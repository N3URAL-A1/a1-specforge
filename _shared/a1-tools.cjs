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
 * Vault root: env A1_VAULT_ROOT, default "~/Documents/Obsidian Vault".
 * All writes are atomic: read → modify → write to <path>.tmp.<pid> → rename.
 *
 * Exit codes: 0 success, 1 user/usage error, 2 internal error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- valid status sets ----------

const SPEC_STATUSES = new Set([
  'discovering',
  'draft',
  'clarified',
  'planned',
  'awaiting-consistency-fix',
  'implementing',
  'done',
  'cancelled',
]);

const BUG_STATUSES = new Set([
  'reported',
  'diagnosed',
  'fixing',
  'fixed',
  'cant-reproduce',
  'wont-fix',
  'duplicate',
  'cancelled',
]);

const BUG_SEVERITIES = new Set(['blocker', 'major', 'minor', 'nit']);

const ANALYSIS_STATUSES = new Set([
  'scoped',
  'discovered',
  'analyzed',
  'synthesized',
  'reported',
  'cancelled',
]);

const ANALYSIS_FOCUSES = new Set([
  'general',
  'security',
  'architecture',
  'quality',
  'onboarding',
]);

const ANALYSIS_SEVERITIES = new Set(['BLOCKER', 'MAJOR', 'MINOR']);

const CONSTITUTION_STATUSES = new Set([
  'discovering',
  'drafted',
  'reviewed',
  'written',
  'cancelled',
]);

// ---------- vault root resolution ----------

function vaultRoot() {
  if (process.env.A1_VAULT_ROOT) return process.env.A1_VAULT_ROOT;
  return path.join(os.homedir(), 'Documents', 'Obsidian Vault');
}

function resolveVaultPath(input) {
  if (path.isAbsolute(input)) return input;
  return path.join(vaultRoot(), input);
}

// ---------- frontmatter parser (line-based, minimal) ----------
// Supports: scalars (quoted/unquoted), null, [], block lists with "- ".
// Does NOT support nested objects.

function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) {
    return { fm: {}, body: content, raw: '' };
  }
  const end = content.indexOf('\n---', 4);
  if (end === -1) {
    throw new Error('frontmatter has no closing "---"');
  }
  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, '');
  const fm = {};
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.startsWith('#')) {
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const valueRaw = m[2];
    if (valueRaw === '' || valueRaw === undefined) {
      const list = [];
      let j = i + 1;
      while (
        j < lines.length &&
        (lines[j].startsWith('  - ') || lines[j].startsWith('- '))
      ) {
        let item = lines[j].replace(/^\s*-\s*/, '');
        if (
          (item.startsWith('"') && item.endsWith('"')) ||
          (item.startsWith("'") && item.endsWith("'"))
        ) {
          try {
            if (item.startsWith('"')) item = JSON.parse(item);
            else item = item.slice(1, -1);
          } catch (_e) {
            item = item.slice(1, -1);
          }
        }
        list.push(item);
        j++;
      }
      if (list.length > 0) {
        fm[key] = list;
        i = j;
        continue;
      }
      fm[key] = null;
      i++;
      continue;
    }
    if (valueRaw === '[]') {
      fm[key] = [];
      i++;
      continue;
    }
    if (valueRaw === 'null') {
      fm[key] = null;
      i++;
      continue;
    }
    let v = valueRaw;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    fm[key] = v;
    i++;
  }
  return { fm, body, raw };
}

function serializeScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return JSON.stringify(v);
  if (v === '') return '""';
  if (/^[A-Za-z0-9._:/\-+@]+$/.test(v)) return v;
  return JSON.stringify(v);
}

// Stable key order for spec and bug frontmatter — known keys first, rest alphabetic.
const SPEC_KEY_ORDER = [
  'id',
  'project',
  'feature_slug',
  'title',
  'status',
  'created',
  'phase_history',
  'wave_plan_path',
  'verify_failures',
];

const BUG_KEY_ORDER = [
  'type',
  'project',
  'bug_slug',
  'title',
  'status',
  'severity',
  'reported_at',
  'reporter',
  'affected_repos',
  'related_deploy',
  'duplicate_of',
  'phase_history',
  'recommended_code_agent',
  'fix_commit',
  'verify_result',
  'tags',
];

const ANALYSIS_KEY_ORDER = [
  'type',
  'project',
  'focus',
  'title',
  'status',
  'created_at',
  'analyzed_path',
  'phase_history',
  'discover',
  'agents_dispatched',
  'findings',
  'findings_count',
  'suggested_next',
  'tags',
];

const CONSTITUTION_KEY_ORDER = [
  'type',
  'project',
  'title',
  'status',
  'version',
  'created_at',
  'last_written_at',
  'phase_history',
  'tags',
];

function detectKeyOrder(fm) {
  if (fm.type === 'bug-report') return BUG_KEY_ORDER;
  if (fm.type === 'project-analysis') return ANALYSIS_KEY_ORDER;
  if (fm.type === 'constitution') return CONSTITUTION_KEY_ORDER;
  return SPEC_KEY_ORDER;
}

function serializeFrontmatter(fm) {
  const knownOrder = detectKeyOrder(fm);
  const keys = Object.keys(fm);
  const ordered = [];
  for (const k of knownOrder) if (keys.includes(k)) ordered.push(k);
  for (const k of keys.sort()) if (!ordered.includes(k)) ordered.push(k);

  const lines = [];
  for (const k of ordered) {
    const v = fm[k];
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) {
          lines.push(`  - ${serializeScalar(item)}`);
        }
      }
    } else {
      lines.push(`${k}: ${serializeScalar(v)}`);
    }
  }
  return lines.join('\n');
}

function readMd(p) {
  const content = fs.readFileSync(p, 'utf8');
  const parsed = parseFrontmatter(content);
  return { content, ...parsed };
}

function writeMdAtomic(p, fm, body) {
  const fmStr = serializeFrontmatter(fm);
  const out = `---\n${fmStr}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, out, 'utf8');
  fs.renameSync(tmp, p);
}

function nowIso() {
  return new Date().toISOString();
}

function appendPhaseHistory(fm, phaseName) {
  if (!Array.isArray(fm.phase_history)) fm.phase_history = [];
  const entry = `phase=${phaseName} completed=${nowIso()}`;
  fm.phase_history = fm.phase_history.filter(
    (e) => !(typeof e === 'string' && e.startsWith(`phase=${phaseName} `))
  );
  fm.phase_history.push(entry);
}

// ---------- flag parser ----------

function parseFlags(args, knownFlags) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let matched = false;
    for (const [name, kind] of Object.entries(knownFlags)) {
      if (a === `--${name}`) {
        if (kind === 'bool') {
          flags[name] = true;
        } else {
          flags[name] = args[++i];
        }
        matched = true;
        break;
      }
      if (kind !== 'bool' && a.startsWith(`--${name}=`)) {
        flags[name] = a.slice(`--${name}=`.length);
        matched = true;
        break;
      }
    }
    if (!matched) flags._.push(a);
  }
  return flags;
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

  if (!Array.isArray(fm.findings)) fm.findings = [];
  // Compute next finding id (F-001, F-002, …).
  let maxN = 0;
  for (const f of fm.findings) {
    if (typeof f === 'string') {
      const m = f.match(/^id=F-(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    }
  }
  const findingId = `F-${String(maxN + 1).padStart(3, '0')}`;

  // Encode as flat key=val pairs separated by "; ". Sanitize semicolons in inputs.
  function clean(s) {
    return String(s).replace(/;/g, ',').replace(/\n/g, ' ');
  }
  const parts = [
    `id=${findingId}`,
    `severity=${severity}`,
    `category=${clean(category)}`,
    `location=${clean(location)}`,
    `description=${clean(description)}`,
  ];
  if (flags.recommendation) parts.push(`recommendation=${clean(flags.recommendation)}`);
  fm.findings.push(parts.join('; '));

  writeMdAtomic(analysisPath, fm, body);
  return {
    analysis_path: analysisPath,
    finding_id: findingId,
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

const WORKTREE_STATUSES = new Set(['prepared', 'active', 'handoff', 'cleaned']);
const WORKTREE_EXIT_MODES = new Set(['keep', 'discard', 'handoff']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const { execFileSync } = require('child_process');

function worktreeRegistryPath() {
  if (process.env.A1_WORKTREE_REGISTRY) return process.env.A1_WORKTREE_REGISTRY;
  return path.join(os.homedir(), '.a1-worktrees-registry.json');
}

function readRegistry() {
  const p = worktreeRegistryPath();
  if (!fs.existsSync(p)) return { version: 1, worktrees: [] };
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.worktrees)) {
      throw new Error('registry shape invalid');
    }
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch (e) {
    throw new Error(`cannot parse worktree registry ${p}: ${e.message}`);
  }
}

function writeRegistryAtomic(reg) {
  const p = worktreeRegistryPath();
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function nowCompactId(slug) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}`;
  return `${stamp}-${slug}`;
}

function git(repoRoot, args, opts = {}) {
  // Returns trimmed stdout. Throws Error with stderr on non-zero exit unless allowFail.
  try {
    const out = execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch (e) {
    const msg = (e.stderr && e.stderr.toString().trim()) || e.message;
    if (opts.allowFail) return { __error: msg, __code: e.status };
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

function gitIsRepo(repoRoot) {
  if (!fs.existsSync(repoRoot)) return false;
  const res = git(repoRoot, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
  if (typeof res === 'string') return res === 'true';
  return false;
}

function gitWorkingTreeClean(repoRoot) {
  const out = git(repoRoot, ['status', '--porcelain']);
  return out.length === 0;
}

function gitBranchExists(repoRoot, branch) {
  const res = git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
    allowFail: true,
  });
  return typeof res === 'string' && res.length > 0;
}

function gitWorktreeList(repoRoot) {
  // Returns array of { path, branch }
  const out = git(repoRoot, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let cur = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) entries.push(cur);
      cur = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  if (cur.path) entries.push(cur);
  return entries;
}

function gitBranchHasWorktree(repoRoot, branch) {
  return gitWorktreeList(repoRoot).some((w) => w.branch === branch);
}

function findRegistryEntry(reg, id) {
  return reg.worktrees.find((w) => w.id === id);
}

function findActiveBySlug(reg, repoRoot, slug) {
  return reg.worktrees.find(
    (w) => w.repo_root === repoRoot && w.slug === slug && w.status !== 'cleaned'
  );
}

function repoParentWorktreeDir(repoRoot) {
  return path.join(path.dirname(repoRoot), 'a1-worktrees');
}

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

// ---------- entry point ----------

function usage(msg) {
  process.stderr.write(`usage error: ${msg}\n`);
  process.stderr.write(`\n${HELP}\n`);
  process.exit(1);
}

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

const HELP = `a1-tools — file-ops helper for a1-* skills

Usage:
  a1-tools spec next-number <project-slug>
  a1-tools spec update-status <spec-path> <new-status> [flags]
  a1-tools spec list <project-slug> [--status=<s>]

  a1-tools fix next-suffix <project-slug> <YYYY-MM-DD>
  a1-tools fix update-status <bug-path> <new-status> [flags]
  a1-tools fix list <project-slug> [--status=<s>] [--severity=<s>]
  a1-tools fix find-duplicates <project-slug> <keyword> [<keyword>...]

  a1-tools analyze next-slot <project-slug> <focus> [--date YYYY-MM-DD]
  a1-tools analyze init <project-slug> <focus> [--project-path /abs] [--date YYYY-MM-DD] [--title <text>]
  a1-tools analyze update-status <analysis-path> <new-status> [--phase-data <json>]
  a1-tools analyze discover <project-path>
  a1-tools analyze add-finding <analysis-path> <severity> <category> <location> <description> [--recommendation <text>]
  a1-tools analyze list <project-slug> [--status=<s>] [--focus=<s>]

  a1-tools check <project-slug> --feature <###-feature-slug> [--format json|human] [--vault <path>]
                  Consistency gate between spec and wave-plan.
                  Exit: 0 PASS, 1 FAIL (content), 2 ERROR (setup).

  a1-tools checklist run <project-slug>[/<feature-id>] [--format json|human] [--save] [--vault <path>]
                  Pre-flight checklist: 8 structural checks before implementation.
                  Severities: BLOCKER (exit 1), MAJOR/MINOR (exit 0, warnings).
                  Exit: 0 PASS or PASS_WITH_WARNINGS, 1 FAIL (blocker), 2 ERROR (setup).
                  With --save: writes report to projects/<slug>/checklist/<###>-<date>.md.
  a1-tools checklist list <project-slug> [--vault <path>]
                  List recent saved checklist reports for a project.

  a1-tools constitution init <project-slug> [--title <text>]
  a1-tools constitution discover <project-slug> [--project-path <abs>]
  a1-tools constitution update-status <constitution-path> <new-status>
  a1-tools constitution set-body <constitution-path> --body-file <path>
  a1-tools constitution next-version <project-slug>
  a1-tools constitution archive-current <project-slug> [--date YYYY-MM-DD]
  a1-tools constitution write-mirror <project-slug> --repo-root <abs>
  a1-tools constitution link-claudemd <project-slug> --repo-root <abs>
  a1-tools constitution list [--status=<s>]

  a1-tools worktree prepare <repo-root> <slug> [--branch <name>] [--base <branch>] [--force-reset]
                  Pre-Flight validation + registry entry. Exit: 0 PASS, 1 BLOCKER, 2 ERROR.
  a1-tools worktree enter <id>
                  Runs 'git worktree add'. Registry: prepared -> active.
  a1-tools worktree status <id>
                  Reports commit_count, has_uncommitted, branch_ahead/behind.
  a1-tools worktree exit <id> --mode <keep|discard|handoff> [--force-discard]
                  keep: remove worktree, keep branch. discard: remove both (refuses on unmerged commits without --force-discard). handoff: keep both for a1-pr-review.
  a1-tools worktree list [--status=<s>] [--repo-root=<abs>]
  a1-tools worktree gc [--dry-run]
                  Reconcile registry with on-disk state. Mark missing worktrees as cleaned.

Spec statuses: ${[...SPEC_STATUSES].join(', ')}
Bug statuses:  ${[...BUG_STATUSES].join(', ')}
Bug severities: ${[...BUG_SEVERITIES].join(', ')}
Analysis statuses: ${[...ANALYSIS_STATUSES].join(', ')}
Analysis focuses:  ${[...ANALYSIS_FOCUSES].join(', ')}
Analysis severities: ${[...ANALYSIS_SEVERITIES].join(', ')}
Constitution statuses: ${[...CONSTITUTION_STATUSES].join(', ')}

Vault root: env A1_VAULT_ROOT, default "~/Documents/Obsidian Vault".
Exit codes: 0 success, 1 user/usage error, 2 internal error.`;

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
      else usage(`unknown fix subcommand: ${sub}`);
    } else if (group === 'analyze') {
      if (sub === 'next-slot') result = cmdAnalyzeNextSlot(rest);
      else if (sub === 'init') result = cmdAnalyzeInit(rest);
      else if (sub === 'update-status') result = cmdAnalyzeUpdateStatus(rest);
      else if (sub === 'discover') result = cmdAnalyzeDiscover(rest);
      else if (sub === 'add-finding') result = cmdAnalyzeAddFinding(rest);
      else if (sub === 'list') result = cmdAnalyzeList(rest);
      else usage(`unknown analyze subcommand: ${sub}`);
    } else if (group === 'check') {
      // The check command is special: it owns its own exit code (0/1/2) and
      // prints its own report (json or human). It does NOT fall through to
      // the generic JSON.stringify(result) path below.
      cmdCheckRun([sub, ...rest].filter((x) => x !== undefined));
      return; // unreachable — cmdCheckRun calls process.exit()
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
      else usage(`unknown worktree subcommand: ${sub}`);
    } else {
      usage(`unknown command group: ${group} (expected "spec", "fix", "analyze", "check", "checklist", "constitution", or "worktree")`);
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
