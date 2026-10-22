'use strict';

// ---------------------------------------------------------------------------
// metrics escaped — escaped-BLOCKER count over the last N finished runs
// (spec 018-pipeline-metrics, FR-006..FR-009, FR-015).
//
// A postmortem ESCAPED when, case-insensitively, severity == blocker AND
// found_by is user / post-merge-ci / production (a person or production found
// it, not a gate or a reviewer) AND should_have_caught names something other
// than none / unknown / absent. Values are read as written: no registry check,
// so a gate that left the registry still counts.
//
// Window: the postmortem date (frontmatter `date`, else the file-name prefix)
// is >= the date of the oldest run among the last N runs. No runs -> empty
// window -> every number 0. `unknown/legacy` = postmortems in the window where
// found_by or should_have_caught is absent or `unknown`.
// Reads vault markdown as data only; no network, no child process.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./io-frontmatter.cjs');
const { assertSafeSegment } = require('./io-roots.cjs');
const { listRuns, lastN, vaultOrExit2 } = require('./metrics-runs.cjs');
const { usage } = require('./help.cjs');

const EXIT_BREACH = 1;
const EXIT_IO = 2;
const DEFAULT_LAST = 10;
const MAX_COUNT_DIGITS = 9;
const MAX_PRINTED_VALUE = 120;
const ESCAPING_FOUND_BY = Object.freeze(['user', 'post-merge-ci', 'production']);
const NOT_A_CATCHER = Object.freeze(['none', 'unknown']);
const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;
const SAFE_VALUE_RE = /^[A-Za-z0-9:._-]*$/;
const UINT_RE = /^[0-9]+$/;

function fail(msg) {
  process.stderr.write(`error: metrics escaped: ${msg}\n`);
  process.exit(EXIT_IO);
}

/** A bad flag or value is a usage error: exit 1 through help.cjs usage(), like every a1-tools command. */
function badUsage(msg) {
  usage(`metrics escaped: ${msg}`);
}

function takeValue(args, i, flag) {
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) badUsage(`${flag} needs a value`);
  return v;
}

function parseCount(text, flag, min) {
  const n = UINT_RE.test(text) && text.length <= MAX_COUNT_DIGITS ? Number(text) : NaN;
  if (!Number.isInteger(n) || n < min) {
    badUsage(`${flag} needs an integer >= ${min} (got ${JSON.stringify(text.slice(0, 40))})`);
  }
  return n;
}

function parseGroup(value) {
  if (value !== 'should-have-caught') badUsage('--group-by accepts only "should-have-caught"');
  return true;
}

/** @returns {{project: string, last: number, json: boolean, groupBy: boolean, failAbove: number|null}} */
function parseArgs(args) {
  const o = { project: null, last: DEFAULT_LAST, json: false, groupBy: false, failAbove: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') o.json = true;
    else if (a === '--project') o.project = takeValue(args, i++, a);
    else if (a === '--last') o.last = parseCount(takeValue(args, i++, a), a, 1);
    else if (a === '--fail-above') o.failAbove = parseCount(takeValue(args, i++, a), a, 0);
    else if (a === '--group-by') o.groupBy = parseGroup(takeValue(args, i++, a));
    else badUsage(`unknown argument ${JSON.stringify(a.slice(0, 60))}`);
  }
  if (!o.project) badUsage('--project <slug> is required');
  return o;
}

function textOf(v) {
  if (v == null) return '';
  return String(Array.isArray(v) ? v.join(',') : v).trim();
}

function dateOf(fm, name) {
  const fromFm = DATE_PREFIX_RE.exec(textOf(fm && fm.date));
  if (fromFm) return fromFm[1];
  const fromName = DATE_PREFIX_RE.exec(name);
  return fromName ? fromName[1] : null;
}

function isEscaped(info) {
  return info.severity === 'blocker' && ESCAPING_FOUND_BY.includes(info.foundBy)
    && info.should !== '' && !NOT_A_CATCHER.includes(info.should);
}

function isUnknownOrLegacy(info) {
  return info.foundBy === '' || info.foundBy === 'unknown' || info.should === '' || info.should === 'unknown';
}

function readPostmortem(dir, name) {
  try {
    const fm = parseFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8')).fm || {};
    return {
      ok: true,
      date: dateOf(fm, name),
      severity: textOf(fm.severity).toLowerCase(),
      foundBy: textOf(fm.found_by),
      should: textOf(fm.should_have_caught),
    };
  } catch (_e) {
    return { ok: false };
  }
}

function listPostmortems(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
}

function byDateThenPath(a, b) {
  if (a.info.date !== b.info.date) return a.info.date < b.info.date ? -1 : 1;
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;
}

/** Reads the postmortems dated inside the window; unreadable ones are listed, never fatal. */
function readWindow(vault, slug, since) {
  const dir = path.join(vault, 'project', slug, 'postmortems');
  const rows = [];
  const unreadable = [];
  for (const name of listPostmortems(dir)) {
    const rel = `project/${slug}/postmortems/${name}`;
    const info = readPostmortem(dir, name);
    if (!info.ok) unreadable.push(rel);
    else if (info.date && info.date >= since) rows.push({ rel, info });
  }
  return { rows: rows.sort(byDateThenPath), unreadable };
}

/** Builds the report object for one project. */
function scan(vault, slug, last) {
  const runs = lastN(listRuns(vault, slug), last);
  const since = runs.length ? runs[0].date : null;
  const base = { project: slug, runs: runs.length, since, escaped: 0, unknownLegacy: 0, unreadable: [], evidence: [] };
  if (!since) return base;
  const { rows, unreadable } = readWindow(vault, slug, since);
  const evidence = rows.filter((r) => isEscaped(r.info)).map((r) => ({
    path: r.rel, date: r.info.date, found_by: r.info.foundBy, should_have_caught: r.info.should,
  }));
  return {
    ...base,
    escaped: evidence.length,
    evidence,
    unreadable,
    unknownLegacy: rows.filter((r) => isUnknownOrLegacy(r.info)).length,
  };
}

/** Counts per should_have_caught: count descending, then name ascending (code-unit order, locale-free). */
function groupCounts(evidence) {
  const counts = new Map();
  for (const e of evidence) counts.set(e.should_have_caught, (counts.get(e.should_have_caught) || 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
}

/** A value from an old file may hold anything; print it on one line, quoted when it is not plain. */
function printable(v) {
  return SAFE_VALUE_RE.test(v) ? v : JSON.stringify(v.slice(0, MAX_PRINTED_VALUE));
}

function renderText(report, groups) {
  const lines = [
    `project: ${report.project}`,
    `runs: ${report.runs}`,
    `since: ${report.since || 'n/a'}`,
    `escaped: ${report.escaped}`,
    `unknown/legacy: ${report.unknownLegacy}`,
    `unreadable: ${report.unreadable.length}`,
  ];
  for (const p of report.unreadable) lines.push(`  unreadable: ${JSON.stringify(p)}`);
  for (const e of report.evidence) {
    lines.push(`  ${JSON.stringify(e.path)} found_by=${printable(e.found_by)} should_have_caught=${printable(e.should_have_caught)}`);
  }
  if (groups) {
    lines.push('by should-have-caught:');
    for (const g of groups) lines.push(`  ${printable(g.name)}: ${g.count}`);
  }
  return `${lines.join('\n')}\n`;
}

/** @param {string[]} args - argv after `metrics escaped` */
function cmdMetricsEscaped(args) {
  const opts = parseArgs(args);
  try { assertSafeSegment(opts.project, 'project slug'); } catch (e) { badUsage(String(e && e.message).split('\n')[0]); }
  let report;
  try {
    report = scan(vaultOrExit2(), opts.project, opts.last);
  } catch (e) {
    fail(String(e && e.message).split('\n')[0]);
  }
  const groups = opts.groupBy ? groupCounts(report.evidence) : null;
  if (opts.json) process.stdout.write(`${JSON.stringify(groups ? { ...report, groups } : report)}\n`);
  else process.stdout.write(renderText(report, groups));
  if (opts.failAbove !== null && report.escaped > opts.failAbove) process.exitCode = EXIT_BREACH;
}

module.exports = { cmdMetricsEscaped };
