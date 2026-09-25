'use strict';

// ---------------------------------------------------------------------------
// xprov-run — hand the VENDORED runner a snapshot under the dedicated Codex
// home, with an exact argv and a minimal environment, and detect any write it
// makes (spec 009-cross-provider-review-gate, Wave 5; FR-011, FR-014 env,
// FR-015, FR-024; amended 2026-09-24 after a1-samuel-security's W5 review and
// a1-reinhard-reviewer's W6 review).
//
//   a1-tools xprov run --mode review|inspect --snapshot <dir> --plan <abs PLAN.md>
//     --phase <name> --gate <id> [--wave N] [--round N] [--lane <id>]
//     [--base <sha>] [--resume <result.json> [--feedback <file>]]
//     [--timeout N] [--work-path <dir>] [--no-log]
//
// Order: usage checks → permitCheck (never a flag) → runner pin check
// (`checkRunnerPin()`; mismatch = runner_failed, no spawn) → artifacts dir
// 0700 → tripwire baseline in a mktemp file → spawnSync python3
// <vendoredRunnerPath()> … with an ALLOWLISTED environment (PATH, HOME,
// TMPDIR, LANG, LC_*, TERM, USER, SHELL) plus CODEX_HOME = codexHome(),
// bounded by timeout + grace and SIGKILL → baseline recomputed.
//
// The baseline covers: `git status --porcelain --untracked-files=all` of the
// primary checkout, $WORK_PATH and the snapshot; the `.git/` metadata that a
// hostile reviewer could plant (config, hooks/*, info/*, the core.hooksPath
// target) for checkout and $WORK_PATH; and EVERY file of the dedicated Codex
// home except Codex's own runtime dirs (a new AGENTS.md there would be a
// persistent prompt injection for all future reviews). Any delta is
// `fail/tripwire`: result discarded, snapshot delta reverted (checkout -- . &&
// clean -fdq on the SNAPSHOT only), BLOCKER note in XREVIEW.md, checkout and
// worktree untouched.
//
// The run directory is taken from the runner's stdout header ONLY when it lies
// under the artifacts dir and is named `claudex-*` — a header pointing at the
// checkout can never make a1 delete it. A runner exit ≠ 0, a timeout, or a
// missing result.json is `runner_failed` (stderr tail as reason_detail; run dir
// removed). result.json and reply.txt above MAX_RESULT_BYTES are `malformed`
// (run dir kept). A clean run is secret-filtered; a hit is `secret_in_output`
// and the run dir is KEPT for the user. Exit 0 only when the runner exited 0,
// the tripwire is clean and the output is secret-free.
//
// a1 writes PLAN-REVIEW-LOG.md itself (the runner has no --log): one appended
// entry per run (`verdict: pending` on success), suppressed by `--no-log`
// when the gate driver writes the single entry per call. Repo-local
// `.codex/config.toml` / `AGENTS.md` in the reviewed commit are stripped from
// the snapshot working tree by `xprov snapshot`; run logs their presence (git
// ls-files) in the log and as an XREVIEW note.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseFlags, repoRoot, assertSafeSegment, writeTextAtomic, nowIso } = require('./io.cjs');
const { parseRegistryIds } = require('./gate-ids.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
// Shared helpers — one definition each, in xprov-common.cjs.
const { REGISTRY_PATH, LANE_RE, sha256, isDir, isFile, gitOut, writeStdoutSync, parsePositive } = C;
const tail = C.stderrTail;
const none = C.oneLine;
const { ensureArtifactsDir, isUnder } = require('./xprov-artifacts.cjs');
const { appendXreviewNote } = require('./xprov-normalize.cjs');
const { filterOutput } = require('./xprov-filter.cjs');
const { permitCheck } = require('./xprov-permit.cjs');
const { SNAP_PREFIX } = require('./xprov-snapshot.cjs');

const NO_LOG_FLAG = 'no-log';
const FLAGS = Object.freeze({
  mode: 'str', snapshot: 'str', plan: 'str', phase: 'str', gate: 'str', wave: 'str', round: 'str', lane: 'str',
  base: 'str', resume: 'str', feedback: 'str', timeout: 'str', 'work-path': 'str', [NO_LOG_FLAG]: 'bool',
});
const DEFAULT_TIMEOUT_SECONDS = 600; // the runner's own default
const SPAWN_GRACE_SECONDS = 60; // the runner kills its child at --timeout; a1 kills the runner a minute later
const RUNNER_MAX_BUFFER = 64 * 1024 * 1024;
const LOG_FILE = 'PLAN-REVIEW-LOG.md';
// Shared with xprov-gate.cjs (it imports this constant) — one header text, one owner.
const LOG_HEADER = '# PLAN-REVIEW-LOG — cross-provider runner calls\n\nWritten by `a1-tools xprov run` and `a1-tools xprov gate`; one entry per call, newest last.\n';
const RUNNER_MODES = new Set(X.RUNNER_MODES);
const RUN_DIR_PREFIX = 'claudex-';
// Environment the runner gets — nothing else (Samuel W5 MAJOR 2: OPENAI_BASE_URL
// would redirect the review, PYTHONPATH would bypass the pin, *_PROXY, GIT_*, …).
const ALLOWED_ENV = Object.freeze(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TERM', 'USER', 'SHELL']);
const ALLOWED_ENV_PREFIX = 'LC_';
// Codex runtime dirs inside the dedicated home that change on every run and are not part of its configuration.
const CODEX_RUNTIME_DIRS = Object.freeze(['cache', 'sessions', 'plugins', 'skills', 'tmp', 'shell_snapshots', 'thread-writer-locks', 'log']);
// Runtime FILES Codex writes into the home ROOT on every real run (measured
// 2026-09-25 in ~/.codex-a1-review after five live runs): state databases and
// their WAL/SHM siblings, the models cache, the install id, history, version.
// Everything else in the root is configuration and trips — deliberately including
// a REGULAR `auth.json`: only the symlink form is safe (its link text is hashed;
// a token refresh through a symlink changes the target, not the link), a regular
// auth.json refreshed by Codex mid-review is reported as a tripwire on purpose.
const CODEX_RUNTIME_FILES = Object.freeze(['.sandbox_migration', 'installation_id', 'models_cache.json', 'history.jsonl', 'version.json']);
const CODEX_RUNTIME_FILE_RE = /\.sqlite(-shm|-wal)?$/;
const isCodexRuntimeFile = (name) => CODEX_RUNTIME_FILES.includes(name) || CODEX_RUNTIME_FILE_RE.test(name);
const GIT_META_DIRS = Object.freeze(['hooks', 'info']);
const REPO_LOCAL_TRACKED = Object.freeze({ repo_local_codex_config: '.codex/config.toml', agents_md: 'AGENTS.md', agents_override_md: 'AGENTS.override.md', codex_hooks: '.codex/hooks' });

// ---------- helpers ----------

// Usage errors are thrown as typed A1_INPUT errors; the facade prints `error: …` and exits 2.
const usage = (msg) => C.usageThrow('run', msg);
const fileSize = (p) => { try { return fs.statSync(p).size; } catch (_e) { return -1; } };

function porcelain(repo) {
  const out = gitOut(['-C', repo, 'status', '--porcelain', '--untracked-files=all']);
  return out === null ? '<git status failed>' : out;
}

// ---------- argument resolution ----------

function resolveArgs(args) {
  const flags = parseFlags(args, FLAGS);
  const stray = flags._.filter((a) => String(a).startsWith('--'));
  if (stray.length) usage(`unknown flag ${stray[0]}`);
  if (flags._.length) usage(`unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  if (!RUNNER_MODES.has(flags.mode)) usage(`--mode must be one of ${X.RUNNER_MODES.join('|')} (got ${JSON.stringify(String(flags.mode).slice(0, 40))}); build is never used`);
  if (flags.mode === 'inspect' && !flags.base) usage('--mode inspect requires --base <sha>');
  if (flags.mode === 'inspect' && flags.resume) usage('--mode inspect is always a fresh session: --resume is not allowed');
  if (flags.feedback && !flags.resume) usage('--feedback requires --resume');
  if (flags.base && !/^[0-9a-fA-F]{7,40}$/.test(flags.base)) usage('--base must be a commit sha (7-40 hex chars)');
  if (!flags.plan) usage('--plan <abs PLAN.md> is required');
  if (!path.isAbsolute(flags.plan)) usage(`--plan must be an absolute path (got ${JSON.stringify(flags.plan.slice(0, 80))})`);
  if (!isFile(flags.plan)) usage(`--plan not found: ${flags.plan}`);
  if (!flags.snapshot) usage('--snapshot <dir> is required');
  const snapshot = path.resolve(flags.snapshot);
  if (!isDir(snapshot) || !isDir(path.join(snapshot, '.git')) || !path.basename(snapshot).startsWith(SNAP_PREFIX)) usage(`--snapshot is not a snapshot clone: ${snapshot}`);
  if (!flags.phase) usage('--phase is required');
  const phase = assertSafeSegment(flags.phase, '--phase');
  const root = repoRoot();
  const phaseDir = path.join(root, '.a1', 'phases', phase);
  if (!isDir(phaseDir)) usage(`phase dir not found: ${phaseDir}`);
  if (!flags.gate) usage('--gate is required');
  let ids;
  try { ids = parseRegistryIds(fs.readFileSync(REGISTRY_PATH, 'utf8')); } catch (_e) { usage(`registry unreadable: ${REGISTRY_PATH}`); }
  if (!ids.includes(flags.gate)) usage(`--gate ${JSON.stringify(String(flags.gate).slice(0, 80))} is not a registered gate id`);
  if (flags.lane !== undefined && !LANE_RE.test(String(flags.lane))) usage(`--lane must match ${LANE_RE} (got ${JSON.stringify(String(flags.lane).slice(0, 80))})`);
  if (flags.resume && !isFile(flags.resume)) usage(`--resume not found: ${flags.resume}`);
  if (flags.feedback && !isFile(flags.feedback)) usage(`--feedback not found: ${flags.feedback}`);
  const workPath = flags['work-path'] ? path.resolve(flags['work-path']) : root;
  if (!isDir(workPath)) usage(`--work-path is not a directory: ${workPath}`);
  return {
    mode: flags.mode, snapshot, plan: flags.plan, phase, phaseDir, root, workPath, gate: flags.gate,
    wave: flags.wave === undefined ? null : parsePositive(flags.wave, 'wave'),
    round: flags.round === undefined ? 1 : parsePositive(flags.round, 'round'),
    lane: flags.lane === undefined ? null : flags.lane, base: flags.base || null,
    resume: flags.resume ? path.resolve(flags.resume) : null, feedback: flags.feedback ? path.resolve(flags.feedback) : null,
    timeout: flags.timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : parsePositive(flags.timeout, 'timeout'),
    noLog: flags[NO_LOG_FLAG] === true, ts: nowIso(),
  };
}

// ---------- argv + env (FR-011, FR-014, FR-024) ----------

function buildArgv(ctx, artifactsDir) {
  const argv = ['python3', X.vendoredRunnerPath(), ctx.mode, '--host', X.RUNNER_HOST, '--repo', ctx.snapshot,
    '--plan', ctx.plan, '--artifacts', artifactsDir, '--timeout', String(ctx.timeout)];
  if (ctx.mode === 'inspect') argv.push('--base', ctx.base);
  if (ctx.mode === 'review' && ctx.resume) {
    argv.push('--resume', ctx.resume);
    if (ctx.feedback) argv.push('--feedback', ctx.feedback);
  }
  const forbidden = argv.find((a) => X.FORBIDDEN_RUNNER_TOKENS.includes(a));
  if (forbidden) throw new Error(`refusing to spawn: argv contains ${forbidden}`);
  return argv;
}

/** Allowlisted environment for the runner (plus the dedicated CODEX_HOME). */
function buildEnv(source) {
  const src = source || process.env;
  const env = {};
  for (const [k, v] of Object.entries(src)) {
    if (ALLOWED_ENV.includes(k) || k.startsWith(ALLOWED_ENV_PREFIX)) env[k] = v;
  }
  env.CODEX_HOME = X.codexHome();
  return env;
}

/** spawnSync options: minimal env, snapshot cwd, hard timeout with grace, SIGKILL. */
function spawnOptions(ctx) {
  return {
    cwd: ctx.snapshot, env: buildEnv(), encoding: 'utf8', maxBuffer: RUNNER_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'],
    timeout: (ctx.timeout + SPAWN_GRACE_SECONDS) * 1000, killSignal: 'SIGKILL',
  };
}

// ---------- tripwire (FR-015) ----------

/** { relpath: sha256 } for every regular file under dir (recursive), skipping `skip`
 * names (and, when `skipFile` is given, matching file names) at the top level. */
function fileHashes(dir, skip, prefix, out, skipFile) {
  const acc = out || {};
  if (!isDir(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (!prefix && (skip.includes(name) || (skipFile && skipFile(name)))) continue;
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try { st = fs.lstatSync(full); } catch (_e) { continue; }
    if (st.isDirectory()) fileHashes(full, skip, rel, acc, skipFile);
    else if (st.isFile()) acc[rel] = sha256(fs.readFileSync(full));
    else if (st.isSymbolicLink()) acc[rel] = `link:${fs.readlinkSync(full)}`;
  }
  return acc;
}

/** .git/ metadata a reviewer could plant: config (from --git-dir, so a linked
 * worktree's own config counts), hooks/* and info/* (from --git-common-dir — a
 * linked worktree's .git/worktrees/<n> has no hooks/, they live in the common
 * dir), the core.hooksPath target. */
function gitMeta(repo) {
  const resolveDir = (flag) => { const d = (gitOut(['-C', repo, 'rev-parse', flag]) || '.git').trim(); return path.isAbsolute(d) ? d : path.join(repo, d); };
  const gitDir = resolveDir('--git-dir');
  const commonDir = resolveDir('--git-common-dir');
  const meta = {};
  if (isFile(path.join(gitDir, 'config'))) meta['.git/config'] = sha256(fs.readFileSync(path.join(gitDir, 'config')));
  if (commonDir !== gitDir && isFile(path.join(commonDir, 'config'))) meta['.git(common)/config'] = sha256(fs.readFileSync(path.join(commonDir, 'config')));
  for (const sub of GIT_META_DIRS) fileHashes(path.join(commonDir, sub), [], `.git/${sub}`, meta);
  const hooksPath = (gitOut(['-C', repo, 'config', '--get', 'core.hooksPath']) || '').trim();
  if (hooksPath) fileHashes(path.isAbsolute(hooksPath) ? hooksPath : path.join(repo, hooksPath), [], `core.hooksPath(${hooksPath})`, meta);
  return meta;
}

function takeBaseline(ctx) {
  const b = {
    checkout: porcelain(ctx.root), snapshot: porcelain(ctx.snapshot),
    gitmeta_checkout: gitMeta(ctx.root), home: fileHashes(X.codexHome(), CODEX_RUNTIME_DIRS, '', null, isCodexRuntimeFile),
  };
  if (path.resolve(ctx.workPath) !== path.resolve(ctx.root)) { b.work = porcelain(ctx.workPath); b.gitmeta_work = gitMeta(ctx.workPath); }
  return b;
}

function writeBaseline(baseline) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-xprov-baseline-'));
  const file = path.join(dir, 'baseline.json');
  fs.writeFileSync(file, JSON.stringify(baseline, null, 2), { mode: 0o600 });
  return file;
}

function setDelta(label, a, b) {
  const A = new Set(String(a || '').split('\n').filter(Boolean));
  const B = new Set(String(b || '').split('\n').filter(Boolean));
  return [...[...B].filter((l) => !A.has(l)).map((l) => `${label}: ${l.slice(3)}`), ...[...A].filter((l) => !B.has(l)).map((l) => `${label}: ${l.slice(3)} (gone)`)];
}

function mapDelta(label, a, b) {
  const A = a || {};
  const B = b || {};
  const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
  return [...keys].filter((k) => A[k] !== B[k]).map((k) => `${label}: ${k}${k in A && k in B ? ' (changed)' : k in A ? ' (gone)' : ' (new)'}`);
}

/** Every path that differs between two baselines. */
function baselineDelta(before, after) {
  return [
    ...setDelta('checkout', before.checkout, after.checkout), ...setDelta('work', before.work, after.work), ...setDelta('snapshot', before.snapshot, after.snapshot),
    ...mapDelta('checkout', before.gitmeta_checkout, after.gitmeta_checkout), ...mapDelta('work', before.gitmeta_work, after.gitmeta_work),
    ...mapDelta('codex home', before.home, after.home),
  ];
}

function revertSnapshot(snapshot) {
  spawnSync('git', ['-C', snapshot, 'checkout', '--quiet', '--', '.'], { stdio: 'ignore' });
  spawnSync('git', ['-C', snapshot, 'clean', '-fdq'], { stdio: 'ignore' });
}

// ---------- runner call ----------

/** The runner's header {…, artifacts}: accepted only as a claudex-* dir under OUR artifacts dir. */
function runDirFromStdout(stdout, artifactsDir) {
  const first = String(stdout || '').split('\n').find((l) => l.trim() !== '');
  try {
    const h = JSON.parse(first);
    if (!h || typeof h.artifacts !== 'string' || !isDir(h.artifacts)) return null;
    const candidate = path.resolve(h.artifacts);
    if (!path.basename(candidate).startsWith(RUN_DIR_PREFIX) || !isUnder(candidate, artifactsDir) || isUnder(artifactsDir, candidate)) return null;
    return candidate;
  } catch (_e) {
    return null;
  }
}

function spawnRunner(argv, ctx, artifactsDir) {
  const r = spawnSync(argv[0], argv.slice(1), spawnOptions(ctx));
  if (r.error) return { status: null, stdout: r.stdout || '', stderr: `spawn failed: ${r.error.code || r.error.message}`, runDir: runDirFromStdout(r.stdout, artifactsDir) };
  if (r.signal) return { status: null, stdout: r.stdout || '', stderr: `runner killed by ${r.signal} after ${ctx.timeout + SPAWN_GRACE_SECONDS} s`, runDir: runDirFromStdout(r.stdout, artifactsDir) };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', runDir: runDirFromStdout(r.stdout, artifactsDir) };
}

function removeRunDir(dir, artifactsDir) {
  if (dir && isDir(dir) && path.basename(dir).startsWith(RUN_DIR_PREFIX) && isUnder(dir, artifactsDir)) fs.rmSync(dir, { recursive: true, force: true });
}

function readIfFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_e) { return ''; }
}

/** Presence of repo-local Codex inputs in the reviewed COMMIT (git ls-files; the working tree was stripped). */
function snapshotNotes(snapshot) {
  const tracked = new Set((gitOut(['-C', snapshot, 'ls-files', '-z']) || '').split('\0').filter(Boolean));
  const notes = {};
  for (const [key, rel] of Object.entries(REPO_LOCAL_TRACKED)) {
    notes[key] = tracked.has(rel) || [...tracked].some((t) => t.startsWith(`${rel}/`));
  }
  return notes;
}

// ---------- log (a1 owns PLAN-REVIEW-LOG.md) ----------

function rolesOf(resultPath) {
  try {
    const r = JSON.parse(readIfFile(resultPath));
    return r && r.roles ? Object.entries(r.roles).map(([k, v]) => `${none(k)} ${none(v)}`).join(', ') : 'unknown';
  } catch (_e) { return 'unknown'; }
}

function appendLog(ctx, entry) {
  if (ctx.noLog) return null;
  const file = path.join(ctx.phaseDir, LOG_FILE);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : LOG_HEADER;
  const lines = [
    `## ${ctx.ts} · ${ctx.gate} · ${ctx.mode} · round ${ctx.round}${ctx.wave === null ? '' : ` · wave ${ctx.wave}`}${ctx.lane ? ` · lane ${none(ctx.lane)}` : ''}`,
    `- gate: ${ctx.gate}`, `- mode: ${ctx.mode}`, `- round: ${ctx.round}`, `- lane: ${none(ctx.lane)}`,
    `- roles: ${none(entry.roles)}`, `- model_requested: ${X.MODEL_REQUESTED_DEFAULT}`,
    `- result: ${none(entry.result_path)}`, `- verdict: ${none(entry.verdict)}`,
    `- snapshot: ${none(ctx.snapshot)}`,
    ...Object.entries(entry.notes).map(([k, v]) => `- ${k}: ${v}`),
  ];
  writeTextAtomic(file, `${existing.replace(/\n*$/, '\n\n')}${lines.join('\n')}\n`);
  return file;
}

// ---------- command ----------

function emit(ctx, extra, exitCode) {
  writeStdoutSync(`${JSON.stringify({ snapshot: ctx.snapshot, mode: ctx.mode, gate: ctx.gate, ...extra }, null, 2)}\n`);
  process.exitCode = exitCode;
}

/** Everything after the pre-spawn checks; the baseline temp dir is always removed. */
function runWithBaseline(ctx, artifactsDir, argv, notes) {
  const before = takeBaseline(ctx);
  const baselinePath = writeBaseline(before);
  // `ok` like preflight/permit/observe/snapshot; `baseline_path` only on a
  // tripwire (the file is gone in `finally` — on success only `baseline_delta`
  // is meaningful, on a tripwire the mktemp path documents where the baseline was).
  const common = { argv, snapshot_notes: notes };
  const finish = (extra, verdict, code) => {
    appendLog(ctx, { roles: extra.result_path ? rolesOf(extra.result_path) : 'unknown', result_path: extra.result_path, verdict, notes });
    return emit(ctx, { ok: code === X.EXIT_PASS, ...common, ...extra }, code);
  };
  const failWith = (reason, detail, runDir, keepRunDir) => {
    if (!keepRunDir) removeRunDir(runDir, artifactsDir);
    return finish({ reason, reason_detail: detail, baseline_delta: [], result_path: null, artifacts_run_dir: keepRunDir ? runDir : null }, `fail/${reason}`, X.EXIT_FAIL);
  };
  try {
    const run = spawnRunner(argv, ctx, artifactsDir);
    const delta = baselineDelta(before, takeBaseline(ctx));
    if (delta.length > 0) {
      revertSnapshot(ctx.snapshot);
      appendXreviewNote(ctx.phaseDir, `BLOCKER tripwire (${ctx.gate}, ${ctx.mode})`, ['the reviewer changed files during the run; its result was discarded', ...delta]);
      removeRunDir(run.runDir, artifactsDir);
      return finish({ reason: X.REASONS.tripwire, baseline_delta: delta, baseline_path: baselinePath, result_path: null, artifacts_run_dir: null }, `fail/${X.REASONS.tripwire}`, X.EXIT_FAIL);
    }
    if (run.status !== 0) {
      process.stderr.write(`xprov run: runner failed: ${tail(run.stderr)}\n`);
      return failWith(X.REASONS.runner_failed, tail(run.stderr) || `runner exited ${run.status}`, run.runDir, false);
    }
    const resultPath = run.runDir ? path.join(run.runDir, 'result.json') : null;
    if (!resultPath || !isFile(resultPath)) return failWith(X.REASONS.runner_failed, 'runner exited 0 without a result.json in a claudex-* run dir under the artifacts dir', run.runDir, false);
    if (fileSize(resultPath) > X.MAX_RESULT_BYTES) return failWith(X.REASONS.malformed, `result.json exceeds ${X.MAX_RESULT_BYTES} bytes and cannot be scanned`, run.runDir, true);
    const replyPath = path.join(run.runDir, 'reply.txt');
    if (isFile(replyPath) && fileSize(replyPath) > X.MAX_RESULT_BYTES) return failWith(X.REASONS.malformed, `reply.txt exceeds ${X.MAX_RESULT_BYTES} bytes and cannot be scanned`, run.runDir, true);
    const hit = filterOutput([readIfFile(resultPath), readIfFile(replyPath)]);
    if (hit && hit.hit) {
      process.stderr.write(`xprov run: secret_in_output (pattern ${hit.pattern_name}); run dir kept for inspection: ${run.runDir}\n`);
      return finish({ reason: X.REASONS.secret_in_output, secret_pattern: hit.pattern_name, baseline_delta: [], result_path: null, artifacts_run_dir: run.runDir }, `fail/${X.REASONS.secret_in_output}`, X.EXIT_FAIL);
    }
    return finish({ reason: null, baseline_delta: [], result_path: resultPath, artifacts_run_dir: run.runDir }, 'pending', X.EXIT_PASS);
  } finally {
    fs.rmSync(path.dirname(baselinePath), { recursive: true, force: true });
  }
}

function cmdXprovRun(args) {
  const ctx = resolveArgs(args);
  // Order (Samuel W5 re-check): usage → permit → pin → notes. A repository without
  // permission receives NO a1 write, not even the repo-local XREVIEW note.
  const permit = permitCheck({ repoRoot: ctx.root });
  if (!permit.ok) {
    process.stderr.write(`xprov run: ${permit.detail || permit.reason}\n`);
    return emit(ctx, { ok: false, reason: permit.reason, reason_detail: permit.detail || null, result_path: null, artifacts_run_dir: null, baseline_delta: [] }, X.EXIT_FAIL);
  }
  const notes = snapshotNotes(ctx.snapshot);
  const pin = X.checkRunnerPin();
  if (!pin.ok) {
    process.stderr.write(`xprov run: runner pin check failed (${pin.reason}); refusing to spawn an unverified runner\n`);
    appendLog(ctx, { roles: 'unknown', result_path: null, verdict: `fail/${X.REASONS.runner_failed}`, notes });
    return emit(ctx, { ok: false, reason: X.REASONS.runner_failed, reason_detail: `runner pin ${pin.reason}: ${pin.runnerPath} vs ${pin.sumsPath}`, result_path: null, artifacts_run_dir: null, baseline_delta: [] }, X.EXIT_FAIL);
  }
  const present = Object.entries(REPO_LOCAL_TRACKED).filter(([k]) => notes[k]).map(([, rel]) => rel);
  if (present.length) {
    process.stderr.write(`xprov run: the reviewed commit tracks repo-local Codex inputs (${present.join(', ')}); they were removed from the snapshot working tree and are logged\n`);
    appendXreviewNote(ctx.phaseDir, `note: repo-local Codex inputs stripped from the snapshot (${ctx.gate}, ${ctx.mode})`, present.map((p) => `${p} is tracked in the reviewed commit; removed from the snapshot working tree before the review`));
  }
  const artifactsDir = ensureArtifactsDir(); // 0700, outside checkout and vault (A1_INPUT → facade exit 2)
  const argv = buildArgv(ctx, artifactsDir);
  return runWithBaseline(ctx, artifactsDir, argv, notes);
}

module.exports = {
  cmdXprovRun, buildArgv, buildEnv, spawnOptions, baselineDelta, takeBaseline, gitMeta, fileHashes, snapshotNotes, runDirFromStdout,
  LOG_HEADER, NO_LOG_FLAG, ALLOWED_ENV, CODEX_RUNTIME_DIRS, CODEX_RUNTIME_FILES,
};
