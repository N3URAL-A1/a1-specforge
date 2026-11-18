#!/usr/bin/env bash
# bin/run-suites.sh — parallel runner for the fixture suites (spec 026-fast-fixture-suites).
#
#   bash bin/run-suites.sh [--workers N] [--root <repo root>] [--job <name> | <selector>...]
#   bash bin/run-suites.sh [--root <repo root>] --check-groups
#
# A selector with "/" is a suite identity (e.g. a1-intent/run-tests.sh); one without is a directory under
# _test-fixtures/ (selects every discovered runner in it). A selector that selects nothing exits 2 before
# the lock, the work dir, the log dir and any suite exist. Without selectors: full run.
# --job <name> runs the identities listed under ci_jobs.<name> in suite-groups.json (one CI job; the name is a
# literal in .github/workflows/test.yml); it cannot be combined with selectors. --check-groups starts nothing
# and exits 1 naming the entry when a runner is in zero or two ci_jobs, a path listed in the declaration file
# no longer exists, or the workflow's `run-suites.sh --job <name>` calls and ci_jobs disagree.
# --locale-native (spec 027 FR-009) skips the `export LC_ALL=C` below and prints one `locale: native` header line.
# --extra-job <name> runs the suites of ci_extra_jobs.<name> in suite-groups.json (kind snapshot-locale: an id
# list or "rest"; needs --locale-native and a root without .git; no --job, no selector). snapshot_incompatible
# (id -> reason) names suites no snapshot-locale job runs; ci_job_workers (job -> 1..6) sets the workers of a
# --job run when neither --workers nor A1_SUITE_WORKERS is given. --check-groups checks all three keys.
# Runs every selected suite exactly once (glob _test-fixtures/*/run*.sh plus
# _test-fixtures/a1-schema-check/parser/run-parser.sh) in a bounded, longest-first worker pool, each
# under an isolated environment (own empty sentinel A1_VAULT_ROOT, own fresh HOME, A1_HOST_ID=leak,
# A1_VAULT_WRITER_HOST unset). Suites under "serial" in _test-fixtures/suite-groups.json run one at a
# time after the pool has drained. Exit 0 = all green, 1 = a suite (or the leak/reconcile check) failed,
# 2 = usage or configuration error (nothing was started).
#
# Env: A1_SUITE_WORKERS (default: online cores - 2, clamped 1..6; --workers wins).
# Files: this entry + bin/run-suites-proc.sh (workers, lock) + bin/run-suites-report.sh (logs, table).
# Portability: Bash 3.2 and GNU (indexed arrays only, no `wait -n`, no mapfile, no `timeout`).
set -u

RS_SELF="${BASH_SOURCE[0]}"
RS_BIN_DIR="$(cd "$(dirname "$RS_SELF")" && pwd)" || { echo "run-suites: cannot resolve its own directory" >&2; exit 2; }
# shellcheck disable=SC1091
. "$RS_BIN_DIR/run-suites-proc.sh" || exit 2
# shellcheck disable=SC1091
. "$RS_BIN_DIR/run-suites-report.sh" || exit 2

RS_PARSER_RUNNER="a1-schema-check/parser/run-parser.sh"
RS_RECON_ID="a1-reconcile/run-tests.sh"
RS_RECON_PATH="_test-fixtures/a1-reconcile"
RS_UNKNOWN_TIMING=9999999999
RS_MAX_LEAK_PATHS=3

RS_ROOT=""
RS_TMP=""
RS_LOGDIR=""
RS_FAILED=0
RS_SEQ=0
RS_SERIAL_LIST=""
RS_TIMING_LINES=""
RS_JOB_LINES=""
RS_JOB=""
RS_CHECK_GROUPS=0
RS_RECON_MODE="none"
RS_DISCOVERED=()
RS_N_DISCOVERED=0
RS_SELECTORS=()
RS_SUBSET=0
RS_LOCALE_NATIVE=0
RS_EXTRA_JOB=""
RS_EXTRA_LINES=""
RS_SNAPINC_LINES=""
RS_WORKERS_LINES=""
RS_EXTRA_KIND=""

rs_die() { echo "run-suites: $*" >&2; exit 2; }

# rs_make_logdir — sets RS_LOGDIR to a fresh run leaf under the per-user base
# ${TMPDIR:-/tmp}/a1-suite-runs-<uid> (mode 700). The base must be a real directory owned by the user and
# not group/world-writable; the leaf is created without -p, so an existing leaf is refused (exit 2).
rs_make_logdir() {
  local base="${TMPDIR:-/tmp}/a1-suite-runs-$(id -u)"
  [ -d "${TMPDIR:-/tmp}" ] || rs_die "temp directory ${TMPDIR:-/tmp} does not exist"
  if [ ! -e "$base" ] && [ ! -L "$base" ]; then mkdir -m 700 "$base" 2>/dev/null || true; fi
  if [ -L "$base" ]; then rs_die "log base $base is a symbolic link; refusing to write logs through it"; fi
  [ -d "$base" ] || rs_die "cannot create the log base directory $base"
  [ -O "$base" ] || rs_die "log base $base is not owned by the current user; refusing to use it"
  if [ -n "$(find "$base" -maxdepth 0 \( -perm -020 -o -perm -002 \) 2>/dev/null)" ]; then
    rs_die "log base $base is group- or world-writable; refusing to use it"
  fi
  RS_LOGDIR="$base/${RS_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
  mkdir -m 700 "$RS_LOGDIR" 2>/dev/null || rs_die "cannot create the log directory $RS_LOGDIR (it may already exist)"
}

rs_cleanup() {
  rs_lock_release
  if [ -n "${RS_TMP:-}" ] && [ -d "$RS_TMP" ]; then
    case "$RS_TMP" in
      */a1-suite-??????)
        find "$RS_TMP" -type d -exec chmod u+rwx {} + 2>/dev/null || true
        rm -rf "$RS_TMP" || true
        ;;
    esac
  fi
  return 0
}

# ---- declaration file (FR-025) ----
# Prints S<TAB>id (serial), N<TAB>id (no_count), J<TAB>job<TAB>id (ci_jobs), T<TAB>id<TAB>seconds (timings),
# X<TAB>name<TAB>kind<TAB>id|*rest* (ci_extra_jobs), I<TAB>id<TAB>reason (snapshot_incompatible),
# W<TAB>job<TAB>n (ci_job_workers); exit 2 on any problem.
rs_read_groups() {
  node -e '
const fs = require("fs");
const f = process.argv[1];
const fail = (m) => { console.error("run-suites: " + f + ": " + m); process.exit(2); };
let j;
try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { fail("cannot read or parse (" + e.message + ")"); }
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);
if (!isObj(j)) fail("top level must be an object");
if (!isList(j.serial)) fail("\"serial\" must be a list of suite identities");
if (!isList(j.no_count)) fail("\"no_count\" must be a list of suite identities");
if (!isObj(j.ci_jobs)) fail("\"ci_jobs\" must be an object");
if (!isObj(j.timings)) fail("\"timings\" must be an object");
for (const k of Object.keys(j.ci_jobs)) {
  if (!/^[A-Za-z0-9_-]+$/.test(k)) fail("ci_jobs name " + JSON.stringify(k) + " must match [A-Za-z0-9_-]+");
  if (!isList(j.ci_jobs[k])) fail("ci_jobs." + k + " must be a list of suite identities");
}
const sec = j.timings.seconds === undefined ? {} : j.timings.seconds;
if (!isObj(sec)) fail("\"timings.seconds\" must be an object");
const ex = j.ci_extra_jobs === undefined ? {} : j.ci_extra_jobs;
if (!isObj(ex)) fail("\"ci_extra_jobs\" must be an object");
const restKinds = new Set();
for (const k of Object.keys(ex)) {
  if (!/^[A-Za-z0-9_-]+$/.test(k)) fail("ci_extra_jobs name " + JSON.stringify(k) + " must match [A-Za-z0-9_-]+");
  if (Object.prototype.hasOwnProperty.call(j.ci_jobs, k)) fail("ci_extra_jobs." + k + " is also a ci_jobs name");
  const e = ex[k];
  if (!isObj(e) || Object.keys(e).some((x) => x !== "kind" && x !== "suites")) fail("ci_extra_jobs." + k + " must be {kind, suites} and nothing else");
  if (e.kind !== "snapshot-locale") fail("ci_extra_jobs." + k + ".kind must be \"snapshot-locale\"");
  if (e.suites === "rest") {
    if (restKinds.has(e.kind)) fail("more than one \"rest\" job of kind " + e.kind);
    restKinds.add(e.kind);
  } else if (!isList(e.suites) || e.suites.length === 0) fail("ci_extra_jobs." + k + ".suites must be a non-empty list of suite identities or \"rest\"");
}
const inc = j.snapshot_incompatible === undefined ? {} : j.snapshot_incompatible;
if (!isObj(inc)) fail("\"snapshot_incompatible\" must be an object");
for (const k of Object.keys(inc)) if (typeof inc[k] !== "string" || inc[k].trim() === "") fail("snapshot_incompatible." + k + " needs a non-empty reason");
const wk = j.ci_job_workers === undefined ? {} : j.ci_job_workers;
if (!isObj(wk)) fail("\"ci_job_workers\" must be an object");
for (const k of Object.keys(wk)) {
  if (!Object.prototype.hasOwnProperty.call(j.ci_jobs, k)) fail("ci_job_workers." + k + " is no ci_jobs name");
  if (typeof wk[k] !== "number" || !Number.isInteger(wk[k]) || wk[k] < 1 || wk[k] > 6) fail("ci_job_workers." + k + " must be an integer from 1 to 6");
}
const out = [];
for (const id of j.serial) out.push("S\t" + id);
for (const id of j.no_count) out.push("N\t" + id);
for (const k of Object.keys(j.ci_jobs)) for (const id of j.ci_jobs[k]) out.push("J\t" + k + "\t" + id);
for (const id of Object.keys(sec)) {
  if (typeof sec[id] !== "number" || !(sec[id] >= 0)) fail("timing of " + id + " must be a number >= 0");
  out.push("T\t" + id + "\t" + Math.round(sec[id]));
}
for (const k of Object.keys(ex)) {
  if (ex[k].suites === "rest") out.push("X\t" + k + "\t" + ex[k].kind + "\t*rest*");
  else for (const id of ex[k].suites) out.push("X\t" + k + "\t" + ex[k].kind + "\t" + id);
}
for (const id of Object.keys(inc)) out.push("I\t" + id + "\t" + inc[id].replace(/[\t\n]+/g, " "));
for (const k of Object.keys(wk)) out.push("W\t" + k + "\t" + wk[k]);
process.stdout.write(out.join("\n") + (out.length ? "\n" : ""));
' "$1"
}

rs_load_groups() {
  local f="$RS_ROOT/_test-fixtures/suite-groups.json" out rc kind a b c
  [ -f "$f" ] || rs_die "$f: declaration file (suite-groups.json) missing"
  out="$(rs_read_groups "$f" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then echo "$out" >&2; exit 2; fi
  while IFS=$'\t' read -r kind a b c; do
    case "$kind" in
      S) RS_SERIAL_LIST="$RS_SERIAL_LIST$a"$'\n' ;;
      X) RS_EXTRA_LINES="$RS_EXTRA_LINES$a"$'\t'"$b"$'\t'"$c"$'\n' ;;
      I) RS_SNAPINC_LINES="$RS_SNAPINC_LINES$a"$'\t'"$b"$'\n' ;;
      W) RS_WORKERS_LINES="$RS_WORKERS_LINES$a"$'\t'"$b"$'\n' ;;
      T) RS_TIMING_LINES="$RS_TIMING_LINES$a"$'\t'"$b"$'\n' ;;
      J) RS_JOB_LINES="$RS_JOB_LINES$a"$'\t'"$b"$'\n' ;;
    esac
  done <<< "$out"
  RS_SERIAL_LIST=$'\n'"$RS_SERIAL_LIST"
}

# rs_is_serial <id> — 0 when listed under "serial".
rs_is_serial() { [[ "$RS_SERIAL_LIST" == *$'\n'"$1"$'\n'* ]]; }

# ---- discovery (FR-001, FR-014) ----
rs_discover() {
  local r id list="" sorted
  for r in "$RS_ROOT"/_test-fixtures/*/run*.sh "$RS_ROOT/_test-fixtures/$RS_PARSER_RUNNER"; do
    [ -f "$r" ] || continue
    id="${r#"$RS_ROOT"/_test-fixtures/}"
    list="$list$id"$'\n'
  done
  sorted="$(printf '%s' "$list" | LC_ALL=C sort -u)"
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    RS_DISCOVERED[$RS_N_DISCOVERED]="$id"
    RS_N_DISCOVERED=$((RS_N_DISCOVERED + 1))
  done <<< "$sorted"
}

# rs_select_job — --job <name>: turns the identities of ci_jobs.<name> into the selectors (before the lock).
rs_select_job() {
  local k id n=0
  [ -n "$RS_JOB" ] || return 0
  [ "${#RS_SELECTORS[@]}" -eq 0 ] || rs_die "--job cannot be combined with selectors"
  while IFS=$'\t' read -r k id; do
    if [ "$k" = "$RS_JOB" ]; then RS_SELECTORS[${#RS_SELECTORS[@]}]="$id"; n=$((n + 1)); fi
  done <<< "$RS_JOB_LINES"
  [ "$n" -gt 0 ] || rs_die "ci job '$RS_JOB' is not listed (or empty) under ci_jobs in _test-fixtures/suite-groups.json; no suite started"
}

# rs_is_snapinc <id> — 0 when the id is listed under snapshot_incompatible.
rs_is_snapinc() { [[ $'\n'"$RS_SNAPINC_LINES" == *$'\n'"$1"$'\t'* ]]; }

# rs_job_workers — the ci_job_workers value of RS_JOB, or nothing.
rs_job_workers() {
  local k n
  while IFS=$'\t' read -r k n; do
    if [ -n "$k" ] && [ "$k" = "$RS_JOB" ]; then printf '%s\n' "$n"; return 0; fi
  done <<< "$RS_WORKERS_LINES"
  return 0
}

# rs_select_extra_job — --extra-job <name> (D10): refusals before the lock, then the selectors.
rs_select_extra_job() {
  local nm kd id explicit="" others="" rest=0 found=0 i
  [ -n "$RS_EXTRA_JOB" ] || return 0
  [ -z "$RS_JOB" ] && [ "${#RS_SELECTORS[@]}" -eq 0 ] || rs_die "--extra-job cannot be combined with --job or selectors"
  while IFS=$'\t' read -r nm kd id; do
    [ -n "$nm" ] || continue
    if [ "$nm" = "$RS_EXTRA_JOB" ]; then
      found=1; RS_EXTRA_KIND="$kd"
      if [ "$id" = "*rest*" ]; then rest=1; else explicit="$explicit$id"$'\n'; fi
    fi
  done <<< "$RS_EXTRA_LINES"
  [ "$found" -eq 1 ] || rs_die "extra job '$RS_EXTRA_JOB' is not listed under ci_extra_jobs in _test-fixtures/suite-groups.json; no suite started"
  if [ "$RS_EXTRA_KIND" = "snapshot-locale" ]; then
    [ "$RS_LOCALE_NATIVE" -eq 1 ] || rs_die "extra job '$RS_EXTRA_JOB' (snapshot-locale) needs --locale-native; no suite started"
    [ ! -e "$RS_ROOT/.git" ] || rs_die "extra job '$RS_EXTRA_JOB' (snapshot-locale) must run from a snapshot without .git, but $RS_ROOT/.git exists; no suite started"
  fi
  if [ "$rest" -eq 1 ]; then
    while IFS=$'\t' read -r nm kd id; do
      [ -n "$nm" ] || continue
      if [ "$nm" != "$RS_EXTRA_JOB" ] && [ "$kd" = "$RS_EXTRA_KIND" ]; then others="$others$id"$'\n'; fi
    done <<< "$RS_EXTRA_LINES"
    i=0
    while [ "$i" -lt "$RS_N_DISCOVERED" ]; do
      id="${RS_DISCOVERED[$i]}"
      if [[ $'\n'"$others" != *$'\n'"$id"$'\n'* ]] && ! rs_is_snapinc "$id"; then RS_SELECTORS[${#RS_SELECTORS[@]}]="$id"; fi
      i=$((i + 1))
    done
  else
    while IFS= read -r id; do
      [ -n "$id" ] || continue
      i=0; found=0
      while [ "$i" -lt "$RS_N_DISCOVERED" ]; do
        if [ "${RS_DISCOVERED[$i]}" = "$id" ]; then found=1; fi
        i=$((i + 1))
      done
      [ "$found" -eq 1 ] || rs_die "extra job '$RS_EXTRA_JOB' lists $id, which is no discovered suite; no suite started"
      if ! rs_is_snapinc "$id"; then RS_SELECTORS[${#RS_SELECTORS[@]}]="$id"; fi
    done <<< "$explicit"
  fi
  [ "${#RS_SELECTORS[@]}" -gt 0 ] || rs_die "extra job '$RS_EXTRA_JOB' selects no suite; no suite started"
}

# rs_check_groups — FR-017. Reads the declaration file, the discovered set (stdin) and the workflow line calls;
# prints one line per finding. Exit 0 consistent, 1 findings, 2 unreadable workflow.
rs_check_groups() {
  local wf="$RS_ROOT/.github/workflows/test.yml"
  [ -f "$wf" ] || rs_die "check-groups: workflow $wf missing"
  printf '%s\n' "${RS_DISCOVERED[@]}" | node -e '
const fs = require("fs");
const [groups, wf] = process.argv.slice(1);
const found = new Set(fs.readFileSync(0, "utf8").split("\n").filter(Boolean));
const j = JSON.parse(fs.readFileSync(groups, "utf8"));
const out = [];
const jobsOf = new Map();
for (const [name, ids] of Object.entries(j.ci_jobs)) {
  for (const id of ids) {
    if (!found.has(id)) { out.push(id + ": listed under ci_jobs but no such suite (job " + name + ")"); continue; }
    jobsOf.set(id, (jobsOf.get(id) || []).concat(name));
  }
}
for (const id of [...found].sort()) {
  const js = [...new Set(jobsOf.get(id) || [])];
  if (js.length === 0) out.push(id + ": in no ci job (list it in exactly one ci_jobs entry)");
  if ((jobsOf.get(id) || []).length > 1) out.push(id + ": in two ci jobs (" + jobsOf.get(id).join(", ") + ")");
}
for (const list of ["serial", "no_count"]) for (const id of j[list]) if (!found.has(id)) out.push(id + ": listed under " + list + " but no such suite");
for (const id of Object.keys(j.timings.seconds || {})) if (!found.has(id)) out.push(id + ": listed under timings but no such suite");
const called = new Set();
const seenGhost = new Set();
const lines = fs.readFileSync(wf, "utf8").split("\n");
// The allowlist for a call line (FR-017): the line, minus a leading `- ` / `run:` / `run: |`, must be exactly this.
const ALLOWED_CALL = /^bash bin\/run-suites\.sh( --[a-z-]+( [^ ]+)?)* --job[= ]"?[A-Za-z0-9_-]+"?$/;
const ALLOWED_EXTRA = /^bash bin\/run-suites\.sh( --[a-z-]+( [^ ]+)?)* --extra-job[= ]"?[A-Za-z0-9_-]+"?$/;
const callText = (l) => l.trim().replace(/^-\s+/, "").replace(/^run:\s*(\|[-+]?)?\s*/, "");
const indentOf = (l) => l.match(/^\s*/)[0].length;
// The text of the step (or job) that holds line n: from its opening line to the line before the next sibling.
const blockAround = (n, opener, ind) => {
  let a = n;
  while (a >= 0 && !(opener(lines[a]) && indentOf(lines[a]) <= ind(lines[n]))) a--;
  if (a < 0) return "";
  const base = indentOf(lines[a]);
  let z = a + 1;
  while (z < lines.length && (lines[z].trim() === "" || indentOf(lines[z]) > base || (/^\s*#/.test(lines[z])))) z++;
  return lines.slice(a, z).filter((l) => !/^\s*#/.test(l)).join("\n");
};
// scanCalls — every workflow line that calls run-suites.sh with <flag>: findings for calls that cannot gate,
// and the valid calls (name -> line numbers). Shared by --job and --extra-job.
const scanCalls = (flag, re, allowed, known, knownIn) => {
  const calls = new Map();
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n].replace(/(^|\s)#.*$/, "$1");
    const m = l.match(re);
    if (!m) continue;
    const job = m[1];
    const before = l.slice(0, l.indexOf("run-suites.sh"));
    const after = l.slice(l.indexOf("run-suites.sh"));
    let why = "";
    if (/\b(echo|printf)\b/.test(before)) why = "inside an echo/printf";
    else if (/\|\|\s*(true|:|exit\s+0)\b/.test(after)) why = "behind `|| true`";
    else if (!allowed.test(callText(l))) why = "call line is not `bash bin/run-suites.sh [--flag [value]]... --" + flag + " <name>` alone (allowlist)";
    else {
      const step = blockAround(n, (x) => /^\s*-\s/.test(x), (x) => indentOf(x));
      if (/\bset\s+\+e\b/.test(step)) why = "in a run block with `set +e`";
      const jobb = blockAround(n, (x) => /^  [A-Za-z0-9_-]+:\s*$/.test(x), () => 2);
      const gating = (x) => /^\s*(-\s+)?(if|continue-on-error):/.test(x) && !/continue-on-error:\s*["\x27]?false["\x27]?\s*$/.test(x);
      const stepOwn = step.split("\n").filter(gating);
      const jobOwn = jobb.split("\n").filter((x) => /^    (if|continue-on-error):/.test(x) && gating(x));
      if (why) { /* set +e */ }
      else if (stepOwn.length) why = "in a step with " + stepOwn[0].trim().replace(/^-\s+/, "").split(":")[0] + ":";
      else if (jobOwn.length) why = "in a job with " + jobOwn[0].trim().split(":")[0] + ":";
    }
    if (why) { out.push("workflow call of --" + flag + " " + job + " cannot gate (" + why + ")"); continue; }
    calls.set(job, (calls.get(job) || []).concat(n));
    if (!Object.prototype.hasOwnProperty.call(known, job) && !seenGhost.has(flag + job)) {
      seenGhost.add(flag + job);
      out.push("workflow calls --" + flag + " " + job + " but " + knownIn + " has no such job");
    }
  }
  return calls;
};
const jobCalls = scanCalls("job", /run-suites\.sh\b.*?--job(?:=|\s+)["\x27]?([A-Za-z0-9_-]+)/, ALLOWED_CALL, j.ci_jobs, "ci_jobs");
for (const k of jobCalls.keys()) called.add(k);
for (const name of Object.keys(j.ci_jobs)) if (!called.has(name)) out.push("ci job " + name + " is called by no workflow line");
const ex = j.ci_extra_jobs || {};
const inc = j.snapshot_incompatible || {};
const extraCalls = scanCalls("extra-job", /run-suites\.sh\b.*?--extra-job(?:=|\s+)["\x27]?([A-Za-z0-9_-]+)/, ALLOWED_EXTRA, ex, "ci_extra_jobs");
for (const name of Object.keys(ex)) {
  const at = extraCalls.get(name) || [];
  if (at.length === 0) { out.push("extra job " + name + " is called by no workflow line"); continue; }
  if (at.length > 1) out.push("extra job " + name + " is called by " + at.length + " workflow lines (exactly one)");
  if (!/(^|\s)--locale-native(\s|$)/.test(callText(lines[at[0]].replace(/(^|\s)#.*$/, "$1")))) {
    out.push("workflow call of --extra-job " + name + " lacks --locale-native");
  }
  const jb = blockAround(at[0], (x) => /^  [A-Za-z0-9_-]+:\s*$/.test(x), () => 2);
  if (!/\bgit archive\b/.test(jb)) out.push("extra job " + name + ": job block has no `git archive` line");
  if (!/test ! -e[^\n]*\.git\b/.test(jb)) out.push("extra job " + name + ": job block has no `test ! -e` line naming .git");
  if (!/\blocale -a\b/.test(jb)) out.push("extra job " + name + ": job block has no `locale -a` line");
  if (/^\s*needs:/m.test(jb)) out.push("extra job " + name + ": job block has needs: (it must run in parallel)");
  if (/A1_XPROV_ONLY/.test(jb)) out.push("extra job " + name + ": job block sets A1_XPROV_ONLY (the harness fails it under $CI)");
}
for (const id of Object.keys(inc)) if (!found.has(id)) out.push(id + ": listed under snapshot_incompatible but no such suite");
const member = new Map();
let hasRest = false;
for (const [name, e] of Object.entries(ex)) {
  if (e.suites === "rest") { hasRest = true; continue; }
  for (const id of e.suites) {
    if (!found.has(id)) { out.push(id + ": listed under ci_extra_jobs but no such suite (job " + name + ")"); continue; }
    member.set(id, (member.get(id) || []).concat(name));
  }
}
if (Object.keys(ex).length) {
  for (const id of [...found].sort()) {
    const where = (member.get(id) || []).concat(Object.prototype.hasOwnProperty.call(inc, id) ? ["snapshot_incompatible"] : []);
    if (where.length > 1) out.push(id + ": in two snapshot-locale places (" + where.join(", ") + ")");
    else if (where.length === 0 && !hasRest) out.push(id + ": in no snapshot-locale job (list it in exactly one ci_extra_jobs entry or snapshot_incompatible)");
  }
}
for (const l of out) console.log("check-groups: " + l);
console.log("check-groups: " + (out.length ? out.length + " finding(s)" : "ok, " + found.size + " suites in " + Object.keys(j.ci_jobs).length + " ci jobs"));
process.exit(out.length ? 1 : 0);
' "$RS_ROOT/_test-fixtures/suite-groups.json" "$wf"
}

# rs_select — narrows RS_DISCOVERED to the suites picked by RS_SELECTORS (no-op for a full run). Runs before
# the lock, work dir and log dir, so a selector that selects nothing exits 2 with nothing left behind.
rs_select() {
  local s id i picked="" kept=() n=0
  [ "${#RS_SELECTORS[@]}" -gt 0 ] || return 0
  for s in "${RS_SELECTORS[@]}"; do
    [ -n "$s" ] || rs_die "empty selector argument; nothing selected, no suite started"
    i=0; n=0
    while [ "$i" -lt "$RS_N_DISCOVERED" ]; do
      id="${RS_DISCOVERED[$i]}"
      case "$s" in
        */*) [ "$id" = "$s" ] && n=$((n + 1)) && picked="$picked$id"$'\n' ;;
        *) [ "${id%%/*}" = "$s" ] && n=$((n + 1)) && picked="$picked$id"$'\n' ;;
      esac
      i=$((i + 1))
    done
    if [ "$n" -eq 0 ]; then
      rs_die "selector '$s' matches no discovered suite (identity: <dir>/<runner>, or a directory under _test-fixtures/); no suite started"
    fi
  done
  i=0
  while [ "$i" -lt "$RS_N_DISCOVERED" ]; do
    id="${RS_DISCOVERED[$i]}"
    if [[ "$picked" == *"$id"$'\n'* ]]; then
      # exact line match: a name that is a suffix of another identity must not count
      if printf '%s' "$picked" | grep -qxF -- "$id"; then kept[${#kept[@]}]="$id"; fi
    fi
    i=$((i + 1))
  done
  RS_DISCOVERED=("${kept[@]}")
  RS_N_DISCOVERED="${#kept[@]}"
  RS_SUBSET=1
}

# rs_timing_of <id> — reference seconds, or the "unknown" key (unknown suites start first).
rs_timing_of() {
  local id="$1" k t
  while IFS=$'\t' read -r k t; do
    if [ "$k" = "$id" ]; then printf '%s\n' "$t"; return 0; fi
  done <<< "$RS_TIMING_LINES"
  printf '%s\n' "$RS_UNKNOWN_TIMING"
}

# rs_order <file> — writes <file>.sorted: key, identity, S|P; longest first (unknown first, then name).
rs_order() {
  local i=0 id t key kind
  : > "$1"
  while [ "$i" -lt "$RS_N_DISCOVERED" ]; do
    id="${RS_DISCOVERED[$i]}"
    t="$(rs_timing_of "$id")"
    key="$(printf '%010d' "$t")"
    kind=P
    if rs_is_serial "$id"; then kind=S; fi
    printf '%s\t%s\t%s\n' "$key" "$id" "$kind" >> "$1"
    i=$((i + 1))
  done
  LC_ALL=C sort -t"$(printf '\t')" -k1,1r -k2,2 "$1" > "$1.sorted"
}

# ---- one finished suite: result, leak check, isolation dirs removed ----
rs_on_suite_done() {
  local slot="$1" rc="$2" left="${3:-0}" id log dir vault elapsed note="" warn="" leaked st p
  id="${RS_SLOT_ID[$slot]}"; log="${RS_SLOT_LOG[$slot]}"; dir="${RS_SLOT_DIR[$slot]}"
  vault="$dir/vault"
  elapsed=$((SECONDS - ${RS_SLOT_START[$slot]}))
  if [ "$rc" -gt 128 ]; then note="killed by signal $((rc - 128))"; fi
  if [ "$left" -ne 0 ]; then
    # Leftovers are a warning, not a failure: the suite's own exit and the leak check below decide.
    echo "warning: suite $id left ${RS_LEFT_COUNT:-?} process(es) running after it finished; the runner ended them"
    warn="ended ${RS_LEFT_COUNT:-?} leftover processes"
    if [ "$left" -ge 2 ]; then warn="$warn; some survived SIGKILL"; fi
  fi
  if [ -d "$vault" ] && [ -n "$(ls -A "$vault" 2>/dev/null)" ]; then
    note="${note:+$note; }wrote into its sentinel vault"
    echo "suite $id left files in its sentinel vault (first $RS_MAX_LEAK_PATHS):"
    leaked="$(find "$vault" -mindepth 1 2>/dev/null | LC_ALL=C sort | head -n "$RS_MAX_LEAK_PATHS")"
    while IFS= read -r p; do
      if [ -n "$p" ]; then echo "  leaked: $p"; fi
    done <<< "$leaked"
  fi
  p="$(rs_summary_note "$id" "$rc" "$log")"
  if [ -n "$p" ]; then note="${note:+$note; }$p"; fi
  st=PASS
  if [ "$rc" -ne 0 ] || [ -n "$note" ]; then st=FAIL; fi
  echo "done: $st $id (${elapsed}s)"
  rs_record_result "$id" "$rc" "$elapsed" "$log" "$note" "$warn"
  rs_remove_slot_dir "$dir"
  RS_SLOT_ID[$slot]=""; RS_SLOT_DIR[$slot]=""
}

rs_remove_slot_dir() {
  local d="$1"
  case "$d" in
    "$RS_TMP"/w[0-9]*)
      if [ -d "$d" ]; then
        find "$d" -type d -exec chmod u+rwx {} + 2>/dev/null || true
        rm -rf "$d" || true
      fi
      ;;
  esac
}

# rs_start_suite <id> — a free slot is required. Failing to build the isolation dirs fails that suite only.
rs_start_suite() {
  local id="$1" slot d log
  slot="$(rs_free_slot)" || return 1
  RS_SEQ=$((RS_SEQ + 1))
  d="$RS_TMP/w$RS_SEQ"
  log="$RS_LOGDIR/${id//\//__}.log"
  if ! mkdir -p "$d/home" "$d/vault"; then
    echo "run-suites: cannot create isolation directories for $id" > "$log" 2>&1 || true
    echo "done: FAIL $id (0s)"
    rs_record_result "$id" 2 0 "$log" "cannot create isolation directories"
    return 0
  fi
  rs_spawn_worker "$id" "$log" "$d/home" "$d/vault"
  RS_SLOT_PID[$slot]="$RS_LAST_PGID"
  RS_SLOT_ID[$slot]="$id"
  RS_SLOT_START[$slot]="$SECONDS"
  RS_SLOT_LOG[$slot]="$log"
  RS_SLOT_DIR[$slot]="$d"
  RS_RUNNING=$((RS_RUNNING + 1))
  rs_lock_pgids_sync
}

# rs_run_batch <width> <id>... — at most <width> suites at once; returns when all have ended.
rs_run_batch() {
  local width="$1" total next=0
  shift
  total=$#
  if [ "$total" -eq 0 ]; then return 0; fi
  local ids=("$@")
  rs_slots_reset "$width"
  while [ "$next" -lt "$total" ] || [ "$RS_RUNNING" -gt 0 ]; do
    while [ "$next" -lt "$total" ] && [ "$RS_RUNNING" -lt "$width" ]; do
      rs_start_suite "${ids[$next]}" || break
      next=$((next + 1))
    done
    rs_wait_any
  done
}

# ---- a1-reconcile restore/clean check (FR-021): once, after all workers ----
rs_root_is_git_toplevel() {
  local top phys
  top="$(git -C "$RS_ROOT" rev-parse --show-toplevel 2>/dev/null)" || return 1
  phys="$(cd "$RS_ROOT" && pwd -P)" || return 1
  [ "$top" = "$phys" ]
}
rs_recon_porcelain() { git -C "$RS_ROOT" status --porcelain -- "$RS_RECON_PATH" 2>/dev/null; }

rs_reconcile_pre() {
  local i=0 sel=0
  while [ "$i" -lt "$RS_N_DISCOVERED" ]; do
    if [ "${RS_DISCOVERED[$i]}" = "$RS_RECON_ID" ]; then sel=1; fi
    i=$((i + 1))
  done
  if [ "$sel" -ne 1 ]; then return 0; fi
  if ! rs_root_is_git_toplevel; then RS_RECON_MODE=nogit
  elif [ -z "$(rs_recon_porcelain)" ]; then RS_RECON_MODE=clean
  else RS_RECON_MODE=dirty; fi
}

rs_reconcile_post() {
  local left
  case "$RS_RECON_MODE" in
    nogit) echo "reconcile check skipped: no git work tree at $RS_ROOT" ;;
    dirty) echo "reconcile check skipped: $RS_RECON_PATH had local edits before the run; left untouched" ;;
    clean)
      if [ -n "$(rs_recon_porcelain)" ]; then
        if git -C "$RS_ROOT" checkout HEAD -- "$RS_RECON_PATH" >/dev/null 2>&1; then
          echo "reconcile check: restored $RS_RECON_PATH to its committed state"
        fi
      fi
      left="$(rs_recon_porcelain)"
      if [ -n "$left" ]; then
        echo "reconcile check FAILED: $RS_RECON_PATH is still modified:"
        printf '%s\n' "$left" | sed 's/^/  /'
        RS_FAILED=1
      else
        echo "reconcile check: $RS_RECON_PATH is clean"
      fi
      ;;
  esac
}

# ---- learnings check (SEC-1b): a suite must not write the fallback learning store of the repo root ----
# A worker that unsets A1_VAULT_ROOT writes to <root>/.a1/learnings (gitignored). Listing (ignored files
# included, one line per file) plus a checksum per file, before and after the run; any difference is red.
RS_LEARN_PATH=".a1/learnings"
RS_LEARN_MODE="none"
RS_LEARN_FILE_MAX_LINES=10
rs_learn_state() {
  git -C "$RS_ROOT" status --porcelain --ignored -uall -- "$RS_LEARN_PATH" 2>/dev/null
  if [ -d "$RS_ROOT/$RS_LEARN_PATH" ]; then
    ( cd "$RS_ROOT" && find "$RS_LEARN_PATH" -type f -exec cksum {} + 2>/dev/null | LC_ALL=C sort -k3 )
  fi
  return 0
}
rs_learn_pre() {
  if ! rs_root_is_git_toplevel; then
    RS_LEARN_MODE=nogit
    return 0
  fi
  RS_LEARN_MODE=check
  rs_learn_state > "$RS_TMP/learn.before"
}
rs_learn_post() {
  case "$RS_LEARN_MODE" in
    nogit) echo "learnings check skipped: $RS_ROOT is not a git top-level directory" ;;
    check)
      rs_learn_state > "$RS_TMP/learn.after"
      if cmp -s "$RS_TMP/learn.before" "$RS_TMP/learn.after"; then
        echo "learnings check: $RS_LEARN_PATH unchanged"
      else
        echo "learnings check FAILED: $RS_LEARN_PATH changed during the run (a suite wrote the fallback store):"
        diff "$RS_TMP/learn.before" "$RS_TMP/learn.after" | head -n "$RS_LEARN_FILE_MAX_LINES" | sed 's/^/  /'
        RS_FAILED=1
      fi
      ;;
  esac
}

# ---- phases check: a suite must not write the gate log (or anything) under the checkout's .a1/phases ----
# Same shape as the learnings check: listing (ignored files included) plus a checksum per file, before and after.
RS_PHASES_PATH=".a1/phases"
RS_PHASES_MODE="none"
RS_PHASES_FILE_MAX_LINES=10
rs_phases_state() {
  git -C "$RS_ROOT" status --porcelain --ignored -uall -- "$RS_PHASES_PATH" 2>/dev/null
  if [ -d "$RS_ROOT/$RS_PHASES_PATH" ]; then
    ( cd "$RS_ROOT" && find "$RS_PHASES_PATH" -type f -exec cksum {} + 2>/dev/null | LC_ALL=C sort -k3 )
  fi
  return 0
}
rs_phases_pre() {
  if ! rs_root_is_git_toplevel; then
    RS_PHASES_MODE=nogit
    return 0
  fi
  RS_PHASES_MODE=check
  rs_phases_state > "$RS_TMP/phases.before"
}
rs_phases_post() {
  case "$RS_PHASES_MODE" in
    nogit) echo "phases check skipped: $RS_ROOT is not a git top-level directory" ;;
    check)
      rs_phases_state > "$RS_TMP/phases.after"
      if cmp -s "$RS_TMP/phases.before" "$RS_TMP/phases.after"; then
        echo "phases check: $RS_PHASES_PATH unchanged"
      else
        echo "phases check FAILED: $RS_PHASES_PATH changed during the run (a suite or a concurrent process wrote under .a1/phases):"
        diff "$RS_TMP/phases.before" "$RS_TMP/phases.after" | head -n "$RS_PHASES_FILE_MAX_LINES" | sed 's/^/  /'
        RS_FAILED=1
      fi
      ;;
  esac
}

# ---- main ----
rs_main() {
  local workers="" order i key id kind
  local pool=() serial=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --workers) [ $# -ge 2 ] || rs_die "--workers needs a value"; workers="$2"; shift 2 ;;
      --workers=*) workers="${1#--workers=}"; shift ;;
      --job) [ $# -ge 2 ] || rs_die "--job needs a ci job name"; RS_JOB="$2"; shift 2 ;;
      --job=*) RS_JOB="${1#--job=}"; shift ;;
      --extra-job) [ $# -ge 2 ] || rs_die "--extra-job needs an extra job name"; RS_EXTRA_JOB="$2"; shift 2 ;;
      --extra-job=*) RS_EXTRA_JOB="${1#--extra-job=}"; shift ;;
      --locale-native) RS_LOCALE_NATIVE=1; shift ;;
      --check-groups) RS_CHECK_GROUPS=1; shift ;;
      --root) [ $# -ge 2 ] || rs_die "--root needs a directory"; RS_ROOT="$2"; shift 2 ;;
      -h|--help) sed -n '2,28p' "$RS_SELF"; exit 0 ;;
      -*) rs_die "unknown argument: $1" ;;
      *) RS_SELECTORS[${#RS_SELECTORS[@]}]="$1"; shift ;;
    esac
  done
  if [ -z "$workers" ]; then workers="${A1_SUITE_WORKERS:-}"; fi
  if [ -n "$workers" ] && ! rs_is_posint "$workers"; then
    rs_die "workers must be an integer from 1 to 9999 (got '$workers')"
  fi
  [ -n "$RS_ROOT" ] || RS_ROOT="$(cd "$RS_BIN_DIR/.." && pwd)"
  [ -d "$RS_ROOT/_test-fixtures" ] || rs_die "no _test-fixtures directory under $RS_ROOT"
  RS_ROOT="$(cd "$RS_ROOT" && pwd -P)" || rs_die "cannot resolve $RS_ROOT"

  rs_load_groups
  # workers: --workers > A1_SUITE_WORKERS > ci_job_workers of --job > default
  if [ -z "$workers" ] && [ -n "$RS_JOB" ]; then workers="$(rs_job_workers)"; fi
  if [ -z "$workers" ]; then
    workers="$(rs_default_workers "$(getconf _NPROCESSORS_ONLN 2>/dev/null)" "$(sysctl -n hw.ncpu 2>/dev/null)")"
  fi
  rs_discover
  [ "$RS_N_DISCOVERED" -gt 0 ] || rs_die "no suites discovered under $RS_ROOT/_test-fixtures"
  if [ "$RS_CHECK_GROUPS" -eq 1 ]; then
    [ -z "$RS_JOB" ] && [ -z "$RS_EXTRA_JOB" ] && [ "${#RS_SELECTORS[@]}" -eq 0 ] || rs_die "--check-groups takes no --job, no --extra-job and no selector"
    rs_check_groups
    exit $?
  fi
  rs_select_job
  rs_select_extra_job
  rs_select

  # The runner's own outer vault, kept for the real-store guard; set before any per-worker env is built.
  if [ -n "${A1_VAULT_ROOT:-}" ]; then export A1_SUITE_REAL_VAULT="$A1_VAULT_ROOT"; else unset A1_SUITE_REAL_VAULT; fi
  # FR-027: every worker collates, sorts and globs like CI (C locale), whatever the machine's locale is.
  # --locale-native (spec 027 FR-009) skips it: the snapshot-locale CI jobs run under the runner's own locale.
  if [ "$RS_LOCALE_NATIVE" -eq 0 ]; then export LC_ALL=C; fi

  rs_lock_acquire || exit 2
  trap rs_cleanup EXIT
  trap 'rs_on_signal INT' INT
  trap 'rs_on_signal TERM' TERM

  RS_TMP="$(mktemp -d "${TMPDIR:-/tmp}/a1-suite-XXXXXX")" || rs_die "cannot create a work directory under ${TMPDIR:-/tmp}"
  [ -n "$RS_TMP" ] && [ -d "$RS_TMP" ] || rs_die "work directory missing"
  rs_make_logdir

  echo "log dir: $RS_LOGDIR"
  if [ "$RS_SUBSET" -eq 1 ]; then
    i=0; id=""
    while [ "$i" -lt "$RS_N_DISCOVERED" ]; do id="$id${id:+ }${RS_DISCOVERED[$i]}"; i=$((i + 1)); done
    echo "subset run: $id"
  else
    echo "full run"
  fi
  echo "workers: $workers"
  if [ "$RS_LOCALE_NATIVE" -eq 1 ]; then
    echo "locale: native (LANG=${LANG-unset}, LC_ALL=${LC_ALL-unset})"
  fi
  if [ "$RS_EXTRA_KIND" = "snapshot-locale" ]; then
    local sk sr
    while IFS=$'\t' read -r sk sr; do
      if [ -n "$sk" ]; then echo "snapshot-incompatible (not run in any snapshot-locale job): $sk - $sr"; fi
    done <<< "$RS_SNAPINC_LINES"
  fi
  echo "discovered $RS_N_DISCOVERED suites"
  i=0
  while [ "$i" -lt "$RS_N_DISCOVERED" ]; do echo "${RS_DISCOVERED[$i]}"; i=$((i + 1)); done

  order="$RS_TMP/order"
  rs_order "$order"
  while IFS=$'\t' read -r key id kind; do
    if [ "$kind" = S ]; then serial[${#serial[@]}]="$id"; else pool[${#pool[@]}]="$id"; fi
  done < "$order.sorted"

  rs_reconcile_pre
  rs_learn_pre
  rs_phases_pre
  RS_T0="$SECONDS"
  if [ "${#pool[@]}" -gt 0 ]; then rs_run_batch "$workers" "${pool[@]}"; fi
  if [ "${#serial[@]}" -gt 0 ]; then rs_run_batch 1 "${serial[@]}"; fi
  rs_reconcile_post
  rs_learn_post
  rs_phases_post

  rs_print_table
  rs_print_failures
  echo "total wall-clock: $((SECONDS - RS_T0))s"
  i=0
  while [ "$i" -lt "$RS_N_RES" ]; do
    if [ "${RS_RES_RC[$i]}" -ne 0 ] || [ -n "${RS_RES_NOTE[$i]}" ]; then RS_FAILED=1; fi
    i=$((i + 1))
  done
  [ "$RS_FAILED" -eq 0 ]
}

rs_main "$@"
exit $?
