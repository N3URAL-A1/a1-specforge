'use strict';

// dashboard-sources — the section readers (spec 021). Wave 1 ships the stub behind the frozen section
// contract; Wave 2 owns the file. Section contract (all waves):
//   { name: string, state: 'ok' | 'none' | 'not_available', reason?: string, items: string[] }
// collectSections(ctx) returns the six repo/vault sections in note order; the Cost section comes from
// dashboard-cost.cjs.

const SECTION_NAMES = Object.freeze(['Now', 'Next', 'Specs', 'Phases', 'Learnings', 'Open points']);

function collectSections(_ctx) {
  return SECTION_NAMES.map((name) => Object.freeze({
    name, state: 'not_available', reason: 'not_implemented', items: Object.freeze([]),
  }));
}

module.exports = { collectSections, SECTION_NAMES };
