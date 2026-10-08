'use strict';

// check.cjs — the spec<->plan FR coverage primitives under checklist checks
// #9/#10 (a1-new-feature Gate 4.5).

const path = require('path');
const { eq, done } = require('../lib.cjs');

const C = require(path.join(process.argv[2], 'check.cjs'));
const sorted = (set) => [...set].sort();

// C1 — spec FR ids: unique, three or more digits, sub-numbers kept distinct.
// Red-making change: dropping the `(?:-\d+)?` group of FR_PATTERN.
eq('C1 unique ids', sorted(C.extractSpecFRs('FR-001 and FR-001 and FR-002')), ['FR-001', 'FR-002']);
eq('C1 sub-numbered ids stay distinct', sorted(C.extractSpecFRs('FR-014-1, FR-014-2')), ['FR-014-1', 'FR-014-2']);
eq('C1 two digits are not an id', sorted(C.extractSpecFRs('FR-01 FR-1')), []);
eq('C1 four digits are an id', sorted(C.extractSpecFRs('FR-1234')), ['FR-1234']);
eq('C1 glued prefix is not an id', sorted(C.extractSpecFRs('XFR-001 FR-001x')), []);
eq('C1 empty body', sorted(C.extractSpecFRs('')), []);

// C2 — wave sections split on `## Wave N`.
{
  const plan = [
    'Intro mentions FR-099', // before any wave: ignored
    '## Wave 1 — setup',
    'covers FR-001, FR-002',
    '### Wave 9 is a sub-heading', // not a wave heading
    'and FR-003',
    '## wave 2',
    'FR-002 again',
    '## Wave 3',
  ].join('\n');
  const w = C.extractWaveFRs(plan);
  eq('C2 wave labels', [...w.keys()], ['Wave 1', 'Wave 2', 'Wave 3']);
  eq('C2 Wave 1 ids (sub-heading text stays in the wave)', sorted(w.get('Wave 1')), ['FR-001', 'FR-002', 'FR-003']);
  eq('C2 lower-case heading accepted', sorted(w.get('Wave 2')), ['FR-002']);
  eq('C2 empty wave', sorted(w.get('Wave 3')), []);
  eq('C2 no wave headings', C.extractWaveFRs('FR-001 only').size, 0);
  eq('C2 "## Wave10" (no space) is not a wave', C.extractWaveFRs('## Wave10\nFR-001').size, 0);
}

// C3 — coverage diff: missing, phantom, duplicated (all sorted).
{
  const spec = new Set(['FR-003', 'FR-001', 'FR-002']);
  const waves = new Map([['Wave 1', new Set(['FR-002', 'FR-009'])], ['Wave 2', new Set(['FR-002', 'FR-001', 'FR-007'])]]);
  const d = C.diffFRCoverage(spec, waves);
  eq('C3 missing in plan', d.missingInPlan, ['FR-003']);
  eq('C3 phantom in plan', d.phantomInPlan, ['FR-007', 'FR-009']);
  eq('C3 duplicated in plan', d.duplicatedInPlan, [{ fr: 'FR-002', waves: ['Wave 1', 'Wave 2'] }]);
  eq('C3 plan ids', sorted(d.planFRs), ['FR-001', 'FR-002', 'FR-007', 'FR-009']);
}

// C4 — the 2026-09-01 regression: a plan that drops FR-014-2 must not pass.
{
  const spec = C.extractSpecFRs('FR-014-1 login\nFR-014-2 logout');
  const d = C.diffFRCoverage(spec, C.extractWaveFRs('## Wave 1\nimplements FR-014-1'));
  eq('C4 dropped sub-requirement is missing', d.missingInPlan, ['FR-014-2']);
}

done();
