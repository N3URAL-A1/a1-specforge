'use strict';
// board-check (spec 024, FR-004/FR-005/FR-022 board rules, W4). Node core only.
// Exit 0 = board ok, 1 = problems (one per line on stderr), 2 = usage/hostile input.

const fs = require('fs');
const path = require('path');
const { clean } = require('./common.cjs');
const { requireBoard, resolveRunDir, readBoard, inside, isRegularFile } = require('./rundir.cjs');
const { extractTiles } = require('./tiles.cjs');
const { readPicks } = require('./picks.cjs');
const { checkFonts } = require('../gate/font-check.cjs');
const ALLOWLIST = require('../gate/font-allowlist.json');

const DIVERGE_TILES = 5;
const CONVERGE_TILES = 3;
const MAX_PROBLEMS = 20;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FONT_REF_RE = /^fonts\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.woff2$/;
const NAMED = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', sol: '/', colon: ':' };
const REMOTE_PATTERNS = Object.freeze([
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]{0,80}/i,
  /\b(?:src|href|poster|action|srcset|data)\s*=\s*["']?\s*\/\/[^\s"'<>)]{0,80}/i,
  /url\(\s*["']?\s*\/\/[^\s"'<>)]{0,80}/i,
  /@import\s+(?:url\(\s*)?["']?\s*\/\/[^\s"'<>)]{0,80}/i,
]);

const cp = (n) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�');

/** HTML character references and CSS escapes decoded, so an escaped URL cannot hide. */
function decode(text) {
  return text
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d{1,7});?/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] !== undefined ? NAMED[n.toLowerCase()] : m))
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-f])/gi, (_, h, c) => (h ? cp(parseInt(h, 16)) : c));
}

const shorten = (s) => String(s).replace(/\s+/g, ' ').slice(0, 80);

/** Remote-resource scan over the whole file, comments included: a board never names a remote resource. */
function remoteProblems(html) {
  const text = decode(html);
  return REMOTE_PATTERNS.map((re) => re.exec(text)).filter(Boolean).map((m) => `remote resource reference: ${shorten(m[0])}`);
}

function fontFileProblem(boardsDir, ref) {
  if (/^data:/i.test(ref) || ref.startsWith('#')) return null;
  if (!FONT_REF_RE.test(ref)) return `font reference outside boards/fonts/: ${shorten(ref)}`;
  const file = path.join(boardsDir, ref);
  if (!isRegularFile(file)) return `font file missing: ${ref}`;
  let real;
  let fontsReal;
  try { real = fs.realpathSync(file); fontsReal = fs.realpathSync(path.join(boardsDir, 'fonts')); } catch (e) { return `font file unreadable: ${ref}`; }
  return inside(fontsReal, real) ? null : `font file resolves outside boards/fonts/: ${ref}`;
}

// Comments are dropped (a commented-out face loads nothing); <style> bodies are kept because
// that is where every @font-face src lives.
const stripComments = (html) => html.replace(/<!--[\s\S]*?(?:-->|$)/g, '');

function fontProblems(html, boardsDir) {
  const css = decode(stripComments(html));
  const refs = [...new Set([...css.matchAll(/url\(\s*["']?([^"')]*)/gi)].map((m) => m[1].trim()))];
  const files = refs.map((r) => fontFileProblem(boardsDir, r)).filter(Boolean);
  const check = checkFonts(html, ALLOWLIST);
  const fonts = check.failures.map((f) => `font check: ${shorten(f.font)} (${f.reason})`);
  return [...files, ...fonts];
}

const attr = (tile, key) => tile.attrs[key] || '';
const dups = (xs) => xs.filter((x, i) => xs.indexOf(x) !== i);

function commonTileProblems(tiles) {
  const ids = tiles.map((t) => attr(t, 'data-option-id'));
  const bad = ids.filter((id) => !ID_RE.test(id));
  return [
    ...(bad.length ? [`${bad.length} tile(s) without a valid data-option-id`] : []),
    ...(dups(ids).length ? ['duplicate data-option-id values'] : []),
    ...(tiles.some((t) => !t.closed) ? ['a tile section is not closed'] : []),
    ...(tiles.some((t) => !ID_RE.test(attr(t, 'data-family'))) ? ['a tile has no valid data-family'] : []),
  ];
}

function divergeProblems(tiles) {
  const v0 = tiles.filter((t) => 'data-variant0' in t.attrs);
  const base = tiles.filter((t) => !('data-variant0' in t.attrs));
  const fams = base.map((t) => attr(t, 'data-family'));
  return [
    ...(base.length === DIVERGE_TILES ? [] : [`diverge board needs exactly ${DIVERGE_TILES} tiles besides data-variant0 (found ${base.length})`]),
    ...(v0.length > 1 ? [`at most one data-variant0 tile (found ${v0.length})`] : []),
    ...(dups(fams).length ? ['the diverge tiles must show different families'] : []),
  ];
}

function convergeProblems(tiles, pickedFamily) {
  const fams = new Set(tiles.map((t) => attr(t, 'data-family')));
  const layouts = tiles.map((t) => attr(t, 'data-layout'));
  const sigs = tiles.map((t) => t.signature);
  return [
    ...(tiles.length === CONVERGE_TILES ? [] : [`converge board needs exactly ${CONVERGE_TILES} tiles (found ${tiles.length})`]),
    ...(fams.size > 1 ? ['converge tiles must all use one family'] : []),
    ...(pickedFamily && fams.size === 1 && !fams.has(pickedFamily) ? [`converge tiles must use the picked family "${pickedFamily}"`] : []),
    ...(layouts.some((l) => !ID_RE.test(l)) || dups(layouts).length ? ['converge tiles need 3 distinct valid data-layout values'] : []),
    ...(dups(sigs).length ? ['converge tiles must differ in element structure, not only in colour or text'] : []),
  ];
}

/** @returns {string[]} problems; empty when the board is ok. Pure apart from reading font files. */
function checkBoard(kind, html, boardsDir, pickedFamily) {
  const { tiles, stray, nested } = extractTiles(html);
  const kindProblems = kind === 'diverge' ? divergeProblems(tiles) : convergeProblems(tiles, pickedFamily);
  return [
    ...(stray > 0 ? [`data-a1-tile on ${stray} element(s) that are not <section>`] : []),
    ...(nested > 0 ? [`data-a1-tile on ${nested} element(s) nested inside another tile`] : []),
    ...commonTileProblems(tiles), ...kindProblems, ...remoteProblems(html), ...fontProblems(html, boardsDir),
  ].slice(0, MAX_PROBLEMS);
}

function boardCheck(args) {
  const kind = requireBoard('--kind', args.kind);
  const runDir = resolveRunDir(args['run-dir']);
  const { html, boardsDir } = readBoard(runDir, kind);
  const picked = kind === 'converge' ? readPicks(runDir).diverge : null;
  const problems = checkBoard(kind, html, boardsDir, picked && picked.family);
  if (problems.length === 0) { process.stdout.write(`board-check ${kind}: ok\n`); return 0; }
  process.stderr.write(`board-check ${kind} failed:\n${problems.map((p) => `- ${clean(p)}`).join('\n')}\n`);
  return 1;
}

module.exports = Object.freeze({ boardCheck, checkBoard });
