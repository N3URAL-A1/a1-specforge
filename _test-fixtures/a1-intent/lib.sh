#!/usr/bin/env bash
# lib.sh — helpers for the a1-intent fixture suite. Sourced by run-tests.sh
# after SUITE_DIR, REPO_ROOT, WORK, pass and fail are set.
#
# Sandbox layout per case (new_sandbox <name>):
#   $WORK/<name>/vault      A1_VAULT_ROOT, with the four lifecycle folders
#   $WORK/<name>/home       HOME, with ~/.a1-intents (0700) and ~/claude-projects
#   $WORK/<name>/trace.log  every read / write / spawn of the CLI (stub/trace.cjs)
# Nothing a case writes lives outside $WORK.
#
# Expectations are typed as literals in the case files. Nothing here imports a
# value from the modules under test (testing.md class 4).

A1_TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
INTENT_LIB="$REPO_ROOT/_shared/lib"
STUB_DIR="$SUITE_DIR/stub"
TRACE_SHIM="$STUB_DIR/trace.cjs"
# Every `a1-tools intent` call runs through stub/a1-tools-as.cjs with the
# call's HOME as the injected passwd home: intent commands refuse a HOME
# that is not the passwd home (A1_HOME_SPLIT, review MINOR-3).
A1_AS="$STUB_DIR/a1-tools-as.cjs"

# Every result line is also appended to $WORK/.results, so cases/99-suite-meta.sh
# can check the tag discipline (FR-038) — also for ok/bad called in a subshell.
w_result() { [[ -n "${WORK:-}" && -d "$WORK" ]] && printf '%s\n' "$1" >>"$WORK/.results"; return 0; }
ok() { echo "PASS  $1"; w_result "PASS  $1"; pass=$((pass + 1)); }
bad() {
  echo "FAIL  $1"
  w_result "FAIL  $1"
  shift
  local line
  for line in "$@"; do printf '      %s\n' "$line"; done
  fail=$((fail + 1))
}

new_sandbox() {
  SB="$WORK/$1"
  VAULT="$SB/vault"
  FHOME="$SB/home"
  TRACE="$SB/trace.log"
  Q="$VAULT/inbox/intents/queued"
  mkdir -p "$SB"
  mk_vault "$VAULT"
  mk_home "$FHOME"
  : >"$TRACE"
}

mk_vault() { mkdir -p "$1/inbox/intents/queued" "$1/inbox/intents/claimed" "$1/inbox/intents/done" "$1/inbox/intents/rejected"; }

# Every sandbox home carries two provisioned fixture devices (Wave 3): the
# phone pixel-robert (mk_intent's default author) and mac-robert (the
# default executor device of set_executor). mk_intent signs with the secret of
# its created_by, so an intent is signed and fresh unless a case says
# otherwise. The secrets are fixture literals, never a real device's.
FIXTURE_DEVICE="pixel-robert"
FIXTURE_SECRET="5a1c0ffee5a1c0ffee5a1c0ffee5a1c0ffee5a1c0ffee5a1c0ffee5a1c0ffee0"
FIXTURE_EXECUTOR_SECRET="e0ec0de5e0ec0de5e0ec0de5e0ec0de5e0ec0de5e0ec0de5e0ec0de5e0ec0de5"

mk_home() {
  mkdir -p "$1/.a1-intents" "$1/claude-projects"
  chmod 700 "$1/.a1-intents"
  printf '{"devices":{"%s":{"secret_hex":"%s","created_at":"2026-09-24T12:00:00.000Z","revoked_at":null},"mac-robert":{"secret_hex":"%s","created_at":"2026-09-24T12:00:00.000Z","revoked_at":null}}}\n' \
    "$FIXTURE_DEVICE" "$FIXTURE_SECRET" "$FIXTURE_EXECUTOR_SECRET" >"$1/.a1-intents/devices.json"
  chmod 600 "$1/.a1-intents/devices.json"
}

# pty_run <outfile> <cmd...> — runs <cmd> with stdout on a pseudo-terminal,
# stdin /dev/null. Sets PTY_RC. macOS and Linux spell `script` differently.
pty_run() {
  local out="$1"
  shift
  if [[ "$(uname -s)" == "Darwin" ]]; then
    script -q /dev/null "$@" </dev/null >"$out" 2>&1
  else
    script -qec "$(printf '%q ' "$@")" /dev/null </dev/null >"$out" 2>&1
  fi
  PTY_RC=$?
}

# provision <device-id> [--qr] — `intent device add` on a pty in the sandbox;
# output in $SB/.pty, exit code in PTY_RC, the stored secret in SECRET.
provision() {
  pty_run "$SB/.pty" env HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent device add "$@"
  SECRET="$(node -e 'try { const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(d.devices[process.argv[2]].secret_hex); } catch (e) {}' \
    "$FHOME/.a1-intents/devices.json" "$1")"
}

# sign_intent <file> <secret-hex> — rewrites the signature line with sign()
# over the file's own fields. The one place the fixture shares code with
# production, deliberately: Lumen must reproduce the canonical string byte for
# byte. cases/03-signature.sh S1 pins it with an independent openssl vector.
sign_intent() {
  node - "$INTENT_LIB" "$1" "$2" <<'JS'
const fs = require('fs');
const [lib, file, secret] = process.argv.slice(2);
const { parseIntentFrontmatter } = require(`${lib}/intent-validate.cjs`);
const { sign } = require(`${lib}/intent-sign.cjs`);
const text = fs.readFileSync(file, 'utf8');
const sig = sign(parseIntentFrontmatter(text).fm, secret);
fs.writeFileSync(file, text.replace(/^signature: .*$/m, `signature: ${sig}`));
JS
}

# fresh_sign <file> — created_at := now, then signed by the fixture device.
# For checked-in vault/ files whose created_at is fixed.
fresh_sign() {
  local now
  now="$(node -e 'process.stdout.write(new Date().toISOString())')"
  node -e 'const fs = require("fs"); const [f, t] = process.argv.slice(1); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^created_at: .*$/m, `created_at: ${t}`))' "$1" "$now"
  sign_intent "$1" "$FIXTURE_SECRET"
}

# sha256_of <file> — the sha256 hex of the file's raw bytes (an approve's
# target_sha256, spec round 6).
sha256_of() {
  node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"
}

# mk_project <slug> — a real project directory with a git repo and an empty
# docs/product/ (the plan's product-docs copy source holds no docs/product/).
mk_project() {
  local dir="$FHOME/claude-projects/$1"
  mkdir -p "$dir/docs/product"
  git init -q "$dir" >/dev/null 2>&1
}

# mk_intent_worktree <slug> — the intent worktree of the fixture intent id of
# stub/a1-tools-as.cjs: since Wave 6 part B the anchor of a write action
# (new-feature, plan, fix, ...) is <home>/claude-projects/a1-worktrees/
# <slug>-intent-<id>, a REAL linked worktree whose `.git` file names
# <project>/.git/worktrees/<slug>-intent-<id> (FR-041 (a), FR-043; review
# m6: no link to the project). One empty base commit is made when the
# project has none. Prints the worktree path; docs/product/ is created in it.
MK_PROJECT_FIXTURE_ID="3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b"
mk_intent_worktree() {
  local dir="$FHOME/claude-projects/$1" wt="$FHOME/claude-projects/a1-worktrees/$1-intent-$MK_PROJECT_FIXTURE_ID"
  git -C "$dir" rev-parse -q --verify HEAD >/dev/null 2>&1 \
    || git -C "$dir" -c user.name=f -c user.email=f@invalid -c core.hooksPath=/dev/null commit -q --allow-empty -m fixture-base
  git -C "$dir" -c core.hooksPath=/dev/null worktree add -q -b "intent/$MK_PROJECT_FIXTURE_ID" "$wt" HEAD >/dev/null 2>&1
  mkdir -p "$wt/docs/product"
  printf '%s' "$wt"
}

# stub_mode <ok|fail|leak|hang> — read by stub/claude from a file under HOME,
# because the spawn contract's env allowlist strips every fixture variable.
stub_mode() {
  mkdir -p "$FHOME/.a1-intents/tmp"
  printf '%s\n' "$1" >"$FHOME/.a1-intents/tmp/stub-mode"
}

# set_executor <hostname> [device-id]
set_executor() {
  printf '{"executor_host":"%s","executor_device":"%s"}\n' "$1" "${2:-mac-robert}" >"$FHOME/.a1-intents/executor.json"
  chmod 600 "$FHOME/.a1-intents/executor.json"
}

# run_intent <args...> — runs `a1-tools intent <args>` inside the sandbox.
# Sets RC, OUT (stdout) and ERR (stderr).
run_intent() {
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" \
    NODE_OPTIONS="--require $TRACE_SHIM" A1_INTENT_FIXTURE_TRACE="$TRACE" \
    node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent "$@" >"$SB/.out" 2>"$SB/.err"
  RC=$?
  OUT="$(cat "$SB/.out")"
  ERR="$(cat "$SB/.err")"
}

# run_intent_novault <args...> — same, but with A1_VAULT_ROOT unset.
run_intent_novault() {
  env -u A1_VAULT_ROOT HOME="$FHOME" PATH="$STUB_DIR:$PATH" \
    NODE_OPTIONS="--require $TRACE_SHIM" A1_INTENT_FIXTURE_TRACE="$TRACE" \
    node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent "$@" >"$SB/.out" 2>"$SB/.err"
  RC=$?
  OUT="$(cat "$SB/.out")"
  ERR="$(cat "$SB/.err")"
}

# mk_intent [key=value ...] [-key ...] [@name=<file>] [@body=<text>] [@raw=<line>]
# Writes a well-formed intent into $Q and prints its path. Defaults: fresh
# lowercase v4 uuid (also the filename stem), action new-feature, project
# real-proj, payload as a block scalar (contract D1), fresh 128-bit nonce,
# created_at now. key=value replaces a frontmatter line verbatim (quote it
# yourself when needed), -key drops it, @raw appends a raw line.
# The result is signed by the fixture device with sign() when its fields
# allow it (Wave 3); @nosign keeps the placeholder signature, and a
# signature=… argument is kept verbatim.
mk_intent() {
  node - "$Q" "$INTENT_LIB" "$FHOME/.a1-intents/devices.json" "$@" <<'JS'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [dir, lib, devicesFile, ...args] = process.argv.slice(2);
let nosign = false;
let ownSig = false;
const id = crypto.randomUUID();
const fields = new Map([
  ['type', 'intent'], ['schema_version', '1'], ['id', id], ['action', 'new-feature'],
  ['project', 'real-proj'], ['payload', '|\n  Push-Benachrichtigung bei neuem Auftrag'],
  ['created_at', new Date().toISOString()], ['created_by', 'pixel-robert'],
  ['nonce', crypto.randomBytes(16).toString('hex')], ['status', 'queued'],
  ['signature', `hmac-sha256:${'0'.repeat(64)}`],
]);
let name = null;
let body = '';
const raw = [];
for (const a of args) {
  if (a === '@nosign') { nosign = true; continue; }
  if (a.startsWith('signature=')) ownSig = true;
  if (a.startsWith('-')) { fields.delete(a.slice(1)); continue; }
  const i = a.indexOf('=');
  const k = a.slice(0, i);
  const v = a.slice(i + 1);
  if (k === '@name') name = v;
  else if (k === '@body') body = v;
  else if (k === '@raw') raw.push(v);
  else fields.set(k, v);
}
const lines = [...fields].map(([k, v]) => `${k}: ${v}`).concat(raw);
const file = path.join(dir, name || `${fields.get('id') || id}.md`);
let text = `---\n${lines.join('\n')}\n---\n${body}`;
if (!nosign && !ownSig && fields.has('signature')) {
  const { parseIntentFrontmatter } = require(`${lib}/intent-validate.cjs`);
  const { sign } = require(`${lib}/intent-sign.cjs`);
  const parsed = parseIntentFrontmatter(text);
  let sig = null;
  let devices = {};
  try { devices = JSON.parse(fs.readFileSync(devicesFile, 'utf8')).devices || {}; } catch (_e) { devices = {}; } // no or broken fixture file: unsigned
  const entry = parsed.ok && typeof parsed.fm.created_by === 'string' ? devices[parsed.fm.created_by] : undefined;
  try { sig = entry ? sign(parsed.fm, entry.secret_hex) : null; } catch (_e) { sig = null; } // shape the signer refuses: keep the placeholder
  if (sig) text = text.replace(/^signature: .*$/m, `signature: ${sig}`);
}
fs.writeFileSync(file, text);
process.stdout.write(file);
JS
}

# expect_verdict <name> <rc> <reasons-csv> — RC must match, stdout must be one
# JSON object whose `reasons` joined by "," equals <reasons-csv> exactly and
# whose `valid` agrees with the exit code.
expect_verdict() {
  local name="$1" want_rc="$2" want="$3" got
  got="$(node -e '
    let o; try { o = JSON.parse(process.argv[1]); } catch (e) { console.log("<stdout is not JSON>"); process.exit(0); }
    const shape = o && typeof o === "object" && !Array.isArray(o) && Array.isArray(o.reasons);
    if (!shape) { console.log("<stdout is not {valid, reasons[]}>"); process.exit(0); }
    if (o.valid !== (o.reasons.length === 0)) { console.log("<valid disagrees with reasons>"); process.exit(0); }
    console.log(o.reasons.join(","));' "$OUT")"
  if [[ "$RC" -eq "$want_rc" && "$got" == "$want" ]]; then ok "$name"
  else bad "$name" "expected exit $want_rc reasons [$want], got exit $RC reasons [$got]" "stderr: ${ERR:0:300}"; fi
}

# expect_no_reason <name> <reason> — stdout JSON parses and does not list <reason>.
expect_no_reason() {
  local name="$1" reason="$2"
  if node -e 'const o = JSON.parse(process.argv[1]); process.exit(o.reasons.includes(process.argv[2]) ? 1 : 0)' "$OUT" "$reason" 2>/dev/null; then ok "$name"
  else bad "$name" "reason $reason present or stdout not JSON (exit $RC): ${OUT:0:300}"; fi
}

# expect_usage <name> — exit 2, nothing on stdout, a "usage error:" sentence on
# stderr. A crash also exits 2 (facade "internal error: …"); it must not pass.
expect_usage() {
  local name="$1"
  if [[ "$RC" -eq 2 && -z "$OUT" && "$ERR" == "usage error: "* ]]; then ok "$name"
  else bad "$name" "expected exit 2, empty stdout, stderr text; got exit $RC" "stdout: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi
}

# tree_listing <dir...> — every path with type, size and mtime, sorted, so a
# before/after compare sees creations, deletions, renames and rewrites.
tree_listing() {
  node -e '
    const fs = require("fs"); const path = require("path"); const out = [];
    const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); const s = fs.lstatSync(p);
      out.push(`${p} ${s.isDirectory() ? "d" : s.isSymbolicLink() ? "l" : "f"} ${s.size} ${s.mtimeMs}`);
      if (s.isDirectory()) walk(p); } };
    for (const d of process.argv.slice(1)) walk(d);
    console.log(out.sort().join("\n"));' "$@"
}

# run_outputs <intent-id> — copies $SB/stdout.txt and $SB/stderr.txt into the
# intent's private run directory ~/.a1-intents/runs/<id>/ (0700, files 0600),
# the only place `complete` reads them from (FR-049). Sets RUN_OUT, RUN_ERR.
run_outputs() {
  local dir="$FHOME/.a1-intents/runs/$1"
  mkdir -p "$dir"
  chmod 700 "$FHOME/.a1-intents/runs" "$dir"
  RUN_OUT="$dir/stdout.txt"
  RUN_ERR="$dir/stderr.txt"
  [[ -f "$SB/stdout.txt" ]] && cp "$SB/stdout.txt" "$RUN_OUT" && chmod 600 "$RUN_OUT"
  [[ -f "$SB/stderr.txt" ]] && cp "$SB/stderr.txt" "$RUN_ERR" && chmod 600 "$RUN_ERR"
  return 0
}
