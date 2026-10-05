#!/usr/bin/env bash
# cases/08-tick.sh — spec 011 Wave 8: `intent tick`, `watch`, `list`,
# conflict copies, tamper state, queue-control intents (approve, cancel),
# run's cancel poll. Sourced after 07b-security.sh; reuses 06-run.sh's w6_*
# and 07-bounds.sh's w7_* helpers. Every child is stub/claude.
#
# RED proof: the single production change that turns each case red is in
# the mutation table (scratchpad), measured on git-archive copies.

w8_now() { node -e 'process.stdout.write(String(Date.now()))'; }
w8_locks() { ls "$FHOME/.a1-intents/executor.lock" "$FHOME/.a1-intents/locks/"*.lock 2>/dev/null | wc -l | tr -d " "; }
w8_uuid() { node -e 'process.stdout.write(require("crypto").randomUUID())'; }
w8_ago() { node -e 'process.stdout.write(new Date(Date.now() - Number(process.argv[1]) * 1000).toISOString())' "$1"; }
w8_count() { find "$VAULT/inbox/intents/$1" -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' '; }
w8_spawns() { [[ -f "$W6_STUB/invocations.log" ]] && grep -c . "$W6_STUB/invocations.log" || echo 0; }
w8_stat() { node -e 'const fs = require("fs"); const crypto = require("crypto"); const f = process.argv[1]; const s = fs.statSync(f);
  process.stdout.write([s.ino, s.mtimeMs, crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")].join(":"))' "$1"; }
w8_empty_queue() { rm -f "$VAULT"/inbox/intents/{queued,claimed}/*.md; rm -rf "$W6_STUB"; w6_age_runs; }
w8_tick() { rm -rf "$W6_STUB"; w6_age_runs; run_intent tick; }
# w8_tick_lib <mode> — stub/tick-lib.cjs; TL = its JSON, spy in $SB/.spy
w8_tick_lib() {
  : >"$SB/.spy"; rm -rf "$W6_STUB"; w6_age_runs
  TL="$(HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" node "$STUB_DIR/tick-lib.cjs" "$INTENT_LIB" "$FHOME" "$1" "$SB/.spy" 2>"$SB/.tl-err")"
}
# w8_mk <mk_intent args...> — mk_intent, W8_F = path, W8_ID = id
w8_mk() { W8_F="$(mk_intent "$@")"; W8_ID="$(basename "$W8_F" .md)"; }
# w8_approve <target-id> <target-file> [created_by] — an approve intent for the target
w8_approve() { w8_mk action=approve target="$1" target_sha256="$(sha256_of "$2")" created_by="${3:-mac-robert}"; }
w8_fm() { local v; v="$(w6_fm "$1" "$2")"; v="${v#\"}"; printf '%s' "${v%\"}"; } # approve writes patched values double-quoted

w6_sandbox w8-tick

# ---------- T1: conflict copies are never touched (FR-009) ----------
w8_mk action=progress
t1_base="$W8_ID"
cp "$W8_F" "$Q/$t1_base (conflict 2026-09-24).md"
cp "$W8_F" "$Q/$t1_base.sync-conflict-20260924-101010-ABCDEFG.md"
rm -f "$W8_F"
t1_a="$(w8_stat "$Q/$t1_base (conflict 2026-09-24).md")"; t1_b="$(w8_stat "$Q/$t1_base.sync-conflict-20260924-101010-ABCDEFG.md")"
w8_tick
t1_rc="$RC"
run_intent list --state ignored
t1_list="$(w6_js 'o.map((r) => r.state + ":" + require("path").basename(r.path)).sort().join("|")' "$OUT")"
t1_log="$(grep -c "$t1_base" "$FHOME/.a1-intents/log.jsonl")"
if [[ "$t1_rc" == 0 && "$(w8_stat "$Q/$t1_base (conflict 2026-09-24).md")" == "$t1_a" && "$(w8_stat "$Q/$t1_base.sync-conflict-20260924-101010-ABCDEFG.md")" == "$t1_b" \
    && "$t1_list" == "ignored:$t1_base (conflict 2026-09-24).md|ignored:$t1_base.sync-conflict-20260924-101010-ABCDEFG.md" && "$(w8_count rejected)" == 0 && "$t1_log" == 0 ]]; then
  ok "T1 '<id> (conflict 2026-09-24).md' and '<id>.sync-conflict-…md' in queued/: after a tick both keep inode, mtime and bytes, list shows them ignored, nothing rejected, no log line names them [FR-009]"
else bad "T1 '<id> (conflict 2026-09-24).md' and '<id>.sync-conflict-…md' in queued/: after a tick both keep inode, mtime and bytes, list shows them ignored, nothing rejected, no log line names them [FR-009]" "rc $t1_rc list '$t1_list' rejected $(w8_count rejected) log $t1_log"; fi
rm -f "$Q"/*conflict*

# ---------- T2/T3: oldest first, one spawn, tick returns after the child (FR-032) ----------
w8_empty_queue
w8_mk action=progress id=ffffffff-0000-4000-8000-000000000003 created_at="$(w8_ago 180)" payload='|
  oldest'
t2_old="$W8_ID"
w8_mk action=progress id=88888888-0000-4000-8000-000000000002 created_at="$(w8_ago 120)" payload='|
  middle'
w8_mk action=progress id=11111111-0000-4000-8000-000000000001 created_at="$(w8_ago 60)" payload='|
  newest'
w8_mk action=progress @nosign
w8_mk action=bogus
stub_mode slow
t2_t0="$(w8_now)"
w8_tick_lib plain
t2_ms="$(node -e 'const ev = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); const a = ev.find((e) => e.event === "driver"); const b = ev.find((e) => e.event === "resolved"); console.log(a && b ? b.ms - a.ms : -1)' "$SB/.spy")" # from the driver's start to tick's resolution (Reinhard m4)
stub_mode ok
t2="$(w6_js 'o.exitCode' "$TL") $(w8_count rejected) $(w8_count claimed) $(w8_count done) $(w8_spawns) $(tr -d '\n' <"$W6_STUB/stdin.txt" 2>/dev/null) $(w6_where "$t2_old")"
t3_done="$(node -e 'const ev = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === "resolved"); console.log(ev ? ev.done.includes(process.argv[2] + ".md") : "no-resolve")' "$SB/.spy" "$t2_old")"
if [[ "$t2" == "0 2 2 1 1 oldest done" ]]; then
  ok "T2 three valid (created_at -3, -2, -1 min; ids sorting the other way) and two invalid queued -> 2 rejected, the oldest ran (its payload on the stub's stdin, done/), the other two claimed, exactly one spawn [FR-032]"
else bad "T2 three valid (created_at -3, -2, -1 min; ids sorting the other way) and two invalid queued -> 2 rejected, the oldest ran (its payload on the stub's stdin, done/), the other two claimed, exactly one spawn [FR-032]" "rc rejected claimed done spawns stdin where: $t2" "tl: ${TL:0:300}"; fi
if [[ "$t2_ms" -ge 1000 && "$t3_done" == true ]]; then ok "T3 the stub sleeps 1 s: tick's promise resolves after ${t2_ms} ms (>= 1000) and at that moment the intent is already in done/ [FR-032]"
else bad "T3 the stub sleeps 1 s: tick's promise resolves after ${t2_ms} ms (>= 1000) and at that moment the intent is already in done/ [FR-032]" "done at resolve: $t3_done"; fi
rm -f "$VAULT"/inbox/intents/rejected/*.md

# ---------- T4: host gate before anything is listed (FR-032, FR-017) ----------
w8_empty_queue
w8_mk action=progress
t4_before="$(w8_stat "$W8_F")"
rmdir "$VAULT/inbox/intents/done.t4" 2>/dev/null; mv "$VAULT/inbox/intents/done" "$VAULT/inbox/intents/done.t4"
set_executor other-mac.invalid
w8_tick
set_executor "$W5B_HOST"
t4="$RC $(w6_js 'o.reasons.join(",")' "$OUT") $( [[ -e "$VAULT/inbox/intents/done" ]] && echo created) $( [[ "$(w8_stat "$W8_F")" == "$t4_before" ]] && echo unchanged)"
mv "$VAULT/inbox/intents/done.t4" "$VAULT/inbox/intents/done"
if [[ "$t4" == "1 not_executor_host  unchanged" ]]; then ok "T4 a tick on a foreign host -> exit 1 not_executor_host, the queued file unchanged, no folder created [FR-032, FR-017]"
else bad "T4 a tick on a foreign host -> exit 1 not_executor_host, the queued file unchanged, no folder created [FR-032, FR-017]" "$t4"; fi

# ---------- T5: watch stops on SIGTERM (FR-032) ----------
w8_empty_queue
t5_lines0="$(grep -c '"command":"tick"' "$FHOME/.a1-intents/log.jsonl")"
( HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent watch --interval 1 >"$SB/.watch-out" 2>"$SB/.watch-err"; echo $? >"$SB/.watch-rc" ) &
t5_pid=$!
sleep 2.5
t5_node="$(pgrep -P "$t5_pid" node | head -1)"
t5_t0="$(w8_now)"
kill -TERM "${t5_node:-$t5_pid}"
wait "$t5_pid"
t5_ms=$(( $(w8_now) - t5_t0 ))
t5_lines=$(( $(grep -c '"command":"tick"' "$FHOME/.a1-intents/log.jsonl") - t5_lines0 ))
if [[ "$(cat "$SB/.watch-rc")" == 0 && "$t5_ms" -lt 1000 && "$t5_lines" -ge 2 ]]; then ok "T5 watch --interval 1, SIGTERM after 2.5 s -> exit 0 within ${t5_ms} ms, $t5_lines tick log lines [FR-032]"
else bad "T5 watch --interval 1, SIGTERM after 2.5 s -> exit 0 within ${t5_ms} ms, $t5_lines tick log lines [FR-032]" "rc $(cat "$SB/.watch-rc") err $(head -c 200 "$SB/.watch-err")"; fi

# ---------- T6/T7: list rows and the tamper state (FR-034) ----------
w8_empty_queue
rm -f "$VAULT"/inbox/intents/{done,rejected}/*.md
w8_mk action=progress; t6_q="$W8_ID"
w6_claim action=progress; t6_c="$W6_ID"
w6_claim action=progress; t6_d="$W6_ID"; w6_run
w8_mk action=progress; run_intent reject "$W8_F" --reason stale; t6_r="$W8_ID"
run_intent list --state all
t6_all="$(w6_js 'o.length + " " + o.every((r) => Object.keys(r).join(",") === "path,state,id,action,project,created_by,created_at,reason") + " " + o.map((r) => r.state + (r.reason ? "/" + r.reason : "")).sort().join(",")' "$OUT")"
run_intent list --state claimed
t6_claimed="$(w6_js 'o.length + " " + o[0].id' "$OUT")"
if [[ "$t6_all" == "4 true claimed,done,queued,rejected/stale" && "$t6_claimed" == "1 $t6_c" ]]; then
  ok "T6 one file per folder -> list --state all prints 4 rows with exactly path, state, id, action, project, created_by, created_at, reason (rejected carries its reason); --state claimed -> that one row [FR-034]"
else bad "T6 one file per folder -> list --state all prints 4 rows with exactly path, state, id, action, project, created_by, created_at, reason (rejected carries its reason); --state claimed -> that one row [FR-034]" "all: $t6_all" "claimed: $t6_claimed"; fi
t7_done="$VAULT/inbox/intents/done/$t6_d.md"
run_intent list --state tampered; t7_before="$(w6_js 'o.length' "$OUT")"
printf 'edited by hand\n' >>"$t7_done"
printf 'edited too\n' >>"$VAULT/inbox/intents/claimed/$t6_c.md"
run_intent list --state tampered
t7="$t7_before $(w6_js 'o.map((r) => r.id).sort().join(",")' "$OUT")"
t7_want="0 $(printf '%s\n' "$t6_c" "$t6_d" | sort | paste -sd, -)"
rm -rf "$W6_STUB"
w6_run "$VAULT/inbox/intents/claimed/$t6_c.md"
t7_run="$RC $(w6_where "$t6_c") $(w8_fm "$VAULT/inbox/intents/rejected/$t6_c.md" rejected_reason) $(w8_spawns)"
if [[ "$t7" == "$t7_want" && "$t7_run" == "1 rejected tampered 0" ]]; then
  ok "T7 a line appended to a done/ file and to a claimed/ file -> both listed state tampered (none before); run on the claimed one -> rejected tampered, 0 spawns [FR-034]"
else bad "T7 a line appended to a done/ file and to a claimed/ file -> both listed state tampered (none before); run on the claimed one -> rejected tampered, 0 spawns [FR-034]" "list: $t7 (want $t7_want)" "run: $t7_run"; fi

# T7b: a claimed intent that run rejected records the rejected bytes; an edit after that is tampered too
t7b_f="$VAULT/inbox/intents/rejected/$t6_c.md"
run_intent list --state tampered; t7b_before="$(w6_js 'o.map((r) => r.id).includes(process.argv[3])' "$OUT" "$t6_c")"
printf 'edited after the rejection\n' >>"$t7b_f"
run_intent list --state tampered; t7b_after="$(w6_js 'o.map((r) => r.id).includes(process.argv[3])' "$OUT" "$t6_c")"
if [[ "$t7b_before $t7b_after" == "false true" ]]; then ok "T7b a claimed intent rejected by run (tampered) is not listed tampered in rejected/ until its bytes change after that rejection [FR-034]"
else bad "T7b a claimed intent rejected by run (tampered) is not listed tampered in rejected/ until its bytes change after that rejection [FR-034]" "before $t7b_before after $t7b_after"; fi

# ---------- T8: SC-006, a done intent's original bytes back in queued/ -> replay ----------
w8_empty_queue
w8_mk action=progress; t8_id="$W8_ID"; cp "$W8_F" "$SB/t8.orig"
w8_tick
t8_first="$(w6_where "$t8_id")"
cp "$SB/t8.orig" "$Q/$t8_id.md"
w8_tick
t8="$t8_first $(w8_fm "$VAULT/inbox/intents/rejected/$t8_id.md" rejected_reason) $(w8_spawns)"
if [[ "$t8" == "done replay 0" ]]; then ok "T8 the original bytes of a done intent re-appear in queued/ -> the next tick rejects them replay, 0 spawns [FR-032, SC-006]"
else bad "T8 the original bytes of a done intent re-appear in queued/ -> the next tick rejects them replay, 0 spawns [FR-032, SC-006]" "$t8"; fi
rm -f "$VAULT"/inbox/intents/rejected/*.md

# ---------- T9: approve from the phone vs. from the executor device (FR-032) ----------
w8_empty_queue
w8_mk action=progress @nosign; t9_t="$W8_ID"
w8_tick
t9_tf="$VAULT/inbox/intents/rejected/$t9_t.md"
t9_pre="$(w8_fm "$t9_tf" rejected_reason) $(sha256_of "$t9_tf")"
w8_approve "$t9_t" "$t9_tf" pixel-robert; t9_a1="$W8_ID"
w8_tick
t9_phone="$(w8_fm "$VAULT/inbox/intents/rejected/$t9_a1.md" rejected_reason) $(sha256_of "$t9_tf") $(w8_count queued) $(w8_spawns)"
w8_approve "$t9_t" "$t9_tf"; t9_a2="$W8_ID"
stub_mode fail # the re-queued target must not run in this tick anyway
w8_tick
stub_mode ok
t9_q="$Q/$t9_t.md"
t9_exec="$(w6_where "$t9_t") $(w8_fm "$t9_q" id) $(w8_fm "$t9_q" created_by) $(w8_fm "$t9_q" approved_via) $(w8_fm "$t9_q" approved_by_intent) $(w8_fm "$t9_q" approved_from_device) $(w6_where "$t9_a2") $(w8_fm "$VAULT/inbox/intents/done/$t9_a2.md" status) $( [[ -e "$VAULT/project/real-proj/intents/$t9_a2.md" ]] && echo note)"
HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent validate "$t9_q" >"$SB/.t9v" 2>&1; t9_valid=$?
if [[ "$t9_pre" == "signature_invalid "* && "$t9_phone" == "approve_from_non_executor_device ${t9_pre#signature_invalid } 0 0" \
    && "$t9_exec" == "queued $t9_t mac-robert intent $t9_a2 pixel-robert done done " && "$t9_valid" == 0 ]]; then
  ok "T9 approve signed by pixel -> rejected approve_from_non_executor_device, the target byte-identical in rejected/; signed by the executor device -> the target itself back in queued/ (id kept, created_by mac-robert, approved_via intent, approved_by_intent, approved_from_device pixel-robert, validates), the approve in done/ with no result note [FR-032]"
else bad "T9 approve signed by pixel -> rejected approve_from_non_executor_device, the target byte-identical in rejected/; signed by the executor device -> the target itself back in queued/ (id kept, created_by mac-robert, approved_via intent, approved_by_intent, approved_from_device pixel-robert, validates), the approve in done/ with no result note [FR-032]" "pre: $t9_pre" "phone: $t9_phone" "exec: $t9_exec valid $t9_valid $(head -c 200 "$SB/.t9v")"; fi
rm -f "$Q"/*.md "$VAULT"/inbox/intents/rejected/*.md

# w8_bg_tick <tag> — `intent tick` in the background (cancel poll 500 ms,
# grace 500 ms, timeout 10 s as a safety bound); RC in $SB/.bg-<tag>.rc
w8_bg_tick() {
  ( A1_INTENT_CANCEL_POLL_MS=500 A1_INTENT_KILL_GRACE_MS=500 A1_INTENT_TIMEOUT_MS=10000 HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" \
      node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent tick >"$SB/.bg-$1.out" 2>"$SB/.bg-$1.err"; echo $? >"$SB/.bg-$1.rc" ) &
  W8_BG=$!
}
# w8_gone_within <ms> <pid...> — every pid fails kill -0 within <ms>; prints the ms it took or "alive"
w8_gone_within() {
  local limit="$1" t0 p alive; shift; t0="$(w8_now)"
  while :; do
    alive=0; for p in "$@"; do kill -0 "$p" 2>/dev/null && alive=1; done
    [[ "$alive" == 0 ]] && { echo $(( $(w8_now) - t0 )); return; }
    (( $(w8_now) - t0 > limit )) && { echo alive; return; }
    sleep 0.05
  done
}
w8_wait_file() { for _ in $(seq 1 100); do [[ -s "$1" ]] && return 0; sleep 0.1; done; return 1; }

# ---------- T10: cancel of the running intent through run's poll; cancel of a claimed one in the pass (FR-032) ----------
w8_empty_queue
w8_mk action=progress; t10_a="$W8_ID"
stub_mode hang
w8_bg_tick t10
w8_wait_file "$W6_STUB/grandchild.pid"
t10_stub="$(cat "$W6_STUB/stub.pid" 2>/dev/null || echo 999999)"; t10_gc="$(cat "$W6_STUB/grandchild.pid" 2>/dev/null || echo 999999)"
w8_mk action=cancel target="$t10_a" id=ffffffff-0000-4000-8000-0000000000c1; t10_x="$W8_ID"
w8_mk action=progress id=00000000-0000-4000-8000-0000000000c0; t10_c="$W8_ID" # sorts before the cancel: a poll that reads more than cancels would claim it first
t10_ms="$(w8_gone_within 2000 "$t10_stub" "$t10_gc")"
wait "$W8_BG"
stub_mode ok
t10="$(w6_where "$t10_a") $(w8_fm "$VAULT/inbox/intents/done/$t10_a.md" failure_reason) $(w6_where "$t10_x") $(w8_fm "$VAULT/inbox/intents/done/$t10_x.md" status) $( [[ -e "$VAULT/project/real-proj/intents/$t10_x.md" ]] && echo note) $(w6_where "$t10_c") $(w8_locks)"
kill -9 "$t10_stub" "$t10_gc" 2>/dev/null
w8_mk action=progress; t10_b="$W8_ID"; run_intent claim "$W8_F"
w8_mk action=cancel target="$t10_b"; t10_y="$W8_ID"
w8_tick
t10b="$(w6_where "$t10_b") $(w8_fm "$VAULT/inbox/intents/rejected/$t10_b.md" rejected_reason) $(w8_fm "$VAULT/inbox/intents/rejected/$t10_b.md" cancelled_by_intent) $(w6_where "$t10_y") $(w8_spawns)"
if [[ "$t10_ms" != alive && "$t10" == "done cancelled done done  queued 0" && "$t10b" == "rejected cancelled_by_user $t10_y done 1" ]]; then
  ok "T10 a valid cancel for the running intent arrives with an unrelated intent C -> stub and grandchild gone ${t10_ms} ms later (poll 500 + grace 500 + 1 s), the target done/ failed cancelled, the cancel in done/ status done with no note, C still in queued/; a cancel of a claimed intent in the pass -> rejected cancelled_by_user with cancelled_by_intent [FR-032]"
else bad "T10 a valid cancel for the running intent arrives with an unrelated intent C -> stub and grandchild gone ${t10_ms} ms later (poll 500 + grace 500 + 1 s), the target done/ failed cancelled, the cancel in done/ status done with no note, C still in queued/; a cancel of a claimed intent in the pass -> rejected cancelled_by_user with cancelled_by_intent [FR-032]" "poll: $t10_ms | $t10" "pass: $t10b" "err: $(head -c 300 "$SB/.bg-t10.err")"; fi

# ---------- T11/T12: unknown, finished or own target (FR-032) ----------
w8_empty_queue
t11_done="$(ls "$VAULT"/inbox/intents/done/*.md | head -1)"; t11_done_id="$(basename "$t11_done" .md)"; t11_done_sha="$(sha256_of "$t11_done")"
w8_mk action=cancel target="$(w8_uuid)"; t11_u="$W8_ID"
w8_mk action=cancel target="$t11_done_id"; t11_d="$W8_ID"
t12_c="$(w8_uuid)"; w8_mk action=cancel id="$t12_c" target="$t12_c"
touch "$SB/t11.marker"; sleep 1
w8_tick
t11_moved="$(find "$VAULT/inbox/intents" -type f -newer "$SB/t11.marker" | sed 's#.*/inbox/intents/##' | sort | paste -sd, -)"
t11_want="$(printf 'rejected/%s.md\n' "$t11_u" "$t11_d" "$t12_c" | sort | paste -sd, -)"
t11="$(for i in "$t11_u" "$t11_d" "$t12_c"; do w8_fm "$VAULT/inbox/intents/rejected/$i.md" rejected_reason; printf ' '; done)$(sha256_of "$t11_done") $(w8_spawns)"
if [[ "$t11_moved" == "$t11_want" && "$t11" == "target_not_found target_not_found target_not_found $t11_done_sha 0" ]]; then
  ok "T11/T12 a cancel of an unknown uuid, a cancel of a done/ intent, a cancel naming its own id -> all three rejected target_not_found, only those three files changed (find -newer), the done file byte-identical, 0 spawns [FR-032]"
else bad "T11/T12 a cancel of an unknown uuid, a cancel of a done/ intent, a cancel naming its own id -> all three rejected target_not_found, only those three files changed (find -newer), the done file byte-identical, 0 spawns [FR-032]" "moved: $t11_moved" "want:  $t11_want" "reasons/sha/spawns: $t11"; fi

# T12b (Reinhard m5): an executor-signed approve naming its own id, while rejected/ holds a file of that very
# name. Measured: validation already refuses it at the claim (it finds the approve itself in queued/ first,
# whose bytes cannot equal its own target_sha256), so the apply-time self-target rule of approveEffect is
# defence in depth that no claimed note can reach (mutation R10: equivalent).
w8_empty_queue
t12b_id="$(w8_uuid)"
w8_mk action=progress id="$t12b_id" @nosign
w8_tick
t12b_rf="$VAULT/inbox/intents/rejected/$t12b_id.md"; t12b_sha="$(sha256_of "$t12b_rf")"
w8_mk action=approve id="$t12b_id" target="$t12b_id" target_sha256="$t12b_sha" created_by=mac-robert
w8_tick
t12b_rej="$(grep -l '^action: approve$' "$VAULT"/inbox/intents/rejected/*.md 2>/dev/null | head -1)"
t12b_claimlog="$(grep "\"intent_id\":\"$t12b_id\"" "$FHOME/.a1-intents/log.jsonl" | grep '"command":"claim"' | grep -c '"reason":"target_not_found"')"
t12b="$(w8_fm "$t12b_rej" rejected_reason) $(sha256_of "$t12b_rf") $(w8_count queued) $(w8_spawns) $t12b_claimlog"
if [[ -n "$t12b_rej" && "$t12b" == "target_not_found $t12b_sha 0 0 1" ]]; then
  ok "T12b an executor-signed approve whose target is its own id, with rejected/<id>.md present -> rejected target_not_found already at its claim (the validator finds the approve itself first, so its target_sha256 cannot bind), rejected/<id>.md byte-identical, queued/ empty [FR-032, Reinhard m5]"
else bad "T12b an executor-signed approve whose target is its own id, with rejected/<id>.md present -> rejected target_not_found already at its claim (the validator finds the approve itself first, so its target_sha256 cannot bind), rejected/<id>.md byte-identical, queued/ empty [FR-032, Reinhard m5]" "$t12b (file ${t12b_rej:-none})"; fi
rm -f "$VAULT"/inbox/intents/rejected/*.md

# ---------- T13: cancel during a post-step (FR-032, spec round 4) ----------
w8_empty_queue
w8_mk action=plan target=M2-P1-x; t13_a="$W8_ID"
: >"$SB/.spy"
( A1_INTENT_CANCEL_POLL_MS=500 A1_INTENT_KILL_GRACE_MS=500 A1_INTENT_TIMEOUT_MS=20000 HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" \
    node "$STUB_DIR/tick-lib.cjs" "$INTENT_LIB" "$FHOME" gate-hang "$SB/.spy" >"$SB/.t13.out" 2>"$SB/.t13.err" ) &
t13_bg=$!
for _ in $(seq 1 100); do grep -q '"event":"gate"' "$SB/.spy" && break; sleep 0.1; done
t13_gate="$(node -e 'const ev = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === "gate"); console.log(ev ? ev.pid : 999999)' "$SB/.spy")"
w8_mk action=cancel target="$t13_a"; t13_x="$W8_ID"
t13_ms="$(w8_gone_within 2000 "$t13_gate")"
wait "$t13_bg"
t13="$(w6_where "$t13_a") $(w8_fm "$VAULT/inbox/intents/done/$t13_a.md" failure_reason) $(w6_where "$t13_x") $(w8_fm "$VAULT/inbox/intents/done/$t13_x.md" status)"
kill -9 "$t13_gate" 2>/dev/null
if [[ "$t13_gate" != 999999 && "$t13_ms" != alive && "$t13" == "done cancelled done done" ]]; then
  ok "T13 the child exited 0 and the injected gate sleeps 30 s; a valid cancel for the running id -> the gate's process gone ${t13_ms} ms later, the intent failed cancelled, the cancel in done/ [FR-032, spec round 4]"
else bad "T13 the child exited 0 and the injected gate sleeps 30 s; a valid cancel for the running id -> the gate's process gone ${t13_ms} ms later, the intent failed cancelled, the cancel in done/ [FR-032, spec round 4]" "gate $t13_gate ms $t13_ms | $t13" "err: $(head -c 300 "$SB/.t13.err")"; fi

# ---------- T14: the approve is bound to the bytes the owner saw (FR-032, spec round 6) ----------
w8_empty_queue
w8_mk action=progress @nosign; t14_t="$W8_ID"
w8_tick
t14_tf="$VAULT/inbox/intents/rejected/$t14_t.md"
w8_approve "$t14_t" "$t14_tf"; t14_a="$W8_ID"
w8_tick_lib swap-target
t14="$(w6_where "$t14_a") $(w8_fm "$VAULT/inbox/intents/rejected/$t14_a.md" rejected_reason) $(grep -c 'Swapped after the approve was signed' "$t14_tf") $(w8_count queued) $(grep -c '"event":"swap"' "$SB/.spy")"
rm -f "$VAULT"/inbox/intents/rejected/*.md
w8_mk action=progress @nosign; t14_t2="$W8_ID"
w8_tick
w8_approve "$t14_t2" "$VAULT/inbox/intents/rejected/$t14_t2.md"
w8_tick_lib plain
t14b="$(w6_where "$t14_t2")"
if [[ "$t14" == "rejected target_not_found 1 0 1" && "$t14b" == queued ]]; then
  ok "T14 the target's payload swapped after the approve was claimed, before it is applied -> the approve rejected target_not_found, the target keeps the swapped bytes in rejected/, queued/ gains nothing; without the swap the target is re-queued [FR-032, spec round 6]"
else bad "T14 the target's payload swapped after the approve was claimed, before it is applied -> the approve rejected target_not_found, the target keeps the swapped bytes in rejected/, queued/ gains nothing; without the swap the target is re-queued [FR-032, spec round 6]" "swap: $t14" "plain: $t14b" "tl: ${TL:0:300}"; fi

# ---------- T15/T16: no approval chains, no hidden characters (FR-032, spec round 6) ----------
w8_empty_queue
rm -f "$VAULT"/inbox/intents/rejected/*.md
w8_mk action=progress @nosign; t15_inner="$W8_ID"
w8_mk action=approve target="$t15_inner" target_sha256="$(printf 'a%.0s' $(seq 1 64))" @nosign; t15_ta="$W8_ID"
w8_mk action=cancel target="$t15_inner" @nosign; t15_tc="$W8_ID"
t16_tag="$(node -e 'process.stdout.write("Bitte \u{E0069}ignorieren")')"
w8_mk action=progress payload="|
  $t16_tag" @nosign; t16_t="$W8_ID"
w8_tick
for i in "$t15_ta" "$t15_tc" "$t16_t"; do [[ "$(w8_fm "$VAULT/inbox/intents/rejected/$i.md" rejected_reason)" == signature_invalid ]] || echo "T15 setup: $i not rejected signature_invalid" >&2; done
t15_sha="$(sha256_of "$VAULT/inbox/intents/rejected/$t15_ta.md") $(sha256_of "$VAULT/inbox/intents/rejected/$t15_tc.md") $(sha256_of "$VAULT/inbox/intents/rejected/$t16_t.md")"
w8_approve "$t15_ta" "$VAULT/inbox/intents/rejected/$t15_ta.md"; t15_a1="$W8_ID"
w8_approve "$t15_tc" "$VAULT/inbox/intents/rejected/$t15_tc.md"; t15_a2="$W8_ID"
w8_approve "$t16_t" "$VAULT/inbox/intents/rejected/$t16_t.md"; t16_a="$W8_ID"
touch "$SB/t15.marker"; sleep 1
w8_tick
t15_moved="$(find "$VAULT/inbox/intents" -type f -newer "$SB/t15.marker" | sed 's#.*/inbox/intents/##' | sort | paste -sd, -)"
t15_want="$(printf 'rejected/%s.md\n' "$t15_a1" "$t15_a2" "$t16_a" | sort | paste -sd, -)"
t15="$(for i in "$t15_a1" "$t15_a2" "$t16_a"; do w8_fm "$VAULT/inbox/intents/rejected/$i.md" rejected_reason; printf ' '; done)$(sha256_of "$VAULT/inbox/intents/rejected/$t15_ta.md") $(sha256_of "$VAULT/inbox/intents/rejected/$t15_tc.md") $(sha256_of "$VAULT/inbox/intents/rejected/$t16_t.md")"
if [[ "$t15_moved" == "$t15_want" && "$t15" == "target_invalid target_invalid target_invalid $t15_sha" ]]; then
  ok "T15/T16 executor-signed approves of a rejected approve, of a rejected cancel and of a target whose payload holds U+E0069 -> each rejected target_invalid, all three targets byte-identical, only the three approves moved [FR-032, spec round 6]"
else bad "T15/T16 executor-signed approves of a rejected approve, of a rejected cancel and of a target whose payload holds U+E0069 -> each rejected target_invalid, all three targets byte-identical, only the three approves moved [FR-032, spec round 6]" "moved: $t15_moved" "want:  $t15_want" "got: $t15 (pre $t15_sha)"; fi

# ---------- T17: run polls its cancel marker itself and ends its OWN group (Samuel MINOR-2) ----------
w8_empty_queue
w8_mk action=progress; t17_a="$W8_ID"
stub_mode hang
w8_bg_tick t17
w8_wait_file "$W6_STUB/grandchild.pid"
t17_stub="$(cat "$W6_STUB/stub.pid" 2>/dev/null || echo 999999)"; t17_gc="$(cat "$W6_STUB/grandchild.pid" 2>/dev/null || echo 999999)"
printf '%s' "$(w8_uuid)" >"$FHOME/.a1-intents/runs/$t17_a.cancel"; chmod 600 "$FHOME/.a1-intents/runs/$t17_a.cancel"
t17_ms="$(w8_gone_within 2000 "$t17_stub" "$t17_gc")"
wait "$W8_BG"
stub_mode ok
t17="$(w6_where "$t17_a") $(w8_fm "$VAULT/inbox/intents/done/$t17_a.md" failure_reason) $( [[ -e "$FHOME/.a1-intents/runs/$t17_a.cancel" ]] && echo marker)"
kill -9 "$t17_stub" "$t17_gc" 2>/dev/null
if [[ "$t17_ms" != alive && "$t17" == "done cancelled " ]]; then
  ok "T17 only the marker runs/<id>.cancel is written (no other process signals anything) -> run's own poll ends its child and grandchild ${t17_ms} ms later, failed cancelled, marker gone [FR-028, Samuel MINOR-2]"
else bad "T17 only the marker runs/<id>.cancel is written (no other process signals anything) -> run's own poll ends its child and grandchild ${t17_ms} ms later, failed cancelled, marker gone [FR-028, Samuel MINOR-2]" "ms $t17_ms | $t17" "err: $(head -c 300 "$SB/.bg-t17.err")"; fi

# ---------- T18: finishQueueControl refuses an edited queue-control intent (FR-032, spec round 3) ----------
w8_empty_queue
w8_mk action=progress; t18_t="$W8_ID"
w8_mk action=cancel target="$t18_t"; t18_id="$W8_ID"
run_intent claim "$Q/$t18_id.md"
printf 'appended after the claim\n' >>"$VAULT/inbox/intents/claimed/$t18_id.md"
t18="$(HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e '
  const [lib, home, file] = process.argv.slice(1);
  require(lib + "/intent-child.cjs").injectChildDeps({ passwdHome: () => home });
  const r = require(lib + "/intent-tick.cjs").finishQueueControl(file);
  console.log(r.exitCode + " " + (r.out && r.out.reasons || []).join(","));' "$INTENT_LIB" "$FHOME" "$VAULT/inbox/intents/claimed/$t18_id.md" 2>&1) $(w6_where "$t18_id")"
if [[ "$t18" == "1 tampered claimed" ]]; then ok "T18 a claimed cancel edited after its claim -> finishQueueControl refuses it tampered and moves nothing [FR-032, spec round 3]"
else bad "T18 a claimed cancel edited after its claim -> finishQueueControl refuses it tampered and moves nothing [FR-032, spec round 3]" "$t18" "claim: ${OUT:0:200}"; fi

# ---------- T19: a claim refused ledger_busy leaves the file in queued/ (FR-032) ----------
w8_empty_queue
w8_mk action=progress; t19_id="$W8_ID"; t19_sha="$(sha256_of "$W8_F")"
sleep 600 & t19_holder=$!
printf '{"pid":%s,"hostname":"%s","acquired_at":"%s","token":"fixture"}' "$t19_holder" "$W5B_HOST" "$(w8_ago 0)" >"$FHOME/.a1-intents/ledger.lock"; chmod 600 "$FHOME/.a1-intents/ledger.lock"
w8_tick
rm -f "$FHOME/.a1-intents/ledger.lock"; kill "$t19_holder" 2>/dev/null; wait "$t19_holder" 2>/dev/null
t19="$RC $(w6_where "$t19_id") $(sha256_of "$Q/$t19_id.md" 2>/dev/null) $(w6_js '(o.skipped || []).map((s) => s.reason).join(",")' "$OUT") $(w8_spawns)"
if [[ "$t19" == "0 queued $t19_sha ledger_busy 0" ]]; then ok "T19 the ledger lock held by a live process -> claim refuses ledger_busy, tick leaves the file byte-identical in queued/ for the next tick, 0 spawns [FR-032]"
else bad "T19 the ledger lock held by a live process -> claim refuses ledger_busy, tick leaves the file byte-identical in queued/ for the next tick, 0 spawns [FR-032]" "$t19" "out: ${OUT:0:300}"; fi

# ---------- T20: a stale executor.lock does not stall the queue (Reinhard W8-M1) ----------
w8_empty_queue
sleep 0 & t20_dead=$!
wait "$t20_dead"
w7_exlock "$(w7_ctxlock "$t20_dead" "$W5B_HOST")"
w8_mk action=progress; t20_id="$W8_ID"
w8_tick
t20="$RC $(w6_where "$t20_id") $(w8_spawns) $( [[ -e "$FHOME/.a1-intents/executor.lock" ]] && echo lock)"
if [[ "$t20" == "0 done 1 " ]]; then ok "T20 executor.lock of a dead same-host run (a crash) and a queued intent -> tick claims and runs it (run reclaims the lock), done, no lock left [FR-025, FR-032, Reinhard W8-M1]"
else bad "T20 executor.lock of a dead same-host run (a crash) and a queued intent -> tick claims and runs it (run reclaims the lock), done, no lock left [FR-025, FR-032, Reinhard W8-M1]" "$t20" "out: ${OUT:0:300}"; fi

# ---------- T21: the poll walks every cancel for the running id (Reinhard m1) ----------
w8_empty_queue
w8_mk action=progress; t21_a="$W8_ID"
stub_mode hang
w8_bg_tick t21
w8_wait_file "$W6_STUB/grandchild.pid"
t21_stub="$(cat "$W6_STUB/stub.pid" 2>/dev/null || echo 999999)"; t21_gc="$(cat "$W6_STUB/grandchild.pid" 2>/dev/null || echo 999999)"
w8_mk action=cancel target="$t21_a" id=00000000-0000-4000-8000-0000000000aa @nosign; t21_bad="$W8_ID" # sorts first, fails validation
w8_mk action=cancel target="$t21_a" id=ffffffff-0000-4000-8000-0000000000ff; t21_x="$W8_ID"
t21_ms="$(w8_gone_within 2000 "$t21_stub" "$t21_gc")"
wait "$W8_BG"
stub_mode ok
t21="$(w8_fm "$VAULT/inbox/intents/done/$t21_a.md" failure_reason) $(w6_where "$t21_x") $(w6_where "$t21_bad")"
kill -9 "$t21_stub" "$t21_gc" 2>/dev/null
if [[ "$t21_ms" != alive && "$t21" == "cancelled done queued" ]]; then
  ok "T21 an invalid cancel for the running id sorts before a valid one -> the poll still applies the valid one (child gone ${t21_ms} ms later, failed cancelled), the invalid one stays in queued/ for the next pass [FR-032, Reinhard m1]"
else bad "T21 an invalid cancel for the running id sorts before a valid one -> the poll still applies the valid one (child gone ${t21_ms} ms later, failed cancelled), the invalid one stays in queued/ for the next pass [FR-032, Reinhard m1]" "ms $t21_ms | $t21"; fi
rm -f "${Q:?}"/*.md

# ---------- T22: the poll acts on the target in the CLAIMED bytes, not on a mention (Samuel s1) ----------
w8_empty_queue
w8_mk action=progress; t22_b="$W8_ID"; run_intent claim "$W8_F"
w8_mk action=progress created_at="$(w8_ago 120)"; t22_a="$W8_ID" # older than B: runs first
stub_mode slow
w8_bg_tick t22
w8_wait_file "$W6_STUB/stub.pid"
w8_mk action=cancel target="$t22_b" payload="|
  stop $t22_a as well"; t22_x="$W8_ID" # names A in its payload, targets B
wait "$W8_BG"
stub_mode ok
t22_mid="$(w6_where "$t22_a") $(w8_fm "$VAULT/inbox/intents/done/$t22_a.md" status) $(w6_where "$t22_x")"
w8_tick
t22="$t22_mid $(w6_where "$t22_x") $(w6_where "$t22_b") $(w8_fm "$VAULT/inbox/intents/rejected/$t22_b.md" rejected_reason)"
if [[ "$t22" == "done done claimed done rejected cancelled_by_user" ]]; then
  ok "T22 while A runs, a cancel for B that mentions A's id in its payload -> the poll claims it but leaves A alone (A done, not cancelled); the next tick applies it to B (rejected cancelled_by_user) [FR-032, Samuel s1]"
else bad "T22 while A runs, a cancel for B that mentions A's id in its payload -> the poll claims it but leaves A alone (A done, not cancelled); the next tick applies it to B (rejected cancelled_by_user) [FR-032, Samuel s1]" "$t22"; fi

chmod -R u+w "$WORK"
