'use strict';

// ---------------------------------------------------------------------------
// disposition-store — spec 017 FR-025. The committed file `.a1/dispositions.json`
// is the ONLY way a finding, a skip increase or an accepted class-sweep match is
// cleared. Entry: kind, fingerprint, reason, date, by, review (pending on creation),
// plus review_reason / reviewed_at / reviewed_by once a verdict is recorded.
//
// Fingerprint grammar (exact string match, no globs, no prefixes):
//   <rule>:<file>:<16 hex>   hex = sha256 of the whitespace-normalised line text
// `file` is a safe repo-relative path (or a verify command id); the rule must belong
// to the entry's kind. A disposition therefore names one rule in one file for one line
// content: a mutated line has another hash and the finding returns.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { sleepSyncMs } = require('./locks.cjs');

const FILE_REL = path.join('.a1', 'dispositions.json');
const FILE_GIT = '.a1/dispositions.json';
const KINDS = Object.freeze({
  fidelity: Object.freeze(['mock-of-subject', 'skipped-test', 'early-return-guard', 'test-not-in-ci']),
  skip_increase: Object.freeze(['skip-increase']),
  class_sweep: Object.freeze(['class-sweep']),
});
const REVIEWS = Object.freeze(['pending', 'upheld', 'overturned']);
const VERDICTS = Object.freeze(['upheld', 'overturned']);
const ENTRY_KEYS = Object.freeze(['kind', 'fingerprint', 'reason', 'date', 'by', 'review', 'review_reason', 'reviewed_at', 'reviewed_by']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_REASON = 2000;
const MAX_PATH = 512;
const MAX_BY = 120;
const HASH_LEN = 16;
const LOCK_RETRIES = 200;
const LOCK_RETRY_MS = 50;
const LOCK_STALE_MS = 30000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const HEX_RE = new RegExp(`^[0-9a-f]{${HASH_LEN}}$`);
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const GLOB_CHARS_RE = /[*?|\\]/;

class DispositionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const bad = (message) => new DispositionError('invalid', message);

/** Whitespace-normalised line text: runs of whitespace collapse to one space, ends trimmed. */
function normalise(text) {
  return String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
}

function textHash(text) {
  return crypto.createHash('sha256').update(normalise(text), 'utf8').digest('hex').slice(0, HASH_LEN);
}

/** True when `file` is a plain repo-relative path or command id: no globs, no control characters, no `..`. */
function isSafeFile(file) {
  if (typeof file !== 'string' || file === '' || file.length > MAX_PATH) return false;
  if (CONTROL_RE.test(file) || GLOB_CHARS_RE.test(file) || file.startsWith('/') || file.startsWith('-')) return false;
  return !file.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

function fingerprintOf(rule, file, text) {
  return `${rule}:${file}:${textHash(text)}`;
}

/** { rule, file, hash } of a fingerprint; throws DispositionError when it breaks the grammar. */
function parseFingerprint(fp) {
  if (typeof fp !== 'string' || fp === '' || fp.length > MAX_PATH + 64) throw bad('fingerprint must be a non-empty string');
  if (CONTROL_RE.test(fp)) throw bad('fingerprint contains a control character');
  const first = fp.indexOf(':');
  const last = fp.lastIndexOf(':');
  if (first <= 0 || last <= first) throw bad('fingerprint must be <rule>:<file>:<16 hex>');
  const rule = fp.slice(0, first);
  const file = fp.slice(first + 1, last);
  const hash = fp.slice(last + 1);
  if (!HEX_RE.test(hash)) throw bad('fingerprint hash must be 16 lowercase hex characters');
  if (!isSafeFile(file)) throw bad('fingerprint file is not a plain repo-relative path ("*", "?", "..", "|", backslash and control characters are refused)');
  return { rule, file, hash };
}

/** Validates the fingerprint against its kind (the rule id must belong to the kind) and returns the parsed parts. */
function checkFingerprint(kind, fp) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw bad(`unknown kind ${JSON.stringify(String(kind).slice(0, 40))} (fidelity | skip_increase | class_sweep)`);
  const parts = parseFingerprint(fp);
  if (!KINDS[kind].includes(parts.rule)) throw bad(`rule ${JSON.stringify(parts.rule.slice(0, 60))} does not belong to kind ${kind} (${KINDS[kind].join(' | ')})`);
  return parts;
}

function checkText(name, value, max) {
  if (typeof value !== 'string' || value.trim() === '') throw bad(`${name} must be a non-empty string`);
  if (value.length > max) throw bad(`${name} is longer than ${max} characters`);
  if (value.includes('\0')) throw bad(`${name} contains a NUL byte`);
  return value;
}

/** Validates one stored entry; returns it unchanged, throws DispositionError. */
function checkEntry(e) {
  if (e === null || typeof e !== 'object' || Array.isArray(e)) throw bad('entry must be an object');
  const extra = Object.keys(e).filter((k) => !ENTRY_KEYS.includes(k));
  if (extra.length > 0) throw bad(`entry has unknown key ${JSON.stringify(extra[0].slice(0, 40))}`);
  checkFingerprint(e.kind, e.fingerprint);
  checkText('reason', e.reason, MAX_REASON);
  checkText('by', e.by, MAX_BY);
  if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(e.date)) throw bad('date must start with YYYY-MM-DD');
  if (!REVIEWS.includes(e.review)) throw bad(`review must be ${REVIEWS.join(' | ')}`);
  if (e.review !== 'pending') checkText('review_reason', e.review_reason, MAX_REASON);
  return e;
}

/** Parses file text into a validated entry list; duplicate fingerprints are refused. */
function parseEntries(text, label) {
  let list;
  try { list = JSON.parse(text); } catch (e) { throw bad(`${label} is not valid JSON: ${e.message}`); }
  if (!Array.isArray(list)) throw bad(`${label} must be a JSON array`);
  if (list.length > MAX_ENTRIES) throw bad(`${label} has more than ${MAX_ENTRIES} entries`);
  const seen = new Set();
  list.forEach((e, i) => {
    try { checkEntry(e); } catch (err) { throw bad(`${label} entry ${i}: ${err.message}`); }
    if (seen.has(e.fingerprint)) throw bad(`${label} entry ${i}: duplicate fingerprint`);
    seen.add(e.fingerprint);
  });
  return list;
}

function filePath(project) { return path.join(project, FILE_REL); }

/** Entries of the working-tree file; a missing file is []. Throws DispositionError on anything unreadable. */
function loadEntries(project) {
  const file = filePath(project);
  let text;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) throw bad(`${FILE_GIT} is not a regular file under ${MAX_FILE_BYTES} bytes`);
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e instanceof DispositionError) throw e;
    if (e.code === 'ENOENT') return [];
    throw bad(`cannot read ${FILE_GIT}: ${e.message}`);
  }
  return parseEntries(text, FILE_GIT);
}

/** Fingerprints that clear findings of `kind`: pending or upheld entries (an overturned one clears nothing). */
function clearedFingerprints(entries, kind) {
  return new Set(entries.filter((e) => e.kind === kind && e.review !== 'overturned').map((e) => e.fingerprint));
}

// ---------- write (lock + atomic rename) ----------

function acquireLock(lockDir) {
  for (let i = 0; i < LOCK_RETRIES; i++) {
    try { fs.mkdirSync(lockDir); return; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS) fs.rmdirSync(lockDir);
      } catch (_e) { /* lost the race or already gone */ }
      sleepSyncMs(LOCK_RETRY_MS);
    }
  }
  throw new DispositionError('lock', `could not lock ${path.basename(lockDir)} (another disposition command is running?)`);
}

/** Runs fn(entries) under the mkdir lock; fn returns the new list (or null for "no write"). Returns fn's second slot. */
function withEntries(project, fn) {
  const file = filePath(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockDir = `${file}.lock.d`;
  acquireLock(lockDir);
  try {
    const { next, result } = fn(loadEntries(project));
    if (next !== null) {
      const tmp = `${file}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, file);
    }
    return result;
  } finally {
    try { fs.rmdirSync(lockDir); } catch (_e) { /* already gone */ }
  }
}

// ---------- changed between two refs ----------

function git(project, args) {
  return execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: GIT_MAX_BUFFER, shell: false });
}

/** Entries of `.a1/dispositions.json` at a git ref; a ref without the file is []; an unresolvable ref throws. */
function entriesAt(project, ref) {
  if (typeof ref !== 'string' || ref === '' || ref.startsWith('-') || /[\0\s]/.test(ref)) throw bad(`unsafe ref ${JSON.stringify(String(ref).slice(0, 60))}`);
  try { git(project, ['rev-parse', '--verify', `${ref}^{commit}`]); } catch (_e) { throw new DispositionError('git', `ref ${ref} does not resolve to a commit`); }
  let text;
  try { text = git(project, ['show', `${ref}:${FILE_GIT}`]); } catch (_e) { return []; }
  return parseEntries(text, `${FILE_GIT}@${ref}`);
}

/** Entries of `headRef` that are new or differ from the same fingerprint at `baseRef`. */
function changedBetween(project, baseRef, headRef = 'HEAD') {
  const base = new Map(entriesAt(project, baseRef).map((e) => [e.fingerprint, JSON.stringify(e)]));
  return entriesAt(project, headRef).filter((e) => base.get(e.fingerprint) !== JSON.stringify(e));
}

/**
 * The merge-check feed (wave 10): [{ reason, kind, fingerprint }].
 * disposition_unreviewed: a changed entry still pending. disposition_overturned: any overturned entry at head.
 */
function pendingOrOverturned(project, baseRef, headRef = 'HEAD') {
  const pending = changedBetween(project, baseRef, headRef).filter((e) => e.review === 'pending').map((e) => ({ reason: 'disposition_unreviewed', kind: e.kind, fingerprint: e.fingerprint }));
  const overturned = entriesAt(project, headRef).filter((e) => e.review === 'overturned').map((e) => ({ reason: 'disposition_overturned', kind: e.kind, fingerprint: e.fingerprint }));
  return [...pending, ...overturned];
}

module.exports = {
  DispositionError, KINDS, VERDICTS, FILE_GIT, MAX_REASON, MAX_BY,
  normalise, textHash, isSafeFile, fingerprintOf, parseFingerprint, checkFingerprint, checkText,
  checkEntry, parseEntries, loadEntries, clearedFingerprints, withEntries, entriesAt, changedBetween, pendingOrOverturned,
};
