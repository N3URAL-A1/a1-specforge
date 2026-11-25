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
const { assertVaultWriteContained } = require('./fs-safe.cjs');
const { linesOf, blocksOf, isDelim } = require('./retro-view.cjs');
const { SLUG_RE } = require('./project-slug.cjs');
const { SCOPE_RE } = require('./gate-log.cjs');

const STORE_FILE = 'a1-new-feature.md';
const LOCK_DIR = 'a1-new-feature.lock.d';
const MAX_BYTES = 20 * 1024 * 1024;
const RETRO_SCOPE_PREFIX = 'retro-';
const GATE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERDICT_RE = /^[a-z_]{1,32}$/;
// typeof first: String(undefined) would pass both patterns and render as `id: undefined` (audit F-008).
const validGate = (g) => g !== null && typeof g === 'object' && typeof g.id === 'string' && typeof g.verdict === 'string'
  && GATE_ID_RE.test(g.id) && VERDICT_RE.test(g.verdict);
const UNKNOWN_PROJECT = 'unknown';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PR_RE = /^[1-9][0-9]{0,6}$/;
const ISSUES_RE = /^[a-z0-9][a-z0-9_-]{0,40}(,[a-z0-9][a-z0-9_-]{0,40}){0,19}$/;
const ISSUE_TAG_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const RESULT_RE = /^(pass|fail)$/;

function refuse(message) {
  const err = new Error(message);
  err.exit = 2;
  return err;
}

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
  if (gates_fired.some((g) => !validGate(g))) reasons.push('invalid_gate_id');
  for (const g of gates_fired) if (validGate(g) && g.caught === true) reasons.push(`caught:${g.id}`);
  if (result !== 'pass') reasons.push('result:fail');
  if (Array.isArray(issues) && issues.length > 0) reasons.push('issues');
  return { required: reasons.length > 0, reasons };
}

/** @returns {string} the store entry in the shape of a real store entry (`gates_fired` as firedYaml prints it) */
function renderEntry({ date, spec, pr, project, retro, decision, issues }) {
  const list = Array.isArray(issues) ? issues : [];
  // Every head field except project is written raw: outside its pattern it would inject head lines or forge prose_required.
  const bad = (v, re) => (typeof v !== 'string' && typeof v !== 'number') || !re.test(String(v));
  if (bad(date, DATE_RE)) throw refuse('machine retro: date is not YYYY-MM-DD');
  if (bad(spec, SCOPE_RE) || String(spec).includes('..')) throw refuse('machine retro: spec is not a safe spec id');
  if (bad(pr, PR_RE)) throw refuse('machine retro: pr is not a positive integer');
  if (list.some((t) => bad(t, ISSUE_TAG_RE))) throw refuse('machine retro: an issue tag is outside its pattern');
  if (bad(retro.result, RESULT_RE)) throw refuse('machine retro: result is not pass or fail');
  // project may come from a checkout's directory name; outside SLUG_RE (e.g. a newline) it is never written raw (audit F-004).
  const proj = typeof project === 'string' && SLUG_RE.test(project) ? project : UNKNOWN_PROJECT;
  const valid = retro.gates_fired.filter(validGate); // an id or verdict outside the pattern is dropped, never written raw (SEC-1)
  const dropped = valid.length !== retro.gates_fired.length;
  const fired = valid.length === 0
    ? 'gates_fired: []'
    : `gates_fired:\n${valid.map((g) => `  - {id: ${g.id}, verdict: ${g.verdict}, caught: ${g.caught}}`).join('\n')}`;
  return [
    '---',
    `date: ${date}`,
    'kind: machine',
    `task: a1-new-feature ${spec} (PR #${pr})`,
    `project: ${proj}`,
    `result: ${retro.result}`,
    `issues: [${list.join(', ')}]`,
    `evidence: pr-${pr}`,
    `machine_record: ${spec}#${pr}`,
    `prose_required: ${decision.required || dropped}`,
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

const { O_RDONLY, O_RDWR, O_APPEND, O_CREAT, O_NOFOLLOW = 0, O_NONBLOCK = 0 } = fs.constants;

/**
 * Opens the store file without following a link and checks the SAME fd (no path stat between check and use, so no TOCTOU).
 * @returns {{fd: number, size: number}|null} null for a missing file when not creating; a link, non-regular file or a file over 20 MB is refused
 */
function openStore(file, create) {
  let fd;
  try { fd = fs.openSync(file, (create ? O_RDWR | O_APPEND | O_CREAT : O_RDONLY) | O_NOFOLLOW | O_NONBLOCK, 0o644); } catch (e) {
    if (e.code === 'ENOENT' && !create) return null;
    throw refuse(`machine retro: cannot open ${file} (a link, a directory or unreadable): ${e.code || e.message}`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw refuse(`machine retro: ${file} is not a regular file`);
    if (st.size > MAX_BYTES) throw refuse(`machine retro: ${file} is over 20 MB`);
    return { fd, size: st.size };
  } catch (e) { fs.closeSync(fd); throw e; }
}

function readStore(file) {
  const h = openStore(file, false);
  if (h === null) return null;
  try { return fs.readFileSync(h.fd, 'utf8'); } finally { fs.closeSync(h.fd); }
}

/**
 * The frontmatter heads of the store, read through retro-view (the view `retro validate` uses: newlines normalised, a block closes
 * at the first line that starts with `---`). A head starts only at the file start or after a blank line (every entry write puts one
 * there), has `date:` as its first line and is closed by a `---` line (or EOF), so a block quoted inside a prose body (F-003), or
 * one cut by `---x`, is not a head. `bare` is true when the next non-blank line after the closing `---` is `---` or EOF:
 * a machine head has no body (a `#` line after it is a body: a pasted head followed by `## Notes` is no record).
 * @returns {{lines: string[], bare: boolean}[]}
 */
function heads(text) {
  const lines = linesOf(text);
  const nextLine = (from) => { let k = from; while (k < lines.length && lines[k].trim() === '') k++; return k < lines.length ? lines[k] : null; };
  return blocksOf(lines)
    .filter((b) => /^date:/.test(b.lines[0] || '') && (b.open === 0 || lines[b.open - 1].trim() === '') && b.closedByDelim)
    .map((b) => {
      const next = b.close >= lines.length ? null : nextLine(b.close + 1);
      return { lines: b.lines, bare: next === null || isDelim(next) };
    });
}

const keyLine = (spec, pr) => `machine_record: ${spec}#${pr}`;
const hasLine = (h, pred) => h.lines.some(pred);
// Only a machine head counts (F-005, F-003): `kind: machine`, a `gates_fired` key, no `retro_of`, no body. A prose retro carries
// `retro_of`; a stray or quoted `machine_record` line is no record. Matching is per normalised line, never a /m regex.
// `kind: machine` is the line right after `date:`, the shape renderEntry writes: a key hidden among other header lines is no record.
const isMachineHead = (h) => h.bare && /^kind: machine\s*$/.test(h.lines[1] || '') && hasLine(h, (l) => l.startsWith('gates_fired:')) && !hasLine(h, (l) => l.startsWith('retro_of:'));
const headOf = (text, spec, pr) => heads(text).find((h) => isMachineHead(h) && hasLine(h, (l) => l.trimEnd() === keyLine(spec, pr)));

/**
 * Idempotency check under the lock, then one O_APPEND write (no rewrite of the file: a concurrent plain append is not lost).
 * @returns {{status: 'appended'|'already_recorded', file: string}}
 * @throws Error with exit 2 for a refused path or an I/O error
 */
function appendMachineRetro({ store, spec, pr, entry }) {
  const file = path.join(store, STORE_FILE);
  let lock;
  try { lock = acquireLock(path.join(store, LOCK_DIR)); } catch (e) { throw refuse(`machine retro: ${e.message}`); }
  let h = null;
  try {
    assertVaultWriteContained(file);
    h = openStore(file, true);
    const existing = fs.readFileSync(h.fd, 'utf8');
    if (headOf(existing, spec, pr) !== undefined) return { status: 'already_recorded', file };
    const sep = existing === '' || existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    fs.writeSync(h.fd, sep + entry);
    return { status: 'appended', file };
  } catch (e) {
    throw e.exit === 2 ? e : refuse(`machine retro: ${e.message}`);
  } finally {
    if (h !== null) fs.closeSync(h.fd);
    releaseLock(lock);
  }
}

/** @returns {{found: boolean, prose_required: boolean}} the stored record of `<spec>#<pr>`; prose_required is true unless it says false */
function findMachineRecord({ store, spec, pr }) {
  let text;
  try { text = readStore(path.join(store, STORE_FILE)); } catch (_e) { return { found: false, prose_required: true }; }
  if (text === null) return { found: false, prose_required: true };
  const head = headOf(text, spec, pr);
  if (!head) return { found: false, prose_required: true };
  return { found: true, prose_required: !hasLine(head, (l) => /^prose_required: false\s*$/.test(l)) };
}

module.exports = { PR_RE, ISSUES_RE, deriveRetro, proseDecision, renderEntry, readScopes, appendMachineRetro, findMachineRecord };
