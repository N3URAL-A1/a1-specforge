'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-hits — the secret-scan hits an allowlist question lists (spec 016 FR-014; wave 3).
//
//   <owner home>/.a1-xprov/scan-records/<snap-basename>.hits.json   (dir 0700, file 0600, atomic, no symlink)
//     { version: 1, snapshot, repo_key, commit, hits: [{ path, rule, line, column }], ts }
//
// The record holds WHERE a hit is (path, line, column) and WHICH rule fired, never the matched text, the secret or a surrounding line:
// `fromGitleaksReport` keeps four fields of a gitleaks JSON report entry and drops everything else (Secret, Match, Fingerprint, Commit,
// Author …). Blob identity is not stored: `blobSha256` computes the sha256 of the blob at `commit:path` from the repository each time, so
// a question and its `consent allowlist` always bind to the content that is really there.
// Wave 9 (snapshot-exclude) writes this record for the changed-line hits of a failed scan; the wave 3 fixtures write it with `writeHits`.
// A tier-0 note: the same OS user can write the file; the owner reads path, rule and blob sha in the question, and the approval covers
// those blobs only. Request-scoped: paths come from the owner home resolver per call.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const OH = require('./xprov-owner-home.cjs');
const AL = require('./xprov-allowlist.cjs');

const RECORDS_DIR = 'scan-records';
const SUFFIX = '.hits.json';
const BASENAME_RE = /^snap-[A-Za-z0-9._-]{1,120}$/;
const COMMIT_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const RULE_RE = /^[A-Za-z0-9._-]{1,80}$/;
const HITS_MAX = 1000;
const PATH_MAX_CHARS = 500;
const POSITION_MAX = 10000000;
const BLOB_MAX_BYTES = 5 * 1024 * 1024;
const BAD_PATH_CHAR_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\\]/u;
const RECORD_KEYS = Object.freeze(['version', 'snapshot', 'repo_key', 'commit', 'hits', 'ts']);
const HIT_KEYS = Object.freeze(['path', 'rule', 'line', 'column']);

const hitsDir = () => path.join(X.xprovHome(), RECORDS_DIR);
const ownedByMe = (st) => typeof process.getuid !== 'function' || st.uid === process.getuid();

function checkBasename(b) {
  if (typeof b !== 'string' || !BASENAME_RE.test(b)) throw C.inputError(`${JSON.stringify(C.clip(String(b), 80))} is not a scan basename (snap-…)`, 'bad_scan_name');
  return b;
}
const hitsFile = (basename) => path.join(hitsDir(), `${checkBasename(basename)}${SUFFIX}`);

/** A repository-relative path git printed: no absolute form, no `..` or `.` segment, no control, bidi or backslash character. */
function plainRelPath(p) {
  if (typeof p !== 'string' || p === '' || p.length > PATH_MAX_CHARS || BAD_PATH_CHAR_RE.test(p) || p.startsWith('/') || p.endsWith('/')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

const posInt = (v) => Number.isInteger(v) && v >= 1 && v <= POSITION_MAX;
const validHit = (h) => AL.exactKeys(h, HIT_KEYS) && plainRelPath(h.path) && typeof h.rule === 'string' && RULE_RE.test(h.rule) && posInt(h.line) && posInt(h.column);

/** The record as a new frozen object, or null when it is off-format. */
function parseHits(doc) {
  if (!AL.exactKeys(doc, RECORD_KEYS) || doc.version !== 1) return null;
  if (typeof doc.snapshot !== 'string' || !BASENAME_RE.test(doc.snapshot) || typeof doc.repo_key !== 'string' || doc.repo_key === '') return null;
  if (typeof doc.commit !== 'string' || !COMMIT_RE.test(doc.commit) || typeof doc.ts !== 'string' || doc.ts === '') return null;
  if (!Array.isArray(doc.hits) || doc.hits.length > HITS_MAX || !doc.hits.every(validHit)) return null;
  return Object.freeze({ ...doc, hits: Object.freeze(doc.hits.map((h) => Object.freeze({ path: h.path, rule: h.rule, line: h.line, column: h.column }))) });
}

/** { ok: true, value } | { ok: false, missing, why } — the guarded read of one hits record. */
function readHits(basename) {
  const file = hitsFile(basename);
  let d;
  try { d = fs.lstatSync(hitsDir()); } catch (_e) { return { ok: false, missing: true, why: 'no scan hits record yet' }; }
  if (d.isSymbolicLink() || !d.isDirectory() || (d.mode & 0o777) !== AL.STORE_DIR_MODE || !ownedByMe(d)) return { ok: false, missing: false, why: 'scan-records is not a 0700 real directory owned by the current user' };
  return AL.readGuardedStore(file, 'scan hits record', parseHits);
}

function ensureDir0700(dir) {
  let st = null;
  try { st = fs.lstatSync(dir); } catch (_e) { st = null; }
  if (st && (st.isSymbolicLink() || !st.isDirectory())) throw C.inputError(`${dir} is not a real directory; refusing to write a hits record`, 'scan_record_dir');
  if (!st) fs.mkdirSync(dir, { mode: AL.STORE_DIR_MODE });
  fs.chmodSync(dir, AL.STORE_DIR_MODE);
}

/** Atomic write of a hits record (the scan-records writer pattern); returns the path. Throws a typed input error for an off-format document. */
function writeHits(basename, doc) {
  OH.assertWritable();
  if (parseHits(doc) === null) throw C.inputError('scan hits record has an unknown format; refusing to write it', 'scan_hits_format');
  const target = hitsFile(basename);
  ensureDir0700(X.xprovHome());
  ensureDir0700(hitsDir());
  const tmp = path.join(hitsDir(), `.${basename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'wx', AL.STORE_MODE);
  try { fs.fchmodSync(fd, AL.STORE_MODE); fs.writeSync(fd, `${JSON.stringify(doc, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, target); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return target;
}

/**
 * The hits of a gitleaks JSON report (an array of findings) as [{ path, rule, line, column }]: RuleID, File, StartLine, StartColumn and
 * nothing else — never Secret, Match or a fingerprint. `stripPrefix` removes the scan source directory the report's File values start with.
 * Throws a typed input error for an entry that has no usable position or a path outside the repository.
 */
function fromGitleaksReport(report, stripPrefix) {
  if (!Array.isArray(report) || report.length > HITS_MAX) throw C.inputError('gitleaks report: expected an array of at most 1000 findings', 'gitleaks_report');
  const cut = typeof stripPrefix === 'string' && stripPrefix !== '' ? stripPrefix.replace(/\/*$/, '/') : '';
  return report.map((e, i) => {
    const file = C.isPlainObject(e) && typeof e.File === 'string' ? (cut && e.File.startsWith(cut) ? e.File.slice(cut.length) : e.File) : null;
    const hit = { path: file, rule: C.isPlainObject(e) ? e.RuleID : null, line: C.isPlainObject(e) ? e.StartLine : null, column: C.isPlainObject(e) ? e.StartColumn : null };
    if (!validHit(hit)) throw C.inputError(`gitleaks report: finding ${i + 1} has no usable File, RuleID, StartLine and StartColumn`, 'gitleaks_report');
    return hit;
  });
}

/** { ok: true, sha256 } of the blob at `commit:path`, or { ok: false, reason, detail }. A symlink, a submodule or a blob over 5 MB is refused. */
function blobSha256(root, commit, relPath) {
  if (!COMMIT_RE.test(String(commit)) || !plainRelPath(relPath)) return { ok: false, reason: 'blob_unresolved', detail: 'the commit or path of the hit is not usable' };
  const env = C.ownerGitEnv();
  const ls = spawnSync(C.gitBin(), ['--literal-pathspecs', '-C', root, 'ls-tree', '-z', commit, '--', relPath], { env, encoding: 'utf8', maxBuffer: C.GIT_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
  const m = ls.status === 0 ? /^(100644|100755) blob ([0-9a-f]{40,64})\t/.exec(ls.stdout) : null;
  if (m === null) return { ok: false, reason: 'blob_unresolved', detail: `${C.clip(relPath, 120)} is not a regular file at commit ${commit.slice(0, 12)}` };
  const cat = spawnSync(C.gitBin(), ['-C', root, 'cat-file', 'blob', m[2]], { env, maxBuffer: BLOB_MAX_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });
  if (cat.status !== 0 || !Buffer.isBuffer(cat.stdout)) return { ok: false, reason: 'blob_unresolved', detail: `${C.clip(relPath, 120)} cannot be read at commit ${commit.slice(0, 12)} (missing, or over ${BLOB_MAX_BYTES} bytes)` };
  return { ok: true, sha256: crypto.createHash('sha256').update(cat.stdout).digest('hex') };
}

module.exports = { SUFFIX, HITS_MAX, parseHits, readHits, writeHits, fromGitleaksReport, blobSha256, plainRelPath };
