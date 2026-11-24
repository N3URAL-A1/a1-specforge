'use strict';

const fs = require('fs');
const path = require('path');
const { parseFlags, repoRoot, writeTextAtomic } = require('./io.cjs');
const { emitExit } = require('./emit-exit.cjs');
const { gitSafe } = require('./git-safe.cjs');
const { RULE_SENTENCE, BUDGET_REL, inScope, measureSkills, checkBudget, readBudget, validateBudget } = require('./workflow-lint-budget.cjs');

// ---------------------------------------------------------------------------
// workflow budget [--root <dir>] [--write] [--base <ref>]  (spec 027 slice 5, FR-027, plan D8/D12a)
//
// Without flags: check every skill against skills/reading-budget.json.
// --write: write the budget file from the measured sizes (atomic, keys sorted).
// --base <ref>: ratchet. A skill whose entry grew against <ref> needs a
//   `budget-raise: <skill>` trailer in <ref>..HEAD, else finding budget_raised:<skill>.
//
// Scope first (D8, D12a): a root without `skills/` or without a regular file
// `_shared/a1-tools.cjs` is not an a1-specforge tree (a consumer repo): print
// scope "out", exit 0, before any git call. --write out of scope exits 2.
//
// Exit codes: 0 clean, 1 finding, 2 usage, git or I/O error.
// ---------------------------------------------------------------------------

const MAX_ROOT_LEN = 4096;
const OUT_NAME = 'workflow budget';

function usageFail(msg) {
  return emitExit(2, '', `error: ${OUT_NAME}: ${msg}\n`);
}

function hostileRoot(raw) {
  if (raw.length > MAX_ROOT_LEN) return `--root too long (${raw.length} chars, max ${MAX_ROOT_LEN})`;
  if (/[\x00-\x1f\x7f]/.test(raw)) return '--root contains a control character';
  return null;
}

function resolveRoot(flags) {
  const raw = flags.root === undefined ? repoRoot() : flags.root;
  if (typeof raw !== 'string' || raw === '') return { error: '--root needs a value' };
  const bad = hostileRoot(raw);
  if (bad) return { error: bad };
  const root = path.resolve(process.cwd(), raw);
  let st = null;
  try { st = fs.statSync(root); } catch (_e) { st = null; }
  if (!st || !st.isDirectory()) return { error: `--root is not a directory: ${root}` };
  return { root };
}

function sortedBudgetJson(skills) {
  const budgets = {};
  for (const s of [...skills].sort((a, b) => (a.name < b.name ? -1 : 1))) budgets[s.name] = s.lines;
  return JSON.stringify({ schema: 1, rule: RULE_SENTENCE, budgets }, null, 2) + '\n';
}

function baseRatchet(root, ref, current) {
  if (typeof ref !== 'string' || ref === '' || ref.startsWith('-')) return { error: `base_unresolved: ${JSON.stringify(ref)}` };
  const rev = gitSafe(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true });
  if (typeof rev !== 'string' || rev === '') return { error: `base_unresolved: ${ref}` };
  const shown = gitSafe(root, ['show', `${rev}:${BUDGET_REL}`], { allowFail: true });
  if (typeof shown !== 'string') return { base: { sha: rev, budget: 'absent' }, raised: [], findings: [] };
  let parsed;
  try { parsed = validateBudget(JSON.parse(shown)); } catch (_e) { parsed = { ok: false }; }
  if (!parsed.ok) return { error: `base_budget_invalid: ${BUDGET_REL} at ${rev}` };
  const trailers = gitSafe(root, ['log', `${rev}..HEAD`, '--format=%(trailers:key=budget-raise,valueonly)'], { allowFail: true });
  if (typeof trailers !== 'string') return { error: `git log failed for ${rev}..HEAD` };
  const named = new Set(trailers.split('\n').map((l) => l.trim()).filter(Boolean));
  const raised = [];
  const findings = [];
  for (const [skill, now] of Object.entries(current || {})) {
    const was = parsed.budgets[skill];
    if (was === undefined || now <= was) continue;
    raised.push(skill);
    if (!named.has(skill)) findings.push({ file: BUDGET_REL, rule: `budget_raised:${skill}`, reason: `budget for ${skill} raised ${was} -> ${now} without a "budget-raise: ${skill}" trailer in ${rev.slice(0, 12)}..HEAD` });
  }
  return { base: { sha: rev, budget: 'present' }, raised, findings };
}

/**
 * `workflow budget` — see the module header.
 * @param {string[]} argv
 * @returns {void} exits through emitExit; stdout JSON `{root, scope, rule, skills: [{skill, lines, budget}], findings, base, raised}`:
 *   `scope` is "in" or "out"; `skills[].budget` is the entry of the budget file or null; `findings` are `{file, rule, reason}`;
 *   `base` is null, or `{sha, budget: "absent"|"present"}`; `raised` names every skill whose entry grew against the base.
 */
function cmdWorkflowBudget(argv) {
  const flags = parseFlags(argv, { root: 'value', write: 'bool', base: 'value' });
  if (flags._.length > 0) return usageFail(`unrecognised arguments: ${flags._.join(' ')}`);
  const r = resolveRoot(flags);
  if (r.error) return usageFail(r.error);
  const root = r.root;
  const hasBase = Object.prototype.hasOwnProperty.call(flags, 'base');
  if (hasBase && flags.base === undefined) return usageFail('--base needs a value');
  const out = { root, scope: 'out', rule: RULE_SENTENCE, skills: [], findings: [], base: null, raised: [] };
  if (!inScope(root)) {
    if (flags.write) return usageFail('out_of_scope: no skills/ directory or _shared/a1-tools.cjs under the root; refusing --write');
    return emitExit(0, JSON.stringify(out) + '\n', '');
  }
  out.scope = 'in';
  const { skills } = measureSkills(root);
  if (flags.write) {
    try { writeTextAtomic(path.join(root, BUDGET_REL), sortedBudgetJson(skills)); } catch (e) { return usageFail(`write failed: ${e.message}`); }
  }
  const chk = checkBudget(root);
  const bud = readBudget(root);
  out.skills = skills.map((s) => ({ skill: s.name, lines: s.lines, budget: bud.ok && bud.budgets[s.name] !== undefined ? bud.budgets[s.name] : null, conditional: s.conditional.map((c) => c.file) }));
  out.findings = chk.findings;
  if (hasBase) {
    const rat = baseRatchet(root, flags.base, bud.ok ? bud.budgets : {});
    if (rat.error) return usageFail(rat.error);
    out.base = rat.base;
    out.raised = rat.raised;
    out.findings = out.findings.concat(rat.findings);
  }
  const text = out.findings.map((f) => `finding: ${f.file} - ${f.rule}: ${f.reason}\n`).join('');
  return emitExit(out.findings.length > 0 ? 1 : 0, JSON.stringify(out) + '\n', text);
}

module.exports = { cmdWorkflowBudget };
