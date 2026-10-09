'use strict';

// ---------- spec↔plan consistency primitives ----------
//
// The former `check run` gate retired in M13: its three invariants live on as
// a1-checklist checks #9 (fr_coverage_bijective — coverage + phantoms) and
// #10 (plan_spec_path_link), invoked by a1-new-feature's Gate 4.5 via
// `checklist run <slug>/<feature> --only 9,10,11` (same 0/1/2 exit contract;
// #11 is the spec↔roadmap status check added by spec 010).
// This module keeps only the shared, deterministic primitives (regex-based,
// no LLM) that checklist.cjs builds those checks on.

// Sub-numbered IDs (FR-014-1, FR-014-2) must stay DISTINCT. With a bare
// `\bFR-\d{3,}\b` both collapse to the token "FR-014", so a spec could lose an
// entire requirement while this gate still reported PASS — verified 2026-09-01
// on n3ural-contentbot: deleting every mention of FR-014-2 from the wave plan
// produced "PASS, 1 FRs" for a two-FR spec. The optional `-\d+` group keeps
// flat IDs (the convention everywhere in this repo) matching exactly as before.
const FR_PATTERN = /\bFR-\d{3,}(?:-\d+)?\b/g;

function extractSpecFRs(specBody) {
  // Spec FR-IDs can appear anywhere in the body. Collect unique set.
  const set = new Set();
  const matches = specBody.match(FR_PATTERN) || [];
  for (const m of matches) set.add(m);
  return set;
}

// Wave headings (audit F-018). A wave id is a number with an optional
// lower-case letter suffix (`## Wave 6b`) or one upper-case letter
// (`## Wave E`); "Wave" itself is case-insensitive. Before, only `\d+` was
// recognised, so `## Wave 6b` and `## Wave E` were not headings and their FRs
// were silently attributed to the previous wave — a false PASS of check 9.
// checklist.cjs splits wave blocks with the same scanner.
const WAVE_ID = '([0-9]+[a-z]?|[A-Z])(?![A-Za-z0-9_])';
const WAVE_HEADING_RE = new RegExp(`^##\\s+[Ww][Aa][Vv][Ee]\\s+${WAVE_ID}(?![.\\-/][A-Za-z0-9])(.*)$`);
// A heading that starts like a numbered wave but has no valid id
// (`## Wave 6B`, `## Wave 6-7`, `## Wave 10.5`). Prose headings such as
// `## Waves`, `## Wave-DAG` or `## Wave sequencing` stay ordinary headings.
const WAVE_HEADING_LIKE_RE = /^##\s+wave\s+[0-9]/i;
const WAVE_REF_RE = new RegExp(`\\b[Ww][Aa][Vv][Ee]\\s+${WAVE_ID}`, 'g');

/** Split a plan body at its wave headings. Returns { sections, problems }:
 * sections in document order as { id, label, lines }, problems as
 * { line, heading, reason } for unrecognised and repeated wave headings. */
function scanWaveSections(planBody) {
  const sections = [];
  const problems = [];
  const seen = new Set();
  let current = null;
  planBody.split('\n').forEach((line, idx) => {
    const h = line.match(WAVE_HEADING_RE);
    if (h) {
      current = { id: h[1], label: `Wave ${h[1]}`, lines: [] };
      if (seen.has(h[1])) problems.push({ line: idx + 1, heading: line, reason: 'duplicate' });
      seen.add(h[1]);
      sections.push(current);
      return;
    }
    if (WAVE_HEADING_LIKE_RE.test(line)) {
      problems.push({ line: idx + 1, heading: line, reason: 'unrecognised' });
    }
    if (current) current.lines.push(line);
  });
  return { sections, problems };
}

function extractWaveFRs(planBody) {
  // For each wave, collect every FR-### occurrence in its section. A repeated
  // heading adds to the same wave (F-019: it used to replace the earlier
  // block's FRs); scanWaveSections reports the repeat as a problem.
  // Returns: Map<waveLabel, Set<FR>>.
  const waves = new Map();
  for (const sec of scanWaveSections(planBody).sections) {
    const found = waves.get(sec.label) || new Set();
    for (const fr of sec.lines.join('\n').match(FR_PATTERN) || []) found.add(fr);
    waves.set(sec.label, found);
  }
  return waves;
}

/** Wave ids referenced in a text (`Depends on: Wave 5b, Wave E`). */
function extractWaveRefs(text) {
  return [...text.matchAll(WAVE_REF_RE)].map((m) => m[1]);
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

module.exports = { extractSpecFRs, scanWaveSections, extractWaveFRs, extractWaveRefs, diffFRCoverage };
