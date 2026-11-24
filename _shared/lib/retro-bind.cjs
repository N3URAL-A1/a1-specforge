'use strict';

// ---------------------------------------------------------------------------
// retro-bind — the binding of `retro validate --defer-to-machine <spec>#<pr>` (review round 2, root cause B).
// A prose retro with `retro_of` and no `gates_fired` may skip the blocking-fail check only because `feature close` will write the
// machine entry that carries the run's gates. The old rule inferred that from names (--phase, a pr-<n> log path), which a
// standalone a1-pr-review (retro_of pr-7#7) or an a1-fix run (fix-bug1#7) satisfied with no carrier ever written. Now the caller
// says so with the flag, and the claim must hold on disk:
//   1. the flag equals the block's retro_of; <spec> is not `pr-<n>`
//   2. `.a1/reservations.json` (the primary checkout: the root itself, or the parent of the git common dir when run from a worktree; a worktree's copy is a stale snapshot) holds a `code_scope` entry
//      with by == <spec> (the reservation is released by `feature close`, which runs after the prose retro: 05-merge item 3)
//   3. one --gate-log resolves (realpath) to <root>/.a1/phases/<spec>/gate-log.jsonl and one to <root>/.a1/phases/pr-<pr>/gate-log.jsonl,
//      with <root> the realpath of the repo root: a log outside the root or reached through a link does not count
// Pure decisions; the only effects are reads (fs.realpathSync, the reservations file, one `git rev-parse`).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadReservations, reservationsFile } = require('./locks.cjs');

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*#[1-9][0-9]*$/;
const PR_SPEC_RE = /^pr-[0-9]+$/;
const LOG_NAME = 'gate-log.jsonl';

const GIT_ENV_DROP = ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];

/**
 * The checkout whose `.a1/reservations.json` counts: the root itself when it is the primary checkout (or no git repo), else the
 * parent of the git common dir. A worktree's own copy is a stale committed snapshot and is never read. `--git-common-dir` is resolved
 * against the cwd (no `--path-format=absolute`, git >= 2.31); git runs with the repo-pointing env vars dropped.
 * @returns {string|null} null when there is no primary checkout (a bare common dir)
 */
function primaryRoot(root) {
  const env = { ...process.env };
  for (const k of GIT_ENV_DROP) delete env[k];
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', env });
  const out = r.status === 0 ? r.stdout.trim() : '';
  if (out === '') return root;
  const common = real(path.resolve(root, out));
  if (common === null || path.basename(common) !== '.git') return null;
  return path.dirname(common);
}

/** @returns {boolean} the primary checkout's reservations file holds a code_scope entry of `spec` (unreadable or malformed holds none) */
function holdsScope(root, spec) {
  const primary = primaryRoot(root);
  if (primary === null) return false;
  const list = loadReservations(reservationsFile({ file: path.join(primary, '.a1', 'reservations.json') })).reservations;
  return list.some((x) => x && x.type === 'code_scope' && x.by === spec);
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
  if (!holdsScope(rootReal, spec)) return `no code_scope reservation by ${spec} in the primary checkout`;
  const have = new Set(paths.map(real).filter((p) => p !== null));
  for (const scope of [spec, `pr-${pr}`]) {
    const want = path.join(rootReal, '.a1', 'phases', scope, LOG_NAME);
    if (!have.has(want)) return `no --gate-log resolves to ${path.join('.a1', 'phases', scope, LOG_NAME)} under the repo root (realpath, no links)`;
  }
  return null;
}

module.exports = { bindingProblem };
