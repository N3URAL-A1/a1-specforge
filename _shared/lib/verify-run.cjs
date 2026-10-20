'use strict';

// `verify run` core (spec 017 FR-011..FR-014): resolve the project's commands,
// run each one as an argv array (no shell, timeout, output to a file so no
// buffer can overflow), parse counts from machine-readable reporters, and turn
// exit codes + counts into a fail-closed verdict. Only counts and exit codes
// are stored, never raw output (spec: no secrets in VERIFICATION.md).
// Base snapshot, flaky re-run and the result cache are wave 6.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { gitRaw, headSha, splitNul, diffNames } = require('./verify-check.cjs');
const rep = require('./verify-reporters.cjs');

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_COMMANDS = 500;
const BASE_CANDIDATES = Object.freeze(['origin/main', 'main', 'master']);
const NPM_SCRIPTS = Object.freeze(['typecheck', 'build', 'test']);
const NPM_PLACEHOLDER_RE = /no test specified/i;

class VerifyError extends Error {
  constructor(reason, message) { super(message || reason); this.reason = reason; }
}

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
      out.push({ id: rel, argv: [...prefix, rel], kind: 'none', viaScript: false, timeoutMs: defTimeout });
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

/** { commands, source, noTestsReason, requiresEnv }; throws VerifyError (exit 2). */
function resolveCommands(project) {
  const cfg = readJsonFile(path.join(project, '.a1', 'verify.json'), '.a1/verify.json');
  if (cfg !== null && (typeof cfg !== 'object' || Array.isArray(cfg))) throw new VerifyError('bad_config', '.a1/verify.json must be an object');
  const requiresEnv = cfg && Array.isArray(cfg.requires_env) ? cfg.requires_env.filter((n) => typeof n === 'string') : [];
  const reason = cfg && typeof cfg.no_tests_reason === 'string' && cfg.no_tests_reason !== '' ? cfg.no_tests_reason : null;
  const tries = [['verify.json', () => (cfg ? fromConfig(project, cfg) : [])], ['package.json', () => fromPackageJson(project)], ['pytest', () => fromPytest(project)]];
  for (const [source, get] of tries) {
    const commands = get();
    if (commands.length > 0) return { commands, source, noTestsReason: null, requiresEnv };
  }
  if (reason) return { commands: [], source: 'no_tests_reason', noTestsReason: reason, requiresEnv };
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

function runCommand(cmd, project, tmp, idx) {
  const reportFile = path.join(tmp, `report-${idx}`);
  const stdoutFile = path.join(tmp, `stdout-${idx}`);
  const argv = rep.injectFlags(cmd.kind, cmd.argv, reportFile, cmd.viaScript);
  const fd = fs.openSync(stdoutFile, 'w');
  let r;
  try {
    r = spawnSync(argv[0], argv.slice(1), { cwd: project, shell: false, stdio: ['ignore', fd, 'ignore'], timeout: cmd.timeoutMs, killSignal: 'SIGKILL' });
  } finally { fs.closeSync(fd); }
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  const counts = rep.parseReport(cmd.kind, readCapped(reportFile, false), cmd.kind === 'node-test' ? readCapped(stdoutFile, true) : null, project);
  return {
    id: cmd.id, argv: cmd.argv, exit_code: typeof r.status === 'number' ? r.status : null, signal: r.signal || null, timed_out: timedOut,
    spawn_error: !!(r.error && !timedOut),
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
  const failedIds = reason !== null && r.failed === null ? [r.id] : r.failed_ids;
  return { ...r, spawn_error: undefined, failed_ids: failedIds, reason };
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
  const cands = ref === undefined ? BASE_CANDIDATES : [ref];
  if (ref !== undefined && (ref.startsWith('-') || /[\0\s]/.test(ref))) throw new VerifyError('base_unresolved', `unsafe --base ${JSON.stringify(ref)}`);
  for (const c of cands) {
    const sha = gitRaw(project, ['rev-parse', '--verify', `${c}^{commit}`]);
    if (sha === null) continue;
    const mb = gitRaw(project, ['merge-base', sha.trim(), 'HEAD']);
    return (mb || sha).trim();
  }
  if (ref !== undefined) throw new VerifyError('base_unresolved', `--base ${ref} does not resolve to a commit`);
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

/**
 * @param {{project:string, base?:string, timeoutMs?:number}} opts
 * @returns {object} the verify_run record; throws VerifyError (exit 2)
 */
function runVerify(opts) {
  const project = fs.realpathSync(opts.project);
  const plan = resolveCommands(project);
  const missing = plan.requiresEnv.filter((n) => !process.env[n]);
  if (missing.length > 0) throw new VerifyError('env_missing', `required environment variable(s) not set: ${missing.join(', ')}`);
  const head = headSha(project);
  const baseSha = head ? resolveBase(project, opts.base) : null;
  const changed = head ? changeSet(project, baseSha) : [];
  const touchesSource = changed.some(isSourcePath);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-verify-'));
  try {
    const commands = plan.commands
      .map((c) => (opts.timeoutMs ? { ...c, timeoutMs: opts.timeoutMs } : c))
      .map((c, i) => finishCommand(runCommand(c, project, tmp, i), touchesSource));
    return { ...overall(commands, plan.noTestsReason), source: plan.source, head_sha: head, base_sha: baseSha, touches_source: touchesSource, changed_files: changed.length, commands };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { VerifyError, resolveCommands, expandEach, runVerify, commandReason, isSourcePath, MAX_TIMEOUT_MS };
