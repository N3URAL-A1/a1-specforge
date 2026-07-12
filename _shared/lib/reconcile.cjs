'use strict';

const fs = require('fs');
const path = require('path');

const { gitSafe } = require('./git-safe.cjs');
const {
  RECONCILE_STATUSES,
  RECONCILE_SCOPE_MODES,
  RECONCILE_DRIFT_CLASSES,
} = require('./status-constants.cjs');
const { usage } = require('./help.cjs');
const {
  vaultRoot,
  resolveVaultPath,
  parseFlags,
  readMd,
  writeMdAtomic,
  nowIso,
  fail,
} = require('./io.cjs');
const { appendPhaseHistory } = require('./spec.cjs');

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

module.exports = {
  cmdReconcileNextSlot,
  cmdReconcileInit,
  cmdReconcileParseSpec,
  cmdReconcileUpdateStatus,
  cmdReconcileAddDrift,
  cmdReconcileList,
};
