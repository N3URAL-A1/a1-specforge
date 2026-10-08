'use strict';

// intent-list.cjs — `a1-tools intent list` (spec 011, Wave 8: FR-034,
// FR-009). Read-only rows per .md file; `tampered` only on the executor host,
// judged against the hash the ledger recorded at a1's last write.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { check, eq, done } = require('../lib.cjs');

const L = require(path.join(process.argv[2], 'intent-list.cjs'));
const work = fs.mkdtempSync(path.join(process.argv[3], 'list-'));
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const ID2 = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

eq('L0 list states', L.LIST_STATES, ['queued', 'claimed', 'done', 'rejected', 'ignored', 'tampered', 'all']);

// L1 — isTampered, pure over (folder, stem, content, rows).
// Red-making change: returning false for a claimed file without a ledger row.
{
  const t = (folder, stem, content, rows) => L.isTampered(folder, stem, content, rows);
  const claimed = [{ id: ID, claimed_sha256: sha('A'), finished_at: null }];
  eq('L1 off the executor host (rows null): never', t('claimed', ID, 'X', null), false);
  eq('L1 queued: never', t('queued', ID, 'X', []), false);
  eq('L1 claimed without a row', t('claimed', ID, 'A', []), true);
  eq('L1 claimed, bytes as claimed', t('claimed', ID, 'A', claimed), false);
  eq('L1 claimed, bytes changed', t('claimed', ID, 'B', claimed), true);
  eq('L1 claimed, unreadable', t('claimed', ID, null, claimed), true);
  eq('L1 claimed, row already finished', t('claimed', ID, 'B', [{ ...claimed[0], finished_at: '2026-10-08T08:00:00Z' }]), false);
  eq('L1 claimed, non-uuid stem has no row', t('claimed', 'notes', 'A', claimed), true);
  const doneRows = [{ id: ID, file_sha256: sha('D') }];
  eq('L1 done, bytes as recorded', t('done', ID, 'D', doneRows), false);
  eq('L1 done, bytes changed', t('done', ID, 'E', doneRows), true);
  eq('L1 rejected, unreadable with a hash', t('rejected', ID, null, doneRows), true);
  eq('L1 done without a row: cannot judge', t('done', ID, 'E', []), false);
  eq('L1 done, row without file_sha256: cannot judge', t('done', ID, 'E', [{ id: ID }]), false);
}

// A vault with all four folders.
const vault = path.join(work, 'vault');
const root = path.join(vault, 'inbox', 'intents');
const fm = (o) => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
const intent = (id, extra = {}) => fm({ type: 'intent', schema_version: 1, id, action: 'new-feature', project: 'demo', created_at: '2026-10-08T08:00:00.000Z', created_by: 'pixel-robert', ...extra });
const put = (folder, name, text) => { fs.mkdirSync(path.join(root, folder), { recursive: true }); fs.writeFileSync(path.join(root, folder, name), text); return text; };
put('queued', `${ID}.md`, intent(ID));
put('queued', `${ID} (conflict 2).md`, 'never read');
put('queued', 'notes.txt', 'skipped');
put('queued', '.obsidian.md', intent(ID)); // a dotfile .md is still a regular .md file
fs.mkdirSync(path.join(root, 'queued', 'folder.md'));
fs.writeFileSync(path.join(work, 'outside.md'), intent(ID2));
fs.symlinkSync(path.join(work, 'outside.md'), path.join(root, 'queued', 'link.md'));
const claimedText = put('claimed', `${ID2}.md`, intent(ID2, { status: 'claimed' }));
put('rejected', 'r1.md', intent(ID, { rejected_reason: 'signature_invalid' }));
put('done', 'd1.md', intent(ID, { failure_reason: 'child_failed' }));

const deps = { hostname: 'exec-host', homedir: () => os.homedir(), vault };

// L2 — off the executor host: folder states only, links/dirs/non-md skipped.
// Red-making change: dropping `e.isFile()` from mdFiles (the link and folder.md are listed).
{
  const r = L.listIntents('all', deps);
  eq('L2 exit 0', r.exitCode, 0);
  eq('L2 paths (folder order, names sorted)', r.out.map((x) => x.path), [
    'inbox/intents/queued/.obsidian.md', `inbox/intents/queued/${ID} (conflict 2).md`, `inbox/intents/queued/${ID}.md`,
    `inbox/intents/claimed/${ID2}.md`, 'inbox/intents/done/d1.md', 'inbox/intents/rejected/r1.md',
  ]);
  check('L2 symlinked .md not listed', !r.out.some((x) => x.path.endsWith('link.md')));
  check('L2 directory named .md not listed', !r.out.some((x) => x.path.endsWith('folder.md')));
  check('L2 non-.md not listed', !r.out.some((x) => x.path.endsWith('.txt')));
  const byPath = Object.fromEntries(r.out.map((x) => [path.basename(x.path), x]));
  eq('L2 conflict copy is ignored, never read', byPath[`${ID} (conflict 2).md`], { path: `inbox/intents/queued/${ID} (conflict 2).md`, state: 'ignored', id: null, action: null, project: null, created_by: null, created_at: null, reason: null });
  eq('L2 queued row fields', byPath[`${ID}.md`], { path: `inbox/intents/queued/${ID}.md`, state: 'queued', id: ID, action: 'new-feature', project: 'demo', created_by: 'pixel-robert', created_at: '2026-10-08T08:00:00.000Z', reason: null });
  eq('L2 claimed stays claimed off the executor host', byPath[`${ID2}.md`].state, 'claimed');
  eq('L2 rejected reason', byPath['r1.md'].reason, 'signature_invalid');
  eq('L2 done reason', byPath['d1.md'].reason, 'child_failed');
  eq('L2 state filter', L.listIntents('rejected', deps).out.map((x) => path.basename(x.path)), ['r1.md']);
}

// L3 — operator errors: exit 2 with a usage line, no rows.
eq('L3 unknown state', L.listIntents('bogus', deps).exitCode, 2);
eq('L3 unset vault', L.listIntents('all', { ...deps, vault: null }).exitCode, 2);
eq('L3 missing folders are empty', L.listIntents('all', { ...deps, vault: path.join(work, 'empty-vault') }).out, []);

// L4 — on the executor host: claimed without a ledger row is tampered; a
// claimed file whose bytes match the ledger is not.
{
  const a1 = path.join(os.homedir(), '.a1-intents');
  fs.mkdirSync(a1, { recursive: true, mode: 0o700 });
  fs.chmodSync(a1, 0o700);
  fs.writeFileSync(path.join(a1, 'executor.json'), JSON.stringify({ executor_host: 'exec-host', executor_device: 'mac-robert' }), { mode: 0o600 });
  const ledger = path.join(os.homedir(), '.a1-intents-ledger.json');
  let r = L.listIntents('tampered', deps);
  eq('L4 claimed without a ledger row is tampered', r.out.map((x) => path.basename(x.path)), [`${ID2}.md`]);
  fs.writeFileSync(ledger, JSON.stringify({ rows: [{ id: ID2, claimed_sha256: sha(claimedText), finished_at: null }] }), { mode: 0o600 });
  r = L.listIntents('tampered', deps);
  eq('L4 claimed with matching hash is not tampered', r.out, []);
  put('claimed', `${ID2}.md`, `${claimedText}edited\n`);
  r = L.listIntents('tampered', deps);
  eq('L4 edited claimed file is tampered', r.out.map((x) => path.basename(x.path)), [`${ID2}.md`]);
  eq('L4 another host: no judgement', L.listIntents('tampered', { ...deps, hostname: 'laptop' }).out, []);
}

done();
