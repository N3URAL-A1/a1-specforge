'use strict';

// ---------------------------------------------------------------------------
// gates-lint — `gates lint`: every registry gate that names a skill in its
// `invoke` cell must be called from that skill, in a fenced bash block
// (spec 017-enforced-self-checks, Wave 1, FR-001..FR-005).
//
// Pure core: takes the registry text, a skills directory and a UTC date and
// returns findings. No process.exit, no stdout (gates-cli.cjs owns those).
// Fenced-bash extraction is imported from workflow-lint.cjs, not copied.
//
// Rules (rule id -> condition):
//   no_invoke_column     the id table has no `invoke` column
//   malformed_row        a table row has fewer cells than the header
//   invoke_invalid       cell breaks the grammar (see gate-ids.cjs)
//   blocking_unwired     deterministic + blocking row whose cell is none/empty
//   prompt_names_command prompt/human row names a subcommand
//   duplicate_subcommand two rows declare the same subcommand
//   unknown_skill        a named skill has no directory under skills/
//   unwired              a named skill has no fenced call of the subcommand
//   exemption_expired    the exemption date lies before today
//   call_without_phase   a skill wires `retro validate --gate-log` but a call of a named gate in it has no --phase
//                        (the gate log line would land in _unscoped and the retro's gates_fired check always stops)
// A valid, unexpired exemption suppresses blocking_unwired and unwired for
// that row; it is always listed.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { rowInvokes } = require('./gate-ids.cjs');
const { extractBashFenceLines, joinContinuations } = require('./workflow-lint.cjs');

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_WORKFLOW_FILE_BYTES = 2 * 1024 * 1024;

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `a1-tools.cjs <sub words>` followed by a word boundary, so `run` does not
// match `runx`; the words may be separated by any run of spaces.
function callRegex(subcommand) {
  const words = subcommand.split(/\s+/).map(escapeRe).join('\\s+');
  return new RegExp(`a1-tools\\.cjs\\s+${words}(?=$|[\\s"'\\\;|&)])`);
}

function isCallLine(text) {
  const t = text.trim();
  return t !== '' && !t.startsWith('#') && !/^(echo|printf)\b/.test(t);
}

/** Files a skill's gate calls are searched in: SKILL.md and workflows/*.md. */
function skillFiles(skillsRoot, skill) {
  const dir = path.join(skillsRoot, skill);
  const files = [path.join(dir, 'SKILL.md')];
  try {
    const wf = path.join(dir, 'workflows');
    for (const e of fs.readdirSync(wf, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md')) files.push(path.join(wf, e.name));
    }
  } catch (_e) { /* no workflows dir: SKILL.md only */ }
  return files.sort();
}

function readIfSmall(file) {
  try {
    if (fs.statSync(file).size > MAX_WORKFLOW_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return null;
  }
}

/** Matching `{file, line}` call sites of `subcommand` in the given files. */
function findCalls(files, subcommand) {
  const re = callRegex(subcommand);
  const hits = [];
  for (const file of files) {
    const content = readIfSmall(file);
    if (content === null) continue;
    for (const l of joinContinuations(extractBashFenceLines(content))) {
      if (isCallLine(l.text) && re.test(l.text)) hits.push({ file, line: l.lineNo, text: l.text });
    }
  }
  return hits;
}

const PHASE_FLAG_RE = /(?:^|\s)--phase(?:=|\s|$)/;
const GATE_LOG_FLAG_RE = /(?:^|\s)--gate-log(?:=|\s|$)/;

/** True when the skill's workflows validate the retro against the phase gate log (`retro validate --gate-log`). */
function wiresGateLog(files) {
  return findCalls(files, 'retro validate').some((h) => GATE_LOG_FLAG_RE.test(h.text));
}

function skillDirExists(skillsRoot, skill) {
  if (!SKILL_NAME_RE.test(skill)) return false;
  try {
    return fs.statSync(path.join(skillsRoot, skill)).isDirectory();
  } catch (_e) {
    return false;
  }
}

function exemptionState(row, today) {
  if (!row.exemption) return { active: false };
  if (row.exemption.until < today) return { active: false, expired: true };
  return { active: true };
}

// Row-level rules that need no file access.
function gradeRow(row, today) {
  const out = [];
  const f = (rule, reason) => out.push({ rule, gate: row.id, reason });
  if (row.malformed) f('malformed_row', 'row has fewer cells than the table header');
  if (row.kind === 'invalid') f('invoke_invalid', row.error);
  const ex = exemptionState(row, today);
  if (ex.expired) f('exemption_expired', `unwired_until=${row.exemption.until} is before ${today} (${row.exemption.reason})`);
  const hardClass = row.class === 'deterministic' && row.enforcement === 'blocking';
  if (hardClass && (row.kind === 'none') && !ex.active) f('blocking_unwired', 'deterministic + blocking row has invoke none');
  if ((row.class === 'prompt' || row.class === 'human') && row.kind === 'command') {
    f('prompt_names_command', `${row.class} row names subcommand ${row.subcommand}`);
  }
  return out;
}

function checkSkills(row, skillsRoot, today) {
  const out = [];
  const ex = exemptionState(row, today);
  const wired = [];
  const missing = [];
  for (const skill of row.skills) {
    if (!skillDirExists(skillsRoot, skill)) {
      out.push({ rule: 'unknown_skill', gate: row.id, skill, reason: `no directory skills/${skill}` });
      continue;
    }
    const files = skillFiles(skillsRoot, skill);
    const hits = findCalls(files, row.subcommand);
    if (hits.length > 0) {
      wired.push({ skill, calls: hits.length });
      if (wiresGateLog(files)) {
        for (const h of hits.filter((x) => !PHASE_FLAG_RE.test(x.text))) {
          out.push({ rule: 'call_without_phase', gate: row.id, skill, file: h.file, line: h.line, reason: `"a1-tools.cjs ${row.subcommand}" has no --phase <phase_name> but ${skill} validates its retro with retro validate --gate-log` });
        }
      }
      continue;
    }
    missing.push({ skill, files });
  }
  if (!ex.active) {
    for (const m of missing) {
      out.push({
        rule: 'unwired', gate: row.id, skill: m.skill, subcommand: row.subcommand,
        reason: `no fenced bash call of "a1-tools.cjs ${row.subcommand}"`,
        searched: m.files,
      });
    }
  }
  return { findings: out, wired, missing: missing.map((m) => m.skill) };
}

function duplicateFindings(rows) {
  const seen = new Map();
  const out = [];
  for (const r of rows) {
    if (r.kind !== 'command') continue;
    if (seen.has(r.subcommand)) {
      out.push({ rule: 'duplicate_subcommand', gate: r.id, reason: `subcommand "${r.subcommand}" already declared by ${seen.get(r.subcommand)}` });
    } else seen.set(r.subcommand, r.id);
  }
  return out;
}

/**
 * @param {{registryText: string, skillsRoot: string, today: string}} input today = UTC YYYY-MM-DD
 * @returns {{rows: number, wired: Object[], exemptions: Object[], findings: Object[]}}
 */
function lintGates({ registryText, skillsRoot, today }) {
  const rows = rowInvokes(registryText);
  if (rows.length === 0) return { rows: 0, wired: [], exemptions: [], findings: [{ rule: 'no_rows', reason: 'registry has no id table' }] };
  if (rows.some((r) => !r.hasInvokeColumn)) {
    return { rows: rows.length, wired: [], exemptions: [], findings: [{ rule: 'no_invoke_column', reason: 'the id table has no invoke column' }] };
  }
  let findings = duplicateFindings(rows);
  const wired = [];
  const exemptions = [];
  for (const row of rows) {
    findings = findings.concat(gradeRow(row, today));
    if (row.exemption) exemptions.push({ gate: row.id, until: row.exemption.until, reason: row.exemption.reason });
    if (row.kind !== 'command') continue;
    const res = checkSkills(row, skillsRoot, today);
    findings = findings.concat(res.findings);
    for (const w of res.wired) wired.push({ gate: row.id, subcommand: row.subcommand, ...w });
  }
  return { rows: rows.length, wired, exemptions, findings };
}

module.exports = { lintGates, callRegex, skillFiles, findCalls };
