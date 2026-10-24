'use strict';

// dashboard-cost — the Cost section (spec 021, FR-012). Sums the mirrored phase VERIFICATION cost lines
// with spec 018's parser (metrics-cost.cjs parseCost; no second parser). Every file is opened through the
// dashboard read seam (readSource), so it stays in the open-path trace. A run counts as "with" only when
// parseCost yields tokens; any reason (unavailable, no line, ambiguous) or any read failure counts as
// "without", never as zero tokens. Fix runs are not read. Numbers use a fixed "," separator (no locale).

const fs = require('fs');
const path = require('path');
const { readSource } = require('./dashboard-read.cjs');
const { parseCost } = require('./metrics-cost.cjs');

const VERIFICATION = 'VERIFICATION.md';
const SOURCE_LINE = 'Source: VERIFICATION cost lines (phase runs only)';
const THOUSANDS_RE = /\B(?=(\d{3})+(?!\d))/g;

function section(state, items, reason) {
  const out = { name: 'Cost', state, items: Object.freeze(items) };
  if (reason) out.reason = reason;
  return Object.freeze(out);
}

function group(n) {
  return String(n).replace(THOUSANDS_RE, ',');
}

function runs(n) {
  return `${group(n)} ${n === 1 ? 'run' : 'runs'}`;
}

/** Sorted names of the real (non-link) phase directories; null when the folder is absent or unreadable. */
function phaseDirs(phasesDir) {
  let entries;
  try {
    entries = fs.readdirSync(phasesDir, { withFileTypes: true });
  } catch (_e) {
    return null;
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** parseCost result of one VERIFICATION file; null when the file is absent; `{reason}` when unreadable. */
function costOf(file, ctx) {
  let text;
  try {
    text = readSource(file, ctx);
  } catch (e) {
    return e && e.code === 'ENOENT' ? null : { reason: 'unreadable' };
  }
  try {
    return parseCost(text);
  } catch (_e) {
    return { reason: 'unparseable' };
  }
}

function costSection(ctx) {
  const phasesDir = path.join(ctx.root, 'project', ctx.slug, 'phases');
  const names = phaseDirs(phasesDir);
  if (names === null) return section('not_available', [], 'no_phases_mirror');
  let tokens = 0;
  let withCost = 0;
  let withoutCost = 0;
  let approx = 0;
  let files = 0;
  for (const name of names) {
    const c = costOf(path.join(phasesDir, name, VERIFICATION), ctx);
    if (c === null) continue;
    files += 1;
    if (typeof c.tokens === 'number') {
      tokens += c.tokens;
      withCost += 1;
      if (c.approx) approx += 1;
    } else {
      withoutCost += 1;
    }
  }
  if (files === 0) return section('none', []);
  const items = [`${group(tokens)} tokens across ${runs(withCost)} with a cost line`, `${runs(withoutCost)} without cost line`];
  if (approx > 0) items.push(`${runs(approx)} with an approximate (~) value included in the sum`);
  items.push(SOURCE_LINE);
  return section('ok', items);
}

module.exports = { costSection };
