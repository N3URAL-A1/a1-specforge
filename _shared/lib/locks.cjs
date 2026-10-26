'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { nowIso, fail } = require('./io.cjs');
const { hostIdentity } = require('./vault-common.cjs');

// ---------------------------------------------------------------------------
// check reservations — P7 cross-run coordination registry.
//
// A shared claim registry (.a1/reservations.json) so parallel runs don't
// collide on migration numbers, route paths, etc. (`parallel_collision`, 3× in
// corpus). Deterministic, atomic (tmp+rename). A claim is <type>:<value> held
// `by` a spec-id. Re-claiming a value already held by a DIFFERENT spec => exit 1
// with holder info. Same spec re-claiming => exit 0 (idempotent).
// ---------------------------------------------------------------------------

function reservationsFile(flags) {
  return flags.file ? path.resolve(flags.file) : path.join(process.cwd(), '.a1', 'reservations.json');
}

function loadReservations(file) {
  if (!fs.existsSync(file)) return { reservations: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.reservations)) return { reservations: [] };
    return parsed;
  } catch (_e) {
    return { reservations: [] };
  }
}

function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

const RESERVATIONS_LOCK_RETRIES = 20;
const RESERVATIONS_LOCK_RETRY_DELAY_MS = 50;
// A lock whose owning process is dead is reclaimed immediately (see
// isLockStale). A lock whose owning process is still alive but has held the
// lock longer than this is also treated as stale — this is the crash-without-
// cleanup safety net (SIGKILL/OOM between openSync and release leaves a lock
// file with no process to detect as dead via process.kill(pid, 0) IF the pid
// got reused, however unlikely; the timeout bounds that edge case too). Five
// minutes is generously above any real product-command runtime.
const RESERVATIONS_LOCK_STALE_MS = 5 * 60 * 1000;
// Clock skew tolerated between the two hosts of a synced checkout. A lock
// dated further ahead than this is invalid (a foreign lock is judged by age
// alone, so a future date would otherwise keep it live forever) → stale.
const RESERVATIONS_LOCK_FUTURE_SKEW_MS = 60 * 1000;
// A real payload is ~100 bytes; anything this large is not a lock we wrote.
const RESERVATIONS_LOCK_MAX_BYTES = 4096;

/** Best-effort synchronous sleep (busy-wait via Atomics) — no external deps,
 * bounded by the caller's retry count so it can never hang. */
function sleepSyncMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

/** Returns true if the process identified by `pid` is no longer running.
 * process.kill(pid, 0) sends no signal but still performs the existence
 * check; it throws ESRCH if the pid is dead, EPERM if it's alive but owned
 * by another user (still "alive" for our purposes). */
function isPidDead(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === 'ESRCH';
  }
}

/** The host name locks carry and compare (spec 010 FR-032/FR-033, amended
 * 2026-09-28): ONE function for payload and staleness — the FR-039 host
 * identity when it is valid, else os.hostname(), so a configuration error
 * never blocks the lock. */
function lockHostIdentity(env = process.env, osHost = os.hostname()) {
  const id = hostIdentity(env, osHost);
  return id.source === 'invalid' ? osHost : id.host;
}

/** The lock file content (spec 010 FR-032): a fresh {pid, createdAt,
 * hostname} object. `hostname` lets a reader on the OTHER machine of a synced
 * checkout tell that the pid is not one of its own processes. */
function lockPayload() {
  return JSON.stringify({ pid: process.pid, createdAt: nowIso(), hostname: lockHostIdentity() });
}

/** True when the payload names a host other than this one (FR-033). A payload
 * without `hostname` (pre-feature format) is treated as same-host, so its
 * pid test keeps today's behaviour. A synced lock that claims THIS host's
 * name is same-host by design: a hostname is a label, not a credential — two
 * machines sharing a name is a configuration error the pid test then sees. */
function isForeignHost(payload) {
  const host = payload && payload.hostname;
  return typeof host === 'string' && host !== '' && host !== lockHostIdentity();
}

/** The lock file as utf8 when it is at most RESERVATIONS_LOCK_MAX_BYTES, else
 * '' (fails JSON.parse → stale); never reads more than MAX+1 bytes. Throws
 * like readFileSync when the file is gone. */
function readLockBounded(lockPath) {
  const fd = fs.openSync(lockPath, 'r');
  try {
    const buf = Buffer.alloc(RESERVATIONS_LOCK_MAX_BYTES + 1);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return n > RESERVATIONS_LOCK_MAX_BYTES ? '' : buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Decide whether an existing `<file>.lock` is stale (safe to reclaim)
 * rather than actively held. Reads the {pid, createdAt, hostname} JSON payload
 * written by acquireReservationsLock. A lock is stale if: the file can't be
 * parsed (pre-fix lock format, or corrupted — never block forever on either),
 * the owning pid is no longer running (own host only — a foreign host's pid
 * says nothing about processes here, FR-033), or the lock is older than
 * RESERVATIONS_LOCK_STALE_MS. Never throws — any error while inspecting the
 * lock is treated as "stale" so a broken lock file can never wedge the
 * product-command family permanently. */
function isLockStale(lockPath) {
  let raw;
  try {
    raw = readLockBounded(lockPath);
  } catch (_e) {
    // Lock disappeared between EEXIST and this read (another process beat
    // us to reclaiming it, or released it normally) — not our lock to
    // reclaim, but also not something to error out on; caller will just
    // retry the openSync.
    return false;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_e) {
    // Unreadable/legacy lock content — can't prove it's live, so treat as
    // stale rather than blocking every future command on a corrupt file.
    return true;
  }
  const { pid, createdAt } = payload || {};
  if (!isForeignHost(payload) && isPidDead(pid)) return true;
  const createdMs = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(createdMs)) return true;
  const ageMs = Date.now() - createdMs;
  if (ageMs < -RESERVATIONS_LOCK_FUTURE_SKEW_MS) return true;
  return ageMs > RESERVATIONS_LOCK_STALE_MS;
}

/** Acquire an exclusive lock for read-check-write sequences on `file` by
 * creating `<file>.lock` with the 'wx' flag (fails if it already exists).
 * The lock file content is `{pid, createdAt, hostname}` JSON so a stale lock left
 * behind by a crashed process (SIGKILL, OOM — anything that skips
 * try/finally) can be detected and reclaimed instead of wedging every future
 * product-command invocation until a human runs `rm`. On EEXIST, inspects
 * the existing lock via isLockStale(): if stale, reclaims it atomically by
 * writing our payload to a unique tmp file and renameSync-ing it over the
 * stale lock, then reads the lock back to verify our pid actually won (if
 * another reclaimer renamed after us, we lost the race and retry instead of
 * proceeding) — this closes the unlink+open gap where two processes could
 * both believe they hold the lock; if live, falls back to the existing
 * bounded retry/backoff. Returns the lock path on success; calls fail()
 * (exit 1) on timeout so callers never proceed without the lock. */
function acquireReservationsLock(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lockPath = `${file}.lock`;
  for (let attempt = 0; attempt < RESERVATIONS_LOCK_RETRIES; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, lockPayload());
      fs.closeSync(fd);
      return lockPath;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (isLockStale(lockPath)) {
        // Atomic reclaim: write our payload to a unique tmp file, then
        // renameSync over the stale lock (atomic replace on POSIX — same
        // pattern as writeJsonAtomic). Then read back and verify our pid
        // actually won: if another reclaimer renamed after us, their payload
        // is in place and we lost — retry instead of proceeding.
        const tmpLock = `${lockPath}.reclaim.${process.pid}.${attempt}`;
        try {
          fs.writeFileSync(tmpLock, lockPayload());
          fs.renameSync(tmpLock, lockPath);
        } catch (_e2) {
          try { fs.unlinkSync(tmpLock); } catch (_e3) { /* best effort */ }
          continue;
        }
        let winner = null;
        try { winner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_e4) { /* raced */ }
        if (winner && winner.pid === process.pid) return lockPath;
        continue; // lost the reclaim race — another live holder now owns the lock
      }
      if (attempt < RESERVATIONS_LOCK_RETRIES - 1) {
        sleepSyncMs(RESERVATIONS_LOCK_RETRY_DELAY_MS);
      }
    }
  }
  fail(
    `could not acquire lock on ${lockPath} after ${RESERVATIONS_LOCK_RETRIES} attempts ` +
      `(another process holds it) — retry, or remove the stale lock file if no process is running`
  );
}

/** Release a lock acquired via acquireReservationsLock. Safe to call even if
 * the lock file is already gone. */
function releaseReservationsLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (_e) {
    // already removed — nothing to do
  }
}

/** process.exit() does NOT run try/finally blocks in Node, so every exit
 * inside a locked read-check-write section must release the lock explicitly
 * first. Use this instead of a bare process.exit(code) anywhere inside an
 * acquireReservationsLock(...) section. */
function exitWithLock(lockPath, code) {
  releaseReservationsLock(lockPath);
  process.exit(code);
}

/** Same idea as exitWithLock, but for the fail()/usage() error paths inside a
 * locked section: release the lock first, then print the error and exit 1. */
function failWithLock(lockPath, msg) {
  releaseReservationsLock(lockPath);
  fail(msg);
}

/** Stage every {target, content} write as a .tmp file first; only rename
 * into place once ALL tmp writes succeeded. The rename phase itself is made
 * all-or-nothing too (FR-009): before renaming, each pre-existing target's
 * original content is backed up in memory (or noted as "did not exist"). If
 * ANY rename in the loop throws (e.g. EXDEV, disk-full, permission change,
 * concurrent external deletion), every rename that already succeeded is
 * reverted — targets that pre-existed are restored to their exact prior
 * content, targets that did not pre-exist are removed — before
 * failWithLock(lockPath, msg) is called. Leftover .tmp files (both the ones
 * never renamed and the one that failed mid-rename) are best-effort
 * unlinked. Mirrors cmdProductStage's proven all-or-nothing pattern so every
 * product-mutating command shares one transaction implementation. Entries
 * `{ target, delete: true }` and `{ target, rmdir: true }` (spec 023) delete a
 * file / empty dir inside the same transaction: originals are backed up first,
 * rmdirs run last (deepest first), the fault seam index covers them, and
 * rollback restores files and recreates dirs. */
function writeAllOrNothing(lockPath, writes, errPrefix, opts) {
  const staged = [];
  const done = [];
  const createdDirs = [];
  try {
    prepareOps(writes, staged, createdDirs);
    executeOps(orderOps(staged), done);
  } catch (e) {
    const revertFailures = rollbackOps(done, staged, createdDirs);
    let msg = `${errPrefix}: write failed, all changes rolled back: ${e.message}`;
    if (revertFailures.length > 0) {
      const detail = revertFailures.map((f) => `${f.file} (${f.error})`).join(', ');
      msg = `${errPrefix}: write failed AND rollback incomplete — PARTIAL ROLLBACK, manual check needed: ${detail}. Original error: ${e.message}`;
    }
    failWithLock(lockPath, msg);
  }
  return runAfterCommit(opts, errPrefix);
}

/** Write the .tmp files and record, per write entry, the original content and
 * mode (from lstat) needed to revert it. Delete entries back up the original
 * BEFORE the rename phase so a later failure can restore it byte for byte and
 * with its mode. Pushes into `staged` / `createdDirs` as it goes, so a throw
 * midway still leaves rollback everything it needs. */
function prepareOps(writes, staged, createdDirs) {
  for (const w of writes) {
    if (w.delete) {
      const mode = fs.lstatSync(w.target).mode & 0o7777;
      staged.push({ kind: 'delete', target: w.target, original: fs.readFileSync(w.target), mode });
      continue;
    }
    if (w.rmdir) {
      staged.push({ kind: 'rmdir', target: w.target });
      continue;
    }
    const tmp = `${w.target}.tmp.${process.pid}`;
    const wdir = path.dirname(w.target);
    for (const d of missingDirs(wdir)) createdDirs.push(d);
    if (!fs.existsSync(wdir)) fs.mkdirSync(wdir, { recursive: true });
    fs.writeFileSync(tmp, w.content, 'utf8');
    const existed = fs.existsSync(w.target);
    const original = existed ? fs.readFileSync(w.target, 'utf8') : null;
    const mode = existed ? fs.lstatSync(w.target).mode & 0o7777 : null;
    staged.push({ kind: 'write', tmp, target: w.target, existed, original, mode });
  }
}

/** rmdirs last, deepest first; the stable sort keeps writes/deletes in caller order. */
function orderOps(staged) {
  const rank = (s) => (s.kind === 'rmdir' ? 1 : 0);
  return staged
    .map((s, i) => ({ s, i }))
    .sort((x, y) => rank(x.s) - rank(y.s) || (rank(x.s) === 1 ? y.s.target.length - x.s.target.length : x.i - y.i))
    .map((x) => x.s);
}

/** Run the rename / delete / rmdir phase, recording each completed op in `done`.
 * Test-only fault injection seam (FR-009 rename-phase coverage): when
 * A1_TEST_FAIL_RENAME_AT_INDEX is set to a loop index, throw AFTER the real
 * operation at that index has completed on disk, simulating fs.renameSync
 * failing partway through a multi-file write set. The index covers renames,
 * deletes and rmdirs. No-op unless the env var is explicitly set. */
function executeOps(ops, done) {
  const failAtIdx = process.env.A1_TEST_FAIL_RENAME_AT_INDEX;
  const failAtIdxNum = failAtIdx !== undefined ? Number(failAtIdx) : -1;
  for (let idx = 0; idx < ops.length; idx++) {
    const s = ops[idx];
    if (s.kind === 'write') fs.renameSync(s.tmp, s.target);
    else if (s.kind === 'delete') fs.unlinkSync(s.target);
    else fs.rmdirSync(s.target);
    done.push(s);
    if (idx === failAtIdxNum) {
      throw new Error(`A1_TEST_FAIL_RENAME_AT_INDEX injected failure at index ${idx}`);
    }
  }
}

/** Recreate `file` with `content` and its original `mode` (writeFileSync's
 * mode only applies to a NEW file, so chmod covers the existing-file case). */
function restoreFile(file, content, mode, encoding) {
  const opts = encoding ? { encoding } : {};
  if (mode !== null && mode !== undefined) opts.mode = mode;
  fs.writeFileSync(file, content, opts);
  if (mode !== null && mode !== undefined) fs.chmodSync(file, mode);
}

/** Revert every operation that already succeeded, in reverse order — this is
 * what makes the rename phase itself transactional. Revert failures are
 * collected (not swallowed) and returned: if the rollback cannot fully
 * complete, the operator must learn exactly which files need a manual check.
 * Also unlinks leftover .tmp files and removes directories this call created
 * (deepest first; a non-empty dir is left alone, never forced). */
function rollbackOps(done, staged, createdDirs) {
  const revertFailures = [];
  for (let i = done.length - 1; i >= 0; i--) {
    const s = done[i];
    try {
      if (s.kind === 'rmdir') fs.mkdirSync(s.target, { recursive: true });
      else if (s.kind === 'delete') restoreFile(s.target, s.original, s.mode);
      else if (s.existed) restoreFile(s.target, s.original, s.mode, 'utf8');
      else fs.unlinkSync(s.target);
    } catch (e2) {
      revertFailures.push({ file: s.target, error: e2.message });
    }
  }
  for (const s of staged) {
    if (s.kind !== 'write') continue;
    try { fs.unlinkSync(s.tmp); } catch (_e2) { /* tmp never renamed or consumed by a failed rename */ }
  }
  for (const d of createdDirs.sort((x, y) => y.length - x.length)) {
    try { fs.rmdirSync(d); } catch (_e3) { /* not empty or already gone */ }
  }
  return revertFailures;
}

/** Directories from `dir` upward that do not exist yet (what mkdirSync
 * -p would create). */
function missingDirs(dir) {
  const out = [];
  let cur = dir;
  while (!fs.existsSync(cur)) {
    out.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

/** Optional `{afterCommit}` (spec 010 FR-007): runs once the rename phase has
 * committed and while the caller still holds the lock; its return value is
 * writeAllOrNothing's. It runs OUTSIDE the rollback try, so a failing hook can
 * never revert the committed write, and an exception is reported on stderr and
 * swallowed — the command's exit code stays the vault-free one. */
function runAfterCommit(opts, errPrefix) {
  if (!opts || typeof opts.afterCommit !== 'function') return undefined;
  try {
    return opts.afterCommit();
  } catch (e) {
    process.stderr.write(`[a1-tools] ${errPrefix}: after-commit hook failed (write kept): ${e.message}\n`);
    return undefined;
  }
}

module.exports = {
  writeJsonAtomic,
  acquireReservationsLock,
  releaseReservationsLock,
  exitWithLock,
  failWithLock,
  reservationsFile,
  loadReservations,
  isLockStale,
  lockHostIdentity,
  isForeignHost,
  isPidDead,
  sleepSyncMs,
  writeAllOrNothing,
};
