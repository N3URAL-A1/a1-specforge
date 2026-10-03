#!/usr/bin/env bash
# cases/07b-security.sh — spec 011 Wave 7, Samuel's security review
# (S-MAJOR-1..4 and the minors). Sourced after 07-bounds.sh; reuses its w7_*
# helpers and b19_try / b19_live_group. B26 and B27 are Samuel's measured
# probes K1 and K3 (scratchpad sam7/k.sh, cases/06z-k3.sh) as cases; his K2
# (a cancel in beforeMarkRunning) is B25 in 07-bounds.sh.
#
# RED proof and the mutation per fix: scratchpad, measured on git-archive
# copies (report of this round).

w7b_uuid() { node -e 'process.stdout.write(require("crypto").randomUUID())'; }
w7b_pid() { local p; p="$(cat "$1" 2>/dev/null)"; [[ "$p" =~ ^[0-9]+$ && "$p" -gt 1 ]] && printf %s "$p" || printf 999999; }

w6_sandbox w7-sec

# ---------- B26 (K1): a timeout whose leader dies on SIGTERM, a grandchild that ignores it and holds no pipe ----------
w6_claim action=progress
cat >"$FHOME/.a1-intents/tmp/stub-script" <<'S'
( trap '' TERM; exec sleep 30 ) </dev/null >/dev/null 2>&1 &
echo $! >"$HOME/.a1-intents/tmp/k1-gc.pid"
sleep 30
S
rm -f "$FHOME/.a1-intents/tmp/k1-gc.pid"
stub_mode script
A1_INTENT_TIMEOUT_MS=1500 A1_INTENT_KILL_GRACE_MS=3000 w7_bg "$W6_FILE" b26
b26_pid=$W7_BG_PID; b26_window=none; b26_seen=no
for _ in $(seq 1 200); do
  b26_gc="$(cat "$FHOME/.a1-intents/tmp/k1-gc.pid" 2>/dev/null)"
  if [[ -n "$b26_gc" ]] && kill -0 "$b26_gc" 2>/dev/null; then
    [[ "$(w7_locks)" -gt 0 ]] && b26_seen=yes
    [[ "$(w7_locks)" == 0 ]] && { b26_window=locks-gone-gc-alive; break; }
  fi
  kill -0 "$b26_pid" 2>/dev/null || break
  sleep 0.05
done
wait "$b26_pid"
stub_mode ok
b26_gc="$(w7b_pid "$FHOME/.a1-intents/tmp/k1-gc.pid")"
b26_stub="$(w7b_pid "$W6_STUB/stub.pid")"
b26_log="$(grep "\"intent_id\":\"$W6_ID\"" "$FHOME/.a1-intents/log.jsonl" | grep -oE '"detail":"(kill [A-Z]+ -[0-9]+|leftover group -[0-9]+ killed)"' | sed 's/"detail"://' | tr -d '"' | tr '\n' ',')"
b26="$b26_seen $b26_window $(w7_alive "$b26_gc") $(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(w7_locks)"
kill -9 "$b26_gc" 2>/dev/null
if [[ "$b26" == "yes none gone done timeout 0" && "$b26_log" == "kill SIGTERM -$b26_stub,kill SIGKILL -$b26_stub," ]]; then
  ok "B26 timeout 1500 ms, grace 3000 ms: the leader dies on SIGTERM, its grandchild ignores SIGTERM and holds no pipe -> never a moment with both locks gone and the grandchild alive; the timeout's own SIGKILL ends it (log: SIGTERM, SIGKILL to -pid, no second sequence), failed timeout [FR-027, S-MAJOR-1 K1]"
else bad "B26 timeout 1500 ms, grace 3000 ms: the leader dies on SIGTERM, its grandchild ignores SIGTERM and holds no pipe -> never a moment with both locks gone and the grandchild alive; the timeout's own SIGKILL ends it (log: SIGTERM, SIGKILL to -pid, no second sequence), failed timeout [FR-027, S-MAJOR-1 K1]" "seen-alive-under-lock window gc where reason locks: $b26" "log: $b26_log (stub $b26_stub)"; fi

# ---------- B27 (K3): exit 0 with a descendant left in the group ----------
w6_claim action=progress
cat >"$FHOME/.a1-intents/tmp/stub-script" <<'S'
( exec sleep 30 ) </dev/null >/dev/null 2>&1 &
echo $! >"$HOME/.a1-intents/tmp/k3-gc.pid"
S
rm -f "$FHOME/.a1-intents/tmp/k3-gc.pid"
stub_mode script
w6_run
stub_mode ok
b27_gc="$(w7b_pid "$FHOME/.a1-intents/tmp/k3-gc.pid")"
b27="$RC $(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" status) $( [[ -f "$FHOME/.a1-intents/tmp/k3-gc.pid" ]] && echo started) $(w7_alive "$b27_gc") $(w7_locks)"
kill -9 "$b27_gc" 2>/dev/null
if [[ "$b27" == "0 done done started gone 0" ]]; then
  ok "B27 the child exits 0 and leaves a descendant (no pipe) in its group -> the descendant is gone when run returns, intent done, both locks gone [FR-025, S-MAJOR-1 K3]"
else bad "B27 the child exits 0 and leaves a descendant (no pipe) in its group -> the descendant is gone when run returns, intent done, both locks gone [FR-025, S-MAJOR-1 K3]" "$b27"; fi

# B27b: the child's leftover is gone before the post-steps run (a gate sees it dead)
w6_claim action=plan target=M2-P1-x
rm -f "$FHOME/.a1-intents/tmp/k3-gc.pid"
stub_mode script
w7_steps gate-probe
stub_mode ok
b27b_gc="$(w7b_pid "$FHOME/.a1-intents/tmp/k3-gc.pid")"
b27b="$( [[ -f "$FHOME/.a1-intents/tmp/k3-gc.pid" ]] && echo started) $(node -e 'const ev = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === "gate"); console.log(ev ? `gate-saw-${ev.alive ? "alive" : "gone"}` : "no-gate")' "$SB/.spy") $(w6_where "$W6_ID")"
kill -9 "$b27b_gc" 2>/dev/null
if [[ "$b27b" == "started gate-saw-gone done" ]]; then ok "B27b the child's leftover descendant is ended before the post-steps: the gate already sees it gone [FR-025, FR-051, S-MAJOR-1]"
else bad "B27b the child's leftover descendant is ended before the post-steps: the gate already sees it gone [FR-025, FR-051, S-MAJOR-1]" "$b27b" "rs: ${RS:0:200}"; fi

# ---------- B28: a cancel after the running rewrite, before the spawn (S-MAJOR-2) ----------
w6_claim action=plan target=M2-P1-x
w7_steps cancel-prespawn
b28="$(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $W6_SPAWNS $(grep -c '"event":"cancel","ok":true,"state":"running"' "$SB/.spy") $(w7_row "$W6_ID" 'r.started_at ? "started" : "unstarted"') $(w6_js 'String(o.out && o.out.run)' "$RS") $( [[ -e "$FHOME/.a1-intents/runs/$W6_ID.cancel" ]] && echo marker) $(w7_locks)"
if [[ "$b28" == "done cancelled 0 1 started false  0" ]]; then
  ok "B28 a cancel that lands after the running rewrite but before the spawn -> failed cancelled with 0 spawns (run: false), marker and both locks gone [FR-028, S-MAJOR-2]"
else bad "B28 a cancel that lands after the running rewrite but before the spawn -> failed cancelled with 0 spawns (run: false), marker and both locks gone [FR-028, S-MAJOR-2]" "$b28" "rs: ${RS:0:200}"; fi

# ---------- B29: child.json binding (S-MAJOR-3) ----------
sleep 0 & b29_dead=$!
wait "$b29_dead"
b19_bad=""
# a: a LIVE holder with a valid child.json -> executor_busy, its group untouched
sleep 30 & b29_holder=$!
b29a_id="$(w7b_uuid)"; b29a_grp="$(b19_live_group)"
w7_record "$b29a_id" "$b29a_grp"
w7_exlock "$(w7_ctxlock "$b29_holder" "$W5B_HOST" "$b29a_id")"; b19_try "live holder with a child.json" busy
[[ "$(w7_alive "$b29a_grp")" == alive ]] || b19_bad="$b19_bad | a: the live holder's group was killed"
kill "$b29_holder" 2>/dev/null; wait "$b29_holder" 2>/dev/null; kill -9 "$b29a_grp" 2>/dev/null
# b: a dead holder whose child.json was written in another boot -> reclaimed, no kill
b29b_id="$(w7b_uuid)"; b29b_grp="$(b19_live_group)"
w7_record "$b29b_id" "$b29b_grp" 'o.boot_ms -= 3600000'
w7_exlock "$(w7_ctxlock "$b29_dead" "$W5B_HOST" "$b29b_id")"; b19_try "dead holder, child.json of another boot" runs
[[ "$(w7_alive "$b29b_grp")" == alive ]] || b19_bad="$b19_bad | b: a group of another boot was killed"
kill -9 "$b29b_grp" 2>/dev/null
# c: a dead holder whose child.json lacks the binding (the pre-review { pgid }) -> reclaimed, no kill
b29c_id="$(w7b_uuid)"; b29c_grp="$(b19_live_group)"
w7_record "$b29c_id" "$b29c_grp" 'delete o.start_ms; delete o.boot_ms'
w7_exlock "$(w7_ctxlock "$b29_dead" "$W5B_HOST" "$b29c_id")"; b19_try "dead holder, unbound child.json" runs
[[ "$(w7_alive "$b29c_grp")" == alive ]] || b19_bad="$b19_bad | c: an unbound pgid was killed"
kill -9 "$b29c_grp" 2>/dev/null
rm -f "$FHOME/.a1-intents/executor.lock"
# d: a child.json that names the caller's own group -> no group (control: another live group is returned)
b29d="$(node -e '
  const cp = require("child_process"); const [lib, dir] = process.argv.slice(1);
  const code = `const S = require(${JSON.stringify(lib + "/intent-spawn.cjs")}); const fs = require("fs"); const dir = process.argv[1];
    fs.mkdirSync(dir + "/own", { recursive: true }); fs.mkdirSync(dir + "/other", { recursive: true });
    S.recordChild(dir + "/own", process.pid);
    const o = cp.spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" }); S.recordChild(dir + "/other", o.pid);
    process.stdout.write(String(S.recordedGroup(dir + "/own")) + " " + String(S.recordedGroup(dir + "/other") === o.pid)); o.kill("SIGKILL");`;
  const r = cp.spawnSync(process.execPath, ["-e", "const cp = require(\"child_process\"); " + code, dir], { encoding: "utf8", detached: true, timeout: 10000 });
  process.stdout.write(r.stdout || ("no output, status " + r.status + " " + r.signal));' "$INTENT_LIB" "$SB/b29d" 2>&1)"
[[ "$b29d" == "null true" ]] || b19_bad="$b19_bad | d: $b29d"
# e: a tracked group whose leader started after it was tracked (a reused pid) is not reaped; the group tracked at its spawn is
b29e="$(node -e '
  const cp = require("child_process"); const S = require(process.argv[1] + "/intent-spawn.cjs");
  const b = S.createBudget({ timeoutMs: 60000, graceMs: 200 });
  const reused = cp.spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" }); const own = b.spawn("/bin/sleep", ["30"]);
  b.track(reused.pid, Date.now() - 60000);
  setTimeout(() => {
    const before = [S.groupAlive(reused.pid), S.groupAlive(own.pid)].join(",");
    b.reapSync();
    setTimeout(() => { console.log(before + " " + [S.groupAlive(reused.pid), S.groupAlive(own.pid)].join(",")); reused.kill("SIGKILL"); process.exit(0); }, 200);
  }, 300);' "$INTENT_LIB" 2>&1)"
[[ "$b29e" == "true,true true,false" ]] || b19_bad="$b19_bad | e: $b29e"
if [[ -z "$b19_bad" ]]; then
  ok "B29 child.json binding: a live holder WITH a child.json -> executor_busy, its group untouched; a child.json of another boot or without start/boot -> reclaimed, no kill; a child.json naming the caller's own group -> none (another live group: found); the reap skips a tracked pid whose leader started after it was tracked [FR-025, S-MAJOR-3]"
else bad "B29 child.json binding: a live holder WITH a child.json -> executor_busy, its group untouched; a child.json of another boot or without start/boot -> reclaimed, no kill; a child.json naming the caller's own group -> none (another live group: found); the reap skips a tracked pid whose leader started after it was tracked [FR-025, S-MAJOR-3]" "${b19_bad:0:600}"; fi

# ---------- B30: a stop signal during a post-step (S-MAJOR-4) ----------
w6_claim action=plan target=M2-P1-x
A1_INTENT_KILL_GRACE_MS=500 w7_steps gate-sigterm
b30_pid="$(node -e 'const ev = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === "gate"); console.log(ev ? ev.pid : 999999)' "$SB/.spy")"
sleep 0.3
b30="$RS_RC $( [[ "$b30_pid" != 999999 ]] && echo started) $(w7_alive "$b30_pid") $(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(w7_locks)"
kill -9 "$b30_pid" 2>/dev/null
if [[ "$b30" == "143 started gone done cancelled 0" ]]; then
  ok "B30 SIGTERM to run while a post-step's tracked process runs -> that process is gone, the intent completed failed cancelled, both locks gone, exit 143 [FR-027, FR-051, S-MAJOR-4]"
else bad "B30 SIGTERM to run while a post-step's tracked process runs -> that process is gone, the intent completed failed cancelled, both locks gone, exit 143 [FR-027, FR-051, S-MAJOR-4]" "$b30"; fi

# B30b: a post-step that leaves a tracked process behind and returns -> it is gone when run returns
w6_claim action=plan target=M2-P1-x
b30b_t0="$(w7_now)"
w7_steps gate-leftover
b30b_ms=$(( $(w7_now) - b30b_t0 ))
b30b_pid="$(node -e 'const ev = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === "gate"); console.log(ev ? ev.pid : 999999)' "$SB/.spy")"
sleep 0.3
b30b="$( [[ "$b30b_pid" != 999999 ]] && echo started) $(w7_alive "$b30b_pid") $(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" status) $(w7_locks)"
kill -9 "$b30b_pid" 2>/dev/null
# the driver's event loop waits for its own child, so a process left alive
# would only end with its 30 s sleep: the time bound tells the two apart
if [[ "$b30b" == "started gone done done 0" && "$b30b_ms" -lt 15000 ]]; then ok "B30b a post-step that leaves a tracked process (sleep 30) and returns ok -> run kills it and returns well before 30 s; intent done, both locks gone [FR-051, S-MAJOR-1]"
else bad "B30b a post-step that leaves a tracked process (sleep 30) and returns ok -> run kills it and returns well before 30 s; intent done, both locks gone [FR-051, S-MAJOR-1]" "$b30b in ${b30b_ms} ms"; fi

# ---------- B31: Samuel's minors ----------
# a: started_at in the future (a clock set back) still counts toward the cap
w6_claim action=progress
w7_rows -7200 -7200 -7200 -7200 -7200 -7200
w6_run
b31a="$RC $(w6_where "$W6_ID") $W6_SPAWNS $(w6_js 'o.outcome + " " + o.reason' "$(w6_log_last run)")"
w7_drop_fixture_rows
if [[ "$b31a" == "1 claimed 0 refused rate_limited" ]]; then ok "B31a six ledger rows whose started_at lies 2 h in the future -> rate_limited, stays claimed, 0 spawns [FR-026, W7 security minor]"
else bad "B31a six ledger rows whose started_at lies 2 h in the future -> rate_limited, stays claimed, 0 spawns [FR-026, W7 security minor]" "$b31a"; fi
# b: an unparsable claimed_at expires (fail closed)
w6_claim action=progress
node -e 'const fs = require("fs"); const [f, id] = process.argv.slice(1); const d = JSON.parse(fs.readFileSync(f, "utf8"));
  d.rows = d.rows.map((r) => (r.id === id ? { ...r, claimed_at: "not-a-date" } : r)); fs.writeFileSync(f, JSON.stringify(d)); fs.chmodSync(f, 0o600);' "$FHOME/.a1-intents-ledger.json" "$W6_ID"
w6_run
b31b="$(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $W6_SPAWNS"
if [[ "$b31b" == "done expired 0" ]]; then ok "B31b a ledger row whose claimed_at cannot be parsed -> failed expired, 0 spawns (fail closed) [FR-028, W7 security minor]"
else bad "B31b a ledger row whose claimed_at cannot be parsed -> failed expired, 0 spawns (fail closed) [FR-028, W7 security minor]" "$b31b" "out: ${OUT:0:200}"; fi
# c: the integrity pre-step ends the process through fail() -> run survives, the intent fails parent_step_failed
w6_claim action=fix
w7_steps integrity-exit
b31c="$RS_RC $(w6_js 'String(o.exitCode)' "$RS") $(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $W6_SPAWNS $(w7_row "$W6_ID" 'String(r.started_at)') $(w7_locks) $(grep -c '"event":"integrity"' "$SB/.spy")"
if [[ "$b31c" == "0 1 done parent_step_failed 0 null 0 1" ]]; then
  ok "B31c an integrity check that calls io fail() (process.exit) -> run does not exit: failed parent_step_failed, 0 spawns, no started_at, both locks gone [FR-051, W7 security minor]"
else bad "B31c an integrity check that calls io fail() (process.exit) -> run does not exit: failed parent_step_failed, 0 spawns, no started_at, both locks gone [FR-051, W7 security minor]" "$b31c" "rs: ${RS:0:200} err: $(head -c 200 "$SB/.rs-err")"; fi
# d: the postmortem post-step does the same -> run survives, failed parent_step_failed
w6_claim action=fix
b16_script "-three"
stub_mode script
w7_steps postmortem-exit
stub_mode ok
b31d="$RS_RC $(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(w7_locks) $(grep -c '"event":"postmortem"' "$SB/.spy")"
if [[ "$b31d" == "0 done parent_step_failed 0 1" ]]; then
  ok "B31d a postmortem writer that calls io fail() -> run does not exit: failed parent_step_failed, both locks gone [FR-051, W7 security minor]"
else bad "B31d a postmortem writer that calls io fail() -> run does not exit: failed parent_step_failed, both locks gone [FR-051, W7 security minor]" "$b31d" "rs: ${RS:0:200}"; fi

chmod -R u+w "$WORK"
