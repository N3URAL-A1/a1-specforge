'use strict';

// ---------------------------------------------------------------------------
// machine-retro (spec 027 slice 5, FR-031, plan D6). `feature close` derives one machine record per merged PR from the gate
// logs of the worktree and appends it to <store>/a1-new-feature.md before the worktree exit. Prose is asked for only when a
// gate caught something, the result is not pass, or the owner named an issue. Nothing here deletes anything; a refused write
// path or an I/O error throws with `exit: 2` so the caller stops before the worktree exit (fail closed).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { UNSCOPED, acquireLock, releaseLock, logPathFor } = require('./gate-log.cjs');
const { listGateLogs } = require('./worktree-gatelog.cjs');
const { gatesFired, readGateLog, mergeByTs } = require('./retro-gatelog.cjs');
const { writeTextAtomic } = require('./fs-safe.cjs');

const STORE_FILE = 'a1-new-feature.md';
const LOCK_DIR = 'a1-new-feature.lock.d';
const MAX_BYTES = 20 * 1024 * 1024;
const RETRO_SCOPE_PREFIX = 'retro-';

function refuse(message) {
  const err = new Error(message);
  err.exit = 2;
  return err;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {{records: Object[], issues?: string[]}} args gate-log records of every scope
 * @returns {{gates_fired: {id: string, verdict: string, caught: boolean}[], result: 'pass'|'fail'}}
 */
function deriveRetro({ records }) {
  const gates_fired = gatesFired(mergeByTs(records));
  return { gates_fired, result: gates_fired.some((g) => g.verdict === 'fail') ? 'fail' : 'pass' };
}

/**
 * @param {{gates_fired: {id: string, caught: boolean}[], result: string, issues?: string[], problem?: string|null}} args
 * @returns {{required: boolean, reasons: string[]}} reasons: gate_log_unreadable, caught:<id>..., result:fail, issues
 */
function proseDecision({ gates_fired, result, issues, problem }) {
  const reasons = [];
  if (problem) reasons.push(problem);
  for (const g of gates_fired) if (g.caught === true) reasons.push(`caught:${g.id}`);
  if (result !== 'pass') reasons.push('result:fail');
  if (Array.isArray(issues) && issues.length > 0) reasons.push('issues');
  return { required: reasons.length > 0, reasons };
}

/** @returns {string} the store entry in the shape of a real store entry (`gates_fired` as firedYaml prints it) */
function renderEntry({ date, spec, pr, project, retro, decision, issues }) {
  const list = Array.isArray(issues) ? issues : [];
  const fired = retro.gates_fired.length === 0
    ? 'gates_fired: []'
    : `gates_fired:\n${retro.gates_fired.map((g) => `  - {id: ${g.id}, verdict: ${g.verdict}, caught: ${g.caught}}`).join('\n')}`;
  return [
    '---',
    `date: ${date}`,
    'kind: machine',
    `task: a1-new-feature ${spec} (PR #${pr})`,
    `project: ${project}`,
    `result: ${retro.result}`,
    `issues: [${list.join(', ')}]`,
    `evidence: pr-${pr}`,
    `machine_record: ${spec}#${pr}`,
    `prose_required: ${decision.required}`,
    fired,
    'what_worked: machine record written by feature close; no prose.',
    'one_line_learning: none recorded by the machine; see the retro prose when prose_required is true.',
    '---',
    '',
  ].join('\n');
}

/**
 * @param {string} worktreePath
 * @returns {{records: Object[], scopes: string[], problem: string|null}} records of every scope except `retro-*` and `_unscoped`;
 *   problem is `gate_log_unreadable` when any log is missing, malformed or its chain is broken (records is then empty)
 */
function readScopes(worktreePath) {
  const scopes = listGateLogs(worktreePath).filter((s) => s !== UNSCOPED && !s.startsWith(RETRO_SCOPE_PREFIX));
  const records = [];
  try {
    for (const scope of scopes) records.push(...readGateLog(logPathFor(worktreePath, scope)).records);
  } catch (e) {
    if (e && e.code === 'A1_GATELOG') return { records: [], scopes, problem: 'gate_log_unreadable' };
    throw e;
  }
  return { records, scopes, problem: null };
}

/** The regular store file or null; a link or non-regular file is refused, a file over 20 MB too. */
function readStore(file) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw refuse(`machine retro: cannot stat ${file}: ${e.code || e.message}`);
  }
  if (!st.isFile()) throw refuse(`machine retro: ${file} is a link or not a regular file`);
  if (st.size > MAX_BYTES) throw refuse(`machine retro: ${file} is over 20 MB`);
  return fs.readFileSync(file, 'utf8');
}

const keyRe = (spec, pr) => new RegExp(`^machine_record: ${escapeRe(spec)}#${escapeRe(pr)}\\s*$`, 'm');

/**
 * @returns {{status: 'appended'|'already_recorded', file: string}}
 * @throws Error with exit 2 for a refused path or an I/O error
 */
function appendMachineRetro({ store, spec, pr, entry }) {
  const file = path.join(store, STORE_FILE);
  let lock;
  try { lock = acquireLock(path.join(store, LOCK_DIR)); } catch (e) { throw refuse(`machine retro: ${e.message}`); }
  try {
    const existing = readStore(file);
    if (existing !== null && keyRe(spec, pr).test(existing)) return { status: 'already_recorded', file };
    const head = existing === null ? '' : existing.replace(/\n*$/, '\n\n');
    writeTextAtomic(file, head + entry);
    return { status: 'appended', file };
  } catch (e) {
    throw e.exit === 2 ? e : refuse(`machine retro: ${e.message}`);
  } finally {
    releaseLock(lock);
  }
}

/** @returns {{found: boolean, prose_required: boolean}} the stored record of `<spec>#<pr>`; prose_required is true unless it says false */
function findMachineRecord({ store, spec, pr }) {
  let text;
  try { text = readStore(path.join(store, STORE_FILE)); } catch (_e) { return { found: false, prose_required: true }; }
  if (text === null) return { found: false, prose_required: true };
  const block = text.split(/^---\s*$/m).find((b) => keyRe(spec, pr).test(b));
  if (!block) return { found: false, prose_required: true };
  return { found: true, prose_required: !/^prose_required: false\s*$/m.test(block) };
}

module.exports = { deriveRetro, proseDecision, renderEntry, readScopes, appendMachineRetro, findMachineRecord };
