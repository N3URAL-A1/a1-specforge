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
const SIZE_UNIT = '(?:px|rem|em|pt|%|vw|vh|ch|ex)';
const MAX_FAILURES = 200;

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

/** Every font-family value found in the document: declarations, shorthand, font-ish custom properties. */
function collectFamilyLists(html) {
  const lists = [];
  for (const m of html.matchAll(/font-family\s*:\s*((?:[^;}"<]|"[^"]*")+)/gi)) lists.push(m[1]);
  const shorthand = new RegExp(`(?:^|[;{\\s"'])font\\s*:\\s*[^;}]*?\\d(?:[\\d.]*)${SIZE_UNIT}?(?:\\s*\\/\\s*[^\\s;}]+)?\\s+([^;}<]+)`, 'gi');
  for (const m of html.matchAll(shorthand)) lists.push(m[1]);
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

/** @returns {{status: 'pass'|'fail', failures: object[]}} */
function checkFonts(html, allowlist) {
  const seen = new Set();
  const failures = [...remoteFailures(html), ...allowlistFailures(html, allowlist)].filter((f) => {
    const k = `${f.font}|${f.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX_FAILURES);
  return { status: failures.length === 0 ? 'pass' : 'fail', failures };
}

module.exports = { checkFonts, splitFamilies, collectFamilyLists };
