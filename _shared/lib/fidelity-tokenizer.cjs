'use strict';

// ---------------------------------------------------------------------------
// fidelity-tokenizer — spec 017 FR-024. One linear pass over a JS/TS or Python
// source. Returns a MASKED copy: comments are blanked entirely, string and
// regex literal contents are blanked (quote characters stay), template literal
// text is blanked while `${ ... }` expressions stay code. Newlines are kept, so
// every offset and line number of the masked text equals the original.
// Also returns the raw value of every simple string literal, keyed by the
// offset of its opening quote (rules read `vi.mock('./x')` specifiers there).
// No regex runs over the input; nesting uses an explicit stack (no recursion),
// so hostile input cannot blow the call stack or backtrack.
// ---------------------------------------------------------------------------

const MAX_STRING_VALUE = 4096;
const MAX_NESTING = 5000;

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);
const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

function isWordChar(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '$';
}

function makeBlanker(out) {
  return function blank(from, to) {
    for (let k = from; k < to; k++) {
      const ch = out[k];
      if (ch !== '\n' && ch !== '\r') out[k] = ' ';
    }
  };
}

function valueOf(src, from, to) {
  return to - from > MAX_STRING_VALUE ? null : src.slice(from, to);
}

/** Scan a quoted string starting at `i` (the opening quote). Returns the index after the close. */
function scanQuoted(src, i, triple, out, blank, strings) {
  const q = src[i];
  const open = triple ? 3 : 1;
  const n = src.length;
  let j = i + open;
  while (j < n) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (triple) {
      if (c === q && src[j + 1] === q && src[j + 2] === q) break;
    } else if (c === q) {
      break;
    } else if (c === '\n') {
      break; // unterminated single-line string: stop at the line end
    }
    j++;
  }
  const end = Math.min(j, n);
  blank(i + open, end);
  if (src[end] === q) {
    strings.set(i, valueOf(src, i + open, end));
    return end + (triple ? 3 : 1);
  }
  return end; // unterminated: no value recorded
}

/** Scan a regex literal body starting after `/`. Returns the index after flags, or -1 if not a regex. */
function scanRegex(src, i) {
  const n = src.length;
  let j = i + 1;
  let inClass = false;
  while (j < n) {
    const c = src[j];
    if (c === '\n' || c === '\r') return -1;
    if (c === '\\') { j += 2; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      j++;
      while (j < n && isWordChar(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

function regexAllowed(prevSig, prevWord) {
  if (prevSig === 'a') return REGEX_KEYWORDS.has(prevWord);
  return REGEX_PRECEDERS.has(prevSig);
}

function tooDeep() {
  throw new Error('source nesting too deep');
}

/** Tokenize JS/TS (also JSON-ish). */
function maskJs(src) {
  const n = src.length;
  const out = src.split('');
  const blank = makeBlanker(out);
  const strings = new Map();
  const stack = []; // entries: {type:'tpl', start, hadExpr} | {type:'expr', depth}
  let prevSig = '';
  let prevWord = '';
  let i = 0;
  while (i < n) {
    const top = stack.length > 0 ? stack[stack.length - 1] : null;
    const c = src[i];
    if (top !== null && top.type === 'tpl') {
      if (c === '\\') { blank(i, Math.min(i + 2, n)); i += 2; continue; }
      if (c === '`') {
        stack.pop();
        if (!top.hadExpr) strings.set(top.start, valueOf(src, top.start + 1, i));
        prevSig = '`'; i++; continue;
      }
      if (c === '$' && src[i + 1] === '{') {
        top.hadExpr = true;
        if (stack.length >= MAX_NESTING) tooDeep();
        stack.push({ type: 'expr', depth: 0 });
        prevSig = '{'; i += 2; continue;
      }
      blank(i, i + 1); i++; continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      blank(i, end); i = end; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      blank(i, end); i = end; continue;
    }
    if (c === '"' || c === "'") {
      i = scanQuoted(src, i, false, out, blank, strings); prevSig = '"'; continue;
    }
    if (c === '`') {
      if (stack.length >= MAX_NESTING) tooDeep();
      stack.push({ type: 'tpl', start: i, hadExpr: false }); i++; continue;
    }
    if (c === '/' && regexAllowed(prevSig, prevWord)) {
      const end = scanRegex(src, i);
      if (end > 0) { blank(i, end); prevSig = ')'; i = end; continue; }
    }
    if (isWordChar(c)) {
      let j = i + 1;
      while (j < n && isWordChar(src[j])) j++;
      prevWord = src.slice(i, j); prevSig = 'a'; i = j; continue;
    }
    if (c === '{' && top !== null) top.depth++;
    else if (c === '}' && top !== null) {
      if (top.depth === 0) { stack.pop(); prevSig = '`'; i++; continue; }
      top.depth--;
    }
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') prevSig = c;
    i++;
  }
  return { code: out.join(''), strings };
}

/** Tokenize Python: `#` comments, quotes, triple quotes (prefixes are plain word characters). */
function maskPy(src) {
  const n = src.length;
  const out = src.split('');
  const blank = makeBlanker(out);
  const strings = new Map();
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '#') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      blank(i, end); i = end; continue;
    }
    if (c === '"' || c === "'") {
      const triple = src[i + 1] === c && src[i + 2] === c;
      i = scanQuoted(src, i, triple, out, blank, strings); continue;
    }
    i++;
  }
  return { code: out.join(''), strings };
}

/** @param {string} src @param {'js'|'py'} lang */
function mask(src, lang) {
  return lang === 'py' ? maskPy(src) : maskJs(src);
}

/** Sorted offsets of every newline, for line lookups. */
function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}

/** 1-based line of `offset` (binary search). */
function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

module.exports = { mask, lineIndex, lineOf, isWordChar };
