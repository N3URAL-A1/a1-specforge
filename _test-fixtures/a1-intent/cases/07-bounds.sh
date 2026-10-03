#!/usr/bin/env bash
# cases/07-bounds.sh — spec 011 Wave 7: global lock, hourly cap, timeout with
# process-group kill, expiry, never rerun, cancel transition, executor steps
# outside the child, orphaned executor lock; plus the carried items (stop
# signal before the running rewrite, kill-grace before the locks go, a
# throwing rollback never masks the original error). Sourced after
# 06b-review.sh; reuses 06-run.sh's w6_* and 05b's helpers.
#
# The hang stub's process tree is UNMEASURED as a model of the real claude
# (probe-7.sh asks Robert); what these cases measure is a1's own kill
# sequence on the child's process group.
#
# RED proof: every case is red against 7889d5d (the code before Wave 7)
# except those named control or pin; the single production change that turns
# each case red is in the mutation table (scratchpad), measured on copies.

W7_ID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
w7_now() { node -e 'process.stdout.write(String(Date.now()))'; }
w7_alive() { kill -0 "$1" 2>/dev/null && echo alive || echo gone; }

# w7_bg <file> <tag> — `intent run` in the background; RC and output go to
# $SB/.bg-<tag>.{rc,out}. W7_BG_PID is the node process.
w7_bg() {
  ( HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent run "$1" >"$SB/.bg-$2.out" 2>"$SB/.bg-$2.err"
    echo $? >"$SB/.bg-$2.rc" ) &
  W7_BG_PID=$!
}

# w7_steps <mode> [file] — stub/run-steps.cjs; RS = its JSON, spy in $SB/.spy
w7_steps() {
  : >"$SB/.spy"
  RS="$(HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" node "$STUB_DIR/run-steps.cjs" "$INTENT_LIB" "$FHOME" "${2:-$W6_FILE}" "$1" "$SB/.spy" 2>"$SB/.rs-err")"
  RS_RC=$?
  W6_SPAWNS="$( [[ -f "$W6_STUB/invocations.log" ]] && grep -c . "$W6_STUB/invocations.log" || echo 0)"
}

# w7_rows <ages-in-seconds...> — the ledger holds exactly these extra rows
# (started_at = now - age), plus every row already there.
w7_rows() {
  node - "$FHOME/.a1-intents-ledger.json" "$@" <<'JS'
const fs = require('fs'); const crypto = require('crypto');
const [ledger, ...ages] = process.argv.slice(2);
const d = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : { rows: [] };
const now = Date.now();
for (const a of ages) {
  const at = new Date(now - Number(a) * 1000).toISOString();
  const claimed = new Date(now - Number(a) * 1000 - 7200000).toISOString(); // claimed 2 h before it started: the cap counts started_at
  d.rows.push({ id: crypto.randomUUID(), device: 'pixel-robert', nonce: crypto.randomBytes(16).toString('hex'), action: 'progress', project: 'real-proj',
    claimed_at: claimed, claimed_sha256: '0'.repeat(64), started_at: at, finished_at: at, outcome: 'done', result_path: null, result_sha256: null });
}
fs.writeFileSync(ledger, JSON.stringify(d)); fs.chmodSync(ledger, 0o600);
JS
}
w7_drop_fixture_rows() { # removes the rows w7_rows added (outcome done, sha 0…)
  node -e 'const fs = require("fs"); const f = process.argv[1]; const d = JSON.parse(fs.readFileSync(f, "utf8"));
    d.rows = d.rows.filter((r) => r.claimed_sha256 !== "0".repeat(64)); fs.writeFileSync(f, JSON.stringify(d)); fs.chmodSync(f, 0o600);' "$FHOME/.a1-intents-ledger.json"
}
w7_row() { node -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const r = d.rows.find((x) => x.id === process.argv[2]); console.log(r ? eval(process.argv[3]) : "<no row>")' "$FHOME/.a1-intents-ledger.json" "$1" "$2"; }
w7_locks() { ls "$FHOME/.a1-intents/executor.lock" "$FHOME/.a1-intents/locks/"*.lock 2>/dev/null | wc -l | tr -d ' '; }

w6_sandbox w7-main
w6_project proj-b

# ---------- B1/B2: one child on the host ----------
w6_claim action=progress
b1_a="$W6_FILE"; b1_a_id="$W6_ID"
w6_claim action=progress project=proj-b
b1_b="$W6_FILE"; b1_b_id="$W6_ID"
stub_mode slow
w7_bg "$b1_a" a
w7_bg "$b1_b" b
b1_lock=""
for _ in $(seq 1 40); do
  [[ -z "$b1_lock" && -f "$FHOME/.a1-intents/executor.lock" ]] && b1_lock="$(node -e 'try { console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))).join(",")); } catch (e) {}' "$FHOME/.a1-intents/executor.lock")"
  [[ -f "$SB/.bg-a.rc" && -f "$SB/.bg-b.rc" ]] && break
  sleep 0.1
done
wait
stub_mode ok
b1_rcs="$(cat "$SB/.bg-a.rc") $(cat "$SB/.bg-b.rc")"
b1_spawns="$(grep -c . "$W6_STUB/invocations.log" 2>/dev/null || echo 0)"
if [[ "$b1_rcs" == "0 1" ]]; then b1_loser="$b1_b_id"; b1_lout="$SB/.bg-b.out"; else b1_loser="$b1_a_id"; b1_lout="$SB/.bg-a.out"; fi
if [[ ( "$b1_rcs" == "0 1" || "$b1_rcs" == "1 0" ) && "$b1_spawns" -eq 1 && "$(cat "$b1_lout")" == *executor_busy* && "$(w6_where "$b1_loser")" == claimed \
    && "$b1_lock" == "pid,hostname,createdAt,intent_id,action,project,vault_root,anchor" ]]; then
  ok "B1 two runs for two projects at once: exactly one spawns, the other exits 1 executor_busy and stays in claimed/; the lock carries the 8 context keys [FR-025]"
else bad "B1 two runs for two projects at once: exactly one spawns, the other exits 1 executor_busy and stays in claimed/; the lock carries the 8 context keys [FR-025]" "rcs $b1_rcs spawns $b1_spawns lock '$b1_lock'" "loser out: $(head -c 200 "$b1_lout")"; fi
rm -rf "$W6_STUB"
w6_run "$VAULT/inbox/intents/claimed/$b1_loser.md"
if [[ "$RC" -eq 0 && "$(w6_where "$b1_loser")" == done && ! -e "$FHOME/.a1-intents/executor.lock" ]]; then ok "B2 after the winner finished, the loser runs; no executor.lock left [FR-025]"
else bad "B2 after the winner finished, the loser runs; no executor.lock left [FR-025]" "rc $RC where $(w6_where "$b1_loser")"; fi

# ---------- B3: hourly cap boundary ----------
w6_claim action=progress # ages the finished rows of B1/B2 first; the six rows below are all the window holds
w7_rows 3599 3599 3599 3599 3599 3599
w6_run
b3a="$RC $(w6_where "$W6_ID") $W6_SPAWNS $(w6_js 'o.outcome + " " + o.reason' "$(w6_log_last run)")"
w7_drop_fixture_rows
w7_rows 3599 3599 3599 3599 3599 3601
w6_run
b3b="$RC $(w6_where "$W6_ID") $W6_SPAWNS"
w7_drop_fixture_rows
if [[ "$b3a" == "1 claimed 0 refused rate_limited" && "$b3b" == "0 done 1" ]]; then
  ok "B3 six runs started within 3599 s -> rate_limited, stays claimed, 0 spawns, logged; with the sixth at 3601 s it runs [FR-026]"
else bad "B3 six runs started within 3599 s -> rate_limited, stays claimed, 0 spawns, logged; with the sixth at 3601 s it runs [FR-026]" "cap: $b3a" "boundary: $b3b"; fi

# ---------- B4/B5: timeout with the process-group kill ----------
w6_claim action=progress
stub_mode hang
b4_t0="$(w7_now)"
A1_INTENT_TIMEOUT_MS=2000 A1_INTENT_KILL_GRACE_MS=500 w6_run
b4_ms=$(( $(w7_now) - b4_t0 ))
stub_mode ok
b4_stub="$(cat "$W6_STUB/stub.pid" 2>/dev/null)"; b4_gc="$(cat "$W6_STUB/grandchild.pid" 2>/dev/null)"
b4_log="$(grep "\"intent_id\":\"$W6_ID\"" "$FHOME/.a1-intents/log.jsonl" | grep -o '"detail":"kill [A-Z]* -[0-9]*"' | tr '\n' ' ')"
b4="$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" status) $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(w7_alive "${b4_stub:-0}") $(w7_alive "${b4_gc:-0}")"
if [[ -n "$b4_stub" && -n "$b4_gc" && "$b4" == "failed timeout gone gone" && "$b4_ms" -lt 5000 && "$b4_log" == *"kill SIGTERM -$b4_stub"*"kill SIGKILL -$b4_stub"* ]]; then
  ok "B4 a child that traps SIGTERM and forks a grandchild, timeout 2000 ms, grace 500 ms -> both gone, failed timeout, log SIGTERM then SIGKILL to -pid [FR-027]"
else bad "B4 a child that traps SIGTERM and forks a grandchild, timeout 2000 ms, grace 500 ms -> both gone, failed timeout, log SIGTERM then SIGKILL to -pid [FR-027]" "$b4 in ${b4_ms} ms" "log: $b4_log"; fi
w6_claim action=progress
stub_mode hang
A1_INTENT_TIMEOUT_MS=1000 A1_INTENT_KILL_GRACE_MS=500 w7_steps killspy
stub_mode ok
b5="$(node -e '
  const ev = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.event === "kill");
  const ok = ev.length === 2 && ev[0].sig === "SIGTERM" && ev[1].sig === "SIGKILL" && ev[0].target === ev[1].target && ev[0].target < 0 && ev[1].ms - ev[0].ms >= 500;
  console.log(ok ? "ok" : JSON.stringify(ev));' "$SB/.spy" 2>&1)"
if [[ "$b5" == ok ]]; then ok "B5 the injected kill sees [-pid, SIGTERM] then [-pid, SIGKILL], the second at least the grace (500 ms) later [FR-027]"
else bad "B5 the injected kill sees [-pid, SIGTERM] then [-pid, SIGKILL], the second at least the grace (500 ms) later [FR-027]" "$b5"; fi

# ---------- B6/B7: expiry, never rerun ----------
w7_claimed_at() { node -e 'const fs = require("fs"); const [f, id, age] = process.argv.slice(1); const d = JSON.parse(fs.readFileSync(f, "utf8"));
  d.rows = d.rows.map((r) => (r.id === id ? { ...r, claimed_at: new Date(Date.now() - Number(age) * 1000).toISOString() } : r)); fs.writeFileSync(f, JSON.stringify(d)); fs.chmodSync(f, 0o600);' \
  "$FHOME/.a1-intents-ledger.json" "$1" "$2"; }
w6_claim action=progress
w7_claimed_at "$W6_ID" 25200
w6_run
b6a="$RC $(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $W6_SPAWNS"
w6_claim action=progress
w7_claimed_at "$W6_ID" 18000
w6_run
b6b="$RC $(w6_where "$W6_ID") $W6_SPAWNS"
if [[ "$b6a" == "1 done expired 0" && "$b6b" == "0 done 1" ]]; then
  ok "B6 claimed 7 h ago -> failed expired, never spawned; claimed 5 h ago -> runs [FR-028]"
else bad "B6 claimed 7 h ago -> failed expired, never spawned; claimed 5 h ago -> runs [FR-028]" "7 h: $b6a" "5 h: $b6b"; fi
# B6c: 20 minutes after the claim (past the 15-min freshness of created_at),
# run re-validates the signature but not the freshness: it runs.
w6_claim action=progress
w7_steps late
b6c="$(w6_js 'o.exitCode' "$RS") $(w6_where "$W6_ID") $W6_SPAWNS"
if [[ "$b6c" == "0 done 1" ]]; then ok "B6c run 20 minutes after the claim (created_at past the freshness window) -> runs; freshness is judged at claim time, expiry after [FR-020, FR-028]"
else bad "B6c run 20 minutes after the claim (created_at past the freshness window) -> runs; freshness is judged at claim time, expiry after [FR-020, FR-028]" "$b6c ${RS:0:200}"; fi
b7_file="$VAULT/inbox/intents/done/$W6_ID.md"
cp "$b7_file" "$SB/b7.before"
rm -rf "$W6_STUB"
w6_run "$b7_file"
if [[ "$RC" -eq 2 && "$W6_SPAWNS" -eq 0 ]] && cmp -s "$SB/b7.before" "$b7_file"; then ok "B7 pin: run on a done/ path -> exit 2, 0 spawns, the file unchanged [FR-028]"
else bad "B7 pin: run on a done/ path -> exit 2, 0 spawns, the file unchanged [FR-028]" "rc $RC spawns $W6_SPAWNS"; fi

# ---------- B8: a vanished queued file ----------
b8_q="$(mk_intent action=progress)"
rm -f "$b8_q"
run_intent claim "$b8_q"
if [[ "$RC" -eq 0 && "$(w6_js 'o.outcome' "$(w6_log_last claim)")" == vanished && "$ERR" != *"internal error"* ]]; then ok "B8 a queued file that vanished before claim -> exit 0, log outcome vanished, nothing thrown [FR-028]"
else bad "B8 a queued file that vanished before claim -> exit 0, log outcome vanished, nothing thrown [FR-028]" "rc $RC out ${OUT:0:200} err ${ERR:0:200}"; fi

# ---------- B10: the cancel transition ----------
w6_claim action=progress
b10_cancel="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
run_intent reject "$W6_FILE" --reason cancelled_by_user --cancelled-by "$b10_cancel"
b10_rej="$VAULT/inbox/intents/rejected/$W6_ID.md"
b10a="$RC $(w6_fm "$b10_rej" rejected_reason) $( [[ -n "$(w6_fm "$b10_rej" rejected_by)" ]] && echo by) $(w6_fm "$b10_rej" cancelled_by_intent) $( [[ -e "$VAULT/project/real-proj/intents/$W6_ID.md" ]] && echo note)"
w6_claim action=progress
run_intent reject "$W6_FILE" --reason cancelled_by_user --cancelled-by not-a-uuid
b10b="$RC $(w6_where "$W6_ID")"
run_intent reject "$W6_FILE" --reason tampered --cancelled-by "$b10_cancel"
b10c="$RC $(w6_where "$W6_ID")"
if [[ "$b10a" == "0 cancelled_by_user by $b10_cancel " && "$b10b" == "2 claimed" && "$b10c" == "2 claimed" ]]; then
  ok "B10 reject --reason cancelled_by_user --cancelled-by <uuid> -> rejected/ with rejected_by and cancelled_by_intent, no result note; a non-uuid or another reason with --cancelled-by -> exit 2, nothing moved [FR-028]"
else bad "B10 reject --reason cancelled_by_user --cancelled-by <uuid> -> rejected/ with rejected_by and cancelled_by_intent, no result note; a non-uuid or another reason with --cancelled-by -> exit 2, nothing moved [FR-028]" "ok: $b10a" "non-uuid: $b10b other reason: $b10c"; fi

# ---------- B11: a sandbox failure releases both locks and does not count ----------
w6_sandbox w7-b11
W6_KEEP_RUNS=1
b11_file="$(find "$W6_SEAL/skills" -name SKILL.md | head -1)"
chmod u+w "$(dirname "$b11_file")" "$b11_file"; printf 'X' >>"$b11_file"; chmod a-w "$b11_file" "$(dirname "$b11_file")"
b11_bad=""
for i in 1 2 3 4 5 6; do
  w6_claim action=progress
  w6_run
  [[ "$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(w7_locks) $(w7_row "$W6_ID" 'String(r.started_at)')" == "sandbox_invalid 0 null" ]] || b11_bad="$b11_bad | run $i: $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) locks $(w7_locks)"
done
chmod -R u+w "$FHOME/.a1-intents-seal"; rm -rf "$FHOME/.a1-intents-seal"
node "$STUB_DIR/seal-lib.cjs" "$INTENT_LIB" "$FHOME" "$W5B_HOST" >/dev/null 2>&1
W6_SEAL="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).seal_dir)' "$FHOME/.a1-intents-seal/manifest.json")"; W6_T="$W6_SEAL/_shared/a1-tools.cjs"
w6_claim action=progress
w6_run
unset W6_KEEP_RUNS
if [[ -z "$b11_bad" && "$RC" -eq 0 && "$W6_SPAWNS" -eq 1 ]]; then
  ok "B11 six runs on a tampered seal end sandbox_invalid, each with both locks gone and no started_at; after a re-seal the seventh runs (not rate_limited) [FR-025, FR-026]"
else bad "B11 six runs on a tampered seal end sandbox_invalid, each with both locks gone and no started_at; after a re-seal the seventh runs (not rate_limited) [FR-025, FR-026]" "${b11_bad:0:300}" "seventh: rc $RC spawns $W6_SPAWNS ${OUT:0:120}"; fi

# ---------- B12: executor_busy before any precondition ----------
w6_claim action=plan target=M2-P1-x
sleep 30 & b12_live=$! # a live holder that is no ancestor of run (an ancestor's lock would put run itself in child mode)
printf '{"pid":%s,"hostname":"%s","createdAt":"%s","intent_id":"3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b","action":"progress","project":"proj-x","vault_root":"/nowhere","anchor":"/nowhere"}' "$b12_live" "$W5B_HOST" "$(node -e 'process.stdout.write(new Date().toISOString())')" >"$FHOME/.a1-intents/executor.lock"
chmod 600 "$FHOME/.a1-intents/executor.lock"
w6_run
b12a="$RC $(w6_where "$W6_ID") $( [[ "$OUT" == *executor_busy* ]] && echo busy) $( [[ -e "$FHOME/claude-projects/a1-worktrees/real-proj-intent-$W6_ID" ]] && echo worktree) $( [[ "$(w6_reg_entry "$W6_ID" '"entry"')" == entry ]] && echo entry)"
rm -f "$FHOME/.a1-intents/executor.lock"
kill "$b12_live" 2>/dev/null; wait "$b12_live" 2>/dev/null
w6_run
b12b="$RC $(w6_where "$W6_ID")"
if [[ "$b12a" == "1 claimed busy  " && "$b12b" == "0 done" ]]; then
  ok "B12 a write intent while another run holds executor.lock -> executor_busy before any worktree or check, stays in claimed/; after release it runs [FR-025]"
else bad "B12 a write intent while another run holds executor.lock -> executor_busy before any worktree or check, stays in claimed/; after release it runs [FR-025]" "busy: $b12a" "after: $b12b"; fi

# ---------- B9: SC-004 burst ----------
w6_sandbox w7-b9
stub_mode slow
b9_files=()
for i in $(seq 1 50); do
  q="$(mk_intent action=progress)"
  run_intent claim "$q"
  b9_files+=("$VAULT/inbox/intents/claimed/$(basename "$q")")
done
# review m3: count distinct stub instances, not the stub's own subshells (a
# pid whose parent is itself a stub process is that stub's subshell)
b9_alive() { local pids p n=0; pids=" $(pgrep -f "$STUB_DIR/claude" | tr '\n' ' ') "
  for p in $pids; do [[ "$pids" == *" $(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ') "* ]] || n=$((n + 1)); done; echo "$n"; }
( max=0; for _ in $(seq 1 200); do n="$(b9_alive)"; [[ "$n" -gt "$max" ]] && max="$n"; echo "$max" >"$SB/b9.max"; sleep 0.05; done ) &
b9_sampler=$!
for batch in 0 10 20 30 40; do
  for f in "${b9_files[@]:$batch:10}"; do
    ( HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" A1_INTENT_MAX_RUNS_PER_HOUR=3 node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent run "$f" >/dev/null 2>&1 ) &
  done
  wait $(jobs -p | grep -v "^$b9_sampler$") 2>/dev/null
done
kill "$b9_sampler" 2>/dev/null; wait "$b9_sampler" 2>/dev/null
stub_mode ok
b9_spawns="$(grep -c . "$W6_STUB/invocations.log" 2>/dev/null || echo 0)"
b9_claimed="$(ls "$VAULT/inbox/intents/claimed" | wc -l | tr -d ' ')"; b9_rej="$(ls "$VAULT/inbox/intents/rejected" | wc -l | tr -d ' ')"
if [[ "$b9_spawns" -eq 3 && "$(cat "$SB/b9.max")" -le 1 && "$b9_claimed" -eq 47 && "$b9_rej" -eq 0 ]]; then
  ok "B9 50 valid intents, cap 3, runs in bursts of 10 -> exactly 3 stub invocations, never more than 1 alive, 47 left in claimed/, 0 rejected [FR-026, SC-004]"
else bad "B9 50 valid intents, cap 3, runs in bursts of 10 -> exactly 3 stub invocations, never more than 1 alive, 47 left in claimed/, 0 rejected [FR-026, SC-004]" "spawns $b9_spawns max-alive $(cat "$SB/b9.max") claimed $b9_claimed rejected $b9_rej"; fi

# ---------- B18: the failure catalog ----------
b18="$(node -e 'const s = require(process.argv[1] + "/status-constants.cjs"); const want = ["timeout", "expired", "spawn_error", "nonzero_exit", "cancelled", "sandbox_invalid", "parent_step_failed"];
  console.log(s.INTENT_FAILURE_REASONS.size === 7 && want.every((x) => s.INTENT_FAILURE_REASONS.has(x)));' "$INTENT_LIB" 2>&1)"
if [[ "$b18" == true ]]; then ok "B18 pin: INTENT_FAILURE_REASONS is the frozen 7-name list incl. parent_step_failed [FR-051]"
else bad "B18 pin: INTENT_FAILURE_REASONS is the frozen 7-name list incl. parent_step_failed [FR-051]" "$b18"; fi

# ---------- B13/B14: the integrity pre-step (fix) ----------
w6_claim action=fix
w7_steps integrity-fail
b13="$(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $W6_SPAWNS $(w7_row "$W6_ID" 'String(r.started_at)') $(w7_locks) $(w6_js 'o.detail' "$(w6_log_last run)")"
if [[ "$b13" == "done parent_step_failed 0 null 0 integrity_check" ]]; then
  ok "B13 a failing integrity check on a fix intent -> failed parent_step_failed (integrity_check), 0 spawns, no started_at, both locks gone [FR-051]"
else bad "B13 a failing integrity check on a fix intent -> failed parent_step_failed (integrity_check), 0 spawns, no started_at, both locks gone [FR-051]" "$b13" "rs: ${RS:0:200}"; fi
w6_claim action=fix
w7_steps integrity-ok
b14="$(node -e '
  const [spy, log, id] = process.argv.slice(1); const fs = require("fs");
  const ev = fs.readFileSync(spy, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const driver = ev.find((e) => e.event === "driver").pid; const check = ev.find((e) => e.event === "integrity");
  const lines = fs.readFileSync(log, "utf8").split("\n").filter((l) => l.includes(`"intent_id":"${id}"`) && l.includes("\"command\":\"run\""));
  const iStep = lines.findIndex((l) => l.includes("integrity_check")); const iSpawn = lines.findIndex((l) => l.includes("\"outcome\":\"spawned\""));
  console.log([check && check.pid === driver, iStep >= 0 && iSpawn > iStep].join(" "));' "$SB/.spy" "$FHOME/.a1-intents/log.jsonl" "$W6_ID" 2>&1)"
if [[ "$b14" == "true true" && "$W6_SPAWNS" -eq 1 ]]; then ok "B14 a passing integrity check runs in the run process itself (same pid) and its log line precedes the spawn line [FR-051]"
else bad "B14 a passing integrity check runs in the run process itself (same pid) and its log line precedes the spawn line [FR-051]" "$b14 spawns $W6_SPAWNS"; fi

# ---------- B15: the xprov post-step (injected gate) ----------
w6_claim action=plan target=M2-P1-x
w7_steps gate-fail
b15a="$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(grep -c '"event":"gate"' "$SB/.spy") $(w6_js 'o.detail' "$(grep "\"intent_id\":\"$W6_ID\"" "$FHOME/.a1-intents/log.jsonl" | grep '"command":"run"' | grep parent_step_failed | tail -1)")"
w6_claim action=plan target=M2-P1-x
stub_mode fail
w7_steps gate-fail
stub_mode ok
b15b="$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(grep -c '"event":"gate"' "$SB/.spy")"
if [[ "$b15a" == "parent_step_failed 1 xprov_gate" && "$b15b" == "nonzero_exit 0" ]]; then
  ok "B15 plan: child exit 0 + failing gate -> parent_step_failed (xprov_gate); child exit 3 -> nonzero_exit and the gate is not called [FR-051]"
else bad "B15 plan: child exit 0 + failing gate -> parent_step_failed (xprov_gate); child exit 3 -> nonzero_exit and the gate is not called [FR-051]" "exit 0: $b15a" "exit 3: $b15b"; fi

# ---------- B16: the postmortem post-step (fix) ----------
b16_script() { printf 'mkdir -p "$A1_VAULT_ROOT/project/real-proj/fixes"\nprintf -- "---\\ntitle: Crash\\nstatus: fixed\\n---\\n# Crash\\n" >"$A1_VAULT_ROOT/project/real-proj/fixes/2026-09-29-crash-on-start%s.md"\n' "$1" >"$FHOME/.a1-intents/tmp/stub-script"; }
w6_claim action=fix
b16_script ""
stub_mode script
w6_run
b16a="$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" status) $( [[ -f "$VAULT/project/real-proj/postmortems/2026-09-29-crash-on-start.md" ]] && echo postmortem)"
w6_claim action=fix
b16_script "-two"
stub_mode script-fail
w6_run
b16b="$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $( [[ -f "$VAULT/project/real-proj/postmortems/2026-09-29-crash-on-start-two.md" ]] && echo postmortem)"
w6_claim action=fix
stub_mode ok
w6_run
b16c="$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" status) $(grep "\"intent_id\":\"$W6_ID\"" "$FHOME/.a1-intents/log.jsonl" | grep -c postmortem_skipped)"
if [[ "$b16a" == "done postmortem" && "$b16b" == "nonzero_exit postmortem" && "$b16c" == "done 1" ]]; then
  ok "B16 fix: a bug report under project/<slug>/fixes/ -> run writes the postmortem, also when the child exits 3 (reason stays nonzero_exit); no bug report -> postmortem_skipped [FR-051]"
else bad "B16 fix: a bug report under project/<slug>/fixes/ -> run writes the postmortem, also when the child exits 3 (reason stays nonzero_exit); no bug report -> postmortem_skipped [FR-051]" "exit 0: $b16a" "exit 3: $b16b" "none: $b16c"; fi

# ---------- B17: a post-step inside the timeout budget ----------
w6_claim action=plan target=M2-P1-x
b17_t0="$(w7_now)"
A1_INTENT_TIMEOUT_MS=2000 A1_INTENT_KILL_GRACE_MS=500 w7_steps gate-hang
b17_ms=$(( $(w7_now) - b17_t0 ))
b17_pid="$(node -e 'const ev = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === "gate"); console.log(ev ? ev.pid : 0)' "$SB/.spy")"
b17="$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(w7_alive "$b17_pid")"
if [[ "$b17" == "timeout gone" && "$b17_ms" -lt 4500 ]]; then ok "B17 a gate that hangs past the budget (2000 ms, grace 500) -> failed timeout, the gate's process gone [FR-051, FR-027]"
else bad "B17 a gate that hangs past the budget (2000 ms, grace 500) -> failed timeout, the gate's process gone [FR-051, FR-027]" "$b17 in ${b17_ms} ms"; fi

# ---------- B19: orphaned executor lock ----------
w7_exlock() { # <json|empty> [age-seconds]
  local f="$FHOME/.a1-intents/executor.lock"
  rm -f "$f"
  if [[ "$1" == empty ]]; then : >"$f"; else printf '%s' "$1" >"$f"; fi
  chmod 600 "$f"
  [[ -n "${2:-}" ]] && node -e 'const fs = require("fs"); const t = (Date.now() - Number(process.argv[2]) * 1000) / 1000; fs.utimesSync(process.argv[1], t, t)' "$f" "$2"
  return 0
}
w7_ctxlock() { # <pid> <host> [intent-id] — a well-formed child-context lock
  printf '{"pid":%s,"hostname":"%s","createdAt":"%s","intent_id":"%s","action":"progress","project":"real-proj","vault_root":"%s","anchor":"%s"}' \
    "$1" "$2" "${W7_LOCK_AT:-$(node -e 'process.stdout.write(new Date().toISOString())')}" "${3:-3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b}" "$(node -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$VAULT")" "$W6_PRIMARY"
}
# w7_record <intent-id> <pid> [js-patch] — runs/<id>/child.json as a run
# writes it (the production recordChild: pgid, the leader's start, the boot);
# js-patch edits the parsed doc `o` before it is written back
w7_record() {
  mkdir -p "$FHOME/.a1-intents/runs/$1"; chmod 700 "$FHOME/.a1-intents/runs" "$FHOME/.a1-intents/runs/$1"
  rm -f "$FHOME/.a1-intents/runs/$1/child.json"
  node -e 'const [lib, dir, pid, patch] = process.argv.slice(1); const fs = require("fs"); const f = dir + "/child.json";
    require(lib + "/intent-spawn.cjs").recordChild(dir, Number(pid));
    if (patch) { const o = JSON.parse(fs.readFileSync(f, "utf8")); eval(patch); fs.writeFileSync(f, JSON.stringify(o)); }' \
    "$INTENT_LIB" "$FHOME/.a1-intents/runs/$1" "$2" "${3:-}"
}
sleep 0 & b19_dead=$!
wait "$b19_dead"
b19_bad=""
b19_try() { # <label> <want: runs|busy>
  cp "$FHOME/.a1-intents/executor.lock" "$SB/b19.before" 2>/dev/null
  w6_claim action=progress
  w6_run
  if [[ "$2" == runs ]]; then [[ "$RC" -eq 0 && "$W6_SPAWNS" -eq 1 ]] || b19_bad="$b19_bad | $1: rc $RC spawns $W6_SPAWNS ${OUT:0:120}"
  else [[ "$RC" -eq 1 && "$OUT" == *executor_busy* && "$W6_SPAWNS" -eq 0 ]] && cmp -s "$SB/b19.before" "$FHOME/.a1-intents/executor.lock" || b19_bad="$b19_bad | $1: rc $RC ${OUT:0:120}"; fi
}
w7_exlock empty 60;                                        b19_try "empty, 60 s old" runs
w7_exlock "$(w7_ctxlock "$b19_dead" "$W5B_HOST")";         b19_try "dead pid, this host" runs
sleep 30 & b19_live=$! # alive, and no ancestor of run
w7_exlock "$(w7_ctxlock "$b19_live" "$W5B_HOST")";         b19_try "live pid" busy
kill "$b19_live" 2>/dev/null; wait "$b19_live" 2>/dev/null
w7_exlock "$(w7_ctxlock "$b19_dead" other-mac.invalid)";   b19_try "foreign host" busy
w7_exlock empty;                                           b19_try "empty, young" busy
rm -f "$FHOME/.a1-intents/executor.lock"
# a surviving child of the dead run: its process group is ended before the lock goes
b19_old="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
node -e 'const cp = require("child_process"); const c = cp.spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" }); c.unref(); process.stdout.write(String(c.pid));' >"$SB/b19.orphan"
b19_orphan="$(cat "$SB/b19.orphan")"
w7_record "$b19_old" "$b19_orphan"
w7_exlock "$(w7_ctxlock "$b19_dead" "$W5B_HOST" "$b19_old")"
b19_try "dead run with a surviving child" runs
sleep 0.3
[[ "$(w7_alive "$b19_orphan")" == gone ]] || { b19_bad="$b19_bad | the dead run's child survived"; kill -9 "$b19_orphan" 2>/dev/null; }
if [[ -z "$b19_bad" ]]; then
  ok "B19 an empty lock past the stale bound and a dead same-host holder are reclaimed (a surviving child of that run is killed first); a live, a foreign-host and a young empty lock -> executor_busy, untouched [FR-025]"
else bad "B19 an empty lock past the stale bound and a dead same-host holder are reclaimed (a surviving child of that run is killed first); a live, a foreign-host and a young empty lock -> executor_busy, untouched [FR-025]" "${b19_bad:0:600}"; fi

# ---------- B20/B21/B22: carried from part B ----------
# B20 (review r1): a stop signal before the running rewrite rolls back.
w6_claim action=plan target=M2-P1-x
w7_steps sigterm-early
b20="$RS_RC $(w6_where "$W6_ID") $(w6_fm "$W6_FILE" status) $( [[ -e "$FHOME/claude-projects/a1-worktrees/real-proj-intent-$W6_ID" ]] && echo worktree) $( [[ -e "$FHOME/.a1-intents/runs/$W6_ID" ]] && echo run-dir) $(w6_reg_entry "$W6_ID" '"entry"') $(w7_locks) $W6_SPAWNS"
if [[ "$b20" == "143 claimed claimed   <no entry> 0 0" ]]; then
  ok "B20 SIGTERM before the running rewrite -> exit 143, worktree, run dir and registry entry rolled back, intent still claimed, both locks gone, 0 spawns [FR-043, review r1]"
else bad "B20 SIGTERM before the running rewrite -> exit 143, worktree, run dir and registry entry rolled back, intent still claimed, both locks gone, 0 spawns [FR-043, review r1]" "$b20"; fi
# B21 (review NIT): a rollback that throws never masks ledger_busy.
w6_claim action=progress
w7_steps busy-dirty
rm -f "$FHOME/.a1-intents/ledger.lock"
b21="$(w6_js '(o.out && o.out.reasons || []).join(",") + " " + /rollback/.test(o.out && o.out.detail || "")' "$RS")"
rm -rf "$FHOME/.a1-intents/runs/$W6_ID"
if [[ "$b21" == "ledger_busy true" ]]; then ok "B21 ledger_busy whose rollback fails (run dir not removable) -> still reported as ledger_busy, the rollback failure named in the detail [FR-020, review NIT]"
else bad "B21 ledger_busy whose rollback fails (run dir not removable) -> still reported as ledger_busy, the rollback failure named in the detail [FR-020, review NIT]" "$b21" "rs: ${RS:0:300}"; fi
# B22 (review n2): SIGTERM to run while a child ignores SIGTERM -> the group
# gets SIGKILL after the grace, BEFORE the locks are released.
w6_claim action=progress
stub_mode hang
A1_INTENT_KILL_GRACE_MS=500 w7_bg "$W6_FILE" b22
b22_pid=$W7_BG_PID
for _ in $(seq 1 40); do [[ -f "$W6_STUB/grandchild.pid" ]] && break; sleep 0.1; done
b22_node="$(pgrep -P "$b22_pid" node | head -1)"
kill -TERM "${b22_node:-$b22_pid}"
wait "$b22_pid"
stub_mode ok
b22="$(cat "$SB/.bg-b22.rc") $(w7_alive "$(cat "$W6_STUB/stub.pid")") $(w7_alive "$(cat "$W6_STUB/grandchild.pid")") $(w7_locks) $(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason)"
if [[ "$b22" == "143 gone gone 0 done cancelled" ]]; then ok "B22 SIGTERM to run while the child ignores SIGTERM -> the child and its grandchild are gone (SIGKILL after the grace), the intent completed failed cancelled (done/), both locks released, exit 143 [FR-027, review n2, W7-M1]"
else bad "B22 SIGTERM to run while the child ignores SIGTERM -> the child and its grandchild are gone (SIGKILL after the grace), the intent completed failed cancelled (done/), both locks released, exit 143 [FR-027, review n2, W7-M1]" "$b22"; fi

# ---------- B23: cancelling the running intent (cancelTarget) ----------
w6_claim action=progress
stub_mode hang
A1_INTENT_KILL_GRACE_MS=500 w7_bg "$W6_FILE" b23
for _ in $(seq 1 40); do [[ -f "$W6_STUB/grandchild.pid" ]] && break; sleep 0.1; done
b23_cancel="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
b23_r="$(HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e '
  const [lib, home, file, id] = process.argv.slice(1);
  require(lib + "/intent-child.cjs").injectChildDeps({ passwdHome: () => home });
  const r = require(lib + "/intent-lifecycle.cjs").cancelTarget(file, id, { graceMs: 500 });
  console.log(JSON.stringify(r));' "$INTENT_LIB" "$FHOME" "$W6_FILE" "$b23_cancel" 2>&1)"
wait
stub_mode ok
b23="$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(w7_alive "$(cat "$W6_STUB/stub.pid")") $(w7_alive "$(cat "$W6_STUB/grandchild.pid")") $(w7_locks)"
w6_claim action=progress
b23_c="$(HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node -e '
  const [lib, home, file, id] = process.argv.slice(1);
  require(lib + "/intent-child.cjs").injectChildDeps({ passwdHome: () => home });
  const L = require(lib + "/intent-lifecycle.cjs");
  const a = L.cancelTarget(file, id, {});
  const b = L.cancelTarget(file.replace("/claimed/", "/done/"), id, {});
  console.log([a.ok, b.ok, b.reason].join(" "));' "$INTENT_LIB" "$FHOME" "$W6_FILE" "$b23_cancel" 2>&1)"
b23_rej="$(w6_fm "$VAULT/inbox/intents/rejected/$W6_ID.md" rejected_reason) $(w6_fm "$VAULT/inbox/intents/rejected/$W6_ID.md" cancelled_by_intent)"
if [[ "$b23" == "cancelled gone gone 0" && "$b23_c" == "true false target_not_found" && "$b23_rej" == "cancelled_by_user $b23_cancel" ]]; then
  ok "B23 cancelTarget: the running intent is stopped with SIGTERM -> grace -> SIGKILL on its group and completed failed cancelled; a claimed target -> rejected cancelled_by_user with cancelled_by_intent; a done target -> target_not_found [FR-028]"
else bad "B23 cancelTarget: the running intent is stopped with SIGTERM -> grace -> SIGKILL on its group and completed failed cancelled; a claimed target -> rejected cancelled_by_user with cancelled_by_intent; a done target -> target_not_found [FR-028]" "running: $b23 (${b23_r:0:200})" "claimed/done: $b23_c rejected: $b23_rej"; fi

# ---------- B6d: a started intent with a leftover run dir still expires (review W7-M1) ----------
w6_claim action=progress
node - "$W6_FILE" "$FHOME/.a1-intents-ledger.json" "$W6_ID" <<'JS'
const fs = require('fs'); const crypto = require('crypto');
const [file, ledger, id] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8').replace(/^status: claimed$/m, 'status: running').replace(/\n---\n$/, '\nstarted_at: 2026-10-01T03:00:00.000Z\n---\n');
fs.writeFileSync(file, text);
const d = JSON.parse(fs.readFileSync(ledger, 'utf8'));
const old = new Date(Date.now() - 7 * 3600000).toISOString();
d.rows = d.rows.map((r) => (r.id === id ? { ...r, claimed_at: old, started_at: '2026-10-01T03:00:00.000Z', claimed_sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex') } : r));
fs.writeFileSync(ledger, JSON.stringify(d)); fs.chmodSync(ledger, 0o600);
JS
mkdir -p "$FHOME/.a1-intents/runs/$W6_ID"; chmod 700 "$FHOME/.a1-intents/runs" "$FHOME/.a1-intents/runs/$W6_ID"
for f in stdout.txt stderr.txt snapshot.json; do printf 'left\n' >"$FHOME/.a1-intents/runs/$W6_ID/$f"; chmod 600 "$FHOME/.a1-intents/runs/$W6_ID/$f"; done
printf '{"pgid":999999}' >"$FHOME/.a1-intents/runs/$W6_ID/child.json"; chmod 600 "$FHOME/.a1-intents/runs/$W6_ID/child.json"
w6_run
b6d="$RC $(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $W6_SPAWNS $( [[ -e "$FHOME/.a1-intents/runs/$W6_ID" ]] && echo run-dir)"
if [[ "$b6d" == "1 done expired 0 " ]]; then ok "B6d a started intent (status running, row started_at) with a leftover run dir, claimed 7 h ago -> failed expired, the run dir taken over and removed, 0 spawns [FR-028, review W7-M1]"
else bad "B6d a started intent (status running, row started_at) with a leftover run dir, claimed 7 h ago -> failed expired, the run dir taken over and removed, 0 spawns [FR-028, review W7-M1]" "$b6d" "out: ${OUT:0:200} err: ${ERR:0:200}"; fi

# ---------- B19g-i: process identity before any kill or live verdict (review W7-M2) ----------
b19_live_group() { node -e 'const cp = require("child_process"); const c = cp.spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" }); c.unref(); process.stdout.write(String(c.pid));'; }
sleep 0 & b19_dead2=$!
wait "$b19_dead2"
b19_bad=""
# g: child.json names a live group whose leader started at another time than the recorded one (pid reuse) -> left alone
b19g_id="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"; b19g_grp="$(b19_live_group)"
w7_record "$b19g_id" "$b19g_grp" 'o.start = o.start + "0"'
w7_exlock "$(w7_ctxlock "$b19_dead2" "$W5B_HOST" "$b19g_id")"; b19_try "dead run, reused group" runs
[[ "$(w7_alive "$b19g_grp")" == alive ]] || b19_bad="$b19_bad | g: the reused group was killed"
kill -9 "$b19g_grp" 2>/dev/null
# h: a lock from before the last boot with a fresh child.json naming a live group -> reclaimed, no kill
b19h_id="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"; b19h_grp="$(b19_live_group)"
w7_record "$b19h_id" "$b19h_grp"
W7_LOCK_AT="2020-01-01T00:00:00.000Z" w7_exlock "$(W7_LOCK_AT="2020-01-01T00:00:00.000Z" w7_ctxlock "$b19_dead2" "$W5B_HOST" "$b19h_id")"; b19_try "pre-boot lock" runs
[[ "$(w7_alive "$b19h_grp")" == alive ]] || b19_bad="$b19_bad | h: a group was signalled for a pre-boot lock"
kill -9 "$b19h_grp" 2>/dev/null
# i: a live pid that started AFTER the lock was written (reused) is no live holder -> reclaimed
b19i_grp="$(b19_live_group)"
W7_LOCK_AT="$(node -e 'process.stdout.write(new Date(Date.now() - 3600000).toISOString())')" w7_exlock "$(W7_LOCK_AT="$(node -e 'process.stdout.write(new Date(Date.now() - 3600000).toISOString())')" w7_ctxlock "$b19i_grp" "$W5B_HOST")"; b19_try "live but reused pid" runs
kill -9 "$b19i_grp" 2>/dev/null
rm -f "$FHOME/.a1-intents/executor.lock"
if [[ -z "$b19_bad" ]]; then ok "B19g-i identity: a child.json whose group leader started at another time than recorded is left alone; a pre-boot lock is reclaimed without any kill; a live pid that started after its lock is no live holder [FR-025, review W7-M2]"
else bad "B19g-i identity: a child.json whose group leader started at another time than recorded is left alone; a pre-boot lock is reclaimed without any kill; a live pid that started after its lock is no live holder [FR-025, review W7-M2]" "${b19_bad:0:500}"; fi

# ---------- B24: nothing of the child's group outlives run (review m1) ----------
w6_claim action=progress
stub_mode bg
w6_run
stub_mode ok
sleep 0.3
b24="$RC $(w6_where "$W6_ID") $(w7_alive "$(cat "$W6_STUB/bg.pid" 2>/dev/null || echo 0)")"
if [[ "$b24" == "0 done gone" ]]; then ok "B24 a child that exits 0 but leaves a background process in its group -> run ends that group after the close [FR-025, review m1]"
else bad "B24 a child that exits 0 but leaves a background process in its group -> run ends that group after the close [FR-025, review m1]" "$b24"; kill -9 "$(cat "$W6_STUB/bg.pid" 2>/dev/null)" 2>/dev/null; fi

# ---------- B25: a cancel in the prepare window (review m2) ----------
w6_claim action=plan target=M2-P1-x
w7_steps cancel-early
b25_rej="$VAULT/inbox/intents/rejected/$W6_ID.md"
b25="$(w6_where "$W6_ID") $(w6_fm "$b25_rej" rejected_reason) $(w6_fm "$b25_rej" cancelled_by_intent) $W6_SPAWNS $(grep -c '"event":"cancel","ok":true,"state":"running"' "$SB/.spy") $( [[ -e "$FHOME/claude-projects/a1-worktrees/real-proj-intent-$W6_ID" ]] && echo worktree) $( [[ -e "$FHOME/.a1-intents/runs/$W6_ID.cancel" ]] && echo marker) $(w7_locks)"
if [[ "$b25" == "rejected cancelled_by_user 0c4a1e2b-5d6f-4a7b-8c9d-0e1f2a3b4c5d 0 1   0" ]]; then
  ok "B25 a cancel of the locked intent before its running rewrite (cancelTarget in the prepare window, no throw) -> rejected cancelled_by_user with cancelled_by_intent, 0 spawns, worktree rolled back, marker and locks gone [FR-028, review m2]"
else bad "B25 a cancel of the locked intent before its running rewrite (cancelTarget in the prepare window, no throw) -> rejected cancelled_by_user with cancelled_by_intent, 0 spawns, worktree rolled back, marker and locks gone [FR-028, review m2]" "$b25" "rs: ${RS:0:200}"; fi

chmod -R u+w "$WORK"
