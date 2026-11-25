#!/usr/bin/env node
'use strict';

// check-optin-readers — spec 027 slice 5 (FR-032, D9): lists the readers of a candidate opt-in file name.
// A line in any .md/.cjs/.js/.mjs/.sh/.json file under skills/, agents/, _shared/ (not _shared/vendor/), bin/ or hooks/
// that holds the literal is a reader, unless a MENTIONS_ALLOWED entry (_shared/lib/optin-logs.cjs) covers that very line.
// The allowlist contract is enforced here, not only documented:
//   - every `contains` is at least 20 characters, else `contract_violations` (checked before the scan);
//   - an entry covers exactly one line (1:1): a further line holding the same `contains` is a reader;
//   - an entry that covers no line is `stale` (checked when the name is one of OPTIN_FILES);
//   - optin-logs.cjs is scanned like any file; only its definition lines (entry('...) and OPTIN_FILES) are exempt.
// The allowlist is loaded from <root>/_shared/lib/optin-logs.cjs when present, else from this repo, so tests can plant entries.
// Limit: the scan is literal. A reader that reaches the file through a constant (readFileSync(path.join(dir, LOG_FILE))) is
// invisible; the writer constants (xprov-gate.cjs, xprov-run.cjs) are pinned by their allowlist entries instead.
// Usage: check-optin-readers.cjs --name <literal> [--root <dir>]
// Output: JSON {name, readers: [{file, line, text}], allowed: [{file, line, reason}], stale: [{file, contains}],
//   contract_violations: [{file, contains, reason}]}. Exit 1 when readers, stale or contract_violations is non-empty, 0 when all are empty, 2 on usage.

const fs = require('fs');
const path = require('path');

const SCAN_ROOTS = Object.freeze(['skills', 'agents', '_shared', 'bin', 'hooks']);
const SCAN_EXTS = Object.freeze(['.md', '.cjs', '.js', '.mjs', '.sh', '.json']);
const SKIP_DIR_NAMES = Object.freeze(['node_modules']);
const SKIP_REL_DIRS = Object.freeze(['_shared/vendor']);
const MIN_CONTAINS = 20;
const TEXT_MAX = 200;
const DEFINITION = '_shared/lib/optin-logs.cjs';
const DEFINITION_LINE = /^\s*(entry\('|const OPTIN_FILES\b)/; // the allowlist defines the names it allows; nothing else in that file is exempt
const ALLOWLIST_REL = path.join('_shared', 'lib', 'optin-logs.cjs');

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

function loadAllowlist(root) {
  const planted = path.join(root, ALLOWLIST_REL);
  return require(fs.existsSync(planted) ? planted : path.join(__dirname, '..', ALLOWLIST_REL));
}

function walk(root, rel, acc) {
  let dirents;
  try { dirents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (_e) { return acc; }
  for (const d of dirents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const childRel = `${rel}/${d.name}`;
    if (d.isDirectory()) {
      if (!SKIP_DIR_NAMES.includes(d.name) && !SKIP_REL_DIRS.includes(childRel)) walk(root, childRel, acc);
    } else if (d.isFile() && SCAN_EXTS.includes(path.extname(d.name))) acc.push(childRel);
  }
  return acc;
}

function contractViolations(entries) {
  return entries
    .filter((m) => typeof m.contains !== 'string' || m.contains.length < MIN_CONTAINS)
    .map((m) => ({ file: m.file, contains: m.contains, reason: `contains is shorter than ${MIN_CONTAINS} characters` }));
}

// classify one file's lines against the entries; `used` maps an entry index to the number of lines it covers (1:1)
function scanFile(root, rel, name, entries, used) {
  const readers = []; const allowed = [];
  fs.readFileSync(path.join(root, rel), 'utf8').split('\n').forEach((text, i) => {
    if (!text.includes(name)) return;
    if (rel === DEFINITION && DEFINITION_LINE.test(text)) { allowed.push({ file: rel, line: i + 1, reason: 'allowlist definition line' }); return; }
    const idx = entries.findIndex((m, k) => m.file === rel && !used.has(k) && text.includes(m.contains));
    if (idx >= 0) { used.add(idx); allowed.push({ file: rel, line: i + 1, reason: entries[idx].reason }); }
    else readers.push({ file: rel, line: i + 1, text: text.slice(0, TEXT_MAX) });
  });
  return { readers, allowed };
}

function finish(result) {
  const bad = result.readers.length + result.stale.length + result.contract_violations.length;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(bad ? 1 : 0));
}

function main() {
  const { name, root } = parseArgs(process.argv.slice(2));
  const { MENTIONS_ALLOWED: entries, OPTIN_FILES } = loadAllowlist(root);
  const violations = contractViolations(entries);
  if (violations.length) return finish({ name, readers: [], allowed: [], stale: [], contract_violations: violations });
  const used = new Set(); let readers = []; let allowed = [];
  for (const sub of SCAN_ROOTS) {
    for (const rel of walk(root, sub, [])) {
      const r = scanFile(root, rel, name, entries, used);
      readers = readers.concat(r.readers); allowed = allowed.concat(r.allowed);
    }
  }
  const stale = OPTIN_FILES.includes(name)
    ? entries.filter((_m, k) => !used.has(k)).map((m) => ({ file: m.file, contains: m.contains }))
    : [];
  return finish({ name, readers, allowed, stale, contract_violations: [] });
}

main();
