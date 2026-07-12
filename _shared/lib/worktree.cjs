'use strict';

const fs = require('fs');
const path = require('path');

const { usage } = require('./help.cjs');
const { parseFlags, nowIso } = require('./io.cjs');

// worktree registry + git helpers live in lib/worktree-registry.cjs
const {
  WORKTREE_STATUSES,
  WORKTREE_EXIT_MODES,
  SLUG_RE,
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
} = require('./worktree-registry.cjs');

function cmdWorktreePrepare(args) {
  const flags = parseFlags(args, {
    branch: 'string',
    base: 'string',
    'force-reset': 'bool',
  });
  const [repoRootRaw, slug] = flags._;
  if (!repoRootRaw) usage('worktree prepare requires <repo-root>');
  if (!slug) usage('worktree prepare requires <slug>');
  const repoRoot = path.resolve(repoRootRaw);
  const branch = flags.branch || `feature/${slug}`;
  const baseBranch = flags.base || 'main';

  const checks = [];
  const fail = (name, hint) => checks.push({ name, result: 'FAIL', hint });
  const pass = (name) => checks.push({ name, result: 'PASS' });

  // 1. slug valid
  if (!SLUG_RE.test(slug)) {
    process.stderr.write(`error: invalid slug "${slug}" (must match ${SLUG_RE})\n`);
    process.exit(2);
  }
  pass('slug_valid');

  // 2. repo exists & is git
  if (!gitIsRepo(repoRoot)) {
    process.stderr.write(`error: ${repoRoot} is not a git repository\n`);
    process.exit(2);
  }
  pass('repo_is_git');

  // 3. working tree clean
  if (gitWorkingTreeClean(repoRoot)) pass('working_tree_clean');
  else fail('working_tree_clean', 'Working tree has uncommitted changes');

  // 4. base branch exists
  if (gitBranchExists(repoRoot, baseBranch)) pass('base_branch_exists');
  else fail('base_branch_exists', `Base branch "${baseBranch}" does not exist`);

  // 5. target branch free OR not in worktree
  if (gitBranchExists(repoRoot, branch)) {
    if (gitBranchHasWorktree(repoRoot, branch)) {
      fail('target_branch_free', `Branch "${branch}" already has a worktree`);
    } else {
      // branch exists but no worktree — acceptable, we'll attach to it
      pass('target_branch_free');
    }
  } else {
    pass('target_branch_free');
  }

  // 6. worktree path free
  const worktreePath = path.join(repoParentWorktreeDir(repoRoot), slug);
  if (fs.existsSync(worktreePath)) {
    fail('worktree_path_free', `Path ${worktreePath} already exists`);
  } else {
    pass('worktree_path_free');
  }

  // 7. no active registry entry
  const reg = readRegistry();
  const existing = findActiveBySlug(reg, repoRoot, slug);
  if (existing && !flags['force-reset']) {
    fail(
      'no_active_registry_entry',
      `Registry already has active entry ${existing.id} (status=${existing.status}) for this repo+slug`
    );
  } else {
    pass('no_active_registry_entry');
  }

  const blocker = checks.some((c) => c.result === 'FAIL');
  if (blocker) {
    process.stdout.write(JSON.stringify({ status: 'BLOCKER', checks }, null, 2) + '\n');
    process.exit(1);
  }

  // All green — write registry entry
  const id = nowCompactId(slug);
  const entry = {
    id,
    slug,
    repo_root: repoRoot,
    worktree_path: worktreePath,
    branch,
    base_branch: baseBranch,
    status: 'prepared',
    created_at: nowIso(),
    last_status_change: nowIso(),
    agent_brief: null,
    commit_count: 0,
    exit_mode: null,
    phase_history: [`phase=prepare completed=${nowIso()}`],
  };

  // If force-reset, drop the old active entry
  if (flags['force-reset'] && existing) {
    reg.worktrees = reg.worktrees.filter((w) => w.id !== existing.id);
  }
  reg.worktrees.push(entry);
  writeRegistryAtomic(reg);

  return {
    id,
    repo_root: repoRoot,
    worktree_path: worktreePath,
    branch,
    base_branch: baseBranch,
    status: 'prepared',
    checks,
  };
}

function cmdWorktreeEnter(args) {
  const flags = parseFlags(args, {});
  const id = flags._[0];
  if (!id) usage('worktree enter requires <id>');
  const reg = readRegistry();
  const entry = findRegistryEntry(reg, id);
  if (!entry) {
    process.stderr.write(`error: no registry entry with id "${id}"\n`);
    process.exit(1);
  }
  if (entry.status !== 'prepared') {
    process.stderr.write(`error: entry ${id} has status "${entry.status}", expected "prepared"\n`);
    process.exit(1);
  }
  // race-safety: path still free?
  if (fs.existsSync(entry.worktree_path)) {
    process.stderr.write(`error: worktree path ${entry.worktree_path} appeared since prepare\n`);
    process.exit(1);
  }

  // ensure parent dir exists
  fs.mkdirSync(path.dirname(entry.worktree_path), { recursive: true });

  // git worktree add: -b only if branch does not yet exist
  const branchExists = gitBranchExists(entry.repo_root, entry.branch);
  const gitArgs = branchExists
    ? ['worktree', 'add', entry.worktree_path, entry.branch]
    : ['worktree', 'add', '-b', entry.branch, entry.worktree_path, entry.base_branch];

  const res = git(entry.repo_root, gitArgs, { allowFail: true });
  if (res && typeof res === 'object' && res.__error) {
    process.stderr.write(`error: git worktree add failed: ${res.__error}\n`);
    process.exit(1);
  }

  entry.status = 'active';
  entry.last_status_change = nowIso();
  entry.phase_history.push(`phase=enter completed=${nowIso()}`);
  writeRegistryAtomic(reg);

  return {
    id,
    worktree_path: entry.worktree_path,
    branch: entry.branch,
    status: 'active',
  };
}

function cmdWorktreeStatus(args) {
  const flags = parseFlags(args, {});
  const id = flags._[0];
  if (!id) usage('worktree status requires <id>');
  const reg = readRegistry();
  const entry = findRegistryEntry(reg, id);
  if (!entry) {
    process.stderr.write(`error: no registry entry with id "${id}"\n`);
    process.exit(1);
  }

  const result = {
    id: entry.id,
    slug: entry.slug,
    repo_root: entry.repo_root,
    worktree_path: entry.worktree_path,
    branch: entry.branch,
    base_branch: entry.base_branch,
    status: entry.status,
    worktree_exists_on_disk: fs.existsSync(entry.worktree_path),
    has_uncommitted: null,
    commit_count: null,
    branch_ahead: null,
    branch_behind: null,
  };

  if (result.worktree_exists_on_disk && entry.status === 'active') {
    const status = git(entry.worktree_path, ['status', '--porcelain'], { allowFail: true });
    result.has_uncommitted = typeof status === 'string' ? status.length > 0 : null;

    const range = `${entry.base_branch}..${entry.branch}`;
    const aheadOut = git(entry.repo_root, ['rev-list', '--count', range], { allowFail: true });
    if (typeof aheadOut === 'string') {
      const n = parseInt(aheadOut, 10);
      result.branch_ahead = Number.isNaN(n) ? null : n;
      result.commit_count = result.branch_ahead;
    }
    const behindOut = git(entry.repo_root, ['rev-list', '--count', `${entry.branch}..${entry.base_branch}`], {
      allowFail: true,
    });
    if (typeof behindOut === 'string') {
      const n = parseInt(behindOut, 10);
      result.branch_behind = Number.isNaN(n) ? null : n;
    }
  }

  return result;
}

function cmdWorktreeExit(args) {
  const flags = parseFlags(args, {
    mode: 'string',
    'force-discard': 'bool',
  });
  const id = flags._[0];
  if (!id) usage('worktree exit requires <id>');
  if (!flags.mode) usage('worktree exit requires --mode <keep|discard|handoff>');
  if (!WORKTREE_EXIT_MODES.has(flags.mode)) {
    usage(`invalid --mode "${flags.mode}", expected one of: ${[...WORKTREE_EXIT_MODES].join(', ')}`);
  }
  const mode = flags.mode;

  const reg = readRegistry();
  const entry = findRegistryEntry(reg, id);
  if (!entry) {
    process.stderr.write(`error: no registry entry with id "${id}"\n`);
    process.exit(1);
  }
  if (entry.status === 'cleaned') {
    process.stderr.write(`error: entry ${id} is already cleaned\n`);
    process.exit(1);
  }

  let removed = false;
  let branchKept = true;

  if (mode === 'handoff') {
    entry.status = 'handoff';
    entry.exit_mode = 'handoff';
    entry.last_status_change = nowIso();
    entry.phase_history.push(`phase=exit-handoff completed=${nowIso()}`);
    writeRegistryAtomic(reg);
    return {
      id,
      exit_mode: 'handoff',
      status: 'handoff',
      removed: false,
      branch_kept: true,
    };
  }

  // For keep / discard, we need to remove the worktree.
  // For discard, also check unmerged commits unless --force-discard.
  if (mode === 'discard' && !flags['force-discard']) {
    if (gitBranchExists(entry.repo_root, entry.branch)) {
      const aheadOut = git(entry.repo_root, ['rev-list', '--count', `${entry.base_branch}..${entry.branch}`], {
        allowFail: true,
      });
      const ahead = typeof aheadOut === 'string' ? parseInt(aheadOut, 10) : 0;
      if (ahead > 0) {
        process.stderr.write(
          `error: branch "${entry.branch}" is ${ahead} commit(s) ahead of "${entry.base_branch}". ` +
            `Refusing discard. Re-run with --force-discard, or use --mode handoff.\n`
        );
        process.exit(1);
      }
    }
  }

  // Remove worktree (if it exists on disk)
  if (fs.existsSync(entry.worktree_path)) {
    const removeArgs = ['worktree', 'remove'];
    if (mode === 'discard' && flags['force-discard']) removeArgs.push('--force');
    removeArgs.push(entry.worktree_path);
    const res = git(entry.repo_root, removeArgs, { allowFail: true });
    if (res && typeof res === 'object' && res.__error) {
      process.stderr.write(`error: git worktree remove failed: ${res.__error}\n`);
      process.exit(1);
    }
    removed = true;
  } else {
    // Prune stale registration in git if any
    git(entry.repo_root, ['worktree', 'prune'], { allowFail: true });
    removed = true;
  }

  if (mode === 'discard') {
    if (gitBranchExists(entry.repo_root, entry.branch)) {
      const delArgs = ['branch', flags['force-discard'] ? '-D' : '-d', entry.branch];
      const res = git(entry.repo_root, delArgs, { allowFail: true });
      if (res && typeof res === 'object' && res.__error) {
        process.stderr.write(`error: git branch delete failed: ${res.__error}\n`);
        process.exit(1);
      }
      branchKept = false;
    } else {
      branchKept = false;
    }
  }

  entry.status = 'cleaned';
  entry.exit_mode = mode;
  entry.last_status_change = nowIso();
  entry.phase_history.push(`phase=exit-${mode} completed=${nowIso()}`);
  writeRegistryAtomic(reg);

  return {
    id,
    exit_mode: mode,
    status: 'cleaned',
    removed,
    branch_kept: branchKept,
  };
}

function cmdWorktreeList(args) {
  const flags = parseFlags(args, {
    status: 'string',
    'repo-root': 'string',
  });
  const reg = readRegistry();
  let entries = reg.worktrees.slice();
  if (flags.status) {
    if (!WORKTREE_STATUSES.has(flags.status)) {
      usage(`invalid --status "${flags.status}", expected one of: ${[...WORKTREE_STATUSES].join(', ')}`);
    }
    entries = entries.filter((e) => e.status === flags.status);
  }
  if (flags['repo-root']) {
    const abs = path.resolve(flags['repo-root']);
    entries = entries.filter((e) => e.repo_root === abs);
  }
  entries.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return {
    count: entries.length,
    worktrees: entries.map((e) => ({
      id: e.id,
      slug: e.slug,
      status: e.status,
      branch: e.branch,
      base_branch: e.base_branch,
      repo_root: e.repo_root,
      worktree_path: e.worktree_path,
      created_at: e.created_at,
      exit_mode: e.exit_mode,
    })),
  };
}

function cmdWorktreeGc(args) {
  const flags = parseFlags(args, { 'dry-run': 'bool' });
  const reg = readRegistry();
  const stale = [];
  const removedFromRegistry = [];

  for (const e of reg.worktrees) {
    if (e.status === 'cleaned') continue;
    if (!fs.existsSync(e.worktree_path) && e.status !== 'handoff') {
      stale.push({ id: e.id, reason: 'worktree path missing', path: e.worktree_path });
      if (!flags['dry-run']) {
        e.status = 'cleaned';
        e.exit_mode = e.exit_mode || 'gc';
        e.last_status_change = nowIso();
        e.phase_history.push(`phase=gc completed=${nowIso()}`);
        removedFromRegistry.push(e.id);
      }
    }
  }

  if (!flags['dry-run'] && removedFromRegistry.length > 0) writeRegistryAtomic(reg);

  return {
    count: stale.length,
    stale,
    removed: removedFromRegistry,
    dry_run: !!flags['dry-run'],
  };
}

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

function cmdWorktreeAdopt(args) {
  const flags = parseFlags(args, { 'worktree-path': 'string', branch: 'string', base: 'string' });
  const [repoRootRaw, slug] = flags._;
  if (!repoRootRaw || !slug) usage('worktree adopt requires <repo-root> <slug>');

  if (!SLUG_RE.test(slug)) {
    process.stderr.write(`error: invalid slug "${slug}" (must match ${SLUG_RE})\n`);
    process.exit(2);
  }

  const repoRoot = path.resolve(repoRootRaw);
  if (!gitIsRepo(repoRoot)) {
    process.stderr.write(`error: ${repoRoot} is not a git repository\n`);
    process.exit(2);
  }
  const repoRootReal = resolveRealOrAbs(repoRootRaw);

  const wts = gitWorktreeList(repoRoot).filter((w) => path.resolve(w.path) !== repoRootReal);

  let matches;
  if (flags['worktree-path']) {
    const target = resolveRealOrAbs(flags['worktree-path']);
    matches = wts.filter((w) => path.resolve(w.path) === target);
  } else if (flags.branch) {
    matches = wts.filter((w) => w.branch === flags.branch);
  } else {
    matches = wts.filter((w) => path.basename(w.path) === slug);
  }

  if (matches.length === 0) {
    process.stderr.write('error: no git worktree matches; candidates:\n');
    process.stdout.write(JSON.stringify({ status: 'NOT_FOUND', candidates: wts }, null, 2) + '\n');
    process.exit(1);
  }
  if (matches.length > 1) {
    process.stderr.write('error: multiple git worktrees match — pass --worktree-path to disambiguate\n');
    process.stdout.write(JSON.stringify({ status: 'AMBIGUOUS', candidates: wts }, null, 2) + '\n');
    process.exit(1);
  }
  const match = matches[0];

  const reg = readRegistry();
  const existingActive = findActiveBySlug(reg, repoRoot, slug);
  if (existingActive) {
    process.stderr.write(
      `error: registry already has active entry ${existingActive.id} for this repo+slug — nothing to adopt\n`
    );
    process.exit(1);
  }
  const resolvedMatchPath = path.resolve(match.path);
  const existingPath = reg.worktrees.find(
    (w) =>
      w.status !== 'cleaned' &&
      resolveRealOrAbs(w.worktree_path) === resolveRealOrAbs(resolvedMatchPath)
  );
  if (existingPath) {
    process.stderr.write(`error: worktree path already registered as ${existingPath.id}\n`);
    process.exit(1);
  }

  const branch = match.branch || flags.branch || null;
  const baseBranch = flags.base || 'main';
  const id = nowCompactId(slug);
  const commitCountRaw = branch
    ? git(repoRoot, ['rev-list', '--count', `${baseBranch}..${branch}`], { allowFail: true })
    : null;
  const commitCount =
    typeof commitCountRaw === 'string' && commitCountRaw.length > 0 ? parseInt(commitCountRaw, 10) : 0;

  const entry = {
    id,
    slug,
    repo_root: repoRoot,
    worktree_path: resolvedMatchPath,
    branch,
    base_branch: baseBranch,
    status: 'active',
    created_at: nowIso(),
    last_status_change: nowIso(),
    agent_brief: null,
    commit_count: commitCount,
    exit_mode: null,
    phase_history: [`phase=adopt completed=${nowIso()}`],
  };

  reg.worktrees.push(entry);
  writeRegistryAtomic(reg);

  return {
    id,
    slug,
    repo_root: repoRoot,
    worktree_path: resolvedMatchPath,
    branch,
    base_branch: baseBranch,
    status: 'active',
    commit_count: commitCount,
    adopted: true,
  };
}

function cmdWorktreeReconcile(args) {
  const flags = parseFlags(args, { prune: 'bool' });
  const [repoRootRaw] = flags._;
  if (!repoRootRaw) usage('worktree reconcile requires <repo-root>');

  const repoRoot = path.resolve(repoRootRaw);
  if (!gitIsRepo(repoRoot)) {
    process.stderr.write(`error: ${repoRoot} is not a git repository\n`);
    process.exit(2);
  }
  const repoRootReal = resolveRealOrAbs(repoRootRaw);

  const gitWts = gitWorktreeList(repoRoot).filter((w) => path.resolve(w.path) !== repoRootReal);
  const reg = readRegistry();

  // Direction A (registry -> disk): registry entries with no matching git
  // worktree AND no path on disk are stale (orphaned registrations).
  const stale = [];
  const pruned = [];
  for (const e of reg.worktrees) {
    if (e.repo_root !== repoRoot || e.status === 'cleaned') continue;
    const entryPathReal = resolveRealOrAbs(e.worktree_path);
    const hasGitMatch = gitWts.some((w) => path.resolve(w.path) === entryPathReal);
    if (hasGitMatch || fs.existsSync(e.worktree_path)) continue;
    stale.push({
      id: e.id,
      slug: e.slug,
      path: e.worktree_path,
      reason: 'registry entry has no git worktree and path missing on disk',
    });
    if (flags.prune) {
      e.status = 'cleaned';
      e.exit_mode = e.exit_mode || 'reconcile';
      e.last_status_change = nowIso();
      e.phase_history.push(`phase=reconcile completed=${nowIso()}`);
      pruned.push(e.id);
    }
  }

  // Direction B (disk -> registry): git worktrees with no non-cleaned
  // registry entry are adopt candidates.
  const adoptCandidates = [];
  for (const w of gitWts) {
    const wPathReal = resolveRealOrAbs(w.path);
    const hasRegMatch = reg.worktrees.some(
      (e) => e.status !== 'cleaned' && resolveRealOrAbs(e.worktree_path) === wPathReal
    );
    if (hasRegMatch) continue;
    adoptCandidates.push({
      path: w.path,
      branch: w.branch || null,
      hint: `a1-tools worktree adopt ${repoRoot} <slug> --worktree-path ${w.path}`,
    });
  }

  if (flags.prune && pruned.length > 0) writeRegistryAtomic(reg);

  return {
    repo_root: repoRoot,
    in_sync: stale.length === 0 && adoptCandidates.length === 0,
    stale,
    pruned,
    adopt_candidates: adoptCandidates,
    prune: !!flags.prune,
  };
}

module.exports = {
  cmdWorktreePrepare,
  cmdWorktreeEnter,
  cmdWorktreeStatus,
  cmdWorktreeExit,
  cmdWorktreeList,
  cmdWorktreeGc,
  cmdWorktreeAdopt,
  cmdWorktreeReconcile,
};
