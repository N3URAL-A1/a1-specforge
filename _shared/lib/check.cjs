'use strict';

// ---------- spec↔plan consistency primitives ----------
//
// The former `check run` gate retired in M13: its three invariants live on as
// a1-checklist checks #9 (fr_coverage_bijective — coverage + phantoms) and
// #10 (plan_spec_path_link), invoked by a1-new-feature's Gate 4.5 via
// `checklist run <slug>/<feature> --only 9,10` (same 0/1/2 exit contract).
// This module keeps only the shared, deterministic primitives (regex-based,
// no LLM) that checklist.cjs builds those checks on.

const FR_PATTERN = /\bFR-\d{3,}\b/g;

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

module.exports = { extractSpecFRs, extractWaveFRs, diffFRCoverage };
