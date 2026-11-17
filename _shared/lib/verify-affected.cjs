'use strict';

// `verify run --affected` selection (spec 027 slice 2, FR-006). Pure selection (`selectAffected`) plus
// the thin IO helpers around it. The map in `.a1/verify.json` (`affected`, `smoke`) is measured by
// `verify affected-map`; nothing here guesses. Every doubt falls back to the FULL set.
//
// Rules, first match decides (D3): 1 no map -> full; 2 no diff base -> full (caller passes changed:null);
// 3 empty change set; 4 deleted path; 5 runner/config path; 6 unmapped path (also for literal requirers);
// 7 a selector that matches no plan command; 8 subset.

const fs = require('fs');
const path = require('path');
const { gitRaw, splitNul } = require('./verify-check.cjs');
const { VerifyError } = require('./verify-base.cjs');

const HARD_FULL_PATHS = Object.freeze([
  'bin/run-suites.sh', 'bin/run-suites-proc.sh', 'bin/run-suites-report.sh',
  '_test-fixtures/suite-groups.json', '.a1/verify.json', '_shared/a1-tools.cjs',
]);
const MAX_KEYS = 2000;
const MAX_SELECTORS = 500;
const MAX_KEY_LEN = 300;
const MAX_DECIDING_PATHS = 5;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const FACADE = '_shared/a1-tools.cjs';
const SELECTOR_RE = /^[A-Za-z0-9._/-]{1,300}$/;

function hasDotDot(s) { return s.split('/').includes('..'); }

function badConfig(msg) { return new VerifyError('bad_config', `.a1/verify.json: ${msg}`); }

function validateSelectors(list, what) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SELECTORS) throw badConfig(`${what} must be a non-empty array of at most ${MAX_SELECTORS} selectors`);
  for (const s of list) {
    if (typeof s !== 'string' || !SELECTOR_RE.test(s) || hasDotDot(s)) throw badConfig(`${what} has an invalid selector ${JSON.stringify(String(s).slice(0, 80))}`);
  }
  return list.slice();
}

/**
 * Validates `affected` and `smoke` (D4). Runs only on the --affected path and in `verify affected-map --check`.
 * @param {object} cfg parsed .a1/verify.json
 * @returns {null|{keys: Array<[string, string[]]>, smoke: string[]}} null when `affected` or `smoke` is absent;
 *   `keys` are [path prefix, selectors] pairs sorted by prefix; `smoke` the always-selected selectors.
 * @throws {VerifyError} bad_config on any D4 violation (the message names the key)
 */
function validateAffectedConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || cfg.affected === undefined || cfg.smoke === undefined) return null;
  const a = cfg.affected;
  if (a === null || typeof a !== 'object' || Array.isArray(a)) throw badConfig('affected must be an object');
  const names = Object.keys(a);
  if (names.length > MAX_KEYS) throw badConfig(`affected has more than ${MAX_KEYS} keys`);
  const keys = names.sort().map((k) => {
    if (k.length < 1 || k.length > MAX_KEY_LEN || k.startsWith('/') || k.includes('\0') || hasDotDot(k)) {
      throw badConfig(`affected has an invalid key ${JSON.stringify(k.slice(0, 80))}`);
    }
    return [k, validateSelectors(a[k], `affected[${JSON.stringify(k.slice(0, 80))}]`)];
  });
  return { keys, smoke: validateSelectors(cfg.smoke, 'smoke') };
}

/**
 * @param {string} selector exact command id, or a prefix ending in `/`
 * @param {string} id command id
 * @returns {boolean} true when the selector selects the id
 */
function selectorMatches(selector, id) {
  return selector === id || (selector.endsWith('/') && id.startsWith(selector));
}

/**
 * Changed paths: committed diff against the merge-base (both sides of a rename, `--no-renames`) plus working-tree paths.
 * @param {string} project repo root
 * @param {string|null} baseSha merge-base sha
 * @param {string[]} statusPaths working-tree changed paths, passed by the caller
 * @returns {string[]|null} de-duplicated union, or null when there is no base or git cannot tell
 */
function affectedChanges(project, baseSha, statusPaths) {
  if (!baseSha) return null;
  const names = splitNul(gitRaw(project, ['diff', '--name-only', '-z', '--no-renames', baseSha, 'HEAD', '--']));
  if (names === null) return null;
  return Array.from(new Set([...names, ...(Array.isArray(statusPaths) ? statusPaths : [])]));
}

const REQ_REL = /require\(\s*(['"])(\.{1,2}\/[^'"\n]*)\1\s*\)/g;
const REQ_JOIN = /require\(\s*path\.join\(\s*__dirname\s*((?:,\s*(['"])[^'"\n]*\2\s*)*)\)\s*\)/g;
const LIT = /(['"])([^'"\n]*)\1/g;

function resolveTracked(tracked, rel) {
  if (rel.startsWith('..')) return null;
  for (const cand of [rel, `${rel}.cjs`, `${rel}.js`]) if (tracked.has(cand)) return cand;
  return null;
}

function requiredBy(project, tracked, file) {
  let src;
  try {
    const abs = path.join(project, file);
    if (fs.statSync(abs).size > MAX_SOURCE_BYTES) return [];
    src = fs.readFileSync(abs, 'utf8');
  } catch (_e) { return []; }
  const dir = path.posix.dirname(file);
  const out = [];
  for (const m of src.matchAll(REQ_REL)) out.push(resolveTracked(tracked, path.posix.normalize(path.posix.join(dir, m[2]))));
  for (const m of src.matchAll(REQ_JOIN)) {
    const lits = Array.from(m[1].matchAll(LIT), (x) => x[2]);
    out.push(resolveTracked(tracked, path.posix.normalize(path.posix.join(dir, ...lits))));
  }
  return out.filter((x) => x !== null);
}

/**
 * Transitive literal requirers (D6) over EVERY tracked *.cjs / *.js file. The facade is never a requirer.
 * @param {string} project repo root
 * @param {string[]} files changed repo-relative paths
 * @returns {Map<string, Set<string>>} file -> set of files that (transitively) require it; one entry per input file
 */
function literalRequirers(project, files) {
  const listed = splitNul(gitRaw(project, ['ls-files', '-z', '--', '*.cjs', '*.js'])) || [];
  const tracked = new Set(listed);
  const direct = new Map();
  for (const f of listed) {
    if (f === FACADE) continue;
    for (const target of requiredBy(project, tracked, f)) {
      if (!direct.has(target)) direct.set(target, new Set());
      direct.get(target).add(f);
    }
  }
  const result = new Map();
  for (const f of files) {
    const seen = new Set();
    const queue = [f];
    while (queue.length > 0) {
      const cur = queue.pop();
      for (const r of direct.get(cur) || []) if (!seen.has(r)) { seen.add(r); queue.push(r); }
    }
    result.set(f, seen);
  }
  return result;
}

function full(reason, planIds, paths) {
  return { selection: 'full', reason, ids: planIds.slice().sort(), paths: paths.slice(0, MAX_DECIDING_PATHS) };
}

function unchangedMatch(cfg, p) {
  const list = cfg && cfg.ci_evidence && Array.isArray(cfg.ci_evidence.unchanged) ? cfg.ci_evidence.unchanged : [];
  return list.some((u) => typeof u === 'string' && u !== '' && (u.endsWith('/') ? p.startsWith(u) : p === u));
}

/**
 * Pure selection per D3 rules 1 and 3-8 (rule 2: the caller passes `changed: null`).
 * @param {{changed: string[]|null, exists: (p: string) => boolean, cfg: object, planIds: string[], requirers: Map<string, Set<string>>|undefined}} a
 * @returns {{selection: 'subset'|'full', reason: string, ids: string[], paths: string[]}}
 *   `ids` sorted command ids to run (all plan ids for `full`); `paths` at most 5 paths that decided a fallback.
 */
function selectAffected({ changed, exists, cfg, planIds, requirers }) {
  const map = validateAffectedConfig(cfg);
  if (map === null) return full('no_affected_map', planIds, []);
  if (changed === null) return full('no_diff_base', planIds, []);
  if (changed.length === 0) return full('empty_change_set', planIds, []);
  const gone = changed.filter((p) => !exists(p));
  if (gone.length > 0) return full('path_deleted', planIds, gone);
  const hard = changed.filter((p) => HARD_FULL_PATHS.includes(p) || unchangedMatch(cfg, p));
  if (hard.length > 0) return full('runner_or_config_changed', planIds, hard);
  const selectors = new Set(map.smoke);
  const unmapped = [];
  const consider = (p) => {
    const hits = map.keys.filter(([k]) => p.startsWith(k));
    if (hits.length === 0) { unmapped.push(p); return; }
    for (const [, sel] of hits) for (const s of sel) selectors.add(s);
  };
  for (const p of changed) {
    consider(p);
    const rq = requirers && typeof requirers.get === 'function' ? requirers.get(p) : null;
    if (rq) for (const r of rq) consider(r);
  }
  if (unmapped.length > 0) return full('unmapped_path', planIds, Array.from(new Set(unmapped)));
  const unknown = Array.from(selectors).filter((s) => !planIds.some((id) => selectorMatches(s, id)));
  if (unknown.length > 0) return full('selector_unknown', planIds, unknown);
  const ids = planIds.filter((id) => Array.from(selectors).some((s) => selectorMatches(s, id))).sort();
  return { selection: 'subset', reason: 'mapped', ids, paths: [] };
}

/**
 * Thin caller used by `runVerify`: reads the diff, follows literal requirers for changed JS files, selects.
 * @param {string} project repo root
 * @param {{commands: Array<{id: string}>}} plan resolved full plan
 * @param {string|null} head HEAD sha or null
 * @param {string|null} baseSha merge-base sha or null
 * @param {object} cfg parsed .a1/verify.json (or {})
 * @param {(project: string) => string[]} statusPathsFn working-tree changed paths
 * @returns {{selection: string, reason: string, ids: string[], paths: string[], changed: string[]|null}}
 */
function planAffected(project, plan, head, baseSha, cfg, statusPathsFn) {
  const planIds = plan.commands.map((c) => c.id);
  const changed = head ? affectedChanges(project, baseSha, statusPathsFn(project)) : null;
  const jsChanged = (changed || []).filter((p) => /\.(cjs|js)$/.test(p));
  const requirers = jsChanged.length > 0 ? literalRequirers(project, jsChanged) : undefined;
  const exists = (p) => fs.existsSync(path.join(project, p));
  return { ...selectAffected({ changed, exists, cfg: cfg || {}, planIds, requirers }), changed };
}

module.exports = {
  HARD_FULL_PATHS, validateAffectedConfig, selectorMatches, affectedChanges, literalRequirers, selectAffected, planAffected,
};
