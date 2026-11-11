'use strict';
// Minimal board markup reader (spec 024, W4): finds data-a1-tile sections and their structure
// signature (the sequence of element tag names inside one tile). Node core only, no mutation of parsed data.

const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR_RE = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Comments (an unclosed one runs to the end, as in a browser), style and script bodies are not markup. */
function stripNonMarkup(html) {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(style|script)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
}

/** Attribute map, names lowercased, first occurrence wins (as in a browser). */
function parseAttrs(text) {
  const entries = [...text.matchAll(ATTR_RE)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']);
  return Object.freeze(entries.reduce((acc, [k, v]) => (Object.prototype.hasOwnProperty.call(acc, k) ? acc : { ...acc, [k]: v }), {}));
}

function tokenize(markup) {
  return [...markup.matchAll(TAG_RE)].map((m) => Object.freeze({
    close: m[1] === '/', name: m[2].toLowerCase(), attrs: m[1] === '/' ? Object.freeze({}) : parseAttrs(m[3]), selfClose: /\/\s*$/.test(m[3]),
  }));
}

const has = (attrs, key) => Object.prototype.hasOwnProperty.call(attrs, key);

/** @returns {{tiles: {attrs: object, signature: string, closed: boolean}[], stray: number}}
 *  stray = elements other than <section> that carry data-a1-tile (they would dodge the count);
 *  nested = data-a1-tile elements inside another tile (a browser counts them as extra tiles). */
function extractTiles(html) {
  const tiles = [];
  const names = [];
  let cur = null;
  let stray = 0;
  let nested = 0;
  for (const t of tokenize(stripNonMarkup(html))) {
    if (cur === null) {
      if (!t.close && has(t.attrs, 'data-a1-tile')) {
        if (t.name === 'section') { cur = { attrs: t.attrs, depth: 1 }; names.length = 0; } else { stray += 1; }
      }
      continue;
    }
    if (!t.close && has(t.attrs, 'data-a1-tile')) nested += 1;
    if (t.name === 'section') cur = { ...cur, depth: cur.depth + (t.close ? -1 : (t.selfClose ? 0 : 1)) };
    if (cur.depth === 0) { tiles.push(Object.freeze({ attrs: cur.attrs, signature: names.join(','), closed: true })); cur = null; continue; }
    if (!t.close) names.push(t.name);
  }
  if (cur !== null) tiles.push(Object.freeze({ attrs: cur.attrs, signature: names.join(','), closed: false }));
  return Object.freeze({ tiles: Object.freeze(tiles), stray, nested });
}

function findTile(html, optionId) {
  return extractTiles(html).tiles.find((t) => t.attrs['data-option-id'] === optionId) || null;
}

module.exports = Object.freeze({ extractTiles, findTile, stripNonMarkup });
