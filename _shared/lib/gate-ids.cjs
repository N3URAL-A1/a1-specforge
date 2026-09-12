'use strict';

// ---------------------------------------------------------------------------
// gate-ids — pure parsing/resolution helpers for `_shared/gates-registry.md`.
//
// No file I/O in this module (the caller reads the file, per the io.cjs
// split: parse functions take text, never a path). No CLI surface of its
// own — Wave 2's `retro validate` (spec 007-retro-gate-id-validator) is the
// sole consumer.
//
// Why this module is careful about WHERE it reads ids from: the registry's
// alias section (a bullet list, see gates-registry.md's own comment) exists
// precisely because a markdown table there would share the id-table's row
// shape and a naive `^| \`id\`` scrape would then accept the alias
// right-hand-side strings as registered ids — the exact drift class that
// caused 8 of 12 gates_fired ids to be silently discarded (2026-08-27
// synthesis) and the same misspelling to recur 9 more times after the
// warning was already written in prose. FR-003 exists to make this
// mechanical instead of readable.
// ---------------------------------------------------------------------------

// Header row the id table is anchored on. Matched loosely (only the leading
// `| id |` cell matters) so unrelated column-width formatting in the real
// file does not break the anchor.
const TABLE_HEADER_RE = /^\|\s*id\s*\|/i;

// A table row inside the id-table span: `| \`some-id\` | ... |`. The id must
// be backtick-quoted, matching every row in the real registry and the
// fixture registry.
const TABLE_ROW_ID_RE = /^\|\s*`([^`]+)`\s*\|/;

// A markdown table separator line (`|---|---|...`), which follows the header
// row and must not itself be read as a data row.
const TABLE_SEPARATOR_RE = /^\|[\s:-]+\|/;

// Left side of a range id must end in digits: prefix + number.
const RANGE_LEFT_RE = /^(.*?)(\d+)$/;

/**
 * Extract the ids of the registry's id table ONLY — never the alias bullet
 * list, never anything outside the table span. Locates the table by its
 * header row (`| id | phase | class | ... |`) and stops at the first blank
 * line after it; only rows inside that span are parsed. This is the
 * FR-003 implementation constraint: a whole-file `^\| \`` scrape would also
 * match a table-shaped alias section (see R1 in the fixture suite), so the
 * parser is deliberately anchored on the header instead.
 *
 * @param {string} text - full contents of a gates-registry.md-shaped file.
 * @returns {string[]} ids exactly as written in the table (ranges NOT
 *   expanded — call expandRangeIds() for that).
 */
function parseRegistryIds(text) {
  const lines = String(text).split('\n');
  let headerLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (TABLE_HEADER_RE.test(lines[i])) {
      headerLine = i;
      break;
    }
  }
  if (headerLine === -1) return [];

  const ids = [];
  // Row after the header is the separator (`|---|---|`); data rows start
  // after that. Walk forward until the first blank line, which ends the
  // table span — anything past it (including a table-shaped alias section
  // further down the file) is out of scope by construction.
  for (let i = headerLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') break;
    if (TABLE_SEPARATOR_RE.test(line)) continue;
    const m = line.match(TABLE_ROW_ID_RE);
    if (m) ids.push(m[1]);
  }
  return ids;
}

// Parses one `left..right` range id into {prefix, from, to}, or null if the
// shape does not match. Two accepted right-hand forms, both seen in the real
// registry / fixtures:
//   - pure digits ("modernize-g1..6")          -> reuses the full left prefix
//   - alpha+digits repeating only the prefix's tail after its last hyphen
//     ("modernize-g1..g6", "range-gate1..gate3") -> the registry's own
//     convention for hyphenated prefixes.
// Anything else (no ".." at all, more than one "..", a non-numeric left
// side) is not a range and the row stays a literal id.
function parseRangeShape(id) {
  const parts = String(id).split('..');
  if (parts.length !== 2) return null;
  const leftMatch = parts[0].match(RANGE_LEFT_RE);
  if (!leftMatch) return null;
  const prefix = leftMatch[1];
  const from = parseInt(leftMatch[2], 10);
  const right = parts[1];

  if (/^\d+$/.test(right)) {
    return { prefix, from, to: parseInt(right, 10) };
  }
  const tail = prefix.slice(prefix.lastIndexOf('-') + 1);
  if (tail && right.startsWith(tail) && /^\d+$/.test(right.slice(tail.length))) {
    return { prefix, from, to: parseInt(right.slice(tail.length), 10) };
  }
  return null;
}

/**
 * Split a list of raw registry ids into literal ids and numeric-suffix
 * ranges, and expose a single `has()`-style membership question via the
 * returned `literal` Set plus `ranges` array. Deliberately narrow: one
 * numeric-suffix range per row; anything parseRangeShape() does not
 * recognise is kept as a literal string, unexpanded.
 *
 * @param {string[]} ids - raw ids as returned by parseRegistryIds().
 * @returns {{literal: Set<string>, ranges: {prefix: string, from: number, to: number}[]}}
 */
function expandRangeIds(ids) {
  const literal = new Set();
  const ranges = [];
  for (const id of ids) {
    const parsed = parseRangeShape(id);
    if (parsed && parsed.to >= parsed.from) {
      ranges.push(parsed);
    } else {
      literal.add(id);
    }
  }
  return { literal, ranges };
}

/**
 * Is `id` registered, given the {literal, ranges} shape expandRangeIds()
 * returns? A thin convenience so callers do not each re-implement the
 * range-membership arithmetic that expandRangeIds() exists to encapsulate.
 *
 * @param {string} id
 * @param {{literal: Set<string>, ranges: {prefix: string, from: number, to: number}[]}} expanded
 * @returns {boolean}
 */
function isRegisteredId(id, expanded) {
  if (expanded.literal.has(id)) return true;
  for (const r of expanded.ranges) {
    if (!id.startsWith(r.prefix)) continue;
    const suffix = id.slice(r.prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = parseInt(suffix, 10);
    if (n >= r.from && n <= r.to) return true;
  }
  return false;
}

// Frozen alias map — the ONE place this correction lives in code (invariant
// 1: the registry's bullet-list prose stays the human-owned copy, this is
// the machine copy). Transcribed verbatim from `_shared/gates-registry.md`'s
// "Alias warning" section as measured 2026-09-11. Frozen because an
// exception list that can grow at runtime is exactly the SC-004
// anti-pattern this feature exists to prevent — adding an entry is a
// reviewed source change, never a side effect.
const KNOWN_ALIASES = Object.freeze({
  'lane-split-check': 'lane-split',
  'consistency-gate-4-5': 'gate-4.5-fr-consistency',
  'full-regression-gate': 'gate-1-build',
});

/**
 * Resolve a `gates_fired[].id` string against the registered set, in exactly
 * three statuses:
 *   - `ok`      — id is registered (literal or inside a range).
 *   - `drift`   — id is a documented misspelling (in KNOWN_ALIASES); carries
 *                 `canonical`, the correct id to use instead.
 *   - `unknown` — id is neither registered nor a documented alias. Real and
 *                 measured (`isolation-gate`, corpus 2026-09-11): this needs
 *                 its own message ("add a registry row per invariant 7")
 *                 rather than being folded into `drift`, which would imply a
 *                 canonical id that does not exist.
 *
 * Delegates the `ok` check to isRegisteredId() rather than testing a
 * literal-only Set itself, so there is exactly ONE definition of "is this id
 * registered" in this module. Before this fix the two functions disagreed:
 * resolveGateId took a literal-only Set and never consulted ranges, so
 * `resolveGateId('modernize-g3', ...)` reported `unknown` while
 * `isRegisteredId('modernize-g3', expanded)` correctly reported true for the
 * exact same id — a retro citing a real, range-registered gate would have
 * been told to add a row that already exists (found 2026-09-11 while
 * registering `isolation-gate`, before Wave 2 shipped this contradiction).
 *
 * @param {string} id - the id as written in a retro.
 * @param {{literal: Set<string>, ranges: {prefix: string, from: number, to: number}[]}} expanded
 *   - the SAME shape isRegisteredId() takes (expandRangeIds(parseRegistryIds(text))),
 *   not a bare Set — that was the mismatch this signature change fixes.
 * @returns {{status: 'ok'|'drift'|'unknown', id: string, canonical?: string}}
 */
function resolveGateId(id, expanded) {
  if (isRegisteredId(id, expanded)) {
    return { status: 'ok', id };
  }
  if (Object.prototype.hasOwnProperty.call(KNOWN_ALIASES, id)) {
    return { status: 'drift', id, canonical: KNOWN_ALIASES[id] };
  }
  return { status: 'unknown', id };
}

module.exports = {
  parseRegistryIds,
  expandRangeIds,
  isRegisteredId,
  KNOWN_ALIASES,
  resolveGateId,
};
