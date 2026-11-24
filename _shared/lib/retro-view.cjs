'use strict';

// ---------------------------------------------------------------------------
// retro-view — ONE view of a learning-store / retro file for every reader (review round 2, root cause A).
// `retro validate` and `machine-retro` used to cut the same file into different blocks (the first split on \n only and ended a
// block at any line starting with `---`; the second matched with /m regexes that also treat \r, U+2028, U+2029 as line ends), so
// a block one of them rejected was a machine record to the other. Both now read through this module:
//   normalizeNewlines  \r\n, \r, U+2028, U+2029, U+0085 -> \n (the only line break left in the text)
//   blocksOf           a block OPENS at a line that is exactly `---` (spaces/tabs allowed) and CLOSES at the next line that
//                      starts with `---` (the rule of parseFrontmatter, io-frontmatter.cjs), so `---x` closes it for everyone
//   hasMachineKeys     raw-text ban on `kind: machine` / `machine_record:` lines (feature close alone writes them)
// ---------------------------------------------------------------------------

const DELIM_RE = /^---[ \t]*$/;
const MACHINE_KEY_RE = /^\s*(?:kind\s*:\s*machine\s*$|machine_record\s*:)/;

/** @param {string} text @returns {string} text with every Unicode line break turned into \n */
function normalizeNewlines(text) {
  return String(text).replace(/\r\n|[\r\u2028\u2029\u0085]/g, '\n');
}

const isDelim = (line) => DELIM_RE.test(line);
const isBlock = (line) => line.startsWith('---');

/**
 * @param {string[]} lines normalised lines
 * @returns {{open: number, close: number, lines: string[], closedByDelim: boolean}[]}
 *   one block per delimiter line (the closing line of one block opens the next, as appended entries share it);
 *   `close` is the index of the closing line (lines.length when the file ends first)
 */
function blocksOf(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isDelim(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !isBlock(lines[j])) j++;
    out.push({ open: i, close: j, lines: lines.slice(i + 1, j), closedByDelim: j >= lines.length || isDelim(lines[j]) });
  }
  return out;
}

/** @returns {string[]} the normalised lines of a text */
const linesOf = (text) => normalizeNewlines(text).split('\n');

/** @returns {string[]} the lines of the raw text that carry a machine-only key (trimmed) */
function machineKeyLines(text) {
  return linesOf(text).filter((l) => MACHINE_KEY_RE.test(l)).map((l) => l.trim());
}

module.exports = { normalizeNewlines, linesOf, blocksOf, isDelim, machineKeyLines, MACHINE_KEY_RE, DELIM_RE };
