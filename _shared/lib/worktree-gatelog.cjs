'use strict';

// ---------------------------------------------------------------------------
// worktree-gatelog (spec 028, FR-011). `worktree exit --mode keep|discard` deletes the worktree, and
// the gate log under `.a1/phases/<scope>/` is gitignored, so it dies with it. These helpers name the
// scopes whose log has no line in the learning-store runs file, i.e. a log `run record` has not kept.
// Read-only: nothing here writes, creates a directory or takes a lock.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { SCOPE_RE, UNSCOPED } = require('./gate-log.cjs');
const { repoProjectSlug } = require('./project-slug.cjs');

/**
 * @param {string} worktreePath
 * @returns {string[]} scopes whose gate-log.jsonl is a regular, non-empty file (sorted); the
 *   `_unscoped` bucket is skipped: it holds calls made without --phase and has no run to record
 */
function listGateLogs(worktreePath) {
  const phases = path.join(worktreePath, '.a1', 'phases');
  let names;
  try { names = fs.readdirSync(phases); } catch (_e) { return []; }
  return names
    .filter((name) => name !== UNSCOPED && SCOPE_RE.test(name) && !name.includes('..'))
    .filter((name) => {
      try {
        const st = fs.lstatSync(path.join(phases, name, 'gate-log.jsonl'));
        return st.isFile() && st.size > 0;
      } catch (_e) { return false; }
    })
    .sort();
}

/** @returns {Set<string>} scopes that have a line in <storeDir>/_runs/<project>.jsonl (empty when unreadable) */
function recordedScopes(worktreePath, storeDir) {
  const project = repoProjectSlug(worktreePath);
  const seen = new Set();
  if (project === null) return seen; // unsafe checkout name: nothing is recorded (the exit then refuses, fail closed)
  const file = path.join(storeDir, '_runs', `${project}.jsonl`);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_e) { return seen; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec.scope === 'string') seen.add(rec.scope);
    } catch (_e) { /* a damaged line records nothing */ }
  }
  return seen;
}

/**
 * @param {string} worktreePath
 * @param {string} storeDir - the learning-store directory (pattern/a1-learnings)
 * @returns {string[]} scopes with a non-empty gate log and no run record
 */
function unpreservedScopes(worktreePath, storeDir) {
  const scopes = listGateLogs(worktreePath);
  if (scopes.length === 0) return [];
  const recorded = recordedScopes(worktreePath, storeDir);
  return scopes.filter((scope) => !recorded.has(scope));
}

module.exports = { listGateLogs, unpreservedScopes };
