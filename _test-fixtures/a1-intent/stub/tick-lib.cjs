'use strict';

// stub/tick-lib.cjs — fixture-only: `intent tick` as a library call with the
// Wave 8 seams (spec 011): the hook before an approve is applied and the run
// deps tick passes on. The passwd home is injected through intent-child's
// library seam, as a1-tools-as.cjs does. Every spy writes one JSON line per
// event into <spy>. Prints the tick result as JSON.
//
//   node tick-lib.cjs <lib-dir> <home> <mode> <spy-file>
//
// modes:
//   plain        no seam
//   swap-target  beforeApply rewrites the approve target's payload line
//                (another device's bytes landing between claim and apply)
//   swap-note    beforeVerify writes $HOME/.a1-intents/tmp/note.orig back over
//                the claimed note it names (the bytes change between the
//                listing and the verification)
//   edit-note    beforeApply appends a line to the approve note itself (its
//                bytes change after the verification, before the finish)
//   busy-finish  beforeFinish holds the ledger lock (this live pid), so the
//                move to done/ is refused ledger_busy after the effect
//   gate-hang    run's xprov gate starts `sleep 30` through the budget's
//                tracked spawn and waits for it (records its pid)

const fs = require('fs');
const path = require('path');

const [lib, home, mode, spy] = process.argv.slice(2);
require(path.join(lib, 'intent-child.cjs')).injectChildDeps({ passwdHome: () => home });
const note = (o) => fs.appendFileSync(spy, `${JSON.stringify({ ...o, ms: Date.now() })}\n`);
note({ event: 'driver', pid: process.pid });

const deps = { runDeps: {} };
if (mode === 'swap-target') {
  deps.beforeApply = ({ target }) => {
    const text = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, text.replace(/^(payload: \|\n {2}).*$/m, '$1Swapped after the approve was signed'));
    note({ event: 'swap', target });
  };
}
if (mode === 'swap-note') {
  deps.beforeVerify = (entry) => {
    const orig = path.join(home, '.a1-intents', 'tmp', 'note.orig');
    if (!fs.existsSync(orig)) return;
    fs.writeFileSync(entry.file, fs.readFileSync(orig));
    fs.rmSync(orig);
    note({ event: 'swap-note', file: entry.file });
  };
}
if (mode === 'edit-note') {
  deps.beforeApply = ({ approve }) => {
    fs.appendFileSync(approve, 'edited between apply and finish\n');
    note({ event: 'edit-note', file: approve });
  };
}
if (mode === 'busy-finish') {
  deps.beforeFinish = () => {
    fs.writeFileSync(path.join(home, '.a1-intents', 'ledger.lock'),
      JSON.stringify({ pid: process.pid, hostname: require('os').hostname(), acquired_at: new Date().toISOString(), token: 'fixture' }), { mode: 0o600 });
    note({ event: 'busy-finish' });
  };
}
if (mode === 'gate-hang') {
  deps.runDeps.xprovGate = async (_ctx, budget) => {
    const child = budget.spawn('/bin/sleep', ['30']);
    note({ event: 'gate', pid: child.pid });
    await new Promise((resolve) => child.on('close', resolve));
    return { ok: true };
  };
}
// When tick's promise resolves: which files done/ holds at that moment (T3:
// the run must be over BEFORE tick returns, not merely before the process exits).
const doneNow = () => fs.readdirSync(path.join(process.env.A1_VAULT_ROOT, 'inbox', 'intents', 'done')).filter((n) => n.endsWith('.md'));
require(path.join(lib, 'intent-tick.cjs')).tick(deps)
  .then((r) => { note({ event: 'resolved', done: doneNow() }); process.stdout.write(JSON.stringify(r)); }, (e) => process.stdout.write(JSON.stringify({ error: e.message })));
