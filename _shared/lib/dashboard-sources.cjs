'use strict';

// dashboard-sources — the section readers (spec 021, Wave 2). Section contract (all waves):
//   { name: string, state: 'ok' | 'none' | 'not_available', reason?: string, items: string[] }
// collectSections(ctx) returns the six repo/vault sections in note order (Now, Next, Specs, Phases,
// Learnings, Open points); the Cost section comes from dashboard-cost.cjs.
//
// Every file read goes through readSource() of dashboard-read.cjs and every text value passes cleanText().
// Directory listings use fs.readdirSync (no file content). This module reimplements the vault-mode count of
// `learnings count-since-watermark` (learnings.cjs runs process.exit and cannot be called as a lib); the suite
// cross-checks both numbers on the same fixture vault.
// ctx = { cwd, env, clock, ops, trace, args, repoRoot, slug, root }

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./io.cjs');
const { readSource, cleanText } = require('./dashboard-read.cjs');

const SECTION_NAMES = Object.freeze(['Now', 'Next', 'Specs', 'Phases', 'Learnings', 'Open points']);
/** Closed set of `not available (<reason>)` codes this module emits; Cost (Wave 4) owns its own. */
const REASONS = Object.freeze(['no_product_docs', 'no_phases', 'no_watermark', 'unreadable']);
const STAGE_WORDS = Object.freeze({
  started: 'started', complete: 'build complete', review: 'in review', verify: 'in verification',
  merge: 'being merged', 'origin-cleanup': 'cleaning up', done: 'done',
});
const NOW_MAX = 3;
const COUNTABLE_TYPES = new Set(['postmortem', 'bugfix']);
const MARKER = /\[NEEDS CLARIFICATION[:\]]/g;

// ---------- section constructors ----------

const section = (name, state, items, reason) => Object.freeze({
  name, state, ...(reason ? { reason } : {}), items: Object.freeze(items),
});
const okOrNone = (name, items) => section(name, items.length > 0 ? 'ok' : 'none', items);
const missing = (name, reason) => section(name, 'not_available', [], reason);

// ---------- plain language ----------

/** Words for the owner: no path, no CLI flag, no gate id. FR-003 scopes this to Now and Next ONLY. */
function plain(value) {
  return cleanText(value)
    .replace(/\S*\/\S*/g, '')
    .replace(/(^|\s)--[\w-]+/g, ' ')
    .replace(/\bgate-\S*/gi, '')
    .replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').trim();
}

function titleOf(feature) {
  const t = typeof feature.title === 'string' ? plain(feature.title) : '';
  return t || plain(String(feature.id || 'unnamed').replace(/^\d+-/, '').replace(/-/g, ' '));
}

const stageWord = (stage) => STAGE_WORDS[stage] || 'in progress';

// ---------- fs helpers ----------

/** Names of regular files in `dir` (links skipped) matching `re`; null when the dir is missing; throws else. */
function listFiles(dir, re) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null;
    throw e;
  }
  return entries.filter((e) => e.isFile() && re.test(e.name)).map((e) => e.name).sort();
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (_e) {
    return [];
  }
}

const readOrNull = (file, ctx) => {
  try { return readSource(file, ctx); } catch (e) { if (e && e.code === 'ENOENT') return null; throw e; }
};

const byNewest = (a, b) => (a < b ? 1 : a > b ? -1 : 0);

// ---------- Now, Next (docs/product/index.json) ----------

function readIndex(ctx) {
  const file = path.join(ctx.repoRoot, 'docs', 'product', 'index.json');
  let text;
  try {
    text = readSource(file, ctx);
  } catch (e) {
    return { reason: e && e.code === 'ENOENT' ? 'no_product_docs' : 'unreadable' };
  }
  try {
    const index = JSON.parse(text);
    return Array.isArray(index.features) ? { index } : { reason: 'unreadable' };
  } catch (_e) {
    return { reason: 'unreadable' };
  }
}

function nowSection(index) {
  const live = index.features.filter((f) => f && f.status === 'in-flight');
  const line = (f) => `${titleOf(f)}, ${stageWord(f.stage)}`;
  if (live.length <= NOW_MAX) return okOrNone('Now', live.map(line));
  const shown = live.slice(0, NOW_MAX - 1).map(line);
  return section('Now', 'ok', [...shown, `and ${live.length - shown.length} more`]);
}

function nextSection(index) {
  const id = index.next || index.cursor;
  if (!id) return section('Next', 'none', []);
  const feature = index.features.find((f) => f && f.id === id) || { id };
  return section('Next', 'ok', [`Recommended next: ${titleOf(feature)}.`]);
}

// ---------- Specs, Open points (<vault>/project/<slug>/spec/*.md) ----------

const openMarkers = (body) => (body.replace(/`[^`\n]*`/g, '').match(MARKER) || []).length;

function readSpec(name, dir, ctx) {
  const text = readSource(path.join(dir, name), ctx);
  let fm = {};
  try { fm = parseFrontmatter(text).fm || {}; } catch (_e) { fm = {}; }
  const id = cleanText(fm.id || name.replace(/\.md$/, ''));
  const title = typeof fm.title === 'string' ? cleanText(fm.title) : '';
  return { id, title, status: cleanText(fm.status || 'unknown'), open: openMarkers(text) };
}

function specSections(ctx) {
  const dir = path.join(ctx.root, 'project', ctx.slug, 'spec');
  let names;
  try {
    names = listFiles(dir, /\.md$/) || [];
  } catch (_e) {
    return [missing('Specs', 'unreadable'), missing('Open points', 'unreadable')];
  }
  const specs = [];
  for (const name of names.filter((n) => !/-VERIFICATION\.md$/.test(n))) {
    try { specs.push(readSpec(name, dir, ctx)); } catch (_e) { /* one unreadable spec is skipped, not fatal */ }
  }
  specs.sort((a, b) => byNewest(a.id, b.id));
  const specLine = (s) => [s.id, s.title, s.status].filter(Boolean).join(' — ');
  const openLines = specs.filter((s) => s.open > 0)
    .map((s) => `${s.id}: ${s.open} open clarification marker${s.open === 1 ? '' : 's'}`);
  return [okOrNone('Specs', specs.map(specLine)), okOrNone('Open points', openLines)];
}

// ---------- Phases (.a1/phases/<phase>/STATUS.md + VERIFICATION.md) ----------

const HEADING_STATES = Object.freeze({
  done: 'done', complete: 'done', completed: 'done', blocked: 'blocked', partial: 'partly done', 'in progress': 'in progress',
});

/** The state word after `⟶` in a wave heading; null when the heading carries no known marker. */
function markerState(heading) {
  const m = /⟶\s*([A-Za-z][A-Za-z ]*?)\s*$/.exec(heading);
  return m ? (HEADING_STATES[m[1].toLowerCase()] || null) : null;
}

/** Keyword fallback for a wave block without a heading marker; whole words only, negated words ignored. */
function keywordState(block) {
  if (/(?<!\bnot\s)\bBLOCKED\b/.test(block)) return 'blocked';
  if (/\bPARTIAL\b/.test(block)) return 'partly done';
  return /\b(DONE|COMPLETE)\b|\bCompleted:/.test(block) ? 'done' : 'in progress';
}

/** `wave N done` from the last `## Wave N` heading of a STATUS.md; null when there is none. */
function waveState(text) {
  const parts = text.split(/^(?=## Wave\s+\d+)/m).filter((p) => /^## Wave\s+\d+/.test(p));
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  const heading = last.split('\n', 1)[0];
  const n = /^## Wave\s+(\d+)/.exec(heading)[1];
  return `wave ${n} ${markerState(heading) || keywordState(last)}`;
}

function verdictOf(text) {
  const m = text && /Verdict:?\**\s*\**([A-Za-z_-]+)/.exec(text);
  return m ? cleanText(m[1]).toUpperCase() : null;
}

function phaseLine(name, dir, ctx) {
  const status = readOrNull(path.join(dir, 'STATUS.md'), ctx);
  const verification = readOrNull(path.join(dir, 'VERIFICATION.md'), ctx);
  if (status === null && verification === null) return null;
  const wave = (status && waveState(status)) || 'no wave recorded';
  return `${cleanText(name)} — ${wave} — verification: ${verdictOf(verification) || 'pending'}`;
}

/** Newest mtime (ms) of STATUS.md / VERIFICATION.md of a phase (links count as 0); 0 when neither exists. */
function phaseMtime(dir) {
  let newest = 0;
  for (const f of ['STATUS.md', 'VERIFICATION.md']) {
    try {
      const st = fs.lstatSync(path.join(dir, f));
      if (st.isFile()) newest = Math.max(newest, st.mtimeMs);
    } catch (_e) { /* absent file */ }
  }
  return newest;
}

function phasesSection(ctx) {
  const base = path.join(ctx.repoRoot, '.a1', 'phases');
  if (!fs.existsSync(base)) return missing('Phases', 'no_phases');
  const lines = [];
  try {
    const names = listDirs(base).filter((n) => !n.startsWith('_'))
      .map((name) => ({ name, at: phaseMtime(path.join(base, name)) }))
      .sort((a, b) => b.at - a.at || byNewest(a.name, b.name)).map((p) => p.name);
    for (const name of names) {
      const line = phaseLine(name, path.join(base, name), ctx);
      if (line) lines.push(line);
    }
  } catch (_e) {
    return missing('Phases', 'unreadable');
  }
  return okOrNone('Phases', lines);
}

// ---------- Learnings (vault mode of `learnings count-since-watermark`) ----------

const learnDir = (root) => path.join(root, 'pattern', 'a1-learnings');
const countMatches = (text, re, watermark, group) => {
  let n = 0; let m;
  while ((m = re.exec(text)) !== null) if (m[group] > watermark) n += 1;
  return n;
};

function retroCount(root, watermark, ctx) {
  const dir = learnDir(root);
  let total = 0;
  for (const name of (listFiles(dir, /\.md$/) || []).filter((n) => n !== 'patterns.md' && n !== 'index.md')) {
    const text = readOrNull(path.join(dir, name), ctx) || '';
    total += countMatches(text, /^date:\s*(\S+)/gm, watermark, 1);
    if (name === 'a1-fix.md') total += countMatches(text, /^## (\d{4}-\d{2}-\d{2})/gm, watermark, 1);
  }
  return total;
}

function walkMd(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(full, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function postmortemCount(root, watermark, ctx) {
  let total = 0;
  for (const slug of listDirs(path.join(root, 'project'))) {
    for (const file of walkMd(path.join(root, 'project', slug, 'postmortems'), [])) {
      const text = readOrNull(file, ctx);
      if (!text || !text.startsWith('---')) continue;
      let fm;
      try { fm = parseFrontmatter(text).fm; } catch (_e) { continue; }
      if (!fm || !fm.date || !(String(fm.date).trim() > watermark)) continue;
      const type = fm.type === undefined || fm.type === null || fm.type === '' ? '' : String(fm.type).trim().toLowerCase();
      if (type === '' || COUNTABLE_TYPES.has(type)) total += 1;
    }
  }
  return total;
}

function learningsSection(ctx) {
  const text = readOrNull(path.join(learnDir(ctx.root), 'patterns.md'), ctx);
  const watermark = text && /^updated:\s*(\S+)/m.exec(text);
  if (!watermark) return missing('Learnings', 'no_watermark');
  try {
    const count = retroCount(ctx.root, watermark[1], ctx) + postmortemCount(ctx.root, watermark[1], ctx);
    const noun = count === 1 ? 'new learning' : 'new learnings';
    return section('Learnings', 'ok', [`${count} ${noun} since the last evolve run (${cleanText(watermark[1])})`]);
  } catch (_e) {
    return missing('Learnings', 'unreadable');
  }
}

// ---------- entry point ----------

/** The six repo/vault sections in note order. Never throws for a missing or unreadable source. */
function collectSections(ctx) {
  const { index, reason } = readIndex(ctx);
  const productSections = index ? [nowSection(index), nextSection(index)]
    : [missing('Now', reason), missing('Next', reason)];
  const [specs, open] = specSections(ctx);
  return Object.freeze([...productSections, specs, phasesSection(ctx), learningsSection(ctx), open]);
}

module.exports = { collectSections, SECTION_NAMES, REASONS };
