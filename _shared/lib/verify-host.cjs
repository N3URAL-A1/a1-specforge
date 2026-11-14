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
const ALL_SKIPPED_REASON = 'all_commands_skipped_on_host'; // verdict fail: zero commands ran on this host (review round M2)
const ALL_SKIPPED_HINT = 'all_commands_skipped_on_host: every command of .a1/verify.json is pinned to another host or shell, so nothing was checked on this host; run the skipped ids on the target OS';
const ENV_RED_STALE = 'env_red_stale';
const ENV_RED_STALE_HINT = 'remove the entry from .a1/verify.json';
const BASE_AND_HEAD_RED = 'red_on_base_and_head';

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

/**
 * `hints` array for a non-empty skipped list; [] otherwise. With `ranCount === 0` (every command skipped on this host, spec 028
 * orchestrator item) a second hint says nothing was checked here; warn-only, the verdict is not touched (A-003).
 */
function skipHints(skipped, ranCount) {
  if (skipped.length === 0) return [];
  return [`${TARGET_OS_HINT}${skipped.map((s) => s.id).join(', ')}`, ...(ranCount === 0 ? [ALL_SKIPPED_HINT] : [])];
}

/**
 * The top-level `env_red` array of a parsed `.a1/verify.json` (spec 028 FR-005, FR-006): [] when absent; every entry needs a
 * non-empty string `id`, `host` and `reason`, and an `{id, host}` pair may appear once. Anything else is bad_config (exit 2).
 * @returns {{id: string, host: string, reason: string}[]}
 */
function validateEnvRed(cfg) {
  const v = cfg && typeof cfg === 'object' ? cfg.env_red : undefined;
  if (v === undefined) return [];
  const fix = '(edit .a1/verify.json: env_red is an array of {id, host, reason}, each a non-empty string, one entry per id and host)';
  if (!Array.isArray(v)) throw new VerifyError('bad_config', `env_red must be an array ${fix}`);
  const seen = new Set();
  return v.map((e, i) => {
    const ok = e && typeof e === 'object' && ['id', 'host', 'reason'].every((k) => typeof e[k] === 'string' && e[k].trim() !== '');
    if (!ok) throw new VerifyError('bad_config', `env_red[${i}]: id, host and reason must be non-empty strings ${fix}`);
    const key = JSON.stringify([e.id, e.host]);
    if (seen.has(key)) throw new VerifyError('bad_config', `env_red[${i}]: duplicate entry for id ${JSON.stringify(e.id)} and host ${JSON.stringify(e.host)} ${fix}`);
    seen.add(key);
    return { id: e.id, host: e.host, reason: e.reason };
  });
}

/**
 * Judge the `env_red` entries of this host's platform against the settled head results.
 * Without a base compare an entry excuses a red command (reason set). With one it excuses only a command that is red on base AND
 * head (settled reason null, pre_existing_red_ids set): a head-only red keeps its reason, so a regression is never masked.
 * An entry whose command is green, or that names no command at all, is stale. Entries of other platforms have no effect.
 * @param {{id: string, host: string, reason: string}[]} entries validated entries
 * @param {string} platform this host's platform
 * @param {object[]} settled settled head command records
 * @param {Iterable<string>} knownIds every resolved id of the plan, including the ones skipped on this host
 * @param {boolean} compareBase true when a base side was compared
 * @param {boolean} [baseRequested] true when --base was given; with no base compare (the merge-base has no plan) an entry then excuses nothing,
 *   because the PR itself supplies both the failing command and the excuse
 * @returns {{envRed: object[], excused: Set<string>, warnings: object[]}}
 */
function applyEnvRed(entries, platform, settled, knownIds, compareBase, baseRequested = false) {
  const byId = new Map(settled.map((c) => [c.id, c]));
  const known = new Set(knownIds);
  const envRed = [];
  const excused = new Set();
  const warnings = [];
  const stale = (id) => warnings.push({ reason: ENV_RED_STALE, id, hint: ENV_RED_STALE_HINT });
  for (const e of entries.filter((x) => x.host === platform)) {
    const c = byId.get(e.id);
    if (!c) { if (!known.has(e.id)) stale(e.id); continue; }
    const noExcuse = baseRequested && !compareBase;
    const red = noExcuse ? false : compareBase ? c.reason === null && Array.isArray(c.pre_existing_red_ids) && c.pre_existing_red_ids.length > 0 : c.reason !== null;
    if (red) {
      envRed.push({ id: e.id, reason: e.reason, result_reason: c.reason || BASE_AND_HEAD_RED });
      excused.add(e.id);
    } else if (c.reason === null) stale(e.id);
  }
  return { envRed, excused, warnings };
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

module.exports = { ALL_SKIPPED_REASON, validateEnvRed, applyEnvRed, validateRequiresHost, hostRecord, probeBashMajor, hostFilter, skipHints, hostSpecificIds, ciSkipHints };
