'use strict';

// ---------------------------------------------------------------------------
// xprov placement — spec 016 Wave 7 (FR-019, FR-020; plan decision D-1). Where does a cross-provider review run at all?
//
//   plan-review-xprov  runs only when the SIZE of the spec named in PLAN.md is L, or the files the plan names are security surface.
//                      Size comes from the `size:` field of the spec file named by the PLAN.md frontmatter (`spec:` or `spec_path:`);
//                      a missing file, an inline description or a missing field is size unknown (decided by surface alone). NEVER from a flag.
//                      The plan's files are the backtick-quoted relative paths inside its `## Wave` sections.
//                      A plan with no `## Wave` section cannot be placed: it runs (fail closed).
//   wave-inspect-xprov runs only for a wave that a LATER wave names in its `**Depends on:**` line (lane-split.cjs declaredDeps) AND whose files
//                      are security surface: the paths the plan names for the wave, or the diff (--base to HEAD) of the wave. A wave the
//                      plan does not list, or a diff git cannot produce, runs (fail closed).
//
// Everything else is `not_applicable` / `scope_exempt`: zero runner calls, nothing written (the caller returns before any write).
// The classifier is the Wave 6 one (xprov-scope.cjs); an unclassifiable path counts as surface there. Pure given the files it reads;
// no env other than A1_VAULT_ROOT (a spec path relative to the vault), no network, no shell.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const C = require('./xprov-common.cjs');
const SC = require('./xprov-scope.cjs');
const LS = require('./lane-split.cjs');

const MAX_PLAN_BYTES = 4 * 1024 * 1024;
const MAX_SPEC_BYTES = 2 * 1024 * 1024;
const MAX_SPEC_REF_CHARS = 300;
const FRONTMATTER_MAX_LINES = 400;
const SIZE_L = 'L';
const SIZES = Object.freeze(['S', 'M', 'L']);
// the first token of the frontmatter value: a relative .md path; anything else ("inline (…)", "docs/roadmap.md (M6 section)" keeps its path) is not
const SPEC_REF_RE = /^([A-Za-z0-9_][A-Za-z0-9_./-]*\.md)(?=$|[\s(,;+])/;
const SPEC_KEY_RE = /^(?:spec|spec_path):\s*(.*?)\s*$/;
const SIZE_LINE_RE = /^size:\s*["']?([A-Za-z]+)["']?\s*(?:#.*)?$/;
const BACKTICK_RE = /`([^`\n]+)`/g;
// a backtick span is a path candidate when it has no space or shell metacharacter and a directory separator or a file extension
const PATH_SHAPE_RE = /^[^\s$();|&<>"']+$/;
const EXT_RE = /\.[A-Za-z0-9]{1,8}$/;
const REASON = 'scope_exempt';

/** The frontmatter lines of a markdown text (between the first two `---` lines, BOM and blank lines tolerated), or []. */
function frontmatter(text) {
  const lines = String(text).replace(/^﻿/, '').split('\n').slice(0, FRONTMATTER_MAX_LINES).map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (lines[i] !== '---') return [];
  const end = lines.indexOf('---', i + 1);
  return end === -1 ? [] : lines.slice(i + 1, end);
}

function unquote(v) {
  const m = /^(["'])(.*)\1$/.exec(v);
  return m ? m[2] : v;
}

/** The relative spec path PLAN.md names, or null (inline, empty, absolute, traversal, too long). */
function specRefOf(planText) {
  for (const line of frontmatter(planText)) {
    const m = SPEC_KEY_RE.exec(line);
    if (m === null) continue;
    const v = unquote(m[1]);
    if (v === '' || v.length > MAX_SPEC_REF_CHARS * 4) return null;
    const ref = SPEC_REF_RE.exec(v);
    if (ref === null || ref[1].length > MAX_SPEC_REF_CHARS || ref[1].split('/').includes('..')) return null;
    return ref[1];
  }
  return null;
}

function insideRealpath(base, file) {
  let b; let f;
  try { b = fs.realpathSync(base); f = fs.realpathSync(file); } catch (_e) { return false; }
  return f === b || f.startsWith(b + path.sep);
}

/** The size (S|M|L) of the spec file `ref` (repo-relative, else vault-relative), or null = unknown. */
function sizeOfSpec(root, ref) {
  if (ref === null) return null;
  const bases = [root];
  if (typeof process.env.A1_VAULT_ROOT === 'string' && process.env.A1_VAULT_ROOT !== '') bases.push(process.env.A1_VAULT_ROOT);
  for (const base of bases) {
    const file = path.join(base, ref);
    if (!insideRealpath(base, file)) continue;
    const buf = C.readNoFollow(file, MAX_SPEC_BYTES);
    if (buf === null) continue;
    for (const line of frontmatter(buf.toString('utf8'))) {
      const m = SIZE_LINE_RE.exec(line);
      if (m !== null) return SIZES.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : null;
    }
    return null;
  }
  return null;
}

/** Backtick-quoted path candidates of a text. Hostile spans (spaces, `$(…)`, `;`) are inert text and are skipped. */
function pathsIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(BACKTICK_RE)) {
    const t = m[1].trim();
    if (t === '' || !PATH_SHAPE_RE.test(t)) continue;
    if (t.includes('/') || EXT_RE.test(t)) out.add(t);
  }
  return [...out];
}

const LOOSE_SPLIT_RE = /[\s`'"<>()[\]{},;|&$=]+/;
const LOOSE_EDGE_RE = /^[-*#>:]+|[:.]+$/g;

/**
 * Every relative path-shaped token of the whole text, quoted or not, under any heading (WP-3): a surface file named in prose or under `## Files`
 * still makes the plan run. Absolute paths, URLs, `~` and `..` segments in free text are not repo paths and are skipped here (the strict
 * backtick rule of the `## Wave` sections still counts them as unclassifiable = surface).
 */
function looseTokens(text) {
  const out = new Set();
  for (const raw of String(text).split(LOOSE_SPLIT_RE)) {
    const t = raw.replace(LOOSE_EDGE_RE, '');
    if (t === '' || t.startsWith('/') || t.startsWith('~') || t.includes(':') || t.split('/').includes('..')) continue;
    if (t.includes('/') || EXT_RE.test(t)) out.add(t);
  }
  return [...out];
}

/** { num, paths, deps } per `## Wave N` section of the plan text. */
function wavesOf(planText) {
  return LS.parseWaves(planText).map((w) => Object.freeze({ num: w.num, paths: pathsIn(w.body), deps: LS.declaredDeps(w.body) }));
}

const surfaceOf = (paths) => SC.classifyPaths(paths, SC.loadGlobs()).security_surface;

function readPlan(planPath) {
  const buf = C.readNoFollow(planPath, MAX_PLAN_BYTES);
  return buf === null ? null : buf.toString('utf8');
}

const exempt = (detail, extra) => Object.freeze({ run: false, reason: REASON, detail, ...extra });
const runs = (detail, extra) => Object.freeze({ run: true, reason: null, detail, ...extra });

/** Placement of the plan review: { run, reason, detail, size, surface }. */
function planPlacement(root, planPath) {
  const text = readPlan(planPath);
  if (text === null) return runs('PLAN.md unreadable: placement cannot decide', { size: null, surface: null });
  const waves = wavesOf(text);
  const size = sizeOfSpec(root, specRefOf(text));
  if (waves.length === 0) return runs('PLAN.md has no `## Wave` section: placement cannot decide', { size, surface: null });
  if (size === SIZE_L) return runs('spec size L', { size, surface: null });
  const surface = surfaceOf([...waves.flatMap((w) => w.paths), ...looseTokens(text)]);
  return surface ? runs('the plan names security surface', { size, surface }) : exempt(`spec size ${size === null ? 'unknown' : size} and no security surface in the files the plan names`, { size, surface });
}

/** The plan-side facts of a wave: { listed, depended, surface } (surface = the files the plan names for it). */
function planFactsOfWave(planText, wave) {
  const waves = wavesOf(planText);
  const mine = waves.find((w) => w.num === wave);
  if (mine === undefined) return Object.freeze({ listed: false, depended: false, surface: false });
  const depended = waves.some((w) => w.num > wave && w.deps.includes(wave));
  return Object.freeze({ listed: true, depended, surface: surfaceOf(mine.paths) });
}

function diffSurface(workPath, base) {
  try { return surfaceOf(SC.diffPaths(workPath, base, 'HEAD')); } catch (_e) { return true; } // git cannot say: guarded
}

/** Placement of the inspection of `wave` (diff = base..HEAD in workPath): { run, reason, detail, depended, surface }. */
function wavePlacement(planPath, wave, workPath, base) {
  const text = readPlan(planPath);
  if (text === null) return runs('PLAN.md unreadable: placement cannot decide', { depended: null, surface: null });
  const f = planFactsOfWave(text, wave);
  if (!f.listed) return runs(`wave ${wave} is not a \`## Wave\` section of PLAN.md: placement cannot decide`, { depended: null, surface: null });
  if (!f.depended) return exempt(`no later wave names wave ${wave} in its Depends on line`, { depended: false, surface: null });
  const surface = f.surface || diffSurface(workPath, base);
  return surface ? runs('a later wave depends on this wave and it touches security surface', { depended: true, surface }) : exempt('a later wave depends on this wave, but no security surface in its files or its diff', { depended: true, surface });
}

const RANGE_RE = /^(\d{1,4})=([0-9a-fA-F]{7,40})\.\.([0-9a-fA-F]{7,40})$/;

/** `--wave-range 1=<base>..<head>,2=…` → Map wave → { base, head }; throws A1_INPUT on a malformed entry. */
function parseRanges(value) {
  const m = new Map();
  if (value === undefined) return m;
  for (const part of String(value).split(',').map((s) => s.trim()).filter(Boolean)) {
    const r = RANGE_RE.exec(part);
    if (r === null) throw C.inputError(`--wave-range entries are <wave>=<base sha>..<head sha>, got ${JSON.stringify(C.clip(part, 80))}`);
    m.set(Number(r[1]), Object.freeze({ base: r[2], head: r[3] }));
  }
  return m;
}

/**
 * Keys `wave|lane` of the completed pairs wave-status may treat as scope_exempt (spec 016 FR-020, Samuel wave 7 WP-2):
 * the PLAN.md must be the one accepted at Load (expectSha given and equal), the gate left no row for the wave, and either no later wave
 * depends on it (accepted, the PR diff gate reviews the whole diff, WP-4) or the plan names no surface for it AND its real diff
 * (--wave-range, base..head) re-classifies as no surface. A missing range or a diff git cannot produce: not exempt.
 */
function exemptKeys(o) {
  const text = readPlan(o.planPath);
  if (text === null || !o.planShaOk) return new Set();
  const ranges = parseRanges(o.rangesText);
  const ok = (p) => {
    if (o.hasRow(p)) return false;
    const f = planFactsOfWave(text, p.wave);
    if (!f.listed) return false;
    if (!f.depended) return true;
    const r = ranges.get(p.wave);
    return !f.surface && r !== undefined && !rangeSurface(o.workPath, r);
  };
  return new Set(o.completed.filter(ok).map((p) => `${p.wave}|${p.lane || ''}`));
}

function rangeSurface(workPath, r) {
  try { return surfaceOf(SC.diffPaths(workPath, r.base, r.head)); } catch (_e) { return true; }
}

/** The gate's stdout report for an exempt review: nothing was run, nothing is written. */
function result(base, pl) {
  return Object.freeze({ ...base, verdict: 'not_applicable', step: 'placement', reason: REASON, reason_detail: pl.detail, placement: 'scope_exempt' });
}

const NOTICE = 'not_applicable — scope_exempt: the placement rule says this review does not apply (small or no security surface); no code leaves, the pipeline continues';

module.exports = { REASON, NOTICE, SIZES, specRefOf, sizeOfSpec, pathsIn, wavesOf, planPlacement, wavePlacement, exemptKeys, planFactsOfWave, parseRanges, result };
