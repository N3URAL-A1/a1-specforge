#!/usr/bin/env bash
# cases/08b-control.sh — spec 011 Wave 8, Samuel's BLOCKER-1: a queue-control
# note in claimed/ acts only when this host claimed exactly those bytes (an
# open ledger row with its claimed_sha256 and claimed_by = this host). C1 is
# Samuel's probe P1 (scratchpad sam8/cases/08z-samuel.sh) as a case. Sourced
# after 08-tick.sh; reuses its w8_* helpers.

w8b_forge() { # <file> — the note as a claim would leave it, written straight into claimed/ (no ledger row)
  node -e 'const fs = require("fs"); const [f, host, at] = process.argv.slice(1);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^status: queued$/m, `status: claimed\nclaimed_by: ${host}\nclaimed_at: ${at}`))' "$1" "$W5B_HOST" "$(w8_ago 0)"
}
w8b_claimed() { printf '%s' "$VAULT/inbox/intents/claimed/$1.md"; }

w6_sandbox w8-control
I="$VAULT/inbox/intents"

# ---------- C1 (Samuel P1): a forged approve dropped into claimed/ never re-signs its target ----------
w8_mk action=progress @nosign payload='|
  attacker payload, no device key'
c1_t="$W8_ID"
w8_tick
c1_tf="$I/rejected/$c1_t.md"; c1_sha="$(sha256_of "$c1_tf")"
w8_mk action=approve target="$c1_t" target_sha256="$c1_sha" @nosign; c1_a="$W8_ID"
w8b_forge "$W8_F"; mv "$W8_F" "$(w8b_claimed "$c1_a")"
run_intent list --state tampered
c1_list="$(w6_js 'o.map((r) => r.id).includes(process.argv[3])' "$OUT" "$c1_a")" # Samuel m3: a claimed/ file without a ledger row
w8_tick
c1_first="$(w6_where "$c1_t") $(sha256_of "$c1_tf") $(w6_where "$c1_a") $(w8_fm "$I/rejected/$c1_a.md" rejected_reason) $(w8_count queued)"
w8_tick; c1_s2="$(w8_spawns)"
w8_tick; c1_s3="$(w8_spawns)"
c1="$c1_list $c1_first $c1_s2 $c1_s3 $(w6_where "$c1_t") $(sha256_of "$c1_tf")"
if [[ "$c1" == "true rejected $c1_sha rejected tampered 0 0 0 rejected $c1_sha" ]]; then
  ok "C1 a forged, unsigned approve with no ledger row written into claimed/ -> listed tampered, then moved to rejected/ tampered, its target stays byte-identical in rejected/ (never re-signed), queued/ empty, 0 spawns on the next two ticks [FR-032, Samuel W8 BLOCKER-1]"
else bad "C1 a forged, unsigned approve with no ledger row written into claimed/ -> listed tampered, then moved to rejected/ tampered, its target stays byte-identical in rejected/ (never re-signed), queued/ empty, 0 spawns on the next two ticks [FR-032, Samuel W8 BLOCKER-1]" "$c1" "want: true rejected $c1_sha rejected tampered 0 0 0 rejected $c1_sha"; fi
rm -f "$I"/rejected/*.md

# ---------- C2: a forged cancel in claimed/ leaves its claimed target alone ----------
w8_empty_queue
w8_mk action=progress; c2_b="$W8_ID"; run_intent claim "$W8_F"
w8_mk action=cancel target="$c2_b" @nosign; c2_x="$W8_ID"
w8b_forge "$W8_F"; mv "$W8_F" "$(w8b_claimed "$c2_x")"
w8_tick
c2="$(w6_where "$c2_x") $(w8_fm "$I/rejected/$c2_x.md" rejected_reason) $(w6_where "$c2_b") $(w8_fm "$I/done/$c2_b.md" status) $( [[ -e "$FHOME/.a1-intents/runs/$c2_b.cancel" ]] && echo marker) $(w8_spawns)"
if [[ "$c2" == "rejected tampered done done  1" ]]; then
  ok "C2 a forged cancel (no ledger row) in claimed/ for a claimed intent -> the cancel rejected tampered, no cancel marker, the target is not cancelled and runs to done [FR-032, Samuel W8 BLOCKER-1]"
else bad "C2 a forged cancel (no ledger row) in claimed/ for a claimed intent -> the cancel rejected tampered, no cancel marker, the target is not cancelled and runs to done [FR-032, Samuel W8 BLOCKER-1]" "$c2"; fi

# ---------- C3: a legit control note edited after its claim is not applied ----------
w8_empty_queue; rm -f "$I"/rejected/*.md
w8_mk action=progress @nosign; c3_t="$W8_ID"
w8_mk action=progress @nosign; c3_t2="$W8_ID"
w8_tick
c3_tf="$I/rejected/$c3_t.md"; c3_sha="$(sha256_of "$c3_tf")"; c3_t2f="$I/rejected/$c3_t2.md"; c3_t2sha="$(sha256_of "$c3_t2f")"
w8_approve "$c3_t" "$c3_tf"; c3_a="$W8_ID"
run_intent claim "$W8_F"; c3_claim="$RC"
# variant (b): the signed target and target_sha256 of the claimed note are rewritten to another rejected intent
node -e 'const fs = require("fs"); const [f, t2, sha] = process.argv.slice(1); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^target: .*$/m, `target: ${t2}`).replace(/^target_sha256: .*$/m, `target_sha256: ${sha}`))' "$(w8b_claimed "$c3_a")" "$c3_t2" "$c3_t2sha"
w8_tick
c3="$c3_claim $(w6_where "$c3_a") $(w8_fm "$I/rejected/$c3_a.md" rejected_reason) $(w6_where "$c3_t") $(sha256_of "$c3_tf") $(w6_where "$c3_t2") $(sha256_of "$c3_t2f") $(w8_count queued)"
if [[ "$c3" == "0 rejected tampered rejected $c3_sha rejected $c3_t2sha 0" ]]; then
  ok "C3 an executor-signed approve claimed by this host, then its target and target_sha256 rewritten to another rejected intent -> rejected tampered, both intents untouched in rejected/, queued/ empty [FR-032, Samuel W8 BLOCKER-1]"
else bad "C3 an executor-signed approve claimed by this host, then its target and target_sha256 rewritten to another rejected intent -> rejected tampered, both intents untouched in rejected/, queued/ empty [FR-032, Samuel W8 BLOCKER-1]" "$c3"; fi

# ---------- C4: positive control — legit claimed approve and cancel still apply ----------
w8_empty_queue; rm -f "$I"/rejected/*.md
w8_mk action=progress @nosign; c4_t="$W8_ID"
w8_tick
w8_approve "$c4_t" "$I/rejected/$c4_t.md"; c4_a="$W8_ID"; run_intent claim "$W8_F"; c4_ca="$RC"
w8_mk action=progress; c4_b="$W8_ID"; run_intent claim "$W8_F"
w8_mk action=cancel target="$c4_b"; c4_x="$W8_ID"; run_intent claim "$W8_F"; c4_cx="$RC"
stub_mode fail # nothing should be left to run; a stray run would show as nonzero_exit
w8_tick
stub_mode ok
c4="$c4_ca $c4_cx $(w6_where "$c4_t") $(w8_fm "$Q/$c4_t.md" approved_by_intent) $(w6_where "$c4_a") $(w6_where "$c4_b") $(w8_fm "$I/rejected/$c4_b.md" rejected_reason) $(w6_where "$c4_x") $(w8_spawns)"
if [[ "$c4" == "0 0 queued $c4_a done rejected cancelled_by_user done 0" ]]; then
  ok "C4 positive control: an approve and a cancel claimed by this host and unchanged -> applied (the target re-queued with approved_by_intent; the claimed target rejected cancelled_by_user), both notes in done/ [FR-032]"
else bad "C4 positive control: an approve and a cancel claimed by this host and unchanged -> applied (the target re-queued with approved_by_intent; the claimed target rejected cancelled_by_user), both notes in done/ [FR-032]" "$c4"; fi
rm -f "$Q"/*.md "$I"/rejected/*.md

# ---------- C5: the effect uses the VERIFIED bytes, not the listing's ----------
w8_empty_queue
w8_mk action=progress @nosign; c5_t1="$W8_ID"
w8_mk action=progress @nosign; c5_t2="$W8_ID"
w8_tick
c5_t2sha="$(sha256_of "$I/rejected/$c5_t2.md")"
w8_approve "$c5_t1" "$I/rejected/$c5_t1.md"; c5_a="$W8_ID"; run_intent claim "$W8_F"
c5_f="$(w8b_claimed "$c5_a")"
cp "$c5_f" "$FHOME/.a1-intents/tmp/note.orig"
node -e 'const fs = require("fs"); const [f, t2, sha] = process.argv.slice(1); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^target: .*$/m, `target: ${t2}`).replace(/^target_sha256: .*$/m, `target_sha256: ${sha}`))' "$c5_f" "$c5_t2" "$c5_t2sha"
w8_tick_lib swap-note
c5="$(grep -c '"event":"swap-note"' "$SB/.spy") $(w6_where "$c5_t1") $(w6_where "$c5_t2") $(sha256_of "$I/rejected/$c5_t2.md" 2>/dev/null) $(w6_where "$c5_a")"
if [[ "$c5" == "1 queued rejected $c5_t2sha done" ]]; then
  ok "C5 the claimed approve reads 'target: T2' when listed and its claimed bytes ('target: T1') when verified -> T1 is re-queued, T2 stays byte-identical in rejected/: the effect uses the verified bytes [FR-032, Samuel W8 BLOCKER-1]"
else bad "C5 the claimed approve reads 'target: T2' when listed and its claimed bytes ('target: T1') when verified -> T1 is re-queued, T2 stays byte-identical in rejected/: the effect uses the verified bytes [FR-032, Samuel W8 BLOCKER-1]" "$c5" "tl: ${TL:0:300}"; fi
rm -f "$Q"/*.md "$I"/rejected/*.md

# ---------- C6: the note's bytes change after the effect -> rejected tampered at once, not left claimed (Samuel s4) ----------
w8_empty_queue
w8_mk action=progress @nosign; c6_t="$W8_ID"
w8_tick
w8_approve "$c6_t" "$I/rejected/$c6_t.md"; c6_a="$W8_ID"; run_intent claim "$W8_F"
w8_tick_lib edit-note
c6="$(grep -c '"event":"edit-note"' "$SB/.spy") $(w6_where "$c6_a") $(w8_fm "$I/rejected/$c6_a.md" rejected_reason) $(w6_where "$c6_t")"
if [[ "$c6" == "1 rejected tampered queued" ]]; then ok "C6 an approve note edited between its verified effect and its move to done/ -> the target was re-queued from the verified bytes, the note goes to rejected/ tampered in the same tick (not left in claimed/) [FR-032, Samuel s4]"
else bad "C6 an approve note edited between its verified effect and its move to done/ -> the target was re-queued from the verified bytes, the note goes to rejected/ tampered in the same tick (not left in claimed/) [FR-032, Samuel s4]" "$c6" "tl: ${TL:0:300}"; fi
rm -f "${Q:?}"/*.md "${I:?}"/rejected/*.md

# ---------- C7: an applied effect is never repeated when the finish failed (Reinhard m2) ----------
w8_empty_queue
w8_mk action=progress @nosign; c7_t="$W8_ID"
w8_tick
w8_approve "$c7_t" "$I/rejected/$c7_t.md"; c7_a="$W8_ID"; run_intent claim "$W8_F"
w8_tick_lib busy-finish
rm -f "${FHOME:?}/.a1-intents/ledger.lock"
c7_first="$(grep -c '"event":"busy-finish"' "$SB/.spy") $(w6_where "$c7_a") $(w6_where "$c7_t")"
mv "$Q/$c7_t.md" "$SB/c7.requeued" # out of the next pass, so the next tick only sees the note
w8_tick
c7="$c7_first $(w6_where "$c7_a") $(w8_fm "$I/done/$c7_a.md" status)"
if [[ "$c7" == "1 claimed queued done done" ]]; then ok "C7 the effect applied (target re-queued) but the move to done/ refused ledger_busy -> the note stays claimed; the next tick only finishes it (done/, not re-applied and not rejected) [FR-032, Reinhard m2]"
else bad "C7 the effect applied (target re-queued) but the move to done/ refused ledger_busy -> the note stays claimed; the next tick only finishes it (done/, not re-applied and not rejected) [FR-032, Reinhard m2]" "$c7" "tl: ${TL:0:300}"; fi
rm -f "${SB:?}/c7.requeued" "${I:?}"/rejected/*.md

# ---------- C8: an unnamed approve refusal keeps the note claimed (Reinhard m3) ----------
w8_empty_queue
w8_mk action=progress @nosign; c8_t="$W8_ID"
w8_tick
w8_approve "$c8_t" "$I/rejected/$c8_t.md"; c8_a="$W8_ID"; run_intent claim "$W8_F"
cp "$FHOME/.a1-intents/devices.json" "$SB/c8.devices"
node -e 'const fs = require("fs"); const f = process.argv[1]; const d = JSON.parse(fs.readFileSync(f, "utf8")); delete d.devices["mac-robert"]; fs.writeFileSync(f, JSON.stringify(d))' "$FHOME/.a1-intents/devices.json"
w8_tick
c8_mid="$(w6_where "$c8_a") $(w6_where "$c8_t") $(grep "\"intent_id\":\"$c8_a\"" "$FHOME/.a1-intents/log.jsonl" | grep -c 'stays claimed')"
cp "$SB/c8.devices" "$FHOME/.a1-intents/devices.json"; chmod 600 "$FHOME/.a1-intents/devices.json"
w8_tick
c8="$c8_mid $(w6_where "$c8_a") $(w6_where "$c8_t")"
if [[ "$c8" == "claimed rejected 1 done queued" ]]; then ok "C8 reapproveIntent refuses with a code the spec does not name (device_unknown: the executor device's secret is gone) -> the approve stays claimed and is logged, not burned as target_invalid; once the secret is back the next tick applies it [FR-032, Reinhard m3]"
else bad "C8 reapproveIntent refuses with a code the spec does not name (device_unknown: the executor device's secret is gone) -> the approve stays claimed and is logged, not burned as target_invalid; once the secret is back the next tick applies it [FR-032, Reinhard m3]" "$c8"; fi
rm -f "${Q:?}"/*.md "${I:?}"/rejected/*.md

# ---------- C9: a tracked leader without a start token (ps failed) is reaped only while it is our unreaped child (Samuel s2) ----------
c9="$(node -e '
  const cp = require("child_process"); const S = require(process.argv[1] + "/intent-spawn.cjs");
  const b = S.createBudget({ timeoutMs: 60000, graceMs: 200 });
  const mine = cp.spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" });
  const foreign = cp.spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" });
  b.track(mine.pid, null, mine); // ps failed at tracking time, but it is our own child
  b.track(foreign.pid, null); // no token and no child handle: may be a reused pid
  setTimeout(() => {
    b.reapSync();
    setTimeout(() => { console.log([S.groupAlive(mine.pid), S.groupAlive(foreign.pid)].join(",")); foreign.kill("SIGKILL"); process.exit(0); }, 300);
  }, 300);' "$INTENT_LIB" 2>&1)"
if [[ "$c9" == "false,true" ]]; then ok "C9 tracked without a start token: our own unexited child is still reaped; a pid with neither token nor child handle is left alone [FR-027, Samuel s2]"
else bad "C9 tracked without a start token: our own unexited child is still reaped; a pid with neither token nor child handle is left alone [FR-027, Samuel s2]" "$c9"; fi

# ---------- C10: one note, one applier (Samuel r1, Reinhard r1) ----------
# Another process holds the note's apply claim (<id>.applying, fresh): this tick must not verify-and-apply it too.
w8_empty_queue
w8_mk action=progress @nosign; c10_t="$W8_ID"
w8_tick
w8_approve "$c10_t" "$I/rejected/$c10_t.md"; c10_a="$W8_ID"; run_intent claim "$W8_F"
mkdir -p "$FHOME/.a1-intents/runs"; chmod 700 "$FHOME/.a1-intents/runs"
: >"$FHOME/.a1-intents/runs/$c10_a.applying"; chmod 600 "$FHOME/.a1-intents/runs/$c10_a.applying"
w8_tick
c10_busy="$(w6_where "$c10_a") $(w6_where "$c10_t") $(grep "\"intent_id\":\"$c10_a\"" "$FHOME/.a1-intents/log.jsonl" | grep -c 'being applied by another process')"
node -e 'const fs = require("fs"); const t = (Date.now() - 3600 * 1000) / 1000; fs.utimesSync(process.argv[1], t, t)' "$FHOME/.a1-intents/runs/$c10_a.applying"
w8_tick
c10="$c10_busy $(w6_where "$c10_a") $(w6_where "$c10_t") $(ls "$FHOME/.a1-intents/runs/" | grep -c "^$c10_a\.appl")"
if [[ "$c10" == "claimed rejected 1 done queued 0" ]]; then
  ok "C10 a fresh apply claim of another process on a verified note -> this tick skips it (logged), the target untouched; once that claim is an hour old (a crashed apply) the next tick takes it over, applies and finishes, no marker left [FR-032, Samuel r1, Reinhard r1]"
else bad "C10 a fresh apply claim of another process on a verified note -> this tick skips it (logged), the target untouched; once that claim is an hour old (a crashed apply) the next tick takes it over, applies and finishes, no marker left [FR-032, Samuel r1, Reinhard r1]" "$c10"; fi
rm -f "${Q:?}"/*.md "${I:?}"/rejected/*.md

# ---------- C11: a busy ledger right after the effect cannot drop the applied state (Samuel r1, Reinhard r1) ----------
w8_empty_queue
w8_mk action=progress @nosign; c11_t="$W8_ID"
w8_tick
w8_approve "$c11_t" "$I/rejected/$c11_t.md"; c11_a="$W8_ID"; run_intent claim "$W8_F"
w8_tick_lib busy-after-effect
rm -f "${FHOME:?}/.a1-intents/ledger.lock"
c11_first="$(grep -c '"event":"busy-after-effect"' "$SB/.spy") $(w6_where "$c11_a") $(w6_where "$c11_t") $( [[ -e "$FHOME/.a1-intents/runs/$c11_a.applied" ]] && echo applied)"
mv "$Q/$c11_t.md" "$SB/c11.requeued" # out of the next pass
w8_tick
c11="$c11_first $(w6_where "$c11_a") $(w8_fm "$I/done/$c11_a.md" status)"
if [[ "$c11" == "1 claimed queued applied done done" ]]; then
  ok "C11 the ledger lock is held right after the effect -> the applied state is still recorded (the .applied marker needs no lock), the finish is refused; the next tick only finishes the note (done/, not re-applied) [FR-032, Samuel r1, Reinhard r1]"
else bad "C11 the ledger lock is held right after the effect -> the applied state is still recorded (the .applied marker needs no lock), the finish is refused; the next tick only finishes the note (done/, not re-applied) [FR-032, Samuel r1, Reinhard r1]" "$c11" "tl: ${TL:0:300}"; fi
rm -f "${SB:?}/c11.requeued" "${I:?}"/rejected/*.md

# ---------- C12: only a regular .applied holding the note's sha256 counts (Samuel W8 m1) ----------
w8_empty_queue
w8_mk action=progress @nosign; c12_t="$W8_ID"
w8_mk action=progress @nosign; c12_t2="$W8_ID"
w8_tick
w8_approve "$c12_t" "$I/rejected/$c12_t.md"; c12_a="$W8_ID"; run_intent claim "$W8_F"
w8_approve "$c12_t2" "$I/rejected/$c12_t2.md"; c12_b="$W8_ID"; run_intent claim "$W8_F"
mkdir -p "$FHOME/.a1-intents/runs"; chmod 700 "$FHOME/.a1-intents/runs"
sha256_of "$(w8b_claimed "$c12_a")" >"$SB/c12.sha"
ln -s "$SB/c12.sha" "$FHOME/.a1-intents/runs/$c12_a.applied" # a link to the right content
printf 'planted' >"$FHOME/.a1-intents/runs/$c12_b.applied"; chmod 600 "$FHOME/.a1-intents/runs/$c12_b.applied" # a file with the wrong content
w8_tick
c12="$(w6_where "$c12_t") $(w6_where "$c12_a") $(w6_where "$c12_t2") $(w6_where "$c12_b") $(ls "$FHOME/.a1-intents/runs/" | grep -c "^$c12_a\.\|^$c12_b\.")"
if [[ "$c12" == "queued done queued done 0" ]]; then
  ok "C12 an .applied marker that is a symbolic link (even to the right sha256) or a file with other content does not count: both approves are applied for real (targets re-queued) and finished, no marker left [FR-032, Samuel W8 m1]"
else bad "C12 an .applied marker that is a symbolic link (even to the right sha256) or a file with other content does not count: both approves are applied for real (targets re-queued) and finished, no marker left [FR-032, Samuel W8 m1]" "$c12"; fi
rm -f "${Q:?}"/*.md "${I:?}"/rejected/*.md

# ---------- C13: a takeover whose effect finds no target says so (Samuel W8 m2) ----------
w8_empty_queue
w8_mk action=progress; c13_b="$W8_ID"; run_intent claim "$W8_F"
w8_mk action=cancel target="$c13_b"; c13_x="$W8_ID"; run_intent claim "$W8_F"
mv "$I/claimed/$c13_b.md" "$SB/c13.target" # the crashed applier got as far as moving the target away
: >"$FHOME/.a1-intents/runs/$c13_x.applying"; chmod 600 "$FHOME/.a1-intents/runs/$c13_x.applying"
node -e 'const fs = require("fs"); const t = (Date.now() - 3600 * 1000) / 1000; fs.utimesSync(process.argv[1], t, t)' "$FHOME/.a1-intents/runs/$c13_x.applying"
w8_tick
c13="$(w6_where "$c13_x") $(w8_fm "$I/rejected/$c13_x.md" rejected_reason) $(grep "\"intent_id\":\"$c13_x\"" "$FHOME/.a1-intents/log.jsonl" | grep -c 'effect_may_have_applied')"
if [[ "$c13" == "rejected target_not_found 1" ]]; then
  ok "C13 a cancel whose apply claim is taken over after a crash and whose target is gone -> rejected target_not_found, logged effect_may_have_applied (the crashed applier may have acted) [FR-032, Samuel W8 m2]"
else bad "C13 a cancel whose apply claim is taken over after a crash and whose target is gone -> rejected target_not_found, logged effect_may_have_applied (the crashed applier may have acted) [FR-032, Samuel W8 m2]" "$c13"; fi
rm -f "${SB:?}/c13.target"

# ---------- C14: the claim taken over before markApplied -> logged, no error (Samuel W8 m3) ----------
w8_empty_queue
w8_mk action=progress @nosign; c14_t="$W8_ID"
w8_tick
w8_approve "$c14_t" "$I/rejected/$c14_t.md"; c14_a="$W8_ID"; run_intent claim "$W8_F"
w8_tick_lib steal-claim
c14="$(w6_js 'o.exitCode' "$TL") $(grep -c '"event":"steal-claim"' "$SB/.spy") $(w6_where "$c14_a") $(w6_where "$c14_t") $(grep "\"intent_id\":\"$c14_a\"" "$FHOME/.a1-intents/log.jsonl" | grep -c 'taken over by another process')"
if [[ "$c14" == "0 1 claimed queued 1" ]]; then
  ok "C14 another process takes the apply claim over between the effect and markApplied -> tick exits 0, logs 'taken over by another process', leaves the finish to it [FR-032, Samuel W8 m3]"
else bad "C14 another process takes the apply claim over between the effect and markApplied -> tick exits 0, logs 'taken over by another process', leaves the finish to it [FR-032, Samuel W8 m3]" "$c14" "tl: ${TL:0:300}"; fi
rm -f "${Q:?}"/*.md "${I:?}"/rejected/*.md

chmod -R u+w "$WORK"
