'use strict';

// `pr review-record` / `pr review-evidence` (spec 027 FR-019, plan D4).
// review-record is the registered invoke of the prompt gate `pr-reinhard`: the facade hook strips `--phase`,
// appends one gate-log line per call (verdict from the exit code, head_sha from HEAD) and this module only
// validates the call. review-evidence writes nothing: it answers "did Reinhard already pass this head?".

const fs = require('fs');
const gateLog = require('./gate-log.cjs');
const { gitSafe } = require('./git-safe.cjs');
const { emitExit } = require('./emit-exit.cjs');

const GATE = 'pr-reinhard';
const HEX40_RE = /^[0-9a-f]{40}$/;
const VERDICTS = Object.freeze(['pass', 'fail']);
const USAGE = {
  'review-record': 'a1-tools pr review-record --head <40-hex sha> --verdict <pass|fail> --phase <scope>',
  'review-evidence': 'a1-tools pr review-evidence --head <40-hex sha> --phase <scope>',
};

class UsageError extends Error {
  constructor(reason, detail) {
    super(detail || reason);
    this.reason = reason;
  }
}

/** Strict flag parse: only the named flags, each with a value; anything else is a usage error. */
function parseFlags(rest, allowed) {
  const out = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!allowed.includes(a)) throw new UsageError('unknown_flag', `unknown argument ${JSON.stringify(String(a).slice(0, 60))}`);
    if (i + 1 >= rest.length) throw new UsageError('missing_value', `${a} needs a value`);
    out[a.slice(2)] = rest[++i];
  }
  return out;
}

function requireHead(flags) {
  if (typeof flags.head !== 'string' || !HEX40_RE.test(flags.head)) throw new UsageError('head_invalid', '--head must be 40 lowercase hex characters');
  return flags.head;
}

/**
 * The last record of Reinhard for one head sha decides (a later fail overrides an earlier pass).
 * @param {object[]} records verified gate-log records, oldest first
 * @param {string} sha
 * @returns {'pass'|'fail'|'error'|null}
 */
function lastVerdictFor(records, sha) {
  let found = null;
  for (const r of records) if (r.gate === GATE && r.head_sha === sha) found = r.verdict;
  return found;
}

function recordCall(rest) {
  const flags = parseFlags(rest, ['--head', '--verdict']);
  const scope = gateLog.currentScope();
  if (!scope) throw new UsageError('phase_required', '--phase <scope> is required, so the record never lands in _unscoped');
  const head = requireHead(flags);
  if (!VERDICTS.includes(flags.verdict)) throw new UsageError('verdict_invalid', '--verdict must be pass or fail');
  const actual = gitSafe(process.cwd(), ['rev-parse', 'HEAD']);
  if (actual !== head) throw new UsageError('head_mismatch', `--head ${head} is not HEAD ${actual}`);
  const ok = flags.verdict === 'pass';
  const payload = { ok, gate: GATE, head_sha: head, verdict: flags.verdict, scope };
  return emitExit(ok ? 0 : 1, `${JSON.stringify(payload)}\n`, '');
}

function evidenceCall(rest) {
  const flags = parseFlags(rest, ['--head', '--phase']);
  const head = requireHead(flags);
  let scope;
  try { scope = gateLog.validateScope(flags.phase === undefined ? null : flags.phase); } catch (e) { throw new UsageError('phase_required', e.message); }
  const ctx = gateLog.gitContext(process.cwd());
  if (!ctx) throw new UsageError('not_a_repo', 'not inside a git work tree');
  const file = gateLog.logPathFor(ctx.root, scope);
  const no = (reason) => emitExit(1, `${JSON.stringify({ ok: false, reason })}\n`, `pr review-evidence: ${reason}\n`);
  if (!fs.existsSync(file)) return no('no_log');
  let chain;
  try { chain = gateLog.verifyChain(file); } catch (_e) { return no('untrusted_log'); }
  if (!chain.ok) return no('untrusted_log');
  if (lastVerdictFor(chain.records, head) !== 'pass') return no('no_pass_for_head');
  return emitExit(0, `${JSON.stringify({ ok: true, gate: GATE, head_sha: head, scope })}\n`, '');
}

/** @param {string} sub 'review-record' | 'review-evidence' @param {string[]} rest */
function cmdPrReview(sub, rest) {
  try {
    return sub === 'review-record' ? recordCall(rest) : evidenceCall(rest);
  } catch (e) {
    if (!(e instanceof UsageError) && !(e && (e.code === 'A1_INPUT' || /git .* failed/.test(String(e.message))))) throw e;
    const reason = e.reason || 'usage';
    return emitExit(2, `${JSON.stringify({ ok: false, reason })}\n`, `pr ${sub}: ${reason}: ${e.message}\nusage: ${USAGE[sub]}\n`);
  }
}

module.exports = { cmdPrReview, lastVerdictFor };
