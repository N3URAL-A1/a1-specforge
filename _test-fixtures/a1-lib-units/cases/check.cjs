'use strict';

// check.cjs — the spec<->plan FR coverage primitives under checklist checks
// #9/#10 (a1-new-feature Gate 4.5).

const path = require('path');
const { eq, check, done } = require('../lib.cjs');

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

// C5 — audit F-018: letter-suffixed and letter waves are their own sections.
// Red-making change: restoring the `(\d+)` heading id in check.cjs.
{
  const plan = [
    '## Wave 6 — base', 'FR-001',
    '## Wave 6b — follow-up', 'FR-001 again',
    '## Wave E — result', 'FR-002',
  ].join('\n');
  const w = C.extractWaveFRs(plan);
  eq('C5 wave labels', [...w.keys()], ['Wave 6', 'Wave 6b', 'Wave E']);
  eq('C5 Wave 6 keeps only its own FRs', sorted(w.get('Wave 6')), ['FR-001']);
  eq('C5 Wave E ids', sorted(w.get('Wave E')), ['FR-002']);
  const d = C.diffFRCoverage(new Set(['FR-001', 'FR-002']), w);
  eq('C5 duplicate across 6 and 6b is found', d.duplicatedInPlan, [{ fr: 'FR-001', waves: ['Wave 6', 'Wave 6b'] }]);
}

// C6 — heading problems: unreadable ids and repeats are reported, prose
// headings are not. Red-making change: dropping WAVE_HEADING_LIKE_RE.
{
  const plan = ['## Waves', '## Wave-DAG', '## Wave sequencing', '## Wave 1', '## Wave 6B', '## Wave 2.5', '## Wave 1'].join('\n');
  eq('C6 problems', C.scanWaveSections(plan).problems.map((p) => [p.line, p.reason]), [[5, 'unrecognised'], [6, 'unrecognised'], [7, 'duplicate']]);
  eq('C6 sections', C.scanWaveSections(plan).sections.map((s) => s.label), ['Wave 1', 'Wave 1']);
}

// C7 — audit F-019: a repeated heading adds to the wave instead of replacing it.
// Red-making change: `waves.set(label, found)` without reading the old set.
{
  const w = C.extractWaveFRs('## Wave 7\nFR-001\n## Wave 7\nFR-004');
  eq('C7 union of both blocks', sorted(w.get('Wave 7')), ['FR-001', 'FR-004']);
}

// C8 — dependency references keep suffixed and letter ids.
eq('C8 refs', C.extractWaveRefs('**Depends on:** Wave 5b, Wave E and wave 3'), ['5b', 'E', '3']);
check('C8 no ref in prose without an id', C.extractWaveRefs('the next wave of work').length === 0);

// C9 — fenced code blocks are not requirement text. A plan that documents the
// FR parser's own behaviour (006-specforge-kritis-profile does, in a ``` block
// that prints `"- **FR-012**: text" -> [ 'FR-012' ]`) used to feed those sample
// ids to the gate: measured 2026-10-29 as "phantom FR-012 + FR-001 in two
// waves" on a plan that is otherwise clean. Of the 37 plan/spec pairs in the
// vault only that one changed verdict, so this closes a real hole without
// moving any other project.
// Red-making change: dropping the fence skip from stripFences.
{
  // The spec's fence names FR-012, the plan's fence names FR-013 — neither id
  // exists as real text anywhere. Read raw, FR-013 is a phantom (in the plan,
  // not the spec) and FR-012 is missing (in the spec, not the plan), so all
  // four C9 asserts below are load-bearing, not just the two id sets.
  const spec = 'Real: FR-001 and FR-002.\n```\nexample output: FR-012\n```\n';
  eq('C9 spec ids skip a fenced block', sorted(C.extractSpecFRs(spec)), ['FR-001', 'FR-002']);

  const plan = [
    '## Wave 1', 'covers FR-001',
    '## Wave 2', 'covers FR-002',
    'The parser prints:', '```', '"- **FR-013**: t" -> [ FR-013 ]', 'wave 1 also saw FR-001', '```',
  ].join('\n');
  const w = C.extractWaveFRs(plan);
  eq('C9 Wave 2 ignores the fenced sample ids', sorted(w.get('Wave 2')), ['FR-002']);
  const d = C.diffFRCoverage(C.extractSpecFRs(spec), w);
  eq('C9 no phantom from the fenced sample', d.phantomInPlan, []);
  eq('C9 no duplicate from the fenced sample', d.duplicatedInPlan, []);
  eq('C9 nothing missing', d.missingInPlan, []);
}

// C10 — fence mechanics: tildes, more than three marks, an info string, and an
// unclosed fence (read as plain text, see C12). A fence may be indented inside
// a list item. An inline single backtick is NOT a fence.
{
  eq('C10 tilde fence', sorted(C.extractSpecFRs('FR-001\n~~~\nFR-099\n~~~\n')), ['FR-001']);
  eq('C10 four backticks', sorted(C.extractSpecFRs('FR-001\n````\nFR-099\n````\n')), ['FR-001']);
  eq('C10 info string', sorted(C.extractSpecFRs('FR-001\n```js\nFR-099\n```\n')), ['FR-001']);
  eq('C10 unclosed fence is read as text', sorted(C.extractSpecFRs('FR-001\n```\nFR-099\nFR-098\n')), ['FR-001', 'FR-098', 'FR-099']);
  eq('C10 indented fence in a list item', sorted(C.extractSpecFRs('- FR-001\n  ```\n  FR-099\n  ```\n')), ['FR-001']);
  eq('C10 inline backticks are not a fence', sorted(C.extractSpecFRs('`FR-001` and FR-002')), ['FR-001', 'FR-002']);
  eq('C10 a tilde fence does not close a backtick fence', sorted(C.extractSpecFRs('FR-001\n```\nFR-099\n~~~\nFR-098\n```\nFR-003')), ['FR-001', 'FR-003']);
  // Negative directions: each pins one clause of the closing rule or the opener.
  eq('C10 a shorter run does not close a longer fence', sorted(C.extractSpecFRs('FR-001\n````\nFR-099\n```\nFR-098\n````\nFR-003')), ['FR-001', 'FR-003']);
  eq('C10 a closer with an info string does not close', sorted(C.extractSpecFRs('FR-001\n```\nFR-099\n```js\nFR-098\n```\nFR-003')), ['FR-001', 'FR-003']);
  eq('C10 a backtick in a backtick info string is inline code', sorted(C.extractSpecFRs('```FR-001``` and FR-002\nFR-003\n```\n')), ['FR-001', 'FR-002', 'FR-003']);
  eq('C10 a tilde info string may hold a backtick', sorted(C.extractSpecFRs('FR-001\n~~~ a`b\nFR-099\n~~~\n')), ['FR-001']);
  eq('C10 CRLF fence', sorted(C.extractSpecFRs('FR-001\r\n```\r\nFR-099\r\n```\r\nFR-002')), ['FR-001', 'FR-002']);
  eq('C10 LF opener, CRLF closer', sorted(C.extractSpecFRs('FR-001\n```js\nFR-099\n```\r\nFR-002')), ['FR-001', 'FR-002']);
}

// C11 — a wave heading inside a fenced block is not a wave heading. A plan that
// shows an example plan in a code block used to gain a phantom wave section.
// Red-making change: scanWaveSections reading the raw body again.
{
  // Two headings in the fence: a valid one (`## Wave 9`, which raw parsing turns
  // into a section) and an invalid one (`## Wave 6B`, which raw parsing reports
  // as 'unrecognised'). Without the second, the problems assert would pass
  // either way — measured: a valid fenced heading produces no problem entry.
  const plan = ['## Wave 1', 'FR-001', '```', '## Wave 9', 'FR-099', '## Wave 6B', '```', 'still wave 1: FR-002'].join('\n');
  const w = C.extractWaveFRs(plan);
  eq('C11 the fenced heading is not a wave', [...w.keys()], ['Wave 1']);
  eq('C11 Wave 1 keeps its own ids only', sorted(w.get('Wave 1')), ['FR-001', 'FR-002']);
  eq('C11 no heading problem is reported for a fenced heading', C.scanWaveSections(plan).problems, []);
}

// C12 — a forgotten closer must not hide requirements. Review of 7715ac9: with
// an unclosed fence running to the end of the file, FR-002 vanished from the
// spec, the plan below (FR-001 only) passed check #9, and on main the same
// input failed with FR-002 missing. Red-making change: an unclosed fence
// blanking its tail again.
{
  const spec = 'FR-001 login\n```\nexample\n\nFR-002 must audit-log';
  const d = C.diffFRCoverage(C.extractSpecFRs(spec), C.extractWaveFRs('## Wave 1\ncovers FR-001'));
  eq('C12 the id after an unclosed fence is still missing', d.missingInPlan, ['FR-002']);
}

done();
