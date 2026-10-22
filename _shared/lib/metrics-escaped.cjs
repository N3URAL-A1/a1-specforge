'use strict';

// metrics escaped — fail-closed stub, replaced in spec 018 wave 2.

function cmdMetricsEscaped(_args) {
  process.stderr.write('error: metrics escaped: not implemented — spec 018 wave 2\n');
  process.exit(2);
}

module.exports = { cmdMetricsEscaped };
