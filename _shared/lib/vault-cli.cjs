'use strict';

// ---------------------------------------------------------------------------
// vault-cli — router for the `vault` and `schema` command groups (spec
// 010-vault-cockpit-contract, Wave 1). The facade _shared/a1-tools.cjs holds
// exactly one dispatch line per group and never changes again for this spec;
// every later wave adds ONE line to the table below and nothing else here.
//
// Contract with the facade: a dispatcher returns a JSON-able result that the
// facade prints (exit 0), or the command owns its exit code and calls
// process.exit() itself (then the facade line is unreachable, as for xprov).
// Modules are required lazily so `spec`, `fix`, … never load them.
// ---------------------------------------------------------------------------

const path = require('path');
const { usage } = require('./help.cjs');

const lib = (name) => require(path.join(__dirname, name));

function dispatchVault(sub, rest) {
  // Wave 3: sync, status · Wave 6: lint, link-hub — one line each, added here.
  if (sub === 'link-hub') return lib('vault-hub.cjs').cmdVaultLinkHub(rest);
  if (sub === 'lint') return lib('vault-lint.cjs').cmdVaultLint(rest);
  if (sub === 'sync') return lib('vault-sync.cjs').cmdVaultSync(rest);
  if (sub === 'status') return lib('vault-sync.cjs').cmdVaultStatus(rest);
  usage(`unknown vault subcommand: ${sub}`);
  return undefined; // unreachable — usage() exits 1
}

function dispatchSchema(sub, rest) {
  if (sub === 'export') return lib('vault-contract.cjs').cmdSchemaExport(rest);
  usage(`unknown schema subcommand: ${sub}`);
  return undefined; // unreachable — usage() exits 1
}

module.exports = { dispatchVault, dispatchSchema };
