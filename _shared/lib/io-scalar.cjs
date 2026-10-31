'use strict';

// Scalar rules shared by both frontmatter parsers (io-frontmatter.cjs and
// io-nested-frontmatter.cjs): folded quoted values, inline arrays, and the
// scalar serializer/parser pair. Split out of io.cjs.

// A vault-wide foreign writer (Basic-Memory daemon, PyYAML `yaml.dump`) folds
// long scalars at ~80 columns onto an indented continuation line. Measured
// 2026-09-24: reading only the first line let `spec update-status` persist
// truncated title/consumer/phase_history values in three specs. Measured
// 2026-10-31: the same fold on PLAIN scalars was truncated too (33 a1-specforge
// notes). Join continuation lines with one space (YAML folding semantics):
// quoted scalars until the closing quote, plain scalars while the next line is
// indented. Flow/block-scalar/anchor/tag starts are not joined.
const NOT_PLAIN_START = /^[[{|>&*!%@`#]/;

// Is the quoted scalar `v` (opening quote included) closed? A trailing `''` inside single quotes is an escaped
// apostrophe, and `\"` inside double quotes an escaped quote - neither closes the scalar (measured 2026-10-31:
// a folded item ending in `(prioritized)''` stopped the join one line early).
function isClosedQuoted(v, q) {
  if (v.length < 2) return false;
  const body = v.slice(1);
  if (q === "'") { const t = body.match(/'+$/); return t !== null && t[0].length % 2 === 1; }
  return body.endsWith('"') && ((body.slice(0, -1).match(/\\+$/) || [''])[0].length % 2 === 0);
}

function joinFoldedScalar(lines, i, first) {
  if (first === '') return { value: first, index: i };
  const q = first[0];
  const quoted = q === '"' || q === "'";
  if (!quoted && NOT_PLAIN_START.test(first)) return { value: first, index: i };
  let v = first;
  let j = i;
  while (!(quoted && isClosedQuoted(v, q))
      && j + 1 < lines.length && /^\s+\S/.test(lines[j + 1]) && !/^\s*-\s/.test(lines[j + 1])) {
    j += 1;
    v = `${v} ${lines[j].trim()}`;
  }
  return { value: v, index: j };
}

// Unwrap a quoted scalar the way YAML does: `''` is one apostrophe inside
// single quotes. Only the flat parser calls this; parseScalarToken (shared with
// the nested parser) is deliberately left as it was.
function unquoteSingle(v) {
  return v.slice(1, -1).replace(/''/g, "'");
}

// Split an inline array on top-level commas only — a quoted element may
// itself contain a comma ("phase=discover (…, non-interactive)").
function splitInlineArray(inner) {
  return (inner.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^,]+/g) || [])
    .map((x) => x.trim()).filter((x) => x !== '');
}

function serializeScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return JSON.stringify(v);
  if (v === '') return '""';
  if (/^[A-Za-z0-9._:/\-+@]+$/.test(v)) return v;
  return JSON.stringify(v);
}

function parseScalarToken(raw) {
  if (raw === '' || raw === undefined) return null;
  if (raw === 'null') return null;
  if (raw === '[]') return [];
  // Non-empty inline arrays. Only `[]` was handled until 2026-09-11, so
  // `[a, b]` came back as the STRING "[a, b]" — silently, since a string is a
  // plausible-looking value. Two measured consequences: docs/product/ROADMAP.md
  // failed `product validate` with "features[1].depends_on: must be an array"
  // for two months, and every retro's `issues:`/`finding_classes:` field was
  // unreadable as a list, which is why a1-evolve's clustering had to re-parse
  // them out of the raw text with a regex instead of using the parser.
  // Quoted items are unwrapped via the same scalar rules (recursion depth 1 —
  // nested inline arrays are not YAML we emit, so `[[a]]` stays a string).
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    if (inner.indexOf('[') === -1 && inner.indexOf(']') === -1) {
      return splitInlineArray(inner).map((x) => parseScalarToken(x));
    }
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?[0-9]+$/.test(raw)) return parseInt(raw, 10);
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    try {
      if (raw.startsWith('"')) return JSON.parse(raw);
      return raw.slice(1, -1);
    } catch (_e) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

module.exports = { joinFoldedScalar, unquoteSingle, splitInlineArray, serializeScalar, parseScalarToken };
