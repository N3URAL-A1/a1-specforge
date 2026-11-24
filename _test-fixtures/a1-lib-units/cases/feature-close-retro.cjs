'use strict';

// feature-close-retro.cjs (spec 027 slice 5, FR-031, plan D6, cases FR1-FR8): `feature close` derives and appends one machine
// record per PR before the worktree exit, and `--check-only` prints the prose decision. Same seam as cases/feature-close.cjs
// (real git repos, a worktree made by `worktree prepare`, gate logs written by real gated commands, a temp vault, the real CLI
// children); only gh is faked via A1_GH_BIN + A1_FEATURE_CLOSE_TEST=1. The helpers are copied, not imported. Literals only.
//
// Measured red 2026-11-23 (scratch copy of feature-close.cjs, one edit each, this file run):
//   machineRetro moved after exitWorktree                      -> FR1
//   decideRetro removed from the --check-only plan             -> FR3
//   the issues regex accepts `;`                               -> FR5
//   a missing store throws instead of warning                  -> FR7

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'fcr-'));
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
  "  const mv = st.move; if (mv && a[a.indexOf('--head') + 1] === mv.when_head) require('child_process').spawnSync('git', ['-C', mv.repo, 'update-ref', 'refs/heads/' + mv.branch, mv.to]);",
  "  const ex = st.exec; if (ex && a[a.indexOf('--head') + 1] === ex.when_head) require('child_process').spawnSync('git', ['-C', ex.repo, ...ex.argv]);",
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
  t.env = { ...BASE_ENV, A1_WORKTREE_REGISTRY: t.reg, A1_VAULT_ROOT: path.join(root, 'vault'), A1_GH_BIN: path.join(root, 'gh.cjs'), A1_FEATURE_CLOSE_TEST: '1', FAKE_GH_STATE: t.state };
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

const STORE = (t) => path.join(t.root, 'vault', 'pattern', 'a1-learnings', 'a1-new-feature.md');
const stepNames = (j) => j.steps.map((s) => s.step);
/** Copies of every gate log of the worktree (the logs die with the worktree exit), for `retro validate` after the close. */
function saveLogs(t) {
  const out = [];
  for (const s of fs.readdirSync(path.join(t.wt, '.a1', 'phases'))) {
    const src = path.join(t.wt, '.a1', 'phases', s, 'gate-log.jsonl');
    if (!fs.existsSync(src)) continue;
    const dst = path.join(t.root, 'saved', s, 'gate-log.jsonl');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    out.push(dst);
  }
  return out;
}
const plantFail = (t) => appendGateLine({ root: t.wt, scope: 'caught-scope', gateId: 'test-fidelity', verdict: 'fail', exitCode: 1, headSha: 'none' });
const { appendGateLine } = require(path.join(LIB, 'gate-log.cjs'));

// FR1 a pass chain: --check-only prints prose_required false; the close writes one machine entry BEFORE the worktree exit; it passes retro validate.
{
  const t = build('fr1');
  const chk = close(t, [...ARGS, '--check-only']);
  check('FR1 check-only retro.prose_required false', chk.rc === 0 && chk.json && chk.json.retro && chk.json.retro.prose_required === false, chk.out);
  const logs = saveLogs(t);
  const r = close(t, ARGS);
  check('FR1 close exit 0', r.rc === 0 && r.json && r.json.ok, `rc=${r.rc} out=${r.out} err=${r.err}`);
  const names = r.json ? stepNames(r.json) : [];
  check('FR1 machine-retro step done, between record-runs and worktree-exit', r.json && stepResult(r.json, 'machine-retro') === 'done' && names.indexOf('machine-retro') === names.indexOf('record-runs') + 1 && names.indexOf('machine-retro') < names.indexOf('worktree-exit'), r.out);
  const store = read(STORE(t)) || '';
  eq('FR1 exactly one machine_record line', (store.match(/^machine_record: fx-spec#7$/gm) || []).length, 1);
  check('FR1 close output carries retro, prose_required false', r.json && r.json.retro && r.json.retro.prose_required === false, r.out);
  const stripped = path.join(path.dirname(STORE(t)), 'fr1-stripped.md'); // machine-only keys are forbidden in retro validate (review round 1)
  fs.writeFileSync(stripped, store.replace(/^(kind|machine_record): .*\n/gm, ''));
  const v = tools(t.A, t.env, ['retro', 'validate', stripped, ...logs.flatMap((l) => ['--gate-log', l]), '--phase', 'retro-fr']);
  check('FR1 retro validate exit 0 on the stored entry without the machine-only keys', v.status === 0, `rc=${v.status} out=${v.stdout} err=${v.stderr}`);
  // FR2 a second close adds no entry.
  const r2 = close(t, ARGS);
  eq('FR2 second close writes no new entry', [r2.rc, ((read(STORE(t)) || '').match(/^machine_record:/gm) || []).length], [0, 1]);
  check('FR2 machine-retro skipped', r2.json && stepResult(r2.json, 'machine-retro') === 'skipped', r2.out);
  // FR8 --check-only after the close (worktree gone) reads the stored record.
  const c3 = close(t, [...ARGS, '--check-only']);
  check('FR8 check-only without a worktree reads the stored record (prose_required false, source stored)', c3.rc === 0 && c3.json.retro && c3.json.retro.prose_required === false && c3.json.retro.source === 'stored', c3.out);
}

// FR3 a chain with a fail record: --check-only prose_required true, reasons name the caught gate.
{
  const t = build('fr3'); plantFail(t);
  const chk = close(t, [...ARGS, '--check-only']);
  check('FR3 prose_required true with caught:test-fidelity', chk.rc === 0 && chk.json.retro && chk.json.retro.prose_required === true && chk.json.retro.reasons.includes('caught:test-fidelity'), chk.out);
  const r = close(t, ARGS);
  check('FR3 the stored entry says prose_required: true and result fail', r.rc === 0 && /\nprose_required: true\n/.test(read(STORE(t)) || '') && /\nresult: fail\n/.test(read(STORE(t)) || ''), r.out);
}

// FR4 --issues voice-input forces prose and lands in the entry.
{
  const t = build('fr4');
  const chk = close(t, [...ARGS, '--check-only', '--issues', 'voice-input']);
  check('FR4 prose_required true, reasons include issues', chk.rc === 0 && chk.json.retro.prose_required === true && chk.json.retro.reasons.includes('issues'), chk.out);
  const r = close(t, [...ARGS, '--issues', 'voice-input']);
  check('FR4 entry has issues: [voice-input]', r.rc === 0 && /\nissues: \[voice-input\]\n/.test(read(STORE(t)) || ''), r.out);
}

// FR5 an unsafe --issues value is a usage error (exit 2), nothing changed.
{
  const t = build('fr5');
  const before = files(t);
  const r = close(t, [...ARGS, '--issues', 'a;b']);
  check('FR5 exit 2, files unchanged, no store file', r.rc === 2 && JSON.stringify(before) === JSON.stringify(files(t)) && read(STORE(t)) === null, `rc=${r.rc} err=${r.err}`);
}

// FR6 --cleanup-only with --issues is a usage error.
{
  const t = build('fr6');
  const r = close(t, ['--cleanup-only', '--issues', 'x']);
  check('FR6 exit 2', r.rc === 2, `rc=${r.rc} out=${r.out} err=${r.err}`);
}

// FR7 no learning store: the close succeeds with a warning and writes no entry.
{
  const t = build('fr7');
  fs.rmSync(path.join(t.root, 'vault', 'pattern'), { recursive: true });
  const r = close(t, ARGS);
  check('FR7 exit 0, machine-retro skipped, a warning names it, no entry file', r.rc === 0 && r.json && stepResult(r.json, 'machine-retro') === 'skipped' && r.json.warnings.some((w) => /machine-retro/.test(w)) && read(STORE(t)) === null, `rc=${r.rc} out=${r.out}`);
  check('FR7 the worktree was still exited, retro still reported', r.json && stepResult(r.json, 'worktree-exit') === 'done' && r.json.retro && typeof r.json.retro.prose_required === 'boolean', r.out);
}

done();
