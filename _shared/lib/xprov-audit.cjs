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
// A store entry names its line (`audit: <sha256 of the line text>`); `verifyAudit` calls the audit ok only when that line is in the
// chain, belongs to the repository, has the matching action and is the LAST permit/denial line for the repository. A line whose store
// write then failed, a truncated log and a hand-written entry therefore show as `broken` (permit-check fails closed on `audit_broken`).
// Appends are serialised with a lock file made as a hard link to a unique nonce file; a stale lock is taken over under a
// `.takeover` mutex by inode compare, and a holder removes only its own lock (inode + nonce).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const OH = require('./xprov-owner-home.cjs');

const AUDIT_FILE = 'consent-audit.jsonl';
const LOCK_FILE = '.consent-audit.lock';
const STORE_LOCK_FILE = '.owner-store.lock'; // the read-modify-write of the owner stores; always taken BEFORE the audit lock, never inside it
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const MAX_BYTES = 8 * 1024 * 1024;
const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 15000;
const LOCK_POLL_MS = 25;
const FUTURE_SKEW_MS = 5000; // a lock stamped further ahead than this is not a live holder's (clock skew stays below it)
const FIELD_MAX_CHARS = 200;
const LINE_KEYS = Object.freeze(['ts', 'repo', 'action', 'tool_use_id', 'session_id', 'permission_mode', 'prev']);
const STATE = Object.freeze({ OK: 'ok', MISSING: 'missing', BROKEN: 'broken' });
// Actions that stand for a permit or a denial of a repository. `permit-check` calls the audit `ok` only when the
// chain holds AND the store entry names (`audit: <sha>`) a line that is the LAST of these for the repository and
// whose action matches the entry kind (SEC-1).
const ACTION = Object.freeze({
  PERMIT: 'permit', PERMIT_DENY: 'permit-deny', WAIVE: 'waive', ALLOWLIST_APPROVE: 'allowlist-approve', ALLOWLIST_REVOKE: 'allowlist-revoke',
  CONSENT: 'consent', CONSENT_DENY: 'consent-deny', CONSENT_REVOKE: 'consent-revoke', CONSENT_WAIVE: 'consent-waive', CONSENT_ALLOWLIST: 'consent-allowlist', CONSENT_CLASSIFY: 'consent-classify',
});
// A revoke supersedes every earlier grant line of the repository: a store entry restored from a backup after `consent revoke`
// names a superseded line and shows as `broken` (security review 2026-10-14, MAJOR-1).
const GRANT_ACTIONS = Object.freeze([ACTION.PERMIT, ACTION.PERMIT_DENY, ACTION.CONSENT, ACTION.CONSENT_DENY, ACTION.CONSENT_REVOKE]);
const KIND_ACTIONS = Object.freeze({ allowed: [ACTION.PERMIT, ACTION.CONSENT], denied: [ACTION.PERMIT_DENY, ACTION.CONSENT_DENY] });
const SHA_RE = /^[0-9a-f]{64}$/;
const ACTION_RE = /^[a-z][a-z0-9-]{0,39}$/;

const auditPath = () => path.join(X.xprovHome(), AUDIT_FILE);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// SEC-8: no control, C1, line-separator or bidi character in a free-text field (a fresh RegExp: the shared one is /g).
// Re-review MINOR-4: also every Unicode format character (Cf: U+200B..U+200F, U+061C, U+2060, U+FEFF, soft hyphen ...), which render as nothing.
const LINE_BREAKERS = new RegExp(`${C.LINE_BREAKERS_RE.source}|\\p{Cf}`, 'u');
const nullableString = (v) => v === null || (typeof v === 'string' && v.length <= FIELD_MAX_CHARS && !LINE_BREAKERS.test(v));
/** The sha256 a store entry keeps as `audit`: that of the exact text of the line as written. */
const lineSha = (line) => sha256(JSON.stringify(line));

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
  const shas = [];
  let prev = null;
  for (let i = 0; i < raw.length; i++) {
    let o;
    try { o = JSON.parse(raw[i]); } catch (_e) { return { state: STATE.BROKEN, lines, why: `line ${i + 1} is not JSON` }; }
    if (!validLine(o)) return { state: STATE.BROKEN, lines, why: `line ${i + 1} is off-format` };
    if (o.prev !== prev) return { state: STATE.BROKEN, lines, why: `line ${i + 1} does not chain to line ${i}` };
    lines.push(Object.freeze(o));
    prev = sha256(raw[i]);
    shas.push(prev);
  }
  return { state: STATE.OK, lines, shas, tip: prev };
}

const verdict = (state, why) => Object.freeze({ state, why: why || null });

/** An entry written by the spec-016 code carries `audit`; a permit entry also `repo` or `origin`. Others are legacy. */
const bound = (entry, kind) => entry.audit !== undefined || (kind === 'allowed' && (entry.repo !== undefined || entry.origin !== undefined));

/**
 * The audit state of one store entry (SEC-1). `entry` is the permit entry (kind 'allowed') or the denial entry
 * (kind 'denied') of `repoKey`, or undefined. ok  = the chain holds AND `entry.audit` names a line of this repository,
 * of the matching action, that is the last permit/denial line for it. broken = chain broken, or a bound entry whose line is
 * absent, foreign, of another action or superseded (truncation, a failed store write after the line, a forged entry).
 * missing = no log / legacy entry without an audit binding / no entry.
 */
function verifyAudit(entry, repoKey, kind, file) {
  const chain = readChain(file);
  if (chain.state === STATE.BROKEN) return verdict(STATE.BROKEN, chain.why);
  if (!entry || !bound(entry, kind)) return verdict(STATE.MISSING, 'no audited store entry for this repository');
  if (chain.state === STATE.MISSING) return verdict(STATE.BROKEN, 'the store entry names an audit line but there is no audit log');
  const idx = typeof entry.audit === 'string' && SHA_RE.test(entry.audit) ? chain.shas.indexOf(entry.audit) : -1;
  if (idx < 0) return verdict(STATE.BROKEN, 'the audit line of the store entry is not in the chain');
  const line = chain.lines[idx];
  if (line.repo !== repoKey || !KIND_ACTIONS[kind].includes(line.action)) return verdict(STATE.BROKEN, 'the audit line of the store entry is for another repository or action');
  const later = chain.lines.slice(idx + 1).some((l) => l.repo === repoKey && GRANT_ACTIONS.includes(l.action));
  return later ? verdict(STATE.BROKEN, 'a later permit or denial line for this repository supersedes the audit line of the store entry') : verdict(STATE.OK);
}

/**
 * Whether the audit line named by `sha` is in the chain, belongs to `repoKey`, has `action` and is not superseded by a later
 * `consent-revoke` of the same repository (MINOR-4: a stored Einstufung must be vouched for like a permit). { state, why }.
 */
function verifyLineOf(sha, repoKey, action, file) {
  const chain = readChain(file);
  if (chain.state === STATE.BROKEN) return verdict(STATE.BROKEN, chain.why);
  if (chain.state === STATE.MISSING) return verdict(STATE.BROKEN, 'there is no audit log');
  const idx = typeof sha === 'string' && SHA_RE.test(sha) ? chain.shas.indexOf(sha) : -1;
  if (idx < 0) return verdict(STATE.BROKEN, 'the audit line of the store entry is not in the chain');
  const line = chain.lines[idx];
  if (line.repo !== repoKey || line.action !== action) return verdict(STATE.BROKEN, 'the audit line of the store entry is for another repository or action');
  const revoked = chain.lines.slice(idx + 1).some((l) => l.repo === repoKey && l.action === ACTION.CONSENT_REVOKE);
  return revoked ? verdict(STATE.BROKEN, 'a later revoke of this repository supersedes the audit line of the store entry') : verdict(STATE.OK);
}

function ensureHome() {
  const home = X.xprovHome();
  try { fs.mkdirSync(home, { mode: DIR_MODE }); } catch (e) { if (e.code !== 'EEXIST') throw e; } // a parallel first writer may win the race
  const st = fs.lstatSync(home);
  if (st.isSymbolicLink() || !st.isDirectory()) throw C.inputError(`${home} is not a real directory; refusing to write the audit log`, 'audit_dir');
  fs.chmodSync(home, DIR_MODE);
  return home;
}

const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev;

/** A leftover `.takeover` slot (re-review MINOR-3). A non-directory is refused (`audit_lock_blocked`, naming the path) and never touched.
 * A directory older than the stale threshold is removed when empty, else renamed aside to a unique name (never a recursive delete of
 * something this module did not create); a fresh one is left for its owner. */
function clearStaleGuard(guard) {
  let st = null;
  try { st = fs.lstatSync(guard); } catch (_e) { return; } // raced away
  if (!st.isDirectory()) throw C.inputError(`${guard} exists and is not a directory; remove it yourself so the audit log can be written; nothing written`, 'audit_lock_blocked');
  if (!isStale(st, Date.now())) return;
  try { fs.rmdirSync(guard); return; } catch (_e) { /* not empty (or raced): move it aside below */ }
  try { fs.renameSync(guard, `${guard}.stale.${crypto.randomBytes(8).toString('hex')}`); } catch (_e) { /* raced away */ }
}

/** Takes over the stale lock `observed` (an lstat taken earlier). One taker at a time (a `.takeover` directory, itself taken over when stale);
 * under it the lock is re-read, and only the very inode that was observed stale is moved to a unique name and deleted. A fresh lock that
 * replaced it is left (or, if it was moved in a race, put back). */
function takeoverStale(lock, observed) {
  const guard = `${lock}.takeover`;
  try { fs.mkdirSync(guard, { mode: DIR_MODE }); } catch (e) {
    if (e.code === 'EEXIST') clearStaleGuard(guard);
    return false;
  }
  try {
    let now = null;
    try { now = fs.lstatSync(lock); } catch (_e) { return false; }
    if (!sameFile(now, observed)) return false;
    const moved = `${lock}.stale.${crypto.randomBytes(8).toString('hex')}`;
    try { fs.renameSync(lock, moved); } catch (_e) { return false; }
    let st = null;
    try { st = fs.lstatSync(moved); } catch (_e) { return false; }
    if (sameFile(st, observed)) { fs.rmSync(moved, { force: true }); return true; }
    try { fs.linkSync(moved, lock); } catch (_e) { /* the slot is taken again; its holder checks ownership on release */ }
    fs.rmSync(moved, { force: true });
    return false;
  } finally { try { fs.rmdirSync(guard); } catch (_e) { /* gone */ } }
}

/** A lock is stale when its mtime is older than the threshold, or lies in the FUTURE beyond the clock-skew tolerance (R-1: an mtime
 * pushed to the year 2100 must not block every owner write for good). */
const isStale = (st, nowMs) => nowMs - st.mtimeMs > LOCK_STALE_MS || st.mtimeMs - nowMs > FUTURE_SKEW_MS;

/** The refusal for a lock that stayed taken: it names WHICH lock (owner stores or audit log), its path and its age (R-1). */
function lockedError(lockFile, lock, observed) {
  const store = lockFile === STORE_LOCK_FILE;
  const ageS = observed === null ? null : Math.round((Date.now() - observed.mtimeMs) / 1000);
  const age = ageS === null ? 'it was released as we gave up' : (ageS < 0 ? `its mtime lies ${-ageS} s in the future` : `held for ${ageS} s`);
  return C.inputError(`the ${store ? 'owner stores are' : 'audit log is'} locked by another process (${store ? 'store lock' : 'audit lock'} ${lock}; ${age}; a lock older than ${LOCK_STALE_MS / 1000} s is taken over, a live one is waited for ${LOCK_WAIT_MS / 1000} s); nothing written`, store ? 'store_locked' : 'audit_locked');
}

/** Creates the lock as a hard link to a unique nonce file (atomic, fails with EEXIST while held). */
function acquire(home, lockFile) {
  const lock = path.join(home, lockFile);
  const nonce = crypto.randomBytes(16).toString('hex');
  const mine = `${lock}.${nonce}`;
  fs.writeFileSync(mine, nonce, { flag: 'wx', mode: FILE_MODE });
  const deadline = Date.now() + LOCK_WAIT_MS;
  try {
    for (;;) {
      try { fs.linkSync(mine, lock); const st = fs.lstatSync(lock); return { lock, nonce, ino: st.ino, dev: st.dev }; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
      let observed = null;
      try { observed = fs.lstatSync(lock); } catch (_e) { /* released meanwhile */ }
      if (observed !== null && isStale(observed, Date.now()) && takeoverStale(lock, observed)) continue;
      if (Date.now() > deadline) throw lockedError(lockFile, lock, observed);
      sleepMs(LOCK_POLL_MS);
    }
  } finally { fs.rmSync(mine, { force: true }); }
}

/** Removes the lock only when it is still the one this process created (inode and nonce). */
function release(h) {
  try {
    const st = fs.lstatSync(h.lock);
    if (sameFile(st, h) && fs.readFileSync(h.lock, 'utf8') === h.nonce) fs.rmSync(h.lock, { force: true });
  } catch (_e) { /* gone or replaced: not ours to remove */ }
}

function withLock(home, body, lockFile) {
  const held = acquire(home, lockFile || LOCK_FILE);
  try { return body(); } finally { release(held); }
}

/**
 * Runs `body` while holding the owner-store lock (security review 2026-10-14, MAJOR-1): every read-modify-write of permits.json,
 * permit-denials.json and consent.json (consent record / revoke, terminal permit / permit --deny) reads the stores INSIDE this lock,
 * so a parallel writer cannot restore an entry the other one just removed. Not re-entrant; the audit lock is taken inside it.
 */
function withStoreLock(body) {
  OH.assertWritable();
  return withLock(ensureHome(), body, STORE_LOCK_FILE);
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

module.exports = { AUDIT_FILE, LOCK_FILE, STORE_LOCK_FILE, LINE_KEYS, STATE, ACTION, GRANT_ACTIONS, auditPath, readChain, verifyAudit, verifyLineOf, appendAudit, lineSha, withLock, withStoreLock, takeoverStale };
