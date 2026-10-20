'use strict';

// `verify run --base` support (spec 017 FR-015, FR-016, FR-039):
//   - merge-base resolution that fails closed (shallow clone without the base: exit 2, message names the fetch),
//   - a `git archive` snapshot of the merge-base in a guarded temp dir (never a checkout in the live tree),
//   - the pure settle rules: single retry -> flaky, flaky_base, head-vs-base failing-set subset compare,
//   - the result cache `.a1/verify-cache/<sha>-<command hash>.json` (git-excluded like the gate log),
//   - flakyBaseGrown(): the frozen-list check `pr merge-check` uses (reason flaky_base_grown, wave 10).
// No raw command output is ever stored: only the per-command records `runCommand` returns (counts, ids, codes).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { gitRaw } = require('./verify-check.cjs');
const { fingerprintOf } = require('./disposition-store.cjs');

const CACHE_DIR = '.a1/verify-cache';
const CACHE_EXCLUDE = '.a1/verify-cache/';
const CACHE_VERSION = 1;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const GATE_LOG_RE = /^\.a1\/phases\/[^/]+\/gate-log\.jsonl$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const RETRYABLE = Object.freeze(['command_failed', 'reported_failures', 'signal', 'implausible_crash']);
const ARCHIVE_TIMEOUT_MS = 10 * 60 * 1000;

class VerifyError extends Error {
  constructor(reason, message) { super(message || reason); this.reason = reason; }
}

/** Merge-base sha of `ref` and HEAD; exit 2 (VerifyError) when git cannot resolve it. */
function resolveMergeBase(project, ref) {
  if (typeof ref !== 'string' || ref.startsWith('-') || /[\0\s]/.test(ref)) throw new VerifyError('base_unresolved', `unsafe --base ${JSON.stringify(ref)}`);
  const sha = gitRaw(project, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (sha === null) throw new VerifyError('base_unresolved', `--base ${ref} does not resolve to a commit; in a shallow clone run: git fetch origin ${ref} (and deepen with --unshallow)`);
  const mb = gitRaw(project, ['merge-base', sha.trim(), 'HEAD']);
  if (mb === null || !SHA_RE.test(mb.trim())) throw new VerifyError('base_unresolved', `no merge-base between ${ref} and HEAD (shallow clone?); run: git fetch --unshallow origin ${ref}`);
  return mb.trim();
}

/** Extracts `git archive <sha>` into a fresh guarded temp dir; returns the dir. Caller removes it. */
function extractSnapshot(project, sha) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'a1-fx-verify-base-')));
  try {
    const tar = path.join(dir, '..', `${path.basename(dir)}.tar`);
    const a = spawnSync('git', ['-C', project, 'archive', '--format=tar', '-o', tar, sha], { shell: false, stdio: 'ignore', timeout: ARCHIVE_TIMEOUT_MS });
    if (a.status !== 0) throw new VerifyError('base_unresolved', `git archive of ${sha} failed (object missing in a shallow clone? run: git fetch --unshallow)`);
    try {
      const x = spawnSync('tar', ['-xf', tar, '-C', dir], { shell: false, stdio: 'ignore', timeout: ARCHIVE_TIMEOUT_MS });
      if (x.status !== 0) throw new VerifyError('internal', 'tar extraction of the base snapshot failed');
    } finally { fs.rmSync(tar, { force: true }); }
    const nm = path.join(project, 'node_modules');
    if (fs.existsSync(nm) && !fs.existsSync(path.join(dir, 'node_modules'))) fs.symlinkSync(nm, path.join(dir, 'node_modules'));
    return dir;
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** Runs fn(snapshotDir) on a snapshot of `sha`; the dir is removed on every path. */
function withSnapshot(project, sha, fn) {
  const dir = extractSnapshot(project, sha);
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Paths from `git status` that count as a dirty tree: gate-log and cache paths are not (FR-039). */
function dirtyPaths(paths) {
  return paths.filter((p) => !(p.startsWith(`${CACHE_DIR}/`) || GATE_LOG_RE.test(p)));
}

function commandHash(commands) {
  const norm = commands.map((c) => [c.id, c.argv, c.kind, c.timeoutMs]);
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 32);
}

function cacheFile(project, sha, hash) { return path.join(project, CACHE_DIR, `${sha}-${hash}.json`); }

/** Cached { id: {raw, retry} } for exactly this sha + command set, else null. */
function readCache(project, sha, hash, commands) {
  try {
    const file = cacheFile(project, sha, hash);
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > MAX_CACHE_BYTES) return null;
    const e = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ok = e && e.version === CACHE_VERSION && e.sha === sha && e.command_hash === hash && e.results && typeof e.results === 'object';
    if (!ok) return null;
    return commands.every((c) => e.results[c.id] && typeof e.results[c.id].raw === 'object') ? e.results : null;
  } catch (_e) { return null; }
}

function ensureCacheExcluded(project) {
  const common = (gitRaw(project, ['rev-parse', '--git-common-dir']) || '').trim();
  if (common === '') return;
  const file = path.resolve(project, common, 'info', 'exclude');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_e) { /* created below */ }
  if (text.split('\n').some((l) => l.trim() === CACHE_EXCLUDE)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${CACHE_EXCLUDE}\n`, 'utf8');
}

function writeCache(project, sha, hash, results) {
  ensureCacheExcluded(project);
  const file = cacheFile(project, sha, hash);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, sha, command_hash: hash, results }), 'utf8');
  fs.renameSync(tmp, file);
}

/** The ids a finished command contributes to a failing set (the command id when nothing finer is known). */
function failingIds(f) {
  if (f.reason === null) return [];
  const ids = Array.isArray(f.failed_ids) ? f.failed_ids : [];
  return ids.length === 0 || (typeof f.failed === 'number' && f.failed > ids.length) ? [...new Set([...ids, f.id])] : ids;
}

function isRetryable(f, baseIds) {
  if (!RETRYABLE.includes(f.reason)) return false;
  return baseIds === null || failingIds(f).some((i) => !baseIds.has(i));
}

/**
 * Settles one head command (FR-015, FR-016).
 * @param {object} first finished record (reason set)
 * @param {() => object} retry runs the command once more and returns a finished record
 * @param {Set<string>|null} baseIds failing ids on the base side, null without --base (or absent there)
 * @param {string[]} flakyBase frozen list
 */
function settle(first, retry, baseIds, flakyBase) {
  const retried = isRetryable(first, baseIds);
  const second = retried ? retry() : null;
  const final = second || first;
  const finalIds = failingIds(final);
  const stillFailing = new Set(finalIds);
  const flaky = retried ? failingIds(first).filter((i) => !stillFailing.has(i)) : [];
  const preExisting = baseIds === null ? [] : finalIds.filter((i) => baseIds.has(i));
  const fresh = finalIds.filter((i) => baseIds === null || !baseIds.has(i));
  let reason = final.reason;
  if (reason !== null && fresh.length === 0 && baseIds !== null) reason = null;
  if (reason === null && flaky.some((i) => !flakyBase.includes(i))) reason = 'new_flaky';
  return { ...final, reason, failed_ids: final.failed_ids, flaky_ids: flaky, pre_existing_red_ids: preExisting, retried };
}

/** Failing-id set for one finished base command. */
function idSet(f) { return new Set(failingIds(f)); }

function parseVerifyJson(v, which) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { throw new VerifyError('bad_config', `${which} .a1/verify.json is not valid JSON: ${e.message}`); }
}

/**
 * Frozen flaky_base (FR-016): ids in the head's list that the base's list lacks.
 * A missing base file means the PR creates .a1/verify.json and may set the initial list.
 * @returns {string[]} the grown ids; non-empty means merge-check reason flaky_base_grown
 */
function flakyBaseGrown(baseVerifyJson, headVerifyJson) {
  const base = parseVerifyJson(baseVerifyJson, 'base');
  const head = parseVerifyJson(headVerifyJson, 'head');
  if (base === null || head === null) return [];
  const list = (cfg) => (Array.isArray(cfg.flaky_base) ? cfg.flaky_base.filter((x) => typeof x === 'string') : []);
  const had = new Set(list(base));
  return [...new Set(list(head).filter((i) => !had.has(i)))];
}

/** Fingerprint of one skip increase: rule skip-increase, the command id, and the exact `base->head` counts. */
function skipFingerprint(commandId, baseSkipped, headSkipped) {
  return fingerprintOf('skip-increase', commandId, `${baseSkipped}->${headSkipped}`);
}

/**
 * Skip-increase rule (FR-017). More skipped tests on head than on base fails the command with reason
 * `skip_increase` unless a `skip_increase` disposition with the fingerprint of exactly this increase is
 * recorded. Counts that are unknown on either side (no report) are not judged.
 * @param {object[]} commands settled head records
 * @param {Map<string, number|null>} baseSkipped skipped count per command id on the base side
 * @param {Set<string>} cleared fingerprints of non-overturned skip_increase dispositions
 * @returns {object[]} new records; a record with an increase carries `skip_increase: {base, head, fingerprint, dispositioned}`
 */
function applySkipIncrease(commands, baseSkipped, cleared) {
  return commands.map((c) => {
    const base = baseSkipped.get(c.id);
    if (typeof c.skipped !== 'number' || typeof base !== 'number' || c.skipped <= base) return c;
    const fingerprint = skipFingerprint(c.id, base, c.skipped);
    const dispositioned = cleared.has(fingerprint);
    return { ...c, reason: c.reason === null && !dispositioned ? 'skip_increase' : c.reason, skip_increase: { base, head: c.skipped, fingerprint, dispositioned } };
  });
}

module.exports = {
  VerifyError, skipFingerprint, applySkipIncrease, RETRYABLE, CACHE_DIR, resolveMergeBase, extractSnapshot, withSnapshot, dirtyPaths, commandHash,
  readCache, writeCache, failingIds, settle, idSet, flakyBaseGrown,
};
