#!/usr/bin/env node
'use strict';
// remix.cjs (spec 024, FR-028, W11). Node core only.
//   plan --run-dir <dir> --amplitude <low|mid|high> [--anchors <id,id>] [--vault-root <dir>] [--date YYYY-MM-DD]
// Resolves the original's family from run.md `## Picks`, resolves each anchor against the taste vault, and records
// the plan in run.md `## Remix` (replaced on a second plan). Prints the plan as one JSON object.
// Exit codes: 0 ok, 1 refusal (no pick, unknown anchor, damaged anchor entry), 2 usage or hostile input, 3 internal error.

const fs = require('fs');
const path = require('path');
const { Refusal, parseArgs, requireText, resolveDate, clean } = require('../run/common.cjs');
const { resolveRunDir, isRegularFile } = require('../run/rundir.cjs');
const { readPicks } = require('../run/picks.cjs');
const { parseEntry } = require('../taste/entry.cjs');

const FAMILY_IDS = Object.freeze(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'run', 'families.json'), 'utf8')).families.map((f) => f.id));
const AMPLITUDES = Object.freeze({
  low: 'same structure, change type scale, colour accents and spacing only',
  mid: 'same family tokens, three new layouts and a new rhythm of sections',
  high: 'same family feeling, new layouts, new imagery direction and a new hero idea',
});
const MAX_ANCHORS = 5;
const MAX_ENTRY_BYTES = 64 * 1024;
const HEADING = '## Remix';
const GATE_START = '<!-- gate-record:start -->';

function vaultRoot(args) {
  const raw = args['vault-root'] !== undefined ? args['vault-root'] : process.env.A1_VAULT_ROOT;
  if (raw === undefined || raw === '') throw new Refusal(2, 'A1_VAULT_ROOT is not set (or pass --vault-root); anchors live in the taste vault');
  if (String(raw).split(/[\\/]/).includes('..')) throw new Refusal(2, 'invalid --vault-root: path must not contain ".."');
  try { return fs.realpathSync(requireText('--vault-root', raw)); } catch (e) {
    if (e instanceof Refusal) throw e;
    throw new Refusal(2, 'vault root does not exist');
  }
}

function parseAnchors(raw) {
  if (raw === undefined || raw === '') return [];
  const ids = String(raw).split(',').map((s) => s.trim());
  const bad = ids.find((id) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id));
  if (bad !== undefined) throw new Refusal(2, 'invalid --anchors: comma-separated entry ids, each lowercase letters, digits and hyphens');
  if (new Set(ids).size !== ids.length) throw new Refusal(2, 'invalid --anchors: duplicate id');
  if (ids.length > MAX_ANCHORS) throw new Refusal(2, `invalid --anchors: at most ${MAX_ANCHORS}`);
  return ids;
}

/** The taste entry <id>.md in exactly one family folder; symlinks and non-files do not count. */
function resolveAnchor(rootReal, id) {
  const base = path.join(rootReal, 'pattern', 'taste-vault');
  const hits = [];
  for (const family of FAMILY_IDS) {
    const dir = path.join(base, family);
    let dirOk = false;
    try { const st = fs.lstatSync(dir); dirOk = st.isDirectory() && !st.isSymbolicLink(); } catch (e) { dirOk = false; }
    const file = path.join(dir, `${id}.md`);
    if (dirOk && isRegularFile(file)) hits.push({ family, file });
  }
  if (hits.length === 0) throw new Refusal(1, `unknown anchor "${id}": no such entry in the taste vault; nothing recorded`);
  if (hits.length > 1) throw new Refusal(1, `anchor "${id}" exists in ${hits.length} families; nothing recorded`);
  const { family, file } = hits[0];
  if (fs.statSync(file).size > MAX_ENTRY_BYTES) throw new Refusal(1, `anchor "${id}" entry is larger than ${MAX_ENTRY_BYTES} bytes`);
  const e = parseEntry(fs.readFileSync(file, 'utf8'));
  const kw = e.keywords;
  if (e.id !== id || e.family !== family || !Array.isArray(kw) || kw.length === 0 || !kw.every((k) => typeof k === 'string' && k.trim())) {
    throw new Refusal(1, `anchor "${id}" entry is damaged (id, family or keywords); run taste.cjs lint`);
  }
  return Object.freeze({ id, family, keywords: Object.freeze(kw.map((k) => clean(k).slice(0, 40))) });
}

function originalFamily(runDir) {
  const picks = readPicks(runDir);
  const pick = picks.converge || picks.diverge;
  if (!pick) throw new Refusal(1, 'no pick recorded in run.md; a remix needs an original (pick a family first)');
  return pick.family;
}

function planLines(plan, date) {
  return [
    `- remix: amplitude=${plan.amplitude} family=${plan.family} original_family=${plan.original_family} anchors=${plan.anchors.map((a) => a.id).join(',') || 'none'} date=${date}`,
    `- distance: ${plan.distance}`,
    ...plan.anchors.map((a) => `- anchor ${a.id}: family=${a.family} keywords=${a.keywords.join(', ')}`),
  ];
}

function writeRemixSection(runDir, lines) {
  const target = path.join(runDir, 'run.md');
  const all = fs.readFileSync(target, 'utf8').split('\n');
  const stripped = (() => {
    const s = all.findIndex((l) => l.trimEnd() === HEADING);
    if (s === -1) return all;
    const rest = all.slice(s + 1).findIndex((l) => /^## /.test(l) || l.trimEnd() === GATE_START);
    const e = rest === -1 ? all.length : s + 1 + rest;
    return [...all.slice(0, s), ...all.slice(e)];
  })();
  let at = stripped.findIndex((l) => l.trimEnd() === '## Assets');
  if (at === -1) at = stripped.findIndex((l) => l.trimEnd() === GATE_START);
  if (at === -1) at = stripped.length;
  const next = [...stripped.slice(0, at), HEADING, '', ...lines, '', ...stripped.slice(at)];
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next.join('\n'), { flag: 'wx' });
  fs.renameSync(tmp, target);
}

function plan(args) {
  if (!Object.prototype.hasOwnProperty.call(AMPLITUDES, args.amplitude)) throw new Refusal(2, `invalid --amplitude: want ${Object.keys(AMPLITUDES).join('|')}`);
  const anchorIds = parseAnchors(args.anchors);
  const date = resolveDate(args.date);
  const runDir = resolveRunDir(args['run-dir']);
  const original = originalFamily(runDir);
  const anchors = anchorIds.length === 0 ? [] : anchorIds.map((id) => resolveAnchor(vaultRoot(args), id));
  const result = Object.freeze({
    amplitude: args.amplitude, distance: AMPLITUDES[args.amplitude], original_family: original,
    family: anchors.length === 0 ? original : anchors[0].family, anchors: Object.freeze(anchors),
    variants: 3,
  });
  writeRemixSection(runDir, planLines(result, date));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

const USAGE = 'usage: remix.cjs plan --run-dir <dir> --amplitude <low|mid|high> [--anchors <id,id>] [--vault-root <dir>] [--date YYYY-MM-DD]';
const COMMANDS = Object.freeze({ plan });

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, cmd)) throw new Refusal(2, USAGE);
  return COMMANDS[cmd](parseArgs(rest));
}

try { process.exit(main(process.argv.slice(2))); } catch (e) {
  if (e instanceof Refusal) { process.stderr.write(`error: ${clean(e.message)}\n`); process.exit(e.code); }
  process.stderr.write(`error: ${clean(e && e.message ? e.message : e)}\n`);
  process.exit(3);
}
