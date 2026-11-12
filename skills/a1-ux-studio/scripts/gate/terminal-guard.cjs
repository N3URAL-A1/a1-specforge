'use strict';
// The terminal check of `ux-gate accept` (spec 024). Used by ux-gate.cjs (friendly message) and by gate-store.cjs recordAccept
// (so the exported store function cannot be called from a script). Null = a real terminal outside Claude Code.

const tty = require('node:tty');

const CONTEXT_GUARD = '../../../../_shared/lib/xprov-approve.cjs';

function safe(v, max) { return String(v ?? '').replace(/[\x00-\x1f]+/g, ' ').slice(0, max); }

/** Null when no Claude Code context is detected; a reason string otherwise (fails closed). The repo's own guard (the one the
 *  xprov owner step uses) is reused: skills/_shared are symlinked side by side by bin/install.sh. */
function claudeContext() {
  try {
    return require(CONTEXT_GUARD).claudeContextRefusal(process.env);
  } catch (err) {
    return `the Claude Code context guard could not be loaded (${safe(err && err.message, 120)})`;
  }
}

/** @returns {string|null} why this process is not Robert at a real terminal, or null. */
function terminalProblem() {
  if (!(tty.isatty(0) && tty.isatty(1))) return 'stdin and stdout are not both a terminal';
  const ctx = claudeContext();
  return ctx === null ? null : `a Claude Code context was detected (${ctx})`;
}

module.exports = { terminalProblem };
