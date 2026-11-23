'use strict';

// `wave checks` (spec 027 FR-024, plan D11): the three per-wave gates in one call.
// Each gate runs as a child of the facade with cwd = the project dir, so each writes its own gate-log line into the
// project's log (schema-check run takes no --project). All three run whatever an earlier one returned.
// Exit: 2 if any child exited 2 or timed out, else 1 if any exited non-zero, else 0.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const gateLog = require('./gate-log.cjs');
const { emitExit } = require('./emit-exit.cjs');

const USAGE = 'a1-tools wave checks <slug> <wave> --diff-base <ref> [--project <dir>] [--migrations <dir>] [--phase <slug>]';
const FACADE = path.join(__dirname, '..', 'a1-tools.cjs');
const CHILD_TIMEOUT_MS = 10 * 60 * 1000;
const TAIL_BYTES = 2000;
const CHILD_GATES = Object.freeze(['realpath-check run', 'schema-check run', 'test-fidelity']);
const GATE_IDS = Object.freeze({ 'realpath-check run': 'gate-0.7-realpath', 'schema-check run': 'gate-0.6-schema', 'test-fidelity': 'test-fidelity' });

class UsageError extends Error {}

function parseArgs(rest) {
  const [slug, waveRaw, ...flags] = rest;
  const o = { diffBase: null, project: null, migrations: null, phase: null };
  const names = { '--diff-base': 'diffBase', '--project': 'project', '--migrations': 'migrations', '--phase': 'phase' };
  for (let i = 0; i < flags.length; i++) {
    const key = names[flags[i]];
    if (!key) throw new UsageError(`unknown argument ${JSON.stringify(String(flags[i]).slice(0, 60))}`);
    if (i + 1 >= flags.length) throw new UsageError(`${flags[i]} needs a value`);
    o[key] = flags[++i];
  }
  try { gateLog.validateScope(slug === undefined ? null : slug); } catch (e) { throw new UsageError(e.message); }
  if (!/^\d+$/.test(String(waveRaw))) throw new UsageError('<wave> must be an integer >= 0');
  if (!o.diffBase) throw new UsageError('--diff-base <ref> is required');
  if (o.phase !== null && o.phase !== slug) throw new UsageError(`--phase ${JSON.stringify(o.phase)} must equal <slug> ${JSON.stringify(slug)}`);
  return { ...o, slug, wave: Number(waveRaw) };
}

const tail = (s) => String(s || '').slice(-TAIL_BYTES);

function spawnChild(argv, cwd) {
  const r = spawnSync(process.execPath, [FACADE, ...argv], { cwd, env: process.env, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const timedOut = r.error && r.error.code === 'ETIMEDOUT';
  return { exit: r.status === null ? null : r.status, timedOut: Boolean(timedOut), stdout_tail: tail(r.stdout || r.stderr) };
}

/**
 * @param {{slug: string, project: string, diffBase: string, migrations?: string|null}} opts
 * @returns {{ok: boolean, checks: Array<{gate: string, argv: string[], exit: number|null, skipped?: string}>}}
 */
function runChecks(opts) {
  const { slug, project, diffBase, migrations } = opts;
  const argvs = {
    'realpath-check run': ['realpath-check', 'run', '--diff-base', diffBase, '--project', project, '--phase', slug],
    'schema-check run': migrations ? ['schema-check', 'run', '--migrations', migrations, '--phase', slug] : null,
    'test-fidelity': ['test-fidelity', '--diff-base', diffBase, '--project', project, '--phase', slug],
  };
  const checks = CHILD_GATES.map((key) => {
    const gate = GATE_IDS[key];
    if (!argvs[key]) return { gate, argv: [], exit: null, skipped: 'no_migrations' };
    return { gate, argv: argvs[key], ...spawnChild(argvs[key], project) };
  });
  const bad = checks.filter((c) => !c.skipped);
  const ok = bad.every((c) => c.exit === 0);
  return { ok, checks };
}

/** @param {Array<{exit: number|null, timedOut?: boolean, skipped?: string}>} checks */
function exitOf(checks) {
  const ran = checks.filter((c) => !c.skipped);
  if (ran.some((c) => c.exit === 2 || c.exit === null || c.timedOut)) return 2;
  return ran.some((c) => c.exit !== 0) ? 1 : 0;
}

/** @param {string[]} rest */
function cmdWaveChecks(rest) {
  if (rest.length === 1 && (rest[0] === '--help' || rest[0] === '-h')) return emitExit(0, `usage: ${USAGE}\n`, '');
  let args;
  try { args = parseArgs(rest); } catch (e) {
    if (!(e instanceof UsageError) && !(e && e.code === 'A1_INPUT')) throw e;
    return emitExit(2, '', `wave checks: ${e.message}\nusage: ${USAGE}\n`);
  }
  const project = path.resolve(args.project || process.cwd());
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) return emitExit(2, '', `wave checks: project dir not found: ${project}\nusage: ${USAGE}\n`);
  const res = runChecks({ slug: args.slug, project, diffBase: args.diffBase, migrations: args.migrations ? path.resolve(args.migrations) : null });
  const code = exitOf(res.checks);
  const out = { ok: code === 0, slug: args.slug, wave: args.wave, checks: res.checks };
  return emitExit(code, `${JSON.stringify(out)}\n`, '');
}

module.exports = { CHILD_GATES, cmdWaveChecks, runChecks };
