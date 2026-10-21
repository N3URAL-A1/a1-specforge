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
const { loadEntries, entriesAt, clearedFingerprints, fingerprintOf, isSelfReviewed } = require('./disposition-store.cjs');

const { VerifyError } = vb;

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_COMMANDS = 500;
const BASE_CANDIDATES = Object.freeze(['origin/main', 'main', 'master']);
const NPM_SCRIPTS = Object.freeze(['typecheck', 'build', 'test']);
const PYTEST_FILES = Object.freeze(['pyproject.toml', 'pytest.ini', 'tox.ini']);
const NPM_PLACEHOLDER_RE = /no test specified/i;
const KILL_GRACE_MS = 10 * 1000;
const GROUP_RUNNER_FLAG = '--group-runner';
// Vault variables never reach a suite: 18 suites forgot `unset A1_VAULT_ROOT` and leaked fixture paths into the real vault.
const SUITE_ENV_DROP = Object.freeze(['A1_VAULT_ROOT', 'A1_VAULT_WRITER_HOST', 'A1_HOST_ID']);

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

function checkEachPattern(pattern) {
  const segs = pattern.split('/');
  if (segs.some((s) => s === '' || s === '..' || s === '.') || pattern.includes('\0')) throw new VerifyError('bad_config', `each: unsafe pattern ${JSON.stringify(pattern)}`);
  return segs;
}

/** Regular files (modes 100644/100755) of a commit's tree, repo-relative, via `git ls-tree -r -z`; null when git cannot read it. */
function treeFiles(project, ref) {
  const out = gitRaw(project, ['ls-tree', '-r', '-z', ref]);
  if (out === null) return null;
  return out.split('\0').filter(Boolean).map((l) => /^100(?:644|755) blob [0-9a-f]+\t(.+)$/s.exec(l)).filter(Boolean).map((m) => m[1]);
}

/** Pure glob over a file list (`*` within one segment only). Sorted, de-duplicated. */
function matchEach(files, pattern) {
  const segs = checkEachPattern(pattern);
  const res = segs.map((seg) => (seg.includes('*') ? globToRegExp(seg) : null));
  const hit = files.filter((f) => {
    const parts = f.split('/');
    return parts.length === segs.length && parts.every((part, i) => (res[i] ? res[i].test(part) : part === segs[i]));
  });
  return [...new Set(hit)].sort();
}

/** Working-tree fallback for a directory that is not a git repository with a commit. */
function expandFromDisk(project, segs) {
  let level = [''];
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    const next = [];
    for (const base of level) {
      let entries;
      try { entries = seg.includes('*') ? fs.readdirSync(path.join(project, base), { withFileTypes: true }).map((d) => d.name).filter((n) => globToRegExp(seg).test(n)) : [seg]; } catch (_e) { continue; }
      for (const name of entries.sort()) {
        const rel = base === '' ? name : `${base}/${name}`;
        let st;
        try { st = fs.lstatSync(path.join(project, rel)); } catch (_e) { continue; }
        if (last ? st.isFile() : st.isDirectory()) next.push(rel);
      }
    }
    level = next;
  });
  return level;
}

/**
 * Expand `a/*\/run*.sh` (segments, `*` only, no `..`) to sorted repo-relative files of a COMMIT tree (default HEAD; spec 017
 * review round D: never the live tree, so an untracked or git-ignored file cannot join the suite set). Not a git repo with a
 * commit: the working tree.
 */
function expandEach(project, pattern, ref = 'HEAD') {
  const segs = checkEachPattern(pattern);
  const files = treeFiles(project, ref);
  return files === null ? expandFromDisk(project, segs) : matchEach(files, pattern);
}

/** The `each` commands of a config for the given files (one per file, id = path). */
function eachCommands(cfg, files) {
  const prefix = cfg.argv_prefix === undefined ? [] : checkArgv(cfg.argv_prefix, 'argv_prefix');
  const timeoutMs = checkTimeout(cfg.timeout_ms, 'verify.json');
  return files.map((rel) => ({ id: rel, file: rel, argv: [...prefix, rel], kind: 'none', viaScript: false, timeoutMs }));
}

function fromConfig(project, cfg, ref) {
  const out = [];
  const defTimeout = checkTimeout(cfg.timeout_ms, 'verify.json');
  (Array.isArray(cfg.commands) ? cfg.commands : []).forEach((c, i) => {
    const argv = checkArgv(c && c.argv, `commands[${i}]`);
    if (c.reporter !== undefined && !rep.REPORTER_KINDS.includes(c.reporter)) throw new VerifyError('bad_config', `commands[${i}]: unknown reporter`);
    out.push({ id: typeof c.id === 'string' && c.id ? c.id : argv.join(' '), argv, kind: c.reporter || rep.detectKind(argv), viaScript: false, timeoutMs: checkTimeout(c.timeout_ms === undefined ? defTimeout : c.timeout_ms, `commands[${i}]`) });
  });
  if (typeof cfg.each === 'string') {
    out.push(...eachCommands(cfg, expandEach(project, cfg.each, ref)));
  }
  if (out.length > MAX_COMMANDS) throw new VerifyError('bad_config', `more than ${MAX_COMMANDS} commands`);
  return out;
}

/** Where the autodetect files are read from: the working tree (no --base) or a commit (--base: base and HEAD, never the live tree). */
function fsSource(project) {
  return { ref: 'HEAD', has: (n) => fs.existsSync(path.join(project, n)), readJson: (n) => readJsonFile(path.join(project, n), n) };
}

function gitSource(project, sha) {
  return {
    ref: sha,
    has: (n) => gitRaw(project, ['cat-file', '-e', `${sha}:${n}`]) !== null,
    readJson: (n) => {
      const text = gitRaw(project, ['show', `${sha}:${n}`]);
      if (text === null) return null;
      if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new VerifyError('bad_config', `${n} at ${sha.slice(0, 12)} is larger than 1 MiB`);
      try { return JSON.parse(text); } catch (e) { throw new VerifyError('bad_config', `${n} at ${sha.slice(0, 12)} is not valid JSON: ${e.message}`); }
    },
  };
}

function packageManager(src) {
  if (src.has('pnpm-lock.yaml')) return 'pnpm';
  if (src.has('yarn.lock')) return 'yarn';
  return 'npm';
}

// `detect` carries what the argv does not: the script body (npm run test runs whatever package.json says) - compared base vs head.
function fromPackageJson(src) {
  const pkg = src.readJson('package.json');
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const pm = packageManager(src);
  return NPM_SCRIPTS.filter((n) => typeof scripts[n] === 'string' && !NPM_PLACEHOLDER_RE.test(scripts[n])).map((n) => ({
    id: `${pm} run ${n}`, argv: [pm, 'run', n], kind: n === 'test' ? rep.detectScriptKind(scripts[n]) : 'none', viaScript: true, timeoutMs: DEFAULT_TIMEOUT_MS, detect: scripts[n],
  }));
}

function fromPytest(src) {
  const found = PYTEST_FILES.filter((f) => src.has(f));
  return found.length > 0 ? [{ id: 'python3 -m pytest -q', argv: ['python3', '-m', 'pytest', '-q'], kind: 'pytest', viaScript: false, timeoutMs: DEFAULT_TIMEOUT_MS, detect: found.join(',') }] : [];
}

/** The autodetected command set of a tree (package.json first, then pytest); [] when none. */
function autodetect(src) {
  const pkg = fromPackageJson(src);
  return pkg.length > 0 ? pkg : fromPytest(src);
}

function detectSignature(commands) {
  return vb.canon(commands.map((c) => [c.id, c.argv, c.kind, c.detect === undefined ? null : c.detect]));
}

/**
 * { commands, source, noTestsReason, requiresEnv, flakyBase }; throws VerifyError (exit 2).
 * @param {object|null} [config] parsed `.a1/verify.json` to use instead of the file in `project`
 *   (`null` = the merge-base has none); undefined reads the file in `project`.
 * @param {{has: Function, readJson: Function}} [src] where package.json / pytest files are read from (default: the files in `project`)
 */
function resolveCommands(project, config, src = fsSource(project)) {
  const cfg = config === undefined ? readJsonFile(path.join(project, '.a1', 'verify.json'), '.a1/verify.json') : config;
  if (cfg !== null && (typeof cfg !== 'object' || Array.isArray(cfg))) throw new VerifyError('bad_config', '.a1/verify.json must be an object');
  const requiresEnv = cfg && Array.isArray(cfg.requires_env) ? cfg.requires_env.filter((n) => typeof n === 'string') : [];
  const flakyBase = cfg && Array.isArray(cfg.flaky_base) ? cfg.flaky_base.filter((n) => typeof n === 'string') : [];
  const reason = cfg && typeof cfg.no_tests_reason === 'string' && cfg.no_tests_reason !== '' ? cfg.no_tests_reason : null;
  const tries = [['verify.json', () => (cfg ? fromConfig(project, cfg, src.ref) : [])], ['package.json', () => fromPackageJson(src)], ['pytest', () => fromPytest(src)]];
  for (const [source, get] of tries) {
    const commands = get();
    if (commands.length > 0) return { commands, source, noTestsReason: null, requiresEnv, flakyBase, eachCfg: source === 'verify.json' && typeof cfg.each === 'string' ? cfg : null };
  }
  if (reason) return { commands: [], source: 'no_tests_reason', noTestsReason: reason, requiresEnv, flakyBase, eachCfg: null };
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
function suiteEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !SUITE_ENV_DROP.includes(k)));
}

function groupRunnerMain() {
  const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
  const emit = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
  const fd = fs.openSync(spec.stdoutFile, 'w');
  const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: suiteEnv(process.env), shell: false, detached: true, stdio: ['ignore', fd, 'ignore'] });
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
function runBaseSide(project, plan, baseSha, hash, touches, tmp, noCache) {
  const cached = noCache ? null : vb.readCache(project, baseSha, hash, plan.commands);
  const results = cached || vb.withSnapshot(project, baseSha, (dir) => Object.fromEntries(plan.commands.map((c, i) => [c.id, {
    raw: c.file && !fs.existsSync(path.join(dir, c.file)) ? { absent: true } : runCommand(c, dir, tmp, `b${i}`),
  }])));
  if (!cached && !noCache) vb.writeCache(project, baseSha, hash, results);
  const ids = new Map(plan.commands.map((c) => [c.id, results[c.id].raw.absent ? new Set() : vb.idSet(finishCommand(results[c.id].raw, touches))]));
  const skipped = new Map(plan.commands.map((c) => [c.id, typeof results[c.id].raw.skipped === 'number' ? results[c.id].raw.skipped : null])); // absent-on-base: no count, not compared
  return { ids, skipped, cache: noCache ? 'off' : (cached ? 'hit' : 'miss') };
}

/** Head side: cached or fresh first runs, retry once on failure, settle against base and flaky_base. ctx.cwd: where the commands run (a HEAD snapshot with --base). */
function runHeadSide(project, plan, head, hash, ctx) {
  const clean = !ctx.noCache && head !== null && vb.dirtyPaths(statusPaths(project)).length === 0;
  const cached = clean ? vb.readCache(project, head, hash, plan.commands) : null;
  const results = {};
  let ranLive = false;
  const settled = plan.commands.map((c, i) => {
    const entry = cached ? cached[c.id] : null;
    const raw = entry ? entry.raw : (ranLive = true, runCommand(c, ctx.cwd, ctx.tmp, `h${i}`));
    results[c.id] = { raw, retry: entry && entry.retry ? entry.retry : null };
    const retry = () => {
      if (!results[c.id].retry) { ranLive = true; results[c.id] = { raw, retry: runCommand(c, ctx.cwd, ctx.tmp, `r${i}`) }; }
      return finishCommand(results[c.id].retry, ctx.touches);
    };
    return vb.settle(finishCommand(raw, ctx.touches), retry, ctx.baseIds ? (ctx.baseIds.get(c.id) || new Set()) : null, plan.flakyBase);
  });
  const stillClean = clean && vb.dirtyPaths(statusPaths(project)).length === 0;
  if (stillClean && ranLive) vb.writeCache(project, head, hash, results);
  return { settled, cache: ctx.noCache ? 'off' : (cached ? (ranLive ? 'partial' : 'hit') : (clean ? 'miss' : 'dirty')) };
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

/** `.a1/verify.json` of a commit (null = none there); size-capped and parsed like the working-tree file. */
function configAt(project, sha, which) {
  const text = gitRaw(project, ['show', `${sha}:${vb.CONFIG_FILE}`]);
  if (text !== null && Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new VerifyError('bad_config', `the ${which} .a1/verify.json is larger than 1 MiB`);
  return vb.parseVerifyJson(text, which);
}

/**
 * SEC-2 (spec 017 review): with --base the command set is the merge-base's, and both sides are read from commits
 * (base and HEAD), never from the live working tree.
 * @returns {{base: object|null, head: object|null, change: object|null, shrunkFlaky: string[]|null}}
 */
function baseConfigGuard(project, baseSha, headSha_) {
  const base = configAt(project, baseSha, 'base');
  const head = configAt(project, headSha_, 'head');
  const change = vb.configChange(base, head);
  const shrunk = change === null && base !== null && head !== null && Array.isArray(head.flaky_base)
    ? head.flaky_base.filter((x) => typeof x === 'string') : null;
  return { base, head, change, shrunkFlaky: shrunk };
}

/**
 * Which command set judges a --base run, and whether the base side can be compared.
 * Base resolves a set: that set, plus a forced `change` when the autodetected set (script bodies included) differs at HEAD (Q23).
 * Base resolves none (no verify.json, nothing autodetectable): the HEAD set runs, there is nothing to compare against,
 * and the change is forced because the PR itself supplies what judges it.
 * @returns {{plan: object, compareBase: boolean, change: {fields: string[], fingerprint: string}|null}}
 */
function selectBasePlan(project, baseSha, headSha_, guard) {
  const baseSrc = gitSource(project, baseSha);
  const headSrc = gitSource(project, headSha_);
  let basePlan = null;
  try { basePlan = resolveCommands(project, guard.base, baseSrc); } catch (e) {
    if (!(e instanceof VerifyError) || e.reason !== 'no_test_command') throw e;
  }
  const forced = (commands) => ({ fields: ['commands'], fingerprint: fingerprintOf(vb.CONFIG_RULE, vb.CONFIG_FILE, detectSignature(commands)) });
  if (basePlan === null) {
    const plan = resolveCommands(project, guard.head, headSrc);
    return { plan, compareBase: false, change: guard.change || forced(plan.commands) };
  }
  if (guard.change === null && basePlan.source !== 'verify.json') {
    const headAuto = autodetect(headSrc);
    const sig = detectSignature(headAuto);
    if (sig !== detectSignature(autodetect(baseSrc))) return { plan: basePlan, compareBase: true, change: { fields: ['autodetect'], fingerprint: fingerprintOf(vb.CONFIG_RULE, vb.CONFIG_FILE, sig) } };
  }
  return { plan: basePlan, compareBase: true, change: guard.change };
}

/**
 * Reasons: a changed command set fails unless a COMMITTED (store at HEAD), UPHELD `config_change` disposition names exactly
 * this head content. A pending, overturned or working-tree-only entry clears nothing (merge-check blocks a pending one anyway).
 */
function upheldConfigFingerprints(project, headSha_) {
  try { return new Set(entriesAt(project, headSha_).filter((e) => e.kind === 'config_change' && e.review === 'upheld' && !isSelfReviewed(e)).map((e) => e.fingerprint)); } catch (e) { throw new VerifyError('bad_config', e.message); }
}

function configChangeRecord(project, change, headSha_) {
  if (change === null) return null;
  return { fields: change.fields, fingerprint: change.fingerprint, dispositioned: upheldConfigFingerprints(project, headSha_).has(change.fingerprint) };
}

function withReasons(v, extra) {
  return extra.length === 0 ? v : { ...v, verdict: 'fail', reason: extra[0], reasons: [...extra, ...v.reasons.filter((r) => !extra.includes(r))] };
}

/**
 * suite_removed (review round D): `each` suites the base plan names that the HEAD tree no longer has. Cleared like
 * verify_config_changed: only by a committed, upheld, not self-reviewed `config_change` disposition (rule verify-config,
 * file .a1/verify.json) whose text is canon({suite_removed: <sorted removed ids>}) - the fingerprint covers exactly that id set.
 */
function suiteRemovedRecord(project, ids, headSha_) {
  if (ids.length === 0) return null;
  const text = vb.canon({ suite_removed: ids });
  const fingerprint = fingerprintOf(vb.CONFIG_RULE, vb.CONFIG_FILE, text);
  return { ids, fingerprint, text, dispositioned: upheldConfigFingerprints(project, headSha_).has(fingerprint) };
}

/**
 * The command set that runs on HEAD. Without a compare (no --base) it is the plan itself. With --base the plan came from the
 * merge-base tree; its `each` pattern is re-expanded on the HEAD tree: suites HEAD added run there, suites the base had and
 * HEAD lost are returned in `removed` (and not run).
 * @returns {{commands: object[], removed: string[]}}
 */
function headCommands(project, plan, headSha_) {
  if (headSha_ === null || plan.eachCfg === null) return { commands: plan.commands, removed: [] };
  const headEach = eachCommands(plan.eachCfg, expandEach(project, plan.eachCfg.each, headSha_));
  const baseIds = new Set(plan.commands.filter((c) => c.file).map((c) => c.id));
  const headIds = new Set(headEach.map((c) => c.id));
  return {
    commands: [...plan.commands.filter((c) => !c.file), ...headEach],
    removed: [...baseIds].filter((id) => !headIds.has(id)).sort(),
  };
}

const pairs = (commands, key) => commands.flatMap((c) => c[key].map((id) => ({ command: c.id, id })));

/**
 * @param {{project:string, base?:string, timeoutMs?:number, noCache?:boolean}} opts noCache: never read or write the
 *   sha + command-hash result cache (merge-check sets it: a cache file is writable by the code under test)
 * @returns {object} the verify_run record; throws VerifyError (exit 2)
 */
function runVerify(opts) {
  const project = fs.realpathSync(opts.project);
  const head = headSha(project);
  if (opts.base !== undefined && head === null) throw new VerifyError('base_unresolved', '--base needs a git repository with a commit');
  const baseSha = head ? resolveBase(project, opts.base) : null;
  const cfgGuard = opts.base !== undefined ? baseConfigGuard(project, baseSha, head) : null;
  const sel = cfgGuard ? selectBasePlan(project, baseSha, head, cfgGuard) : { plan: resolveCommands(project), compareBase: false, change: null };
  const plan = sel.plan;
  const flakyBase = cfgGuard && sel.compareBase && cfgGuard.shrunkFlaky !== null ? cfgGuard.shrunkFlaky : plan.flakyBase;
  const missing = plan.requiresEnv.filter((n) => !process.env[n]);
  if (missing.length > 0) throw new VerifyError('env_missing', `required environment variable(s) not set: ${missing.join(', ')}`);
  const changed = head ? changeSet(project, baseSha) : [];
  const touches = changed.some(isSourcePath);
  const withTimeout = (list) => list.map((c) => (opts.timeoutMs ? { ...c, timeoutMs: opts.timeoutMs } : c));
  const timed = { ...plan, flakyBase, commands: withTimeout(plan.commands) };
  const headSet = headCommands(project, plan, sel.compareBase && head ? head : null);
  const headTimed = { ...timed, commands: withTimeout(headSet.commands) };
  const hash = vb.commandHash(headTimed.commands, vb.envDigest((n) => readLockfile(project, n)));
  const baseHash = baseSha ? vb.commandHash(timed.commands, vb.envDigest((n) => gitRaw(project, ['show', `${baseSha}:${n}`]))) : hash;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-verify-'));
  const release = vb.cleanupOnExit(tmp);
  try {
    const base = sel.compareBase ? runBaseSide(project, timed, baseSha, baseHash, touches, tmp, opts.noCache === true) : null;
    const runHead = (cwd) => runHeadSide(project, headTimed, head, hash, { tmp, touches, baseIds: base ? base.ids : null, cwd, noCache: opts.noCache === true });
    // --base: HEAD runs from a git-archive snapshot like the base side, so git-ignored local files cannot change the verdict.
    const side = opts.base !== undefined ? vb.withSnapshot(project, head, runHead, 'head') : runHead(project);
    const settled = base ? vb.applySkipIncrease(side.settled, base.skipped, skipIncreaseDispositions(project)) : side.settled;
    const configChanged = configChangeRecord(project, sel.change, head);
    const removed = suiteRemovedRecord(project, headSet.removed, head);
    const extra = [...(configChanged && !configChanged.dispositioned ? ['verify_config_changed'] : []), ...(removed && !removed.dispositioned ? ['suite_removed'] : [])];
    return {
      ...withReasons(overall(settled, plan.noTestsReason), extra), source: plan.source, head_sha: head, base_sha: baseSha,
      touches_source: touches, changed_files: changed.length, flaky: pairs(side.settled, 'flaky_ids'), pre_existing_red: pairs(side.settled, 'pre_existing_red_ids'),
      cache: { head: side.cache, base: base ? base.cache : 'none' }, ...(configChanged ? { config_changed: configChanged } : {}), ...(removed ? { suite_removed: removed } : {}), commands: settled,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    release();
  }
}

if (require.main === module && process.argv[2] === GROUP_RUNNER_FLAG) groupRunnerMain();

module.exports = { VerifyError, runCommand, resolveCommands, expandEach, runVerify, commandReason, isSourcePath, MAX_TIMEOUT_MS };
