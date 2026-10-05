'use strict';

// Fixture-only preload (NODE_OPTIONS="--require <this file>"). When
// A1_INTENT_FIXTURE_TRACE names a file, appends one line per file access and
// per child-process call made by the CLI's own JS code:
//   read <path>      fs.readFileSync / fs.openSync with a read-only string
//                    flag / the first fs.readSync on a descriptor opened with
//                    numeric flags
//   open <path>      fs.openSync with numeric read-only flags (O_RDONLY |
//                    O_NOFOLLOW | …): opened, not yet read — a fstat gate may
//                    refuse the file before a byte is read
//   write <path>     fs.openSync / writeFileSync / appendFileSync / renameSync …
//   spawn <command>  any child_process entry point
//   spawnopts <json> child_process.spawn only (Wave 6B): { cmd, args, cwd,
//                    shell, detached, stdio, env_names, intent_env } where
//                    intent_env holds the A1_INTENT_* values
// Cases assert on these lines ("0 spawns", "no read outside the vault") so
// both claims are measured. Patched before any module under test loads, so
// destructured imports (`const { execFileSync } = require(...)`) see the
// wrapped functions too. Never used by production code.

const fs = require('fs');
const childProcess = require('child_process');

const out = process.env.A1_INTENT_FIXTURE_TRACE;
if (out) {
  const origAppend = fs.appendFileSync;
  let busy = false;
  const log = (kind, what) => {
    if (busy) return;
    busy = true;
    try {
      origAppend(out, `${kind} ${String(what)}\n`);
    } finally {
      busy = false;
    }
  };
  const isReadFlag = (flags) => flags === undefined || flags === 'r' || flags === 0;
  // O_RDONLY is 0 and the access mode is the low two bits (O_WRONLY 1, O_RDWR 2).
  const isNumericRead = (flags) => typeof flags === 'number' && flags !== 0 && (flags & 3) === 0;
  const fdPaths = new Map(); // fd opened with numeric read flags -> path, until its first read
  const wrap = (obj, name, kindOf) => {
    const orig = obj[name];
    obj[name] = function traced(...args) {
      log(kindOf(args), args[0]);
      return orig.apply(this, args);
    };
  };
  wrap(fs, 'readFileSync', () => 'read');
  const origOpen = fs.openSync;
  fs.openSync = function tracedOpen(...args) {
    const numeric = isNumericRead(args[1]);
    log(numeric ? 'open' : isReadFlag(args[1]) ? 'read' : 'write', args[0]);
    const fd = origOpen.apply(this, args);
    if (numeric) fdPaths.set(fd, String(args[0]));
    return fd;
  };
  const origReadSync = fs.readSync;
  fs.readSync = function tracedReadSync(fd, ...rest) {
    if (fdPaths.has(fd)) {
      log('read', fdPaths.get(fd));
      fdPaths.delete(fd);
    }
    return origReadSync.call(this, fd, ...rest);
  };
  const origClose = fs.closeSync;
  fs.closeSync = function tracedClose(fd) {
    fdPaths.delete(fd);
    return origClose.call(this, fd);
  };
  for (const name of ['writeFileSync', 'appendFileSync', 'renameSync', 'unlinkSync', 'rmSync', 'mkdirSync', 'copyFileSync']) {
    wrap(fs, name, () => 'write');
  }
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    wrap(childProcess, name, () => 'spawn');
  }
  const tracedSpawn = childProcess.spawn;
  childProcess.spawn = function spawnWithOpts(cmd, args, opts) {
    const o = opts || {};
    const env = o.env || {};
    const intentEnv = Object.fromEntries(Object.keys(env).filter((k) => k.startsWith('A1_INTENT_')).map((k) => [k, env[k]]));
    log('spawnopts', JSON.stringify({
      cmd, args, cwd: o.cwd, shell: o.shell, detached: o.detached, stdio: o.stdio, env_names: Object.keys(env), intent_env: intentEnv,
    }));
    return tracedSpawn.apply(this, [cmd, args, opts]);
  };
}
