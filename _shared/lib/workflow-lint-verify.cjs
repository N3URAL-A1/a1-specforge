'use strict';
// workflow-lint rules for the verify scope split (spec 027 slice 2, FR-007/FR-008).
//   verify-scope      per-wave `verify run` carries --affected; Verify-step `verify run` never does.
//   verify-reuse-ban  `verify reuse` stays out of the merge path.
//   quiet-host-poll   no pgrep-based poll in any fenced block under skills/ (FR-017).
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
const POLL_RE = /(^|[\s;&|(`$])pgrep(\s|$)/;
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

// Lines inside any ``` or ~~~ fence (any info string); closes on the same marker.
function fencedLines(content) {
  const out = [];
  let marker = null;
  content.split('\n').forEach((line, i) => {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (marker === null) {
      if (m) marker = m[1][0];
    } else if (m && m[1][0] === marker && /^\s*(```+|~~~+)\s*$/.test(line)) {
      marker = null;
    } else {
      out.push({ lineNo: i + 1, text: line });
    }
  });
  return out;
}

// Every .md under skills/, recursive, symlinks skipped.
function listSkillMarkdown(root) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
    }
  };
  walk(path.join(root, 'skills'));
  return out.sort();
}

function checkQuietHostPoll(root, isSkillsTree) {
  if (!isSkillsTree(root)) return { checked: 0, findings: [] };
  const findings = [];
  const files = listSkillMarkdown(root);
  for (const file of files) {
    const content = readOrNull(file);
    if (content === null) continue;
    if (fencedLines(content).some((l) => POLL_RE.test(l.text))) {
      findings.push({
        file,
        rule: 'quiet-host-poll',
        reason: 'pgrep-based quiet-host poll in a fenced block (spec 027 FR-017: the verify run CLI lock replaces it)',
      });
    }
  }
  return { checked: files.length, findings };
}

module.exports = {
  checkQuietHostPoll,
  POLL_RE,
  checkVerifyScope,
  checkReuseBan,
  PER_WAVE_FILES,
  VERIFY_FILES,
  REUSE_BAN_FILES,
};
