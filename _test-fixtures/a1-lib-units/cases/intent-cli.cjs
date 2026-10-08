'use strict';

// intent-cli.cjs — the router of `a1-tools intent <sub>` (spec 011). Exit
// contract: 0 ok · 1 refused/invalid (JSON on stdout) · 2 usage error, no
// stdout. Cases run the router in-process with stdout/stderr captured; the
// passwd home is injected through intent-child's library seam (the same one
// _test-fixtures/a1-intent/stub/a1-tools-as.cjs uses), never by a variable.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const work = fs.mkdtempSync(path.join(process.argv[3], 'cli-'));

// Runs fn with stdout/stderr captured; -> { code, out, err }.
function capture(fn) {
  const w = { out: process.stdout.write, err: process.stderr.write };
  let out = '';
  let err = '';
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  process.exitCode = undefined;
  try { fn(); } finally { process.stdout.write = w.out; process.stderr.write = w.err; }
  const code = process.exitCode;
  process.exitCode = undefined;
  return { code, out, err };
}

// I0 — before the seam: HOME (the suite's temp home) is not the passwd home.
// Red-making change: dropping the assertHomeConsistent() call from run().
const CLI = require(path.join(LIB, 'intent-cli.cjs'));
{
  const r = capture(() => CLI.run('list', []));
  eq('I0 split home refused with exit 2', r.code, 2);
  check('I0 names A1_HOME_SPLIT', /A1_HOME_SPLIT/.test(r.err), r.err);
  eq('I0 no stdout', r.out, '');
}

require(path.join(LIB, 'intent-child.cjs')).injectChildDeps({ passwdHome: () => os.homedir() });

eq('I1 subcommand names', CLI.SUBCOMMAND_NAMES, ['validate', 'device', 'claim', 'reject', 'complete', 'run', 'tick', 'watch', 'list', 'schema', 'doctor', 'approve', 'install-agent', 'seal']);
eq('I1 exit codes', [CLI.EXIT_OK, CLI.EXIT_INVALID, CLI.EXIT_USAGE], [0, 1, 2]);

const usage = (name, sub, args, re) => {
  let r;
  try { r = capture(() => CLI.run(sub, args)); } catch (e) { r = { code: `threw ${e.message.slice(0, 80)}`, out: '', err: '' }; }
  check(`${name}: exit 2, no stdout`, r.code === 2 && r.out === '', `code ${r.code}, out ${JSON.stringify(r.out.slice(0, 120))}`);
  if (re) check(`${name}: message`, re.test(r.err), r.err);
};

// I2 — unknown subcommands; only own keys of the table route.
// Red-making change: testing `sub in SUBCOMMANDS` instead of hasOwnProperty.
usage('I2 no subcommand', undefined, [], /unknown intent subcommand: \(none\)/);
usage('I2 unknown subcommand', 'deploy', [], /unknown intent subcommand: "deploy"/);
usage('I2 __proto__', '__proto__', [], /unknown intent subcommand/);
usage('I2 constructor', 'constructor', [], /unknown intent subcommand/);
{
  const r = capture(() => CLI.run('x'.repeat(10000), []));
  check('I2 oversized name clipped to 64 chars', r.code === 2 && r.err.includes(`"${'x'.repeat(64)}"`) && !r.err.includes('x'.repeat(65)), r.err.slice(0, 200));
}

// I3 — validate: argument and location checks, all before anything is read.
const vault = path.join(work, 'vault');
const intents = path.join(vault, 'inbox', 'intents');
fs.mkdirSync(path.join(intents, 'queued'), { recursive: true });
fs.mkdirSync(path.join(intents, 'dir.md'));
fs.writeFileSync(path.join(work, 'outside.md'), '---\ntype: intent\n---\n');
fs.symlinkSync(path.join(work, 'outside.md'), path.join(intents, 'queued', 'link.md'));
const withVault = (v, fn) => { const b = process.env.A1_VAULT_ROOT; if (v === undefined) delete process.env.A1_VAULT_ROOT; else process.env.A1_VAULT_ROOT = v; try { return fn(); } finally { if (b === undefined) delete process.env.A1_VAULT_ROOT; else process.env.A1_VAULT_ROOT = b; } };

withVault(vault, () => {
  usage('I3 validate without a path', 'validate', [], /exactly one intent file/);
  usage('I3 validate with two paths', 'validate', ['a.md', 'b.md'], /exactly one intent file/);
  usage('I3 validate with a flag', 'validate', ['--json'], /exactly one intent file/);
  usage('I3 not a .md file', 'validate', [path.join(intents, 'queued', 'x.txt')], /must name a \.md file/);
  usage('I3 path outside the intents dir', 'validate', [path.join(work, 'outside.md')], /outside \$A1_VAULT_ROOT\/inbox\/intents/);
  usage('I3 traversal out of the intents dir', 'validate', [path.join(intents, '..', '..', '..', 'outside.md')], /outside/);
  // Red-making change: checking the lexical path instead of its realpath.
  usage('I3 symlink inside pointing outside', 'validate', [path.join(intents, 'queued', 'link.md')], /outside/);
  usage('I3 directory named .md', 'validate', [path.join(intents, 'dir.md')], /not a regular file/);
  usage('I3 missing file', 'validate', [path.join(intents, 'queued', 'nope.md')], /cannot resolve/);
  usage('I3 injection-shaped name', 'validate', [path.join(intents, 'queued', '$(touch PWNED).md')], /cannot resolve/);
});
withVault(undefined, () => usage('I3 A1_VAULT_ROOT unset', 'validate', [path.join(intents, 'queued', 'x.md')], /A1_VAULT_ROOT is not set/));
withVault(path.join(work, 'no-vault'), () => usage('I3 vault without inbox/intents', 'validate', [path.join(work, 'outside.md')], /cannot resolve \$A1_VAULT_ROOT/));

// I4 — a real file inside: one JSON verdict on stdout, exit 1 when invalid.
withVault(vault, () => {
  fs.writeFileSync(path.join(intents, 'queued', 'bad.md'), '---\ntype: intent\n---\n');
  const r = capture(() => CLI.run('validate', [path.join(intents, 'queued', 'bad.md')]));
  let doc = null;
  try { doc = JSON.parse(r.out); } catch (_e) { /* asserted below */ }
  check('I4 invalid intent: exit 1 with JSON verdict', r.code === 1 && doc !== null && doc.valid === false && Array.isArray(doc.reasons) && doc.reasons.length > 0, `code ${r.code}, out ${r.out.slice(0, 200)}, err ${r.err.slice(0, 200)}`);
});

// I5 — seal refuses --yes and any argument (usage, nothing sealed).
usage('I5 seal --yes refused', 'seal', ['--yes'], /--yes is refused/);
usage('I5 seal with an argument', 'seal', ['now'], /takes no arguments/);

// I6 — a subcommand whose module is missing fails closed (exit 2), in a copy
// of _shared/lib without intent-schema.cjs.
// Red-making change: resolveHandler requiring the module without the existsSync check (throws instead).
{
  const copy = path.join(work, 'lib-copy');
  fs.cpSync(LIB, copy, { recursive: true });
  fs.unlinkSync(path.join(copy, 'intent-schema.cjs'));
  require(path.join(copy, 'intent-child.cjs')).injectChildDeps({ passwdHome: () => os.homedir() });
  const CLI2 = require(path.join(copy, 'intent-cli.cjs'));
  let r;
  try { r = capture(() => CLI2.run('schema', [])); } catch (e) { r = { code: 'threw', out: '', err: e.message }; }
  check('I6 missing module: exit 2 "not implemented yet (wave 9)"', r.code === 2 && r.out === '' && /intent schema: not implemented yet \(wave 9\)/.test(r.err), `code ${r.code}, err ${r.err}`);
}

done();
