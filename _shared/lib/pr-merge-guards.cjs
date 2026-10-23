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

/**
 * Every tree entry under a top-level directory whose name equals `.a1` case-insensitively (a case-insensitive checkout folds
 * `.A1` onto `.a1`), recursively, as { path, mode, sha }; a top-level `.a1` that is a symlink (mode 120000) is returned as itself.
 * null when git fails (the caller blocks: an unreadable tree is not an unchanged one).
 */
function a1TreeEntries(project, rev) {
  const top = gitText(project, ['ls-tree', '-z', rev]);
  if (top === null) return null;
  const out = [];
  for (const rec of top.split('\0')) {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(rec);
    if (!m || m[4].toLowerCase() !== A1_DIR) continue;
    if (m[1] === '120000') { out.push({ path: m[4], mode: m[1], sha: m[3] }); continue; }
    if (m[2] !== 'tree') continue;
    const sub = gitText(project, ['ls-tree', '-r', '-z', m[3]]);
    if (sub === null) return null;
    for (const r of sub.split('\0')) {
      const s2 = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(r);
      if (s2) out.push({ path: `${m[4]}/${s2[4]}`, mode: s2[1], sha: s2[3] });
    }
  }
  return out;
}

/** What one side (base or head) holds for a guarded file: matched paths (case-insensitive) with their blobs, and whether `.a1` is a symlink. */
function sideOf(project, rev, guard, entries) {
  const want = guard.rel.toLowerCase();
  const matched = entries.filter((e) => e.path.toLowerCase() === want).sort((x, y) => (x.path < y.path ? -1 : 1));
  const symlinked = entries.some((e) => e.mode === '120000' && e.path.toLowerCase() === A1_DIR);
  const texts = matched.map((e) => ({ path: e.path, mode: e.mode, text: gitText(project, ['cat-file', 'blob', e.sha]) }));
  return { rev, matched: texts, symlinked, key: JSON.stringify(texts.map((t) => [t.path, t.mode, t.text])) };
}

/** Fingerprint text of the head side: the plain content when the exact path is the only match (unchanged from before), else path+mode+content of every match. */
function headFingerprintText(guard, head) {
  const plain = head.matched.length === 1 && head.matched[0].path === guard.rel && head.matched[0].mode !== '120000' && !head.symlinked;
  if (plain) return head.matched[0].text === null ? '' : head.matched[0].text;
  if (head.matched.length === 0 && !head.symlinked) return '';
  return `${head.symlinked ? 'symlink:.a1\n' : ''}${head.matched.map((t) => `${t.path}\0${t.mode}\0${t.text === null ? '' : t.text}`).join('\n')}`;
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
  const base = unreadable ? { key: '', matched: [], symlinked: false } : sideOf(project, baseSha, guard, baseEntries);
  const head = unreadable ? { key: '', matched: [], symlinked: false } : sideOf(project, 'HEAD', guard, headEntries);
  const symlinked = base.symlinked || head.symlinked;
  if (!unreadable && !symlinked && base.key === head.key) return { reasons: [] };
  const fingerprint = D.fingerprintOf(guard.rule, guard.rel, unreadable ? 'unreadable-tree' : headFingerprintText(guard, head));
  const cleared = entriesAtHead.some((e) => e.kind === CONFIG_KIND && e.fingerprint === fingerprint && e.review === 'upheld' && !D.isSelfReviewed(e));
  if (cleared) return { reasons: [] };
  let change = 'changed';
  if (unreadable) change = 'unreadable';
  else if (symlinked) change = 'symlink';
  else if (base.matched.length === 0) change = 'added';
  else if (head.matched.length === 0) change = 'removed';
  const file = !unreadable && !symlinked && head.matched.length > 0 ? head.matched.map((t) => t.path).join(', ') : (!unreadable && !symlinked && base.matched.length > 0 ? base.matched.map((t) => t.path).join(', ') : guard.rel);
  return { reasons: [{ reason: guard.reason, file, change, fingerprint, hint: `disposition add --kind ${CONFIG_KIND} --fingerprint ${fingerprint} --reason <why> --by <you>; a second reviewer runs disposition review ${fingerprint} --verdict upheld --by <reviewer>; commit and push .a1/dispositions.json; run the merge check again` }] };
}

/** All guarded config files in table order (fidelity first, so the existing reason order is unchanged). */
function configChangeChecks(project, baseSha, entriesAtHead) {
  const trees = [a1TreeEntries(project, baseSha), a1TreeEntries(project, 'HEAD')];
  return { reasons: CONFIG_GUARDS.flatMap((guard) => configChangeCheck(project, baseSha, entriesAtHead, guard, trees).reasons) };
}

module.exports = { SHA_RE, headReasons, dispositionsUncommitted, configChangeChecks, statusPaths, CONFIG_KIND, CONFIG_RULE };
