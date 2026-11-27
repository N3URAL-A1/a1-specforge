#!/usr/bin/env node
// Fails when a tracked instruction or config text file holds an invisible or bidi control character:
// such a character can hide an instruction from the human reader. Idea: affaan-m/ECC check-unicode-safety (MIT).
// Usage: node bin/check-unicode-safety.cjs [--self-test]    exit 0 clean, 1 hits, 2 usage or read error
// Scans the files git tracks; without git data it scans every file under the repo root.
// This file is pure ASCII on purpose: every code point is a number, so the list stays reviewable.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Scanned formats: the ones that carry instructions and configuration. Code files are out of scope (three lib
// files hold such characters as literal regex classes).
const TEXT_EXT_RE = /\.(md|json|ya?ml|txt)$/i;
// [first, last] code point, inclusive. U+2028/2029 are left out: a fixture corpus holds them on purpose.
// ZWJ (U+200D) and a leading BOM (U+FEFF) are hits on purpose: strict, and the tree holds none.
const BAD_RANGES = [
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // combining grapheme joiner
  [0x061c, 0x061c], // Arabic letter mark
  [0x115f, 0x1160], // Hangul fillers
  [0x17b4, 0x17b5], // Khmer invisible vowels
  [0x180b, 0x180f], // Mongolian selectors and vowel separator
  [0x200b, 0x200f], // zero width and direction marks
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x2064], // word joiner, invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0d], // variation selectors 1-14 (15 and 16 are judged below)
  [0xfeff, 0xfeff], // BOM / zero width no-break space
  [0xffa0, 0xffa0], // halfwidth Hangul filler
  [0xfff9, 0xfffb], // interlinear annotation
  [0x1d173, 0x1d17a], // musical format controls
  [0xe0000, 0xe007f], // tag characters
  [0xe0100, 0xe01ef], // variation selectors supplement
];
const isSelector = (cp) => cp >= 0xfe00 && cp <= 0xfe0f;
const isBad = (cp) => BAD_RANGES.some(([a, b]) => cp >= a && cp <= b);

/** First offending code point of a line, or -1. A single U+FE0E/FE0F (text or emoji style) is legitimate;
 *  two selectors in a row are the smuggling form. */
function firstBad(line) {
  let prev = -1;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    if (isBad(cp) || (isSelector(cp) && isSelector(prev))) return cp;
    prev = cp;
  }
  return -1;
}

const label = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/** Returns { hits, errors, scanned }. Symlinks, non-regular files and tracked-but-deleted files are skipped. */
function scan(root, files) {
  const hits = [];
  const errors = [];
  let scanned = 0;
  for (const file of files.filter((f) => TEXT_EXT_RE.test(f))) {
    const abs = path.join(root, file);
    let text;
    try {
      if (!fs.lstatSync(abs).isFile()) continue;
      text = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') errors.push(`${file}: ${e.code || e.message}`);
      continue;
    }
    scanned += 1;
    text.split('\n').forEach((line, i) => {
      const cp = firstBad(line);
      if (cp !== -1) hits.push(`${file}:${i + 1}: ${label(cp)}`);
    });
  }
  return { hits, errors, scanned };
}

/** Every file under root, relative paths; `.git` and `node_modules` are left out. Symlinks are not followed. */
function walk(root, rel) {
  const out = [];
  for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) { if (ent.name !== '.git' && ent.name !== 'node_modules') out.push(...walk(root, child)); }
    else out.push(child);
  }
  return out;
}

// Independent of BAD_RANGES on purpose: dropping a range above turns the self-test red.
const SELF_TEST_BAD = [0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x180b, 0x180e, 0x200b, 0x200d, 0x200f,
  0x202a, 0x202e, 0x2060, 0x2064, 0x2066, 0x2069, 0x3164, 0xfe00, 0xfe0d, 0xfeff, 0xffa0, 0xfff9, 0xfffb,
  0x1d173, 0xe0001, 0xe0041, 0xe007f, 0xe0100, 0xe01ef];

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-unicode-'));
  const cp = String.fromCodePoint;
  try {
    // umlauts, check mark, warning sign with one U+FE0F, heart with U+FE0E: all legitimate
    fs.writeFileSync(path.join(dir, 'clean.md'), `plain\n${cp(0xe4, 0xf6, 0xfc)} ${cp(0x2705)} ${cp(0x26a0, 0xfe0f)} ${cp(0x2764, 0xfe0e)}\r\n`);
    fs.writeFileSync(path.join(dir, 'bad.md'), SELF_TEST_BAD.map((c) => `a${cp(c)}b`).join('\n') + `\nx${cp(0x26a0, 0xfe0f, 0xfe0f)}y\n`);
    fs.writeFileSync(path.join(dir, 'skip.bin'), `not a text format${cp(0x200b)}\n`);
    fs.symlinkSync(dir, path.join(dir, 'link.md'));
    const got = scan(dir, ['clean.md', 'bad.md', 'skip.bin', 'link.md', 'deleted.md']);
    const want = SELF_TEST_BAD.map((c, i) => `bad.md:${i + 1}: ${label(c)}`).concat(`bad.md:${SELF_TEST_BAD.length + 1}: U+FE0F`);
    const same = JSON.stringify(got.hits) === JSON.stringify(want) && got.errors.length === 0 && got.scanned === 2;
    if (!same) { console.error(`self-test FAILED:\n got  ${JSON.stringify(got)}\n want ${JSON.stringify(want)}`); return 1; }
    console.log(`self-test ok (${want.length} planted characters found, clean file and skipped files silent)`);
    return 0;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function main(argv) {
  if (argv.length === 1 && argv[0] === '--self-test') return selfTest();
  if (argv.length) { console.error('usage: check-unicode-safety.cjs [--self-test]'); return 2; }
  const root = path.resolve(__dirname, '..');
  let files;
  try {
    files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch (e) { files = walk(root, ''); } // no git data (release tarball, `git archive` snapshot): scan the folder itself
  const { hits, errors, scanned } = scan(root, files);
  hits.forEach((h) => console.error(h));
  errors.forEach((e) => console.error(`cannot read ${e}`));
  console.log(`unicode-safety: ${hits.length} hit(s) in ${scanned} text files`);
  if (errors.length) return 2;
  return hits.length ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
