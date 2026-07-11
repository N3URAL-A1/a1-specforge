'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const WORKTREE_STATUSES = new Set(['prepared', 'active', 'handoff', 'cleaned']);
const WORKTREE_EXIT_MODES = new Set(['keep', 'discard', 'handoff']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function worktreeRegistryPath() {
  if (process.env.A1_WORKTREE_REGISTRY) return process.env.A1_WORKTREE_REGISTRY;
  return path.join(os.homedir(), '.a1-worktrees-registry.json');
}

function readRegistry() {
  const p = worktreeRegistryPath();
  if (!fs.existsSync(p)) return { version: 1, worktrees: [] };
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.worktrees)) {
      throw new Error('registry shape invalid');
    }
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch (e) {
    throw new Error(`cannot parse worktree registry ${p}: ${e.message}`);
  }
}

function writeRegistryAtomic(reg) {
  const p = worktreeRegistryPath();
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function nowCompactId(slug) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}`;
  return `${stamp}-${slug}`;
}

function git(repoRoot, args, opts = {}) {
  // Returns trimmed stdout. Throws Error with stderr on non-zero exit unless allowFail.
  try {
    const out = execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch (e) {
    const msg = (e.stderr && e.stderr.toString().trim()) || e.message;
    if (opts.allowFail) return { __error: msg, __code: e.status };
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

function gitIsRepo(repoRoot) {
  if (!fs.existsSync(repoRoot)) return false;
  const res = git(repoRoot, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
  if (typeof res === 'string') return res === 'true';
  return false;
}

function gitWorkingTreeClean(repoRoot) {
  const out = git(repoRoot, ['status', '--porcelain']);
  return out.length === 0;
}

function gitBranchExists(repoRoot, branch) {
  const res = git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
    allowFail: true,
  });
  return typeof res === 'string' && res.length > 0;
}

function gitWorktreeList(repoRoot) {
  // Returns array of { path, branch }
  const out = git(repoRoot, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let cur = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) entries.push(cur);
      cur = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  if (cur.path) entries.push(cur);
  return entries;
}

function gitBranchHasWorktree(repoRoot, branch) {
  return gitWorktreeList(repoRoot).some((w) => w.branch === branch);
}

function findRegistryEntry(reg, id) {
  return reg.worktrees.find((w) => w.id === id);
}

function findActiveBySlug(reg, repoRoot, slug) {
  return reg.worktrees.find(
    (w) => w.repo_root === repoRoot && w.slug === slug && w.status !== 'cleaned'
  );
}

function repoParentWorktreeDir(repoRoot) {
  return path.join(path.dirname(repoRoot), 'a1-worktrees');
}

function prReviewDir(worktreePath) {
  return path.join(worktreePath, '.a1-review');
}

function ensurePrReviewDir(worktreePath) {
  const d = prReviewDir(worktreePath);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function readFindings(worktreePath) {
  const p = path.join(prReviewDir(worktreePath), 'findings.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`cannot parse findings.json at ${p}: ${e.message}`);
  }
}

function findEntryBySlugOrId(reg, slugOrId) {
  // Prefer id match (exact, includes timestamp), fall back to unique slug.
  const byId = reg.worktrees.find((w) => w.id === slugOrId);
  if (byId) return byId;
  const bySlug = reg.worktrees.filter(
    (w) => w.slug === slugOrId && w.status !== 'cleaned'
  );
  if (bySlug.length === 1) return bySlug[0];
  if (bySlug.length > 1) {
    throw new Error(
      `slug "${slugOrId}" matches ${bySlug.length} non-cleaned entries; pass id instead`
    );
  }
  return null;
}

module.exports = {
  WORKTREE_STATUSES,
  WORKTREE_EXIT_MODES,
  SLUG_RE,
  worktreeRegistryPath,
  readRegistry,
  writeRegistryAtomic,
  nowCompactId,
  git,
  gitIsRepo,
  gitWorkingTreeClean,
  gitBranchExists,
  gitWorktreeList,
  gitBranchHasWorktree,
  findRegistryEntry,
  findActiveBySlug,
  repoParentWorktreeDir,
  prReviewDir,
  ensurePrReviewDir,
  readFindings,
  findEntryBySlugOrId,
};
