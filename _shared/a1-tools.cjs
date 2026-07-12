#!/usr/bin/env node
/**
 * a1-tools.cjs — shared deterministic file-ops helper for a1-* skills.
 *
 * Subcommand hierarchy:
 *
 *   a1-tools spec next-number <project-slug>
 *       → JSON { project, next, padded, dir }
 *
 *   a1-tools spec update-status <spec-path> <new-status> [flags]
 *       Flags:
 *         --wave-plan-path <path>         set frontmatter wave_plan_path
 *         --verify-failures-file <path>   replace verify_failures with JSON array from file
 *         --clear-verify-failures         set verify_failures to []
 *       → JSON { spec_path, status, phase_history, wave_plan_path, verify_failures }
 *
 *   a1-tools spec list <project-slug> [--status=<s>]
 *       → JSON { project, count, specs: [...] }
 *
 *   a1-tools fix next-suffix <project-slug> <YYYY-MM-DD>
 *       → JSON { project, date, suffix, padded, dir }
 *         suffix is "" for first bug of day, "-2" / "-3" for follow-ups.
 *
 *   a1-tools fix update-status <bug-path> <new-status> [flags]
 *       Flags:
 *         --recommended-code-agent <name>  set frontmatter recommended_code_agent
 *         --fix-commit <hash>              set frontmatter fix_commit
 *         --verify-result <text>           set frontmatter verify_result (string)
 *         --duplicate-of <path>            set frontmatter duplicate_of
 *       → JSON { bug_path, status, phase_history, ...changed }
 *
 *   a1-tools fix list <project-slug> [--status=<s>] [--severity=<s>]
 *       → JSON { project, count, bugs: [...] }
 *
 *   a1-tools fix find-duplicates <project-slug> <symptom-keywords...>
 *       → JSON { project, window_days: 30, matches: [...] }
 *         grep over projects/<slug>/fixes/*.md within 30 days, case-insensitive.
 *
 *   a1-tools fix integrity-check [--agents-dir <abs>] [--skills-dir <abs>]
 *       → JSON { status: "ok"|"mismatch"|"bootstrapped", mismatches: [], files_checked }
 *         On first run: bootstraps wiki/_canonical/agents.lock.json from current state.
 *         On subsequent runs: compares SHA256 hashes. status="mismatch" means skill STOPS.
 *
 *   a1-tools fix init-postmortem <bug-slug> <project-slug> [flags]
 *       Flags: --date --severity --root-cause-class --terminal-status --one-line-learning
 *              --fix-wave-count --diagnosis-rounds --phase-friction --quak-regression
 *              --fix-required-test-first
 *       → JSON { path, project, bug_slug, date, filename }
 *         Creates wiki/postmortems/<project>/<date>-<bug-slug>.md with YAML frontmatter.
 *
 *   a1-tools fix count-postmortems-since --since <ISO-timestamp>
 *       → JSON { count, since, files: [...] }
 *         Counts postmortem files in wiki/postmortems/ modified after the given timestamp.
 *
 *   a1-tools fix update-promote-state [--at <ISO-timestamp>]
 *       → JSON { last_promote_at, path }
 *         Writes wiki/_state/last_promote.json with promote timestamp.
 *
 *   a1-tools fix write-suggestion <agent-name> [--title <t>] [--body-file <path>|--body <text>]
 *                                              [--source-postmortem <path>] [--skill <name>]
 *       → JSON { path, agent, title, date, filename }
 *         Creates wiki/lessons/<agent>/_suggestions/<date>-<slug>.md. NEVER writes _active.md.
 *
 *   a1-tools analyze next-slot <project-slug> <focus> [--date YYYY-MM-DD]
 *       → JSON { project, focus, date, suffix, filename, path, dir }
 *
 *   a1-tools analyze init <project-slug> <focus> [flags]
 *       Flags: --project-path <abs> --date <YYYY-MM-DD> --title <text>
 *       → JSON { path, project, focus, status }
 *         Creates analyses/<date>-<focus>[-N].md with status=scoped.
 *
 *   a1-tools analyze update-status <analysis-path> <new-status> [--phase-data <json>]
 *       phase-data is merged into frontmatter based on target status:
 *         discovered → fills `discover` from object
 *         analyzed   → fills `agents_dispatched` from .agents_dispatched[]
 *         synthesized → fills `findings_count` from .findings_count
 *         reported   → fills `suggested_next` from .suggested_next[]
 *       → JSON { analysis_path, status, phase_history, ... }
 *
 *   a1-tools analyze discover <project-path>
 *       → JSON { tech_stack[], loc, file_count, last_commit, branch, commit_count_30d }
 *
 *   a1-tools analyze add-finding <analysis-path> <severity> <category> <location> <description> [--recommendation <text>]
 *       severity: BLOCKER | MAJOR | MINOR
 *       → JSON { analysis_path, finding_id, total_findings }
 *
 *   a1-tools analyze add-findings <analysis-path> --json <file|->
 *       batch mode: JSON array of {severity, category, location, description, recommendation?}
 *       '-' reads from stdin. Single atomic write, no shell-quoting pitfalls.
 *       → JSON { analysis_path, finding_ids[], added, total_findings }
 *
 *   a1-tools analyze list <project-slug> [--status=<s>] [--focus=<s>]
 *       → JSON { project, count, analyses: [...] }
 *
 *   a1-tools constitution init <project-slug> [--title <text>]
 *       → JSON { path, project, status, version }
 *
 *   a1-tools constitution discover <project-slug> [--project-path <abs>]
 *       → JSON { project, project_path, claudemd_present, claudemd_excerpt,
 *                repo_constitution_present, global_rules: [...],
 *                has_link_to_constitution }
 *
 *   a1-tools constitution update-status <constitution-path> <new-status>
 *       → JSON { constitution_path, status, version, phase_history, last_written_at }
 *
 *   a1-tools constitution set-body <constitution-path> --body-file <path>
 *       → JSON { constitution_path, body_bytes }
 *
 *   a1-tools constitution next-version <project-slug>
 *       → JSON { project, next, history_dir }
 *
 *   a1-tools constitution archive-current <project-slug> [--date YYYY-MM-DD]
 *       → JSON { project, snapshot, new_version }
 *         Copies current constitution.md to history/YYYY-MM-DD-vN.md,
 *         increments version in live file.
 *
 *   a1-tools constitution write-mirror <project-slug> --repo-root <abs>
 *       → JSON { project, mirror_path, bytes, version }
 *         Writes stripped-down mirror to <repo-root>/constitution.md atomically.
 *
 *   a1-tools constitution link-claudemd <project-slug> --repo-root <abs>
 *       → JSON { project, claudemd_path, action: 'appended' | 'updated' }
 *         Idempotent: managed block delimited by HTML comment markers.
 *
 *   a1-tools constitution list [--status=<s>]
 *       → JSON { count, constitutions: [...] }
 *
 *   a1-tools schema-check run --migrations <dir> [--tables t1,t2]
 *                             [--trigger-pattern 'audit|log'] [--json]
 *       Deterministic schema pre-gate (audit trigger, RLS, FK type match).
 *       Owns exit code: 0 pass, 1 findings, 2 error.
 *
 *   a1-tools schema-check parse --migrations <dir> [--json]
 *       → JSON schema model { files, tables, triggers, rls, skippedStatements }
 *         Debug mode for the bounded SQL parser (see supported subset in HELP).
 *
 *   a1-tools cost run --project <claude-projects-dir> [--since ISO] [--until ISO] [--json]
 *       Token spend aggregation per session (+ sub-agent logs), dedup by
 *       message.id. Contract: _shared/cost-format-notes.md.
 *       Owns exit code: 0 ok, 2 error.
 *
 *   a1-tools realpath-check run --diff-base <git-ref> [--project <dir>]
 *                               [--evidence <file>] [--real-markers <pattern>] [--json]
 *       Gate 0.7 — kills the mock-test blind spot. Greps the wave diff for
 *       real-backend surfaces (SQL / RLS / external HTTP) and, if any are
 *       present, requires a test-evidence file proving each category ran
 *       against the real backend (non-mock output + real-execution marker).
 *       Owns exit code: 0 pass (no surfaces or all proven), 1 lacking proof,
 *       2 bad args / no git.
 *
 *   a1-tools check reservations --claim <type>:<value> --by <spec-id> [--file <path>]
 *   a1-tools check reservations --list [--file <path>]
 *       P7 cross-run coordination registry (.a1/reservations.json). Claim a
 *       migration number / route / etc. for a spec. Claiming a value already
 *       held by ANOTHER spec → exit 1 (holder info). Same spec re-claim → exit 0
 *       (idempotent). Atomic tmp+rename write.
 *
 * Learning store root: repo-local ".a1/learnings/" by default; env
 * A1_VAULT_ROOT overrides this to point at an external vault (e.g. Obsidian).
 * All writes are atomic: read → modify → write to <path>.tmp.<pid> → rename.
 *
 * Exit codes: 0 success, 1 user/usage error, 2 internal error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- valid status sets (lib/status-constants.cjs) ----------
const {
  SPEC_STATUSES, BUG_STATUSES, BUG_SEVERITIES,
  ANALYSIS_STATUSES, ANALYSIS_FOCUSES, ANALYSIS_SEVERITIES,
  CONSTITUTION_STATUSES,
  RECONCILE_STATUSES, RECONCILE_SCOPE_MODES, RECONCILE_DRIFT_CLASSES,
  MODERNIZE_STATUSES, MODERNIZE_MODES, MODERNIZE_PROPOSAL_DECISIONS, MODERNIZE_WAVE_STATUSES,
} = require(path.join(__dirname, 'lib', 'status-constants.cjs'));

// ---------- core I/O, frontmatter parsing, flag parsing (lib/io.cjs) ----------
const {
  vaultRoot,
  resolveVaultPath,
  parseFrontmatter,
  serializeScalar,
  detectKeyOrder,
  serializeFrontmatter,
  readMd,
  writeMdAtomic,
  nowIso,
  writeTextAtomic,
  parseScalarToken,
  parseNestedFrontmatter,
  serializeNestedFrontmatter,
  writeNestedMdAtomic,
  parseFlags,
  fail,
} = require(path.join(__dirname, 'lib', 'io.cjs'));

// ---------- reservations lock machinery + transactional writes (lib/locks.cjs) ----------
const {
  writeJsonAtomic,
  acquireReservationsLock,
  releaseReservationsLock,
  exitWithLock,
  failWithLock,
  reservationsFile,
  loadReservations,
  isLockStale,
  isPidDead,
  sleepSyncMs,
  writeAllOrNothing,
} = require(path.join(__dirname, 'lib', 'locks.cjs'));

// ---------- safe git exec (argv-array, no shell) + metachar guard (lib/git-safe.cjs) ----------
const { gitSafe, assertNoShellMetachar } = require(path.join(__dirname, 'lib', 'git-safe.cjs'));


// ---------- product command group (lib/product.cjs) ----------
// readProductRoadmap/readProductFeature/regenerateDerived/appendChangelogEntry/
// assertSlug/productDirFromFlags/buildRoadmapWritesWithChangelog + every cmdProduct*
// (status/stage/markers/changelog/init/add-milestone/add-feature/feature-init/import/
// validate) + the legacy-roadmap-import parser helpers + PRODUCT_ROADMAP_KEY_ORDER/
// PRODUCT_FEATURE_KEY_ORDER all live in lib/product.cjs now. The dispatcher's product
// branch lazily requires it (no init() call needed anymore — usage() moved to
// lib/help.cjs in M10 Wave 1 and the stage-name constant moved to
// lib/code-scope.cjs in M10 Wave 8; product.cjs imports both directly, no
// injection needed at all).


// ---------- spec group (lib/spec.cjs) ----------
const {
  appendPhaseHistory,
  cmdSpecNextNumber,
  cmdSpecUpdateStatus,
  cmdSpecList,
} = require(path.join(__dirname, 'lib', 'spec.cjs'));

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
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'fixes');
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
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'fixes');
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
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'fixes');
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

// ---------- analyze group (lib/analyze.cjs) ----------
const {
  cmdAnalyzeNextSlot,
  cmdAnalyzeInit,
  cmdAnalyzeUpdateStatus,
  cmdAnalyzeDiscover,
  cmdAnalyzeAddFinding,
  cmdAnalyzeAddFindings,
  cmdAnalyzeList,
} = require(path.join(__dirname, 'lib', 'analyze.cjs'));

// ---------- constitution subcommands ----------
//
// Singleton-per-project + history. Vault is the source of truth; the repo
// constitution.md is a stripped-down mirror derived from the vault file.
//
// Vault layout:
//   projects/<slug>/constitution/constitution.md         (canonical)
//   projects/<slug>/constitution/history/YYYY-MM-DD-vN.md (snapshots)
//
// Repo mirror: <repo-root>/constitution.md

const CONSTITUTION_STATUS_TO_PHASE = {
  discovering: 'discover',
  drafted: 'draft',
  reviewed: 'review',
  written: 'write',
  cancelled: 'cancelled',
};

function constitutionVaultPath(projectSlug) {
  return path.join(
    vaultRoot(),
    'projects',
    projectSlug,
    'constitution',
    'constitution.md'
  );
}

function constitutionHistoryDir(projectSlug) {
  return path.join(
    vaultRoot(),
    'projects',
    projectSlug,
    'constitution',
    'history'
  );
}

function cmdConstitutionInit(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('constitution init requires <project-slug>');
  const flags = parseFlags(args.slice(1), {
    title: 'value',
  });
  const filePath = constitutionVaultPath(projectSlug);
  const dir = path.dirname(filePath);
  if (fs.existsSync(filePath)) {
    fail(
      `constitution already exists: ${filePath}. ` +
        `Use 'archive-current' before re-initializing, or update status directly.`
    );
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const title = flags.title || `Constitution for ${projectSlug}`;
  const fm = {
    type: 'constitution',
    project: projectSlug,
    title,
    status: 'discovering',
    version: 1,
    created_at: nowIso(),
    last_written_at: null,
    phase_history: [],
    tags: ['constitution', `project/${projectSlug}`],
  };

  const body = `# ${title}

<!-- Body filled by Phase 2 (Draft) via 'constitution set-body'. -->
<!-- Until then this skeleton remains and the file is in 'discovering' status. -->

## Override Precedence (4 Layers)

<filled by Finn in Phase 2>

## Project Behavioral Rules

<filled by Finn in Phase 2>

## Notes

<optional, filled in Phase 3 Review>
`;

  writeMdAtomic(filePath, fm, body);
  return {
    path: filePath,
    project: projectSlug,
    status: 'discovering',
    version: 1,
  };
}

function cmdConstitutionDiscover(args) {
  const flags = parseFlags(args, {
    'project-path': 'value',
  });
  const projectSlug = flags._[0];
  if (!projectSlug) {
    usage(
      'constitution discover requires <project-slug> [--project-path <abs>]'
    );
  }
  const projectPath = flags['project-path'] || null;
  const result = {
    project: projectSlug,
    project_path: projectPath,
    claudemd_present: false,
    claudemd_path: null,
    claudemd_excerpt: null,
    repo_constitution_present: false,
    repo_constitution_path: null,
    global_rules: [],
    has_link_to_constitution: false,
  };

  // CLAUDE.md inspection.
  if (projectPath) {
    const claudemdPath = path.join(projectPath, 'CLAUDE.md');
    if (fs.existsSync(claudemdPath)) {
      result.claudemd_present = true;
      result.claudemd_path = claudemdPath;
      try {
        const content = fs.readFileSync(claudemdPath, 'utf8');
        // First 4000 chars is enough for the LLM to grasp scope.
        result.claudemd_excerpt = content.slice(0, 4000);
        // Detect existing cross-link to constitution.md.
        result.has_link_to_constitution = /constitution\.md/i.test(content);
      } catch (_e) {
        // unreadable — leave excerpt null
      }
    }
    const repoConstPath = path.join(projectPath, 'constitution.md');
    if (fs.existsSync(repoConstPath)) {
      result.repo_constitution_present = true;
      result.repo_constitution_path = repoConstPath;
    }
  }

  // Global rules under ~/.claude/rules/
  const rulesDir = path.join(os.homedir(), '.claude', 'rules');
  if (fs.existsSync(rulesDir)) {
    function walkRules(dir, prefix = '') {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_e) {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) {
          walkRules(full, rel);
        } else if (e.isFile() && e.name.endsWith('.md')) {
          result.global_rules.push(rel);
        }
      }
    }
    walkRules(rulesDir);
    result.global_rules.sort();
  }

  return result;
}

function cmdConstitutionUpdateStatus(args) {
  const constPathInput = args[0];
  const newStatus = args[1];
  if (!constPathInput || !newStatus) {
    usage('constitution update-status requires <constitution-path> <new-status>');
  }
  if (!CONSTITUTION_STATUSES.has(newStatus)) {
    usage(
      `invalid constitution status "${newStatus}". valid: ${[...CONSTITUTION_STATUSES].join(', ')}`
    );
  }
  const constPath = resolveVaultPath(constPathInput);
  if (!fs.existsSync(constPath)) fail(`constitution file not found: ${constPath}`);
  const { fm, body } = readMd(constPath);
  fm.status = newStatus;
  const phase = CONSTITUTION_STATUS_TO_PHASE[newStatus];
  if (phase) appendPhaseHistory(fm, phase);
  if (newStatus === 'written') {
    fm.last_written_at = nowIso();
  }
  writeMdAtomic(constPath, fm, body);
  return {
    constitution_path: constPath,
    status: fm.status,
    version: typeof fm.version === 'number' ? fm.version : parseInt(fm.version, 10) || 1,
    phase_history: fm.phase_history,
    last_written_at: fm.last_written_at ?? null,
  };
}

function cmdConstitutionSetBody(args) {
  const flags = parseFlags(args, {
    'body-file': 'value',
  });
  const constPathInput = flags._[0];
  if (!constPathInput) {
    usage('constitution set-body requires <constitution-path> --body-file <path>');
  }
  if (!flags['body-file']) {
    usage('constitution set-body requires --body-file <path>');
  }
  const constPath = resolveVaultPath(constPathInput);
  if (!fs.existsSync(constPath)) fail(`constitution file not found: ${constPath}`);
  if (!fs.existsSync(flags['body-file'])) {
    fail(`body file not found: ${flags['body-file']}`);
  }
  const newBody = fs.readFileSync(flags['body-file'], 'utf8');
  const { fm } = readMd(constPath);
  writeMdAtomic(constPath, fm, newBody);
  return {
    constitution_path: constPath,
    body_bytes: Buffer.byteLength(newBody, 'utf8'),
  };
}

function cmdConstitutionNextVersion(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('constitution next-version requires <project-slug>');
  const histDir = constitutionHistoryDir(projectSlug);
  let max = 0;
  if (fs.existsSync(histDir)) {
    for (const entry of fs.readdirSync(histDir)) {
      const m = entry.match(/-v(\d+)\.md$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  return {
    project: projectSlug,
    next: max + 1,
    history_dir: histDir,
  };
}

function cmdConstitutionArchiveCurrent(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('constitution archive-current requires <project-slug>');
  const flags = parseFlags(args.slice(1), { date: 'value' });
  const constPath = constitutionVaultPath(projectSlug);
  if (!fs.existsSync(constPath)) {
    fail(`no current constitution to archive: ${constPath}`);
  }
  const histDir = constitutionHistoryDir(projectSlug);
  if (!fs.existsSync(histDir)) fs.mkdirSync(histDir, { recursive: true });
  const date = flags.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage(`invalid date "${date}", expected YYYY-MM-DD`);
  }
  // Determine next version number.
  const nv = cmdConstitutionNextVersion([projectSlug]);
  const snapshotName = `${date}-v${nv.next}.md`;
  const snapshotPath = path.join(histDir, snapshotName);
  // Copy via read-then-write-atomic (preserves content faithfully).
  const content = fs.readFileSync(constPath, 'utf8');
  const tmp = `${snapshotPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, snapshotPath);
  // Bump version in the live file.
  const { fm, body } = readMd(constPath);
  fm.version = (typeof fm.version === 'number' ? fm.version : parseInt(fm.version, 10) || 1) + 1;
  writeMdAtomic(constPath, fm, body);
  return {
    project: projectSlug,
    snapshot: snapshotPath,
    new_version: fm.version,
  };
}

function cmdConstitutionWriteMirror(args) {
  const flags = parseFlags(args, { 'repo-root': 'value' });
  const projectSlug = flags._[0];
  if (!projectSlug) {
    usage('constitution write-mirror requires <project-slug> --repo-root <abs>');
  }
  if (!flags['repo-root']) {
    usage('constitution write-mirror requires --repo-root <abs>');
  }
  const repoRoot = flags['repo-root'];
  if (!path.isAbsolute(repoRoot)) {
    fail(`--repo-root must be absolute path, got: ${repoRoot}`);
  }
  if (!fs.existsSync(repoRoot)) {
    fail(`repo root does not exist: ${repoRoot}`);
  }
  const constPath = constitutionVaultPath(projectSlug);
  if (!fs.existsSync(constPath)) {
    fail(`no vault constitution found for ${projectSlug}: ${constPath}`);
  }
  const { fm, body } = readMd(constPath);
  // Stripped-down mirror: tiny generation header + body. No vault frontmatter.
  const header =
    `<!-- Generated mirror — source of truth: Obsidian Vault\n` +
    `     ${path.relative(vaultRoot(), constPath)}\n` +
    `     project: ${projectSlug} | version: ${fm.version} | last_written_at: ${fm.last_written_at ?? nowIso()}\n` +
    `     Do not edit this file directly. Edit the vault version and re-run a1-constitution. -->\n\n`;
  const mirrorPath = path.join(repoRoot, 'constitution.md');
  const out = header + body;
  const tmp = `${mirrorPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, out, 'utf8');
  fs.renameSync(tmp, mirrorPath);
  return {
    project: projectSlug,
    mirror_path: mirrorPath,
    bytes: Buffer.byteLength(out, 'utf8'),
    version: typeof fm.version === 'number' ? fm.version : parseInt(fm.version, 10) || 1,
  };
}

const CLAUDEMD_LINK_MARKER_START = '<!-- a1-constitution:link -->';
const CLAUDEMD_LINK_MARKER_END = '<!-- /a1-constitution:link -->';

function cmdConstitutionLinkClaudemd(args) {
  const flags = parseFlags(args, { 'repo-root': 'value' });
  const projectSlug = flags._[0];
  if (!projectSlug) {
    usage('constitution link-claudemd requires <project-slug> --repo-root <abs>');
  }
  if (!flags['repo-root']) {
    usage('constitution link-claudemd requires --repo-root <abs>');
  }
  const repoRoot = flags['repo-root'];
  if (!path.isAbsolute(repoRoot)) {
    fail(`--repo-root must be absolute path, got: ${repoRoot}`);
  }
  const claudemdPath = path.join(repoRoot, 'CLAUDE.md');
  if (!fs.existsSync(claudemdPath)) {
    fail(
      `CLAUDE.md not found at ${claudemdPath}. ` +
        `Create it first (template: ~/.claude/templates/CLAUDE.md.template).`
    );
  }
  const content = fs.readFileSync(claudemdPath, 'utf8');
  const block =
    `${CLAUDEMD_LINK_MARKER_START}\n` +
    `## Behavioral Rules\n\n` +
    `This project's behavioral rules and override-precedence are defined in\n` +
    `[\`constitution.md\`](./constitution.md). CLAUDE.md = data + context;\n` +
    `constitution.md = rules + override order. If they conflict, constitution.md wins\n` +
    `for behavior; CLAUDE.md wins for project facts.\n` +
    `${CLAUDEMD_LINK_MARKER_END}\n`;

  let updated;
  let action;
  if (content.includes(CLAUDEMD_LINK_MARKER_START)) {
    // Replace existing managed block (idempotent update).
    const startIdx = content.indexOf(CLAUDEMD_LINK_MARKER_START);
    const endIdx = content.indexOf(CLAUDEMD_LINK_MARKER_END);
    if (endIdx === -1) {
      fail(
        `CLAUDE.md has a start-marker but no end-marker. ` +
          `Please clean up the file manually around ${CLAUDEMD_LINK_MARKER_START}.`
      );
    }
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + CLAUDEMD_LINK_MARKER_END.length);
    updated = before + block + after;
    action = 'updated';
  } else {
    // Append at end.
    const sep = content.endsWith('\n') ? '\n' : '\n\n';
    updated = content + sep + block;
    action = 'appended';
  }
  const tmp = `${claudemdPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, updated, 'utf8');
  fs.renameSync(tmp, claudemdPath);
  return {
    project: projectSlug,
    claudemd_path: claudemdPath,
    action,
  };
}

function cmdConstitutionList(args) {
  const flags = parseFlags(args, { status: 'value' });
  const projectsRoot = path.join(vaultRoot(), 'projects');
  const constitutions = [];
  if (!fs.existsSync(projectsRoot)) {
    return { count: 0, constitutions };
  }
  for (const slug of fs.readdirSync(projectsRoot).sort()) {
    const constPath = path.join(
      projectsRoot,
      slug,
      'constitution',
      'constitution.md'
    );
    if (!fs.existsSync(constPath)) continue;
    let status = 'unknown';
    let version = null;
    let title = slug;
    let lastWrittenAt = null;
    try {
      const { fm } = readMd(constPath);
      status = fm.status || 'unknown';
      version = fm.version ?? null;
      title = fm.title || slug;
      lastWrittenAt = fm.last_written_at ?? null;
    } catch (_e) {
      // skip unreadable
    }
    if (flags.status && status !== flags.status) continue;
    constitutions.push({
      project: slug,
      path: constPath,
      status,
      version: typeof version === 'number' ? version : parseInt(version, 10) || null,
      title,
      last_written_at: lastWrittenAt,
    });
  }
  return { count: constitutions.length, constitutions };
}

// ---------- checklist subcommands ----------
const { cmdChecklistRun, cmdChecklistList } = require(path.join(__dirname, 'lib', 'checklist.cjs'));

// ---------- worktree subcommands ----------
const {
  cmdWorktreePrepare,
  cmdWorktreeEnter,
  cmdWorktreeStatus,
  cmdWorktreeExit,
  cmdWorktreeList,
  cmdWorktreeGc,
  cmdWorktreeAdopt,
  cmdWorktreeReconcile,
} = require(path.join(__dirname, 'lib', 'worktree.cjs'));

// ---------------------------------------------------------------------------
// pr — a1-pr-review CLI helpers (registry filter, findings summary, status)
// ---------------------------------------------------------------------------
const {
  cmdPrListHandoff,
  cmdPrMarkStatus,
  cmdPrMarkPrOpen,
  cmdPrFindingsSummary,
} = require(path.join(__dirname, 'lib', 'pr.cjs'));

// ---------- modernize group (lib/modernize.cjs) ----------
const {
  cmdModernizeNextSlot,
  cmdModernizeInit,
  cmdModernizeUpdateStatus,
  cmdModernizeDiscoverStack,
  cmdModernizeAddProposal,
  cmdModernizeApproveProposal,
  cmdModernizeAddWave,
  cmdModernizeSnapshotBehavior,
  cmdModernizeStartWave,
  cmdModernizeCompleteWave,
  cmdModernizeVerifyParity,
  cmdModernizePublishNotion,
  cmdModernizeList,
} = require(path.join(__dirname, 'lib', 'modernize.cjs'));

// ---------- reconcile subcommands ----------
//
// Spec-vs-code drift detection. Owns drift reports in the vault under
// projects/<slug>/drift-<YYYY-MM-DD>[-N].md (or projects/_vault-sync/... for
// vault-sync mode). The CLI handles deterministic operations: slot
// calculation, spec parsing (Acceptance-Criteria anchor extraction),
// frontmatter updates, drift append, listing. Sub-agent probing happens in
// the skill (Phase 3).

function reconcileDir(projectSlug) {
  // For vault-sync we use a synthetic slug "_vault-sync".
  return path.join(vaultRoot(), 'projects', projectSlug);
}

function cmdReconcileNextSlot(args) {
  const flags = parseFlags(args, { date: 'value' });
  const projectSlug = flags._[0];
  if (!projectSlug) {
    usage('reconcile next-slot requires <project-slug> [--date YYYY-MM-DD]');
  }
  const date = flags.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage(`invalid date "${date}", expected YYYY-MM-DD`);
  }
  const dir = reconcileDir(projectSlug);
  let used = new Set();
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^drift-${date}(-(\\d+))?\\.md$`);
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(re);
      if (m) used.add(m[2] ? parseInt(m[2], 10) : 1);
    }
  }
  let n = 1;
  while (used.has(n)) n++;
  const suffix = n === 1 ? '' : `-${n}`;
  const filename = `drift-${date}${suffix}.md`;
  return {
    project: projectSlug,
    date,
    suffix,
    filename,
    path: path.join(dir, filename),
    dir,
  };
}

function listProjectSpecs(projectSlug) {
  // Returns array of { feature_id, abs, rel, fm } for every spec under
  // projects/<slug>/spec/. feature_id is the filename without .md.
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'spec');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith('.md')) continue;
    const featureId = entry.slice(0, -3);
    const abs = path.join(dir, entry);
    const rel = `projects/${projectSlug}/spec/${entry}`;
    let fm = {};
    try {
      const parsed = readMd(abs);
      fm = parsed.fm || {};
    } catch (_e) {
      // include even if frontmatter parse fails; consumer can filter
    }
    out.push({ feature_id: featureId, abs, rel, fm });
  }
  return out;
}

function cmdReconcileInit(args) {
  const flags = parseFlags(args, {
    'scope': 'value',
    'spec': 'value',
    'project-path': 'value',
    'date': 'value',
    'title': 'value',
  });
  const projectSlug = flags._[0];
  if (!projectSlug) {
    usage(
      'reconcile init requires <project-slug> --scope <single|project|vault-sync> [--spec <###-slug>] [--project-path /abs] [--date YYYY-MM-DD] [--title <text>]'
    );
  }
  const scope = flags.scope;
  if (!scope || !RECONCILE_SCOPE_MODES.has(scope)) {
    usage(
      `reconcile init requires --scope, one of: ${[...RECONCILE_SCOPE_MODES].join(', ')}`
    );
  }
  if (scope === 'single' && !flags.spec) {
    usage('reconcile init --scope single requires --spec <###-feature-slug>');
  }

  // Compute slot (re-use logic, no recursion: build args).
  const slotArgs = [projectSlug];
  if (flags.date) slotArgs.push('--date', flags.date);
  const slot = cmdReconcileNextSlot(slotArgs);
  const filePath = slot.path;
  if (!fs.existsSync(slot.dir)) fs.mkdirSync(slot.dir, { recursive: true });

  // Resolve scope_targets.
  const scopeTargets = [];
  if (scope === 'single') {
    const specRel = `projects/${projectSlug}/spec/${flags.spec}.md`;
    const specAbs = path.join(vaultRoot(), specRel);
    scopeTargets.push(
      `project=${projectSlug}; spec=${flags.spec}; spec_path=${specRel}; repo_path=${flags['project-path'] || ''}`
    );
    if (!fs.existsSync(specAbs)) {
      // We still create the report, but record a parse_warning later.
      // For init we just note it via stderr (non-fatal).
      process.stderr.write(`warning: spec not found at init: ${specRel}\n`);
    }
  } else if (scope === 'project') {
    const specs = listProjectSpecs(projectSlug);
    for (const s of specs) {
      scopeTargets.push(
        `project=${projectSlug}; spec=${s.feature_id}; spec_path=${s.rel}; repo_path=${flags['project-path'] || ''}`
      );
    }
  } else {
    // vault-sync: list every projects/<slug>/spec/ in the vault.
    const projectsRoot = path.join(vaultRoot(), 'projects');
    if (fs.existsSync(projectsRoot)) {
      for (const entry of fs.readdirSync(projectsRoot).sort()) {
        if (entry.startsWith('_')) continue;
        const specs = listProjectSpecs(entry);
        for (const s of specs) {
          scopeTargets.push(
            `project=${entry}; spec=${s.feature_id}; spec_path=${s.rel}; repo_path=`
          );
        }
      }
    }
  }

  const title =
    flags.title ||
    (scope === 'single'
      ? `Drift Check — ${projectSlug}/${flags.spec}`
      : scope === 'project'
        ? `Drift Check — ${projectSlug} (project sweep)`
        : `Drift Check — vault-sync ${slot.date}`);

  const fm = {
    type: 'drift-report',
    project: projectSlug,
    title,
    status: 'scoped',
    scope_mode: scope,
    created_at: nowIso(),
    date: slot.date,
    phase_history: [`phase=scope completed=${nowIso()}`],
    scope_targets: scopeTargets,
    parsed_targets: [],
    stale_candidates: [],
    parse_warnings: [],
    agents_dispatched: [],
    probe_notes: [],
    drifts: [],
    drifts_count: ['missing=0', 'extra=0', 'diverged=0', 'stale=0'],
    in_sync_count: '0',
    skipped_projects: [],
    suggested_next: [],
    tags: ['drift-report', `project/${projectSlug}`, `scope/${scope}`],
  };

  const body = `# ${title}

## Summary

<filled by Phase 4 (Report)>

## Drifts

<filled by Phase 4 (Report) from frontmatter drifts[]>

## Phase History

<filled by Phase 4 (Report) from frontmatter phase_history[]>

## Suggested Next

<filled by Phase 4 (Report)>
`;

  writeMdAtomic(filePath, fm, body);
  return {
    path: filePath,
    project: projectSlug,
    scope_mode: scope,
    target_count: scopeTargets.length,
    status: 'scoped',
  };
}

// Parses "key=val; key=val" entries (used in scope_targets[]).
function parseKvEntry(s) {
  const out = {};
  if (typeof s !== 'string') return out;
  for (const part of s.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

// Inline-code span extractor: matches text inside backticks.
const INLINE_CODE_RE = /`([^`\n]+)`/g;

// File-path heuristic: contains a slash AND ends with a known extension.
const FILE_EXT_RE = /\.(js|jsx|ts|tsx|mjs|cjs|py|rs|go|dart|java|kt|rb|php|html|css|scss|vue|svelte|astro|sql|sh|yml|yaml|toml|json|md)$/i;

// HTTP endpoint heuristic.
const ENDPOINT_RE = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)$/i;

// Function call heuristic: identifier followed by ().
const FUNC_CALL_RE = /^[A-Za-z_][A-Za-z0-9_]*\(\)$/;

function classifyAnchor(text) {
  const t = text.trim();
  if (ENDPOINT_RE.test(t)) return { kind: 'endpoint', ref: t };
  if (FUNC_CALL_RE.test(t)) return { kind: 'function', ref: t.replace(/\(\)$/, '') };
  if (t.includes('/') && FILE_EXT_RE.test(t)) return { kind: 'file', ref: t };
  return null;
}

function extractAnchorsFromSpec(specBody) {
  // Walk bullet/numbered lines that contain an FR-### id and harvest every
  // inline-code span on that line as a potential anchor. Returns an array of
  // { fr, kind, ref, context }.
  const out = [];
  const lines = specBody.split('\n');
  const frRe = /\b(FR-\d{3,})\b/;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const frMatch = line.match(frRe);
    if (!frMatch) continue;
    const fr = frMatch[1];
    const ctx = line.replace(/^[-*\d.\s]+/, '').trim().slice(0, 200);
    let found = false;
    let m;
    INLINE_CODE_RE.lastIndex = 0;
    while ((m = INLINE_CODE_RE.exec(line)) !== null) {
      const classified = classifyAnchor(m[1]);
      if (classified) {
        out.push({
          fr,
          kind: classified.kind,
          ref: classified.ref,
          context: ctx,
        });
        found = true;
      }
    }
    if (!found) {
      // Record an FR-only anchor (no concrete artifact reference).
      out.push({ fr, kind: 'other', ref: '', context: ctx });
    }
  }
  return out;
}

function gitLastTouchIso(repoPath, relRefs) {
  if (!repoPath || !fs.existsSync(path.join(repoPath, '.git'))) return null;
  try {
    const filtered = relRefs.filter(Boolean);
    if (filtered.length === 0) return null;
    // git log -1 --format=%cI -- <paths...> ; missing paths are tolerated.
    // execFileSync passes each path as a literal argv entry — no shell
    // involved, so metacharacters in a hostile path are inert.
    const args = ['log', '-1', '--format=%cI', '--'].concat(filtered);
    const out = gitSafe(repoPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    return out || null;
  } catch (_e) {
    return null;
  }
}

function cmdReconcileParseSpec(args) {
  const driftPathInput = args[0];
  if (!driftPathInput) usage('reconcile parse-spec requires <drift-path>');
  const driftPath = resolveVaultPath(driftPathInput);
  if (!fs.existsSync(driftPath)) fail(`drift report not found: ${driftPath}`);
  const { fm, body } = readMd(driftPath);

  if (!Array.isArray(fm.scope_targets) || fm.scope_targets.length === 0) {
    fail('drift report has no scope_targets[] — nothing to parse');
  }

  const parsedTargets = [];
  const staleCandidates = [];
  const warnings = [];

  for (const entry of fm.scope_targets) {
    const t = parseKvEntry(entry);
    const specPathRel = t.spec_path;
    const specAbs = specPathRel ? resolveVaultPath(specPathRel) : null;
    if (!specAbs || !fs.existsSync(specAbs)) {
      warnings.push(`spec missing for target ${t.project}/${t.spec}: ${specPathRel || '(no path)'}`);
      continue;
    }
    let spec;
    try {
      spec = readMd(specAbs);
    } catch (e) {
      warnings.push(`spec parse error for ${specPathRel}: ${e.message}`);
      continue;
    }
    const anchors = extractAnchorsFromSpec(spec.body);
    // Dedup per (spec, kind, ref).
    const seen = new Set();
    for (const a of anchors) {
      const key = `${t.spec}|${a.kind}|${a.ref}|${a.fr}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parsedTargets.push(
        `spec=${t.spec}; fr=${a.fr}; kind=${a.kind}; ref=${a.ref}; context=${a.context.replace(/;/g, ',')}`
      );
    }

    // STALE pre-filter: spec.updated vs git log on referenced file anchors.
    const specUpdated = spec.fm && (spec.fm.updated || spec.fm.created);
    if (
      spec.fm &&
      spec.fm.status === 'shipped' &&
      specUpdated &&
      t.repo_path &&
      fs.existsSync(t.repo_path)
    ) {
      const fileRefs = anchors
        .filter((a) => a.kind === 'file' && a.ref)
        .map((a) => a.ref);
      const lastTouch = gitLastTouchIso(t.repo_path, fileRefs);
      if (lastTouch && lastTouch < specUpdated) {
        staleCandidates.push(
          `spec=${t.spec}; spec_updated=${specUpdated}; last_code_touch=${lastTouch}`
        );
      } else if (!lastTouch && fileRefs.length > 0) {
        warnings.push(`git log failed for ${t.spec} repo=${t.repo_path}`);
      }
    }
  }

  fm.parsed_targets = parsedTargets;
  fm.stale_candidates = staleCandidates;
  fm.parse_warnings = warnings;

  writeMdAtomic(driftPath, fm, body);
  return {
    drift_path: driftPath,
    target_count: parsedTargets.length,
    stale_candidates: staleCandidates.length,
    parse_warnings: warnings.length,
  };
}

const RECONCILE_STATUS_TO_PHASE = {
  scoped: 'scope',
  parsed: 'parse',
  probed: 'probe',
  reported: 'report',
  cancelled: 'cancelled',
};

function cmdReconcileUpdateStatus(args) {
  const driftPathInput = args[0];
  const newStatus = args[1];
  if (!driftPathInput || !newStatus) {
    usage('reconcile update-status requires <drift-path> <new-status> [--phase-data <json>]');
  }
  if (!RECONCILE_STATUSES.has(newStatus)) {
    usage(
      `invalid reconcile status "${newStatus}". valid: ${[...RECONCILE_STATUSES].join(', ')}`
    );
  }
  const flags = parseFlags(args.slice(2), { 'phase-data': 'value' });
  const driftPath = resolveVaultPath(driftPathInput);
  if (!fs.existsSync(driftPath)) fail(`drift report not found: ${driftPath}`);
  const { fm, body } = readMd(driftPath);
  fm.status = newStatus;

  const phase = RECONCILE_STATUS_TO_PHASE[newStatus];
  if (phase) appendPhaseHistory(fm, phase);

  if (flags['phase-data']) {
    let parsed;
    try {
      parsed = JSON.parse(flags['phase-data']);
    } catch (e) {
      fail(`--phase-data is not valid JSON: ${e.message}`);
    }

    if (newStatus === 'probed' && parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.agents_dispatched)) {
        fm.agents_dispatched = parsed.agents_dispatched.map((a) => {
          if (typeof a === 'string') return a;
          const parts = [];
          if (a.name) parts.push(`name=${a.name}`);
          if (a.completed_at) parts.push(`completed_at=${a.completed_at}`);
          if (a.drift_count !== undefined) parts.push(`drift_count=${a.drift_count}`);
          return parts.join('; ');
        });
      }
      if (parsed.in_sync_count !== undefined) {
        fm.in_sync_count = String(parsed.in_sync_count);
      }
      if (Array.isArray(parsed.probe_notes)) {
        fm.probe_notes = parsed.probe_notes.map((n) => String(n));
      }
    }

    if (newStatus === 'reported' && parsed && Array.isArray(parsed.suggested_next)) {
      fm.suggested_next = parsed.suggested_next.map((s) => {
        if (typeof s === 'string') return s;
        const parts = [];
        if (s.skill) parts.push(`skill=${s.skill}`);
        if (s.reason) parts.push(`reason=${s.reason}`);
        if (Array.isArray(s.targets) && s.targets.length)
          parts.push(`targets=${s.targets.join(',')}`);
        return parts.join('; ');
      });
    }
  }

  writeMdAtomic(driftPath, fm, body);
  return {
    drift_path: driftPath,
    status: fm.status,
    phase_history: fm.phase_history,
    agents_dispatched: fm.agents_dispatched ?? [],
    drifts_count: fm.drifts_count ?? [],
    in_sync_count: fm.in_sync_count ?? '0',
    suggested_next: fm.suggested_next ?? [],
  };
}

function cmdReconcileAddDrift(args) {
  const flags = parseFlags(args, {
    'recommendation': 'value',
    'spec-ref': 'value',
    'code-ref': 'value',
  });
  const [driftPathInput, klass, artifact, description] = flags._;
  if (!driftPathInput || !klass || !artifact || !description) {
    usage('reconcile add-drift requires <drift-path> <class> <artifact> <description> [--recommendation <text>] [--spec-ref <FR-###>] [--code-ref <path:line>]');
  }
  if (!RECONCILE_DRIFT_CLASSES.has(klass)) {
    usage(
      `invalid drift class "${klass}". valid: ${[...RECONCILE_DRIFT_CLASSES].join(', ')}`
    );
  }
  const driftPath = resolveVaultPath(driftPathInput);
  if (!fs.existsSync(driftPath)) fail(`drift report not found: ${driftPath}`);
  const { fm, body } = readMd(driftPath);

  if (!Array.isArray(fm.drifts)) fm.drifts = [];
  let maxN = 0;
  for (const d of fm.drifts) {
    if (typeof d === 'string') {
      const m = d.match(/^id=D-(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    }
  }
  const driftId = `D-${String(maxN + 1).padStart(3, '0')}`;
  function clean(s) {
    return String(s).replace(/;/g, ',').replace(/\n/g, ' ');
  }
  const parts = [
    `id=${driftId}`,
    `class=${klass}`,
    `artifact=${clean(artifact)}`,
    `description=${clean(description)}`,
  ];
  if (flags['spec-ref']) parts.push(`spec_ref=${clean(flags['spec-ref'])}`);
  if (flags['code-ref']) parts.push(`code_ref=${clean(flags['code-ref'])}`);
  if (flags.recommendation) parts.push(`recommendation=${clean(flags.recommendation)}`);
  fm.drifts.push(parts.join('; '));

  // Recompute counts.
  const counts = { MISSING: 0, EXTRA: 0, DIVERGED: 0, STALE: 0 };
  for (const d of fm.drifts) {
    if (typeof d !== 'string') continue;
    const m = d.match(/class=([A-Z]+)/);
    if (m && counts[m[1]] !== undefined) counts[m[1]]++;
  }
  fm.drifts_count = [
    `missing=${counts.MISSING}`,
    `extra=${counts.EXTRA}`,
    `diverged=${counts.DIVERGED}`,
    `stale=${counts.STALE}`,
  ];

  writeMdAtomic(driftPath, fm, body);
  return {
    drift_path: driftPath,
    drift_id: driftId,
    total_drifts: fm.drifts.length,
    counts: fm.drifts_count,
  };
}

function cmdReconcileList(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('reconcile list requires <project-slug>');
  const flags = parseFlags(args.slice(1), { status: 'value' });
  const dir = reconcileDir(projectSlug);
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, count: 0, reports: [] };
  }
  const reports = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.match(/^drift-\d{4}-\d{2}-\d{2}(-\d+)?\.md$/)) continue;
    const full = path.join(dir, entry);
    let status = 'unknown';
    let scopeMode = 'unknown';
    let title = entry;
    try {
      const { fm } = readMd(full);
      status = fm.status || 'unknown';
      scopeMode = fm.scope_mode || 'unknown';
      title = fm.title || entry;
    } catch (_e) {
      // ignore
    }
    if (flags.status && status !== flags.status) continue;
    reports.push({ file: entry, path: full, status, scope_mode: scopeMode, title });
  }
  reports.sort((a, b) => b.file.localeCompare(a.file));
  return { project: projectSlug, count: reports.length, reports };
}

// ---------- schema-check group (lib/schema-check.cjs) ----------
const { cmdSchemaCheckParse, cmdSchemaCheckRun } = require(path.join(__dirname, 'lib', 'schema-check.cjs'));

// ---------- cost group (lib/cost.cjs) ----------
const { cmdCostRun } = require(path.join(__dirname, 'lib', 'cost.cjs'));

// ---------- realpath-check group (lib/realpath-check.cjs) ----------
const { cmdRealpathCheckRun } = require(path.join(__dirname, 'lib', 'realpath-check.cjs'));

// ---------- check-reservations group (lib/check-reservations.cjs) ----------
const { cmdCheckReservations } = require(path.join(__dirname, 'lib', 'check-reservations.cjs'));

// ---------- check group (lib/check.cjs) ----------
const { cmdCheckRun } = require(path.join(__dirname, 'lib', 'check.cjs'));

// ---------- code-scope group (lib/code-scope.cjs) ----------
const {
  cmdCodeScopeClaim,
  cmdCodeScopeStage,
  cmdCodeScopeRelease,
  cmdCodeScopeList,
  cmdCodeScopeCheck,
} = require(path.join(__dirname, 'lib', 'code-scope.cjs'));

const { usage, HELP } = require(path.join(__dirname, 'lib', 'help.cjs'));
const { cmdPhantomCheck, cmdPhantomListTasks } = require(path.join(__dirname, 'lib', 'phantom.cjs'));

const { cmdPackValidate, cmdPackImport, cmdPackExport } = require(path.join(__dirname, 'lib', 'pack.cjs'));

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${HELP}\n`);
    process.exit(0);
  }
  const [group, sub, ...rest] = argv;
  let result;
  try {
    if (group === 'spec') {
      if (sub === 'next-number') result = cmdSpecNextNumber(rest);
      else if (sub === 'update-status') result = cmdSpecUpdateStatus(rest);
      else if (sub === 'list') result = cmdSpecList(rest);
      else usage(`unknown spec subcommand: ${sub}`);
    } else if (group === 'fix') {
      if (sub === 'next-suffix') result = cmdFixNextSuffix(rest);
      else if (sub === 'update-status') result = cmdFixUpdateStatus(rest);
      else if (sub === 'list') result = cmdFixList(rest);
      else if (sub === 'find-duplicates') result = cmdFixFindDuplicates(rest);
      else if (sub === 'integrity-check') result = cmdFixIntegrityCheck(rest);
      else if (sub === 'init-postmortem') result = cmdFixInitPostmortem(rest);
      else if (sub === 'count-postmortems-since') result = cmdFixCountPostmortemsSince(rest);
      else if (sub === 'update-promote-state') result = cmdFixUpdatePromoteState(rest);
      else if (sub === 'write-suggestion') result = cmdFixWriteSuggestion(rest);
      else usage(`unknown fix subcommand: ${sub}`);
    } else if (group === 'analyze') {
      if (sub === 'next-slot') result = cmdAnalyzeNextSlot(rest);
      else if (sub === 'init') result = cmdAnalyzeInit(rest);
      else if (sub === 'update-status') result = cmdAnalyzeUpdateStatus(rest);
      else if (sub === 'discover') result = cmdAnalyzeDiscover(rest);
      else if (sub === 'add-finding') result = cmdAnalyzeAddFinding(rest);
      else if (sub === 'add-findings') result = cmdAnalyzeAddFindings(rest);
      else if (sub === 'list') result = cmdAnalyzeList(rest);
      else usage(`unknown analyze subcommand: ${sub}`);
    } else if (group === 'check') {
      // `check reservations` is an independent subcommand (owns exit 0/1).
      if (sub === 'reservations') {
        cmdCheckReservations(rest);
        return; // unreachable — cmdCheckReservations calls process.exit()
      }
      // The default check command is special: it owns its own exit code (0/1/2)
      // and prints its own report (json or human). It does NOT fall through to
      // the generic JSON.stringify(result) path below.
      cmdCheckRun([sub, ...rest].filter((x) => x !== undefined));
      return; // unreachable — cmdCheckRun calls process.exit()
    } else if (group === 'code-scope') {
      // code-scope claim/check own their exit code (0/1) and JSON output.
      if (sub === 'claim') {
        cmdCodeScopeClaim(rest);
        return; // unreachable — cmdCodeScopeClaim calls process.exit()
      } else if (sub === 'check') {
        cmdCodeScopeCheck(rest);
        return; // unreachable — cmdCodeScopeCheck calls process.exit()
      } else if (sub === 'stage') {
        cmdCodeScopeStage(rest);
        return; // unreachable — cmdCodeScopeStage calls process.exit()
      } else if (sub === 'release') {
        cmdCodeScopeRelease(rest);
        return; // unreachable — cmdCodeScopeRelease calls process.exit()
      } else if (sub === 'list') {
        cmdCodeScopeList(rest);
        return; // unreachable — cmdCodeScopeList calls process.exit()
      } else {
        usage(`unknown code-scope subcommand: ${sub}`);
      }
    } else if (group === 'realpath-check') {
      if (sub === 'run') {
        // owns its own exit code (0 pass / 1 findings / 2 error) and stdout
        cmdRealpathCheckRun(rest);
        return; // unreachable — cmdRealpathCheckRun calls process.exit()
      } else usage(`unknown realpath-check subcommand: ${sub}`);
    } else if (group === 'checklist') {
      if (sub === 'run') {
        // checklist run owns its own exit code (0/1/2) and report format.
        cmdChecklistRun(rest);
        return; // unreachable — cmdChecklistRun calls process.exit()
      } else if (sub === 'list') {
        result = cmdChecklistList(rest);
      } else {
        usage(`unknown checklist subcommand: ${sub}`);
      }
    } else if (group === 'constitution') {
      if (sub === 'init') result = cmdConstitutionInit(rest);
      else if (sub === 'discover') result = cmdConstitutionDiscover(rest);
      else if (sub === 'update-status') result = cmdConstitutionUpdateStatus(rest);
      else if (sub === 'set-body') result = cmdConstitutionSetBody(rest);
      else if (sub === 'next-version') result = cmdConstitutionNextVersion(rest);
      else if (sub === 'archive-current') result = cmdConstitutionArchiveCurrent(rest);
      else if (sub === 'write-mirror') result = cmdConstitutionWriteMirror(rest);
      else if (sub === 'link-claudemd') result = cmdConstitutionLinkClaudemd(rest);
      else if (sub === 'list') result = cmdConstitutionList(rest);
      else usage(`unknown constitution subcommand: ${sub}`);
    } else if (group === 'worktree') {
      if (sub === 'prepare') result = cmdWorktreePrepare(rest);
      else if (sub === 'enter') result = cmdWorktreeEnter(rest);
      else if (sub === 'status') result = cmdWorktreeStatus(rest);
      else if (sub === 'exit') result = cmdWorktreeExit(rest);
      else if (sub === 'list') result = cmdWorktreeList(rest);
      else if (sub === 'gc') result = cmdWorktreeGc(rest);
      else if (sub === 'adopt') result = cmdWorktreeAdopt(rest);
      else if (sub === 'reconcile') result = cmdWorktreeReconcile(rest);
      else usage(`unknown worktree subcommand: ${sub}`);
    } else if (group === 'pr') {
      if (sub === 'list-handoff') result = cmdPrListHandoff(rest);
      else if (sub === 'mark-status') result = cmdPrMarkStatus(rest);
      else if (sub === 'mark-pr-open') result = cmdPrMarkPrOpen(rest);
      else if (sub === 'findings-summary') result = cmdPrFindingsSummary(rest);
      else usage(`unknown pr subcommand: ${sub}`);
    } else if (group === 'phantom') {
      if (sub === 'check') {
        // owns its own exit code and stdout (json or human)
        cmdPhantomCheck(rest);
        return; // unreachable
      } else if (sub === 'list-tasks') {
        result = cmdPhantomListTasks(rest);
      } else {
        usage(`unknown phantom subcommand: ${sub}`);
      }
    } else if (group === 'reconcile') {
      if (sub === 'next-slot') result = cmdReconcileNextSlot(rest);
      else if (sub === 'init') result = cmdReconcileInit(rest);
      else if (sub === 'parse-spec') result = cmdReconcileParseSpec(rest);
      else if (sub === 'update-status') result = cmdReconcileUpdateStatus(rest);
      else if (sub === 'add-drift') result = cmdReconcileAddDrift(rest);
      else if (sub === 'list') result = cmdReconcileList(rest);
      else usage(`unknown reconcile subcommand: ${sub}`);
    } else if (group === 'modernize') {
      if (sub === 'next-slot') result = cmdModernizeNextSlot(rest);
      else if (sub === 'init') result = cmdModernizeInit(rest);
      else if (sub === 'update-status') result = cmdModernizeUpdateStatus(rest);
      else if (sub === 'discover-stack') result = cmdModernizeDiscoverStack(rest);
      else if (sub === 'add-proposal') result = cmdModernizeAddProposal(rest);
      else if (sub === 'approve-proposal') result = cmdModernizeApproveProposal(rest);
      else if (sub === 'add-wave') result = cmdModernizeAddWave(rest);
      else if (sub === 'snapshot-behavior') result = cmdModernizeSnapshotBehavior(rest);
      else if (sub === 'start-wave') result = cmdModernizeStartWave(rest);
      else if (sub === 'complete-wave') result = cmdModernizeCompleteWave(rest);
      else if (sub === 'verify-parity') result = cmdModernizeVerifyParity(rest);
      else if (sub === 'publish-notion') result = cmdModernizePublishNotion(rest);
      else if (sub === 'list') result = cmdModernizeList(rest);
      else usage(`unknown modernize subcommand: ${sub}`);
    } else if (group === 'schema-check') {
      if (sub === 'parse') result = cmdSchemaCheckParse(rest);
      else if (sub === 'run') {
        // owns its own exit code (0 pass / 1 findings / 2 error) and stdout
        cmdSchemaCheckRun(rest);
        return; // unreachable — cmdSchemaCheckRun calls process.exit()
      } else usage(`unknown schema-check subcommand: ${sub}`);
    } else if (group === 'cost') {
      if (sub === 'run') {
        // owns its own exit code (0 ok / 2 error) and stdout (table or json)
        cmdCostRun(rest);
        return; // unreachable — cmdCostRun calls process.exit()
      } else usage(`unknown cost subcommand: ${sub}`);
    } else if (group === 'product') {
      // product command group lives in lib/product.cjs (M9 module split).
      // Lazy require (only paid when `product ...` is actually invoked) — no
      // init() needed: usage() (Wave 1) and the stage-name constant (Wave 8)
      // are both imported directly by product.cjs now.
      const product = require(path.join(__dirname, 'lib', 'product.cjs'));
      // product status/stage own their exit code (0/1) and JSON output.
      if (sub === 'status') {
        product.cmdProductStatus(rest);
        return; // unreachable — cmdProductStatus calls process.exit()
      } else if (sub === 'stage') {
        product.cmdProductStage(rest);
        return; // unreachable — cmdProductStage calls process.exit()
      } else if (sub === 'markers') {
        product.cmdProductMarkers(rest);
        return; // unreachable — cmdProductMarkers calls process.exit()
      } else if (sub === 'changelog') {
        product.cmdProductChangelog(rest);
        return; // unreachable — cmdProductChangelog calls process.exit()
      } else if (sub === 'init') {
        product.cmdProductInit(rest);
        return; // unreachable — cmdProductInit calls process.exit()
      } else if (sub === 'add-milestone') {
        product.cmdProductAddMilestone(rest);
        return; // unreachable — cmdProductAddMilestone calls process.exit()
      } else if (sub === 'add-feature') {
        product.cmdProductAddFeature(rest);
        return; // unreachable — cmdProductAddFeature calls process.exit()
      } else if (sub === 'feature-init') {
        product.cmdProductFeatureInit(rest);
        return; // unreachable — cmdProductFeatureInit calls process.exit()
      } else if (sub === 'import') {
        product.cmdProductImport(rest);
        return; // unreachable — cmdProductImport calls process.exit()
      } else if (sub === 'validate') {
        product.cmdProductValidate(rest);
        return; // unreachable — cmdProductValidate calls process.exit()
      } else {
        usage(`unknown product subcommand: ${sub}`);
      }
    } else if (group === 'pack') {
      // pack subcommands own their exit codes (0/1/2) and stdout.
      if (sub === 'validate') {
        cmdPackValidate(rest);
        return; // unreachable — cmdPackValidate calls process.exit()
      } else if (sub === 'import') {
        cmdPackImport(rest);
        return; // unreachable — cmdPackImport calls process.exit()
      } else if (sub === 'export') {
        cmdPackExport(rest);
        return; // unreachable — cmdPackExport calls process.exit()
      } else usage(`unknown pack subcommand: ${sub}`);
    } else {
      usage(`unknown command group: ${group} (expected "spec", "fix", "analyze", "check", "checklist", "constitution", "worktree", "pr", "phantom", "reconcile", "modernize", "schema-check", "cost", "pack", "product", or "realpath-check"). fix supports: next-suffix, update-status, list, find-duplicates, integrity-check, init-postmortem, count-postmortems-since, update-promote-state, write-suggestion`);
    }
  } catch (e) {
    process.stderr.write(`internal error: ${e.message}\n`);
    if (process.env.A1_DEBUG) process.stderr.write(`${e.stack}\n`);
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

main();
