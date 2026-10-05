#!/usr/bin/env bash
# cases/04-claim.sh — spec 011 Wave 4: executor host binding, fail-closed
# ledger, atomic single-winner claim, reject, one decision-log line per
# command. Sourced by run-tests.sh.
#
# RED proof (CONVENTIONS.md): the single production change that turns each
# case red, each measured on a cp -R copy of the tree before commit.
#   C1  hasReplay checking only (device, nonce), not `id` (C1b: same id, new
#       nonce); ledger row missing one of the six fields (C1a). C1c (the same
#       file copied back) is double-guarded: id and (device, nonce) both match.
#   C2  hasReplay checking only `id` (C2a); matching on nonce alone without
#       the device (C2b: a second device's equal nonce is refused).
#   C3  loadLedger catching the parse error and continuing with [] (C3a),
#       accepting a non-array `rows` (C3b), following a symlinked ledger (C3c).
#   C4  reading the intent before requireExecutorHost (C4a: trace shows the
#       read), a missing executor.json treated as "any host" (C4c), a corrupt
#       executor.json treated as missing (C4d).
#   C5  the already_claimed branch exiting 0 (C5a: two winners). The ledger
#       lock and the atomic rename are two guards; C5a alone cannot tell them
#       apart, so C5b isolates the rename (rename ENOENT treated as success)
#       and C5c/C5d isolate the lock (skipping it; never reclaiming a dead
#       holder's lock).
#   C6  writing the claimed frontmatter before the rename (C6b), rewriting
#       through io.writeMdAtomic (C6a: key order changes), dropping
#       claimed_by (C6a).
#   C7  accepting any string as reason (C7b), a plain rename over an
#       existing rejected/ file (C7e), rewriting instead of prepending on an
#       unparsable file (C7c), dropping the copy loop of the header
#       prepend (C7c/C7d), dropping the size gate of readForReject (C7f: the
#       truncated read parses and is rewritten; C7d stays green because
#       oversized.md truncated does not parse).
#   C8  none — a Gegentest: reject never writes under project/.
#   C9  logging the whole frontmatter (C9a: payload text in the log),
#       dropping the `payload` key guard in logDecision (C9b), a command that
#       does not log (C9a line counts).
#   C10 not catching A1_DEVICES_UNREADABLE in claim (C10a: no log line; the
#       facade's generic internal error has none).
#   C13 removing claim or reject from the intent-cli table, or the module
#       not exporting cmdIntentClaim / cmdIntentReject ("not implemented").
#   C14 readForReject parsing with io.parseFrontmatter (C14c: the duplicate
#       key collapses, the file is rewritten instead of getting a header),
#       dropping the parse-back check of rewriteFrontmatter (C14d). C14a/b
#       are refused by validate's strict parser before any rewrite.
#   C15 removing a new key from INTENT_A1_ONLY_KEYS (C15d/e/f: the file a1
#       writes is then schema_invalid; C15g: the frozen list differs),
#       dropping the validateNoA1OnlyKeys call (C15a–c; without the list
#       entry they are refused as unknown keys anyway — double-guarded).
#   C11 claim passing no executorDevice to validate (C11a: approve from the
#       executor device is refused).

W4_HOST="$(node -e 'process.stdout.write(require("os").hostname())')"
W4_PAYLOAD_TEXT="Push-Benachrichtigung bei neuem Auftrag"
W4_PAYLOAD_SHA="d44c6af75fba4ec2d394ccdea93c260a30d1136805313cfde73375cd75e74fd7"

w4_sandbox() {
  new_sandbox "$1"
  mk_project real-proj
  set_executor "$W4_HOST"
  W4_LEDGER="$FHOME/.a1-intents-ledger.json"
  W4_LOG="$FHOME/.a1-intents/log.jsonl"
  W4_C="$VAULT/inbox/intents/claimed"
  W4_R="$VAULT/inbox/intents/rejected"
}

# w4_node <js> [args...] — JS with the lifecycle modules as L (lifecycle),
# G (ledger), O (log), inside the sandbox HOME and vault.
w4_node() {
  local js="$1"
  shift
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e "
    const lib = process.argv[1];
    const fs = require('fs');
    const path = require('path');
    const L = require(lib + '/intent-lifecycle.cjs');
    const G = require(lib + '/intent-ledger.cjs');
    const O = require(lib + '/intent-log.cjs');
    const argv = process.argv.slice(2);
    $js" "$INTENT_LIB" "$@" 2>&1
}

# w4_json <expr> <json> — evaluates <expr> with the parsed JSON as `o`.
w4_json() { node -e 'let o; try { o = JSON.parse(process.argv[2]); } catch (e) { console.log("<not JSON>"); process.exit(0); } console.log(eval(process.argv[1]))' "$@" 2>&1; }

w4_count() { find "$1" -type f | wc -l | tr -d ' '; }
w4_lines() { if [[ -f "$1" ]]; then wc -l <"$1" | tr -d ' '; else echo 0; fi; }
w4_sha() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }
w4_field() { node -e 'const m = require("fs").readFileSync(process.argv[1], "utf8").match(new RegExp("^" + process.argv[2] + ": (.*)$", "m")); process.stdout.write(m ? m[1] : "")' "$1" "$2"; }

# w4_bg <tag> <args...> — `a1-tools intent <args>` as a separate process; rc,
# stdout, stderr land in $SB/.rc.<tag>, .out.<tag>, .err.<tag>.
w4_bg() {
  local tag="$1"
  shift
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" \
    node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent "$@" >"$SB/.out.$tag" 2>"$SB/.err.$tag"
  echo $? >"$SB/.rc.$tag"
}

w4_reasons() { w4_json 'o.reasons.join(",")' "$OUT"; }

# ---------- C1: ledger row + replay by id ----------
w4_sandbox c1
c1_f="$(mk_intent)"
c1_id="$(basename "$c1_f" .md)"
c1_nonce="$(w4_field "$c1_f" nonce)"
cp "$c1_f" "$SB/orig.md"
run_intent claim "$c1_f"
c1_row="$(node -e '
  const [file, id, nonce, host, sha] = process.argv.slice(1);
  const d = JSON.parse(require("fs").readFileSync(file, "utf8"));
  const r = d.rows[0] || {};
  const ok = d.rows.length === 1 && r.id === id && r.device === "pixel-robert" && r.nonce === nonce
    && r.action === "new-feature" && r.project === "real-proj" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.claimed_at)
    && r.claimed_sha256 === sha && r.started_at === null && r.outcome === "claimed";
  console.log(ok ? "ok" : JSON.stringify(d));' "$W4_LEDGER" "$c1_id" "$c1_nonce" "$W4_HOST" "$(w4_sha "$W4_C/$c1_id.md" 2>/dev/null)" 2>&1)"
if [[ "$RC" -eq 0 && "$c1_row" == "ok" ]]; then ok "C1a claim writes one ledger row: id, device, nonce, action, project, claimed_at, claimed_sha256 [FR-014]"
else bad "C1a claim writes one ledger row: id, device, nonce, action, project, claimed_at, claimed_sha256 [FR-014]" "rc $RC, row: ${c1_row:0:400}" "stderr: ${ERR:0:300}"; fi

# C1b: same id, fresh nonce — only the id check can refuse it.
rm -f "$W4_C/$c1_id.md"
c1_g="$(mk_intent "id=$c1_id")"
run_intent claim "$c1_g"
if [[ "$RC" -eq 1 && "$(w4_reasons)" == "replay" && "$(w4_field "$c1_g" nonce)" != "$c1_nonce" && -f "$c1_g" ]]; then
  ok "C1b an already claimed id with a new nonce is refused as replay, nothing moved [FR-014]"
else bad "C1b an already claimed id with a new nonce is refused as replay, nothing moved [FR-014]" "rc $RC, out: ${OUT:0:200}"; fi

rm -f "$c1_g"
cp "$SB/orig.md" "$c1_f"
run_intent claim "$c1_f"
if [[ "$RC" -eq 1 && "$(w4_reasons)" == "replay" && "$(w4_count "$W4_C")" == "0" && -f "$c1_f" ]]; then
  ok "C1c the same file re-appearing in queued/ is refused as replay, nothing moved [FR-014]"
else bad "C1c the same file re-appearing in queued/ is refused as replay, nothing moved [FR-014]" "rc $RC, out: ${OUT:0:200}, claimed/: $(w4_count "$W4_C")"; fi

# ---------- C2: replay by (device, nonce) ----------
w4_sandbox c2
c2_f="$(mk_intent)"
c2_nonce="$(w4_field "$c2_f" nonce)"
run_intent claim "$c2_f"
c2_g="$(mk_intent "nonce=$c2_nonce")"
run_intent claim "$c2_g"
if [[ "$RC" -eq 1 && "$(w4_reasons)" == "replay" && -f "$c2_g" ]]; then
  ok "C2a a new id with an already used (device, nonce) is refused as replay [FR-014]"
else bad "C2a a new id with an already used (device, nonce) is refused as replay [FR-014]" "rc $RC, out: ${OUT:0:200}"; fi

c2_h="$(mk_intent "nonce=$c2_nonce" created_by=mac-robert)"
run_intent claim "$c2_h"
if [[ "$RC" -eq 0 && -f "$W4_C/$(basename "$c2_h")" ]]; then
  ok "C2b the same nonce from another device is not a replay [FR-014]"
else bad "C2b the same nonce from another device is not a replay [FR-014]" "rc $RC, out: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi

# ---------- C3: corrupt ledger fails closed ----------
w4_sandbox c3
c3_f="$(mk_intent)"
c3_letters=(a b c)
c3_i=0
for c3_body in '{' '{"rows":"x"}' 'SYMLINK'; do
  c3_tag="${c3_letters[$c3_i]}"
  c3_i=$((c3_i + 1))
  rm -f "$W4_LEDGER"
  if [[ "$c3_body" == "SYMLINK" ]]; then
    printf '{"rows":[]}\n' >"$SB/elsewhere.json"
    ln -s "$SB/elsewhere.json" "$W4_LEDGER"
  else
    printf '%s' "$c3_body" >"$W4_LEDGER"
  fi
  c3_before="$(tree_listing "$VAULT")"
  run_intent claim "$c3_f"
  c3_name="C3$c3_tag ledger ${c3_body} -> ledger_unreadable, queued/ unchanged [FR-014]"
  if [[ "$RC" -eq 1 && "$(w4_reasons)" == "ledger_unreadable" && "$(tree_listing "$VAULT")" == "$c3_before" ]]; then ok "$c3_name"
  else bad "$c3_name" "rc $RC, out: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi
done

# ---------- C4: executor host binding ----------
w4_sandbox c4
c4_f="$(mk_intent)"
set_executor "not-this-host"
c4_before="$(tree_listing "$VAULT")"
: >"$TRACE"
run_intent claim "$c4_f"
c4_rc_claim=$RC
c4_out_claim="$OUT"
c4_reads="$(grep -c "$(basename "$c4_f")" "$TRACE")"
run_intent reject "$c4_f" --reason signature_invalid
if [[ "$c4_rc_claim" -eq 1 && "$(w4_json 'o.reasons.join(",")' "$c4_out_claim")" == "not_executor_host" && "$c4_reads" == "0" \
  && "$RC" -eq 1 && "$(w4_reasons)" == "not_executor_host" && "$(tree_listing "$VAULT")" == "$c4_before" ]]; then
  ok "C4a wrong hostname: claim and reject -> not_executor_host, intent never read, 0 files moved [FR-017]"
else bad "C4a wrong hostname: claim and reject -> not_executor_host, intent never read, 0 files moved [FR-017]" "claim rc $c4_rc_claim ${c4_out_claim:0:120}; trace hits $c4_reads; reject rc $RC ${OUT:0:120}"; fi

run_intent validate "$c4_f"
if [[ "$RC" -eq 0 ]]; then ok "C4b validate still works on a non-executor host [FR-017]"
else bad "C4b validate still works on a non-executor host [FR-017]" "rc $RC, out: ${OUT:0:200}"; fi

rm -f "$FHOME/.a1-intents/executor.json"
run_intent claim "$c4_f"
if [[ "$RC" -eq 1 && "$(w4_reasons)" == "not_executor_host" && "$(tree_listing "$VAULT")" == "$c4_before" ]]; then
  ok "C4c no executor.json -> not_executor_host, nothing moved [FR-017]"
else bad "C4c no executor.json -> not_executor_host, nothing moved [FR-017]" "rc $RC, out: ${OUT:0:200}"; fi

printf '{"executor_host":' >"$FHOME/.a1-intents/executor.json"
c4_log_before="$(w4_lines "$W4_LOG")"
run_intent claim "$c4_f"
c4_last="$(tail -n 1 "$W4_LOG" 2>/dev/null)"
if [[ "$RC" -eq 2 && -z "$OUT" && "$ERR" == *"executor.json"* && "$(w4_lines "$W4_LOG")" == "$((c4_log_before + 1))" \
  && "$(w4_json 'o.reason' "$c4_last")" == "executor_unreadable" && "$(tree_listing "$VAULT")" == "$c4_before" ]]; then
  ok "C4d corrupt executor.json -> exit 2 (operator error), one log line, nothing moved [FR-017]"
else bad "C4d corrupt executor.json -> exit 2 (operator error), one log line, nothing moved [FR-017]" "rc $RC, out: ${OUT:0:120}, stderr: ${ERR:0:200}, last log: ${c4_last:0:200}"; fi

# ---------- C5: concurrent claim, single winner ----------
w4_sandbox c5
c5_ok=0
c5_detail=""
for c5_round in 1 2 3 4 5; do
  c5_f="$(mk_intent)"
  w4_bg a claim "$c5_f" &
  c5_pa=$!
  w4_bg b claim "$c5_f" &
  c5_pb=$!
  wait "$c5_pa" "$c5_pb"
  c5_ra="$(cat "$SB/.rc.a")"
  c5_rb="$(cat "$SB/.rc.b")"
  if [[ "$c5_ra" -eq 0 ]]; then c5_lose=b; else c5_lose=a; fi
  c5_lreason="$(w4_json 'o.reasons.join(",")' "$(cat "$SB/.out.$c5_lose")")"
  if [[ $(( (c5_ra == 0) + (c5_rb == 0) )) -eq 1 && "$c5_lreason" == "already_claimed" \
    && "$(w4_field "$W4_C/$(basename "$c5_f")" status)" == "claimed" ]]; then
    c5_ok=$((c5_ok + 1))
  else c5_detail="$c5_detail round $c5_round: rc $c5_ra/$c5_rb loser [$c5_lreason];"; fi
done
c5_rows="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).rows.length)' "$W4_LEDGER" 2>&1)"
if [[ "$c5_ok" -eq 5 && "$c5_rows" == "5" && "$(w4_count "$W4_C")" == "5" && "$(w4_count "$Q")" == "0" ]]; then
  ok "C5a two concurrent claim processes, 5 rounds: exactly one exit 0, loser already_claimed, one ledger row each [FR-018]"
else bad "C5a two concurrent claim processes, 5 rounds: exactly one exit 0, loser already_claimed, one ledger row each [FR-018]" "$c5_detail ledger rows $c5_rows"; fi

# C5b — the rename is a guard of its own: a rename that fails with ENOENT
# (another process moved the file first) -> already_claimed, nothing written.
c5b_f="$(mk_intent)"
c5b="$(w4_node '
  const before = G.loadLedger().rows.length;
  const writes = [];
  const deps = {
    rename: () => { const e = new Error("gone"); e.code = "ENOENT"; throw e; },
    writeText: (p) => writes.push(p),
  };
  const r = L.claimIntent(argv[0], deps);
  const rows = G.loadLedger().rows.length - before;
  console.log(r.exitCode === 1 && r.out.reasons.join() === "already_claimed" && writes.length === 0 && rows === 0 ? "ok" : JSON.stringify({ r, writes, rows }));' "$c5b_f")"
[[ "$c5b" == "ok" ]] && ok "C5b rename ENOENT -> already_claimed, no frontmatter write, no ledger row [FR-018]" \
  || bad "C5b rename ENOENT -> already_claimed, no frontmatter write, no ledger row [FR-018]" "${c5b:0:400}"

# C5c — the ledger lock: a lock held by a live process on this host makes
# claim give up with ledger_busy and move nothing.
printf '{"pid":%s,"hostname":"%s","acquired_at":"%s"}\n' "$$" "$W4_HOST" "$(node -e 'process.stdout.write(new Date().toISOString())')" \
  >"$FHOME/.a1-intents/ledger.lock"
c5c_before="$(tree_listing "$VAULT")"
run_intent claim "$c5b_f"
if [[ "$RC" -eq 1 && "$(w4_reasons)" == "ledger_busy" && "$(tree_listing "$VAULT")" == "$c5c_before" ]]; then
  ok "C5c a ledger lock held by a live process -> ledger_busy, nothing moved [FR-018]"
else bad "C5c a ledger lock held by a live process -> ledger_busy, nothing moved [FR-018]" "rc $RC, out: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi

( exit 0 ) &
c5_dead=$!
wait "$c5_dead"
printf '{"pid":%s,"hostname":"%s","acquired_at":"%s"}\n' "$c5_dead" "$W4_HOST" "2026-09-27T00:00:00.000Z" >"$FHOME/.a1-intents/ledger.lock"
run_intent claim "$c5b_f"
if [[ "$RC" -eq 0 && ! -e "$FHOME/.a1-intents/ledger.lock" ]]; then
  ok "C5d a lock left by a dead process on this host is reclaimed and released [FR-018]"
else bad "C5d a lock left by a dead process on this host is reclaimed and released [FR-018]" "rc $RC, out: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi

# ---------- C6: rename first, then rewrite, key order preserved ----------
w4_sandbox c6
c6_f="$(mk_intent)"
: >"$TRACE"
run_intent claim "$c6_f"
c6_file="$W4_C/$(basename "$c6_f")"
c6="$(node -e '
  const lib = process.argv[1];
  const { parseIntentFrontmatter } = require(lib + "/intent-validate.cjs");
  const p = parseIntentFrontmatter(require("fs").readFileSync(process.argv[2], "utf8"));
  if (!p.ok) { console.log("unparsable"); process.exit(0); }
  const keys = Object.keys(p.fm).join(",");
  const fresh = Math.abs(Date.parse(p.fm.claimed_at) - Date.now()) < 60000;
  console.log(keys === "type,schema_version,id,action,project,payload,created_at,created_by,nonce,status,signature,claimed_by,claimed_at"
    && p.fm.status === "claimed" && p.fm.claimed_by === process.argv[3] && fresh
    && p.fm.payload === "Push-Benachrichtigung bei neuem Auftrag\n" ? "ok" : JSON.stringify(p.fm));' "$INTENT_LIB" "$c6_file" "$W4_HOST" 2>&1)"
if [[ "$RC" -eq 0 && "$c6" == "ok" && "$(w4_count "$Q")" == "0" && "$(grep -c '^spawn ' "$TRACE")" == "0" ]]; then
  ok "C6a claimed file: status claimed, claimed_by, claimed_at appended, key order and payload kept, 0 spawns [FR-018]"
else bad "C6a claimed file: status claimed, claimed_by, claimed_at appended, key order and payload kept, 0 spawns [FR-018]" "rc $RC, fm: ${c6:0:400}"; fi

run_intent validate "$c6_file"
if [[ "$RC" -eq 0 ]]; then ok "C6c the claimed file still validates (signature intact) in claimed/ [FR-018]"
else bad "C6c the claimed file still validates (signature intact) in claimed/ [FR-018]" "rc $RC, out: ${OUT:0:200}"; fi

c6b_f="$(mk_intent)"
c6b="$(w4_node '
  const ops = [];
  const deps = {
    rename: (a, b) => { ops.push("rename:" + path.basename(path.dirname(a)) + ">" + path.basename(path.dirname(b))); fs.renameSync(a, b); },
    writeText: (p, t) => { ops.push("write:" + path.basename(path.dirname(p))); fs.writeFileSync(p, t); },
  };
  const r = L.claimIntent(argv[0], deps);
  console.log(r.exitCode === 0 ? ops.join(",") : JSON.stringify(r));' "$c6b_f")"
if [[ "$c6b" == "rename:queued>claimed,write:claimed" ]]; then ok "C6b the rename happens before the frontmatter rewrite, the rewrite targets claimed/ [FR-018]"
else bad "C6b the rename happens before the frontmatter rewrite, the rewrite targets claimed/ [FR-018]" "ops: ${c6b:0:300}"; fi

# ---------- C7: reject codes and folder ----------
w4_sandbox c7
c7_f="$(mk_intent)"
c7_id="$(basename "$c7_f" .md)"
c7_before="$(tree_listing "$VAULT")"
run_intent reject "$c7_f" --reason bogus
if [[ "$RC" -eq 2 && -z "$OUT" && "$(tree_listing "$VAULT")" == "$c7_before" ]]; then
  ok "C7b --reason bogus -> exit 2, nothing moved [FR-019]"
else bad "C7b --reason bogus -> exit 2, nothing moved [FR-019]" "rc $RC, out: ${OUT:0:200}"; fi

run_intent reject "$c7_f" --reason signature_invalid
c7_r="$W4_R/$c7_id.md"
c7_at="$(w4_field "$c7_r" rejected_at)"
if [[ "$RC" -eq 0 && ! -e "$c7_f" && "$(w4_field "$c7_r" status)" == "rejected" && "$(w4_field "$c7_r" rejected_reason)" == "signature_invalid" \
  && "$(w4_field "$c7_r" rejected_by)" == "$W4_HOST" && "$c7_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$ \
  && "$(w4_field "$c7_r" payload)" == "|" ]]; then
  ok "C7a reject -> rejected/<id>.md with status, rejected_reason, rejected_by, rejected_at [FR-019]"
else bad "C7a reject -> rejected/<id>.md with status, rejected_reason, rejected_by, rejected_at [FR-019]" "rc $RC, out: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi

printf 'not an intent\n' >"$Q/garbage.md"
run_intent reject "$Q/garbage.md" --reason schema_invalid
c7c_want="$(printf -- '---\nstatus: rejected\nrejected_reason: schema_invalid\nrejected_by: %s\n' "$W4_HOST")"
if [[ "$RC" -eq 0 && "$(head -n 4 "$W4_R/garbage.md")" == "$c7c_want" && "$(tail -n 1 "$W4_R/garbage.md")" == "not an intent" \
  && "$(sed -n 6p "$W4_R/garbage.md")" == "---" ]]; then
  ok "C7c unparsable garbage.md -> rejected/garbage.md with a header prepended, original text kept [FR-019]"
else bad "C7c unparsable garbage.md -> rejected/garbage.md with a header prepended, original text kept [FR-019]" "rc $RC" "$(head -c 300 "$W4_R/garbage.md" 2>&1)"; fi

cp "$SUITE_DIR/vault/oversized.md" "$Q/big.md"
cp "$SUITE_DIR/vault/oversized.md" "$SB/big.orig"
run_intent reject "$Q/big.md" --reason oversized
if [[ "$RC" -eq 0 && "$(head -n 2 "$W4_R/big.md" | tail -n 1)" == "status: rejected" ]] \
  && tail -n +7 "$W4_R/big.md" | cmp -s - "$SB/big.orig"; then
  ok "C7d oversized file -> header prepended, the original bytes kept unchanged after it [FR-019]"
else bad "C7d oversized file -> header prepended, the original bytes kept unchanged after it [FR-019]" "rc $RC, stderr: ${ERR:0:200}"; fi

# C7f: oversized but with a parsable frontmatter (body > cap) — the size gate
# alone keeps it from being read truncated and rewritten.
cp "$SUITE_DIR/vault/w4-big-body.md" "$Q/bigbody.md"
run_intent reject "$Q/bigbody.md" --reason oversized
if [[ "$RC" -eq 0 && "$(head -n 2 "$W4_R/bigbody.md" | tail -n 1)" == "status: rejected" ]] \
  && tail -n +7 "$W4_R/bigbody.md" | cmp -s - "$SUITE_DIR/vault/w4-big-body.md"; then
  ok "C7f oversized file with a parsable frontmatter -> header prepended, never truncated [FR-019]"
else bad "C7f oversized file with a parsable frontmatter -> header prepended, never truncated [FR-019]" "rc $RC, stderr: ${ERR:0:200}"; fi

cp "$SB/big.orig" "$Q/big.md"
run_intent reject "$Q/big.md" --reason oversized
if [[ "$RC" -eq 0 && "$(find "$W4_R" -name 'big.*' -type f | wc -l | tr -d ' ')" == "2" ]]; then
  ok "C7e a second reject of the same filename keeps the first rejected file [FR-019]"
else bad "C7e a second reject of the same filename keeps the first rejected file [FR-019]" "rc $RC, rejected/: $(ls "$W4_R" 2>&1 | tr '\n' ' ')"; fi

# ---------- C8: no project artifact on a bad slug ----------
w4_sandbox c8
c8_f="$(mk_intent 'project=../.ssh')"
touch "$SB/marker"
run_intent reject "$c8_f" --reason project_invalid
c8_new="$(find "$VAULT" -newer "$SB/marker" -type f ! -path '*/inbox/intents/rejected/*' 2>&1)"
if [[ "$RC" -eq 0 && ! -e "$VAULT/project" && -z "$c8_new" ]]; then
  ok "C8 reject project_invalid writes nothing under project/ (only rejected/ changes) [FR-019]"
else bad "C8 reject project_invalid writes nothing under project/ (only rejected/ changes) [FR-019]" "rc $RC, new: ${c8_new:0:300}"; fi

# ---------- C9: one log line per decision ----------
w4_sandbox c9
c9_f="$(mk_intent)"
c9_g="$(mk_intent)"
c9_ok=1
c9_detail=""
for c9_cmd in "validate $c9_f" "claim $c9_f" "reject $c9_g --reason stale"; do
  c9_before="$(w4_lines "$W4_LOG")"
  # shellcheck disable=SC2086
  run_intent $c9_cmd
  c9_after="$(w4_lines "$W4_LOG")"
  c9_line="$(tail -n 1 "$W4_LOG" 2>/dev/null)"
  c9_keys="$(w4_json '["ts","command","intent_id","outcome","reason","hostname"].every((k) => k in o) && o.command === process.argv[3] && o.hostname === process.argv[4] ? "ok" : "bad"' "$c9_line" "${c9_cmd%% *}" "$W4_HOST")"
  if [[ "$c9_after" != "$((c9_before + 1))" || "$c9_keys" != "ok" ]]; then
    c9_ok=0
    c9_detail="$c9_detail ${c9_cmd%% *}: $c9_before->$c9_after ${c9_line:0:200};"
  fi
done
c9_claim_line="$(grep '"command":"claim"' "$W4_LOG" | tail -n 1)"
if [[ "$c9_ok" -eq 1 && "$(grep -cF "$W4_PAYLOAD_TEXT" "$W4_LOG")" == "0" \
  && "$(w4_json 'o.payload_sha256' "$c9_claim_line")" == "$W4_PAYLOAD_SHA" && "$(w4_json 'o.outcome' "$c9_claim_line")" == "claimed" ]]; then
  ok "C9a validate, claim, reject each append exactly one JSON line; payload sha256 logged, payload text never [FR-033]"
else bad "C9a validate, claim, reject each append exactly one JSON line; payload sha256 logged, payload text never [FR-033]" "$c9_detail claim line: ${c9_claim_line:0:300}"; fi

c9b="$(w4_node '
  const tries = [{ payload: "x" }, { fm: {} }];
  const refused = tries.filter((extra) => { try { O.logDecision({ command: "claim", intentId: "x", outcome: "ok", reason: null, hostname: "h", ...extra }); return false; } catch (e) { return true; } });
  console.log(refused.length === 2 ? "ok" : "accepted " + (2 - refused.length));')"
if [[ "$c9b" == "ok" && "$(grep -c '"fm"' "$W4_LOG")" == "0" ]]; then ok "C9b logDecision refuses a payload key and any unknown key [FR-033]"
else bad "C9b logDecision refuses a payload key and any unknown key [FR-033]" "$c9b"; fi

# ---------- C10: corrupt devices.json during claim ----------
w4_sandbox c10
c10_f="$(mk_intent)"
printf '{' >"$FHOME/.a1-intents/devices.json"
c10_before="$(tree_listing "$VAULT")"
c10_lines="$(w4_lines "$W4_LOG")"
run_intent claim "$c10_f"
c10_last="$(tail -n 1 "$W4_LOG" 2>/dev/null)"
if [[ "$RC" -eq 2 && -z "$OUT" && "$ERR" == *"devices.json"* && "$(w4_lines "$W4_LOG")" == "$((c10_lines + 1))" \
  && "$(w4_json 'o.reason' "$c10_last")" == "devices_unreadable" && "$(tree_listing "$VAULT")" == "$c10_before" ]]; then
  ok "C10a corrupt devices.json during claim -> exit 2, one log line devices_unreadable, nothing moved [FR-033]"
else bad "C10a corrupt devices.json during claim -> exit 2, one log line devices_unreadable, nothing moved [FR-033]" "rc $RC, stderr: ${ERR:0:200}, log: ${c10_last:0:200}"; fi

rm -f "$FHOME/.a1-intents/devices.json"
ln -s "$SB/nowhere.json" "$FHOME/.a1-intents/devices.json"
run_intent claim "$c10_f"
if [[ "$RC" -eq 2 && -z "$OUT" && "$(tree_listing "$VAULT")" == "$c10_before" ]]; then
  ok "C10b symlinked devices.json during claim -> exit 2, nothing moved [FR-033]"
else bad "C10b symlinked devices.json during claim -> exit 2, nothing moved [FR-033]" "rc $RC, out: ${OUT:0:200}"; fi

# ---------- C11: executor device from executor.json reaches validate ----------
w4_sandbox c11
c11_t="$(mk_intent)"
c11_tid="$(basename "$c11_t" .md)"
C11_TSHA="$(sha256_of "$c11_t")" # spec round 6: an approve carries the target's sha256
c11_a="$(mk_intent action=approve "target_sha256=\"$C11_TSHA\"" "target=$c11_tid" created_by=mac-robert)"
run_intent claim "$c11_a"
if [[ "$RC" -eq 0 ]]; then ok "C11a claim of an approve signed by the executor device passes (executor_device injected) [FR-017]"
else bad "C11a claim of an approve signed by the executor device passes (executor_device injected) [FR-017]" "rc $RC, out: ${OUT:0:200}"; fi

c11_b="$(mk_intent action=approve "target_sha256=\"$C11_TSHA\"" "target=$c11_tid")"
run_intent claim "$c11_b"
if [[ "$RC" -eq 1 && "$(w4_reasons)" == "approve_from_non_executor_device" ]]; then
  ok "C11b claim of an approve signed by the phone -> approve_from_non_executor_device [FR-017]"
else bad "C11b claim of an approve signed by the phone -> approve_from_non_executor_device [FR-017]" "rc $RC, out: ${OUT:0:200}"; fi

c11_c="$(mk_intent action=approve "target_sha256=\"$C11_TSHA\"" "target=$c11_tid" created_by=mac-robert)"
run_intent validate "$c11_c"
if [[ "$RC" -eq 0 ]]; then ok "C11c validate CLI also receives the executor device (approve from the Mac valid) [FR-017]"
else bad "C11c validate CLI also receives the executor device (approve from the Mac valid) [FR-017]" "rc $RC, out: ${OUT:0:200}"; fi

# ---------- C12: claim only takes files from queued/ ----------
w4_sandbox c12
c12_f="$(mk_intent)"
mv "$c12_f" "$VAULT/inbox/intents/done/"
c12_before="$(tree_listing "$VAULT")"
run_intent claim "$VAULT/inbox/intents/done/$(basename "$c12_f")"
if [[ "$RC" -eq 2 && -z "$OUT" && "$(tree_listing "$VAULT")" == "$c12_before" ]]; then
  ok "C12 claim of a file outside queued/ -> usage error, nothing moved [FR-018]"
else bad "C12 claim of a file outside queued/ -> usage error, nothing moved [FR-018]" "rc $RC, out: ${OUT:0:200}"; fi

# ---------- C13: claim and reject are shipped (usage, not "not implemented") ----------
w4_sandbox c13
c13_bad=""
for sub in claim reject; do
  run_intent "$sub"
  [[ "$RC" -eq 2 && -z "$OUT" && "$ERR" == "usage error: intent $sub "* ]] || c13_bad="$c13_bad $sub:$RC:${ERR:0:80}"
done
if [[ -z "$c13_bad" ]]; then ok "C13 claim and reject without arguments -> their own usage error, not 'not implemented' [FR-018]"
else bad "C13 claim and reject without arguments -> their own usage error, not 'not implemented' [FR-018]" "$c13_bad"; fi

# ---------- C14: a duplicate-key or folded file cannot slip through the rewrite ----------
w4_sandbox c14
c14_dup="$(mk_intent '@raw=project: other-proj')"
c14_fold="$(mk_intent 'payload=>' '@raw=  gefaltet')"
c14_before="$(tree_listing "$VAULT")"
run_intent claim "$c14_dup"
c14_rc_dup=$RC
c14_out_dup="$OUT"
run_intent claim "$c14_fold"
if [[ "$c14_rc_dup" -eq 1 && "$(w4_json 'o.reasons.join(",")' "$c14_out_dup")" == "schema_invalid" \
  && "$RC" -eq 1 && "$(w4_reasons)" == "schema_invalid" && "$(tree_listing "$VAULT")" == "$c14_before" ]]; then
  ok "C14a/b claim of a duplicate-key or folded-payload file -> schema_invalid, nothing moved or rewritten [FR-018]"
else bad "C14a/b claim of a duplicate-key or folded-payload file -> schema_invalid, nothing moved or rewritten [FR-018]" "dup rc $c14_rc_dup ${c14_out_dup:0:100}; fold rc $RC ${OUT:0:100}"; fi

cp "$c14_dup" "$SB/dup.orig"
run_intent reject "$c14_dup" --reason schema_invalid
c14_r="$W4_R/$(basename "$c14_dup")"
if [[ "$RC" -eq 0 && "$(sed -n 2p "$c14_r")" == "status: rejected" && "$(grep -c '^project: ' "$c14_r")" == "2" ]] \
  && tail -n +7 "$c14_r" | cmp -s - "$SB/dup.orig"; then
  ok "C14c reject of a duplicate-key file prepends a header and keeps both project lines byte for byte [FR-019]"
else bad "C14c reject of a duplicate-key file prepends a header and keeps both project lines byte for byte [FR-019]" "rc $RC" "$(head -c 300 "$c14_r" 2>&1)"; fi

c14d="$(w4_node '
  const text = fs.readFileSync(argv[0], "utf8");
  try { L.rewriteFrontmatter(text, { status: "claimed" }); console.log("rewrote"); } catch (e) { console.log("refused"); }' "$SB/dup.orig")"
[[ "$c14d" == "refused" ]] && ok "C14d rewriteFrontmatter refuses content that does not parse back strictly (duplicate key) [FR-018]" \
  || bad "C14d rewriteFrontmatter refuses content that does not parse back strictly (duplicate key) [FR-018]" "$c14d"

# ---------- C15: rejected_at, failure_reason, cancelled_by_intent are a1-only keys ----------
w4_sandbox c15
for k in rejected_at failure_reason cancelled_by_intent; do
  run_intent validate "$(mk_intent "@raw=$k: x")"
  expect_verdict "C15 $k in a queued/ file -> schema_invalid [FR-008]" 1 "schema_invalid"
done

c15_f="$(mk_intent)"
run_intent reject "$c15_f" --reason signature_invalid
run_intent validate "$W4_R/$(basename "$c15_f")"
expect_verdict "C15d the rejected/ file reject writes (rejected_at) validates [FR-019]" 0 ""

c15_now="$(node -e 'process.stdout.write(new Date().toISOString())')"
c15_g="$(mk_intent status=failed '@raw=claimed_by: mac-a' "@raw=claimed_at: $c15_now" "@raw=started_at: $c15_now" \
  "@raw=finished_at: $c15_now" '@raw=exit_code: 1' '@raw=failure_reason: timeout')"
mv "$c15_g" "$VAULT/inbox/intents/done/"
run_intent validate "$VAULT/inbox/intents/done/$(basename "$c15_g")"
expect_verdict "C15e a done/ file with status: failed and failure_reason validates [FR-029]" 0 ""

c15_h="$(mk_intent status=rejected '@raw=rejected_reason: cancelled_by_user' '@raw=rejected_by: mac-a' \
  "@raw=rejected_at: $c15_now" '@raw=cancelled_by_intent: 0b8f5a52-4a3e-4c1d-9e2f-3a4b5c6d7e8f')"
mv "$c15_h" "$W4_R/"
run_intent validate "$W4_R/$(basename "$c15_h")"
expect_verdict "C15f a rejected/ file with cancelled_by_intent validates [FR-028]" 0 ""

c15_list="$(node -e '
  const k = require(process.argv[1] + "/intent-constants.cjs").INTENT_A1_ONLY_KEYS;
  const K = ["claimed_by", "claimed_at", "started_at", "finished_at", "exit_code", "rejected_reason", "rejected_by",
    "rejected_at", "failure_reason", "cancelled_by_intent"];
  console.log(k.length === 10 && K.every((x) => k.includes(x)) ? "ok" : JSON.stringify(k));' "$INTENT_LIB" 2>&1)"
[[ "$c15_list" == "ok" ]] && ok "C15g INTENT_A1_ONLY_KEYS is exactly the 10 keys of the fixture's own list [FR-008]" \
  || bad "C15g INTENT_A1_ONLY_KEYS is exactly the 10 keys of the fixture's own list [FR-008]" "$c15_list"
