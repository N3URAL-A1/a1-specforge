'use strict';

// ---------------------------------------------------------------------------
// xprov-filter — reviewer output is filtered BEFORE any a1 component reads it
// (spec 009-cross-provider-review-gate, Wave 3; FR-018, FR-019, FR-028).
//
// Two pure hooks, called by xprov-normalize.cjs through its lazy require:
//
//   filterOutput(texts: string[]) → { hit: boolean, pattern_name: string|null }
//     Applies SECRET_PATTERNS (owned by xprov.cjs) to the raw result.json text
//     and reply.txt. Reports the pattern NAME only — the matched text must
//     never travel into XREVIEW.md, stdout or a findings file.
//
//   quarantineFindings(findings, { lsFiles: Set, planPath, repoRoot })
//     → { kept: finding[], quarantined: (finding & { reason, marker? })[], notes: string[] }
//     Findings are data. `file` must be a relative path without `..` segments
//     that is in `git ls-files` at the reviewed commit (the caller passes the
//     set — this module does no git I/O) or equals the phase's PLAN.md path;
//     otherwise `reason: path_not_in_repo`. `evidence` and `fix` are lowercased
//     and scanned for INSTRUCTION_MARKERS; a hit is `reason: instruction_shaped`.
//     New arrays, input untouched. Any single string field longer than
//     MAX_FIELD_CHARS is scanned only up to that length and the truncation is
//     recorded in `notes` (size guard; the JSON read itself is bounded by
//     normalize to MAX_RESULT_BYTES).
//
// No child process, no shell, no I/O: a hostile path such as `; rm -rf /` is
// only ever compared as a string against the ls-files set.
// ---------------------------------------------------------------------------

const path = require('path');
const X = require('./xprov.cjs');

const REASON_PATH = 'path_not_in_repo';
const REASON_INSTRUCTION = 'instruction_shaped';

// ---------- secret filter ----------

const MAX_PARSED_STRINGS = 20000; // size guard for the parsed-value scan
const SCAN_CAP_PATTERN = 'scan_cap_reached'; // reported as a hit: reaching the cap fails closed

/** The strings (keys and values) of a parsed JSON text, iteratively and without
 * argument spreading (a spread throws RangeError from ~124k elements); `{ strings: [],
 * capped: false }` when the text is not JSON. `capped` is true when strings were left
 * unvisited. A JSON escape (`\n`, `\u0073`) hides a key from the raw text but not from
 * the parsed value (Samuel SEC-1, spec 012 FR-017). */
function parsedStrings(text) {
  let root;
  try { root = JSON.parse(text); } catch (_e) { return { strings: [], capped: false }; }
  const strings = [];
  const stack = [root];
  while (stack.length > 0) {
    if (strings.length >= MAX_PARSED_STRINGS) return { strings, capped: true };
    const v = stack.pop();
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (v[i] !== null && typeof v[i] !== 'number' && typeof v[i] !== 'boolean') stack.push(v[i]);
    } else if (v !== null && typeof v === 'object') {
      for (const key of Object.keys(v)) { strings.push(key); stack.push(v[key]); }
    }
  }
  return { strings, capped: false };
}

/** First pattern that matches any of the texts or, for JSON texts, any parsed
 * string value; by name; never the match. A parsed scan that reached its cap with
 * no pattern hit is a hit named `scan_cap_reached` (fail closed). */
function filterOutput(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  let capped = false;
  for (const text of list) {
    if (typeof text !== 'string' || text === '') continue;
    const parsed = parsedStrings(text);
    capped = capped || parsed.capped;
    for (const candidate of [text, ...parsed.strings]) {
      for (const { name, re } of X.SECRET_PATTERNS) {
        if (re.test(candidate)) return { hit: true, pattern_name: name };
      }
    }
  }
  return capped ? { hit: true, pattern_name: SCAN_CAP_PATTERN } : { hit: false, pattern_name: null };
}

// ---------- path validation ----------

/** Relative, no NUL, no `..` segment after POSIX normalisation, non-empty. */
function isRepoRelativePath(file) {
  if (typeof file !== 'string' || file === '' || file.includes('\0')) return false;
  if (path.isAbsolute(file) || path.posix.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file)) return false;
  const normalized = path.posix.normalize(file.replace(/\\/g, '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return false;
  return !normalized.split('/').includes('..');
}

function normalizeRel(file) {
  return path.posix.normalize(String(file).replace(/\\/g, '/')).replace(/^\.\//, '');
}

function pathIsInRepo(file, ctx) {
  if (!isRepoRelativePath(file)) return false;
  const rel = normalizeRel(file);
  if (ctx.planPath && rel === normalizeRel(ctx.planPath)) return true;
  return ctx.lsFiles instanceof Set && (ctx.lsFiles.has(rel) || ctx.lsFiles.has(file));
}

// ---------- instruction scan ----------

/** Clip one field to the scan window; returns { text, truncated }. */
function clipField(value) {
  const s = typeof value === 'string' ? value : '';
  return s.length > X.MAX_FIELD_CHARS ? { text: s.slice(0, X.MAX_FIELD_CHARS), truncated: true } : { text: s, truncated: false };
}

// Every Unicode space-like code point, including the zero-width ones JS `\s`
// does not cover (ZWSP, ZWNJ, ZWJ, word joiner). Collapsed to one ASCII space
// before the marker scan so `run curl`, `git\tpush` or `run​curl`
// cannot slip past a space-terminated marker.
const SPACE_LIKE_RE = new RegExp('[\\s\\u00a0\\u1680\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+', 'g');

/** NFKC (fullwidth → ASCII), unicode spaces → one space, lowercase. Line
 * breaks survive as a single `\n` so the anchored markers (`system:` at a line
 * start) keep their boundary; everything else space-like collapses. */
function normalizeHaystack(text) {
  return String(text).normalize('NFKC').replace(/\r\n?/g, '\n')
    .split('\n').map((line) => line.replace(SPACE_LIKE_RE, ' ')).join('\n')
    .toLowerCase();
}

/** The first INSTRUCTION_MARKER found in the normalised evidence + fix, or null. */
function instructionMarker(finding, notes) {
  const ev = clipField(finding.evidence);
  const fx = clipField(finding.fix);
  if (ev.truncated || fx.truncated) {
    notes.push(`finding ${String(finding.id)}: a field exceeded ${X.MAX_FIELD_CHARS} chars and was scanned up to that length only`);
  }
  const haystack = normalizeHaystack(`${ev.text}\n${fx.text}`);
  for (const marker of X.INSTRUCTION_MARKERS) {
    if (haystack.includes(marker)) return marker;
  }
  for (const { name, re } of X.INSTRUCTION_MARKER_PATTERNS || []) {
    if (re.test(haystack)) return name;
  }
  return null;
}

// ---------- quarantine ----------

function quarantineFindings(findings, ctx) {
  const list = Array.isArray(findings) ? findings : [];
  const context = ctx || {};
  const kept = [];
  const quarantined = [];
  const notes = [];
  for (const f of list) {
    const finding = f && typeof f === 'object' ? f : { id: String(f), file: '', evidence: '', fix: '' };
    if (!pathIsInRepo(finding.file, context)) {
      quarantined.push({ ...finding, reason: REASON_PATH });
      continue;
    }
    const marker = instructionMarker(finding, notes);
    if (marker !== null) {
      quarantined.push({ ...finding, reason: REASON_INSTRUCTION, marker });
      continue;
    }
    kept.push({ ...finding });
  }
  return { kept, quarantined, notes };
}

module.exports = {
  filterOutput, quarantineFindings, isRepoRelativePath, instructionMarker, normalizeHaystack,
  REASON_PATH, REASON_INSTRUCTION,
};
