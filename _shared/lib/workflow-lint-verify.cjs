'use strict';
// workflow-lint rules for the verify scope split (spec 027 slice 2, FR-007/FR-008).
//   verify-scope      per-wave `verify run` carries --affected; Verify-step `verify run` never does.
//   verify-reuse-ban  `verify reuse` stays out of the merge path.
// No require of workflow-lint.cjs (no cycle): the fence helpers come in as a parameter.

const fs = require('fs');
const path = require('path');

const PER_WAVE_FILES = Object.freeze([
  'skills/a1-execute/workflows/02-execute.md',
  'skills/a1-new-feature/workflows/05-implement.md',
]);
const VERIFY_FILES = Object.freeze([
  'skills/a1-execute/workflows/03-verify.md',
  'skills/a1-new-feature/workflows/06-verify.md',
  'agents/a1-victor-verifier.md',
]);
const REUSE_BAN_FILES = Object.freeze([
  'skills/a1-pr-review/workflows/05-merge.md',
  '_shared/lib/pr-merge-check.cjs',
]);

const VERIFY_RUN_RE = /(?:a1-tools\.cjs|\$\{?A1_TOOLS\}?"?)\s+verify\s+run(?=\s|;|$)/;
const AFFECTED_RE = /(?:^|\s)--affected(?=\s|;|$)/;
const REUSE_RE = /verify['",\s]+reuse|verify-reuse/;
const IGNORED_LINE_RE = /^\s*(?:#|echo\b|printf\b)/;

// skills/ files are always required; agents/ and _shared/lib/ files only when that
// top directory exists under root (a skills-only copy stays green).
function isRequired(root, rel) {
  const top = rel.split('/')[0];
  if (top === 'skills') return true;
  const sub = top === '_shared' ? '_shared/lib' : top;
  try {
    return fs.statSync(path.join(root, sub)).isDirectory();
  } catch (_e) {
    return false;
  }
}

function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return null;
  }
}

function verifyRunCalls(content, helpers) {
  return helpers
    .joinContinuations(helpers.extractBashFenceLines(content))
    .map((l) => l.text)
    .filter((t) => !IGNORED_LINE_RE.test(t) && VERIFY_RUN_RE.test(t));
}

function checkVerifyScope(root, isSkillsTree, helpers) {
  if (!isSkillsTree(root)) return { checked: 0, findings: [] };
  const findings = [];
  let checked = 0;
  const groups = [
    [PER_WAVE_FILES, true],
    [VERIFY_FILES, false],
  ];
  for (const [files, perWave] of groups) {
    for (const rel of files) {
      if (!isRequired(root, rel)) continue;
      checked += 1;
      const file = path.join(root, rel);
      const content = readOrNull(file);
      const add = (reason) => findings.push({ file, rule: 'verify-scope', reason });
      if (content === null) {
        add('file missing or unreadable');
        continue;
      }
      const calls = verifyRunCalls(content, helpers);
      if (calls.length === 0) {
        add('no fenced verify run call');
        continue;
      }
      for (const call of calls) {
        const has = AFFECTED_RE.test(call);
        if (perWave && !has) add('per-wave verify run without --affected');
        if (!perWave && has) add('Verify-step verify run with --affected');
      }
    }
  }
  return { checked, findings };
}

function checkReuseBan(root, isSkillsTree) {
  if (!isSkillsTree(root)) return { checked: 0, findings: [] };
  const findings = [];
  let checked = 0;
  for (const rel of REUSE_BAN_FILES) {
    if (!isRequired(root, rel)) continue;
    checked += 1;
    const file = path.join(root, rel);
    const content = readOrNull(file);
    if (content === null) {
      findings.push({ file, rule: 'verify-reuse-ban', reason: 'file missing or unreadable' });
      continue;
    }
    if (content.split('\n').some((l) => REUSE_RE.test(l))) {
      findings.push({
        file,
        rule: 'verify-reuse-ban',
        reason: 'verify reuse is banned here (merge-check stays CI evidence or a fresh run)',
      });
    }
  }
  return { checked, findings };
}

module.exports = {
  checkVerifyScope,
  checkReuseBan,
  PER_WAVE_FILES,
  VERIFY_FILES,
  REUSE_BAN_FILES,
};
