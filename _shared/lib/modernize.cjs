'use strict';

const fs = require('fs');
const path = require('path');

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
const {
  MODERNIZE_STATUSES,
  MODERNIZE_MODES,
  MODERNIZE_PROPOSAL_DECISIONS,
  MODERNIZE_WAVE_STATUSES,
} = require('./status-constants.cjs');

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

module.exports = {
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
};
