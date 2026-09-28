'use strict';

// stub/run-lib.cjs — fixture-only: `intent run` as a library call with one
// named change to what the builder returns (spec 011 X8, X29, X30: "injected
// deps.buildArgv wrapper"). The real builder runs first; the mutation is
// applied to its argv (or env) only, so the guard compares a changed argv
// with the values `run` itself expects. The passwd home is injected through
// intent-child's library seam, as a1-tools-as.cjs does. Prints the result
// JSON of runIntent.
//
//   node run-lib.cjs <lib-dir> <home> <claimed-file> <mutation>

const path = require('path');

const [lib, home, file, mutation] = process.argv.slice(2);
require(path.join(lib, 'intent-child.cjs')).injectChildDeps({ passwdHome: () => home });
const run = require(path.join(lib, 'intent-run.cjs'));
const argvLib = require(path.join(lib, 'intent-argv.cjs'));

const FLAG_SPAN = { '--restricted': 1, '--strict-mcp-config': 1, '--no-session-persistence': 1 };
const [kind, ...rest] = mutation.split(':');
const arg = rest.join(':');

function mutateArgv(a) {
  const argv = [...a];
  const at = (f) => argv.indexOf(f);
  switch (kind) {
    case 'none': case 'env': case 'noprimary': case 'busy': case 'tamperlate': case 'staletmp': return argv; // changes below, not in argv
    case 'drop': {
      const i = at(arg);
      if (arg === '--disallowedTools') { let j = i + 1; while (j < argv.length && !argv[j].startsWith('-')) j += 1; argv.splice(i, j - i); return argv; }
      argv.splice(i, FLAG_SPAN[arg] || 2);
      return argv;
    }
    case 'add': return [...argv, ...arg.split('|')];
    case 'set': { const [flag, value] = arg.split('='); argv[at(flag) + 1] = value.replace('@T', argv[at('--plugin-dir') + 1] + '/_shared/a1-tools.cjs'); return argv; }
    case 'allow': argv[at('--allowedTools') + 1] = `${argv[at('--allowedTools') + 1]},${arg.replace('@T', argv[at('--plugin-dir') + 1] + '/_shared/a1-tools.cjs')}`; return argv;
    case 'denydrop': argv.splice(argv.indexOf(arg), 1); return argv;
    case 'tdouble': {
      const t = `${argv[at('--plugin-dir') + 1]}/_shared/a1-tools.cjs`;
      const d = t.replace('/_shared/', '//_shared/');
      return argv.map((x) => x.split(t).join(d));
    }
    default: throw new Error(`run-lib: unknown mutation ${mutation}`);
  }
}

// noprimary: a builder that leaves the primary pair out of argv AND deny list
// (the guard must pin it itself, FR-042/FR-043).
function withoutPrimary(b, primary) {
  const pair = [`Edit(/${primary}/**)`, `Write(/${primary}/**)`];
  return { ...b, argv: b.argv.filter((x) => !pair.includes(x)), denyRules: b.denyRules.filter((x) => !pair.includes(x)) };
}

// Hooks between the snapshot and the running rewrite (deps.beforeMarkRunning):
//   busy        a ledger lock held by this (live) process: markRunning's
//               withLedgerLock gives up with A1_LEDGER_BUSY (review M1)
//   tamperlate  one byte appended to the claimed file after checkClaimed
//               (review m2 of the security review)
// staletmp: a stale registry temp file named with this pid (review m3).
const os = require('os');
const fs = require('fs');
function beforeMarkRunning(ctx) {
  if (kind === 'busy') {
    fs.writeFileSync(path.join(home, '.a1-intents', 'ledger.lock'),
      JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquired_at: new Date().toISOString(), token: 'fixture' }), { mode: 0o600 });
  }
  if (kind === 'tamperlate') fs.appendFileSync(ctx.loc.path, 'x');
}
if (kind === 'staletmp') fs.writeFileSync(path.join(home, `.a1-worktrees-registry.json.tmp.${process.pid}`), 'stale\n');

const deps = {
  beforeMarkRunning,
  buildArgv: (...a) => {
    const b = argvLib.buildArgv(...a);
    if (kind === 'noprimary') return withoutPrimary(b, a[3].primary);
    return { ...b, argv: mutateArgv(b.argv) };
  },
  buildEnv: (...a) => { const e = argvLib.buildEnv(...a); return kind === 'env' ? { ...e, [arg]: '--require=/tmp/x' } : e; },
};
run.runIntent(file, deps).then((r) => process.stdout.write(JSON.stringify(r)), (e) => { process.stdout.write(JSON.stringify({ error: e.message })); });
