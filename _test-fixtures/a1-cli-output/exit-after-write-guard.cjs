'use strict';
// Source guard for fix 2026-11-05-stdout-pipe-truncation.
// Usage: node exit-after-write-guard.cjs <repo-root>
// Exit 0 = clean, 1 = a stdout/stderr write is followed directly by process.exit().
// Platform neutral: reads source text, so it also catches the defect on Linux where
// pipes are synchronous and the truncation itself cannot be reproduced.
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) { console.error('usage: exit-after-write-guard.cjs <repo-root>'); process.exit(2); }

// Every _shared/**/*.cjs file is scanned (no hand-kept target list). stdout is checked everywhere:
// that is where large payloads go. stderr is checked only where the stream carries the whole
// failure report of the dispatcher; the short usage/fail messages elsewhere stay on
// process.exit() (follow-up sweep, each is far below one pipe buffer).
const STDERR_FILES = new Set(['_shared/a1-tools.cjs']);
// Explicit exceptions: "file:statement-start-line-text" -> reason. Empty on purpose.
const EXCEPTIONS = {};

function listCjs(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') listCjs(full, out); }
    else if (e.name.endsWith('.cjs')) out.push(full);
  }
  return out;
}
const sharedDir = path.join(root, '_shared');
const TARGETS = {};
for (const f of listCjs(sharedDir, [])) {
  const rel = path.relative(root, f).split(path.sep).join('/');
  TARGETS[rel] = STDERR_FILES.has(rel) ? ['stdout', 'stderr'] : ['stdout'];
}
// the emit helper itself must exist, or the scan proves nothing
if (!TARGETS['_shared/lib/emit-exit.cjs']) { console.error('emit-exit.cjs missing'); process.exit(1); }

const violations = [];
for (const [rel, streams] of Object.entries(TARGETS)) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { violations.push(`${rel}: file missing`); continue; }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const writeRe = new RegExp(`process\\.(${streams.join('|')})\\.write\\(`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // comments
    // same line: `write(...); process.exit(` (the verify-run one-liner)
    if (writeRe.test(line) && /process\.exit\(/.test(line)) { violations.push(`${rel}:${i + 1}: write and process.exit on one line`); continue; }
    if (!writeRe.test(line)) continue;
    // A write statement may span lines; find its last line by paren balance, then the next code line.
    let depth = 0; let j = i; let started = false;
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) { if (ch === '(') { depth++; started = true; } else if (ch === ')') depth--; }
      if (started && depth <= 0) break;
    }
    let k = j + 1;
    while (k < lines.length && (lines[k].trim() === '' || lines[k].trim().startsWith('//'))) k++;
    if (k < lines.length && /^\s*(process\.exit|exitWithLock)\(/.test(lines[k])) if (!EXCEPTIONS[`${rel}:${line.trim()}`]) violations.push(`${rel}:${i + 1}: process.exit() directly after a ${line.includes('stderr') ? 'stderr' : 'stdout'} write (line ${k + 1})`);
  }
}

// Cross-function shape (found in profile-ears: printResult() writes, its caller exits next line).
// Same-file only: a top-level function whose body writes to stdout, called as a statement on a line
// directly followed by process.exit( / exitWithLock(. Helpers imported from other files are not
// followed (the guard does not resolve requires); the repo sweep found none that matter
// (xprov-common emitJson writes with fs.writeSync, which is synchronous and safe).
for (const rel of Object.keys(TARGETS)) {
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
  const writers = new Set();
  for (let i = 0; i < lines.length; i++) {
    const fm = /^(?:async )?function (\w+)\(/.exec(lines[i]);
    if (!fm) continue;
    let j = i;
    while (j < lines.length && !/^}/.test(lines[j])) j++;
    if (lines.slice(i, j + 1).some((x) => /process\.stdout\.write\(/.test(x) && !/^\s*(\/\/|\*)/.test(x))) writers.add(fm[1]);
  }
  for (let i = 0; i < lines.length - 1; i++) {
    const c = /^\s*(?:return\s+)?(\w+)\(.*\);\s*$/.exec(lines[i]);
    if (!c || !writers.has(c[1])) continue;
    let k = i + 1;
    while (k < lines.length && (lines[k].trim() === '' || /^\s*\/\//.test(lines[k]))) k++;
    if (/^\s*(process\.exit|exitWithLock)\(/.test(lines[k]) && !EXCEPTIONS[`${rel}:${lines[i].trim()}`]) {
      violations.push(`${rel}:${i + 1}: ${c[1]}() writes to stdout and process.exit() follows (line ${k + 1})`);
    }
  }
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('exit-after-write guard: clean');
