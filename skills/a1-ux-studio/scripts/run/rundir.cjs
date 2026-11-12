'use strict';
// Run-folder and board-file access for the board commands (spec 024, W4). Node core only.
// Every path argument is validated before any read or write; failures are Refusal(2).

const fs = require('fs');
const path = require('path');
const { Refusal, requireText, requireSlug } = require('./common.cjs');

const BOARD_KINDS = Object.freeze(['diverge', 'converge']);
const MAX_BOARD_BYTES = 5 * 1024 * 1024;

function requireBoard(name, value) {
  if (!BOARD_KINDS.includes(value)) throw new Refusal(2, `invalid ${name}: want ${BOARD_KINDS.join('|')}`);
  return value;
}

const inside = (rootReal, p) => p === rootReal || p.startsWith(rootReal + path.sep);

function isRegularFile(p) {
  try { const st = fs.lstatSync(p); return st.isFile() && !st.isSymbolicLink(); } catch (e) { return false; }
}

/** The run folder: an existing directory whose run.md is a regular file (no symlink). Returns the real path. */
function resolveRunDir(raw) {
  const given = requireText('--run-dir', raw);
  let real;
  try { real = fs.realpathSync(given); } catch (e) { throw new Refusal(2, 'invalid --run-dir: not an existing directory'); }
  if (!fs.statSync(real).isDirectory()) throw new Refusal(2, 'invalid --run-dir: not a directory');
  if (!isRegularFile(path.join(real, 'run.md'))) throw new Refusal(2, 'invalid --run-dir: no run.md (not a run folder)');
  return real;
}

/** Reads boards/<kind>.html; the file must be a regular file whose real path stays inside boards/. */
function readBoard(runDir, kind) {
  const boardsDir = path.join(runDir, 'boards');
  const file = path.join(boardsDir, `${kind}.html`);
  if (!isRegularFile(file)) throw new Refusal(1, `boards/${kind}.html is missing; render the board first`);
  let boardsReal;
  try { boardsReal = fs.realpathSync(boardsDir); } catch (e) { throw new Refusal(1, 'boards/ is not readable'); }
  if (!inside(runDir, boardsReal)) throw new Refusal(1, 'boards/ resolves outside the run folder');
  if (fs.statSync(file).size > MAX_BOARD_BYTES) throw new Refusal(2, `boards/${kind}.html is larger than ${MAX_BOARD_BYTES} bytes`);
  return { html: fs.readFileSync(file, 'utf8'), boardsDir: boardsReal };
}

/** An id such as a family, variant or option id. */
const requireId = (name, value) => requireSlug(name, value);

module.exports = Object.freeze({ BOARD_KINDS, requireBoard, requireId, resolveRunDir, readBoard, inside, isRegularFile });
