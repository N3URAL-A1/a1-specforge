'use strict';

// CLI lock of `verify run` (spec 027 FR-017/FR-018, plan D11): one heavy local run per host, replacing the hand-run
// quiet-host poll. Design mirrors the runner lock (`rs_lock_*` in bin/run-suites-proc.sh): atomic mkdir, an owner file
// written by tmp+rename, PID-reuse proof by command line, takeover under a mkdir guard.
//
// NOT a security boundary: a forged A1_VERIFY_LOCK_TOKEN only skips the wait. The lock serialises load; it does not authorize.
//
// Seams (tests only): A1_VERIFY_LOCK_DIR (absolute, parent must exist), A1_VERIFY_LOCK_WAIT_MS (integer 0..900000).
// Re-entrancy: a nested run (a suite that itself runs `verify run`) carries A1_VERIFY_LOCK_TOKEN of the live owner and does not wait.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DEFAULT_WAIT_MS = 900000;
const POLL_MS = 250;
const INIT_BOUND_MS = 10000;
const GUARD_STALE_MS = 30000;
const MAX_OWNER_BYTES = 4096;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const OWNER_FILE = 'owner.json';
const OWNER_TMP_RE = /^owner\.json\.\d+\.tmp$/;

class LockError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

/** @param {NodeJS.ProcessEnv} env @returns {string} */
function lockDirPath(env) {
  const v = env.A1_VERIFY_LOCK_DIR;
  if (v === undefined || v === '') return path.join(os.tmpdir(), `a1-verify-lock-${process.getuid()}`);
  if (!path.isAbsolute(v)) throw new LockError('lock_unusable', 'A1_VERIFY_LOCK_DIR must be an absolute path');
  let st;
  try { st = fs.statSync(path.dirname(v)); } catch (_e) { st = null; }
  if (st === null || !st.isDirectory()) throw new LockError('lock_unusable', 'parent of A1_VERIFY_LOCK_DIR is not a directory');
  return v;
}

/** @param {NodeJS.ProcessEnv} env @returns {number} ceiling in ms */
function lockCeilingMs(env) {
  const v = env.A1_VERIFY_LOCK_WAIT_MS;
  if (v === undefined || v === '') return DEFAULT_WAIT_MS;
  if (!/^\d{1,7}$/.test(v) || Number(v) > DEFAULT_WAIT_MS) throw new LockError('lock_unusable', `A1_VERIFY_LOCK_WAIT_MS must be an integer in 0..${DEFAULT_WAIT_MS}`);
  return Number(v);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function psCmd(pid) {
  const r = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 && typeof r.stdout === 'string' ? r.stdout.trim() : '';
}

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch (_e) { return null; }
}

/** Owner record or null (missing, unreadable, malformed, oversize). */
function readOwner(dir) {
  const file = path.join(dir, OWNER_FILE);
  const st = lstatOrNull(file);
  if (st === null || !st.isFile() || st.size > MAX_OWNER_BYTES) return null;
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ok = o && Number.isInteger(o.pid) && o.pid > 0 && typeof o.token === 'string' && typeof o.cmd === 'string';
    return ok ? o : null;
  } catch (_e) { return null; }
}

/** PID-reuse proof: the pid is alive AND (when recorded) its command line still equals the recorded one. */
function ownerLive(o, psCommand) {
  try { process.kill(o.pid, 0); } catch (e) { if (e.code !== 'EPERM') return false; }
  if (o.cmd === '') return true;
  const cmd = psCommand(o.pid);
  return cmd === '' || cmd === o.cmd;   // an empty or failed ps answer is "live": never take a lock over on a guess
}

function checkDirShape(dir) {
  const st = lstatOrNull(dir);
  if (st === null) return;
  if (st.isSymbolicLink() || !st.isDirectory()) throw new LockError('lock_unusable', `${dir} is not a lock directory`);
  if (st.uid !== process.getuid()) throw new LockError('lock_unusable', `${dir} is not owned by this user`);
  const foreign = fs.readdirSync(dir).filter((n) => n !== OWNER_FILE && !OWNER_TMP_RE.test(n));
  if (foreign.length > 0) throw new LockError('lock_unusable', `${dir} holds foreign entries`);
}

function writeOwner(dir, token, psCommand) {
  const owner = { pid: process.pid, token, cmd: psCommand(process.pid), started_at: new Date().toISOString() };
  const tmp = path.join(dir, `${OWNER_FILE}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, OWNER_FILE));
}

function tryMkdir(dir, token, psCommand) {
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw new LockError('lock_unusable', `cannot create ${dir}: ${e.code || e.message}`);
  }
  try { writeOwner(dir, token, psCommand); } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });   // never leave an owner-less dir behind (the next run would wait for the init bound)
    throw new LockError('lock_unusable', `cannot write the owner record in ${dir}: ${e.code || e.message}`);
  }
  return true;
}

function takeGuard(guard) {
  for (let i = 0; i < 2; i++) {
    try { fs.mkdirSync(guard, { mode: 0o700 }); return true; } catch (_e) { /* held or stale */ }
    const st = lstatOrNull(guard);
    if (st !== null && Date.now() - st.mtimeMs > GUARD_STALE_MS) fs.rmSync(guard, { recursive: true, force: true });
    else return false;
  }
  return false;
}

/** Takeover of a not-live lock under the guard; true when the dir was removed (caller retries the mkdir). */
function takeover(dir, psCommand) {
  const guard = `${dir}.takeover`;
  if (!takeGuard(guard)) return false;
  try {
    const o = readOwner(dir);
    if (o !== null && ownerLive(o, psCommand)) return false;
    if (o === null) {   // a missing owner is only stale past the init bound, also under the guard (the owner may be mid-write)
      const st = lstatOrNull(dir);
      if (st === null || Date.now() - st.mtimeMs <= INIT_BOUND_MS) return false;
    }
    const stale = `${dir}.stale-${crypto.randomBytes(4).toString('hex')}`;
    fs.renameSync(dir, stale);
    fs.rmSync(stale, { recursive: true, force: true });
    return true;
  } catch (_e) {
    return false;
  } finally {
    fs.rmSync(guard, { recursive: true, force: true });
  }
}

function makeRelease(dir, token) {
  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    const o = readOwner(dir);
    process.removeListener('exit', release);
    if (o !== null && o.token === token) fs.rmSync(dir, { recursive: true, force: true });
  };
  process.on('exit', release);
  return release;
}

/**
 * Take the verify lock, waiting up to the ceiling; nests by token.
 * @param {{env?: NodeJS.ProcessEnv, now?: () => number, sleepMs?: (ms: number) => void, psCommand?: (pid: number) => string}} [opts]
 * @returns {{mode: 'held'|'nested', token: string, waitedMs: number, release: () => void}}
 */
function acquireVerifyLock(opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now || Date.now;
  const sleepMs = opts.sleepMs || sleepSync;
  const psCommand = opts.psCommand || psCmd;
  const dir = lockDirPath(env);
  const ceiling = lockCeilingMs(env);
  checkDirShape(dir);
  const given = env.A1_VERIFY_LOCK_TOKEN;
  if (typeof given === 'string' && TOKEN_RE.test(given)) {
    const o = readOwner(dir);
    if (o !== null && o.token === given && ownerLive(o, psCommand)) return { mode: 'nested', token: given, waitedMs: 0, release: () => {} };
  }
  const token = crypto.randomBytes(16).toString('hex');
  const start = now();
  for (;;) {
    if (tryMkdir(dir, token, psCommand)) return { mode: 'held', token, waitedMs: now() - start, release: makeRelease(dir, token) };
    const o = readOwner(dir);
    if (o === null) {
      const st = lstatOrNull(dir);
      if (st !== null && now() - st.mtimeMs > INIT_BOUND_MS && takeover(dir, psCommand)) continue;
    } else if (!ownerLive(o, psCommand) && takeover(dir, psCommand)) {
      continue;
    }
    const waited = now() - start;
    if (waited >= ceiling) {
      throw new LockError('lock_timeout', `verify lock ${dir} held by PID ${o ? o.pid : 'unknown'} for more than ${ceiling} ms`);
    }
    sleepMs(Math.min(POLL_MS, ceiling - waited));
  }
}

module.exports = { acquireVerifyLock, lockCeilingMs, LockError, lockDirPath };
