'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { BUG_STATUSES, BUG_SEVERITIES } = require('./status-constants.cjs');
const { usage } = require('./help.cjs');
const {
  vaultRoot,
  resolveVaultPath,
  parseFlags,
  readMd,
  writeMdAtomic,
  nowIso,
  fail,
  projectsPath,
} = require('./io.cjs');
const { appendPhaseHistory } = require('./spec.cjs');

// ---------- fix subcommands ----------

function cmdFixNextSuffix(args) {
  const projectSlug = args[0];
  const date = args[1];
  if (!projectSlug || !date) {
    usage('fix next-suffix requires <project-slug> <YYYY-MM-DD>');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage(`invalid date "${date}", expected YYYY-MM-DD`);
  }
  const dir = projectsPath(projectSlug, 'fixes');
  let used = new Set(); // suffixes used today, "" + "-2" + "-3" ...
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^${date}-.+?(-(\\d+))?\\.md$`);
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(re);
      if (m) {
        used.add(m[2] ? parseInt(m[2], 10) : 1);
      }
    }
  }
  // first bug of day → no suffix; second → -2; third → -3 ...
  let n = 1;
  while (used.has(n)) n++;
  const suffix = n === 1 ? '' : `-${n}`;
  return {
    project: projectSlug,
    date,
    suffix,
    padded: suffix,
    dir,
  };
}

function cmdFixUpdateStatus(args) {
  const bugPathInput = args[0];
  const newStatus = args[1];
  if (!bugPathInput || !newStatus) {
    usage('fix update-status requires <bug-path> <new-status>');
  }
  if (!BUG_STATUSES.has(newStatus)) {
    usage(
      `invalid bug status "${newStatus}". valid: ${[...BUG_STATUSES].join(', ')}`
    );
  }
  const flags = parseFlags(args.slice(2), {
    'recommended-code-agent': 'value',
    'fix-commit': 'value',
    'verify-result': 'value',
    'duplicate-of': 'value',
  });
  const bugPath = resolveVaultPath(bugPathInput);
  if (!fs.existsSync(bugPath)) fail(`bug file not found: ${bugPath}`);
  const { fm, body } = readMd(bugPath);
  fm.status = newStatus;

  // Phase mapping for bug lifecycle.
  const PHASE_MAP = {
    reported: 'report',
    diagnosed: 'diagnose',
    fixing: 'fix-start',
    fixed: 'verify',
    'cant-reproduce': 'cant-reproduce',
    'wont-fix': 'wont-fix',
    duplicate: 'duplicate',
    cancelled: 'cancelled',
  };
  const phase = PHASE_MAP[newStatus];
  if (phase) appendPhaseHistory(fm, phase);

  if (flags['recommended-code-agent'] !== undefined) {
    fm.recommended_code_agent = flags['recommended-code-agent'];
  }
  if (flags['fix-commit'] !== undefined) {
    fm.fix_commit = flags['fix-commit'];
  }
  if (flags['verify-result'] !== undefined) {
    fm.verify_result = flags['verify-result'];
  }
  if (flags['duplicate-of'] !== undefined) {
    fm.duplicate_of = flags['duplicate-of'];
  }

  writeMdAtomic(bugPath, fm, body);
  return {
    bug_path: bugPath,
    status: fm.status,
    phase_history: fm.phase_history,
    recommended_code_agent: fm.recommended_code_agent ?? null,
    fix_commit: fm.fix_commit ?? null,
    verify_result: fm.verify_result ?? null,
    duplicate_of: fm.duplicate_of ?? null,
  };
}

function cmdFixList(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('fix list requires <project-slug>');
  const flags = parseFlags(args.slice(1), {
    status: 'value',
    severity: 'value',
  });
  const dir = projectsPath(projectSlug, 'fixes');
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, count: 0, bugs: [] };
  }
  const bugs = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.match(/^\d{4}-\d{2}-\d{2}-.+\.md$/)) continue;
    const full = path.join(dir, entry);
    let status = 'unknown';
    let severity = 'unknown';
    let title = entry;
    try {
      const { fm } = readMd(full);
      status = fm.status || 'unknown';
      severity = fm.severity || 'unknown';
      title = fm.title || entry;
    } catch (_e) {
      // ignore
    }
    if (flags.status && status !== flags.status) continue;
    if (flags.severity && severity !== flags.severity) continue;
    bugs.push({ file: entry, path: full, status, severity, title });
  }
  return { project: projectSlug, count: bugs.length, bugs };
}

function cmdFixFindDuplicates(args) {
  const projectSlug = args[0];
  if (!projectSlug) {
    usage('fix find-duplicates requires <project-slug> <symptom-keywords...>');
  }
  const keywords = args.slice(1).filter((s) => s && s.length >= 3);
  if (keywords.length === 0) {
    usage('fix find-duplicates requires at least one keyword (>=3 chars)');
  }
  const dir = projectsPath(projectSlug, 'fixes');
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, window_days: 30, matches: [] };
  }
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const matches = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.match(/^\d{4}-\d{2}-\d{2}-.+\.md$/)) continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.mtimeMs < cutoff) continue;
    let content = '';
    try {
      content = fs.readFileSync(full, 'utf8').toLowerCase();
    } catch (_e) {
      continue;
    }
    const hits = keywords.filter((k) => content.includes(k.toLowerCase()));
    if (hits.length > 0) {
      let title = entry;
      let status = 'unknown';
      try {
        const { fm } = readMd(full);
        title = fm.title || entry;
        status = fm.status || 'unknown';
      } catch (_e) {}
      matches.push({
        file: entry,
        path: full,
        title,
        status,
        keyword_hits: hits,
        hit_count: hits.length,
      });
    }
  }
  matches.sort((a, b) => b.hit_count - a.hit_count);
  return { project: projectSlug, window_days: 30, matches };
}

// ---------- fix learning-loop subcommands ----------

function postmortemsDir(projectSlug) {
  if (projectSlug) {
    return path.join(vaultRoot(), 'wiki', 'postmortems', projectSlug);
  }
  return path.join(vaultRoot(), 'wiki', 'postmortems');
}

function agentsLockPath() {
  return path.join(vaultRoot(), 'wiki', '_canonical', 'agents.lock.json');
}

function lastPromotePath() {
  return path.join(vaultRoot(), 'wiki', '_state', 'last_promote.json');
}

function cmdFixIntegrityCheck(args) {
  const flags = parseFlags(args, {
    'agents-dir': 'value',
    'skills-dir': 'value',
  });
  const agentsDir = flags['agents-dir'] || path.join(os.homedir(), '.claude', 'agents');
  const skillsDir = flags['skills-dir'] || path.join(os.homedir(), '.claude', 'skills');
  const lockPath = agentsLockPath();

  if (!fs.existsSync(lockPath)) {
    // Bootstrap: write the lock file from current state
    const crypto = require('crypto');
    const hashes = {};
    for (const dir of [agentsDir, skillsDir]) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.md')) continue;
        const full = path.join(dir, entry);
        try {
          const content = fs.readFileSync(full, 'utf8');
          hashes[entry] = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
        } catch (_e) {}
      }
    }
    const lockDir = path.dirname(lockPath);
    if (!fs.existsSync(lockDir)) fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ generated_at: nowIso(), hashes }, null, 2), 'utf8');
    return { status: 'bootstrapped', lock_path: lockPath, file_count: Object.keys(hashes).length };
  }

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const crypto = require('crypto');
  const mismatches = [];
  const current = {};
  for (const dir of [agentsDir, skillsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.md')) continue;
      const full = path.join(dir, entry);
      try {
        const content = fs.readFileSync(full, 'utf8');
        const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
        current[entry] = hash;
        if (lock.hashes[entry] && lock.hashes[entry] !== hash) {
          mismatches.push({ file: entry, expected: lock.hashes[entry], actual: hash });
        }
      } catch (_e) {}
    }
  }
  return {
    status: mismatches.length === 0 ? 'ok' : 'mismatch',
    mismatches,
    files_checked: Object.keys(current).length,
    lock_generated_at: lock.generated_at,
  };
}

function cmdFixInitPostmortem(args) {
  const flags = parseFlags(args, {
    'date': 'value',
    'severity': 'value',
    'root-cause-class': 'value',
    'terminal-status': 'value',
    'one-line-learning': 'value',
    'fix-wave-count': 'value',
    'diagnosis-rounds': 'value',
    'phase-friction': 'value',
    'quak-regression': 'value',
    'fix-required-test-first': 'value',
  });
  const bugSlug = flags._[0];
  const projectSlug = flags._[1];
  if (!bugSlug || !projectSlug) {
    usage('fix init-postmortem <bug-slug> <project-slug> [flags]');
  }
  const date = flags['date'] || new Date().toISOString().slice(0, 10);
  const dir = postmortemsDir(projectSlug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `${date}-${bugSlug}.md`;
  const filePath = path.join(dir, filename);

  const severity = flags['severity'] || 'major';
  const terminalStatus = flags['terminal-status'] || 'fixed';
  const rootCauseClass = flags['root-cause-class'] || 'unknown';
  const oneLineLearning = flags['one-line-learning'] || '';
  const fixWaveCount = flags['fix-wave-count'] || '1';
  const diagnosisRounds = flags['diagnosis-rounds'] || '1';
  const phaseFriction = flags['phase-friction'] || 'diagnose';
  const quakRegression = flags['quak-regression'] || 'skipped';
  const fixRequiredTestFirst = flags['fix-required-test-first'] || 'false';

  const body = `---
type: postmortem
bug_slug: ${bugSlug}
project: ${projectSlug}
date: ${date}
severity: ${severity}
terminal_status: ${terminalStatus}
root_cause_class: [${rootCauseClass}]
fix_wave_count: ${fixWaveCount}
diagnosis_rounds: ${diagnosisRounds}
phase_that_produced_most_friction: ${phaseFriction}
quak_regression: ${quakRegression}
fix_required_test_first: ${fixRequiredTestFirst}
one_line_learning: "${oneLineLearning}"
created_at: ${nowIso()}
---

# Postmortem: ${bugSlug} (${date})

## Bug Summary

<!-- Short description of what was broken -->

## Timeline

| Time | Event |
|------|-------|
| | Reported |
| | Diagnosed |
| | Fixed (commit ) |
| | Verified |

## Root Cause

<!-- One paragraph: what was the technical cause? -->

## Contributing Factors

<!-- What conditions allowed this bug to exist/survive? -->

## What Went Well

<!-- Diagnosis speed, tooling, team response -->

## What Didn't Go Well

<!-- Where did friction come from? -->

## One-Line Learning

${oneLineLearning}

## Suggested Lesson (for promote-lessons to evaluate)

<!-- One concrete, actionable rule that would prevent recurrence -->
`;

  fs.writeFileSync(filePath, body, 'utf8');
  return {
    path: filePath,
    project: projectSlug,
    bug_slug: bugSlug,
    date,
    filename,
  };
}

function cmdFixCountPostmortemsSince(args) {
  const flags = parseFlags(args, { 'since': 'value' });
  const sinceStr = flags['since'] || flags._[0];
  if (!sinceStr) {
    usage('fix count-postmortems-since --since <ISO-timestamp>');
  }
  const sinceMs = new Date(sinceStr).getTime();
  if (isNaN(sinceMs)) usage(`invalid timestamp: ${sinceStr}`);

  const root = path.join(vaultRoot(), 'wiki', 'postmortems');
  if (!fs.existsSync(root)) return { count: 0, since: sinceStr };

  let count = 0;
  const found = [];
  for (const projectDir of fs.readdirSync(root)) {
    const pDir = path.join(root, projectDir);
    if (!fs.statSync(pDir).isDirectory()) continue;
    for (const entry of fs.readdirSync(pDir)) {
      if (!entry.endsWith('.md')) continue;
      const full = path.join(pDir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs >= sinceMs) {
          count++;
          found.push(path.join(projectDir, entry));
        }
      } catch (_e) {}
    }
  }
  return { count, since: sinceStr, files: found };
}

function cmdFixUpdatePromoteState(args) {
  const flags = parseFlags(args, { 'at': 'value' });
  const at = flags['at'] || nowIso();
  const stateDir = path.join(vaultRoot(), 'wiki', '_state');
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  const p = lastPromotePath();
  const data = { last_promote_at: at, updated_at: nowIso() };
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return { last_promote_at: at, path: p };
}

function cmdFixWriteSuggestion(args) {
  const flags = parseFlags(args, {
    'title': 'value',
    'body-file': 'value',
    'body': 'value',
    'source-postmortem': 'value',
    'skill': 'value',
  });
  const agentName = flags._[0];
  if (!agentName) usage('fix write-suggestion <agent-name> [--title <t>] [--body-file <path>|--body <text>] [--source-postmortem <path>] [--skill <name>]');
  const title = flags['title'] || 'Untitled suggestion';
  let body = '';
  if (flags['body-file']) {
    body = fs.readFileSync(flags['body-file'], 'utf8');
  } else if (flags['body']) {
    body = flags['body'];
  }
  const date = new Date().toISOString().slice(0, 10);
  const slugTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const filename = `${date}-${slugTitle}.md`;
  const dir = path.join(vaultRoot(), 'wiki', 'lessons', agentName, '_suggestions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  const content = `---
type: lesson-suggestion
agent: ${agentName}
title: "${title}"
status: pending
date: ${date}
source_postmortem: "${flags['source-postmortem'] || ''}"
skill: "${flags['skill'] || ''}"
created_at: ${nowIso()}
---

# ${title}

${body}
`;
  fs.writeFileSync(filePath, content, 'utf8');
  return { path: filePath, agent: agentName, title, date, filename };
}

module.exports = {
  cmdFixNextSuffix,
  cmdFixUpdateStatus,
  cmdFixList,
  cmdFixFindDuplicates,
  cmdFixIntegrityCheck,
  cmdFixInitPostmortem,
  cmdFixCountPostmortemsSince,
  cmdFixUpdatePromoteState,
  cmdFixWriteSuggestion,
};
