'use strict';

// ---------------------------------------------------------------------------
// pr-merge-guards — the pinning checks of `pr merge-check` (spec 017 review
// round A: SEC-1/M1 head pinning, M2 uncommitted dispositions, SEC-3 self
// review, SEC-2 fidelity config). Pure over git + the working tree; every
// function returns reasons[] (or null when git itself fails, which the caller
// turns into exit 2). `pr-merge-check.cjs` composes them.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const D = require('./disposition-store.cjs');

const SHA_RE = /^[0-9a-f]{40}$/;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const FIDELITY_REL = '.a1/fidelity.json';
const PROBES_REL = '.a1/live-probes.yaml';
const A1_DIR = '.a1';
const CONFIG_KIND = 'config_change';
const CONFIG_RULE = 'fidelity-config';
/** Guarded config files: a change base..HEAD blocks the merge until a second reviewer upholds a config_change disposition (rule = fingerprint namespace). */
const CONFIG_GUARDS = [
  { rel: FIDELITY_REL, reason: 'fidelity_config_changed', rule: CONFIG_RULE },
  { rel: PROBES_REL, reason: 'probes_config_changed', rule: 'probes-config' },
];
// Files a merge-check run (or the a1-pr-review run before it) writes: the verify cache, the gate log and the review output dir
// `.a1-review/`. They are git-excluded in a healthy checkout, but a repo that lost the exclude must not block.
const OWN_OUTPUT = Object.freeze([/^\.a1\/verify-cache(\/|$)/, /^\.a1\/phases\/[^/]+\/gate-log\.jsonl$/, /^\.a1-review(\/|$)/]);

function gitText(project, args) {
  try {
    return execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: GIT_MAX_BUFFER, shell: false });
  } catch (_e) { return null; }
}

/** Paths `git status` lists (tracked changes and untracked files), -z parsed; null when git fails. */
function statusPaths(project) {
  const out = gitText(project, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (out === null) return null;
  const parts = out.split('\0');
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i++; // a rename/copy carries its origin as the next token
  }
  return paths;
}

/**
 * SEC-1: the commit that gets merged is the one that was checked.
 * Reason head_mismatch when local HEAD differs from the PR head gh reports, or when the tree holds changes
 * (cache/log of this run and .a1/dispositions.json, which has its own reason, are ignored).
 */
function headReasons(project, remoteHead) {
  const local = (gitText(project, ['rev-parse', '--verify', 'HEAD^{commit}']) || '').trim();
  if (!SHA_RE.test(local)) return null;
  const paths = statusPaths(project);
  if (paths === null) return null;
  const dirty = paths.filter((p) => p !== D.FILE_GIT && !OWN_OUTPUT.some((re) => re.test(p)));
  const reasons = [];
  if (local !== remoteHead) reasons.push({ reason: 'head_mismatch', cause: 'local_head_differs', local_head: local, pr_head: remoteHead });
  if (dirty.length > 0) reasons.push({ reason: 'head_mismatch', cause: 'dirty_tree', paths: dirty.slice(0, 20), count: dirty.length });
  return { local, reasons };
}

/** M2: the review verdicts that the committed-state checks read must be in HEAD, not only in the working tree. */
function dispositionsUncommitted(project) {
  const committed = gitText(project, ['show', `HEAD:${D.FILE_GIT}`]);
  let working = null;
  try { working = fs.readFileSync(path.join(project, D.FILE_GIT), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return committed === working ? [] : [{ reason: 'dispositions_uncommitted', file: D.FILE_GIT, hint: 'commit and push .a1/dispositions.json after `disposition review`, then run the merge check again' }];
}

/** Name folding a case/Unicode-insensitive filesystem may apply: NFKC, lower case, and the letters whose fold NFKC does not give. */
const fold = (name) => name.normalize('NFKC').toLowerCase().replace(/\u017f/g, 's').replace(/\u0131/g, 'i').replace(/\u212a/g, 'k');
const NON_ASCII_RE = /[^\u0000-\u007f]/;
const GITLINK = '160000';
const SYMLINK = '120000';

/**
 * Every tree entry under a top-level directory whose folded name is `.a1` (a case-insensitive checkout folds `.A1` onto `.a1`, APFS also
 * folds U+017F to s; NFKC covers compatibility forms), recursively, as { path, mode, sha, variant }.
 * A top-level `.a1` that is a symlink (120000) or a gitlink/submodule (160000) is returned as itself.
 * `variant` marks a name a folding filesystem could alias onto a guarded one: a non-ASCII top-level name that folds to `.a1`, and ANY
 * non-ASCII name directly under such a directory (the simple rule: no per-letter list, so no letter can be missed).
 * null when git fails (the caller blocks: an unreadable tree is not an unchanged one).
 */
function a1TreeEntries(project, rev) {
  const top = gitText(project, ['ls-tree', '-z', rev]);
  if (top === null) return null;
  const out = [];
  for (const rec of top.split('\0')) {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(rec);
    if (!m || fold(m[4]) !== A1_DIR) continue;
    const topVariant = NON_ASCII_RE.test(m[4]);
    if (m[1] === SYMLINK || m[1] === GITLINK) { out.push({ path: m[4], mode: m[1], sha: m[3], variant: topVariant }); continue; }
    if (m[2] !== 'tree') continue;
    if (topVariant) out.push({ path: m[4], mode: m[1], sha: m[3], variant: true });
    const sub = gitText(project, ['ls-tree', '-r', '-z', m[3]]);
    if (sub === null) return null;
    for (const r of sub.split('\0')) {
      const s2 = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(r);
      if (s2) out.push({ path: `${m[4]}/${s2[4]}`, mode: s2[1], sha: s2[3], variant: topVariant || NON_ASCII_RE.test(s2[4].split('/')[0]) });
    }
  }
  return out;
}

const SPECIAL_MODES = { [SYMLINK]: 'symlink', [GITLINK]: 'submodule' };

/** What one side (base or head) holds for a guarded file: matched paths (case-insensitive) with their blobs, and any special condition of `.a1` itself. */
function sideOf(project, rev, guard, entries) {
  const want = guard.rel.toLowerCase();
  const matched = entries.filter((e) => e.path.toLowerCase() === want).sort((x, y) => (x.path < y.path ? -1 : 1));
  const top = entries.find((e) => SPECIAL_MODES[e.mode] && fold(e.path) === A1_DIR);
  const variants = entries.filter((e) => e.variant).map((e) => e.path).sort();
  const special = top ? SPECIAL_MODES[top.mode] : (variants.length > 0 ? 'name_variant' : null);
  const texts = matched.map((e) => ({ path: e.path, mode: e.mode, text: gitText(project, ['cat-file', 'blob', e.sha]) }));
  return { rev, matched: texts, special, variants, key: JSON.stringify(texts.map((t) => [t.path, t.mode, t.text])) };
}

// Attributes that change what a checkout puts in the working tree (SEC-10): a `.gitattributes`-only change can make the loader read
// different bytes (or none) from an unchanged blob. `diff`/`merge`/`export-*` do not alter the checked-out bytes and are not read.
const CONTENT_ATTRS = ['text', 'eol', 'crlf', 'working-tree-encoding', 'filter', 'ident'];

/** Effective content attributes of `paths` at `rev` as a stable string ('' when none set). null when this git cannot tell (no --source). */
function attrKeyOf(project, rev, paths) {
  const out = gitText(project, ['check-attr', '-z', `--source=${rev}`, ...CONTENT_ATTRS, '--', ...paths]);
  if (out === null) return null;
  const f = out.split('\0');
  const set = [];
  for (let i = 0; i + 2 < f.length; i += 3) if (f[i + 2] !== 'unspecified') set.push(`${f[i]}\0${f[i + 1]}=${f[i + 2]}`);
  return set.sort().join('\n');
}

/** Fallback when --source is unsupported: the blobs of every .gitattributes that can apply (repo root and .a1/); any edit counts. */
function attrBlobKeyOf(project, rev) {
  return ['.gitattributes', `${A1_DIR}/.gitattributes`].map((f) => `${f}\0${gitText(project, ['show', `${rev}:${f}`]) || ''}`).join('\n');
}

/** Attribute keys of base and head for the guard's paths; both from the same method so the two sides stay comparable. */
function attrKeys(project, baseSha, guard, baseSide, headSide) {
  const paths = [...new Set([guard.rel, ...baseSide.matched.map((t) => t.path), ...headSide.matched.map((t) => t.path)])];
  const b = attrKeyOf(project, baseSha, paths);
  const h = attrKeyOf(project, 'HEAD', paths);
  if (b !== null && h !== null) return { base: b, head: h };
  return { base: attrBlobKeyOf(project, baseSha), head: attrBlobKeyOf(project, 'HEAD') };
}

/** Fingerprint text of the head side: the plain content when the exact path is the only match (unchanged from before), else path+mode+content of every match. */
function headFingerprintText(guard, head) {
  const plain = head.matched.length === 1 && head.matched[0].path === guard.rel && head.matched[0].mode !== SYMLINK && !head.special;
  if (plain) return head.matched[0].text === null ? '' : head.matched[0].text;
  if (head.matched.length === 0 && !head.special) return '';
  return `${head.special ? `${head.special}:.a1\n${head.variants.join('\n')}\n` : ''}${head.matched.map((t) => `${t.path}\0${t.mode}\0${t.text === null ? '' : t.text}`).join('\n')}`;
}

/**
 * SEC-1b (config files, SEC-2 part): a guarded config file (.a1/fidelity.json: it can switch rules off; .a1/live-probes.yaml: it names
 * the hosts live probes may reach, spec 020 FR-019) differing base..HEAD blocks the merge. Added, changed and deleted all count; a deleted
 * file fingerprints as empty content. Cleared only like verify_config_changed: by an upheld disposition of kind config_change (the guard's
 * rule) on the exact head content, reviewed by someone other than its author. There is no flag that clears it (a flag would let the caller
 * authorize its own change).
 * Spec 020 review round (SEC-1/SEC-2): the base and head trees are listed and every guarded path is matched case-insensitively, because
 * a case-insensitive checkout resolves `.a1/LIVE-PROBES.yaml` (or `.A1/...`) to the file the loader reads; and a symlinked `.a1` on either
 * side blocks outright, because the exact-path lookup then returns nothing on both sides while the loader follows the link.
 * @returns {{reasons:object[]}}
 */
function configChangeCheck(project, baseSha, entriesAtHead, guard, trees) {
  const [baseEntries, headEntries] = trees;
  const unreadable = baseEntries === null || headEntries === null;
  const base = unreadable ? { key: '', matched: [], special: null, variants: [] } : sideOf(project, baseSha, guard, baseEntries);
  const head = unreadable ? { key: '', matched: [], special: null, variants: [] } : sideOf(project, 'HEAD', guard, headEntries);
  const special = head.special || base.special;
  const attrs = unreadable ? { base: '', head: '' } : attrKeys(project, baseSha, guard, base, head);
  // An attribute change only matters while the guarded file exists on a side (no file, nothing for the loader to read).
  const attrsChanged = attrs.base !== attrs.head && (base.matched.length > 0 || head.matched.length > 0);
  if (!unreadable && !special && !attrsChanged && base.key === head.key) return { reasons: [] };
  // The attribute set is part of the fingerprint only when attributes changed, so the plain case keeps its golden fingerprint.
  const attrPart = attrsChanged ? `\nattributes:\n${attrs.head}` : '';
  const fingerprint = D.fingerprintOf(guard.rule, guard.rel, unreadable ? 'unreadable-tree' : headFingerprintText(guard, head) + attrPart);
  const cleared = entriesAtHead.some((e) => e.kind === CONFIG_KIND && e.fingerprint === fingerprint && e.review === 'upheld' && !D.isSelfReviewed(e));
  if (cleared) return { reasons: [] };
  let change = 'changed';
  if (unreadable) change = 'unreadable';
  else if (special) change = special;
  else if (base.matched.length === 0) change = 'added';
  else if (head.matched.length === 0) change = 'removed';
  if (change === 'changed' && attrsChanged && base.key === head.key) change = 'attributes';
  const file = !unreadable && !special && head.matched.length > 0 ? head.matched.map((t) => t.path).join(', ') : (!unreadable && !special && base.matched.length > 0 ? base.matched.map((t) => t.path).join(', ') : guard.rel);
  return { reasons: [{ reason: guard.reason, file, change, fingerprint, hint: `disposition add --kind ${CONFIG_KIND} --fingerprint ${fingerprint} --reason <why> --by <you>; a second reviewer runs disposition review ${fingerprint} --verdict upheld --by <reviewer>; commit and push .a1/dispositions.json; run the merge check again` }] };
}

/** All guarded config files in table order (fidelity first, so the existing reason order is unchanged). */
function configChangeChecks(project, baseSha, entriesAtHead) {
  const trees = [a1TreeEntries(project, baseSha), a1TreeEntries(project, 'HEAD')];
  return { reasons: CONFIG_GUARDS.flatMap((guard) => configChangeCheck(project, baseSha, entriesAtHead, guard, trees).reasons) };
}

module.exports = { SHA_RE, headReasons, dispositionsUncommitted, configChangeChecks, statusPaths, CONFIG_KIND, CONFIG_RULE };
