#!/usr/bin/env node
'use strict';
// taste.cjs (spec 024, FR-023/FR-024, W8). Node core only.
//   add  --family <id> --id <slug> --screenshot <vault-relative file> --source-url <url> --keywords "a,b"
//        --image-prompt <text> --copy-brief <text> [--vault-root <dir>]
//   lint --root <dir> [--min-entries N] [--families N]
// Exit codes: 0 ok, 1 refusal (personal data, duplicate entry, lint finding), 2 usage or hostile input, 3 internal error.

const fs = require('fs');
const path = require('path');
const { Refusal, parseArgs, requireText, clean, today } = require('../run/common.cjs');
const { validateEntry, checkPii, formatEntry, parseEntry, isFilled, FIELDS } = require('./entry.cjs');

const FAMILY_IDS = Object.freeze(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'run', 'families.json'), 'utf8')).families.map((f) => f.id));
const VAULT_SUBDIR = ['pattern', 'taste-vault'];
const MAX_LINT_FILES = 5000;
const MAX_ENTRY_BYTES = 64 * 1024;

const inside = (rootReal, p) => p === rootReal || p.startsWith(rootReal + path.sep);
const noDotDot = (name, v) => { if (v.split(/[\\/]/).includes('..')) throw new Refusal(2, `invalid ${name}: path must not contain ".."`); return v; };

function vaultRoot(args) {
  const raw = args['vault-root'] !== undefined ? args['vault-root'] : process.env.A1_VAULT_ROOT;
  if (raw === undefined || raw === '') throw new Refusal(2, 'A1_VAULT_ROOT is not set (or pass --vault-root); the taste vault lives in the vault');
  try { return fs.realpathSync(noDotDot('--vault-root', requireText('--vault-root', raw))); } catch (e) {
    if (e instanceof Refusal) throw e;
    throw new Refusal(2, 'vault root does not exist');
  }
}

/** Makes <vault>/pattern/taste-vault/<family> one level at a time; every level must stay inside the vault. */
function ensureFamilyDir(rootReal, family) {
  let cur = rootReal;
  for (const seg of [...VAULT_SUBDIR, family]) {
    cur = path.join(cur, seg);
    if (!fs.existsSync(cur)) fs.mkdirSync(cur);
    if (fs.lstatSync(cur).isSymbolicLink() || !fs.statSync(cur).isDirectory()) throw new Refusal(2, `vault path ${seg} is a symlink or not a directory`);
    if (!inside(rootReal, fs.realpathSync(cur))) throw new Refusal(2, 'taste vault path resolves outside the vault root');
  }
  return cur;
}

function requireScreenshot(rootReal, rel) {
  const file = path.join(rootReal, rel);
  let real;
  try { real = fs.realpathSync(file); } catch (e) { throw new Refusal(2, `--screenshot file not found in the vault: ${clean(rel)}`); }
  if (!inside(rootReal, real) || !fs.statSync(real).isFile()) throw new Refusal(2, '--screenshot must be a regular file inside the vault');
}

function add(args) {
  const rootReal = vaultRoot(args);
  const entry = validateEntry(args, FAMILY_IDS);
  requireScreenshot(rootReal, entry.screenshot);
  const dir = ensureFamilyDir(rootReal, entry.family);
  const file = path.join(dir, `${entry.id}.md`);
  try { fs.writeFileSync(file, formatEntry(entry, today()), { flag: 'wx' }); } catch (e) {
    if (e.code === 'EEXIST') throw new Refusal(1, `entry ${entry.id} already exists in ${entry.family}`);
    throw e;
  }
  process.stdout.write(`${path.relative(rootReal, file).split(path.sep).join('/')}\n`);
  return 0;
}

function listEntries(rootReal) {
  const files = [];
  for (const d of fs.readdirSync(rootReal).sort()) {
    const dir = path.join(rootReal, d);
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) files.push({ family: d, name: f, file: path.join(dir, f) });
  }
  return files.slice(0, MAX_LINT_FILES);
}

function entryProblems(item, vaultReal) {
  const where = `${item.family}/${item.name}`;
  const st = fs.lstatSync(item.file);
  if (!st.isFile() || st.size > MAX_ENTRY_BYTES) return [`${where}: not a regular file or larger than ${MAX_ENTRY_BYTES} bytes`];
  const e = parseEntry(fs.readFileSync(item.file, 'utf8'));
  const out = FIELDS.filter((f) => !isFilled(e[f])).map((f) => `${where}: missing field ${f}`);
  if (e.family !== item.family || !FAMILY_IDS.includes(item.family)) out.push(`${where}: family must be a catalog id equal to its folder`);
  if (e.id !== item.name.slice(0, -3)) out.push(`${where}: id must equal the file name`);
  const pii = checkPii(e);
  if (pii) out.push(`${where}: ${pii.field} contains an ${pii.kind === 'email' ? 'email address' : 'phone number'}`);
  if (vaultReal && typeof e.screenshot === 'string' && !e.screenshot.split('/').includes('..')) {
    try { if (!inside(vaultReal, fs.realpathSync(path.join(vaultReal, e.screenshot)))) out.push(`${where}: screenshot resolves outside the vault`); } catch (x) { out.push(`${where}: screenshot file not found`); }
  }
  return out;
}

const count = (name, raw) => {
  if (raw === undefined) return undefined;
  if (!/^\d{1,6}$/.test(raw)) throw new Refusal(2, `invalid ${name}: want a non-negative integer`);
  return Number(raw);
};

function lint(args) {
  const minEntries = count('--min-entries', args['min-entries']);
  const wantFamilies = count('--families', args.families);
  let rootReal;
  try { rootReal = fs.realpathSync(noDotDot('--root', requireText('--root', args.root))); } catch (e) {
    if (e instanceof Refusal) throw e;
    throw new Refusal(2, 'invalid --root: not an existing directory');
  }
  if (!fs.statSync(rootReal).isDirectory()) throw new Refusal(2, 'invalid --root: not a directory');
  const tail = rootReal.split(path.sep).slice(-VAULT_SUBDIR.length).join('/');
  const vaultReal = tail === VAULT_SUBDIR.join('/') ? path.resolve(rootReal, '..', '..') : null;
  const items = listEntries(rootReal);
  const fams = new Set(items.map((i) => i.family));
  const problems = [
    ...items.flatMap((i) => entryProblems(i, vaultReal)),
    ...(minEntries !== undefined && items.length < minEntries ? [`${items.length} entries, want at least ${minEntries}`] : []),
    ...(wantFamilies !== undefined && fams.size !== wantFamilies ? [`${fams.size} families with entries, want exactly ${wantFamilies}`] : []),
  ];
  if (problems.length === 0) { process.stdout.write(`taste lint: ok (${items.length} entries, ${fams.size} families)\n`); return 0; }
  process.stderr.write(`taste lint failed (${items.length} entries, ${fams.size} families):\n${problems.slice(0, 40).map((p) => `- ${clean(p)}`).join('\n')}\n`);
  return 1;
}

const USAGE = 'usage: taste.cjs add --family <id> --id <slug> --screenshot <vault-relative.png> --source-url <url> --keywords "a,b" --image-prompt <text> --copy-brief <text> [--vault-root <dir>]\n'
  + '       taste.cjs lint --root <dir> [--min-entries N] [--families N]';
const COMMANDS = Object.freeze({ add, lint });

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
