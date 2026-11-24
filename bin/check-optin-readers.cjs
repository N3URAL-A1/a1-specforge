#!/usr/bin/env node
'use strict';

// check-optin-readers — spec 027 slice 5 (FR-032, D9): lists the readers of a candidate opt-in file name.
// A line in skills/**/*.md, agents/**/*.md or _shared/lib/**/*.cjs that holds the literal is a reader, unless a
// MENTIONS_ALLOWED entry (_shared/lib/optin-logs.cjs) has the same file and its `contains` occurs in that very line.
// Usage: check-optin-readers.cjs --name <literal> [--root <dir>]
// Output: JSON {name, readers: [{file, line, text}], allowed: [{file, line, reason}]}. Exit 1 when readers is non-empty, 0 when empty, 2 on usage.

const fs = require('fs');
const path = require('path');
const { MENTIONS_ALLOWED } = require(path.join(__dirname, '..', '_shared', 'lib', 'optin-logs.cjs'));

const SCANS = [['skills', '.md'], ['agents', '.md'], [path.join('_shared', 'lib'), '.cjs']];
const TEXT_MAX = 200;
const DEFINITION = '_shared/lib/optin-logs.cjs'; // the allowlist itself names the files it allows; it is not a reader

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

function walk(dir, ext, acc) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return acc; }
  for (const d of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, ext, acc);
    else if (d.isFile() && d.name.endsWith(ext)) acc.push(p);
  }
  return acc;
}

function main() {
  const { name, root } = parseArgs(process.argv.slice(2));
  const readers = []; const allowed = [];
  for (const [sub, ext] of SCANS) {
    for (const abs of walk(path.join(root, sub), ext, [])) {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (rel === DEFINITION) continue;
      fs.readFileSync(abs, 'utf8').split('\n').forEach((text, i) => {
        if (!text.includes(name)) return;
        const hit = MENTIONS_ALLOWED.find((m) => m.file === rel && text.includes(m.contains));
        if (hit) allowed.push({ file: rel, line: i + 1, reason: hit.reason });
        else readers.push({ file: rel, line: i + 1, text: text.slice(0, TEXT_MAX) });
      });
    }
  }
  process.stdout.write(`${JSON.stringify({ name, readers, allowed }, null, 2)}\n`, () => process.exit(readers.length ? 1 : 0));
}

main();
