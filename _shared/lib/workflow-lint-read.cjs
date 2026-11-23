'use strict';

const fs = require('fs');
const path = require('path');
const { skillFiles, measureSkills, checkBudget } = require('./workflow-lint-budget.cjs');

// ---------------------------------------------------------------------------
// Reading-path rules (spec 027 slice 5; plan D3, D10, D11):
//   - conditional files are read only after their trigger command ran (FR-028),
//   - no raw `worktree add` / `--delete-branch` text in skills outside a1-worktree (FR-030),
//   - vault sync / dashboard build / cost run sit in the right workflow files (FR-032).
// The module owns no copy of the vault-sync regex: the caller passes it (fail closed).
// ---------------------------------------------------------------------------

const ALLOW_MARKER = '<!-- lint-allow: forbidden-example -->';
const FORBIDDEN = Object.freeze([
  { re: /worktree\s+add/, what: 'worktree add' },
  { re: /--delete-branch/, what: '--delete-branch' },
]);
const DASHBOARD_BUILD_RE = /a1-tools\.cjs dashboard build\b/;
const COST_RUN_RE = /a1-tools\.cjs cost run\b/;
const PER_WAVE_FILES = Object.freeze(['skills/a1-execute/workflows/02-execute.md', 'skills/a1-new-feature/workflows/05-implement.md']);
const PHASE_END_FILES = Object.freeze(['skills/a1-plan/workflows/04-audit.md', 'skills/a1-execute/workflows/03-verify.md']);
const CLOSING_FILES = Object.freeze([
  'skills/a1-execute/workflows/03-verify.md',
  'skills/a1-new-feature/workflows/06-verify.md',
  'skills/a1-fix/workflows/04-verify.md',
]);

function fail(msg) {
  const err = new Error(msg);
  err.code = 'A1_INPUT';
  return err;
}

function assertHelpers(h) {
  if (!h || typeof h.extractBashFenceLines !== 'function') throw fail('checkReadingPath: helpers.extractBashFenceLines is missing or not a function');
  if (!(h.VAULT_SYNC_CALL_RE instanceof RegExp)) throw fail('checkReadingPath: helpers.VAULT_SYNC_CALL_RE is missing or not a RegExp');
}

function walkMd(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isDirectory()) walkMd(path.join(dir, e.name), `${rel}/${e.name}`, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(`${rel}/${e.name}`);
  }
  return out;
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Per line: `{fenced, heading}`; headings are detected outside fenced blocks only (D3). */
function lineKinds(lines) {
  const kinds = [];
  let inFence = false;
  for (const line of lines) {
    const fenceLine = /^\s*```/.test(line);
    if (fenceLine) { kinds.push({ fenced: true, heading: false }); inFence = !inFence; continue; }
    kinds.push({ fenced: inFence, heading: !inFence && /^#{1,6}\s/.test(line) });
  }
  return kinds;
}

function triggerOn(line, fenced, trigger) {
  const call = new RegExp(`a1-tools\\.cjs ${esc(trigger)}(?![A-Za-z0-9-])`);
  if (fenced) return call.test(line);
  return new RegExp('`[^`]*' + call.source + '[^`]*`').test(line);
}

function refRe(basename) { return new RegExp(`(^|[^A-Za-z0-9._-])${esc(basename)}`); }

function checkConditionalRefs(root, skillNames) {
  const findings = [];
  const conds = [];
  const defaults = [];
  for (const name of skillNames) {
    const f = skillFiles(root, name);
    conds.push(...f.conditional);
    defaults.push(...f.defaultPath);
  }
  const seen = new Map();
  for (const c of conds) {
    const b = path.basename(c.file);
    if (seen.has(b)) findings.push({ file: c.file, rule: 'conditional_basename_duplicate', reason: `basename ${b} is also used by ${seen.get(b)}` });
    else seen.set(b, c.file);
  }
  for (const rel of defaults) {
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
    const kinds = lineKinds(lines);
    for (const c of conds) {
      const re = refRe(path.basename(c.file));
      let sectionStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (kinds[i].heading) sectionStart = i;
        if (!re.test(lines[i])) continue;
        let ok = false;
        for (let j = sectionStart; j < i && !ok; j++) ok = triggerOn(lines[j], kinds[j].fenced, c.trigger);
        if (!ok) findings.push({ file: rel, line: i + 1, rule: 'conditional_ref_untriggered', reason: `${rel}:${i + 1} names ${path.basename(c.file)} before an earlier line of its section runs "a1-tools.cjs ${c.trigger}"` });
      }
    }
  }
  return { findings, conditionalFiles: conds.length };
}

function checkForbidden(root, allMd) {
  const findings = [];
  let scanned = 0;
  for (const rel of allMd) {
    if (rel.startsWith('skills/a1-worktree/')) continue;
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      scanned++;
      if (line.includes(ALLOW_MARKER)) return;
      for (const f of FORBIDDEN) {
        if (f.re.test(line)) findings.push({ file: rel, line: i + 1, rule: 'forbidden_command', reason: `${rel}:${i + 1} contains "${f.what}"; use the a1-worktree skill or mark a documented example with ${ALLOW_MARKER}` });
      }
    });
  }
  return { findings, scanned };
}

function fenced(root, rel, helpers) {
  return helpers.extractBashFenceLines(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function countRe(lines, re) { return lines.filter((l) => re.test(l.text)).length; }

function checkSync(root, allMd, helpers) {
  const findings = [];
  const exists = (rel) => fs.existsSync(path.join(root, rel));
  const files = new Set([...PER_WAVE_FILES, ...PHASE_END_FILES, ...CLOSING_FILES].filter(exists));
  for (const rel of PER_WAVE_FILES.filter(exists)) {
    const L = fenced(root, rel, helpers);
    const v = countRe(L, helpers.VAULT_SYNC_CALL_RE);
    const d = countRe(L, DASHBOARD_BUILD_RE);
    if (v || d) findings.push({ file: rel, rule: 'sync_per_wave', reason: `${rel} holds ${v} fenced vault sync and ${d} dashboard build line(s); both belong to the phase end` });
  }
  for (const rel of PHASE_END_FILES.filter(exists)) {
    const L = fenced(root, rel, helpers);
    const v = countRe(L, helpers.VAULT_SYNC_CALL_RE);
    const d = countRe(L, DASHBOARD_BUILD_RE);
    if (v !== 1 || d !== 1) findings.push({ file: rel, rule: 'sync_phase_end_count', reason: `${rel} must hold exactly one fenced vault sync and one dashboard build line, found ${v} and ${d}` });
  }
  for (const rel of CLOSING_FILES.filter(exists)) {
    const k = countRe(fenced(root, rel, helpers), COST_RUN_RE);
    if (k !== 1) findings.push({ file: rel, rule: 'cost_run_placement', reason: `${rel} must hold exactly one fenced cost run line, found ${k}` });
  }
  for (const rel of allMd.filter((r) => !CLOSING_FILES.includes(r))) {
    const k = countRe(fenced(root, rel, helpers), COST_RUN_RE);
    if (k > 0) findings.push({ file: rel, rule: 'cost_run_placement', reason: `${rel} holds ${k} fenced cost run line(s); only the closing step files may` });
  }
  return { findings, files: files.size };
}

/**
 * Check the reading-path rules under `root`.
 * @param {string} root
 * @param {{extractBashFenceLines: function(string): {lineNo: number, text: string}[], VAULT_SYNC_CALL_RE: RegExp}} helpers
 *   both supplied by the caller; a missing or mistyped helper throws an error with code A1_INPUT.
 * @returns {{checked: {budget_skills: number, conditional_files: number, forbidden_lines_scanned: number, sync_files: number},
 *   findings: {file: string, line: (number|undefined), rule: string, reason: string}[]}}
 */
function checkReadingPath(root, helpers) {
  assertHelpers(helpers);
  const budget = checkBudget(root);
  const checked = { budget_skills: budget.checked, conditional_files: 0, forbidden_lines_scanned: 0, sync_files: 0 };
  const skillsDir = path.join(root, 'skills');
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) return { checked, findings: budget.findings };
  const allMd = walkMd(skillsDir, 'skills', []);
  const names = measureSkills(root).skills.map((s) => s.name);
  const cond = checkConditionalRefs(root, names);
  const forb = checkForbidden(root, allMd);
  const sync = checkSync(root, allMd, helpers);
  checked.conditional_files = cond.conditionalFiles;
  checked.forbidden_lines_scanned = forb.scanned;
  checked.sync_files = sync.files;
  return { checked, findings: [...budget.findings, ...cond.findings, ...forb.findings, ...sync.findings] };
}

module.exports = { checkReadingPath, PER_WAVE_FILES, PHASE_END_FILES, CLOSING_FILES };
