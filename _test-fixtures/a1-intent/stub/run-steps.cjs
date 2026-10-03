'use strict';

// stub/run-steps.cjs — fixture-only: `intent run` as a library call with the
// Wave 7 seams (spec 011): the kill function, the executor steps and a hook
// before the running rewrite. The passwd home is injected through
// intent-child's library seam, as a1-tools-as.cjs does. Every spy writes
// one JSON line per event into <spy>. Prints the runIntent result as JSON.
//
//   node run-steps.cjs <lib-dir> <home> <claimed-file> <mode> <spy-file>
//
// modes:
//   killspy          deps.kill records [target, signal, ms] and then kills
//   integrity-fail   deps.integrityCheck -> { status: 'mismatch' } (records its pid)
//   integrity-ok     deps.integrityCheck -> { status: 'ok' } (records its pid)
//   gate-fail        deps.xprovGate -> { ok: false, detail } (records the call)
//   gate-ok          deps.xprovGate -> { ok: true }
//   gate-hang        deps.xprovGate starts `sleep 30` through the budget's
//                    tracked spawn and waits for it (records its pid)
//   sigterm-early    beforeMarkRunning sends SIGTERM to this process and
//                    lets the event loop turn before the running rewrite
//   late             the clock of run is 20 minutes ahead (past created_at's
//                    15-minute freshness window, far from the 6 h expiry)
//   busy-dirty       beforeMarkRunning holds the ledger lock (live pid) and
//                    leaves an extra file in the run dir, so the rollback
//                    after the ledger_busy cannot remove it
//   cancel-prespawn  beforeSpawn (after the running rewrite) cancels this
//                    intent through the real cancelTarget (S-MAJOR-2)
//   gate-sigterm     deps.xprovGate starts `sleep 30` through the budget's
//                    tracked spawn, records its pid, then sends SIGTERM to
//                    this process (S-MAJOR-4)
//   gate-probe       deps.xprovGate records whether the pid in
//                    $HOME/.a1-intents/tmp/k3-gc.pid is alive when it runs
//   gate-leftover    deps.xprovGate starts `sleep 30` through the budget's
//                    tracked spawn and returns ok without waiting for it
//   integrity-exit   deps.integrityCheck ends the process through io.cjs fail()
//   postmortem-exit  deps.writePostmortem ends the process through io.cjs fail()

const fs = require('fs');
const os = require('os');
const path = require('path');

const [lib, home, file, mode, spy] = process.argv.slice(2);
require(path.join(lib, 'intent-child.cjs')).injectChildDeps({ passwdHome: () => home });
const run = require(path.join(lib, 'intent-run.cjs'));
const note = (o) => fs.appendFileSync(spy, `${JSON.stringify({ ...o, ms: Date.now() })}\n`);
note({ event: 'driver', pid: process.pid });

const deps = {};
if (mode === 'killspy') deps.kill = (target, sig) => { note({ event: 'kill', target, sig }); try { process.kill(target, sig); } catch (_e) { /* gone */ } };
if (mode === 'integrity-fail') deps.integrityCheck = () => { note({ event: 'integrity', pid: process.pid }); return { status: 'mismatch' }; };
if (mode === 'integrity-ok') deps.integrityCheck = () => { note({ event: 'integrity', pid: process.pid }); return { status: 'ok' }; };
if (mode === 'gate-fail') deps.xprovGate = () => { note({ event: 'gate' }); return { ok: false, detail: 'fixture gate: FAIL' }; };
if (mode === 'gate-ok') deps.xprovGate = () => { note({ event: 'gate' }); return { ok: true }; };
if (mode === 'gate-hang') {
  deps.xprovGate = async (_ctx, budget) => {
    const child = budget.spawn('/bin/sleep', ['30']);
    note({ event: 'gate', pid: child.pid });
    await new Promise((resolve) => child.on('close', resolve));
    return { ok: true };
  };
}
if (mode === 'late') deps.now = () => Date.now() + 20 * 60 * 1000;
// cancel-early: a cancel of this (locked, not yet started) intent arrives in
// the prepare window, through the real cancelTarget (review m2)
if (mode === 'cancel-early') {
  deps.beforeMarkRunning = () => {
    const r = require(path.join(lib, 'intent-lifecycle.cjs')).cancelTarget(file, '0c4a1e2b-5d6f-4a7b-8c9d-0e1f2a3b4c5d', { graceMs: 100 });
    note({ event: 'cancel', ok: r.ok, state: r.state });
  };
}
if (mode === 'cancel-prespawn') {
  deps.beforeSpawn = () => {
    const r = require(path.join(lib, 'intent-lifecycle.cjs')).cancelTarget(file, '0c4a1e2b-5d6f-4a7b-8c9d-0e1f2a3b4c5d', { graceMs: 100 });
    note({ event: 'cancel', ok: r.ok, state: r.state });
  };
}
if (mode === 'gate-sigterm') {
  deps.xprovGate = async (_ctx, budget) => {
    const child = budget.spawn('/bin/sleep', ['30']);
    note({ event: 'gate', pid: child.pid });
    process.kill(process.pid, 'SIGTERM');
    await new Promise((resolve) => child.on('close', resolve));
    return { ok: true };
  };
}
if (mode === 'gate-probe') {
  deps.xprovGate = () => {
    const pid = Number(fs.readFileSync(path.join(home, '.a1-intents', 'tmp', 'k3-gc.pid'), 'utf8'));
    let alive = true;
    try { process.kill(pid, 0); } catch (_e) { alive = false; }
    note({ event: 'gate', pid, alive });
    return { ok: true };
  };
}
if (mode === 'gate-leftover') {
  deps.xprovGate = (_ctx, budget) => {
    const child = budget.spawn('/bin/sleep', ['30']);
    note({ event: 'gate', pid: child.pid });
    return { ok: true };
  };
}
if (mode === 'integrity-exit') deps.integrityCheck = () => { note({ event: 'integrity', pid: process.pid }); require(path.join(lib, 'io.cjs')).fail('fixture: no learning-store root'); };
if (mode === 'postmortem-exit') deps.writePostmortem = () => { note({ event: 'postmortem' }); require(path.join(lib, 'io.cjs')).fail('fixture: bad postmortem argument'); };
if (mode === 'sigterm-early') {
  deps.beforeMarkRunning = () => {
    note({ event: 'sigterm-self' });
    process.kill(process.pid, 'SIGTERM');
    return new Promise((resolve) => setTimeout(resolve, 500));
  };
}
if (mode === 'busy-dirty') {
  deps.beforeMarkRunning = (ctx) => {
    fs.writeFileSync(path.join(home, '.a1-intents', 'ledger.lock'),
      JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquired_at: new Date().toISOString(), token: 'fixture' }), { mode: 0o600 });
    fs.writeFileSync(path.join(ctx.runDir, 'extra.txt'), 'keeps the dir non-empty\n');
  };
}
run.runIntent(file, deps).then((r) => process.stdout.write(JSON.stringify(r)), (e) => process.stdout.write(JSON.stringify({ error: e.message })));
