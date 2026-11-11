'use strict';
// board-check rule for the taste vault (spec 024, FR-024, W8): a board never references a pattern/taste-vault path,
// because vault screenshots are internal reference only. Wraps the W4 board-check: a hit fails the board before the W4 checks run.

const fs = require('fs');
const path = require('path');
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

module.exports = Object.freeze({ withTasteVaultRule, referencesTasteVault });
