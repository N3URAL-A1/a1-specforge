'use strict';

// product edit: replace a feature's depends_on or a milestone's target (spec 028 FR-026/FR-027).

const path = require('path');
const { parseFlags, nowIso } = require('./io.cjs');
const { emitExitWithLock, acquireReservationsLock, failWithLock, writeAllOrNothing } = require('./locks.cjs');
const { usage } = require('./help.cjs');
const { productMirrorHook } = require('./vault-product-hook.cjs');
const { productDirFromFlags, buildRoadmapWritesWithChangelog, featureMdWrite, parseRoadmapFile, assertSlug } = require('./product-txn.cjs');

const TARGET_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const EDIT_WHY = 'via product edit';

function parseIdList(value) {
  const ids = String(value).split(',').map((v) => v.trim()).filter((v) => v !== '');
  return [...new Set(ids)];
}

/** True when `from` reaches `target` over depends_on edges (iterative DFS). */
function reaches(graph, from, target) {
  const seen = new Set();
  const stack = [from];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const dep of graph.get(cur) || []) stack.push(dep);
  }
  return false;
}

function sameList(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Validate a new depends_on list for `id`; returns an error text or null. */
function dependsOnError(features, id, deps) {
  const known = new Set(features.map((f) => f.id));
  const unknown = deps.filter((d) => !known.has(d));
  if (unknown.length > 0) return `unknown feature id(s) in --depends-on: ${unknown.join(', ')}`;
  const cancelled = deps.filter((d) => features.some((f) => f.id === d && f.status === 'cancelled'));
  if (cancelled.length > 0) return `--depends-on names cancelled feature(s): ${cancelled.join(', ')} (a cancelled feature never completes; remove it from the list)`;
  if (deps.includes(id)) return `feature '${id}' cannot depend on itself`;
  const graph = new Map(features.map((f) => [f.id, f.id === id ? deps : (f.depends_on || [])]));
  const cyc = deps.find((d) => reaches(graph, d, id));
  return cyc ? `dependency cycle: '${cyc}' already depends on '${id}' (directly or through others)` : null;
}

/** Returns { updatedFm, what, featureMdPatch, featureId } or { unchanged } or { error }. */
function planEdit(roadmapFm, flags) {
  const features = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];
  if (flags.milestone !== undefined) {
    const milestones = Array.isArray(roadmapFm.milestones) ? roadmapFm.milestones : [];
    const m = milestones.find((x) => x.id === flags.milestone);
    if (!m) return { error: `milestone '${flags.milestone}' not found` };
    const target = flags.target === 'null' ? null : flags.target;
    if (target !== null && !TARGET_RE.test(String(target))) return { error: `--target must be YYYY-MM (month 01-12) or null, got ${JSON.stringify(flags.target)}` };
    if ((m.target === undefined ? null : m.target) === target) return { unchanged: true, milestone: flags.milestone };
    const updatedMilestones = milestones.map((x) => (x.id === flags.milestone ? { ...x, target } : x));
    return { updatedFm: { ...roadmapFm, milestones: updatedMilestones }, what: `milestone '${flags.milestone}' target set to ${target === null ? 'null' : target}` };
  }
  const f = features.find((x) => x.id === flags.by);
  if (!f) return { error: `feature '${flags.by}' not found` };
  const deps = parseIdList(flags['depends-on']);
  const err = dependsOnError(features, flags.by, deps);
  if (err) return { error: err };
  if (sameList(Array.isArray(f.depends_on) ? f.depends_on : [], deps)) return { unchanged: true, feature: flags.by };
  const updatedFeatures = features.map((x) => (x.id === flags.by ? { ...x, depends_on: deps } : x));
  return {
    updatedFm: { ...roadmapFm, features: updatedFeatures },
    what: `feature '${flags.by}' depends_on set to [${deps.join(', ')}]`,
    featureId: flags.by,
    featureMdPatch: { depends_on: deps },
  };
}

function cmdProductEdit(args) {
  const flags = parseFlags(args, { by: 'value', 'depends-on': 'value', milestone: 'value', target: 'value', dir: 'value' });
  const featureMode = flags.by !== undefined || flags['depends-on'] !== undefined;
  const milestoneMode = flags.milestone !== undefined || flags.target !== undefined;
  const usageText = 'product edit requires either --by <feature-id> --depends-on <ids> or --milestone <m-slug> --target <YYYY-MM|null>';
  if (featureMode === milestoneMode) usage(usageText);
  if (featureMode && (flags.by === undefined || flags['depends-on'] === undefined)) usage(usageText);
  if (milestoneMode && (flags.milestone === undefined || flags.target === undefined)) usage(usageText);
  if (featureMode) assertSlug(flags.by, 'feature-id');
  if (milestoneMode) assertSlug(flags.milestone, 'milestone');
  const dir = productDirFromFlags(flags);
  const lockPath = acquireReservationsLock(path.join(dir, '.product-stage.lock.json'));
  const roadmap = parseRoadmapFile(dir);
  if (!roadmap) failWithLock(lockPath, `product edit: ${path.join(dir, 'ROADMAP.md')} not found`);
  const plan = planEdit(roadmap.fm, flags);
  if (plan.error) failWithLock(lockPath, `product edit: ${plan.error}`);
  if (plan.unchanged) {
    return emitExitWithLock(lockPath, 0, JSON.stringify({ status: 'unchanged', ...plan }, null, 2) + '\n', '');
  }
  const updatedFm = { ...plan.updatedFm, updated: nowIso().slice(0, 10) };
  const { writes } = buildRoadmapWritesWithChangelog(dir, updatedFm, roadmap.body, plan.what, EDIT_WHY, lockPath);
  if (plan.featureId) {
    const md = featureMdWrite(dir, plan.featureId, plan.featureMdPatch);
    if (md !== null) writes.push(md);
  }
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product edit', productMirrorHook(dir));
  const out = { status: 'OK', edited: plan.what, files_written: writes.map((w) => w.target), vault_mirror: vaultMirror };
  return emitExitWithLock(lockPath, 0, JSON.stringify(out, null, 2) + '\n', '');
}

module.exports = { cmdProductEdit };
