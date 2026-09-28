'use strict';

// ---------------------------------------------------------------------------
// intent-run — `a1-tools intent run` (spec 011, Wave 6). Part A (entry
// conditions, 2026-09-28) builds the executor-side pieces the spawn stands
// on; this file spawns nothing yet (Part B adds runIntent and the spawn):
//
//   writeChildContextLock / removeChildContextLock (FR-047, FR-025)
//     ~/.a1-intents/executor.lock of the passwd home, O_WRONLY|O_CREAT|O_EXCL|
//     O_NOFOLLOW at 0600, exactly the eight LOCK_KEYS; `run` takes it as its
//     first lock, before the project lock, and removes it in `finally`.
//     Wave 7 adds the busy semantics (stale reclaim) of the global lock.
//   createRunDir / openRunOutputs / removeRunDir (FR-049)
//     ~/.a1-intents/runs/<id>/ (0700) with stdout.txt and stderr.txt (0600,
//     O_EXCL|O_NOFOLLOW); `complete` accepts --stdout/--stderr only there.
//   spawnEnvSecrets (FR-049): every spawn-env value beyond the fixed names
//     of FR-021, for the exact-value redaction of FR-031 (none in v1).
//   guardArgv / guardStageArgv (FR-039): pure checks over a built argv; Part
//     B builds the argv (buildArgv) and calls them before every spawn. The
//     values the owner measurements may still change (the deny rules: B5;
//     the env names: B4) come in as arguments, so the guard itself does not
//     depend on a measurement outcome.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');

const { LOCK_KEYS, readLock, lockPath, childDeps } = require('./intent-child.cjs');
const { assertPrivateDir, openPrivate } = require('./intent-devices.cjs');
const { INTENT_ACTIONS } = require('./status-constants.cjs');
const { INTENT_ID_RE, INTENT_CHILD_ENV_NAMES, INTENT_ROW_TOOLS, rowAllow, readDenyRules, workTreeDenyRules } = require('./intent-constants.cjs');
const { INTENT_PROJECT_SLUG_RE: SLUG_RE } = require('./intent-sandbox.cjs'); // not worktree-registry: it takes execFileSync at load

const LOCK_MODE = 0o600;
const RUNS_DIR = 'runs';
const RUN_DIR_MODE = 0o700;
const RUN_FILE_MODE = 0o600;
const RUN_OUTPUTS = Object.freeze(['stdout.txt', 'stderr.txt']);
const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;

const defaultDeps = () => ({
  pid: process.pid,
  hostname: os.hostname,
  now: Date.now,
  homedir: os.homedir,
  passwdHome: () => os.userInfo().homedir,
  getuid: process.getuid,
});

const inputError = (what) => Object.assign(new Error(`intent run: invalid ${what}`), { code: 'A1_INPUT' });

// Review MINOR-3 — every intent command and `run` refuse fail closed when
// $HOME (os.homedir(), where devices, ledger, log, run dir and seal live)
// is not the passwd home (where the lock, the anchor and the read-deny
// rules point). Throws A1_HOME_SPLIT; returns the passwd home's realpath.
function assertHomeConsistent(deps = {}) {
  const d = { ...childDeps(), ...deps };
  const real = (p) => {
    try {
      return d.realpath(p);
    } catch (_e) {
      return null; // a home that does not resolve matches nothing
    }
  };
  const [home, passwd] = [real((d.homedir || os.homedir)()), real(d.passwdHome())];
  if (home === null || home !== passwd) {
    throw Object.assign(new Error(`$HOME (${home}) is not the passwd home (${passwd}); intent commands refuse until they are the same`), { code: 'A1_HOME_SPLIT' });
  }
  return passwd;
}

// ---------- child-context lock (FR-047) ----------

// -> the frozen lock document in LOCK_KEYS order. Throws on a bad context.
function lockDocument(ctx, d) {
  const pid = ctx.pid === undefined ? d.pid : ctx.pid;
  const checks = [
    [Number.isSafeInteger(pid) && pid > 1, 'pid'], [INTENT_ID_RE.test(String(ctx.intent_id)), 'intent_id'],
    [INTENT_ACTIONS.has(ctx.action), 'action'], [SLUG_RE.test(String(ctx.project)), 'project'],
    [typeof ctx.vault_root === 'string' && path.isAbsolute(ctx.vault_root), 'vault_root'],
    [typeof ctx.anchor === 'string' && path.isAbsolute(ctx.anchor), 'anchor'],
  ];
  const bad = checks.find(([ok]) => !ok);
  if (bad) throw inputError(bad[1]);
  const values = [pid, d.hostname(), new Date(d.now()).toISOString(), ctx.intent_id, ctx.action, ctx.project, ctx.vault_root, ctx.anchor];
  return Object.freeze(Object.fromEntries(LOCK_KEYS.map((k, i) => [k, values[i]])));
}

// -> { ok: true, lock, file } | { ok: false, reason: 'executor_busy' } when a
// lock (or a link in its place) already exists.
function writeChildContextLock(ctx, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const doc = lockDocument(ctx, d);
  const file = path.join(assertPrivateDir({ homedir: d.passwdHome }), path.basename(lockPath(d)));
  let fd;
  try {
    fd = fs.openSync(file, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, LOCK_MODE);
  } catch (e) {
    if (e && (e.code === 'EEXIST' || e.code === 'ELOOP')) return { ok: false, reason: 'executor_busy' };
    throw e;
  }
  try {
    fs.fchmodSync(fd, LOCK_MODE);
    fs.writeSync(fd, `${JSON.stringify(doc)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { ok: true, lock: doc, file };
}

// Removes the lock only while it still holds exactly `lock` (identity by
// content, never by inode: Linux reuses inode numbers at once).
function removeChildContextLock(lock, deps = {}) {
  const d = { ...defaultDeps(), ...deps, execArgv: [] };
  const now = readLock(d);
  if (!now.present) return { removed: false, why: 'absent' };
  if (now.doc === null || JSON.stringify(now.doc) !== JSON.stringify(lock)) return { removed: false, why: 'not_own_lock' };
  fs.unlinkSync(lockPath(d));
  return { removed: true };
}

// ---------- private run directory (FR-049) ----------

const runsRoot = (d) => path.join(assertPrivateDir({ homedir: d.homedir }), RUNS_DIR);

function sandboxInvalid(detail) {
  return Object.freeze({ ok: false, reason: 'sandbox_invalid', detail });
}

// mkdir 0700 without following a link, then the private-dir check on the
// descriptor. -> null, or why the entry is not such a directory.
function privateSubdir(dir, d) {
  try {
    fs.mkdirSync(dir, { mode: RUN_DIR_MODE });
  } catch (e) {
    if (!e || e.code !== 'EEXIST') return `cannot create (${e && e.code})`;
  }
  try {
    const fd = openPrivate(dir, 'directory', d, (why) => Object.assign(new Error(why), { code: 'A1_RUN_DIR_UNSAFE' }));
    if (fd === null) return 'missing';
    fs.closeSync(fd);
    return null;
  } catch (e) {
    if (e && e.code === 'A1_RUN_DIR_UNSAFE') return e.message;
    throw e;
  }
}

// -> { ok: true, dir } | sandboxInvalid(run_dir_unsafe). The dir of an
// earlier run of the same id is reused only when it is private and empty.
function createRunDir(id, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!INTENT_ID_RE.test(String(id))) throw inputError('intent id');
  const root = runsRoot(d);
  const dir = path.join(root, id);
  const why = privateSubdir(root, d) || privateSubdir(dir, d);
  if (why !== null) return sandboxInvalid(`run_dir_unsafe: ${why}`);
  if (fs.readdirSync(dir).length > 0) return sandboxInvalid('run_dir_unsafe: not empty');
  return Object.freeze({ ok: true, dir });
}

// -> { stdout: fd, stderr: fd, paths } — both created O_EXCL|O_NOFOLLOW 0600.
function openRunOutputs(dir) {
  const fds = [];
  try {
    for (const name of RUN_OUTPUTS) {
      const fd = fs.openSync(path.join(dir, name), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, RUN_FILE_MODE);
      fds.push(fd);
      fs.fchmodSync(fd, RUN_FILE_MODE);
    }
  } catch (e) {
    fds.forEach((fd) => fs.closeSync(fd));
    throw e;
  }
  return Object.freeze({ stdout: fds[0], stderr: fds[1], paths: RUN_OUTPUTS.map((n) => path.join(dir, n)) });
}

// FR-049 — `complete` reads --stdout/--stderr only as a regular 0600 file of
// this uid directly inside ~/.a1-intents/runs/<id>/ of the intent's own id,
// every directory on the way opened O_NOFOLLOW and private, the file through
// one O_NOFOLLOW descriptor. -> { ok: true, fd } | { ok: false, why }.
function openRunOutput(file, id, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!INTENT_ID_RE.test(String(id))) return { ok: false, why: 'belongs to no intent id' };
  const intents = path.join(d.homedir(), '.a1-intents');
  const dirs = [intents, path.join(intents, RUNS_DIR), path.join(intents, RUNS_DIR, id)];
  if (path.dirname(path.resolve(String(file))) !== dirs[2]) return { ok: false, why: `must lie directly in ~/.a1-intents/${RUNS_DIR}/${id}/` };
  const fail = (why) => Object.assign(new Error(why), { code: 'A1_RUN_DIR_UNSAFE' });
  try {
    for (const dir of dirs) {
      const fd = openPrivate(dir, 'directory', d, fail);
      if (fd === null) return { ok: false, why: 'has no run directory' };
      fs.closeSync(fd);
    }
    const fd = openPrivate(path.resolve(String(file)), 'file', d, fail);
    return fd === null ? { ok: false, why: 'file does not exist' } : { ok: true, fd };
  } catch (e) {
    if (e && e.code === 'A1_RUN_DIR_UNSAFE') return { ok: false, why: `is not a private run file (${e.message})` };
    throw e;
  }
}

// `run` removes the dir after `complete` succeeded; only the two outputs.
function removeRunDir(id, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!INTENT_ID_RE.test(String(id))) throw inputError('intent id');
  const dir = path.join(runsRoot(d), id);
  for (const name of RUN_OUTPUTS) fs.rmSync(path.join(dir, name), { force: true });
  fs.rmdirSync(dir);
}

// ---------- spawn-env secrets (FR-049 -> FR-031) ----------

// Values of every env key beyond the fixed names of FR-021.
function spawnEnvSecrets(env) {
  return Object.freeze(Object.entries(env || {})
    .filter(([k, v]) => !INTENT_CHILD_ENV_NAMES.includes(k) && typeof v === 'string' && v.length > 0)
    .map(([, v]) => v));
}

// ---------- argv guard (FR-039) ----------

// Every flag of the FR-022 template -> its number of values (the deny list
// takes every following element that does not start with `-`).
const CLAUDE_TEMPLATE_FLAGS = Object.freeze({
  '-p': 1, '--restricted': 0, '--strict-mcp-config': 0, '--mcp-config': 1, '--tools': 1, '--allowedTools': 1,
  '--disallowedTools': Infinity, '--plugin-dir': 1, '--add-dir': 1, '--permission-mode': 1, '--permission-prompts': 1,
  '--no-session-persistence': 0, '--append-system-prompt': 1, '--output-format': 1,
});
const FIXED_VALUES = Object.freeze({ '--permission-mode': 'dontAsk', '--permission-prompts': 'none', '--output-format': 'json' });
const NODE_OPTION_RE = /^(?:-e|--eval|-p|--print|-r|--require|--import|--loader|--experimental-loader|--env-file|--inspect(?:-brk|-port|-wait|-publish-uid)?)(?:=|$)/;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SAFE_PATH_RE = /^\/[A-Za-z0-9._@+/-]+$/; // executor-resolved paths; `Bash(node <T> *)` must match them literally
const PAYLOAD_SUBSTRING_MIN = 16;

const fail = (rule) => Object.freeze({ ok: false, rule });
const safePath = (p) => typeof p === 'string' && SAFE_PATH_RE.test(p) && path.normalize(p) === p;

// Forbidden anywhere, whatever the flag: bypass spellings, settings, payload.
function forbiddenElement(argv, payload) {
  for (const el of argv.map(String)) {
    if (/dangerously/i.test(el)) return 'forbidden_dangerously';
    if (/bypassPermissions/i.test(el)) return 'forbidden_bypass_permissions';
    if (el === '--settings' || el.startsWith('--settings=')) return 'forbidden_settings';
    if (el === '--setting-sources' || el.startsWith('--setting-sources=')) return 'forbidden_setting_sources';
    if (typeof payload === 'string' && payload.length > 0 && (el === payload || (payload.length >= PAYLOAD_SUBSTRING_MIN && el.includes(payload)))) return 'payload_in_argv';
  }
  return null;
}

// -> { flags: { flag: [values…] per occurrence } } or { rule }.
function parseTemplateArgv(argv) {
  if (argv[0] !== '-p') return { rule: 'first_element_not_p' };
  const flags = {};
  for (let i = 0; i < argv.length;) {
    const el = String(argv[i]);
    if (!Object.prototype.hasOwnProperty.call(CLAUDE_TEMPLATE_FLAGS, el)) return { rule: el.startsWith('-') ? 'unknown_flag' : 'stray_element' };
    const arity = CLAUDE_TEMPLATE_FLAGS[el];
    let j = i + 1;
    if (arity === Infinity) while (j < argv.length && !String(argv[j]).startsWith('-')) j += 1;
    else j += arity;
    if (j > argv.length) return { rule: `missing_value:${el}` };
    flags[el] = [...(flags[el] || []), argv.slice(i + 1, j).map(String)];
    i = j;
  }
  return { flags };
}

// FR-039 pins on the allow list: exactly one Bash rule for row W, and none
// that names raw git, a node option or an env assignment before `node`.
function allowEntriesRule(value, row, a1Tools) {
  const bash = value.split(',').filter((e) => /^Bash\(/.test(e));
  for (const e of bash) {
    const tokens = e.slice('Bash('.length, -1).trim().split(/\s+/);
    const nodeAt = tokens.indexOf('node');
    if (tokens.slice(0, nodeAt < 0 ? tokens.length : nodeAt).some((t) => ENV_ASSIGNMENT_RE.test(t))) return 'allow_env_assignment';
    if (nodeAt !== 0 && tokens.includes('git')) return 'allow_raw_git';
    if (nodeAt === 0 && tokens.slice(1).some((t) => NODE_OPTION_RE.test(t))) return 'allow_node_option';
  }
  const want = row === 'W' ? [`Bash(node ${a1Tools} *)`] : [];
  return bash.join('\n') === want.join('\n') ? null : 'bash_rule';
}

// Exact values of the flags that must appear exactly once.
function valueRule(flags, o, a1Tools) {
  const one = (f) => flags[f][0][0];
  const want = {
    '--mcp-config': o.emptyMcpPath, '--tools': INTENT_ROW_TOOLS[o.row].join(','), '--allowedTools': rowAllow(o.row, a1Tools).join(','),
    '--plugin-dir': o.sealDir, '--add-dir': o.sealDir, '--append-system-prompt': o.systemPrompt, ...FIXED_VALUES,
    '-p': o.prompt,
  };
  const bad = Object.keys(want).find((f) => one(f) !== want[f]);
  if (bad) return `value:${bad}`;
  const deny = flags['--disallowedTools'][0];
  return JSON.stringify(deny) === JSON.stringify([...o.denyRules]) ? null : 'deny_rules';
}

// Review MINOR-5: what the guard pins itself; the caller may only add. The
// deny list must hold the seal, work-tree (FR-042) and private-state
// (FR-049) rules, the MCP config is the seal dir's empty-mcp.json, and the
// prompt is always given.
function pinnedRule(o) {
  if (typeof o.prompt !== 'string' || o.prompt.length === 0) return 'prompt_unpinned';
  if (o.emptyMcpPath !== path.join(path.dirname(o.sealDir), 'empty-mcp.json')) return 'empty_mcp_path';
  if (typeof o.cwd !== 'string' || !safePath(o.cwd) || typeof o.passwdHome !== 'string' || !safePath(o.passwdHome)) return 'path_charset';
  const required = ['Bash(git *--output*)', `Edit(/${o.sealDir}/**)`, `Write(/${o.sealDir}/**)`, ...workTreeDenyRules(o.cwd), ...readDenyRules(o.passwdHome)];
  const given = new Set(o.denyRules || []);
  return required.every((r) => given.has(r)) ? null : 'deny_rules_incomplete';
}

// Caller env names may only narrow the FR-021 set.
function envRule(env, envNames) {
  const names = Object.keys(env || {});
  if (names.includes('NODE_OPTIONS')) return 'env_node_options';
  const allowed = INTENT_CHILD_ENV_NAMES.filter((n) => !envNames || envNames.includes(n));
  return names.every((n) => allowed.includes(n)) ? null : 'env_name';
}

// FR-039 -> { ok: true } | { ok: false, rule }. o: { row: 'R'|'W', sealDir,
// emptyMcpPath, payload, prompt, denyRules, systemPrompt, env, cwd,
// passwdHome, envNames? }.
function guardArgv(argv, o) {
  if (!Array.isArray(argv) || !Object.prototype.hasOwnProperty.call(INTENT_ROW_TOOLS, o.row)) return fail('row_or_argv_invalid');
  const forbidden = forbiddenElement(argv, o.payload);
  if (forbidden) return fail(forbidden);
  if (!safePath(o.sealDir) || !safePath(o.emptyMcpPath)) return fail('path_charset');
  const pinned = pinnedRule(o);
  if (pinned) return fail(pinned);
  const parsed = parseTemplateArgv(argv);
  if (parsed.rule) return fail(parsed.rule);
  const missing = Object.keys(CLAUDE_TEMPLATE_FLAGS).find((f) => !parsed.flags[f] || parsed.flags[f].length !== 1);
  if (missing) return fail(`flag_count:${missing}`);
  const a1Tools = path.join(o.sealDir, '_shared', 'a1-tools.cjs');
  const rule = allowEntriesRule(parsed.flags['--allowedTools'][0][0], o.row, a1Tools) || valueRule(parsed.flags, o, a1Tools)
    || envRule(o.env, o.envNames);
  return rule ? fail(rule) : Object.freeze({ ok: true });
}

// FR-039 for `stage` (kind cli): argv exactly [<T>, product, stage, --by <id>,
// --set <stage>, --dir docs/product], spawned as process.execPath, so no node
// option precedes <T>. -> { ok: true } | { ok: false, rule }.
function guardStageArgv(argv, { sealDir, featureId, stage, env, envNames }) {
  if (!safePath(sealDir)) return fail('path_charset');
  const want = [path.join(sealDir, '_shared', 'a1-tools.cjs'), 'product', 'stage', '--by', featureId, '--set', stage, '--dir', 'docs/product'];
  if (!Array.isArray(argv) || JSON.stringify(argv) !== JSON.stringify(want)) return fail('stage_argv');
  const rule = envRule(env, envNames);
  return rule ? fail(rule) : Object.freeze({ ok: true });
}

module.exports = {
  assertHomeConsistent,
  CLAUDE_TEMPLATE_FLAGS,
  guardArgv,
  guardStageArgv,
  writeChildContextLock,
  removeChildContextLock,
  createRunDir,
  openRunOutputs,
  openRunOutput,
  removeRunDir,
  spawnEnvSecrets,
  RUN_OUTPUTS,
};
