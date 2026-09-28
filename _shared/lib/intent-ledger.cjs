'use strict';

// ---------------------------------------------------------------------------
// intent-ledger — the replay ledger outside the vault (spec 011, Wave 4:
// FR-014).
//
//   ~/.a1-intents-ledger.json   { "rows": [ { id, device, nonce, action,
//                                 project, claimed_at, claimed_sha256,
//                                 started_at, finished_at, outcome,
//                                 result_path, result_sha256 } ] }
//   ~/.a1-intents/ledger.lock   held by claim from the replay check to the
//                               ledger append
//
// FAIL CLOSED. A missing ledger is an empty ledger; a ledger that does not
// parse, has the wrong shape, or is not a regular file (a symlink) throws
// LedgerUnreadable, and every claim and run refuses with ledger_unreadable
// until the operator repairs it by hand. This is deliberately the OPPOSITE
// of locks.cjs, which reclaims a corrupt reservations lock: a lock guards
// against concurrency and may be rebuilt, the ledger is the memory of which
// ids and nonces were already used — rebuilding it empty would reopen every
// replay.
//
// All row helpers return new arrays; nothing mutates a loaded ledger.
//
// The ledger lock serialises "load -> replay check -> rename -> append"
// across processes. Without it two claims of different files carrying the
// same (device, nonce) could both pass the replay check, and two appends
// could lose a row (read-modify-write). A lock whose holder process is dead
// on this host is reclaimed; a lock that cannot be taken within the retry
// budget throws A1_LEDGER_BUSY (claim exits 1 ledger_busy, moves nothing).
//
// Security review of waves 4–5: the ledger is read through openPrivate (one
// fd, O_NOFOLLOW, regular file of this uid, no group/other bit — else
// ledger_unreadable) and written tmp (O_EXCL, 0600, fchmod + fsync) + rename.
// The lock lives in ~/.a1-intents, which must pass assertPrivateDir.
// A lock's identity is its content — { pid, hostname, acquired_at, token }
// with 16 random bytes of token — plus its mtime, never its inode number:
// Linux reuses a freed inode number at once (measured in node:20 on overlay
// /tmp: 200/200 unlink+create pairs got the same number; APFS 0/200), so an
// inode check took a new live lock for the judged stale one.
// Reclaim (MINOR-A) never removes by path on an old verdict: the reclaimer
// hard-links the path to ledger.lock.reclaim.<key>, key = sha256 of the
// judged content and mtime (link fails with EEXIST for every other reclaimer
// of the same lock), reads the link back and compares content and mtime with
// the verdict, and only then unlinks ledger.lock — which can still only be
// that stale lock, because a new lock is created with O_EXCL only while the
// path is free. A reclaimer that crashes between link and unlink leaves the
// .reclaim.<key> name behind; the lock then stays busy (fail closed) until
// the operator removes both files. Release removes the lock only while its
// content still carries this process's token.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isPidDead, sleepSyncMs } = require('./locks.cjs');
const { openPrivate, assertPrivateDir } = require('./intent-devices.cjs');

const LEDGER_FILE = '.a1-intents-ledger.json';
const LEDGER_MODE = 0o600;
const LOCK_DIR = '.a1-intents';
const LOCK_FILE = 'ledger.lock';
const LOCK_RETRIES = 50;
const LOCK_RETRY_DELAY_MS = 20;
// An unparsable lock (crash between create and write) older than this is
// reclaimed; a younger one may still be in the middle of being written.
const LOCK_UNPARSABLE_STALE_MS = 10 * 1000;
const LOCK_MAX_BYTES = 4096;

function ledgerUnreadable(why) {
  const e = new Error(`~/${LEDGER_FILE} is unreadable (${why}); claim and run refuse until it is repaired by hand`);
  e.name = 'LedgerUnreadable';
  e.code = 'A1_LEDGER_UNREADABLE';
  return e;
}

function ledgerPath(homedir = os.homedir) {
  return path.join(homedir(), LEDGER_FILE);
}

const isRow = (r) => r !== null && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'string';

// -> { rows } (frozen). Missing file -> no rows; anything else wrong throws.
function loadLedger(deps = {}) {
  const fd = openPrivate(ledgerPath(deps.homedir), 'file', deps, ledgerUnreadable);
  if (fd === null) return Object.freeze({ rows: Object.freeze([]) });
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch (_e) {
    throw ledgerUnreadable('not JSON');
  } finally {
    fs.closeSync(fd);
  }
  const rows = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.rows : undefined;
  if (!Array.isArray(rows) || !rows.every(isRow)) throw ledgerUnreadable('no "rows" array of rows with an id');
  return Object.freeze({ rows: Object.freeze(rows.map((r) => Object.freeze({ ...r }))) });
}

// -> 'id' | 'device_nonce' | null. An id or a (device, nonce) pair that the
// ledger already holds is a replay, whatever its outcome was.
function hasReplay(rows, fm) {
  if (rows.some((r) => r.id === fm.id)) return 'id';
  if (rows.some((r) => r.device === fm.created_by && r.nonce === fm.nonce)) return 'device_nonce';
  return null;
}

const findRow = (rows, id) => rows.find((r) => r.id === id) || null;
const appendRow = (rows, row) => Object.freeze([...rows, Object.freeze({ ...row })]);
const updateRow = (rows, id, patch) => Object.freeze(rows.map((r) => (r.id === id ? Object.freeze({ ...r, ...patch }) : r)));

// tmp in the same directory (O_EXCL, 0600, fchmod, fsync) -> rename: the
// ledger holds nonces and is never visible with a looser mode.
function writeLedger(rows, deps = {}) {
  const file = ledgerPath(deps.homedir);
  // Review MINOR-6: the temp file lives in ~/.a1-intents (same filesystem,
  // covered by the child's directory-level deny), not beside the ledger.
  const tmp = path.join(path.dirname(file), '.a1-intents', `ledger.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`);
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, LEDGER_MODE);
  try {
    fs.writeSync(fd, `${JSON.stringify({ rows }, null, 2)}\n`);
    fs.fchmodSync(fd, LEDGER_MODE);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

// ---------- ledger lock ----------

const LOCK_READ_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const LOCK_CREATE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;

// -> { raw, holder, st } read through one fd; holder null when not parsable.
function readLock(file) {
  const fd = fs.openSync(file, LOCK_READ_FLAGS);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > LOCK_MAX_BYTES) return { raw: null, holder: null, st };
    const raw = fs.readFileSync(fd, 'utf8');
    try {
      return { raw, holder: JSON.parse(raw), st };
    } catch (_e) {
      return { raw, holder: null, st }; // mid-write or garbage; judged by age below
    }
  } finally {
    fs.closeSync(fd);
  }
}

// -> readLock(file), or null when it is gone or not ours to judge.
function readLockOrNull(file) {
  try {
    return readLock(file);
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ELOOP')) return null;
    throw e;
  }
}

// The lock as read when its holder is a dead process on this host, or when
// it never became parsable and is old; else null. A live or foreign holder keeps it.
function reclaimable(file, hostname, now) {
  const info = readLockOrNull(file);
  if (info === null || info.raw === null) return null;
  const h = info.holder;
  if (h === null || typeof h !== 'object') return now - info.st.mtimeMs > LOCK_UNPARSABLE_STALE_MS ? info : null;
  const dead = h.hostname === hostname && Number.isSafeInteger(h.pid) && h.pid > 0 && isPidDead(h.pid);
  return dead ? info : null;
}

const sameLock = (a, b) => a !== null && b !== null && a.raw === b.raw && a.st.mtimeMs === b.st.mtimeMs;

// Removes the lock only if it is still the judged one (see header).
function reclaim(file, judged) {
  const key = crypto.createHash('sha256').update(`${judged.raw}\n${judged.st.mtimeMs}`).digest('hex').slice(0, 32);
  const claim = `${file}.reclaim.${key}`;
  try {
    fs.linkSync(file, claim);
  } catch (e) {
    if (e && (e.code === 'EEXIST' || e.code === 'ENOENT')) return false; // another reclaimer, or released
    throw e;
  }
  if (!sameLock(readLockOrNull(claim), judged)) {
    fs.unlinkSync(claim); // the path holds a new lock meanwhile: keep that one
    return false;
  }
  fs.unlinkSync(file);
  fs.unlinkSync(claim);
  return true;
}

// -> this process's token, or null when the lock exists.
function tryCreateLock(file, hostname, now) {
  let fd;
  try {
    fd = fs.openSync(file, LOCK_CREATE_FLAGS, 0o600);
  } catch (e) {
    if (e && e.code === 'EEXIST') return null;
    throw e;
  }
  const token = crypto.randomBytes(16).toString('hex');
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, hostname, acquired_at: new Date(now).toISOString(), token }));
    return token;
  } finally {
    fs.closeSync(fd);
  }
}

function acquireLedgerLock(deps) {
  const file = path.join(assertPrivateDir(deps), LOCK_FILE);
  for (let i = 0; i < LOCK_RETRIES; i += 1) {
    const now = deps.now();
    const token = tryCreateLock(file, deps.hostname, now);
    if (token) return { file, token };
    const stale = reclaimable(file, deps.hostname, now);
    if (stale && reclaim(file, stale)) continue;
    sleepSyncMs(LOCK_RETRY_DELAY_MS);
  }
  const e = new Error(`~/${LOCK_DIR}/${LOCK_FILE} is held by another process`);
  e.code = 'A1_LEDGER_BUSY';
  throw e;
}

// Unlinks the lock only while its content still carries this process's token.
function releaseLedgerLock({ file, token }) {
  const info = readLockOrNull(file);
  if (info && info.holder && typeof info.holder === 'object' && info.holder.token === token) fs.unlinkSync(file);
}

// Runs fn() while holding the ledger lock; releases it on every path.
function withLedgerLock(fn, deps = {}) {
  const d = { homedir: os.homedir, hostname: os.hostname(), now: Date.now, ...deps };
  const lock = acquireLedgerLock(d);
  try {
    return fn();
  } finally {
    releaseLedgerLock(lock);
  }
}

module.exports = {
  ledgerPath,
  loadLedger,
  hasReplay,
  findRow,
  appendRow,
  updateRow,
  writeLedger,
  withLedgerLock,
};
