'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const WORKTREE_STATUSES = new Set(['prepared', 'active', 'handoff', 'cleaned']);
const WORKTREE_EXIT_MODES = new Set(['keep', 'discard', 'handoff']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
// Keeps `<repo-tag>-<slug>` (tag up to 47 bytes) under the 255-byte file name limit.
const SLUG_MAX_BYTES = 200;

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

// A1_NOW_OVERRIDE (ISO string) pins the clock for the id stamp only (tests).
function nowDate() {
  const raw = process.env.A1_NOW_OVERRIDE;
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const e = new Error(`invalid A1_NOW_OVERRIDE: ${raw}`);
    e.code = 'A1_INPUT';
    throw e;
  }
  return d;
}

function nowCompactId(slug) {
  const d = nowDate();
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

// Same repo when the real paths match (a symlinked path names the same repo).
function sameRepo(a, b) {
  return a === b || resolveRealOrAbs(a) === resolveRealOrAbs(b);
}

function findActiveBySlug(reg, repoRoot, slug) {
  return reg.worktrees.find(
    (w) => sameRepo(w.repo_root, repoRoot) && w.slug === slug && w.status !== 'cleaned'
  );
}

function repoParentWorktreeDir(repoRoot) {
  return path.join(path.dirname(repoRoot), 'a1-worktrees');
}

const TAG_NAME_MAX = 40;
const TAG_HASH_LEN = 6;
const NAME_BYTES_MAX = 254; // keep `<prefix>-<slug>` under 255 bytes

function resolveRealOrAbs(p) {
  // git worktree list --porcelain prints realpaths (symlinks resolved, e.g.
  // macOS /tmp -> /private/tmp). path.resolve() alone does not resolve
  // symlinks, so comparing a raw CLI arg against git's output can spuriously
  // mismatch. Prefer the realpath when the path exists on disk; fall back to
  // plain resolve otherwise (path may legitimately not exist yet).
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch (_e) {
    return abs;
  }
}

function kebabSafe(name) {
  const k = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return k || 'repo';
}

// `<kebab(basename, <=maxName)>-<6 hex of sha1(real repo root)>`; the hash keeps
// it unique per repo, the name part is cut first when space is short.
function repoTag(repoRoot, maxLen = Infinity) {
  const hash = crypto
    .createHash('sha1')
    .update(resolveRealOrAbs(repoRoot))
    .digest('hex')
    .slice(0, TAG_HASH_LEN);
  const room = Math.min(TAG_NAME_MAX, maxLen - TAG_HASH_LEN - 1);
  if (room < 1) return hash;
  const name = kebabSafe(path.basename(repoRoot)).slice(0, room).replace(/-+$/, '');
  return `${name || 'repo'}-${hash}`;
}

function activeOtherRepo(reg, repoRoot) {
  return reg.worktrees.filter((w) => w.status !== 'cleaned' && !sameRepo(w.repo_root, repoRoot));
}

// Lookups by id match any entry, so an id is taken by an entry of any repo and status
// (cleaned and same-repo entries included).
// (repoRoot is unused; kept so the call sites stay uniform with holdsPath.)
function holdsId(reg, _repoRoot, id) {
  return reg.worktrees.some((w) => w.id === id);
}

function holdsPath(reg, repoRoot, worktreePath) {
  const want = resolveRealOrAbs(worktreePath);
  return activeOtherRepo(reg, repoRoot).some((w) => resolveRealOrAbs(w.worktree_path) === want);
}

// Suffix the repo tag when ANY entry holds the id; otherwise unchanged.
function disambiguateId(reg, repoRoot, id) {
  return holdsId(reg, repoRoot, id) ? `${id}-${repoTag(repoRoot)}` : id;
}

function disambiguatePath(reg, repoRoot, slug) {
  const dir = repoParentWorktreeDir(repoRoot);
  const plain = path.join(dir, slug);
  if (!holdsPath(reg, repoRoot, plain)) return plain;
  const room = NAME_BYTES_MAX - Buffer.byteLength(slug) - 1;
  return path.join(dir, `${repoTag(repoRoot, room)}-${slug}`);
}

// Id and path are decided separately. idTaken/pathTaken report a collision that
// is still there after disambiguation (the caller must refuse, not write).
function disambiguateNames(reg, repoRoot, slug) {
  const id = disambiguateId(reg, repoRoot, nowCompactId(slug));
  const worktreePath = disambiguatePath(reg, repoRoot, slug);
  return {
    id,
    worktreePath,
    idTaken: holdsId(reg, repoRoot, id),
    pathTaken: holdsPath(reg, repoRoot, worktreePath),
  };
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
  SLUG_MAX_BYTES,
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
  kebabSafe,
  repoTag,
  resolveRealOrAbs,
  disambiguateId,
  disambiguateNames,
  holdsId,
  sameRepo,
  prReviewDir,
  ensurePrReviewDir,
  readFindings,
  findEntryBySlugOrId,
};
