'use strict';

// dashboard-cost — the Cost section (spec 021). Wave 1 ships the stub behind the frozen section contract
// (see dashboard-sources.cjs); Wave 4 owns the file.

function costSection(_ctx) {
  return Object.freeze({ name: 'Cost', state: 'not_available', reason: 'not_implemented', items: Object.freeze([]) });
}

module.exports = { costSection };
