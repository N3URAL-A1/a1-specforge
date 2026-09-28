'use strict';

// ---------------------------------------------------------------------------
// intent-doctor — `a1-tools intent doctor` (spec 011, Wave 10: FR-037; the
// override report of FR-046). Read-only: it never creates, repairs, chmods or
// logs anything, and it never prints a secret or a payload — the report
// carries device ids, file names and check names only.
//
// Report (stdout JSON): executor config, non-revoked device ids, community
// plugins, the Sync flag, Obsidian's TCP listeners, the active A1_INTENT_*
// variables, and checks[] of { name, ok, detail }. Exit 1 when any check
// fails, 0 otherwise, 2 on a usage error.
//
// Checks, in order:
//   intents_dir, seal_dir    ~/.a1-intents, ~/.a1-intents-seal: a real
//                            directory of this uid, no group/other bit
//                            (FR-011). Absent is ok (nothing to protect).
//   devices_mode, executor_mode, log_mode, ledger_mode
//                            devices.json, executor.json, log.jsonl and
//                            ~/.a1-intents-ledger.json: a regular file of this
//                            uid, 0600, opened O_NOFOLLOW|O_NONBLOCK and
//                            checked on that descriptor (openPrivate), never a
//                            stat by path. Absent is ok.
//   obsidian_listener        every TCP listener of the WHOLE Obsidian process
//                            tree. Measured 2026-09-28 on the executor Mac:
//                            the main process `Obsidian` owns no socket; the
//                            listeners (*:58589, 127.0.0.1:22360, :27124)
//                            belong to its child "Obsidian Helper (Renderer)",
//                            which `pgrep -x Obsidian` never finds (security
//                            review of waves 9–10, BLOCKER-1). So: one
//                            `ps -axo pid=,ppid=,uid=,comm=`, roots = every
//                            process named Obsidian or running from inside
//                            Obsidian.app, plus all their descendants; then
//                            one `lsof -nP -iTCP -sTCP:LISTEN -a -p <pids>`.
//                            Both by absolute path with an argv array (no
//                            shell, no PATH lookup). Any bind address outside
//                            127/8 and [::1] fails. A tool that is missing or
//                            fails, or a line that does not parse, fails too:
//                            an unverified listener is not a safe one.
//   secret_in_vault          a walk over $A1_VAULT_ROOT for every device
//                            secret in devices.json (revoked ones too): hex in
//                            either case, and base64 / base64url of the 32 raw
//                            bytes (a plugin's data.json stores it that way).
//                            Hits name the vault-relative file and never the
//                            secret. A symlink is never followed. One whose
//                            realpath lies inside the vault is covered by the
//                            walk; one that points out, dangles or cannot be
//                            resolved is an `unscanned_symlink` finding and
//                            fails the check (spec round 6). With the
//                            devices file unsafe or unreadable, the scan has
//                            nothing to look for: the check fails as "not
//                            checked" instead of passing.
//   overrides                any A1_INTENT_* variable in the environment
//                            (FR-046: a plist or ~/.zshenv carrying one is an
//                            operator mistake even when it only tightens).
//
// Fixture seam: injectDoctorDeps({ exec }) replaces the ps/lsof runner, as
// intent-child's injectChildDeps does for the passwd home. Production never
// calls it; no variable can reach it.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { devicesDir, loadDevices, openPrivate } = require('./intent-devices.cjs');

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const TOOL_PATHS = Object.freeze({
  ps: Object.freeze(['/bin/ps', '/usr/bin/ps']),
  lsof: Object.freeze(['/usr/sbin/lsof', '/usr/bin/lsof']),
});
const TOOL_ENV = Object.freeze({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C' });
const TOOL_TIMEOUT_MS = 5000;
const TOOL_MAX_BUFFER = 8 * 1024 * 1024;
const PS_ARGV = Object.freeze(['-axo', 'pid=,ppid=,uid=,comm=']);
const OBSIDIAN_NAME = 'Obsidian';
const OBSIDIAN_APP = '/Obsidian.app/';
const SEAL_DIR = '.a1-intents-seal';
const LEDGER_FILE = '.a1-intents-ledger.json';
const OVERRIDE_PREFIX = 'A1_INTENT_';
const JSON_MAX_BYTES = 1024 * 1024;
const SCAN_CHUNK_BYTES = 64 * 1024;
const SCAN_MAX_FILES = 200000;
const SCAN_MAX_HITS = 20;
const SCAN_OVERLAP_CHARS = 63; // longest needle (64 hex) minus one
const LOOPBACK_RE = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]|localhost)$/;
const LISTEN_RE = /^\S+\s+([0-9]+)\s.*\bTCP\s+(\S+)\s+\(LISTEN\)\s*$/;
const PS_LINE_RE = /^\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+(.+)$/;
const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;

let injected = Object.freeze({});

// Fixture seam (see header).
function injectDoctorDeps(deps) {
  injected = Object.freeze({ ...deps });
}

// The first existing absolute path of `tool`; never a PATH lookup.
function resolveTool(tool) {
  return (TOOL_PATHS[tool] || []).find((p) => fs.existsSync(p)) || null;
}

function defaultExec(tool, argv) {
  const bin = resolveTool(tool);
  if (!bin) return { status: null, stdout: '', error: 'ENOENT' };
  const r = spawnSync(bin, argv, {
    encoding: 'utf8', timeout: TOOL_TIMEOUT_MS, maxBuffer: TOOL_MAX_BUFFER, env: TOOL_ENV, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: r.status, stdout: r.stdout || '', error: r.error ? (r.error.code || 'error') : null };
}

const defaultDeps = () => ({
  homedir: os.homedir,
  vault: process.env.A1_VAULT_ROOT || null,
  env: process.env,
  exec: defaultExec,
  ...injected,
});

const check = (name, ok, detail = null) => Object.freeze({ name, ok, detail });

// ---------- private state (FR-011) ----------

class Unsafe extends Error {}

// Opens `p` through openPrivate and closes it again. -> check, plus the fd's
// text when `read` is set and the file is safe.
function privateCheck(name, p, kind, d, read = false) {
  let fd;
  try {
    fd = openPrivate(p, kind, d, (why) => new Unsafe(why));
  } catch (e) {
    if (e instanceof Unsafe) return { check: check(name, false, e.message), text: null };
    throw e;
  }
  if (fd === null) return { check: check(name, true, 'absent'), text: null };
  try {
    const text = read ? fs.readFileSync(fd, 'utf8') : null;
    return { check: check(name, true), text };
  } finally {
    fs.closeSync(fd);
  }
}

function executorFrom(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (_e) {
    return { ok: false, executor: null };
  }
  const ok = doc && typeof doc === 'object' && typeof doc.executor_host === 'string' && typeof doc.executor_device === 'string';
  return ok ? { ok: true, executor: { executor_host: doc.executor_host, executor_device: doc.executor_device } } : { ok: false, executor: null };
}

// -> { devices: ids | null, secrets: [{ id, secret }], problem }.
function devicesFrom(d) {
  let map;
  try {
    map = loadDevices({ homedir: d.homedir });
  } catch (e) {
    if (e && e.code === 'A1_DEVICES_UNREADABLE') return { devices: null, secrets: null, problem: 'devices.json is unreadable' };
    throw e;
  }
  const ids = Object.keys(map).sort();
  return {
    devices: ids.filter((id) => map[id].revoked_at === null),
    secrets: ids.map((id) => ({ id, secret: map[id].secret_hex })), // revoked ones too: a leak is a leak
    problem: null,
  };
}

// ---------- vault writers: plugins, Sync ----------

function readVaultJson(vault, rel) {
  const p = path.join(vault, rel);
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!st) return { absent: true, value: null };
  if (!st.isFile() || st.size > JSON_MAX_BYTES) return { absent: false, value: undefined };
  try {
    return { absent: false, value: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (_e) {
    return { absent: false, value: undefined }; // unreadable: reported as null
  }
}

function pluginsOf(vault) {
  const r = readVaultJson(vault, path.join('.obsidian', 'community-plugins.json'));
  if (r.absent) return [];
  return Array.isArray(r.value) && r.value.every((x) => typeof x === 'string') ? r.value : null;
}

// core-plugins.json is an array of enabled ids (older Obsidian) or an object
// { <id>: boolean } (current Obsidian).
function syncEnabledOf(vault) {
  const r = readVaultJson(vault, path.join('.obsidian', 'core-plugins.json'));
  if (r.absent) return false;
  if (Array.isArray(r.value)) return r.value.includes('sync');
  if (r.value && typeof r.value === 'object') return r.value.sync === true;
  return null;
}

// ---------- Obsidian listeners ----------

const isObsidianComm = (comm) => path.basename(comm) === OBSIDIAN_NAME || comm.includes(OBSIDIAN_APP);

// ps output -> the pids of every Obsidian root and all their descendants,
// sorted; { problem } when a line does not parse.
function obsidianTree(psText) {
  const rows = [];
  for (const line of String(psText).split('\n')) {
    if (line.trim() === '') continue;
    const m = line.match(PS_LINE_RE);
    if (!m) return { pids: null, problem: `ps line does not parse: ${JSON.stringify(line.slice(0, 120))}` };
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[4] });
  }
  const tree = new Set(rows.filter((r) => isObsidianComm(r.comm)).map((r) => r.pid));
  let grew = tree.size > 0;
  while (grew) {
    const before = tree.size;
    for (const r of rows) if (tree.has(r.ppid)) tree.add(r.pid);
    grew = tree.size > before;
  }
  return { pids: [...tree].sort((a, b) => a - b), problem: null };
}

// lsof output -> { listeners, problem }; the pid comes from each line.
function parseLsof(text) {
  const listeners = [];
  for (const line of String(text).split('\n')) {
    if (line.trim() === '' || line.startsWith('COMMAND')) continue;
    const m = line.match(LISTEN_RE);
    const cut = m ? m[2].lastIndexOf(':') : -1;
    if (cut <= 0) return { listeners, problem: `lsof line does not parse: ${JSON.stringify(line.slice(0, 120))}` };
    const address = m[2].slice(0, cut);
    listeners.push({ pid: Number(m[1]), address, port: m[2].slice(cut + 1), loopback: LOOPBACK_RE.test(address) });
  }
  return { listeners, problem: null };
}

function listenersOf(d) {
  const ps = d.exec('ps', [...PS_ARGV]);
  if (ps.status !== 0 || ps.error) return { listeners: null, problem: `ps unavailable or failed (${ps.error || `exit ${ps.status}`})` };
  const tree = obsidianTree(ps.stdout);
  if (tree.problem) return { listeners: null, problem: tree.problem };
  if (tree.pids.length === 0) return { listeners: [], problem: null }; // not running
  const r = d.exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', tree.pids.join(',')]);
  // lsof exits 1 when one of the pids has no listener or vanished between
  // ps and lsof, and still prints the lines of the others (re-review n6):
  // exit 1 with output is a result; exit 1 without output means no listener
  // (measured for the main pid alone). Anything else could not be verified.
  const output = String(r.stdout).trim() !== '';
  if (r.status === 1 && !r.error && !output) return { listeners: [], problem: null };
  if (r.error || (r.status !== 0 && r.status !== 1)) return { listeners: null, problem: `lsof failed (${r.error || `exit ${r.status}`})` };
  const parsed = parseLsof(r.stdout);
  return parsed.problem ? { listeners: null, problem: parsed.problem } : { listeners: parsed.listeners, problem: null };
}

function listenerCheck(l) {
  if (l.problem) return check('obsidian_listener', false, l.problem);
  const open = l.listeners.filter((x) => !x.loopback).map((x) => `${x.address}:${x.port}`);
  return open.length === 0 ? check('obsidian_listener', true) : check('obsidian_listener', false, `non-loopback: ${open.join(', ')}`);
}

// ---------- secret scan ----------

// Every spelling of one secret we look for: hex (compared lowercased) and
// base64 / base64url of the 32 raw bytes (compared as is; the 43-character
// unpadded prefix also matches the padded form).
function needlesOf(secretHex) {
  const raw = Buffer.from(secretHex, 'hex');
  return {
    hex: secretHex.toLowerCase(),
    exact: [raw.toString('base64').replace(/=+$/, ''), raw.toString('base64url')],
  };
}

// true when the file contains one of the needles; read in chunks with an
// overlap, through one O_NOFOLLOW descriptor.
function fileContains(p, needles) {
  let fd;
  try {
    fd = fs.openSync(p, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (e) {
    if (e && typeof e.code === 'string') return false; // vanished or no permission: nothing readable through this path
    throw e;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return false;
    const buf = Buffer.alloc(SCAN_CHUNK_BYTES);
    let carry = '';
    let n = fs.readSync(fd, buf, 0, buf.length, null);
    while (n > 0) {
      const text = carry + buf.subarray(0, n).toString('latin1');
      const lower = text.toLowerCase();
      if (needles.some((s) => lower.includes(s.hex) || s.exact.some((e) => text.includes(e)))) return true;
      carry = text.slice(-SCAN_OVERLAP_CHARS);
      n = fs.readSync(fd, buf, 0, buf.length, null);
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

// A link whose realpath lies inside the vault's realpath is covered by the
// walk (its target is scanned where it lives); anything else — pointing out,
// dangling, unresolvable — is not followed and is reported.
function linkCovered(p, vaultReal) {
  try {
    const real = fs.realpathSync(p);
    return real === vaultReal || real.startsWith(vaultReal + path.sep);
  } catch (e) {
    if (e && typeof e.code === 'string') return false; // dangling, a loop, no permission
    throw e;
  }
}

// -> { hits, symlinks, problem }. Symlinks are never followed; the ones not
// covered by the walk are listed.
function walkVault(vault, needles) {
  const found = { hits: [], symlinks: [], problem: null };
  const vaultReal = fs.realpathSync(vault);
  const stack = [vault];
  let files = 0;
  while (stack.length > 0 && found.hits.length < SCAN_MAX_HITS) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return { ...found, problem: `cannot read ${path.relative(vault, dir) || '.'} (${e.code || 'error'})` };
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) {
        if (!linkCovered(p, vaultReal)) found.symlinks.push(path.relative(vault, p));
      }
      else if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile()) {
        files += 1;
        if (files > SCAN_MAX_FILES) return { ...found, problem: `more than ${SCAN_MAX_FILES} files; scan incomplete` };
        if (fileContains(p, needles)) found.hits.push(path.relative(vault, p));
      }
    }
  }
  return found;
}

function secretCheck(vault, secrets) {
  if (secrets === null) return check('secret_in_vault', false, 'not checked: devices.json is unsafe or unreadable');
  const w = walkVault(vault, secrets.map((s) => needlesOf(s.secret)));
  const problems = [
    w.problem,
    w.hits.length > 0 ? `a provisioned secret in: ${w.hits.join(', ')}` : null,
    w.symlinks.length > 0 ? `unscanned_symlink: ${w.symlinks.slice(0, SCAN_MAX_HITS).join(', ')}` : null,
  ].filter((x) => x !== null);
  if (problems.length > 0) return check('secret_in_vault', false, problems.join('; '));
  return check('secret_in_vault', true, secrets.length === 0 ? 'no provisioned secret' : null);
}

// ---------- report ----------

function runDoctor(deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const home = d.homedir();
  const dir = devicesDir(d.homedir);
  const intentsDir = privateCheck('intents_dir', dir, 'directory', d);
  const sealDir = privateCheck('seal_dir', path.join(home, SEAL_DIR), 'directory', d);
  const devicesFile = privateCheck('devices_mode', path.join(dir, 'devices.json'), 'file', d);
  const executorFile = privateCheck('executor_mode', path.join(dir, 'executor.json'), 'file', d, true);
  const logFile = privateCheck('log_mode', path.join(dir, 'log.jsonl'), 'file', d);
  const ledgerFile = privateCheck('ledger_mode', path.join(home, LEDGER_FILE), 'file', d);
  const exec = executorFile.text === null ? { ok: true, executor: null } : executorFrom(executorFile.text);
  const safeDevices = intentsDir.check.ok && devicesFile.check.ok;
  const dev = safeDevices ? devicesFrom(d) : { devices: null, secrets: null, problem: null };
  const listeners = listenersOf(d);
  const overrides = Object.keys(d.env).filter((k) => k.startsWith(OVERRIDE_PREFIX)).sort();
  const checks = [
    intentsDir.check,
    sealDir.check,
    dev.problem ? check('devices_mode', false, dev.problem) : devicesFile.check,
    exec.ok ? executorFile.check : check('executor_mode', false, 'executor.json is not a JSON object with executor_host and executor_device'),
    logFile.check,
    ledgerFile.check,
    listenerCheck(listeners),
    secretCheck(d.vault, dev.secrets),
    overrides.length === 0 ? check('overrides', true) : check('overrides', false, `active: ${overrides.join(', ')}`),
  ];
  return Object.freeze({
    ok: checks.every((c) => c.ok),
    executor: exec.executor,
    devices: dev.devices,
    plugins: pluginsOf(d.vault),
    sync_enabled: syncEnabledOf(d.vault),
    listeners: listeners.listeners,
    overrides,
    checks,
  });
}

function usageExit(message) {
  process.stderr.write(`usage error: ${message}\n`);
  process.stderr.write('see: a1-tools --help (section "a1-tools intent")\n');
  process.exitCode = EXIT_USAGE;
}

// `a1-tools intent doctor` — no arguments.
function cmdIntentDoctor(args, deps = {}) {
  if (args.length > 0) return usageExit('intent doctor (takes no arguments; it only reports, it never repairs)');
  if (!process.env.A1_VAULT_ROOT) return usageExit('intent doctor: A1_VAULT_ROOT is not set; the vault checks need it');
  const report = runDoctor(deps);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const failed = report.checks.filter((c) => !c.ok).map((c) => c.name);
  if (failed.length > 0) process.stderr.write(`intent doctor: failing checks: ${failed.join(', ')}\n`);
  process.exitCode = failed.length === 0 ? EXIT_OK : EXIT_FAILED;
  return undefined;
}

module.exports = {
  runDoctor, cmdIntentDoctor, injectDoctorDeps, parseLsof, obsidianTree, resolveTool, defaultExec,
};
