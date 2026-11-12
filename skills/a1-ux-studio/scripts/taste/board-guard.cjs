'use strict';
// board-check rule for the taste vault (spec 024, FR-024, W8): a board never references a pattern/taste-vault path,
// because vault screenshots are internal reference only. Wraps the W4 board-check: a hit fails the board before the W4 checks run.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireBoard, resolveRunDir, isRegularFile } = require('../run/rundir.cjs');

const MAX_BOARD_BYTES = 5 * 1024 * 1024;
const VAULT_PATH_RE = /pattern\s*\/+\s*taste-vault/i;

/** Board text with HTML character references, CSS escapes, percent escapes and backslashes normalised. */
function normalise(html) {
  const cp = (n) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ');
  let t = html
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d{1,7});?/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&sol;/gi, '/')
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, (_, h) => cp(parseInt(h, 16)));
  t = t.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return t.replace(/\\/g, '/');
}

const referencesTasteVault = (html) => VAULT_PATH_RE.test(html) || VAULT_PATH_RE.test(normalise(html));

const MAX_WALK_FILES = 5000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DATA_IMAGE_RE = /data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]{16,})/gi;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Regular files below `dir` (no symlink followed, bounded), as absolute paths. */
function walkFiles(dir) {
  const out = [];
  const todo = [dir];
  while (todo.length > 0 && out.length < MAX_WALK_FILES) {
    const cur = todo.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (_e) { entries = []; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) todo.push(full); else if (e.isFile()) out.push(full);
    }
  }
  return out;
}

/** sha256 of every PNG below <vaultRoot>/pattern/taste-vault; an empty set when the vault is not there. */
function vaultPngShas(vaultRoot) {
  const dir = path.join(String(vaultRoot || ''), 'pattern', 'taste-vault');
  if (!vaultRoot || !fs.existsSync(dir)) return new Set();
  return new Set(walkFiles(dir).filter((f) => /\.png$/i.test(f) && fs.statSync(f).size <= MAX_IMAGE_BYTES).map((f) => sha256(fs.readFileSync(f))));
}

/**
 * Problems for a result page (FR-024, PR review): the path text rule of the boards, plus - when the vault is present -
 * a sha256 match of every non-HTML file under result/ and of every data: image in the page against the vault PNGs.
 * @returns {string[]} one reason each; empty when the result is clean.
 */
function resultTasteVaultProblems(resultDir, html, vaultRoot) {
  const out = referencesTasteVault(html) ? ['result page names a pattern/taste-vault path (vault screenshots are internal reference only)'] : [];
  const shas = vaultPngShas(vaultRoot);
  if (shas.size === 0) return out;
  const files = walkFiles(resultDir).filter((f) => !/\.html?$/i.test(f) && fs.statSync(f).size <= MAX_IMAGE_BYTES);
  for (const f of files) {
    if (shas.has(sha256(fs.readFileSync(f)))) out.push(`result/${path.relative(resultDir, f).split(path.sep).join('/').slice(0, 120)} is a byte copy of a taste-vault image`);
  }
  for (const m of html.matchAll(DATA_IMAGE_RE)) {
    if (shas.has(sha256(Buffer.from(m[1].replace(/\s+/g, ''), 'base64')))) { out.push('result page inlines a taste-vault image as a data: URI'); break; }
  }
  return out;
}

/** @returns {(args: object) => number} a board-check that also fails boards naming the taste vault. */
function withTasteVaultRule(inner) {
  return (args) => {
    const kind = requireBoard('--kind', args.kind);
    const file = path.join(resolveRunDir(args['run-dir']), 'boards', `${kind}.html`);
    const scan = isRegularFile(file) && fs.statSync(file).size <= MAX_BOARD_BYTES;
    if (!scan || !referencesTasteVault(fs.readFileSync(file, 'utf8'))) return inner(args);
    process.stderr.write(`board-check ${kind} failed:\n- board references a pattern/taste-vault path (vault screenshots are internal reference only)\n`);
    return 1;
  };
}

module.exports = Object.freeze({ withTasteVaultRule, referencesTasteVault, resultTasteVaultProblems });
