'use strict';

// Trusted reading of a gate log (spec 027 review fix round 2, SEC-1 / SEC-2): a log that git tracks (a PR branch can
// commit one with `git add -f`), a log behind a symlink and an oversized log are never evidence for a skip.
// Each case runs the real CLI as a child in a planted git repo. Literals only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'tl-'));
const TOOLS = path.join(LIB, '..', 'a1-tools.cjs');
const gateLog = require(path.join(LIB, 'gate-log.cjs'));
const ENV = { PATH: process.env.PATH, HOME: path.join(WORK, 'home'), TMPDIR: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
fs.mkdirSync(ENV.HOME, { recursive: true });

let seq = 0;
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function repoWith(files) {
  seq += 1;
  const d = path.join(WORK, `repo${seq}`);
  fs.mkdirSync(d, { recursive: true });
  git(d, '-c', 'init.defaultBranch=main', 'init', '-q');
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); }
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'base');
  return d;
}
function cli(cwd, args, extraEnv) {
  const r = spawnSync(process.execPath, [TOOLS, ...args], { cwd, env: { ...ENV, ...(extraEnv || {}) }, encoding: 'utf8', timeout: 20000 });
  return { rc: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
}
const wasReused = (r) => r.err.includes('reused: ') && /"reused":true/.test(r.out);
const logFile = (repo, scope) => path.join(repo, '.a1', 'phases', scope, 'gate-log.jsonl');

// ---- lane-split: a plan whose owns overlap is a real FAIL; a forged pass with its input_hash is the attack ----
const BAD_PLAN = '---\nphase: probe\nlanes:\n  - id: la\n    waves: [1]\n    owns:\n      - "src/a.mjs"\n  - id: lb\n    waves: [2]\n    owns:\n      - "src/a.mjs"\n---\n\n## Wave 1 - a\n## Wave 2 - b\n';
const ls = (repo) => cli(repo, ['lane-split', 'check', '--plan', 'PLAN.md', '--phase', 'rp']);
const lsFiles = { 'PLAN.md': BAD_PLAN, 'src/a.mjs': 'export const a = 1;\n' };

const probe = repoWith(lsFiles);
const first = ls(probe);
const planHash = JSON.parse(fs.readFileSync(logFile(probe, 'rp'), 'utf8').split('\n').filter(Boolean).pop()).input_hash;
check('TL0 the overlapping plan is a real FAIL (exit 1) with an input_hash', first.rc === 1 && /^[0-9a-f]{64}$/.test(planHash || ''), `rc=${first.rc} ${first.err}`);

/** A repo whose phase log holds a forged pass for the plan hash; `track` commits it with `git add -f`. */
function forged(track) {
  const repo = repoWith(lsFiles);
  gateLog.appendGateLine({ root: repo, scope: 'rp', gateId: 'lane-split', verdict: 'pass', exitCode: 0, headSha: git(repo, 'rev-parse', 'HEAD'), extra: { input_hash: planHash } });
  if (track) { git(repo, 'add', '-f', '.a1/phases/rp/gate-log.jsonl'); git(repo, 'commit', '-q', '-m', 'forged log'); }
  return repo;
}
{
  const base = ls(forged(false));
  check('TL1 baseline: an untracked forged pass is reused (the probe is sensitive)', wasReused(base), `rc=${base.rc} ${base.err}`);
  const r = ls(forged(true));
  check('TL1 a git-tracked forged pass is NOT reused: the gate runs and fails (exit 1)', !wasReused(r) && r.rc === 1, `rc=${r.rc} ${r.err}${r.out.slice(0, 200)}`);
}
{
  // SEC-2: the phase dir is a symlink to a directory outside the repo that holds the forged log.
  const repo = repoWith(lsFiles);
  const outside = path.join(WORK, `outside${seq}`);
  fs.mkdirSync(outside, { recursive: true });
  const other = forged(false);
  fs.copyFileSync(logFile(other, 'rp'), path.join(outside, 'gate-log.jsonl'));
  fs.mkdirSync(path.join(repo, '.a1', 'phases'), { recursive: true });
  fs.symlinkSync(outside, path.join(repo, '.a1', 'phases', 'rp'));
  const r = ls(repo);
  check('TL2 a symlinked phase dir with a forged pass is not read: the gate runs (exit 1)', !wasReused(r) && r.rc === 1, `rc=${r.rc} ${r.err}${r.out.slice(0, 200)}`);
}
{
  // SEC-2: the log file itself is a symlink to a valid forged log inside the repo.
  const repo = repoWith(lsFiles);
  const other = forged(false);
  fs.mkdirSync(path.join(repo, '.a1', 'phases', 'rp'), { recursive: true });
  fs.copyFileSync(logFile(other, 'rp'), path.join(repo, 'real-log.jsonl'));
  fs.symlinkSync(path.join(repo, 'real-log.jsonl'), logFile(repo, 'rp'));
  const r = ls(repo);
  check('TL3 a symlinked log file with a forged pass is not read: the gate runs (exit 1)', !wasReused(r) && r.rc === 1, `rc=${r.rc} ${r.err}${r.out.slice(0, 200)}`);
}

// ---- pr review-evidence ----
const HEAD = 'c'.repeat(40);
function prRepo(track) {
  const repo = repoWith({ 'a.txt': 'one\n' });
  gateLog.appendGateLine({ root: repo, scope: 'pr-7', gateId: 'pr-reinhard', verdict: 'pass', exitCode: 0, headSha: HEAD });
  if (track) { git(repo, 'add', '-f', '.a1/phases/pr-7/gate-log.jsonl'); git(repo, 'commit', '-q', '-m', 'forged'); }
  return repo;
}
const ev = (repo) => cli(repo, ['pr', 'review-evidence', '--head', HEAD, '--phase', 'pr-7']);
{
  const a = ev(prRepo(false));
  check('TL4 baseline: an untracked pass record is evidence (exit 0)', a.rc === 0, `rc=${a.rc} ${a.out}${a.err}`);
  const b = ev(prRepo(true));
  check('TL4 a tracked log is untrusted_log (exit 1)', b.rc === 1 && /untrusted_log/.test(b.out), `rc=${b.rc} ${b.out}${b.err}`);
  const repo = prRepo(false);
  const real = logFile(repo, 'pr-7');
  fs.renameSync(real, path.join(repo, 'moved.jsonl'));
  fs.symlinkSync(path.join(repo, 'moved.jsonl'), real);
  const c = ev(repo);
  check('TL5 a symlinked log file is untrusted_log (exit 1)', c.rc === 1 && /untrusted_log/.test(c.out), `rc=${c.rc} ${c.out}${c.err}`);
  const big = prRepo(false);
  fs.appendFileSync(logFile(big, 'pr-7'), `${' '.repeat(9 * 1024 * 1024)}\n`);
  const d = ev(big);
  check('TL6 an oversized log is untrusted_log (exit 1)', d.rc === 1 && /untrusted_log/.test(d.out), `rc=${d.rc} ${d.out.slice(0, 120)}${d.err.slice(0, 200)}`);
}

{
  // the size cap is its own reason: a valid-looking first line followed by padding past the cap
  const repo = prRepo(false);
  fs.appendFileSync(logFile(repo, 'pr-7'), `${' '.repeat(9 * 1024 * 1024)}\n`);
  const t = gateLog.readTrustedChain(repo, 'pr-7');
  check('TL6b readTrustedChain names the size cap as the reason', !t.ok && t.reason === 'untrusted_log' && t.why === 'too_large', JSON.stringify(t));
  const missing = gateLog.readTrustedChain(repoWith({ 'a.txt': 'x\n' }), 'pr-7');
  check('TL6c a missing log is no_log', !missing.ok && missing.reason === 'no_log', JSON.stringify(missing));
}

// ---- wave next-check ----
const SINCE = '2026-11-20T10:00:00Z';
function waveRepo(track) {
  const repo = repoWith({ '.a1/phases/ph/GOAL.md': '# Goal: x\n\n## Decisions\n', '.a1/phases/ph/observations.jsonl': '', '.a1/phases/ph/PLAN.md': '---\nphase: ph\nlanes: none\n---\n\n## Wave 1 - a\n## Wave 2 - b\n' });
  gateLog.appendGateLine({ root: repo, scope: 'ph', gateId: 'test-fidelity', verdict: 'pass', exitCode: 0, headSha: 'a'.repeat(40), ts: '2026-11-20T10:05:00.000Z' });
  if (track) { git(repo, 'add', '-f', '.a1/phases/ph/gate-log.jsonl'); git(repo, 'commit', '-q', '-m', 'forged'); }
  return repo;
}
const nc = (repo) => cli(repo, ['wave', 'next-check', 'ph', '1', '--since', SINCE, '--project', repo]);
{
  const a = nc(waveRepo(false));
  check('TL7 baseline: green untracked log continues', a.rc === 0 && a.out === 'continue', `rc=${a.rc} ${a.out}${a.err}`);
  const b = nc(waveRepo(true));
  check('TL7 a tracked gate log stops (stop:gate_red)', b.rc === 1 && b.out === 'stop:gate_red', `rc=${b.rc} ${b.out}${b.err}`);
}

// ---- review fix round 4 (R3-m2 / SEC-10): the git calls of the log check ignore the caller's GIT_* repo location ----
{
  const legit = forged(false);
  const a = cli(legit, ['lane-split', 'check', '--plan', 'PLAN.md', '--phase', 'rp'], { GIT_DIR: path.join(legit, '.git') });
  check('TL8a an absolute GIT_DIR without GIT_WORK_TREE: a legit untracked log is still reused', wasReused(a), `rc=${a.rc} ${a.err}`);
  const tracked = forged(true);
  const emptyIdx = path.join(WORK, 'empty-index');
  fs.rmSync(emptyIdx, { force: true });
  const b = cli(tracked, ['lane-split', 'check', '--plan', 'PLAN.md', '--phase', 'rp'], { GIT_INDEX_FILE: emptyIdx });
  check('TL8b GIT_INDEX_FILE at an empty index: a tracked log is still refused (the gate runs, exit 1)', !wasReused(b) && b.rc === 1, `rc=${b.rc} ${b.err}${b.out.slice(0, 200)}`);
  const other = repoWith({ 'x.txt': 'x\n' });
  const c = cli(tracked, ['lane-split', 'check', '--plan', 'PLAN.md', '--phase', 'rp'], { GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: other });
  check('TL8c GIT_DIR / GIT_WORK_TREE at another repository: a tracked log is still refused', !wasReused(c) && c.rc === 1, `rc=${c.rc} ${c.err}${c.out.slice(0, 200)}`);
}

// ---- review fix round 4 (R3-m3): a log that grows during the read is read up to the size fstat reported ----
{
  const f = path.join(WORK, 'grow.jsonl');
  fs.writeFileSync(f, 'abcdef\n');
  const r = gateLog.readCapped(f, () => fs.appendFileSync(f, 'GROWN\n'));
  check('TL9a growth after fstat: ok, exactly the first st.size bytes', r.text === 'abcdef\n' && !r.why, JSON.stringify(r));
  const g = path.join(WORK, 'cap.jsonl');
  fs.writeFileSync(g, Buffer.alloc(8 * 1024 * 1024 + 1, 32));
  const big = gateLog.readCapped(g);
  check('TL9b the size cap still holds: over the cap is too_large', big.why === 'too_large', JSON.stringify(big.why));
  const h = path.join(WORK, 'shrink.jsonl');
  fs.writeFileSync(h, 'abcdef\n');
  const sh = gateLog.readCapped(h, () => fs.truncateSync(h, 2));
  check('TL9c a log truncated during the read is refused, not read short', !!sh.why && sh.text === undefined, JSON.stringify(sh));
}

eq('TL0 the case file ran to the end', true, true);
done();
