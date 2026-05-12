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

function detectKeyOrder(fm) {
  if (fm.type === 'bug-report') return BUG_KEY_ORDER;
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

Spec statuses: ${[...SPEC_STATUSES].join(', ')}
Bug statuses:  ${[...BUG_STATUSES].join(', ')}
Bug severities: ${[...BUG_SEVERITIES].join(', ')}

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
    } else {
      usage(`unknown command group: ${group} (expected "spec" or "fix")`);
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
