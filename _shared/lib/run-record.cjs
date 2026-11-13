'use strict';

// ---------------------------------------------------------------------------
// run record (spec 027-lean-pipeline, FR-035, D5, D10). Keeps the gate-log result and the
// measured durations of one scope in the learning store, so they outlive the worktree.
//   <store>/_runs/<project>.jsonl   one JSON line per (scope, pr); owner: this module
// Exit: 0 recorded or already recorded / 1 precondition not met (nothing changes) / 2 usage,
// hostile value, I/O error or refused write path.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseFlags } = require('./io.cjs');
const { peekVaultRoot } = require('./io-roots.cjs');
const { assertAncestorInside, writeTextAtomic } = require('./fs-safe.cjs');
const { validateScope, assertContained } = require('./gate-log.cjs');
const { readGateLog, gatesFired } = require('./retro-gatelog.cjs');
const { repoProjectSlug } = require('./project-slug.cjs');
const { emitExit } = require('./emit-exit.cjs');

const MAX_REPO_CHARS = 4096;
const MAX_RUNS_FILE_BYTES = 20 * 1024 * 1024;
const PR_RE = /^[1-9][0-9]{0,6}$/;
const FILE_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const MERGE_CHECK = 'pr-merge-check';
const FLAGS = { repo: 'string', scope: 'string', pr: 'string' };
const USAGE = 'usage: a1-tools run record --repo <path> --scope <spec-id> [--pr <n>]';

class RunError extends Error {
  constructor(exit, code, message) { super(message); this.exit = exit; this.code = code; }
}

const usageErr = (msg) => new RunError(2, 'usage', msg);

/** @param {string[]} args @returns {{repo: string, scope: string, pr: number|null}} */
function parseArgs(args) {
  const f = parseFlags(args, FLAGS);
  if (f._.length > 0) throw usageErr(`unexpected argument: ${JSON.stringify(String(f._[0]).slice(0, 60))}`);
  const repo = f.repo;
  if (typeof repo !== 'string' || repo === '' || repo.length > MAX_REPO_CHARS || repo.includes('\0')) throw usageErr('--repo is required (a directory path, at most 4096 characters)');
  let isDir = false;
  try { isDir = fs.statSync(repo).isDirectory(); } catch (_e) { /* not there */ }
  if (!isDir) throw usageErr('--repo is not an existing directory');
  if (typeof f.scope !== 'string') throw usageErr('--scope is required');
  try { validateScope(f.scope); } catch (e) { throw usageErr(e.message); }
  if (f.pr !== undefined && !PR_RE.test(String(f.pr))) throw usageErr('--pr must be a positive integer of at most 7 digits');
  return { repo: path.resolve(repo), scope: f.scope, pr: f.pr === undefined ? null : Number(f.pr) };
}

/** @returns {string} the learning-store directory @throws RunError exit 1 when there is none */
function storeDir() {
  const peek = peekVaultRoot();
  const dir = peek ? path.join(peek.root, 'pattern', 'a1-learnings') : null;
  let isDir = false;
  try { isDir = dir !== null && fs.statSync(dir).isDirectory(); } catch (_e) { /* absent */ }
  if (!isDir) throw new RunError(1, 'no_learning_store', 'no learning store (pattern/a1-learnings is absent); nothing was written');
  return dir;
}

/** @returns {{file: string, existing: string}} the runs file, refused when a link or too big @throws RunError exit 2 */
function runsFile(store, project) {
  const runsDir = path.join(store, '_runs');
  const file = path.join(runsDir, `${project}.jsonl`);
  try {
    assertAncestorInside(runsDir, fs.realpathSync(store));
    let st = null;
    try { st = fs.lstatSync(runsDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (st && (st.isSymbolicLink() || !st.isDirectory())) throw new Error('_runs is not a real directory');
    let fst = null;
    try { fst = fs.lstatSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (fst && (!fst.isFile() || fst.isSymbolicLink())) throw new Error('the runs file is not a regular file');
    if (fst && fst.size > MAX_RUNS_FILE_BYTES) throw new Error('the runs file is larger than 20 MB');
    return { file, existing: fst ? fs.readFileSync(file, 'utf8') : '' };
  } catch (e) {
    throw new RunError(2, 'refused_write_path', `refusing ${path.basename(file)}: ${e.message}`);
  }
}

/** @param {Object[]} records @returns {Object[]} one entry per gate: id, verdict, caught, runs, duration sums */
function gateEntries(records) {
  return gatesFired(records).map(({ id, verdict, caught }) => {
    const own = records.filter((r) => r.gate === id);
    const timed = own.filter((r) => Number.isInteger(r.duration_ms));
    const entry = {
      id, verdict, caught, runs: own.length,
      duration_ms_sum: timed.length === 0 ? null : timed.reduce((a, r) => a + r.duration_ms, 0),
      no_duration: own.length - timed.length,
    };
    if (id !== MERGE_CHECK) return entry;
    const why = {};
    for (const r of own) {
      const k = typeof r.ci_evidence_why === 'string' ? r.ci_evidence_why : 'unknown';
      why[k] = (why[k] || 0) + 1;
    }
    return { ...entry, ci_evidence_why: why };
  });
}

/** @returns {Object[]} the gate-log records of the scope @throws RunError exit 1 or 2 */
function readRecords(repo, scope) {
  const logPath = path.join(repo, '.a1', 'phases', scope, 'gate-log.jsonl');
  try { assertContained(repo, scope, logPath); } catch (e) { throw new RunError(2, 'refused_log_path', e.message); }
  if (!fs.existsSync(logPath)) throw new RunError(1, 'no_gate_log', `no gate log for scope ${scope}`);
  let log;
  try { log = readGateLog(logPath); } catch (e) {
    if (e.code === 'A1_GATELOG') throw new RunError(1, 'gate_log_untrusted', e.message);
    throw new RunError(2, 'io', e.message);
  }
  if (log.records.length === 0) throw new RunError(1, 'empty_gate_log', `the gate log of ${scope} has no records`);
  return log.records;
}

function alreadyRecorded(existing, scope, pr) {
  for (const line of existing.split('\n')) {
    if (!line) continue;
    let o = null;
    try { o = JSON.parse(line); } catch (_e) { continue; }
    if (o && o.scope === scope && (o.pr === undefined ? null : o.pr) === pr) return true;
  }
  return false;
}

/** @param {{repo: string, scope: string, pr: number|null}} a @returns {{exit: number, out: Object}} */
function record(a) {
  const project = repoProjectSlug(a.repo);
  if (!FILE_SLUG_RE.test(project)) throw usageErr('the derived project name is not a safe file name');
  const store = storeDir();
  const { file, existing } = runsFile(store, project);
  const records = readRecords(a.repo, a.scope);
  if (alreadyRecorded(existing, a.scope, a.pr)) return { exit: 0, out: { status: 'already_recorded', file, project, scope: a.scope, pr: a.pr } };
  const line = {
    schema: 1, recorded_at: new Date().toISOString(), project, scope: a.scope, pr: a.pr,
    head_sha: records[records.length - 1].head_sha, gates: gateEntries(records),
  };
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
  try { writeTextAtomic(file, `${existing}${sep}${JSON.stringify(line)}\n`); } catch (e) { throw new RunError(2, 'io', e.message); }
  return { exit: 0, out: { status: 'recorded', file, project, scope: a.scope, pr: a.pr, gates: line.gates.length } };
}

/**
 * @param {string|undefined} sub - only `record`
 * @param {string[]} args
 */
function cmdRun(sub, args) {
  try {
    if (sub !== 'record') throw usageErr(sub ? `unknown run subcommand: ${String(sub).slice(0, 40)}` : 'run requires a subcommand: run record');
    const res = record(parseArgs(args));
    return emitExit(res.exit, `${JSON.stringify(res.out)}\n`, '');
  } catch (e) {
    if (!(e instanceof RunError)) return emitExit(2, '', `run record: ${e && e.message ? e.message : String(e)}\n`);
    const payload = e.exit === 1 ? `${JSON.stringify({ status: 'refused', reason: e.code, message: e.message })}\n` : '';
    const err = e.exit === 2 ? `run record: ${e.message}${e.code === 'usage' ? `\n${USAGE}` : ''}\n` : '';
    return emitExit(e.exit, payload, err);
  }
}

module.exports = { cmdRun, gateEntries };
