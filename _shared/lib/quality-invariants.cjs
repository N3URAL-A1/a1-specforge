'use strict';

// ---------------------------------------------------------------------------
// quality-invariants — keep-list lint (spec 027 FR-034, D9).
// Reads `<root>/_shared/quality-invariants.json` and the CI workflow files named
// in it, always relative to `root` (never __dirname). Pure checks + a small loader.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseRegistryRows, rowInvokes } = require('./gate-ids.cjs');

const FILE_REL = path.join('_shared', 'quality-invariants.json');
const MAX_BYTES = 256 * 1024;
const MAX_REF_BYTES = 4 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9.-]{0,80}$/;
const KINDS = ['deterministic', 'prompt'];
const PROMPT_FIELDS = ['owner_skill', 'owner_ref', 'must_contain'];

const isStr = (v) => typeof v === 'string' && v !== '';

function readSmall(file, cap) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > cap) return null;
    return fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return null;
  }
}

function unsafeRef(ref) {
  return path.isAbsolute(ref) || ref.split(/[\\/]/).includes('..') || ref.includes('\0');
}

function entryProblem(g) {
  if (!g || typeof g !== 'object') return 'gate entry is not an object';
  if (!isStr(g.id) || !ID_RE.test(g.id)) return `bad gate id ${JSON.stringify(g.id)}`;
  if (!KINDS.includes(g.kind)) return `${g.id}: unknown kind ${JSON.stringify(g.kind)}`;
  if (g.kind === 'prompt') {
    for (const f of PROMPT_FIELDS) if (!isStr(g[f])) return `${g.id}: prompt entry misses ${f}`;
    if (unsafeRef(g.owner_ref)) return `${g.id}: owner_ref must be relative without ..`;
  }
  return null;
}

function stepProblem(s) {
  if (!s || typeof s !== 'object') return 'ci step is not an object';
  for (const f of ['file', 'job', 'name']) if (!isStr(s[f])) return `ci step misses ${f}`;
  if (unsafeRef(s.file)) return 'ci step file must be relative without ..';
  return null;
}

function validate(spec) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.gates) || !Array.isArray(spec.ci_steps)) {
    return 'needs "gates" and "ci_steps" arrays';
  }
  for (const g of spec.gates) { const p = entryProblem(g); if (p) return p; }
  for (const s of spec.ci_steps) { const p = stepProblem(s); if (p) return p; }
  return null;
}

function unquote(text) {
  const t = text.trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) return t.slice(1, -1);
  return t;
}

/** Plain string comparison inside the job block; no regex is built from the step name. */
function stepInJob(text, job, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === `  ${job}:`);
  if (start === -1) return false;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) break;
    const m = lines[i].match(/^\s*-\s+name:\s*(.*)$/);
    if (m && unquote(m[1]) === name) return true;
  }
  return false;
}

function gateFindings(g, row, inv, root, lintReport) {
  const out = [];
  const f = (rule, reason) => out.push({ rule, gate: g.id, reason });
  if (!row) { f('invariant_missing', 'keep-list gate has no registry row'); return out; }
  if (row.cells.class !== g.kind) f('invariant_class_changed', `registry class "${row.cells.class}" is not "${g.kind}"`);
  if (inv && inv.exemption) f('invariant_unwired_until', `keep-list gate carries unwired_until=${inv.exemption.until}`);
  if (g.kind === 'deterministic') {
    const wiredIds = new Set(((lintReport && lintReport.wired) || []).map((w) => w.gate));
    const lintUnwired = ((lintReport && lintReport.findings) || []).some((x) => x.rule === 'unwired' && x.gate === g.id);
    if (!inv || inv.kind !== 'command') f('invariant_unwired', 'invoke cell is not a command');
    else if (lintUnwired || !wiredIds.has(g.id)) f('invariant_unwired', 'no skill calls the gate command');
  } else {
    const owner = row.cells['owning file'] || '';
    const text = unsafeRef(g.owner_ref) ? null : readSmall(path.join(root, g.owner_ref), MAX_REF_BYTES);
    if (!owner.includes(g.owner_skill)) f('invariant_owner_lost', `owning file cell lacks ${g.owner_skill}`);
    else if (text === null) f('invariant_owner_lost', `${g.owner_ref} is missing`);
    else if (!text.includes(g.must_contain)) f('invariant_owner_lost', `${g.owner_ref} lacks its owner anchor`);
  }
  return out;
}

/**
 * Check the keep-list against the registry, the lint report and the CI workflow.
 *
 * @param {{root: string, defaultRoot: boolean, registryText: string, lintReport: {wired: Object[], findings: Object[]}}} p
 * @returns {{status: 'checked'|'absent', file: string, ids: number, ci_steps: number, findings: {rule: string, gate: (string|null), step?: string, reason: string}[]}}
 */
function checkInvariants({ root, defaultRoot, registryText, lintReport }) {
  const file = path.join(root, FILE_REL);
  const base = { status: 'checked', file, ids: 0, ci_steps: 0, findings: [] };
  const raw = readSmall(file, MAX_BYTES);
  if (raw === null) {
    let exists = false;
    try { exists = fs.existsSync(file); } catch (_e) { exists = false; }
    if (exists) return { ...base, findings: [{ rule: 'invariant_file_invalid', gate: null, reason: 'unreadable or over 256 KB' }] };
    if (!defaultRoot) return { ...base, status: 'absent' };
    return { ...base, findings: [{ rule: 'invariant_file_missing', gate: null, reason: `${FILE_REL} is missing` }] };
  }
  let spec;
  try { spec = JSON.parse(raw); } catch (e) {
    return { ...base, findings: [{ rule: 'invariant_file_invalid', gate: null, reason: `bad JSON: ${e.message}` }] };
  }
  const bad = validate(spec);
  if (bad) return { ...base, findings: [{ rule: 'invariant_file_invalid', gate: null, reason: bad }] };
  const rows = new Map(parseRegistryRows(registryText).map((r) => [r.id, r]));
  const invs = new Map(rowInvokes(registryText).map((r) => [r.id, r]));
  const findings = spec.gates.flatMap((g) => gateFindings(g, rows.get(g.id), invs.get(g.id), root, lintReport));
  for (const s of spec.ci_steps) {
    const text = readSmall(path.join(root, s.file), MAX_REF_BYTES);
    if (text === null || !stepInJob(text, s.job, s.name)) {
      findings.push({ rule: 'invariant_ci_step_missing', gate: null, step: `${s.job}: ${s.name}`, reason: `step not found in job ${s.job} of ${s.file}` });
    }
  }
  return { ...base, ids: spec.gates.length, ci_steps: spec.ci_steps.length, findings };
}

module.exports = { checkInvariants };
