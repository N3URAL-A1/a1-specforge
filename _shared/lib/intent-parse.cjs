'use strict';

// ---------------------------------------------------------------------------
// intent-parse — the strict frontmatter parser of the intent note contract
// (spec 011, Wave 1; split out of intent-validate.cjs, which re-exports
// parseIntentFrontmatter unchanged). Pure: no filesystem, no clock.
//
// Why a parser of its own instead of io.parseFrontmatter: that parser skips a
// line it does not recognise and lets a repeated key overwrite the first. For
// an exact-key-set contract both are bypasses (a `foo-bar:` line or a second
// `project:` would pass unseen). parseIntentFrontmatter accepts exactly
//   key: <plain | "double-quoted" | 'single-quoted' scalar>
//   key: |   or   key: |-   followed by an indented block (contract D1: the
//                             payload is a YAML block scalar)
// plus blank lines, and refuses everything else.
//
// Line endings: CRLF is read as LF (a file saved on Windows or by an editor
// that writes CRLF validates like its LF twin; the signature covers the LF
// values). A lone CR is not a line break: it stays inside the line, where no
// key or scalar rule accepts it.
// ---------------------------------------------------------------------------

const KEY_LINE_RE = /^([a-z_][a-z0-9_]*):(?: (.*))?$/;
const PLAIN_INT_RE = /^(0|[1-9][0-9]*)$/;
// A plain scalar that YAML would read as something other than a string.
const PLAIN_UNSAFE_RE = /^[[\]{}&*!|>%@`#'",]|^[-?](?: |$)|: | #|:$/;

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '' || v === 'null' || v === '~') return { ok: true, value: null };
  if (v.startsWith('"')) {
    if (!v.endsWith('"') || v.length < 2) return { ok: false };
    try {
      return { ok: true, value: JSON.parse(v) };
    } catch (_e) {
      return { ok: false }; // not a JSON-compatible double-quoted scalar
    }
  }
  if (v.startsWith("'")) {
    const inner = v.slice(1, -1);
    if (!v.endsWith("'") || v.length < 2 || inner.replace(/''/g, '').includes("'")) return { ok: false };
    return { ok: true, value: inner.replace(/''/g, "'") };
  }
  if (PLAIN_INT_RE.test(v)) return { ok: true, value: Number(v) };
  if (v === 'true' || v === 'false') return { ok: true, value: v === 'true' };
  if (PLAIN_UNSAFE_RE.test(v)) return { ok: false };
  return { ok: true, value: v };
}

// Block scalar starting after line index `start`; returns the string and the
// index of the first line after the block.
function parseBlock(lines, start, chomp) {
  let end = start;
  while (end < lines.length && (lines[end] === '' || /^ /.test(lines[end]))) end += 1;
  const block = lines.slice(start, end);
  const first = block.find((l) => l.trim() !== '');
  const indent = first ? first.match(/^ */)[0].length : 0;
  const prefix = ' '.repeat(indent);
  if (first && block.some((l) => l.trim() !== '' && !l.startsWith(prefix))) return { ok: false };
  const body = block.map((l) => l.slice(indent));
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  const text = body.join('\n');
  return { ok: true, value: chomp === '|' && text !== '' ? `${text}\n` : text, next: end };
}

// -> { ok: true, fm, body } | { ok: false }. `fm` is a null-prototype object,
// so a key named `__proto__` or `constructor` is an ordinary (unknown) key.
function parseIntentFrontmatter(content) {
  const lines = String(content).replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return { ok: false };
  const close = lines.indexOf('---', 1);
  if (close === -1) return { ok: false };
  const fmLines = lines.slice(1, close);
  const fm = Object.create(null);
  let i = 0;
  while (i < fmLines.length) {
    if (fmLines[i].trim() === '') { i += 1; continue; }
    const m = fmLines[i].match(KEY_LINE_RE);
    if (!m || Object.prototype.hasOwnProperty.call(fm, m[1])) return { ok: false };
    const rest = m[2] === undefined ? '' : m[2];
    const parsed = rest === '|' || rest === '|-' ? parseBlock(fmLines, i + 1, rest) : parseScalar(rest);
    if (!parsed.ok) return { ok: false };
    fm[m[1]] = parsed.value;
    i = parsed.next === undefined ? i + 1 : parsed.next;
  }
  return { ok: true, fm, body: lines.slice(close + 1).join('\n') };
}

module.exports = { parseIntentFrontmatter };
