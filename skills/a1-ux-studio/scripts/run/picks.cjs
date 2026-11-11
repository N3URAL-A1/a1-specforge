'use strict';
// Pick, require-pick and reroll commands (spec 024, FR-006/FR-007, W4). Node core only.
// run.md `## Picks` holds one line per board:
//   - <board>: family=<f> variant=<v> date=<d>
//   - <board>: Default adopted: <v> family=<f> variant=<v> date=<d>
//   - <board>: reroll used date=<d>
// Every rewrite builds a new file and renames it over run.md (no in-place edit).

const fs = require('fs');
const path = require('path');
const { Refusal, resolveDate } = require('./common.cjs');
const { requireBoard, requireId, resolveRunDir, readBoard } = require('./rundir.cjs');
const { findTile } = require('./tiles.cjs');

const HEADING = '## Picks';
const GATE_START = '<!-- gate-record:start -->';
const PICK_RE = /^- (diverge|converge): (?:Default adopted: [a-z0-9-]+ )?family=([a-z0-9-]+) variant=([a-z0-9-]+) date=(\d{4}-\d{2}-\d{2})$/;
const REROLL_RE = /^- (diverge|converge): reroll used date=\d{4}-\d{2}-\d{2}$/;

function readRunMd(runDir) {
  const lines = fs.readFileSync(path.join(runDir, 'run.md'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === HEADING);
  if (start === -1) throw new Refusal(1, 'run.md has no "## Picks" section');
  const rest = lines.slice(start + 1).findIndex((l) => /^## /.test(l) || l.trimEnd() === GATE_START);
  const end = rest === -1 ? lines.length : start + 1 + rest;
  return Object.freeze({ before: lines.slice(0, start), section: lines.slice(start + 1, end), after: lines.slice(end) });
}

/** Parsed picks: { diverge: {family, variant, date} | null, converge: ..., rerolls: {diverge: bool, converge: bool} }. */
function readPicks(runDir) {
  const { section } = readRunMd(runDir);
  const pickOf = (board) => {
    const m = section.map((l) => PICK_RE.exec(l.trimEnd())).filter((x) => x && x[1] === board).pop();
    return m ? Object.freeze({ family: m[2], variant: m[3], date: m[4] }) : null;
  };
  const rerolled = (board) => section.some((l) => { const m = REROLL_RE.exec(l.trimEnd()); return m !== null && m[1] === board; });
  return Object.freeze({
    diverge: pickOf('diverge'), converge: pickOf('converge'),
    rerolls: Object.freeze({ diverge: rerolled('diverge'), converge: rerolled('converge') }),
  });
}

function writeRunMd(runDir, parts, section) {
  const text = [...parts.before, HEADING, ...section, ...parts.after].join('\n');
  const target = path.join(runDir, 'run.md');
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { flag: 'wx' });
  fs.renameSync(tmp, target);
}

/** New section: foreign lines kept, lines matching `drop` replaced, `entry` appended, one blank line each side. */
function withEntry(section, drop, entry) {
  const keep = section.filter((l) => l.trim() !== '' && !drop(l.trimEnd()));
  return ['', ...keep, entry, ''];
}

const isBoardLine = (board) => (l) => PICK_RE.test(l) && l.startsWith(`- ${board}: `);
const isRerollLine = (board) => (l) => REROLL_RE.test(l) && l.startsWith(`- ${board}: `);

function pick(args) {
  const board = requireBoard('--board', args.board);
  const hasOption = args.option !== undefined;
  const hasDefault = args['default-adopted'] !== undefined;
  if (hasOption === hasDefault) throw new Refusal(2, 'use exactly one of --option or --default-adopted');
  const id = requireId(hasOption ? '--option' : '--default-adopted', hasOption ? args.option : args['default-adopted']);
  const date = resolveDate(args.date);
  const runDir = resolveRunDir(args['run-dir']);
  const tile = findTile(readBoard(runDir, board).html, id);
  if (!tile) throw new Refusal(1, `no tile with option id "${id}" on boards/${board}.html; nothing recorded`);
  const family = tile.attrs['data-family'];
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(family || '')) throw new Refusal(1, `tile "${id}" has no valid data-family; nothing recorded`);
  const label = hasDefault ? `Default adopted: ${id} ` : '';
  const entry = `- ${board}: ${label}family=${family} variant=${id} date=${date}`;
  const parts = readRunMd(runDir);
  writeRunMd(runDir, parts, withEntry(parts.section, isBoardLine(board), entry));
  process.stdout.write(`${entry}\n`);
  return 0;
}

function requirePick(args) {
  const board = requireBoard('--board', args.board);
  const picked = readPicks(resolveRunDir(args['run-dir']))[board];
  if (!picked) throw new Refusal(1, `no pick recorded for ${board}; ask the user to pick (or adopt a default) before continuing`);
  process.stdout.write(`${board}: family=${picked.family} variant=${picked.variant}\n`);
  return 0;
}

function reroll(args) {
  const board = requireBoard('--board', args.board);
  const date = resolveDate(args.date);
  const runDir = resolveRunDir(args['run-dir']);
  if (readPicks(runDir).rerolls[board]) throw new Refusal(1, `the one re-roll for ${board} is used; stop and ask the user`);
  const parts = readRunMd(runDir);
  const entry = `- ${board}: reroll used date=${date}`;
  writeRunMd(runDir, parts, withEntry(parts.section, isRerollLine(board), entry));
  process.stdout.write(`${entry}\n`);
  return 0;
}

module.exports = Object.freeze({ pick, requirePick, reroll, readPicks });
