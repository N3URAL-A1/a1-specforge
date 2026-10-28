'use strict';

// profile-ears — spec 006-specforge-kritis-profile, Wave 3 (FR-002). Owns
// `profile ears-check`: a deterministic check that every functional
// requirement in a spec's `## Functional Requirements` section (and the
// profile's `## Non-Functional Requirements (KRITIS profile)` section)
// matches its declared EARS pattern (_shared/profiles/kritis/ears.md).
//
// `evaluateEars(text)` is the pure checker (text in, verdict out). `checkEars`
// is the CLI entry point `profile.cjs` dispatches `ears-check` to (argv in):
// it reads the file, caps its size, refuses a symlink, runs the pure
// checker, and maps the verdict to the house exit-code contract (0 pass /
// 1 finding or usage / 2 unreadable, unsafe path or hostile input). No
// module-global mutable state; every returned object is frozen.

const fs = require('fs');
const { resolveVaultPath, parseFlags } = require('./io.cjs');
const { usage } = require('./help.cjs');

const MAX_SPEC_BYTES = 1024 * 1024; // 1 MiB (contract: size cap 1 MiB)

const SECTION_HEADINGS = [
  '## Functional Requirements',
  '## Non-Functional Requirements (KRITIS profile)',
];

// Closed, frozen finding-code set (contract: must not grow ad hoc).
const FINDING_CODES = Object.freeze([
  'no_tag',
  'unknown_pattern',
  'structure_mismatch',
  'missing_shall',
  'multiple_shall',
  'no_frs',
]);

// Canonical EARS patterns (ears.md). Each entry: tag name -> a RegExp that
// the requirement's own text (tag stripped) must start with, case-sensitive
// per the canonical keyword. Patterns are anchored at the start of the
// requirement body so a requirement that merely *mentions* "when" midway
// does not pass as event-driven.
const PATTERN_OPENERS = Object.freeze({
  ubiquitous: /^The\s+\S/,
  'event-driven': /^When\s+\S/,
  'state-driven': /^While\s+\S/,
  optional: /^Where\s+\S/,
  unwanted: /^If\s+\S/,
});

const KNOWN_TAGS = Object.freeze(Object.keys(PATTERN_OPENERS));

const TAG_RE = /\[EARS:\s*([a-z-]+)\s*\]/i;

const VAGUE_TERMS = Object.freeze([
  'should',
  'as fast as possible',
  'as appropriate',
  'as needed',
  'adequate security',
  'etc.',
  'and similar',
  'intuitive',
  'in real time',
]);

/** Extract the body lines of every heading in SECTION_HEADINGS, stopping at
 * the next `## ` heading (any level-2 heading ends the section). */
function extractSections(text) {
  const lines = text.split('\n');
  const bodies = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (SECTION_HEADINGS.includes(line.trim())) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^##\s+/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      bodies.push(body);
      continue;
    }
    i += 1;
  }
  return bodies;
}

// Bullet shapes: "- **FR-NNN**:" / "- **FR-NNN**" / "**FR-NNN**" (bare,
// usually with an em dash or colon after). Heading shapes: "### FR-NNN" /
// "#### FR-NNN". FR ids may carry the NFR infix (FR-NFR-001).
const FR_ID = 'FR(?:-NFR)?-\\d{3,}';
const BULLET_RE = new RegExp(`^-\\s+\\*\\*(${FR_ID})\\*\\*:?\\s*(.*)$`);
const BARE_RE = new RegExp(`^\\*\\*(${FR_ID})\\*\\*\\s*[:—-]?\\s*(.*)$`);
const HEADING_RE = new RegExp(`^#{3,4}\\s+(${FR_ID})\\b.*$`);
const TABLE_ROW_RE = /^\s*\|/;

/** True while `bodyLines[j]` continues a lazy (flush-left) paragraph: not
 * blank, not a new heading/bullet/table row. Shared by the bare-`**FR-NNN**`
 * and heading-shape paragraph readers (real files wrap both flush-left). */
function isParagraphContinuation(line) {
  return (
    line.trim() !== '' &&
    !/^#{1,6}\s/.test(line) &&
    !/^(-|\*)\s/.test(line) &&
    !TABLE_ROW_RE.test(line)
  );
}

/** Collect lazy-paragraph continuation lines starting at bodyLines[start],
 * trimmed. Returns { parts, next }. */
function readParagraph(bodyLines, start) {
  const parts = [];
  let j = start;
  while (j < bodyLines.length && isParagraphContinuation(bodyLines[j])) {
    parts.push(bodyLines[j].trim());
    j += 1;
  }
  return { parts, next: j };
}

/** `- **FR-NNN**` bullet entry: its own line plus every INDENTED
 * continuation line that follows (a sub-bullet convention, where the next
 * unindented `- ` starts a new FR and must not be swallowed). */
function readBulletEntry(bodyLines, i, m) {
  const parts = [m[2]];
  let j = i + 1;
  while (j < bodyLines.length && /^\s+\S/.test(bodyLines[j])) {
    parts.push(bodyLines[j].trim());
    j += 1;
  }
  return { id: m[1], text: parts.join(' ').trim(), line: i + 1, next: j };
}

/** Bare `**FR-NNN**` entry (no leading `- `): markdown's lazy-continuation
 * paragraph style — real files (e.g. 014-preview-bypass-token.md) wrap it
 * flush-left, not indented. */
function readBareEntry(bodyLines, i, m) {
  const { parts, next } = readParagraph(bodyLines, i + 1);
  return { id: m[1], text: [m[2], ...parts].join(' ').trim(), line: i + 1, next };
}

/** Heading-shape entry (`###/#### FR-NNN`): body is the first paragraph
 * that follows (blank lines skipped, then lazy-continuation reader). */
function readHeadingEntry(bodyLines, i, m) {
  let j = i + 1;
  while (j < bodyLines.length && bodyLines[j].trim() === '') j += 1;
  const { parts, next } = readParagraph(bodyLines, j);
  return { id: m[1], text: parts.join(' ').trim(), line: i + 1, next };
}

/** Parse one section's body lines into FR entries: { id, text, line }.
 * Table rows are ignored outright. See the three shape readers above for
 * how each entry's body is assembled. */
function parseSection(bodyLines) {
  const entries = [];
  let i = 0;
  while (i < bodyLines.length) {
    const raw = bodyLines[i];
    if (TABLE_ROW_RE.test(raw)) { i += 1; continue; }

    const bulletM = raw.match(BULLET_RE);
    const bareM = !bulletM ? raw.match(BARE_RE) : null;
    const headingM = raw.match(HEADING_RE);

    let result = null;
    if (bulletM) result = readBulletEntry(bodyLines, i, bulletM);
    else if (bareM) result = readBareEntry(bodyLines, i, bareM);
    else if (headingM) result = readHeadingEntry(bodyLines, i, headingM);

    if (result) {
      entries.push({ id: result.id, text: result.text, line: result.line });
      i = result.next;
      continue;
    }
    i += 1;
  }
  return entries;
}

function countShall(text) {
  const matches = text.match(/\bshall\b/g);
  return matches ? matches.length : 0;
}

function findVagueTerms(text) {
  const lower = text.toLowerCase();
  const hits = [];
  for (const term of VAGUE_TERMS) {
    if (lower.includes(term)) hits.push(term);
  }
  return hits;
}

/** Classify one FR entry against its declared tag. Returns the one finding
 * that applies, or null when the entry passes. */
function classifyEntry(entry) {
  const { id, text: reqText, line } = entry;
  const tagM = reqText.match(TAG_RE);

  if (!tagM) {
    return { id, code: 'no_tag', line, message: `${id} has no [EARS: <pattern>] tag` };
  }

  const tag = tagM[1].toLowerCase();
  if (!KNOWN_TAGS.includes(tag)) {
    return { id, code: 'unknown_pattern', line, message: `${id} has an unrecognised EARS tag: ${tagM[1]}` };
  }

  const body = reqText.slice(0, tagM.index).trim();
  const shallCount = countShall(body);
  if (shallCount === 0) {
    return { id, code: 'missing_shall', line, message: `${id} has no "shall"` };
  }
  if (shallCount > 1) {
    return { id, code: 'multiple_shall', line, message: `${id} has ${shallCount} occurrences of "shall", expected exactly 1` };
  }

  if (!PATTERN_OPENERS[tag].test(body)) {
    return { id, code: 'structure_mismatch', line, message: `${id} is tagged "${tag}" but its text does not open with that pattern's keyword` };
  }
  return null;
}

/**
 * `evaluateEars(text)` — pure checker (text in, verdict out; no I/O).
 * @param {string} text spec markdown
 * @returns {{checked:number, findings:Array, warnings:Array}} frozen
 */
function evaluateEars(text) {
  const sections = extractSections(String(text == null ? '' : text));
  const entries = [];
  for (const body of sections) entries.push(...parseSection(body));

  if (entries.length === 0) {
    const noFrs = Object.freeze({ id: null, code: 'no_frs', line: null, message: 'no functional requirements found under a recognised heading' });
    return Object.freeze({ checked: 0, findings: Object.freeze([noFrs]), warnings: Object.freeze([]) });
  }

  const findings = [];
  const warnings = [];
  for (const entry of entries) {
    for (const term of findVagueTerms(entry.text)) {
      warnings.push(Object.freeze({ id: entry.id, code: 'vague_term', line: entry.line, message: `vague term "${term}"` }));
    }
    const finding = classifyEntry(entry);
    if (finding) findings.push(Object.freeze(finding));
  }

  return Object.freeze({
    checked: entries.length,
    findings: Object.freeze(findings),
    warnings: Object.freeze(warnings),
  });
}

/** Read and validate `--spec`'s target path. Returns the file's text, or
 * exits 2 (unreadable, symlink, not-a-file, oversized) without returning. */
function readSpecOrExit(specFlag) {
  let abs;
  try {
    abs = resolveVaultPath(specFlag);
  } catch (e) {
    process.stderr.write(`profile ears-check: unsafe --spec path: ${e.message}\n`);
    process.exit(2);
  }

  let st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    process.stderr.write(`profile ears-check: cannot read --spec: ${e.code || e.message}\n`);
    process.exit(2);
  }
  if (st.isSymbolicLink()) {
    process.stderr.write('profile ears-check: --spec refused — target is a symlink\n');
    process.exit(2);
  }
  if (!st.isFile()) {
    process.stderr.write('profile ears-check: --spec is not a regular file\n');
    process.exit(2);
  }
  if (st.size > MAX_SPEC_BYTES) {
    process.stderr.write(`profile ears-check: --spec exceeds the ${MAX_SPEC_BYTES}-byte cap (${st.size} bytes)\n`);
    process.exit(2);
  }

  try {
    return fs.readFileSync(abs, 'utf8');
  } catch (e) {
    process.stderr.write(`profile ears-check: cannot read --spec: ${e.code || e.message}\n`);
    process.exit(2);
    return ''; // unreachable — process.exit stops execution
  }
}

/** Print the verdict in the requested format. */
function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  process.stdout.write(`checked ${result.checked} requirement(s), ${result.findings.length} finding(s), ${result.warnings.length} warning(s)\n`);
  for (const f of result.findings) process.stdout.write(`  FINDING ${f.code} ${f.id || ''} (line ${f.line}): ${f.message}\n`);
  for (const w of result.warnings) process.stdout.write(`  WARNING ${w.code} ${w.id || ''} (line ${w.line}): ${w.message}\n`);
}

/**
 * `checkEars(args)` — the CLI entry point `profile.cjs` dispatches
 * `ears-check` to. `args` is the remaining argv, not spec text; it reads
 * `--spec` from the filesystem, caps size, refuses a symlink, runs the pure
 * `evaluateEars`, and maps the verdict to the house exit-code contract
 * (0 pass / 1 finding or usage / 2 unreadable, unsafe path or hostile input).
 */
function checkEars(args) {
  const flags = parseFlags(args, { spec: 'value', json: 'bool', phase: 'value' });
  if (!flags.spec) {
    usage('profile ears-check requires --spec <path>');
    return;
  }

  const text = readSpecOrExit(flags.spec);

  let result;
  try {
    result = evaluateEars(text);
  } catch (e) {
    process.stderr.write(`profile ears-check: internal error: ${e.message}\n`);
    process.exit(2);
    return;
  }

  printResult(result, flags.json);
  process.exit(result.findings.length > 0 ? 1 : 0);
}

module.exports = { checkEars, evaluateEars, FINDING_CODES };
