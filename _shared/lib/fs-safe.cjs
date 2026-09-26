'use strict';

// ---------------------------------------------------------------------------
// fs-safe — atomic writes and write containment (spec 010 Wave 5, security
// review MINOR 1). Split out of io.cjs, which re-exports every name, so no
// caller changes.
//
// Temp names are `<file>.tmp.<12 hex>` (random, so a symlink planted at a
// guessable name cannot catch the write) and are opened with 'wx'
// (O_CREAT|O_EXCL never follows a final symlink). The `.tmp.` prefix keeps
// them under the mirror exclude `*.tmp*`. Inside A1_VAULT_ROOT the nearest
// existing ancestor of the target must resolve inside the real vault root,
// so neither mkdir nor the write can escape through a linked folder.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TMP_SUFFIX_BYTES = 6;

/** `<file>.tmp.<12 hex>` — a fresh random temp path next to `file`. */
function tmpPathFor(file) {
  return `${file}.tmp.${crypto.randomBytes(TMP_SUFFIX_BYTES).toString('hex')}`;
}

function lexists(p) {
  try { fs.lstatSync(p); return true; } catch (_e) { return false; }
}

/** The closest path at or above `p` that exists (lstat — a dangling link counts). */
function nearestExistingAncestor(p) {
  let cur = path.resolve(p);
  while (!lexists(cur)) {
    const up = path.dirname(cur);
    if (up === cur) return cur;
    cur = up;
  }
  return cur;
}

function insideLexically(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/** Throws when `realRoot` is set and the nearest existing ancestor of `dir`
 * does not resolve inside it (a linked folder on the way out). */
function assertAncestorInside(dir, realRoot) {
  const anc = nearestExistingAncestor(dir);
  let real;
  try { real = fs.realpathSync(anc); } catch (e) { throw new Error(`refusing to write below an unresolvable link: ${anc} (${e.code})`); }
  if (!realRoot || !insideLexically(real, realRoot)) {
    throw new Error(`refusing to write through a link that leaves ${realRoot}: ${anc} -> ${real}`);
  }
}

/** The vault guard for the io writers: applies only to targets lexically
 * inside an existing A1_VAULT_ROOT; everything else is left alone. */
function assertVaultWriteContained(file) {
  const root = process.env.A1_VAULT_ROOT;
  if (!root) return;
  const lexRoot = path.resolve(root);
  if (!insideLexically(path.resolve(file), lexRoot)) return;
  let realRoot;
  try { realRoot = fs.realpathSync(lexRoot); } catch (_e) { return; }
  assertAncestorInside(path.dirname(path.resolve(file)), realRoot);
}

/** tmp (random, 'wx') + rename; the tmp is removed if the write fails. */
function writeViaTmp(file, content) {
  const tmp = tmpPathFor(file);
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_e) { /* never created */ }
    throw e;
  }
}

module.exports = { tmpPathFor, nearestExistingAncestor, assertAncestorInside, assertVaultWriteContained, writeViaTmp };
