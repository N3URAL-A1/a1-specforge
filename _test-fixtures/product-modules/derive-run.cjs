'use strict';
// usage: node derive-run.cjs <case> <outDir> [--raw]
// Runs regenerateDerived on an in-memory case; writes masked index.json +
// NEXT.md (generated / updated masked) to <outDir>.
const fs = require('fs'); const path = require('path'); const os = require('os');
const root = path.resolve(__dirname, '../../_shared/lib');
const { regenerateDerived } = require(path.join(root, 'product-derived.cjs'));
const { cases } = require('./derive-cases.cjs');
const [name, out] = process.argv.slice(2);
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-'));
const { indexJson, nextMd } = regenerateDerived(emptyDir, cases[name]);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ ...indexJson, generated: 'MASKED' }, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'NEXT.md'), nextMd.replace(/^updated: .*$/m, 'updated: MASKED'));
if (typeof require(path.join(root, 'product-derived.cjs')).regenerateDerived !== 'function') process.exit(2);
