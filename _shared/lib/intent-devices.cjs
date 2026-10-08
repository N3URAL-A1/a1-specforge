'use strict';

// ---------------------------------------------------------------------------
// intent-devices — per-device HMAC secrets outside the vault (spec 011,
// Wave 3: FR-011, FR-012 lookup half) and `a1-tools intent device`.
//
//   ~/.a1-intents/              mode 0700
//   ~/.a1-intents/devices.json  mode 0600, written tmp+rename
//     { "devices": { "<device-id>": { secret_hex, created_at, revoked_at|null } } }
//
// Rules:
//   - The file is read inside the command function, never at module load.
//   - Missing dir or file -> no devices. Corrupt file (unparsable JSON, wrong
//     shape), a symlink or non-regular file, a foreign owner or any group /
//     other mode bit on the dir or the file -> throw A1_DEVICES_UNREADABLE.
//     Never a silent empty map: that would be safe (everything
//     device_unknown) but hides the operator problem.
//   - `device add` generates 32 random bytes and prints the secret exactly
//     once, and only when stdout is a TTY (non-TTY: exit 1, nothing written).
//     The secret goes to /dev/tty, never to stdout (MINOR-4 of the security
//     review): stdout carries only the JSON result, so a pipe, a log or a
//     session recorder on stdout never sees it. /dev/tty is opened before
//     anything is written; no controlling terminal -> exit 1, nothing stored.
//     With --qr it prints the provisioning payload instead of the bare hex,
//     so the secret still appears once. The payload stays TEXT: a real QR
//     code needs an encoder (Reed-Solomon, masking), and the repo adds no
//     npm dependency for it. No other command, log or error message ever
//     carries a secret.
//   - Nothing here writes into $A1_VAULT_ROOT; a home dir resolving inside the
//     vault is refused.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR_NAME = '.a1-intents';
const FILE_NAME = 'devices.json';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const SECRET_BYTES = 32;
const DEVICE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/; // FR-007 `created_by`
const SECRET_HEX_RE = /^[0-9a-f]{64}$/;
const QR_PREFIX = 'a1-intent://provision';

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;

function unreadable(why) {
  const e = new Error(`~/${DIR_NAME}/${FILE_NAME} is unreadable (${why}); fix or remove it, then re-provision the devices`);
  e.code = 'A1_DEVICES_UNREADABLE';
  return e;
}

function devicesDir(homedir = os.homedir) {
  return path.join(homedir(), DIR_NAME);
}

function devicesPath(homedir = os.homedir) {
  return path.join(devicesDir(homedir), FILE_NAME);
}

const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

function isEntry(e) {
  return e !== null && typeof e === 'object' && !Array.isArray(e)
    && typeof e.secret_hex === 'string' && SECRET_HEX_RE.test(e.secret_hex)
    && isIso(e.created_at)
    && (e.revoked_at === null || isIso(e.revoked_at));
}

// -> frozen null-prototype map { <id>: frozen entry }.
function parseDevices(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (_e) {
    throw unreadable('not JSON');
  }
  const devices = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.devices : undefined;
  if (!devices || typeof devices !== 'object' || Array.isArray(devices)) throw unreadable('no "devices" object');
  const out = Object.create(null);
  for (const [id, entry] of Object.entries(devices)) {
    if (!DEVICE_ID_RE.test(id) || !isEntry(entry)) throw unreadable('an entry has the wrong shape');
    out[id] = Object.freeze({ secret_hex: entry.secret_hex, created_at: entry.created_at, revoked_at: entry.revoked_at });
  }
  return Object.freeze(out);
}

const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK, O_DIRECTORY } = fs.constants;
const PRIVATE_BITS = 0o077; // group and other: must be 0 on the dir and the file

// Owner and mode of an opened descriptor: a regular file (or a directory),
// owned by this uid, no group or other bits. Returns why not, or null.
function privateProblem(st, kind, uid) {
  const isKind = kind === 'directory' ? st.isDirectory() : st.isFile();
  if (!isKind) return `not a regular ${kind}`;
  if (st.uid !== uid) return `${kind} owned by uid ${st.uid}, not ${uid}`;
  const mode = (st.mode & 0o777).toString(8);
  if ((st.mode & PRIVATE_BITS) !== 0) return `${kind} mode ${mode}, want ${kind === 'directory' ? '700' : '600'}`;
  return null;
}

// Opens `p` without following a final symlink, fstats the descriptor and
// checks it with privateProblem. -> fd, or null when `p` does not exist.
// O_NONBLOCK: a FIFO in place of the file never blocks the open. `fail`
// builds the error (default: A1_DEVICES_UNREADABLE); the ledger, the log and
// executor.json pass their own.
function openPrivate(p, kind, d, fail = unreadable) {
  const flags = O_RDONLY | O_NOFOLLOW | O_NONBLOCK | (kind === 'directory' ? O_DIRECTORY : 0);
  let fd;
  try {
    fd = fs.openSync(p, flags);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    if (e && (e.code === 'ELOOP' || e.code === 'EMLINK')) throw fail(`${kind} is a symlink`);
    throw fail(e && e.code ? e.code : 'open failed');
  }
  const problem = privateProblem((d.fstat || fs.fstatSync)(fd), kind, (d.getuid || process.getuid)());
  if (problem) {
    fs.closeSync(fd);
    throw fail(problem);
  }
  return fd;
}

function dirUnsafe(why, name = DIR_NAME) {
  const e = new Error(`~/${name} is not a private directory (${why}); every intent command refuses until it is mode 0700 and owned by you`);
  e.code = 'A1_INTENTS_DIR_UNSAFE';
  return e;
}

// MAJOR-D (security review of waves 4–5): every intent command that writes
// or reads under ~/.a1-intents calls this first. The directory is created
// 0700 when missing (`create`), then opened O_DIRECTORY|O_NOFOLLOW and
// fstat'ed: owned by this uid, no group or other bit, else
// A1_INTENTS_DIR_UNSAFE. Returns the directory path.
function assertPrivateDir(deps = {}, { create = true } = {}) {
  return assertPrivateDirAt(devicesDir(deps.homedir), deps, { create });
}

// The same rule for another private directory of the home (FR-011: the seal
// directory ~/.a1-intents-seal). Returns the directory path.
function assertPrivateDirAt(dir, deps = {}, { create = true } = {}) {
  const fail = (why) => dirUnsafe(why, path.basename(dir));
  if (create) {
    assertOutsideVault(dir);
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  }
  const fd = openPrivate(dir, 'directory', deps, fail);
  if (fd === null) throw fail('missing');
  fs.closeSync(fd);
  return dir;
}

// MAJOR-1 (security review of waves 1–3): whoever can write devices.json can
// add a device and have intents run as the owner; whoever can read it can
// forge intents. So ~/.a1-intents must be a real 0700 directory of this uid
// and devices.json a real 0600 file of this uid, else A1_DEVICES_UNREADABLE.
// The file is checked and read through the same descriptor (no stat->read
// race). `deps.fstat` and `deps.getuid` exist for the foreign-owner cases.
function loadDevices(deps = {}) {
  const d = deps;
  const dir = devicesDir(deps.homedir);
  const dirFd = openPrivate(dir, 'directory', d);
  if (dirFd === null) return Object.freeze(Object.create(null));
  fs.closeSync(dirFd);
  const fd = openPrivate(path.join(dir, FILE_NAME), 'file', d);
  if (fd === null) return Object.freeze(Object.create(null));
  try {
    return parseDevices(fs.readFileSync(fd, 'utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

// FR-012 — the secret of a provisioned, non-revoked device, else null.
function lookupDevice(devices, id) {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(devices, id)) return null;
  const entry = devices[id];
  return entry.revoked_at === null ? entry.secret_hex : null;
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
  const dirReal = fs.realpathSync(path.dirname(dir));
  if (dirReal === vaultReal || dirReal.startsWith(vaultReal + path.sep)) {
    const e = new Error(`refusing to write ~/${DIR_NAME}: the home directory lies inside $A1_VAULT_ROOT, and device secrets never go into the vault`);
    e.code = 'A1_DEVICES_IN_VAULT';
    throw e;
  }
}

function ensureDir(dir) {
  assertOutsideVault(dir);
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory()) throw unreadable(`~/${DIR_NAME} is not a directory`);
  fs.chmodSync(dir, DIR_MODE);
}

// tmp in the same directory (same filesystem) -> fsync -> fchmod -> rename.
function writeDevices(devices, deps = {}) {
  const dir = devicesDir(deps.homedir);
  ensureDir(dir);
  const file = path.join(dir, FILE_NAME);
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  const body = `${JSON.stringify({ devices }, null, 2)}\n`;
  const fd = fs.openSync(tmp, 'wx', FILE_MODE);
  try {
    fs.writeSync(fd, body);
    fs.fchmodSync(fd, FILE_MODE);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

const plain = (devices) => Object.fromEntries(Object.entries(devices).map(([k, v]) => [k, { ...v }]));

// -> { ok: true, secretHex, createdAt } | { ok: false, why }. Refuses an id
// that exists and is not revoked; a revoked id may be provisioned again.
function addDevice(id, deps = {}) {
  if (typeof id !== 'string' || !DEVICE_ID_RE.test(id)) return { ok: false, why: 'device_id_invalid' };
  const devices = loadDevices(deps);
  if (lookupDevice(devices, id) !== null) return { ok: false, why: 'device_exists' };
  const secretHex = crypto.randomBytes(SECRET_BYTES).toString('hex');
  const createdAt = new Date((deps.now || Date.now)()).toISOString();
  writeDevices({ ...plain(devices), [id]: { secret_hex: secretHex, created_at: createdAt, revoked_at: null } }, deps);
  return { ok: true, secretHex, createdAt };
}

function revokeDevice(id, deps = {}) {
  const devices = loadDevices(deps);
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(devices, id)) return { ok: false, why: 'device_unknown' };
  if (devices[id].revoked_at !== null) return { ok: false, why: 'already_revoked' };
  const revokedAt = new Date((deps.now || Date.now)()).toISOString();
  writeDevices({ ...plain(devices), [id]: { ...devices[id], revoked_at: revokedAt } }, deps);
  return { ok: true, revokedAt };
}

function requireTty(stream = process.stdout) {
  return stream.isTTY === true;
}

const TTY_PATH = '/dev/tty';
const openDevTty = () => fs.openSync(TTY_PATH, 'w');

function emit(obj, code) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exitCode = code;
}

function usageExit(message) {
  process.stderr.write(`usage error: ${message}\n`);
  process.stderr.write('see: a1-tools --help (section "a1-tools intent")\n');
  process.exitCode = EXIT_USAGE;
}

// Why a Claude Code session may not provision a device, or null. Fails closed;
// `deps.contextRefusal` (library cases) replaces the shared check, the CLI never passes it.
function contextRefusal(deps) {
  if (typeof deps.contextRefusal === 'function') return deps.contextRefusal();
  try {
    return require('./xprov-approve.cjs').claudeContextRefusal(process.env);
  } catch (e) {
    return `the process ancestry could not be checked (${e.message})`;
  }
}

// `deps.openTty` (default: open /dev/tty for writing) exists for the
// library cases that tell stdout and the terminal apart.
function cmdAdd(rest, deps = {}) {
  const qr = rest.includes('--qr');
  const ids = rest.filter((a) => a !== '--qr');
  if (ids.length !== 1 || ids[0].startsWith('-')) return usageExit('intent device add <device-id> [--qr]');
  if (!requireTty()) {
    process.stderr.write('intent device add: stdout is not a TTY; the secret is printed only to a terminal. Nothing was written.\n');
    process.exitCode = EXIT_REFUSED;
    return undefined;
  }
  const why = contextRefusal(deps);
  if (why) {
    process.stderr.write(`intent device add: refused (claude_code_context): ${why}. Nothing was written.\n`);
    process.exitCode = EXIT_REFUSED;
    return undefined;
  }
  let tty;
  try {
    tty = (deps.openTty || openDevTty)();
  } catch (e) {
    process.stderr.write(`intent device add: cannot open ${TTY_PATH} (${e && e.code ? e.code : 'error'}); the secret is shown only on the terminal. Nothing was written.\n`);
    process.exitCode = EXIT_REFUSED;
    return undefined;
  }
  try {
    const r = addDevice(ids[0]);
    if (!r.ok) return emit({ ok: false, device: ids[0].slice(0, 64), error: r.why }, EXIT_REFUSED);
    const shown = qr ? `${QR_PREFIX}?device=${ids[0]}&secret=${r.secretHex}` : r.secretHex;
    fs.writeSync(tty, `${qr ? 'provisioning payload' : 'secret'} for ${ids[0]}: ${shown}\n`);
    emit({ ok: true, device: ids[0], created_at: r.createdAt, shown_on: 'tty', format: qr ? 'provisioning-payload' : 'hex' }, EXIT_OK);
    process.stderr.write('Store this secret on the device now; it is not shown again. Then clear the terminal scrollback.\n');
  } finally {
    fs.closeSync(tty);
  }
  return undefined;
}

function cmdRevoke(rest) {
  if (rest.length !== 1 || rest[0].startsWith('-')) return usageExit('intent device revoke <device-id>');
  const r = revokeDevice(rest[0]);
  if (!r.ok) return emit({ ok: false, device: rest[0].slice(0, 64), error: r.why }, EXIT_REFUSED);
  return emit({ ok: true, device: rest[0], revoked_at: r.revokedAt }, EXIT_OK);
}

// `a1-tools intent device add <id> [--qr] | device revoke <id>`
function cmdIntentDevice(args, deps = {}) {
  const [verb, ...rest] = args;
  if (verb === 'add') return cmdAdd(rest, deps);
  if (verb === 'revoke') return cmdRevoke(rest);
  return usageExit('intent device add <device-id> [--qr] | intent device revoke <device-id>');
}

module.exports = {
  DEVICE_ID_RE,
  devicesDir,
  devicesPath,
  loadDevices,
  lookupDevice,
  openPrivate,
  assertPrivateDir,
  assertPrivateDirAt,
  addDevice,
  revokeDevice,
  requireTty,
  cmdIntentDevice,
};
