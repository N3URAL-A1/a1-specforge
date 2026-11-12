#!/usr/bin/env node
'use strict';
// ux-studio gate (spec 024, FR-009..FR-012). Runs the pinned Impeccable detector on an
// HTML target plus a font-license check, and writes gate-record.json + the run.md block.
//
//   run    --run-dir <d> --target <html>            exit 0 pass / 1 blocking / 2 usage|hostile / 3 gate error
//   accept --run-dir <d> --finding <id> --reason <text>   exit 0 / 2   (TTY only; writes the acceptance into the gate store)
//   handoff-check --run-dir <d>                     exit 0 allowed / 1 blocked (one reason per line) / 2 usage
//   A new `run` rewrites the record, so earlier acceptances are reset (fail closed).
//   gate-record.json is not trusted on its own: `run` and `accept` also write the gate store (gate-store.cjs, outside the run
//   folder) and handoff-check compares the record with it.
//
// Fail closed: a spawn error, a signal, exit 1, an unparseable result or a missing severity
// can never produce `pass`. This script never computes contrast; the detector decides.

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkFonts } = require('./font-check.cjs');
const { checkHandoff } = require('./handoff-check.cjs');
const store = require('./gate-store.cjs');
const { terminalProblem } = require('./terminal-guard.cjs');
const { resultTasteVaultProblems } = require('../taste/board-guard.cjs');

const RECORD_FILE = 'gate-record.json';
const MARK_START = '<!-- gate-record:start -->';
const MARK_END = '<!-- gate-record:end -->';
const MAX_ARG = 4096;
const MAX_REASON = 1000;
const MAX_TARGET_BYTES = 5 * 1024 * 1024;
const MAX_DETAIL = 200;
const ID_RE = /^[a-z0-9][a-z0-9._@:-]{0,120}$/;
const WAIVER_RE = /impeccable-disable|impeccable-ignore/i;
const EXIT = { PASS: 0, BLOCKING: 1, USAGE: 2, ERROR: 3 };

class UsageError extends Error {}

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'impeccable.json'), 'utf8'));
const ALLOWLIST = JSON.parse(fs.readFileSync(path.join(__dirname, 'font-allowlist.json'), 'utf8'));

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!/^--[a-z-]+$/.test(key || '') || i + 1 >= rest.length) throw new UsageError(`bad argument near "${String(key).slice(0, 40)}"`);
    opts[key.slice(2)] = rest[i + 1];
  }
  return { cmd, opts };
}

function cleanPathArg(name, value) {
  if (typeof value !== 'string' || value === '') throw new UsageError(`--${name} is required`);
  if (value.length > MAX_ARG) throw new UsageError(`--${name} exceeds ${MAX_ARG} characters`);
  if (value.includes('\0')) throw new UsageError(`--${name} contains a NUL byte`);
  if (value.split(/[\\/]/).includes('..')) throw new UsageError(`--${name} contains a ".." segment`);
  return value;
}

function resolveRunDir(value) {
  const raw = cleanPathArg('run-dir', value);
  let real;
  try { real = fs.realpathSync(path.resolve(raw)); } catch (_) { throw new UsageError('--run-dir does not exist'); }
  if (!fs.statSync(real).isDirectory()) throw new UsageError('--run-dir is not a directory');
  return real;
}

function resolveTarget(value) {
  const raw = cleanPathArg('target', value);
  let real;
  try { real = fs.realpathSync(path.resolve(raw)); } catch (_) { throw new UsageError('--target does not exist'); }
  const st = fs.statSync(real);
  if (!st.isFile()) throw new UsageError('--target is not a regular file');
  if (!/\.html?$/i.test(real)) throw new UsageError('--target must be an .html file');
  if (st.size > MAX_TARGET_BYTES) throw new UsageError(`--target exceeds ${MAX_TARGET_BYTES} bytes`);
  return real;
}

function safeText(value, max) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1f]/g, '').slice(0, max);
}

/** Map one detector entry. No severity field -> primary (fail closed). */
function mapFinding(entry, index, seen) {
  const f = CONFIG.fields;
  const rule = safeText(entry && entry[f.rule], 80) || 'unknown-rule';
  const n = (seen[rule] || 0) + 1;
  const sev = entry && typeof entry[f.severity] === 'string' ? entry[f.severity] : null;
  const line = Number.isFinite(entry && entry[f.line]) ? entry[f.line] : 0;
  const file = safeText(entry && entry[f.file], 500);
  return {
    seen: { ...seen, [rule]: n },
    finding: {
      id: `${rule.replace(/[^a-z0-9._-]/gi, '-').toLowerCase()}-${n}`,
      rule,
      severity: sev === f.advisory_severity_value ? 'advisory' : 'primary',
      location: `${path.basename(file) || 'target'}:${line}`,
      state: 'open',
      reason: null,
      detail: safeText(entry && entry[f.detail], MAX_DETAIL),
    },
  };
}

function mapFindings(entries) {
  return entries.reduce((acc, entry, i) => {
    const r = mapFinding(entry, i, acc.seen);
    return { seen: r.seen, list: [...acc.list, r.finding] };
  }, { seen: {}, list: [] }).list;
}

const REGISTRY_FLAG = '--registry=https://registry.npmjs.org';
const STEERING_ENV_RE = /^(?:IMPECCABLE_|npm_config_)/i;

/** Explicit env: every IMPECCABLE_* and npm_config_* / NPM_CONFIG_* variable removed, so no outer setting steers the detector or the registry npx downloads it from. */
function detectorEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !STEERING_ENV_RE.test(k)));
}

function spawnDetector(target, scratch) {
  const res = spawnSync('npx', [REGISTRY_FLAG, CONFIG.pin, 'detect', ...CONFIG.detect_flags, '--json', target], {
    cwd: scratch,
    env: detectorEnv(process.env),
    encoding: 'utf8',
    timeout: CONFIG.timeout_ms,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return res;
}

/** Interpret a spawn result -> {exit_code, status, cause, findings}. Never returns pass on doubt. */
function interpret(res) {
  const fail = (cause, exit_code = null) => ({ exit_code, status: 'error', cause, findings: [] });
  if (res.error) {
    const why = res.error.code === 'ENOENT' ? 'npx not found on PATH' : res.error.code === 'ETIMEDOUT' ? `detector timed out after ${CONFIG.timeout_ms} ms` : `spawn failed: ${res.error.message}`;
    return fail(safeText(why, 300));
  }
  if (res.signal) return fail(`detector killed by signal ${res.signal}`);
  const code = res.status;
  if (code !== CONFIG.exit_codes.pass && code !== CONFIG.exit_codes.primary_findings) {
    return fail(safeText(`detector exited ${code}: ${(res.stderr || '').trim()}`, 300), code);
  }
  let parsed;
  try { parsed = JSON.parse(res.stdout); } catch (_) { parsed = null; }
  if (!Array.isArray(parsed)) return fail(`detector exit ${code} produced no JSON array`, code);
  const findings = mapFindings(parsed);
  const primary = findings.filter((f) => f.severity === 'primary').length;
  if (code === CONFIG.exit_codes.pass) {
    if (primary > 0) return fail('detector exit 0 but reported primary findings (inconsistent output)', code);
    return { exit_code: code, status: 'pass', cause: null, findings };
  }
  const withFallback = primary > 0 ? findings : [...findings, { id: 'detector-exit-2-1', rule: 'detector-exit-2', severity: 'primary', location: 'target:0', state: 'open', reason: null, detail: 'exit 2 without a primary finding in the JSON' }];
  return { exit_code: code, status: 'findings', cause: 'detector reported primary findings', findings: withFallback };
}

function buildRecord(target, scan, fonts, sha) {
  let status = scan.status;
  let cause = scan.cause;
  if (status === 'pass' && fonts.status === 'fail') { status = 'findings'; cause = 'font check failed'; }
  return {
    gate_id: 'ux-studio-gate',
    impeccable_version: CONFIG.version,
    scan_mode: CONFIG.scan_mode,
    target,
    target_sha256: sha,
    exit_code: scan.exit_code,
    status,
    cause,
    findings: scan.findings,
    font_check: fonts,
    created: new Date().toISOString(),
  };
}

function esc(value) { return safeText(value, 300).replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderBlock(rec) {
  const lines = [MARK_START, `status: ${rec.status}`, `impeccable: ${rec.impeccable_version} (${rec.scan_mode})`, `exit_code: ${rec.exit_code}`];
  if (rec.cause) lines.push(`cause: ${esc(rec.cause)}`);
  for (const f of rec.findings) lines.push(`- [${f.state}] ${esc(f.id)} ${f.severity} ${esc(f.rule)} @ ${esc(f.location)}${f.reason ? ` (reason: ${esc(f.reason)})` : ''}`);
  lines.push(`font_check: ${rec.font_check.status}`);
  for (const x of rec.font_check.failures) lines.push(`- [${x.state}] font ${esc(x.font)} ${x.reason}${x.reason_text && x.state === 'accepted' ? ` (reason: ${esc(x.reason_text)})` : ''}`);
  lines.push(MARK_END);
  return lines.join('\n');
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function persist(runDir, rec) {
  const mdPath = path.join(runDir, 'run.md');
  const md = fs.readFileSync(mdPath, 'utf8');
  const s = md.indexOf(MARK_START);
  const e = md.indexOf(MARK_END);
  if (s < 0 || e < s || md.indexOf(MARK_START, s + 1) >= 0) throw new UsageError('run.md must carry exactly one gate-record marker pair');
  const next = md.slice(0, s) + renderBlock(rec) + md.slice(e + MARK_END.length);
  writeAtomic(path.join(runDir, RECORD_FILE), `${JSON.stringify(rec, null, 2)}\n`);
  writeAtomic(mdPath, next);
}

function requireRunMd(runDir) {
  const md = path.join(runDir, 'run.md');
  if (!fs.existsSync(md) || !fs.statSync(md).isFile()) throw new UsageError('--run-dir has no run.md (not a run folder)');
}

function sha256Of(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch (_) { return null; }
}

function cmdRun(opts) {
  const runDir = resolveRunDir(opts['run-dir']);
  const target = resolveTarget(opts.target);
  requireRunMd(runDir);
  const bytes = fs.readFileSync(target);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const html = bytes.toString('utf8');
  if (WAIVER_RE.test(html)) throw new UsageError('target carries an impeccable ignore/waiver marker; findings must be fixed, not waived in the file');
  const vaultHits = resultTasteVaultProblems(path.join(runDir, 'result'), html, process.env.A1_VAULT_ROOT);
  if (vaultHits.length > 0) throw new UsageError(`result breaks the taste-vault rule: ${safeText(vaultHits.join('; '), 400)}`);
  const scratch = fs.mkdtempSync(path.join(runDir, '.gate-scratch-'));
  let scan;
  try { scan = interpret(spawnDetector(target, scratch)); } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  if (scan.status !== 'error' && sha256Of(target) !== sha) scan = { exit_code: scan.exit_code, status: 'error', cause: 'target changed while the detector ran', findings: [] };
  const rec = buildRecord(target, scan, checkFonts(html, ALLOWLIST), sha);
  store.recordRun(runDir, rec); // the store line first: a record without it never passes handoff, and a failing store aborts the run (exit 3)
  persist(runDir, rec);
  process.stdout.write(`ux-studio-gate: ${rec.status}${rec.cause ? ` (${rec.cause})` : ''}\n`);
  if (rec.status === 'pass') return EXIT.PASS;
  return rec.status === 'error' ? EXIT.ERROR : EXIT.BLOCKING;
}

const FONT_PREFIX = 'font:';

/** Accept primary findings (`<rule>-<n>`) or font failures (`font:<family>`); returns the new record. */
function applyAccept(rec, id, reason) {
  if (id.startsWith(FONT_PREFIX)) {
    const name = id.slice(FONT_PREFIX.length);
    const hits = rec.font_check.failures.filter((x) => x.font === name);
    if (hits.length === 0) throw new UsageError(`no font failure "${name}"`);
    if (hits.every((x) => x.state !== 'open')) throw new UsageError(`font failure "${name}" is already ${hits[0].state}`);
    const failures = rec.font_check.failures.map((x) => (x.font === name && x.state === 'open' ? { ...x, state: 'accepted', reason_text: reason, accepted_by: 'tty' } : x));
    return { ...rec, font_check: { ...rec.font_check, failures } };
  }
  const hit = rec.findings.find((f) => f.id === id);
  if (!hit) throw new UsageError(`no finding "${id}"`);
  if (hit.state !== 'open') throw new UsageError(`finding "${id}" is already ${hit.state}`);
  return { ...rec, findings: rec.findings.map((f) => (f.id === id ? { ...f, state: 'accepted', reason, accepted_by: 'tty' } : f)) };
}

function validFindingId(id) {
  if (typeof id !== 'string') return false;
  if (id.startsWith(FONT_PREFIX)) return id.length > FONT_PREFIX.length && id.length <= 220 && !/[\x00-\x1f]/.test(id);
  return ID_RE.test(id);
}

function shq(v) { return `'${String(v).replace(/'/g, `'\\''`)}'`; }

/** accept is Robert's decision: it needs a real terminal AND no Claude Code context (a pty alone is fakeable). The check lives in
 *  terminal-guard.cjs because gate-store.cjs recordAccept runs the same one. */
function requireTerminal(opts) {
  const why = terminalProblem();
  if (why === null) return;
  const cmd = `node ${shq(__filename)} accept --run-dir ${shq(opts['run-dir'] || '<run-dir>')} --finding ${shq(opts.finding || '<finding-id>')} --reason ${shq('<written reason>')}`;
  throw new UsageError(`accept needs Robert at a real terminal outside Claude Code: ${why}. Do not run it yourself; hand Robert this exact command for his own terminal:\n${cmd}`);
}

function cmdAccept(opts) {
  requireTerminal(opts);
  const runDir = resolveRunDir(opts['run-dir']);
  requireRunMd(runDir);
  const id = opts.finding;
  if (!validFindingId(id)) throw new UsageError('--finding is not a valid finding id');
  const reason = typeof opts.reason === 'string' ? opts.reason.trim() : '';
  if (!reason) throw new UsageError('--reason must not be empty');
  if (reason.length > MAX_REASON) throw new UsageError(`--reason exceeds ${MAX_REASON} characters`);
  let rec;
  try { rec = JSON.parse(fs.readFileSync(path.join(runDir, RECORD_FILE), 'utf8')); } catch (_) { throw new UsageError('no readable gate-record.json; run the gate first'); }
  if (!rec || rec.gate_id !== 'ux-studio-gate' || !Array.isArray(rec.findings) || !rec.font_check || !Array.isArray(rec.font_check.failures)) throw new UsageError('gate-record.json is not a ux-studio-gate record');
  const mismatch = store.recordMismatch(runDir, rec);
  if (mismatch) throw new UsageError(`${mismatch}; nothing accepted`);
  const text = safeText(reason, MAX_REASON);
  const next = applyAccept(rec, id, text);
  store.recordAccept(runDir, rec, id, text); // the store line first: an accepted record without it never passes handoff
  persist(runDir, next);
  process.stdout.write(`accepted ${safeText(id, 120)}\n`);
  return EXIT.PASS;
}

function cmdHandoffCheck(opts) {
  const runDir = resolveRunDir(opts['run-dir']);
  requireRunMd(runDir);
  const { blockers, notes } = checkHandoff(runDir);
  for (const n of notes) process.stdout.write(`${n}\n`);
  if (blockers.length === 0) { process.stdout.write('handoff allowed\n'); return EXIT.PASS; }
  for (const b of blockers) process.stdout.write(`blocked: ${b}\n`);
  return EXIT.BLOCKING;
}

function main(argv) {
  try {
    const { cmd, opts } = parseArgs(argv);
    if (cmd === 'run') return cmdRun(opts);
    if (cmd === 'accept') return cmdAccept(opts);
    if (cmd === 'handoff-check') return cmdHandoffCheck(opts);
    throw new UsageError('usage: ux-gate.cjs run --run-dir <d> --target <html> | accept --run-dir <d> --finding <id> --reason <text> | handoff-check --run-dir <d>');
  } catch (err) {
    if (err instanceof UsageError) { process.stderr.write(`ux-gate: ${err.message}\n`); return EXIT.USAGE; }
    process.stderr.write(`ux-gate: gate error: ${safeText(err && err.message, 300)}\n`);
    return EXIT.ERROR;
  }
}

process.exitCode = main(process.argv.slice(2));
