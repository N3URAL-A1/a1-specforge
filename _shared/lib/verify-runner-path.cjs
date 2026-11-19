'use strict';

// Runner path of `verify run` (spec 027 slice 3, FR-013/FR-014, plan D4-D9, D16-D18): preparation of the base
// runner, eligibility, one runner call per side, and the strict reader of the runner's JSON (D7).
// Pure module: no require of verify-run.cjs (helpers come in as `deps`), so there is no import cycle.
// Every error is the VerifyError of verify-base.cjs, the one verify-run.cjs re-exports (pr-merge-check maps it to exit 2).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const vb = require('./verify-base.cjs');
const { pinnedGitEnv } = require('./xprov-common.cjs');

const { VerifyError } = vb;

const RUNNER_FILES = Object.freeze(['bin/run-suites.sh', 'bin/run-suites-proc.sh', 'bin/run-suites-report.sh', '_test-fixtures/suite-groups.json']);
const CONTRACT_LINE = 'a1-suite-runner-contract 1';
const MAX_RESULT_BYTES = 1024 * 1024;
const FIXTURE_PREFIX = '_test-fixtures/';
const ID_RE = /^_test-fixtures\/[A-Za-z0-9._/-]+$/;
const SIGNAL_RE = /^SIG[A-Z0-9]+$/;
const CHECK_NAMES = Object.freeze(['reconcile', 'learnings', 'phases']);
const CHECK_STATES = Object.freeze(['not_selected', 'skipped_nogit', 'skipped_dirty', 'ok', 'failed']);
const LOCK_LINE_RE = /^run-suites: lock wait of \d+ ms exceeded/;
const PREP_TIMEOUT_MS = 30 * 1000;
const ARCHIVE_TIMEOUT_MS = 60 * 1000;
const CEILING_SLACK_MS = 60 * 1000;
const KILL_GRACE_MS = 10 * 1000; // same value as verify-run.cjs: spawnGroup adds it on top of the ceiling
const MAX_TIMER_MS = 2147483647;
const STDERR_TAIL_BYTES = 8192;
const MESSAGE_TAIL_CHARS = 500;
const TOP_KEYS = Object.freeze(['checks', 'contract', 'lock_wait_ms', 'results', 'root', 'subset', 'workers']);
const RESULT_KEYS = Object.freeze(['exit_code', 'id', 'leak_note', 'seconds', 'signal', 'summary_note', 'timed_out']);

const isInt = (v) => Number.isInteger(v);
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const sameKeys = (o, keys) => Object.keys(o).sort().join(',') === [...keys].sort().join(',');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Id as the runner knows it: the `_test-fixtures/` prefix removed. */
function identity(id) { return id.startsWith(FIXTURE_PREFIX) ? id.slice(FIXTURE_PREFIX.length) : id; }

function ruleOf(c) {
  if (c.kind !== 'none') return `reporter ${c.kind}`;
  if (c.requiresHost) return 'requires_host';
  if (!Array.isArray(c.argv) || c.argv.length !== 2 || c.argv[0] !== 'bash' || c.argv[1] !== c.id) return 'argv is not [bash, <id>]';
  if (typeof c.id !== 'string' || !ID_RE.test(c.id) || c.id.split('/').includes('..')) return 'id is not a _test-fixtures path';
  return null;
}

/**
 * D4: may this plan take the runner path?
 * @param {{source: string, skipped?: object[], commands: object[]}} basePlan the base-side plan
 * @param {object[]} headCommands the head-side commands
 * @returns {{ok: true} | {ok: false, why: string}} why = the first failing rule
 */
function eligibility(basePlan, headCommands) {
  if (!basePlan || basePlan.source !== 'verify.json') return { ok: false, why: 'plan source is not verify.json' };
  if (Array.isArray(basePlan.skipped) && basePlan.skipped.length > 0) return { ok: false, why: 'plan has host-skipped commands' };
  const all = [...basePlan.commands, ...headCommands];
  for (const c of all) {
    const why = ruleOf(c);
    if (why !== null) return { ok: false, why: `command ${c.id}: ${why}` };
  }
  const timeouts = new Set(all.map((c) => c.timeoutMs));
  if (timeouts.size > 1) return { ok: false, why: 'commands have different timeout_ms' };
  return { ok: true };
}

function extractRunnerFiles(project, baseSha, dir) {
  const a = spawnSync('git', ['-C', project, 'archive', '--format=tar', baseSha, ...RUNNER_FILES], { shell: false, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: ARCHIVE_TIMEOUT_MS, env: pinnedGitEnv(process.env) }); // SEC-2: no replace refs, no caller GIT_* redirects
  if (a.status !== 0) return false;
  const x = spawnSync('tar', ['-xf', '-', '-C', dir], { shell: false, input: a.stdout, stdio: ['pipe', 'ignore', 'ignore'], timeout: ARCHIVE_TIMEOUT_MS });
  return x.status === 0;
}

/**
 * SEC-1: the blob ids the four runner files have at the base sha (ls-tree, hardened env), as {path: id}; null when git cannot say.
 */
function baseBlobIds(project, baseSha) {
  const r = spawnSync('git', ['-C', project, 'ls-tree', '-z', baseSha, '--', ...RUNNER_FILES], { shell: false, encoding: 'utf8', timeout: ARCHIVE_TIMEOUT_MS, env: pinnedGitEnv(process.env) });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  const ids = {};
  for (const rec of r.stdout.split('\0').filter(Boolean)) {
    const m = /^100[67][0-9]{2} blob ([0-9a-f]+)\t(.+)$/.exec(rec);
    if (m) ids[m[2]] = m[1];
  }
  return RUNNER_FILES.every((f) => typeof ids[f] === 'string') ? ids : null;
}

/**
 * SEC-1: true only while every runner file of `dir` is still a regular file whose content hashes to the base blob id.
 * Head suites run between the runner calls and could rewrite the copy; this runs before each call.
 */
function copyIntact(project, dir, expected) {
  const files = RUNNER_FILES.map((f) => path.join(dir, f));
  for (const f of files) {
    let st;
    try { st = fs.lstatSync(f); } catch (_e) { return false; }
    if (!st.isFile() || st.isSymbolicLink()) return false;
  }
  const h = spawnSync('git', ['-C', project, 'hash-object', '--no-filters', '--', ...files], { shell: false, encoding: 'utf8', timeout: ARCHIVE_TIMEOUT_MS, env: pinnedGitEnv(process.env) });
  if (h.status !== 0 || typeof h.stdout !== 'string') return false;
  const got = h.stdout.split('\n').filter(Boolean);
  return got.length === RUNNER_FILES.length && RUNNER_FILES.every((f, i) => got[i] === expected[f]);
}

/**
 * D5: copy the runner from the BASE sha and ask it for the contract line.
 * @param {string} project repo root
 * @param {string} baseSha base commit
 * @param {object} env the runner env (D9)
 * @returns {{ok: true, dir: string, release: () => void, intact: () => boolean} | {ok: false, why: 'base_copy_missing'|'no_contract'}} dir = extracted copy, release removes it, intact = SEC-1 re-check against the base blobs
 */
function prepareRunner(project, baseSha, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-verify-runner-'));
  const unregister = vb.cleanupOnExit(dir);
  const release = () => { fs.rmSync(dir, { recursive: true, force: true }); unregister(); };
  const fail = (why) => { release(); return { ok: false, why }; };
  const expected = baseBlobIds(project, baseSha);
  if (expected === null || !extractRunnerFiles(project, baseSha, dir)) return fail('base_copy_missing');
  const intact = () => copyIntact(project, dir, expected);
  if (!intact()) return fail('base_copy_missing');
  const r = spawnSync('bash', [path.join(dir, 'bin', 'run-suites.sh'), '--contract'], { cwd: dir, env, shell: false, encoding: 'utf8', timeout: PREP_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.status !== 0 || typeof r.stdout !== 'string' || r.stdout.trim() !== CONTRACT_LINE) return fail('no_contract');
  return { ok: true, dir, release, intact };
}

/**
 * D17: spawn timeout for one runner call, capped so setTimeout in the group runner cannot overflow.
 * @param {number} remainingWaitMs lock wait still allowed
 * @param {number|number[]} timeoutsMs per-suite timeouts of the requested ids (a number is one timeout)
 * @returns {number} ms
 */
function runnerCeilingMs(remainingWaitMs, timeoutsMs) {
  const sum = (Array.isArray(timeoutsMs) ? timeoutsMs.reduce((a, b) => a + b, 0) : timeoutsMs);
  return Math.min(remainingWaitMs + sum + CEILING_SLACK_MS, MAX_TIMER_MS - KILL_GRACE_MS);
}

function invalid(msg) { return new VerifyError('runner_result_invalid', `runner result: ${msg}`); }

function checkResultShape(r, i) {
  const at = `results[${i}]`;
  if (!isObject(r) || !sameKeys(r, RESULT_KEYS)) throw invalid(`${at} has unexpected keys`);
  if (typeof r.id !== 'string' || r.id === '') throw invalid(`${at}.id is not a string`);
  if (r.exit_code !== null && !isInt(r.exit_code)) throw invalid(`${at}.exit_code is not an integer or null`);
  if (r.signal !== null && !(typeof r.signal === 'string' && SIGNAL_RE.test(r.signal))) throw invalid(`${at}.signal is not null or SIG<NAME>`);
  if (typeof r.timed_out !== 'boolean') throw invalid(`${at}.timed_out is not a boolean`);
  if (!isNonNegInt(r.seconds)) throw invalid(`${at}.seconds is not a non-negative integer`);
  if (typeof r.leak_note !== 'string' || typeof r.summary_note !== 'string') throw invalid(`${at} notes are not strings`);
}

function parseResultFile(file) {
  let st;
  try { st = fs.lstatSync(file); } catch (_e) { throw invalid('file missing'); }
  if (!st.isFile() || st.isSymbolicLink()) throw invalid('not a regular file');
  if (st.size > MAX_RESULT_BYTES) throw invalid('file larger than 1 MiB');
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { throw invalid('not valid JSON'); }
  if (!isObject(doc) || !sameKeys(doc, TOP_KEYS)) throw invalid('unexpected top-level keys');
  if (doc.contract !== 1) throw invalid('contract is not 1');
  if (typeof doc.root !== 'string' || typeof doc.subset !== 'boolean' || !isNonNegInt(doc.workers)) throw invalid('root, subset or workers have the wrong type');
  if (!isNonNegInt(doc.lock_wait_ms)) throw invalid('lock_wait_ms is not a non-negative integer');
  if (!Array.isArray(doc.results)) throw invalid('results is not an array');
  doc.results.forEach(checkResultShape);
  if (new Set(doc.results.map((r) => r.id)).size !== doc.results.length) throw invalid('duplicate result id');
  if (!isObject(doc.checks) || !sameKeys(doc.checks, CHECK_NAMES) || !CHECK_NAMES.every((k) => CHECK_STATES.includes(doc.checks[k]))) throw invalid('checks have unexpected keys or states');
  return doc;
}

const resultFails = (r) => r.exit_code !== 0 || r.signal !== null || r.timed_out === true || r.leak_note !== '';

/**
 * D7: validate the runner's JSON against the ids that were requested.
 * @param {string} file the --json-out file
 * @param {string[]} requestedIds ids as passed to the runner (identity form)
 * @param {number} runnerExit the runner's exit status
 * @returns {{results: object[], lockWaitMs: number, checks: object}} validated; throws VerifyError runner_result_invalid | runner_result_mismatch
 */
function readRunnerResult(file, requestedIds, runnerExit) {
  const doc = parseResultFile(file);
  const got = new Set(doc.results.map((r) => r.id));
  const want = new Set(requestedIds);
  const missing = [...want].filter((i) => !got.has(i));
  const extra = [...got].filter((i) => !want.has(i));
  if (missing.length > 0 || extra.length > 0) {
    throw new VerifyError('runner_result_mismatch', `runner result ids differ from the request; missing: [${missing.slice(0, 5).join(', ')}], extra: [${extra.slice(0, 5).join(', ')}]`);
  }
  const anyFail = doc.results.some(resultFails) || doc.results.some((r) => r.summary_note !== '') || CHECK_NAMES.some((k) => doc.checks[k] === 'failed');
  if (runnerExit === 1 && !anyFail) throw invalid('runner exit 1 but no result, note or check failed');
  return { results: doc.results, lockWaitMs: doc.lock_wait_ms, checks: doc.checks };
}

/**
 * D8: one runner result as a raw command record (finishCommand turns it into a verdict reason).
 * @param {{exit_code: number|null, signal: string|null, timed_out: boolean, seconds: number, leak_note: string}} result validated runner result
 * @param {string} id the full command id (`_test-fixtures/...`)
 * @returns {object} raw record; `leak_note` only when non-empty
 */
function toRaw(result, id) {
  const raw = {
    id, argv: ['bash', id], exit_code: result.exit_code, signal: result.signal, timed_out: result.timed_out, spawn_error: false,
    passed: null, failed: null, skipped: null, failed_ids: [], duration_ms: result.seconds * 1000,
  };
  return result.leak_note !== '' ? { ...raw, leak_note: result.leak_note } : raw;
}

function stderrTail(file) {
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, STDERR_TAIL_BYTES);
      buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
    } finally { fs.closeSync(fd); }
  } catch (_e) { return ''; }
  return buf.toString('utf8');
}

const sanitise = (s) => s.slice(-MESSAGE_TAIL_CHARS).replace(/[^\x20-\x7e\n]/g, '?'); // eslint-disable-line no-control-regex

function failFromExit(exit, tail) {
  const first = tail.split('\n').map((l) => l.trim()).find((l) => l !== '') || '';
  if (exit.status === 2 && !exit.signal && LOCK_LINE_RE.test(first)) return new VerifyError('lock_timeout', `runner lock: ${sanitise(tail.trim())}`);
  const what = exit.timedOut ? 'timed out' : exit.signal ? `killed by ${exit.signal}` : exit.spawnError ? 'could not start' : `exit ${exit.status}`;
  return new VerifyError('suite_runner_failed', `runner ${what}: ${sanitise(tail.trim())}`);
}

/**
 * Run one side (head, base or retry) through the runner and return its validated records.
 * @param {{runnerDir: string, root: string, ids: string[], side: 'head'|'base'|'retry', workers?: number, env: object, tmp: string, timeoutMs: number, lockWaitMs: number, deps: {spawnGroup: Function, noteSpawn: Function}, intact?: () => boolean}} o
 * @returns {{records: Map<string, object>, exit: number, ms: number, lockWaitMs: number, checksSkipped: string[], summaryNotes: {id: string, note: string}[], checks: object}}
 *   records = full id to raw record (D8); lockWaitMs = the runner's measured wait; checksSkipped = `<name>:<state>` for each check that neither ran ok nor was unselected
 */
function runSide(o) {
  const { runnerDir, root, ids, side, workers, env, tmp, timeoutMs, lockWaitMs, deps, intact } = o;
  if (typeof intact === 'function' && !intact()) throw invalid(`the base runner copy changed before the ${side} call`);
  const jsonFile = path.join(tmp, `runner-${side}.json`);
  const outFile = path.join(tmp, `runner-${side}.out`);
  const errFile = path.join(tmp, `runner-${side}.err`);
  const wanted = ids.map(identity);
  const argv = ['bash', path.join(runnerDir, 'bin', 'run-suites.sh'), '--root', root, '--groups-file', path.join(runnerDir, '_test-fixtures', 'suite-groups.json'),
    '--json-out', jsonFile, '--suite-timeout-ms', String(timeoutMs), '--lock-wait', String(lockWaitMs), ...(workers ? ['--workers', String(workers)] : []), ...wanted];
  ids.forEach((id) => deps.noteSpawn(`runner:${side}`, id));
  const t0 = process.hrtime.bigint();
  const exit = deps.spawnGroup(argv, root, outFile, runnerCeilingMs(lockWaitMs, ids.map(() => timeoutMs)), env, errFile);
  const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
  const status = typeof exit.status === 'number' ? exit.status : null;
  if (exit.spawnError === true || exit.timedOut === true || exit.signal || (status !== 0 && status !== 1)) throw failFromExit(exit, stderrTail(errFile));
  const read = readRunnerResult(jsonFile, wanted, status);
  const byId = new Map(read.results.map((r) => [r.id, r]));
  const records = new Map(ids.map((id) => [id, toRaw(byId.get(identity(id)), id)]));
  return {
    records, exit: status, ms, lockWaitMs: read.lockWaitMs, checks: read.checks,
    checksSkipped: CHECK_NAMES.filter((k) => !['ok', 'not_selected'].includes(read.checks[k])).map((k) => `${k}:${read.checks[k]}`),
    summaryNotes: read.results.filter((r) => r.summary_note !== '').map((r) => ({ id: r.id, note: r.summary_note })),
  };
}

module.exports = { RUNNER_FILES, CONTRACT_LINE, MAX_RESULT_BYTES, eligibility, prepareRunner, identity, runSide, runnerCeilingMs, readRunnerResult, toRaw };
