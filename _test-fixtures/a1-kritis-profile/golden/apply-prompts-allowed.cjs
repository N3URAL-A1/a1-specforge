'use strict';
// Applies golden/prompts.allowed-diff to one (golden, current) pair of
// already-stripped prompt texts before the byte compare (spec
// 006-specforge-kritis-profile, FR-008). Same contract as
// ../../a1-vault-fallback/golden/apply-allowed.cjs, extended with a leading
// <file> column because prompts.allowed-diff covers six files in one list,
// not one golden at a time.
//
//   node apply-prompts-allowed.cjs <allowed-diff> <file-basename> <golden-body> <current> <out-golden> <out-current>
//
// insert-after + line…: the golden line must occur EXACTLY once; the
//   following "line" rules are inserted after it, so the current text must
//   carry exactly those lines there.
// Any count other than one exits 3 — an allowance that matches nothing (or
// twice) is itself a mismatch, never a silent pass.
const fs = require('fs');
const [allowedPath, fileBasename, goldenPath, currentPath, outGolden, outCurrent] = process.argv.slice(2);
const rules = fs
  .readFileSync(allowedPath, 'utf8')
  .split('\n')
  .filter((l) => l !== '' && !l.startsWith('#'))
  .map((l) => {
    const [file, ext, op, ...rest] = l.split('\t');
    return { file, ext, op, text: rest.join('\t') };
  })
  .filter((r) => r.file === fileBasename);
let golden = fs.readFileSync(goldenPath, 'utf8').split('\n');
const current = fs.readFileSync(currentPath, 'utf8').split('\n');
const die = (msg) => {
  process.stderr.write(`prompts-allowed-diff ${fileBasename}: ${msg}\n`);
  process.exit(3);
};
for (let i = 0; i < rules.length; i += 1) {
  const r = rules[i];
  if (r.op === 'insert-after') {
    const lines = [];
    while (rules[i + 1] && rules[i + 1].op === 'line') {
      lines.push(rules[i + 1].text);
      i += 1;
    }
    if (lines.length === 0) die(`insert-after without a following line: ${r.text}`);
    const hits = golden.filter((l) => l === r.text).length;
    if (hits !== 1) die(`golden line occurs ${hits} times (need 1): ${r.text}`);
    const at = golden.indexOf(r.text) + 1;
    golden = [...golden.slice(0, at), ...lines, ...golden.slice(at)];
  } else {
    die(`unknown op ${r.op}`);
  }
}
fs.writeFileSync(outGolden, golden.join('\n'));
fs.writeFileSync(outCurrent, current.join('\n'));
