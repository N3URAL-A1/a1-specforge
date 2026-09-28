'use strict';

// ---------------------------------------------------------------------------
// intent-git — `a1-tools git status|diff|add|commit|log` (spec 011, Wave 6
// part A, FR-048). The child of a write intent has no raw `git` rule: a
// regular .git/config with `core.fsmonitor = "<cmd>"` makes git status, diff,
// add and commit run <cmd> (re-review MAJOR-3, git 2.50.1, no exec bit
// needed), so Write/Edit plus raw git is arbitrary command execution. The
// child reaches git only through this wrapper, and only in child mode: the
// dispatcher's guard has already checked the action allowlist (which lists
// `git <sub>` per action) and every path-like argument; outside child mode
// the group is a usage error (exit 2).
//
// The wrapper:
//   - accepts only the grammar of FR-048 (GRAMMAR below); any other option
//     (-c, -C, --git-dir, --work-tree, --exec-path, --output, --amend,
//     --no-verify, pathspec magic `:…`) is subcommand_not_allowed, exit 77,
//     and git never runs;
//   - requires every path inside the project anchor (realpath, FR-041 (c));
//   - runs GIT_BIN by absolute path as an argv array (shell: false) in the
//     cwd with GIT_LEADING in front of the subcommand and an env built from
//     nothing: GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL=/dev/null, the git
//     keys of FR-042, GIT_CEILING_DIRECTORIES = the anchor's parent (no
//     repository above the project), GIT_LITERAL_PATHSPECS=1, HOME = the
//     passwd home, PATH=/usr/bin:/bin. No GIT_* variable of the caller
//     (GIT_EXEC_PATH, GIT_CONFIG_PARAMETERS, GIT_DIR, ...) reaches git;
//   - adds --no-ext-diff --no-textconv to diff;
//   - passes git's stdout, stderr and exit code through.
// `commit` gets user.name / user.email from the passwd home's global git
// config (read with `git config --global --get`, a read that runs nothing),
// because GIT_CONFIG_GLOBAL=/dev/null hides them from the commit itself.
//
// Classification (grep over skills/<skill>/** and the agents they start,
// 2026-09-28): a1-execute runs git status/diff/log itself and its executor
// agent (a1-erik-executor) commits per wave -> status, diff, log, add,
// commit. a1-new-feature, a1-plan and a1-fix read history and the tree
// (git log, git diff, git status) -> status, diff, log. a1-progress (row R)
// and stage have no Bash -> none. Checked by cases/05b-child-seal.sh H7e.
//
// Repository config (Part A review MAJOR-A, measured): .git/config ALONE can
// make git run a command (a filter or diff driver whose attributes come from
// core.attributesFile pointing at any project file, fsmonitor, pager, ...).
// So before git runs at all, the repository-scope config (scopes local and
// worktree of `git config --list --show-scope --name-only`, a read that runs
// nothing, under the same hardened env) must hold only REPO_CONFIG_ALLOW
// keys, and neither $GIT_DIR/info/attributes nor the common dir's may exist;
// else the call is refused (77 child_context_invalid) and git never runs.
// -c core.attributesFile=/dev/null is passed as well.
//
// Internal git (MAJOR-B): in child mode every git spawn of a1-tools (io.cjs,
// realpath-check, git-safe, ...) is routed through the same runner:
// routeChildGit() replaces the child_process functions of this process
// before the facade loads its modules. The modules intent-child loads for the
// decision itself take no child_process function at load (RV6 pins it:
// worktree-registry, which does, is no longer among them). A call to `git`
// runs GIT_BIN with GIT_LEADING, --no-ext-diff --no-textconv on diff/log/
// show, --ignore-submodules=all on status/diff, the env built from nothing
// and the config check of its repository; every other program, a shell and
// an async git spawn are refused (re-review MINOR-2). A nested repository
// (gitlink) is never entered (submodule.recurse=false, --ignore-submodules;
// chosen over scanning nested .git dirs, re-review MINOR-5).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const { childContext, childDeps, resolvePhysical, refuseExit } = require('./intent-child.cjs');

const { spawnSync } = childProcess; // the original, taken before routeChildGit() replaces it

const GIT_BIN = '/usr/bin/git';
const EXIT_USAGE = 2;
const EXIT_GIT_FAILED = 1;
const LOG_MAX_N = 1000;
const IDENTITY_KEYS = Object.freeze(['user.name', 'user.email']);
const SAFE_LANG_RE = /^[A-Za-z0-9_.@-]{1,64}$/;

// FR-048 leading options, plus the gpg/gc/maintenance keys: a commit must not
// start gpg.program or an auto gc/maintenance run either.
const GIT_LEADING = Object.freeze([
  '--no-optional-locks',
  '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=',
  '-c', 'core.pager=cat', '-c', 'credential.helper=',
  '-c', 'commit.gpgSign=false', '-c', 'log.showSignature=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
  '-c', 'core.attributesFile=/dev/null',
  '-c', 'submodule.recurse=false', // re-review MINOR-5: never into a nested repository the config gate did not check
]);

// Re-review MINOR-2: in child mode a1-tools starts no program but git
// (routed above) and none of these. Empty today: the ancestry walk runs
// /bin/ps through intent-child's own spawnSync, taken before the routing;
// no allowlisted subcommand starts anything else (measured with the P
// probes, 2026-09-28). A shell of any kind is never on it.
const CHILD_SPAWN_ALLOW = Object.freeze([]);

// status and diff never descend into a gitlink (measured: plain git status
// and git diff run a nested repository's fsmonitor, --ignore-submodules=all
// does not).
const NO_RECURSE = Object.freeze(['--ignore-submodules=all']);

// The only repository-scope keys a child's git may meet (names as git prints
// them: section and key lower case). Each is data, not a command:
const REPO_CONFIG_ALLOW = Object.freeze([
  /^core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode)$/, // git init defaults
  /^core\.hookspath$/, //          husky sets it (3 of 30 projects, 2026-09-28); -c and FR-042 override it in every call
  /^remote\..+\.(url|fetch)$/, //   used only by fetch/push, which no grammar or internal call runs
  /^branch\..+\.(remote|merge)$/, // upstream tracking, read by status
  /^user\.(name|email)$/, //        commit identity
  /^extensions\.worktreeconfig$/, // repos with linked worktrees (a1-worktree); the worktree scope is scanned too
]);
const SHELL_GIT_RE = /^\s*git(\s+[A-Za-z0-9._\/=:@%+,~^-]+)*\s*$/; // execSync strings: plain words only

// FR-042 — the git keys of the child env; the wrapper sets them as well.
const GIT_CONFIG_ENV = Object.freeze({
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: '/dev/null',
  GIT_CONFIG_KEY_1: 'core.fsmonitor',
  GIT_CONFIG_VALUE_1: 'false',
});

const refused = (detail) => ({ ok: false, reason: 'subcommand_not_allowed', detail: String(detail).slice(0, 200) });
const isPath = (a) => typeof a === 'string' && a.length > 0 && !a.startsWith('-') && !a.startsWith(':');

// Splits `[options…] [-- <path>…]`. -> { opts, paths } or null (a path
// without `--`, or `--` without a path).
function splitPaths(args) {
  const at = args.indexOf('--');
  if (at < 0) return { opts: args, paths: [] };
  const paths = args.slice(at + 1);
  return paths.length > 0 ? { opts: args.slice(0, at), paths } : null;
}

// Each option at most once, all from `allowed`.
const onlyOnce = (opts, allowed) => opts.every((o, i) => allowed.includes(o) && opts.indexOf(o) === i);

function parseStatus(args) {
  const allowed = ['--porcelain', '--porcelain=v1', '--short'];
  const porcelain = args.filter((a) => a.startsWith('--porcelain')).length;
  return onlyOnce(args, allowed) && porcelain <= 1 ? { ok: true, argv: ['status', ...NO_RECURSE, ...args, '--end-of-options'], paths: [] } : refused('git status [--porcelain[=v1]] [--short]');
}

function parseDiff(args) {
  const split = splitPaths(args);
  const ok = split && onlyOnce(split.opts, ['--cached', '--staged', '--stat', '--name-only'])
    && !(split.opts.includes('--cached') && split.opts.includes('--staged')) && split.paths.every(isPath);
  if (!ok) return refused('git diff [--cached|--staged] [--stat] [--name-only] [-- <path>…]');
  const tail = split.paths.length ? ['--', ...split.paths] : [];
  return { ok: true, argv: ['diff', '--no-ext-diff', '--no-textconv', ...NO_RECURSE, ...split.opts, '--end-of-options', ...tail], paths: split.paths };
}

function parseAdd(args) {
  if (args.length === 0 || !args.every(isPath)) return refused('git add <path>…');
  return { ok: true, argv: ['add', '--end-of-options', ...args], paths: args };
}

function parseCommit(args) {
  const ok = args.length === 2 && args[0] === '-m' && typeof args[1] === 'string' && args[1].trim().length > 0 && !args[1].startsWith('-');
  return ok ? { ok: true, argv: ['commit', `--message=${args[1]}`, '--end-of-options'], paths: [], identity: true } : refused('git commit -m <message>');
}

function parseLog(args) {
  const split = splitPaths(args);
  if (!split || !split.paths.every(isPath)) return refused('git log [-n <N>] [--oneline] [-- <path>…]');
  const out = [];
  for (let i = 0; i < split.opts.length; i++) {
    const o = split.opts[i];
    const n = o === '-n' ? split.opts[++i] : undefined;
    const nOk = n !== undefined && /^[1-9][0-9]{0,3}$/.test(n) && Number(n) <= LOG_MAX_N && !out.includes('-n');
    if (o === '-n' && nOk) out.push('-n', n);
    else if (o === '--oneline' && !out.includes(o)) out.push(o);
    else return refused('git log [-n <N>] [--oneline] [-- <path>…]');
  }
  const tail = split.paths.length ? ['--', ...split.paths] : [];
  return { ok: true, argv: ['log', ...out, '--end-of-options', ...tail], paths: split.paths };
}

const GRAMMAR = Object.freeze({ status: parseStatus, diff: parseDiff, add: parseAdd, commit: parseCommit, log: parseLog });

// FR-048 -> { ok: true, argv, paths, identity? } | refused(detail). Pure.
function parseGitArgs(sub, args) {
  if (!Object.prototype.hasOwnProperty.call(GRAMMAR, sub)) return refused(`git ${String(sub).slice(0, 40)} is not in the grammar`);
  return GRAMMAR[sub](args.map(String));
}

// The env git runs with: built from nothing (never a filtered process.env).
// `ceiling` stops the repository search above the project (FR-048).
function runnerEnv(home, parentEnv, ceiling) {
  const lang = SAFE_LANG_RE.test(parentEnv.LANG || '') ? { LANG: parentEnv.LANG } : {};
  return {
    HOME: home,
    PATH: '/usr/bin:/bin',
    ...lang,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CEILING_DIRECTORIES: ceiling,
    GIT_LITERAL_PATHSPECS: '1',
    ...GIT_CONFIG_ENV,
  };
}

const gitEnv = (ctx, home, parentEnv) => runnerEnv(home, parentEnv, path.dirname(ctx.roots[0]));

// A value passed on as `-c key=value`: one line, not option-shaped.
const safeIdentity = (v) => v.length > 0 && !/[\r\n]/.test(v) && !v.startsWith('-');

// user.name / user.email of the passwd home's global config -> ['-c', …].
// Read by git itself (`git config --global --get`), never by parsing the
// file here; only these two keys cross over, every other global key
// (core.fsmonitor, alias.*, ...) stays behind GIT_CONFIG_GLOBAL=/dev/null.
function identityArgs(gitBin, home) {
  const env = { HOME: home, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1' };
  return IDENTITY_KEYS.flatMap((key) => {
    const r = spawnSync(gitBin, ['config', '--global', '--get', key], { env, encoding: 'utf8', shell: false });
    const value = r.status === 0 ? String(r.stdout).replace(/\n$/, '') : '';
    return safeIdentity(value) ? ['-c', `${key}=${value}`] : [];
  });
}

const realOrSelf = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch (_e) {
    return p;
  }
};

// Why the repository around `dir` may not meet git, or null, under `env`.
// `expect` ({ gitDir, common }, child mode only): the git dir and common dir
// that follow from the LOCK, never from the repository (part B security
// review BLOCKER: a child that rewrites the worktree's `.git` file to
// `gitdir: <primary>/.git` or to a planted `./evil` repository would
// otherwise commit onto the owner's branch or meet an unchecked config).
// The scan always runs GIT_BIN (never the fixture's gitBin spy, which
// records only the call being made); `bin` is a fixture seam (library calls
// only) for a git whose rev-parse fails or prints one line.
// Re-verify n1: with `expect` set, a rev-parse that fails or does not print
// exactly the two dirs is a problem (fail closed), never a silent skip.
function repoConfigProblemAt(dir, env, expect = null, bin = GIT_BIN) {
  const run = (args) => spawnSync(bin, args, { cwd: dir, env, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const list = run(['config', '--list', '--show-scope', '--name-only']);
  let problem = list.status === 0 ? null : 'the repository config cannot be listed';
  for (const line of problem ? [] : String(list.stdout).split('\n')) {
    const [scope, name] = line.split('\t');
    if ((scope === 'local' || scope === 'worktree') && !REPO_CONFIG_ALLOW.some((re) => re.test(name))) {
      problem = `the repository config holds ${String(name).slice(0, 80)}`;
      break;
    }
  }
  const dirs = run(['rev-parse', '--git-dir', '--git-common-dir']);
  const gitDirs = dirs.status === 0 ? String(dirs.stdout).split('\n').filter(Boolean).map((g) => path.resolve(dir, g)) : [];
  if (!problem && gitDirs.some((g) => fs.existsSync(path.join(g, 'info', 'attributes')))) problem = 'the repository has info/attributes';
  if (!problem && expect && gitDirs.length !== 2) problem = 'the repository\'s git dirs cannot be determined';
  if (!problem && expect) {
    const [gitDir, common] = gitDirs.map(realOrSelf);
    if (gitDir !== realOrSelf(expect.gitDir) || common !== realOrSelf(expect.common)) {
      problem = `the repository's git dir is not the one the lock names (${String(gitDir).slice(0, 120)})`;
    }
  }
  return problem;
}

const insideDir = (p, root) => p === root || p.startsWith(root + path.sep);

// The git dirs a child's repository must have, from the lock (ctx), or null
// for a directory outside both scope roots' repositories: in the anchor the
// project's (write action: <primary>/.git/worktrees/<slug>, common
// <primary>/.git; progress/stage: <primary>/.git for both), in the vault
// project the vault's own <vault>/.git.
function expectedGitDirs(dir, ctx) {
  const real = realOrSelf(path.resolve(dir));
  if (ctx.primary && insideDir(real, ctx.roots[0])) {
    const common = path.join(ctx.primary, '.git');
    return { gitDir: ctx.write ? path.join(common, 'worktrees', path.basename(ctx.roots[0])) : common, common };
  }
  if (ctx.vaultRoot) return { gitDir: path.join(ctx.vaultRoot, '.git'), common: path.join(ctx.vaultRoot, '.git') };
  return null;
}

// The child's check, cached per dir for the life of the a1-tools process.
const configCache = new Map();
function repoConfigProblem(dir, ctx, d) {
  if (!configCache.has(dir)) configCache.set(dir, repoConfigProblemAt(dir, gitEnv(ctx, d.passwdHome(), d.env), expectedGitDirs(dir, ctx)));
  return configCache.get(dir);
}

function refuse(r) {
  const { INTENT_CHILD_EXIT_CODE } = require('./intent-constants.cjs');
  process.stdout.write(`${JSON.stringify({ ok: false, error: 'intent_child_refused', reason: r.reason, detail: r.detail })}\n`);
  process.stderr.write(`a1-tools: refused in intent child mode (${r.reason}); git did not run.\n`);
  process.exitCode = INTENT_CHILD_EXIT_CODE;
}

// Every path inside the project anchor (the repository), physically.
function pathsInAnchor(paths, ctx, d) {
  const anchor = ctx.roots[0];
  return paths.find((p) => {
    const real = resolvePhysical(p, ctx.cwd, d);
    return real === null || !(real === anchor || real.startsWith(anchor + path.sep));
  });
}

// `a1-tools git <sub> [args]` — exit: git's own, 77 refused, 2 outside child mode.
function cmdGit(sub, args) {
  const ctx = childContext();
  if (ctx === null) {
    process.stderr.write('usage error: a1-tools git exists only in intent child mode (the child of `intent run`)\n');
    process.exitCode = EXIT_USAGE;
    return;
  }
  const parsed = parseGitArgs(sub, args);
  if (!parsed.ok) return refuse(parsed);
  const d = childDeps();
  const outside = pathsInAnchor(parsed.paths, ctx, d);
  if (outside !== undefined) return refuse({ reason: 'path_outside_scope', detail: String(outside).slice(0, 200) });
  const problem = repoConfigProblem(ctx.cwd, ctx, d);
  if (problem !== null) return refuse({ reason: 'child_context_invalid', detail: problem });
  const gitBin = d.gitBin || GIT_BIN;
  const home = d.passwdHome();
  const identity = parsed.identity ? identityArgs(GIT_BIN, home) : []; // a read, like the config scan: never the fixture spy
  const r = spawnSync(gitBin, [...GIT_LEADING, ...identity, ...parsed.argv], {
    cwd: ctx.cwd, env: gitEnv(ctx, home, d.env), stdio: ['ignore', 'inherit', 'inherit'], shell: false,
  });
  if (r.error) process.stderr.write(`a1-tools git: ${gitBin} could not run (${r.error.code || 'error'})\n`);
  process.exitCode = r.error || r.status === null ? EXIT_GIT_FAILED : r.status;
}

// ---------- internal git of the child (MAJOR-B) ----------

const isGit = (cmd) => typeof cmd === 'string' && (cmd === 'git' || path.basename(cmd) === 'git');
const mentionsGit = (text) => typeof text === 'string' && /(^|[^A-Za-z0-9_.-])git([^A-Za-z0-9_-]|$)/.test(text);

// GIT_LEADING in front, --no-ext-diff --no-textconv behind diff/log/show,
// --ignore-submodules=all behind status/diff.
function hardenedArgs(args) {
  let i = 0;
  while (i < args.length && (args[i] === '-C' || args[i] === '-c')) i += 2;
  const extra = [...(['diff', 'log', 'show'].includes(args[i]) ? ['--no-ext-diff', '--no-textconv'] : []),
    ...(['status', 'diff'].includes(args[i]) ? NO_RECURSE : [])];
  return [...GIT_LEADING, ...args.slice(0, i + 1), ...extra, ...args.slice(i + 1)];
}

// The repository an internal call works on must lie in the scope and pass
// the config check; else the whole a1-tools process refuses (77).
function checkRouted(args, opts, ctx, d) {
  const base = opts && opts.cwd ? String(opts.cwd) : process.cwd();
  const dir = args[0] === '-C' && typeof args[1] === 'string' ? path.resolve(base, args[1]) : path.resolve(base);
  const real = resolvePhysical(dir, ctx.cwd, d);
  if (real === null || !ctx.roots.some((r) => real === r || real.startsWith(r + path.sep))) {
    refuseExit({ reason: 'path_outside_scope', detail: `internal git in ${dir}`.slice(0, 200) });
  }
  const problem = repoConfigProblem(dir, ctx, d);
  if (problem !== null) refuseExit({ reason: 'child_context_invalid', detail: problem });
}

function refuseInternal(detail) {
  refuseExit({ reason: 'subcommand_not_allowed', detail });
}

const spawnAllowed = (cmd) => typeof cmd === 'string' && CHILD_SPAWN_ALLOW.includes(cmd);
const notAllowed = (cmd) => refuseInternal(`${String(cmd).slice(0, 80)} may not be started in intent child mode`);

// Replaces the child_process functions of this process (child mode only):
// git (by name or path) runs hardened, a CHILD_SPAWN_ALLOW binary as asked,
// everything else (a shell, `/usr/bin/env git`, any other program) exits 77.
function routeChildGit(ctx) {
  const d = childDeps();
  const bin = d.gitBin || GIT_BIN;
  const orig = { ...childProcess };
  const opts = (o) => ({ ...(o || {}), shell: false, env: gitEnv(ctx, d.passwdHome(), d.env) });
  const sync = (name) => (cmd, a, o) => {
    const [args, o2] = Array.isArray(a) ? [a.map(String), o] : [[], a];
    if (o2 && o2.shell) refuseInternal('a shell in intent child mode');
    if (!isGit(cmd)) return spawnAllowed(cmd) ? orig[name](cmd, a, o) : notAllowed(cmd);
    checkRouted(args, o2, ctx, d);
    return orig[name](bin, hardenedArgs(args), opts(o2));
  };
  childProcess.spawnSync = sync('spawnSync');
  childProcess.execFileSync = sync('execFileSync');
  childProcess.execSync = (command, o) => {
    if (!mentionsGit(command) || !SHELL_GIT_RE.test(command)) refuseInternal('a shell string in intent child mode');
    const args = command.trim().split(/\s+/).slice(1);
    checkRouted(args, o, ctx, d);
    return orig.execFileSync(bin, hardenedArgs(args), opts(o));
  };
  for (const name of ['spawn', 'execFile', 'exec', 'fork']) {
    childProcess[name] = (cmd, ...rest) => {
      if (isGit(cmd) || name === 'exec' || name === 'fork') refuseInternal(`${name} of ${String(cmd).slice(0, 60)} in intent child mode`);
      return spawnAllowed(cmd) ? orig[name](cmd, ...rest) : notAllowed(cmd);
    };
  }
}

// Called by intent-child's guardDispatch once the context is valid: route
// every git spawn, then check the project repository before anything runs.
function enterChildGit(ctx) {
  routeChildGit(ctx);
  const problem = repoConfigProblem(ctx.cwd, ctx, childDeps());
  if (problem !== null) refuseExit({ reason: 'child_context_invalid', detail: problem });
}

module.exports = {
  GIT_BIN, GIT_LEADING, GIT_CONFIG_ENV, REPO_CONFIG_ALLOW, parseGitArgs, safeIdentity, cmdGit, enterChildGit,
  runnerEnv, repoConfigProblemAt, // FR-043: the executor's own git calls (intent-worktree.cjs) use the same runner
};
