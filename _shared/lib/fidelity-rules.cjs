'use strict';

// ---------------------------------------------------------------------------
// fidelity-rules — spec 017 FR-020 (mock-of-subject), FR-022 (skipped-test),
// FR-023 (early-return-guard). Every rule works on the MASKED source from
// fidelity-tokenizer (strings and comments blanked), so text inside a string
// or comment never matches (FR-024). All scans are linear or bounded-regex.
// A slot for the repo-level rule `test-not-in-ci` (wave 7) sits at the end.
// ---------------------------------------------------------------------------

const { isWordChar } = require('./fidelity-tokenizer.cjs');
const { subjectFiles } = require('./fidelity-resolve.cjs');

const DEFAULT_DB_WRAPPERS = ['withTenantContext', 'pool', 'db', 'query'];
const MAX_SCAN_SPAN = 200000;

const MOCK_CALL_RE = /\b(vi|jest)[ \t\r\n]{0,64}\.[ \t\r\n]{0,64}(mock|doMock|spyOn)[ \t\r\n]{0,64}\(/g;
const TEST_CALL_RE = /\b(?:it|test)((?:[ \t\r\n]{0,64}\.[ \t\r\n]{0,64}[A-Za-z]{1,16}){0,3})[ \t\r\n]{0,64}\(/g;
const IMPORT_RE = /\bimport\b[^;'"`]{0,300}?\bfrom[ \t\r\n]{0,64}['"]/g;
const SKIP_PATTERNS = [
  /\.[ \t\r\n]{0,16}skip(?:If)?\b/g,
  /\b(?:xit|xdescribe|xtest)\b/g,
  /\bpytest[ \t]{0,8}\.[ \t]{0,8}mark[ \t]{0,8}\.[ \t]{0,8}skip(?:if)?\b/g,
  /\bpytest[ \t]{0,8}\.[ \t]{0,8}skip[ \t]{0,8}\(/g,
  /@unittest\.skip/g,
];
const PY_DEF_RE = /^[ \t]{0,64}(?:async[ \t]+)?def[ \t]+test\w{0,100}[ \t]{0,8}\(/gm;
const PY_GUARD_ONE_LINE = /^if[ \t]+not\b[^:\n]{0,500}:[ \t]*return\b/;
const PY_GUARD_HEAD = /^if[ \t]+not\b[^:\n]{0,500}:[ \t]*$/;

// ---------- scanning helpers ----------

function skipWs(code, i) {
  let j = i;
  while (j < code.length && (code[j] === ' ' || code[j] === '\t' || code[j] === '\n' || code[j] === '\r')) j++;
  return j;
}

/** Index of the closer matching the bracket at `open` in masked code, or -1 (limit: MAX_SCAN_SPAN). */
function matchBracket(code, open) {
  let depth = 0;
  const limit = Math.min(code.length, open + MAX_SCAN_SPAN);
  for (let i = open; i < limit; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the `)` matching the `(` at `open`, or -1. */
function matchParen(code, open) {
  const close = matchBracket(code, open);
  return close >= 0 && code[close] === ')' ? close : -1;
}

/** Offsets where each depth-1 argument of the call starting at `open` begins. */
function argStarts(code, open, close) {
  const starts = [skipWs(code, open + 1)];
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) starts.push(skipWs(code, i + 1));
  }
  return starts;
}

/** Keys of the depth-1 object literal opened at `open` ('{'): identifiers and quoted keys. */
function objectKeys(code, strings, open) {
  const keys = [];
  let depth = 0;
  let prev = '';
  const limit = Math.min(code.length, open + MAX_SCAN_SPAN);
  for (let i = open; i < limit; i++) {
    const c = code[i];
    if (c === '{' || c === '(' || c === '[') { depth++; prev = c; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0) break; prev = c; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
    if (depth === 1 && (prev === '{' || prev === ',')) {
      const key = readKey(code, strings, i);
      if (key !== null) { keys.push(key.name); i = key.end - 1; prev = 'k'; continue; }
    }
    prev = c;
  }
  return keys;
}

function readKey(code, strings, i) {
  const c = code[i];
  let name = null;
  let end = i + 1;
  if (c === '"' || c === "'") {
    const v = strings.get(i);
    const close = code.indexOf(c, i + 1);
    if (typeof v === 'string' && close > 0) { name = v; end = close + 1; }
  } else if (isWordChar(c)) {
    while (end < code.length && isWordChar(code[end])) end++;
    name = code.slice(i, end);
  }
  if (name === null) return null;
  const next = code[skipWs(code, end)];
  return next === ':' || next === ',' || next === '}' || next === '(' ? { name, end } : null;
}

/** Factory object literals in a mock call: `=> ({`, `=> {`, `return {`, `return ({`. */
function factoryObjects(code, from, to) {
  const opens = [];
  const text = code.slice(from, to);
  const re = /(=>|\breturn\b)[ \t\r\n(]{0,64}\{/g;
  let m;
  let insideUntil = -1;
  while ((m = re.exec(text)) !== null) {
    const open = from + m.index + m[0].length - 1;
    if (open < insideUntil) continue; // nested factory (an inner arrow): not the returned module object
    opens.push(open);
    insideUntil = matchBracket(code, open);
  }
  return opens;
}

// ---------- rule: mock-of-subject ----------

function importBindings(code, strings) {
  const map = new Map();
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(code)) !== null) {
    const spec = strings.get(m.index + m[0].length - 1);
    if (typeof spec !== 'string') continue;
    const clause = m[0].slice(6, m[0].lastIndexOf('from'));
    const ns = /\*[ \t\r\n]{0,16}as[ \t\r\n]{1,16}([A-Za-z_$][\w$]{0,100})/.exec(clause);
    const def = /^[ \t\r\n]{0,16}([A-Za-z_$][\w$]{0,100})[ \t\r\n]{0,16}(?:,|$)/.exec(clause);
    if (ns) map.set(ns[1], spec);
    else if (def) map.set(def[1], spec);
  }
  return map;
}

function mockCallInfo(code, strings, m, bindings) {
  const open = m.index + m[0].length - 1;
  const close = matchParen(code, open);
  if (close < 0) return null;
  const args = argStarts(code, open, close);
  const kind = m[2];
  if (kind === 'spyOn') {
    const method = strings.get(args[1]);
    const objName = /^[A-Za-z_$][\w$]*/.exec(code.slice(args[0], args[0] + 120));
    const spec = objName ? bindings.get(objName[0]) : undefined;
    return { open, close, spec: typeof spec === 'string' ? spec : null, keys: typeof method === 'string' ? [method] : [] };
  }
  const spec = strings.get(args[0]);
  const keys = factoryObjects(code, args[0], close).flatMap((o) => objectKeys(code, strings, o));
  return { open, close, spec: typeof spec === 'string' ? spec : null, keys };
}

/**
 * @param {object} t {rel, code, strings, starts, lineOf}
 * @param {object} ctx {changedSources:Set<string>, dbWrappers:string[], ...resolver ctx}
 */
function mockOfSubject(t, ctx) {
  const findings = [];
  const bindings = importBindings(t.code, t.strings);
  MOCK_CALL_RE.lastIndex = 0;
  let m;
  while ((m = MOCK_CALL_RE.exec(t.code)) !== null) {
    const info = mockCallInfo(t.code, t.strings, m, bindings);
    if (info === null) continue;
    const reasons = [];
    const targets = info.spec === null ? [] : subjectFiles(ctx, t.rel, info.spec);
    const hit = targets.find((f) => ctx.changedSources.has(f));
    if (hit !== undefined) reasons.push({ reason: 'changed-subject', subject: hit });
    const wrapper = info.keys.find((k) => ctx.dbWrappers.includes(k));
    if (wrapper !== undefined) reasons.push({ reason: 'db-wrapper', wrapper });
    if (reasons.length > 0) {
      findings.push({ rule: 'mock-of-subject', file: t.rel, line: t.lineOf(m.index), call: `${m[1]}.${m[2]}`, specifier: info.spec, reasons });
    }
  }
  return findings;
}

// ---------- rule: skipped-test ----------

function skippedTest(t) {
  const findings = [];
  const seen = new Set();
  for (const re of SKIP_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t.code)) !== null) {
      const line = t.lineOf(m.index);
      if (seen.has(line)) continue; // `pytest.mark.skip` matches two patterns: one finding per line
      seen.add(line);
      findings.push({ rule: 'skipped-test', file: t.rel, line, match: m[0].replace(/\s+/g, '') });
    }
  }
  return findings;
}

// ---------- rule: early-return-guard ----------

/** Position of the `{` that opens the callback body inside a test call, or -1. */
function callbackBody(code, open, close) {
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '=' && code[i + 1] === '>') {
      const j = skipWs(code, i + 2);
      return code[j] === '{' ? j : -1;
    } else if (depth === 0 && code.startsWith('function', i) && !isWordChar(code[i - 1] || ' ')) {
      const p = code.indexOf('(', i);
      const pc = p < 0 ? -1 : matchParen(code, p);
      const j = pc < 0 ? -1 : skipWs(code, pc + 1);
      return j >= 0 && code[j] === '{' ? j : -1;
    }
  }
  return -1;
}

function jsLeadingGuard(code, body) {
  let i = skipWs(code, body + 1);
  if (!code.startsWith('if', i) || isWordChar(code[i + 2] || ' ')) return -1;
  const start = i;
  i = skipWs(code, i + 2);
  if (code[i] !== '(') return -1;
  const close = matchParen(code, i);
  if (close < 0) return -1;
  const cond = code.slice(i + 1, close).trim();
  if (cond[0] !== '!' || cond[1] === '=') return -1;
  let j = skipWs(code, close + 1);
  if (code[j] === '{') j = skipWs(code, j + 1);
  return code.startsWith('return', j) && !isWordChar(code[j + 6] || ' ') ? start : -1;
}

function eachCallOpen(code, open, close, suffix) {
  if (!/\beach\b/.test(suffix)) return { open, close };
  const next = skipWs(code, close + 1);
  if (code[next] !== '(') return { open, close };
  const c2 = matchParen(code, next);
  return c2 < 0 ? { open, close } : { open: next, close: c2 };
}

function jsEarlyReturn(t) {
  const findings = [];
  TEST_CALL_RE.lastIndex = 0;
  let m;
  while ((m = TEST_CALL_RE.exec(t.code)) !== null) {
    const open0 = m.index + m[0].length - 1;
    const close0 = matchParen(t.code, open0);
    if (close0 < 0) continue;
    const { open, close } = eachCallOpen(t.code, open0, close0, m[1] || '');
    const body = callbackBody(t.code, open, close);
    if (body < 0) continue;
    const at = jsLeadingGuard(t.code, body);
    if (at >= 0) findings.push({ rule: 'early-return-guard', file: t.rel, line: t.lineOf(at) });
  }
  return findings;
}

function pyBodyStart(code, open) {
  const close = matchParen(code, open);
  if (close < 0) return -1;
  const colon = code.indexOf(':', close);
  return colon < 0 ? -1 : colon + 1;
}

/** Non-blank statement lines after `from` (docstring remnants — only quotes — skipped). */
function pyNextLines(code, from, max) {
  const lines = [];
  let i = from;
  while (i < code.length && lines.length < max) {
    const e = code.indexOf('\n', i);
    const end = e < 0 ? code.length : e;
    const text = code.slice(i, end);
    if (text.replace(/["'\s]/g, '') !== '') lines.push({ text: text.trim(), offset: i + (text.length - text.trimStart().length) });
    i = end + 1;
  }
  return lines;
}

function pyEarlyReturn(t) {
  const findings = [];
  PY_DEF_RE.lastIndex = 0;
  let m;
  while ((m = PY_DEF_RE.exec(t.code)) !== null) {
    const start = pyBodyStart(t.code, m.index + m[0].length - 1);
    if (start < 0) continue;
    const lines = pyNextLines(t.code, start, 2);
    const first = lines[0];
    if (first === undefined) continue;
    const guarded = PY_GUARD_ONE_LINE.test(first.text)
      || (PY_GUARD_HEAD.test(first.text) && lines[1] !== undefined && /^return\b/.test(lines[1].text))
      || /^pytest\s*\.\s*skip\s*\(/.test(first.text);
    if (guarded) findings.push({ rule: 'early-return-guard', file: t.rel, line: t.lineOf(first.offset) });
  }
  return findings;
}

function earlyReturnGuard(t) {
  return t.lang === 'py' ? pyEarlyReturn(t) : jsEarlyReturn(t);
}

// ---------- registry ----------

/** Per-file rules, run on every touched test file. */
const FILE_RULES = [mockOfSubject, skippedTest, earlyReturnGuard];

/** Repo-level rules (slot for `test-not-in-ci`, spec 017 wave 7). Each takes ctx and returns findings. */
const REPO_RULES = [];

module.exports = { FILE_RULES, REPO_RULES, DEFAULT_DB_WRAPPERS, matchParen, argStarts, objectKeys };
