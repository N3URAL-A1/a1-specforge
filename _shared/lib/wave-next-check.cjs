'use strict';

// `wave next-check` (spec 027 FR-021, plan D7): the stop-reason of a wave boundary.
// stdout is exactly `continue` (exit 0) or `stop:<reason>` (exit 1). Every source is required
// ("missing source = stop", owner decision 2026-11-20): a missing store means the run broke.
// Checks run in a fixed order; the first stop wins.

const fs = require('fs');
const path = require('path');
const gateLog = require('./gate-log.cjs');
const { parseLanes, parseWaves, frontmatterOf } = require('./lane-split.cjs');
const { emitExit } = require('./emit-exit.cjs');

const USAGE = 'a1-tools wave next-check <slug> <wave> --since <iso> [--project <dir>] [--plan <file>] [--checkpoint-each-wave]';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STOP_TYPES = Object.freeze(['deviation', 'blocker']);

class UsageError extends Error {}

const stop = (reason, detail) => ({ reason, detail });
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch (_e) { return null; } };

/** Records of the gate log at or after `since`; null reason when the log is fine. */
function gateRed({ root, slug, since }) {
  const file = gateLog.logPathFor(root, slug);
  if (!fs.existsSync(file)) return stop('gate_red', `no gate log at ${file}`);
  let chain;
  try { chain = gateLog.verifyChain(file); } catch (e) { return stop('gate_red', `gate log unreadable: ${e.message}`); }
  if (!chain.ok) return stop('gate_red', 'gate log chain does not verify');
  const sinceMs = Date.parse(since);
  const recent = chain.records.filter((r) => Date.parse(r.ts) >= sinceMs);
  if (recent.length === 0) return stop('gate_red', `no gate record at or after ${since}`);
  const last = new Map();
  for (const r of recent) last.set(r.gate, r.verdict);
  const red = [...last].filter(([, v]) => v === 'fail' || v === 'error').map(([g, v]) => `${g}=${v}`);
  return red.length ? stop('gate_red', `last verdict red since ${since}: ${red.join(', ')}`) : null;
}

function deviation({ root, slug, wave }) {
  const text = readText(path.join(root, '.a1', 'phases', slug, 'observations.jsonl'));
  if (text === null) return stop('deviation', 'source_missing: observations.jsonl');
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  for (let i = 0; i < lines.length; i++) {
    let obs;
    try { obs = JSON.parse(lines[i]); } catch (_e) { return stop('deviation', `observations.jsonl line ${i + 1} is not JSON`); }
    if (obs === null || typeof obs !== 'object') return stop('deviation', `observations.jsonl line ${i + 1} is not an object`);
    const sameWave = obs.wave === undefined || Number(obs.wave) === wave;
    if (STOP_TYPES.includes(obs.type) && sameWave) return stop('deviation', `${obs.type} observation at line ${i + 1}`);
  }
  return null;
}

/** Rows `- <token> ...` under `## Decisions` of GOAL.md. */
function decisionRows(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Decisions\s*$/.test(l));
  if (start === -1) return null;
  const rows = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    const m = /^-\s+(\S+)/.exec(lines[i]);
    if (m) rows.push(m[1]);
  }
  return rows;
}

function scopeChange({ root, slug, since }) {
  const text = readText(path.join(root, '.a1', 'phases', slug, 'GOAL.md'));
  if (text === null) return stop('scope_change', 'source_missing: GOAL.md');
  const rows = decisionRows(text);
  if (rows === null) return stop('scope_change', 'no_decisions_section: GOAL.md has no "## Decisions" heading');
  const sinceMs = Date.parse(since);
  const sinceDay = new Date(sinceMs).toISOString().slice(0, 10);
  for (const token of rows) {
    if (ISO_RE.test(token)) {
      if (Date.parse(token) >= sinceMs) return stop('scope_change', `decision ${token} is at or after ${since}`);
    } else if (DATE_RE.test(token)) {
      if (token >= sinceDay) return stop('scope_change', `date-only decision ${token} is on or after the day of ${since} (fail-closed, repeats for every wave of that day; rewrite the row with an ISO timestamp to clear it)`);
    } else {
      return stop('scope_change', `decision row starts with ${JSON.stringify(token.slice(0, 40))}, not a date`);
    }
  }
  return null;
}

function laneAgent(text, next) {
  const { lanes, sequentialAfter } = parseLanes(frontmatterOf(text));
  if (sequentialAfter.includes(next)) return null;
  const lane = lanes.find((l) => l.waves.includes(next));
  if (!lane) return stop('agent_unnamed', `no lane holds wave ${next}`);
  return lane.agent ? null : stop('agent_unnamed', `lane ${lane.id} (wave ${next}) names no agent`);
}

function agentUnnamed({ root, slug, wave, plan }) {
  const file = plan || path.join(root, '.a1', 'phases', slug, 'PLAN.md');
  const text = readText(file);
  if (text === null) return stop('agent_unnamed', `plan missing or unreadable: ${file}`);
  const next = wave + 1;
  const section = parseWaves(text).find((w) => w.num === next);
  if (!section) return null;
  const fm = frontmatterOf(text);
  if (/^lanes:\s*none\b/im.test(fm)) return null;
  if (/^lanes:/m.test(fm)) return laneAgent(text, next);
  if (!plan) return null;
  const ok = /^#{2,4}\s+Suggested agent\(s\)\s*$[\s\S]*?^\s*-\s+\*\*[^*\s][^*]*\*\*/m.test(section.body);
  return ok ? null : stop('agent_unnamed', `wave ${next} has no "### Suggested agent(s)" with a "- **<name>**" line`);
}

/**
 * @param {{slug: string, wave: number, since: string, root: string, plan?: string|null, checkpointEachWave?: boolean}} opts
 * @returns {{result: 'continue'|'stop', reason: string|null, detail: string}}
 */
function nextCheck(opts) {
  const ctx = { ...opts, plan: opts.plan || null };
  if (opts.checkpointEachWave) return { result: 'stop', reason: 'owner_requested', detail: '--checkpoint-each-wave given' };
  const checks = opts.wave === 0 ? [agentUnnamed] : [gateRed, deviation, scopeChange, agentUnnamed];
  for (const check of checks) {
    const hit = check(ctx);
    if (hit) return { result: 'stop', reason: hit.reason, detail: hit.detail };
  }
  return { result: 'continue', reason: null, detail: '' };
}

function parseArgs(rest) {
  const [slug, waveRaw, ...flags] = rest;
  const o = { project: null, plan: null, since: null, checkpointEachWave: false };
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === '--checkpoint-each-wave') o.checkpointEachWave = true;
    else if (f === '--since' || f === '--project' || f === '--plan') {
      if (i + 1 >= flags.length) throw new UsageError(`${f} needs a value`);
      o[f.slice(2)] = flags[++i];
    } else throw new UsageError(`unknown argument ${JSON.stringify(String(f).slice(0, 60))}`);
  }
  try { gateLog.validateScope(slug === undefined ? null : slug); } catch (e) { throw new UsageError(e.message); }
  if (!/^\d+$/.test(String(waveRaw))) throw new UsageError('<wave> must be an integer >= 0');
  if (o.since === null || !ISO_RE.test(o.since) || Number.isNaN(Date.parse(o.since))) throw new UsageError('--since <ISO-8601 UTC> is required');
  return { ...o, slug, wave: Number(waveRaw) };
}

/** @param {string[]} rest */
function cmdWaveNextCheck(rest) {
  let args;
  try { args = parseArgs(rest); } catch (e) {
    if (!(e instanceof UsageError) && !(e && e.code === 'A1_INPUT')) throw e;
    return emitExit(2, '', `wave next-check: ${e.message}\nusage: ${USAGE}\n`);
  }
  const dir = path.resolve(args.project || process.cwd());
  const ctx = gateLog.gitContext(dir);
  const root = ctx ? ctx.root : dir;
  const out = nextCheck({ ...args, root, plan: args.plan ? path.resolve(args.plan) : null });
  if (out.result === 'continue') return emitExit(0, 'continue\n', '');
  return emitExit(1, `stop:${out.reason}\n`, `wave next-check: ${out.reason}: ${out.detail}\n`);
}

module.exports = { cmdWaveNextCheck, nextCheck };
