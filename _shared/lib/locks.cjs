'use strict';

const fs = require('fs');
const path = require('path');
const { nowIso, fail } = require('./io.cjs');

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

/** Decide whether an existing `<file>.lock` is stale (safe to reclaim)
 * rather than actively held. Reads the {pid, createdAt} JSON payload written
 * by acquireReservationsLock. A lock is stale if: the file can't be parsed
 * (pre-fix lock format, or corrupted — never block forever on either), the
 * owning pid is no longer running, or the lock is older than
 * RESERVATIONS_LOCK_STALE_MS. Never throws — any error while inspecting the
 * lock is treated as "stale" so a broken lock file can never wedge the
 * product-command family permanently. */
function isLockStale(lockPath) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
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
  if (isPidDead(pid)) return true;
  const createdMs = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(createdMs)) return true;
  return Date.now() - createdMs > RESERVATIONS_LOCK_STALE_MS;
}

/** Acquire an exclusive lock for read-check-write sequences on `file` by
 * creating `<file>.lock` with the 'wx' flag (fails if it already exists).
 * The lock file content is `{pid, createdAt}` JSON so a stale lock left
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
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: nowIso() }));
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
          fs.writeFileSync(tmpLock, JSON.stringify({ pid: process.pid, createdAt: nowIso() }));
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
 * product-mutating command shares one transaction implementation. */
function writeAllOrNothing(lockPath, writes, errPrefix) {
  const staged = [];
  const renamed = [];
  try {
    for (const w of writes) {
      const tmp = `${w.target}.tmp.${process.pid}`;
      const wdir = path.dirname(w.target);
      if (!fs.existsSync(wdir)) fs.mkdirSync(wdir, { recursive: true });
      fs.writeFileSync(tmp, w.content, 'utf8');
      const existed = fs.existsSync(w.target);
      const original = existed ? fs.readFileSync(w.target, 'utf8') : null;
      staged.push({ tmp, target: w.target, existed, original });
    }
    // Test-only fault injection seam (FR-009 rename-phase coverage): when
    // A1_TEST_FAIL_RENAME_AT_INDEX is set to a rename-loop index, throw
    // AFTER the real rename at that index has already completed on disk,
    // simulating fs.renameSync failing partway through a multi-file write
    // set (the exact shape of the original atomicity bug). No-op unless the
    // env var is explicitly set, so production behavior is unchanged.
    const failAtIdx = process.env.A1_TEST_FAIL_RENAME_AT_INDEX;
    const failAtIdxNum = failAtIdx !== undefined ? Number(failAtIdx) : -1;
    for (let idx = 0; idx < staged.length; idx++) {
      const s = staged[idx];
      fs.renameSync(s.tmp, s.target);
      renamed.push(s);
      if (idx === failAtIdxNum) {
        throw new Error(`A1_TEST_FAIL_RENAME_AT_INDEX injected failure at index ${idx}`);
      }
    }
  } catch (e) {
    // Revert every rename that already succeeded, in reverse order, before
    // reporting failure — this is what makes the rename phase itself
    // transactional rather than just the tmp-write phase. Revert failures
    // are collected (not swallowed): if the rollback itself can't fully
    // complete, the repo is left in a partially-reverted state and the
    // operator needs to know exactly which files still need a manual check,
    // rather than seeing only the original write error and assuming the
    // rollback silently succeeded.
    const revertFailures = [];
    for (let i = renamed.length - 1; i >= 0; i--) {
      const s = renamed[i];
      try {
        if (s.existed) {
          fs.writeFileSync(s.target, s.original, 'utf8');
        } else {
          fs.unlinkSync(s.target);
        }
      } catch (e2) {
        // best-effort revert — if this also fails there is nothing more we
        // can safely do automatically, but the failure is surfaced below
        // instead of discarded so the operator knows this file was NOT
        // restored to its pre-write state.
        revertFailures.push({ file: s.target, error: e2.message });
      }
    }
    for (const s of staged) {
      try {
        fs.unlinkSync(s.tmp);
      } catch (_e2) {
        // ignore ENOENT etc — best-effort cleanup (covers both tmp files
        // never renamed and the one tmp file consumed by a failed rename)
      }
    }
    let msg = `${errPrefix}: write failed, all changes rolled back: ${e.message}`;
    if (revertFailures.length > 0) {
      const detail = revertFailures.map((f) => `${f.file} (${f.error})`).join(', ');
      msg = `${errPrefix}: write failed AND rollback incomplete — PARTIAL ROLLBACK, manual check needed: ${detail}. Original error: ${e.message}`;
    }
    failWithLock(lockPath, msg);
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
  isPidDead,
  sleepSyncMs,
  writeAllOrNothing,
};
