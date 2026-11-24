'use strict';

// ---------------------------------------------------------------------------
// retro-gatelog — cross-check of a retro's `gates_fired` against the gate log
// (spec 017, Wave 2, FR-009). Kept apart from retro-validate.cjs (size limit).
//
// Rules, for a retro whose date is on or after ENFORCED_SINCE:
//   no_log_line            a `deterministic` entry has no log line with that id
//   verdict_mismatch       its verdict differs from the LAST log line of that id
//   missing_blocking_fail  the log holds a `fail` line of a `blocking` gate
//                          that no entry of the retro names
//   bad_retro_of           a block's `retro_of` is not a string `<spec>#<pr>`, or is not bound to the run (see below)
// A reference block (`retro_of` and no `gates_fired`, F-005) is a prose retro whose gates the machine entry of `feature close`
// carries; it needs no entry for the log's blocking fails. That skip holds only when every enforced block of the file is such a
// reference and each key is bound to the run by the explicit flag `--defer-to-machine <spec>#<pr>` (retro-bind.cjs): the flag equals
// the key, `--phase` is `retro-<spec>`, <spec> holds a code_scope reservation, and the two --gate-log paths resolve (realpath, no
// links) to `.a1/phases/<spec>/` and `.a1/phases/pr-<pr>/gate-log.jsonl` under the repo root. The log is still read and
// chain-checked; the deferred fails are reported.
// `prompt` and `human` entries are not checked against the log. A log verdict
// `error` counts as `fail` (a gate that crashed did not pass).
// ---------------------------------------------------------------------------

const { parseRegistryRows } = require('./gate-ids.cjs');
const { verifyChain } = require('./gate-log.cjs');
const { ENFORCED_SINCE } = require('./enforced-since.cjs');
const { bindingProblem } = require('./retro-bind.cjs');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RETRO_OF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*#[1-9][0-9]*$/;

/** `error` -> `fail`; the retro vocabulary is pass|fail|not_applicable */
function retroVerdict(logVerdict) {
  return logVerdict === 'error' ? 'fail' : logVerdict;
}

/** Retro dated before `since`. A missing or unreadable date is NOT legacy (fail closed). */
function isLegacy(date, since) {
  const day = String(date === undefined || date === null ? '' : date).slice(0, 10);
  return DATE_RE.test(day) && day < since;
}

/** @param {string} logPath @returns {{records: Object[], lines: number}} @throws Error code A1_GATELOG */
function readGateLog(logPath) {
  let result;
  try {
    result = verifyChain(logPath);
  } catch (e) {
    const err = new Error(`gate log unreadable: ${logPath} (${e.code || e.message})`);
    err.code = 'A1_GATELOG';
    throw err;
  }
  if (!result.ok) {
    const first = result.problems[0];
    const err = new Error(`gate log is not trustworthy: ${logPath} line ${first.line}: ${first.rule} (${first.reason}); ${result.problems.length} problem(s)`);
    err.code = 'A1_GATELOG';
    throw err;
  }
  return { records: result.records, lines: result.lines };
}

function lastVerdicts(records) {
  const last = new Map();
  const failed = new Set();
  for (const r of records) {
    last.set(r.gate, retroVerdict(r.verdict));
    if (retroVerdict(r.verdict) === 'fail') failed.add(r.gate);
  }
  return { last, failed };
}

/** @param {Object[]} records @returns {{id: string, verdict: string, caught: boolean}[]} */
function gatesFired(records) {
  const { last, failed } = lastVerdicts(records);
  return [...last.entries()].map(([id, verdict]) => ({ id, verdict, caught: failed.has(id) }));
}

function entryProblems(entries, rows, last) {
  const problems = [];
  for (const e of entries) {
    const row = rows.get(e.id);
    if (!row || row.cells.class !== 'deterministic') continue;
    if (!last.has(e.id)) problems.push({ id: e.id, rule: 'no_log_line', reason: 'no gate-log line with this id' });
    else if (e.verdict !== last.get(e.id)) {
      problems.push({ id: e.id, rule: 'verdict_mismatch', reason: `retro says ${e.verdict === undefined ? '(none)' : e.verdict}, the last log line says ${last.get(e.id)}` });
    }
  }
  return problems;
}

/**
 * Stable sort by `ts` (argv order on equal or unparsable timestamps), so the last verdict of a gate does not depend on the
 * order of the --gate-log flags. A single log is already in time order and comes out unchanged.
 */
function mergeByTs(records) {
  const time = (r) => { const t = Date.parse(r && r.ts); return Number.isNaN(t) ? null : t; };
  return records.map((r, i) => ({ r, i, t: time(r) })).sort((a, b) => (a.t !== null && b.t !== null && a.t !== b.t ? a.t - b.t : a.i - b.i)).map((x) => x.r);
}

/**
 * @param {*} key a block's `retro_of` value
 * @param {{scope?: string|null, defer: string|null, paths: string[], root: string}} ctx `--phase`, `--defer-to-machine`, the resolved --gate-log paths, the repo root
 * @returns {string|null} why the key is not bound to this run, else null
 */
function retroOfProblem(key, ctx) {
  if (typeof key !== 'string' || !RETRO_OF_RE.test(key)) return 'retro_of must be one string <spec>#<pr>, e.g. 027-lean-pipeline#115';
  const spec = key.slice(0, key.lastIndexOf('#'));
  const scope = ctx.scope;
  if (scope !== `retro-${spec}`) return `retro_of names spec ${spec}, but --phase is ${scope === null || scope === undefined ? '(none)' : scope}, not retro-${spec}`;
  return bindingProblem(key, ctx);
}

/** @returns {boolean} the block is a prose reference (`retro_of`, no `gates_fired`): the machine entry carries its gates */
const isReference = (b) => b.retroOf !== undefined && !b.hasGates;

/**
 * @param {{logPath?: string, logPaths?: string[], registryText: string, blocks: {date: any, isEntry: boolean, entries: {id: string, verdict?: string}[], retroOf?: any, hasGates?: boolean}[], since?: string}} args
 * @returns {{checked: boolean, skipped?: string, lines?: number, problems: {id: string, rule: string, reason: string}[], deferred?: {retro_of: string[], failed_blocking: string[]}, warnings?: string[]}}
 * @throws Error code A1_GATELOG when the log is missing, malformed or its chain is broken
 */
function checkRetroAgainstLog({ logPath, logPaths, registryText, blocks, since = ENFORCED_SINCE, scope = null, defer = null, root = process.cwd() }) {
  const enforced = blocks.filter((b) => b.isEntry && !isLegacy(b.date, since));
  if (enforced.length === 0) return { checked: false, skipped: 'legacy', problems: [] };
  // Spec 028 FR-016: several logs (a run that crossed scopes) are merged in argument order; any unreadable one throws.
  const paths = logPaths && logPaths.length > 0 ? logPaths : [logPath];
  const reads = paths.map(readGateLog);
  const records = mergeByTs(reads.flatMap((r) => r.records));
  const lines = reads.reduce((n, r) => n + r.lines, 0);
  const rows = new Map(parseRegistryRows(registryText).map((r) => [r.id, r]));
  const entries = enforced.flatMap((b) => b.entries);
  const { last, failed } = lastVerdicts(records);
  const named = new Set(entries.map((e) => e.id));
  const problems = entryProblems(entries, rows, last);
  const refs = enforced.filter(isReference);
  const keyed = enforced.filter((b) => b.retroOf !== undefined);
  const retroOfs = keyed.map((b) => (typeof b.retroOf === 'string' ? b.retroOf : JSON.stringify(b.retroOf)));
  keyed.forEach((b, i) => {
    const why = retroOfProblem(b.retroOf, { scope, defer, paths, root });
    if (why !== null) problems.push({ id: retroOfs[i], rule: 'bad_retro_of', reason: why });
  });
  const skip = refs.length === enforced.length && !problems.some((p) => p.rule === 'bad_retro_of');
  const blockingFails = [...failed].filter((id) => rows.has(id) && rows.get(id).cells.enforcement === 'blocking');
  if (!skip) {
    for (const id of blockingFails) {
      if (!named.has(id)) problems.push({ id, rule: 'missing_blocking_fail', reason: 'the log holds a fail line of this blocking gate, the retro does not name it' });
    }
  }
  const warnings = enforced.some((b) => b.retroOf !== undefined && b.hasGates) ? ['retro_of_with_gates_fired'] : [];
  return {
    checked: true, lines, problems,
    ...(skip ? { deferred: { retro_of: retroOfs, failed_blocking: blockingFails } } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** The `gates_fired` YAML block the retro template tells the writer to paste. */
function firedYaml(records) {
  const fired = gatesFired(records);
  if (fired.length === 0) return 'gates_fired: []\n';
  const items = fired.map(({ id, verdict, caught }) => `  - {id: ${id}, verdict: ${verdict}, caught: ${caught}}`);
  return `gates_fired:\n${items.join('\n')}\n`;
}

module.exports = { checkRetroAgainstLog, firedYaml, readGateLog, isLegacy, retroVerdict, lastVerdicts, gatesFired, mergeByTs };
