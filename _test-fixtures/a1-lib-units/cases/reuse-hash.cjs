'use strict';

// reuse-hash.cjs (spec 027 FR-020, plan D6): a pass of gate-4.5, lane-split or fix-class-sweep is reused
// only when inputs, call arguments and the gate's own code are byte-identical. Every case runs the real CLI
// as a child in a planted git repo; the vault of the 4.5 cases is a planted copy of the real a1-checklist
// gate-pass fixture, the class-sweep repo a copy of the real a1-fix-class-sweep files. Literals only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'rh-'));
const TOOLS = path.join(LIB, '..', 'a1-tools.cjs');
const FIX = path.join(__dirname, '..', '..');
const gateLog = require(path.join(LIB, 'gate-log.cjs'));
const HEX64 = /^[0-9a-f]{64}$/;

const BASE_ENV = {
  PATH: process.env.PATH, HOME: path.join(WORK, 'home'), TMPDIR: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};
fs.mkdirSync(BASE_ENV.HOME, { recursive: true });

let seq = 0;
const tmp = (name) => { seq += 1; const d = path.join(WORK, `${name}${seq}`); fs.mkdirSync(d, { recursive: true }); return d; };
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function repoWith(files) {
  const d = tmp('repo');
  git(d, '-c', 'init.defaultBranch=main', 'init', '-q');
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); }
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'base');
  return d;
}
function cli(cwd, args, env, tools) {
  const r = spawnSync(process.execPath, [tools || TOOLS, ...args], { cwd, env: { ...BASE_ENV, ...(env || {}) }, encoding: 'utf8', timeout: 60000 });
  return { rc: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const logOf = (repo, scope) => {
  const f = path.join(repo, '.a1', 'phases', scope, 'gate-log.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const lastOf = (repo, scope, gate) => logOf(repo, scope).filter((r) => r.gate === gate).pop();
const wasReused = (r) => r.err.includes('reused: ') && /"reused":true/.test(r.out);

// RH1 currentScope() is null outside the hook (red: returning a stale module value is caught by RH2).
check('RH1 currentScope() is null outside the hook', gateLog.currentScope() === null);

// ---------------- lane-split ----------------
const LANE_PLAN = '---\nphase: probe\nlanes:\n  - id: la\n    waves: [1]\n    owns:\n      - "src/a.mjs"\n  - id: lb\n    waves: [2]\n    owns:\n      - "src/b.mjs"\n---\n\n## Wave 1 - a\n## Wave 2 - b\n';
const lsFiles = { 'PLAN.md': LANE_PLAN, 'src/a.mjs': 'export const a = 1;\n', 'src/b.mjs': 'export const b = 2;\n' };
const ls = (repo, extra, scope, env, tools) => cli(repo, ['lane-split', 'check', '--plan', 'PLAN.md', ...extra, ...(scope ? ['--phase', scope] : [])], env, tools);

{
  const repo = repoWith(lsFiles);
  const r1 = ls(repo, [], 'rp');
  const r2 = ls(repo, [], 'rp');
  const [rec1, rec2] = logOf(repo, 'rp');
  check('RH2 first run passes and logs an input_hash', r1.rc === 0 && rec1 && HEX64.test(rec1.input_hash || '') && !rec1.reused, r1.err);
  check('RH2 second run is reused: stderr line', r2.rc === 0 && new RegExp(`reused: lane-split @ ${rec1.input_hash}`).test(r2.err), r2.err);
  check('RH2 stdout JSON has reused:true', /"reused":true/.test(r2.out), r2.out);
  check('RH2 second log record has the same input_hash and reused:true', rec2 && rec2.input_hash === rec1.input_hash && rec2.reused === true, JSON.stringify(rec2));

  fs.appendFileSync(path.join(repo, 'PLAN.md'), '\nedited\n');
  git(repo, 'commit', '-qam', 'plan');
  const r3 = ls(repo, [], 'rp');
  check('RH3 a plan edit runs the gate', r3.rc === 0 && !wasReused(r3) && !lastOf(repo, 'rp', 'lane-split').reused, r3.err);

  // RH4 a planted fail with the same hash after the pass runs the gate again.
  const h = lastOf(repo, 'rp', 'lane-split').input_hash;
  gateLog.appendGateLine({ root: repo, scope: 'rp', gateId: 'lane-split', verdict: 'fail', exitCode: 1, headSha: git(repo, 'rev-parse', 'HEAD'), extra: { input_hash: h } });
  const r4 = ls(repo, [], 'rp');
  check('RH4 a later fail record with the same hash blocks reuse', r4.rc === 0 && !wasReused(r4), r4.err);
  const r4b = ls(repo, [], 'rp');
  check('RH4 the pass after the fail is reused again (last record wins)', wasReused(r4b), r4b.err);

  // RH5 a garbage line makes the log untrusted.
  fs.appendFileSync(path.join(repo, '.a1', 'phases', 'rp', 'gate-log.jsonl'), 'garbage\n');
  const r5 = ls(repo, [], 'rp');
  check('RH5 a garbage line in the log runs the gate', r5.rc === 0 && !wasReused(r5), r5.err);
}
{
  const repo = repoWith(lsFiles);
  ls(repo, [], null);
  const r2 = ls(repo, [], null);
  const recs = logOf(repo, '_unscoped');
  check('RH6 without --phase nothing is reused and no record says so', !wasReused(r2) && recs.length === 2 && recs.every((r) => !r.reused), JSON.stringify(recs));
}
{
  const repo = repoWith(lsFiles);
  const a = ls(repo, ['--imports', '.'], 'rp');
  const b = ls(repo, ['--imports', '.'], 'rp');
  check('RH7 --imports reuse holds at the same HEAD', a.rc === 0 && wasReused(b) && /"imports_checked":true/.test(b.out), b.err + b.out);
  fs.writeFileSync(path.join(repo, 'src', 'other.mjs'), 'export const o = 3;\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'more');
  const c = ls(repo, ['--imports', '.'], 'rp');
  check('RH7 --imports runs after a new commit (HEAD moved)', c.rc === 0 && !wasReused(c), c.err);
  check('RH14/RH7 the new record carries no reused flag', !lastOf(repo, 'rp', 'lane-split').reused);
  const d = ls(repo, ['--imports', '.'], 'rp');
  check('RH7 and is reused again at the new HEAD', wasReused(d), d.err);
  fs.appendFileSync(path.join(repo, 'src', 'a.mjs'), '// dirty\n');
  const e = ls(repo, ['--imports', '.'], 'rp');
  check('RH15 --imports runs with an uncommitted tracked change', e.rc === 0 && !wasReused(e), e.err);
}
{
  // RH17 / RH19: the gate's own code is part of the key (a scratch copy of the tree).
  const repo = repoWith(lsFiles);
  ls(repo, [], 'rp');
  const tree = tmp('tree');
  fs.cpSync(path.join(LIB, '..'), path.join(tree, '_shared'), { recursive: true });
  const toolsCopy = path.join(tree, '_shared', 'a1-tools.cjs');
  const same = ls(repo, [], 'rp', null, toolsCopy);
  check('RH17 an unmodified tree copy still reuses (the key is content, not path)', wasReused(same), same.err);
  fs.appendFileSync(path.join(tree, '_shared', 'lib', 'lane-split.cjs'), '\n// RH17 appended comment\n');
  const r17 = ls(repo, [], 'rp', null, toolsCopy);
  check('RH17 one appended comment line in lane-split.cjs runs the gate', r17.rc === 0 && !wasReused(r17), r17.err);
  const tree2 = tmp('tree');
  fs.cpSync(path.join(LIB, '..'), path.join(tree2, '_shared'), { recursive: true });
  const req = fs.readFileSync(path.join(LIB, 'lane-split.cjs'), 'utf8');
  const depth1 = ['segment-glob.cjs', 'code-scope.cjs', 'io.cjs'].find((f) => req.includes(`require('./${f}')`));
  fs.appendFileSync(path.join(tree2, '_shared', 'lib', depth1), '\n// RH19 appended comment\n');
  const r19 = ls(repo, [], 'rp', null, path.join(tree2, '_shared', 'a1-tools.cjs'));
  check(`RH19 one appended line in a depth-1 require (${depth1}) runs the gate`, Boolean(depth1) && r19.rc === 0 && !wasReused(r19), r19.err);
}

{
  // RH20 (review fix B1): an untracked non-ignored lane file is an input of --imports; a pass at the same HEAD must not be reused.
  const plan = LANE_PLAN.replace('"src/a.mjs"', '"src/a.mjs"\n      - "src/new.mjs"');
  const repo = repoWith({ ...lsFiles, 'PLAN.md': plan });
  const a = ls(repo, ['--imports', '.'], 'rp');
  const b = ls(repo, ['--imports', '.'], 'rp');
  check('RH20 baseline: --imports passes and is reused at a clean tree', a.rc === 0 && wasReused(b), a.err + b.err);
  fs.writeFileSync(path.join(repo, 'src', 'new.mjs'), "import { b } from './b.mjs';\nexport const n = b;\n");
  const c = ls(repo, ['--imports', '.'], 'rp');
  check('RH20 an untracked lane file that imports a foreign lane file runs the gate (no reuse)', !wasReused(c), c.err + c.out);
  check('RH20 and the gate reports the cross-lane import (exit 1)', c.rc === 1, `rc=${c.rc} ${c.out.slice(0, 200)}`);
}
{
  // RH21 (review fix m1): the key covers the whole require closure, not two levels; double-quoted requires count.
  const repo = repoWith(lsFiles);
  const tree = tmp('tree');
  fs.cpSync(path.join(LIB, '..'), path.join(tree, '_shared'), { recursive: true });
  const toolsCopy = path.join(tree, '_shared', 'a1-tools.cjs');
  ls(repo, [], 'rp', null, toolsCopy);
  const deep = ls(repo, [], 'rp', null, toolsCopy);
  check('RH21 baseline: the tree copy reuses', wasReused(deep), deep.err);
  fs.appendFileSync(path.join(tree, '_shared', 'lib', 'status-constants.cjs'), '\n// RH21 depth-3 edit\n');
  const r = ls(repo, [], 'rp', null, toolsCopy);
  check('RH21 an edit of a depth-3 module (status-constants.cjs) runs the gate', r.rc === 0 && !wasReused(r), r.err);
}
{
  const repo = repoWith(lsFiles);
  const tree = tmp('tree');
  fs.cpSync(path.join(LIB, '..'), path.join(tree, '_shared'), { recursive: true });
  const toolsCopy = path.join(tree, '_shared', 'a1-tools.cjs');
  fs.writeFileSync(path.join(tree, '_shared', 'lib', 'zz-dq.cjs'), "'use strict';\nmodule.exports = 1;\n");
  fs.appendFileSync(path.join(tree, '_shared', 'lib', 'lane-split.cjs'), '\nconst _dq = require("./zz-dq.cjs");\n');
  ls(repo, [], 'rp', null, toolsCopy);
  const same = ls(repo, [], 'rp', null, toolsCopy);
  check('RH22 baseline: the tree copy with a double-quoted require reuses', wasReused(same), same.err);
  fs.appendFileSync(path.join(tree, '_shared', 'lib', 'zz-dq.cjs'), '// RH22 edit\n');
  const r = ls(repo, [], 'rp', null, toolsCopy);
  check('RH22 an edit of a module required with double quotes runs the gate', r.rc === 0 && !wasReused(r), r.err);
}

// ---------------- gate 4.5 ----------------
function planVault() {
  const vault = tmp('vault');
  fs.cpSync(path.join(FIX, 'a1-checklist', 'gate-pass', 'project'), path.join(vault, 'project'), { recursive: true });
  return vault;
}
const SPEC_REL = path.join('project', 'demo', 'spec', '001-login.md');
const WP_REL = path.join('project', 'demo', 'plans', '001-login-wave-plan.md');
const RM_FM = (st) => `---\nproject: demo\nfeatures:\n  - id: 001-login\n    status: ${st}\n---\n# Roadmap\n`;
const cl = (repo, vault, extra, scope) => cli(repo, ['checklist', 'run', 'demo/001-login', '--only', '9,10,11', ...extra, ...(scope === null ? [] : ['--phase', scope || 'p'])], { A1_VAULT_ROOT: vault });
{
  const repo = repoWith({ 'README.md': 'x\n' });
  const vault = planVault();
  fs.mkdirSync(path.join(vault, 'project', 'demo', 'product'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'project', 'demo', 'product', 'ROADMAP.md'), RM_FM('planned'));
  const a = cl(repo, vault, []);
  const b = cl(repo, vault, []);
  check('RH8 4.5 first run passes', a.rc === 0, a.err + a.out.slice(0, 300));
  check('RH8 4.5 second run is reused', b.rc === 0 && wasReused(b), b.err + b.out.slice(0, 300));
  check('RH8 the record is gate-4.5-fr-consistency with reused:true', (lastOf(repo, 'p', 'gate-4.5-fr-consistency') || {}).reused === true);

  fs.appendFileSync(path.join(vault, WP_REL), '\n<!-- edit -->\n');
  const c = cl(repo, vault, []);
  check('RH9 a wave-plan-only edit runs the gate', !wasReused(c), c.err);
  fs.appendFileSync(path.join(vault, SPEC_REL), '\n<!-- edit -->\n');
  const d = cl(repo, vault, []);
  check('RH10 a spec edit runs the gate', !wasReused(d), d.err);
  const d2 = cl(repo, vault, []);
  check('RH10 an unchanged call after that is reused', wasReused(d2), d2.err);
  const e = cli(repo, ['checklist', 'run', 'demo/001-login', '--only', '9,10', '--phase', 'p'], { A1_VAULT_ROOT: vault });
  const e2 = cli(repo, ['checklist', 'run', 'demo/001-login', '--only', '9,10', '--phase', 'p'], { A1_VAULT_ROOT: vault });
  check('RH11 --only 9,10 (a different set) is never reused', !wasReused(e) && !wasReused(e2), e.err + e2.err);
  fs.writeFileSync(path.join(vault, 'project', 'demo', 'product', 'ROADMAP.md'), RM_FM('done'));
  const g = cl(repo, vault, []);
  check('RH18 a roadmap-only edit runs the gate', !wasReused(g), g.err);
}
{
  // RH25 (review fix m2): check 11 reads the spec the roadmap entry's spec_path names; when that is not the hashed spec, the call is not reusable.
  const repo = repoWith({ 'README.md': 'x\n' });
  const vault = planVault();
  fs.mkdirSync(path.join(vault, 'project', 'demo', 'product'), { recursive: true });
  const rmFile = path.join(vault, 'project', 'demo', 'product', 'ROADMAP.md');
  const withSpecPath = (rel) => RM_FM('planned').replace('    status: planned', `    status: planned\n    spec_path: ${rel}`);
  fs.writeFileSync(rmFile, withSpecPath(SPEC_REL));
  cl(repo, vault, []);
  const same = cl(repo, vault, []);
  check('RH25 baseline: a spec_path naming the hashed spec is reused', wasReused(same), same.err + same.out.slice(0, 200));
  const OTHER_REL = path.join('project', 'demo', 'spec', 'other.md');
  fs.copyFileSync(path.join(vault, SPEC_REL), path.join(vault, OTHER_REL));
  fs.writeFileSync(rmFile, withSpecPath(OTHER_REL));
  cl(repo, vault, []);
  const second = cl(repo, vault, []);
  check('RH25 a spec_path naming another file is not reusable (second identical call runs)', !wasReused(second), second.err + second.out.slice(0, 200));
  fs.appendFileSync(path.join(vault, OTHER_REL), '\n<!-- edit -->\n');
  const third = cl(repo, vault, []);
  check('RH25 an edit of the other spec runs the gate', !wasReused(third), third.err);
}
{
  const repo = repoWith({ 'README.md': 'x\n' });
  const vault = planVault();
  const f1 = cli(repo, ['checklist', 'run', 'demo/001-login', '--phase', 'p'], { A1_VAULT_ROOT: vault });
  const f2 = cli(repo, ['checklist', 'run', 'demo/001-login', '--phase', 'p'], { A1_VAULT_ROOT: vault });
  check('RH12 a full run without --only is never reused', !wasReused(f1) && !wasReused(f2), f2.err);
}

{
  // RH24 (review fix n1): an unexpected error in the 4.5 reuse lookup is named on stderr (the gate still runs); a plain miss stays silent.
  const repo = repoWith({ 'README.md': 'x\n' });
  const tree = tmp('tree');
  fs.cpSync(path.join(LIB, '..'), path.join(tree, '_shared'), { recursive: true });
  const sc = path.join(tree, '_shared', 'lib', 'spec-coherence.cjs');
  const src = fs.readFileSync(sc, 'utf8');
  const marker = "  const tiers = [\n    ['cwd'";
  if (!src.includes(marker)) throw new Error('RH24 marker missing in spec-coherence.cjs');
  fs.writeFileSync(sc, src.replace(marker, `  throw new Error('RH24 boom');\n${marker}`));
  const boom = cli(repo, ['checklist', 'run', 'demo/001-login', '--only', '9,10,11', '--phase', 'p'], { A1_VAULT_ROOT: planVault() }, path.join(tree, '_shared', 'a1-tools.cjs'));
  check('RH24 an unexpected reuse-lookup error is named on stderr ("reuse check failed: ... RH24 boom")', /reuse check failed: .*RH24 boom/.test(boom.err), boom.err.slice(0, 300));
  const vault = planVault();
  const miss = cl(repo, vault, []);
  check('RH24 an ordinary first run prints no "reuse check failed:" line', !/reuse check failed:/.test(miss.err), miss.err.slice(0, 300));
}

// ---------------- fix class-sweep --verify ----------------
{
  const REAL = path.join(FIX, 'a1-fix-class-sweep', 'real');
  const vault = tmp('csvault');
  fs.mkdirSync(path.join(vault, 'project', 'demo', 'fixes'), { recursive: true });
  const repo = tmp('csrepo');
  fs.cpSync(REAL, repo, { recursive: true, filter: (s) => !/ORIGIN\.md$|bug-frontmatter\.txt$/.test(s) });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'old.test.ts'), 'test("old", () => {});\n');
  git(repo, '-c', 'init.defaultBranch=main', 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  const bug = path.join(vault, 'project', 'demo', 'fixes', '2026-10-03-fk-class.md');
  const fm = fs.readFileSync(path.join(REAL, 'bug-frontmatter.txt'), 'utf8').split('\n').filter((l) => !l.startsWith('status:')).join('\n');
  fs.writeFileSync(bug, `${fm}\nstatus: reported\nclass_query:\n  - pattern: INSERT INTO api\\.(invoices|workspace_tasks)\n  - glob: **/*.ts\n  - engine: grep -E\nroot_site: lib/crm/invoice-write-service.ts:224\n---\n\n# Bug\n\nSymptom.\n`);
  const env = { A1_VAULT_ROOT: vault };
  const sw = (args) => cli(repo, ['fix', 'class-sweep', '--phase', 'cs', ...args], env);
  const rec = sw(['--record', bug]);
  for (const f of ['app/api/crm/invoices/[id]/convert/route.ts', 'lib/crm/invoice-write-service.ts', 'lib/workspace-tasks/task-write-service.ts', 'packages/office-core/src/adapters/task-sql.ts']) {
    const p = path.join(repo, f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split('INSERT INTO api.').join('SELECT api.insert_'));
  }
  git(repo, 'commit', '-qam', 'fix');
  const v1 = sw(['--verify', bug]);
  const v2 = sw(['--verify', bug]);
  check('RH13 --record ran and --verify passes on the fixed tree', rec.rc === 0 && v1.rc === 0, `${rec.rc}/${v1.rc} ${v1.out.slice(0, 200)}${v1.err}`);
  check('RH13 the second --verify is reused (post-run hash of the first)', v2.rc === 0 && wasReused(v2), v2.err + v2.out);
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'n\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'notes');
  const v3 = sw(['--verify', bug]);
  check('RH14 a new commit runs --verify', v3.rc === 0 && !wasReused(v3), v3.err);
  fs.appendFileSync(path.join(repo, 'notes.txt'), 'dirty\n');
  const v4 = sw(['--verify', bug]);
  check('RH15 an uncommitted tracked change runs --verify', v4.rc === 0 && !wasReused(v4), v4.err);
  git(repo, 'commit', '-qam', 'clean');
  sw(['--verify', bug]);
  // RH23 (review fix B1): an untracked non-ignored file with the pattern is part of the swept set; a pass at this HEAD must not be reused.
  const w1 = sw(['--verify', bug]);
  const w2 = sw(['--verify', bug]);
  check('RH23 baseline: the clean tree --verify passes and is reused', w1.rc === 0 && wasReused(w2), w1.err + w2.err);
  fs.mkdirSync(path.join(repo, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'lib', 'new-site.ts'), 'export const q = "INSERT INTO api.invoices (id) VALUES (1)";\n');
  const w3 = sw(['--verify', bug]);
  check('RH23 an untracked file with the pattern runs --verify and it fails (exit 1, no reuse)', !wasReused(w3) && w3.rc === 1, `rc=${w3.rc} ${w3.err}${w3.out.slice(0, 200)}`);
  fs.rmSync(path.join(repo, 'lib', 'new-site.ts'));
  const v5 = sw(['--verify', bug, '--guard', 'class-sweep:other.ts:0123456789abcdef=tests/old.test.ts']);
  check('RH16 a different --guard set runs (and is refused on its own merits)', !wasReused(v5), v5.err + v5.out.slice(0, 200));
}

eq('RH0 the case file ran to the end', true, true);
done();
