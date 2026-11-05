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

// File -> streams checked. The dispatcher also covers the stderr write in its catch tail.
const TARGETS = {
  '_shared/a1-tools.cjs': ['stdout', 'stderr'],
  '_shared/lib/worktree.cjs': ['stdout'],
  '_shared/lib/checklist.cjs': ['stdout'],
  '_shared/lib/verify-run.cjs': ['stdout'],
  '_shared/lib/pack.cjs': ['stdout'],
  '_shared/lib/learnings.cjs': ['stdout'],
  '_shared/lib/product-cmd-progress.cjs': ['stdout'],
  '_shared/lib/product-validate.cjs': ['stdout'],
};

const violations = [];
for (const [rel, streams] of Object.entries(TARGETS)) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { violations.push(`${rel}: file missing`); continue; }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const writeRe = new RegExp(`process\\.(${streams.join('|')})\\.write\\(`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
    if (k < lines.length && /^\s*process\.exit\(/.test(lines[k])) violations.push(`${rel}:${i + 1}: process.exit() directly after a ${line.includes('stderr') ? 'stderr' : 'stdout'} write (line ${k + 1})`);
  }
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('exit-after-write guard: clean');
