'use strict';

// ---------------------------------------------------------------------------
// xprov-audit — the hash-chained consent audit log (spec 016 FR-010; wave 1).
//
//   <owner home>/.a1-xprov/consent-audit.jsonl
//     one JSON object per line: { ts, repo, action, tool_use_id, session_id, permission_mode, prev }
//     `prev` = sha256 (hex) of the previous line's exact text, null on the first line.
//
// Tier 0: the chain makes a naive edit or a hand-written store entry VISIBLE
// (`audit: broken` / `audit: missing` in `permit-check`). It does not prevent
// anything: the same OS user can rewrite the whole file and its chain. No text
// may say otherwise.
//
// Writers append BEFORE they change a store, so a store write without an audit
// line is impossible through the code paths; a failing append aborts the write.
// Appends are serialised with a lock file (a stale lock is taken over).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const OH = require('./xprov-owner-home.cjs');

const AUDIT_FILE = 'consent-audit.jsonl';
const LOCK_FILE = '.consent-audit.lock';
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const MAX_BYTES = 8 * 1024 * 1024;
const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 15000;
const LOCK_POLL_MS = 25;
const FIELD_MAX_CHARS = 200;
const LINE_KEYS = Object.freeze(['ts', 'repo', 'action', 'tool_use_id', 'session_id', 'permission_mode', 'prev']);
const STATE = Object.freeze({ OK: 'ok', MISSING: 'missing', BROKEN: 'broken' });
// Actions that stand for a permit or a denial of a repository; `permit-check` calls the audit `ok` only when
// the chain holds AND the repository has at least one of these.
const ACTION = Object.freeze({
  PERMIT: 'permit', PERMIT_DENY: 'permit-deny', WAIVE: 'waive', ALLOWLIST_APPROVE: 'allowlist-approve', ALLOWLIST_REVOKE: 'allowlist-revoke',
  CONSENT: 'consent', CONSENT_DENY: 'consent-deny', CONSENT_REVOKE: 'consent-revoke', CONSENT_WAIVE: 'consent-waive', CONSENT_ALLOWLIST: 'consent-allowlist',
});
const GRANT_ACTIONS = Object.freeze([ACTION.PERMIT, ACTION.PERMIT_DENY, ACTION.CONSENT, ACTION.CONSENT_DENY]);
const ACTION_RE = /^[a-z][a-z0-9-]{0,39}$/;

const auditPath = () => path.join(X.xprovHome(), AUDIT_FILE);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const nullableString = (v) => v === null || (typeof v === 'string' && v.length <= FIELD_MAX_CHARS && !/[\0-\x1f\x7f]/.test(v));

function validLine(o) {
  if (!C.isPlainObject(o)) return false;
  const keys = Object.keys(o);
  if (keys.length !== LINE_KEYS.length || !LINE_KEYS.every((k) => keys.includes(k))) return false;
  return typeof o.ts === 'string' && o.ts !== '' && typeof o.repo === 'string' && o.repo !== ''
    && typeof o.action === 'string' && ACTION_RE.test(o.action)
    && nullableString(o.tool_use_id) && nullableString(o.session_id) && nullableString(o.permission_mode)
    && (o.prev === null || /^[0-9a-f]{64}$/.test(o.prev));
}

/** Reads the log text without following a symlink. { text } | { missing: true } | { broken: why }. */
function readText(file) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch (e) {
    return e.code === 'ENOENT' ? { missing: true } : { broken: 'the audit log cannot be opened (symlink or unreadable)' };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { broken: 'the audit log is not a regular file' };
    if (st.size > MAX_BYTES) return { broken: 'the audit log exceeds its size bound' };
    if (st.size === 0) return { missing: true };
    return { text: fs.readFileSync(fd, 'utf8') };
  } catch (_e) { return { broken: 'the audit log cannot be read' }; } finally { fs.closeSync(fd); }
}

/** Parses the whole chain. { state, lines } with state ok|missing|broken (`why` when broken). */
function readChain(file) {
  const r = readText(file || auditPath());
  if (r.missing) return { state: STATE.MISSING, lines: [] };
  if (r.broken) return { state: STATE.BROKEN, lines: [], why: r.broken };
  if (!r.text.endsWith('\n')) return { state: STATE.BROKEN, lines: [], why: 'the last audit line is incomplete' };
  const raw = r.text.slice(0, -1).split('\n');
  const lines = [];
  let prev = null;
  for (let i = 0; i < raw.length; i++) {
    let o;
    try { o = JSON.parse(raw[i]); } catch (_e) { return { state: STATE.BROKEN, lines, why: `line ${i + 1} is not JSON` }; }
    if (!validLine(o)) return { state: STATE.BROKEN, lines, why: `line ${i + 1} is off-format` };
    if (o.prev !== prev) return { state: STATE.BROKEN, lines, why: `line ${i + 1} does not chain to line ${i}` };
    lines.push(Object.freeze(o));
    prev = sha256(raw[i]);
  }
  return { state: STATE.OK, lines, tip: prev };
}

/** The audit state for one repository key: broken (chain), missing (no log, or no grant line for the repo), ok. */
function verifyAudit(repoKey, file) {
  const chain = readChain(file);
  if (chain.state !== STATE.OK) return Object.freeze({ state: chain.state, why: chain.why || null });
  const has = chain.lines.some((l) => l.repo === repoKey && GRANT_ACTIONS.includes(l.action));
  return Object.freeze({ state: has ? STATE.OK : STATE.MISSING, why: has ? null : 'no permit or denial line for this repository' });
}

function ensureHome() {
  const home = X.xprovHome();
  try { fs.mkdirSync(home, { mode: DIR_MODE }); } catch (e) { if (e.code !== 'EEXIST') throw e; } // a parallel first writer may win the race
  const st = fs.lstatSync(home);
  if (st.isSymbolicLink() || !st.isDirectory()) throw C.inputError(`${home} is not a real directory; refusing to write the audit log`, 'audit_dir');
  fs.chmodSync(home, DIR_MODE);
  return home;
}

function withLock(home, body) {
  const lock = path.join(home, LOCK_FILE);
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(lock, 'wx', FILE_MODE); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.lstatSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true }); } catch (_e) { /* raced away */ }
      if (Date.now() > deadline) throw C.inputError('the audit log is locked by another process; nothing written', 'audit_locked');
      sleepMs(LOCK_POLL_MS);
    }
  }
  try { return body(); } finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }); }
}

const field = (v) => (v === undefined || v === null ? null : String(v).slice(0, FIELD_MAX_CHARS));

/**
 * Appends one chained line and returns it. Throws a typed input error (nothing appended) when the
 * home tripwire holds, the existing chain is broken (an edited log is never extended), or the file cannot be written.
 * `o`: { repo, action, now?, tool_use_id?, session_id?, permission_mode? }.
 */
function appendAudit(o) {
  OH.assertWritable();
  if (!o || typeof o.repo !== 'string' || o.repo === '') throw C.inputError('audit: repo is required', 'audit_input');
  if (typeof o.action !== 'string' || !ACTION_RE.test(o.action)) throw C.inputError('audit: action is not a plain name', 'audit_input');
  const home = ensureHome();
  return withLock(home, () => {
    const file = path.join(home, AUDIT_FILE);
    const chain = readChain(file);
    if (chain.state === STATE.BROKEN) throw C.inputError(`the audit log is broken (${chain.why}); fix or remove ${file} yourself; nothing written`, 'audit_broken');
    const line = {
      ts: o.now || new Date().toISOString(), repo: o.repo, action: o.action,
      tool_use_id: field(o.tool_use_id), session_id: field(o.session_id), permission_mode: field(o.permission_mode),
      prev: chain.state === STATE.OK ? chain.tip : null,
    };
    if (!validLine(line)) throw C.inputError('audit: line is off-format; nothing written', 'audit_input');
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, FILE_MODE);
    try {
      fs.fchmodSync(fd, FILE_MODE);
      fs.writeSync(fd, `${JSON.stringify(line)}\n`);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    return Object.freeze(line);
  });
}

module.exports = { AUDIT_FILE, LINE_KEYS, STATE, ACTION, GRANT_ACTIONS, auditPath, readChain, verifyAudit, appendAudit };
