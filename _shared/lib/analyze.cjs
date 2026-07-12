'use strict';

const fs = require('fs');
const path = require('path');

const {
  vaultRoot,
  resolveVaultPath,
  readMd,
  writeMdAtomic,
  nowIso,
  parseFlags,
  fail,
} = require('./io.cjs');
const { usage } = require('./help.cjs');
const { appendPhaseHistory } = require('./spec.cjs');
const {
  ANALYSIS_STATUSES,
  ANALYSIS_FOCUSES,
  ANALYSIS_SEVERITIES,
} = require('./status-constants.cjs');

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

module.exports = {
  cmdAnalyzeNextSlot,
  cmdAnalyzeInit,
  cmdAnalyzeUpdateStatus,
  cmdAnalyzeDiscover,
  cmdAnalyzeAddFinding,
  cmdAnalyzeAddFindings,
  cmdAnalyzeList,
};
