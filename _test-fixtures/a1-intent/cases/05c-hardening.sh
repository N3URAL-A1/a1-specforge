#!/usr/bin/env bash
# cases/05c-hardening.sh — spec 011, security review of waves 4–5 (samuel,
# FAIL: 4 MAJOR, 6 MINOR): the fixes to the decision log, the ledger lock,
# ledger/executor.json modes, the result-note filter and fences, a planted
# done/ file and the snapshot input. Sourced by run-tests.sh.
#
# RED proof (CONVENTIONS.md): the single production change that turns each
# case red, each measured on a `git archive HEAD` copy before commit.
#   Z1  (MAJOR-D) logDecision back to appendFileSync (Z1a: the link target
#       gets a line); assertLogSafe dropped from executorConfig (Z1b: claim
#       moves the intent, then fails to log); the directory mode check of
#       privateProblem dropped (Z1c/Z1d: reject/complete run in a 0755 / 0777
#       dir); openLog without the mode check (Z1e: a 0644 log accepted);
#       idFields logging any string as intent_id (Z1f).
#   Z2  (MINOR-A) the reclaim back to check-then-rm by path (Z2a: two holders
#       at once); release removing the lock without the token check (Z2b).
#   Z3  (MINOR-B) loadLedger / executorConfig back to lstat + read by path
#       without the mode check (Z3a/Z3b); writeLedger without the O_EXCL 0600
#       tmp (Z3c: the tmp is 0644 at rename time).
#   Z4  (MAJOR-B) prepareOutput without capBackticks (Z4a/Z4b: the note
#       exceeds 16384 bytes and complete fails); the "both sections empty"
#       stop removed from fitSections (Z4c: the call never returns).
#   Z5  (MAJOR-C, item 1) replaceExact dropped from redact (Z5a: the device
#       secrets reach the note); loadDevices not called by complete (Z5b: a
#       0644 devices.json does not stop it).
#   Z6  (MINOR-C) redactOpenPem dropped (Z6a); redactOrphanPemEnd dropped or
#       only on cut reads (Z6b); either rule widened to every marker (Z6c:
#       the text after a complete block is lost).
#   Z7  (MINOR-E) clearDoneSlot dropped (Z7a: tampered on every retry); the
#       containment pre-check dropped (Z7b: internal error, no log line).
#   Z8  (MINOR-F) the private-dir check of --snapshot dropped (Z8a/Z8b);
#       fileEntry back to readFileSync by path (Z8c: no fd open in the trace).
#   Z9  (MAJOR-A) the old source of pattern 1 / 10 / 11 restored (Z9a / Z9j
#       / Z9k: > 2 s or killed). The other Z9 lines guard the rest of the
#       list against a future quadratic source.
#   Z10 (MAJOR-A) the old pattern 1 restored (complete on 4 MiB > 5 s).
#   Z11 (MINOR-D) each new alternative or pattern removed alone: the scheme
#       word slot (Z11a), the quoted value (Z11b), patterns 14–18 (Z11c–g);
#       `token(?!s)` back to `token` with the suffix (Z11h).
#   Z12 (MAJOR-C item 2) the key-name suffix of pattern 12 dropped (the
#       secret_hex / aws_secret_access_key / SECRET_KEY values survive).
#   Z13 a case that vanishes without a PASS or FAIL line: this file must
#       report exactly the count written in Z13.

ZB_RAN_BEFORE=$((pass + fail))
ZB_HOST="$(node -e 'process.stdout.write(require("os").hostname())')"

zb_sandbox() {
  new_sandbox "$1"
  mk_project real-proj
  set_executor "$ZB_HOST"
  ZB_DIR="$FHOME/.a1-intents"
  ZB_LOG="$ZB_DIR/log.jsonl"
  ZB_LEDGER="$FHOME/.a1-intents-ledger.json"
  ZB_C="$VAULT/inbox/intents/claimed"
  ZB_D="$VAULT/inbox/intents/done"
  ZB_R="$VAULT/inbox/intents/rejected"
  ZB_P="$VAULT/project/real-proj"
  mkdir -p "$ZB_P"
  printf 'plain line\n' >"$SB/stdout.txt"
  : >"$SB/stderr.txt"
}

zb_check() { # <name> <want> <got>
  if [[ "$3" == "$2" ]]; then ok "$1"; else bad "$1" "want: $2" "got:  ${3:0:600}"; fi
}

# zb_claimed [mk_intent args...] — a claimed intent through the real claim.
zb_claimed() {
  local q
  q="$(mk_intent "$@")"
  ZB_ID="$(basename "$q" .md)"
  run_intent claim "$q"
  ZB_F="$ZB_C/$ZB_ID.md"
}

# zb_run_timed <ms> <intent args...> — run_intent with a hard timeout: a hung
# CLI is killed and reported as RC 124 instead of stopping the suite.
zb_run_timed() {
  local ms="$1"
  shift
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" \
    NODE_OPTIONS="--require $TRACE_SHIM" A1_INTENT_FIXTURE_TRACE="$TRACE" \
    node -e '
      const cp = require("child_process"); const fs = require("fs");
      const [ms, out, err, ...args] = process.argv.slice(1);
      const r = cp.spawnSync(process.execPath, args, { timeout: Number(ms), killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 });
      fs.writeFileSync(out, r.stdout || ""); fs.writeFileSync(err, r.stderr || "");
      process.exitCode = r.error && r.error.code === "ETIMEDOUT" ? 124 : r.status;' \
    "$ms" "$SB/.out" "$SB/.err" "$A1_AS" "$FHOME" - "$A1_TOOLS" intent "$@"
  RC=$?
  OUT="$(cat "$SB/.out")"
  ERR="$(cat "$SB/.err")"
}

zb_complete() { run_outputs "$ZB_ID"; run_intent complete "$ZB_F" --exit-code "$1" --stdout "$RUN_OUT" --stderr "$RUN_ERR" "${@:2}"; }
zb_field() { node -e 'let t = ""; try { t = require("fs").readFileSync(process.argv[1], "utf8"); } catch (e) {} const m = t.match(new RegExp("^" + process.argv[2] + ": (.*)$", "m")); process.stdout.write(m ? m[1] : "<none>")' "$1" "$2"; }
zb_bytes() { if [[ -f "$1" ]]; then wc -c <"$1" | tr -d ' '; else echo 0; fi; }
zb_reasons() { node -e 'try { console.log(JSON.parse(process.argv[1]).reasons.join(",")); } catch (e) { console.log("<no json>"); }' "$OUT"; }

# zb_lib <timeout-ms> <js> [args...] — JS in a child with a timeout, fs and
# the intent lib path `lib` loaded, inside the sandbox HOME and vault.
# Prints HUNG when the child does not return in time.
zb_lib() {
  local ms="$1" js="$2"
  shift 2
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e '
    const cp = require("child_process");
    const [ms, js, lib, ...rest] = process.argv.slice(1);
    const pre = "const fs = require(\"fs\"); const lib = process.argv[1]; const argv = process.argv.slice(2);";
    const r = cp.spawnSync(process.execPath, ["-e", pre + js, lib, ...rest], { encoding: "utf8", timeout: Number(ms), env: process.env });
    if (r.error && r.error.code === "ETIMEDOUT") console.log("HUNG");
    else process.stdout.write((r.stdout || "") + (r.status === 0 ? "" : `EXIT ${r.status} ${(r.stderr || "").split("\n").find((l) => /Error/.test(l)) || ""}`));' \
    "$ms" "$js" "$INTENT_LIB" "$@" 2>&1
}

# ---------- Z1: the decision log (MAJOR-D) ----------
zb_sandbox z1
z1_target="$SB/shell-rc"
: >"$z1_target"
ln -s "$z1_target" "$ZB_LOG"
z1_f="$(mk_intent)"
z1a="$(zb_lib 5000 '
  const L = require(lib + "/intent-log.cjs");
  try { L.logDecision({ command: "validate", intentId: "x", outcome: "valid", reason: null, hostname: "h" }); console.log("appended"); }
  catch (e) { console.log(e.code); }')"
zb_check "Z1a logDecision on a symlinked log.jsonl -> A1_INTENTS_DIR_UNSAFE, nothing appended through the link [FR-033]" \
  "A1_INTENTS_DIR_UNSAFE 0" "$z1a $(zb_bytes "$z1_target")"
z1_before="$(tree_listing "$VAULT")"
run_intent claim "$z1_f"
zb_check "Z1b log.jsonl a symlink -> claim exit 2 before anything moves, nothing appended through the link [FR-033]" \
  "2 0 same" "$RC $(zb_bytes "$z1_target") $([[ "$(tree_listing "$VAULT")" == "$z1_before" ]] && echo same || echo changed)"
rm -f "$ZB_LOG"

zb_claimed
z1_before="$(tree_listing "$VAULT")"
z1_lines="$(wc -l <"$ZB_LOG" | tr -d ' ')"
chmod 755 "$ZB_DIR"
run_intent reject "$ZB_F" --reason schema_invalid
z1c="$RC $([[ "$(tree_listing "$VAULT")" == "$z1_before" ]] && echo same || echo changed) $(wc -l <"$ZB_LOG" | tr -d ' ')"
zb_check "Z1c ~/.a1-intents at 0755 -> reject exit 2, nothing moved, no log line [FR-033]" "2 same $z1_lines" "$z1c"
chmod 777 "$ZB_DIR"
zb_complete 0
z1d="$RC $([[ "$(tree_listing "$VAULT")" == "$z1_before" ]] && echo same || echo changed) $(wc -l <"$ZB_LOG" | tr -d ' ')"
zb_check "Z1d ~/.a1-intents at 0777 -> complete exit 2, nothing moved, no log line [FR-033]" "2 same $z1_lines" "$z1d"
chmod 700 "$ZB_DIR"
chmod 644 "$ZB_LOG"
zb_complete 0
zb_check "Z1e log.jsonl at 0644 -> complete exit 2, nothing moved [FR-033]" \
  "2 same" "$RC $([[ "$(tree_listing "$VAULT")" == "$z1_before" ]] && echo same || echo changed)"
chmod 600 "$ZB_LOG"

z1_name='x$(touch${IFS}pwned).md'
z1_evil="$(mk_intent 'id="$(touch pwned)"' "@name=$z1_name")"
run_intent validate "$z1_evil"
z1f="$(tail -n 1 "$ZB_LOG" | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(`${o.intent_id} ${/^[0-9a-f]{64}$/.test(o.name_sha256)}`)' 2>&1)"
zb_check "Z1f an id or file name that is not a UUID is logged as intent_id null + name_sha256, never raw [FR-033]" \
  "null true 0" "$z1f $(grep -c 'pwned' "$ZB_LOG")"

# ---------- Z2: the ledger lock under concurrency (MINOR-A) ----------
zb_sandbox z2
z2="$(node - "$INTENT_LIB" "$FHOME" <<'JS'
// 8 rounds x 8 processes race for a stale lock (dead pid on this host); each
// holder marks the critical section with an O_EXCL file. A second holder
// finds the marker and reports VIOLATION.
const fs = require('fs'); const path = require('path'); const cp = require('child_process'); const os = require('os');
const [lib, home] = process.argv.slice(2);
const dir = path.join(home, '.a1-intents');
const child = `
const fs = require('fs'); const G = require(process.argv[1] + '/intent-ledger.cjs');
const [home, marker, t0] = process.argv.slice(2);
while (Date.now() < Number(t0)) {}
try {
  G.withLedgerLock(() => {
    try { fs.writeFileSync(marker, String(process.pid), { flag: 'wx' }); } catch (e) { process.stdout.write('VIOLATION'); return; }
    const until = Date.now() + 15; while (Date.now() < until) {}
    fs.unlinkSync(marker);
    process.stdout.write('held');
  }, { homedir: () => home });
} catch (e) { process.stdout.write(e.code || e.message); }`;
const dead = Number(cp.spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString());
const round = (r) => new Promise((resolve) => {
  fs.writeFileSync(path.join(dir, 'ledger.lock'), JSON.stringify({ pid: dead, hostname: os.hostname(), acquired_at: '2026-09-27T00:00:00.000Z' }), { mode: 0o600 });
  const marker = path.join(home, `in-section-${r}`);
  const t0 = Date.now() + 500;
  let left = 8; const outs = [];
  for (let i = 0; i < 8; i += 1) {
    const k = cp.spawn(process.execPath, ['-e', child, lib, home, marker, String(t0)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = ''; k.stdout.on('data', (d) => { o += d; }); k.stderr.on('data', (d) => { o += d; });
    k.on('close', () => { outs.push(o); left -= 1; if (left === 0) resolve(outs); });
  }
});
(async () => {
  const tally = {};
  for (let r = 0; r < 8; r += 1) for (const o of await round(r)) tally[o] = (tally[o] || 0) + 1;
  const leftovers = fs.readdirSync(dir).filter((f) => f.startsWith('ledger.lock')).length;
  console.log(`${JSON.stringify(tally)} leftovers=${leftovers}`);
})();
JS
)"
zb_check "Z2a 8 rounds x 8 processes reclaim a dead holder's lock: every one holds it, never two at once, no lock file left [FR-014]" \
  '{"held":64} leftovers=0' "$z2"
z2b="$(zb_lib 10000 '
  const G = require(lib + "/intent-ledger.cjs"); const path = require("path");
  const lock = path.join(process.env.HOME, ".a1-intents", "ledger.lock");
  G.withLedgerLock(() => { fs.unlinkSync(lock); fs.writeFileSync(lock, "{\"pid\":1,\"hostname\":\"other\"}", { mode: 0o600 }); });
  console.log(fs.readFileSync(lock, "utf8"));')"
zb_check "Z2b release removes the lock only while it still holds the token this process wrote [FR-014]" '{"pid":1,"hostname":"other"}' "$z2b"

# ---------- Z3: ledger and executor.json mode (MINOR-B) ----------
zb_sandbox z3
zb_claimed
z3_q="$(mk_intent)"
chmod 644 "$ZB_LEDGER"
run_intent claim "$z3_q"
zb_check "Z3a ledger at 0644 -> claim exit 1 ledger_unreadable, queued/ unchanged [FR-014]" "1 ledger_unreadable 1" "$RC $(zb_reasons) $(find "$Q" -type f | wc -l | tr -d ' ')"
chmod 600 "$ZB_LEDGER"
chmod 644 "$ZB_DIR/executor.json"
run_intent claim "$z3_q"
zb_check "Z3b executor.json at 0644 -> claim exit 2, names executor.json, queued/ unchanged [FR-017]" \
  "2 yes 1" "$RC $([[ "$ERR" == *"executor.json"* ]] && echo yes || echo no) $(find "$Q" -type f | wc -l | tr -d ' ')"
chmod 600 "$ZB_DIR/executor.json"
z3c="$(zb_lib 10000 '
  const G = require(lib + "/intent-ledger.cjs");
  const orig = fs.renameSync; const seen = [];
  fs.renameSync = (a, b) => { seen.push((fs.statSync(a).mode & 0o777).toString(8)); return orig(a, b); };
  process.umask(0o022);
  G.writeLedger([{ id: "x" }], { homedir: () => process.env.HOME });
  fs.renameSync = orig;
  console.log(`${seen.join(",")} ${(fs.statSync(G.ledgerPath(() => process.env.HOME)).mode & 0o777).toString(8)}`);')"
zb_check "Z3c writeLedger: the tmp is already 0600 when it is renamed into place, the ledger is 0600 [FR-014]" "600 600" "$z3c"

# ---------- Z4: fences never push the note over its budget (MAJOR-B) ----------
zb_sandbox z4
for z4_n in 9000 20000; do
  zb_claimed
  node -e 'console.log("before"); console.log("`".repeat(Number(process.argv[1]))); console.log("after")' "$z4_n" >"$SB/stderr.txt"
  cp "$SB/stderr.txt" "$SB/stdout.txt"
  z4_t0="$(node -e 'process.stdout.write(String(Date.now()))')"
  run_outputs "$ZB_ID"
  zb_run_timed 20000 complete "$ZB_F" --exit-code 0 --stdout "$RUN_OUT" --stderr "$RUN_ERR"
  z4_ms="$(( $(node -e 'process.stdout.write(String(Date.now()))') - z4_t0 ))"
  z4_note="$ZB_P/intents/$ZB_ID.md"
  z4_fence="$(node -e '
    const t = require("fs").readFileSync(process.argv[1], "utf8");
    const body = t.split("## Stderr\n\n")[1] || "";
    const fence = body.split("\n")[0];
    const inner = body.split("\n").slice(1, -2).join("\n");
    const runs = inner.match(/`+/g) || [];
    console.log(/^`{3,}$/.test(fence) && runs.every((r) => r.length < fence.length) && inner.includes("before") && inner.includes("after") ? "fenced" : "broken");' "$z4_note" 2>&1)"
  zb_check "Z4$([[ $z4_n == 9000 ]] && echo a || echo b) a ${z4_n}-backtick line: complete exits 0 in < 10 s, note <= 16384 bytes, truncated, no run reaches the fence [FR-030]" \
    "0 fast yes true fenced" "$RC $([[ $z4_ms -lt 10000 ]] && echo fast || echo "slow:$z4_ms") $([[ $(zb_bytes "$z4_note") -le 16384 ]] && echo yes || echo "no:$(zb_bytes "$z4_note")") $(zb_field "$z4_note" truncated) $z4_fence"
done
z4c="$(zb_lib 5000 '
  const X = require(lib + "/intent-redact.cjs");
  const r = X.fitSections([["aaaa"], ["bbbb"]], -100);
  console.log(`${r.summary.length} ${r.stderr.length} ${r.cut}`);')"
zb_check "Z4c fitSections with a negative budget ends with both sections empty (never loops) [FR-030]" "0 0 true" "$z4c"

# ---------- Z5: device secrets by exact value (MAJOR-C, item 1) ----------
zb_sandbox z5
# A revoked device too: its secret must never surface either.
z5_revoked="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
node -e '
  const fs = require("fs"); const f = process.argv[1];
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  d.devices["old-phone"] = { secret_hex: process.argv[2], created_at: "2026-09-01T00:00:00.000Z", revoked_at: "2026-09-02T00:00:00.000Z" };
  fs.writeFileSync(f, JSON.stringify(d, null, 2));' "$ZB_DIR/devices.json" "$z5_revoked"
zb_claimed
{
  cat "$ZB_DIR/devices.json"
  echo "upper $(printf '%s' "$FIXTURE_SECRET" | tr 'a-f' 'A-F')"
  echo "b64 $(node -e 'process.stdout.write(Buffer.from(process.argv[1], "hex").toString("base64"))' "$FIXTURE_EXECUTOR_SECRET")"
  echo "b64url $(node -e 'process.stdout.write(Buffer.from(process.argv[1], "hex").toString("base64url"))' "$z5_revoked")"
  echo "a1-intent://provision?device=pixel-robert&secret=$FIXTURE_SECRET"
  echo "bare $FIXTURE_EXECUTOR_SECRET done"
} >"$SB/stdout.txt"
zb_complete 0
z5_note="$ZB_P/intents/$ZB_ID.md"
z5_leaks="$(node -e '
  const t = require("fs").readFileSync(process.argv[1], "utf8").toLowerCase();
  const hex = process.argv.slice(2);
  const forms = hex.flatMap((h) => { const b = Buffer.from(h, "hex"); return [h, b.toString("base64").toLowerCase(), b.toString("base64url").toLowerCase()]; });
  console.log(forms.filter((f) => t.includes(f)).length);' "$z5_note" "$FIXTURE_SECRET" "$FIXTURE_EXECUTOR_SECRET" "$z5_revoked" 2>&1)"
zb_check "Z5a devices.json printed by the child: no device secret (active or revoked; hex, HEX, base64, base64url, provisioning URL) reaches the note [FR-031]" \
  "0 0" "$RC $z5_leaks"
zb_claimed
z5_before="$(tree_listing "$VAULT")"
chmod 644 "$ZB_DIR/devices.json"
zb_complete 0
zb_check "Z5b devices.json at 0644 -> complete exit 2 (fail closed), nothing moved, no note [FR-031]" \
  "2 same" "$RC $([[ "$(tree_listing "$VAULT")" == "$z5_before" ]] && echo same || echo changed)"
chmod 600 "$ZB_DIR/devices.json"

# ---------- Z6: PEM without END or without BEGIN (MINOR-C) ----------
zb_sandbox z6
z6_js='const X = require(lib + "/intent-redact.cjs"); const t = fs.readFileSync(argv[0], "utf8");
  const f = X.filterOutput({ text: t, cut: false });
  console.log(`${/MIIkey/.test(f)} ${/-----(BEGIN|END)/.test(f)} ${f.includes("keep-before")} ${f.includes("keep-after")}`);'
printf 'keep-before\n-----BEGIN RSA PRIVATE KEY-----\nMIIkeyAAAA\nMIIkeyBBBB\n' >"$SB/head.pem"
zb_check "Z6a BEGIN without END in an uncut read: from BEGIN to the end is redacted, the text before stays [FR-031]" \
  "false false true false" "$(zb_lib 5000 "$z6_js" "$SB/head.pem")"
printf 'MIIkeyCCCC\nMIIkeyDDDD\n-----END RSA PRIVATE KEY-----\nkeep-after\n' >"$SB/tail.pem"
zb_check "Z6b END without BEGIN in an uncut read (tail -n of a key file): from the start to END is redacted, the text after stays [FR-031]" \
  "false false false true" "$(zb_lib 5000 "$z6_js" "$SB/tail.pem")"
printf 'keep-before\n-----BEGIN EC PRIVATE KEY-----\nMIIkeyEEEE\n-----END EC PRIVATE KEY-----\nkeep-after\n' >"$SB/full.pem"
zb_check "Z6c a complete block: only the block goes, the text before and after stays [FR-031]" \
  "false false true true" "$(zb_lib 5000 "$z6_js" "$SB/full.pem")"

# ---------- Z7: a planted done/<id>.md, an unsafe result path (MINOR-E) ----------
zb_sandbox z7
zb_claimed
printf 'planted by a vault writer\n' >"$ZB_D/$ZB_ID.md"
zb_complete 0
z7a_planted="$(cat "$ZB_R/$ZB_ID.done-conflict.md" 2>/dev/null)"
z7a_detail="$(tail -n 1 "$ZB_LOG" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).detail)' 2>&1)"
zb_check "Z7a a planted done/<id>.md: complete exits 0, done/ holds the intent, the planted bytes move to rejected/<id>.done-conflict.md, logged [FR-029]" \
  "0 done planted by a vault writer done_conflict_moved" "$RC $(zb_field "$ZB_D/$ZB_ID.md" status) $z7a_planted $z7a_detail"
zb_claimed
mkdir -p "$SB/outside"
rm -rf "$ZB_P/intents"
ln -s "$SB/outside" "$ZB_P/intents"
z7_lines="$(wc -l <"$ZB_LOG" | tr -d ' ')"
zb_complete 0
z7b_last="$(tail -n 1 "$ZB_LOG" | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(o.reason)' 2>&1)"
zb_check "Z7b project/<slug>/intents a link out of the vault -> exit 1 result_path_unsafe, one log line, nothing outside, intent stays claimed [FR-029]" \
  "1 result_path_unsafe $((z7_lines + 1)) result_path_unsafe 0 yes" \
  "$RC $(zb_reasons) $(wc -l <"$ZB_LOG" | tr -d ' ') $z7b_last $(find "$SB/outside" -type f | wc -l | tr -d ' ') $([[ -f "$ZB_F" ]] && echo yes || echo no)"
rm "$ZB_P/intents"

# ---------- Z8: the snapshot input (MINOR-F) ----------
zb_sandbox z8
printf 'a\n' >"$ZB_P/a.md"
zb_claimed
z8_js='const R = require(lib + "/intent-result.cjs"); fs.writeFileSync(argv[0], JSON.stringify(R.snapshotProject("real-proj")), { mode: Number(argv[1]) });'
zb_lib 10000 "$z8_js" "$SB/snap.json" 384 >/dev/null
zb_complete 0 --snapshot "$SB/snap.json"
zb_check "Z8a --snapshot outside ~/.a1-intents -> usage error, nothing moved [FR-030]" "2 yes" "$RC $([[ -f "$ZB_F" ]] && echo yes || echo no)"
mkdir -p "$ZB_DIR/runs" && chmod 700 "$ZB_DIR/runs"
zb_lib 10000 "$z8_js" "$ZB_DIR/runs/snap.json" 420 >/dev/null
chmod 644 "$ZB_DIR/runs/snap.json"
zb_complete 0 --snapshot "$ZB_DIR/runs/snap.json"
zb_check "Z8b --snapshot at 0644 under ~/.a1-intents -> usage error, nothing moved [FR-030]" "2 yes" "$RC $([[ -f "$ZB_F" ]] && echo yes || echo no)"
chmod 600 "$ZB_DIR/runs/snap.json"
: >"$TRACE"
zb_complete 0 --snapshot "$ZB_DIR/runs/snap.json"
zb_check "Z8c a private snapshot is accepted, and each project file is hashed through an fd opened O_NOFOLLOW (open line in the trace) [FR-030]" \
  "0 yes" "$RC $(grep -qE "^open .*/z8/vault/project/real-proj/a[.]md$" "$TRACE" && echo yes || echo no)"

# ---------- Z9: every pattern runs in linear time (MAJOR-A) ----------
# One 1 MiB single line per pattern, built from the pattern's own prefix
# repeated (the input that made patterns 1, 10 and 11 quadratic), redacted in
# a child with a 10 s kill; each must finish in < 2000 ms.
zb_sandbox z9
z9_time() { # <unit> -> elapsed ms, or HUNG
  zb_lib 10000 '
    const X = require(lib + "/intent-redact.cjs");
    const u = argv[0]; const n = 1024 * 1024;
    const t = u.repeat(Math.ceil(n / u.length)).slice(0, n);
    const t0 = Date.now(); X.redact(t); console.log(Date.now() - t0);' "$1"
}
z9_i=0
for z9_case in \
  "a|1 URL credentials" "sk-ant-|2 sk-ant-" "sk-|3 sk-" "ghp_|4 GitHub" "AKIA|5 AWS id" "xoxb-|6 Slack" \
  "figd_|7 Figma" "AIza|8 Gemini" "-----BEGIN RSA PRIVATE KEY-----|9 PEM" "A_TOKEN|10 *_TOKEN=" \
  "railway|11 Railway" "secret|12 key/value" "Bearer |13 Bearer" "sk-proj-|14 sk-proj-" "sk_live_|15 Stripe" \
  "github_pat_|16 github_pat_" "npm_|17 npm" "eyJ|18 JWT"; do
  z9_unit="${z9_case%%|*}"
  z9_label="${z9_case#*|}"
  z9_ms="$(z9_time "$z9_unit")"
  z9_tag="$(printf "\\x$(printf '%x' $((97 + z9_i)))")"
  z9_i=$((z9_i + 1))
  if [[ "$z9_ms" =~ ^[0-9]+$ && "$z9_ms" -lt 2000 ]]; then ok "Z9$z9_tag pattern $z9_label: a 1 MiB line of its own prefix is redacted in < 2 s [FR-031]"
  else bad "Z9$z9_tag pattern $z9_label: a 1 MiB line of its own prefix is redacted in < 2 s [FR-031]" "got: $z9_ms"; fi
done

# ---------- Z10: complete stays bounded on a 4 MiB line (MAJOR-A) ----------
zb_claimed
# Exactly 4 MiB with the newline: the whole line is read (no cut, which
# would drop it as a partial first line and never reach the filter).
node -e 'process.stdout.write("a".repeat(4 * 1024 * 1024 - 1) + "\n")' >"$SB/stdout.txt"
z10_t0="$(node -e 'process.stdout.write(String(Date.now()))')"
run_outputs "$ZB_ID"
zb_run_timed 30000 complete "$ZB_F" --exit-code 0 --stdout "$RUN_OUT" --stderr "$RUN_ERR"
z10_ms="$(( $(node -e 'process.stdout.write(String(Date.now()))') - z10_t0 ))"
zb_check "Z10 complete with one 4 MiB stdout line (read whole, not cut) exits 0 in < 5 s, its tail reaches the Summary [FR-029]" "0 fast 1" "$RC $([[ $z10_ms -lt 5000 ]] && echo fast || echo "slow:$z10_ms") $(grep -c '^aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$ZB_P/intents/$ZB_ID.md")"
printf 'plain line\n' >"$SB/stdout.txt"

# ---------- Z11: filter gaps (MINOR-D) ----------
zb_sandbox z11
zb_claimed
cat >"$SB/stdout.txt" <<'OUT'
G1 Authorization: Token tokGAPaaaa1111
G2 password: "correct horse battery staple"
G3 key sk-proj-AbCdEfGhIjKlMnOp_Qr-StUvWx1234
G4 pat github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvw
G5 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U
G6 stripe @@SKLIVE@@4eC39HqLyjWDarjtT1zdp7dc
G7 npm npm_abcdefghijklmnopqrstuvwxyz0123456789
G8 usage input_tokens: 1200 output_tokens: 345
OUT
node -e 'const fs=require("fs"),f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,"utf8").split("@@SKLIVE@@").join("sk_"+"live_"))' "$SB/stdout.txt"  # Stripe-shaped fakes are assembled at runtime: GitHub push protection blocks the literal
zb_complete 0
z11_note="$ZB_P/intents/$ZB_ID.md"
z11_check() { # <tag> <line> <secret> <label>
  if [[ "$(grep -c "^$2 .*\[REDACTED\]" "$z11_note" 2>/dev/null)" == "1" ]] && ! grep -qF -- "$3" "$z11_note"; then ok "$1 $4 -> [REDACTED] [FR-031]"
  else bad "$1 $4 -> [REDACTED] [FR-031]" "line: $(grep "^$2 " "$z11_note" 2>/dev/null | head -1)"; fi
}
z11_check Z11a G1 "tokGAPaaaa1111" "Authorization: Token <t> (any scheme word)"
z11_check Z11b G2 "battery staple" "a quoted value with spaces"
z11_check Z11c G3 "AbCdEfGhIjKlMnOp_Qr-StUvWx1234" "sk-proj- key"
z11_check Z11d G4 "11ABCDEFG0123456789_abcdefghijklmnopqrstuvw" "github_pat_ token"
z11_check Z11e G5 "eyJzdWIiOiIxMjM0NTY3ODkwIn0" "bare JWT"
z11_check Z11f G6 "4eC39HqLyjWDarjtT1zdp7dc" "Stripe sk_live_ key"
z11_check Z11g G7 "abcdefghijklmnopqrstuvwxyz0123456789" "npm_ token"
zb_check "Z11h token counts stay: input_tokens: 1200 output_tokens: 345 is not redacted [FR-031]" \
  "G8 usage input_tokens: 1200 output_tokens: 345" "$(grep '^G8 ' "$z11_note")"

# ---------- Z12: real-shape sources (MAJOR-C, item 2; testing.md class 3) ----------
# Secrets NOT in this machine's devices.json, so only the patterns can act.
zb_sandbox z12
zb_claimed
cat >"$SB/stdout.txt" <<'OUT'
{
  "devices": {
    "old-mac": {
      "secret_hex": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "created_at": "2026-08-01T10:00:00.000Z",
      "revoked_at": null
    }
  }
}
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
aws_session_token = FwoGZXIvYXdzEBYaDHqa0AP1/example+token==
DATABASE_URL=postgres://app:dbPASSxyz@localhost:5432/app
SECRET_KEY=djangoSECRETabc123
STRIPE_SECRET_KEY=@@SKLIVE@@51HxQstripeSECRETvalue00
JWT_SECRET="multi word secret value"
OPENAI_API_KEY=sk-proj-openAIprojectKEY_abc-123456789
client_secret: oauthCLIENTsecret99
PRIVATE_KEY_PASSPHRASE=passPHRASEvalue77
OUT
node -e 'const fs=require("fs"),f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,"utf8").split("@@SKLIVE@@").join("sk_"+"live_"))' "$SB/stdout.txt"  # Stripe-shaped fakes are assembled at runtime: GitHub push protection blocks the literal
zb_complete 0
z12_note="$ZB_P/intents/$ZB_ID.md"
z12_left=""
for z12_s in 9f86d081884c7d659a2feaa0c55ad015 wJalrXUtnFEMI FwoGZXIvYXdz AKIAIOSFODNN7EXAMPLE dbPASSxyz djangoSECRETabc123 \
  stripeSECRETvalue00 "multi word secret value" "word secret" openAIprojectKEY oauthCLIENTsecret99 passPHRASEvalue77; do
  grep -qF -- "$z12_s" "$z12_note" && z12_left="$z12_left|$z12_s"
done
zb_check "Z12a devices.json of another machine, ~/.aws/credentials and a .env file: no secret value reaches the note [FR-031]" \
  "0 none" "$RC ${z12_left:-none}"

# ---------- Z13: every case above reported ----------
zb_ran=$((pass + fail - ZB_RAN_BEFORE))
if [[ "$zb_ran" -eq 52 ]]; then ok "Z13 05c-hardening reported all 52 cases before this one [FR-038]"
else bad "Z13 05c-hardening reported all 52 cases before this one [FR-038]" "reported: $zb_ran"; fi
