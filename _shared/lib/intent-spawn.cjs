'use strict';

// ---------------------------------------------------------------------------
// intent-spawn — the child process of `intent run` (spec 011): the spawn
// itself (FR-021, moved out of intent-run.cjs in Wave 7), the hard timeout
// with the process-group kill (FR-027), the stop signals of `run`, and the
// group kill that `cancel` (FR-028) and the reclaim of an orphaned executor
// lock (FR-025) use.
//
// The child is spawned detached, so it leads its own process group; every
// kill goes to -pid, which reaches the child's descendants too (a grandchild
// that ignores SIGTERM included). Sequence (FR-027): SIGTERM to the group,
// INTENT_KILL_GRACE_MS, then SIGKILL to the group if anything of it is still
// alive. The timeout budget (INTENT_TIMEOUT_MS) covers the child AND the
// executor post-steps (FR-051); a post-step that starts a process does so
// through budget.spawn, so the same group kill ends it.
//
// Nothing of a tracked group outlives the locks (W7 security S-MAJOR-1/4):
// the child's `close` only means its leader and pipes are gone, so before
// anything is completed or released `run` awaits a pending timeout kill
// (budget.settle) and then ends every tracked group still alive
// (budget.reapSync); the stop-signal handler reaps the same set.
//
// UNMEASURED: whether the real `claude -p` keeps the processes of its Bash
// tool in its own process group (a tool that calls setsid would escape the
// group kill). probe-7.sh (P7-GROUPKILL) asks the owner to measure it; the
// fixtures' hang stub models a tree that stays in the group.
//
// A JavaScript timer cannot interrupt a synchronous call: a post-step that
// blocks (spawnSync, heavy fs work) is judged against the deadline only after
// it returns. Signal handlers likewise run only between event-loop turns.
// ---------------------------------------------------------------------------

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sleepSyncMs } = require('./locks.cjs');

const STOP_SIGNALS = Object.freeze(['SIGTERM', 'SIGINT']);
const PS_BIN = '/bin/ps';
const SYSCTL_BIN = '/usr/sbin/sysctl';
const START_TOLERANCE_MS = 2000; // lstart has second resolution
const GROUP_POLL_MS = 50;
const KILL_SETTLE_MS = 1000; // SIGKILL is delivered asynchronously: how long killGroup waits for the group to vanish
const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;
const CHILD_FILE = 'child.json'; // runs/<id>/child.json: { pgid } of the running child (cancel, reclaim)

const defaultKill = (target, sig) => process.kill(target, sig);

// ---------- process identity (Wave 7 review M2) ----------
// A recorded pid or pgid is only acted on (a kill, or a "live" verdict) when
// the process behind it is the one that recorded it: PIDs restart after a
// reboot and are reused anyway. MEASURED on 2026-10-02 (macOS /bin/ps and
// Debian procps in node:20): `ps -o pgid=,lstart= -p <pid>` under LC_ALL=C
// prints "<pgid> Fri Oct  2 09:29:52 2026" (local time) on both; without
// LC_ALL=C macOS prints the date localised ("Fr.  2 Okt. 09:29:41 2026"),
// which Date cannot parse. With TZ=UTC both print UTC (measured the same
// day), so the time is read as "<lstart> UTC" and no two processes with
// different TZ settings disagree about it. Boot time: macOS `sysctl -n kern.boottime` ->
// "{ sec = 1788445648, usec = 624100 } Thu Sep  3 …"; Linux /proc/stat
// "btime 1790014461".

// -> { pgid, startMs } of a live pid, or null (gone or unreadable).
function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  const env = { LC_ALL: 'C', TZ: 'UTC', PATH: '/usr/bin:/bin' };
  const r = childProcess.spawnSync(PS_BIN, ['-o', 'pgid=,lstart=', '-p', String(pid)], { env, encoding: 'utf8' });
  const m = r.status === 0 ? /^\s*(\d+)\s+(\S.*\S)\s*$/.exec(String(r.stdout)) : null;
  const startMs = m ? Date.parse(`${m[2]} UTC`) : NaN;
  return m && Number.isFinite(startMs) ? Object.freeze({ pgid: Number(m[1]), startMs }) : null;
}

// -> the last boot in ms, or null when it cannot be read.
function bootTimeMs() {
  try {
    const btime = /^btime (\d+)$/m.exec(fs.readFileSync('/proc/stat', 'utf8'));
    if (btime) return Number(btime[1]) * 1000;
  } catch (_e) {
    // not Linux
  }
  const r = childProcess.spawnSync(SYSCTL_BIN, ['-n', 'kern.boottime'], { encoding: 'utf8' });
  const m = r.status === 0 ? /sec = (\d+)/.exec(String(r.stdout)) : null;
  return m ? Number(m[1]) * 1000 : null;
}

const beforeBoot = (ms) => {
  const boot = bootTimeMs();
  return Number.isFinite(ms) && boot !== null && ms < boot;
};

// A lock holder `pid` that wrote its lock at `sinceMs` is alive only when
// the pid lives, the lock is not from before the last boot, and the process
// started no later than the lock (else the pid was reused).
function holderAlive(pid, sinceMs) {
  if (require('./locks.cjs').isPidDead(pid)) return false;
  if (!Number.isFinite(sinceMs)) return true; // no time to compare: liveness alone
  if (beforeBoot(sinceMs)) return false;
  const info = processInfo(pid);
  return info === null || info.startMs <= sinceMs + START_TOLERANCE_MS;
}

const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= START_TOLERANCE_MS;

// W7 security S-MAJOR-3: a child.json { pgid, start_ms, boot_ms } names the
// run's child only when this is the boot it was written in, the group's
// leader lives, leads that group, started at the recorded time, and the
// group is not the caller's own. Anything else (fields missing included) is
// discarded: no kill.
function isRecordedChild(doc) {
  if (!doc || !Number.isSafeInteger(doc.pgid) || doc.pgid <= 1) return false;
  if (!near(bootTimeMs(), doc.boot_ms)) return false;
  const info = processInfo(doc.pgid);
  if (info === null || info.pgid !== doc.pgid || info.startMs !== doc.start_ms) return false;
  const own = processInfo(process.pid);
  return own !== null && own.pgid !== doc.pgid;
}

// A tracked group `pgid`, spawned by this run at `spawnedMs`, is still this
// run's: alive, and its leader either gone (a live group's id is never
// handed out again) or the very process spawned then (not a reused pid).
function ownGroup(pgid, spawnedMs) {
  if (!groupAlive(pgid)) return false;
  const leader = processInfo(pgid);
  return leader === null || (leader.pgid === pgid && leader.startMs <= spawnedMs + START_TOLERANCE_MS);
}

// Is any process of group `pgid` alive? (kill 0 to the group.)
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e) {
    return !!(e && e.code === 'EPERM');
  }
}

const trySignal = (kill, target, sig) => {
  try {
    kill(target, sig);
  } catch (_e) {
    // the group is gone already
  }
};

// FR-027, synchronous (signal handlers, cancel, reclaim): SIGTERM, wait up
// to the grace while the group lives, SIGKILL if it still does. -> the
// signals sent, in order.
function killGroupSync(pgid, graceMs, { kill = defaultKill, onSignal = () => {} } = {}) {
  if (!Number.isSafeInteger(pgid) || pgid <= 1) return [];
  const sent = [];
  const send = (sig) => {
    onSignal(sig, -pgid);
    trySignal(kill, -pgid, sig);
    sent.push(sig);
  };
  if (!groupAlive(pgid)) return sent;
  send('SIGTERM');
  for (let waited = 0; waited < graceMs && groupAlive(pgid); waited += GROUP_POLL_MS) sleepSyncMs(GROUP_POLL_MS);
  if (groupAlive(pgid)) send('SIGKILL');
  return sent;
}

// FR-027, asynchronous (the timeout): the same sequence without blocking;
// resolves once the group is gone (or KILL_SETTLE_MS after the SIGKILL).
function killGroup(pgid, graceMs, { kill = defaultKill, onSignal = () => {} } = {}) {
  return new Promise((resolve) => {
    onSignal('SIGTERM', -pgid);
    trySignal(kill, -pgid, 'SIGTERM');
    setTimeout(() => {
      if (!groupAlive(pgid)) return resolve();
      onSignal('SIGKILL', -pgid);
      trySignal(kill, -pgid, 'SIGKILL');
      const until = Date.now() + KILL_SETTLE_MS;
      const poll = setInterval(() => {
        if (groupAlive(pgid) && Date.now() < until) return;
        clearInterval(poll);
        resolve();
      }, GROUP_POLL_MS);
    }, graceMs);
  });
}

// The time budget of one run (FR-027, FR-051). `track(pid)` adds a process
// group the timeout must end; `spawn` starts a detached, tracked process for
// a post-step. -> { deadline, left(), track, spawn, expired(), timeout(),
// settle(), reapSync(onLeftover) }.
function createBudget({ timeoutMs, graceMs, now = Date.now, kill = defaultKill, onSignal = () => {} }) {
  const deadline = now() + timeoutMs;
  // Deliberate shared state (review n3): pgid -> spawn time (real clock) of
  // every tracked group; kept after the leader's close, since a group can
  // outlive its leader (S-MAJOR-1).
  const groups = new Map();
  let timedOut = false;
  let pending = Promise.resolve();
  const owned = () => [...groups].filter(([pgid, at]) => ownGroup(pgid, at)).map(([pgid]) => pgid);
  const budget = {
    deadline,
    left: () => Math.max(0, deadline - now()),
    track: (pid, atMs = Date.now()) => groups.set(pid, atMs),
    spawn: (cmd, args, opts = {}) => {
      const child = childProcess.spawn(cmd, args, { ...opts, detached: true, stdio: 'ignore', shell: false });
      budget.track(child.pid);
      return child;
    },
    expired: () => timedOut,
    // Ends every tracked group; marks the budget expired.
    timeout: () => {
      timedOut = true;
      pending = Promise.all(owned().map((pid) => killGroup(pid, graceMs, { kill, onSignal })));
      return pending;
    },
    settle: () => pending, // a timeout kill still in its grace
    // Synchronous FR-027 sequence on every tracked group still alive.
    reapSync: (onLeftover = () => {}) => owned().forEach((pgid) => {
      onLeftover(pgid);
      killGroupSync(pgid, graceMs, { kill });
    }),
  };
  return budget;
}

// Races `work` (a promise) against the budget's deadline; on the deadline
// the tracked groups are killed and { timedOut: true } is returned.
async function withinBudget(budget, work) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve('deadline'), budget.left());
  });
  const first = await Promise.race([work.then((v) => ({ value: v })), deadline]);
  clearTimeout(timer);
  if (first !== 'deadline') return { timedOut: false, value: first.value };
  await budget.timeout();
  await work.catch(() => {});
  return { timedOut: true };
}

// Writes into a run-dir output; a failure is recorded, never thrown out of
// an event handler (part B review m5).
function capture(fd, state) {
  return (b) => {
    try {
      fs.writeSync(fd, b);
    } catch (e) {
      state.outputError = state.outputError || (e && e.code) || 'write_failed';
    }
  };
}

// runs/<id>/child.json { pgid, start_ms, boot_ms } (0600, O_EXCL): cancel
// (FR-028) and the reclaim of an orphaned executor lock find the child's
// group here, bound to its leader's start and the boot (S-MAJOR-3).
function recordChild(runDir, pid) {
  const info = processInfo(pid);
  const doc = { pgid: pid, start_ms: info === null ? null : info.startMs, boot_ms: bootTimeMs() };
  const fd = fs.openSync(path.join(runDir, CHILD_FILE), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(doc));
  } finally {
    fs.closeSync(fd);
  }
}

// The child's process group of run dir `dir` — only when it is still that
// child (isRecordedChild), else null.
function recordedGroup(dir) {
  try {
    const fd = fs.openSync(path.join(dir, CHILD_FILE), fs.constants.O_RDONLY | O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const doc = JSON.parse(fs.readFileSync(fd, 'utf8'));
      return isRecordedChild(doc) ? doc.pgid : null;
    } finally {
      fs.closeSync(fd);
    }
  } catch (_e) {
    return null;
  }
}

// FR-021 — spawn with the payload on stdin and the outputs into the run dir,
// inside the budget (FR-027): at the deadline the child's group gets the
// kill sequence. `live.child` names the child for the stop signals.
// -> { code, signal, timedOut } | { error } (+ outputError).
function spawnChild(ctx, sp, live, budget, d, afterSpawn = () => {}) {
  const { openRunOutputs } = require('./intent-run.cjs');
  const fds = openRunOutputs(ctx.runDir);
  const state = { outputError: null };
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let timedOut = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      live.child = null;
      [fds.stdout, fds.stderr].forEach((fd) => fs.closeSync(fd));
      resolve({ ...r, pid: child ? child.pid : undefined, timedOut, outputError: state.outputError });
    };
    let child;
    try {
      child = d.spawn(sp.cmd, [...sp.argv], { cwd: ctx.cwd, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...sp.env } });
    } catch (e) {
      done({ error: e });
      return;
    }
    live.child = child;
    if (child.pid) {
      budget.track(child.pid);
      recordChild(ctx.runDir, child.pid);
      afterSpawn(child.pid);
    }
    timer = setTimeout(() => {
      timedOut = true;
      budget.timeout();
    }, budget.left());
    child.on('error', (e) => done({ error: e }));
    child.stdout.on('data', capture(fds.stdout, state));
    child.stderr.on('data', capture(fds.stderr, state));
    child.stdin.on('error', () => {}); // a child that never reads stdin closes it early (EPIPE)
    child.stdin.end(String(ctx.fm.payload));
    child.on('close', (code, signal) => done({ code, signal }));
  });
}

const exitCodeOf = (r) => {
  if (Number.isInteger(r.code)) return r.code;
  const n = r.signal ? os.constants.signals[r.signal] : undefined;
  return Number.isInteger(n) ? 128 + n : 1;
};

// Part B review m5 + Wave 7 (review n2, r1, W7-M1, S-MAJOR-4) — SIGTERM/SIGINT
// while `run` holds its locks: the child's group and every group a post-step
// started (live.budget) get the FR-027 sequence (SIGKILL after the grace, so
// nothing of them outlives the locks); a run stopped before
// its running rewrite rolls back (live.rollback), one stopped after it is
// completed failed: cancelled (live.complete); then both locks go and the
// process exits 128+signo.
function onStopSignals(release, live, graceMs, kill = defaultKill) {
  const handlers = STOP_SIGNALS.map((sig) => {
    const h = () => {
      if (live.child && live.child.pid) killGroupSync(live.child.pid, graceMs, { kill });
      if (live.budget) live.budget.reapSync();
      for (const step of [live.rollback, live.complete]) {
        if (!step) continue;
        try {
          step(); // before the running rewrite: roll back; after it: complete (review W7-M1)
        } catch (_e) {
          // best effort: the locks go regardless
        }
      }
      release();
      process.exit(128 + os.constants.signals[sig]);
    };
    process.once(sig, h);
    return [sig, h];
  });
  return () => handlers.forEach(([sig, h]) => process.removeListener(sig, h));
}

module.exports = {
  CHILD_FILE, groupAlive, killGroupSync, processInfo, bootTimeMs, beforeBoot, holderAlive, isRecordedChild, killGroup, createBudget, withinBudget, spawnChild, exitCodeOf, onStopSignals,
  recordedGroup, recordChild,
};
