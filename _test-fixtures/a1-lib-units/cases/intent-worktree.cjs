'use strict';

// intent-worktree.cjs — the worktree of a write intent (spec 011, FR-043):
// created from the default branch's tip commit under
// <passwd home>/claude-projects/a1-worktrees/<project>-intent-<id>, recorded
// in the passwd home's registry, capped per project, rolled back when `run`
// stops before the spawn. All deps (passwd home, env, clock) are injected;
// git is the real /usr/bin/git against a throwaway repository.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { check, eq, throws, done } = require('../lib.cjs');

if (!process.argv[3] || !os.homedir().startsWith(process.argv[3])) {
  check('W0 HOME is the suite temp home', false, `${os.homedir()} (run through run-tests.sh)`);
  done();
  process.exit(1);
}

const W = require(path.join(process.argv[2], 'intent-worktree.cjs'));
const home = fs.realpathSync(os.homedir());
const projects = path.join(home, 'claude-projects');
const project = 'demo';
const projectReal = path.join(projects, project);
const registry = path.join(home, '.a1-worktrees-registry.json');
const deps = { passwdHome: () => home, realpath: fs.realpathSync, now: () => Date.UTC(2026, 9, 8, 8, 0, 0), env: {} };
const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const ID2 = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const folderOf = (id) => path.join(projects, 'a1-worktrees', `demo-intent-${id}`);
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (...args) => execFileSync('/usr/bin/git', ['-C', projectReal, ...args], { env: gitEnv, encoding: 'utf8' }).trim();
const branchExists = (b) => { try { git('rev-parse', '--verify', '--quiet', `refs/heads/${b}`); return true; } catch (_e) { return false; } };
const readReg = () => JSON.parse(fs.readFileSync(registry, 'utf8'));

fs.mkdirSync(projectReal, { recursive: true });
execFileSync('/usr/bin/git', ['init', '-q', '-b', 'main', projectReal], { env: gitEnv });

// W1 — refusals before git runs.
throws('W1 invalid id throws', () => W.createIntentWorktree({ project, projectReal, id: 'not-a-uuid', action: 'plan' }, deps), /invalid project or id/);
throws('W1 uppercase id throws', () => W.createIntentWorktree({ project, projectReal, id: ID.toUpperCase(), action: 'plan' }, deps), /invalid project or id/);
{
  const r = W.createIntentWorktree({ project, projectReal, id: ID, action: 'plan' }, { ...deps, env: { A1_WORKTREE_REGISTRY: '/tmp/other.json' } });
  check('W1 $A1_WORKTREE_REGISTRY set: registry_override', r.ok === false && r.reason === 'workspace_not_isolated' && /^registry_override/.test(r.detail), JSON.stringify(r));
}

// W2 — a repository without a commit on main/master: base_missing.
{
  const r = W.createIntentWorktree({ project, projectReal, id: ID, action: 'plan' }, deps);
  eq('W2 no base commit', { ok: r.ok, detail: r.detail }, { ok: false, detail: 'base_missing' });
}
fs.writeFileSync(path.join(projectReal, 'a.txt'), 'a\n');
git('add', 'a.txt');
git('commit', '-q', '-m', 'init');
const baseCommit = git('rev-parse', 'HEAD');

// W3 — a folder that is not the repository's top level: not_a_repo.
{
  const sub = path.join(projects, 'plain');
  fs.mkdirSync(sub, { recursive: true });
  const r = W.createIntentWorktree({ project: 'plain', projectReal: sub, id: ID, action: 'plan' }, deps);
  eq('W3 not a repo', r.detail, 'not_a_repo');
}

// W4 — a repository config key outside the allow list: refused by the gate.
{
  git('config', 'core.sshCommand', 'touch /tmp/PWNED');
  const r = W.createIntentWorktree({ project, projectReal, id: ID, action: 'plan' }, deps);
  check('W4 repo config gate refuses', r.ok === false && /^repo_config:/.test(r.detail), JSON.stringify(r));
  git('config', '--unset', 'core.sshCommand');
}

// W5 — the happy path: folder, branch from the base commit, registry entry.
{
  // Uncommitted changes in the primary checkout neither block nor enter.
  fs.writeFileSync(path.join(projectReal, 'dirty.txt'), 'wip\n');
  const r = W.createIntentWorktree({ project, projectReal, id: ID, action: 'plan' }, deps);
  eq('W5 created', r, { ok: true, path: folderOf(ID), branch: `intent/${ID}`, base: 'main' });
  check('W5 folder exists without the dirty file', fs.existsSync(path.join(folderOf(ID), 'a.txt')) && !fs.existsSync(path.join(folderOf(ID), 'dirty.txt')));
  eq('W5 branch at the base commit', git('rev-parse', `intent/${ID}`), baseCommit);
  const e = readReg().worktrees[0];
  eq('W5 registry entry', { slug: e.slug, repo_root: e.repo_root, worktree_path: e.worktree_path, branch: e.branch, base_branch: e.base_branch, status: e.status, intent_id: e.intent_id, intent_action: e.intent_action, intent_outcome: e.intent_outcome, created_at: e.created_at },
    { slug: `demo-intent-${ID}`, repo_root: projectReal, worktree_path: folderOf(ID), branch: `intent/${ID}`, base_branch: 'main', status: 'active', intent_id: ID, intent_action: 'plan', intent_outcome: 'running', created_at: '2026-10-08T08:00:00.000Z' });
  eq('W5 open count 1', W.countOpenIntentWorktrees(project, projectReal, deps), 1);
  eq('W5 expectedIntentWorktree', W.expectedIntentWorktree(project, ID, deps), folderOf(ID));
  eq('W5 info is home-relative', W.intentWorktreeInfo(ID, deps), { branch: `intent/${ID}`, worktree_path: `~/claude-projects/a1-worktrees/demo-intent-${ID}` });
}

// W6 — the same id again: path_exists; folder gone but branch left: branch_exists.
{
  eq('W6 same id: path_exists', W.createIntentWorktree({ project, projectReal, id: ID, action: 'plan' }, deps).detail, 'path_exists');
}

// W7 — finish: done -> handoff; failed keeps active with the reason.
{
  const f = W.finishIntentWorktree(ID, 'failed', 'child_failed', deps);
  eq('W7 failed: active + reason', { status: f.status, outcome: f.intent_outcome, reason: f.intent_failure_reason }, { status: 'active', outcome: 'failed', reason: 'child_failed' });
  const d = W.finishIntentWorktree(ID, 'done', null, deps);
  eq('W7 done: handoff', { status: d.status, outcome: d.intent_outcome }, { status: 'handoff', outcome: 'done' });
  eq('W7 phase history appended', d.phase_history.slice(-2), ['phase=intent-failed completed=2026-10-08T08:00:00.000Z', 'phase=intent-done completed=2026-10-08T08:00:00.000Z']);
  eq('W7 unknown intent: null', W.finishIntentWorktree(ID2, 'done', null, deps), null);
  eq('W7 info of unknown intent: null', W.intentWorktreeInfo(ID2, deps), null);
}

// W8 — rollback removes folder, branch and the open entry.
// Red-making change: dropping the registry filter in rollbackIntentWorktree (the cap stays used).
{
  eq('W8 rollback clean', W.rollbackIntentWorktree({ project, projectReal, id: ID }, deps), []);
  check('W8 folder removed', !fs.existsSync(folderOf(ID)));
  check('W8 branch removed', !branchExists(`intent/${ID}`));
  eq('W8 open count back to 0', W.countOpenIntentWorktrees(project, projectReal, deps), 0);
}

// W9 — a leftover branch without a folder blocks only the same id.
{
  git('branch', `intent/${ID2}`, 'main');
  eq('W9 branch_exists', W.createIntentWorktree({ project, projectReal, id: ID2, action: 'plan' }, deps).detail, 'branch_exists');
  git('branch', '-D', `intent/${ID2}`);
}

// W10 — the cap: three open entries of this project refuse a fourth;
// cleaned entries, other projects and other repo roots do not count.
// Red-making change: counting `cleaned` entries as open.
{
  const ent = (id, extra = {}) => ({ slug: `demo-intent-${id}`, repo_root: projectReal, status: 'active', intent_id: id, ...extra });
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
  fs.writeFileSync(registry, JSON.stringify({ version: 1, worktrees: [ent(ids[0]), ent(ids[1]), ent(ids[2], { status: 'cleaned' }), ent(ids[2], { repo_root: '/elsewhere' }), { slug: `other-intent-${ids[2]}`, repo_root: projectReal, status: 'active' }, { slug: 'demo-feature-x', repo_root: projectReal, status: 'active' }] }));
  eq('W10 open count ignores cleaned/other', W.countOpenIntentWorktrees(project, projectReal, deps), 2);
  fs.writeFileSync(registry, JSON.stringify({ version: 1, worktrees: ids.map((i) => ent(i)) }));
  const r = W.createIntentWorktree({ project, projectReal, id: ID, action: 'plan' }, deps);
  eq('W10 fourth refused', { ok: r.ok, reason: r.reason, detail: r.detail }, { ok: false, reason: 'intent_worktree_limit', detail: '3 open intent worktrees' });
}

// W11 — an unreadable registry is refused, never overwritten.
{
  const bad = (name, setup) => {
    fs.rmSync(registry, { force: true });
    setup();
    const before = fs.lstatSync(registry).isSymbolicLink() ? fs.readlinkSync(registry) : fs.readFileSync(registry, 'utf8');
    const r = W.createIntentWorktree({ project, projectReal, id: ID, action: 'plan' }, deps);
    const after = fs.lstatSync(registry).isSymbolicLink() ? fs.readlinkSync(registry) : fs.readFileSync(registry, 'utf8');
    check(`W11 ${name}: registry_unreadable, unchanged`, r.ok === false && /^registry_unreadable/.test(r.detail) && before === after, JSON.stringify(r));
  };
  bad('not JSON', () => fs.writeFileSync(registry, '{'));
  bad('no worktrees list', () => fs.writeFileSync(registry, '{"version":1}'));
  bad('a symlink', () => { fs.writeFileSync(path.join(home, 'real-reg.json'), '{"version":1,"worktrees":[]}'); fs.symlinkSync(path.join(home, 'real-reg.json'), registry); });
  fs.rmSync(registry, { force: true });
  check('W11 no worktree folder left behind', !fs.existsSync(folderOf(ID)));
}

done();
