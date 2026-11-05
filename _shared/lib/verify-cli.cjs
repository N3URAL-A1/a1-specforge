'use strict';

// `verify` command group (spec 017 FR-011..FR-014, FR-018). Every path ends in
// process.exit with 0 / 1 / 2:
//   verify run   0 verdict pass / 1 verdict fail / 2 usage, no_test_command,
//                env_missing, bad config, unreadable project (JSON error on stdout)
//   verify check 0 ok / 1 refused / 2 usage (see verify-check.cjs)
// stdout is one JSON object; `--out <file>` also writes it as `verify_run` into
// the frontmatter of that VERIFICATION.md (other keys and the body are kept).

const fs = require('fs');
const path = require('path');
const { parseFlags } = require('./io.cjs');
const { emitExit } = require('./emit-exit.cjs');
const { readMd, writeMdAtomic } = require('./io-frontmatter.cjs');
const { VerifyError, runVerify, MAX_TIMEOUT_MS } = require('./verify-run.cjs');
const { cmdVerifyCheck } = require('./verify-check.cjs');

const KNOWN_FLAGS = { project: 'string', base: 'string', out: 'string', 'timeout-ms': 'string', 'no-cache': 'bool' };
const MAX_ARG_LENGTH = 4096;

/** Report a failure and exit 2 once the streams drained. Callers `return fail(...)`. */
function fail(reason, message) {
  return emitExit(2, `${JSON.stringify({ ok: false, error: reason, message })}\n`, `verify: ${reason}: ${message}\n`);
}

function parseArgs(args) {
  const flags = parseFlags(args, KNOWN_FLAGS);
  if (flags._.length > 0) throw new VerifyError('usage', `unexpected argument ${JSON.stringify(flags._[0])}`);
  for (const [k, v] of Object.entries(flags)) {
    if (k === '_' || k === 'no-cache') continue;
    if (typeof v !== 'string' || v === '' || v.length > MAX_ARG_LENGTH || v.includes('\0')) throw new VerifyError('usage', `--${k} needs a plain value`);
  }
  let timeoutMs;
  if (flags['timeout-ms'] !== undefined) {
    timeoutMs = Number(flags['timeout-ms']);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw new VerifyError('usage', '--timeout-ms must be an integer in 1..86400000');
  }
  return { project: path.resolve(process.cwd(), flags.project || '.'), base: flags.base, out: flags.out, timeoutMs, noCache: flags['no-cache'] === true };
}

/** Writes `verify_run` into the frontmatter of `file`, keeping every other key and the body. */
function writeOut(file, record) {
  const abs = path.resolve(process.cwd(), file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const existing = fs.existsSync(abs) ? readMd(abs) : { fm: {}, body: '' };
  writeMdAtomic(abs, { ...existing.fm, verify_run: record }, existing.body);
  return abs;
}

function cmdVerifyRun(args) {
  let opts;
  try {
    opts = parseArgs(args);
  } catch (e) {
    if (e instanceof VerifyError) return fail(e.reason, e.message);
    throw e;
  }
  let isDir = false;
  try {
    isDir = fs.statSync(opts.project).isDirectory();
  } catch (_e) {
    return fail('usage', `--project not found: ${opts.project}`);
  }
  if (!isDir) return fail('usage', `--project is not a directory: ${opts.project}`);
  let record;
  let text;
  try {
    record = runVerify(opts);
    const written = opts.out ? writeOut(opts.out, record) : null;
    text = `${JSON.stringify({ ok: record.verdict === 'pass', ...record, out: written })}\n`;
  } catch (e) {
    if (e instanceof VerifyError) return fail(e.reason, e.message);
    return fail('internal', e.message);
  }
  return emitExit(record.verdict === 'pass' ? 0 : 1, text, '');
}

/** @param {string|undefined} sub @param {string[]} rest */
function cmdVerify(sub, rest) {
  if (sub === 'run') return cmdVerifyRun(rest);
  if (sub === 'check') return cmdVerifyCheck(rest);
  return emitExit(2, '', 'usage: a1-tools verify run [--project <dir>] [--base <ref>] [--out <VERIFICATION.md>] [--timeout-ms <n>] [--no-cache] | verify check <VERIFICATION.md>\n');
}

module.exports = { cmdVerify, writeOut };
