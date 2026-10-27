'use strict';
// Node harness for the a1-dashboard suite: calls buildDashboard(ctx) in-process so the suite can inject
// a fixed clock, a failing rename, a forced non-writer verdict and read the open-path trace.
// Usage: node harness.cjs --cwd <dir> [--slug <s>] [--clock <ISO>] [--fail-rename] [--force-skip] [--trace <file>]
// Prints one JSON line: the buildDashboard result. Vault env comes from the caller's environment.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = { cwd: process.cwd(), slug: null, clock: '2026-10-23T09:00:00.000Z', failRename: false, forceSkip: false, trace: null };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--fail-rename') opt.failRename = true;
  else if (a === '--force-skip') opt.forceSkip = true;
  else if (a === '--cwd') opt.cwd = argv[++i];
  else if (a === '--slug') opt.slug = argv[++i];
  else if (a === '--clock') opt.clock = argv[++i];
  else if (a === '--trace') opt.trace = argv[++i];
  else throw new Error(`harness: unknown argument ${a}`);
}
const lib = path.join(process.env.A1_FX_SHARED || path.join(__dirname, '..', '..', '..', '_shared'), 'lib', 'dashboard.cjs');
const { buildDashboard } = require(lib);

const ops = { ...fs };
if (opt.failRename) ops.renameSync = () => { const e = new Error('injected rename failure'); e.code = 'EIO'; throw e; };
const trace = [];
const ctx = {
  cwd: opt.cwd, env: process.env, clock: () => new Date(opt.clock), ops, trace,
  args: { slug: opt.slug, json: true },
};
if (opt.forceSkip) ctx.writerCheck = () => ({ allow: false, reason: 'this host is not the vault writer (fx-writer ≠ other-host)' });
const result = buildDashboard(ctx);
if (opt.trace) fs.writeFileSync(opt.trace, trace.join('\n') + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
