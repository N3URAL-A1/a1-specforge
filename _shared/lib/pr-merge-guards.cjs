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
const CONFIG_KIND = 'config_change';
const CONFIG_RULE = 'fidelity-config';
// Files a merge-check run itself writes (both are git-excluded in a healthy checkout, but a repo that lost the exclude must not block).
const OWN_OUTPUT = Object.freeze([/^\.a1\/verify-cache(\/|$)/, /^\.a1\/phases\/[^/]+\/gate-log\.jsonl$/]);

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
 * SEC-1b (fidelity config, SEC-2 part): `.a1/fidelity.json` differing base..HEAD blocks the merge, because the config can switch rules off.
 * Cleared by an upheld, independently reviewed disposition of kind config_change on the exact head content,
 * or by `--accept-config-change <reason>`, which the report logs (`config_change_accepted`).
 * @returns {{reasons:object[], accepted:object[]}|null} null when git fails
 */
function fidelityConfigCheck(project, baseSha, entriesAtHead, acceptReason) {
  const baseText = gitText(project, ['show', `${baseSha}:${FIDELITY_REL}`]);
  const headText = gitText(project, ['show', `HEAD:${FIDELITY_REL}`]);
  if (baseText === headText) return { reasons: [], accepted: [] };
  const fingerprint = D.fingerprintOf(CONFIG_RULE, FIDELITY_REL, headText === null ? '' : headText);
  const cleared = entriesAtHead.some((e) => e.kind === CONFIG_KIND && e.fingerprint === fingerprint && e.review === 'upheld' && !D.isSelfReviewed(e));
  if (cleared) return { reasons: [], accepted: [] };
  if (acceptReason !== undefined) return { reasons: [], accepted: [{ file: FIDELITY_REL, fingerprint, reason: acceptReason }] };
  const change = baseText === null ? 'added' : (headText === null ? 'removed' : 'changed');
  return { reasons: [{ reason: 'fidelity_config_changed', file: FIDELITY_REL, change, fingerprint, hint: `disposition add --kind ${CONFIG_KIND} --fingerprint ${fingerprint} (reviewed by someone else) or pass --accept-config-change <reason>` }], accepted: [] };
}

module.exports = { SHA_RE, headReasons, dispositionsUncommitted, fidelityConfigCheck, statusPaths, CONFIG_KIND, CONFIG_RULE };
