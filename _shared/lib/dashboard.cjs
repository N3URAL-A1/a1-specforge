'use strict';

// dashboard — command group `dashboard` (spec 021-dashboard). `dashboard build [<slug>] [--json]` writes one
// owner-marked, read-only overview note, <vault>/project/<slug>/dashboard.md, atomically.
//
// Exit contract (FR-010): 0 note written, or skipped on a non-writer host · 1 usage error (help.cjs usage())
// · 2 unsafe path, slug mismatch, vault root missing or not writable, foreign note, write failure, any
// internal error. Every exit-2 message is one stderr line through redact(); no stack trace.
//
// State is request-scoped: buildDashboard(ctx) takes cwd, env, clock, fs ops and the open-path trace as
// parameters; this module holds no mutable module-level state. Only fs and path plus in-repo libs.
//   ctx = { cwd, env, clock, ops, trace, args: { slug, json }, writerCheck? }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { usage } = require('./help.cjs');
const { parseFlags, parseFrontmatter, peekVaultRoot } = require('./io.cjs');
const { isLink, rootProblem, warnSkipped } = require('./vault-common.cjs');
const { resolveSlug } = require('./vault-sync.cjs');
const { redact } = require('./intent-redact.cjs');
const { readSource, writerCheck } = require('./dashboard-read.cjs');
const { collectSections } = require('./dashboard-sources.cjs');
const { costSection } = require('./dashboard-cost.cjs');
const { render, GENERATED_BY } = require('./dashboard-render.cjs');

const NOTE_NAME = 'dashboard.md';
const ROADMAP_REL = Object.freeze(['docs', 'product', 'ROADMAP.md']);
const FLAGS = Object.freeze({ json: 'bool' });
const EXTERNAL_TIERS = new Set(['env', 'legacy']);
const HEX_SHA = /^[0-9a-f]{40}$/;

/** A refusal that ends the build with exit 2; `reason` is a stable code. */
function refusal(reason, message) {
  const err = new Error(message);
  err.dashReason = reason;
  return err;
}

// ---------- repo, slug, vault ----------

/** The directory that holds `.git` (dir or worktree file), walking up from `cwd`; null when none. */
function findRepoRoot(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** `{ exists, project }` from the ROADMAP frontmatter, read through the dashboard read seam. */
function readRoadmap(repoRoot, ctx) {
  let text;
  try {
    text = readSource(path.join(repoRoot, ...ROADMAP_REL), ctx);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { exists: false, project: null };
    throw refusal('unreadable_roadmap', 'docs/product/ROADMAP.md exists but cannot be read');
  }
  const { project } = parseFrontmatter(text).fm;
  return { exists: true, project: typeof project === 'string' && project !== '' ? project : null };
}

function slugFor(requested, roadmap) {
  try {
    return resolveSlug(requested, roadmap);
  } catch (e) {
    throw refusal('bad_slug', e.message);
  }
}

/**
 * The external vault root (tier env or legacy), checked writable. Same decision as vault-common
 * externalVaultRoot(), through the read-only lookup alone: externalVaultRoot() also announces the
 * learnings root on stderr, which would break the one-line stderr contract (FR-010, FR-011).
 */
function vaultRootFor() {
  const peek = peekVaultRoot();
  if (!peek || !EXTERNAL_TIERS.has(peek.source)) {
    const tier = peek ? `tier ${peek.source}` : 'nothing resolves';
    throw refusal('no_vault_root', `no external vault root (${tier}); set A1_VAULT_ROOT`);
  }
  const root = path.resolve(peek.root);
  const problem = rootProblem(root, fs.constants.W_OK);
  if (problem) throw refusal('vault_not_writable', problem);
  return root;
}

// ---------- source_head (fs only: no child process) ----------

function readTrim(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (_e) { return null; }
}

/** The git dir of a checkout: `.git` itself, or the target of a worktree `gitdir:` file. */
function gitDirOf(repoRoot) {
  const dot = path.join(repoRoot, '.git');
  let st;
  try { st = fs.statSync(dot); } catch (_e) { return null; }
  if (st.isDirectory()) return dot;
  const m = /^gitdir:\s*(.+)$/m.exec(readTrim(dot) || '');
  return m ? path.resolve(repoRoot, m[1].trim()) : null;
}

function packedRef(commonDir, ref) {
  const packed = readTrim(path.join(commonDir, 'packed-refs'));
  if (!packed) return null;
  const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
  return line ? line.split(' ')[0] : null;
}

/** Short HEAD hash, or null when it cannot be read. Never throws. */
function sourceHead(repoRoot) {
  const gitDir = gitDirOf(repoRoot);
  const head = gitDir && readTrim(path.join(gitDir, 'HEAD'));
  if (!head) return null;
  let sha = head;
  if (head.startsWith('ref: ')) {
    const ref = head.slice(5).trim();
    const common = readTrim(path.join(gitDir, 'commondir'));
    const commonDir = common ? path.resolve(gitDir, common) : gitDir;
    sha = readTrim(path.join(gitDir, ref)) || readTrim(path.join(commonDir, ref)) || packedRef(commonDir, ref);
  }
  return sha && HEX_SHA.test(sha) ? sha.slice(0, 7) : null;
}

// ---------- the note ----------

/** Refuse a link at project/<slug>/ or at the note; refuse a note not made by this command. */
function checkTarget(projectDir, target, ops) {
  if (isLink(projectDir)) throw refusal('unsafe_path', `project folder is a symbolic link: ${projectDir}`);
  if (isLink(target)) throw refusal('unsafe_path', `${NOTE_NAME} is a symbolic link: ${target}`);
  let text;
  try {
    text = ops.readFileSync(target, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return;
    throw refusal('unreadable_note', `existing ${NOTE_NAME} cannot be read (${e && e.code})`);
  }
  if (parseFrontmatter(text).fm.generated_by !== GENERATED_BY) {
    throw refusal('foreign_note', `${target} was not generated by ${GENERATED_BY}; it is never overwritten`);
  }
}

/** tmp sibling + rename; on any failure the tmp file is removed and the old note stays. */
function writeAtomic(target, text, ops) {
  const tmp = `${target}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  try {
    ops.mkdirSync(path.dirname(target), { recursive: true });
    ops.writeFileSync(tmp, text, { flag: 'wx' });
    ops.renameSync(tmp, target);
  } catch (e) {
    try { ops.unlinkSync(tmp); } catch (_e) { /* tmp never created or already gone */ }
    throw refusal('write_failed', `could not write ${NOTE_NAME} (${(e && e.code) || e.message})`);
  }
}

function toIso(clock) {
  const t = clock();
  return (t instanceof Date ? t : new Date(t)).toISOString();
}

function failure(err) {
  const reason = err.dashReason || 'internal_error';
  return Object.freeze({ exit: 2, ok: false, status: 'error', reason, message: redact(err.message).replace(/\s+/g, ' ').slice(0, 500) });
}

/**
 * buildDashboard(ctx) -> frozen result. Never throws for an expected refusal: `{ exit: 2, status: 'error',
 * reason, message }`. Success: `{ exit: 0, ok: true, status: 'written' | 'skipped-non-writer', path,
 * degraded, message? }`.
 */
function buildDashboard(ctx) {
  const ops = ctx.ops || fs;
  try {
    const repoRoot = findRepoRoot(ctx.cwd);
    if (!repoRoot) throw refusal('not_a_git_repo', 'must run inside a git repo (the dashboard source is the repo)');
    const slug = slugFor(ctx.args.slug || null, readRoadmap(repoRoot, ctx));
    const root = vaultRootFor();
    const projectDir = path.join(root, 'project', slug);
    const target = path.join(projectDir, NOTE_NAME);
    checkTarget(projectDir, target, ops);
    const gate = (ctx.writerCheck || writerCheck)(slug, root, ctx.env);
    if (!gate.allow) {
      return Object.freeze({ exit: 0, ok: true, status: 'skipped-non-writer', path: target, degraded: [], message: gate.reason });
    }
    const sections = [...collectSections({ ...ctx, repoRoot, slug, root }), costSection({ ...ctx, repoRoot, slug, root })];
    const text = render(sections, { slug, generated: toIso(ctx.clock), sourceHead: sourceHead(repoRoot) });
    writeAtomic(target, text, ops);
    const degraded = sections.filter((s) => s.state === 'not_available').map((s) => s.name);
    return Object.freeze({ exit: 0, ok: true, status: 'written', path: target, degraded });
  } catch (e) {
    return failure(e);
  }
}

// ---------- CLI ----------

function parseArgs(args) {
  const flags = parseFlags(args, FLAGS);
  const stray = flags._.filter((a) => a.startsWith('--'));
  if (stray.length > 0) usage(`dashboard build: unknown flag ${stray[0].slice(0, 40)}`);
  if (flags._.length > 1) usage(`dashboard build takes at most one <slug>, got ${flags._.length} positional arguments`);
  return { slug: flags._[0] || null, json: flags.json === true };
}

function emit(result, args) {
  if (result.exit !== 0) {
    process.stderr.write(`[a1-tools] dashboard: ${result.reason}: ${result.message}\n`);
    process.exit(2);
  }
  if (result.status === 'skipped-non-writer') warnSkipped('dashboard', result.message);
  const out = args.json
    ? JSON.stringify({ ok: result.ok, path: result.path, status: result.status, degraded: result.degraded })
    : (result.status === 'written' ? result.path : '');
  if (out) process.stdout.write(`${out}\n`);
  process.exit(0);
}

/** @param {string|undefined} sub - only `build` @param {string[]} args */
function cmdDashboard(sub, args) {
  if (!sub) usage('dashboard requires a subcommand: dashboard build [<slug>] [--json]');
  if (sub !== 'build') usage(`unknown dashboard subcommand: ${String(sub).slice(0, 40)} (expected: dashboard build)`);
  const parsed = parseArgs(args);
  const ctx = {
    cwd: process.cwd(), env: process.env, clock: () => new Date(), ops: fs, trace: null, args: parsed,
  };
  emit(buildDashboard(ctx), parsed);
}

module.exports = { cmdDashboard, buildDashboard };
