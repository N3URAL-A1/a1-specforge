'use strict';

// Trusted reading of a gate log, in-repo path tricks (spec 027 review fix round 3, SEC-6): a log that a clone of a PR
// branch holds as TRACKED content but that `git ls-files --error-unmatch -- <path>` does not report as tracked, because
// a tracked symlink or a submodule sits on the path or because the index spells the path in another case. Each attack is
// run against all three readers: input-hash reuse, `pr review-evidence` and `wave next-check`.
// Each case runs the real CLI as a child in a planted git repo. Literals only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'tp-'));
const TOOLS = path.join(LIB, '..', 'a1-tools.cjs');
const gateLog = require(path.join(LIB, 'gate-log.cjs'));
const ENV = { PATH: process.env.PATH, HOME: path.join(WORK, 'home'), TMPDIR: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
fs.mkdirSync(ENV.HOME, { recursive: true });

let seq = 0;
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function newRepo(files) {
  seq += 1;
  const d = path.join(WORK, `repo${seq}`);
  fs.mkdirSync(d, { recursive: true });
  git(d, '-c', 'init.defaultBranch=main', 'init', '-q');
  writeAll(d, files);
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'base');
  return d;
}
function writeAll(dir, files) {
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
}
function cli(cwd, args) {
  const r = spawnSync(process.execPath, [TOOLS, ...args], { cwd, env: ENV, encoding: 'utf8', timeout: 20000 });
  return { rc: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
}
function forgedText(scope, gateId, headSha, extra) {
  const t = newRepo({ x: 'x\n' });
  gateLog.appendGateLine({ root: t, scope, gateId, verdict: 'pass', exitCode: 0, headSha, extra, ts: '2026-11-20T10:05:00.000Z' });
  return fs.readFileSync(path.join(t, '.a1', 'phases', scope, 'gate-log.jsonl'), 'utf8');
}
function sub(files) { return newRepo(files); }

/** Each attack puts `extras` + the forged log where the reader looks, as tracked content of the attacker repo. */
const LOG = 'gate-log.jsonl';
const ATTACKS = {
  C: { note: 'tracked symlink .a1/phases/<scope> -> docs/evil', build(a, scope, text, extras) {
    writeAll(a, { ...Object.fromEntries(Object.entries({ ...extras, [LOG]: text }).map(([k, v]) => [`docs/evil/${k}`, v])) });
    fs.mkdirSync(path.join(a, '.a1', 'phases'), { recursive: true });
    fs.symlinkSync('../../docs/evil', path.join(a, '.a1', 'phases', scope));
  } },
  C2: { note: 'tracked symlink .a1 -> docs/x', build(a, scope, text, extras) {
    writeAll(a, Object.fromEntries(Object.entries({ ...extras, [LOG]: text }).map(([k, v]) => [`docs/x/phases/${scope}/${k}`, v])));
    fs.symlinkSync('docs/x', path.join(a, '.a1'));
  } },
  D: { note: 'submodule at .a1', clone: ['--recurse-submodules'], build(a, scope, text, extras) {
    const s = sub(Object.fromEntries(Object.entries({ ...extras, [LOG]: text }).map(([k, v]) => [`phases/${scope}/${k}`, v])));
    git(a, 'submodule', 'add', '-q', s, '.a1');
  } },
  D2: { note: 'submodule at .a1/phases/<scope>', clone: ['--recurse-submodules'], build(a, scope, text, extras) {
    const s = sub({ ...extras, [LOG]: text });
    fs.mkdirSync(path.join(a, '.a1', 'phases'), { recursive: true });
    git(a, 'submodule', 'add', '-q', s, `.a1/phases/${scope}`);
  } },
  E: { note: 'index spells GATE-LOG.jsonl, core.ignorecase=true, disk lowercase', icase: 'file', build(a, scope, text, extras) {
    writeAll(a, Object.fromEntries(Object.entries({ ...extras, 'GATE-LOG.jsonl': text }).map(([k, v]) => [`.a1/phases/${scope}/${k}`, v])));
  } },
  E2: { note: 'index spells .A1/Phases/<scope>/..., core.ignorecase=true, disk lowercase', icase: 'dirs', build(a, scope, text, extras) {
    writeAll(a, Object.fromEntries(Object.entries({ ...extras, [LOG]: text }).map(([k, v]) => [`.A1/Phases/${scope}/${k}`, v])));
  } },
};

/** The victim: a clone of the attacker repo, with the simulated macOS case state for the icase attacks. */
function victim(attack, scope, text, extras, baseFiles) {
  const a = newRepo(baseFiles);
  attack.build(a, scope, text, extras);
  git(a, 'add', '-A', '-f');
  git(a, 'commit', '-q', '-m', 'attack');
  seq += 1;
  const v = path.join(WORK, `victim${seq}`);
  git(WORK, 'clone', '-q', ...(attack.clone || []), a, v);
  if (attack.icase) {
    git(v, 'config', 'core.ignorecase', 'true');
    if (attack.icase === 'file') fs.renameSync(path.join(v, '.a1', 'phases', scope, 'GATE-LOG.jsonl'), path.join(v, '.a1', 'phases', scope, LOG));
    else { fs.renameSync(path.join(v, '.A1'), path.join(v, '.a1x')); fs.renameSync(path.join(v, '.a1x'), path.join(v, '.a1')); fs.renameSync(path.join(v, '.a1', 'Phases'), path.join(v, '.a1', 'phases')); }
  }
  return v;
}

const names = Object.keys(ATTACKS);
const wasReused = (r) => r.err.includes('reused: ') && /"reused":true/.test(r.out);

// ---- input-hash reuse (lane-split) ----
const BAD_PLAN = '---\nphase: probe\nlanes:\n  - id: la\n    waves: [1]\n    owns:\n      - "src/a.mjs"\n  - id: lb\n    waves: [2]\n    owns:\n      - "src/a.mjs"\n---\n\n## Wave 1 - a\n## Wave 2 - b\n';
const lsFiles = { 'PLAN.md': BAD_PLAN, 'src/a.mjs': 'export const a = 1;\n' };
const lsCall = (repo) => cli(repo, ['lane-split', 'check', '--plan', 'PLAN.md', '--phase', 'rp']);
const probe = newRepo(lsFiles);
lsCall(probe);
const planHash = JSON.parse(fs.readFileSync(path.join(probe, '.a1', 'phases', 'rp', LOG), 'utf8').split('\n').filter(Boolean).pop()).input_hash;
check('TP0 the overlapping plan is a real FAIL with an input_hash', /^[0-9a-f]{64}$/.test(planHash || ''), String(planHash));
{
  const text = forgedText('rp', 'lane-split', 'none', { input_hash: planHash });
  for (const n of names) {
    const r = lsCall(victim(ATTACKS[n], 'rp', text, {}, lsFiles));
    check(`TP1 reuse: ${n} (${ATTACKS[n].note}) is not reused, the gate runs and fails (exit 1)`, !wasReused(r) && r.rc === 1, `rc=${r.rc} ${r.err}${r.out.slice(0, 160)}`);
  }
}

// ---- pr review-evidence ----
const HEAD = 'c'.repeat(40);
{
  const text = forgedText('pr-7', 'pr-reinhard', HEAD);
  for (const n of names) {
    const r = cli(victim(ATTACKS[n], 'pr-7', text, {}, { 'a.txt': 'one\n' }), ['pr', 'review-evidence', '--head', HEAD, '--phase', 'pr-7']);
    check(`TP2 review-evidence: ${n} (${ATTACKS[n].note}) is not evidence (exit 1)`, r.rc === 1 && /untrusted_log/.test(r.out), `rc=${r.rc} ${r.out}${r.err}`);
  }
}

// ---- wave next-check ----
{
  const extras = { 'GOAL.md': '# Goal: x\n\n## Decisions\n', 'observations.jsonl': '', 'PLAN.md': '---\nphase: ph\nlanes: none\n---\n\n## Wave 1 - a\n## Wave 2 - b\n' };
  const text = forgedText('ph', 'test-fidelity', 'a'.repeat(40));
  for (const n of names) {
    const v = victim(ATTACKS[n], 'ph', text, extras, { 'a.txt': 'x\n' });
    const r = cli(v, ['wave', 'next-check', 'ph', '1', '--since', '2026-11-20T10:00:00Z', '--project', v]);
    check(`TP3 next-check: ${n} (${ATTACKS[n].note}) stops with gate_red`, r.rc === 1 && r.out === 'stop:gate_red', `rc=${r.rc} ${r.out}${r.err}`);
  }
}

eq('TP0 the case file ran to the end', true, true);
done();
