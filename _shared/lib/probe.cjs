'use strict';

// probe — command group `probe` (spec 020-live-probes). `probe run` reads .a1/live-probes.yaml from a
// target repo and measures the real effect from outside. Exit contract (FR-002): 0 all pass or no probes,
// 1 a probe failed or was not measured, 2 usage error, hostile file, blocked host, unreadable path.
// Every error exits 2 with a one-line message (no stack trace) that passes through intent-redact.
//
// Flow: parse + static policy -> address preflight (any blocked host: exit 2, nothing sent) -> probes run
// sequentially in file order -> optional --wait re-runs of failed read-only probes -> one report sink.
// The network module is loaded lazily and only after a successful parse, so a hostile file never reaches
// network code. Result lines carry codes and numbers only (id, kind, verdict, reason, status, attempts, ms).

const fs = require('fs');
const path = require('path');

const MAX_WAIT_S = 600;
const BUDGET_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 5000;
const READ_ONLY = ['GET', 'HEAD', 'OPTIONS'];
const USAGE = 'usage: a1-tools probe run --project <dir> [--wait <seconds>] [--json]';

/** Drop a message that holds an actual secret value, then run it through the shared redactor. */
function scrubMessage(msg, secrets) {
  const { redact } = require(path.join(__dirname, 'intent-redact.cjs'));
  const t = String(msg);
  const hit = (secrets || []).some((s) => s && t.includes(s));
  return redact(hit ? '[redacted: holds a secret value]' : t).replace(/\s+/g, ' ').slice(0, 500);
}

/** One-line message on stderr, exit 2. `secrets`: resolved credential values the message must not hold. */
function die(msg, secrets) {
  process.stderr.write(`probe: ${scrubMessage(msg, secrets)}\n`);
  process.exit(2);
}

/** Every resolved `{env: NAME}` value of the config (the values this run could leak). */
function configSecrets(config, env) {
  const { secretValues } = require(path.join(__dirname, 'probe-net.cjs'));
  const leaves = (config.probes || []).flatMap((p) => (p.kind === 'pair' ? [p.allow, p.deny] : [p]));
  return leaves.flatMap((l) => secretValues(l, env));
}

function parseArgs(args) {
  const opts = { project: null, wait: 0, json: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--project' || a === '--wait') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) die(`${a} needs a value. ${USAGE}`);
      i += 1;
      if (a === '--project') opts.project = v;
      else if (!/^\d{1,3}$/.test(v) || Number(v) > MAX_WAIT_S) die(`--wait must be an integer 0..${MAX_WAIT_S}`);
      else opts.wait = Number(v);
    } else die(`unknown argument: ${a.slice(0, 40)}. ${USAGE}`);
  }
  if (!opts.project) die(`--project <dir> is required. ${USAGE}`);
  return opts;
}

function resolveProject(dir) {
  let real;
  try { real = fs.realpathSync(dir); } catch (_e) { return die('project directory not found'); }
  if (!fs.statSync(real).isDirectory()) die('--project is not a directory');
  return real;
}

// ---------- running ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runLeaf(leaf, ctx) {
  const net = require(path.join(__dirname, 'probe-net.cjs'));
  return leaf.kind === 'tcp' ? net.runTcp(leaf, ctx) : net.runHttp(leaf, ctx);
}

/** Verdict of one executor result: pass | fail | not_measured. */
function verdictOf(r) {
  if (r.pass) return 'pass';
  return r.not_measured ? 'not_measured' : 'fail';
}

/** Pair: allow half first, then deny half (both always run so the report can name the failing half). */
async function runPair(probe, ctx) {
  const allow = await runLeaf(probe.allow, ctx);
  const deny = await runLeaf(probe.deny, ctx);
  const base = { allow_status: allow.status, deny_status: deny.status, duration_ms: allow.duration_ms + deny.duration_ms };
  const blocked = allow.blocked || deny.blocked;
  if (blocked) return { ...base, pass: false, reason: 'blocked_host', blocked: true };
  if (!allow.pass) return { ...base, pass: false, reason: allow.not_measured ? 'env_missing' : 'allow_failed', not_measured: !!allow.not_measured };
  if (deny.pass) return { ...base, pass: true, reason: 'ok' };
  if (deny.not_measured) return { ...base, pass: false, reason: 'env_missing', not_measured: true };
  const halfOpen = deny.reason === 'status_mismatch' || deny.reason === 'unexpected_open';
  return { ...base, pass: false, reason: halfOpen ? 'deny_half_open' : 'deny_failed' };
}

function runOne(probe, ctx) {
  return probe.kind === 'pair' ? runPair(probe, ctx) : runLeaf(probe, ctx);
}

/** A probe may be repeated under --wait only when nothing it sends mutates state. */
function isReadOnly(probe) {
  const leaves = probe.kind === 'pair' ? [probe.allow, probe.deny] : [probe];
  return leaves.every((l) => l.kind === 'tcp' || READ_ONLY.includes(l.method));
}

const entry = (probe, r, attempts) => ({ probe, r, attempts });

/** One sequential pass over config.probes; `prev` entries carry the attempt counts of earlier passes. */
async function runPass(entries, config, ctx, budgetMs) {
  const start = Date.now();
  const out = [];
  for (const probe of config.probes) {
    const prev = entries ? entries.find((e) => e.probe === probe) : null;
    out.push(await runBudgeted(probe, ctx, start, budgetMs, prev));
    if (out[out.length - 1].r.blocked) break;
  }
  return out;
}

async function runBudgeted(probe, ctx, start, budgetMs, prev) {
  if (Date.now() - start >= budgetMs) return entry(probe, { pass: false, reason: 'timeout_budget', duration_ms: 0 }, prev ? prev.attempts : 1);
  return entry(probe, await runOne(probe, ctx), prev ? prev.attempts + 1 : 1);
}

/**
 * Run every probe (and, under waitS, re-run failed read-only ones every intervalMs); results in file order.
 * @param {{probes: object[]}} config
 * @param {{env?: object, budgetMs?: number, waitS?: number, intervalMs?: number, lookup?: Function}} opts
 */
async function execute(config, opts = {}) {
  const ctx = { env: opts.env || process.env, lookup: opts.lookup };
  const budgetMs = opts.budgetMs === undefined ? BUDGET_MS : opts.budgetMs;
  const waitMs = (opts.waitS || 0) * 1000;
  const interval = opts.intervalMs === undefined ? RETRY_INTERVAL_MS : opts.intervalMs;
  const t0 = Date.now();
  let entries = await runPass(null, config, ctx, budgetMs);
  while (!entries.some((e) => e.r.blocked) && Date.now() - t0 + interval <= waitMs) {
    const again = entries.filter((e) => !e.r.pass && !e.r.not_measured && e.r.reason !== 'timeout_budget' && isReadOnly(e.probe));
    if (again.length === 0) break;
    await sleep(interval);
    const redo = await runPass(entries, { probes: again.map((e) => e.probe) }, ctx, budgetMs);
    entries = entries.map((e) => redo.find((x) => x.probe === e.probe) || e);
  }
  return entries.map((e) => ({ ...e.r, id: e.probe.id, kind: e.probe.kind, attempts: e.attempts }));
}

// ---------- report (the single output sink) ----------

/** Exit code from the result list in one place: 2 blocked, 1 any fail / not_measured, else 0. */
function exitCodeOf(results) {
  if (results.some((r) => r.blocked)) return 2;
  return results.some((r) => verdictOf(r) !== 'pass') ? 1 : 0;
}

function summarize(results) {
  const n = { pass: 0, fail: 0, not_measured: 0 };
  results.forEach((r) => { n[verdictOf(r)] += 1; });
  return n;
}

function lineOf(r) {
  const parts = [r.id, r.kind, verdictOf(r), r.reason];
  if (r.status !== undefined) parts.push(`status=${r.status}`);
  if (r.allow_status !== undefined) parts.push(`allow_status=${r.allow_status}`);
  if (r.deny_status !== undefined) parts.push(`deny_status=${r.deny_status}`);
  parts.push(`attempts=${r.attempts}`, `duration_ms=${r.duration_ms}`);
  return parts.join(' ');
}

function report(results, json) {
  const sum = summarize(results);
  const code = exitCodeOf(results);
  if (json) {
    const rows = results.map((r) => ({
      id: r.id, kind: r.kind, verdict: verdictOf(r), reason: r.reason, status: r.status, allow_status: r.allow_status,
      deny_status: r.deny_status, attempts: r.attempts, duration_ms: r.duration_ms,
    }));
    process.stdout.write(`${JSON.stringify({ no_probes: false, results: rows, summary: sum, exit: code })}\n`);
  } else {
    const lines = results.map(lineOf);
    lines.push(`pass=${sum.pass} fail=${sum.fail} not_measured=${sum.not_measured}`);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  return code;
}

function reportNoProbes(config, json) {
  const why = config.absent ? 'not found' : 'has no probes';
  if (json) process.stdout.write(`${JSON.stringify({ no_probes: true, file: config.file, results: [], summary: { pass: 0, fail: 0, not_measured: 0 }, exit: 0 })}\n`);
  else process.stdout.write(`no_probes: ${config.file} ${why}\n`);
  return 0;
}

function loadConfig(project) {
  const { loadProbeConfig, ProbeConfigError } = require(path.join(__dirname, 'probe-config.cjs'));
  try {
    return loadProbeConfig(project);
  } catch (e) {
    if (e instanceof ProbeConfigError) return die(e.message);
    throw e;
  }
}

async function mainRun(opts, held) {
  const project = resolveProject(opts.project);
  const config = loadConfig(project);
  if (config.absent || config.probes.length === 0) return reportNoProbes(config, opts.json);
  held.push(...configSecrets(config, process.env));
  const pf = await require(path.join(__dirname, 'probe-net.cjs')).preflight(config.hosts, process.env);
  if (!pf.ok) return die(`blocked_host: ${pf.host}`);
  const results = await execute(config, { env: process.env, waitS: opts.wait });
  const code = report(results, opts.json);
  if (code === 2) return die('blocked_host: a connected address was refused');
  return code;
}

function cmdProbeRun(args) {
  const opts = parseArgs(args);
  const held = [];
  mainRun(opts, held).then((code) => { process.exitCode = code; }, (e) => die(`internal error: ${(e && e.message) || e}`, held));
}

/**
 * @param {string|undefined} sub - 'run'
 * @param {string[]} args
 */
function cmdProbe(sub, args) {
  if (sub !== 'run') die(`probe requires the subcommand "run". ${USAGE}`);
  cmdProbeRun(args);
}

module.exports = { cmdProbe, execute, scrubMessage, MAX_WAIT_S };
