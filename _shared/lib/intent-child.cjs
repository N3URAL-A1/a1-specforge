'use strict';

// ---------------------------------------------------------------------------
// intent-child — a1-tools child mode (spec 011, Wave 5b FR-041; Wave 6 part A
// FR-047). When a1-tools runs inside a child that `intent run` spawned, it may
// run only the action's allowlisted subcommands and touch only paths inside
// the project.
//
// Context (FR-047): `run` writes ~/.a1-intents/executor.lock (0600, O_EXCL,
// exactly the eight LOCK_KEYS) before the spawn. `~` is the passwd home of
// the calling uid (os.userInfo().homedir), never $HOME. Child mode is on when
// A1_INTENT_CHILD=1 is set, OR when that lock names this host and a pid that
// is an ancestor of this process. The ancestry walk runs the absolute
// /bin/ps (never through PATH), at most 64 levels; when a lock of this host
// exists and the walk cannot decide (ps fails, a level does not parse, 64
// levels used up), the process counts as a child (fail closed). In child mode
// action, project, vault root and anchor come ONLY from the lock, read
// through one O_NOFOLLOW|O_NONBLOCK descriptor and checked on it (regular,
// this uid, no group/other bit) inside a private ~/.a1-intents. A missing,
// unsafe, unparsable, foreign-host or incomplete lock, an A1_INTENT_ACTION,
// A1_INTENT_PROJECT or A1_VAULT_ROOT (by realpath) that differs from it, a
// non-empty process.execArgv or a set NODE_OPTIONS -> child_context_invalid.
// Nothing the child can set (A1_INTENT_CHILD, ACTION, PROJECT, A1_VAULT_ROOT,
// HOME, PATH) switches child mode off or moves the scope. A lock that exists
// but does not parse or names no pid proves no ancestry: it switches child
// mode on only together with A1_INTENT_CHILD=1 (and is then invalid).
//
// Scope: the anchor — for a write action the intent worktree
// realpath(<passwd home>/claude-projects/a1-worktrees/<project>-intent-<id>)
// (FR-043, Wave 6 part B), else realpath(<passwd home>/claude-projects/
// <project>) — which must lie under realpath(<passwd home>/claude-projects/)
// and equal the lock's `anchor`, and realpath(<vault_root>/project/
// <project>). The owner's primary checkout is outside a write action's
// scope. The cwd must lie
// inside the anchor: a cwd anchor alone would let `cd / && node <T> …` widen
// the scope. Paths are resolved physically: realpath of the longest existing
// prefix of the raw string (no lexical `..` folding first, so `lnk/../x`
// follows the link), then the missing tail is joined lexically; a tail holding
// `.` or `..` is refused (`nonexist/../lnk/x` would join to <cwd>/lnk/x while
// the command, after normalizing, follows lnk out of the project).
//
// Refusal: {"ok":false,"error":"intent_child_refused","reason","detail"} on
// stdout, one sentence on stderr, exit 77, nothing written. io.cjs calls
// guardChildPath() from resolveVaultPath and projectsPath; this module must
// therefore not require io.cjs, and loads the constants only in child mode.
//
// Library seam (FR-047): fixtures inject the passwd home, the ps walk and the
// git binary through injectChildDeps() or the `deps` argument, never through
// an environment variable a child could set. `run` writes and removes the
// lock through intent-run.cjs (writeChildContextLock, removeChildContextLock).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CHILD_FLAG = 'A1_INTENT_CHILD';
const INTENTS_DIR = '.a1-intents';
const LOCK_FILE = 'executor.lock';
const LOCK_KEYS = Object.freeze(['pid', 'hostname', 'createdAt', 'intent_id', 'action', 'project', 'vault_root', 'anchor']);
const LOCK_READ_MAX_BYTES = 4096;
const PRIVATE_BITS = 0o077;
const PS_BIN = '/bin/ps';
const PROJECTS_DIR = 'claude-projects';
const WORKTREES_DIR = 'a1-worktrees'; // FR-043: <project>-intent-<id> of a write action
const MAX_ANCESTRY = 64;
const DETAIL_MAX_CHARS = 200;
const INACTIVE = Object.freeze({ active: false });
const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK, O_DIRECTORY } = fs.constants;

// -> the parent pid of `pid`, or null when ps cannot decide.
function psParent(pid) {
  const r = spawnSync(PS_BIN, ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' });
  const text = r.status === 0 && !r.error ? String(r.stdout).trim() : '';
  const n = /^[0-9]+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(n) ? n : null;
}

let injected = Object.freeze({});

const defaultDeps = () => ({
  env: process.env,
  cwd: process.cwd,
  ppid: process.ppid,
  execArgv: process.execArgv,
  hostname: os.hostname,
  passwdHome: () => os.userInfo().homedir,
  realpath: fs.realpathSync.native, // the OS realpath(3); the JS one folds `..` lexically first
  parentOf: psParent,
  getuid: process.getuid,
  ...injected,
});

// ---------- the child-context lock (FR-047) ----------

const lockPath = (d) => path.join(d.passwdHome(), INTENTS_DIR, LOCK_FILE);

// Why the fd is not private (regular file of this uid, no group/other), or null.
function fdProblem(fd, kind, d) {
  const st = fs.fstatSync(fd);
  if (kind === 'directory' ? !st.isDirectory() : !st.isFile()) return `not a regular ${kind}`;
  if (st.uid !== d.getuid()) return `${kind} owned by another uid`;
  return (st.mode & PRIVATE_BITS) !== 0 ? `${kind} mode ${(st.mode & 0o777).toString(8)}` : null;
}

function dirProblem(d) {
  let fd;
  try {
    fd = fs.openSync(path.dirname(lockPath(d)), O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  } catch (e) {
    return `~/${INTENTS_DIR} cannot be opened (${e.code || 'error'})`;
  }
  try {
    return fdProblem(fd, 'directory', d);
  } finally {
    fs.closeSync(fd);
  }
}

// -> { present: false } | { present: true, doc: object|null, problem: string|null }
function readLock(d) {
  let fd;
  try {
    fd = fs.openSync(lockPath(d), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { present: false };
    return { present: true, doc: null, problem: `the lock cannot be opened (${e.code || 'error'})` };
  }
  try {
    const problem = fdProblem(fd, 'file', d) || dirProblem(d);
    if (problem !== null && problem.startsWith('not a regular')) return { present: true, doc: null, problem };
    const buf = Buffer.alloc(LOCK_READ_MAX_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    let doc = null;
    try {
      doc = JSON.parse(buf.subarray(0, n).toString('utf8'));
    } catch (_e) {
      return { present: true, doc: null, problem: problem || 'the lock is not JSON' };
    }
    return { present: true, doc: doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : null, problem };
  } finally {
    fs.closeSync(fd);
  }
}

// -> true (ancestor), false (walk reached pid 1 without it), null (undecidable).
function isAncestor(target, d) {
  let cur = d.ppid;
  for (let i = 0; i < MAX_ANCESTRY; i++) {
    if (cur === target) return true;
    if (cur === null || !Number.isSafeInteger(cur)) return null;
    if (cur <= 1) return false;
    cur = d.parentOf(cur);
  }
  return null;
}

// FR-047 (b)(c): the flag, or a lock of this host whose pid is an ancestor
// (or whose ancestry cannot be decided).
// A1_INTENT_ID (review MINOR-1) is a second flag: an orphan re-parented to
// pid 1 keeps it, and it must name the lock's intent. An undecidable walk is
// child mode with an invalid context.
function decideChildMode(d) {
  const lock = readLock(d);
  const flag = d.env[CHILD_FLAG] === '1' || d.env.A1_INTENT_ID !== undefined;
  if (!lock.present || lock.doc === null) return { child: flag, lock, ancestry: undefined };
  const { pid, hostname } = lock.doc;
  if (!Number.isSafeInteger(pid) || pid <= 1 || hostname !== d.hostname()) return { child: flag, lock, ancestry: undefined };
  const ancestry = isAncestor(pid, d);
  return { child: flag || ancestry !== false, lock, ancestry };
}

function isChildMode(deps = {}) {
  return decideChildMode({ ...defaultDeps(), ...deps }).child;
}

// ---------- scope ----------

// Physical resolution of `p` against `base` -> realpath, or null (refuse).
function resolvePhysical(p, base, d) {
  const raw = String(p);
  const expanded = raw === '~' || raw.startsWith('~/') ? d.passwdHome() + raw.slice(1) : raw;
  let head = path.isAbsolute(expanded) ? expanded : `${base}${path.sep}${expanded}`;
  const tail = [];
  for (;;) {
    try {
      // MAJOR-1 (re-review of 5b): a `.` or `..` in the missing tail would be
      // folded lexically here but by the OS later, past any link after it.
      if (tail.some((seg) => seg === '.' || seg === '..')) return null;
      return path.join(d.realpath(head), ...tail.reverse());
    } catch (e) {
      if (!e || (e.code !== 'ENOENT' && e.code !== 'ENOTDIR')) return null;
    }
    const up = path.dirname(head);
    if (up === head) return null;
    tail.push(path.basename(head));
    head = up;
  }
}

const inside = (p, root) => p === root || p.startsWith(root + path.sep);

function invalid(detail) {
  return Object.freeze({ active: true, ok: false, reason: 'child_context_invalid', detail });
}

const sameReal = (a, b, d) => {
  try {
    return d.realpath(a) === d.realpath(b);
  } catch (_e) {
    return false; // an env value that does not resolve differs from the lock
  }
};

// FR-047 (d)(f): the lock's shape and the process around it -> detail or null.
function lockDetail(lock, d) {
  const { INTENT_ACTIONS } = require('./status-constants.cjs');
  const { INTENT_PROJECT_SLUG_RE: SLUG_RE } = require('./intent-sandbox.cjs'); // not worktree-registry (re-review MINOR-1)
  if (!lock.present) return 'no child-context lock (~/.a1-intents/executor.lock)';
  if (lock.problem) return `the child-context lock is unsafe (${lock.problem})`;
  const doc = lock.doc;
  if (doc === null || Object.keys(doc).sort().join(',') !== [...LOCK_KEYS].sort().join(',')) return 'the child-context lock is incomplete';
  if (doc.hostname !== d.hostname()) return 'the child-context lock belongs to another host';
  if (typeof doc.action !== 'string' || !INTENT_ACTIONS.has(doc.action)) return 'the lock names no intent action';
  if (typeof doc.project !== 'string' || !SLUG_RE.test(doc.project)) return 'the lock names no project slug';
  if (![doc.vault_root, doc.anchor].every((p) => typeof p === 'string' && path.isAbsolute(p))) return 'the lock paths are not absolute';
  const { env } = d;
  if (env.A1_INTENT_ACTION !== undefined && env.A1_INTENT_ACTION !== doc.action) return 'A1_INTENT_ACTION differs from the lock';
  if (env.A1_INTENT_PROJECT !== undefined && env.A1_INTENT_PROJECT !== doc.project) return 'A1_INTENT_PROJECT differs from the lock';
  if (env.A1_VAULT_ROOT !== undefined && !sameReal(env.A1_VAULT_ROOT, doc.vault_root, d)) return 'A1_VAULT_ROOT differs from the lock';
  if (env.A1_INTENT_ID !== undefined && env.A1_INTENT_ID !== doc.intent_id) return 'A1_INTENT_ID differs from the lock';
  if (env[CHILD_FLAG] === '1' && env.A1_INTENT_ID === undefined) return 'A1_INTENT_CHILD=1 without A1_INTENT_ID'; // re-review MINOR-6
  if (d.execArgv.length > 0 || env.NODE_OPTIONS !== undefined) return 'node options in front of a1-tools (execArgv or NODE_OPTIONS)';
  return null;
}

const GITFILE_MAX_BYTES = 4096;

// The `.git` FILE of an intent worktree must name exactly <primary>/.git/
// worktrees/<slug> (read through one O_NOFOLLOW fd). -> true | false.
function gitfileNames(dir, want, d) {
  let fd;
  try {
    fd = fs.openSync(path.join(dir, '.git'), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (_e) {
    return false; // missing, a link, or not openable
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return false;
    const buf = Buffer.alloc(GITFILE_MAX_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = /^gitdir: (.+)\n?$/.exec(buf.subarray(0, n).toString('utf8'));
    if (!m) return false;
    return d.realpath(path.resolve(dir, m[1])) === want;
  } catch (_e) {
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

// FR-041 (a), FR-047 — the anchor the action requires, recomputed from the
// lock: for a write action the intent worktree
// <passwd home>/claude-projects/a1-worktrees/<project>-intent-<intent_id>
// (FR-043), otherwise the project; realpath, under claude-projects/. The
// intent worktree must be a real directory (lstat: no link to the project,
// part B review m6) whose `.git` file names <primary>/.git/worktrees/<slug>.
// -> { anchor, primary, write } | null.
function expectedAnchor(doc, projects, d) {
  const { INTENT_WRITE_ACTIONS } = require('./intent-sandbox.cjs');
  const { INTENT_ID_RE } = require('./intent-constants.cjs');
  const write = INTENT_WRITE_ACTIONS.includes(doc.action);
  const primary = d.realpath(path.join(projects, doc.project));
  if (!primary.startsWith(projects + path.sep)) return null;
  if (!write) return { anchor: primary, primary, write };
  if (!INTENT_ID_RE.test(String(doc.intent_id))) return null;
  const slug = `${doc.project}-intent-${doc.intent_id}`;
  const folder = path.join(projects, WORKTREES_DIR, slug);
  const st = fs.lstatSync(folder, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) return null;
  const anchor = d.realpath(folder);
  if (anchor !== folder) return null; // a link on the way
  const admin = path.join(d.realpath(path.join(primary, '.git')), 'worktrees', slug);
  return gitfileNames(anchor, admin, d) ? { anchor, primary, write } : null;
}

// -> { active, ok, action, project, roots, cwd, primary, vaultRoot, write } or an invalid context.
function buildContext(d, lock, ancestry) {
  const detail = ancestry === null ? 'the ancestry of the lock cannot be decided' : lockDetail(lock, d); // null: undecidable walk
  if (detail !== null) return invalid(detail);
  const { action, project, vault_root: vaultRoot, anchor } = lock.doc;
  let want;
  let cwd;
  try {
    const projects = d.realpath(path.join(d.passwdHome(), PROJECTS_DIR));
    want = expectedAnchor(lock.doc, projects, d);
    if (want === null) return invalid('the anchor the action requires does not exist as such (intent worktree: a real directory whose .git file names the project)');
    cwd = d.realpath(d.cwd());
  } catch (_e) {
    return invalid('the anchor directory or the cwd does not resolve');
  }
  if (!sameReal(anchor, want.anchor, d)) return invalid('the lock anchor is not the anchor the action requires (intent worktree or project realpath)');
  if (!inside(cwd, want.anchor)) return invalid('the cwd is outside the anchor directory');
  const vaultProject = resolvePhysical(path.join(vaultRoot, 'project', project), cwd, d);
  const roots = Object.freeze([want.anchor, vaultProject].filter(Boolean));
  let vaultReal = null;
  try {
    vaultReal = d.realpath(vaultRoot);
  } catch (_e) {
    vaultReal = null;
  }
  return Object.freeze({ active: true, ok: true, action, project, roots, cwd, primary: want.primary, vaultRoot: vaultReal, write: want.write });
}

function contextFor(d) {
  const { child, lock, ancestry } = decideChildMode(d);
  return child ? buildContext(d, lock, ancestry) : INACTIVE;
}

function inScope(p, ctx, d) {
  const real = resolvePhysical(p, ctx.cwd, d);
  return real !== null && ctx.roots.some((root) => inside(real, root));
}

const looksLikePath = (a) => a.includes('/') || a.startsWith('.') || a.startsWith('~');

// Every argument FR-041 (c) checks: each value of a path flag (both forms),
// and each other argument or flag value that looks like a path.
function pathArguments(args, pathFlags) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (!a.startsWith('--')) {
      if (looksLikePath(a)) out.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq < 0 ? a : a.slice(0, eq);
    const value = eq < 0 ? null : a.slice(eq + 1);
    if (pathFlags.includes(name)) {
      if (value !== null) out.push(value);
      else if (i + 1 < args.length) out.push(String(args[++i]));
    } else if (value !== null && looksLikePath(value)) out.push(value);
  }
  return out;
}

const clip = (s) => String(s).slice(0, DETAIL_MAX_CHARS);

// -> { ok: true } or { ok: false, reason, detail } for one invocation.
function childGuard(group, sub, args, ctx, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!ctx.ok) return { ok: false, reason: ctx.reason, detail: ctx.detail };
  const C = require('./intent-constants.cjs');
  const key = `${group} ${sub}`;
  if (group === undefined || sub === undefined || !C.INTENT_CHILD_ALLOWLIST[ctx.action].includes(key)) {
    return { ok: false, reason: 'subcommand_not_allowed', detail: clip(`${key} is not allowed for action ${ctx.action}`) };
  }
  const optionShaped = C.optionProblem(group, args.map(String));
  if (optionShaped !== null) return { ok: false, reason: 'subcommand_not_allowed', detail: clip(optionShaped) };
  const { INTENT_CHILD_PATH_FLAGS } = C;
  const outside = pathArguments(args, INTENT_CHILD_PATH_FLAGS).find((p) => !inScope(p, ctx, d));
  if (outside !== undefined) return { ok: false, reason: 'path_outside_scope', detail: clip(outside) };
  return { ok: true };
}

function refuseExit(r) {
  const { INTENT_CHILD_EXIT_CODE } = require('./intent-constants.cjs');
  const line = JSON.stringify({ ok: false, error: 'intent_child_refused', reason: r.reason, detail: r.detail });
  fs.writeSync(1, `${line}\n`);
  fs.writeSync(2, `a1-tools: refused in intent child mode (${r.reason}); nothing was written.\n`);
  process.exit(INTENT_CHILD_EXIT_CODE);
}

// ---------- writing the child-context lock (FR-047, `intent run`) ----------
const LOCK_MODE = 0o600;
// The writer's own deps (the process that holds the lock, never a child).
const writerDeps = () => ({ ...defaultDeps(), pid: process.pid, now: Date.now, homedir: os.homedir });

// Moved here from intent-run.cjs (Wave 7 review n2). Every dependency is
// loaded lazily: this module runs first in every a1-tools child process.

// -> the frozen lock document in LOCK_KEYS order. Throws on a bad context.
function lockDocument(ctx, d) {
  const { INTENT_ACTIONS } = require('./status-constants.cjs');
  const { INTENT_ID_RE } = require('./intent-constants.cjs');
  const { INTENT_PROJECT_SLUG_RE: SLUG_RE } = require('./intent-sandbox.cjs');
  const pid = ctx.pid === undefined ? d.pid : ctx.pid;
  const checks = [
    [Number.isSafeInteger(pid) && pid > 1, 'pid'], [INTENT_ID_RE.test(String(ctx.intent_id)), 'intent_id'],
    [INTENT_ACTIONS.has(ctx.action), 'action'], [SLUG_RE.test(String(ctx.project)), 'project'],
    [typeof ctx.vault_root === 'string' && path.isAbsolute(ctx.vault_root), 'vault_root'],
    [typeof ctx.anchor === 'string' && path.isAbsolute(ctx.anchor), 'anchor'],
  ];
  const bad = checks.find(([ok]) => !ok);
  if (bad) throw Object.assign(new Error(`intent run: invalid ${bad[1]}`), { code: 'A1_INPUT' });
  const values = [pid, d.hostname(), new Date(d.now()).toISOString(), ctx.intent_id, ctx.action, ctx.project, ctx.vault_root, ctx.anchor];
  return Object.freeze(Object.fromEntries(LOCK_KEYS.map((k, i) => [k, values[i]])));
}

// -> { ok: true, lock, file } | { ok: false, reason: 'executor_busy' } when a
// live lock (or a link in its place) exists. Wave 7 (FR-025): a lock left by
// a dead run on this host, or an unparsable one older than the stale bound
// (a crash between create and write), is reclaimed through the ledger lock's
// hard-link takeover; a surviving child of that run is killed through its
// process group first (runs/<intent_id>/child.json).
function writeChildContextLock(ctx, deps = {}) {
  const { assertPrivateDir } = require('./intent-devices.cjs');
  const d = { ...writerDeps(), ...deps };
  const doc = lockDocument(ctx, d);
  const file = path.join(assertPrivateDir({ homedir: d.passwdHome }), path.basename(lockPath(d)));
  let fd = createLockFile(file);
  if (fd === null && reclaimExecutorLock(file, d)) fd = createLockFile(file);
  if (fd === null) return { ok: false, reason: 'executor_busy' };
  try {
    fs.fchmodSync(fd, LOCK_MODE);
    fs.writeSync(fd, `${JSON.stringify(doc)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { ok: true, lock: doc, file };
}

// -> the fd of a new lock file, or null when the path is taken (or a link).
function createLockFile(file) {
  try {
    return fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, LOCK_MODE);
  } catch (e) {
    if (e && (e.code === 'EEXIST' || e.code === 'ELOOP')) return null;
    throw e;
  }
}

// The dead run's child group goes first, then the lock (same judgement as
// the ledger lock: never a live or a foreign-host holder).
function reclaimExecutorLock(file, d) {
  const { reclaimStaleLock } = require('./intent-ledger.cjs');
  const { killGroupSync, recordedGroup } = require('./intent-spawn.cjs');
  const { INTENT_KILL_GRACE_MS } = require('./intent-constants.cjs');
  const held = readLock({ ...defaultDeps(), passwdHome: d.passwdHome, hostname: d.hostname });
  const doc = held.present ? held.doc : null;
  const { holderAlive } = require('./intent-spawn.cjs');
  // Review M2: dead = gone, from before the boot, or the pid was reused; the
  // child group is killed only when recordedGroup confirms its identity.
  const deadHere = doc && doc.hostname === d.hostname() && Number.isSafeInteger(doc.pid) && !holderAlive(doc.pid, Date.parse(String(doc.createdAt)));
  const preBoot = doc && require('./intent-spawn.cjs').beforeBoot(Date.parse(String(doc.createdAt)));
  if (deadHere && !preBoot && /^[0-9a-f-]{36}$/.test(String(doc.intent_id))) { // a pre-boot lock's pgid is never signalled
    const pgid = recordedGroup(path.join(d.homedir(), INTENTS_DIR, 'runs', doc.intent_id));
    if (pgid !== null) killGroupSync(pgid, INTENT_KILL_GRACE_MS);
  }
  return reclaimStaleLock(file, d.hostname(), d.now());
}

// Removes the lock only while it still holds exactly `lock` (identity by
// content, never by inode: Linux reuses inode numbers at once).
function removeChildContextLock(lock, deps = {}) {
  const d = { ...writerDeps(), ...deps, execArgv: [] };
  const now = readLock(d);
  if (!now.present) return { removed: false, why: 'absent' };
  if (now.doc === null || JSON.stringify(now.doc) !== JSON.stringify(lock)) return { removed: false, why: 'not_own_lock' };
  fs.unlinkSync(lockPath(d));
  return { removed: true };
}

// One decision per process: child mode cannot change while a1-tools runs.
let processContext = null;

function currentContext() {
  if (processContext === null) processContext = contextFor(defaultDeps());
  return processContext;
}

// Library seam for fixtures (FR-047): replaces default deps for this process
// and forgets a decision already taken. Never reachable through env.
function injectChildDeps(deps) {
  injected = Object.freeze({ ...deps });
  processContext = null;
}

// The deps this process decides with (intent-git reads the passwd home and
// the git binary from here).
const childDeps = () => defaultDeps();

// Called by a1-tools.cjs before any other module loads or any subcommand runs.
function guardDispatch(argv) {
  const ctx = currentContext();
  if (!ctx.active) return;
  const [group, sub, ...rest] = argv;
  const r = childGuard(group, sub, rest, ctx);
  if (!r.ok) refuseExit(r);
  require('./intent-git.cjs').enterChildGit(ctx); // MAJOR-A/B: every git spawn hardened, repo config checked
}

// True when this a1-tools process is an intent child (for commands that
// skip a human-facing side effect in the child, e.g. spec init's hub link).
function inChildMode() {
  return currentContext().active;
}

// The valid child context of this process (for commands that exist only in
// the child, e.g. `git`), or null outside child mode.
function childContext() {
  const ctx = currentContext();
  return ctx.active && ctx.ok ? ctx : null;
}

// For the spec-010 product mirror, which runs after the repo write and must
// therefore be SKIPPED, not refused, in the child: true outside child mode;
// in it, the mirror slug must equal the context's project (a `project:`
// naming a vault alias of the own project would pass the realpath test
// alone) AND the target must resolve inside the scope.
function childMirrorAllowed(slug, target) {
  const ctx = currentContext();
  if (!ctx.active) return true;
  return ctx.ok && slug === ctx.project && inScope(target, ctx, defaultDeps());
}

// Called by io.cjs resolveVaultPath / projectsPath with the resolved path.
function guardChildPath(p) {
  const ctx = currentContext();
  if (!ctx.active) return p;
  if (!ctx.ok) refuseExit(ctx);
  if (!inScope(p, ctx, defaultDeps())) refuseExit({ reason: 'path_outside_scope', detail: clip(p) });
  return p;
}

module.exports = {
  LOCK_KEYS,
  writeChildContextLock,
  removeChildContextLock,
  isChildMode,
  isAncestor,
  resolvePhysical,
  pathArguments,
  childGuard,
  guardDispatch,
  guardChildPath,
  inChildMode,
  childContext,
  childDeps,
  childMirrorAllowed,
  injectChildDeps,
  refuseExit,
  readLock,
  lockPath,
};
