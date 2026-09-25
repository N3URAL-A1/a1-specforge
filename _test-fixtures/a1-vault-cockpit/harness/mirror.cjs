#!/usr/bin/env node
'use strict';
// Test scaffolding for _shared/lib/vault-mirror.cjs (spec 010, Wave 2) — NOT a
// CLI. Plans (and unless --plan-only, applies) the mirror for one repo/vault
// pair and prints ONE JSON document: { pid, plan, result, events }.
//   --repo <abs> --vault <abs> --slug <s> [--plan-only] [--prune] [--record]
// --record wraps the REAL fs ops in a recording adapter: every call is
// performed AND logged, so byte assertions and event assertions run on the
// same apply. Exit 0 on success, 1 on any thrown error (message on stderr).

const fs = require('fs');
const path = require('path');
const mirror = require(path.join(__dirname, '..', '..', '..', '_shared', 'lib', 'vault-mirror.cjs'));

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

function recordingOps(events) {
  return {
    mkdirSync: (p, o) => { events.push({ op: 'mkdir', path: p }); return fs.mkdirSync(p, o); },
    writeFileSync: (p, data) => { events.push({ op: 'write', path: p }); return fs.writeFileSync(p, data); },
    renameSync: (from, to) => { events.push({ op: 'rename', from, to }); return fs.renameSync(from, to); },
    unlinkSync: (p) => { events.push({ op: 'unlink', path: p }); return fs.unlinkSync(p); },
  };
}

function main() {
  const argv = process.argv.slice(2);
  const repoRoot = argValue(argv, '--repo');
  const vaultRoot = argValue(argv, '--vault');
  const slug = argValue(argv, '--slug');
  if (!repoRoot || !vaultRoot || !slug) {
    process.stderr.write('harness/mirror.cjs: --repo, --vault and --slug are required\n');
    process.exit(1);
  }
  const events = [];
  const plan = mirror.planMirror({ repoRoot, vaultRoot, slug });
  let result = null;
  if (!argv.includes('--plan-only')) {
    const opts = { prune: argv.includes('--prune') };
    if (argv.includes('--record')) opts.fsOps = recordingOps(events);
    result = mirror.applyMirror(plan, opts);
  }
  process.stdout.write(`${JSON.stringify({ pid: process.pid, plan, result, events }, null, 2)}\n`);
}

try { main(); } catch (e) {
  process.stderr.write(`harness/mirror.cjs: ${e.message}\n`);
  process.exit(1);
}
