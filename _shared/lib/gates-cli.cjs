'use strict';

// ---------------------------------------------------------------------------
// gates-cli — dispatch of the `gates` command group (spec 017: `gates lint`
// (Wave 1), `gates lint --log` and `gates fired --log` (Wave 2)). Every path ends in process.exit with 0 / 1 / 2:
//   0  every named skill calls its gate (or the row carries a live exemption)
//   1  at least one finding
//   2  usage error, unknown flag, hostile value, unreadable root or registry
// Findings go to stderr one per line; a JSON report goes to stdout.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseFlags, repoRoot } = require('./io.cjs');
const { lintGates } = require('./gates-lint.cjs');
const { verifyChain } = require('./gate-log.cjs');
const { readGateLog, firedYaml } = require('./retro-gatelog.cjs');

const MAX_ARG_LENGTH = 4096;
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function die(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
}

function checkArg(name, value) {
  if (typeof value !== 'string' || value === '') die(`--${name} needs a value`);
  if (value.length > MAX_ARG_LENGTH) die(`--${name} is too long`);
  if (value.includes('\0')) die(`--${name} contains a NUL byte`);
  return value;
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function resolveInputs(flags) {
  let root;
  try {
    root = flags.root !== undefined ? path.resolve(process.cwd(), checkArg('root', flags.root)) : repoRoot();
  } catch (e) {
    die(`cannot resolve repo root: ${e.message}`);
  }
  try {
    if (!fs.statSync(root).isDirectory()) die(`--root is not a directory: ${root}`);
  } catch (_e) {
    die(`--root not found: ${root}`);
  }
  const registry = flags.registry !== undefined
    ? path.resolve(process.cwd(), checkArg('registry', flags.registry))
    : path.join(root, '_shared', 'gates-registry.md');
  let registryText;
  try {
    if (!fs.statSync(registry).isFile()) die(`registry is not a regular file: ${registry}`);
    if (fs.statSync(registry).size > MAX_REGISTRY_BYTES) die(`registry too large: ${registry}`);
    registryText = fs.readFileSync(registry, 'utf8');
  } catch (_e) {
    die(`registry unreadable: ${registry}`);
  }
  let today = utcToday();
  if (flags.today !== undefined) {
    today = checkArg('today', flags.today);
    if (!DATE_RE.test(today)) die('--today must be YYYY-MM-DD');
  }
  return { root, registry, registryText, today };
}

function formatFinding(f) {
  const where = [f.skill ? `skill ${f.skill}` : '', f.searched ? `searched ${f.searched.join(', ')}` : ''].filter(Boolean).join('; ');
  return `finding: ${f.gate || '-'} — ${f.rule}: ${f.reason}${where ? ` (${where})` : ''}`;
}

/** `gates lint --log <file>`: shape + hash chain of one gate log (FR-010). */
function cmdGatesLintLog(file) {
  const logPath = path.resolve(process.cwd(), checkArg('log', file));
  let result;
  try {
    result = verifyChain(logPath);
  } catch (_e) {
    die(`gate log unreadable: ${logPath}`);
  }
  process.stdout.write(`${JSON.stringify({ log: logPath, lines: result.lines, problems: result.problems })}\n`);
  for (const p of result.problems) process.stderr.write(`finding: ${p.rule} at line ${p.line}: ${p.reason}\n`);
  process.exit(result.ok ? 0 : 1);
}

/** `gates fired --log <file>`: print the gates_fired YAML block derived from the log. */
function cmdGatesFired(argv) {
  const flags = parseFlags(argv, { log: 'string' });
  if (flags._.length > 0) die(`unexpected argument: ${flags._[0]} (usage: gates fired --log <file>)`);
  if (flags.log === undefined) die('gates fired needs --log <file>');
  const logPath = path.resolve(process.cwd(), checkArg('log', flags.log));
  let log;
  try {
    log = readGateLog(logPath);
  } catch (e) {
    die(e.message);
  }
  process.stdout.write(firedYaml(log.records));
  process.exit(0);
}

function cmdGatesLint(argv) {
  const flags = parseFlags(argv, { root: 'string', registry: 'string', today: 'string', log: 'string' });
  if (flags._.length > 0) die(`unexpected argument: ${flags._[0]} (usage: gates lint [--root <path>] [--registry <path>] [--today YYYY-MM-DD] | gates lint --log <file>)`);
  if (flags.log !== undefined) return cmdGatesLintLog(flags.log);
  const inputs = resolveInputs(flags);
  const report = lintGates({
    registryText: inputs.registryText,
    skillsRoot: path.join(inputs.root, 'skills'),
    today: inputs.today,
  });
  const out = {
    root: inputs.root, registry: inputs.registry, today: inputs.today,
    rows: report.rows, wired: report.wired, exemptions: report.exemptions, findings: report.findings,
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  for (const e of report.exemptions) process.stderr.write(`exemption: ${e.gate} until ${e.until} — ${e.reason}\n`);
  for (const f of report.findings) process.stderr.write(`${formatFinding(f)}\n`);
  process.exit(report.findings.length > 0 ? 1 : 0);
}

/** @param {string} sub @param {string[]} rest */
function cmdGates(sub, rest) {
  if (sub === 'lint') return cmdGatesLint(rest);
  if (sub === 'fired') return cmdGatesFired(rest);
  return die(`unknown gates subcommand: ${sub === undefined ? '(none)' : sub} (expected "lint" or "fired")`);
}

module.exports = { cmdGates, cmdGatesLint };
