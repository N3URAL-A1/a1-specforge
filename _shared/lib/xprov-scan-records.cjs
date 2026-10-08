'use strict';

// ---------------------------------------------------------------------------
// xprov-scan-records — the scan-pass record of a snapshot (spec 014 FR-005).
//
//   ~/.a1-xprov/scan-records/<snap-basename>.json
//
// A passing `snapshot()` writes one record (tree, index and status hashes, nonce);
// `xprov run` (Wave 6) binds to it. The writer applies the steps of
// `writeGuardedStore` (xprov-approve.cjs) to a SUBDIRECTORY, which that function
// cannot do (flat names only): lstat with no symlink, 0700 dirs, a `wx` 0600 temp
// file, fsync, rename. The reader applies the `readGuardedStore` checks to the
// directory and the file. No module-level cache: every call reads the disk.
// Same-user forgery stays the accepted residual (spec 014 R-1).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
// Lazy: the allowlist module pulls in xprov-permit, which must not be able to close an import cycle through gc.
const AL = new Proxy({}, { get: (_t, k) => require('./xprov-allowlist.cjs')[k] });

const RECORDS_DIR = 'scan-records';
const RECORD_VERSION = 1;
const RECORD_SUFFIX = '.json';
const NONCE_BYTES = 16; // 32 hex characters
const NONCE_RE = /^[0-9a-f]{32}$/;
const BASENAME_RE = /^snap-[A-Za-z0-9._-]+$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RECORD_KEYS = Object.freeze([
  'version', 'snapshot', 'repo_key', 'commit', 'base', 'tree', 'index_sha256', 'status_sha256', 'diff_sha256', 'inputs', 'gitleaks', 'nonce', 'ts',
]);
const STRING_KEYS = Object.freeze(['snapshot', 'repo_key', 'commit', 'tree', 'index_sha256', 'status_sha256', 'ts']);
const NULLABLE_STRING_KEYS = Object.freeze(['base', 'diff_sha256']);

const scanRecordsDir = () => path.join(X.xprovHome(), RECORDS_DIR);

function checkBasename(basename) {
  if (typeof basename !== 'string' || !BASENAME_RE.test(basename)) throw C.inputError(`${JSON.stringify(String(basename).slice(0, 80))} is not a snapshot basename`, 'bad_scan_record_name');
  return basename;
}

const recordPath = (basename) => path.join(scanRecordsDir(), `${checkBasename(basename)}${RECORD_SUFFIX}`);

const ownedByMe = (st) => typeof process.getuid !== 'function' || st.uid === process.getuid();

/** The record document as a new frozen object, or null when it is off-format. */
function parseScanRecord(doc) {
  if (!AL.exactKeys(doc, RECORD_KEYS) || doc.version !== RECORD_VERSION) return null;
  if (!STRING_KEYS.every((k) => typeof doc[k] === 'string' && doc[k] !== '')) return null;
  if (!NULLABLE_STRING_KEYS.every((k) => doc[k] === null || (typeof doc[k] === 'string' && doc[k] !== ''))) return null;
  if (typeof doc.gitleaks !== 'boolean' || typeof doc.nonce !== 'string' || !NONCE_RE.test(doc.nonce)) return null;
  if (!C.isPlainObject(doc.inputs) || !Object.values(doc.inputs).every((v) => typeof v === 'string' && v !== '')) return null;
  return Object.freeze({ ...doc, inputs: Object.freeze({ ...doc.inputs }) });
}

/** A fresh 32-hex nonce. */
const newNonce = () => crypto.randomBytes(NONCE_BYTES).toString('hex');

function ensureDir0700(dir) {
  let st = null;
  try { st = fs.lstatSync(dir); } catch (_e) { st = null; }
  if (st && (st.isSymbolicLink() || !st.isDirectory())) throw C.inputError(`${dir} is not a real directory; refusing to write a scan record`, 'scan_record_dir');
  if (!st) fs.mkdirSync(dir, { mode: AL.STORE_DIR_MODE });
  fs.chmodSync(dir, AL.STORE_DIR_MODE);
}

/** Atomic write of the record for `basename`; returns the path. Throws on an off-format doc or any fs failure. */
function writeScanRecord(basename, doc) {
  if (parseScanRecord(doc) === null) throw C.inputError('scan record has an unknown format; refusing to write it', 'scan_record_format');
  const target = recordPath(basename);
  ensureDir0700(X.xprovHome());
  const dir = scanRecordsDir();
  ensureDir0700(dir);
  const tmp = path.join(dir, `.${basename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'wx', AL.STORE_MODE);
  try {
    fs.fchmodSync(fd, AL.STORE_MODE); // umask-proof
    fs.writeSync(fd, `${JSON.stringify(doc, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return target;
}

/** { ok: true, value } | { ok: false, missing, why } — `missing` means no record (nothing unusable about it). */
function readScanRecord(basename) {
  const absent = (why, missing) => ({ ok: false, missing: Boolean(missing), why });
  const dirProblem = (dir, label) => {
    let d;
    try { d = fs.lstatSync(dir); } catch (_e) { return absent(`${label} does not exist`, true); }
    if (d.isSymbolicLink() || !d.isDirectory()) return absent(`${label} is not a real directory`);
    if ((d.mode & 0o777) !== AL.STORE_DIR_MODE || !ownedByMe(d)) return absent(`${label} is not 0700 and owned by the current user`);
    return null;
  };
  const bad = dirProblem(X.xprovHome(), '~/.a1-xprov') || dirProblem(scanRecordsDir(), '~/.a1-xprov/scan-records');
  if (bad) return bad;
  let fd;
  try { fd = fs.openSync(recordPath(basename), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch (e) {
    return e.code === 'ENOENT' ? absent('no scan record yet', true) : absent('the scan record is a symlink or cannot be opened');
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o777) !== AL.STORE_MODE || !ownedByMe(st)) return absent('the scan record is not a 0600 regular file owned by the current user');
    const value = parseScanRecord(AL.parseStrictJson(fs.readFileSync(fd, 'utf8')));
    return value === null ? absent('the scan record has an unknown format') : { ok: true, value };
  } catch (_e) {
    return absent('the scan record is unreadable');
  } finally {
    fs.closeSync(fd);
  }
}

/** Removes the record of `basename` (a symlink is unlinked, never followed). Returns true when something was removed. */
function removeScanRecord(basename) {
  const file = recordPath(basename);
  let st = null;
  try {
    const d = fs.lstatSync(scanRecordsDir());
    if (d.isSymbolicLink() || !d.isDirectory()) return false; // never remove through a linked directory
    st = fs.lstatSync(file);
  } catch (_e) { return false; }
  if (st.isDirectory()) return false;
  fs.rmSync(file, { force: true });
  return true;
}

/** gc: removes records older than `maxAgeDays` and records whose snapshot is gone
 * (`snapshotExists(basename)` decides). Only `snap-*.json` regular files are touched.
 * Returns { root, removed: [paths], kept: [paths] }. */
function sweepScanRecords(maxAgeDays, snapshotExists, nowMs) {
  const root = scanRecordsDir();
  const out = { root, removed: [], kept: [] };
  let d;
  try { d = fs.lstatSync(root); } catch (_e) { return out; }
  if (d.isSymbolicLink() || !d.isDirectory()) return out;
  const cutoff = (typeof nowMs === 'number' ? nowMs : Date.now()) - maxAgeDays * MS_PER_DAY;
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(RECORD_SUFFIX)) continue;
    const base = name.slice(0, -RECORD_SUFFIX.length);
    if (!BASENAME_RE.test(base)) continue;
    const full = path.join(root, name);
    let st;
    try { st = fs.lstatSync(full); } catch (_e) { continue; }
    if (st.isDirectory()) continue;
    if (st.mtimeMs < cutoff || !snapshotExists(base)) { fs.rmSync(full, { force: true }); out.removed.push(full); } else out.kept.push(full);
  }
  return out;
}

module.exports = {
  RECORDS_DIR, RECORD_KEYS, scanRecordsDir, parseScanRecord, newNonce, writeScanRecord, readScanRecord, removeScanRecord, sweepScanRecords,
};
