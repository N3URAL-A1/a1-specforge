'use strict';

// feature-close.cjs (spec 027 FR-026, plan D16): `feature close` against REAL git repositories (a bare origin, a primary clone,
// a worktree made by `worktree prepare`, gate logs written by a real gated command), a temp vault and the real CLI children
// (worktree, run record, code-scope, spec). Only gh is faked: a node script named by A1_GH_BIN answers `pr view` and
// `pr list --state merged` from a JSON state file (it exits 1 on any other --state, so the sweep cannot widen its query).
// Each case builds its own tree under the suite temp dir, with HOME, the worktree registry and the vault redirected there.
// The spec header is a copy of the real spec 028 frontmatter (status set to implementing). Literals only.
//
// Measured red 2026-11-23 (scratch copy of feature-close.cjs, one edit each, this file run):
//   the MERGED check removed                                   -> FC3
//   delete-all candidates (judge always {del:true})            -> FC6, FC7, FC8
//   the tip comparison removed (any merged PR entry deletes)   -> FC8
//   worktree exit moved after stages/release/spec              -> FC5
//   --force-discard added to the exit call                     -> FC5
//   the checked-out-worktree exclusion removed                 -> FC6 (git refuses that delete, exit 1)
//   the spec-done skip removed                                 -> FC2
//   recordRuns records only pr-<n> and the spec id             -> FC16
//   pendingSharedState removed                                 -> FC17

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'fc-'));
const TOOLS = path.join(LIB, '..', 'a1-tools.cjs');
const SPEC_ID = 'fx-spec';
const BASE_ENV = { PATH: process.env.PATH, HOME: path.join(WORK, 'home'), TMPDIR: process.env.TMPDIR || '/tmp', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
fs.mkdirSync(BASE_ENV.HOME, { recursive: true });
const SPEC_TEXT = [
  '---', `id: ${SPEC_ID}`, 'project: proj-a', 'feature_slug: fx', 'title: "Fixture spec"', 'status: implementing', 'created: 2026-11-14', 'phase_history:',
  '  - "phase=discover completed=2026-11-14T16:41:06.178Z"', '  - "phase=plan completed=2026-11-14T17:05:38.297Z"', 'verify_failures: []', 'size: L', 'type: spec', '---', '',
  '# Fixture spec', '', '> Spec ID: `fx-spec` - Project: `proj-a` - Status: `implementing`', '',
].join('\n');
const FAKE_GH = [
  '#!/usr/bin/env node', "const fs = require('fs');", "const st = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));", 'const a = process.argv.slice(2);',
  "if (a[0] === 'pr' && a[1] === 'view') { const v = st.view[a[2]]; if (!v) { process.stderr.write('no pull request\\n'); process.exit(1); } process.stdout.write(JSON.stringify(v)); process.exit(0); }",
  "if (a[0] === 'pr' && a[1] === 'list') {",
  "  if (st.list_fail || a[a.indexOf('--state') + 1] !== 'merged') { process.stderr.write('gh: list failed\\n'); process.exit(1); }",
  "  process.stdout.write(JSON.stringify(st.merged[a[a.indexOf('--head') + 1]] || [])); process.exit(0); }",
  'process.exit(1);', '',
].join('\n');

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: BASE_ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const gitOk = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { env: BASE_ENV, encoding: 'utf8' }).status === 0;
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_e) { return null; } };
const tools = (cwd, env, args) => spawnSync(process.execPath, [TOOLS, ...args], { cwd, env, encoding: 'utf8', timeout: 120000 });
const commit = (cwd, file, text) => { fs.writeFileSync(path.join(cwd, file), text); git(cwd, 'add', file); git(cwd, 'commit', '-q', '-m', file); return git(cwd, 'rev-parse', 'HEAD'); };

/** One tree: bare origin, primary clone `proj-a`, a worktree for feature/feat (two real gate logs), the branch squash-merged on origin. */
function build(name, o = {}) {
  const root = path.join(WORK, name);
  fs.mkdirSync(root, { recursive: true });
  const t = {
    root, A: path.join(root, 'proj-a'), origin: path.join(root, 'origin.git'), B: path.join(root, 'proj-b'),
    reg: path.join(root, 'registry.json'), spec: path.join(root, 'vault', 'project', 'proj-a', 'spec', `${SPEC_ID}.md`), state: path.join(root, 'gh-state.json'),
  };
  t.env = { ...BASE_ENV, A1_WORKTREE_REGISTRY: t.reg, A1_VAULT_ROOT: path.join(root, 'vault'), A1_GH_BIN: path.join(root, 'gh.cjs'), FAKE_GH_STATE: t.state };
  fs.mkdirSync(path.join(root, 'vault', 'pattern', 'a1-learnings'), { recursive: true });
  fs.mkdirSync(path.dirname(t.spec), { recursive: true });
  fs.writeFileSync(t.spec, SPEC_TEXT);
  fs.writeFileSync(t.env.A1_GH_BIN, FAKE_GH, { mode: 0o755 });
  git(root, 'init', '-q', '--bare', '-b', 'main', t.origin);
  git(root, 'clone', '-q', t.origin, t.A);
  commit(t.A, 'README.md', 'base\n');
  git(t.A, 'push', '-q', '-u', 'origin', 'main');
  fs.appendFileSync(path.join(t.A, '.git', 'info', 'exclude'), '.a1/\n');
  const prep = tools(t.A, t.env, ['worktree', 'prepare', t.A, 'feat']);
  const id = JSON.parse(prep.stdout).id;
  t.id = id; t.wt = path.join(root, 'a1-worktrees', 'feat');
  tools(t.A, t.env, ['worktree', 'enter', id]);
  t.tip = commit(t.wt, 'f.txt', 'feature\n');
  git(t.wt, 'push', '-q', 'origin', 'feature/feat');
  fs.writeFileSync(path.join(root, 'plan.md'), '- [x] Add `b` in `a.js`\n');
  for (const scope of ['pr-7', SPEC_ID, ...(o.extraScopes || [])]) {
    tools(t.wt, t.env, ['phantom', 'check', path.join(root, 'plan.md'), '--repo-path', t.wt, '--since', 'HEAD', '--phase', scope]);
  }
  if (o.cloneB) { git(root, 'clone', '-q', t.origin, t.B); git(t.B, 'branch', 'feature/feat', 'origin/feature/feat'); }
  const m = path.join(root, 'm');
  git(root, 'clone', '-q', t.origin, m);
  git(m, 'merge', '--squash', 'origin/feature/feat');
  git(m, 'commit', '-q', '-m', 'squash feature');
  git(m, 'push', '-q', 'origin', 'main');
  git(m, 'push', '-q', 'origin', '--delete', 'feature/feat');
  tools(t.A, t.env, ['code-scope', 'claim', '--by', SPEC_ID, '--scope', 'f.txt']);
  tools(t.A, t.env, ['code-scope', 'stage', '--by', SPEC_ID, '--set', 'verify']);
  t.gh = { view: { 7: { state: 'MERGED', headRefName: 'feature/feat', baseRefName: 'main', headRefOid: t.tip } }, merged: { 'feature/feat': [{ headRefOid: t.tip }] }, list_fail: false };
  t.saveGh = () => fs.writeFileSync(t.state, JSON.stringify(t.gh));
  t.saveGh();
  return t;
}
const files = (t) => [t.reg, path.join(t.A, '.a1', 'reservations.json'), t.spec].map(read);
const close = (t, args, cwd) => {
  const r = tools(cwd || t.A, t.env, ['feature', 'close', ...args]);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (_e) { /* usage error: no JSON */ }
  return { rc: r.status, json, out: r.stdout, err: r.stderr };
};
const ARGS = ['--by', SPEC_ID, '--pr', '7'];
const registry = (t) => JSON.parse(read(t.reg)).worktrees.find((e) => e.id === t.id);
const exists = (p) => fs.existsSync(p);
const hasBranch = (t, b) => gitOk(t.A, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`);
const allDone = (j) => j.steps.every((s) => s.result === 'done' || s.result === 'skipped');
const stepResult = (j, name) => (j.steps.find((s) => s.step === name) || {}).result;

// FC1 merged, remote branch gone: everything closes; rule (a) and rule (b) branches are swept.
{
  const t = build('fc1');
  git(t.A, 'branch', 'merged-b', 'main');
  git(t.A, 'checkout', '-q', '-b', 'pr-a'); const aTip = commit(t.A, 'a.txt', 'a\n'); git(t.A, 'checkout', '-q', 'main');
  t.gh.merged['pr-a'] = [{ headRefOid: aTip }]; t.saveGh();
  const r = close(t, ARGS);
  check('FC1 exit 0 ok', r.rc === 0 && r.json && r.json.ok === true, `rc=${r.rc} out=${r.out} err=${r.err}`);
  check('FC1 registry cleaned, worktree dir gone', registry(t).status === 'cleaned' && !exists(t.wt), JSON.stringify(registry(t)));
  check('FC1 reservation released', !/"by": "fx-spec"/.test(read(path.join(t.A, '.a1', 'reservations.json')) || ''), read(path.join(t.A, '.a1', 'reservations.json')));
  check('FC1 spec status done', /\nstatus: done\n/.test(read(t.spec)), read(t.spec));
  check('FC1 local feature branch deleted', !hasBranch(t, 'feature/feat'));
  eq('FC1 deleted lists the rule (a) and rule (b) branches', r.json && r.json.deleted.slice().sort(), ['merged-b', 'pr-a']);
  check('FC1 every step is done or skipped, worktree-exit done, no pending reservations commit', r.json && allDone(r.json) && stepResult(r.json, 'worktree-exit') === 'done' && stepResult(r.json, 'release') === 'done' && stepResult(r.json, 'spec') === 'done' && r.json.reservations_commit_pending === undefined, r.out);
  // FC2 a second call changes no file and deletes nothing.
  const before = files(t);
  const r2 = close(t, ARGS);
  eq('FC2 second call exit 0, deleted []', [r2.rc, r2.json && r2.json.deleted], [0, []]);
  check('FC2 registry, reservations and spec bytes equal', JSON.stringify(before) === JSON.stringify(files(t)));
}

// FC3 PR OPEN -> pr_not_merged, nothing changed.
{
  const t = build('fc3'); t.gh.view[7].state = 'OPEN'; t.saveGh();
  const before = files(t);
  const r = close(t, ARGS);
  check('FC3 exit 1 pr_not_merged', r.rc === 1 && r.json && r.json.reason === 'pr_not_merged' && r.json.ok === false, `rc=${r.rc} out=${r.out}`);
  check('FC3 files byte-equal, worktree still there', JSON.stringify(before) === JSON.stringify(files(t)) && exists(t.wt));
}

// FC4 the remote branch is still on origin -> remote_branch_present, nothing changed.
{
  const t = build('fc4'); git(t.wt, 'push', '-q', 'origin', 'feature/feat');
  const before = files(t);
  const r = close(t, ARGS);
  check('FC4 exit 1 remote_branch_present', r.rc === 1 && r.json && r.json.reason === 'remote_branch_present', `rc=${r.rc} out=${r.out}`);
  check('FC4 files byte-equal', JSON.stringify(before) === JSON.stringify(files(t)) && exists(t.wt));
}

// FC5 a dirty worktree (untracked file) -> worktree_exit_refused; reservation and spec unchanged.
{
  const t = build('fc5'); fs.writeFileSync(path.join(t.wt, 'dirty.txt'), 'x\n');
  const before = files(t);
  const r = close(t, ARGS);
  check('FC5 exit 1 worktree_exit_refused', r.rc === 1 && r.json && r.json.reason === 'worktree_exit_refused' && r.json.step === 'worktree-exit', `rc=${r.rc} out=${r.out}`);
  check('FC5 reservation, spec and registry unchanged, dirty file still there', JSON.stringify(before) === JSON.stringify(files(t)) && exists(path.join(t.wt, 'dirty.txt')));
}

// FC6, FC7, FC8, FC9 branch sweep: only proven-merged branches are deleted.
{
  const t = build('fc6');
  git(t.A, 'checkout', '-q', '-b', 'wip'); commit(t.A, 'w.txt', 'w\n');
  git(t.A, 'checkout', '-q', '-b', 'closed-pr'); commit(t.A, 'c.txt', 'c\n');
  git(t.A, 'checkout', '-q', '-b', 'extra'); const oldTip = commit(t.A, 'e.txt', 'e\n'); commit(t.A, 'e2.txt', 'e2\n');
  git(t.A, 'branch', 'other-wt', 'main');
  git(t.A, 'worktree', 'add', '-q', path.join(t.root, 'other-wt-dir'), 'other-wt');
  git(t.A, 'checkout', '-q', '-b', 'cur', 'main');
  t.gh.merged.extra = [{ headRefOid: oldTip }]; t.saveGh();
  const r = close(t, ARGS);
  check('FC6 exit 0', r.rc === 0 && r.json && r.json.ok, `rc=${r.rc} out=${r.out} err=${r.err}`);
  const kept = (b) => ((r.json && r.json.kept) || []).find((k) => k.branch === b);
  check('FC6 wip (commit not on origin, no PR) kept unmerged_commits and still exists', kept('wip') && kept('wip').reason === 'unmerged_commits' && hasBranch(t, 'wip'), r.out);
  check('FC7 closed-pr (no merged PR, has a diff) kept and still exists', kept('closed-pr') && hasBranch(t, 'closed-pr'), r.out);
  check('FC8 extra (merged PR head differs from the local tip) kept tip_differs and still exists', kept('extra') && kept('extra').reason === 'tip_differs' && hasBranch(t, 'extra'), r.out);
  check('FC9 current branch, main and a branch checked out in another worktree are never candidates', hasBranch(t, 'cur') && hasBranch(t, 'main') && hasBranch(t, 'other-wt') && !kept('cur') && !kept('main') && !kept('other-wt'), r.out);
}

// FC10 --cleanup-only in a second clone: deletes its local copy of the merged branch only.
{
  const t = build('fc10', { cloneB: true });
  const specBefore = read(t.spec);
  const r = close(t, ['--cleanup-only', '--repo', t.B], t.root);
  check('FC10 exit 0, mode cleanup-only, local copy of the merged branch deleted', r.rc === 0 && r.json && r.json.mode === 'cleanup-only' && r.json.deleted.includes('feature/feat') && !gitOk(t.B, 'rev-parse', '--verify', '--quiet', 'refs/heads/feature/feat'), `rc=${r.rc} out=${r.out} err=${r.err}`);
  check('FC10 no .a1/reservations.json created, spec untouched', !exists(path.join(t.B, '.a1', 'reservations.json')) && read(t.spec) === specBefore);
}

// FC11 run from inside the linked worktree.
{
  const t = build('fc11');
  const before = files(t);
  const r = close(t, ARGS, t.wt);
  check('FC11 exit 1 run_from_worktree, files unchanged', r.rc === 1 && r.json && r.json.reason === 'run_from_worktree' && JSON.stringify(before) === JSON.stringify(files(t)) && exists(t.wt), `rc=${r.rc} out=${r.out}`);
}

// FC12 hostile and malformed arguments exit 2.
{
  const t = build('fc12');
  const bad = [['--by', '../x', '--pr', '7'], ['--by', SPEC_ID, '--pr', '0'], ['--by', SPEC_ID, '--pr', '12345678'], ['--by', SPEC_ID, '--pr', '7; rm -rf x'], ['--by', SPEC_ID], ['--cleanup-only', '--by', SPEC_ID], [...ARGS, '--worktree', '../../etc'], [...ARGS, 'extra']];
  const rcs = bad.map((a) => close(t, a).rc);
  eq('FC12 every bad argument list exits 2', rcs, bad.map(() => 2));
}

// FC13 gh fails during the sweep: nothing is deleted.
{
  const t = build('fc13');
  git(t.A, 'branch', 'merged-b', 'main');
  t.gh.list_fail = true; t.saveGh();
  const r = close(t, ARGS);
  check('FC13 exit 1 gh_failed at the sweep, merged-b not deleted', r.rc === 1 && r.json && r.json.reason === 'gh_failed' && r.json.step === 'sweep' && r.json.deleted.length === 0 && hasBranch(t, 'merged-b'), `rc=${r.rc} out=${r.out}`);
}

// FC14 a resumed partial close: reservation already released, spec still implementing.
{
  const t = build('fc14');
  tools(t.A, t.env, ['code-scope', 'release', '--by', SPEC_ID]);
  const r = close(t, ARGS);
  check('FC14 exit 0 and the spec is done', r.rc === 0 && /\nstatus: done\n/.test(read(t.spec)) && stepResult(r.json, 'release') === 'skipped', `rc=${r.rc} out=${r.out}`);
}

// FC15 spec file missing: spec_not_found before any change.
{
  const t = build('fc15'); fs.rmSync(t.spec);
  const before = files(t);
  const r = close(t, ARGS);
  check('FC15 exit 1 spec_not_found, files byte-equal, worktree still there', r.rc === 1 && r.json && r.json.reason === 'spec_not_found' && JSON.stringify(before) === JSON.stringify(files(t)) && exists(t.wt), `rc=${r.rc} out=${r.out}`);
}

// FC16 an extra gate-log scope in the worktree is recorded too (audit M9).
{
  const t = build('fc16', { extraScopes: ['retro-x'] });
  const r = close(t, ARGS);
  const runsDir = path.join(t.root, 'vault', 'pattern', 'a1-learnings', '_runs');
  const lines = exists(runsDir) ? fs.readdirSync(runsDir).filter((n) => n.endsWith('.jsonl')).map((n) => read(path.join(runsDir, n))).join('\n') : '';
  const scopes = lines.split('\n').filter(Boolean).map((l) => JSON.parse(l).scope).sort();
  check('FC16 exit 0 and the runs file holds retro-x, pr-7 and the spec id', r.rc === 0 && JSON.stringify(scopes) === JSON.stringify(['fx-spec', 'pr-7', 'retro-x']), `rc=${r.rc} scopes=${scopes} out=${r.out} err=${r.err}`);
}

// FC17 a tracked, changed .a1/reservations.json is reported, never committed.
{
  const t = build('fc17');
  git(t.A, 'add', '-f', '.a1/reservations.json'); git(t.A, 'commit', '-q', '-m', 'track reservations');
  const headBefore = git(t.A, 'rev-parse', 'HEAD');
  const r = close(t, ARGS);
  check('FC17 exit 0, stdout names reservations_commit_pending', r.rc === 0 && r.json && r.json.reservations_commit_pending === '.a1/reservations.json', `rc=${r.rc} out=${r.out} err=${r.err}`);
  eq('FC17 git status lists exactly that file (trimmed), HEAD unchanged', [git(t.A, 'status', '--porcelain'), git(t.A, 'rev-parse', 'HEAD')], ['M .a1/reservations.json', headBefore]);
  check('FC17 stderr carries the one-line hint', /feature close: commit \.a1\/reservations\.json on main/.test(r.err), r.err);
}

// FC-help `--help` prints the usage only (stdout, exit 0), no error line before it.
{
  for (const flag of ['--help', '-h']) {
    const r = tools(WORK, BASE_ENV, ['feature', 'close', flag]);
    check(`FC-help feature close ${flag}: exit 0, usage on stdout, stderr empty`, r.status === 0 && /^usage: a1-tools feature close /.test(r.stdout) && r.stderr === '', `rc=${r.status} out=${r.stdout} err=${r.stderr}`);
  }
}

done();
