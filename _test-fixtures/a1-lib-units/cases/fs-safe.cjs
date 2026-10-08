'use strict';

// fs-safe.cjs — atomic writes and the vault write containment (spec 010
// Wave 5, security review MINOR 1).

const fs = require('fs');
const path = require('path');
const { check, eq, throws, noThrow, done } = require('../lib.cjs');

const S = require(path.join(process.argv[2], 'fs-safe.cjs'));
const work = fs.mkdtempSync(path.join(process.argv[3], 'fs-'));
const tmpLeft = (dir) => fs.readdirSync(dir).filter((n) => n.includes('.tmp.'));

// F1 — temp names are `<file>.tmp.<12 hex>` and random per call.
{
  const a = S.tmpPathFor('/x/y.md');
  const b = S.tmpPathFor('/x/y.md');
  check('F1 tmpPathFor shape', /^\/x\/y\.md\.tmp\.[0-9a-f]{12}$/.test(a), a);
  check('F1 tmpPathFor random', a !== b);
}

// F2 — nearest existing ancestor; a dangling link counts as existing (lstat).
{
  const d = path.join(work, 'f2');
  fs.mkdirSync(d);
  eq('F2 nearestExistingAncestor of a missing subtree', S.nearestExistingAncestor(path.join(d, 'a', 'b', 'c')), d);
  fs.symlinkSync(path.join(work, 'nowhere'), path.join(d, 'dangling'));
  eq('F2 a dangling link is the ancestor', S.nearestExistingAncestor(path.join(d, 'dangling', 'x')), path.join(d, 'dangling'));
}

// F3 — writeViaTmp writes the content and leaves no temp file.
{
  const d = path.join(work, 'f3');
  fs.mkdirSync(d);
  const f = path.join(d, 'note.md');
  S.writeViaTmp(f, 'one\n');
  S.writeViaTmp(f, 'two\n');
  eq('F3 writeViaTmp content', fs.readFileSync(f, 'utf8'), 'two\n');
  eq('F3 writeViaTmp leaves no tmp', tmpLeft(d), []);
}

// F4 — a failed rename (target is a directory) throws and removes the tmp.
// Red-making change: dropping the unlinkSync(tmp) in the catch of writeViaTmp.
{
  const d = path.join(work, 'f4');
  fs.mkdirSync(path.join(d, 'target'), { recursive: true });
  throws('F4 writeViaTmp onto a directory throws', () => S.writeViaTmp(path.join(d, 'target'), 'x'), /EISDIR|directory|not empty|EEXIST|ENOTEMPTY/i);
  eq('F4 failed write leaves no tmp', tmpLeft(d), []);
}

// F5 — a symlink at the target is replaced, never written through.
{
  const d = path.join(work, 'f5');
  fs.mkdirSync(d);
  const victim = path.join(work, 'f5-victim.txt');
  fs.writeFileSync(victim, 'secret\n');
  fs.symlinkSync(victim, path.join(d, 'out.md'));
  S.writeViaTmp(path.join(d, 'out.md'), 'new\n');
  eq('F5 link target untouched', fs.readFileSync(victim, 'utf8'), 'secret\n');
  check('F5 target is now a regular file', fs.lstatSync(path.join(d, 'out.md')).isFile());
}

// Vault containment. Layout: <work>/v/vault (the vault), <work>/v/outside,
// <work>/v/vault-evil (a sibling sharing the vault's name as a prefix).
const v = path.join(work, 'v');
const vault = path.join(v, 'vault');
const outside = path.join(v, 'outside');
const evil = path.join(v, 'vault-evil');
for (const d of [path.join(vault, 'real', 'sub'), outside, evil]) fs.mkdirSync(d, { recursive: true });
fs.symlinkSync(outside, path.join(vault, 'linked'));
fs.symlinkSync(evil, path.join(vault, 'prefix-link'));
fs.symlinkSync(path.join(v, 'gone'), path.join(vault, 'dangling'));
fs.symlinkSync(vault, path.join(v, 'vault-alias'));

const withVault = (root, fn) => {
  const before = process.env.A1_VAULT_ROOT;
  if (root === undefined) delete process.env.A1_VAULT_ROOT; else process.env.A1_VAULT_ROOT = root;
  try { return fn(); } finally { if (before === undefined) delete process.env.A1_VAULT_ROOT; else process.env.A1_VAULT_ROOT = before; }
};

// F6 — no A1_VAULT_ROOT: the guard is off, even through a link.
withVault(undefined, () => noThrow('F6 no vault root: no check', () => S.assertVaultWriteContained(path.join(vault, 'linked', 'x.md'))));
// F7 — a target outside the vault is left alone.
withVault(vault, () => noThrow('F7 target outside the vault: no check', () => S.assertVaultWriteContained(path.join(outside, 'x.md'))));
// F8 — a plain target inside the vault, also below folders that do not exist yet.
withVault(vault, () => noThrow('F8 plain vault target', () => S.assertVaultWriteContained(path.join(vault, 'real', 'sub', 'new', 'deep', 'x.md'))));
// F9 — a linked folder that leaves the vault is refused.
// Red-making change: making assertVaultWriteContained return before assertAncestorInside.
withVault(vault, () => throws('F9 link out of the vault refused', () => S.assertVaultWriteContained(path.join(vault, 'linked', 'new', 'x.md')), /refusing to write through a link that leaves/));
// F10 — a dangling link on the way is refused (cannot be resolved).
withVault(vault, () => throws('F10 dangling link refused', () => S.assertVaultWriteContained(path.join(vault, 'dangling', 'x.md')), /unresolvable link/));
// F11 — a link to a sibling whose name starts with the vault's name is refused.
// Red-making change: insideLexically testing `startsWith(root)` without `+ path.sep`.
withVault(vault, () => throws('F11 prefix-sibling link refused', () => S.assertVaultWriteContained(path.join(vault, 'prefix-link', 'x.md')), /leaves/));
// F12 — a vault root that is itself a link is judged by its real path.
withVault(path.join(v, 'vault-alias'), () => noThrow('F12 linked vault root: inside target ok', () => S.assertVaultWriteContained(path.join(v, 'vault-alias', 'real', 'x.md'))));
withVault(path.join(v, 'vault-alias'), () => throws('F12 linked vault root: escape still refused', () => S.assertVaultWriteContained(path.join(v, 'vault-alias', 'linked', 'x.md')), /leaves/));
// F13 — a configured vault root that does not exist: nothing to contain.
withVault(path.join(v, 'missing-vault'), () => noThrow('F13 missing vault root: no check', () => S.assertVaultWriteContained(path.join(v, 'missing-vault', 'x.md'))));
// F14 — assertAncestorInside without a real root refuses (fail closed).
throws('F14 assertAncestorInside without a root refuses', () => S.assertAncestorInside(path.join(vault, 'real'), ''), /refusing/);

done();
