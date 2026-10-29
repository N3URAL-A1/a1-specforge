'use strict';

// profile-nfr — spec 006-specforge-kritis-profile, Wave 4 (FR-004). Owns
// `profile nfr-inject`: appends every uncovered item of the NIS2/KRITIS NFR
// catalogue (`_shared/profiles/kritis/nfr-catalogue.md`) into a spec as an
// ordinary EARS-form `FR-###` line, deduplicated by tag and idempotent.
//
// Numbering (DECIDED 2026-10-29, option B): the injected lines continue the
// spec's running `FR-###` sequence. `FR-NFR-###` is NOT used, because
// `check.cjs` matches `/\bFR-\d{3,}(?:-\d+)?\b/g` and would not see it. The
// catalogue id travels in the text as `Source: kritis-nfr:<ID>`. Heading and
// line shape come from `_shared/profiles/kritis/spec-sections.md` section 1.
//
// `planInjection(specText, catalogue)` and `parseCatalogue(text)` are pure
// (no I/O, no process.exit; errors are thrown with a `.code`). `injectNfr`
// is the CLI entry point: argv parsing, path checks, atomic write, exit code
// (0 written or nothing to add / 2 catalogue_invalid, unreadable or unsafe
// --spec, missing "## Functional Requirements"). Dedup is tag-based only.
//
// Dispatch note: `profile.cjs` (Wave 1) calls `planInjection(rest)` with an
// argv array. `planInjection` therefore forwards an array argument to
// `injectNfr`; a string argument is the pure contract.

const fs = require('fs');
const path = require('path');
const { resolveVaultPath, parseFlags, readMd, writeMdAtomic } = require('./io.cjs');
const { usage } = require('./help.cjs');

const MAX_SPEC_BYTES = 1024 * 1024; // 1 MiB (same cap as profile-ears.cjs)
const EXPECTED_ITEMS = 41;
const CATALOGUE_PATH = path.join(__dirname, '..', 'profiles', 'kritis', 'nfr-catalogue.md');
const CATALOGUE_REF = '_shared/profiles/kritis/nfr-catalogue.md';

const FR_HEADING = '## Functional Requirements';
const NFR_HEADING = '## Non-Functional Requirements (KRITIS profile)';
const COLUMNS = 6;
const ID_PATTERN = /^(AVA|SEC|AUD|PER|DAT|OPS)-?\d{2}$/;
const ID_SOURCE = '(?:AVA|SEC|AUD|PER|DAT|OPS)-?\\d{2}';
const FR_NUMBER_RE = /\bFR-(\d{3,})(?:-\d+)?\b/g; // same shape as check.cjs:19
const SOURCE_TAG_RE = new RegExp(`Source:\\s*kritis-nfr:(${ID_SOURCE})\\b`, 'g');
const COVERS_TAG_RE = new RegExp(`\\(covers\\s+kritis-nfr:(${ID_SOURCE})\\)`, 'g');
const PLACEHOLDER_RE = /\[X(?:\s[^\]]*)?\]/g; // [X] / [X ms]

// EARS opener -> tag (profile-ears.cjs PATTERN_OPENERS).
const OPENER_TAGS = Object.freeze([
  [/^While\s/, 'state-driven'],
  [/^When\s/, 'event-driven'],
  [/^Where\s/, 'optional'],
  [/^If\s/, 'unwanted'],
]);

function codedError(code, detail) {
  const e = new Error(detail ? `${code}: ${detail}` : code);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------------------
// catalogue

function splitRow(line) {
  const t = line.trim();
  const inner = t.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

/**
 * `parseCatalogue(text)` — pure. Reads the table under `## Catalogue` and
 * returns a frozen array of `{ id, category, requirement, baseline, source,
 * question }`. Throws `catalogue_invalid` unless there are exactly 41 rows,
 * each with 6 cells, an id matching ID_PATTERN, and unique ids.
 */
function parseCatalogue(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Catalogue');
  if (start === -1) throw codedError('catalogue_invalid', 'no "## Catalogue" section');
  const tableLines = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    if (/^\s*\|/.test(lines[i])) tableLines.push(lines[i]);
  }
  const rows = tableLines.slice(2); // header + separator
  const items = [];
  const seen = new Set();
  for (const line of rows) {
    const cells = splitRow(line);
    if (cells.length !== COLUMNS) {
      throw codedError('catalogue_invalid', `row has ${cells.length} cells, expected ${COLUMNS}: ${line.slice(0, 40)}`);
    }
    const [id, category, requirement, baseline, source, question] = cells;
    if (!ID_PATTERN.test(id)) throw codedError('catalogue_invalid', `bad id "${id}"`);
    if (seen.has(id)) throw codedError('catalogue_invalid', `duplicate id "${id}"`);
    if (requirement === '') throw codedError('catalogue_invalid', `empty requirement for ${id}`);
    seen.add(id);
    items.push(Object.freeze({ id, category, requirement, baseline, source, question }));
  }
  if (items.length !== EXPECTED_ITEMS) {
    throw codedError('catalogue_invalid', `${items.length} rows, expected ${EXPECTED_ITEMS}`);
  }
  return Object.freeze(items);
}

// ---------------------------------------------------------------------------
// injection

function allMatches(re, text, group) {
  const out = [];
  const r = new RegExp(re.source, re.flags);
  let m;
  while ((m = r.exec(text)) !== null) out.push(m[group]);
  return out;
}

function highestFrNumber(text) {
  return allMatches(FR_NUMBER_RE, text, 1).reduce((max, n) => Math.max(max, parseInt(n, 10)), 0);
}

function coveredIds(text) {
  return new Set([...allMatches(SOURCE_TAG_RE, text, 1), ...allMatches(COVERS_TAG_RE, text, 1)]);
}

function earsTag(requirement) {
  const hit = OPENER_TAGS.find(([re]) => re.test(requirement));
  return hit ? hit[1] : 'ubiquitous';
}

function renderFrLine(item, number) {
  const marker = (m) => `[NEEDS CLARIFICATION: ${item.id} threshold ${m.slice(1, -1)} is open]`;
  const req = item.requirement.replace(PLACEHOLDER_RE, marker);
  const article = item.source ? `; ${item.source}` : '';
  const num = String(number).padStart(3, '0');
  return `- **FR-${num}**: ${req} [EARS: ${earsTag(item.requirement)}] — Source: kritis-nfr:${item.id} (${CATALOGUE_REF})${article}`;
}

/** Index of the next `## ` heading after `from`, or `lines.length`. */
function nextH2(lines, from) {
  for (let i = from + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) return i;
  return lines.length;
}

/** Trailing blank lines of `lines[from..to)` trimmed off: returns new `to`. */
function trimBlankTail(lines, from, to) {
  let end = to;
  while (end > from + 1 && lines[end - 1].trim() === '') end -= 1;
  return end;
}

/**
 * `planInjection(specText, catalogue)` — pure. Returns a frozen
 * `{ text, added, skipped }` (ids, in catalogue order). `catalogue` is the
 * array from `parseCatalogue`. Inputs are not mutated. Throws
 * `no_fr_section` when the spec has no `## Functional Requirements`.
 */
function planInjection(specText, catalogue) {
  const text = String(specText == null ? '' : specText);
  const covered = coveredIds(text);
  const todo = catalogue.filter((it) => !covered.has(it.id));
  const skipped = catalogue.filter((it) => covered.has(it.id)).map((it) => it.id);
  if (todo.length === 0) {
    return Object.freeze({ text, added: Object.freeze([]), skipped: Object.freeze(skipped) });
  }

  const lines = text.split('\n');
  const frAt = lines.findIndex((l) => l.trim() === FR_HEADING);
  if (frAt === -1) throw codedError('no_fr_section', `spec has no "${FR_HEADING}" heading`);

  const first = highestFrNumber(text) + 1;
  const newLines = todo.map((it, i) => renderFrLine(it, first + i));

  const nfrAt = lines.findIndex((l) => l.trim() === NFR_HEADING);
  let out;
  if (nfrAt !== -1) {
    const end = trimBlankTail(lines, nfrAt, nextH2(lines, nfrAt));
    out = [...lines.slice(0, end), ...newLines, ...lines.slice(end)];
  } else {
    const end = trimBlankTail(lines, frAt, nextH2(lines, frAt));
    const block = ['', NFR_HEADING, '', ...newLines];
    const tail = lines.slice(end);
    // keep one blank line before whatever followed the FR section
    out = [...lines.slice(0, end), ...block, ...(tail.length && tail[0].trim() !== '' ? [''] : []), ...tail];
  }
  return Object.freeze({
    text: out.join('\n'),
    added: Object.freeze(todo.map((it) => it.id)),
    skipped: Object.freeze(skipped),
  });
}

// ---------------------------------------------------------------------------
// CLI

function fail2(msg) {
  process.stderr.write(`profile nfr-inject: ${msg}\n`);
  process.exit(2);
}

function resolveSpecOrExit(specFlag) {
  let abs;
  try {
    abs = resolveVaultPath(specFlag);
  } catch (e) {
    fail2(`unsafe --spec path: ${e.message}`);
  }
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    fail2(`cannot read --spec: ${e.code || e.message}`);
  }
  if (st.isSymbolicLink()) fail2('--spec refused — target is a symlink');
  if (!st.isFile()) fail2('--spec is not a regular file');
  if (st.size > MAX_SPEC_BYTES) fail2(`--spec exceeds the ${MAX_SPEC_BYTES}-byte cap (${st.size} bytes)`);
  return abs;
}

function loadCatalogueOrExit() {
  let raw;
  try {
    raw = fs.readFileSync(CATALOGUE_PATH, 'utf8');
  } catch (e) {
    fail2(`catalogue_invalid: cannot read catalogue: ${e.code || e.message}`);
  }
  try {
    return parseCatalogue(raw);
  } catch (e) {
    fail2(e.code === 'catalogue_invalid' ? e.message : `catalogue_invalid: ${e.message}`);
  }
  return [];
}

/**
 * `injectNfr(argv)` — CLI entry point for `profile nfr-inject --spec <path>`.
 */
function injectNfr(argv) {
  const flags = parseFlags(argv || [], { spec: 'value' });
  if (!flags.spec) {
    usage('profile nfr-inject requires --spec <path>');
    return;
  }
  const abs = resolveSpecOrExit(flags.spec);
  const catalogue = loadCatalogueOrExit();

  let parsed;
  try {
    parsed = readMd(abs);
  } catch (e) {
    fail2(`cannot parse --spec: ${e.message}`);
  }
  let plan;
  try {
    plan = planInjection(parsed.body, catalogue);
  } catch (e) {
    fail2(e.message);
  }
  if (plan.added.length > 0) {
    writeMdAtomic(abs, parsed.fm, plan.text);
  }
  process.stdout.write(`profile nfr-inject: added ${plan.added.length}, skipped ${plan.skipped.length}\n`);
  process.exit(0);
}

module.exports = { planInjection, parseCatalogue, injectNfr, EXPECTED_ITEMS, NFR_HEADING };
