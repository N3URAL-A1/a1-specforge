'use strict';
// ux-studio gate store (spec 024 PR review, FR-013/FR-014). The gate-record.json in a run folder is NOT trusted on its own:
// anyone who can write the run folder could forge `pass` or `accepted`. Two facts therefore live OUTSIDE the run folder, in a
// per-user, append-only, hash-chained log under the passwd home (same tier as the xprov consent audit, spec 016):
//
//   <passwd home>/.a1-ux-studio/gate-store.jsonl
//     { kind: 'run',    ts, run_dir, target_sha256, digest, prev }          written by `ux-gate run`
//     { kind: 'accept', ts, run_dir, target_sha256, finding, reason, prev } written by `ux-gate accept` (TTY only)
//     prev = sha256 of the previous line's exact text (null on the first line)
//
// handoff-check recomputes the record's digest and compares it with the latest `run` line of the run folder, and requires
// a matching `accept` line (after that run) for every accepted item. Tier 0 stays: the same OS user can rewrite the whole
// file and its chain with raw Bash; the plugin hook denies Edit/Write of the store and of gate-record.json. See workflows/05-gate.md.
//
// Test seam (same as xprov, spec 016 plan D-2): the passwd home comes from _shared/lib/xprov-owner-home.cjs, which the fixture
// harness swaps in its tree COPY. No environment variable can redirect the store in production.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const OH = require('../../../../_shared/lib/xprov-owner-home.cjs');
const acceptGuard = require('./store-accept-guard.cjs');

const DIR_NAME = '.a1-ux-studio';
const FILE_NAME = 'gate-store.jsonl';
const LOCK_NAME = '.gate-store.lock';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const OTHERS_WRITE = 0o022;
const MAX_BYTES = 8 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{64}$/;
const KINDS = Object.freeze(['run', 'accept']);
const RUN_KEYS = ['kind', 'ts', 'run_dir', 'target_sha256', 'digest', 'prev'];
const ACCEPT_KEYS = ['kind', 'ts', 'run_dir', 'target_sha256', 'finding', 'reason', 'prev'];

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const storeDir = () => path.join(OH.ownerHome(), DIR_NAME);
const storeFile = () => path.join(storeDir(), FILE_NAME);

const RECOVERY = 'Ask the owner; do not delete the store (workflows/05-gate.md section 7 has the owner recovery).';
class StoreError extends Error {
  constructor(message) { super(`${message}. ${RECOVERY}`); }
}

const ownedByMe = (st) => typeof process.getuid !== 'function' || st.uid === process.getuid();

/** Refuses a symlink, a non-directory, a foreign owner and a group- or world-writable directory. Returns false when absent and !create. */
function checkDir(dir, create) {
  let st;
  try { st = fs.lstatSync(dir); } catch (e) {
    if (e.code !== 'ENOENT') throw new StoreError(`gate store directory cannot be read (${e.code})`);
    if (!create) return false;
    try { fs.mkdirSync(dir, { mode: DIR_MODE }); } catch (e2) { if (e2.code !== 'EEXIST') throw new StoreError(`gate store directory cannot be created (${e2.code})`); }
    st = fs.lstatSync(dir);
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new StoreError('gate store directory is a symlink or not a directory');
  if (!ownedByMe(st)) throw new StoreError('gate store directory is owned by another user');
  if ((st.mode & OTHERS_WRITE) !== 0) throw new StoreError('gate store directory is group- or world-writable');
  return true;
}

function readText(file) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch (e) {
    if (e.code === 'ENOENT') return { missing: true };
    throw new StoreError('gate store file cannot be opened (symlink or unreadable)');
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new StoreError('gate store file is not a regular file');
    if (!ownedByMe(st)) throw new StoreError('gate store file is owned by another user');
    if ((st.mode & OTHERS_WRITE) !== 0) throw new StoreError('gate store file is group- or world-writable');
    if (st.size > MAX_BYTES) throw new StoreError('gate store file exceeds its size bound');
    return st.size === 0 ? { missing: true } : { text: fs.readFileSync(fd, 'utf8') };
  } finally { fs.closeSync(fd); }
}

const isStr = (v) => typeof v === 'string' && v !== '';

function validEntry(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o) || !KINDS.includes(o.kind)) return false;
  const want = o.kind === 'run' ? RUN_KEYS : ACCEPT_KEYS;
  const keys = Object.keys(o);
  if (keys.length !== want.length || !want.every((k) => keys.includes(k))) return false;
  if (!isStr(o.ts) || !isStr(o.run_dir) || !SHA_RE.test(String(o.target_sha256))) return false;
  if (o.prev !== null && !SHA_RE.test(String(o.prev))) return false;
  return o.kind === 'run' ? SHA_RE.test(String(o.digest)) : isStr(o.finding) && typeof o.reason === 'string';
}

/** The whole chain. { entries, tip } or { missing: true }; throws StoreError when the directory, file or chain is not trustworthy. */
function readChain(create) {
  if (!checkDir(storeDir(), create)) return { missing: true };
  const r = readText(storeFile());
  if (r.missing) return { missing: true };
  if (!r.text.endsWith('\n')) throw new StoreError('the last gate store line is incomplete');
  const raw = r.text.slice(0, -1).split('\n');
  const entries = [];
  let prev = null;
  raw.forEach((line, i) => {
    let o;
    try { o = JSON.parse(line); } catch (_e) { throw new StoreError(`gate store line ${i + 1} is not JSON`); }
    if (!validEntry(o)) throw new StoreError(`gate store line ${i + 1} is off-format`);
    if (o.prev !== prev) throw new StoreError(`gate store line ${i + 1} does not chain to line ${i}`);
    entries.push(Object.freeze(o));
    prev = sha256(line);
  });
  return { entries, tip: prev };
}

function append(fields) {
  const { withLock } = require('../../../../_shared/lib/xprov-audit.cjs'); // lazy: handoff-check (read-only) never loads it
  checkDir(storeDir(), true);
  return withLock(storeDir(), () => {
    const chain = readChain(true);
    const entry = { ...fields, ts: new Date().toISOString(), prev: chain.missing ? null : chain.tip };
    const keys = entry.kind === 'run' ? RUN_KEYS : ACCEPT_KEYS;
    const ordered = Object.fromEntries(keys.map((k) => [k, entry[k]]));
    if (!validEntry(ordered)) throw new StoreError('gate store entry is off-format; nothing written');
    const fd = fs.openSync(storeFile(), fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, FILE_MODE);
    try {
      fs.fchmodSync(fd, FILE_MODE);
      fs.writeSync(fd, `${JSON.stringify(ordered)}\n`);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    return ordered;
  }, LOCK_NAME);
}

const list = (v) => (Array.isArray(v) ? v : []);
const at = (o, k) => (o && typeof o === 'object' ? o[k] : undefined);

/** sha256 over the canonical content `run` produced: target, status, findings, font failures. State, reasons and accepted_by are not in it (accept changes them). */
function runDigest(rec) {
  const canon = {
    target: at(rec, 'target') ?? null,
    target_sha256: at(rec, 'target_sha256') ?? null,
    exit_code: at(rec, 'exit_code') ?? null,
    status: at(rec, 'status') ?? null,
    cause: at(rec, 'cause') ?? null,
    findings: list(at(rec, 'findings')).map((f) => [at(f, 'id'), at(f, 'rule'), at(f, 'severity'), at(f, 'location'), at(f, 'detail') ?? '']),
    font_status: at(at(rec, 'font_check'), 'status') ?? null,
    font_failures: list(at(at(rec, 'font_check'), 'failures')).map((x) => [at(x, 'font'), at(x, 'reason')]),
  };
  return sha256(JSON.stringify(canon));
}

const realDir = (runDir) => fs.realpathSync(runDir);

function recordRun(runDir, rec) {
  return append({ kind: 'run', run_dir: realDir(runDir), target_sha256: rec.target_sha256, digest: runDigest(rec) });
}

function recordAccept(runDir, rec, finding, reason) {
  const why = acceptGuard.terminalProblem(); // Robert's decision: refused for any caller that is not a real terminal outside Claude Code
  if (why !== null) throw new StoreError(`an acceptance can only be recorded by Robert at a real terminal: ${why}`);
  return append({ kind: 'accept', run_dir: realDir(runDir), target_sha256: rec.target_sha256, finding, reason });
}

/** The latest `run` line of the run folder, with the accept lines that follow it. { run, accepts } | { blocker }. */
function latestRun(runDir) {
  let chain;
  try { chain = readChain(false); } catch (e) {
    if (e instanceof StoreError) return { blocker: `gate store is not trustworthy: ${e.message}` };
    throw e;
  }
  if (chain.missing) return { blocker: 'no gate run is recorded for this run folder (gate-record.json was not written by ux-gate run): run the gate' };
  const key = realDir(runDir);
  const idx = chain.entries.map((e, i) => (e.kind === 'run' && e.run_dir === key ? i : -1)).filter((i) => i >= 0).pop();
  if (idx === undefined) return { blocker: 'no gate run is recorded for this run folder (gate-record.json was not written by ux-gate run): run the gate' };
  const run = chain.entries[idx];
  const accepts = chain.entries.slice(idx + 1).filter((e) => e.kind === 'accept' && e.run_dir === key && e.target_sha256 === run.target_sha256);
  return { run, accepts };
}

/** null when the record is the one the latest recorded gate run produced, else one reason. */
function recordMismatch(runDir, rec) {
  const l = latestRun(runDir);
  if (l.blocker) return l.blocker;
  const same = at(rec, 'target_sha256') === l.run.target_sha256 && runDigest(rec) === l.run.digest;
  return same ? null : 'gate record does not match the recorded gate run (hand-edited or forged): run the gate again';
}

const clip = (v) => String(v ?? '').replace(/[\x00-\x1f]+/g, ' ').slice(0, 120);
const noReason = (r) => !(typeof r === 'string' && r.trim() !== '');

/** Every accepted item of the record (findings and font failures) as { label, key, reason }. Advisories are never accepted. */
function acceptedItems(rec) {
  const f = list(at(rec, 'findings')).filter((x) => at(x, 'state') === 'accepted' && at(x, 'severity') !== 'advisory')
    .map((x) => ({ label: `finding ${clip(at(x, 'id'))}`, key: at(x, 'id'), reason: at(x, 'reason') }));
  const t = list(at(at(rec, 'font_check'), 'failures')).filter((x) => at(x, 'state') === 'accepted')
    .map((x) => ({ label: `font failure ${clip(at(x, 'font'))}`, key: `font:${at(x, 'font')}`, reason: at(x, 'reason_text') }));
  return [...f, ...t];
}

/** Blockers for the record: it must match the latest recorded run, every accepted item needs a recorded acceptance with the same reason. */
function verifyRecord(runDir, rec) {
  const l = latestRun(runDir);
  if (l.blocker) return [l.blocker];
  const mismatch = recordMismatch(runDir, rec);
  const out = mismatch ? [mismatch] : [];
  const missing = acceptedItems(rec).filter((it) => !noReason(it.reason) && !l.accepts.some((a) => a.finding === it.key && a.reason === it.reason));
  return [...out, ...missing.map((it) => `acceptance of ${it.label} has no entry in the gate store (only ux-gate accept at a terminal records one)`)];
}

module.exports = { DIR_NAME, FILE_NAME, StoreError, storeDir, storeFile, readChain, runDigest, recordRun, recordAccept, recordMismatch, verifyRecord };
