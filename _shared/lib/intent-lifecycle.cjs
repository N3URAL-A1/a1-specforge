'use strict';

// ---------------------------------------------------------------------------
// intent-lifecycle — executor host binding, `intent claim`, `intent reject`
// (spec 011, Wave 4: FR-017, FR-018, FR-019; log lines FR-033).
//
// Host (FR-017): ~/.a1-intents/executor.json = { executor_host,
// executor_device }, compared with the hostname BEFORE any intent is read.
// Missing file -> not_executor_host (exit 1); corrupt or linked -> operator
// error (exit 2, log line, nothing moved), as is a corrupt devices.json.
//
// claim (FR-018), under the ledger lock: one bounded read -> validate exactly
// those bytes (executor device injected) -> replay check -> renameSync
// queued/ -> claimed/ (ENOENT: another process won -> already_claimed,
// nothing written) -> rewrite the claimed file -> ledger row -> log. The
// claimed file is the validated bytes plus three claim keys, whatever
// happened to the queued file between read and rename.
//
// reject (FR-019): catalog reason (else exit 2) -> host -> rename queued/ or
// claimed/ -> rejected/<filename> (never over an existing file) -> rewrite;
// a file that does not parse or is oversized gets a header prepended and its
// bytes streamed after it. reject parses only to choose between the two and
// to name the id in the log; it never writes under project/.
//
// Rewrite: not io.writeMdAtomic, which reorders keys and re-quotes values.
// Original lines stay byte for byte, patched keys are replaced in place, new
// keys appended; the result must parse back before io.writeTextAtomic writes
// it. Nothing in this module spawns a process.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeTextAtomic } = require('./io.cjs');
const { assertVaultWriteContained, tmpPathFor } = require('./fs-safe.cjs');
const { INTENT_REJECT_REASONS } = require('./status-constants.cjs');
const { INTENT_ID_RE } = require('./intent-constants.cjs');
const { parseIntentFrontmatter, readIntentFile, validateIntentFile } = require('./intent-validate.cjs');
const { DEVICE_ID_RE, openPrivate, assertPrivateDir } = require('./intent-devices.cjs');
const { loadLedger, hasReplay, appendRow, writeLedger, withLedgerLock } = require('./intent-ledger.cjs');
const { logDecision, assertLogSafe } = require('./intent-log.cjs');

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_OPERATOR = 2;
const INTENTS_DIR = path.join('inbox', 'intents');
const EXECUTOR_FILE = path.join('.a1-intents', 'executor.json');
const COPY_CHUNK_BYTES = 64 * 1024;
const PLAIN_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const KEY_LINE_RE = /^([a-z_][a-z0-9_]*):/;

// Errors that end a command as an operator error (exit 2) with a log line.
const OPERATOR_ERRORS = Object.freeze({
  A1_DEVICES_UNREADABLE: 'devices_unreadable',
  A1_EXECUTOR_UNREADABLE: 'executor_unreadable',
});
// Errors that refuse a command (exit 1) with a reason and move nothing.
const REFUSAL_ERRORS = Object.freeze({
  A1_LEDGER_UNREADABLE: 'ledger_unreadable',
  A1_LEDGER_BUSY: 'ledger_busy',
});

const defaultDeps = () => ({
  hostname: os.hostname(),
  homedir: os.homedir,
  now: Date.now,
  rename: fs.renameSync,
  writeText: writeTextAtomic,
  validate: validateIntentFile,
  vault: process.env.A1_VAULT_ROOT || null,
});

// ---------- executor host (FR-017) ----------

function executorUnreadable(why) {
  const e = new Error(`~/${EXECUTOR_FILE} is unreadable (${why}); fix it by hand on the executor Mac`);
  e.code = 'A1_EXECUTOR_UNREADABLE';
  return e;
}

// -> { executor_host, executor_device } | null (no file). Throws on corrupt.
// ~/.a1-intents and log.jsonl must be private (A1_INTENTS_DIR_UNSAFE) before
// anything else; the file is read through one checked fd (this uid, 0600).
function executorConfig(deps = {}) {
  const dir = assertPrivateDir(deps);
  assertLogSafe(deps);
  const fd = openPrivate(path.join(dir, path.basename(EXECUTOR_FILE)), 'file', deps, executorUnreadable);
  if (fd === null) return null;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch (_e) {
    throw executorUnreadable('not JSON');
  } finally {
    fs.closeSync(fd);
  }
  const ok = doc && typeof doc === 'object' && typeof doc.executor_host === 'string' && doc.executor_host !== ''
    && typeof doc.executor_device === 'string' && DEVICE_ID_RE.test(doc.executor_device);
  if (!ok) throw executorUnreadable('needs executor_host and executor_device');
  return Object.freeze({ executor_host: doc.executor_host, executor_device: doc.executor_device });
}

// -> the config when this host is the executor, else null.
function requireExecutorHost(d) {
  const config = executorConfig(d);
  return config !== null && config.executor_host === d.hostname ? config : null;
}

// ---------- files ----------

// The path must be <root>/<folder>/<name>.md, a regular file (not a link),
// with <folder> one of `folders`. Nothing is read.
function locateLifecycleFile(arg, folders, vault) {
  if (!vault) return { ok: false, why: 'A1_VAULT_ROOT is not set' };
  if (typeof arg !== 'string' || !arg.endsWith('.md')) return { ok: false, why: 'path must name a .md file' };
  let root;
  let parent;
  try {
    root = fs.realpathSync(path.join(vault, INTENTS_DIR));
    parent = fs.realpathSync(path.dirname(path.resolve(arg)));
  } catch (e) {
    return { ok: false, why: `cannot resolve the intent folder (${e.code || e.message})` };
  }
  const folder = folders.find((f) => parent === path.join(root, f));
  if (!folder) return { ok: false, why: `path must lie directly in ${folders.map((f) => `${f}/`).join(' or ')}` };
  const file = path.join(parent, path.basename(arg));
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (st && !st.isFile()) return { ok: false, why: 'path is not a regular file' };
  return { ok: true, path: file, root, folder, missing: !st };
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const isoNow = (d) => new Date(d.now()).toISOString();

// ---------- frontmatter rewrite ----------

function yamlValue(v) {
  if (v === null || Number.isSafeInteger(v)) return String(v); // exit_code: 0 | null (Wave 5)
  const s = String(v);
  const plain = PLAIN_VALUE_RE.test(s) && !/^[0-9]+$/.test(s) && !['true', 'false', 'null'].includes(s);
  return plain ? s : JSON.stringify(s);
}

// Replaces the lines of patched keys (incl. their indented continuation
// lines), appends new keys, keeps every other line as it was. Throws when the
// result does not parse back to the patched values.
function rewriteFrontmatter(content, patch) {
  const lines = String(content).replace(/\r\n/g, '\n').split('\n');
  const close = lines.indexOf('---', 1);
  if (lines[0] !== '---' || close === -1) throw new Error('rewriteFrontmatter: no frontmatter');
  const out = [];
  const seen = new Set();
  let replacing = false;
  for (const line of lines.slice(1, close)) {
    const m = line.match(KEY_LINE_RE);
    if (m) replacing = Object.prototype.hasOwnProperty.call(patch, m[1]);
    if (m && replacing) {
      seen.add(m[1]);
      out.push(`${m[1]}: ${yamlValue(patch[m[1]])}`);
    } else if (!replacing) out.push(line);
  }
  for (const k of Object.keys(patch)) if (!seen.has(k)) out.push(`${k}: ${yamlValue(patch[k])}`);
  const next = ['---', ...out, ...lines.slice(close)].join('\n');
  const back = parseIntentFrontmatter(next);
  if (!back.ok || Object.keys(patch).some((k) => back.fm[k] !== patch[k])) throw new Error('rewriteFrontmatter: result does not parse back');
  return next;
}

// header + the original bytes, streamed (an oversized file never sits in
// memory whole), written to a tmp file and renamed over `file`.
function prependHeader(file, patch) {
  assertVaultWriteContained(file);
  const header = `---\n${Object.keys(patch).map((k) => `${k}: ${yamlValue(patch[k])}`).join('\n')}\n---\n`;
  const tmp = tmpPathFor(file);
  const out = fs.openSync(tmp, 'wx', 0o644);
  const src = fs.openSync(file, 'r');
  try {
    fs.writeSync(out, header);
    const buf = Buffer.alloc(COPY_CHUNK_BYTES);
    let n = fs.readSync(src, buf, 0, buf.length, null);
    while (n > 0) {
      fs.writeSync(out, buf, 0, n);
      n = fs.readSync(src, buf, 0, buf.length, null);
    }
  } finally {
    fs.closeSync(src);
    fs.closeSync(out);
  }
  fs.renameSync(tmp, file);
}

// rejected/<name>, or rejected/<stem>.<ms>.md when that name is taken.
function freeRejectedPath(root, name, d) {
  const first = path.join(root, 'rejected', name);
  if (!fs.existsSync(first)) return first;
  return path.join(root, 'rejected', `${path.basename(name, '.md')}.${d.now()}.md`);
}

// ---------- decisions ----------

function decide(d, command, exitCode, out, log) {
  logDecision({ command, hostname: d.hostname, ...log }, { homedir: d.homedir, now: d.now });
  return Object.freeze({ exitCode, out });
}

// Maps a thrown operator or refusal error to a logged decision; rethrows
// everything else (no silent catch). An unsafe ~/.a1-intents cannot carry a
// log line: exit 2 with the reason on stderr, nothing logged.
function decideError(d, command, intentId, e) {
  const code = e && e.code;
  if (code === 'A1_INTENTS_DIR_UNSAFE') return Object.freeze({ exitCode: EXIT_OPERATOR, out: null, stderr: e.message });
  if (Object.prototype.hasOwnProperty.call(OPERATOR_ERRORS, code)) {
    const r = decide(d, command, EXIT_OPERATOR, null, { intentId, outcome: 'error', reason: OPERATOR_ERRORS[code] });
    return Object.freeze({ ...r, stderr: e.message });
  }
  if (Object.prototype.hasOwnProperty.call(REFUSAL_ERRORS, code)) {
    const reason = REFUSAL_ERRORS[code];
    return decide(d, command, EXIT_REFUSED, { [`${command}ed`]: false, reasons: [reason] }, { intentId, outcome: 'refused', reason });
  }
  throw e;
}

function refuseClaim(d, intentId, reasons, extra = {}) {
  return decide(d, 'claim', EXIT_REFUSED, { claimed: false, reasons }, { intentId, outcome: 'refused', reason: reasons.join(','), ...extra });
}

// One read through the validator's own reader (one descriptor, O_NOFOLLOW,
// bounded), then validate exactly those bytes; null when the file is gone
// (another process claimed or rejected it first).
function readAndValidate(file, config, d) {
  try {
    const read = readIntentFile(file);
    const content = read.ok ? read.content : null;
    const inject = read.ok ? { readFile: () => content } : {};
    const v = d.validate(file, { ...inject, homedir: d.homedir, now: d.now, executorDevice: config.executor_device });
    return { content, v };
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

function claimLocked(loc, config, d) {
  const name = path.basename(loc.path);
  const read = loc.missing ? null : readAndValidate(loc.path, config, d);
  if (read === null) return refuseClaim(d, name, ['already_claimed']);
  const { content, v } = read;
  const intentId = v.intent && typeof v.intent.id === 'string' ? v.intent.id : name;
  const logged = { payloadSha256: v.payloadSha256 || undefined, detail: v.detail || undefined };
  if (!v.valid) return refuseClaim(d, intentId, [...v.reasons], logged);
  const { fm } = parseIntentFrontmatter(content);
  const { rows } = loadLedger({ homedir: d.homedir });
  const dest = path.join(loc.root, 'claimed', name);
  if (hasReplay(rows, fm)) return refuseClaim(d, intentId, ['replay'], logged);
  if (fs.existsSync(dest)) return refuseClaim(d, intentId, ['already_claimed'], logged);
  const claimedAt = isoNow(d);
  const text = rewriteFrontmatter(content, { status: 'claimed', claimed_by: d.hostname, claimed_at: claimedAt });
  try {
    d.rename(loc.path, dest);
  } catch (e) {
    if (e && e.code === 'ENOENT') return refuseClaim(d, intentId, ['already_claimed'], logged);
    throw e;
  }
  d.writeText(dest, text);
  const row = {
    id: fm.id, device: fm.created_by, nonce: fm.nonce, action: fm.action, project: fm.project, claimed_at: claimedAt,
    claimed_sha256: sha256(text), started_at: null, finished_at: null, outcome: 'claimed', result_path: null, result_sha256: null,
  };
  writeLedger(appendRow(rows, row), { homedir: d.homedir });
  return decide(d, 'claim', EXIT_OK, { claimed: true, id: fm.id, path: dest }, { intentId, outcome: 'claimed', reason: null, ...logged });
}

// FR-018 -> { exitCode, out, stderr? }; the log line is written here.
function claimIntent(filePath, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const name = path.basename(String(filePath));
  try {
    const config = requireExecutorHost(d);
    if (config === null) return refuseClaim(d, name, ['not_executor_host']);
    const loc = locateLifecycleFile(filePath, ['queued'], d.vault);
    if (!loc.ok) return Object.freeze({ exitCode: EXIT_OPERATOR, out: null, usage: `intent claim: ${loc.why}` });
    return withLedgerLock(() => claimLocked(loc, config, d), { homedir: d.homedir, hostname: d.hostname, now: d.now });
  } catch (e) {
    return decideError(d, 'claim', name, e);
  }
}

function rejectPatch(reason, d) {
  return { status: 'rejected', rejected_reason: reason, rejected_by: d.hostname, rejected_at: isoNow(d) };
}

// Reads through the validator's reader, so an oversized or non-regular file
// is never read; -> { content, parsed } | null (null: prepend a header).
function readForReject(file) {
  const read = readIntentFile(file);
  const parsed = read.ok ? parseIntentFrontmatter(read.content) : { ok: false };
  return parsed.ok ? { content: read.content, parsed } : null;
}

function rejectMoved(loc, reason, d) {
  const name = path.basename(loc.path);
  const read = readForReject(loc.path);
  const idOk = read && typeof read.parsed.fm.id === 'string' && INTENT_ID_RE.test(read.parsed.fm.id);
  const intentId = idOk ? read.parsed.fm.id : name;
  const dest = freeRejectedPath(loc.root, name, d);
  const patch = rejectPatch(reason, d);
  try {
    d.rename(loc.path, dest);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return decide(d, 'reject', EXIT_REFUSED, { rejected: false, reasons: ['already_moved'] }, { intentId, outcome: 'refused', reason: 'already_moved' });
    }
    throw e;
  }
  if (read) d.writeText(dest, rewriteFrontmatter(read.content, patch));
  else prependHeader(dest, patch);
  return decide(d, 'reject', EXIT_OK, { rejected: true, reason, path: dest }, { intentId, outcome: 'rejected', reason });
}

// FR-019 -> { exitCode, out, usage?, stderr? }. `reason` is checked first.
function rejectIntent(filePath, reason, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!INTENT_REJECT_REASONS.has(reason)) {
    return Object.freeze({ exitCode: EXIT_OPERATOR, out: null, usage: `intent reject: --reason must be one of ${[...INTENT_REJECT_REASONS].join(', ')}` });
  }
  const name = path.basename(String(filePath));
  try {
    if (requireExecutorHost(d) === null) {
      return decide(d, 'reject', EXIT_REFUSED, { rejected: false, reasons: ['not_executor_host'] }, { intentId: name, outcome: 'refused', reason: 'not_executor_host' });
    }
    const loc = locateLifecycleFile(filePath, ['queued', 'claimed'], d.vault);
    if (!loc.ok || loc.missing) return Object.freeze({ exitCode: EXIT_OPERATOR, out: null, usage: `intent reject: ${loc.ok ? 'no such file' : loc.why}` });
    return rejectMoved(loc, reason, d);
  } catch (e) {
    return decideError(d, 'reject', name, e);
  }
}

// ---------- CLI ----------

function emit(r) {
  if (r.usage) {
    process.stderr.write(`usage error: ${r.usage}\n`);
    process.stderr.write('see: a1-tools --help (section "a1-tools intent")\n');
  }
  if (r.stderr) process.stderr.write(`${r.stderr}\n`);
  if (r.out) process.stdout.write(`${JSON.stringify(r.out, null, 2)}\n`);
  process.exitCode = r.exitCode;
}
const usage = (text) => emit({ exitCode: EXIT_OPERATOR, out: null, usage: text });

// `a1-tools intent claim <path>`
function cmdIntentClaim(args) {
  if (args.length !== 1 || args[0].startsWith('-')) return usage('intent claim <path> (exactly one queued/ intent file)');
  return emit(claimIntent(args[0]));
}

// `a1-tools intent reject <path> --reason <code>`
function cmdIntentReject(args) {
  const i = args.indexOf('--reason');
  const rest = args.filter((_a, j) => j !== i && j !== i + 1);
  if (i === -1 || args[i + 1] === undefined || rest.length !== 1 || rest[0].startsWith('-')) {
    return usage('intent reject <path> --reason <code>');
  }
  return emit(rejectIntent(rest[0], args[i + 1]));
}

// For `intent validate` (intent-cli): the executor device, when configured.
// A corrupt executor.json leaves it null (approve fails closed) and says so.
function validateDeps(deps = {}) {
  try {
    const config = executorConfig(deps);
    return { executorDevice: config === null ? null : config.executor_device };
  } catch (e) {
    if (e && e.code === 'A1_EXECUTOR_UNREADABLE') {
      process.stderr.write(`warning: ${e.message}; approve intents are treated as not from the executor device\n`);
      return { executorDevice: null };
    }
    throw e;
  }
}

module.exports = {
  executorConfig, rewriteFrontmatter, claimIntent, rejectIntent, cmdIntentClaim, cmdIntentReject, validateDeps,
  requireExecutorHost, locateLifecycleFile, decide, decideError, emit, freeRejectedPath, // for intent-result (complete)
};
