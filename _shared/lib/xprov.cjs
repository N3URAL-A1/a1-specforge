'use strict';

// ---------------------------------------------------------------------------
// xprov — facade for `a1-tools xprov <sub>` (spec 009-cross-provider-review-gate,
// Wave 1; frozen afterwards).
//
// This module owns exactly four things and nothing else:
//   1. the dispatch table for all thirteen subcommands (lazy `require` per
//      module — a subcommand whose module has not shipped yet exits 2 with
//      `not implemented yet (planned wave N)`, which is what makes every later
//      wave's fixture part RED on its first run without touching the facade);
//   2. the shared constants every xprov module reads instead of hardcoding:
//      reason codes, the secret-pattern list, the instruction-marker list, the
//      two gate ids, the runner modes a1 is allowed to use;
//   3. the path helpers (xprov home, artifacts, snapshots, the VENDORED runner
//      resolved relative to this file — never from the Claude plugin cache —
//      and the dedicated CODEX_HOME);
//   4. the runner pin check (`checkRunnerPin`): the one place that decides
//      whether the vendored `runner.py` still matches `SHA256SUMS`. Fails
//      closed: an unreadable pin file is a mismatch, never a skip.
//
// Pure at module load: no file I/O, no process I/O until a function is called.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ---------- exit contract (house rule for every xprov subcommand) ----------
// stdout JSON is the machine contract; every human sentence goes to stderr.
const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

// ---------- subcommand map: sub -> { module, export, wave } ----------
// Sole-writer rule from the wave plan: each module is written by exactly one
// wave. The facade only knows the file name and the exported command function.
const SUBCOMMANDS = Object.freeze({
  normalize: Object.freeze({ module: 'xprov-normalize.cjs', fn: 'cmdXprovNormalize', wave: 2 }),
  gc: Object.freeze({ module: 'xprov-artifacts.cjs', fn: 'cmdXprovGc', wave: 3 }),
  preflight: Object.freeze({ module: 'xprov-preflight.cjs', fn: 'cmdXprovPreflight', wave: 4 }),
  'init-home': Object.freeze({ module: 'xprov-preflight.cjs', fn: 'cmdXprovInitHome', wave: 4 }),
  'permit-check': Object.freeze({ module: 'xprov-permit.cjs', fn: 'cmdXprovPermitCheck', wave: 4 }),
  permit: Object.freeze({ module: 'xprov-permit.cjs', fn: 'cmdXprovPermit', wave: 4 }),
  observe: Object.freeze({ module: 'xprov-observe.cjs', fn: 'cmdXprovObserve', wave: 4 }),
  snapshot: Object.freeze({ module: 'xprov-snapshot.cjs', fn: 'cmdXprovSnapshot', wave: 5 }),
  run: Object.freeze({ module: 'xprov-run.cjs', fn: 'cmdXprovRun', wave: 5 }),
  gate: Object.freeze({ module: 'xprov-gate.cjs', fn: 'cmdXprovGate', wave: 6 }),
  'load-check': Object.freeze({ module: 'xprov-gate.cjs', fn: 'cmdXprovLoadCheck', wave: 6 }),
  'wave-status': Object.freeze({ module: 'xprov-gate.cjs', fn: 'cmdXprovWaveStatus', wave: 6 }),
  waive: Object.freeze({ module: 'xprov-gate.cjs', fn: 'cmdXprovWaive', wave: 6 }),
});
const SUBCOMMAND_NAMES = Object.freeze(Object.keys(SUBCOMMANDS));

// ---------- reason codes (stdout `reason` on exit 1) ----------
const REASON_LIST = Object.freeze([
  'runner_failed', 'malformed', 'wrong_mode', 'blocked', 'plan_changed', 'tripwire',
  'secret_in_snapshot', 'secret_in_output', 'quarantined', 'round_cap',
  'external_review_not_permitted', 'snapshot_failed', 'not_logged_in',
]);
const REASONS = Object.freeze(Object.fromEntries(REASON_LIST.map((r) => [r, r])));

// ---------- verdicts the facade hands to the workflows ----------
const VERDICTS = Object.freeze({ PASS: 'pass', FAIL_WITH_FINDINGS: 'fail-with-findings', FAIL: 'fail' });

// ---------- gate ids (rows in _shared/gates-registry.md) ----------
const GATE_IDS = Object.freeze({ PLAN_REVIEW: 'plan-review-xprov', WAVE_INSPECT: 'wave-inspect-xprov' });
const GATE_ID_LIST = Object.freeze(Object.values(GATE_IDS));

// ---------- runner usage limits (FR-024) ----------
const RUNNER_MODES = Object.freeze(['review', 'inspect']);
const RUNNER_MODES_ALLOWED = Object.freeze(['review', 'inspect', 'check']);
const FORBIDDEN_RUNNER_TOKENS = Object.freeze(['build', '--unreviewed-spec', '--proof']);
const RUNNER_HOST = 'claude';

// ---------- numeric limits shared by later waves ----------
const ARTIFACT_MAX_AGE_DAYS = 14; // decided 2026-09-24 (FR-020)
const ROUND_CAP = 2; // FR-006
const MAX_FIELD_CHARS = 10000; // FR-028 size guard for one string field
const MAX_RESULT_BYTES = 5 * 1024 * 1024; // FR-028 bound on the JSON read
const TITLE_MAX_CHARS = 120; // FR-012
const MODEL_REQUESTED_DEFAULT = 'CLI default (unresolved)'; // FR-013
const MODEL_OBSERVED_UNKNOWN = 'unknown'; // FR-013

// ---------- secret patterns (verbatim from the spec's hardening section, FR-018) ----------
// Consumers report `name` only — never the matched text.
const SECRET_PATTERNS = Object.freeze([
  Object.freeze({ name: 'private_key_header', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ }),
  Object.freeze({ name: 'aws_access_key_id', re: /AKIA[0-9A-Z]{16}/ }),
  Object.freeze({ name: 'sk_prefixed_key', re: /sk-[A-Za-z0-9]{20,}/ }),
  Object.freeze({ name: 'github_pat_classic', re: /ghp_[A-Za-z0-9]{36}/ }),
  Object.freeze({ name: 'slack_token', re: /xox[bp]-/ }),
  Object.freeze({ name: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ }),
  Object.freeze({ name: 'pem_begin', re: /-----BEGIN/ }),
  Object.freeze({ name: 'secret_assignment', re: /(api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{12,}/i }),
]);

// ---------- instruction markers (FR-019; compared against lowercased text) ----------
const INSTRUCTION_MARKERS = Object.freeze([
  'run ', 'curl ', 'wget ', 'rm ', 'delete ', 'chmod ', 'git push',
  'ignore previous', 'disregard', 'you must now', 'execute ',
]);

// ---------- path helpers (pure path math; nothing is created here) ----------
const XPROV_HOME_DIRNAME = '.a1-xprov';
const CODEX_HOME_ENV = 'A1_XPROV_CODEX_HOME';
const DEFAULT_CODEX_HOME_DIRNAME = '.codex-a1-review';
const RUNNER_FILE = 'runner.py';
const SUMS_FILE = 'SHA256SUMS';

function xprovHome() {
  return path.join(os.homedir(), XPROV_HOME_DIRNAME);
}

function artifactsDir(slug) {
  return path.join(xprovHome(), 'artifacts', String(slug));
}

function snapshotsDir() {
  return path.join(xprovHome(), 'snapshots');
}

function vendorDir() {
  return path.resolve(__dirname, '..', 'vendor', 'claudex-loop');
}

function vendoredRunnerPath() {
  return path.join(vendorDir(), RUNNER_FILE);
}

function vendoredSumsPath() {
  return path.join(vendorDir(), SUMS_FILE);
}

// Control characters (incl. NUL) and DEL in a path override are never legitimate.
const CONTROL_CHAR_RE = /[\0-\x1f\x7f]/;

function inputError(reason, message) {
  const err = new Error(message);
  err.code = 'A1_INPUT'; // the facade prints these as user errors (exit 2)
  err.reason = reason;
  return err;
}

/** Dedicated Codex home: `A1_XPROV_CODEX_HOME` or `~/.codex-a1-review`. The
 * override must be an absolute path (no `~` expansion — a shell expands it, a
 * literal `~` here is a mistake) with no control characters, and is
 * `path.resolve()`d so that `…/.codex-a1-review/../.codex` reads as the
 * global home it is; preflight (Wave 4) then compares by realpath. */
function codexHome(env) {
  const e = env || process.env;
  const raw = e[CODEX_HOME_ENV];
  if (raw === undefined || String(raw).trim() === '') {
    return path.join(os.homedir(), DEFAULT_CODEX_HOME_DIRNAME);
  }
  const value = String(raw);
  if (CONTROL_CHAR_RE.test(value)) {
    throw inputError('codex_home_invalid', `${CODEX_HOME_ENV} contains control characters`);
  }
  if (!path.isAbsolute(value)) {
    throw inputError('codex_home_not_absolute',
      `${CODEX_HOME_ENV} must be an absolute path ('~' is not expanded); got ${JSON.stringify(describeSub(value))}`);
  }
  return path.resolve(value);
}

// ---------- runner pin ----------

/** Parse `shasum -a 256` output: `<64 hex>  <name>` (or `<hex> *<name>`) per
 * line. Returns a fresh {name: sha} object; blank lines and `#` comments are
 * ignored, anything else is skipped rather than guessed. */
function parseSha256Sums(text) {
  const out = {};
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Compare the vendored runner with its pin. Never throws; every failure is
 * a typed `reason` so preflight (Wave 4) and the fixture can name it. An
 * unreadable SHA256SUMS or an unpinned runner is `ok: false` — fail closed. */
function checkRunnerPin(opts) {
  const runnerPath = (opts && opts.runnerPath) || vendoredRunnerPath();
  const sumsPath = (opts && opts.sumsPath) || vendoredSumsPath();
  const base = { ok: false, runnerPath, sumsPath, expected: null, actual: null };
  let sums;
  try {
    sums = parseSha256Sums(fs.readFileSync(sumsPath, 'utf8'));
  } catch (_e) {
    return { ...base, reason: 'sums_unreadable' };
  }
  const expected = sums[path.basename(runnerPath)] || null;
  if (!expected) return { ...base, reason: 'not_pinned' };
  let actual;
  try {
    actual = sha256File(runnerPath);
  } catch (_e) {
    return { ...base, expected, reason: 'runner_unreadable' };
  }
  if (actual !== expected) return { ...base, expected, actual, reason: 'mismatch' };
  return { ...base, ok: true, expected, actual, reason: null };
}

// ---------- dispatch ----------

const SUB_ECHO_MAX = 80; // a hostile 10 000-char subcommand name is not echoed whole

function describeSub(sub) {
  const s = String(sub == null ? '' : sub).replace(/[\0\r\n]/g, '?');
  return s.length > SUB_ECHO_MAX ? `${s.slice(0, SUB_ECHO_MAX)}… (${s.length} chars)` : s;
}

function usageExit(msg) {
  process.stderr.write(`usage error: xprov ${msg}\n`);
  process.stderr.write(`  subcommands: ${SUBCOMMAND_NAMES.join(', ')}\n`);
  process.stderr.write('  see: a1-tools --help (section "a1-tools xprov")\n');
  process.exit(EXIT_USAGE);
}

/** `a1-tools xprov <sub> [args]`. Owns exit 2 for unknown/missing subcommands
 * and for modules that have not shipped yet; everything else is delegated to
 * the module's command function, which owns its own exit code and stdout. */
function cmdXprov(sub, args) {
  if (sub === undefined || sub === '' || sub === '--help' || sub === '-h') {
    return usageExit('<sub> is required');
  }
  const entry = Object.prototype.hasOwnProperty.call(SUBCOMMANDS, sub) ? SUBCOMMANDS[sub] : null;
  if (!entry) return usageExit(`unknown subcommand: ${JSON.stringify(describeSub(sub))}`);
  const modulePath = path.join(__dirname, entry.module);
  if (!fs.existsSync(modulePath)) {
    process.stderr.write(`xprov ${sub}: not implemented yet (planned wave ${entry.wave})\n`);
    process.exit(EXIT_USAGE);
  }
  const mod = require(modulePath);
  if (typeof mod[entry.fn] !== 'function') {
    process.stderr.write(`xprov ${sub}: ${entry.module} does not export ${entry.fn}()\n`);
    process.exit(EXIT_USAGE);
  }
  return mod[entry.fn](Array.isArray(args) ? [...args] : []);
}

module.exports = {
  EXIT_PASS, EXIT_FAIL, EXIT_USAGE,
  SUBCOMMANDS, SUBCOMMAND_NAMES,
  REASONS, REASON_LIST, VERDICTS,
  GATE_IDS, GATE_ID_LIST,
  RUNNER_MODES, RUNNER_MODES_ALLOWED, FORBIDDEN_RUNNER_TOKENS, RUNNER_HOST,
  ARTIFACT_MAX_AGE_DAYS, ROUND_CAP, MAX_FIELD_CHARS, MAX_RESULT_BYTES, TITLE_MAX_CHARS,
  MODEL_REQUESTED_DEFAULT, MODEL_OBSERVED_UNKNOWN,
  SECRET_PATTERNS, INSTRUCTION_MARKERS,
  CODEX_HOME_ENV, RUNNER_FILE, SUMS_FILE,
  xprovHome, artifactsDir, snapshotsDir, vendorDir, vendoredRunnerPath, vendoredSumsPath, codexHome,
  parseSha256Sums, sha256File, checkRunnerPin,
  cmdXprov,
};
