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
//     → { kept: finding[], quarantined: (finding & { reason, marker?, display_detail? })[], notes: string[] }
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
const DISPLAY_DETAIL_MAX_CHARS = X.TITLE_MAX_CHARS * 4; // FR-013: 480

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

// Unicode format characters (category Cf: soft hyphen, LRM/RLM, bidi controls, tag chars …) render as nothing,
// so `ig<SHY>nore` reads as `ignore`. The space-like ones (ZWSP, word joiner, BOM) are collapsed to a space first.
const FORMAT_CHAR_RE = /\p{Cf}/gu;

/** NFKC (fullwidth → ASCII), unicode spaces → one space, remaining format characters removed, lowercase.
 * Line breaks survive as a single `\n` so the anchored markers (`system:` at a line start) keep their
 * boundary; everything else space-like collapses. */
function normalizeHaystack(text) {
  return String(text).normalize('NFKC').replace(/\r\n?/g, '\n')
    .split('\n').map((line) => line.replace(SPACE_LIKE_RE, ' ').replace(FORMAT_CHAR_RE, '')).join('\n')
    .toLowerCase();
}

/** The texts a marker is searched in: the line-preserving haystack, the same with every whitespace run
 * (line breaks included) folded to one space — `ignore\nprevious`, `git\npush`, `rm\n-rf` — and a variant
 * where format characters become a space (`run<LRM>curl`). */
function haystackVariants(text) {
  const base = normalizeHaystack(text);
  const flat = (t) => t.replace(/\s+/g, ' ');
  const asSpace = String(text).normalize('NFKC').replace(FORMAT_CHAR_RE, ' ');
  return [base, flat(base), flat(normalizeHaystack(asSpace))];
}

function markerIn(variants) {
  for (const haystack of variants) {
    for (const marker of X.INSTRUCTION_MARKERS) {
      if (haystack.includes(marker)) return marker;
    }
    for (const { name, re } of X.INSTRUCTION_MARKER_PATTERNS || []) {
      if (re.test(haystack)) return name;
    }
  }
  return null;
}

/** The first INSTRUCTION_MARKER found in the normalised evidence + fix + file + id, or null. `file` and `id`
 * are reviewer text too (a `path_not_in_repo` file is anything), and both travel into the findings file. */
function instructionMarker(finding, notes) {
  const ev = clipField(finding.evidence);
  const fx = clipField(finding.fix);
  const file = clipField(finding.file);
  const id = clipField(finding.id);
  if (ev.truncated || fx.truncated || file.truncated || id.truncated) {
    notes.push(`finding ${String(finding.id).slice(0, X.TITLE_MAX_CHARS)}: a field exceeded ${X.MAX_FIELD_CHARS} chars and was scanned up to that length only`);
  }
  // field by field: a line break between two fields must not fold into a space and join their words
  for (const text of [ev.text, fx.text, file.text, id.text]) {
    const marker = markerIn(haystackVariants(text));
    if (marker !== null) return marker;
  }
  return null;
}

/** Marker in the identity fields only (`file`, `id`): those are echoed verbatim in lists, so a hit replaces them. */
function identityMarker(finding) {
  for (const text of [clipField(finding.file).text, clipField(finding.id).text]) {
    const marker = markerIn(haystackVariants(text));
    if (marker !== null) return marker;
  }
  return null;
}

// ---------- quarantine ----------

/** Total length <= DISPLAY_DETAIL_MAX_CHARS, an ellipsis when cut. */
const clipDetail = (text) => (text.length > DISPLAY_DETAIL_MAX_CHARS ? `${text.slice(0, DISPLAY_DETAIL_MAX_CHARS - 1)}…` : text);

const IDENTITY_PLACEHOLDER = '[redacted: instruction-shaped]';
const oneLineClip = (v) => {
  const t = String(v == null ? '' : v).replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ');
  return t.length > X.TITLE_MAX_CHARS ? `${t.slice(0, X.TITLE_MAX_CHARS - 1)}…` : t;
};

/** `file` and `id` of a quarantined item as they may be listed: a field with a marker → fixed placeholder (an id
 * hit also replaces the title, which repeats the id); otherwise one line, at most TITLE_MAX_CHARS. New object. */
function listableIdentity(finding) {
  const field = (key) => (identityMarker({ [key]: finding[key] }) !== null ? IDENTITY_PLACEHOLDER : oneLineClip(finding[key]));
  const id = field('id');
  return { ...finding, file: field('file'), id, ...(id === IDENTITY_PLACEHOLDER ? { title: IDENTITY_PLACEHOLDER } : {}) };
}

/** A `path_not_in_repo` item (FR-013): the same marker scan as an in-repo finding. Without a marker the
 * item carries `display_detail`, its detail clipped to DISPLAY_DETAIL_MAX_CHARS; with one it carries
 * the marker and no detail. Secret values never reach here (the output filter ran on the raw result). */
function quarantinedForPath(finding, notes) {
  const marker = instructionMarker(finding, notes);
  const listed = listableIdentity(finding);
  if (marker !== null) return { ...listed, reason: REASON_PATH, marker };
  const detail = typeof finding.detail === 'string' ? finding.detail : '';
  return { ...listed, reason: REASON_PATH, display_detail: clipDetail(detail) };
}

function quarantineFindings(findings, ctx) {
  const list = Array.isArray(findings) ? findings : [];
  const context = ctx || {};
  const kept = [];
  const quarantined = [];
  const notes = [];
  for (const f of list) {
    const finding = f && typeof f === 'object' ? f : { id: String(f), file: '', evidence: '', fix: '' };
    if (!pathIsInRepo(finding.file, context)) {
      quarantined.push(quarantinedForPath(finding, notes));
      continue;
    }
    const marker = instructionMarker(finding, notes);
    if (marker !== null) {
      quarantined.push({ ...listableIdentity(finding), reason: REASON_INSTRUCTION, marker });
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
