#!/usr/bin/env bash
# cases/05-complete.sh — spec 011 Wave 5: `intent complete` writes the
# secret-filtered, size-capped result note under project/<slug>/intents/,
# moves claimed/ -> done/, closes the ledger row. Sourced by run-tests.sh.
#
# RED proof (CONVENTIONS.md): the single production change that turns each
# case red, each measured on a `git archive HEAD` copy before commit.
#   R1  the note written to project/<slug>/<id>.md, without the `intents`
#       segment (R1a); the intent rewritten through io.writeMdAtomic (R1b:
#       original line order lost); the ledger patch dropping result_sha256
#       (R1c).
#   R2  every exit code mapped to done (R2a); accepting any failure string
#       (R2b); dropping the queue-control refusal (R2c: a note appears);
#       requiring an integer exit code even with a failure reason (R2d).
#   R3  dropping `truncated` from the key list (R3a); duration_s from
#       claimed_at instead of started_at (R3a: 330 -> other); hostname taken
#       from os.hostname() instead of deps (R3a); the started_at fallback to
#       claimed_at removed (R3b: null); tailLines keeping 50 lines (R3c).
#   R4  comparing size only (R4a: the touched file 010-b vanishes); walking
#       project/ instead of project/<slug>/ (R4a: other-proj listed);
#       artifacts without the before-snapshot, i.e. all files (R4a: 009-c);
#       accepting a snapshot of another project (R4c).
#   R5  capping the body but not counting the frontmatter (R5a: > 16384
#       bytes); truncated hardwired false (R5a) or true (R5b); cutting the
#       head of an oversized single line instead of keeping its tail (R5c).
#   R6  removing any single pattern from REDACTION_PATTERNS (each sub-assert
#       R6a…R6m dies alone; the inputs are built so that only their own
#       pattern matches them, the PEM block collapses to one [REDACTED]).
#   R7  changing a pattern source or flag without updating this frozen list.
#   R8  adding a bare-UUID or bare-hex pattern (R8a); the spec's original
#       key/value source (R8c: Bearer/Basic token and JSON value survive).
#   R9  taking the 40-line tail before redacting (R9a: PEM body lines leak);
#       dropping the orphan-END guard of a cut read (R9b); keeping the
#       partial first line of a cut read (R9c).
#   R10 no ledger row accepted (R10a); the sha256 check skipped (R10b); a
#       closed row accepted (R10c); reading the intent before the host check
#       (R10d: trace shows the read).
#   R11 a decision that does not log, or that logs stdout text (R11a/b).
#   R12 removing `complete` from the intent-cli table or not exporting
#       cmdIntentComplete ("not implemented").
#   R13 a case that vanishes without a PASS or FAIL line (a quote in a
#       literal once swallowed R7 silently): this file must report exactly
#       45 cases before R13.

W5_RAN_BEFORE=$((pass + fail))
W5_HOST="$(node -e 'process.stdout.write(require("os").hostname())')"
W5_PAYLOAD_TEXT="Push-Benachrichtigung bei neuem Auftrag"

w5_sandbox() {
  new_sandbox "$1"
  mk_project real-proj
  set_executor "$W5_HOST"
  W5_LEDGER="$FHOME/.a1-intents-ledger.json"
  W5_LOG="$FHOME/.a1-intents/log.jsonl"
  W5_C="$VAULT/inbox/intents/claimed"
  W5_D="$VAULT/inbox/intents/done"
  W5_P="$VAULT/project/real-proj"
  mkdir -p "$W5_P"
  printf 'plain line\n' >"$SB/stdout.txt"
  : >"$SB/stderr.txt"
}

# w5_claimed [mk_intent args...] — a claimed intent through the real claim;
# sets W5_ID and W5_F (the claimed/ path).
w5_claimed() {
  local q
  q="$(mk_intent "$@")"
  W5_ID="$(basename "$q" .md)"
  run_intent claim "$q"
  W5_F="$W5_C/$W5_ID.md"
}

# w5_forge <action> <target> — a claimed/ file written by hand plus a matching
# open ledger row (claimed_sha256 of the file), for actions the fixture cannot
# claim through the real path (approve needs a real target).
w5_forge() {
  W5_ID="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
  W5_F="$W5_C/$W5_ID.md"
  node - "$W5_F" "$W5_LEDGER" "$W5_ID" "$1" "$2" <<'JS'
const fs = require('fs');
const crypto = require('crypto');
const [file, ledger, id, action, target] = process.argv.slice(2);
const text = ['---', 'type: intent', 'schema_version: 1', `id: ${id}`, `action: ${action}`, 'project: real-proj',
  `target: ${target}`, 'payload: ""', `created_at: ${new Date().toISOString()}`, 'created_by: mac-robert',
  `nonce: ${crypto.randomBytes(16).toString('hex')}`, 'status: claimed', `signature: hmac-sha256:${'0'.repeat(64)}`,
  'claimed_by: forged', `claimed_at: ${new Date().toISOString()}`, '---', ''].join('\n');
fs.writeFileSync(file, text);
let rows = [];
try { rows = JSON.parse(fs.readFileSync(ledger, 'utf8')).rows; } catch (_e) { rows = []; } // no ledger yet
rows.push({ id, device: 'mac-robert', nonce: 'n', action, project: 'real-proj', claimed_at: new Date().toISOString(),
  claimed_sha256: crypto.createHash('sha256').update(text).digest('hex'), started_at: null, finished_at: null,
  outcome: 'claimed', result_path: null, result_sha256: null });
fs.writeFileSync(ledger, JSON.stringify({ rows }));
JS
}

# w5_lib <js> [args...] — JS with R (intent-result) and G (ledger) loaded,
# inside the sandbox HOME and vault.
w5_lib() {
  local js="$1"
  shift
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e "
    const lib = process.argv[1];
    const fs = require('fs');
    // Wave 6 part B: complete of a write action reads the worktree registry
    // of the passwd home; the seam keeps it in the sandbox home.
    require(lib + '/intent-child.cjs').injectChildDeps({ passwdHome: () => process.env.HOME });
    const R = require(lib + '/intent-result.cjs');
    const argv = process.argv.slice(2);
    $js" "$INTENT_LIB" "$@" 2>&1
}

w5_field() { node -e 'let t = ""; try { t = require("fs").readFileSync(process.argv[1], "utf8"); } catch (e) {} const m = t.match(new RegExp("^" + process.argv[2] + ": (.*)$", "m")); process.stdout.write(m ? m[1] : "<none>")' "$1" "$2"; }
w5_keys() { node -e 'let t = ""; try { t = require("fs").readFileSync(process.argv[1], "utf8"); } catch (e) {} const fm = t.split("\n---\n")[0]; process.stdout.write((fm.match(/^[a-z_]+(?=:)/gm) || []).join(","))' "$1"; }
w5_sha() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }
w5_row() { node -e 'try { const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const r = d.rows.find((x) => x.id === process.argv[2]); console.log(eval(process.argv[3])); } catch (e) { console.log("<no row>"); }' "$W5_LEDGER" "$W5_ID" "$1"; }
w5_count() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }
w5_lines() { if [[ -f "$1" ]]; then wc -l <"$1" | tr -d ' '; else echo 0; fi; }
w5_bytes() { if [[ -f "$1" ]]; then wc -c <"$1" | tr -d ' '; else echo 0; fi; }
w5_complete() { run_outputs "$W5_ID"; run_intent complete "$W5_F" --exit-code "$1" --stdout "$RUN_OUT" --stderr "$RUN_ERR" "${@:2}"; }

# ---------- R1: done path, line-preserving rewrite, ledger close ----------
w5_sandbox r1
w5_claimed
cp "$W5_F" "$SB/claimed-copy.md"
w5_complete 0
r1_note="$W5_P/intents/$W5_ID.md"
if [[ "$RC" -eq 0 && -f "$r1_note" && ! -f "$W5_P/$W5_ID.md" && -f "$W5_D/$W5_ID.md" && "$(w5_count "$W5_C")" == "0" \
  && "$(w5_field "$W5_D/$W5_ID.md" status)" == "done" && "$(w5_field "$W5_D/$W5_ID.md" exit_code)" == "0" \
  && "$(w5_field "$W5_D/$W5_ID.md" finished_at)" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$ ]]; then
  ok "R1a exit 0: note at project/real-proj/intents/<id>.md, intent in done/ with status done, exit_code 0, finished_at [FR-029]"
else bad "R1a exit 0: note at project/real-proj/intents/<id>.md, intent in done/ with status done, exit_code 0, finished_at [FR-029]" "rc $RC, out: ${OUT:0:300}" "stderr: ${ERR:0:300}"; fi

r1_order="$(node -e '
  const fs = require("fs");
  const fmLines = (f) => fs.readFileSync(f, "utf8").split("\n---\n")[0].split("\n").slice(1);
  const before = fmLines(process.argv[1]);
  const after = fmLines(process.argv[2]);
  const statusAt = before.findIndex((l) => l.startsWith("status:"));
  const sameOrder = JSON.stringify(after.slice(0, before.length).filter((_l, i) => i !== statusAt)) === JSON.stringify(before.filter((_l, i) => i !== statusAt));
  const added = after.slice(before.length).map((l) => l.split(":")[0]).join(",");
  console.log(sameOrder && after[statusAt] === "status: done" ? added : "<order changed>");' \
  "$SB/claimed-copy.md" "$W5_D/$W5_ID.md" 2>&1)"
if [[ "$r1_order" == "finished_at,exit_code" ]]; then ok "R1b the done/ file keeps every claimed line in order and appends finished_at, exit_code [FR-029]"
else bad "R1b the done/ file keeps every claimed line in order and appends finished_at, exit_code [FR-029]" "got: $r1_order"; fi

r1_row="$(w5_row '[r.outcome, r.result_path, r.result_sha256, /^\d{4}-\d\d-\d\dT[\d:.]{12}Z$/.test(r.finished_at)].join("|")')"
if [[ "$r1_row" == "done|project/real-proj/intents/$W5_ID.md|$(w5_sha "$r1_note" 2>/dev/null)|true" ]]; then
  ok "R1c ledger row closed: outcome done, result_path vault-relative, result_sha256 = sha256 of the note, finished_at [FR-029]"
else bad "R1c ledger row closed: outcome done, result_path vault-relative, result_sha256 = sha256 of the note, finished_at [FR-029]" "row: $r1_row"; fi

# ---------- R2: failed, failure reasons, queue-control ----------
w5_sandbox r2
w5_claimed
w5_complete 3
r2_note="$W5_P/intents/$W5_ID.md"
if [[ "$RC" -eq 0 && "$(w5_field "$W5_D/$W5_ID.md" status)" == "failed" && "$(w5_field "$W5_D/$W5_ID.md" failure_reason)" == "nonzero_exit" \
  && "$(w5_field "$W5_D/$W5_ID.md" exit_code)" == "3" && "$(w5_field "$r2_note" status)" == "failed" \
  && "$(w5_field "$r2_note" failure_reason)" == "nonzero_exit" && "$(w5_row 'r.outcome')" == "failed" ]]; then
  ok "R2a exit 3 -> status failed, failure_reason nonzero_exit in intent, note and ledger [FR-029]"
else bad "R2a exit 3 -> status failed, failure_reason nonzero_exit in intent, note and ledger [FR-029]" "rc $RC, out: ${OUT:0:300}" "stderr: ${ERR:0:300}"; fi

w5_claimed
w5_complete 1 --failure-reason bogus
if [[ "$RC" -eq 2 && -z "$OUT" && "$ERR" == "usage error: "* && -f "$W5_F" && ! -f "$W5_P/intents/$W5_ID.md" ]]; then
  ok "R2b --failure-reason bogus -> exit 2, nothing moved, no note [FR-029]"
else bad "R2b --failure-reason bogus -> exit 2, nothing moved, no note [FR-029]" "rc $RC, out: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi

r2_bad=""
r2_notes="$(w5_count "$W5_P/intents")"
for action in approve cancel; do
  w5_forge "$action" "$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
  w5_complete 0
  [[ "$RC" -eq 2 && -z "$OUT" && -f "$W5_F" && ! -e "$W5_P/intents/$W5_ID.md" && "$(w5_row 'r.outcome')" == "claimed" ]] || r2_bad="$r2_bad $action:$RC"
done
if [[ -z "$r2_bad" && "$(w5_count "$W5_P/intents")" == "$r2_notes" ]]; then
  ok "R2c complete on an approve or cancel intent -> exit 2, no result note, intent stays in claimed/, row open [FR-029]"
else bad "R2c complete on an approve or cancel intent -> exit 2, no result note, intent stays in claimed/, row open [FR-029]" "$r2_bad" "stderr: ${ERR:0:200}"; fi

w5_claimed
w5_complete null --failure-reason timeout
if [[ "$RC" -eq 0 && "$(w5_field "$W5_D/$W5_ID.md" status)" == "failed" && "$(w5_field "$W5_D/$W5_ID.md" failure_reason)" == "timeout" \
  && "$(w5_field "$W5_P/intents/$W5_ID.md" exit_code)" == "null" ]]; then
  ok "R2d --exit-code null --failure-reason timeout -> failed: timeout, exit_code null (a killed child has no code) [FR-029]"
else bad "R2d --exit-code null --failure-reason timeout -> failed: timeout, exit_code null (a killed child has no code) [FR-029]" "rc $RC, out: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi
w5_claimed
w5_complete null
r2e_rc="$RC"
w5_complete 0 --failure-reason nonzero_exit
if [[ "$r2e_rc" -eq 2 && "$RC" -eq 2 && -f "$W5_F" ]]; then ok "R2e exit_code null without a reason, and nonzero_exit with exit 0, are usage errors [FR-029]"
else bad "R2e exit_code null without a reason, and nonzero_exit with exit 0, are usage errors [FR-029]" "rc $r2e_rc / $RC"; fi

# ---------- R3: the 15 keys, duration, executor host, tails ----------
w5_sandbox r3
w5_claimed
node -e 'const fs = require("fs"); const f = process.argv[1]; const d = JSON.parse(fs.readFileSync(f, "utf8"));
  d.rows = d.rows.map((r) => ({ ...r, started_at: "2026-09-27T10:00:00.000Z" })); fs.writeFileSync(f, JSON.stringify(d));' "$W5_LEDGER"
set_executor mac-w5
node -e 'for (let i = 1; i <= 50; i += 1) console.log(`out-${String(i).padStart(2, "0")}`)' >"$SB/stdout.txt"
node -e 'for (let i = 1; i <= 30; i += 1) console.log(`err-${String(i).padStart(2, "0")}`)' >"$SB/stderr.txt"
run_outputs "$W5_ID"
r3_rc="$(w5_lib 'const r = R.completeIntent(argv[0], { exitCode: 0, stdoutFile: argv[1], stderrFile: argv[2] },
  { hostname: "mac-w5", now: () => Date.parse("2026-09-27T10:05:30.000Z") }); console.log(r.exitCode)' "$W5_F" "$RUN_OUT" "$RUN_ERR" | tail -1)"
r3_note="$W5_P/intents/$W5_ID.md"
r3_want="type,schema_version,intent_id,action,project,target,status,failure_reason,started_at,finished_at,duration_s,exit_code,executor_host,branch,worktree_path,artifacts,truncated"
r3_vals="$(w5_field "$r3_note" type)|$(w5_field "$r3_note" schema_version)|$(w5_field "$r3_note" intent_id)|$(w5_field "$r3_note" action)|$(w5_field "$r3_note" project)|$(w5_field "$r3_note" target)|$(w5_field "$r3_note" status)|$(w5_field "$r3_note" failure_reason)|$(w5_field "$r3_note" started_at)|$(w5_field "$r3_note" finished_at)|$(w5_field "$r3_note" duration_s)|$(w5_field "$r3_note" exit_code)|$(w5_field "$r3_note" executor_host)|$(w5_field "$r3_note" branch)|$(w5_field "$r3_note" worktree_path)|$(w5_field "$r3_note" artifacts)|$(w5_field "$r3_note" truncated)"
if [[ "$r3_rc" == "0" && "$(w5_keys "$r3_note")" == "$r3_want" \
  && "$r3_vals" == "intent-result|1|$W5_ID|new-feature|real-proj|null|done|null|2026-09-27T10:00:00.000Z|2026-09-27T10:05:30.000Z|330|0|mac-w5|null|null|[]|false" ]]; then
  ok "R3a note frontmatter: exactly the 17 keys in order (branch, worktree_path null without an intent worktree); duration_s 330 = finished - started; executor_host = injected host [FR-030]"
else bad "R3a note frontmatter: exactly the 17 keys in order (branch, worktree_path null without an intent worktree); duration_s 330 = finished - started; executor_host = injected host [FR-030]" "rc $r3_rc keys $(w5_keys "$r3_note")" "vals $r3_vals"; fi

r3_body="$(node -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); const b = t.slice(t.indexOf("\n---\n", 4) + 5);
  const sec = (h) => { const i = b.indexOf(h); const j = b.indexOf("\n## ", i + 1); return b.slice(i, j === -1 ? undefined : j); };
  const s = sec("## Summary"), e = sec("## Stderr");
  const outs = (s.match(/^out-\d\d$/gm) || []), errs = (e.match(/^err-\d\d$/gm) || []);
  console.log([b.indexOf("## Summary") < b.indexOf("## Stderr"), outs.length, outs[0], outs[outs.length - 1], errs.length, errs[0], errs[errs.length - 1]].join("|"))' "$r3_note" 2>&1)"
if [[ "$r3_body" == "true|40|out-11|out-50|20|err-11|err-30" ]]; then
  ok "R3c body: ## Summary = the last 40 stdout lines, then ## Stderr = the last 20 stderr lines [FR-030]"
else bad "R3c body: ## Summary = the last 40 stdout lines, then ## Stderr = the last 20 stderr lines [FR-030]" "got: $r3_body"; fi

w5_sandbox r3b
w5_claimed
w5_complete 0
if [[ "$RC" -eq 0 && "$(w5_field "$W5_P/intents/$W5_ID.md" started_at)" == "$(w5_row 'r.claimed_at')" && "$(w5_field "$W5_P/intents/$W5_ID.md" executor_host)" == "$W5_HOST" ]]; then
  ok "R3b a row without started_at (manual complete) reports claimed_at as started_at [FR-030]"
else bad "R3b a row without started_at (manual complete) reports claimed_at as started_at [FR-030]" "rc $RC started_at $(w5_field "$W5_P/intents/$W5_ID.md" started_at) claimed_at $(w5_row 'r.claimed_at')"; fi

# ---------- R4: artifacts = vault diff under project/<slug>/ only ----------
w5_sandbox r4
mkdir -p "$W5_P/spec" "$VAULT/project/other-proj"
printf 'a\n' >"$W5_P/spec/011-a.md"
printf 'b\n' >"$W5_P/spec/010-b.md"
printf 'c\n' >"$W5_P/spec/009-c.md"
printf 'y\n' >"$VAULT/project/other-proj/y.md"
w5_claimed
# The before-snapshot lives in the private dir (security review 4–5, MINOR-F).
W5_RUNS="$FHOME/.a1-intents/runs"
mkdir -p "$W5_RUNS" && chmod 700 "$W5_RUNS"
w5_lib 'fs.writeFileSync(argv[0], JSON.stringify(R.snapshotProject("real-proj")), { mode: 0o600 })' "$W5_RUNS/snap.json" >/dev/null
printf 'x' >>"$W5_P/spec/011-a.md"
node -e 'const fs = require("fs"); const t = new Date(Date.now() + 10000); fs.utimesSync(process.argv[1], t, t)' "$W5_P/spec/010-b.md"
printf 'new\n' >"$W5_P/spec/012-x.md"
printf 'yy\n' >"$VAULT/project/other-proj/y.md"
printf 'repo\n' >"$FHOME/claude-projects/real-proj/repo-file.md"
: >"$TRACE"
w5_complete 0 --snapshot "$W5_RUNS/snap.json"
r4_art="$(node -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); const m = t.match(/^artifacts:\n((?:  - .*\n)*)/m); console.log(m ? m[1].split("\n").filter(Boolean).map((l) => l.slice(4)).join(",") : "<none>")' "$W5_P/intents/$W5_ID.md" 2>&1)"
if [[ "$RC" -eq 0 && "$r4_art" == "project/real-proj/spec/010-b.md,project/real-proj/spec/011-a.md,project/real-proj/spec/012-x.md" ]]; then
  ok "R4a artifacts: created, appended and touched files under project/real-proj/, sorted; untouched and other-project files absent [FR-030]"
else bad "R4a artifacts: created, appended and touched files under project/real-proj/, sorted; untouched and other-project files absent [FR-030]" "rc $RC artifacts: $r4_art" "stderr: ${ERR:0:300}"; fi
if ! grep -qF "$FHOME/claude-projects" "$TRACE" && grep -q "^read .*/r4/vault/project/real-proj/spec/" "$TRACE"; then
  ok "R4b the artifacts snapshot reads the vault project folder and never the repo (~/claude-projects) [FR-030]"
else bad "R4b the artifacts snapshot reads the vault project folder and never the repo (~/claude-projects) [FR-030]" "$(grep -cF "$FHOME/claude-projects" "$TRACE") repo lines" "$(grep -F "$FHOME/claude-projects" "$TRACE" | head -3)"; fi

w5_claimed
w5_lib 'fs.writeFileSync(argv[0], JSON.stringify(R.snapshotProject("other-proj")), { mode: 0o600 })' "$W5_RUNS/snap-other.json" >/dev/null
w5_complete 0 --snapshot "$W5_RUNS/snap-other.json"
r4c_rc="$RC"
w5_complete 0
if [[ "$r4c_rc" -eq 2 && "$RC" -eq 0 && "$(w5_field "$W5_P/intents/$W5_ID.md" artifacts)" == "[]" ]]; then
  ok "R4c a snapshot of another project is a usage error; without --snapshot artifacts is [] [FR-030]"
else bad "R4c a snapshot of another project is a usage error; without --snapshot artifacts is [] [FR-030]" "rc $r4c_rc / $RC, artifacts $(w5_field "$W5_P/intents/$W5_ID.md" artifacts)"; fi

# ---------- R5: size cap and truncated ----------
w5_sandbox r5
w5_claimed
node -e 'for (let i = 1; i <= 50; i += 1) console.log(`L${String(i).padStart(2, "0")} ` + "o".repeat(2000))' >"$SB/stdout.txt"
node -e 'for (let i = 1; i <= 50; i += 1) console.log(`E${String(i).padStart(2, "0")} ` + "e".repeat(2000))' >"$SB/stderr.txt"
w5_complete 0
r5_note="$W5_P/intents/$W5_ID.md"
if [[ "$RC" -eq 0 && "$(w5_bytes "$r5_note")" -le 16384 && "$(w5_bytes "$r5_note")" -ge 12000 && "$(w5_field "$r5_note" truncated)" == "true" ]] \
  && grep -q "^L50 o" "$r5_note" && grep -q "^E50 e" "$r5_note"; then
  ok "R5a 100 KB stdout + 100 KB stderr -> note <= 16384 bytes (frontmatter counted), truncated true, both last lines kept [FR-030]"
else bad "R5a 100 KB stdout + 100 KB stderr -> note <= 16384 bytes (frontmatter counted), truncated true, both last lines kept [FR-030]" "rc $RC bytes $(w5_bytes "$r5_note") truncated $(w5_field "$r5_note" truncated)" "stderr: ${ERR:0:200}"; fi

w5_claimed
node -e 'for (let i = 1; i <= 10; i += 1) console.log(`S${i} ` + "s".repeat(95))' >"$SB/stdout.txt"
: >"$SB/stderr.txt"
w5_complete 0
if [[ "$RC" -eq 0 && "$(w5_field "$W5_P/intents/$W5_ID.md" truncated)" == "false" && "$(grep -c '^S[0-9]* s' "$W5_P/intents/$W5_ID.md")" == "10" ]]; then
  ok "R5b 1 KB stdout -> truncated false, all 10 lines present [FR-030]"
else bad "R5b 1 KB stdout -> truncated false, all 10 lines present [FR-030]" "rc $RC truncated $(w5_field "$W5_P/intents/$W5_ID.md" truncated)"; fi

w5_claimed
node -e 'process.stdout.write("HEAD-" + "h".repeat(100000) + "-TAIL-END\n")' >"$SB/stdout.txt"
w5_complete 0
if [[ "$RC" -eq 0 && "$(w5_bytes "$W5_P/intents/$W5_ID.md")" -le 16384 ]] && grep -q -- "-TAIL-END" "$W5_P/intents/$W5_ID.md" && ! grep -q "HEAD-" "$W5_P/intents/$W5_ID.md"; then
  ok "R5c one 100 KB line -> cut from its head, the tail is kept, note <= 16384 bytes [FR-030]"
else bad "R5c one 100 KB line -> cut from its head, the tail is kept, note <= 16384 bytes [FR-030]" "rc $RC bytes $(w5_bytes "$W5_P/intents/$W5_ID.md")"; fi

# ---------- R6: each of the 13 patterns alone ----------
# Every line matches only its own pattern (checked against the other 12 when
# the case was written), so removing one pattern turns exactly its line red.
w5_sandbox r6
w5_claimed
cat >"$SB/stdout.txt" <<'OUT'
L01 db postgres://appuser:Xq9pw7Lm@db.internal/app
L02 key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv
L03 key sk-AbCdEfGhIjKlMnOpQrStUvWx12
L04 gh ghp_AbCdEfGhIjKlMnOpQrStUvWx1234
L05 aws AKIAIOSFODNN7EXAMPLE
L06 slack xoxb-1234567890-abcdefghij
L07 figma figd_AbCdEfGhIjKlMnOpQrStUv_12
L08 gemini AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q
L09 -----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAw5sZpemline1
q1w2e3r4t5y6pemline2
-----END RSA PRIVATE KEY-----
L10 SOME_SERVICE_TOKEN=abc123def456
L11 RAILWAY_DEPLOY_KEY: Zx81Qw72Er63
L12 password: hunter2
L13 curl -H "Bearer abcDEF1234567"
OUT
w5_complete 0
r6_note="$W5_P/intents/$W5_ID.md"
r6_check() { # <tag> <line-prefix> <secret> <label>
  local line
  line="$(grep "^$2 " "$r6_note" 2>/dev/null | head -1)"
  if [[ -n "$line" && "$line" == *"[REDACTED]"* ]] && ! grep -qF -- "$3" "$r6_note"; then ok "$1 $4 -> [REDACTED], original absent [FR-031]"
  else bad "$1 $4 -> [REDACTED], original absent [FR-031]" "line: ${line:0:120}" "secret present: $(grep -cF -- "$3" "$r6_note" 2>/dev/null)"; fi
}
r6_check R6a L01 "appuser:Xq9pw7Lm" "URL credentials scheme://user:pass@"
r6_check R6b L02 "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv" "sk-ant- key"
r6_check R6c L03 "sk-AbCdEfGhIjKlMnOpQrStUvWx12" "sk- key"
r6_check R6d L04 "ghp_AbCdEfGhIjKlMnOpQrStUvWx1234" "GitHub gh[pousr]_ token"
r6_check R6e L05 "AKIAIOSFODNN7EXAMPLE" "AWS AKIA id"
r6_check R6f L06 "xoxb-1234567890-abcdefghij" "Slack xox[baprs]- token"
r6_check R6g L07 "figd_AbCdEfGhIjKlMnOpQrStUv_12" "Figma fig[du]_ token"
r6_check R6h L08 "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q" "Gemini AIza key"
if [[ "$(grep -c '^L09 \[REDACTED\]$' "$r6_note")" == "1" ]] && ! grep -qE "pemline|PRIVATE KEY" "$r6_note"; then
  ok "R6i PEM private-key block (4 lines) -> one [REDACTED], no key line left [FR-031]"
else bad "R6i PEM private-key block (4 lines) -> one [REDACTED], no key line left [FR-031]" "$(grep -E '^L09|pemline|PRIVATE' "$r6_note" | head -4)"; fi
if [[ "$(grep '^L10 ' "$r6_note")" == "L10 [REDACTED]" ]]; then ok "R6j generic *_TOKEN= assignment -> [REDACTED] including the variable name [FR-031]"
else bad "R6j generic *_TOKEN= assignment -> [REDACTED] including the variable name [FR-031]" "line: $(grep '^L10 ' "$r6_note")"; fi
r6_check R6k L11 "Zx81Qw72Er63" "Railway-named assignment"
r6_check R6l L12 "hunter2" "password: key/value"
r6_check R6m L13 "abcDEF1234567" "Bearer token"

# ---------- R7: the exported list is the contract ----------
r7_got="$(node -e 'const p = require(process.argv[1] + "/intent.cjs").REDACTION_PATTERNS; console.log(Object.isFrozen(p) + "|" + p.length + "|" + p.map(String).join("\n"))' "$INTENT_LIB" 2>&1)"
# Quoted heredoc read without $( ): the key/value source holds both quote
# characters, which bash 3.2 misparses inside a command substitution.
IFS= read -r -d '' r7_want <<'PATTERNS' || true
true|18|/(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/:@]{1,256}:[^\s/@]{1,256}@/gi
/sk-ant-[A-Za-z0-9_-]{20,}/g
/sk-[A-Za-z0-9]{20,}/g
/gh[pousr]_[A-Za-z0-9]{20,}/g
/AKIA[0-9A-Z]{16}/g
/xox[baprs]-[A-Za-z0-9-]{10,}/g
/fig[du]_[A-Za-z0-9_-]{20,}/g
/AIza[0-9A-Za-z_-]{35}/g
/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?-----END [A-Z ]{0,40}PRIVATE KEY-----/g
/(?<![A-Za-z0-9_])[A-Za-z0-9_]{0,64}_(TOKEN|API_KEY)\s{0,8}=\s{0,8}(?:\\?"[^"\n]{0,256}\\?"|'[^'\n]{0,256}'|(?:[A-Za-z]{1,16}[ \t]{1,8})?\S+)/gi
/railway[A-Za-z0-9_]{0,64}\s{0,8}[:=]\s{0,8}(?:\\?"[^"\n]{0,256}\\?"|'[^'\n]{0,256}'|(?:[A-Za-z]{1,16}[ \t]{1,8})?\S+)/gi
/(?:api[_-]?key|token(?!s)|secret|password|passwd|private[_-]?key|authorization|credential)[A-Za-z0-9_-]{0,64}\\?["']?\s{0,8}[:=]\s{0,8}(?:\\?"[^"\n]{0,256}\\?"|'[^'\n]{0,256}'|(?:[A-Za-z]{1,16}[ \t]{1,8})?\S+)/gi
/Bearer\s+[A-Za-z0-9._-]{10,}/g
/(?<![A-Za-z0-9_-])sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g
/(?<![A-Za-z0-9_])[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g
/(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,}/g
/(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}/g
/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
PATTERNS
r7_want="${r7_want%$'\n'}"
if [[ "$r7_got" == "$r7_want" ]]; then ok "R7 REDACTION_PATTERNS is exported frozen from intent.cjs: 18 patterns (13 spec + 5 from the security review), order, sources and flags equal the fixture's own list [FR-031]"
else bad "R7 REDACTION_PATTERNS is exported frozen from intent.cjs: 18 patterns (13 spec + 5 from the security review), order, sources and flags equal the fixture's own list [FR-031]" "got: ${r7_got:0:600}"; fi

# ---------- R8: UUID and git sha survive; the spec's AC list ----------
w5_sandbox r8
w5_claimed
cat >"$SB/stdout.txt" <<'OUT'
intent 3f2b9c1e-4d5a-4b6c-8d7e-0f1a2b3c4d5e done at 9fceb02d0ae598e95dc970b74767f19372d61af8
AC postgres://user:pw@host/db sk-ant-AAAAAAAAAAAAAAAAAAAAAAAA sk-BBBBBBBBBBBBBBBBBBBBBBBB ghp_CCCCCCCCCCCCCCCCCCCCCCCC
AC AKIADDDDDDDDDDDDDDDD xoxb-EEEEEEEEEEEE figd_FFFFFFFFFFFFFFFFFFFFFFFF AIzaGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG
-----BEGIN PRIVATE KEY-----
HHHHHHHHHHHHHHHH
-----END PRIVATE KEY-----
SOME_SERVICE_TOKEN=abcIIIIIIII
RAILWAY_API_TOKEN: abcJJJJJJJJ
password: hunter2
Bearer abcKKKKKKKKKK
OUT
w5_complete 0
r8_note="$W5_P/intents/$W5_ID.md"
if grep -qF "3f2b9c1e-4d5a-4b6c-8d7e-0f1a2b3c4d5e" "$r8_note" && grep -qF "9fceb02d0ae598e95dc970b74767f19372d61af8" "$r8_note"; then
  ok "R8a an intent UUID and a git sha in stdout stay unredacted [FR-031]"
else bad "R8a an intent UUID and a git sha in stdout stay unredacted [FR-031]" "$(grep -E '^intent' "$r8_note")"; fi
r8_left=""
for s in user:pw AAAAAAAA BBBBBBBB CCCCCCCC DDDDDDDD EEEEEEEE FFFFFFFF GGGGGGGG HHHHHHHH IIIIIIII JJJJJJJJ hunter2 KKKKKKKK; do
  grep -qF "$s" "$r8_note" && r8_left="$r8_left $s"
done
if [[ "$RC" -eq 0 && -z "$r8_left" && "$(grep -o '\[REDACTED\]' "$r8_note" | wc -l | tr -d ' ')" -ge 13 ]]; then
  ok "R8b the spec's 13-secret acceptance output: none of the originals left, >= 13 [REDACTED] [FR-031]"
else bad "R8b the spec's 13-secret acceptance output: none of the originals left, >= 13 [REDACTED] [FR-031]" "rc $RC left:$r8_left"; fi

# R8c: header and JSON forms. With the spec's source of the key/value rule
# the token after "Bearer"/"Basic" and the JSON-quoted value survived
# (measured in Wave 5); the rule takes both forms now.
w5_claimed
cat >"$SB/stdout.txt" <<'OUT'
H1 Authorization: Bearer hdrTOKENaaaa1111
H2 Authorization: Basic dXNlcjpwYXNzd29yZA==
H3 {"password": "jsonSECRETbbbb"}
H4 {\"api_key\": \"escSECRETcccc\"}
OUT
w5_complete 0
r8c_left=""
for s in hdrTOKENaaaa1111 dXNlcjpwYXNzd29yZA== jsonSECRETbbbb escSECRETcccc; do grep -qF -- "$s" "$W5_P/intents/$W5_ID.md" && r8c_left="$r8c_left $s"; done
if [[ "$RC" -eq 0 && -z "$r8c_left" && "$(grep -c '^H[1-4] .*\[REDACTED\]' "$W5_P/intents/$W5_ID.md")" == "4" ]]; then
  ok "R8c Authorization: Bearer/Basic and JSON-quoted keys -> the value is redacted, not only the scheme word [FR-031]"
else bad "R8c Authorization: Bearer/Basic and JSON-quoted keys -> the value is redacted, not only the scheme word [FR-031]" "rc $RC left:$r8c_left" "$(grep '^H[1-4]' "$W5_P/intents/$W5_ID.md")"; fi

# ---------- R9: redact before truncating ----------
w5_sandbox r9
w5_claimed
{
  printf 'pre 1\npre 2\n-----BEGIN EC PRIVATE KEY-----\n'
  for i in $(seq 1 40); do printf 'MIIkeybody%02d\n' "$i"; done
  printf -- '-----END EC PRIVATE KEY-----\npost 1\npost 2\npost 3\n'
} >"$SB/stdout.txt"
w5_complete 0
if [[ "$RC" -eq 0 ]] && ! grep -q "MIIkeybody" "$W5_P/intents/$W5_ID.md" && grep -q "^\[REDACTED\]$" "$W5_P/intents/$W5_ID.md"; then
  ok "R9a a PEM block whose BEGIN lies before the 40-line tail cut is redacted whole (filter runs before the cut) [FR-031]"
else bad "R9a a PEM block whose BEGIN lies before the 40-line tail cut is redacted whole (filter runs before the cut) [FR-031]" "rc $RC, key lines: $(grep -c MIIkeybody "$W5_P/intents/$W5_ID.md" 2>/dev/null)"; fi

{
  printf 'head sk-ant-api03-SPLITSECRETSPLITSECRET\n-----BEGIN RSA PRIVATE KEY-----\n'
  for i in $(seq 1 20); do printf 'CUTkeybody%02d\n' "$i"; done
  printf -- '-----END RSA PRIVATE KEY-----\nafter\n'
} >"$SB/cut.txt"
r9b="$(w5_lib 'const size = fs.statSync(argv[0]).size; const t = R.readOutput(argv[0], size - 120); const f = R.filterOutput(t);
  console.log([t.cut, /CUTkeybody|SPLITSECRET|PRIVATE KEY/.test(f), f.split("\n")[0], f.includes("after")].join("|"))' "$SB/cut.txt")"
if [[ "$r9b" == "true|false|[REDACTED]|true" ]]; then
  ok "R9b a read cut inside a PEM block: the partial first line is dropped and the orphan key tail up to END is redacted [FR-031]"
else bad "R9b a read cut inside a PEM block: the partial first line is dropped and the orphan key tail up to END is redacted [FR-031]" "got: $r9b"; fi

# R9c: a read cut inside a token on the first line: the partial line goes,
# because the token's prefix (sk-ant-) was cut off and no pattern sees it.
node -e 'process.stdout.write("sk-ant-api03-CUTTOKEN" + "Q".repeat(40) + "\nsafe tail\n")' >"$SB/cut2.txt"
r9c="$(w5_lib 'const size = fs.statSync(argv[0]).size; const t = R.readOutput(argv[0], size - 12); const f = R.filterOutput(t);
  console.log([t.cut, /QQQQQ|CUTTOKEN/.test(f), f.trim()].join("|"))' "$SB/cut2.txt")"
if [[ "$r9c" == "true|false|safe tail" ]]; then
  ok "R9c a read cut inside a token: the partial first line is dropped, no token fragment survives [FR-031]"
else bad "R9c a read cut inside a token: the partial first line is dropped, no token fragment survives [FR-031]" "got: $r9c"; fi

# ---------- R10: refusals (no row, tampered, closed row, host) ----------
w5_sandbox r10
w5_claimed
rm -f "$W5_LEDGER"
w5_complete 0
if [[ "$RC" -eq 1 && "$(node -e 'console.log(JSON.parse(process.argv[1]).reasons.join(","))' "$OUT" 2>&1)" == "tampered" && -f "$W5_F" && ! -e "$W5_P/intents" ]]; then
  ok "R10a a claimed/ file without a ledger row -> exit 1 tampered, nothing moved, no note [FR-029]"
else bad "R10a a claimed/ file without a ledger row -> exit 1 tampered, nothing moved, no note [FR-029]" "rc $RC out: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi

w5_sandbox r10b
w5_claimed
printf '\n' >>"$W5_F"
w5_complete 0
if [[ "$RC" -eq 1 && "$(node -e 'console.log(JSON.parse(process.argv[1]).reasons.join(","))' "$OUT" 2>&1)" == "tampered" && -f "$W5_F" \
  && ! -e "$W5_P/intents" && "$(w5_row 'r.outcome')" == "claimed" ]]; then
  ok "R10b a claimed/ file whose sha256 differs from the claim-time value -> exit 1 tampered, nothing moved, row open [FR-029]"
else bad "R10b a claimed/ file whose sha256 differs from the claim-time value -> exit 1 tampered, nothing moved, row open [FR-029]" "rc $RC out: ${OUT:0:200}"; fi

w5_sandbox r10c
w5_claimed
node -e 'const fs = require("fs"); const f = process.argv[1]; const d = JSON.parse(fs.readFileSync(f, "utf8"));
  d.rows = d.rows.map((r) => ({ ...r, finished_at: "2026-09-27T10:00:00.000Z", outcome: "done" })); fs.writeFileSync(f, JSON.stringify(d));' "$W5_LEDGER"
w5_complete 0
if [[ "$RC" -eq 1 && "$(node -e 'console.log(JSON.parse(process.argv[1]).reasons.join(","))' "$OUT" 2>&1)" == "tampered" && -f "$W5_F" ]]; then
  ok "R10c a claimed/ file whose ledger row is already closed -> exit 1 tampered, nothing moved [FR-029]"
else bad "R10c a claimed/ file whose ledger row is already closed -> exit 1 tampered, nothing moved [FR-029]" "rc $RC out: ${OUT:0:200}"; fi

w5_sandbox r10d
w5_claimed
set_executor some-other-mac
: >"$TRACE"
w5_complete 0
if [[ "$RC" -eq 1 && "$(node -e 'console.log(JSON.parse(process.argv[1]).reasons.join(","))' "$OUT" 2>&1)" == "not_executor_host" && -f "$W5_F" ]] \
  && ! grep -qE "^(read|open) .*$W5_ID" "$TRACE" && ! grep -q "stdout.txt" "$TRACE"; then
  ok "R10d not the executor host -> exit 1 not_executor_host before the intent or the output files are read [FR-029]"
else bad "R10d not the executor host -> exit 1 not_executor_host before the intent or the output files are read [FR-029]" "rc $RC out: ${OUT:0:200}" "$(grep -E "$W5_ID|stdout.txt" "$TRACE" | head -3)"; fi

w5_sandbox r10e
r10e_q="$(mk_intent)"
run_outputs "$(basename "$r10e_q" .md)"
run_intent complete "$r10e_q" --exit-code 0 --stdout "$RUN_OUT" --stderr "$RUN_ERR"
r10e_rc="$RC"
w5_claimed
run_outputs "$W5_ID"
run_intent complete "$W5_F" --exit-code 0 --stdout "$FHOME/.a1-intents/runs/$W5_ID/missing.txt" --stderr "$RUN_ERR"
if [[ "$r10e_rc" -eq 2 && "$RC" -eq 2 && -f "$r10e_q" && -f "$W5_F" ]]; then
  ok "R10e a queued/ path, or a missing --stdout file, is a usage error; nothing moved [FR-029]"
else bad "R10e a queued/ path, or a missing --stdout file, is a usage error; nothing moved [FR-029]" "rc $r10e_rc / $RC"; fi

# ---------- R11: one log line per decision, no payload / secret / stdout ----------
w5_sandbox r11
w5_claimed
printf 'W5-STDOUT-MARKER ghp_AbCdEfGhIjKlMnOpQrStUvWx1234\n' >"$SB/stdout.txt"
r11_id="$W5_ID"
r11_before="$(w5_lines "$W5_LOG")"
w5_complete 0
r11_after="$(w5_lines "$W5_LOG")"
r11_last="$(tail -1 "$W5_LOG" | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log([o.command, o.intent_id, o.outcome, o.reason].map(String).join("|"))' 2>&1)"
w5_claimed
printf '\n' >>"$W5_F"
r11_b2="$(w5_lines "$W5_LOG")"
w5_complete 0
r11_a2="$(w5_lines "$W5_LOG")"
if [[ $((r11_after - r11_before)) -eq 1 && "$r11_last" == "complete|$r11_id|done|null" && $((r11_a2 - r11_b2)) -eq 1 ]]; then
  ok "R11a complete writes exactly one log line per decision (done and refused) [FR-029]"
else bad "R11a complete writes exactly one log line per decision (done and refused) [FR-029]" "lines +$((r11_after - r11_before)) / +$((r11_a2 - r11_b2)), last: $r11_last"; fi
if ! grep -qE "W5-STDOUT-MARKER|ghp_|$W5_PAYLOAD_TEXT" "$W5_LOG"; then ok "R11b the log holds no stdout text, secret or payload [FR-029]"
else bad "R11b the log holds no stdout text, secret or payload [FR-029]" "$(grep -E 'W5-STDOUT|ghp_|Push' "$W5_LOG" | head -2)"; fi

# ---------- R12: registered in the router ----------
w5_sandbox r12
run_intent complete
if [[ "$RC" -eq 2 && "$ERR" == "usage error: "* && "$ERR" != *"not implemented"* ]]; then ok "R12 intent complete is routed (usage error without arguments, not 'not implemented') [FR-029]"
else bad "R12 intent complete is routed (usage error without arguments, not 'not implemented') [FR-029]" "rc $RC stderr: ${ERR:0:200}"; fi

# ---------- R13: every case above reported ----------
w5_ran=$((pass + fail - W5_RAN_BEFORE))
if [[ "$w5_ran" -eq 45 ]]; then ok "R13 cases/05-complete.sh reported all 45 cases (none swallowed by quoting) [FR-029]"
else bad "R13 cases/05-complete.sh reported all 45 cases (none swallowed by quoting) [FR-029]" "reported $w5_ran"; fi
