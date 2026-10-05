'use strict';

// ---------------------------------------------------------------------------
// intent-cli — router for `a1-tools intent <sub>` (spec 011, Wave 1). The
// facade _shared/a1-tools.cjs holds one dispatch line for the group; this
// table pre-registers all 13 subcommands of Wave 1 plus `seal` (Wave 5b); all of them are
// shipped since Wave 11 (`install-agent`, intent-agent.cjs). A subcommand whose module has not
// shipped yet (or does not export its command function yet) exits 2 with
// "intent <sub>: not implemented yet (wave N)". That branch stays after every
// wave shipped: a missing or half-copied module must fail closed.
//
// Exit contract of every intent subcommand (house rule, differs from the
// facade default): 0 ok/valid · 1 refused/invalid, stdout JSON names the
// reason(s) · 2 usage error, no stdout. Human text goes to stderr only.
// Commands set process.exitCode and return instead of calling process.exit(),
// so a stdout pipe is always drained.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const { validateIntentFile } = require('./intent-validate.cjs');

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;

const INTENTS_DIR = path.join('inbox', 'intents');

function usageExit(message) {
  process.stderr.write(`usage error: ${message}\n`);
  process.stderr.write('see: a1-tools --help (section "a1-tools intent")\n');
  process.exitCode = EXIT_USAGE;
}

// The validate path must name a .md file whose realpath lies inside
// realpath($A1_VAULT_ROOT/inbox/intents) — checked before anything is read.
function locateIntentFile(arg, vault) {
  if (!arg.endsWith('.md')) return { ok: false, why: 'path must name a .md file' };
  let root;
  let real;
  try {
    root = fs.realpathSync(path.join(vault, INTENTS_DIR));
  } catch (e) {
    return { ok: false, why: `cannot resolve $A1_VAULT_ROOT/${INTENTS_DIR} (${e.code || e.message})` };
  }
  try {
    real = fs.realpathSync(path.resolve(arg));
  } catch (e) {
    return { ok: false, why: `cannot resolve ${JSON.stringify(arg.slice(0, 200))} (${e.code || e.message})` };
  }
  if (!real.startsWith(root + path.sep)) return { ok: false, why: `path is outside $A1_VAULT_ROOT/${INTENTS_DIR}/` };
  if (!fs.statSync(real).isFile()) return { ok: false, why: 'path is not a regular file' };
  return { ok: true, path: real };
}

// FR-016 — `intent validate <path>`: one JSON object on stdout, exit 0/1/2,
// never renames or spawns; its only write is the FR-033 line in
// ~/.a1-intents/log.jsonl, outside the vault.
function cmdIntentValidate(args) {
  if (args.length !== 1 || args[0].startsWith('-')) {
    usageExit('intent validate <path> (exactly one intent file, no flags)');
    return;
  }
  const vault = process.env.A1_VAULT_ROOT;
  if (!vault) {
    usageExit('A1_VAULT_ROOT is not set; intent validate only reads files under $A1_VAULT_ROOT/inbox/intents/');
    return;
  }
  const located = locateIntentFile(args[0], vault);
  if (!located.ok) {
    usageExit(`intent validate: ${located.why}`);
    return;
  }
  // Wave 4: the executor device from executor.json (approve rules, FR-006)
  // and one decision-log line per verdict (FR-033); required lazily.
  const { validateDeps } = require('./intent-lifecycle.cjs');
  const { logValidate } = require('./intent-log.cjs');
  const r = validateIntentFile(located.path, validateDeps());
  logValidate(r, located.path);
  const out = { valid: r.valid, reasons: [...r.reasons] };
  if (r.intent) out.intent = { ...r.intent };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exitCode = r.valid ? EXIT_OK : EXIT_INVALID;
}

// `intent seal` (FR-040) — no arguments; `--yes` is refused (exit 2). The
// seal itself lives in intent-seal.cjs, required lazily.
function cmdIntentSeal(args, deps = {}) {
  if (args.includes('--yes')) return usageExit('intent seal: --yes is refused; the seal needs the owner\'s confirmation on the terminal');
  if (args.length > 0) return usageExit('intent seal (takes no arguments)');
  const { sealPlugin, SealRefusal } = require('./intent-seal.cjs');
  try {
    const r = sealPlugin(deps);
    process.stdout.write(`${JSON.stringify(r)}\n`);
    process.exitCode = EXIT_OK;
    process.stderr.write(`intent seal: sealed ${r.files} files into ${r.seal_dir}\n`);
    process.stderr.write('intent seal: a LaunchAgent installed earlier still runs the previous seal; run `intent install-agent --force` to point it here (intent run and tick refuse until then).\n');
  } catch (e) {
    if (!(e instanceof SealRefusal)) throw e;
    process.stdout.write(`${JSON.stringify({ ok: false, reasons: [e.code], detail: e.message.slice(0, 300) })}\n`);
    process.exitCode = EXIT_INVALID;
    process.stderr.write(`intent seal: refused (${e.code}); nothing was sealed.\n`);
  }
  return undefined;
}

// sub -> the module and function that implement it, and the wave it ships in.
// `validate` lives here; every other module is required lazily on first use.
const SUBCOMMANDS = Object.freeze({
  validate: Object.freeze({ handler: cmdIntentValidate, wave: 1 }),
  device: Object.freeze({ module: 'intent-devices.cjs', fn: 'cmdIntentDevice', wave: 3 }),
  claim: Object.freeze({ module: 'intent-lifecycle.cjs', fn: 'cmdIntentClaim', wave: 4 }),
  reject: Object.freeze({ module: 'intent-lifecycle.cjs', fn: 'cmdIntentReject', wave: 4 }),
  complete: Object.freeze({ module: 'intent-result.cjs', fn: 'cmdIntentComplete', wave: 5 }),
  run: Object.freeze({ module: 'intent-run.cjs', fn: 'cmdIntentRun', wave: 6 }),
  tick: Object.freeze({ module: 'intent-tick.cjs', fn: 'cmdIntentTick', wave: 8 }),
  watch: Object.freeze({ module: 'intent-tick.cjs', fn: 'cmdIntentWatch', wave: 8 }),
  list: Object.freeze({ module: 'intent-tick.cjs', fn: 'cmdIntentList', wave: 8 }),
  schema: Object.freeze({ module: 'intent-schema.cjs', fn: 'cmdIntentSchema', wave: 9 }),
  doctor: Object.freeze({ module: 'intent-doctor.cjs', fn: 'cmdIntentDoctor', wave: 10 }),
  approve: Object.freeze({ module: 'intent-approve.cjs', fn: 'cmdIntentApprove', wave: 10 }),
  'install-agent': Object.freeze({ module: 'intent-agent.cjs', fn: 'cmdIntentInstallAgent', wave: 11 }),
  seal: Object.freeze({ handler: cmdIntentSeal, wave: '5b' }),
});
const SUBCOMMAND_NAMES = Object.freeze(Object.keys(SUBCOMMANDS));

function notImplemented(sub, wave) {
  process.stderr.write(`intent ${sub}: not implemented yet (wave ${wave})\n`);
  process.exitCode = EXIT_USAGE;
}

function resolveHandler(entry) {
  if (entry.handler) return entry.handler;
  const file = path.join(__dirname, entry.module);
  if (!fs.existsSync(file)) return null;
  const fn = require(file)[entry.fn];
  return typeof fn === 'function' ? fn : null;
}

function run(sub, args) {
  try {
    require('./intent-run.cjs').assertHomeConsistent(); // review MINOR-3: no command on a split home
  } catch (e) {
    if (e.code !== 'A1_HOME_SPLIT') throw e;
    process.stderr.write(`error: ${e.message} (A1_HOME_SPLIT)\n`);
    process.exitCode = EXIT_USAGE;
    return;
  }
  if (sub === undefined || !Object.prototype.hasOwnProperty.call(SUBCOMMANDS, sub)) {
    usageExit(`unknown intent subcommand: ${sub === undefined ? '(none)' : JSON.stringify(sub.slice(0, 64))} (expected one of: ${SUBCOMMAND_NAMES.join(', ')})`);
    return;
  }
  const entry = SUBCOMMANDS[sub];
  const handler = resolveHandler(entry);
  if (!handler) {
    notImplemented(sub, entry.wave);
    return;
  }
  handler(args);
}

module.exports = { run, SUBCOMMAND_NAMES, EXIT_OK, EXIT_INVALID, EXIT_USAGE };
