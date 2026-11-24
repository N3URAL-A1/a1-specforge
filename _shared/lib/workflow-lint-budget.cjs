'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Reading-budget counting and check (spec 027 slice 5, FR-027, plan D8/D12/D12a).
//
// COUNTING RULE: the size of a file is the number of `\n` characters (`wc -l`);
// a last line without a newline is not counted. The default path of a skill is
// SKILL.md plus every workflows/*.md (not recursive) whose first line is not a
// conditional header. A first line that starts with `<!-- load: conditional`
// but does not match the exact header stays on the default path (fail closed)
// and is a finding.
//
// SCOPE (D12a): the budget check runs only on a root that holds a regular file
// `_shared/a1-tools.cjs` and a `skills/` directory. A copied `skills/` tree
// alone gets `{checked: 0, findings: []}`.
// ---------------------------------------------------------------------------

const BUDGET_REL = 'skills/reading-budget.json';
const RULE_SENTENCE =
  'Lines are counted as newline characters (wc -l); the default path of a skill is SKILL.md plus every workflows/*.md ' +
  'whose first line is not a conditional header (<!-- load: conditional trigger=<group> [<sub>] -->).';
const CONDITIONAL_RE = /^<!-- load: conditional trigger=([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)?) -->$/;
const CONDITIONAL_PREFIX = '<!-- load: conditional';
const ALLOWED_TOP_KEYS = Object.freeze(['schema', 'rule', 'budgets']);

/**
 * Number of newline characters in `text` (identical to `wc -l`).
 * @param {string} text
 * @returns {number} count of `\n`
 */
function countLines(text) {
  let n = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/**
 * Parse the first line of a workflow file.
 * @param {string} firstLine
 * @returns {{conditional: boolean, trigger: (string|null), malformed: boolean}}
 */
function parseConditionalHeader(firstLine) {
  const m = CONDITIONAL_RE.exec(firstLine);
  if (m) return { conditional: true, trigger: m[1], malformed: false };
  return { conditional: false, trigger: null, malformed: firstLine.startsWith(CONDITIONAL_PREFIX) };
}

function firstLineOf(text) {
  const i = text.indexOf('\n');
  return i === -1 ? text : text.slice(0, i);
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (_e) { return false; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_e) { return false; }
}

/**
 * Classify the files of one skill. Repo-relative, sorted paths; only SKILL.md and workflows/*.md.
 * @param {string} root
 * @param {string} skill
 * @returns {{defaultPath: string[], conditional: {file: string, trigger: string}[], malformed: string[]}}
 */
function skillFiles(root, skill) {
  const out = { defaultPath: [], conditional: [], malformed: [] };
  const base = `skills/${skill}`;
  if (isFile(path.join(root, base, 'SKILL.md'))) out.defaultPath.push(`${base}/SKILL.md`);
  const wfDir = path.join(root, base, 'workflows');
  const names = isDir(wfDir) ? fs.readdirSync(wfDir).filter((n) => n.endsWith('.md')).sort() : [];
  for (const n of names) {
    const rel = `${base}/workflows/${n}`;
    if (!isFile(path.join(root, rel))) continue;
    const h = parseConditionalHeader(firstLineOf(fs.readFileSync(path.join(root, rel), 'utf8')));
    if (h.conditional) out.conditional.push({ file: rel, trigger: h.trigger });
    else {
      out.defaultPath.push(rel);
      if (h.malformed) out.malformed.push(rel);
    }
  }
  out.defaultPath.sort();
  return out;
}

/**
 * Measure every skill directory that has a SKILL.md. A root without `skills/` returns no skills.
 * @param {string} root
 * @returns {{skills: {name: string, lines: number, files: string[], conditional: {file: string, trigger: string}[]}[]}}
 */
function measureSkills(root) {
  const dir = path.join(root, 'skills');
  if (!isDir(dir)) return { skills: [] };
  const skills = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!isFile(path.join(dir, name, 'SKILL.md'))) continue;
    const f = skillFiles(root, name);
    let lines = 0;
    for (const rel of f.defaultPath) lines += countLines(fs.readFileSync(path.join(root, rel), 'utf8'));
    skills.push({ name, lines, files: f.defaultPath, conditional: f.conditional });
  }
  return { skills };
}

/**
 * D12a scope test: `skills/` is a directory and `_shared/a1-tools.cjs` is a regular file.
 * @param {string} root
 * @returns {boolean}
 */
function inScope(root) {
  return isDir(path.join(root, 'skills')) && isFile(path.join(root, '_shared', 'a1-tools.cjs'));
}

/**
 * Read and validate `skills/reading-budget.json` (schema 1).
 * @param {string} root
 * @returns {{ok: boolean, budgets: (Object<string, number>|null), reason: (string|null)}}
 */
function readBudget(root) {
  const file = path.join(root, BUDGET_REL);
  if (!isFile(file)) return { ok: false, budgets: null, reason: 'missing' };
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { ok: false, budgets: null, reason: `invalid JSON: ${e.message}` }; }
  return validateBudget(j);
}

function validateBudget(j) {
  const bad = (reason) => ({ ok: false, budgets: null, reason });
  if (!j || typeof j !== 'object' || Array.isArray(j)) return bad('not an object');
  const unknown = Object.keys(j).filter((k) => !ALLOWED_TOP_KEYS.includes(k));
  if (unknown.length) return bad(`unknown top-level key: ${unknown.join(', ')}`);
  if (j.schema !== 1) return bad('schema must be 1');
  if (!j.budgets || typeof j.budgets !== 'object' || Array.isArray(j.budgets)) return bad('budgets must be an object');
  for (const [k, v] of Object.entries(j.budgets)) {
    if (!Number.isInteger(v) || v <= 0) return bad(`budget for ${k} must be a positive integer`);
  }
  return { ok: true, budgets: j.budgets, reason: null };
}

/**
 * Check every skill against its budget (`lines <= budget`, D12).
 * Rules: budget_file_missing, budget_file_invalid, budget_exceeded, budget_missing_entry,
 * budget_unknown_skill, conditional_header_malformed.
 * @param {string} root
 * @returns {{checked: number, findings: {file: string, rule: string, reason: string}[]}}
 */
function checkBudget(root) {
  if (!inScope(root)) return { checked: 0, findings: [] };
  const { skills } = measureSkills(root);
  const findings = [];
  for (const s of skills) {
    for (const f of skillFiles(root, s.name).malformed) {
      findings.push({ file: f, rule: 'conditional_header_malformed', reason: 'first line starts with "<!-- load: conditional" but is not a valid header; file stays on the default path' });
    }
  }
  const b = readBudget(root);
  if (!b.ok) {
    const rule = b.reason === 'missing' ? 'budget_file_missing' : 'budget_file_invalid';
    findings.push({ file: BUDGET_REL, rule, reason: b.reason });
    return { checked: skills.length, findings };
  }
  for (const s of skills) {
    const budget = b.budgets[s.name];
    if (budget === undefined) findings.push({ file: BUDGET_REL, rule: 'budget_missing_entry', reason: `no budget entry for skill ${s.name}` });
    else if (s.lines > budget) findings.push({ file: `skills/${s.name}`, rule: 'budget_exceeded', reason: `skill ${s.name} default path is ${s.lines} lines, budget ${budget}` });
  }
  const names = new Set(skills.map((s) => s.name));
  for (const k of Object.keys(b.budgets)) {
    if (!names.has(k)) findings.push({ file: BUDGET_REL, rule: 'budget_unknown_skill', reason: `budget entry ${k} has no skill directory` });
  }
  return { checked: skills.length, findings };
}

module.exports = {
  BUDGET_REL, RULE_SENTENCE, CONDITIONAL_RE,
  countLines, parseConditionalHeader, skillFiles, measureSkills, inScope, readBudget, validateBudget, checkBudget,
};
