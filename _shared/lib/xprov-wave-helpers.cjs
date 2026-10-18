'use strict';

// ---------------------------------------------------------------------------
// xprov-wave-helpers — the pure helpers of `xprov wave-status` (moved out of xprov-gate.cjs unchanged in spec 016 wave 10, which needed the
// room: the gate file was at its size limit). Nothing here reads the registry, the permit or the index.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const C = require('./xprov-common.cjs');
const WV = require('./xprov-waivers.cjs');

const { inputError, clip, parseWave } = C;
const WAVE_HEADING_RE = /^##\s+Wave\s+(\d+)\b/;

/** Completed (wave, lane) pairs from STATUS.md (lane null) and every
 * STATUS-<lane>.md (lane from the file name) — `## Wave N` headings. A
 * STATUS.md heading whose wave number a STATUS-<lane>.md also lists is the
 * lane consolidation (a1-execute merges lane files into STATUS.md before
 * Victor), not a lane-null wave: it is skipped (Reinhard M2). Sequential
 * waves after the lanes carry their own numbers and still count. */
function completedWavesFromStatus(phaseDir) {
  const headings = (f) => fs.readFileSync(path.join(phaseDir, f), 'utf8').split('\n').map((l) => l.match(WAVE_HEADING_RE)).filter(Boolean).map((w) => Number(w[1]));
  const files = fs.readdirSync(phaseDir).sort().map((f) => ({ f, m: f.match(/^STATUS(?:-([A-Za-z0-9_-]+))?\.md$/) })).filter((x) => x.m);
  const laneWaves = new Set(files.filter((x) => x.m[1]).flatMap((x) => headings(x.f)));
  const pairs = [];
  for (const { f, m } of files) {
    const lane = m[1] || null;
    for (const wave of headings(f)) {
      if (lane === null && laneWaves.has(wave)) continue;
      if (!pairs.some((p) => p.wave === wave && p.lane === lane)) pairs.push({ wave, lane });
    }
  }
  return pairs.sort((a, b) => a.wave - b.wave || String(a.lane).localeCompare(String(b.lane)));
}

/** --waves 1,2 [--lane L] → (wave, lane) pairs; lanes are first-class keys. */
function parseWavesFlag(value, lane) {
  const waves = String(value).split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseWave(s, 'waves'));
  if (!waves.length) throw inputError('--waves must list at least one wave number');
  return [...new Set(waves)].sort((a, b) => a - b).map((wave) => ({ wave, lane: lane || null }));
}

/** The waves whose chosen coverage is of `kind` (fallback | dispositions). */
function kindWaves(completed, chosen, kind) {
  return [...new Set(completed.filter((p) => { const c = chosen.get(`${p.wave}|${p.lane || ''}`); return c != null && c.kind === kind; }).map((p) => p.wave))];
}

/** --lane-work-path L=dir[,L2=dir]: each lane's work path (same git-common-dir) and HEAD. */
function laneTips(value, repo) {
  const tips = {};
  if (value === undefined) return tips;
  for (const part of String(value).split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    const lane = C.parseLane(i > 0 ? part.slice(0, i) : '');
    if (!lane) throw inputError(`--lane-work-path entries are <lane>=<dir>, got ${JSON.stringify(clip(part, 80))}`);
    const dir = path.resolve(part.slice(i + 1));
    const h = WV.headIn(dir, repo);
    if (h.problem) throw inputError(h.problem);
    tips[lane] = { workPath: dir, head: h.head };
  }
  return tips;
}

module.exports = { WAVE_HEADING_RE, completedWavesFromStatus, parseWavesFlag, kindWaves, laneTips };
