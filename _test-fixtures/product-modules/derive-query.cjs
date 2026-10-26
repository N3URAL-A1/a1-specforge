'use strict';
// usage: node derive-query.cjs <case> cursors|module-next <id>|project-next
// Drives the REAL exported functions on the in-memory cases.
const path = require('path'); const fs = require('fs'); const os = require('os');
// Never mirror into the real vault: point it at a path that is never created.
process.env.A1_VAULT_ROOT = path.join(os.tmpdir(), `a1-no-vault-${process.pid}`);
const root = path.resolve(__dirname, '../../_shared/lib');
const { regenerateDerived } = require(path.join(root, 'product-derived.cjs'));
const m = require(path.join(root, 'product-modules.cjs'));
const { cases } = require('./derive-cases.cjs');
const [name, what, id] = process.argv.slice(2);
const fm = cases[name];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dq-'));
const { indexJson, nextMd } = regenerateDerived(dir, fm);
fs.rmSync(dir, { recursive: true, force: true });
if (what === 'project-next') process.stdout.write(nextMd);
else if (what === 'module-next') process.stdout.write(m.renderModuleNext(id, { features: indexJson.features, milestones: fm.milestones }, '2026-01-01'));
else if (what === 'cursors') {
  for (const mod of m.modulesInUse(fm)) console.log(`${mod}=${m.moduleCursor(mod, indexJson.features, fm.milestones)}`);
}
