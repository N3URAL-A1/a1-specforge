#!/usr/bin/env node
'use strict';
// node check-timeout.cjs <verify.json> <suite-groups.json>
// exit 0 when timeout_ms === ceil(max(timings.seconds) * 1000 * 1.5) (spec 027 slice 2, D13), 1 on a mismatch, 2 on unreadable input.
const fs = require('fs');
function load(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { process.stderr.write(`check-timeout: cannot read ${p}: ${e.message}\n`); process.exit(2); }
}
const [vp, gp] = process.argv.slice(2);
if (!vp || !gp) { process.stderr.write('usage: node check-timeout.cjs <verify.json> <suite-groups.json>\n'); process.exit(2); }
const cfg = load(vp);
const seconds = ((load(gp).timings || {}).seconds) || {};
const vals = Object.values(seconds).filter((n) => typeof n === 'number');
if (vals.length === 0) { process.stderr.write('check-timeout: timings.seconds is empty\n'); process.exit(2); }
const want = Math.ceil(Math.max(...vals) * 1000 * 1.5);
if (cfg.timeout_ms !== want) {
  process.stdout.write(`timeout_ms mismatch: config ${cfg.timeout_ms}, expected ${want} (ceil(max(timings.seconds) * 1000 * 1.5))\n`);
  process.exit(1);
}
process.stdout.write(`timeout_ms ${want} ok\n`);
