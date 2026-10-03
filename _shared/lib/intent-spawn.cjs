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
const CHILD_FILE = 'child.json'; // runs/<id>/child.json: { pgid, start, boot_id } of the running child (cancel, reclaim)
const BOOT_ID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const STAT_START_FIELD = 22; // proc(5): starttime, clock ticks after boot

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
//
// Wave 8 (Samuel MINOR-1): the identity of a recorded child and of a tracked
// group uses no wall clock at all. MEASURED on 2026-10-03: the boot is
// macOS `sysctl -n kern.bootsessionuuid` -> "7E98FB26-45C6-4FDF-940B-EC5462A2F65E"
// (the same on every call) and Linux /proc/sys/kernel/random/boot_id ->
// "81735484-b53c-4862-9f61-0d1182e40fa0" (node:20); the process start is
// Linux /proc/<pid>/stat field 22, ticks after boot ("9 (sleep) R 1 1 1 0 -1
// … 0 1 0 93403079 …"; comm may hold spaces and parentheses, so fields are
// counted after the LAST ')'), and on macOS ps lstart, the kernel's p_start
// recorded at fork, which a later clock change does not move. The lock
// holder check (holderAlive) still compares lstart with the lock's
// createdAt: the lock's 8 keys are frozen (FR-047), see STATUS.

// The start token of /proc/<pid>/stat text (Linux), or null. Pure.
function parseStatStart(text) {
  const s = String(text);
  const close = s.lastIndexOf(')');
  if (close < 0) return null;
  const fields = s.slice(close + 2).split(' ');
  const ticks = fields[STAT_START_FIELD - 3]; // fields[0] is field 3 (state)
  return /^\d+$/.test(String(ticks)) ? `t:${ticks}` : null;
}

function statStart(pid) {
  try {
    return parseStatStart(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch (_e) {
    return null; // not Linux, or the pid is gone
  }
}

// -> { pgid, startMs, start } of a live pid, or null (gone or unreadable).
// `start` is the boot-relative start token: Linux ticks, else macOS p_start.
function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  const env = { LC_ALL: 'C', TZ: 'UTC', PATH: '/usr/bin:/bin' };
  const r = childProcess.spawnSync(PS_BIN, ['-o', 'pgid=,lstart=', '-p', String(pid)], { env, encoding: 'utf8' });
  const m = r.status === 0 ? /^\s*(\d+)\s+(\S.*\S)\s*$/.exec(String(r.stdout)) : null;
  const startMs = m ? Date.parse(`${m[2]} UTC`) : NaN;
  if (!m || !Number.isFinite(startMs)) return null;
  return Object.freeze({ pgid: Number(m[1]), startMs, start: statStart(pid) || `s:${startMs}` });
}

// -> this boot's id (macOS bootsessionuuid, Linux boot_id), or null.
function bootId() {
  let id = null;
  try {
    id = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch (_e) {
    const r = childProcess.spawnSync(SYSCTL_BIN, ['-n', 'kern.bootsessionuuid'], { encoding: 'utf8' });
    id = r.status === 0 ? String(r.stdout).trim() : null;
  }
  return BOOT_ID_RE.test(String(id)) ? id : null;
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

// W7 security S-MAJOR-3, W8 MINOR-1: a child.json { pgid, start, boot_id }
// names the run's child only when this is the boot it was written in (boot
// id), the group's leader lives, leads that group, has the recorded start
// token, and the group is not the caller's own. Anything else (fields
// missing included) is discarded: no kill.
function isRecordedChild(doc) {
  if (!doc || !Number.isSafeInteger(doc.pgid) || doc.pgid <= 1 || typeof doc.start !== 'string') return false;
  const boot = bootId();
  if (boot === null || doc.boot_id !== boot) return false;
  const info = processInfo(doc.pgid);
  if (info === null || info.pgid !== doc.pgid || info.start !== doc.start) return false;
  const own = processInfo(process.pid);
  return own !== null && own.pgid !== doc.pgid;
}

// A tracked group `pgid`, whose leader had start token `start` when it was
// tracked, is still this run's: alive, and its leader either gone (a live
// group's id is never handed out again) or that very process (not a reused
// pid). Without a start token (ps failed when it was tracked, Samuel s2)
// the leader counts as ours only while it is this process's own child that
// has not exited yet (`proc`): an unreaped child's pid cannot be handed out
// again. Otherwise a live leader without a token may be a reused pid: left.
function ownGroup(pgid, start, proc = null) {
  if (!groupAlive(pgid)) return false;
  const leader = processInfo(pgid);
  if (leader === null) return true;
  if (start !== null) return leader.pgid === pgid && leader.start === start;
  return proc !== null && proc.pid === pgid && proc.exitCode === null && proc.signalCode === null;
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
// cancel(), settle(), reapSync(onLeftover) }.
const startOf = (pid) => {
  const info = processInfo(pid);
  return info === null ? null : info.start;
};

function createBudget({ timeoutMs, graceMs, now = Date.now, kill = defaultKill, onSignal = () => {} }) {
  const deadline = now() + timeoutMs;
  // Deliberate shared state (review n3): pgid -> { start, proc }: the leader's start token
  // when tracked; kept after the leader's close, since a group can outlive
  // its leader (S-MAJOR-1).
  const groups = new Map();
  let timedOut = false;
  let pending = Promise.resolve();
  const owned = () => [...groups].filter(([pgid, g]) => ownGroup(pgid, g.start, g.proc)).map(([pgid]) => pgid);
  const budget = {
    deadline,
    left: () => Math.max(0, deadline - now()),
    track: (pid, start = startOf(pid), proc = null) => groups.set(pid, { start, proc }),
    spawn: (cmd, args, opts = {}) => {
      const child = childProcess.spawn(cmd, args, { ...opts, detached: true, stdio: 'ignore', shell: false });
      budget.track(child.pid, undefined, child);
      return child;
    },
    expired: () => timedOut,
    // Ends every tracked group; marks the budget expired.
    timeout: () => {
      timedOut = true;
      pending = Promise.all(owned().map((pid) => killGroup(pid, graceMs, { kill, onSignal })));
      return pending;
    },
    // FR-028 via run's cancel poll (Samuel MINOR-2): the same sequence on
    // every tracked group this run owns, without marking the budget expired.
    cancel: () => {
      pending = Promise.all([pending, ...owned().map((pid) => killGroup(pid, graceMs, { kill }))]); // joins a timeout kill in its grace (Reinhard n2)
      return pending;
    },
    settle: () => pending, // a timeout or cancel kill still in its grace
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

// runs/<id>/child.json { pgid, start, boot_id } (0600, O_EXCL): cancel
// (FR-028) and the reclaim of an orphaned executor lock find the child's
// group here, bound to its leader's start token and the boot (S-MAJOR-3,
// MINOR-1).
function recordChild(runDir, pid) {
  const doc = { pgid: pid, start: startOf(pid), boot_id: bootId() };
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
      budget.track(child.pid, undefined, child);
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
  CHILD_FILE, groupAlive, killGroupSync, processInfo, parseStatStart, bootId, bootTimeMs, beforeBoot, holderAlive, isRecordedChild, killGroup, createBudget, withinBudget, spawnChild, exitCodeOf, onStopSignals,
  recordedGroup, recordChild,
};
