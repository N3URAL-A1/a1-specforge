'use strict';

// ---------------------------------------------------------------------------
// retro-bind — the binding of `retro validate --defer-to-machine <spec>#<pr>` (review round 2, root cause B).
// A prose retro with `retro_of` and no `gates_fired` may skip the blocking-fail check only because `feature close` will write the
// machine entry that carries the run's gates. The old rule inferred that from names (--phase, a pr-<n> log path), which a
// standalone a1-pr-review (retro_of pr-7#7) or an a1-fix run (fix-bug1#7) satisfied with no carrier ever written. Now the caller
// says so with the flag, and the claim must hold on disk:
//   1. the flag equals the block's retro_of; <spec> is not `pr-<n>`
//   2. `.a1/reservations.json` (this repo root, or the primary checkout when run from a worktree) holds a `code_scope` entry
//      with by == <spec> (the reservation is released by `feature close`, which runs after the prose retro: 05-merge item 3)
//   3. one --gate-log resolves (realpath) to <root>/.a1/phases/<spec>/gate-log.jsonl and one to <root>/.a1/phases/pr-<pr>/gate-log.jsonl,
//      with <root> the realpath of the repo root: a log outside the root or reached through a link does not count
// Pure decisions; the only effects are reads (fs.realpathSync, the reservations file, one `git rev-parse`).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*#[1-9][0-9]*$/;
const PR_SPEC_RE = /^pr-[0-9]+$/;
const LOG_NAME = 'gate-log.jsonl';

/** @returns {string[]} the repo root and, from a worktree, the primary checkout that holds the shared `.a1/reservations.json` */
function reservationRoots(root) {
  const roots = [root];
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim() !== '' && path.basename(r.stdout.trim()) === '.git') roots.push(path.dirname(r.stdout.trim()));
  return roots;
}

/** @returns {boolean} some reservations file holds a code_scope entry of `spec` (an unreadable or malformed file holds none) */
function holdsScope(roots, spec) {
  return roots.some((r) => {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(r, '.a1', 'reservations.json'), 'utf8')).reservations;
      return Array.isArray(list) && list.some((x) => x && x.type === 'code_scope' && x.by === spec);
    } catch (_e) { return false; }
  });
}

function real(p) {
  try { return fs.realpathSync(p); } catch (_e) { return null; }
}

/**
 * @param {string} key the block's retro_of (already shape-checked)
 * @param {{defer: string|null, paths: string[], root: string}} ctx
 * @returns {string|null} why the key is not bound to this run, else null
 */
function bindingProblem(key, { defer, paths, root }) {
  if (defer === null) return 'retro_of needs --defer-to-machine ' + key + ' (only the a1-new-feature close-out prose retro passes it); without it the blocking fails must be named';
  if (!KEY_RE.test(defer)) return '--defer-to-machine must be <spec>#<pr>, e.g. 027-lean-pipeline#115';
  if (defer !== key) return `--defer-to-machine ${defer} does not equal retro_of ${key}`;
  const at = key.lastIndexOf('#');
  const spec = key.slice(0, at);
  const pr = key.slice(at + 1);
  if (PR_SPEC_RE.test(spec)) return `retro_of names ${spec}, a PR review scope, not an a1-new-feature spec: its gates have no machine entry to defer to`;
  const rootReal = real(root);
  if (rootReal === null) return 'the repo root cannot be resolved';
  if (!holdsScope(reservationRoots(rootReal), spec)) return `no code_scope reservation of ${spec} in .a1/reservations.json: feature close has no run to record for it`;
  const have = new Set(paths.map(real).filter((p) => p !== null));
  for (const scope of [spec, `pr-${pr}`]) {
    const want = path.join(rootReal, '.a1', 'phases', scope, LOG_NAME);
    if (!have.has(want)) return `no --gate-log resolves to ${path.join('.a1', 'phases', scope, LOG_NAME)} under the repo root (realpath, no links)`;
  }
  return null;
}

module.exports = { bindingProblem };
