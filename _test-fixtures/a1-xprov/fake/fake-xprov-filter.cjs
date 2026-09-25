'use strict';

// Fake `xprov-filter.cjs` for part 02 (normalize). The harness owns the temp
// tree, so part 02 copies this file to <TREE>/_shared/lib/xprov-filter.cjs —
// the Wave 3 module is not under test there, normalize's WIRING is: does it
// call both hooks, and does it honour their verdicts?
//
// Contract normalize relies on (Wave 3 implements the real thing):
//   filterOutput(texts: string[])            → { hit: boolean, pattern_name: string|null }
//   quarantineFindings(findings, ctx)        → { kept: finding[], quarantined: (finding & {reason})[] }
//     ctx = { lsFiles: Set<string>, planPath: string, repoRoot: string }
//
// Pass-through by default. Env switches let a case force a verdict:
//   FAKE_FILTER_HIT=<pattern-name>   filterOutput reports a hit (never the text)
//   FAKE_FILTER_QUARANTINE=1         every finding is quarantined (reason fake_quarantine)
//   FAKE_FILTER_CALLS=<file>         append one line per hook call (proves the call happened)
//   FAKE_FILTER_BROKEN=1             both hooks return undefined (contract violation)

const fs = require('fs');

function note(hook, detail) {
  const f = process.env.FAKE_FILTER_CALLS;
  if (f) fs.appendFileSync(f, `${hook} ${detail}\n`);
}

function filterOutput(texts) {
  note('filterOutput', `texts=${Array.isArray(texts) ? texts.length : 'not-array'}`);
  if (process.env.FAKE_FILTER_BROKEN === '1') return undefined;
  const name = process.env.FAKE_FILTER_HIT;
  return name ? { hit: true, pattern_name: name } : { hit: false, pattern_name: null };
}

function quarantineFindings(findings, ctx) {
  const list = Array.isArray(findings) ? findings : [];
  note('quarantineFindings', `findings=${list.length} lsFiles=${ctx && ctx.lsFiles ? ctx.lsFiles.size : 'none'} planPath=${ctx ? ctx.planPath : 'none'}`);
  if (process.env.FAKE_FILTER_BROKEN === '1') return undefined;
  const notes = process.env.FAKE_FILTER_NOTES ? [process.env.FAKE_FILTER_NOTES] : [];
  if (process.env.FAKE_FILTER_QUARANTINE === '1') {
    return { kept: [], quarantined: list.map((f) => ({ ...f, reason: 'fake_quarantine' })), notes };
  }
  return { kept: [...list], quarantined: [], notes };
}

module.exports = { filterOutput, quarantineFindings };
