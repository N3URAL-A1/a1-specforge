'use strict';

const fs = require('fs');
const path = require('path');
const { vaultRoot, readMd, parseFlags, projectsPath } = require('./io.cjs');
const { usage } = require('./help.cjs');

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
  const specDir = projectsPath(slug, 'spec');
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

// ---------- F-009 split of the former single `runChecklistChecks` ----------
//
// The original 246-line function has been split into sequential phases, each
// independently well under 100 lines, preserving exact combined behavior:
//   1. gatherChecklistInputs            — parse/load phase (reads spec + plan
//                                          files, returns a plain data struct)
//   2. evaluateChecklistRules           — compute phase, checks 1-2 plus the
//                                          no-plan degenerate branch; delegates
//                                          checks 3-8 (when a plan exists) to:
//      2a. evaluateChecklistWaveStructureRules — checks 3-5 (wave-block-derived)
//      2b. evaluateChecklistProjectMetaRules    — checks 6-8 (project-metadata)
//      2c. evaluateChecklistPlanBodyRules       — thin composer of 2a + 2b
//   3. runChecklistChecks               — thin orchestrator kept for API
//                                          stability; calls (1) then (2) in
//                                          sequence, unchanged signature/return
//                                          shape from the pre-split version so
//                                          cmdChecklistRun needs no changes.

// Phase 1 (parse/gather): load spec + plan frontmatter/body from disk.
// Returns { spec, plan, planExists, errors, fatal }. Mirrors the original
// function's graceful-fallback-on-missing load section byte-for-byte.
function gatherChecklistInputs(paths) {
  const errors = [];
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
    return { spec, plan, planExists: false, errors, fatal: true };
  }

  const planExists = fs.existsSync(paths.planAbs);
  if (planExists) {
    try {
      plan = readMd(paths.planAbs);
    } catch (e) {
      errors.push(`wave-plan frontmatter parse error: ${e.message}`);
      return { spec, plan, planExists, errors, fatal: true };
    }
  }

  return { spec, plan, planExists, errors, fatal: false };
}

// Phase 2b-i (compute, wave-structure sub-rules): checks 3-5, all derived
// from the parsed wave blocks. Split out from the plan-body checks so no
// single helper approaches the ~100-line F-009 ceiling.
function evaluateChecklistWaveStructureRules(waveBlocks) {
  const checks = [];

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

  return checks;
}

// Phase 2b-ii (compute, project/frontmatter sub-rules): checks 6-8, derived
// from project metadata rather than wave blocks. Split out from the
// wave-structure checks for the same F-009 size-ceiling reason.
function evaluateChecklistProjectMetaRules(slug, paths, plan) {
  const checks = [];

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
    const projectRoot = projectsPath(slug);
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

  return checks;
}

// Phase 2b (compute, plan-body sub-rules): checks 3-8, only run when a
// wave-plan is present. Thin composer over the two smaller sub-evaluators
// above so evaluateChecklistRules itself stays small too.
function evaluateChecklistPlanBodyRules(slug, paths, plan) {
  const waveBlocks = extractWaveBlocks(plan.body);
  return [
    ...evaluateChecklistWaveStructureRules(waveBlocks),
    ...evaluateChecklistProjectMetaRules(slug, paths, plan),
  ];
}

// Phase 2 (compute): evaluates checks 1-8 against the gathered inputs.
// Takes gatherChecklistInputs' output shape (minus errors/fatal, which the
// caller already handled) plus the identifiers needed for path-relative
// messaging. Returns { checks, errors } — errors is always [] here since
// the fatal-error paths are handled entirely in gatherChecklistInputs.
function evaluateChecklistRules(slug, paths, spec, plan, planExists) {
  const checks = [];
  const errors = [];

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
    return { checks, errors };
  }

  // --- Body-driven checks 3-8: delegated to the plan-body sub-evaluator ---
  const bodyChecks = evaluateChecklistPlanBodyRules(slug, paths, plan);
  checks.push(...bodyChecks);

  return { checks, errors };
}

// Phase 3 / thin orchestrator: kept under the original name so
// cmdChecklistRun's call site needs no change. Calls gather then evaluate
// in sequence, returning the exact same { checks, errors, fatal } shape the
// pre-split single function returned.
function runChecklistChecks(slug, feature, paths) {
  const gathered = gatherChecklistInputs(paths);
  if (gathered.fatal) {
    return { checks: [], errors: gathered.errors, fatal: true };
  }
  const { checks, errors } = evaluateChecklistRules(
    slug,
    paths,
    gathered.spec,
    gathered.plan,
    gathered.planExists
  );
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
      ? 'PASS (with warnings)'
      : report.status === 'FAIL'
      ? 'FAIL'
      : 'ERROR';
  lines.push(`Pre-flight checklist: ${label}`);
  lines.push('');
  lines.push(`Feature: ${report.feature} (project: ${report.project})`);
  lines.push('');

  if (report.status === 'ERROR') {
    lines.push('Setup errors:');
    for (const err of report.errors || []) lines.push(`  - ${err}`);
    lines.push('');
    lines.push('Recommendation:');
    lines.push('  Check the paths, create missing files, or repair the frontmatter.');
    return lines.join('\n');
  }

  const tick = (r) => (r === 'PASS' ? '[ok]' : '[x]');
  const sevTag = { BLOCKER: '[BLOCKER]', MAJOR: '[MAJOR]', MINOR: '[MINOR]' };
  lines.push('Checks:');
  for (const c of report.checks) {
    lines.push(`  ${tick(c.result)} ${sevTag[c.severity]} ${c.name}`);
    lines.push(`        ${c.detail}`);
  }
  lines.push('');

  const s = report.summary;
  lines.push(
    `Result: ${s.blockers} BLOCKER, ${s.majors} MAJOR, ${s.minors} MINOR open.`
  );

  if (report.status === 'PASS') {
    lines.push('');
    lines.push('Recommendation: implementation can start.');
  } else if (report.status === 'PASS_WITH_WARNINGS') {
    lines.push('');
    lines.push(
      'Recommendation: implementation is possible, but address the MAJOR/MINOR items before starting.'
    );
  } else {
    lines.push('');
    lines.push('Recommendation: fix the BLOCKERs — the plan is not implementation-ready.');
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
  const dir = projectsPath(slug, 'checklist');
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

module.exports = { cmdChecklistRun, cmdChecklistList };
