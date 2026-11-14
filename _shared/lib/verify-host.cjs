'use strict';

// Host awareness for `verify run` (spec 028 FR-001..FR-004): a command pinned to other platforms
// (`requires_host`) and an id ending `-bash32` whose argv[0] is not a bash 3 are never executed
// on this host and never reported as pass; they are named under `skipped_on_host`.
// Pure helpers: the host facts and the probe spawner are injected, no module state (the probe
// memo is owned by the caller, one Map per run). Cost: in-memory filtering; the probe is one
// spawnSync per distinct argv[0] and only when a `-bash32` id exists (bounded by PROBE_TIMEOUT_MS).

const os = require('os');
const { spawnSync } = require('child_process');
const { VerifyError } = require('./verify-base.cjs');

const BASH32_SUFFIX = '-bash32';
const PROBE_TIMEOUT_MS = 5000;
const PROBE_ARGS = Object.freeze(['-c', 'echo "${BASH_VERSINFO[0]}"']);
const EXPECTED_BASH_MAJOR = 3;
const SHELL_MISMATCH = 'shell_major_mismatch';
const TARGET_OS_HINT = 'run these ids on the target OS before merge: ';
const CI_HINT = 'ci_evidence used: host-specific ids were not run locally: ';

/** The `requires_host` list of one commands[] entry: null when absent or empty; bad_config for any other shape. */
function validateRequiresHost(entry, where) {
  const v = entry && typeof entry === 'object' ? entry.requires_host : undefined;
  if (v === undefined) return null;
  if (!Array.isArray(v) || !v.every((p) => typeof p === 'string' && p !== '')) {
    throw new VerifyError('bad_config', `${where}: requires_host must be an array of platform names, e.g. ["darwin"] (edit .a1/verify.json)`);
  }
  return v.length === 0 ? null : v.slice();
}

/** Host facts of a run: platform, arch, node, never a hostname (spec 028 A-005). `host.platform` can be injected (tests). */
function hostRecord(host = {}) {
  return { platform: host.platform || os.platform(), arch: os.arch(), node: process.version };
}

/** Major version printed by `<argv0> -c 'echo "${BASH_VERSINFO[0]}"'`: { major } or { error }. */
function probeBashMajor(argv0, { spawn = spawnSync, timeoutMs = PROBE_TIMEOUT_MS, cwd } = {}) {
  const r = spawn(argv0, PROBE_ARGS, { encoding: 'utf8', timeout: timeoutMs, shell: false, cwd, stdio: ['ignore', 'pipe', 'ignore'], killSignal: 'SIGKILL' });
  if (r.error) return { error: r.error.code === 'ETIMEDOUT' ? `probe timed out after ${timeoutMs} ms` : `cannot start ${argv0}: ${r.error.code || r.error.message}` };
  if (r.signal) return { error: `probe killed by ${r.signal}` };
  const out = String(r.stdout || '').trim();
  if (!/^\d+$/.test(out)) return { error: `probe printed ${JSON.stringify(out.slice(0, 40))}, expected a bash major version number` };
  return { major: Number(out) };
}

function isBash32Candidate(c) {
  return c.requiresHost === null && !c.file && typeof c.id === 'string' && c.id.endsWith(BASH32_SUFFIX);
}

/**
 * Split commands into the ones to run and the ones this host skips. Order is kept.
 * @param {object[]} commands resolved commands (`requiresHost`: string[]|null)
 * @param {{platform?: string, probeTimeoutMs?: number, spawn?: Function, cwd?: string}} host injected host facts
 * @param {Map<string, object>} memo probe results per argv[0] for this run (the caller owns it)
 * @returns {{run: object[], skipped: object[]}}
 */
function hostFilter(commands, host, memo) {
  const platform = hostRecord(host).platform;
  const run = [];
  const skipped = [];
  for (const c of commands) {
    if (c.requiresHost && !c.requiresHost.includes(platform)) {
      skipped.push({ id: c.id, requires_host: c.requiresHost, host_platform: platform });
    } else if (isBash32Candidate(c)) {
      const key = c.argv[0];
      if (!memo.has(key)) memo.set(key, probeBashMajor(key, { spawn: host.spawn, timeoutMs: host.probeTimeoutMs, cwd: host.cwd }));
      const p = memo.get(key);
      const detail = p.error || (p.major === EXPECTED_BASH_MAJOR ? null : `${key} reports bash major ${p.major}, expected ${EXPECTED_BASH_MAJOR}`);
      if (detail === null) run.push(c);
      else skipped.push({ id: c.id, requires_host: null, host_platform: platform, reason: SHELL_MISMATCH, detail });
    } else {
      run.push(c);
    }
  }
  return { run, skipped };
}

/** `hints` array for a non-empty skipped list; [] otherwise. */
function skipHints(skipped) {
  return skipped.length === 0 ? [] : [`${TARGET_OS_HINT}${skipped.map((s) => s.id).join(', ')}`];
}

/** Ids of a parsed `.a1/verify.json` commands[] that are host-specific (non-empty requires_host, or a bare `-bash32` id); [] when unreadable. */
function hostSpecificIds(cfg) {
  const cmds = cfg && Array.isArray(cfg.commands) ? cfg.commands : [];
  return cmds.filter((c) => c && typeof c === 'object').flatMap((c) => {
    const id = typeof c.id === 'string' && c.id ? c.id : (Array.isArray(c.argv) ? c.argv.join(' ') : '');
    const pinned = Array.isArray(c.requires_host) && c.requires_host.length > 0;
    return id !== '' && (pinned || id.endsWith(BASH32_SUFFIX)) ? [id] : [];
  });
}

/** The ci_evidence-path hint for a list of host-specific ids; [] when none. */
function ciSkipHints(ids) {
  return ids.length === 0 ? [] : [`${CI_HINT}${ids.join(', ')}`];
}

module.exports = { validateRequiresHost, hostRecord, probeBashMajor, hostFilter, skipHints, hostSpecificIds, ciSkipHints };
