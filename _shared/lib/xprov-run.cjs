'use strict';

// ---------------------------------------------------------------------------
// xprov-run — hand the VENDORED runner a snapshot under the dedicated Codex
// home, with an exact argv and a minimal environment, and detect any write it
// makes (spec 009-cross-provider-review-gate, Wave 5; FR-011, FR-014 env,
// FR-015, FR-024; amended 2026-09-24 after a1-samuel-security's W5 review and
// a1-reinhard-reviewer's W6 review; Wave 7 hardening 2026-10-02 after the
// live smoke, see "Skill roots" below).
//
//   a1-tools xprov run --mode review|inspect --snapshot <dir> --plan <abs PLAN.md>
//     --phase <name> --gate <id> [--wave N] [--round N] [--lane <id>]
//     [--base <sha>] [--feedback <file>]
//     [--timeout N] [--work-path <dir>] [--no-log]
//
// Order: usage checks → permitCheck (never a flag) → runner pin check
// (`checkRunnerPin()`; mismatch = runner_failed, no spawn) → artifacts dir
// 0700 → tripwire baseline in a mktemp file → spawnSync python3
// <vendoredRunnerPath()> … with an ALLOWLISTED environment (PATH, HOME,
// TMPDIR, LANG, LC_*, TERM, USER, SHELL) plus CODEX_HOME = codexHome(),
// bounded by timeout + grace and SIGKILL → baseline recomputed.
//
// Skill roots (Wave 7, measured with canaries under a network block,
// `codex debug prompt-input`, codex-cli 0.155.1). Codex reads skills — text
// that lands verbatim in a developer message — from `$HOME/.agents/skills`
// (the root follows $HOME), from `.agents/skills` at the git root of its cwd
// (a non-git cwd's own `.agents/skills` counts too), and from
// `$CODEX_HOME/skills` next to the built-in `skills/.system`. Hence:
//   * HOME is a FRESH per-run dir `~/.a1-xprov/run-home-*` (mkdtemp, 0700,
//     owner, no symlink, verified EMPTY right before the spawn — a persistent
//     HOME would be the next planting spot). Its manifest — names and sizes of
//     what Codex wrote there, never contents — goes into the run dir as
//     `run-home.manifest.json` and into stdout; a non-empty manifest AFTER the
//     run is an XREVIEW note, not a fail (measured 2026-10-02: 0 entries after a
//     live inspect). The dir is removed in `finally`, pass or fail; a SIGKILL
//     skips `finally`, so `xprov gc` (xprov-artifacts.cjs) sweeps `run-home-*`
//     dirs older than 24 h (lstat, same owner, never following a symlink) — and
//     every `xprov run` calls that same sweep first.
//   * --plan / --feedback are accepted ONLY as the snapshot's scanned copies
//     (`<snapshot>.inputs/{PLAN.md,feedback.md}`) whose sha256 snapshot()
//     recorded; checked after the pin check and re-hashed right before the
//     spawn — a foreign path, a missing record or a changed byte → refused.
//     Shell start under the empty HOME was measured (zsh, no newuser prompt,
//     first exec 0.4 s vs 5.9 s with the real HOME), so no .zshrc is planted and
//     SHELL stays as allowlisted. XDG_* is not on the env allowlist; TMPDIR is.
//   * the cwd is the snapshot root, and the spawn is refused (`snapshot_failed`)
//     while that root still holds any REPO_LOCAL_STRIP entry (`.agents` incl.).
//   * only `skills/.system` of the dedicated home is runtime; anything else
//     under `skills/` is configuration and trips.
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
const { ensureArtifactsDir, isUnder, sweepRunHomes } = require('./xprov-artifacts.cjs');
const { appendXreviewNote } = require('./xprov-normalize.cjs');
const { filterOutput, instructionMarker } = require('./xprov-filter.cjs');
const { permitCheck } = require('./xprov-permit.cjs');
const { homeSymlinks, skillsDirsProblem } = require('./xprov-preflight.cjs');
const { SNAP_PREFIX, REPO_LOCAL_STRIP, storedDiffSha, storedInputHashes, INPUTS_SUFFIX, INPUT_FILES } = require('./xprov-snapshot.cjs');

const NO_LOG_FLAG = 'no-log';
const FLAGS = Object.freeze({
  mode: 'str', snapshot: 'str', plan: 'str', phase: 'str', gate: 'str', wave: 'str', round: 'str', lane: 'str',
  base: 'str', feedback: 'str', timeout: 'str', 'work-path': 'str', [NO_LOG_FLAG]: 'bool',
});
const DEFAULT_TIMEOUT_SECONDS = 600; // the runner's own default
const SPAWN_GRACE_SECONDS = 60; // the runner kills its child at --timeout; a1 kills the runner a minute later
const RUNNER_MAX_BUFFER = 64 * 1024 * 1024;
const LOG_FILE = 'PLAN-REVIEW-LOG.md';
// Shared with xprov-gate.cjs (it imports this constant) — one header text, one owner.
const LOG_HEADER = '# PLAN-REVIEW-LOG — cross-provider runner calls\n\nWritten by `a1-tools xprov run` and `a1-tools xprov gate`; one entry per call, newest last.\n';
const RUNNER_MODES = new Set(X.RUNNER_MODES);
const RUN_DIR_PREFIX = 'claudex-';
const RUN_HOME_PREFIX = 'run-home-';
const RUN_HOME_MANIFEST_FILE = 'run-home.manifest.json';
const RUN_HOME_MANIFEST_MAX = 500; // entries recorded; the count is always exact
const RUN_HOME_NOTE_MAX = 20; // entries listed in the XREVIEW note
const FAILURE_DETAIL_MAX = 300; // characters of the runner's own failure reason kept in reason_detail
const SYSTEM_SKILLS_REL = path.join('skills', '.system');
const MANIFEST_FILE_MODE = 0o600;
// Environment the runner gets — nothing else (Samuel W5 MAJOR 2: OPENAI_BASE_URL
// would redirect the review, PYTHONPATH would bypass the pin, *_PROXY, GIT_*, …).
const ALLOWED_ENV = Object.freeze(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TERM', 'USER', 'SHELL']);
const ALLOWED_ENV_PREFIX = 'LC_';
// Codex runtime dirs inside the dedicated home that change on every run and are not part of its configuration.
// `skills/.system` (Codex's built-in skills) is runtime; the rest of `skills/` is
// a USER skill root (measured, Wave 7) and therefore configuration that trips.
const CODEX_RUNTIME_DIRS = Object.freeze(['cache', 'sessions', 'plugins', 'skills/.system', 'tmp', 'shell_snapshots', 'thread-writer-locks', 'log']);
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
const REPO_LOCAL_TRACKED = Object.freeze({ repo_local_codex_config: '.codex/config.toml', agents_md: 'AGENTS.md', agents_override_md: 'AGENTS.override.md', codex_hooks: '.codex/hooks', agents_dir: '.agents' });

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
  // No session is ever resumed (Samuel, Wave 7 MAJOR): `codex exec resume`
  // replays a rollout file in the dedicated home that no check covers.
  if ((args || []).some((a) => /^--resume(=|$)/.test(String(a)))) usage('--resume is not accepted: every review is a fresh session (a resumed session replays a rollout file outside the tripwire)');
  const flags = parseFlags(args, FLAGS);
  const stray = flags._.filter((a) => String(a).startsWith('--'));
  if (stray.length) usage(`unknown flag ${stray[0]}`);
  if (flags._.length) usage(`unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  if (!RUNNER_MODES.has(flags.mode)) usage(`--mode must be one of ${X.RUNNER_MODES.join('|')} (got ${JSON.stringify(String(flags.mode).slice(0, 40))}); build is never used`);
  if (flags.mode === 'inspect' && !flags.base) usage('--mode inspect requires --base <sha>');
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
  if (flags.feedback && !isFile(flags.feedback)) usage(`--feedback not found: ${flags.feedback}`);
  const workPath = flags['work-path'] ? path.resolve(flags['work-path']) : root;
  if (!isDir(workPath)) usage(`--work-path is not a directory: ${workPath}`);
  return {
    mode: flags.mode, snapshot, plan: flags.plan, phase, phaseDir, root, workPath, gate: flags.gate,
    wave: flags.wave === undefined ? null : parsePositive(flags.wave, 'wave'),
    round: flags.round === undefined ? 1 : parsePositive(flags.round, 'round'),
    lane: flags.lane === undefined ? null : flags.lane, base: flags.base || null,
    feedback: flags.feedback ? path.resolve(flags.feedback) : null,
    timeout: flags.timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : parsePositive(flags.timeout, 'timeout'),
    noLog: flags[NO_LOG_FLAG] === true, ts: nowIso(),
  };
}

// ---------- argv + env (FR-011, FR-014, FR-024) ----------

function buildArgv(ctx, artifactsDir) {
  const argv = ['python3', X.vendoredRunnerPath(), ctx.mode, '--host', X.RUNNER_HOST, '--repo', ctx.snapshot,
    '--plan', ctx.plan, '--artifacts', artifactsDir, '--timeout', String(ctx.timeout)];
  if (ctx.mode === 'inspect') argv.push('--base', ctx.base);
  if (ctx.feedback) argv.push('--feedback', ctx.feedback); // every mode: runner.py:348-349 appends it unconditionally
  const forbidden = argv.find((a) => X.FORBIDDEN_RUNNER_TOKENS.includes(a));
  if (forbidden) throw new Error(`refusing to spawn: argv contains ${forbidden}`);
  return argv;
}

/** Allowlisted environment for the runner (plus the dedicated CODEX_HOME). HOME
 * is the per-run home and never the caller's: without `runHome` it is left out. */
function buildEnv(source, runHome) {
  const src = source || process.env;
  const env = {};
  for (const [k, v] of Object.entries(src)) {
    if (ALLOWED_ENV.includes(k) || k.startsWith(ALLOWED_ENV_PREFIX)) env[k] = v;
  }
  delete env.HOME;
  if (runHome) env.HOME = runHome;
  env.CODEX_HOME = X.codexHome();
  env.GIT_CONFIG_NOSYSTEM = '1'; // the runner's git reads no /etc/gitconfig (Wave 7, Samuel)
  return env;
}

/** spawnSync options: minimal env, snapshot cwd, hard timeout with grace, SIGKILL. */
function spawnOptions(ctx, runHome) {
  return {
    cwd: ctx.snapshot, env: buildEnv(null, runHome), encoding: 'utf8', maxBuffer: RUNNER_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'],
    timeout: (ctx.timeout + SPAWN_GRACE_SECONDS) * 1000, killSignal: 'SIGKILL',
  };
}

// ---------- tripwire (FR-015) ----------

/** { relpath: sha256 } for every regular file under dir (recursive), skipping the
 * `skip` relative paths at any depth and, when `skipFile` is given, matching file
 * names at the top level. */
function fileHashes(dir, skip, prefix, out, skipFile) {
  const acc = out || {};
  if (!isDir(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    // `skip` holds relative paths (`cache`, `skills/.system`); `skipFile` names at the top level only.
    if (skip.includes(rel) || (!prefix && skipFile && skipFile(name))) continue;
    const full = path.join(dir, name);
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

// ---------- per-run HOME (Wave 7) ----------

const octal = (mode) => (mode & 0o777).toString(8).padStart(3, '0');

/** Why `dir` is not a safe, empty run home right now — or null. */
function runHomeProblem(dir) {
  let st;
  try { st = fs.lstatSync(dir); } catch (_e) { return `run home vanished: ${dir}`; }
  if (st.isSymbolicLink()) return `run home is a symlink: ${dir}`;
  if (!st.isDirectory()) return `run home is not a directory: ${dir}`;
  if ((st.mode & 0o777) !== C.DIR_MODE) return `run home mode ${octal(st.mode)}, want ${octal(C.DIR_MODE)}: ${dir}`;
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return `run home owned by uid ${st.uid}, not ${process.getuid()}: ${dir}`;
  if (path.resolve(dir) === path.resolve(os.homedir())) return `run home equals the caller's HOME: ${dir}`;
  const entries = fs.readdirSync(dir);
  if (entries.length > 0) return `run home not empty before the spawn: ${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ` (+${entries.length - 5})` : ''}`;
  return null;
}

function removeRunHome(dir) {
  if (dir && path.basename(dir).startsWith(RUN_HOME_PREFIX) && isUnder(dir, X.xprovHome())) fs.rmSync(dir, { recursive: true, force: true });
}

/** A fresh run home: mkdtemp under ~/.a1-xprov, 0700, verified empty. The
 * `afterCreate` seam (fixtures only) runs between mkdtemp and the check. */
function prepareRunHome(opts) {
  const o = opts || {};
  C.mkdir0700(X.xprovHome());
  const dir = fs.mkdtempSync(path.join(X.xprovHome(), RUN_HOME_PREFIX));
  fs.chmodSync(dir, C.DIR_MODE); // umask-proof
  if (typeof o.afterCreate === 'function') o.afterCreate(dir);
  const problem = runHomeProblem(dir);
  if (problem) {
    removeRunHome(dir);
    return Object.freeze({ ok: false, dir: null, problem });
  }
  return Object.freeze({ ok: true, dir, problem: null });
}

/** What the runner left in its HOME: [{path, type, size}], sorted, symlinks not followed. */
function runHomeManifest(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const full = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      let st;
      try { st = fs.lstatSync(full); } catch (_e) { continue; }
      const type = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other';
      out.push({ path: r, type, size: type === 'file' ? st.size : null });
      if (type === 'dir') walk(full, r);
    }
  };
  try { walk(dir, ''); } catch (_e) { /* a vanished dir yields what was read */ }
  return out;
}

/** The manifest as it may leave a1's private artifacts dir: a name the runner
 * chose is data — secret-shaped or instruction-shaped names are withheld and
 * only the pattern is named (Codex R1, hardened live inspect 2026-10-02). */
function emittableManifest(manifest) {
  return manifest.map((e) => {
    const hit = filterOutput([e.path]);
    if (hit && hit.hit) return { ...e, path: `<withheld: ${hit.pattern_name}>` };
    if (instructionMarker({ id: '', evidence: e.path, fix: '' }, []) !== null) return { ...e, path: '<withheld: instruction_shaped>' };
    return e;
  });
}

function writeRunHomeManifest(runDir, artifactsDir, manifest) {
  if (!runDir || !isDir(runDir) || !isUnder(runDir, artifactsDir)) return;
  const body = { entries: manifest.length, manifest: manifest.slice(0, RUN_HOME_MANIFEST_MAX) };
  fs.writeFileSync(path.join(runDir, RUN_HOME_MANIFEST_FILE), `${JSON.stringify(body, null, 2)}\n`, { mode: MANIFEST_FILE_MODE });
}

/** --plan / --feedback must be the snapshot's own scanned copies, unchanged
 * since snapshot() hashed them (Codex R1, live inspect 2026-10-03): a foreign
 * path, a missing record, a symlink or a changed byte → the reason, else null. */
function inputProblem(ctx) {
  const record = storedInputHashes(ctx.snapshot);
  if (!record) return `no input record next to the snapshot (${ctx.snapshot}${INPUTS_SUFFIX}/inputs.json) — build it with xprov snapshot --plan`;
  const given = [['plan', ctx.plan], ...(ctx.feedback ? [['feedback', ctx.feedback]] : [])];
  for (const [key, p] of given) {
    const expected = path.join(`${ctx.snapshot}${INPUTS_SUFFIX}`, INPUT_FILES[key]);
    let st;
    try { st = fs.lstatSync(p); } catch (_e) { return `--${key} ${p} is missing`; }
    if (st.isSymbolicLink() || !st.isFile()) return `--${key} ${p} is not a regular file`;
    let same = false;
    try { same = fs.realpathSync(p) === fs.realpathSync(expected); } catch (_e) { same = false; }
    if (!same) return `--${key} must be the snapshot's scanned copy ${expected}, got ${p}`;
    if (typeof record[key] !== 'string') return `the snapshot recorded no ${key} copy`;
    if (sha256(fs.readFileSync(p)) !== record[key]) return `--${key} copy changed after the snapshot scanned it`;
  }
  return null;
}

/** Right before the spawn (Samuel m7, measured 2026-10-03 on a home copy with
 * `codex debug prompt-input` under a network block): a SKILL.md planted in
 * `skills/.system` is loaded while its marker matches (m1), and Codex re-extracts
 * the identical `.system` (6 skills + marker 8bcfb84cfbe4722a) when it is absent
 * (m2) or when the marker is gone (m3). So the dedicated home must hold no
 * symlink besides auth.json, `skills/` and `skills/.system` must be real, own
 * directories, and `.system` is removed before every spawn. → reason or null. */
function resetSystemSkills() {
  const home = X.codexHome();
  const links = homeSymlinks(home);
  if (links.length) return `the dedicated Codex home holds symlinks (${links.slice(0, 5).join(', ')}) — refusing to spawn`;
  const bad = skillsDirsProblem(home);
  if (bad) return `${bad} in the dedicated Codex home — refusing to spawn`;
  fs.rmSync(path.join(home, SYSTEM_SKILLS_REL), { recursive: true, force: true });
  return null;
}

/** runner.py 2.1.0 RunError messages WITHOUT interpolated parts (f-strings
 * excluded: line 102 carries repo path names, `error` carries str(exc)). Only
 * an exact match is exempt from the instruction check (Samuel W7: invert it).
 * The claude-provider, build, check and resume messages are left out: a1 never
 * reaches those paths, so they are checked like any other text. */
const RUNNER_FIXED_MESSAGES = Object.freeze([
  'The plan reviewer must be the other provider. Change the host to swap roles.',
  '--cli must be an absolute path to an installed CLI executable.',
  'Review must contain exactly verdict, summary, findings, coverage and limitations.',
  'Invalid review verdict.', 'Missing review summary.', 'A completed review must identify what was inspected.',
  'Invalid findings list.', 'Invalid finding fields.', 'Every finding needs an id, severity, path, evidence and fix.',
  'Finding IDs must be unique; severity must be high, medium or low.', 'APPROVED cannot contain unresolved high/medium findings.',
  'REVISE must explain at least one concrete finding.', 'BLOCKED must explain the limitation.',
  'Run timed out or was interrupted; no approval recorded.', 'Codex event stream contains a non-object event.',
  'Codex reported a failed turn; inspect the captured diagnostics.', 'Missing or ambiguous Codex session/completion event.',
  'CLI did not return a valid session UUID.', 'CLI resumed a different session; refusing its result.',
  'Plan review must use the provider opposite the planner/host.', 'Inspection requires --base and a fresh session (no --resume).',
  'Keep run artifacts outside the target checkout so they do not contaminate its diff.',
  'CLI version probe failed. Check the resolved executable before retrying.',
  'Plan changed during the run; result cannot approve the current plan.', 'Code changed during inspection; inspect the final code again.',
  'Timeout must be positive.',
]);
const RUNNER_STDERR_PREFIX = 'claudex-loop: '; // runner.py:415

/** The runner's own failure reason, display-safe (Wave 7 review): the last
 * `{"type":"error","message":…}` event of the run dir's stdout.txt (measured:
 * the usage-limit case), else result.json `error`, else the stderr tail — one
 * line (every line breaker and bidi control → space), capped. Secret patterns
 * are withheld by name; anything that is not an exact fixed runner message is
 * withheld when instruction-shaped. */
function runnerFailureDetail(run) {
  let msg = null;
  if (run.runDir) {
    for (const line of readIfFile(path.join(run.runDir, 'stdout.txt')).split('\n')) {
      try { const ev = JSON.parse(line); if (ev && ev.type === 'error' && typeof ev.message === 'string') msg = ev.message; } catch (_e) { /* not a JSON event */ }
    }
    if (msg === null) {
      try { const rec = JSON.parse(readIfFile(path.join(run.runDir, 'result.json'))); if (rec && typeof rec.error === 'string') msg = rec.error; } catch (_e) { /* no record */ }
    }
  }
  if (msg === null) msg = tail(run.stderr) || '';
  const bare = msg.trim().startsWith(RUNNER_STDERR_PREFIX) ? msg.trim().slice(RUNNER_STDERR_PREFIX.length) : msg.trim();
  const hit = filterOutput([msg]);
  if (hit && hit.hit) msg = `<withheld: ${hit.pattern_name}>`;
  else if (!RUNNER_FIXED_MESSAGES.includes(bare) && instructionMarker({ id: '', evidence: msg, fix: '' }, []) !== null) msg = '<withheld: instruction_shaped>';
  const line = msg.replace(C.LINE_BREAKERS_RE, ' ').replace(/ {2,}/g, ' ').trim().slice(0, FAILURE_DETAIL_MAX);
  return `runner exited ${run.status}${line ? `: ${line}` : ''}`;
}

/** The snapshot root must be stripped: its own `.agents/skills` would be a skill root. */
function unstrippedEntries(snapshot) {
  return REPO_LOCAL_STRIP.filter((name) => fs.existsSync(path.join(snapshot, name)));
}

function spawnRunner(argv, ctx, artifactsDir, runHome) {
  const r = spawnSync(argv[0], argv.slice(1), spawnOptions(ctx, runHome));
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

/** finish / failWith for one run: log entry + stdout JSON. `extra.run_home_manifest`
 * and `extra.porcelain` are set by the caller once the spawn happened. */
function makeOutcomes(ctx, artifactsDir, common, notes) {
  const finish = (extra, verdict, code) => {
    appendLog(ctx, { roles: extra.result_path ? rolesOf(extra.result_path) : 'unknown', result_path: extra.result_path, verdict, notes });
    return emit(ctx, { ok: code === X.EXIT_PASS, ...common, run_home_manifest: null, ...extra }, code);
  };
  const failWith = (reason, detail, runDir, keepRunDir, extra) => {
    if (!keepRunDir) removeRunDir(runDir, artifactsDir);
    return finish({ reason, reason_detail: detail, baseline_delta: [], result_path: null, artifacts_run_dir: keepRunDir ? runDir : null, ...(extra || {}) }, `fail/${reason}`, X.EXIT_FAIL);
  };
  return { finish, failWith };
}

/** `git status --porcelain` before and after the run, raw (SC-004 evidence). */
function porcelainEvidence(before, after) {
  const pair = (k) => ({ before: before[k] === undefined ? null : before[k], after: after[k] === undefined ? null : after[k] });
  return { checkout: pair('checkout'), snapshot: pair('snapshot'), work: pair('work') };
}

/** XREVIEW note when the runner left entries in its per-run HOME (names + sizes only). */
function noteRunHome(ctx, manifest) {
  if (manifest.length === 0) return;
  appendXreviewNote(ctx.phaseDir, `note: the runner left ${manifest.length} entries in its per-run HOME (${ctx.gate}, ${ctx.mode})`,
    manifest.slice(0, RUN_HOME_NOTE_MAX).map((e) => `${e.path} · ${e.type}${e.size === null ? '' : ` · ${e.size} bytes`}`));
}

/** The run dir's result.json is present and scannable, else { reason, detail, keep }. */
function resultFileProblem(run) {
  const resultPath = run.runDir ? path.join(run.runDir, 'result.json') : null;
  if (!resultPath || !isFile(resultPath)) return { reason: X.REASONS.runner_failed, detail: 'runner exited 0 without a result.json in a claudex-* run dir under the artifacts dir', keep: false };
  if (fileSize(resultPath) > X.MAX_RESULT_BYTES) return { reason: X.REASONS.malformed, detail: `result.json exceeds ${X.MAX_RESULT_BYTES} bytes and cannot be scanned`, keep: true };
  return null;
}

/** Detective TOCTOU check (Wave 7, Samuel): the diff the runner hashed must be
 * the diff the snapshot scan hashed (runner.py:106-107 vs snapshot()). */
function diffHashProblem(ctx, resultPath) {
  if (ctx.mode !== 'inspect') return null;
  let recorded = null;
  try { const rec = JSON.parse(readIfFile(resultPath)); recorded = rec && rec.snapshot && typeof rec.snapshot.diff_sha256 === 'string' ? rec.snapshot.diff_sha256 : null; } catch (_e) { recorded = null; }
  if (recorded === ctx.diffSha) return null;
  return `snapshot diff changed between the scan and the runner (scanned ${String(ctx.diffSha).slice(0, 12)}, runner ${String(recorded).slice(0, 12)})`;
}

/** Everything after the spawn, in order: tripwire, run-home note, exit, files, diff hash, secret filter. */
function judgeRun(ctx, o, run, artifactsDir, delta, baselinePath, seen) {
  if (delta.length > 0) {
    revertSnapshot(ctx.snapshot);
    appendXreviewNote(ctx.phaseDir, `BLOCKER tripwire (${ctx.gate}, ${ctx.mode})`, ['the reviewer changed files during the run; its result was discarded', ...delta]);
    removeRunDir(run.runDir, artifactsDir);
    return o.finish({ reason: X.REASONS.tripwire, baseline_delta: delta, baseline_path: baselinePath, result_path: null, artifacts_run_dir: null, ...seen }, `fail/${X.REASONS.tripwire}`, X.EXIT_FAIL);
  }
  // The note goes in AFTER the tripwire baseline was retaken: a1's own write into
  // the phase dir must never read as a reviewer write.
  noteRunHome(ctx, seen.run_home_manifest);
  if (run.status !== 0) {
    const why = runnerFailureDetail(run);
    process.stderr.write(`xprov run: runner failed: ${why}\n`);
    return o.failWith(X.REASONS.runner_failed, why, run.runDir, false, seen);
  }
  const bad = resultFileProblem(run);
  if (bad) return o.failWith(bad.reason, bad.detail, run.runDir, bad.keep, seen);
  const resultPath = path.join(run.runDir, 'result.json');
  const tamper = diffHashProblem(ctx, resultPath);
  if (tamper) {
    appendXreviewNote(ctx.phaseDir, `BLOCKER tripwire (${ctx.gate}, ${ctx.mode})`, ['the outbound diff differs from the scanned one; the result was discarded', tamper]);
    removeRunDir(run.runDir, artifactsDir);
    return o.finish({ reason: X.REASONS.tripwire, reason_detail: tamper, baseline_delta: [tamper], result_path: null, artifacts_run_dir: null, ...seen }, `fail/${X.REASONS.tripwire}`, X.EXIT_FAIL);
  }
  const replyPath = path.join(run.runDir, 'reply.txt');
  if (isFile(replyPath) && fileSize(replyPath) > X.MAX_RESULT_BYTES) return o.failWith(X.REASONS.malformed, `reply.txt exceeds ${X.MAX_RESULT_BYTES} bytes and cannot be scanned`, run.runDir, true, seen);
  const hit = filterOutput([readIfFile(resultPath), readIfFile(replyPath)]);
  if (hit && hit.hit) {
    process.stderr.write(`xprov run: secret_in_output (pattern ${hit.pattern_name}); run dir kept for inspection: ${run.runDir}\n`);
    return o.finish({ reason: X.REASONS.secret_in_output, secret_pattern: hit.pattern_name, baseline_delta: [], result_path: null, artifacts_run_dir: run.runDir, ...seen }, `fail/${X.REASONS.secret_in_output}`, X.EXIT_FAIL);
  }
  return o.finish({ reason: null, baseline_delta: [], result_path: resultPath, artifacts_run_dir: run.runDir, ...seen }, 'pending', X.EXIT_PASS);
}

/** Pre-spawn run home + late input re-hash, spawn, post-run judgement; the
 * baseline temp dir and the run home are always removed. */
function runWithBaseline(ctx, artifactsDir, argv, notes) {
  const before = takeBaseline(ctx);
  const baselinePath = writeBaseline(before);
  // `ok` like preflight/permit/observe/snapshot; `baseline_path` only on a
  // tripwire (the file is gone in `finally` — on success only `baseline_delta`
  // is meaningful, on a tripwire the mktemp path documents where the baseline was).
  const o = makeOutcomes(ctx, artifactsDir, { argv, snapshot_notes: notes }, notes);
  let runHome = null;
  try {
    const home = prepareRunHome();
    if (!home.ok) {
      process.stderr.write(`xprov run: ${home.problem}; refusing to spawn\n`);
      return o.failWith(X.REASONS.run_home_unsafe, home.problem, null, false);
    }
    runHome = home.dir;
    // Re-hash the input copies right before the spawn (TOCTOU since the check in cmdXprovRun).
    const late = inputProblem(ctx);
    if (late) {
      process.stderr.write(`xprov run: ${late}; refusing to spawn\n`);
      return o.failWith(X.REASONS.snapshot_failed, late, null, false);
    }
    const homeIssue = resetSystemSkills();
    if (homeIssue) {
      process.stderr.write(`xprov run: ${homeIssue}\n`);
      return o.failWith(X.REASONS.preflight_failed, homeIssue, null, false);
    }
    const run = spawnRunner(argv, ctx, artifactsDir, runHome);
    const rawManifest = runHomeManifest(runHome);
    writeRunHomeManifest(run.runDir, artifactsDir, rawManifest); // a1's 0700 artifacts dir, like result.json
    const after = takeBaseline(ctx);
    const seen = { run_home_manifest: emittableManifest(rawManifest), porcelain: porcelainEvidence(before, after) };
    return judgeRun(ctx, o, run, artifactsDir, baselineDelta(before, after), baselinePath, seen);
  } finally {
    removeRunHome(runHome);
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
  // Opportunistic: run-homes a SIGKILL left behind never accumulate (gc's own sweep, not a copy).
  sweepRunHomes();
  const notes = snapshotNotes(ctx.snapshot);
  const pin = X.checkRunnerPin();
  if (!pin.ok) {
    process.stderr.write(`xprov run: runner pin check failed (${pin.reason}); refusing to spawn an unverified runner\n`);
    appendLog(ctx, { roles: 'unknown', result_path: null, verdict: `fail/${X.REASONS.runner_failed}`, notes });
    return emit(ctx, { ok: false, reason: X.REASONS.runner_failed, reason_detail: `runner pin ${pin.reason}: ${pin.runnerPath} vs ${pin.sumsPath}`, result_path: null, artifacts_run_dir: null, baseline_delta: [] }, X.EXIT_FAIL);
  }
  const unstripped = unstrippedEntries(ctx.snapshot);
  if (unstripped.length) {
    const detail = `the snapshot root still holds ${unstripped.join(', ')}; the runner's cwd must be a stripped snapshot root`;
    process.stderr.write(`xprov run: ${detail}; refusing to spawn\n`);
    appendLog(ctx, { roles: 'unknown', result_path: null, verdict: `fail/${X.REASONS.snapshot_failed}`, notes });
    return emit(ctx, { ok: false, reason: X.REASONS.snapshot_failed, reason_detail: detail, result_path: null, artifacts_run_dir: null, baseline_delta: [] }, X.EXIT_FAIL);
  }
  const inputs = inputProblem(ctx);
  if (inputs) {
    process.stderr.write(`xprov run: ${inputs}; refusing to spawn\n`);
    appendLog(ctx, { roles: 'unknown', result_path: null, verdict: `fail/${X.REASONS.snapshot_failed}`, notes });
    return emit(ctx, { ok: false, reason: X.REASONS.snapshot_failed, reason_detail: inputs, result_path: null, artifacts_run_dir: null, baseline_delta: [] }, X.EXIT_FAIL);
  }
  const diffSha = ctx.mode === 'inspect' ? storedDiffSha(ctx.snapshot) : null;
  if (ctx.mode === 'inspect') {
    if (!diffSha) {
      const detail = 'no scanned diff hash next to the snapshot (<snapshot>.inputs/diff.sha256) — build it with xprov snapshot --base';
      process.stderr.write(`xprov run: ${detail}; refusing to spawn\n`);
      appendLog(ctx, { roles: 'unknown', result_path: null, verdict: `fail/${X.REASONS.snapshot_failed}`, notes });
      return emit(ctx, { ok: false, reason: X.REASONS.snapshot_failed, reason_detail: detail, result_path: null, artifacts_run_dir: null, baseline_delta: [] }, X.EXIT_FAIL);
    }
  }
  const present = Object.entries(REPO_LOCAL_TRACKED).filter(([k]) => notes[k]).map(([, rel]) => rel);
  if (present.length) {
    process.stderr.write(`xprov run: the reviewed commit tracks repo-local Codex inputs (${present.join(', ')}); they were removed from the snapshot working tree and are logged\n`);
    appendXreviewNote(ctx.phaseDir, `note: repo-local Codex inputs stripped from the snapshot (${ctx.gate}, ${ctx.mode})`, present.map((p) => `${p} is tracked in the reviewed commit; removed from the snapshot working tree before the review`));
  }
  const artifactsDir = ensureArtifactsDir(); // 0700, outside checkout and vault (A1_INPUT → facade exit 2)
  const argv = buildArgv(ctx, artifactsDir);
  return runWithBaseline(Object.freeze({ ...ctx, diffSha }), artifactsDir, argv, notes);
}

module.exports = {
  cmdXprovRun, buildArgv, buildEnv, spawnOptions, baselineDelta, takeBaseline, gitMeta, fileHashes, snapshotNotes, runDirFromStdout,
  prepareRunHome, removeRunHome, runHomeManifest,
  LOG_HEADER, NO_LOG_FLAG, ALLOWED_ENV, CODEX_RUNTIME_DIRS, CODEX_RUNTIME_FILES, RUN_HOME_PREFIX,
};
