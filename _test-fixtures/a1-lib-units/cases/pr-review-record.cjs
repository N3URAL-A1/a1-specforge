'use strict';

// pr-review-record.cjs (spec 027 FR-019, plan D4): `pr review-record` and `pr review-evidence`.
// Every case runs the real CLI facade as a child in a planted git repo (scope pr-7), so the registry
// hook writes the gate-log line exactly as in production. Literals only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'rr-'));
const TOOLS = path.join(LIB, '..', 'a1-tools.cjs');
const ENV = {
  PATH: process.env.PATH, HOME: path.join(WORK, 'home'), TMPDIR: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};
fs.mkdirSync(ENV.HOME, { recursive: true });

let seq = 0;
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function newRepo() {
  seq += 1;
  const d = path.join(WORK, `repo${seq}`);
  fs.mkdirSync(d, { recursive: true });
  git(d, '-c', 'init.defaultBranch=main', 'init', '-q');
  fs.writeFileSync(path.join(d, 'a.txt'), 'one\n');
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'base');
  return d;
}
function commit(repo, text) {
  fs.writeFileSync(path.join(repo, 'a.txt'), text);
  git(repo, 'commit', '-qam', text.trim());
  return git(repo, 'rev-parse', 'HEAD');
}
function pr(cwd, sub, args) {
  const r = spawnSync(process.execPath, [TOOLS, 'pr', sub, ...args], { cwd, env: ENV, encoding: 'utf8', timeout: 60000 });
  return { rc: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const logFile = (repo, scope) => path.join(repo, '.a1', 'phases', scope, 'gate-log.jsonl');
const logOf = (repo, scope) => (fs.existsSync(logFile(repo, scope)) ? fs.readFileSync(logFile(repo, scope), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const rec = (repo, head, verdict, extra) => pr(repo, 'review-record', ['--head', head, '--verdict', verdict, ...(extra || ['--phase', 'pr-7'])]);
const ev = (repo, head, extra) => pr(repo, 'review-evidence', ['--head', head, ...(extra || ['--phase', 'pr-7'])]);

const repo = newRepo();
const sha1 = git(repo, 'rev-parse', 'HEAD');

// RR1 record pass: exit 0, exactly one new log line with the verdict and head.
let r = rec(repo, sha1, 'pass');
let lines = logOf(repo, 'pr-7');
check('RR1 record pass: exit 0, one log line, gate pr-reinhard, verdict pass, head_sha = HEAD', r.rc === 0 && lines.length === 1 && lines[0].gate === 'pr-reinhard' && lines[0].verdict === 'pass' && lines[0].head_sha === sha1, `rc=${r.rc} ${JSON.stringify(lines)} ${r.err}`);
// RR2 evidence at the same sha
r = ev(repo, sha1);
eq('RR2 evidence at the recorded sha exits 0', r.rc, 0);
// RR3 new commit, new sha
const sha2 = commit(repo, 'two\n');
r = ev(repo, sha2);
eq('RR3 evidence for a new head sha exits 1', r.rc, 1);
// RR4 record fail
r = rec(repo, sha2, 'fail');
lines = logOf(repo, 'pr-7');
check('RR4 record fail: exit 1, last log line verdict fail', r.rc === 1 && lines[lines.length - 1].verdict === 'fail' && lines[lines.length - 1].head_sha === sha2, `rc=${r.rc} ${JSON.stringify(lines.slice(-1))}`);
// RR5 last record wins
r = ev(repo, sha2);
check('RR5 evidence for the failed sha exits 1 (no_pass_for_head)', r.rc === 1 && /no_pass_for_head/.test(r.err), `rc=${r.rc} ${r.err}`);
// RR5b/RR5c the last record of one sha decides, in both orders
const ord = newRepo();
const so = git(ord, 'rev-parse', 'HEAD');
rec(ord, so, 'pass');
rec(ord, so, 'fail');
eq('RR5b pass then fail at the same sha: evidence exits 1', ev(ord, so).rc, 1);
rec(ord, so, 'pass');
eq('RR5c pass, fail, pass at the same sha: evidence exits 0', ev(ord, so).rc, 0);
// RR6 head of the parent commit
const before6 = logOf(repo, 'pr-7').length;
r = rec(repo, sha1, 'pass');
check('RR6 --head of the parent commit: exit 2, head_mismatch', r.rc === 2 && /head_mismatch/.test(r.err), `rc=${r.rc} ${r.err}`);
const after6 = logOf(repo, 'pr-7');
check('RR6b the exit-2 record carries verdict error, never pass', after6.length === before6 + 1 && after6[after6.length - 1].verdict === 'error', JSON.stringify(after6.slice(-1)));
// RR7 no --phase
const count7 = logOf(repo, 'pr-7').length;
r = rec(repo, sha2, 'pass', []);
check('RR7 no --phase: exit 2, phase_required, no new line in .a1/phases/pr-7/', r.rc === 2 && /phase_required/.test(r.err) && logOf(repo, 'pr-7').length === count7, `rc=${r.rc} ${r.err}`);
// RR8 garbage line
const bad = newRepo();
const sb = git(bad, 'rev-parse', 'HEAD');
rec(bad, sb, 'pass');
fs.appendFileSync(logFile(bad, 'pr-7'), 'garbage\n');
r = ev(bad, sb);
check('RR8 evidence with a garbage line appended: exit 1, untrusted_log', r.rc === 1 && /untrusted_log/.test(r.err), `rc=${r.rc} ${r.err}`);
// RR9 no log
const fresh = newRepo();
r = ev(fresh, git(fresh, 'rev-parse', 'HEAD'));
check('RR9 evidence with no log: exit 1, no_log', r.rc === 1 && /no_log/.test(r.err), `rc=${r.rc} ${r.err}`);
// RR10 verdict maybe
r = rec(repo, sha2, 'maybe');
eq('RR10 --verdict maybe exits 2', r.rc, 2);
// RR11 --head shapes
r = rec(repo, 'abc123', 'pass');
eq('RR11a --head not 40-hex exits 2', r.rc, 2);
r = rec(repo, '', 'pass');
eq('RR11b an empty --head exits 2', r.rc, 2);
r = ev(repo, 'XYZ');
eq('RR11c evidence with a bad --head exits 2', r.rc, 2);
// RR12 unknown flag
r = pr(repo, 'review-record', ['--head', sha2, '--verdict', 'pass', '--bogus', 'x', '--phase', 'pr-7']);
eq('RR12a an unknown flag on review-record exits 2', r.rc, 2);
r = ev(repo, sha2, ['--phase', 'pr-7', '--bogus', 'x']);
eq('RR12b an unknown flag on review-evidence exits 2', r.rc, 2);
// RR13 one line per call
const two = newRepo();
const st = git(two, 'rev-parse', 'HEAD');
rec(two, st, 'pass');
rec(two, st, 'pass');
eq('RR13 two record calls write exactly 2 lines', logOf(two, 'pr-7').length, 2);

done();
