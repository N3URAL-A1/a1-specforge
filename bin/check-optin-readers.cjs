#!/usr/bin/env node
'use strict';

// check-optin-readers — spec 027 slice 5 (FR-032, D9): lists the readers of a candidate opt-in file name.
// A line in a scanned file that holds the literal is a reader, unless a MENTIONS_ALLOWED entry (_shared/lib/optin-logs.cjs)
// covers that very line. Scanned: skills/, agents/, _shared/ (not _shared/vendor/), bin/, hooks/, packs/, _extras/, .github/;
// extensions .md .cjs .js .mjs .sh .json .yml .yaml .plist .toml .html, plus executable files without an extension.
// Symlinks are followed to their real path: every real file and directory is read once, reported under its canonical path
// (relative to realpath(root)), so an alias or a link to a parent never rescans a tree. A link whose target lies outside the root is
// not walked and goes to `unscanned` ('outside root'); a target inside the root but outside the scanned roots is not walked;
// the skip lists (_shared/vendor, node_modules) apply to the canonical path. A link that cannot be resolved ('broken symlink') and a
// directory or file that cannot be read ('unreadable') are listed in `unscanned` too. --root is resolved against the cwd.
// The allowlist contract is enforced here, not only documented:
//   - every `contains` is at least 20 characters, else `contract_violations` (checked before the scan);
//   - an entry covers exactly one line (1:1): a further line holding the same `contains` is a reader (`duplicate_of`);
//   - a line is covered only when every occurrence of the name lies inside the `contains` span (equal occurrence counts);
//   - an entry whose `contains` names the candidate and that covers no line is `stale` (entries of other opt-in names are not);
//   - optin-logs.cjs is scanned like any file; only its full canonical definition lines are exempt: the whole line
//     `  entry('<file>', '<contains>', '<reason>'),` equal to a loaded entry, and the whole OPTIN_FILES line equal to its value.
// The allowlist is loaded from <root>/_shared/lib/optin-logs.cjs when present (JSON `allowlist: "root"`), else from this repo
// (`"fallback"`). --root EXECUTES that tree's optin-logs.cjs: use trusted trees only. A module without two array exports is exit 2.
//   - an entry whose `contains` names no OPTIN_FILES entry can never cover a line of a candidate: `contract_violations`.
// Limit: the scan is literal and line-based. Invisible to it: a reader that reaches the file through a constant
// (readFileSync(path.join(dir, LOG_FILE))), a name built from split or concatenated literals ('PLAN-REVIEW' + '-LOG.md'), a file
// whose extension is outside SCAN_EXTS (.py, .ts, .txt), a non-executable file without an extension, and logic inside the trusted
// allowlist module (a redefined entry(), code that edits MENTIONS_ALLOWED at load time: --root executes that module). The writer
// constants (xprov-gate.cjs, xprov-run.cjs) are pinned by their allowlist entries instead.
// Usage: check-optin-readers.cjs --name <literal> [--root <dir>]
// Output: JSON {name, allowlist, readers: [{file, line, text, duplicate_of?}], allowed: [{file, line, reason}], stale: [{file, contains}],
//   contract_violations: [{file, contains, reason}], unscanned: [{file, reason}]}.
// Exit 1 when readers, stale, contract_violations or unscanned is non-empty (an unscanned path is unchecked, so the check fails closed),
// 0 when all are empty, 2 on usage, an unusable --root or a malformed allowlist module.

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
  return { ...out, root: path.resolve(out.root) };
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

const toPosix = (p) => p.split(path.sep).join('/');
const isOutside = (canon) => canon === '..' || canon.startsWith('../') || path.isAbsolute(canon);
const isSkipped = (canon) => canon.split('/').some((seg) => SKIP_DIR_NAMES.includes(seg)) || SKIP_REL_DIRS.some((d) => canon === d || canon.startsWith(`${d}/`));
const isScannable = (st, name) => st.isFile() && (SCAN_EXTS.includes(path.extname(name)) || (path.extname(name) === '' && (st.mode & EXEC_BITS) !== 0));

// Visits one directory entry by its real path. `parent` is the canonical path of the directory holding it ('' for the root); the
// canonical path (relative to realpath(root)) is what is deduplicated, skip-filtered and reported.
function visit(ctx, parent, name) {
  const seen = parent ? `${parent}/${name}` : name;
  let real;
  try { real = fs.realpathSync(path.join(ctx.realRoot, seen)); } catch (_e) { ctx.unscanned.push({ file: seen, reason: 'broken symlink' }); return; }
  const canon = toPosix(path.relative(ctx.realRoot, real));
  if (isOutside(canon)) { ctx.unscanned.push({ file: seen, reason: 'outside root' }); return; }
  if (!SCAN_ROOTS.includes(canon.split('/')[0]) || isSkipped(canon) || ctx.visited.has(canon)) return;
  ctx.visited.add(canon);
  let st; let children;
  try {
    st = fs.statSync(real);
    if (st.isDirectory()) children = fs.readdirSync(real).sort();
  } catch (_e) { ctx.unscanned.push({ file: canon, reason: 'unreadable' }); return; }
  if (children) children.forEach((d) => visit(ctx, canon, d));
  else if (isScannable(st, path.basename(canon))) ctx.files.push(canon);
}

function listFiles(root) {
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch (_e) { return usage('--root cannot be resolved'); }
  const ctx = { realRoot, visited: new Set(), files: [], unscanned: [] };
  for (const sub of SCAN_ROOTS) {
    try { fs.lstatSync(path.join(realRoot, sub)); } catch (_e) { continue; } // absent: nothing to scan
    visit(ctx, '', sub);
  }
  return { files: ctx.files, unscanned: ctx.unscanned, realRoot };
}

const SHORT = `contains is shorter than ${MIN_CONTAINS} characters`;
const DEAD = 'contains names no OPTIN_FILES entry';
function contractViolations(entries, optinFiles) {
  const reason = (m) => (typeof m.contains !== 'string' || m.contains.length < MIN_CONTAINS ? SHORT : (optinFiles.some((n) => m.contains.includes(n)) ? null : DEAD));
  return entries.map((m) => ({ file: m.file, contains: m.contains, reason: reason(m) })).filter((v) => v.reason !== null);
}

// classify one file's lines; `used` maps an entry index to the line that took it (1:1)
function scanFile(root, rel, name, al, used) {
  const readers = []; const allowed = [];
  let content;
  try { content = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_e) { return { readers, allowed, unscanned: [{ file: rel, reason: 'unreadable' }] }; }
  content.split('\n').forEach((text, i) => {
    if (!text.includes(name)) return;
    if (rel === DEFINITION && isDefinitionLine(text, al.entries, al.optinFiles)) { allowed.push({ file: rel, line: i + 1, reason: 'allowlist definition line' }); return; }
    const free = al.entries.findIndex((m, k) => !used.has(k) && covers(m, rel, text, name));
    if (free >= 0) { used.set(free, i + 1); allowed.push({ file: rel, line: i + 1, reason: al.entries[free].reason }); return; }
    const taken = al.entries.findIndex((m, k) => used.has(k) && covers(m, rel, text, name));
    const item = { file: rel, line: i + 1, text: text.slice(0, TEXT_MAX) };
    readers.push(taken >= 0 ? { ...item, duplicate_of: used.get(taken) } : item);
  });
  return { readers, allowed, unscanned: [] };
}

function finish(result) {
  const bad = result.readers.length + result.stale.length + result.contract_violations.length + result.unscanned.length;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(bad ? 1 : 0));
}

function main() {
  const { name, root } = parseArgs(process.argv.slice(2));
  const al = loadAllowlist(root);
  const base = { name, allowlist: al.source, readers: [], allowed: [], stale: [], contract_violations: [], unscanned: [] };
  const violations = contractViolations(al.entries, al.optinFiles);
  if (violations.length) return finish({ ...base, contract_violations: violations });
  const listed = listFiles(root);
  const used = new Map(); let readers = []; let allowed = []; let unscanned = listed.unscanned;
  for (const rel of listed.files) {
    const r = scanFile(listed.realRoot, rel, name, al, used);
    readers = readers.concat(r.readers); allowed = allowed.concat(r.allowed); unscanned = unscanned.concat(r.unscanned);
  }
  const stale = al.entries.filter((m, k) => !used.has(k) && m.contains.includes(name)).map((m) => ({ file: m.file, contains: m.contains }));
  return finish({ ...base, readers, allowed, stale, unscanned });
}

main();
