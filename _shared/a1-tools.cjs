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
// branch lazily requires it and calls product.init({ CODE_SCOPE_STAGES }) once before
// dispatching (CODE_SCOPE_STAGES is shared with the facade-resident code-scope
// commands — moving it without also moving code-scope would create a circular
// require back into this file; usage() moved to lib/help.cjs in M10 Wave 1 and
// product.cjs now imports it directly, no longer via injection).


function appendPhaseHistory(fm, phaseName) {
  if (!Array.isArray(fm.phase_history)) fm.phase_history = [];
  const entry = `phase=${phaseName} completed=${nowIso()}`;
  fm.phase_history = fm.phase_history.filter(
    (e) => !(typeof e === 'string' && e.startsWith(`phase=${phaseName} `))
  );
  fm.phase_history.push(entry);
}

// ---------- spec subcommands ----------

function cmdSpecNextNumber(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('spec next-number requires <project-slug>');
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'spec');
  let max = 0;
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(/^(\d{3})-/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  const next = max + 1;
  return {
    project: projectSlug,
    next,
    padded: String(next).padStart(3, '0'),
    dir,
  };
}

const SPEC_STATUS_TO_PHASE = {
  draft: 'discover',
  clarified: 'specify+clarify',
  planned: 'plan',
  'awaiting-consistency-fix': 'consistency-gate-fail',
  implementing: null,
  done: 'implement+verify',
  cancelled: 'cancelled',
};

function cmdSpecUpdateStatus(args) {
  const specPathInput = args[0];
  const newStatus = args[1];
  if (!specPathInput || !newStatus) {
    usage('spec update-status requires <spec-path> <new-status>');
  }
  if (!SPEC_STATUSES.has(newStatus)) {
    usage(
      `invalid spec status "${newStatus}". valid: ${[...SPEC_STATUSES].join(', ')}`
    );
  }
  const flags = parseFlags(args.slice(2), {
    'wave-plan-path': 'value',
    'verify-failures-file': 'value',
    'clear-verify-failures': 'bool',
  });
  const specPath = resolveVaultPath(specPathInput);
  if (!fs.existsSync(specPath)) fail(`spec file not found: ${specPath}`);
  const { fm, body } = readMd(specPath);
  fm.status = newStatus;

  const completedPhase = SPEC_STATUS_TO_PHASE[newStatus];
  if (completedPhase) {
    for (const ph of completedPhase.split('+')) appendPhaseHistory(fm, ph);
  }

  if (flags['wave-plan-path'] !== undefined) {
    fm.wave_plan_path = flags['wave-plan-path'];
  }
  if (flags['clear-verify-failures'] || newStatus === 'done') {
    fm.verify_failures = [];
  }
  if (flags['verify-failures-file']) {
    const raw = fs.readFileSync(flags['verify-failures-file'], 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      fail(`verify-failures-file is not valid JSON: ${e.message}`);
    }
    if (!Array.isArray(parsed)) {
      fail('verify-failures-file must contain a JSON array');
    }
    fm.verify_failures = parsed.map((f) => JSON.stringify(f));
  }

  writeMdAtomic(specPath, fm, body);
  return {
    spec_path: specPath,
    status: fm.status,
    phase_history: fm.phase_history,
    wave_plan_path: fm.wave_plan_path ?? null,
    verify_failures: fm.verify_failures ?? [],
  };
}

function cmdSpecList(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('spec list requires <project-slug>');
  const flags = parseFlags(args.slice(1), { status: 'value' });
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'spec');
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, count: 0, specs: [] };
  }
  const specs = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.match(/^\d{3}-.+\.md$/)) continue;
    const full = path.join(dir, entry);
    let status = 'unknown';
    let title = entry;
    try {
      const { fm } = readMd(full);
      status = fm.status || 'unknown';
      title = fm.title || entry;
    } catch (_e) {
      // ignore
    }
    if (flags.status && status !== flags.status) continue;
    specs.push({ file: entry, path: full, status, title });
  }
  return { project: projectSlug, count: specs.length, specs };
}

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

// ---------- analyze subcommands ----------

function cmdAnalyzeNextSlot(args) {
  const flags = parseFlags(args, { date: 'value' });
  const projectSlug = flags._[0];
  const focus = flags._[1];
  if (!projectSlug || !focus) {
    usage('analyze next-slot requires <project-slug> <focus> [--date YYYY-MM-DD]');
  }
  if (!ANALYSIS_FOCUSES.has(focus)) {
    usage(
      `invalid focus "${focus}". valid: ${[...ANALYSIS_FOCUSES].join(', ')}`
    );
  }
  const date = flags.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage(`invalid date "${date}", expected YYYY-MM-DD`);
  }
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'analyses');
  let used = new Set();
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^${date}-${focus}(-(\\d+))?\\.md$`);
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(re);
      if (m) used.add(m[2] ? parseInt(m[2], 10) : 1);
    }
  }
  let n = 1;
  while (used.has(n)) n++;
  const suffix = n === 1 ? '' : `-${n}`;
  const filename = `${date}-${focus}${suffix}.md`;
  return {
    project: projectSlug,
    focus,
    date,
    suffix,
    filename,
    path: path.join(dir, filename),
    dir,
  };
}

function cmdAnalyzeInit(args) {
  const flags = parseFlags(args, {
    'project-path': 'value',
    'date': 'value',
    'title': 'value',
  });
  const projectSlug = flags._[0];
  const focus = flags._[1];
  if (!projectSlug || !focus) {
    usage('analyze init requires <project-slug> <focus> [--project-path /abs] [--date YYYY-MM-DD] [--title <text>]');
  }
  if (!ANALYSIS_FOCUSES.has(focus)) {
    usage(
      `invalid focus "${focus}". valid: ${[...ANALYSIS_FOCUSES].join(', ')}`
    );
  }
  // Compute slot.
  const slot = cmdAnalyzeNextSlot([projectSlug, focus, ...(flags.date ? ['--date', flags.date] : [])]);
  const filePath = slot.path;
  if (!fs.existsSync(slot.dir)) fs.mkdirSync(slot.dir, { recursive: true });

  const title = flags.title || `${focus} analysis of ${projectSlug}`;
  const analyzedPath = flags['project-path'] || '';

  const fm = {
    type: 'project-analysis',
    project: projectSlug,
    focus,
    title,
    status: 'scoped',
    created_at: nowIso(),
    analyzed_path: analyzedPath,
    phase_history: [`phase=scope completed=${nowIso()}`],
    discover: [],
    agents_dispatched: [],
    findings: [],
    findings_count: ['blocker=0', 'major=0', 'minor=0'],
    suggested_next: [],
    tags: ['analysis', `project/${projectSlug}`, `focus/${focus}`],
  };

  // Body — sectioned report skeleton. Phase 5 will overwrite sections.
  const body = `# Analysis: ${title}

## Scope

- Project: ${projectSlug}
- Focus: ${focus}
- Analyzed path: ${analyzedPath || '<not set>'}

## Discover (Phase 2 — filled by CLI)

<filled by 'analyze update-status ... discovered --phase-data ...'>

## Findings (Phase 3 — appended by sub-agents)

<filled incrementally by 'analyze add-finding'>

## Synthesis (Phase 4 — LLM)

<filled by skill in synthesize phase>

## Recommendations (Phase 5 — LLM)

<filled by skill in report phase>

## Notes

<anything else>
`;

  writeMdAtomic(filePath, fm, body);
  return {
    path: filePath,
    project: projectSlug,
    focus,
    status: 'scoped',
  };
}

const ANALYSIS_STATUS_TO_PHASE = {
  scoped: 'scope',
  discovered: 'discover',
  analyzed: 'analyze',
  synthesized: 'synthesize',
  reported: 'report',
  cancelled: 'cancelled',
};

function cmdAnalyzeUpdateStatus(args) {
  const analysisPathInput = args[0];
  const newStatus = args[1];
  if (!analysisPathInput || !newStatus) {
    usage('analyze update-status requires <analysis-path> <new-status> [--phase-data <json>]');
  }
  if (!ANALYSIS_STATUSES.has(newStatus)) {
    usage(
      `invalid analysis status "${newStatus}". valid: ${[...ANALYSIS_STATUSES].join(', ')}`
    );
  }
  const flags = parseFlags(args.slice(2), {
    'phase-data': 'value',
  });
  const analysisPath = resolveVaultPath(analysisPathInput);
  if (!fs.existsSync(analysisPath)) fail(`analysis file not found: ${analysisPath}`);
  const { fm, body } = readMd(analysisPath);
  fm.status = newStatus;

  const phase = ANALYSIS_STATUS_TO_PHASE[newStatus];
  if (phase) appendPhaseHistory(fm, phase);

  if (flags['phase-data']) {
    let parsed;
    try {
      parsed = JSON.parse(flags['phase-data']);
    } catch (e) {
      fail(`--phase-data is not valid JSON: ${e.message}`);
    }
    // Map known phase-data targets.
    if (newStatus === 'discovered' && parsed && typeof parsed === 'object') {
      const entries = [];
      for (const k of Object.keys(parsed)) {
        const v = parsed[k];
        const flatVal = Array.isArray(v) ? v.join(',') : String(v ?? '');
        entries.push(`${k}=${flatVal}`);
      }
      fm.discover = entries;
    }
    if (newStatus === 'analyzed' && parsed && Array.isArray(parsed.agents_dispatched)) {
      fm.agents_dispatched = parsed.agents_dispatched.map((a) => {
        if (typeof a === 'string') return a;
        const parts = [];
        if (a.name) parts.push(`name=${a.name}`);
        if (a.focus) parts.push(`focus=${a.focus}`);
        if (a.completed_at) parts.push(`completed_at=${a.completed_at}`);
        return parts.join('; ');
      });
    }
    if (newStatus === 'synthesized' && parsed && parsed.findings_count) {
      const fc = parsed.findings_count;
      fm.findings_count = [
        `blocker=${fc.blocker ?? 0}`,
        `major=${fc.major ?? 0}`,
        `minor=${fc.minor ?? 0}`,
      ];
    }
    if (newStatus === 'reported' && parsed && Array.isArray(parsed.suggested_next)) {
      fm.suggested_next = parsed.suggested_next.map((s) => {
        if (typeof s === 'string') return s;
        const parts = [];
        if (s.skill) parts.push(`skill=${s.skill}`);
        if (s.reason) parts.push(`reason=${s.reason}`);
        if (s.target_findings)
          parts.push(`target_findings=${(s.target_findings || []).join(',')}`);
        return parts.join('; ');
      });
    }
  }

  writeMdAtomic(analysisPath, fm, body);
  return {
    analysis_path: analysisPath,
    status: fm.status,
    phase_history: fm.phase_history,
    discover: fm.discover ?? [],
    agents_dispatched: fm.agents_dispatched ?? [],
    findings_count: fm.findings_count ?? [],
    suggested_next: fm.suggested_next ?? [],
  };
}

function cmdAnalyzeDiscover(args) {
  const projectPath = args[0];
  if (!projectPath) usage('analyze discover requires <project-path>');
  if (!fs.existsSync(projectPath)) fail(`project path not found: ${projectPath}`);

  const stack = new Set();
  const STACK_MARKERS = [
    ['package.json', 'node'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['tsconfig.json', 'typescript'],
    ['next.config.js', 'next.js'],
    ['next.config.mjs', 'next.js'],
    ['next.config.ts', 'next.js'],
    ['vite.config.ts', 'vite'],
    ['vite.config.js', 'vite'],
    ['astro.config.mjs', 'astro'],
    ['svelte.config.js', 'svelte'],
    ['nuxt.config.ts', 'nuxt'],
    ['remix.config.js', 'remix'],
    ['requirements.txt', 'python'],
    ['pyproject.toml', 'python'],
    ['Pipfile', 'python'],
    ['Cargo.toml', 'rust'],
    ['go.mod', 'go'],
    ['pubspec.yaml', 'flutter'],
    ['composer.json', 'php'],
    ['Gemfile', 'ruby'],
    ['build.gradle', 'java'],
    ['build.gradle.kts', 'kotlin'],
    ['pom.xml', 'java-maven'],
    ['Dockerfile', 'docker'],
    ['docker-compose.yml', 'docker-compose'],
    ['docker-compose.yaml', 'docker-compose'],
    ['vercel.json', 'vercel'],
    ['netlify.toml', 'netlify'],
    ['supabase/config.toml', 'supabase'],
    ['prisma/schema.prisma', 'prisma'],
    ['drizzle.config.ts', 'drizzle'],
    ['turbo.json', 'turborepo'],
    ['nx.json', 'nx'],
    ['.github/workflows', 'github-actions'],
  ];
  for (const [marker, label] of STACK_MARKERS) {
    if (fs.existsSync(path.join(projectPath, marker))) stack.add(label);
  }

  // LOC + file count: walk, skip noise dirs.
  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.next', 'dist', 'build', 'out',
    '.turbo', '.cache', 'coverage', '.venv', 'venv', '__pycache__',
    'target', '.gradle', '.idea', '.vscode',
  ]);
  const CODE_EXT = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py', '.rs', '.go', '.dart', '.java', '.kt', '.rb', '.php',
    '.css', '.scss', '.html', '.vue', '.svelte', '.astro',
    '.sql', '.sh', '.yml', '.yaml', '.toml', '.json', '.md',
  ]);
  let loc = 0;
  let fileCount = 0;
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!CODE_EXT.has(ext)) continue;
        fileCount++;
        try {
          const content = fs.readFileSync(full, 'utf8');
          loc += content.split('\n').length;
        } catch (_e) {
          // skip unreadable
        }
      }
    }
  }
  walk(projectPath);

  // Git stats (best effort).
  let lastCommit = null;
  let branch = null;
  let commitCount30d = 0;
  const gitDir = path.join(projectPath, '.git');
  if (fs.existsSync(gitDir)) {
    try {
      const { execSync } = require('child_process');
      lastCommit = execSync('git log -1 --format=%cI', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const count = execSync('git log --since="30 days ago" --oneline', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      commitCount30d = count.trim() ? count.trim().split('\n').length : 0;
    } catch (_e) {
      // git not available or other issue — leave as null
    }
  }

  return {
    project_path: projectPath,
    tech_stack: [...stack].sort(),
    loc,
    file_count: fileCount,
    last_commit: lastCommit,
    branch,
    commit_count_30d: commitCount30d,
  };
}

function cmdAnalyzeAddFinding(args) {
  const flags = parseFlags(args, {
    recommendation: 'value',
  });
  const [analysisPathInput, severity, category, location, description] = flags._;
  if (!analysisPathInput || !severity || !category || !location || !description) {
    usage('analyze add-finding requires <analysis-path> <severity> <category> <location> <description> [--recommendation <text>]');
  }
  if (!ANALYSIS_SEVERITIES.has(severity)) {
    usage(
      `invalid severity "${severity}". valid: ${[...ANALYSIS_SEVERITIES].join(', ')}`
    );
  }
  const analysisPath = resolveVaultPath(analysisPathInput);
  if (!fs.existsSync(analysisPath)) fail(`analysis file not found: ${analysisPath}`);
  const { fm, body } = readMd(analysisPath);
  const findingId = appendFinding(fm, {
    severity,
    category,
    location,
    description,
    recommendation: flags.recommendation,
  });
  writeMdAtomic(analysisPath, fm, body);
  return {
    analysis_path: analysisPath,
    finding_id: findingId,
    total_findings: fm.findings.length,
  };
}

function appendFinding(fm, { severity, category, location, description, recommendation }) {
  if (!severity || !category || !location || !description) {
    fail('finding requires severity, category, location, description');
  }
  if (!ANALYSIS_SEVERITIES.has(severity)) {
    fail(`invalid severity "${severity}". valid: ${[...ANALYSIS_SEVERITIES].join(', ')}`);
  }
  if (!Array.isArray(fm.findings)) fm.findings = [];
  let maxN = 0;
  for (const f of fm.findings) {
    if (typeof f === 'string') {
      const m = f.match(/^id=F-(\d+)/);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
  }
  const findingId = `F-${String(maxN + 1).padStart(3, '0')}`;
  const clean = (s) => String(s).replace(/;/g, ',').replace(/\n/g, ' ');
  const parts = [
    `id=${findingId}`,
    `severity=${severity}`,
    `category=${clean(category)}`,
    `location=${clean(location)}`,
    `description=${clean(description)}`,
  ];
  if (recommendation) parts.push(`recommendation=${clean(recommendation)}`);
  fm.findings.push(parts.join('; '));
  return findingId;
}

function cmdAnalyzeAddFindings(args) {
  const flags = parseFlags(args, { json: 'value' });
  const analysisPathInput = flags._[0];
  if (!analysisPathInput || !flags.json) {
    usage('analyze add-findings requires <analysis-path> --json <file|-> (JSON array of {severity, category, location, description, recommendation?})');
  }
  const raw = flags.json === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(flags.json, 'utf8');
  let items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    fail(`invalid JSON input: ${e.message}`);
  }
  if (!Array.isArray(items) || items.length === 0) {
    fail('JSON input must be a non-empty array of finding objects');
  }
  const analysisPath = resolveVaultPath(analysisPathInput);
  if (!fs.existsSync(analysisPath)) fail(`analysis file not found: ${analysisPath}`);
  const { fm, body } = readMd(analysisPath);
  const ids = items.map((item) => appendFinding(fm, item || {}));
  writeMdAtomic(analysisPath, fm, body);
  return {
    analysis_path: analysisPath,
    finding_ids: ids,
    added: ids.length,
    total_findings: fm.findings.length,
  };
}

function cmdAnalyzeList(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('analyze list requires <project-slug>');
  const flags = parseFlags(args.slice(1), {
    status: 'value',
    focus: 'value',
  });
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'analyses');
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, count: 0, analyses: [] };
  }
  const analyses = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.match(/^\d{4}-\d{2}-\d{2}-.+\.md$/)) continue;
    const full = path.join(dir, entry);
    let status = 'unknown';
    let focus = 'unknown';
    let title = entry;
    try {
      const { fm } = readMd(full);
      status = fm.status || 'unknown';
      focus = fm.focus || 'unknown';
      title = fm.title || entry;
    } catch (_e) {
      // ignore
    }
    if (flags.status && status !== flags.status) continue;
    if (flags.focus && focus !== flags.focus) continue;
    analyses.push({ file: entry, path: full, status, focus, title });
  }
  // Sort by filename desc (most recent date first).
  analyses.sort((a, b) => b.file.localeCompare(a.file));
  return { project: projectSlug, count: analyses.length, analyses };
}

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

// ---------- check subcommand (consistency gate) ----------
//
// Verifies structural consistency between a feature's spec and its wave-plan.
// Three checks (all deterministic, regex-based — no LLM):
//   1. frontmatter_link — plan.frontmatter.spec_path resolves to the expected spec
//   2. fr_coverage      — every FR-### from the spec appears in exactly one Wave
//   3. fr_phantoms      — no FR-### in the plan that is absent from the spec
//
// Exit codes (the check command sets its own — bypasses the generic main() path):
//   0 PASS, 1 FAIL (content inconsistency), 2 ERROR (setup: missing file, bad frontmatter)
//
// Output formats: --format json (default, for programmatic callers) or --format human (DE).

const FR_PATTERN = /\bFR-\d{3,}\b/g;
const WAVE_HEADING_PATTERN = /^##\s+Wave\s+(\d+)\b[^\n]*$/gim;

function extractSpecFRs(specBody) {
  // Spec FR-IDs can appear anywhere in the body. Collect unique set.
  const set = new Set();
  const matches = specBody.match(FR_PATTERN) || [];
  for (const m of matches) set.add(m);
  return set;
}

function extractWaveFRs(planBody) {
  // Split plan body into wave sections by "## Wave N" headings.
  // For each wave, collect every FR-### occurrence in that section.
  // Returns: Map<waveLabel, Set<FR>>.
  const waves = new Map();
  const lines = planBody.split('\n');
  let currentLabel = null;
  let currentBuf = [];
  const flush = () => {
    if (currentLabel === null) return;
    const text = currentBuf.join('\n');
    const found = new Set();
    const m = text.match(FR_PATTERN) || [];
    for (const fr of m) found.add(fr);
    waves.set(currentLabel, found);
  };
  const headingRe = /^##\s+Wave\s+(\d+)\b(.*)$/i;
  for (const line of lines) {
    const h = line.match(headingRe);
    if (h) {
      flush();
      currentLabel = `Wave ${h[1]}`;
      currentBuf = [];
    } else if (currentLabel !== null) {
      currentBuf.push(line);
    }
  }
  flush();
  return waves;
}

function diffFRCoverage(specFRs, waveMap) {
  // Build the inverse map: FR -> [waveLabels...] (to detect duplicates).
  const frToWaves = new Map();
  for (const [waveLabel, frs] of waveMap.entries()) {
    for (const fr of frs) {
      if (!frToWaves.has(fr)) frToWaves.set(fr, []);
      frToWaves.get(fr).push(waveLabel);
    }
  }
  const planFRs = new Set(frToWaves.keys());
  const missingInPlan = [...specFRs].filter((fr) => !planFRs.has(fr)).sort();
  const phantomInPlan = [...planFRs].filter((fr) => !specFRs.has(fr)).sort();
  const duplicatedInPlan = [];
  for (const [fr, labels] of frToWaves.entries()) {
    if (labels.length > 1) duplicatedInPlan.push({ fr, waves: labels });
  }
  duplicatedInPlan.sort((a, b) => a.fr.localeCompare(b.fr));
  return { missingInPlan, phantomInPlan, duplicatedInPlan, planFRs };
}

function buildExpectedPaths(projectSlug, feature) {
  // feature = "<###>-<feature-slug>" (e.g. "001-login")
  const specAbs = path.join(vaultRoot(), 'projects', projectSlug, 'spec', `${feature}.md`);
  const planAbs = path.join(
    vaultRoot(),
    'projects',
    projectSlug,
    'plans',
    `${feature}-wave-plan.md`
  );
  const specRel = `projects/${projectSlug}/spec/${feature}.md`;
  const planRel = `projects/${projectSlug}/plans/${feature}-wave-plan.md`;
  return { specAbs, planAbs, specRel, planRel };
}

function formatHumanReport(report) {
  const lines = [];
  const statusLabel =
    report.status === 'PASS'
      ? 'PASS'
      : report.status === 'FAIL'
      ? 'FAIL'
      : 'ERROR';
  lines.push(`Konsistenz-Check: ${statusLabel}`);
  lines.push('');
  lines.push(`Feature: ${report.feature} (Projekt: ${report.project})`);
  lines.push('');

  if (report.status === 'ERROR') {
    lines.push('Setup-Fehler:');
    for (const err of report.errors || []) lines.push(`  - ${err}`);
    lines.push('');
    lines.push('Empfehlung:');
    lines.push('  Artifacts pruefen — fehlende Datei anlegen oder Frontmatter reparieren.');
    return lines.join('\n');
  }

  const tick = (s) => (s === 'PASS' ? '[ok]' : '[x]');
  lines.push('Pruefungen:');
  lines.push(`  Frontmatter-Link    ${tick(report.checks.frontmatter_link)} ${report.checks.frontmatter_link}`);
  lines.push(`  FR-Coverage         ${tick(report.checks.fr_coverage)} ${report.checks.fr_coverage}`);
  lines.push(`  FR-Phantome         ${tick(report.checks.fr_phantoms)} ${report.checks.fr_phantoms}`);
  lines.push('');

  if (report.status === 'PASS') {
    lines.push(`Befund: Spec und Wave-Plan sind synchron (${report.counts.spec_frs} FRs ueber ${report.counts.waves} Waves verteilt).`);
    return lines.join('\n');
  }

  lines.push('Befund:');
  const d = report.diffs;
  if (report.checks.frontmatter_link === 'FAIL') {
    lines.push(`  Plan-Frontmatter zeigt auf falsche Spec:`);
    lines.push(`    spec_path im Plan: ${d.frontmatter_link.actual || '(fehlt)'}`);
    lines.push(`    erwartet:          ${d.frontmatter_link.expected}`);
  }
  if (d.missing_in_plan.length > 0) {
    lines.push(`  FRs aus der Spec, die in keiner Wave vorkommen:`);
    for (const fr of d.missing_in_plan) lines.push(`    - ${fr}`);
  }
  if (d.duplicated_in_plan.length > 0) {
    lines.push(`  FRs, die in mehreren Waves vorkommen:`);
    for (const dup of d.duplicated_in_plan) {
      lines.push(`    - ${dup.fr} in ${dup.waves.join(', ')}`);
    }
  }
  if (d.phantom_in_plan.length > 0) {
    lines.push(`  Phantom-FRs im Plan (nicht in der Spec definiert):`);
    for (const fr of d.phantom_in_plan) lines.push(`    - ${fr}`);
  }
  lines.push('');
  lines.push('Empfehlung:');
  lines.push(`  ${report.summary}`);
  return lines.join('\n');
}

function cmdCheckRun(args) {
  // Parse: <project-slug> --feature <###-slug> [--format json|human] [--vault <path>]
  const projectSlug = args[0];
  if (!projectSlug || projectSlug.startsWith('--')) {
    usage('check requires <project-slug> --feature <###-feature-slug>');
  }
  const flags = parseFlags(args.slice(1), {
    feature: 'value',
    format: 'value',
    vault: 'value',
  });
  if (!flags.feature) {
    usage('check requires --feature <###-feature-slug>');
  }
  const format = flags.format || 'json';
  if (format !== 'json' && format !== 'human') {
    usage(`check --format must be "json" or "human" (got: ${format})`);
  }
  if (flags.vault) process.env.A1_VAULT_ROOT = flags.vault;

  const feature = flags.feature;
  const paths = buildExpectedPaths(projectSlug, feature);

  const report = {
    status: 'PASS',
    exit_code: 0,
    project: projectSlug,
    feature,
    paths: { spec: paths.specRel, plan: paths.planRel },
    checks: { frontmatter_link: 'PASS', fr_coverage: 'PASS', fr_phantoms: 'PASS' },
    counts: { spec_frs: 0, plan_frs: 0, waves: 0 },
    diffs: {
      frontmatter_link: { expected: paths.specRel, actual: null },
      missing_in_plan: [],
      duplicated_in_plan: [],
      phantom_in_plan: [],
    },
    errors: [],
    summary: '',
  };

  // --- Load phase ---
  const errors = [];
  if (!fs.existsSync(paths.specAbs)) {
    errors.push(`spec not found: ${paths.specRel}`);
  }
  if (!fs.existsSync(paths.planAbs)) {
    errors.push(`wave-plan not found: ${paths.planRel}`);
  }
  if (errors.length > 0) {
    report.status = 'ERROR';
    report.exit_code = 2;
    report.errors = errors;
    return emitCheckReport(report, format);
  }

  let spec, plan;
  try {
    spec = readMd(paths.specAbs);
  } catch (e) {
    report.status = 'ERROR';
    report.exit_code = 2;
    report.errors = [`spec frontmatter parse error: ${e.message}`];
    return emitCheckReport(report, format);
  }
  try {
    plan = readMd(paths.planAbs);
  } catch (e) {
    report.status = 'ERROR';
    report.exit_code = 2;
    report.errors = [`wave-plan frontmatter parse error: ${e.message}`];
    return emitCheckReport(report, format);
  }

  // --- Compare phase ---
  // Check 1: frontmatter_link
  const planSpecPath = plan.fm.spec_path || null;
  report.diffs.frontmatter_link.actual = planSpecPath;
  // Accept either the relative form or the absolute form of the expected spec path.
  const linkOk =
    planSpecPath === paths.specRel ||
    planSpecPath === paths.specAbs ||
    (typeof planSpecPath === 'string' &&
      planSpecPath.endsWith(`spec/${feature}.md`));
  if (!linkOk) {
    report.checks.frontmatter_link = 'FAIL';
  }

  // Check 2 + 3: FR coverage + phantoms
  const specFRs = extractSpecFRs(spec.body);
  const waveMap = extractWaveFRs(plan.body);
  const diff = diffFRCoverage(specFRs, waveMap);

  report.counts.spec_frs = specFRs.size;
  report.counts.plan_frs = diff.planFRs.size;
  report.counts.waves = waveMap.size;
  report.diffs.missing_in_plan = diff.missingInPlan;
  report.diffs.duplicated_in_plan = diff.duplicatedInPlan;
  report.diffs.phantom_in_plan = diff.phantomInPlan;

  if (diff.missingInPlan.length > 0 || diff.duplicatedInPlan.length > 0) {
    report.checks.fr_coverage = 'FAIL';
  }
  if (diff.phantomInPlan.length > 0) {
    report.checks.fr_phantoms = 'FAIL';
  }

  // --- Report phase ---
  const anyFail = Object.values(report.checks).some((v) => v === 'FAIL');
  if (anyFail) {
    report.status = 'FAIL';
    report.exit_code = 1;
    const parts = [];
    if (diff.missingInPlan.length > 0) {
      parts.push(`${diff.missingInPlan.length} FR(s) from spec not covered by any wave`);
    }
    if (diff.duplicatedInPlan.length > 0) {
      parts.push(`${diff.duplicatedInPlan.length} FR(s) duplicated across waves`);
    }
    if (diff.phantomInPlan.length > 0) {
      parts.push(`${diff.phantomInPlan.length} phantom FR(s) in plan (not in spec)`);
    }
    if (report.checks.frontmatter_link === 'FAIL') {
      parts.push('plan frontmatter spec_path mismatches expected spec');
    }
    report.summary = parts.join('; ') + '.';
  } else {
    report.summary = `Spec and wave-plan are consistent (${specFRs.size} FRs across ${waveMap.size} waves).`;
  }

  return emitCheckReport(report, format);
}

function emitCheckReport(report, format) {
  if (format === 'human') {
    process.stdout.write(formatHumanReport(report) + '\n');
  } else {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
  process.exit(report.exit_code);
}

// ---------- checklist subcommands ----------
//
// Pre-flight gate before implementation. Runs 8 structural checks across the
// feature's spec, wave-plan, and project metadata. Severities: BLOCKER stops
// the gate (exit 1), MAJOR/MINOR are reported but do not gate (exit 0 with
// warnings). Setup problems (missing files, parse errors) yield exit 2.

const CHECKLIST_REQUIRED_PLAN_FM_FIELDS = [
  'spec_path',
  'spec_id',
  'project',
  'created',
  'waves',
];

// Resolve a slug-or-slug/feature input into a concrete feature id.
// - "foo/003" or "foo/003-login" → { slug: "foo", feature: "003-login" }
// - "foo"                        → { slug: "foo", feature: <latest by ###> }
function resolveChecklistTarget(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('checklist target must be "<slug>" or "<slug>/<feature-id>"');
  }
  const parts = input.split('/');
  const slug = parts[0];
  if (!slug) throw new Error('checklist target: empty project slug');
  const specDir = path.join(vaultRoot(), 'projects', slug, 'spec');
  if (!fs.existsSync(specDir)) {
    throw new Error(`spec directory not found: projects/${slug}/spec/`);
  }
  const specFiles = fs
    .readdirSync(specDir)
    .filter((f) => /^\d{3,}-.+\.md$/.test(f))
    .sort();
  if (specFiles.length === 0) {
    throw new Error(`no specs found under projects/${slug}/spec/`);
  }

  if (parts.length === 1) {
    const latest = specFiles[specFiles.length - 1];
    return { slug, feature: latest.replace(/\.md$/, '') };
  }

  const ref = parts.slice(1).join('/');
  // Case A: full feature id "003-login"
  const full = specFiles.find((f) => f === `${ref}.md`);
  if (full) return { slug, feature: ref };
  // Case B: just the number "003"
  const numMatch = ref.match(/^(\d{3,})$/);
  if (numMatch) {
    const prefix = `${numMatch[1]}-`;
    const hit = specFiles.find((f) => f.startsWith(prefix));
    if (hit) return { slug, feature: hit.replace(/\.md$/, '') };
    throw new Error(`no spec found under projects/${slug}/spec/ matching prefix "${prefix}"`);
  }
  // Case C: partial slug-style "003-log"
  const partial = specFiles.find((f) => f.startsWith(ref) && f.endsWith('.md'));
  if (partial) return { slug, feature: partial.replace(/\.md$/, '') };
  throw new Error(`no spec found under projects/${slug}/spec/ matching "${ref}"`);
}

function checklistPaths(slug, feature) {
  const root = vaultRoot();
  return {
    specAbs: path.join(root, 'projects', slug, 'spec', `${feature}.md`),
    specRel: `projects/${slug}/spec/${feature}.md`,
    planAbs: path.join(root, 'projects', slug, 'plans', `${feature}-wave-plan.md`),
    planRel: `projects/${slug}/plans/${feature}-wave-plan.md`,
    plansDirAbs: path.join(root, 'projects', slug, 'plans'),
    plansDirRel: `projects/${slug}/plans`,
    claudemdAbs: path.join(root, 'projects', slug, 'CLAUDE.md'),
    claudemdRel: `projects/${slug}/CLAUDE.md`,
    checklistDirAbs: path.join(root, 'projects', slug, 'checklist'),
    checklistDirRel: `projects/${slug}/checklist`,
  };
}

// Extract wave blocks from a plan body. Returns Array<{label, num, lines[]}>.
function extractWaveBlocks(planBody) {
  const blocks = [];
  const headingRe = /^##\s+Wave\s+(\d+)\b(.*)$/i;
  const lines = planBody.split('\n');
  let current = null;
  for (const line of lines) {
    const h = line.match(headingRe);
    if (h) {
      if (current) blocks.push(current);
      current = { label: `Wave ${h[1]}`, num: parseInt(h[1], 10), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

// Find the "Depends on:" reference inside a wave block. Returns array of wave-nums.
// Recognizes patterns like:
//   **Depends on:** Wave 1, Wave 2
//   Depends on: none
//   Dependencies: Wave 1
function extractWaveDependencies(block) {
  const text = block.lines.join('\n');
  const depRe = /\b(?:depends\s+on|dependencies)\s*:\*?\*?\s*([^\n]*)/i;
  const m = text.match(depRe);
  if (!m) return [];
  const rest = m[1].trim();
  if (!rest || /^(none|keine|—|-)$/i.test(rest)) return [];
  const nums = [];
  const numRe = /\bwave\s+(\d+)\b/gi;
  let nm;
  while ((nm = numRe.exec(rest)) !== null) {
    nums.push(parseInt(nm[1], 10));
  }
  return nums;
}

// DAG cycle detection via DFS. Returns null if acyclic, or {cycle: [n1,n2,...,n1]} if cyclic.
function detectWaveCycles(waveNums, depsByNum) {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map(waveNums.map((n) => [n, WHITE]));
  const parent = new Map();
  let cycleFound = null;

  function dfs(u) {
    color.set(u, GRAY);
    const deps = depsByNum.get(u) || [];
    for (const v of deps) {
      if (!color.has(v)) continue; // unknown wave — separate check elsewhere
      if (color.get(v) === GRAY) {
        // back-edge: reconstruct cycle u → ... → v → u
        const cyc = [u];
        let p = parent.get(u);
        while (p !== undefined && p !== v) {
          cyc.unshift(p);
          p = parent.get(p);
        }
        cyc.unshift(v);
        cyc.push(v);
        cycleFound = cyc;
        return true;
      }
      if (color.get(v) === WHITE) {
        parent.set(v, u);
        if (dfs(v)) return true;
      }
    }
    color.set(u, BLACK);
    return false;
  }

  for (const n of waveNums) {
    if (color.get(n) === WHITE) {
      if (dfs(n)) break;
    }
  }
  return cycleFound;
}

function runChecklistChecks(slug, feature, paths) {
  const checks = [];
  const errors = [];

  // --- Load files (with graceful fallback on missing) ---
  let spec = null;
  let plan = null;

  if (!fs.existsSync(paths.specAbs)) {
    errors.push(`spec not found: ${paths.specRel}`);
  } else {
    try {
      spec = readMd(paths.specAbs);
    } catch (e) {
      errors.push(`spec frontmatter parse error: ${e.message}`);
    }
  }

  if (errors.length > 0) {
    return { checks, errors, fatal: true };
  }

  const planExists = fs.existsSync(paths.planAbs);
  if (planExists) {
    try {
      plan = readMd(paths.planAbs);
    } catch (e) {
      errors.push(`wave-plan frontmatter parse error: ${e.message}`);
      return { checks, errors, fatal: true };
    }
  }

  // --- Check 1: spec status = clarified (BLOCKER) ---
  {
    const status = spec.fm.status || null;
    const ok = status === 'clarified';
    checks.push({
      id: 1,
      name: 'spec_status_clarified',
      severity: 'BLOCKER',
      result: ok ? 'PASS' : 'FAIL',
      detail: ok
        ? `Spec status is "clarified".`
        : `Spec status is "${status || '(missing)'}", expected "clarified".`,
    });
  }

  // --- Check 2: wave-plan exists (BLOCKER) ---
  {
    checks.push({
      id: 2,
      name: 'wave_plan_exists',
      severity: 'BLOCKER',
      result: planExists ? 'PASS' : 'FAIL',
      detail: planExists
        ? `Wave-plan present at ${paths.planRel}.`
        : `Wave-plan missing: expected ${paths.planRel}.`,
    });
  }

  // Without a plan, the remaining body-checks cannot run; mark them N/A as FAIL/PASS conservatively.
  if (!planExists) {
    checks.push({
      id: 3,
      name: 'waves_have_suggested_agents',
      severity: 'MAJOR',
      result: 'FAIL',
      detail: 'Skipped: no wave-plan to inspect.',
    });
    checks.push({
      id: 4,
      name: 'wave_dependencies_dag',
      severity: 'BLOCKER',
      result: 'FAIL',
      detail: 'Skipped: no wave-plan to inspect.',
    });
    checks.push({
      id: 5,
      name: 'waves_have_stories_advanced',
      severity: 'MAJOR',
      result: 'FAIL',
      detail: 'Skipped: no wave-plan to inspect.',
    });
    checks.push({
      id: 6,
      name: 'project_claudemd_exists',
      severity: 'MINOR',
      result: fs.existsSync(paths.claudemdAbs) ? 'PASS' : 'FAIL',
      detail: fs.existsSync(paths.claudemdAbs)
        ? `Project CLAUDE.md found at ${paths.claudemdRel}.`
        : `Project CLAUDE.md missing at ${paths.claudemdRel}.`,
    });
    checks.push({
      id: 7,
      name: 'plans_directory_convention',
      severity: 'MINOR',
      result: 'FAIL',
      detail: 'Skipped: no plans/ directory or no wave-plan present.',
    });
    checks.push({
      id: 8,
      name: 'plan_frontmatter_complete',
      severity: 'MAJOR',
      result: 'FAIL',
      detail: 'Skipped: no wave-plan to inspect.',
    });
    return { checks, errors, fatal: false };
  }

  // --- Body-driven checks: parse waves once ---
  const waveBlocks = extractWaveBlocks(plan.body);

  // --- Check 3: every wave has "Suggested agent(s):" (MAJOR) ---
  {
    const agentRe = /\bsuggested\s+agent\(?s\)?\s*:/i;
    const missing = waveBlocks
      .filter((b) => !agentRe.test(b.lines.join('\n')))
      .map((b) => b.label);
    const ok = waveBlocks.length > 0 && missing.length === 0;
    checks.push({
      id: 3,
      name: 'waves_have_suggested_agents',
      severity: 'MAJOR',
      result: ok ? 'PASS' : 'FAIL',
      detail:
        waveBlocks.length === 0
          ? 'No "## Wave N" headings found in plan body.'
          : ok
          ? `All ${waveBlocks.length} waves declare Suggested agent(s).`
          : `Waves missing Suggested agent(s): ${missing.join(', ')}.`,
    });
  }

  // --- Check 4: dependencies form a DAG (BLOCKER) ---
  {
    const nums = waveBlocks.map((b) => b.num);
    const depsByNum = new Map();
    for (const b of waveBlocks) depsByNum.set(b.num, extractWaveDependencies(b));
    const cycle = waveBlocks.length > 0 ? detectWaveCycles(nums, depsByNum) : null;
    checks.push({
      id: 4,
      name: 'wave_dependencies_dag',
      severity: 'BLOCKER',
      result: cycle ? 'FAIL' : 'PASS',
      detail: cycle
        ? `Dependency cycle detected: ${cycle.map((n) => `Wave ${n}`).join(' → ')}.`
        : `No cycles in wave dependencies (${nums.length} waves inspected).`,
    });
  }

  // --- Check 5: every wave has "**Stories advanced:**" (MAJOR) ---
  {
    const storiesRe = /\*\*\s*stories\s+advanced\s*:?\s*\*\*/i;
    const missing = waveBlocks
      .filter((b) => !storiesRe.test(b.lines.join('\n')))
      .map((b) => b.label);
    const ok = waveBlocks.length > 0 && missing.length === 0;
    checks.push({
      id: 5,
      name: 'waves_have_stories_advanced',
      severity: 'MAJOR',
      result: ok ? 'PASS' : 'FAIL',
      detail:
        waveBlocks.length === 0
          ? 'No "## Wave N" headings found in plan body.'
          : ok
          ? `All ${waveBlocks.length} waves reference Stories advanced.`
          : `Waves missing "**Stories advanced:**": ${missing.join(', ')}.`,
    });
  }

  // --- Check 6: project CLAUDE.md exists (MINOR) ---
  {
    const ok = fs.existsSync(paths.claudemdAbs);
    checks.push({
      id: 6,
      name: 'project_claudemd_exists',
      severity: 'MINOR',
      result: ok ? 'PASS' : 'FAIL',
      detail: ok
        ? `Project CLAUDE.md found at ${paths.claudemdRel}.`
        : `Project CLAUDE.md missing at ${paths.claudemdRel}.`,
    });
  }

  // --- Check 7: plans/ directory convention (MINOR) ---
  //
  // The expected wave-plan lives under projects/<slug>/plans/. Stray plan files
  // outside that directory (e.g. under projects/<slug>/ root) are a smell.
  {
    const projectRoot = path.join(vaultRoot(), 'projects', slug);
    const strays = [];
    if (fs.existsSync(projectRoot)) {
      try {
        const entries = fs.readdirSync(projectRoot);
        for (const e of entries) {
          if (/wave-plan\.md$/i.test(e)) {
            strays.push(`projects/${slug}/${e}`);
          }
        }
      } catch (_) {
        // ignore
      }
    }
    const dirOk = fs.existsSync(paths.plansDirAbs);
    const ok = dirOk && strays.length === 0;
    let detail;
    if (!dirOk) {
      detail = `Expected directory missing: ${paths.plansDirRel}/.`;
    } else if (strays.length > 0) {
      detail = `Stray wave-plan(s) outside plans/: ${strays.join(', ')}.`;
    } else {
      detail = `plans/ directory present, no stray wave-plans.`;
    }
    checks.push({
      id: 7,
      name: 'plans_directory_convention',
      severity: 'MINOR',
      result: ok ? 'PASS' : 'FAIL',
      detail,
    });
  }

  // --- Check 8: plan frontmatter has all required fields (MAJOR) ---
  {
    const missing = CHECKLIST_REQUIRED_PLAN_FM_FIELDS.filter((k) => {
      const v = plan.fm[k];
      if (v === undefined || v === null) return true;
      if (typeof v === 'string' && v.trim() === '') return true;
      if (Array.isArray(v) && v.length === 0) return true;
      return false;
    });
    const ok = missing.length === 0;
    checks.push({
      id: 8,
      name: 'plan_frontmatter_complete',
      severity: 'MAJOR',
      result: ok ? 'PASS' : 'FAIL',
      detail: ok
        ? `All required frontmatter fields present: ${CHECKLIST_REQUIRED_PLAN_FM_FIELDS.join(', ')}.`
        : `Plan frontmatter missing/empty fields: ${missing.join(', ')}.`,
    });
  }

  return { checks, errors, fatal: false };
}

function classifyChecklistResult(checks) {
  let blockers = 0,
    majors = 0,
    minors = 0;
  for (const c of checks) {
    if (c.result !== 'FAIL') continue;
    if (c.severity === 'BLOCKER') blockers++;
    else if (c.severity === 'MAJOR') majors++;
    else if (c.severity === 'MINOR') minors++;
  }
  let status, exit_code;
  if (blockers > 0) {
    status = 'FAIL';
    exit_code = 1;
  } else if (majors > 0 || minors > 0) {
    status = 'PASS_WITH_WARNINGS';
    exit_code = 0;
  } else {
    status = 'PASS';
    exit_code = 0;
  }
  return { status, exit_code, summary: { blockers, majors, minors } };
}

function formatChecklistHumanReport(report) {
  const lines = [];
  const label =
    report.status === 'PASS'
      ? 'PASS'
      : report.status === 'PASS_WITH_WARNINGS'
      ? 'PASS (mit Hinweisen)'
      : report.status === 'FAIL'
      ? 'FAIL'
      : 'ERROR';
  lines.push(`Pre-Flight Checkliste: ${label}`);
  lines.push('');
  lines.push(`Feature: ${report.feature} (Projekt: ${report.project})`);
  lines.push('');

  if (report.status === 'ERROR') {
    lines.push('Setup-Fehler:');
    for (const err of report.errors || []) lines.push(`  - ${err}`);
    lines.push('');
    lines.push('Empfehlung:');
    lines.push('  Pfade pruefen, fehlende Dateien anlegen oder Frontmatter reparieren.');
    return lines.join('\n');
  }

  const tick = (r) => (r === 'PASS' ? '[ok]' : '[x]');
  const sevTag = { BLOCKER: '[BLOCKER]', MAJOR: '[MAJOR]', MINOR: '[MINOR]' };
  lines.push('Pruefungen:');
  for (const c of report.checks) {
    lines.push(`  ${tick(c.result)} ${sevTag[c.severity]} ${c.name}`);
    lines.push(`        ${c.detail}`);
  }
  lines.push('');

  const s = report.summary;
  lines.push(
    `Befund: ${s.blockers} BLOCKER, ${s.majors} MAJOR, ${s.minors} MINOR offen.`
  );

  if (report.status === 'PASS') {
    lines.push('');
    lines.push('Empfehlung: Implementation kann starten.');
  } else if (report.status === 'PASS_WITH_WARNINGS') {
    lines.push('');
    lines.push(
      'Empfehlung: Implementation moeglich, aber MAJOR/MINOR Punkte vor Start adressieren.'
    );
  } else {
    lines.push('');
    lines.push('Empfehlung: BLOCKER beheben — Plan ist nicht implementierungsbereit.');
  }
  return lines.join('\n');
}

function cmdChecklistRun(args) {
  // Parse: <target> [--format json|human] [--save] [--vault <path>]
  const target = args[0];
  if (!target || target.startsWith('--')) {
    usage('checklist run requires <project-slug> or <project-slug>/<feature-id>');
  }
  const flags = parseFlags(args.slice(1), {
    format: 'value',
    save: 'bool',
    vault: 'value',
  });
  const format = flags.format || 'json';
  if (format !== 'json' && format !== 'human') {
    usage(`checklist run --format must be "json" or "human" (got: ${format})`);
  }
  if (flags.vault) process.env.A1_VAULT_ROOT = flags.vault;

  let slug, feature;
  try {
    const resolved = resolveChecklistTarget(target);
    slug = resolved.slug;
    feature = resolved.feature;
  } catch (e) {
    const report = {
      status: 'ERROR',
      exit_code: 2,
      project: target.split('/')[0] || null,
      feature: null,
      paths: {},
      checks: [],
      summary: { blockers: 0, majors: 0, minors: 0 },
      errors: [e.message],
    };
    emitChecklistReport(report, format);
    return;
  }

  const paths = checklistPaths(slug, feature);
  const { checks, errors, fatal } = runChecklistChecks(slug, feature, paths);

  if (fatal) {
    const report = {
      status: 'ERROR',
      exit_code: 2,
      project: slug,
      feature,
      paths: {
        spec: paths.specRel,
        plan: paths.planRel,
        claudemd: paths.claudemdRel,
      },
      checks: [],
      summary: { blockers: 0, majors: 0, minors: 0 },
      errors,
    };
    emitChecklistReport(report, format);
    return;
  }

  const classified = classifyChecklistResult(checks);
  const report = {
    status: classified.status,
    exit_code: classified.exit_code,
    project: slug,
    feature,
    paths: {
      spec: paths.specRel,
      plan: paths.planRel,
      claudemd: paths.claudemdRel,
    },
    checks,
    summary: classified.summary,
    errors: [],
  };

  if (flags.save) {
    try {
      if (!fs.existsSync(paths.checklistDirAbs)) {
        fs.mkdirSync(paths.checklistDirAbs, { recursive: true });
      }
      const date = new Date().toISOString().slice(0, 10);
      const num = feature.match(/^(\d{3,})/);
      const numStr = num ? num[1] : '000';
      const out = path.join(paths.checklistDirAbs, `${numStr}-${date}.md`);
      const body = `---\ntype: checklist-report\nproject: ${slug}\nfeature: ${feature}\nstatus: ${report.status}\ncreated: ${date}\n---\n\n${formatChecklistHumanReport(report)}\n\n## JSON\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
      const tmp = `${out}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, out);
      report.saved_to = `projects/${slug}/checklist/${numStr}-${date}.md`;
    } catch (e) {
      report.errors.push(`save failed: ${e.message}`);
    }
  }

  emitChecklistReport(report, format);
}

function emitChecklistReport(report, format) {
  if (format === 'human') {
    process.stdout.write(formatChecklistHumanReport(report) + '\n');
  } else {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
  process.exit(report.exit_code);
}

function cmdChecklistList(args) {
  const slug = args[0];
  if (!slug || slug.startsWith('--')) {
    usage('checklist list requires <project-slug>');
  }
  const flags = parseFlags(args.slice(1), { vault: 'value' });
  if (flags.vault) process.env.A1_VAULT_ROOT = flags.vault;
  const dir = path.join(vaultRoot(), 'projects', slug, 'checklist');
  if (!fs.existsSync(dir)) {
    return { project: slug, reports: [] };
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.md$/.test(f))
    .sort()
    .reverse();
  const reports = files.map((f) => {
    const abs = path.join(dir, f);
    let fm = {};
    try {
      const parsed = readMd(abs);
      fm = parsed.fm || {};
    } catch (_) {}
    return {
      file: `projects/${slug}/checklist/${f}`,
      feature: fm.feature || null,
      status: fm.status || null,
      created: fm.created || null,
    };
  });
  return { project: slug, reports };
}

// ---------- worktree subcommands ----------

// worktree registry + git helpers live in lib/worktree-registry.cjs
const {
  WORKTREE_STATUSES,
  WORKTREE_EXIT_MODES,
  SLUG_RE,
  worktreeRegistryPath,
  readRegistry,
  writeRegistryAtomic,
  nowCompactId,
  git,
  gitIsRepo,
  gitWorkingTreeClean,
  gitBranchExists,
  gitWorktreeList,
  gitBranchHasWorktree,
  findRegistryEntry,
  findActiveBySlug,
  repoParentWorktreeDir,
  prReviewDir,
  ensurePrReviewDir,
  readFindings,
  findEntryBySlugOrId,
} = require(path.join(__dirname, 'lib', 'worktree-registry.cjs'));

function cmdWorktreePrepare(args) {
  const flags = parseFlags(args, {
    branch: 'string',
    base: 'string',
    'force-reset': 'bool',
  });
  const [repoRootRaw, slug] = flags._;
  if (!repoRootRaw) usage('worktree prepare requires <repo-root>');
  if (!slug) usage('worktree prepare requires <slug>');
  const repoRoot = path.resolve(repoRootRaw);
  const branch = flags.branch || `feature/${slug}`;
  const baseBranch = flags.base || 'main';

  const checks = [];
  const fail = (name, hint) => checks.push({ name, result: 'FAIL', hint });
  const pass = (name) => checks.push({ name, result: 'PASS' });

  // 1. slug valid
  if (!SLUG_RE.test(slug)) {
    process.stderr.write(`error: invalid slug "${slug}" (must match ${SLUG_RE})\n`);
    process.exit(2);
  }
  pass('slug_valid');

  // 2. repo exists & is git
  if (!gitIsRepo(repoRoot)) {
    process.stderr.write(`error: ${repoRoot} is not a git repository\n`);
    process.exit(2);
  }
  pass('repo_is_git');

  // 3. working tree clean
  if (gitWorkingTreeClean(repoRoot)) pass('working_tree_clean');
  else fail('working_tree_clean', 'Working tree has uncommitted changes');

  // 4. base branch exists
  if (gitBranchExists(repoRoot, baseBranch)) pass('base_branch_exists');
  else fail('base_branch_exists', `Base branch "${baseBranch}" does not exist`);

  // 5. target branch free OR not in worktree
  if (gitBranchExists(repoRoot, branch)) {
    if (gitBranchHasWorktree(repoRoot, branch)) {
      fail('target_branch_free', `Branch "${branch}" already has a worktree`);
    } else {
      // branch exists but no worktree — acceptable, we'll attach to it
      pass('target_branch_free');
    }
  } else {
    pass('target_branch_free');
  }

  // 6. worktree path free
  const worktreePath = path.join(repoParentWorktreeDir(repoRoot), slug);
  if (fs.existsSync(worktreePath)) {
    fail('worktree_path_free', `Path ${worktreePath} already exists`);
  } else {
    pass('worktree_path_free');
  }

  // 7. no active registry entry
  const reg = readRegistry();
  const existing = findActiveBySlug(reg, repoRoot, slug);
  if (existing && !flags['force-reset']) {
    fail(
      'no_active_registry_entry',
      `Registry already has active entry ${existing.id} (status=${existing.status}) for this repo+slug`
    );
  } else {
    pass('no_active_registry_entry');
  }

  const blocker = checks.some((c) => c.result === 'FAIL');
  if (blocker) {
    process.stdout.write(JSON.stringify({ status: 'BLOCKER', checks }, null, 2) + '\n');
    process.exit(1);
  }

  // All green — write registry entry
  const id = nowCompactId(slug);
  const entry = {
    id,
    slug,
    repo_root: repoRoot,
    worktree_path: worktreePath,
    branch,
    base_branch: baseBranch,
    status: 'prepared',
    created_at: nowIso(),
    last_status_change: nowIso(),
    agent_brief: null,
    commit_count: 0,
    exit_mode: null,
    phase_history: [`phase=prepare completed=${nowIso()}`],
  };

  // If force-reset, drop the old active entry
  if (flags['force-reset'] && existing) {
    reg.worktrees = reg.worktrees.filter((w) => w.id !== existing.id);
  }
  reg.worktrees.push(entry);
  writeRegistryAtomic(reg);

  return {
    id,
    repo_root: repoRoot,
    worktree_path: worktreePath,
    branch,
    base_branch: baseBranch,
    status: 'prepared',
    checks,
  };
}

function cmdWorktreeEnter(args) {
  const flags = parseFlags(args, {});
  const id = flags._[0];
  if (!id) usage('worktree enter requires <id>');
  const reg = readRegistry();
  const entry = findRegistryEntry(reg, id);
  if (!entry) {
    process.stderr.write(`error: no registry entry with id "${id}"\n`);
    process.exit(1);
  }
  if (entry.status !== 'prepared') {
    process.stderr.write(`error: entry ${id} has status "${entry.status}", expected "prepared"\n`);
    process.exit(1);
  }
  // race-safety: path still free?
  if (fs.existsSync(entry.worktree_path)) {
    process.stderr.write(`error: worktree path ${entry.worktree_path} appeared since prepare\n`);
    process.exit(1);
  }

  // ensure parent dir exists
  fs.mkdirSync(path.dirname(entry.worktree_path), { recursive: true });

  // git worktree add: -b only if branch does not yet exist
  const branchExists = gitBranchExists(entry.repo_root, entry.branch);
  const gitArgs = branchExists
    ? ['worktree', 'add', entry.worktree_path, entry.branch]
    : ['worktree', 'add', '-b', entry.branch, entry.worktree_path, entry.base_branch];

  const res = git(entry.repo_root, gitArgs, { allowFail: true });
  if (res && typeof res === 'object' && res.__error) {
    process.stderr.write(`error: git worktree add failed: ${res.__error}\n`);
    process.exit(1);
  }

  entry.status = 'active';
  entry.last_status_change = nowIso();
  entry.phase_history.push(`phase=enter completed=${nowIso()}`);
  writeRegistryAtomic(reg);

  return {
    id,
    worktree_path: entry.worktree_path,
    branch: entry.branch,
    status: 'active',
  };
}

function cmdWorktreeStatus(args) {
  const flags = parseFlags(args, {});
  const id = flags._[0];
  if (!id) usage('worktree status requires <id>');
  const reg = readRegistry();
  const entry = findRegistryEntry(reg, id);
  if (!entry) {
    process.stderr.write(`error: no registry entry with id "${id}"\n`);
    process.exit(1);
  }

  const result = {
    id: entry.id,
    slug: entry.slug,
    repo_root: entry.repo_root,
    worktree_path: entry.worktree_path,
    branch: entry.branch,
    base_branch: entry.base_branch,
    status: entry.status,
    worktree_exists_on_disk: fs.existsSync(entry.worktree_path),
    has_uncommitted: null,
    commit_count: null,
    branch_ahead: null,
    branch_behind: null,
  };

  if (result.worktree_exists_on_disk && entry.status === 'active') {
    const status = git(entry.worktree_path, ['status', '--porcelain'], { allowFail: true });
    result.has_uncommitted = typeof status === 'string' ? status.length > 0 : null;

    const range = `${entry.base_branch}..${entry.branch}`;
    const aheadOut = git(entry.repo_root, ['rev-list', '--count', range], { allowFail: true });
    if (typeof aheadOut === 'string') {
      const n = parseInt(aheadOut, 10);
      result.branch_ahead = Number.isNaN(n) ? null : n;
      result.commit_count = result.branch_ahead;
    }
    const behindOut = git(entry.repo_root, ['rev-list', '--count', `${entry.branch}..${entry.base_branch}`], {
      allowFail: true,
    });
    if (typeof behindOut === 'string') {
      const n = parseInt(behindOut, 10);
      result.branch_behind = Number.isNaN(n) ? null : n;
    }
  }

  return result;
}

function cmdWorktreeExit(args) {
  const flags = parseFlags(args, {
    mode: 'string',
    'force-discard': 'bool',
  });
  const id = flags._[0];
  if (!id) usage('worktree exit requires <id>');
  if (!flags.mode) usage('worktree exit requires --mode <keep|discard|handoff>');
  if (!WORKTREE_EXIT_MODES.has(flags.mode)) {
    usage(`invalid --mode "${flags.mode}", expected one of: ${[...WORKTREE_EXIT_MODES].join(', ')}`);
  }
  const mode = flags.mode;

  const reg = readRegistry();
  const entry = findRegistryEntry(reg, id);
  if (!entry) {
    process.stderr.write(`error: no registry entry with id "${id}"\n`);
    process.exit(1);
  }
  if (entry.status === 'cleaned') {
    process.stderr.write(`error: entry ${id} is already cleaned\n`);
    process.exit(1);
  }

  let removed = false;
  let branchKept = true;

  if (mode === 'handoff') {
    entry.status = 'handoff';
    entry.exit_mode = 'handoff';
    entry.last_status_change = nowIso();
    entry.phase_history.push(`phase=exit-handoff completed=${nowIso()}`);
    writeRegistryAtomic(reg);
    return {
      id,
      exit_mode: 'handoff',
      status: 'handoff',
      removed: false,
      branch_kept: true,
    };
  }

  // For keep / discard, we need to remove the worktree.
  // For discard, also check unmerged commits unless --force-discard.
  if (mode === 'discard' && !flags['force-discard']) {
    if (gitBranchExists(entry.repo_root, entry.branch)) {
      const aheadOut = git(entry.repo_root, ['rev-list', '--count', `${entry.base_branch}..${entry.branch}`], {
        allowFail: true,
      });
      const ahead = typeof aheadOut === 'string' ? parseInt(aheadOut, 10) : 0;
      if (ahead > 0) {
        process.stderr.write(
          `error: branch "${entry.branch}" is ${ahead} commit(s) ahead of "${entry.base_branch}". ` +
            `Refusing discard. Re-run with --force-discard, or use --mode handoff.\n`
        );
        process.exit(1);
      }
    }
  }

  // Remove worktree (if it exists on disk)
  if (fs.existsSync(entry.worktree_path)) {
    const removeArgs = ['worktree', 'remove'];
    if (mode === 'discard' && flags['force-discard']) removeArgs.push('--force');
    removeArgs.push(entry.worktree_path);
    const res = git(entry.repo_root, removeArgs, { allowFail: true });
    if (res && typeof res === 'object' && res.__error) {
      process.stderr.write(`error: git worktree remove failed: ${res.__error}\n`);
      process.exit(1);
    }
    removed = true;
  } else {
    // Prune stale registration in git if any
    git(entry.repo_root, ['worktree', 'prune'], { allowFail: true });
    removed = true;
  }

  if (mode === 'discard') {
    if (gitBranchExists(entry.repo_root, entry.branch)) {
      const delArgs = ['branch', flags['force-discard'] ? '-D' : '-d', entry.branch];
      const res = git(entry.repo_root, delArgs, { allowFail: true });
      if (res && typeof res === 'object' && res.__error) {
        process.stderr.write(`error: git branch delete failed: ${res.__error}\n`);
        process.exit(1);
      }
      branchKept = false;
    } else {
      branchKept = false;
    }
  }

  entry.status = 'cleaned';
  entry.exit_mode = mode;
  entry.last_status_change = nowIso();
  entry.phase_history.push(`phase=exit-${mode} completed=${nowIso()}`);
  writeRegistryAtomic(reg);

  return {
    id,
    exit_mode: mode,
    status: 'cleaned',
    removed,
    branch_kept: branchKept,
  };
}

function cmdWorktreeList(args) {
  const flags = parseFlags(args, {
    status: 'string',
    'repo-root': 'string',
  });
  const reg = readRegistry();
  let entries = reg.worktrees.slice();
  if (flags.status) {
    if (!WORKTREE_STATUSES.has(flags.status)) {
      usage(`invalid --status "${flags.status}", expected one of: ${[...WORKTREE_STATUSES].join(', ')}`);
    }
    entries = entries.filter((e) => e.status === flags.status);
  }
  if (flags['repo-root']) {
    const abs = path.resolve(flags['repo-root']);
    entries = entries.filter((e) => e.repo_root === abs);
  }
  entries.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return {
    count: entries.length,
    worktrees: entries.map((e) => ({
      id: e.id,
      slug: e.slug,
      status: e.status,
      branch: e.branch,
      base_branch: e.base_branch,
      repo_root: e.repo_root,
      worktree_path: e.worktree_path,
      created_at: e.created_at,
      exit_mode: e.exit_mode,
    })),
  };
}

function cmdWorktreeGc(args) {
  const flags = parseFlags(args, { 'dry-run': 'bool' });
  const reg = readRegistry();
  const stale = [];
  const removedFromRegistry = [];

  for (const e of reg.worktrees) {
    if (e.status === 'cleaned') continue;
    if (!fs.existsSync(e.worktree_path) && e.status !== 'handoff') {
      stale.push({ id: e.id, reason: 'worktree path missing', path: e.worktree_path });
      if (!flags['dry-run']) {
        e.status = 'cleaned';
        e.exit_mode = e.exit_mode || 'gc';
        e.last_status_change = nowIso();
        e.phase_history.push(`phase=gc completed=${nowIso()}`);
        removedFromRegistry.push(e.id);
      }
    }
  }

  if (!flags['dry-run'] && removedFromRegistry.length > 0) writeRegistryAtomic(reg);

  return {
    count: stale.length,
    stale,
    removed: removedFromRegistry,
    dry_run: !!flags['dry-run'],
  };
}

function resolveRealOrAbs(p) {
  // git worktree list --porcelain prints realpaths (symlinks resolved, e.g.
  // macOS /tmp -> /private/tmp). path.resolve() alone does not resolve
  // symlinks, so comparing a raw CLI arg against git's output can spuriously
  // mismatch. Prefer the realpath when the path exists on disk; fall back to
  // plain resolve otherwise (path may legitimately not exist yet).
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch (_e) {
    return abs;
  }
}

function cmdWorktreeAdopt(args) {
  const flags = parseFlags(args, { 'worktree-path': 'string', branch: 'string', base: 'string' });
  const [repoRootRaw, slug] = flags._;
  if (!repoRootRaw || !slug) usage('worktree adopt requires <repo-root> <slug>');

  if (!SLUG_RE.test(slug)) {
    process.stderr.write(`error: invalid slug "${slug}" (must match ${SLUG_RE})\n`);
    process.exit(2);
  }

  const repoRoot = path.resolve(repoRootRaw);
  if (!gitIsRepo(repoRoot)) {
    process.stderr.write(`error: ${repoRoot} is not a git repository\n`);
    process.exit(2);
  }
  const repoRootReal = resolveRealOrAbs(repoRootRaw);

  const wts = gitWorktreeList(repoRoot).filter((w) => path.resolve(w.path) !== repoRootReal);

  let matches;
  if (flags['worktree-path']) {
    const target = resolveRealOrAbs(flags['worktree-path']);
    matches = wts.filter((w) => path.resolve(w.path) === target);
  } else if (flags.branch) {
    matches = wts.filter((w) => w.branch === flags.branch);
  } else {
    matches = wts.filter((w) => path.basename(w.path) === slug);
  }

  if (matches.length === 0) {
    process.stderr.write('error: no git worktree matches; candidates:\n');
    process.stdout.write(JSON.stringify({ status: 'NOT_FOUND', candidates: wts }, null, 2) + '\n');
    process.exit(1);
  }
  if (matches.length > 1) {
    process.stderr.write('error: multiple git worktrees match — pass --worktree-path to disambiguate\n');
    process.stdout.write(JSON.stringify({ status: 'AMBIGUOUS', candidates: wts }, null, 2) + '\n');
    process.exit(1);
  }
  const match = matches[0];

  const reg = readRegistry();
  const existingActive = findActiveBySlug(reg, repoRoot, slug);
  if (existingActive) {
    process.stderr.write(
      `error: registry already has active entry ${existingActive.id} for this repo+slug — nothing to adopt\n`
    );
    process.exit(1);
  }
  const resolvedMatchPath = path.resolve(match.path);
  const existingPath = reg.worktrees.find(
    (w) =>
      w.status !== 'cleaned' &&
      resolveRealOrAbs(w.worktree_path) === resolveRealOrAbs(resolvedMatchPath)
  );
  if (existingPath) {
    process.stderr.write(`error: worktree path already registered as ${existingPath.id}\n`);
    process.exit(1);
  }

  const branch = match.branch || flags.branch || null;
  const baseBranch = flags.base || 'main';
  const id = nowCompactId(slug);
  const commitCountRaw = branch
    ? git(repoRoot, ['rev-list', '--count', `${baseBranch}..${branch}`], { allowFail: true })
    : null;
  const commitCount =
    typeof commitCountRaw === 'string' && commitCountRaw.length > 0 ? parseInt(commitCountRaw, 10) : 0;

  const entry = {
    id,
    slug,
    repo_root: repoRoot,
    worktree_path: resolvedMatchPath,
    branch,
    base_branch: baseBranch,
    status: 'active',
    created_at: nowIso(),
    last_status_change: nowIso(),
    agent_brief: null,
    commit_count: commitCount,
    exit_mode: null,
    phase_history: [`phase=adopt completed=${nowIso()}`],
  };

  reg.worktrees.push(entry);
  writeRegistryAtomic(reg);

  return {
    id,
    slug,
    repo_root: repoRoot,
    worktree_path: resolvedMatchPath,
    branch,
    base_branch: baseBranch,
    status: 'active',
    commit_count: commitCount,
    adopted: true,
  };
}

function cmdWorktreeReconcile(args) {
  const flags = parseFlags(args, { prune: 'bool' });
  const [repoRootRaw] = flags._;
  if (!repoRootRaw) usage('worktree reconcile requires <repo-root>');

  const repoRoot = path.resolve(repoRootRaw);
  if (!gitIsRepo(repoRoot)) {
    process.stderr.write(`error: ${repoRoot} is not a git repository\n`);
    process.exit(2);
  }
  const repoRootReal = resolveRealOrAbs(repoRootRaw);

  const gitWts = gitWorktreeList(repoRoot).filter((w) => path.resolve(w.path) !== repoRootReal);
  const reg = readRegistry();

  // Direction A (registry -> disk): registry entries with no matching git
  // worktree AND no path on disk are stale (orphaned registrations).
  const stale = [];
  const pruned = [];
  for (const e of reg.worktrees) {
    if (e.repo_root !== repoRoot || e.status === 'cleaned') continue;
    const entryPathReal = resolveRealOrAbs(e.worktree_path);
    const hasGitMatch = gitWts.some((w) => path.resolve(w.path) === entryPathReal);
    if (hasGitMatch || fs.existsSync(e.worktree_path)) continue;
    stale.push({
      id: e.id,
      slug: e.slug,
      path: e.worktree_path,
      reason: 'registry entry has no git worktree and path missing on disk',
    });
    if (flags.prune) {
      e.status = 'cleaned';
      e.exit_mode = e.exit_mode || 'reconcile';
      e.last_status_change = nowIso();
      e.phase_history.push(`phase=reconcile completed=${nowIso()}`);
      pruned.push(e.id);
    }
  }

  // Direction B (disk -> registry): git worktrees with no non-cleaned
  // registry entry are adopt candidates.
  const adoptCandidates = [];
  for (const w of gitWts) {
    const wPathReal = resolveRealOrAbs(w.path);
    const hasRegMatch = reg.worktrees.some(
      (e) => e.status !== 'cleaned' && resolveRealOrAbs(e.worktree_path) === wPathReal
    );
    if (hasRegMatch) continue;
    adoptCandidates.push({
      path: w.path,
      branch: w.branch || null,
      hint: `a1-tools worktree adopt ${repoRoot} <slug> --worktree-path ${w.path}`,
    });
  }

  if (flags.prune && pruned.length > 0) writeRegistryAtomic(reg);

  return {
    repo_root: repoRoot,
    in_sync: stale.length === 0 && adoptCandidates.length === 0,
    stale,
    pruned,
    adopt_candidates: adoptCandidates,
    prune: !!flags.prune,
  };
}

// ---------- entry point ----------

// ---------------------------------------------------------------------------
// pr — a1-pr-review CLI helpers (registry filter, findings summary, status)
// ---------------------------------------------------------------------------

// prReviewDir, ensurePrReviewDir, readFindings, findEntryBySlugOrId live in lib/worktree-registry.cjs

const PR_STATUSES = new Set([
  'handoff',
  'in-review',
  'reviewed',
  'pr-open',
]);

function cmdPrListHandoff(args) {
  const flags = parseFlags(args, { 'repo-root': 'string' });
  const reg = readRegistry();
  let entries = reg.worktrees.filter((w) => w.status === 'handoff');
  if (flags['repo-root']) {
    entries = entries.filter((w) => w.repo_root === flags['repo-root']);
  }
  return {
    count: entries.length,
    entries: entries.map((w) => ({
      id: w.id,
      slug: w.slug,
      repo_root: w.repo_root,
      worktree_path: w.worktree_path,
      branch: w.branch,
      created_at: w.created_at,
      base: w.base || 'main',
      last_phase_note:
        Array.isArray(w.phase_history) && w.phase_history.length > 0
          ? w.phase_history[w.phase_history.length - 1]
          : null,
    })),
  };
}

function cmdPrMarkStatus(args) {
  if (args.length < 2) usage('pr mark-status requires <id-or-slug> <new-status>');
  const [slugOrId, newStatus] = args;
  if (!PR_STATUSES.has(newStatus)) {
    fail(`invalid pr status "${newStatus}". valid: ${[...PR_STATUSES].join(', ')}`);
  }
  const reg = readRegistry();
  const entry = findEntryBySlugOrId(reg, slugOrId);
  if (!entry) fail(`no registry entry for "${slugOrId}"`);
  const prev = entry.status;
  entry.status = newStatus;
  if (!Array.isArray(entry.phase_history)) entry.phase_history = [];
  entry.phase_history.push({
    at: nowIso(),
    from: prev,
    to: newStatus,
    by: 'a1-pr-review',
  });
  writeRegistryAtomic(reg);
  return { id: entry.id, slug: entry.slug, status: newStatus, previous: prev };
}

function cmdPrMarkPrOpen(args) {
  if (args.length < 2) usage('pr mark-pr-open requires <id-or-slug> <pr-url>');
  const [slugOrId, prUrl] = args;
  if (!/^https?:\/\//.test(prUrl)) fail(`pr-url must start with http(s)://: ${prUrl}`);
  const reg = readRegistry();
  const entry = findEntryBySlugOrId(reg, slugOrId);
  if (!entry) fail(`no registry entry for "${slugOrId}"`);
  const prev = entry.status;
  entry.status = 'pr-open';
  entry.pr_url = prUrl;
  if (!Array.isArray(entry.phase_history)) entry.phase_history = [];
  entry.phase_history.push({
    at: nowIso(),
    from: prev,
    to: 'pr-open',
    by: 'a1-pr-review',
    pr_url: prUrl,
  });
  writeRegistryAtomic(reg);
  return { id: entry.id, slug: entry.slug, status: 'pr-open', pr_url: prUrl };
}

function formatFindingMd(f) {
  const loc = f.file ? (f.line ? `${f.file}:${f.line}` : f.file) : '(no location)';
  const title = f.title || '(no title)';
  const detail = f.detail ? `\n  > ${String(f.detail).replace(/\n/g, '\n  > ')}` : '';
  return `- **${title}** — \`${loc}\`${detail}`;
}

function formatInlineMinorMd(f) {
  const loc = f.file ? (f.line ? `${f.file}:${f.line}` : f.file) : '(no location)';
  const title = f.title || '(no title)';
  const detail = f.detail ? `: ${f.detail}` : '';
  return `- \`${loc}\` — ${title}${detail}`;
}

function cmdPrFindingsSummary(args) {
  const flags = parseFlags(args, { 'worktree-path': 'string' });
  if (!flags['worktree-path'] && flags._.length < 1) {
    usage('pr findings-summary requires <id-or-slug> or --worktree-path');
  }
  const [slugOrId] = flags._;

  if (flags['worktree-path']) {
    const wtPath = path.resolve(flags['worktree-path']);
    if (!fs.existsSync(wtPath)) fail(`worktree path does not exist: ${wtPath}`);
    const findings = readFindings(wtPath);
    if (!findings) {
      fail(`no findings.json in ${wtPath}/.a1-review/ — run Phase 2 first`);
    }
    const blocker = Array.isArray(findings.blocker) ? findings.blocker : [];
    const major = Array.isArray(findings.major) ? findings.major : [];
    const minor = Array.isArray(findings.minor) ? findings.minor : [];
    return {
      id: null,
      slug: path.basename(wtPath),
      worktree_path: wtPath,
      source: 'direct-path',
      summary: findings.summary || '',
      counts: {
        blocker: blocker.length,
        major: major.length,
        minor: minor.length,
      },
      blocker_md: blocker.map(formatFindingMd).join('\n'),
      major_md: major.map(formatFindingMd).join('\n'),
      inline_minor_md: minor.map(formatInlineMinorMd).join('\n'),
    };
  }

  const reg = readRegistry();
  const entry = findEntryBySlugOrId(reg, slugOrId);
  if (!entry) fail(`no registry entry for "${slugOrId}"`);
  const findings = readFindings(entry.worktree_path);
  if (!findings) {
    fail(`no findings.json in ${entry.worktree_path}/.a1-review/ — run Phase 2 first`);
  }
  const blocker = Array.isArray(findings.blocker) ? findings.blocker : [];
  const major = Array.isArray(findings.major) ? findings.major : [];
  const minor = Array.isArray(findings.minor) ? findings.minor : [];
  return {
    id: entry.id,
    slug: entry.slug,
    worktree_path: entry.worktree_path,
    summary: findings.summary || '',
    counts: {
      blocker: blocker.length,
      major: major.length,
      minor: minor.length,
    },
    blocker_md: blocker.map(formatFindingMd).join('\n'),
    major_md: major.map(formatFindingMd).join('\n'),
    inline_minor_md: minor.map(formatInlineMinorMd).join('\n'),
  };
}

// ---------- modernize subcommands ----------
//
// Brownfield modernization pipeline. Owns master files in the vault under
// projects/<slug>/modernize/<YYYY-MM-DD>-<mode>[-N].md. The CLI handles
// deterministic operations: slot calculation, frontmatter updates, proposal
// management, wave lifecycle, parity snapshot, listing. Sub-agents do the
// thinking in the skill phases.
//
// FMEA-2 (computed parity): snapshot-behavior --manual-smoke stores a sha256
// snapshot_hash of the smoke artifact in parity_baseline. complete-wave then
// requires --replay-file and byte-diffs it against the baseline manual_smoke_doc
// itself — a self-asserted `--snapshot-replay pass` alone is rejected once a
// snapshot_hash exists. Legacy baselines (no hash) keep claim-based behavior.
// FMEA-5 (approval audit trail): update-status / approve-proposal / start-wave
// accept --approved-by <human|harness:reason>. update-status appends it to the
// phase_history entry; approve-proposal/start-wave set approved_by on the object.

function modernizeDir(projectSlug) {
  return path.join(vaultRoot(), 'projects', projectSlug, 'modernize');
}

function cmdModernizeNextSlot(args) {
  const flags = parseFlags(args, { date: 'value' });
  const projectSlug = flags._[0];
  const focus = flags._[1] || 'full';
  if (!projectSlug) {
    usage('modernize next-slot requires <project-slug> [<focus>] [--date YYYY-MM-DD]');
  }
  const date = flags.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage(`invalid date "${date}", expected YYYY-MM-DD`);
  }
  const dir = modernizeDir(projectSlug);
  let used = new Set();
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^${date}-${focus}(-(\\d+))?\\.md$`);
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(re);
      if (m) used.add(m[2] ? parseInt(m[2], 10) : 1);
    }
  }
  let n = 1;
  while (used.has(n)) n++;
  const suffix = n === 1 ? '' : `-${n}`;
  const filename = `${date}-${focus}${suffix}.md`;
  return {
    project: projectSlug,
    focus,
    date,
    suffix,
    filename,
    path: path.join(dir, filename),
    dir,
  };
}

function cmdModernizeInit(args) {
  const flags = parseFlags(args, {
    'project-path': 'value',
    'date': 'value',
    'title': 'value',
  });
  const projectSlug = flags._[0];
  const mode = flags._[1] || 'full';
  if (!projectSlug) {
    usage('modernize init requires <project-slug> <mode> [--project-path /abs] [--date YYYY-MM-DD]');
  }
  if (!MODERNIZE_MODES.has(mode)) {
    usage(`invalid mode "${mode}". valid: ${[...MODERNIZE_MODES].join(', ')}`);
  }
  const slot = cmdModernizeNextSlot([projectSlug, mode, ...(flags.date ? ['--date', flags.date] : [])]);
  const filePath = slot.path;
  if (!fs.existsSync(slot.dir)) fs.mkdirSync(slot.dir, { recursive: true });

  const title = flags.title || `${mode} modernization of ${projectSlug}`;
  const analyzedPath = flags['project-path'] || '';

  const fm = {
    type: 'modernize-uplift',
    project_slug: projectSlug,
    focus: mode,
    mode,
    title,
    status: 'scoped',
    created_at: nowIso(),
    analyzed_path: analyzedPath,
    parity_baseline: ['snapshot_taken_at=null', 'test_count=0', 'manual_smoke_doc=null'],
    phase_history: [`phase=scope completed=${nowIso()}`],
    discover: ['tech_stack=[]', 'loc=0', 'file_count=0', 'test_coverage_pre=null'],
    open_questions: [],
    proposals: [],
    waves: [],
    notion_export: ['page_id=null', 'exported_at=null', 'fallback_path=null'],
    suggested_next: [],
  };

  const body = `# Modernize: ${title}

## Scope

- Project: ${projectSlug}
- Mode: ${mode}
- Analyzed path: ${analyzedPath || '<not set>'}

## Reverse-Spec (Phase 2)

<filled by a1-rafael-reverse-spec>

## Gap Findings (Phase 3)

<filled by reinhard + alex + reconcile>

## Tech Proposals (Phase 4)

<filled by stack-conditional agents>

## Plan (Phase 5)

<filled by a1-pablo-planner>

## Wave Execution (Phase 6)

<filled per wave by a1-erik-executor>

## Report (Phase 7)

<filled on publish>
`;

  writeMdAtomic(filePath, fm, body);
  return {
    path: filePath,
    project: projectSlug,
    mode,
    status: 'scoped',
  };
}

const MODERNIZE_STATUS_TO_PHASE = {
  'scoped': 'scope',
  'spec-drafted': 'reverse-spec',
  'gap-analyzed': 'gap-analysis',
  'proposals-pending': 'tech-proposals',
  'planned': 'plan',
  'executing': 'execute',
  'executed': 'execute-complete',
  'published': 'publish',
  'cancelled': 'cancelled',
};

function cmdModernizeUpdateStatus(args) {
  const masterPathInput = args[0];
  const newStatus = args[1];
  if (!masterPathInput || !newStatus) {
    usage('modernize update-status requires <master-path> <new-status> [--phase-data <json>] [--approved-by <human|harness:reason>]');
  }
  if (!MODERNIZE_STATUSES.has(newStatus)) {
    usage(`invalid modernize status "${newStatus}". valid: ${[...MODERNIZE_STATUSES].join(', ')}`);
  }
  const flags = parseFlags(args.slice(2), { 'phase-data': 'value', 'approved-by': 'value' });
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  fm.status = newStatus;
  const phase = MODERNIZE_STATUS_TO_PHASE[newStatus];
  if (phase) {
    appendPhaseHistory(fm, phase);
    // FMEA-5: audit trail. Auto-approval stays possible but leaves a record —
    // append approved_by=<value> onto the just-written phase_history entry.
    if (flags['approved-by']) {
      const last = fm.phase_history.length - 1;
      fm.phase_history[last] = `${fm.phase_history[last]} approved_by=${flags['approved-by']}`;
    }
  }
  if (flags['phase-data']) {
    let extra;
    try { extra = JSON.parse(flags['phase-data']); } catch (e) {
      fail(`--phase-data is not valid JSON: ${e.message}`);
    }
    Object.assign(fm, extra);
  }
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, status: newStatus };
}

function cmdModernizeDiscoverStack(args) {
  const projectPath = args[0];
  if (!projectPath) usage('modernize discover-stack requires <project-path>');
  if (!fs.existsSync(projectPath)) fail(`project path not found: ${projectPath}`);

  const techStack = [];
  const root = projectPath;

  // Node/JS ecosystem
  if (fs.existsSync(path.join(root, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['next']) techStack.push('next.js');
      else if (deps['react']) techStack.push('react');
      if (deps['vue']) techStack.push('vue');
      if (deps['@angular/core']) techStack.push('angular');
      if (deps['svelte']) techStack.push('svelte');
      if (deps['express']) techStack.push('express');
      if (deps['fastify']) techStack.push('fastify');
      if (deps['vitest']) techStack.push('vitest');
      if (deps['jest']) techStack.push('jest');
      if (deps['playwright'] || deps['@playwright/test']) techStack.push('playwright');
    } catch (_e) {}
    if (!techStack.length) techStack.push('node.js');
  }

  // Flutter / Dart
  if (fs.existsSync(path.join(root, 'pubspec.yaml'))) techStack.push('flutter');

  // Python
  if (fs.existsSync(path.join(root, 'requirements.txt')) ||
      fs.existsSync(path.join(root, 'pyproject.toml'))) techStack.push('python');

  // Docker / Infra
  if (fs.existsSync(path.join(root, 'Dockerfile')) ||
      fs.existsSync(path.join(root, 'docker-compose.yml')) ||
      fs.existsSync(path.join(root, 'docker-compose.yaml'))) techStack.push('docker');
  if (fs.existsSync(path.join(root, '.github', 'workflows'))) techStack.push('github-actions');

  // AI signals
  try {
    const lockfile = path.join(root, 'package-lock.json');
    if (fs.existsSync(lockfile)) {
      const content = fs.readFileSync(lockfile, 'utf8');
      if (content.includes('"@anthropic-ai/sdk"') || content.includes('"openai"') ||
          content.includes('"langchain"')) techStack.push('ai-llm');
    }
  } catch (_e) {}

  // LOC and file count (non-blocking, best-effort). execFileSync passes
  // `root` as a literal argv entry (no shell), and the node_modules/.git
  // exclusion is done in JS instead of a `| grep -v` shell pipeline.
  let loc = 0;
  let fileCount = 0;
  try {
    const find = require('child_process').execFileSync(
      'find',
      [root, '-type', 'f', '(', '-name', '*.ts', '-o', '-name', '*.tsx',
        '-o', '-name', '*.js', '-o', '-name', '*.dart', '-o', '-name', '*.py', ')'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    const files = find
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.includes('node_modules') && !f.includes('/.git/'));
    fileCount = files.length;
    for (const f of files.slice(0, 200)) {
      try {
        const lines = fs.readFileSync(f, 'utf8').split('\n').length;
        loc += lines;
      } catch (_e) {}
    }
  } catch (_e) {}

  return {
    tech_stack: techStack,
    loc,
    file_count: fileCount,
    test_coverage_pre: null,
  };
}

function cmdModernizeAddProposal(args) {
  const masterPathInput = args[0];
  if (!masterPathInput) usage('modernize add-proposal requires <master-path> --title <t> --rationale <r> --risk low|medium|high --effort <e> --rollback <rb>');
  const flags = parseFlags(args.slice(1), {
    'title': 'value', 'rationale': 'value', 'risk': 'value',
    'effort': 'value', 'rollback': 'value',
  });
  if (!flags.title || !flags.rationale || !flags.risk || !flags.effort || !flags.rollback) {
    usage('modernize add-proposal requires --title --rationale --risk --effort --rollback');
  }
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  if (!Array.isArray(fm.proposals)) fm.proposals = [];
  const id = `P-${String(fm.proposals.length + 1).padStart(3, '0')}`;
  fm.proposals.push({
    id,
    title: flags.title,
    rationale: flags.rationale,
    risk: flags.risk,
    effort_estimate: flags.effort,
    rollback_path: flags.rollback,
    approved_by_robert: 'pending',
    rejection_reason: null,
    deferred_to: null,
  });
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, proposal_id: id };
}

function cmdModernizeApproveProposal(args) {
  const masterPathInput = args[0];
  const proposalId = args[1];
  const decision = args[2];
  if (!masterPathInput || !proposalId || !decision) {
    usage('modernize approve-proposal requires <master-path> <proposal-id> approved|rejected|deferred [--reason <text>] [--approved-by <human|harness:reason>]');
  }
  if (!MODERNIZE_PROPOSAL_DECISIONS.has(decision)) {
    usage(`invalid decision "${decision}". valid: ${[...MODERNIZE_PROPOSAL_DECISIONS].join(', ')}`);
  }
  const flags = parseFlags(args.slice(3), { 'reason': 'value', 'approved-by': 'value' });
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  if (!Array.isArray(fm.proposals)) fail('no proposals found in master file');
  normalizeJsonEntries(fm, 'proposals');
  const p = fm.proposals.find((x) => x.id === proposalId);
  if (!p) fail(`proposal ${proposalId} not found`);
  p.approved_by_robert = decision;
  if (flags.reason) p.rejection_reason = flags.reason;
  // FMEA-5: audit trail — who approved (human vs harness:<reason>).
  if (flags['approved-by']) p.approved_by = flags['approved-by'];
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, proposal_id: proposalId, decision };
}

// Frontmatter round-trip fix: writeMdAtomic serializes array-of-object entries
// as JSON strings; on re-read they stay strings, so id-lookups (x.id) miss.
// Normalize in place: parse string entries back into objects before use.
// parity_baseline convention: array of "key=val" strings (see modernize init).
// Tolerates legacy object/string shapes; "null" strings become real nulls.
function parityBaselineToMap(pb) {
  const map = {};
  if (Array.isArray(pb)) {
    for (const entry of pb) {
      if (typeof entry !== 'string') continue;
      const i = entry.indexOf('=');
      if (i === -1) continue;
      const k = entry.slice(0, i);
      const v = entry.slice(i + 1);
      map[k] = v === 'null' ? null : v;
    }
  } else if (pb && typeof pb === 'object') {
    Object.assign(map, pb);
  }
  return map;
}

function normalizeJsonEntries(fm, key) {
  if (!Array.isArray(fm[key])) return;
  fm[key] = fm[key].map((entry) => {
    if (typeof entry !== 'string') return entry;
    try {
      const parsed = JSON.parse(entry);
      return parsed && typeof parsed === 'object' ? parsed : entry;
    } catch (_e) {
      return entry;
    }
  });
}

function cmdModernizeAddWave(args) {
  const masterPathInput = args[0];
  if (!masterPathInput) usage('modernize add-wave requires <master-path> --title <t> [--depends-on W-01,W-02]');
  const flags = parseFlags(args.slice(1), {
    'title': 'value', 'depends-on': 'value',
  });
  if (!flags.title) usage('modernize add-wave requires --title');
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  if (!Array.isArray(fm.waves)) fm.waves = [];
  const id = `W-${String(fm.waves.length + 1).padStart(2, '0')}`;
  const dependsOn = flags['depends-on'] ? flags['depends-on'].split(',').map((s) => s.trim()) : [];
  fm.waves.push({
    id,
    title: flags.title,
    depends_on: dependsOn,
    frs: [],
    status: 'planned',
    approved_by_robert: 'pending',
  });
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, wave_id: id };
}

function cmdModernizeSnapshotBehavior(args) {
  const masterPathInput = args[0];
  if (!masterPathInput) usage('modernize snapshot-behavior requires <master-path> [--baseline-tests <path>] [--manual-smoke <path>]');
  const flags = parseFlags(args.slice(1), {
    'baseline-tests': 'value', 'manual-smoke': 'value',
  });
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  // parity_baseline follows the repo's flat "key=val" string-array convention
  // (seeded by modernize init) — read into a map, update, write back as k=v.
  const baseline = parityBaselineToMap(fm.parity_baseline);
  baseline.snapshot_taken_at = nowIso();
  if (flags['baseline-tests']) baseline.baseline_tests = flags['baseline-tests'];
  if (flags['manual-smoke']) {
    baseline.manual_smoke_doc = flags['manual-smoke'];
    // FMEA-2: compute a content hash of the smoke artifact so complete-wave can
    // recompute + diff it later — turns a claimed parity gate into a computed one.
    const smokePath = resolveVaultPath(flags['manual-smoke']);
    if (!fs.existsSync(smokePath)) fail(`--manual-smoke file not found: ${smokePath}`);
    const crypto = require('crypto');
    const content = fs.readFileSync(smokePath);
    baseline.snapshot_hash = crypto.createHash('sha256').update(content).digest('hex');
  }
  fm.parity_baseline = Object.entries(baseline).map(([k, v]) => `${k}=${v === null || v === undefined ? 'null' : v}`);
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, snapshot_taken_at: baseline.snapshot_taken_at, snapshot_hash: baseline.snapshot_hash || null };
}

function cmdModernizeStartWave(args) {
  const masterPathInput = args[0];
  const waveId = args[1];
  if (!masterPathInput || !waveId) usage('modernize start-wave requires <master-path> <wave-id> [--approved-by <human|harness:reason>]');
  const flags = parseFlags(args.slice(2), { 'approved-by': 'value' });
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  if (!Array.isArray(fm.waves)) fail('no waves found in master file');
  normalizeJsonEntries(fm, 'waves');
  const w = fm.waves.find((x) => x.id === waveId);
  if (!w) fail(`wave ${waveId} not found`);
  w.status = 'implementing';
  w.approved_by_robert = 'approved';
  // FMEA-5: audit trail — who approved the wave start (human vs harness:<reason>).
  if (flags['approved-by']) w.approved_by = flags['approved-by'];
  fm.status = 'executing';
  appendPhaseHistory(fm, `wave-${waveId}-start`);
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, wave_id: waveId, status: 'implementing' };
}

function cmdModernizeCompleteWave(args) {
  const masterPathInput = args[0];
  const waveId = args[1];
  if (!masterPathInput || !waveId) {
    usage('modernize complete-wave requires <master-path> <wave-id> --snapshot-replay pass|fail [--replay-file <path>] --fr-ac-checks <json>');
  }
  const flags = parseFlags(args.slice(2), {
    'snapshot-replay': 'value', 'fr-ac-checks': 'value', 'replay-file': 'value',
  });
  if (!flags['snapshot-replay']) usage('modernize complete-wave requires --snapshot-replay pass|fail');
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  if (!Array.isArray(fm.waves)) fail('no waves found in master file');
  normalizeJsonEntries(fm, 'waves');
  const w = fm.waves.find((x) => x.id === waveId);
  if (!w) fail(`wave ${waveId} not found`);

  // FMEA-2: computed parity. If snapshot-behavior stored a snapshot_hash, the
  // self-asserted `--snapshot-replay pass` claim alone is no longer trusted:
  //  - --replay-file given → diff its byte-content against the baseline
  //    manual_smoke_doc file. Identical ⇒ replay pass (regardless of the claim);
  //    different ⇒ fail. (Diff by content, not by hash-equality of paths.)
  //  - no --replay-file → reject the claim outright.
  // Legacy baselines (no snapshot_hash) keep old claim-based behavior.
  const baseline = parityBaselineToMap(fm.parity_baseline);
  const hasComputedParity = baseline.snapshot_hash != null && baseline.snapshot_hash !== 'null';
  if (hasComputedParity) {
    if (!flags['replay-file']) {
      fail('computed parity required: pass --replay-file');
    }
    const replayPath = resolveVaultPath(flags['replay-file']);
    if (!fs.existsSync(replayPath)) fail(`--replay-file not found: ${replayPath}`);
    const baselinePathRaw = baseline.manual_smoke_doc;
    if (!baselinePathRaw || baselinePathRaw === 'null') {
      fail('parity drift (computed): baseline manual_smoke_doc missing');
    }
    const baselinePath = resolveVaultPath(baselinePathRaw);
    if (!fs.existsSync(baselinePath)) fail(`parity drift (computed): baseline manual_smoke_doc not found: ${baselinePath}`);
    const replayContent = fs.readFileSync(replayPath);
    const baselineContent = fs.readFileSync(baselinePath);
    if (!replayContent.equals(baselineContent)) {
      fail('parity drift (computed)');
    }
    // computed replay pass — the claim is superseded by the byte-diff verdict.
  } else if (flags['snapshot-replay'] !== 'pass') {
    fail(`parity check failed (snapshot-replay=${flags['snapshot-replay']}). Fix regression before completing wave.`);
  }
  w.status = 'done';
  appendPhaseHistory(fm, `wave-${waveId}-done`);
  // Check if all waves are done
  const allDone = fm.waves.every((wv) => wv.status === 'done');
  if (allDone) fm.status = 'executed';
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, wave_id: waveId, status: 'done', all_waves_done: allDone };
}

function cmdModernizeVerifyParity(args) {
  const masterPathInput = args[0];
  if (!masterPathInput) usage('modernize verify-parity requires <master-path>');
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm } = readMd(masterPath);
  if (!fm.parity_baseline) {
    process.stderr.write('no parity baseline found — run snapshot-behavior first\n');
    process.exit(1);
  }
  const baseline = parityBaselineToMap(fm.parity_baseline);
  normalizeJsonEntries(fm, 'waves');
  // Report baseline info; actual test execution is done by the skill
  return {
    path: masterPath,
    baseline_snapshot_taken_at: baseline.snapshot_taken_at || null,
    baseline_tests: baseline.baseline_tests || null,
    manual_smoke_doc: baseline.manual_smoke_doc || null,
    waves_done: Array.isArray(fm.waves) ? fm.waves.filter((w) => w.status === 'done').length : 0,
  };
}

function cmdModernizePublishNotion(args) {
  const masterPathInput = args[0];
  if (!masterPathInput) usage('modernize publish-notion requires <master-path> [--notion-parent <page-id>]');
  const flags = parseFlags(args.slice(1), { 'notion-parent': 'value' });
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  // Prepare fallback export path
  const masterDir = path.dirname(masterPath);
  const fallbackDir = path.join(masterDir, 'modernize-export');
  const fallbackPath = path.join(fallbackDir, 'report.md');
  return {
    path: masterPath,
    notion_parent: flags['notion-parent'] || null,
    fallback_path: fallbackPath,
    status: fm.status,
    project_slug: fm.project_slug,
  };
}

function cmdModernizeList(args) {
  const flags = parseFlags(args, { status: 'value', slug: 'value' });
  const projectSlug = flags.slug || flags._[0];
  const results = [];
  const projectsRoot = path.join(vaultRoot(), 'projects');
  if (!fs.existsSync(projectsRoot)) return { count: 0, runs: [] };
  const slugs = projectSlug
    ? [projectSlug]
    : fs.readdirSync(projectsRoot).filter((e) => !e.startsWith('_'));
  for (const slug of slugs) {
    const dir = path.join(projectsRoot, slug, 'modernize');
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).sort().reverse()) {
      if (!entry.match(/^\d{4}-\d{2}-\d{2}-.+\.md$/)) continue;
      const full = path.join(dir, entry);
      let status = 'unknown';
      let mode = 'unknown';
      let title = entry;
      try {
        const { fm } = readMd(full);
        status = fm.status || 'unknown';
        mode = fm.mode || 'unknown';
        title = fm.title || entry;
      } catch (_e) {}
      if (flags.status && status !== flags.status) continue;
      results.push({ project: slug, file: entry, path: full, status, mode, title });
    }
  }
  return { count: results.length, runs: results };
}

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

// reservations lock machinery lives in lib/locks.cjs

function cmdCheckReservations(args) {
  const flags = parseFlags(args, {
    claim: 'value',
    by: 'value',
    file: 'value',
    list: 'bool',
    release: 'bool',
  });
  const file = reservationsFile(flags);

  if (flags.list) {
    const data = loadReservations(file);
    const out = { file, count: data.reservations.length, reservations: data.reservations };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(0);
  }

  if (flags.release) {
    if (!flags.by) {
      usage('check reservations --release requires --by <spec-id> (optionally --claim <type>:<value>)');
    }
    const by = flags.by;
    let type = null;
    let value = null;
    if (flags.claim) {
      const relIdx = flags.claim.indexOf(':');
      if (relIdx <= 0 || relIdx === flags.claim.length - 1) {
        usage(`check reservations --claim must be <type>:<value> (got: ${flags.claim})`);
      }
      type = flags.claim.slice(0, relIdx);
      value = flags.claim.slice(relIdx + 1);
    }
    const lockPath = acquireReservationsLock(file);
    const data = loadReservations(file);

    if (flags.claim) {
      const existing = data.reservations.find((r) => r.type === type && r.value === value);
      if (existing && existing.by !== by) {
        const out = {
          status: 'FORBIDDEN',
          file,
          claim: { type, value, by },
          held_by: existing.by,
        };
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        process.stderr.write(
          `cannot release: ${type}:${value} is held by ${existing.by}, not ${by}\n`
        );
        exitWithLock(lockPath, 1);
      }
    }

    const matches = flags.claim
      ? data.reservations.filter((r) => r.type === type && r.value === value)
      : data.reservations.filter((r) => r.by === by);

    if (matches.length === 0) {
      const out = { status: 'OK', file, released: [], idempotent: true, note: 'nothing to release' };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      exitWithLock(lockPath, 0);
    }

    const removed = matches.filter((r) => r.by === by);
    const remaining = data.reservations.filter(
      (r) => !removed.some((m) => m === r)
    );
    writeJsonAtomic(file, { ...data, reservations: remaining });
    const out = { status: 'OK', file, released: removed, idempotent: false };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    exitWithLock(lockPath, 0);
  }

  if (!flags.claim || !flags.by) {
    usage('check reservations requires --claim <type>:<value> --by <spec-id> (or --list)');
  }
  const idx = flags.claim.indexOf(':');
  if (idx <= 0 || idx === flags.claim.length - 1) {
    usage(`check reservations --claim must be <type>:<value> (got: ${flags.claim})`);
  }
  const type = flags.claim.slice(0, idx);
  const value = flags.claim.slice(idx + 1);
  const by = flags.by;

  const data = loadReservations(file);
  const existing = data.reservations.find((r) => r.type === type && r.value === value);

  if (existing) {
    if (existing.by === by) {
      const out = { status: 'OK', idempotent: true, file, reservation: existing };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      process.exit(0);
    }
    const out = {
      status: 'CONFLICT',
      file,
      claim: { type, value, by },
      held_by: existing.by,
      holder: existing,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.stderr.write(
      `conflict: ${type}:${value} already reserved by ${existing.by} (at ${existing.at})\n`
    );
    process.exit(1);
  }

  const reservation = { type, value, by, at: nowIso() };
  const next = { reservations: [...data.reservations, reservation] };
  writeJsonAtomic(file, next);
  const out = { status: 'OK', idempotent: false, file, reservation };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// code-scope — path-list reservation claims with deterministic overlap gate.
//
// Extends the reservations registry (same .a1/reservations.json file) with a
// new claim shape: { type: "code_scope", paths: [...], by, at, stage }.
// Unlike scalar `check reservations --claim <type>:<value>` (exact-match),
// code-scope compares whole path LISTS for prefix/glob overlap so a new
// feature's declared file scope can be checked against every in-flight
// feature's declared scope before Implementation starts (FR-004..007, 017).
// Deterministic: no filesystem reads beyond the registry file itself, no git.
// ---------------------------------------------------------------------------

/** Normalize a scope path for comparison: strip leading "./", collapse
 * duplicate slashes, strip a single trailing slash (kept conceptually as
 * "directory" via segment comparison, not via string suffix). */
function normalizeScopePath(p) {
  let out = String(p).trim().replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  out = out.replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/** Split a normalized path into non-empty segments. */
function scopeSegments(p) {
  return p.split('/').filter(Boolean);
}

/** True if `pattern` segment is a glob segment ("*" or "**"). */
function isGlobSegment(seg) {
  return seg === '*' || seg === '**';
}

/** Match a single path's segments against a pattern's segments.
 * "*" matches exactly one segment; "**" matches zero or more segments. */
function segmentsMatchGlob(patternSegs, pathSegs) {
  const memo = new Map();
  function walk(pi, si) {
    const key = pi + ':' + si;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (pi === patternSegs.length) {
      result = si === pathSegs.length;
    } else {
      const seg = patternSegs[pi];
      if (seg === '**') {
        result = walk(pi + 1, si) || (si < pathSegs.length && walk(pi, si + 1));
      } else if (seg === '*') {
        result = si < pathSegs.length && walk(pi + 1, si + 1);
      } else {
        result = si < pathSegs.length && pathSegs[si] === seg && walk(pi + 1, si + 1);
      }
    }
    memo.set(key, result);
    return result;
  }
  return walk(0, 0);
}

/** True if segsA is a prefix of segsB at a segment boundary (or equal). */
function isSegmentPrefix(segsA, segsB) {
  if (segsA.length > segsB.length) return false;
  for (let i = 0; i < segsA.length; i++) {
    if (segsA[i] !== segsB[i]) return false;
  }
  return true;
}

/** Segments up to (excluding) the first glob segment, i.e. the fixed
 * "directory anchor" a glob pattern is rooted under. For a pattern with no
 * glob segment this is just all of its segments (identical to itself). */
function nonGlobPrefix(segs) {
  const idx = segs.findIndex(isGlobSegment);
  return idx === -1 ? segs : segs.slice(0, idx);
}

/** Deterministic overlap check between two declared scope paths.
 * Overlap if:
 *   - one is a segment-boundary prefix of the other (dir containment), or
 *   - either contains a glob ("*"/"**") that matches the other via glob math, or
 *   - either side's glob is rooted under a directory the other side contains
 *     (or vice versa) — e.g. `src/**\/util.js` vs `src/foo`, or `src/*` vs
 *     `src/a/b.js`. Compares each side's fixed (non-glob) prefix against the
 *     other side's full segments via segment-boundary containment.
 * No fs reads, no git — pure string/segment comparison. */
function scopePathsOverlap(rawA, rawB) {
  const a = normalizeScopePath(rawA);
  const b = normalizeScopePath(rawB);
  if (a === b) return true;
  const segsA = scopeSegments(a);
  const segsB = scopeSegments(b);
  const hasGlobA = segsA.some(isGlobSegment);
  const hasGlobB = segsB.some(isGlobSegment);
  if (hasGlobA && segmentsMatchGlob(segsA, segsB)) return true;
  if (hasGlobB && segmentsMatchGlob(segsB, segsA)) return true;
  if (!hasGlobA && !hasGlobB) {
    if (isSegmentPrefix(segsA, segsB)) return true;
    if (isSegmentPrefix(segsB, segsA)) return true;
  } else {
    // At least one side has a glob: also test directory containment between
    // each side's fixed (non-glob) prefix and the other side's full path.
    const prefixA = nonGlobPrefix(segsA);
    const prefixB = nonGlobPrefix(segsB);
    if (prefixA.length > 0 && isSegmentPrefix(prefixA, segsB)) return true;
    if (prefixB.length > 0 && isSegmentPrefix(prefixB, segsA)) return true;
    if (prefixB.length > 0 && isSegmentPrefix(segsA, prefixB)) return true;
    if (prefixA.length > 0 && isSegmentPrefix(segsB, prefixA)) return true;
  }
  return false;
}

/** Find all code_scope reservation entries (excluding a given feature id)
 * whose declared paths overlap the candidate paths. Returns a flat list of
 * { feature, path, with } describing each overlapping pair. */
function findScopeOverlaps(reservations, candidatePaths, excludeBy) {
  const overlaps = [];
  for (const r of reservations) {
    if (r.type !== 'code_scope') continue;
    if (r.by === excludeBy) continue;
    const otherPaths = Array.isArray(r.paths) ? r.paths : [];
    for (const cand of candidatePaths) {
      for (const other of otherPaths) {
        if (scopePathsOverlap(cand, other)) {
          overlaps.push({ feature: r.by, path: cand, with: other });
        }
      }
    }
  }
  return overlaps;
}

function parseScopeList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const CODE_SCOPE_STAGES = ['started', 'complete', 'review', 'verify', 'merge', 'origin-cleanup', 'done'];

function cmdCodeScopeClaim(args) {
  const flags = parseFlags(args, { by: 'value', scope: 'value', file: 'value' });
  const file = reservationsFile(flags);
  if (!flags.by || !flags.scope) {
    usage('code-scope claim requires --by <feature-id> --scope <path>[,<path>...]');
  }
  const paths = parseScopeList(flags.scope);
  if (paths.length === 0) {
    usage('code-scope claim requires at least one --scope path');
  }
  const by = flags.by;

  const lockPath = acquireReservationsLock(file);
  const data = loadReservations(file);
  const existingSame = data.reservations.find((r) => r.type === 'code_scope' && r.by === by);

  if (existingSame) {
    const existingNorm = (existingSame.paths || []).map(normalizeScopePath).sort();
    const candidateNorm = paths.map(normalizeScopePath).sort();
    const identical =
      existingNorm.length === candidateNorm.length &&
      existingNorm.every((p, i) => p === candidateNorm[i]);
    if (identical) {
      const out = { status: 'OK', idempotent: true, file, reservation: existingSame };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      exitWithLock(lockPath, 0);
    }
  }

  const overlaps = findScopeOverlaps(data.reservations, paths, by);
  if (overlaps.length > 0) {
    const out = { status: 'CONFLICT', file, claim: { by, paths }, overlaps };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    const featureIds = [...new Set(overlaps.map((o) => o.feature))];
    process.stderr.write(
      `conflict: scope overlaps in-flight feature(s): ${featureIds.join(', ')}\n`
    );
    exitWithLock(lockPath, 1);
  }

  const reservation = { type: 'code_scope', paths, by, at: nowIso(), stage: 'started' };
  const remaining = data.reservations.filter((r) => !(r.type === 'code_scope' && r.by === by));
  const next = { reservations: [...remaining, reservation] };
  writeJsonAtomic(file, next);
  const out = { status: 'OK', idempotent: false, file, reservation };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

function cmdCodeScopeStage(args) {
  const flags = parseFlags(args, { by: 'value', set: 'value', file: 'value' });
  const file = reservationsFile(flags);
  if (!flags.by || !flags.set) {
    usage('code-scope stage requires --by <feature-id> --set <stage>');
  }
  const stage = flags.set;
  if (!CODE_SCOPE_STAGES.includes(stage)) {
    usage(`code-scope stage --set must be one of: ${CODE_SCOPE_STAGES.join('|')} (got: ${stage})`);
  }
  const by = flags.by;
  const lockPath = acquireReservationsLock(file);
  const data = loadReservations(file);
  const existing = data.reservations.find((r) => r.type === 'code_scope' && r.by === by);
  if (!existing) {
    failWithLock(lockPath, `code-scope stage: no in-flight code_scope reservation found for feature '${by}'`);
  }

  const currentIdx = CODE_SCOPE_STAGES.indexOf(existing.stage);
  const nextIdx = CODE_SCOPE_STAGES.indexOf(stage);
  if (currentIdx !== -1 && nextIdx < currentIdx) {
    failWithLock(
      lockPath,
      `code-scope stage: backward transition rejected for '${by}' ` +
        `(current stage '${existing.stage}' is ahead of requested '${stage}'). ` +
        `Stage transitions must be forward-only: ${CODE_SCOPE_STAGES.join(' -> ')}.`
    );
  }
  const skipped =
    currentIdx !== -1 && nextIdx - currentIdx > 1
      ? CODE_SCOPE_STAGES.slice(currentIdx + 1, nextIdx)
      : [];

  const updated = { ...existing, stage };
  const next = {
    reservations: data.reservations.map((r) =>
      r.type === 'code_scope' && r.by === by ? updated : r
    ),
  };
  writeJsonAtomic(file, next);
  const out = { status: 'OK', file, reservation: updated };
  if (skipped.length > 0) out.skipped = skipped;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

function cmdCodeScopeRelease(args) {
  const flags = parseFlags(args, { by: 'value', file: 'value' });
  const file = reservationsFile(flags);
  if (!flags.by) {
    usage('code-scope release requires --by <feature-id>');
  }
  const by = flags.by;
  const lockPath = acquireReservationsLock(file);
  const data = loadReservations(file);
  const existing = data.reservations.find((r) => r.type === 'code_scope' && r.by === by);
  if (!existing) {
    const out = { status: 'OK', file, released: false };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    exitWithLock(lockPath, 0);
  }
  const remaining = data.reservations.filter((r) => !(r.type === 'code_scope' && r.by === by));
  const next = { reservations: remaining };
  writeJsonAtomic(file, next);
  const out = { status: 'OK', file, released: true, reservation: existing };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

function cmdCodeScopeList(args) {
  const flags = parseFlags(args, { file: 'value', 'stale-days': 'value' });
  const file = reservationsFile(flags);
  const data = loadReservations(file);
  const scopes = data.reservations.filter((r) => r.type === 'code_scope');
  const staleDaysRaw = flags['stale-days'];
  let reservations = scopes;
  if (staleDaysRaw !== undefined) {
    const staleDays = Number(staleDaysRaw);
    if (!Number.isFinite(staleDays) || staleDays < 0) {
      usage(`code-scope list --stale-days must be a non-negative number (got: ${staleDaysRaw})`);
    }
    const thresholdMs = staleDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    reservations = scopes.map((r) => {
      const atMs = Date.parse(r.at);
      const stale = Number.isFinite(atMs) ? (now - atMs) > thresholdMs : false;
      const entry = { ...r, stale };
      if (stale) {
        entry.hint = `release via a1-tools code-scope release --by ${r.by}`;
      }
      return entry;
    });
  }
  const out = { file, count: reservations.length, reservations };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

function cmdCodeScopeCheck(args) {
  const flags = parseFlags(args, { by: 'value', scope: 'value', file: 'value' });
  const file = reservationsFile(flags);
  if (!flags.by || !flags.scope) {
    usage('code-scope check requires --by <feature-id> --scope <path>[,<path>...]');
  }
  const paths = parseScopeList(flags.scope);
  if (paths.length === 0) {
    usage('code-scope check requires at least one --scope path');
  }
  const by = flags.by;
  const data = loadReservations(file);
  const overlaps = findScopeOverlaps(data.reservations, paths, by);
  if (overlaps.length > 0) {
    const out = { status: 'CONFLICT', file, claim: { by, paths }, overlaps };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    const featureIds = [...new Set(overlaps.map((o) => o.feature))];
    process.stderr.write(
      `conflict: scope overlaps in-flight feature(s): ${featureIds.join(', ')}\n`
    );
    process.exit(1);
  }
  const out = { status: 'OK', file, claim: { by, paths }, overlaps: [] };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

const { usage, HELP } = require(path.join(__dirname, 'lib', 'help.cjs'));
const { cmdPhantomCheck, cmdPhantomListTasks } = require(path.join(__dirname, 'lib', 'phantom.cjs'));

// ---------------------------------------------------------------------------
// pack — Gate-Pack system (ADR 2026-07-05-gate-pack-format).
//
// A pack is a versioned directory bundling battle-tested gate patterns so users
// import proven gates instead of collecting their own bugs. Trust model v1:
// curation over cryptography — no executable payloads (checks/ carries only
// parameter files for already-shipped CLI subcommands).
//
//   a1-tools pack validate <dir>
//       Validates pack.yaml manifest + every pattern file + checks/ safety.
//       Exit: 0 valid, 1 invalid (schema/field/unsafe-payload), 2 error (setup).
//
//   a1-tools pack import <dir> [--dest <repo>]
//       validate → copy to <repo>/.a1/packs/<name>/ → stops (never applies).
//       Re-import same version: idempotent (exit 0). Different version: replaces.
//
//   a1-tools pack export --patterns <id,..> --anonymize A2|A3 --out <dir>
//                        [--source <label>]
//       Builds a pack skeleton from Vault patterns.md entries. Enforces the
//       anonymization deny-regex — a hit in generated output → exit 1 (leak).
//       A3 additionally strips code blocks from diffs.
//
// pack.yaml (flat parser, reuses the frontmatter grammar — no YAML dependency).
// ---------------------------------------------------------------------------

const PACK_ANON_LEVELS = new Set(['A1', 'A2', 'A3']);
const PACK_TARGET_KINDS = new Set(['brief-line', 'gate-step', 'cli-check']);
// Deny-regex per ADR §3: project slugs, file paths, personal names, e-mails,
// vault paths, tenant names. A hit in exported output blocks the export.
const PACK_DENY_REGEX = /\/Users\/|N3URAL-Vault|@|n3ural|niimo/i;

// Parse a flat pack.yaml. Reuses parseFrontmatter's grammar by wrapping the
// body in "---" fences, then post-processes the two nested blocks the manifest
// needs (provenance{}, and the top-level scalar/list fields). No dependency.
function parsePackYaml(content) {
  // Nested objects (provenance) aren't handled by parseFrontmatter — parse the
  // manifest line-by-line with a one-level-deep indent model.
  const lines = content.split(/\r?\n/);
  const obj = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const valueRaw = m[2].trim();
    if (valueRaw === '') {
      // Could be a nested object (indented "key: val") or a block list ("- ").
      let j = i + 1;
      const nestedObj = {};
      const list = [];
      while (j < lines.length && /^\s+\S/.test(lines[j])) {
        const child = lines[j];
        const listM = child.match(/^\s*-\s*(.*)$/);
        const kvM = child.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
        if (listM) {
          list.push(unquotePackScalar(listM[1].trim()));
        } else if (kvM) {
          nestedObj[kvM[1]] = unquotePackScalar(kvM[2].trim());
        }
        j++;
      }
      if (list.length > 0) obj[key] = list;
      else if (Object.keys(nestedObj).length > 0) obj[key] = nestedObj;
      else obj[key] = null;
      i = j;
      continue;
    }
    obj[key] = parsePackInlineValue(valueRaw);
    i++;
  }
  return obj;
}

function unquotePackScalar(v) {
  if ((v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parsePackInlineValue(v) {
  if (v === '[]') return [];
  // Inline flow list: [a, b, c]
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => unquotePackScalar(s.trim()));
  }
  return unquotePackScalar(v);
}

// A pattern file is a YAML-ish document (frontmatter grammar) with a `diff` and
// `evidence_schema`. Parse the whole file as a manifest-style flat doc, but keep
// the raw text so multi-line block scalars (diff: |) can be recovered.
function parsePatternFile(content) {
  const obj = parsePackYaml(content);
  // Recover block scalar for `diff: |` — parsePackYaml gives it as null.
  const diffMatch = content.match(/^diff:\s*\|\s*\n([\s\S]*?)(?=^\S|\Z)/m);
  if (diffMatch) {
    obj.diff = diffMatch[1].replace(/\n+$/, '\n');
  }
  return obj;
}

function packValidateDir(dir) {
  const errors = [];
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return { ok: false, fatal: true, errors: [`pack dir not found: ${abs}`] };
  }
  const manifestPath = path.join(abs, 'pack.yaml');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, fatal: true, errors: [`missing pack.yaml in ${abs}`] };
  }

  let manifest;
  try {
    manifest = parsePackYaml(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { ok: false, fatal: true, errors: [`pack.yaml parse error: ${e.message}`] };
  }

  // Required manifest fields (ADR §2).
  const reqScalars = ['name', 'version', 'anonymization', 'requires_cli'];
  for (const k of reqScalars) {
    if (manifest[k] === undefined || manifest[k] === null || manifest[k] === '') {
      errors.push(`pack.yaml missing required field: ${k}`);
    }
  }
  if (manifest.version && !/^\d+\.\d+\.\d+$/.test(String(manifest.version))) {
    errors.push(`pack.yaml version "${manifest.version}" is not semver (MAJOR.MINOR.PATCH)`);
  }
  if (!Array.isArray(manifest.stacks) || manifest.stacks.length === 0) {
    errors.push('pack.yaml stacks[] must be a non-empty list');
  }
  if (manifest.anonymization && !PACK_ANON_LEVELS.has(String(manifest.anonymization))) {
    errors.push(`pack.yaml anonymization "${manifest.anonymization}" must be A1|A2|A3`);
  }
  const prov = manifest.provenance;
  if (!prov || typeof prov !== 'object' || Array.isArray(prov)) {
    errors.push('pack.yaml provenance{} missing or malformed');
  } else {
    for (const k of ['occurrences', 'severity', 'date_range', 'source']) {
      if (prov[k] === undefined || prov[k] === null || prov[k] === '') {
        errors.push(`pack.yaml provenance.${k} missing`);
      }
    }
  }
  if (!Array.isArray(manifest.patterns) || manifest.patterns.length === 0) {
    errors.push('pack.yaml patterns[] must be a non-empty list');
  }

  // Each listed pattern → file must exist with required fields.
  const listed = Array.isArray(manifest.patterns) ? manifest.patterns : [];
  for (const pid of listed) {
    const pf = path.join(abs, 'patterns', `${pid}.md`);
    if (!fs.existsSync(pf)) {
      errors.push(`pattern "${pid}" listed in manifest but patterns/${pid}.md missing`);
      continue;
    }
    let pat;
    try {
      pat = parsePatternFile(fs.readFileSync(pf, 'utf8'));
    } catch (e) {
      errors.push(`patterns/${pid}.md parse error: ${e.message}`);
      continue;
    }
    for (const k of ['id', 'class', 'trigger_signature', 'diff', 'evidence_schema']) {
      if (pat[k] === undefined || pat[k] === null || pat[k] === '') {
        errors.push(`patterns/${pid}.md missing required field: ${k}`);
      }
    }
    if (pat.id && String(pat.id) !== String(pid)) {
      errors.push(`patterns/${pid}.md id "${pat.id}" does not match filename "${pid}"`);
    }
    const tgt = pat.target;
    if (!tgt || typeof tgt !== 'object' || Array.isArray(tgt)) {
      errors.push(`patterns/${pid}.md target{} missing or malformed`);
    } else {
      if (!tgt.kind || !PACK_TARGET_KINDS.has(String(tgt.kind))) {
        errors.push(`patterns/${pid}.md target.kind "${tgt.kind}" must be brief-line|gate-step|cli-check`);
      }
      for (const k of ['skill', 'anchor']) {
        if (tgt[k] === undefined || tgt[k] === null || tgt[k] === '') {
          errors.push(`patterns/${pid}.md target.${k} missing`);
        }
      }
    }
  }

  // Also flag orphan pattern files not listed in the manifest.
  const patternsDir = path.join(abs, 'patterns');
  if (fs.existsSync(patternsDir)) {
    for (const entry of fs.readdirSync(patternsDir)) {
      if (!entry.endsWith('.md')) continue;
      const pid = entry.slice(0, -3);
      if (!listed.includes(pid)) {
        errors.push(`patterns/${entry} present but not listed in manifest patterns[]`);
      }
    }
  }

  // checks/ may ONLY contain parameter files — no executable payloads (ADR §5).
  const checksDir = path.join(abs, 'checks');
  if (fs.existsSync(checksDir)) {
    for (const entry of fs.readdirSync(checksDir)) {
      const full = path.join(checksDir, entry);
      if (fs.statSync(full).isDirectory()) {
        errors.push(`checks/${entry}/ — subdirectories not allowed in checks/`);
        continue;
      }
      const isParam = entry.endsWith('.json') || entry.endsWith('.args.json');
      if (!isParam) {
        errors.push(`checks/${entry} — only .json/.args.json parameter files allowed (no executable payloads)`);
      }
    }
  }

  return { ok: errors.length === 0, fatal: false, errors, manifest };
}

function cmdPackValidate(rest) {
  const dir = rest[0];
  if (!dir) {
    process.stderr.write('usage: pack validate <dir>\n');
    process.exit(1);
  }
  const res = packValidateDir(dir);
  if (res.fatal) {
    for (const e of res.errors) process.stderr.write(`error: ${e}\n`);
    process.exit(2);
  }
  if (res.ok) {
    process.stdout.write(`pack: VALID — ${res.manifest.name}@${res.manifest.version} (${(res.manifest.patterns || []).length} patterns)\n`);
    process.exit(0);
  }
  process.stderr.write(`pack: INVALID — ${res.errors.length} problem(s):\n`);
  for (const e of res.errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.statSync(s).isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rmDirRecursive(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function cmdPackImport(rest) {
  const flags = parseFlags(rest, { dest: 'value' });
  const dir = flags._[0];
  if (!dir) {
    process.stderr.write('usage: pack import <dir> [--dest <repo>]\n');
    process.exit(1);
  }
  const res = packValidateDir(dir);
  if (res.fatal) {
    for (const e of res.errors) process.stderr.write(`error: ${e}\n`);
    process.exit(2);
  }
  if (!res.ok) {
    process.stderr.write(`pack: INVALID — refusing import (${res.errors.length} problem(s)):\n`);
    for (const e of res.errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  const name = String(res.manifest.name);
  const version = String(res.manifest.version);
  const destRepo = path.resolve(flags.dest || process.cwd());
  const stagedDir = path.join(destRepo, '.a1', 'packs', name);

  let note = 'staged';
  if (fs.existsSync(stagedDir)) {
    const existingManifest = path.join(stagedDir, 'pack.yaml');
    let existingVersion = null;
    if (fs.existsSync(existingManifest)) {
      try {
        existingVersion = String(parsePackYaml(fs.readFileSync(existingManifest, 'utf8')).version);
      } catch (_e) {}
    }
    if (existingVersion === version) {
      // Idempotent re-import of same version.
      process.stdout.write(`pack ${name}@${version} already staged at ${stagedDir} — idempotent, apply via a1-evolve\n`);
      process.exit(0);
    }
    note = `replaced ${existingVersion || 'unknown'} → ${version}`;
    rmDirRecursive(stagedDir);
  }
  copyDirRecursive(path.resolve(dir), stagedDir);
  process.stdout.write(`pack ${name}@${version} staged at ${stagedDir} (${note}), apply via a1-evolve\n`);
  process.exit(0);
}

// Parse the Vault patterns.md "Applied" + "Monitoring" tables into records so
// export can build a pack skeleton from real corpus entries.
function parseVaultPatternsTable(content) {
  const records = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    // Applied table rows: | pattern | × | target | synthese |
    const row = line.match(/^\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (row) {
      let id = row[1].replace(/\*\*/g, '').trim();
      if (id === 'Pattern' || id.startsWith('---')) continue;
      const occ = parseInt(row[2].replace(/\*\*/g, ''), 10);
      const target = row[3].replace(/\*\*/g, '').trim();
      if (!id || isNaN(occ)) continue;
      records[id] = { id, occurrences: occ, target_file: target };
    }
    // Monitoring/watch rows: "- pattern_name (N) — description"
    const watch = line.match(/^-\s+([a-z_][a-z0-9_]*)\s*\((\d+)\)\s*(?:—\s*(.*))?$/);
    if (watch) {
      const id = watch[1];
      const occ = parseInt(watch[2], 10);
      if (!records[id]) {
        records[id] = { id, occurrences: occ, target_file: '', note: (watch[3] || '').trim() };
      }
    }
  }
  return records;
}

function cmdPackExport(rest) {
  const flags = parseFlags(rest, {
    patterns: 'value',
    anonymize: 'value',
    out: 'value',
    source: 'value',
  });
  if (!flags.patterns || !flags.anonymize || !flags.out) {
    process.stderr.write('usage: pack export --patterns <id,..> --anonymize A2|A3 --out <dir> [--source <label>]\n');
    process.exit(1);
  }
  if (!PACK_ANON_LEVELS.has(flags.anonymize)) {
    process.stderr.write(`error: --anonymize "${flags.anonymize}" must be A1|A2|A3 (export requires A2 or A3)\n`);
    process.exit(1);
  }
  const anon = flags.anonymize;
  const ids = flags.patterns.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    process.stderr.write('error: --patterns produced no ids\n');
    process.exit(1);
  }

  const patternsMd = path.join(vaultRoot(), 'pattern', 'a1-learnings', 'patterns.md');
  if (!fs.existsSync(patternsMd)) {
    process.stderr.write(`error: Vault patterns.md not found: ${patternsMd}\n`);
    process.exit(2);
  }
  const corpus = parseVaultPatternsTable(fs.readFileSync(patternsMd, 'utf8'));

  const missing = ids.filter((id) => !corpus[id]);
  if (missing.length > 0) {
    process.stderr.write(`error: pattern id(s) not found in Vault patterns.md: ${missing.join(', ')}\n`);
    process.exit(1);
  }

  const outDir = path.resolve(flags.out);
  const packName = path.basename(outDir);
  const source = flags.source || 'a1-office (anonymized)';

  // Build pattern files + manifest in memory, then run the deny-regex over the
  // FULL generated output. A hit → exit 1 listing the leak (before any write).
  const patternFiles = {};
  let totalOcc = 0;
  const stacks = new Set();
  for (const id of ids) {
    const rec = corpus[id];
    totalOcc += rec.occurrences;
    let diffText = rec.note || rec.target_file || `Gate derived from pattern ${id} (${rec.occurrences}×).`;
    if (anon === 'A3') {
      // A3: mechanism-only — strip fenced code blocks from diffs.
      diffText = diffText.replace(/```[\s\S]*?```/g, '[code stripped: A3]');
    }
    const pf = [
      `id: ${id}`,
      `class: ${id}`,
      `trigger_signature: "corpus pattern ${id}"`,
      'target:',
      '  kind: gate-step',
      '  skill: a1-new-feature',
      `  anchor: "${rec.target_file || 'Gate'}"`,
      'diff: |',
      `  ${diffText.replace(/\n/g, '\n  ')}`,
      'evidence_schema: "grep + CLI check output"',
      '',
    ].join('\n');
    patternFiles[id] = pf;
  }
  stacks.add('generic');

  const manifest = [
    `name: ${packName}`,
    'version: 0.1.0',
    `stacks: [${[...stacks].join(', ')}]`,
    'provenance:',
    `  occurrences: ${totalOcc}`,
    '  severity: unknown',
    '  date_range: unknown',
    `  source: ${source}`,
    `anonymization: ${anon}`,
    `patterns: [${ids.join(', ')}]`,
    'requires_cli: ">=1.4"',
    '',
  ].join('\n');

  // Deny-regex scan across all generated content.
  const scanTargets = [{ file: 'pack.yaml', text: manifest }];
  for (const id of ids) scanTargets.push({ file: `patterns/${id}.md`, text: patternFiles[id] });
  const leaks = [];
  for (const t of scanTargets) {
    for (const line of t.text.split('\n')) {
      const m = line.match(PACK_DENY_REGEX);
      if (m) leaks.push(`${t.file}: "${line.trim()}" (matched /${m[0]}/)`);
    }
  }
  if (leaks.length > 0) {
    process.stderr.write(`pack export: ANONYMIZATION FAILURE — ${leaks.length} leak(s), refusing to write:\n`);
    for (const l of leaks) process.stderr.write(`  - ${l}\n`);
    process.exit(1);
  }

  // Clean; write.
  fs.mkdirSync(path.join(outDir, 'patterns'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'pack.yaml'), manifest, 'utf8');
  for (const id of ids) {
    fs.writeFileSync(path.join(outDir, 'patterns', `${id}.md`), patternFiles[id], 'utf8');
  }
  process.stdout.write(`pack exported: ${packName} (${ids.length} patterns, ${anon}) → ${outDir}\n`);
  process.exit(0);
}

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
      // product command group lives in lib/product.cjs (Wave 9 module split).
      // Lazy require (only paid when `product ...` is actually invoked) +
      // one-time init() to inject the one remaining facade-only free
      // identifier the moved functions still call (CODE_SCOPE_STAGES is
      // shared with the facade-resident code-scope commands; usage() moved
      // to lib/help.cjs in M10 Wave 1 and product.cjs now imports it directly).
      const product = require(path.join(__dirname, 'lib', 'product.cjs'));
      product.init({ CODE_SCOPE_STAGES });
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
