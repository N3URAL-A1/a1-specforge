'use strict';

const fs = require('fs');
const path = require('path');
const { vaultRoot, readMd, parseFlags } = require('./io.cjs');
const { usage } = require('./help.cjs');

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

module.exports = { cmdCheckRun };
