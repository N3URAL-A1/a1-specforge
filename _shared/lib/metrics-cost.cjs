'use strict';

// ---------------------------------------------------------------------------
// metrics cost (spec 018, FR-010..FR-013). Sums the "Cost: N tokens" line of
//   project/<slug>/phases/*/VERIFICATION.md   (kind phase, one run per directory)
//   project/<slug>/fixes/*.md with status: fixed (kind fix, via listRuns)
// and reports rows, total, coverage and the unreported runs. Local files only.
// Exit: 0 report, 1 usage error, 2 I/O error or vault absent.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./io-frontmatter.cjs');
const { assertSafeSegment } = require('./io-roots.cjs');
const { parseFlags } = require('./io.cjs');
const { usage } = require('./help.cjs');
const { listRuns, lastN, vaultOrExit2 } = require('./metrics-runs.cjs');

const EXIT_IO = 2;
const MAX_FILE_BYTES = 1024 * 1024; // a cost line sits in a small report; bigger files are not read
const PERCENT = 100;
// Anchored at line start: table rows ("| … Cost: …") and list items ("- [x] … Cost: …") never match.
const COST_LINE_RE = /^\s*(?:\*\*Cost:\*\*\s*)?(?:Cost:\s*)?(~?)([0-9][0-9,]*)\s+tokens\b/;
const UNAVAILABLE_RE = /^\s*(?:\*\*Cost:\*\*\s*)?(?:Cost:\s*)?unavailable\b/i;
const GROUPED_RE = /^[0-9]{1,3}(?:,[0-9]{3})+$/;
const PLAIN_RE = /^[0-9]+$/;
const DATE_RE = /\d{4}-\d{2}-\d{2}/;
const FLAGS = { project: 'str', last: 'str', json: 'bool' };

/** @returns {number|null} tokens, or null when the digit groups are ambiguous (e.g. 1,23,456) */
function parseTokens(raw) {
  if (PLAIN_RE.test(raw)) return Number(raw);
  if (GROUPED_RE.test(raw)) return Number(raw.replace(/,/g, ''));
  return null;
}

/**
 * The last matching cost line of a text wins.
 * @returns {{tokens:number, approx:boolean, lines:number}|{reason:string, lines:number}}
 */
function parseCost(text) {
  let hit = null;
  let count = 0;
  let unavailable = false;
  for (const line of text.split(/\r?\n/)) {
    const m = COST_LINE_RE.exec(line);
    if (m) { hit = m; count += 1; } else if (UNAVAILABLE_RE.test(line)) unavailable = true;
  }
  if (!hit) return { reason: unavailable ? 'unavailable' : 'no_cost_line', lines: 0 };
  const tokens = parseTokens(hit[2]);
  if (tokens === null) return { reason: 'ambiguous', lines: count };
  return { tokens, approx: hit[1] === '~', lines: count };
}

function costOfFile(file) {
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) return { reason: 'too_large', lines: 0 };
    return parseCost(fs.readFileSync(file, 'utf8'));
  } catch (_e) {
    return { reason: 'unreadable', lines: 0 };
  }
}

function phaseDate(file) {
  try {
    const fm = parseFrontmatter(fs.readFileSync(file, 'utf8')).fm || {};
    const m = DATE_RE.exec(String(fm.verified || fm.date || ''));
    return m ? m[0] : '';
  } catch (_e) { return ''; }
}

function phaseEntries(base) {
  const dir = path.join(base, 'phases');
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name, 'VERIFICATION.md');
    if (!fs.existsSync(file)) continue;
    const date = fs.statSync(file).size > MAX_FILE_BYTES ? '' : phaseDate(file);
    out.push({ kind: 'phase', id: name, date, file, rel: `phases/${name}/VERIFICATION.md` });
  }
  return out;
}

function byDateThenId(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function entriesOf(vault, slug, last) {
  const base = path.join(vault, 'project', slug);
  const phases = phaseEntries(base).sort(byDateThenId);
  const fixes = listRuns(vault, slug).filter((r) => r.kind === 'fix')
    .map((r) => ({ ...r, file: path.join(base, 'fixes', `${r.id}.md`), rel: `fixes/${r.id}.md` }));
  return last ? [...lastN(phases, last), ...lastN(fixes, last)] : [...phases, ...fixes];
}

function projectSlugs(vault) {
  try {
    return fs.readdirSync(path.join(vault, 'project'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
  } catch (e) { if (e && e.code === 'ENOENT') return []; throw e; }
}

/** @returns {{rows:object[], unreported:object[], notes:string[]}} */
function collect(vault, slugs, last) {
  const rows = []; const unreported = []; const notes = [];
  for (const slug of slugs) {
    for (const e of entriesOf(vault, slug, last)) {
      const label = `${slug}/${e.id}`;
      const c = costOfFile(e.file);
      if (c.reason) { unreported.push({ kind: e.kind, id: label, reason: c.reason }); continue; }
      rows.push({ kind: e.kind, id: label, tokens: c.tokens, approx: c.approx });
      if (c.lines > 1) notes.push(`${label}: ${c.lines} cost lines in ${e.rel}, using the last`);
    }
  }
  return { rows, unreported, notes };
}

function summarize(data) {
  const total = data.rows.reduce((s, r) => s + r.tokens, 0);
  const runs = data.rows.length + data.unreported.length;
  const percent = runs === 0 ? 0 : Math.round((data.rows.length / runs) * PERCENT);
  return { ...data, total, reported: data.rows.length, runs, percent };
}

function render(s) {
  const out = [`rows: ${s.reported}`];
  for (const r of s.rows) out.push(`${r.kind} ${r.id} ${r.tokens} tokens${r.approx ? ' approx' : ''}`);
  out.push(`total: ${s.total} tokens`, `coverage: ${s.reported}/${s.runs} (${s.percent}%)`, `unreported: ${s.unreported.length}`);
  for (const u of s.unreported) out.push(`unreported ${u.kind} ${u.id} (${u.reason})`);
  for (const n of s.notes) out.push(`note: ${n}`);
  return `${out.join('\n')}\n`;
}

function parseLast(raw) {
  if (raw === undefined) return 0;
  if (!/^[1-9][0-9]*$/.test(String(raw))) usage(`metrics cost: --last needs a positive integer, got ${JSON.stringify(String(raw).slice(0, 40))}`);
  return Number(raw);
}

function cmdMetricsCost(args) {
  const flags = parseFlags(args, FLAGS);
  if (flags._.length) usage(`metrics cost: unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 40))}`);
  const last = parseLast(flags.last);
  if (flags.project !== undefined) {
    try { assertSafeSegment(flags.project, 'project slug'); } catch (e) { usage(`metrics cost: ${e.message}`); }
  }
  const vault = vaultOrExit2();
  let s;
  try {
    s = summarize(collect(vault, flags.project !== undefined ? [flags.project] : projectSlugs(vault), last));
  } catch (e) {
    process.stderr.write(`error: metrics cost: ${e && e.code ? e.code : 'read failed'}\n`);
    process.exit(EXIT_IO);
  }
  const body = flags.json
    ? `${JSON.stringify({ rows: s.rows, total: s.total, reported: s.reported, runs: s.runs, coverage_percent: s.percent, unreported: s.unreported, notes: s.notes })}\n`
    : render(s);
  process.stdout.write(body);
}

module.exports = { cmdMetricsCost };
