'use strict';

// wave-checks.cjs (spec 027 FR-024, plan D11): `wave checks` runs the three per-wave gates as children of the facade.
// Every case plants a git repo (base commit + wave commit) and runs the real CLI with cwd = a DIFFERENT temp dir, so a
// child spawned without the project dir as cwd writes its log line into the wrong repo (WC1, WC4). Planted defects are
// a copy of a real file (the schema-check fail-no-rls migration); the skipped test of WC3 is synthetic.
// Literals only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'wc-'));
const TOOLS = path.join(LIB, '..', 'a1-tools.cjs');
const REPO = path.join(LIB, '..', '..');
const gateLog = require(path.join(LIB, 'gate-log.cjs'));
const REAL_SQL = path.join(REPO, '_test-fixtures', 'a1-schema-check', 'fail-no-rls', 'migrations', '001.sql');
const ENV = { PATH: process.env.PATH, HOME: path.join(WORK, 'home'), TMPDIR: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
fs.mkdirSync(ENV.HOME, { recursive: true });
const SLUG = 's';

let seq = 0;
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}
/** Plants a repo: a base commit tagged `base`, then one wave commit holding `files` ({relpath: text}). */
function plant(files) {
  seq += 1;
  const root = path.join(WORK, `repo${seq}`);
  fs.mkdirSync(path.join(root, '.a1', 'phases', SLUG), { recursive: true });
  git(root, '-c', 'init.defaultBranch=main', 'init', '-q');
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base'); git(root, 'tag', 'base');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'wave');
  return root;
}
function wc(root, args) {
  const cwd = fs.mkdtempSync(path.join(WORK, 'cwd-'));
  const r = spawnSync(process.execPath, [TOOLS, 'wave', 'checks', ...args], { cwd, env: ENV, encoding: 'utf8', timeout: 180000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (_e) { /* usage error: no JSON */ }
  return { rc: r.status, json, err: r.stderr || '', cwd };
}
const ARGS = (root, extra) => [SLUG, '1', '--diff-base', 'base', '--project', root, '--phase', SLUG, ...(extra || [])];
const byGate = (r, gate) => (r.json && r.json.checks.find((c) => c.gate === gate)) || {};
function logGates(root) {
  const t = gateLog.readTrustedChain(root, SLUG);
  return t.ok ? t.chain.records.map((x) => `${x.gate}:${x.verdict}`).sort() : [`untrusted:${t.reason}`];
}

const README = { 'README.md': 'wave\n' };

// WC1 all green; log lines land in the project's log, none in the cwd.
{
  const root = plant(README);
  const r = wc(root, ARGS(root));
  check('WC1 exit 0', r.rc === 0, `rc=${r.rc} err=${r.err}`);
  check('WC1 three entries in order', r.json && r.json.checks.map((c) => c.gate).join(',') === 'gate-0.7-realpath,gate-0.6-schema,test-fidelity', JSON.stringify(r.json));
  check('WC1 schema-check skipped: no_migrations', byGate(r, 'gate-0.6-schema').skipped === 'no_migrations');
  check('WC1 two log lines in the project log', logGates(root).join(',') === 'gate-0.7-realpath:pass,test-fidelity:pass', logGates(root).join(','));
  check('WC1 the cwd got no .a1 dir', !fs.existsSync(path.join(r.cwd, '.a1')));
}
// WC2 the wave adds a .sql file with SELECT and no evidence: realpath red, fidelity still runs.
{
  const root = plant({ 'db/q.sql': fs.readFileSync(REAL_SQL, 'utf8') + 'SELECT id FROM users;\n' });
  const r = wc(root, ARGS(root));
  check('WC2 exit 1', r.rc === 1, `rc=${r.rc} err=${r.err}`);
  check('WC2 realpath exit 1', byGate(r, 'gate-0.7-realpath').exit === 1);
  check('WC2 test-fidelity still ran (exit 0)', byGate(r, 'test-fidelity').exit === 0, JSON.stringify(byGate(r, 'test-fidelity')));
}
// WC3 the wave adds a skipped test.
{
  // Synthetic on purpose: the real postmortem test carries SQL and RLS shapes, which would turn realpath red as well.
  const root = plant({ 'tests/greet.test.ts': "import { greet } from '../src/greet';\n\ndescribe('greet', () => {\n  it.skip('says hello', () => {\n    expect(greet('a')).toBe('hello a');\n  });\n});\n" });
  const r = wc(root, ARGS(root));
  check('WC3 exit 1', r.rc === 1, `rc=${r.rc} err=${r.err}`);
  check('WC3 realpath green', byGate(r, 'gate-0.7-realpath').exit === 0, JSON.stringify(byGate(r, 'gate-0.7-realpath')));
  check('WC3 test-fidelity exit 1', byGate(r, 'test-fidelity').exit === 1);
}
// WC4 --migrations with a migration missing RLS: all three reported, the schema line is in the project's log.
{
  const root = plant(README);
  const mig = path.join(root, 'migrations');
  fs.mkdirSync(mig);
  fs.copyFileSync(REAL_SQL, path.join(mig, '001.sql'));
  const r = wc(root, ARGS(root, ['--migrations', mig]));
  check('WC4 exit 1', r.rc === 1, `rc=${r.rc} err=${r.err}`);
  check('WC4 schema-check exit 1', byGate(r, 'gate-0.6-schema').exit === 1);
  check('WC4 all three reported with an exit code', r.json && r.json.checks.length === 3 && r.json.checks.every((c) => typeof c.exit === 'number'));
  check('WC4 gate-0.6-schema line in the project log', logGates(root).includes('gate-0.6-schema:fail'), logGates(root).join(','));
  check('WC4 the cwd got no .a1 dir', !fs.existsSync(path.join(r.cwd, '.a1')));
}
// WC5 --phase other than the slug.
{
  const root = plant(README);
  const r = wc(root, [SLUG, '1', '--diff-base', 'base', '--project', root, '--phase', 'other']);
  check('WC5 --phase other -> exit 2, no children run', r.rc === 2 && r.json === null && logGates(root)[0].startsWith('untrusted'), `rc=${r.rc} err=${r.err}`);
}
// WC6 no --diff-base.
{
  const root = plant(README);
  const r = wc(root, [SLUG, '1', '--project', root, '--phase', SLUG]);
  check('WC6 no --diff-base -> exit 2', r.rc === 2 && /diff-base/.test(r.err), `rc=${r.rc} err=${r.err}`);
}
// WC7 an unknown ref: a child exit 2 propagates, all three still reported.
{
  const root = plant(README);
  const r = wc(root, [SLUG, '1', '--diff-base', 'nope', '--project', root, '--phase', SLUG]);
  check('WC7 exit 2', r.rc === 2, `rc=${r.rc} err=${r.err}`);
  check('WC7 realpath and test-fidelity exit 2, schema skipped', byGate(r, 'gate-0.7-realpath').exit === 2 && byGate(r, 'test-fidelity').exit === 2 && byGate(r, 'gate-0.6-schema').skipped === 'no_migrations', JSON.stringify(r.json));
}

// WC7b (PR B review fix round 1): a failing child keeps BOTH tails; stderr no longer hides behind a non-empty stdout.
{
  const root = plant(README);
  const r = wc(root, [SLUG, '1', '--diff-base', 'nope', '--project', root, '--phase', SLUG]);
  const c = byGate(r, 'test-fidelity');
  check('WC7b the failing child carries stdout_tail and stderr_tail, stderr_tail names the bad ref', typeof c.stdout_tail === 'string' && typeof c.stderr_tail === 'string' && /nope/.test(c.stderr_tail), JSON.stringify(c));
}

// WC8 `--help` prints the usage only (stdout, exit 0), no error line before it.
{
  const cwd = fs.mkdtempSync(path.join(WORK, 'cwd-'));
  for (const flag of ['--help', '-h']) {
    const r = spawnSync(process.execPath, [TOOLS, 'wave', 'checks', flag], { cwd, env: ENV, encoding: 'utf8', timeout: 60000 });
    check(`WC8 wave checks ${flag}: exit 0, usage on stdout, stderr empty`, r.status === 0 && /^usage: a1-tools wave checks /.test(r.stdout) && r.stderr === '', `rc=${r.status} out=${r.stdout} err=${r.stderr}`);
  }
}

done();
