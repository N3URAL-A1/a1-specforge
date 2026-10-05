'use strict';

// ---------------------------------------------------------------------------
// intent-worktree — the intent worktree of a write action (spec 011, Wave 6
// part B, FR-043; Robert's decision 2026-09-28). The child of new-feature,
// continue-feature, plan, execute and fix never runs in the owner's checkout:
// `run` creates, under the project lock, a worktree of its own
//
//   <passwd home>/claude-projects/a1-worktrees/<project>-intent-<id>/
//   branch intent/<id>, based on the tip commit of the default branch
//
// with `git worktree add -b intent/<id> <folder> <base commit>` in the project
// realpath, and records it in the a1-worktree registry of the passwd home
// (the fields `worktree prepare` writes, plus intent_id, intent_action and
// intent_outcome). The base is a commit, never the working tree: uncommitted
// changes, the checked-out branch or a detached HEAD of the primary checkout
// neither block the intent nor enter the worktree, and nothing here runs
// checkout, switch, reset, stash, merge or commit there.
//
// Every git call runs GIT_BIN as an argv array with the runner env of the git
// wrapper (built from nothing, GIT_CONFIG_NOSYSTEM/GLOBAL, the FR-042 keys)
// and GIT_LEADING, after the wrapper's repository config gate has passed for
// the project (FR-048). The registry entry is written only after `git
// worktree add` exited 0; nothing is removed after a failed creation (a
// leftover folder or branch blocks only the same id). a1 never merges,
// pushes or removes the worktree: cleanup is the owner's `a1-worktree exit`.
//
// Not cmdWorktreePrepare: that one exits the process and demands a clean
// primary tree, which the decision drops. Not readRegistry/writeRegistryAtomic
// of worktree-registry.cjs either: they resolve the registry from
// $A1_WORKTREE_REGISTRY or os.homedir(), and FR-043 names the passwd home's
// registry; with $A1_WORKTREE_REGISTRY set, a1-worktree would read another
// file than the one written here, so creation refuses (registry_override).
// Known upstream gap: worktree-registry.cjs has no lock, so a concurrent
// `a1-worktree` write can lose an entry written here (and vice versa).
// A worktree this run created and no child touched is rolled back
// (rollbackIntentWorktree) when `run` stops before the spawn; after
// `git worktree add` a folder at the wrong place or a registry write failure
// is rolled back at once. This module is loaded only by `run`
// (intent-run.cjs) and `complete` (intent-result.cjs), never on a1-tools'
// child-mode path.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { INTENT_MAX_OPEN_WORKTREES, INTENT_ID_RE, SAFE_PATH_RE } = require('./intent-constants.cjs');
const { GIT_BIN, GIT_LEADING, runnerEnv, repoConfigProblemAt } = require('./intent-git.cjs');
const { childDeps } = require('./intent-child.cjs');

const REGISTRY_FILE = '.a1-worktrees-registry.json';
const PROJECTS_DIR = 'claude-projects';
const WORKTREES_DIR = 'a1-worktrees';
const BRANCH_PREFIX = 'intent/';
const BASE_CANDIDATES = Object.freeze(['main', 'master']);
const DETAIL_MAX_CHARS = 200;
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

const defaultDeps = () => {
  const c = childDeps();
  return { passwdHome: c.passwdHome, realpath: c.realpath, now: Date.now, env: process.env, git: GIT_BIN };
};

const isoNow = (d) => new Date(d.now()).toISOString();
const registryPath = (d) => path.join(d.passwdHome(), REGISTRY_FILE);
const slugOf = (project, id) => `${project}-intent-${id}`;
const branchOf = (id) => `${BRANCH_PREFIX}${id}`;
const notIsolated = (detail) => Object.freeze({ ok: false, reason: 'workspace_not_isolated', detail: String(detail).slice(0, DETAIL_MAX_CHARS) });

class RegistryUnreadable extends Error {}

// The registry of the passwd home: a missing file is empty; anything else
// that is not a regular file holding { worktrees: [] } is unreadable.
function readIntentRegistry(d) {
  const file = registryPath(d);
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!st) return Object.freeze({ version: 1, worktrees: Object.freeze([]) });
  if (!st.isFile()) throw new RegistryUnreadable(`~/${REGISTRY_FILE} is not a regular file`);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_e) {
    throw new RegistryUnreadable(`~/${REGISTRY_FILE} is not JSON`);
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.worktrees)) throw new RegistryUnreadable(`~/${REGISTRY_FILE} has no worktrees list`);
  return doc;
}

// Same bytes as worktree-registry's writeRegistryAtomic, at the passwd home;
// the temp name carries random bytes, so a stale temp file of an earlier
// process with the same pid never blocks the write (review m3).
function writeIntentRegistry(reg, d) {
  const file = registryPath(d);
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(tmp, file);
}

const intentSlugRe = (project) => new RegExp(`^${project.replace(/[^a-z0-9-]/g, '')}-intent-${UUID_V4}$`);

// FR-043 (c) — entries of the project (repo_root = its realpath, slug
// <project>-intent-<uuid>) whose status is not `cleaned`.
const openCount = (reg, project, projectReal) => {
  const re = intentSlugRe(project);
  return reg.worktrees.filter((w) => w && w.repo_root === projectReal && re.test(String(w.slug)) && w.status !== 'cleaned').length;
};
function countOpenIntentWorktrees(project, projectReal, deps = {}) {
  return openCount(readIntentRegistry({ ...defaultDeps(), ...deps }), project, projectReal);
}

// One hardened git call in `cwd`. -> { status, stdout, stderr }.
function gitRun(args, cwd, env, d) {
  const r = spawnSync(d.git, [...GIT_LEADING, ...args], { cwd, env, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: r.error ? null : r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || (r.error && r.error.message) || '') };
}

const commitOf = (ref, cwd, env, d) => {
  const r = gitRun(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], cwd, env, d);
  return r.status === 0 ? r.stdout.trim() : null;
};

// The default branch: the local branch refs/remotes/origin/HEAD names, else
// main, else master. -> { branch, commit } | null.
function defaultBase(cwd, env, d) {
  const head = gitRun(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd, env, d);
  const named = head.status === 0 ? head.stdout.trim().replace(/^refs\/remotes\/origin\//, '') : null;
  const candidates = [...(named && /^[A-Za-z0-9._\/-]+$/.test(named) ? [named] : []), ...BASE_CANDIDATES];
  for (const branch of candidates) {
    const commit = commitOf(`refs/heads/${branch}`, cwd, env, d);
    if (commit) return { branch, commit };
  }
  return null;
}

const expectedFolder = (project, id, d) => path.join(d.realpath(path.join(d.passwdHome(), PROJECTS_DIR)), WORKTREES_DIR, slugOf(project, id));

// Everything before `git worktree add`: repository, config gate, base,
// folder and branch free. -> { ok: true, folder, base, env } | notIsolated.
function preflight(project, projectReal, id, d) {
  const env = runnerEnv(d.passwdHome(), d.env, path.dirname(projectReal));
  const top = gitRun(['rev-parse', '--show-toplevel'], projectReal, env, d);
  const topReal = top.status === 0 ? (() => { try { return d.realpath(top.stdout.trim()); } catch (_e) { return null; } })() : null;
  if (topReal !== projectReal) return notIsolated('not_a_repo');
  const gate = repoConfigProblemAt(projectReal, env);
  if (gate !== null) return notIsolated(`repo_config: ${gate}`);
  const base = defaultBase(projectReal, env, d);
  if (base === null) return notIsolated('base_missing');
  const folder = expectedFolder(project, id, d);
  if (!SAFE_PATH_RE.test(folder) || path.normalize(folder) !== folder) return notIsolated('path_mismatch');
  let taken;
  try {
    taken = Boolean(fs.lstatSync(folder, { throwIfNoEntry: false }));
  } catch (e) {
    taken = true; // e.g. ENOTDIR: a file where a folder on the way should be
  }
  if (taken) return notIsolated('path_exists');
  if (commitOf(`refs/heads/${branchOf(id)}`, projectReal, env, d) !== null) return notIsolated('branch_exists');
  return { ok: true, folder, base, env };
}

function registryEntry({ project, projectReal, id, action }, folder, base, d) {
  const at = isoNow(d);
  return {
    id: `${at.replace(/[-:]/g, '').slice(0, 13).replace('T', '-')}-${slugOf(project, id)}`,
    slug: slugOf(project, id),
    repo_root: projectReal,
    worktree_path: folder,
    branch: branchOf(id),
    base_branch: base.branch,
    status: 'active',
    created_at: at,
    last_status_change: at,
    agent_brief: null,
    commit_count: 0,
    exit_mode: null,
    phase_history: [`phase=intent-create completed=${at}`],
    intent_id: id,
    intent_action: action,
    intent_outcome: 'running',
  };
}

// FR-043 -> { ok: true, path, branch, base } | { ok: false, reason:
// 'intent_worktree_limit' | 'workspace_not_isolated', detail }.
function createIntentWorktree(input, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const { project, projectReal, id } = input;
  if (!INTENT_ID_RE.test(String(id)) || !intentSlugRe(project).test(slugOf(project, id))) throw new Error('createIntentWorktree: invalid project or id');
  if (d.env.A1_WORKTREE_REGISTRY) return notIsolated('registry_override: $A1_WORKTREE_REGISTRY is set; a1-worktree would not see the entry');
  let reg;
  try {
    reg = readIntentRegistry(d);
  } catch (e) {
    if (e instanceof RegistryUnreadable) return notIsolated(`registry_unreadable: ${e.message}`);
    throw e;
  }
  const open = openCount(reg, project, projectReal);
  if (open >= INTENT_MAX_OPEN_WORKTREES) return Object.freeze({ ok: false, reason: 'intent_worktree_limit', detail: `${open} open intent worktrees` });
  const pre = preflight(project, projectReal, id, d);
  if (!pre.ok) return pre;
  const add = gitRun(['worktree', 'add', '-b', branchOf(id), pre.folder, pre.base.commit], projectReal, pre.env, d);
  if (add.status !== 0) return notIsolated(`worktree_add_failed: ${add.stderr.split('\n')[0]}`);
  const undo = (detail) => {
    removeWorktreeAndBranch(projectReal, pre.folder, id, pre.env, d);
    return notIsolated(detail);
  };
  if (!placedAsExpected(pre.folder, projectReal, slugOf(project, id), pre.env, d)) return undo('path_mismatch');
  const entry = registryEntry(input, pre.folder, pre.base, d);
  try {
    writeIntentRegistry({ ...reg, worktrees: [...reg.worktrees, entry] }, d);
  } catch (e) {
    return undo(`registry_unreadable: cannot write ~/${REGISTRY_FILE} (${e.code || e.message})`);
  }
  return Object.freeze({ ok: true, path: pre.folder, branch: entry.branch, base: pre.base.branch });
}

// After `worktree add`: the folder is at its expected realpath and git named
// its admin dir <primary>/.git/worktrees/<slug> (a stale admin dir of that
// name makes git pick another one, which the child's anchor check refuses).
function placedAsExpected(folder, projectReal, slug, env, d) {
  let real;
  try {
    real = d.realpath(folder);
  } catch (_e) {
    return false;
  }
  if (real !== folder) return false;
  const r = gitRun(['rev-parse', '--git-dir'], folder, env, d);
  if (r.status !== 0) return false;
  try {
    return d.realpath(path.resolve(folder, r.stdout.trim())) === path.join(d.realpath(path.join(projectReal, '.git')), 'worktrees', slug);
  } catch (_e) {
    return false;
  }
}

// `git worktree remove --force <folder>` and `git branch -D intent/<id>`;
// best effort, each step independent. -> the steps that failed.
function removeWorktreeAndBranch(projectReal, folder, id, env, d) {
  const failed = [];
  if (fs.lstatSync(folder, { throwIfNoEntry: false })) {
    if (gitRun(['worktree', 'remove', '--force', folder], projectReal, env, d).status !== 0) failed.push('worktree_remove');
  }
  if (commitOf(`refs/heads/${branchOf(id)}`, projectReal, env, d) !== null) {
    if (gitRun(['branch', '-D', branchOf(id)], projectReal, env, d).status !== 0) failed.push('branch_delete');
  }
  return failed;
}

// M1 of the part B review — `run` stopped between the creation and the
// spawn: the worktree it created (no child touched it) goes again, with its
// branch and registry entry, so the cap and a retry of the same id are free.
// -> the steps that failed (empty: clean).
function rollbackIntentWorktree({ project, projectReal, id }, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const env = runnerEnv(d.passwdHome(), d.env, path.dirname(projectReal));
  const failed = removeWorktreeAndBranch(projectReal, expectedFolder(project, id, d), id, env, d);
  try {
    const reg = readIntentRegistry(d);
    if (reg.worktrees.some((w) => w && w.intent_id === id && w.status !== 'cleaned')) {
      writeIntentRegistry({ ...reg, worktrees: reg.worktrees.filter((w) => !(w && w.intent_id === id && w.status !== 'cleaned')) }, d);
    }
  } catch (_e) {
    failed.push('registry');
  }
  return Object.freeze(failed);
}

const openEntryOf = (reg, id) => reg.worktrees.find((w) => w && w.intent_id === id && w.status !== 'cleaned') || null;

// { branch, worktree_path (home-relative) } of the intent's open entry, or null.
function intentWorktreeInfo(id, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const entry = openEntryOf(readIntentRegistry(d), id);
  if (entry === null) return null;
  const home = d.realpath(d.passwdHome()); // the entry holds realpaths
  const wt = String(entry.worktree_path);
  return Object.freeze({ branch: entry.branch, worktree_path: wt.startsWith(`${home}/`) ? `~/${wt.slice(home.length + 1)}` : wt });
}

// FR-043 (e) — `done` -> status handoff, intent_outcome done; `failed`
// (any reason) -> status stays active, intent_outcome failed plus the reason.
// -> the updated entry, or null when the intent has no open entry.
function finishIntentWorktree(id, outcome, failureReason, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const reg = readIntentRegistry(d);
  const entry = openEntryOf(reg, id);
  if (entry === null) return null;
  const at = isoNow(d);
  const done = outcome === 'done';
  const next = {
    ...entry,
    status: done ? 'handoff' : 'active',
    intent_outcome: done ? 'done' : 'failed',
    ...(done ? {} : { intent_failure_reason: failureReason }),
    last_status_change: at,
    phase_history: [...(Array.isArray(entry.phase_history) ? entry.phase_history : []), `phase=intent-${done ? 'done' : 'failed'} completed=${at}`],
  };
  writeIntentRegistry({ ...reg, worktrees: reg.worktrees.map((w) => (w === entry ? next : w)) }, d);
  return Object.freeze(next);
}

module.exports = {
  countOpenIntentWorktrees,
  createIntentWorktree,
  rollbackIntentWorktree,
  finishIntentWorktree,
  intentWorktreeInfo,
  expectedIntentWorktree: (project, id, deps = {}) => expectedFolder(project, id, { ...defaultDeps(), ...deps }),
};
