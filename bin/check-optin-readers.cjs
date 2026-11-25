#!/usr/bin/env node
'use strict';

// check-optin-readers — spec 027 slice 5 (FR-032, D9): lists the readers of a candidate opt-in file name.
// A line in a scanned file that holds the literal is a reader, unless a MENTIONS_ALLOWED entry (_shared/lib/optin-logs.cjs)
// covers that very line. Scanned: skills/, agents/, _shared/ (not _shared/vendor/), bin/, hooks/, packs/, _extras/, .github/;
// extensions .md .cjs .js .mjs .sh .json .yml .yaml .plist .toml .html, plus executable files without an extension.
// Symlinked files and directories are followed (loop-safe by real path); a link that cannot be resolved is listed in `unscanned`.
// The allowlist contract is enforced here, not only documented:
//   - every `contains` is at least 20 characters, else `contract_violations` (checked before the scan);
//   - an entry covers exactly one line (1:1): a further line holding the same `contains` is a reader (`duplicate_of`);
//   - a line is covered only when every occurrence of the name lies inside the `contains` span (equal occurrence counts);
//   - an entry whose `contains` names the candidate and that covers no line is `stale` (entries of other opt-in names are not);
//   - optin-logs.cjs is scanned like any file; only its full canonical definition lines are exempt: the whole line
//     `  entry('<file>', '<contains>', '<reason>'),` equal to a loaded entry, and the whole OPTIN_FILES line equal to its value.
// The allowlist is loaded from <root>/_shared/lib/optin-logs.cjs when present (JSON `allowlist: "root"`), else from this repo
// (`"fallback"`). --root EXECUTES that tree's optin-logs.cjs: use trusted trees only. A module without two array exports is exit 2.
// Limit: the scan is literal. A reader that reaches the file through a constant (readFileSync(path.join(dir, LOG_FILE))) is
// invisible; the writer constants (xprov-gate.cjs, xprov-run.cjs) are pinned by their allowlist entries instead.
// Usage: check-optin-readers.cjs --name <literal> [--root <dir>]
// Output: JSON {name, allowlist, readers: [{file, line, text, duplicate_of?}], allowed: [{file, line, reason}], stale: [{file, contains}],
//   contract_violations: [{file, contains, reason}], unscanned: [{file, reason}]}.
// Exit 1 when readers, stale or contract_violations is non-empty, 0 when all are empty, 2 on usage or a malformed allowlist module.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCAN_ROOTS = Object.freeze(['skills', 'agents', '_shared', 'bin', 'hooks', 'packs', '_extras', '.github']);
const SCAN_EXTS = Object.freeze(['.md', '.cjs', '.js', '.mjs', '.sh', '.json', '.yml', '.yaml', '.plist', '.toml', '.html']);
const SKIP_DIR_NAMES = Object.freeze(['node_modules']);
const SKIP_REL_DIRS = Object.freeze(['_shared/vendor']);
const EXEC_BITS = 0o111;
const MIN_CONTAINS = 20;
const TEXT_MAX = 200;
const DEFINITION = '_shared/lib/optin-logs.cjs';
const ALLOWLIST_REL = path.join('_shared', 'lib', 'optin-logs.cjs');
const STR = '(?:\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*")'; // one JS string literal, no template, no code
const ENTRY_LINE = new RegExp(`^  entry\\((${STR}), (${STR}), (${STR})\\),$`);
const OPTIN_LINE = new RegExp(`^const OPTIN_FILES = Object\\.freeze\\(\\[((?:${STR}(?:, )?)*)\\]\\);$`);

function usage(msg) {
  process.stderr.write(`usage error: ${msg}\nusage: check-optin-readers.cjs --name <literal> [--root <dir>]\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = { name: null, root: path.join(__dirname, '..') };
  for (let i = 0; i < argv.length; i += 2) {
    const v = argv[i + 1];
    if ((argv[i] !== '--name' && argv[i] !== '--root') || v === undefined || v === '') usage(`unexpected argument ${JSON.stringify(String(argv[i]).slice(0, 60))}`);
    out[argv[i].slice(2)] = v;
  }
  if (!out.name) usage('--name is required');
  return out;
}

const lit = (s) => vm.runInNewContext(s, Object.create(null), { timeout: 100 }); // s matched STR: a plain string literal

function loadAllowlist(root) {
  const planted = path.join(root, ALLOWLIST_REL);
  const source = fs.existsSync(planted) ? 'root' : 'fallback';
  let mod;
  try { mod = require(source === 'root' ? planted : path.join(__dirname, '..', ALLOWLIST_REL)); } catch (e) { return usage(`cannot load the allowlist module: ${String(e.message).slice(0, 120)}`); }
  if (!Array.isArray(mod.MENTIONS_ALLOWED) || !Array.isArray(mod.OPTIN_FILES) || !mod.MENTIONS_ALLOWED.every((m) => m && typeof m === 'object')) usage('the allowlist module must export MENTIONS_ALLOWED and OPTIN_FILES as arrays');
  return { entries: mod.MENTIONS_ALLOWED, optinFiles: mod.OPTIN_FILES, source };
}

// true when `text` is a full canonical definition line of the allowlist module that matches a loaded entry / OPTIN_FILES value
function isDefinitionLine(text, entries, optinFiles) {
  const e = ENTRY_LINE.exec(text);
  if (e) { const [f, c, r] = [lit(e[1]), lit(e[2]), lit(e[3])]; return entries.some((m) => m.file === f && m.contains === c && m.reason === r); }
  const o = OPTIN_LINE.exec(text);
  return Boolean(o) && JSON.stringify((o[1].match(new RegExp(STR, 'g')) || []).map(lit)) === JSON.stringify(optinFiles);
}

const count = (text, name) => text.split(name).length - 1;
const covers = (m, rel, text, name) => m.file === rel && text.includes(m.contains) && count(text, name) === count(m.contains, name);

function walk(root, rel, state, chain) {
  let real;
  try { real = fs.realpathSync(path.join(root, rel)); } catch (_e) { state.unscanned.push({ file: rel, reason: 'unresolvable' }); return; }
  if (chain.includes(real)) return;
  for (const d of fs.readdirSync(path.join(root, rel)).sort()) visit(root, `${rel}/${d}`, d, state, chain.concat(real));
}

function visit(root, rel, name, state, chain) {
  let st;
  try { st = fs.statSync(path.join(root, rel)); } catch (_e) { state.unscanned.push({ file: rel, reason: 'broken symlink' }); return; }
  if (st.isDirectory()) {
    if (!SKIP_DIR_NAMES.includes(name) && !SKIP_REL_DIRS.includes(rel)) walk(root, rel, state, chain);
  } else if (st.isFile() && (SCAN_EXTS.includes(path.extname(name)) || (path.extname(name) === '' && (st.mode & EXEC_BITS) !== 0))) state.files.push(rel);
}

function listFiles(root) {
  const state = { files: [], unscanned: [] };
  for (const sub of SCAN_ROOTS) if (fs.existsSync(path.join(root, sub))) walk(root, sub, state, []);
  return state;
}

function contractViolations(entries) {
  return entries
    .filter((m) => typeof m.contains !== 'string' || m.contains.length < MIN_CONTAINS)
    .map((m) => ({ file: m.file, contains: m.contains, reason: `contains is shorter than ${MIN_CONTAINS} characters` }));
}

// classify one file's lines; `used` maps an entry index to the line that took it (1:1)
function scanFile(root, rel, name, al, used) {
  const readers = []; const allowed = [];
  fs.readFileSync(path.join(root, rel), 'utf8').split('\n').forEach((text, i) => {
    if (!text.includes(name)) return;
    if (rel === DEFINITION && isDefinitionLine(text, al.entries, al.optinFiles)) { allowed.push({ file: rel, line: i + 1, reason: 'allowlist definition line' }); return; }
    const free = al.entries.findIndex((m, k) => !used.has(k) && covers(m, rel, text, name));
    if (free >= 0) { used.set(free, i + 1); allowed.push({ file: rel, line: i + 1, reason: al.entries[free].reason }); return; }
    const taken = al.entries.findIndex((m, k) => used.has(k) && covers(m, rel, text, name));
    const item = { file: rel, line: i + 1, text: text.slice(0, TEXT_MAX) };
    readers.push(taken >= 0 ? { ...item, duplicate_of: used.get(taken) } : item);
  });
  return { readers, allowed };
}

function finish(result) {
  const bad = result.readers.length + result.stale.length + result.contract_violations.length;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(bad ? 1 : 0));
}

function main() {
  const { name, root } = parseArgs(process.argv.slice(2));
  const al = loadAllowlist(root);
  const base = { name, allowlist: al.source, readers: [], allowed: [], stale: [], contract_violations: [], unscanned: [] };
  const violations = contractViolations(al.entries);
  if (violations.length) return finish({ ...base, contract_violations: violations });
  const { files, unscanned } = listFiles(root);
  const used = new Map(); let readers = []; let allowed = [];
  for (const rel of files) {
    const r = scanFile(root, rel, name, al, used);
    readers = readers.concat(r.readers); allowed = allowed.concat(r.allowed);
  }
  const stale = al.entries.filter((m, k) => !used.has(k) && m.contains.includes(name)).map((m) => ({ file: m.file, contains: m.contains }));
  return finish({ ...base, readers, allowed, stale, unscanned });
}

main();
