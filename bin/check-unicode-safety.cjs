#!/usr/bin/env node
// Fails when a tracked instruction or config text file holds an invisible or bidi control character:
// such a character can hide an instruction from the human reader. Idea: affaan-m/ECC check-unicode-safety (MIT).
// Usage: node bin/check-unicode-safety.cjs [--self-test]    exit 0 clean, 1 hits, 2 usage or git error
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TEXT_EXT_RE = /\.(md|json|ya?ml|txt)$/i;
// soft hyphen, letter marks, zero width + direction marks, bidi embeddings and isolates, word joiner, BOM, tags
const BAD_RE = /[­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{e0000}-\u{e007f}]/u;
function scan(root, files) {
  const hits = [];
  for (const file of files.filter((f) => TEXT_EXT_RE.test(f))) {
    fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, i) => {
      const m = BAD_RE.exec(line);
      if (m) hits.push(`${file}:${i + 1}: U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    });
  }
  return hits;
}
function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-unicode-'));
  try {
    fs.writeFileSync(path.join(dir, 'clean.md'), 'plain text\numlauts äöü and emoji ✅ are fine\n');
    fs.writeFileSync(path.join(dir, 'bad.md'), 'line one\nhidden‮ here\n');
    fs.writeFileSync(path.join(dir, 'skip.bin'), 'not a text format​\n');
    const got = scan(dir, ['clean.md', 'bad.md', 'skip.bin']).join('|');
    if (got !== 'bad.md:2: U+202E') { console.error(`self-test FAILED: got "${got}"`); return 1; }
    console.log('self-test ok');
    return 0;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function main(argv) {
  if (argv.length === 1 && argv[0] === '--self-test') return selfTest();
  if (argv.length) { console.error('usage: check-unicode-safety.cjs [--self-test]'); return 2; }
  const root = path.resolve(__dirname, '..');
  let files;
  try { files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean); }
  catch (e) { console.error(`git ls-files failed: ${e.message}`); return 2; }
  const hits = scan(root, files);
  hits.forEach((h) => console.error(h));
  console.log(`unicode-safety: ${hits.length} hit(s) in ${files.filter((f) => TEXT_EXT_RE.test(f)).length} text files`);
  return hits.length ? 1 : 0;
}
process.exit(main(process.argv.slice(2)));
