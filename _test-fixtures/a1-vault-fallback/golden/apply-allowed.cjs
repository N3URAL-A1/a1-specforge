'use strict';
// Applies a golden/<name>.allowed-diff to one output kind before the byte compare.
//   node apply-allowed.cjs <allowed-diff> <ext> <golden-body> <current> <out-golden> <out-current>
// replace/with: the golden line must occur EXACTLY once; it is swapped for the
//   expected new line, so the current output must carry that line in its place.
// drop-prefix: EXACTLY one current line starting with the prefix is removed.
// insert-after + line…: the golden line must occur EXACTLY once; the following
//   "line" rules are inserted after it, so the current output must carry
//   exactly those lines there (G4b: the new check #11 entry, FR-029).
// Any count other than one exits 3 — an allowance that matches nothing (or
// twice) is itself a mismatch, never a silent pass.
const fs = require('fs');
const [allowedPath, ext, goldenPath, currentPath, outGolden, outCurrent] = process.argv.slice(2);
const rules = fs.readFileSync(allowedPath, 'utf8').split('\n')
  .filter((l) => l !== '' && !l.startsWith('#'))
  .map((l) => { const [e, op, ...rest] = l.split('\t'); return { e, op, text: rest.join('\t') }; })
  .filter((r) => r.e === ext);
let golden = fs.readFileSync(goldenPath, 'utf8').split('\n');
let current = fs.readFileSync(currentPath, 'utf8').split('\n');
const die = (msg) => { process.stderr.write(`allowed-diff ${ext}: ${msg}\n`); process.exit(3); };
for (let i = 0; i < rules.length; i += 1) {
  const r = rules[i];
  if (r.op === 'replace') {
    const next = rules[i + 1];
    if (!next || next.op !== 'with') die(`replace without a following with: ${r.text}`);
    const hits = golden.filter((l) => l === r.text).length;
    if (hits !== 1) die(`golden line occurs ${hits} times (need 1): ${r.text}`);
    golden = golden.map((l) => (l === r.text ? next.text : l));
    i += 1;
  } else if (r.op === 'insert-after') {
    const lines = [];
    while (rules[i + 1] && rules[i + 1].op === 'line') { lines.push(rules[i + 1].text); i += 1; }
    if (lines.length === 0) die(`insert-after without a following line: ${r.text}`);
    const hits = golden.filter((l) => l === r.text).length;
    if (hits !== 1) die(`golden line occurs ${hits} times (need 1): ${r.text}`);
    const at = golden.indexOf(r.text) + 1;
    golden = [...golden.slice(0, at), ...lines, ...golden.slice(at)];
  } else if (r.op === 'drop-prefix') {
    const hits = current.filter((l) => l.startsWith(r.text)).length;
    if (hits !== 1) die(`current lines starting with "${r.text}": ${hits} (need 1)`);
    current = current.filter((l) => !l.startsWith(r.text));
  } else {
    die(`unknown op ${r.op}`);
  }
}
fs.writeFileSync(outGolden, golden.join('\n'));
fs.writeFileSync(outCurrent, current.join('\n'));
