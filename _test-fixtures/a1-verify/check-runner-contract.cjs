'use strict';
// Unit cases RC1-RC9 for _shared/lib/verify-runner-path.cjs (spec 027 slice 3 wave 6). Prints `<id>\tPASS|FAIL\t<detail>` per case.
// Usage: node check-runner-contract.cjs <repo-root> <work-dir>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [repo, work] = process.argv.slice(2);
const rp = require(path.join(repo, '_shared/lib/verify-runner-path.cjs'));
const vb = require(path.join(repo, '_shared/lib/verify-base.cjs'));
const { VerifyError } = require(path.join(repo, '_shared/lib/verify-run.cjs'));
const out = [];
const rec = (id, okay, detail = '') => out.push(`${id}\t${okay ? 'PASS' : 'FAIL'}\t${detail}`);
const tryRun = (f) => { try { return { v: f() }; } catch (e) { return { e }; } };
const reasonOf = (r) => (r.e instanceof VerifyError ? r.e.reason : r.e ? `non-VerifyError:${r.e.message}` : 'no-throw');

// ---------- RC1 eligibility ----------
const cmd = (id, over = {}) => ({ id, argv: ['bash', id], kind: 'none', timeoutMs: 1000, viaScript: false, ...over });
const plan = (cmds, over = {}) => ({ source: 'verify.json', skipped: [], commands: cmds, ...over });
const A = '_test-fixtures/a/run-tests.sh';
const B = '_test-fixtures/b/run-tests.sh';
rec('RC1a each plan eligible', rp.eligibility(plan([cmd(A), cmd(B)]), [cmd(A), cmd(B)]).ok === true);
const r1b = rp.eligibility(plan([cmd(A, { kind: 'node-test' })]), [cmd(A)]);
rec('RC1b node-test not eligible, names the command', r1b.ok === false && r1b.why.includes(A) && r1b.why.includes('node-test'), r1b.why);
rec('RC1c argv bash -c x not eligible', rp.eligibility(plan([cmd(A, { argv: ['bash', '-c', 'x'] })]), [cmd(A)]).ok === false);
rec('RC1d id ../x not eligible', rp.eligibility(plan([cmd('../x')]), [cmd('../x')]).ok === false
  && rp.eligibility(plan([cmd('_test-fixtures/../x')]), [cmd('_test-fixtures/../x')]).ok === false);
rec('RC1e two timeouts not eligible', rp.eligibility(plan([cmd(A), cmd(B, { timeoutMs: 2000 })]), [cmd(A)]).ok === false);
rec('RC1f requires_host not eligible', rp.eligibility(plan([cmd(A, { requiresHost: ['linux'] })]), [cmd(A)]).ok === false);
rec('RC1g head command with a reporter not eligible', rp.eligibility(plan([cmd(A)]), [cmd(B, { kind: 'vitest' })]).ok === false);
rec('RC1h non-verify.json source / skipped commands not eligible', rp.eligibility(plan([cmd(A)], { source: 'package.json' }), [cmd(A)]).ok === false
  && rp.eligibility(plan([cmd(A)], { skipped: [{ id: 'x' }] }), [cmd(A)]).ok === false);

// ---------- planted base repos (RC2-RC4b) ----------
const g = (d, ...a) => spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
function baseRepo(name, files) {
  const d = path.join(work, name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(path.join(d, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(d, '_test-fixtures'), { recursive: true });
  g(d, 'init', '-q', '-b', 'main');
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(d, rel), content, { mode: 0o755 });
  g(d, 'add', '-A'); g(d, 'commit', '-q', '-m', 'base');
  return { d, sha: g(d, 'rev-parse', 'HEAD').stdout.trim() };
}
const real = (n) => fs.readFileSync(path.join(repo, 'bin', n), 'utf8');
const GROUPS = '{"serial":[],"no_count":[],"ci_jobs":{},"timings":{}}';
const env = { ...process.env, A1_VERIFY_LOCK_DIR: path.join(work, 'rc-lock'), A1_VERIFY_LOCK_WAIT_MS: '1000' };

const full = baseRepo('rc2', { 'bin/run-suites.sh': real('run-suites.sh'), 'bin/run-suites-proc.sh': real('run-suites-proc.sh'), 'bin/run-suites-report.sh': real('run-suites-report.sh'), '_test-fixtures/suite-groups.json': GROUPS });
const p2 = rp.prepareRunner(full.d, full.sha, env);
rec('RC2 prepareRunner on a base with the real runner: ok, 4 files', p2.ok === true && rp.RUNNER_FILES.every((f) => fs.existsSync(path.join(p2.dir, f))), JSON.stringify(p2.why || ''));
if (p2.ok) { p2.release(); rec('RC2b release removes the dir', !fs.existsSync(p2.dir)); }

const noRunner = baseRepo('rc3', { '_test-fixtures/suite-groups.json': GROUPS });
const p3 = rp.prepareRunner(noRunner.d, noRunner.sha, env);
rec('RC3 base without bin/run-suites.sh: base_copy_missing', p3.ok === false && p3.why === 'base_copy_missing', JSON.stringify(p3.why));

const stubFiles = (body) => ({ 'bin/run-suites.sh': body, 'bin/run-suites-proc.sh': '#', 'bin/run-suites-report.sh': '#', '_test-fixtures/suite-groups.json': GROUPS });
const s4 = baseRepo('rc4', stubFiles('#!/usr/bin/env bash\nexit 2\n'));
const p4 = rp.prepareRunner(s4.d, s4.sha, env);
rec('RC4 base runner stub exit 2: no_contract', p4.ok === false && p4.why === 'no_contract', JSON.stringify(p4.why));
const s4b = baseRepo('rc4b', stubFiles('#!/usr/bin/env bash\necho "a1-suite-runner-contract 1x"\nexit 0\n'));
const p4b = rp.prepareRunner(s4b.d, s4b.sha, env);
rec('RC4b contract line is an exact match, not a prefix: no_contract', p4b.ok === false && p4b.why === 'no_contract', JSON.stringify(p4b.why));
const s4c = baseRepo('rc4c', stubFiles(`#!/usr/bin/env bash\necho "${rp.CONTRACT_LINE}"\nexit 0\n`));
const p4c = rp.prepareRunner(s4c.d, s4c.sha, env);
rec('RC4c exact contract line from a stub: ok', p4c.ok === true, JSON.stringify(p4c.why || ''));
if (p4c.ok) p4c.release();

// ---------- RC5 readRunnerResult ----------
let n = 0;
const doc = (over = {}) => ({ contract: 1, root: '/r', subset: true, workers: 3, lock_wait_ms: 0,
  results: [{ id: 'a/run-tests.sh', exit_code: 0, signal: null, timed_out: false, seconds: 2, leak_note: '', summary_note: '' }],
  checks: { reconcile: 'not_selected', learnings: 'skipped_nogit', phases: 'skipped_nogit' }, ...over });
const plant = (d) => { n += 1; const f = path.join(work, `rr-${n}.json`); fs.writeFileSync(f, typeof d === 'string' ? d : JSON.stringify(d)); return f; };
const res = (o, over) => ({ ...o.results[0], ...over });
const read = (d, ids = ['a/run-tests.sh'], rc = 0) => tryRun(() => rp.readRunnerResult(plant(d), ids, rc));
const base = doc();
rec('RC5a valid file: ok', read(base).v !== undefined && read(base).v.results.length === 1);
const m1 = read(base, ['a/run-tests.sh', 'b/run-tests.sh']);
rec('RC5b missing id: runner_result_mismatch naming it', reasonOf(m1) === 'runner_result_mismatch' && m1.e.message.includes('b/run-tests.sh'), m1.e && m1.e.message);
const m2 = read(doc({ results: [res(base), res(base, { id: 'z/run-tests.sh' })] }));
rec('RC5c extra id: runner_result_mismatch naming it', reasonOf(m2) === 'runner_result_mismatch' && m2.e.message.includes('z/run-tests.sh'), m2.e && m2.e.message);
rec('RC5d duplicate id: runner_result_invalid', reasonOf(read(doc({ results: [res(base), res(base)] }))) === 'runner_result_invalid');
rec('RC5e exit_code "0": invalid', reasonOf(read(doc({ results: [res(base, { exit_code: '0' })] }))) === 'runner_result_invalid');
rec('RC5f signal "KILL": invalid', reasonOf(read(doc({ results: [res(base, { exit_code: null, signal: 'KILL' })] }))) === 'runner_result_invalid');
rec('RC5g contract 2: invalid', reasonOf(read(doc({ contract: 2 }))) === 'runner_result_invalid');
rec('RC5h lock_wait_ms -1: invalid', reasonOf(read(doc({ lock_wait_ms: -1 }))) === 'runner_result_invalid');
rec('RC5i every error is the VerifyError that verify-run exports', [m1, m2, read('{', ['x'])].every((r) => r.e instanceof VerifyError && r.e instanceof vb.VerifyError));
const pad = (size) => { const s = JSON.stringify(doc()); return s + ' '.repeat(size - s.length); };
rec('RC5j file of exactly 1 MiB is read, 1 MiB + 1 is invalid', read(pad(rp.MAX_RESULT_BYTES)).v !== undefined && reasonOf(read(pad(rp.MAX_RESULT_BYTES + 1))) === 'runner_result_invalid');
const target = plant(base); const link = path.join(work, 'rr-link.json');
fs.rmSync(link, { force: true }); fs.symlinkSync(target, link);
rec('RC5k symlink to a valid file: invalid', reasonOf(tryRun(() => rp.readRunnerResult(link, ['a/run-tests.sh'], 0))) === 'runner_result_invalid');
rec('RC5l unknown check state: invalid', reasonOf(read(doc({ checks: { reconcile: 'maybe', learnings: 'ok', phases: 'ok' } }))) === 'runner_result_invalid');
rec('RC5m missing file: invalid', reasonOf(tryRun(() => rp.readRunnerResult(path.join(work, 'nope.json'), ['x'], 0))) === 'runner_result_invalid');

// ---------- RC6 consistency ----------
rec('RC6a runner exit 1, all green, no notes, no failed check: runner_result_invalid', reasonOf(read(base, ['a/run-tests.sh'], 1)) === 'runner_result_invalid');
rec('RC6b runner exit 0 with an exit_code 1 result: valid (red wins later)', read(doc({ results: [res(base, { exit_code: 1 })] }), ['a/run-tests.sh'], 0).v !== undefined);
rec('RC6c runner exit 1 with a failing result: valid', read(doc({ results: [res(base, { exit_code: 1 })] }), ['a/run-tests.sh'], 1).v !== undefined);
rec('RC6d runner exit 1 with a summary note only: valid', read(doc({ results: [res(base, { summary_note: 'no assert summary' })] }), ['a/run-tests.sh'], 1).v !== undefined);
rec('RC6e runner exit 1 with a failed check only: valid', read(doc({ checks: { reconcile: 'failed', learnings: 'ok', phases: 'ok' } }), ['a/run-tests.sh'], 1).v !== undefined);

// ---------- RC7 toRaw ----------
const ID = '_test-fixtures/a/run-tests.sh';
const leak = rp.toRaw(res(base, { leak_note: 'wrote into its sentinel vault' }), ID);
rec('RC7a leak note result carries leak_note', leak.leak_note === 'wrote into its sentinel vault' && leak.id === ID && leak.argv.join(' ') === `bash ${ID}`);
const clean = rp.toRaw(res(base), ID);
rec('RC7b clean result has no leak_note key, D8 shape', !('leak_note' in clean) && clean.duration_ms === 2000 && clean.spawn_error === false && clean.passed === null && Array.isArray(clean.failed_ids));
const killed = rp.toRaw(res(base, { exit_code: null, signal: 'SIGKILL' }), ID);
rec('RC7c signal 137 (SIGKILL, exit_code null): raw keeps both', killed.exit_code === null && killed.signal === 'SIGKILL');

// ---------- RC8 isRetryable seam ----------
rec('RC8a isRetryable is exported', typeof vb.isRetryable === 'function');
rec('RC8b RETRYABLE / NEVER_PRE_EXISTING equal their bc47b07 values', JSON.stringify(vb.RETRYABLE) === JSON.stringify(['command_failed', 'reported_failures', 'signal', 'implausible_crash'])
  && JSON.stringify(vb.NEVER_PRE_EXISTING) === JSON.stringify(['timeout', 'implausible_crash']));

// ---------- RC9 ceiling ----------
rec('RC9a (1000, [2000]) is 63000', rp.runnerCeilingMs(1000, [2000]) === 63000, String(rp.runnerCeilingMs(1000, [2000])));
rec('RC9b (0, 25 x 86400000) is capped at 2147483647 - 10000', rp.runnerCeilingMs(0, Array(25).fill(86400000)) === 2147483647 - 10000);

// ---------- RC10 runSide with a fake spawnGroup ----------
const tmp = path.join(work, 'rs-tmp'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
const spawned = []; const noted = [];
const mkdeps = (exit, writeJson, errText) => ({
  noteSpawn: (l, id) => noted.push(`${l}\t${id}`),
  spawnGroup: (argv, cwd, so, to, e, se) => { spawned.push({ argv, cwd, to, se }); if (writeJson) fs.writeFileSync(argv[argv.indexOf('--json-out') + 1], JSON.stringify(writeJson)); if (errText) fs.writeFileSync(se, errText); return exit; },
});
const base2 = { runnerDir: '/rd', root: '/root', ids: [A], side: 'head', workers: 2, env: {}, tmp, timeoutMs: 1000, lockWaitMs: 500 };
const okRun = tryRun(() => rp.runSide({ ...base2, deps: mkdeps({ status: 0 }, doc({ results: [{ ...base.results[0], id: 'a/run-tests.sh', seconds: 3 }], lock_wait_ms: 1200, checks: { reconcile: 'skipped_dirty', learnings: 'ok', phases: 'not_selected' } })) }));
const sp = spawned[0] || { argv: [] };
rec('RC10a runSide argv, cwd, ceiling, stderr file', okRun.v && sp.cwd === '/root' && sp.to === 61500 && sp.se === path.join(tmp, 'runner-head.err')
  && sp.argv.slice(0, 4).join(' ') === 'bash /rd/bin/run-suites.sh --root /root' && sp.argv.includes('--workers') && sp.argv[sp.argv.length - 1] === 'a/run-tests.sh'
  && sp.argv[sp.argv.indexOf('--groups-file') + 1] === '/rd/_test-fixtures/suite-groups.json' && sp.argv[sp.argv.indexOf('--lock-wait') + 1] === '500' && sp.argv[sp.argv.indexOf('--suite-timeout-ms') + 1] === '1000', JSON.stringify(sp));
rec('RC10b runSide result: record by full id, lock wait, skipped checks, spawn log line', okRun.v && okRun.v.records.get(A).duration_ms === 3000 && okRun.v.lockWaitMs === 1200
  && okRun.v.checksSkipped.join(',') === 'reconcile:skipped_dirty' && noted[0] === `runner:head\t${A}`, JSON.stringify(okRun.v && okRun.v.checksSkipped));
const lockErr = tryRun(() => rp.runSide({ ...base2, deps: mkdeps({ status: 2 }, null, 'run-suites: lock wait of 500 ms exceeded; another run holds the lock\x1b[0m') }));
rec('RC10c exit 2 with the lock line: lock_timeout, control chars replaced', reasonOf(lockErr) === 'lock_timeout' && !/\x1b/.test(lockErr.e.message), lockErr.e && lockErr.e.message);
const otherErr = tryRun(() => rp.runSide({ ...base2, deps: mkdeps({ status: 2 }, null, 'run-suites: unknown argument') }));
rec('RC10d any other exit 2: suite_runner_failed', reasonOf(otherErr) === 'suite_runner_failed');
rec('RC10e exit 3, a signal and a timeout: suite_runner_failed', ['{"status":3}', '{"signal":"SIGKILL"}', '{"status":null,"timedOut":true}'].every((j) => reasonOf(tryRun(() => rp.runSide({ ...base2, deps: mkdeps(JSON.parse(j), null, '') }))) === 'suite_runner_failed'));
const forged = tryRun(() => rp.runSide({ ...base2, deps: mkdeps({ status: 3 }, null, 'run-suites: lock wait of 5 ms exceeded') }));
rec('RC10f lock line with exit 3 is not lock_timeout', reasonOf(forged) === 'suite_runner_failed');
const mism = tryRun(() => rp.runSide({ ...base2, ids: [A, B], deps: mkdeps({ status: 0 }, doc()) }));
rec('RC10g runner returns a different id set: runner_result_mismatch', reasonOf(mism) === 'runner_result_mismatch');

process.stdout.write(`${out.join('\n')}\n`);
