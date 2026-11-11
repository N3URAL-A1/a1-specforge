#!/usr/bin/env bash
# Part 37 — spec 025 Wave 7 task 7.3 (FR-020): the leftovers of the removed gates `wave-inspect-xprov` and `pr-diff-xprov`
# (index rows, owner waiver records, `.a1-review/xreview/` cover files) stay as history. Every `xprov` subcommand the suite runs
# exits as it would without them, never rewrites them, and no migration code exists. Sourced by run-tests.sh.
#
# Method: the same battery runs twice, once in a repository without the legacy files (A, the baseline) and once in an identical one
# that holds them (B). Exit code and output (repository, home and artifact paths normalized) must match per command, and the
# baseline must hit the exit code written here as a literal, so a battery that fails the same way twice proves nothing. The
# seeds are static files under cases/legacy-state/ in the shapes the removed gates wrote (index rows from the old normalize
# entry, waiver records from parts/06 waiver6, XREVIEW.md section from the old renderSection).
#   LG1  no-permit repository: gate, load-check, design-targets (plan and base mode), dispose, waive, permit-check, handover-check,
#        scope and `gate --gate <removed id>` give the baseline exit code and output; no seeded file changes (sha256 per file).
#        Red if a reader throws or exits differently on an unknown gate id (load-check, dispose, design-targets, waiver store).
#   LG2  permitted repository: a real plan review (fake runner) takes round 1 beside four legacy rows and the owner store, writes
#        its row after them, and every legacy row, the waiver store and the cover files stay byte for byte. Red if the round
#        counter or the pass lookup reads a legacy row, or if a write rewrites rows or records it does not know.
#   LG3  the waiver store holds only legacy records: still readable (readWaivers ok), load-check exits as baseline.
#   LG4  `git grep` finds no migration code for the removed ids; a planted migration line proves the pattern matches (control).
# Seeds are copied into temp dirs only; every write target is checked non-empty and under the suite temp root before use.

LG_CASES="$CASES/legacy-state"
mk_workdir LG37_TMP lg37
LG37_SAVED_HOME="$HOME"
LG37_PLAN_GATE="plan-review-xprov"

# lg_under_tmp <path> — refuses empty paths and anything outside the suite temp root (a leak into the cwd was found once).
lg_under_tmp() {
  local p="$1"
  [[ -n "$p" && "$p" == /* && "$p" != *".."* ]] || return 1
  case "$p" in "$LG37_TMP"/*|"$A1_FX_ROOT"/*) return 0 ;; esac
  return 1
}

# lg_env <tag> — fresh tree and phase repo p37 under its own fake HOME; sets LG_REPO, LG_PHASE_DIR, LG_HOME.
lg_env() {
  local tag="$1"
  make_tree; make_phase p37
  LG_REPO="$PHASE_REPO"; LG_PHASE_DIR="$PHASE_DIR"
  LG_HOME="$LG37_TMP/home-$tag"
  lg_under_tmp "$LG_HOME" || { bad "LG harness: home $LG_HOME is not under the temp root"; return 1; }
  mkdir -p "$LG_HOME/.codex"; printf '{"fixture":true}\n' > "$LG_HOME/.codex/auth.json"; chmod 600 "$LG_HOME/.codex/auth.json"
  export HOME="$LG_HOME"
}

# lg_seed — the three legacy kinds into the current LG_REPO / LG_HOME; sets LG_SEEDED (the files, one per line).
lg_seed() {
  lg_under_tmp "$LG_PHASE_DIR" && lg_under_tmp "$LG_REPO" && lg_under_tmp "$LG_HOME" || { bad "LG harness: a seed target is outside the temp root"; return 1; }
  mkdir -p "$LG_PHASE_DIR/xreview" "$LG_HOME/.a1-xprov" "$LG_REPO/.a1-review/xreview"
  chmod 700 "$LG_HOME/.a1-xprov"
  cp "$LG_CASES/index.json" "$LG_PHASE_DIR/xreview/index.json"
  cp "$LG_CASES/XREVIEW.md" "$LG_PHASE_DIR/XREVIEW.md"
  cp "$LG_CASES/waivers.json" "$LG_HOME/.a1-xprov/waivers.json"; chmod 600 "$LG_HOME/.a1-xprov/waivers.json"
  cp "$LG_CASES/cover/index.json" "$LG_REPO/.a1-review/xreview/index.json"
  cp "$LG_CASES/cover/XREVIEW.md" "$LG_REPO/.a1-review/xreview/XREVIEW.md"
  cp "$LG_CASES/cover/observations.jsonl" "$LG_REPO/.a1-review/xreview/observations.jsonl"
  LG_SEEDED="$LG_PHASE_DIR/xreview/index.json
$LG_PHASE_DIR/XREVIEW.md
$LG_HOME/.a1-xprov/waivers.json
$LG_REPO/.a1-review/xreview/index.json
$LG_REPO/.a1-review/xreview/XREVIEW.md
$LG_REPO/.a1-review/xreview/observations.jsonl"
}

# lg_sums <files, one per line> — "sha256  path" lines.
lg_sums() {
  local f
  while IFS= read -r f; do [[ -n "$f" ]] && { if [[ -f "$f" ]]; then printf '%s  %s\n' "$(sha256_of "$f")" "$f"; else printf 'MISSING  %s\n' "$f"; fi; }; done <<< "$1"
}

# lg_norm <text> — repository, home and artifact paths replaced, so two repositories compare byte for byte.
lg_norm() {
  local t="$1" real
  real="$(cd "$LG_REPO" && pwd -P)"
  t="${t//$real/<R>}"; t="${t//$LG_REPO/<R>}"; t="${t//$LG_HOME/<H>}"
  printf '%s' "$t" | sed -E 's#tmp\.[A-Za-z0-9]+#tmp.X#g; s#phase_repo\.[A-Za-z0-9]+#phase_repo.X#g'
}

# lg_cmd <outdir> <name> <args...> — one xprov subcommand from inside LG_REPO; stores "rc", normalized stdout and stderr.
lg_cmd() {
  local dir="$1" name="$2"; shift 2
  lg_under_tmp "$dir" || { bad "LG harness: result dir $dir is not under the temp root"; return 1; }
  mkdir -p "$dir"
  local out err rc
  out="$(cd "$LG_REPO" && node "$TREE_TOOLS" xprov "$@" 2>"$dir/$name.err.raw" </dev/null)"; rc=$?
  err="$(cat "$dir/$name.err.raw")"
  printf '%s\n' "$rc" > "$dir/$name.rc"
  lg_norm "$out" > "$dir/$name.out"; lg_norm "$err" > "$dir/$name.err"
}

# lg_battery <outdir> — the no-permit battery (nothing it runs writes a file; the baseline proves that too).
lg_battery() {
  local d="$1" paths="$LG37_TMP/paths.txt"
  printf 'docs/readme.md\nsrc/add.js\n' > "$paths"
  lg_cmd "$d" gate gate --phase p37 --gate "$LG37_PLAN_GATE" --timeout 7
  lg_cmd "$d" loadcheck load-check --phase p37
  lg_cmd "$d" dispose dispose --phase p37 --gate "$LG37_PLAN_GATE"
  lg_cmd "$d" waive waive --phase p37 --gate "$LG37_PLAN_GATE" --reason fixture --by fixture
  lg_cmd "$d" permitcheck permit-check
  lg_cmd "$d" handover handover-check
  lg_cmd "$d" scope scope --paths "$paths"
  lg_cmd "$d" targets-plan design-targets --phase p37 --plan "$LG_PHASE_DIR/PLAN.md"
  lg_cmd "$d" targets-base design-targets --phase p37 --base HEAD
  lg_cmd "$d" gate-removed-wave gate --phase p37 --gate wave-inspect-xprov --wave 3
  lg_cmd "$d" gate-removed-pr gate --phase p37 --gate pr-diff-xprov
}

# The exit code each command gives WITHOUT the legacy files, written down from the baseline run of 2026-11-11 (not read back from B).
LG_EXPECT="gate:1 loadcheck:0 dispose:1 waive:2 permitcheck:1 handover:0 scope:0 targets-plan:0 targets-base:0 gate-removed-wave:2 gate-removed-pr:2"

# ---------- LG1: no-permit repository, baseline against seeded ----------
caseLG1() {
  lg_env A || return 0
  local da="$LG37_TMP/res-A"; lg_battery "$da"
  local base_repo="$LG_REPO" base_home="$LG_HOME"
  lg_env B || return 0
  lg_seed || return 0
  local db="$LG37_TMP/res-B" before after
  before="$(lg_sums "$LG_SEEDED")"
  lg_battery "$db"
  after="$(lg_sums "$LG_SEEDED")"
  local pair name want
  for pair in $LG_EXPECT; do
    name="${pair%%:*}"; want="${pair##*:}"
    assert_eq "LG1 $name baseline exit code is the literal $want" "$(cat "$da/$name.rc" 2>/dev/null)" "$want"
    assert_eq "LG1 $name exits as without the legacy files" "$(cat "$db/$name.rc" 2>/dev/null)" "$(cat "$da/$name.rc" 2>/dev/null)"
    cmp -s "$da/$name.out" "$db/$name.out" && ok "LG1 $name stdout is byte-identical to the baseline" || bad "LG1 $name stdout differs: $(diff "$da/$name.out" "$db/$name.out" | head -4 | tr '\n' ' ')"
    cmp -s "$da/$name.err" "$db/$name.err" && ok "LG1 $name stderr is byte-identical to the baseline" || bad "LG1 $name stderr differs: $(diff "$da/$name.err" "$db/$name.err" | head -4 | tr '\n' ' ')"
  done
  assert_eq "LG1 six legacy files were seeded and none is missing" "$(printf '%s\n' "$before" | grep -c -v MISSING)" "6"
  [[ "$before" == "$after" ]] && ok "LG1 sha256 of every seeded file is unchanged by the battery" || bad "LG1 a seeded file changed: $(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -4 | tr '\n' ' ')"
  # the seeds are the committed fixture files, byte for byte (the copy did not alter them)
  assert_eq "LG1 seeded index.json equals the committed seed" "$(sha256_of "$LG_PHASE_DIR/xreview/index.json")" "$(sha256_of "$LG_CASES/index.json")"
  assert_eq "LG1 the baseline repo has no legacy file" "$(ls "$base_repo/.a1-review" "$base_home/.a1-xprov" 2>/dev/null | wc -l | tr -d ' ')" "0"
}

# ---------- LG2: permitted repository, a real plan review beside the legacy rows ----------
lg_permitted() {
  lg_env "$1" || return 1
  write_permit "$LG_REPO" fixture record/2026-09-24-fixture.md
  make_home; ln -s "$LG_HOME/.codex/auth.json" "$XHOME/auth.json"; export A1_XPROV_CODEX_HOME="$XHOME"
}

caseLG2() {
  lg_permitted A2 || return 0
  local da="$LG37_TMP/res-A2"
  FAKE_RUNNER_CASE=approved fake_runner_env
  lg_cmd "$da" gate gate --phase p37 --gate "$LG37_PLAN_GATE" --timeout 7
  lg_cmd "$da" loadcheck load-check --phase p37
  lg_permitted B2 || return 0
  lg_seed || return 0
  local db="$LG37_TMP/res-B2" before after
  # the seeds that the gate legitimately appends to (phase index, XREVIEW.md) are compared by prefix below; the rest by sha256
  local fixed="$LG_HOME/.a1-xprov/waivers.json
$LG_REPO/.a1-review/xreview/index.json
$LG_REPO/.a1-review/xreview/XREVIEW.md
$LG_REPO/.a1-review/xreview/observations.jsonl"
  before="$(lg_sums "$fixed")"
  FAKE_RUNNER_CASE=approved fake_runner_env
  lg_cmd "$db" gate gate --phase p37 --gate "$LG37_PLAN_GATE" --timeout 7
  lg_cmd "$db" loadcheck load-check --phase p37
  after="$(lg_sums "$fixed")"
  assert_eq "LG2 baseline plan review passes with exit 0" "$(cat "$da/gate.rc")" "0"
  assert_eq "LG2 seeded plan review exits as the baseline" "$(cat "$db/gate.rc")" "$(cat "$da/gate.rc")"
  local ga gb; ga="$(cat "$da/gate.out")"; gb="$(cat "$db/gate.out")"
  local expr="[j.verdict, j.step, j.round, j.enforcement, j.mode].join('/')"
  assert_eq "LG2 baseline verdict, step, round 1" "$(json_get "$ga" "$expr")" "pass/normalize/1/blocking/review"
  assert_eq "LG2 seeded run takes round 1 too (legacy rows are not counted)" "$(json_get "$gb" "$expr")" "$(json_get "$ga" "$expr")"
  assert_eq "LG2 baseline load-check accepts the pass" "$(json_get "$(cat "$da/loadcheck.out")" "j.accepted")" "pass"
  assert_eq "LG2 seeded load-check accepts the pass too" "$(json_get "$(cat "$db/loadcheck.out")" "j.accepted")" "pass"
  [[ "$before" == "$after" ]] && ok "LG2 waiver store and cover files keep their sha256 after a real gate run" || bad "LG2 a seeded file changed: $(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -4 | tr '\n' ' ')"
  # the phase index: the four legacy rows first and unchanged, the new row after them
  local got
  got="$(node -e '
    const fs = require("fs"); const [seed, live] = process.argv.slice(1);
    const s = JSON.parse(fs.readFileSync(seed, "utf8")); const l = JSON.parse(fs.readFileSync(live, "utf8"));
    const same = s.every((row, i) => JSON.stringify(row) === JSON.stringify(l[i]));
    process.stdout.write([l.length - s.length, same, l[s.length] && l[s.length].gate].join("/"));
  ' "$LG_CASES/index.json" "$LG_PHASE_DIR/xreview/index.json" 2>&1)"
  assert_eq "LG2 index.json: one new row after the four legacy rows, which are unchanged" "$got" "1/true/$LG37_PLAN_GATE"
  local seed_len; seed_len="$(wc -c < "$LG_CASES/XREVIEW.md" | tr -d ' ')"
  assert_eq "LG2 XREVIEW.md keeps the legacy section as its first bytes" "$(head -c "$seed_len" "$LG_PHASE_DIR/XREVIEW.md" | cmp -s - "$LG_CASES/XREVIEW.md" && echo same || echo changed)" "same"
}

# ---------- LG3: a store with only legacy records ----------
caseLG3() {
  lg_env C || return 0
  lg_seed || return 0
  local before after
  before="$(lg_sums "$LG_HOME/.a1-xprov/waivers.json")"
  local got
  got="$(cd "$LG_REPO" && node -e '
    const W = require(process.argv[1] + "/_shared/lib/xprov-waivers.cjs");
    const r = W.readWaivers(); process.stdout.write([r.ok, r.waivers.length, r.waivers.map((w) => w.gate).join(",")].join("/"));
  ' "$TREE" 2>&1)"
  assert_eq "LG3 readWaivers lists both legacy records and reports ok" "$got" "true/2/wave-inspect-xprov,pr-diff-xprov"
  lg_cmd "$LG37_TMP/res-C" loadcheck load-check --phase p37
  assert_eq "LG3 load-check beside a legacy-only store exits 0 (not applicable, no permit)" "$(cat "$LG37_TMP/res-C/loadcheck.rc")" "0"
  after="$(lg_sums "$LG_HOME/.a1-xprov/waivers.json")"
  [[ "$before" == "$after" ]] && ok "LG3 reading the store never rewrites it" || bad "LG3 the waiver store changed"
}

# ---------- LG4: no migration code for the removed ids ----------
caseLG4() {
  local pat='(migrat|upgrade|convert|rename|unlink|rmSync|delete|writeFile|rewrite)'
  # lines that name a removed id (literal or the constants) AND a rewriting verb, in the code the CLI runs
  local hits
  hits="$(cd "$REPO_ROOT" && git grep -n --untracked -i -E "(wave-inspect-xprov|pr-diff-xprov|RETIRED_GATE_IDS|RETIRED_IDS)" -- '_shared/a1-tools.cjs' '_shared/lib/*.cjs' 'bin' 'hooks' 2>/dev/null | grep -i -E "$pat" || true)"
  assert_eq "LG4 no line in the CLI code names a removed gate id together with a migrate/rewrite/delete verb" "$hits" ""
  # control: the same filter finds a planted migration line (a grep that cannot match proves nothing)
  mk_workdir LG4_REPO lg4repo
  ( cd "$LG4_REPO" && git init -q && mkdir -p _shared/lib \
    && printf 'function migrateLegacy(rows) { return rows.filter((r) => r.gate !== "wave-inspect-xprov"); }\n' > _shared/lib/planted.cjs \
    && git add -A ) >/dev/null 2>&1
  local planted
  planted="$(cd "$LG4_REPO" && git grep -n --untracked -i -E "(wave-inspect-xprov|pr-diff-xprov|RETIRED_GATE_IDS|RETIRED_IDS)" -- '_shared/lib/*.cjs' 2>/dev/null | grep -i -E "$pat" | wc -l | tr -d ' ')"
  assert_eq "LG4 control: a planted migration line is found by the same filter" "$planted" "1"
  # the one reader of the retired ids in the store code only keeps records inert
  local reads
  reads="$(cd "$REPO_ROOT" && git grep -c "RETIRED_GATE_IDS" -- '_shared/lib/*.cjs' | tr '\n' ' ')"
  assert_eq "LG4 RETIRED_GATE_IDS appears only in a comment of gate-ids.cjs, its definition and export, and the waiver reader" "$reads" "_shared/lib/gate-ids.cjs:1 _shared/lib/xprov-waivers.cjs:1 _shared/lib/xprov.cjs:2 "
}

caseLG1; caseLG2; caseLG3; caseLG4
export HOME="$LG37_SAVED_HOME"; unset A1_XPROV_CODEX_HOME
