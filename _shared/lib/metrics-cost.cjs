'use strict';

// metrics cost — fail-closed stub, replaced in spec 018 wave 3.

function cmdMetricsCost(_args) {
  process.stderr.write('error: metrics cost: not implemented — spec 018 wave 3\n');
  process.exit(2);
}

module.exports = { cmdMetricsCost };
