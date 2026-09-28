'use strict';

// ---------------------------------------------------------------------------
// intent-log — the decision log outside the vault (spec 011, Wave 4: FR-033).
//
//   ~/.a1-intents/log.jsonl   mode 0600, one JSON object per line, append-only
//
// Every decision of validate, claim, run, complete, reject, approve and tick
// is one line: ts, command, intent_id (or the filename when there is no id),
// outcome, reason, hostname; optional detail, payload_sha256, argv, env_names.
// The payload itself never reaches this file: logDecision accepts only the
// keys in ENTRY_KEYS and throws on anything else — explicitly on `payload`,
// so no caller can pass the frontmatter or the payload by accident.
// The file is resolved per call (never at module load); a home directory that
// lies inside $A1_VAULT_ROOT is refused, like devices.json.
//
// MAJOR-D (security review of waves 4–5): ~/.a1-intents must pass
// assertPrivateDir (0700, this uid) before every append, and log.jsonl is
// opened O_APPEND|O_CREAT|O_NOFOLLOW at 0600 and fstat'ed (regular file,
// this uid, no group/other bit) — a symlinked or loosened log is refused
// with A1_INTENTS_DIR_UNSAFE, never followed. `intent_id` is logged only
// when it is a UUID (INTENT_ID_RE); any other id or file name is attacker
// chosen, so the line carries intent_id null and name_sha256 instead.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { INTENT_ID_RE } = require('./intent-constants.cjs');
const { assertPrivateDir } = require('./intent-devices.cjs');

const DIR_NAME = '.a1-intents';
const FILE_NAME = 'log.jsonl';
const FILE_MODE = 0o600;
const { O_WRONLY, O_APPEND, O_CREAT, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
const APPEND_FLAGS = O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW | O_NONBLOCK;

// input key -> output key, in output order.
const ENTRY_KEYS = Object.freeze({
  command: 'command',
  intentId: 'intent_id',
  nameSha256: 'name_sha256',
  outcome: 'outcome',
  reason: 'reason',
  hostname: 'hostname',
  detail: 'detail',
  payloadSha256: 'payload_sha256',
  argv: 'argv',
  envNames: 'env_names',
});
const REQUIRED_KEYS = Object.freeze(['command', 'intentId', 'outcome', 'reason', 'hostname']);
const OPTIONAL_KEYS = Object.freeze(['nameSha256', 'detail', 'payloadSha256', 'argv', 'envNames']);
const CALLER_KEYS = Object.freeze(Object.keys(ENTRY_KEYS).filter((k) => k !== 'nameSha256'));

function fieldError(message) {
  const e = new Error(`logDecision: ${message}`);
  e.code = 'A1_LOG_FIELD';
  return e;
}

function logPath(homedir = os.homedir) {
  return path.join(homedir(), DIR_NAME, FILE_NAME);
}

function assertOutsideVault(dir) {
  const vault = process.env.A1_VAULT_ROOT;
  if (!vault) return;
  let vaultReal;
  try {
    vaultReal = fs.realpathSync(vault);
  } catch (_e) {
    return; // no vault on disk: nothing to write into
  }
  const parentReal = fs.realpathSync(path.dirname(dir));
  if (parentReal === vaultReal || parentReal.startsWith(vaultReal + path.sep)) {
    throw fieldError(`refusing to write ~/${DIR_NAME}/${FILE_NAME}: the home directory lies inside $A1_VAULT_ROOT`);
  }
}

// -> the line object; throws A1_LOG_FIELD on a forbidden or unknown key.
function buildEntry(entry, now) {
  if (entry === null || typeof entry !== 'object') throw fieldError('entry must be an object');
  const keys = Object.keys(entry);
  if (keys.includes('payload')) throw fieldError('a payload is never logged (log its sha256 as payloadSha256)');
  const unknown = keys.filter((k) => !CALLER_KEYS.includes(k));
  if (unknown.length > 0) throw fieldError(`unknown key(s): ${unknown.map((k) => k.slice(0, 32)).join(', ')}`);
  const missing = REQUIRED_KEYS.filter((k) => !keys.includes(k));
  if (missing.length > 0) throw fieldError(`missing key(s): ${missing.join(', ')}`);
  const named = { ...entry, ...idFields(entry.intentId) };
  const line = { ts: new Date(now()).toISOString() };
  for (const k of REQUIRED_KEYS) line[ENTRY_KEYS[k]] = named[k] === undefined ? null : named[k];
  for (const k of OPTIONAL_KEYS) if (named[k] !== undefined && named[k] !== null) line[ENTRY_KEYS[k]] = named[k];
  return line;
}

// A UUID is logged as is; anything else only as the sha256 of its text.
function idFields(id) {
  if (id === undefined || id === null) return { intentId: null };
  if (typeof id === 'string' && INTENT_ID_RE.test(id)) return { intentId: id };
  return { intentId: null, nameSha256: crypto.createHash('sha256').update(String(id), 'utf8').digest('hex') };
}

function logUnsafe(why) {
  const e = new Error(`~/${DIR_NAME}/${FILE_NAME} is not a private regular file (${why}); nothing was logged`);
  e.code = 'A1_INTENTS_DIR_UNSAFE';
  return e;
}

// O_APPEND|O_CREAT|O_NOFOLLOW at 0600, then fstat: regular file, this uid,
// private. -> the checked fd.
function openLog(file, deps) {
  let fd;
  try {
    fd = fs.openSync(file, APPEND_FLAGS, FILE_MODE);
  } catch (e) {
    throw logUnsafe(e && (e.code === 'ELOOP' || e.code === 'EMLINK') ? 'file is a symlink' : (e && e.code) || 'open failed');
  }
  const st = (deps.fstat || fs.fstatSync)(fd);
  const uid = (deps.getuid || process.getuid)();
  const why = !st.isFile() ? 'not a regular file'
    : st.uid !== uid ? `file owned by uid ${st.uid}, not ${uid}`
      : (st.mode & 0o077) !== 0 ? `file mode ${(st.mode & 0o777).toString(8)}, want 600` : null;
  if (why) {
    fs.closeSync(fd);
    throw logUnsafe(why);
  }
  return fd;
}

// The pre-flight of every lifecycle command: the directory and log.jsonl are
// safe to append to, checked before anything is moved (nothing is written).
function assertLogSafe(deps = {}) {
  const file = logPath(deps.homedir);
  assertOutsideVault(path.dirname(file));
  assertPrivateDir(deps);
  fs.closeSync(openLog(file, deps));
}

// Appends one line. `deps.homedir` and `deps.now` for fixtures.
function logDecision(entry, deps = {}) {
  const line = buildEntry(entry, deps.now || Date.now);
  const file = logPath(deps.homedir);
  const dir = path.dirname(file);
  assertOutsideVault(dir);
  assertPrivateDir(deps);
  const fd = openLog(file, deps);
  try {
    fs.writeSync(fd, `${JSON.stringify(line)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  return line;
}

// The FR-033 line of one `intent validate` verdict.
function logValidate(result, file, deps = {}) {
  const intentId = result.intent && typeof result.intent.id === 'string' ? result.intent.id : path.basename(String(file));
  return logDecision({
    command: 'validate',
    intentId,
    outcome: result.valid ? 'valid' : 'invalid',
    reason: result.reasons.length === 0 ? null : result.reasons.join(','),
    hostname: deps.hostname || os.hostname(),
    detail: result.detail || undefined,
    payloadSha256: result.payloadSha256 || undefined,
  }, deps);
}

module.exports = { logPath, logDecision, logValidate, assertLogSafe };
