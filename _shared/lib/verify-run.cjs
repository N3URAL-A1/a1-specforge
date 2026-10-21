'use strict';

// `verify run` core (spec 017 FR-011..FR-014): resolve the project's commands,
// run each one as an argv array (no shell, timeout, output to a file so no
// buffer can overflow), parse counts from machine-readable reporters, and turn
// exit codes + counts into a fail-closed verdict. Only counts and exit codes
// are stored, never raw output (spec: no secrets in VERIFICATION.md).
// Wave 6 adds the group-kill runner below, the base snapshot compare, the single
// flaky re-run and the sha + command-hash result cache (rules in verify-base.cjs).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { gitRaw, headSha, splitNul, diffNames } = require('./verify-check.cjs');
const rep = require('./verify-reporters.cjs');
const vb = require('./verify-base.cjs');
const { loadEntries, clearedFingerprints } = require('./disposition-store.cjs');

const { VerifyError } = vb;

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_COMMANDS = 500;
const BASE_CANDIDATES = Object.freeze(['origin/main', 'main', 'master']);
const NPM_SCRIPTS = Object.freeze(['typecheck', 'build', 'test']);
const NPM_PLACEHOLDER_RE = /no test specified/i;
const KILL_GRACE_MS = 10 * 1000;
const GROUP_RUNNER_FLAG = '--group-runner';

function readJsonFile(file, what) {
  let st;
  try { st = fs.statSync(file); } catch (_e) { return null; }
  if (!st.isFile() || st.size > MAX_CONFIG_BYTES) throw new VerifyError('bad_config', `${what} is not a readable regular file under 1 MiB`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw new VerifyError('bad_config', `${what} is not valid JSON: ${e.message}`);
  }
}

function checkArgv(argv, where) {
  const ok = Array.isArray(argv) && argv.length > 0 && argv.every((t) => typeof t === 'string' && t !== '' && !t.includes('\0'));
  if (!ok) throw new VerifyError('bad_config', `${where}: argv must be a non-empty array of non-empty strings`);
  return argv.slice();
}

function checkTimeout(v, where) {
  if (v === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(v) || v < 1 || v > MAX_TIMEOUT_MS) throw new VerifyError('bad_config', `${where}: timeout_ms must be an integer in 1..${MAX_TIMEOUT_MS}`);
  return v;
}

function globToRegExp(seg) {
  return new RegExp(`^${seg.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
}

/** Expand `a/*\/run*.sh` (segments, `*` only, no `..`) to sorted repo-relative files. */
function expandEach(project, pattern) {
  const segs = pattern.split('/');
  if (segs.some((s) => s === '' || s === '..' || s === '.') || pattern.includes('\0')) throw new VerifyError('bad_config', `each: unsafe pattern ${JSON.stringify(pattern)}`);
  let level = [''];
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    const next = [];
    for (const base of level) {
      const entries = seg.includes('*')
        ? fs.readdirSync(path.join(project, base), { withFileTypes: true }).filter((d) => globToRegExp(seg).test(d.name))
        : [{ name: seg, isDirectory: () => true, isFile: () => true }];
      for (const d of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const rel = base === '' ? d.name : `${base}/${d.name}`;
        let st;
        try { st = fs.lstatSync(path.join(project, rel)); } catch (_e) { continue; }
        if (last ? st.isFile() : st.isDirectory()) next.push(rel);
      }
    }
    level = next;
  });
  return level;
}

function fromConfig(project, cfg) {
  const out = [];
  const defTimeout = checkTimeout(cfg.timeout_ms, 'verify.json');
  (Array.isArray(cfg.commands) ? cfg.commands : []).forEach((c, i) => {
    const argv = checkArgv(c && c.argv, `commands[${i}]`);
    if (c.reporter !== undefined && !rep.REPORTER_KINDS.includes(c.reporter)) throw new VerifyError('bad_config', `commands[${i}]: unknown reporter`);
    out.push({ id: typeof c.id === 'string' && c.id ? c.id : argv.join(' '), argv, kind: c.reporter || rep.detectKind(argv), viaScript: false, timeoutMs: checkTimeout(c.timeout_ms === undefined ? defTimeout : c.timeout_ms, `commands[${i}]`) });
  });
  if (typeof cfg.each === 'string') {
    const prefix = cfg.argv_prefix === undefined ? [] : checkArgv(cfg.argv_prefix, 'argv_prefix');
    for (const rel of expandEach(project, cfg.each)) {
      out.push({ id: rel, file: rel, argv: [...prefix, rel], kind: 'none', viaScript: false, timeoutMs: defTimeout });
    }
  }
  if (out.length > MAX_COMMANDS) throw new VerifyError('bad_config', `more than ${MAX_COMMANDS} commands`);
  return out;
}

function packageManager(project) {
  if (fs.existsSync(path.join(project, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(project, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function fromPackageJson(project) {
  const pkg = readJsonFile(path.join(project, 'package.json'), 'package.json');
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const pm = packageManager(project);
  return NPM_SCRIPTS.filter((n) => typeof scripts[n] === 'string' && !NPM_PLACEHOLDER_RE.test(scripts[n])).map((n) => ({
    id: `${pm} run ${n}`, argv: [pm, 'run', n], kind: n === 'test' ? rep.detectScriptKind(scripts[n]) : 'none', viaScript: true, timeoutMs: DEFAULT_TIMEOUT_MS,
  }));
}

function fromPytest(project) {
  const has = ['pyproject.toml', 'pytest.ini', 'tox.ini'].some((f) => fs.existsSync(path.join(project, f)));
  return has ? [{ id: 'python3 -m pytest -q', argv: ['python3', '-m', 'pytest', '-q'], kind: 'pytest', viaScript: false, timeoutMs: DEFAULT_TIMEOUT_MS }] : [];
}

/**
 * { commands, source, noTestsReason, requiresEnv, flakyBase }; throws VerifyError (exit 2).
 * @param {object|null} [config] parsed `.a1/verify.json` to use instead of the file in `project`
 *   (`null` = the merge-base has none); undefined reads the file in `project`.
 */
function resolveCommands(project, config) {
  const cfg = config === undefined ? readJsonFile(path.join(project, '.a1', 'verify.json'), '.a1/verify.json') : config;
  if (cfg !== null && (typeof cfg !== 'object' || Array.isArray(cfg))) throw new VerifyError('bad_config', '.a1/verify.json must be an object');
  const requiresEnv = cfg && Array.isArray(cfg.requires_env) ? cfg.requires_env.filter((n) => typeof n === 'string') : [];
  const flakyBase = cfg && Array.isArray(cfg.flaky_base) ? cfg.flaky_base.filter((n) => typeof n === 'string') : [];
  const reason = cfg && typeof cfg.no_tests_reason === 'string' && cfg.no_tests_reason !== '' ? cfg.no_tests_reason : null;
  const tries = [['verify.json', () => (cfg ? fromConfig(project, cfg) : [])], ['package.json', () => fromPackageJson(project)], ['pytest', () => fromPytest(project)]];
  for (const [source, get] of tries) {
    const commands = get();
    if (commands.length > 0) return { commands, source, noTestsReason: null, requiresEnv, flakyBase };
  }
  if (reason) return { commands: [], source: 'no_tests_reason', noTestsReason: reason, requiresEnv, flakyBase };
  throw new VerifyError('no_test_command', 'no .a1/verify.json command, package.json typecheck/build/test script or pytest config found; declare no_tests_reason in .a1/verify.json if the project has no tests');
}

function readCapped(file, tail) {
  let st;
  try { st = fs.statSync(file); } catch (_e) { return null; }
  if (!st.isFile()) return null;
  if (st.size <= rep.MAX_REPORT_BYTES) return fs.readFileSync(file, 'utf8');
  if (!tail) return null;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(rep.MAX_REPORT_BYTES);
    fs.readSync(fd, buf, 0, buf.length, st.size - buf.length);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

/**
 * Group runner (child process of `node verify-run.cjs --group-runner`): spawnSync cannot start a
 * process group, so this wrapper starts the command detached and, on timeout, SIGKILLs the whole
 * group so no grandchild of a `bash` suite survives. Spec on stdin, result JSON on stdout.
 */
function groupRunnerMain() {
  const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
  const emit = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
  const fd = fs.openSync(spec.stdoutFile, 'w');
  const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, shell: false, detached: true, stdio: ['ignore', fd, 'ignore'] });
  let timedOut = false;
  // SEC-10: the group dies on EVERY way out (timeout, normal exit, spawn error, a signal to this runner),
  // not only on timeout - a suite that returns 0 and leaves a background child must not leave it running.
  const killGroup = () => {
    if (!child.pid) return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch (_e) { /* group already gone */ }
  };
  process.on('exit', killGroup);
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { killGroup(); process.exit(1); });
  const timer = setTimeout(() => { timedOut = true; killGroup(); }, spec.timeoutMs);
  child.on('error', () => { clearTimeout(timer); emit({ spawnError: true }); });
  child.on('exit', (status, signal) => { clearTimeout(timer); emit({ status, signal, timedOut }); });
}

function spawnGroup(argv, cwd, stdoutFile, timeoutMs) {
  const spec = JSON.stringify({ argv, cwd, stdoutFile, timeoutMs });
  const r = spawnSync(process.execPath, [__filename, GROUP_RUNNER_FLAG], { input: spec, shell: false, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: timeoutMs + KILL_GRACE_MS, killSignal: 'SIGKILL' });
  try { return JSON.parse(r.stdout); } catch (_e) { return { spawnError: true }; }
}

function runCommand(cmd, cwd, tmp, label) {
  const reportFile = path.join(tmp, `report-${label}`);
  const stdoutFile = path.join(tmp, `stdout-${label}`);
  const argv = rep.injectFlags(cmd.kind, cmd.argv, reportFile, cmd.viaScript);
  const r = spawnGroup(argv, cwd, stdoutFile, cmd.timeoutMs);
  // FR-041: a command that cannot start (unknown runner) is an error of the tool, never a verdict.
  if (r.spawnError === true) throw new VerifyError('spawn_failed', `cannot start ${JSON.stringify(cmd.argv.join(' ').slice(0, 200))} (unknown runner or not executable) in ${path.basename(cwd)}`);
  const counts = rep.parseReport(cmd.kind, readCapped(reportFile, false), cmd.kind === 'node-test' ? readCapped(stdoutFile, true) : null, cwd);
  return {
    id: cmd.id, argv: cmd.argv, exit_code: typeof r.status === 'number' ? r.status : null, signal: r.signal || null, timed_out: r.timedOut === true,
    spawn_error: r.spawnError === true,
    passed: counts ? counts.passed : null, failed: counts ? counts.failed : null, skipped: counts ? counts.skipped : null,
    failed_ids: counts ? counts.failedIds : [],
  };
}

/** Reason a finished command fails the verdict, or null. FR-013 / FR-014. */
function commandReason(r, touchesSource) {
  if (r.timed_out) return 'timeout';
  if (r.spawn_error) return 'spawn_failed';
  if (r.signal !== null || r.exit_code !== 0) {
    if (r.failed === 0 || (r.signal !== null && r.failed === null)) return 'implausible_crash';
    return r.signal !== null ? 'signal' : 'command_failed';
  }
  if (r.failed !== null && r.failed > 0) return 'reported_failures';
  if (r.passed !== null && r.passed + r.failed === 0 && touchesSource) return 'zero_tests';
  return null;
}

function finishCommand(r, touchesSource) {
  const reason = commandReason(r, touchesSource);
  const ids = reason !== null && (r.failed === null || r.failed_ids.length === 0) ? [r.id] : r.failed_ids;
  return { ...r, spawn_error: undefined, failed_ids: ids, reason };
}

function isSourcePath(p) {
  return !(/\.md$/i.test(p) || p.startsWith('docs/') || p.startsWith('.a1/'));
}

function statusPaths(project) {
  const parts = splitNul(gitRaw(project, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])) || [];
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(parts[i].slice(3));
    if (/[RC]/.test(parts[i].slice(0, 2))) { i += 1; if (parts[i]) out.push(parts[i]); }
  }
  return out;
}

function resolveBase(project, ref) {
  if (ref !== undefined) return vb.resolveMergeBase(project, ref);
  for (const c of BASE_CANDIDATES) {
    const sha = gitRaw(project, ['rev-parse', '--verify', `${c}^{commit}`]);
    if (sha === null) continue;
    const mb = gitRaw(project, ['merge-base', sha.trim(), 'HEAD']);
    return (mb || sha).trim();
  }
  return null;
}

function changeSet(project, baseSha) {
  const committed = baseSha ? diffNames(project, baseSha, 'HEAD') || [] : [];
  return [...new Set([...committed, ...statusPaths(project)])];
}

function overall(commands, noTestsReason) {
  const reasons = [...new Set(commands.map((c) => c.reason).filter((r) => r !== null))];
  return { verdict: reasons.length === 0 ? 'pass' : 'fail', reason: reasons[0] || null, reasons, no_tests_reason: noTestsReason };
}

/** Base side (FR-015): { ids: Map<commandId, Set>, cache } from the cache or a git-archive snapshot of baseSha. */
function runBaseSide(project, plan, baseSha, hash, touches, tmp) {
  const cached = vb.readCache(project, baseSha, hash, plan.commands);
  const results = cached || vb.withSnapshot(project, baseSha, (dir) => Object.fromEntries(plan.commands.map((c, i) => [c.id, {
    raw: c.file && !fs.existsSync(path.join(dir, c.file)) ? { absent: true } : runCommand(c, dir, tmp, `b${i}`),
  }])));
  if (!cached) vb.writeCache(project, baseSha, hash, results);
  const ids = new Map(plan.commands.map((c) => [c.id, results[c.id].raw.absent ? new Set() : vb.idSet(finishCommand(results[c.id].raw, touches))]));
  const skipped = new Map(plan.commands.map((c) => [c.id, typeof results[c.id].raw.skipped === 'number' ? results[c.id].raw.skipped : null])); // absent-on-base: no count, not compared
  return { ids, skipped, cache: cached ? 'hit' : 'miss' };
}

/** Head side: cached or fresh first runs, retry once on failure, settle against base and flaky_base. */
function runHeadSide(project, plan, head, hash, ctx) {
  const clean = head !== null && vb.dirtyPaths(statusPaths(project)).length === 0;
  const cached = clean ? vb.readCache(project, head, hash, plan.commands) : null;
  const results = {};
  let ranLive = false;
  const settled = plan.commands.map((c, i) => {
    const entry = cached ? cached[c.id] : null;
    const raw = entry ? entry.raw : (ranLive = true, runCommand(c, project, ctx.tmp, `h${i}`));
    results[c.id] = { raw, retry: entry && entry.retry ? entry.retry : null };
    const retry = () => {
      if (!results[c.id].retry) { ranLive = true; results[c.id] = { raw, retry: runCommand(c, project, ctx.tmp, `r${i}`) }; }
      return finishCommand(results[c.id].retry, ctx.touches);
    };
    return vb.settle(finishCommand(raw, ctx.touches), retry, ctx.baseIds ? ctx.baseIds.get(c.id) : null, plan.flakyBase);
  });
  const stillClean = clean && vb.dirtyPaths(statusPaths(project)).length === 0;
  if (stillClean && ranLive) vb.writeCache(project, head, hash, results);
  return { settled, cache: cached ? (ranLive ? 'partial' : 'hit') : (clean ? 'miss' : 'dirty') };
}

/** Fingerprints of the committed `skip_increase` dispositions; an unreadable store is a config error (exit 2). */
function skipIncreaseDispositions(project) {
  try { return clearedFingerprints(loadEntries(project), 'skip_increase'); } catch (e) {
    throw new VerifyError('bad_config', e.message);
  }
}

function readLockfile(project, name) {
  try { return fs.readFileSync(path.join(project, name), 'utf8'); } catch (_e) { return null; }
}

/**
 * SEC-2 (spec 017 review): with --base the command set is the merge-base's `.a1/verify.json`.
 * @returns {{base: object|null, head: object|null, change: object|null, shrunkFlaky: string[]|null}}
 */
function baseConfigGuard(project, baseSha) {
  const baseText = gitRaw(project, ['show', `${baseSha}:${vb.CONFIG_FILE}`]);
  if (baseText !== null && Buffer.byteLength(baseText) > MAX_CONFIG_BYTES) throw new VerifyError('bad_config', 'the merge-base .a1/verify.json is larger than 1 MiB');
  const base = vb.parseVerifyJson(baseText, 'base');
  const head = readJsonFile(path.join(project, '.a1', 'verify.json'), '.a1/verify.json');
  const change = vb.configChange(base, head);
  const shrunk = change === null && base !== null && head !== null && Array.isArray(head.flaky_base)
    ? head.flaky_base.filter((x) => typeof x === 'string') : null;
  return { base, head, change, shrunkFlaky: shrunk };
}

/** Reasons: a changed config fails unless a committed, non-overturned `config_change` disposition names exactly this head content. */
function configChangeRecord(project, guard) {
  if (guard.change === null) return null;
  let cleared;
  try { cleared = clearedFingerprints(loadEntries(project), 'config_change'); } catch (e) { throw new VerifyError('bad_config', e.message); }
  return { fields: guard.change.fields, fingerprint: guard.change.fingerprint, dispositioned: cleared.has(guard.change.fingerprint) };
}

function withConfigReason(v) {
  return { ...v, verdict: 'fail', reason: 'verify_config_changed', reasons: ['verify_config_changed', ...v.reasons] };
}

const pairs = (commands, key) => commands.flatMap((c) => c[key].map((id) => ({ command: c.id, id })));

/**
 * @param {{project:string, base?:string, timeoutMs?:number}} opts
 * @returns {object} the verify_run record; throws VerifyError (exit 2)
 */
function runVerify(opts) {
  const project = fs.realpathSync(opts.project);
  const head = headSha(project);
  if (opts.base !== undefined && head === null) throw new VerifyError('base_unresolved', '--base needs a git repository with a commit');
  const baseSha = head ? resolveBase(project, opts.base) : null;
  const cfgGuard = opts.base !== undefined ? baseConfigGuard(project, baseSha) : null;
  const plan = resolveCommands(project, cfgGuard ? cfgGuard.base : undefined);
  const flakyBase = cfgGuard && cfgGuard.shrunkFlaky !== null ? cfgGuard.shrunkFlaky : plan.flakyBase;
  const missing = plan.requiresEnv.filter((n) => !process.env[n]);
  if (missing.length > 0) throw new VerifyError('env_missing', `required environment variable(s) not set: ${missing.join(', ')}`);
  const changed = head ? changeSet(project, baseSha) : [];
  const touches = changed.some(isSourcePath);
  const timed = { ...plan, flakyBase, commands: plan.commands.map((c) => (opts.timeoutMs ? { ...c, timeoutMs: opts.timeoutMs } : c)) };
  const hash = vb.commandHash(timed.commands, vb.envDigest((n) => readLockfile(project, n)));
  const baseHash = baseSha ? vb.commandHash(timed.commands, vb.envDigest((n) => gitRaw(project, ['show', `${baseSha}:${n}`]))) : hash;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-verify-'));
  const release = vb.cleanupOnExit(tmp);
  try {
    const base = opts.base !== undefined ? runBaseSide(project, timed, baseSha, baseHash, touches, tmp) : null;
    const side = runHeadSide(project, timed, head, hash, { tmp, touches, baseIds: base ? base.ids : null });
    const settled = base ? vb.applySkipIncrease(side.settled, base.skipped, skipIncreaseDispositions(project)) : side.settled;
    const configChanged = cfgGuard ? configChangeRecord(project, cfgGuard) : null;
    const verdict = overall(settled, plan.noTestsReason);
    return {
      ...(configChanged && !configChanged.dispositioned ? withConfigReason(verdict) : verdict), source: plan.source, head_sha: head, base_sha: baseSha,
      touches_source: touches, changed_files: changed.length, flaky: pairs(side.settled, 'flaky_ids'), pre_existing_red: pairs(side.settled, 'pre_existing_red_ids'),
      cache: { head: side.cache, base: base ? base.cache : 'none' }, ...(configChanged ? { config_changed: configChanged } : {}), commands: settled,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    release();
  }
}

if (require.main === module && process.argv[2] === GROUP_RUNNER_FLAG) groupRunnerMain();

module.exports = { VerifyError, runCommand, resolveCommands, expandEach, runVerify, commandReason, isSourcePath, MAX_TIMEOUT_MS };
