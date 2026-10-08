'use strict';

// xprov-denials.cjs — the owner-only permit-denial store (spec 012 D1).
// A denial may only count when the guarded store holds it, so every unusable
// store must read as "not ok" — and never as "missing" (no store yet).
// HOME is the suite's temp home, so ~/.a1-xprov is a throwaway directory.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { check, eq, done } = require('../lib.cjs');

const D = require(path.join(process.argv[2], 'xprov-denials.cjs'));
const home = path.join(os.homedir(), '.a1-xprov');
// D0 — refuse to run against a real home: everything below writes ~/.a1-xprov.
if (!process.argv[3] || !os.homedir().startsWith(process.argv[3])) {
  check('D0 HOME is the suite temp home', false, `${os.homedir()} (run through run-tests.sh)`);
  done();
  process.exit(1);
}

const entry = { decided_by: 'robert', decided_on: '2026-10-05', ts: '2026-10-05T10:00:00Z' };
const doc = (denials) => ({ version: 1, denials });

// D1 — a well-formed document parses to its map, entries frozen.
{
  const m = D.parseDenialsDoc(doc({ '/repo/.git': entry }));
  eq('D1 parse valid doc', m, { '/repo/.git': entry });
  check('D1 entries are frozen', Object.isFrozen(m['/repo/.git']));
  eq('D1 empty denials map', D.parseDenialsDoc(doc({})), {});
}

// D2 — every off-format shape is refused (null).
// Red-making change: dropping the per-entry exactKeys check in parseDenialsDoc.
const off = {
  'extra top-level key': { version: 1, denials: {}, note: 'x' },
  'version 2': { version: 2, denials: {} },
  'version as string': { version: '1', denials: {} },
  'denials is an array': { version: 1, denials: [] },
  'denials is null': { version: 1, denials: null },
  'entry missing ts': doc({ k: { decided_by: 'r', decided_on: 'd' } }),
  'entry extra key': doc({ k: { ...entry, by: 'agent' } }),
  'entry empty string': doc({ k: { ...entry, decided_by: '' } }),
  'entry non-string': doc({ k: { ...entry, ts: 1759658400 } }),
  'entry is an array': doc({ k: ['robert'] }),
  'document is an array': [],
  'document is null': null,
};
for (const [name, d] of Object.entries(off)) eq(`D2 ${name}: refused`, D.parseDenialsDoc(d), null);

// D3 — withDenial adds, replaces and removes without touching its input.
{
  const before = { a: entry };
  const added = D.withDenial(before, 'b', entry);
  eq('D3 add', Object.keys(added).sort(), ['a', 'b']);
  eq('D3 replace', D.withDenial(added, 'a', { ...entry, decided_by: 'x' }).a.decided_by, 'x');
  eq('D3 remove (null)', D.withDenial(added, 'a', null), { b: entry });
  eq('D3 remove an absent key is a no-op', D.withDenial(before, 'zzz', null), { a: entry });
  eq('D3 input unchanged', before, { a: entry });
}

eq('D4 store path under ~/.a1-xprov', D.denialsPath(), path.join(home, 'permit-denials.json'));

// D5 — no store yet: missing, no denials.
{
  const r = D.readDenials();
  eq('D5 no ~/.a1-xprov: missing', { ok: r.ok, missing: r.missing, denials: r.denials }, { ok: false, missing: true, denials: {} });
}

// D6 — write then read round-trips; modes 0700 / 0600.
{
  const p = D.writeDenials({ '/repo/.git': entry });
  eq('D6 writeDenials returns the store path', p, D.denialsPath());
  eq('D6 store dir is 0700', fs.statSync(home).mode & 0o777, 0o700);
  eq('D6 store file is 0600', fs.statSync(p).mode & 0o777, 0o600);
  const r = D.readDenials();
  eq('D6 read back', { ok: r.ok, denials: r.denials }, { ok: true, denials: { '/repo/.git': entry } });
  const r2 = D.readDenials();
  check('D6 no tmp files left in the store dir', fs.readdirSync(home).every((n) => !n.endsWith('.tmp')) && r2.ok);
}

// D7 — unusable stores: not ok AND not missing, so a caller can tell
// "broken" from "no denial" (an unusable store is never overwritten).
// Red-making change: readGuardedStore returning `missing: true` for every failure.
const unusable = (name, setup, teardown) => {
  setup();
  const r = D.readDenials();
  eq(`D7 ${name}: unusable, not missing`, { ok: r.ok, missing: r.missing, denials: r.denials }, { ok: false, missing: false, denials: {} });
  teardown();
};
const p = D.denialsPath();
const good = fs.readFileSync(p, 'utf8');
unusable('store file 0644', () => fs.chmodSync(p, 0o644), () => fs.chmodSync(p, 0o600));
unusable('store dir 0755', () => fs.chmodSync(home, 0o755), () => fs.chmodSync(home, 0o700));
unusable('off-format content', () => fs.writeFileSync(p, JSON.stringify({ version: 2, denials: {} })), () => fs.writeFileSync(p, good));
unusable('not JSON', () => fs.writeFileSync(p, '{"version": 1, "denials": '), () => fs.writeFileSync(p, good));
unusable('duplicate key in JSON', () => fs.writeFileSync(p, '{"version": 1, "version": 1, "denials": {}}'), () => fs.writeFileSync(p, good));
{
  const real = path.join(process.argv[3], 'elsewhere.json');
  fs.writeFileSync(real, good, { mode: 0o600 });
  unusable('store file is a symlink', () => { fs.unlinkSync(p); fs.symlinkSync(real, p); }, () => { fs.unlinkSync(p); fs.writeFileSync(p, good, { mode: 0o600 }); });
}
{
  const realHome = path.join(process.argv[3], 'xprov-real');
  unusable('~/.a1-xprov is a symlink', () => { fs.renameSync(home, realHome); fs.symlinkSync(realHome, home); }, () => { fs.unlinkSync(home); fs.renameSync(realHome, home); });
}
check('D7 the store is usable again after the cases', D.readDenials().ok === true);

done();
