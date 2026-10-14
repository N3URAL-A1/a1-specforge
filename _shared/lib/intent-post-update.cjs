'use strict';

// ---------------------------------------------------------------------------
// intent-post-update — `a1-tools intent post-update` (spec 016 FR-033, US-016-8).
// After `claude plugin update a1-specforge` the owner types ONE command: it
// runs `intent seal`, then `intent install-agent --force`, and prints one
// combined result.
//
// Security boundary: this command adds no guard of its own and removes none.
// Both steps run through their own owner-only guards (TTY on stdin and stdout,
// Claude-Code environment and ancestor check via the shared helper
// xprov-approve.claudeContextRefusal, child mode, executor host, typed
// confirmation). The command is a terminal step for the owner and nothing
// else: no argument is accepted (so no `--yes`, no `--force`, no path), the
// install step never runs when the seal step failed, and neither step is
// reachable from an intent child (not in INTENT_CHILD_ALLOWLIST).
//
// Exit contract: 0 both steps done · 1 a step refused (stdout JSON names the
// step and the reason) · 2 usage error.
// ---------------------------------------------------------------------------

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
const DETAIL_MAX = 300;
const ARG_ECHO_MAX = 64;

const COMMAND = 'a1-tools intent post-update';

function usageExit(message) {
  process.stderr.write(`usage error: ${message}\n`);
  process.stderr.write('see: a1-tools --help (section "a1-tools intent")\n');
  process.exitCode = EXIT_USAGE;
}

function refuse(out, step, seal, code, detail, stderrLine) {
  const result = { ok: false, step, reasons: [code], detail: String(detail).slice(0, DETAIL_MAX), ...(seal ? { seal } : {}) };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = EXIT_REFUSED;
  out.write(stderrLine);
}

// deps (fixture seam, library calls only): { seal: <sealPlugin deps>, agent: <installForced deps> }.
function cmdIntentPostUpdate(args, deps = {}) {
  if (args.length > 0) {
    return usageExit(`intent post-update takes no arguments (got ${JSON.stringify(String(args[0]).slice(0, ARG_ECHO_MAX))}); run \`${COMMAND}\` alone on your terminal`);
  }
  const { sealPlugin, SealRefusal } = require('./intent-seal.cjs');
  const { installForced } = require('./intent-agent.cjs');
  const err = process.stderr;
  let sealed;
  try {
    sealed = sealPlugin(deps.seal || {});
  } catch (e) {
    if (!(e instanceof SealRefusal)) throw e;
    return refuse(err, 'seal', null, e.code, e.message, `intent post-update: refused at the seal step (${e.code}); nothing was sealed and the agent was not touched.\n`);
  }
  err.write(`intent post-update: sealed ${sealed.files} files into ${sealed.seal_dir}\n`);
  const installed = installForced(deps.agent || {});
  if (!installed.ok) {
    const r = installed.refusal;
    return refuse(err, 'install-agent', sealed, r.code, r.message, `intent post-update: the seal is done, but the agent install was refused (${r.code}); ${r.outcome} Run \`${COMMAND}\` again after fixing the cause.\n`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, seal: sealed, install_agent: installed.result })}\n`);
  process.exitCode = EXIT_OK;
  err.write(`intent post-update: done. Sealed ${sealed.version}; agent ${installed.result.action}.\n`);
  return undefined;
}

module.exports = { cmdIntentPostUpdate };
