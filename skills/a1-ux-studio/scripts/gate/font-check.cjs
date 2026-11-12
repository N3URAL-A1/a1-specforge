'use strict';
// Font-license check for the ux-studio gate (spec 024, FR-009).
// Pure functions, Node core only. A target passes only when every named font
// family is on the allowlist and no font source is a remote URL.

const GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif',
  'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong',
  'inherit', 'initial', 'unset', 'revert', 'revert-layer',
]);
const NON_FAMILY_VAR = /size|weight|style|stretch|feature|variation|line|height|spacing|kerning|smooth/i;
const REMOTE = /^\s*(?:https?:)?\/\//i;
const SIZE_UNIT = '(?:px|rem|em|pt|pc|cm|mm|in|%|vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|ch|ex|cap|ic|lh|rlh)';
const SIZE_KEYWORDS = new Set(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', 'smaller', 'larger']);
const SIZE_FUNCTION_RE = /^(?:var|calc|clamp|min|max|env)\(/i;
const LENGTH_RE = new RegExp(`^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)${SIZE_UNIT}$`, 'i');
const MAX_FAILURES = 200;

const NAMED_ENTITIES = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', sol: '/', colon: ':' };
const MAX_CODEPOINT = 0x10ffff;

function safeFromCodePoint(n) {
  return Number.isInteger(n) && n > 0 && n <= MAX_CODEPOINT && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
}

/** Decode CSS escapes (`\2f `, `\/`) and HTML character references so escaped URLs and names cannot hide. */
function normalize(html) {
  const ents = html
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d{1,7});?/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (NAMED_ENTITIES[n.toLowerCase()] !== undefined ? NAMED_ENTITIES[n.toLowerCase()] : m));
  return ents.replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-f])/gi, (_, h, c) => (h ? safeFromCodePoint(parseInt(h, 16)) : c));
}

/** Split a CSS family list on commas outside quotes; returns unquoted names. */
function splitFamilies(list) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = null; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.replace(/!important/i, '').trim().replace(/\s+/g, ' ')).filter(Boolean);
}

function isNumericLike(v) {
  return new RegExp(`^[\\d.]+(?:${SIZE_UNIT})?$`, 'i').test(v.trim()) || /^(normal|bold|bolder|lighter|italic|oblique)$/i.test(v.trim());
}

/** Whitespace-separated tokens of a CSS value, spaces inside quotes and parentheses kept; each with its offsets. */
function tokenize(value) {
  const tokens = [];
  let start = -1;
  let depth = 0;
  let quote = null;
  for (let i = 0; i <= value.length; i += 1) {
    const ch = i < value.length ? value[i] : ' ';
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; if (start < 0) start = i; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')' && depth > 0) depth -= 1;
    const space = /\s/.test(ch) && depth === 0;
    if (space && start >= 0) { tokens.push({ text: value.slice(start, i), start, end: i }); start = -1; } else if (!space && start < 0) start = i;
  }
  return tokens;
}

/** Index of a `/` outside parentheses, or -1. */
function topLevelSlash(token) {
  let depth = 0;
  for (let i = 0; i < token.length; i += 1) {
    if (token[i] === '(') depth += 1;
    else if (token[i] === ')' && depth > 0) depth -= 1;
    else if (token[i] === '/' && depth === 0) return i;
  }
  return -1;
}

const isSizeToken = (t) => SIZE_KEYWORDS.has(t.toLowerCase()) || SIZE_FUNCTION_RE.test(t) || LENGTH_RE.test(t) || t === '0';

/**
 * The family list of a `font:` shorthand value: everything after the size (keyword, length, var()/calc()) and its optional
 * `/ line-height`. Style, variant, weight and stretch words before the size are skipped. null when the value names no size
 * (system font keywords such as `caption`, or a lone var()).
 */
function shorthandFamilies(value) {
  const toks = tokenize(value);
  const sizeOf = (t) => { const slash = topLevelSlash(t); return slash === -1 ? t : t.slice(0, slash); };
  for (let i = 0; i < toks.length; i += 1) {
    if (!isSizeToken(sizeOf(toks[i].text))) continue;
    // `font: var(--w) var(--s) Georgia`: a run of var()/calc() tokens is size-capable; the LAST one of the run is the size, the family follows it.
    while (SIZE_FUNCTION_RE.test(sizeOf(toks[i].text)) && topLevelSlash(toks[i].text) === -1 && toks[i + 1] && !toks[i + 1].text.startsWith('/') && isSizeToken(sizeOf(toks[i + 1].text))) i += 1;
    const t = toks[i].text;
    const slash = topLevelSlash(t);
    let next = i + 1;
    if (slash === t.length - 1) next += 1; // `16px/ 1.4`
    else if (slash === -1 && toks[next] && toks[next].text.startsWith('/')) next += toks[next].text === '/' ? 2 : 1; // `16px /1.4`, `16px / 1.4`
    return next < toks.length ? value.slice(toks[next].start) : null;
  }
  return null;
}

/** Every font-family value found in the document: declarations, shorthand, font-ish custom properties. */
function collectFamilyLists(html) {
  const lists = [];
  for (const m of html.matchAll(/font-family\s*:\s*((?:[^;}"<]|"[^"]*")+)/gi)) lists.push(m[1]);
  for (const m of html.matchAll(/(?:^|[;{\s"'])font\s*:\s*([^;}<]+)/gi)) {
    const families = shorthandFamilies(m[1]);
    if (families !== null) lists.push(families);
  }
  for (const m of html.matchAll(/\bfont-family\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) lists.push(m[1] ?? m[2]);
  for (const m of html.matchAll(/--([\w-]*font[\w-]*)\s*:\s*([^;}<]+)/gi)) {
    if (!NON_FAMILY_VAR.test(m[1]) && !isNumericLike(m[2])) lists.push(m[2]);
  }
  return lists;
}

/** Family names from a Google-Fonts-style URL (`family=Inter:wght@400&family=Lora`). */
function familiesFromUrl(url) {
  const names = [];
  for (const m of url.matchAll(/[?&]family=([^&]+)/gi)) {
    try {
      for (const part of decodeURIComponent(m[1].replace(/\+/g, ' ')).split('|')) names.push(part.split(':')[0].trim());
    } catch (_) {
      names.push(m[1]);
    }
  }
  return names.filter(Boolean);
}

/** Remote font sources: <link href>, @import, @font-face src url(). Returns {url, family|null}. */
function collectRemoteSources(html) {
  const found = [];
  for (const m of html.matchAll(/<link\b[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)/gi)) found.push({ url: m[1], family: null });
  for (const m of html.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) found.push({ url: m[1], family: null });
  for (const m of html.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const fam = /font-family\s*:\s*([^;}]+)/i.exec(m[1]);
    const family = fam ? splitFamilies(fam[1])[0] || null : null;
    for (const u of m[1].matchAll(/url\(\s*["']?([^"')]+)/gi)) found.push({ url: u[1], family });
  }
  return found.filter((f) => REMOTE.test(f.url));
}

function failureFor(font, reason, text) {
  return { font: String(font).slice(0, 200), reason, state: 'open', reason_text: text };
}

function remoteFailures(html) {
  const out = [];
  for (const { url, family } of collectRemoteSources(html)) {
    const names = family ? [family] : familiesFromUrl(url);
    const shown = url.length > 120 ? `${url.slice(0, 120)}...` : url;
    for (const font of names.length ? names : [shown]) {
      out.push(failureFor(font, 'remote_url', `font source loads from a remote URL (${shown}); self-host via @fontsource`));
    }
  }
  return out;
}

function allowlistFailures(html, allowlist) {
  const allowed = new Set(allowlist.families.map((f) => f.family.toLowerCase()));
  const out = [];
  for (const list of collectFamilyLists(html)) {
    for (const name of splitFamilies(list)) {
      const key = name.toLowerCase();
      if (GENERIC.has(key) || /^var\(|^env\(/.test(key) || allowed.has(key)) continue;
      out.push(failureFor(name, 'not_allowlisted', `family "${name}" is not in font-allowlist.json (OFL families only)`));
    }
  }
  return out;
}

const slugOf = (family) => String(family).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const LOCAL_SRC_RE = /\blocal\s*\(/i;
const FONT_PATH_RE = /(?:^|\/)fonts\/([^/]+)\/([^/]+)$/;

/** Every @font-face block as { family, css }. */
function fontFaces(html) {
  return [...html.matchAll(/@font-face\s*\{([^}]*)\}/gi)].map((m) => {
    const fam = /font-family\s*:\s*([^;}]+)/i.exec(m[1]);
    return { family: fam ? splitFamilies(fam[1])[0] || null : null, css: m[1] };
  });
}

/**
 * @font-face sources that cannot be licence-checked: `src: local(...)` loads a font from the visitor's machine, `url(data:...)` hides the file, and a file
 * outside fonts/<family-id>/ or one that does not start with the family id could be any font under an allowlisted name.
 */
function fontFaceFailures(html) {
  const out = [];
  for (const { family, css } of fontFaces(html)) {
    const name = family || 'unnamed @font-face';
    if (LOCAL_SRC_RE.test(css)) out.push(failureFor(name, 'local_src', `@font-face for "${name}" loads a local font (src: local()); only self-hosted files from font-allowlist.json are allowed`));
    const id = family ? slugOf(family) : '';
    for (const u of css.matchAll(/url\(\s*["']?([^"')]+)/gi)) {
      const url = u[1].trim();
      if (/^data:/i.test(url)) { out.push(failureFor(name, 'data_src', `@font-face for "${name}" embeds the font as a data: URI; the file cannot be licence-checked, ship it under fonts/${id || '<family-id>'}/`)); continue; }
      if (REMOTE.test(url) || url === '') continue;
      const m = FONT_PATH_RE.exec(url.split(/[?#]/)[0]);
      if (id !== '' && m && m[1] === id && m[2].toLowerCase().startsWith(id)) continue;
      out.push(failureFor(name, 'font_file_mismatch', `font file "${url.slice(0, 120)}" is not fonts/${id || '<family-id>'}/${id || '<family-id>'}*; ship each family under its own folder and name`));
    }
  }
  return out;
}

const SCRIPT_FONT_RE = /\bFontFace\b|document\s*\.\s*fonts\b|\bfonts\s*\.\s*(?:add|load)\s*\(/;

/** Fonts registered from script bypass every static check, so they fail outright. */
function scriptFailures(html) {
  if (!SCRIPT_FONT_RE.test(html)) return [];
  return [failureFor('FontFace (script)', 'not_allowlisted', 'script registers fonts at run time (FontFace / document.fonts); only static @font-face from font-allowlist.json is allowed')];
}

/** @returns {{status: 'pass'|'fail', failures: object[]}} */
function checkFonts(rawHtml, allowlist) {
  const html = normalize(rawHtml);
  const seen = new Set();
  const failures = [...remoteFailures(html), ...allowlistFailures(html, allowlist), ...fontFaceFailures(html), ...scriptFailures(html)].filter((f) => {
    const k = `${f.font}|${f.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX_FAILURES);
  return { status: failures.length === 0 ? 'pass' : 'fail', failures };
}

module.exports = { checkFonts, splitFamilies, collectFamilyLists };
