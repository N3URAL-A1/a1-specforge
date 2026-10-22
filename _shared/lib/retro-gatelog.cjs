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
// `prompt` and `human` entries are not checked against the log. A log verdict
// `error` counts as `fail` (a gate that crashed did not pass).
// ---------------------------------------------------------------------------

const { parseRegistryRows } = require('./gate-ids.cjs');
const { verifyChain } = require('./gate-log.cjs');
const { ENFORCED_SINCE } = require('./enforced-since.cjs');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * @param {{logPath: string, registryText: string, blocks: {date: any, isEntry: boolean, entries: {id: string, verdict?: string}[]}[], since?: string}} args
 * @returns {{checked: boolean, skipped?: string, lines?: number, problems: {id: string, rule: string, reason: string}[]}}
 * @throws Error code A1_GATELOG when the log is missing, malformed or its chain is broken
 */
function checkRetroAgainstLog({ logPath, registryText, blocks, since = ENFORCED_SINCE }) {
  const enforced = blocks.filter((b) => b.isEntry && !isLegacy(b.date, since));
  if (enforced.length === 0) return { checked: false, skipped: 'legacy', problems: [] };
  const { records, lines } = readGateLog(logPath);
  const rows = new Map(parseRegistryRows(registryText).map((r) => [r.id, r]));
  const entries = enforced.flatMap((b) => b.entries);
  const { last, failed } = lastVerdicts(records);
  const named = new Set(entries.map((e) => e.id));
  const problems = entryProblems(entries, rows, last);
  for (const id of failed) {
    const row = rows.get(id);
    if (row && row.cells.enforcement === 'blocking' && !named.has(id)) {
      problems.push({ id, rule: 'missing_blocking_fail', reason: 'the log holds a fail line of this blocking gate, the retro does not name it' });
    }
  }
  return { checked: true, lines, problems };
}

/** The `gates_fired` YAML block the retro template tells the writer to paste. */
function firedYaml(records) {
  const { last, failed } = lastVerdicts(records);
  if (last.size === 0) return 'gates_fired: []\n';
  const items = [...last.entries()].map(([id, verdict]) => `  - {id: ${id}, verdict: ${verdict}, caught: ${failed.has(id)}}`);
  return `gates_fired:\n${items.join('\n')}\n`;
}

module.exports = { checkRetroAgainstLog, firedYaml, readGateLog, isLegacy, retroVerdict };
