'use strict';
// workflow-lint rules for the lean flow (spec 027 slice 4, FR-019/FR-021/FR-022).
//   verify-early-review  06-verify.md of a1-new-feature never names the reviewer agent (D10).
//   wave-checkpoint      a wave prompt appears only between `<!-- a1:stop -->` markers (D8).
//   pr-confirmation      03-draft.md and 04-submit.md hold no PR-creation confirmation (D9).
// The rules read whole lines. No require of workflow-lint.cjs (no import cycle).

const fs = require('fs');
const path = require('path');

const EARLY_REVIEW_FILES = Object.freeze(['skills/a1-new-feature/workflows/06-verify.md']);
const EARLY_REVIEW_MARKERS = Object.freeze(['a1-reinhard-reviewer']);

const CHECKPOINT_FILES = Object.freeze([
  'skills/a1-execute/workflows/02-execute.md',
  'skills/a1-new-feature/workflows/05-implement.md',
]);
const CHECKPOINT_MARKERS = Object.freeze([
  'Continue? [y',
  'Wait for user input before starting next wave',
  'Should I dispatch the agent like this',
  'Wait for user confirmation',
  'Do **not** dispatch automatically',
  'Continue to next wave or stop',
  'Once the user confirms',
]);
const STOP_OPEN = '<!-- a1:stop -->';
const STOP_CLOSE = '<!-- /a1:stop -->';

const PR_CONFIRM_FILES = Object.freeze([
  'skills/a1-pr-review/workflows/03-draft.md',
  'skills/a1-pr-review/workflows/04-submit.md',
]);
const PR_CONFIRM_MARKERS = Object.freeze([
  'Should I create the PR',
  'yes / no / adjust draft',
  'Are you sure',
  'User must have confirmed',
  'User aborts at confirm',
]);

function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return null;
  }
}

// Reads each file of a rule and calls scan(lines, add) on it.
function runRule(root, isSkillsTree, files, rule, scan) {
  if (!isSkillsTree(root)) return { checked: 0, findings: [] };
  const findings = [];
  for (const rel of files) {
    const file = path.join(root, rel);
    const content = readOrNull(file);
    const add = (line, reason) => findings.push({ file, rule, line, reason });
    if (content === null) {
      add(0, 'file missing or unreadable');
      continue;
    }
    scan(content.split('\n'), add);
  }
  return { checked: files.length, findings };
}

function flagMarkers(lines, markers, add, skip) {
  lines.forEach((text, i) => {
    if (skip && skip(i)) return;
    const hit = markers.find((m) => text.includes(m));
    if (hit) add(i + 1, `marker "${hit}" is not allowed here`);
  });
}

/**
 * @returns {{checked: number, findings: Array<{file: string, rule: string, line: number, reason: string}>}}
 */
function checkEarlyReview(root, isSkillsTree) {
  return runRule(root, isSkillsTree, EARLY_REVIEW_FILES, 'verify-early-review', (lines, add) =>
    flagMarkers(lines, EARLY_REVIEW_MARKERS, add));
}

/**
 * @returns {{checked: number, findings: Array<{file: string, rule: string, line: number, reason: string}>}}
 */
function checkWaveCheckpoint(root, isSkillsTree) {
  return runRule(root, isSkillsTree, CHECKPOINT_FILES, 'wave-checkpoint', (lines, add) => {
    const inside = new Array(lines.length).fill(false);
    let openAt = -1;
    lines.forEach((text, i) => {
      if (text.includes(STOP_CLOSE)) openAt = -1;
      else if (text.includes(STOP_OPEN)) { if (openAt < 0) openAt = i; }
      inside[i] = openAt >= 0;
    });
    flagMarkers(lines, CHECKPOINT_MARKERS, add, (i) => inside[i]);
    if (openAt >= 0) add(openAt + 1, 'unclosed <!-- a1:stop --> block');
  });
}

/**
 * @returns {{checked: number, findings: Array<{file: string, rule: string, line: number, reason: string}>}}
 */
function checkPrConfirmation(root, isSkillsTree) {
  return runRule(root, isSkillsTree, PR_CONFIRM_FILES, 'pr-confirmation', (lines, add) =>
    flagMarkers(lines, PR_CONFIRM_MARKERS, add));
}

module.exports = { checkEarlyReview, checkWaveCheckpoint, checkPrConfirmation };
