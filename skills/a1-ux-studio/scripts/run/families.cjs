'use strict';
// `families` command (spec 024, FR-016/FR-017, W5). Node core only.
// Pool order: design system named in the project CLAUDE.md > vault taste families > built-in list.
// Output: one JSON object on stdout { source, context, token_source, design_system, pool, candidates, warnings };
// `pool` is every family id the source offers for the context, `candidates` the first 5 of them (plus top-ups).

const fs = require('fs');
const path = require('path');
const { Refusal, requireText, clean } = require('./common.cjs');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'families.json'), 'utf8'));
const CONTEXTS = Object.freeze(['brand', 'product']);
const TASTE_SKILL = 'design-taste-frontend';
const CANDIDATE_COUNT = 5;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_VAULT_ENTRIES = 500;
const MAX_ENTRY_BYTES = 64 * 1024;
const FAMILY_KEY_RE = /^family:\s*([a-z0-9][a-z0-9-]{0,63})\s*$/m;

function noDotDot(name, value) {
  if (value.split(/[\\/]/).includes('..')) throw new Refusal(2, `invalid ${name}: path must not contain ".."`);
  return value;
}

function readSmallFile(name, raw) {
  const given = noDotDot(name, requireText(name, raw));
  let st;
  try { st = fs.statSync(given); } catch (e) { throw new Refusal(2, `invalid ${name}: file not found`); }
  if (!st.isFile()) throw new Refusal(2, `invalid ${name}: not a regular file`);
  if (st.size > MAX_FILE_BYTES) throw new Refusal(2, `invalid ${name}: larger than ${MAX_FILE_BYTES} bytes`);
  return fs.readFileSync(given, 'utf8');
}

/** Design-system skills named in the CLAUDE.md text, in catalog order. Whole-token match only. */
function detectDesignSystems(text) {
  return DATA.designSystems.filter((ds) => new RegExp(`(^|[^A-Za-z0-9_-])${ds.skill}($|[^A-Za-z0-9_-])`).test(text));
}

function parseGuardrails(raw) {
  if (raw === undefined) return Object.freeze({ never: [] });
  let data;
  try { data = JSON.parse(readSmallFile('--guardrails', raw)); } catch (e) {
    if (e instanceof Refusal) throw e;
    throw new Refusal(2, 'invalid --guardrails: not valid JSON');
  }
  const never = data && Array.isArray(data.never) ? data.never.filter((x) => typeof x === 'string') : [];
  return Object.freeze({ never });
}

/** Vault family ids with entry counts: Map<id, n>. Missing or empty folder gives an empty map. */
function vaultFamilies(vaultRoot, warnings) {
  const counts = new Map();
  if (vaultRoot === undefined) return counts;
  const dir = path.join(vaultRoot, 'pattern', 'taste-vault');
  let rootReal; let dirReal;
  try { rootReal = fs.realpathSync(vaultRoot); dirReal = fs.realpathSync(dir); } catch (e) { return counts; }
  if (dirReal !== rootReal && !dirReal.startsWith(rootReal + path.sep)) {
    warnings.push('taste vault folder resolves outside the vault root; ignored');
    return counts;
  }
  const names = fs.readdirSync(dirReal).filter((n) => n.endsWith('.md')).sort().slice(0, MAX_VAULT_ENTRIES);
  for (const n of names) {
    const file = path.join(dirReal, n);
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_ENTRY_BYTES) continue;
    const m = FAMILY_KEY_RE.exec(fs.readFileSync(file, 'utf8').split(/^---\s*$/m)[1] || '');
    if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  return counts;
}

const loadsTaste = (f) => f.skills.includes(TASTE_SKILL);
const contextRank = (ctx) => (f) => (f.contexts.includes(ctx) ? 0 : 1);

/** Context filter then stable ordering: families written for the context first, catalog order kept. */
function orderForContext(pool, ctx) {
  const usable = ctx === 'product' ? pool.filter((f) => !loadsTaste(f)) : pool;
  const rank = contextRank(ctx);
  return usable.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
}

const candidate = (f, source, skills, extra) => Object.freeze({
  id: f.id, name: f.name, descriptor: f.descriptor, skills: Object.freeze([...skills]), source, ...extra,
});

function designSystemResult(systems, ctx, guardrails, warnings) {
  const sys = systems[0];
  if (systems.length > 1) warnings.push(`CLAUDE.md names several design systems (${systems.map((s) => s.skill).join(', ')}); using ${sys.skill}`);
  for (const rule of guardrails.never) {
    const hit = sys.fonts.find((font) => new RegExp(`\\b${font.toLowerCase()}\\b`).test(rule.toLowerCase()));
    if (hit) warnings.push(`guardrail "${clean(rule).slice(0, 120)}" conflicts with design system ${sys.skill} font ${hit}; the design system wins`);
  }
  const ordered = orderForContext(DATA.families, ctx);
  const picked = ordered.slice(0, CANDIDATE_COUNT);
  return {
    pool: ordered.map((f) => f.id),
    source: 'design-system', designSystem: sys.skill, tokenSource: `skill:${sys.skill}`,
    candidates: picked.map((f) => candidate(f, 'design-system', [sys.skill], { fonts: Object.freeze([...sys.fonts]) })),
  };
}

function poolResult(vault, ctx, warnings) {
  const known = DATA.families.filter((f) => vault.has(f.id));
  for (const id of vault.keys()) if (!DATA.families.some((f) => f.id === id)) warnings.push(`taste vault family "${id}" is not in the built-in catalog; ignored`);
  const fromVault = orderForContext(known, ctx).slice(0, CANDIDATE_COUNT);
  if (fromVault.length === 0) {
    const all = orderForContext(DATA.families, ctx);
    const built = all.slice(0, CANDIDATE_COUNT);
    return { pool: all.map((f) => f.id), source: 'builtin', designSystem: null, tokenSource: 'builtin', candidates: built.map((f) => candidate(f, 'builtin', f.skills, {})) };
  }
  const missing = CANDIDATE_COUNT - fromVault.length;
  const topUp = missing > 0
    ? orderForContext(DATA.families, ctx).filter((f) => !fromVault.some((v) => v.id === f.id)).slice(0, missing) : [];
  if (topUp.length > 0) warnings.push(`taste vault has only ${fromVault.length} usable families for this context; topped up from the built-in list`);
  return {
    pool: orderForContext(known, ctx).map((f) => f.id),
    source: 'vault', designSystem: null, tokenSource: 'vault',
    candidates: [
      ...fromVault.map((f) => candidate(f, 'vault', f.skills, { entries: vault.get(f.id) })),
      ...topUp.map((f) => candidate(f, 'builtin', f.skills, {})),
    ],
  };
}

function families(args) {
  const ctx = args.context === undefined ? 'product' : args.context;
  if (!CONTEXTS.includes(ctx)) throw new Refusal(2, `invalid --context: want ${CONTEXTS.join('|')}`);
  const guardrails = parseGuardrails(args.guardrails);
  const claudeText = args['project-claude-md'] === undefined ? '' : readSmallFile('--project-claude-md', args['project-claude-md']);
  const vaultRaw = args['vault-root'] !== undefined ? args['vault-root'] : process.env.A1_VAULT_ROOT;
  const vaultRoot = vaultRaw === undefined || vaultRaw === '' ? undefined : noDotDot('--vault-root', requireText('--vault-root', vaultRaw));
  const warnings = [];
  const systems = detectDesignSystems(claudeText);
  const r = systems.length > 0
    ? designSystemResult(systems, ctx, guardrails, warnings)
    : poolResult(vaultFamilies(vaultRoot, warnings), ctx, warnings);
  process.stdout.write(`${JSON.stringify({
    source: r.source, context: ctx, design_system: r.designSystem, token_source: r.tokenSource,
    pool: r.pool, candidates: r.candidates, warnings,
  }, null, 2)}\n`);
  return 0;
}

module.exports = Object.freeze({ families, detectDesignSystems });
