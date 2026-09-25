'use strict';

// ---------------------------------------------------------------------------
// xprov observe — spec 009-cross-provider-review-gate, Wave 4 (FR-025,
// FR-026). Sole writer: this wave.
//
// Appends ONE observation line per gate run to
// `.a1/phases/<name>/observations.jsonl`, attributed to the external reviewer.
// `agent` is validated against constitution invariant 5 (`a1-<vorname>-<rolle>`)
// or the single documented exception `xprov-codex`, whose owner is
// `_shared/learning-schema.md` ("External reviewer attribution"). Anything
// else — a first-name shorthand like `a1-victor`, a bare provider name like
// `codex` — exits 1 and writes nothing.
//
// `model_observed` is never derived from `model_requested` (FR-013): it is
// whatever the caller measured, else the literal `unknown`.
//
// The append is the one non-atomic write in the xprov plan: a single
// `appendFileSync` of one line, matching how Erik and Victor write today.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const io = require('./io.cjs');
const xprov = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
// Shared helpers — one definition each, in xprov-common.cjs.
const { LANE_RE, inputError, parsePositive } = C;
const usageExit = (msg) => C.usageExit('', msg);
const finish = (report, code) => C.emitJson(report, code, false);
const resolveRepoFlag = (flag) => (flag === undefined ? undefined : C.resolveRepoFlag(flag));

const AGENT_RE = /^a1-[a-z]+-[a-z-]+$/;
const EXTERNAL_AGENT = 'xprov-codex';
const SKILL_RE = /^a1-[a-z][a-z-]*$/;
const PROVIDER_RE = /^[a-z][a-z0-9-]{0,31}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()\/:-]{0,79}$/;
const TYPES = Object.freeze(['gap', 'blocker']);
const SEVERITIES = Object.freeze(['minor', 'major', 'critical']);
const PATTERNS = Object.freeze(['xprov_finding', 'xprov_waived']);
const DEFAULT_PROVIDER = 'codex';
const REQUIRED_FLAGS = Object.freeze(['agent', 'skill', 'phase', 'type', 'severity', 'msg']);
const OBSERVATIONS_FILE = 'observations.jsonl';

function validateAgent(agent) {
  const a = String(agent == null ? '' : agent);
  if (a === EXTERNAL_AGENT || AGENT_RE.test(a)) return a;
  throw inputError(`--agent ${JSON.stringify(a.slice(0, 80))} is not allowed: constitution invariant 5 requires the full a1-<vorname>-<rolle> name; the single documented exception is ${EXTERNAL_AGENT} (owner: _shared/learning-schema.md)`, 'agent_not_allowed');
}

function oneOf(value, allowed, flag) {
  const v = String(value == null ? '' : value);
  if (!allowed.includes(v)) throw inputError(`--${flag} must be one of ${allowed.join('|')}, got ${JSON.stringify(v.slice(0, 80))}`);
  return v;
}

function matching(value, re, flag) {
  const v = String(value == null ? '' : value);
  if (!re.test(v)) throw inputError(`--${flag} has an unexpected shape, got ${JSON.stringify(v.slice(0, 80))}`);
  return v;
}

function validateWave(wave) {
  if (wave === undefined || wave === null || wave === '') return null;
  parsePositive(wave, 'wave'); // shared bound 1–9999 (was 1–999 here: --wave 1000 passed the gate and failed in observe)
  return Number(wave);
}

function validateMsg(msg) {
  const m = String(msg == null ? '' : msg);
  if (m.trim() === '') throw inputError('--msg must not be empty');
  if (m.includes('\0')) throw inputError('--msg contains a NUL byte');
  if (m.length > xprov.MAX_FIELD_CHARS) throw inputError(`--msg exceeds ${xprov.MAX_FIELD_CHARS} characters (${m.length})`);
  return m;
}

/** Builds the frozen observation object from raw flag values; throws
 * A1_INPUT on every invalid field. Field order is the schema's order. */
function buildObservation(o) {
  const obs = {
    ts: o.ts || io.nowIso(),
    agent: validateAgent(o.agent),
    skill: matching(o.skill, SKILL_RE, 'skill'),
    phase: io.assertSafeSegment(o.phase, '--phase'),
    wave: validateWave(o.wave),
  };
  if (o.lane !== undefined && o.lane !== null && o.lane !== '') obs.lane = matching(o.lane, LANE_RE, 'lane');
  obs.type = oneOf(o.type, TYPES, 'type');
  obs.severity = oneOf(o.severity, SEVERITIES, 'severity');
  obs.msg = validateMsg(o.msg);
  obs.pattern = oneOf(o.pattern === undefined ? PATTERNS[0] : o.pattern, PATTERNS, 'pattern');
  obs.provider = matching(o.provider === undefined ? DEFAULT_PROVIDER : o.provider, PROVIDER_RE, 'provider');
  obs.model_requested = matching(o.modelRequested === undefined ? xprov.MODEL_REQUESTED_DEFAULT : o.modelRequested, MODEL_RE, 'model-requested');
  obs.model_observed = matching(o.modelObserved === undefined ? xprov.MODEL_OBSERVED_UNKNOWN : o.modelObserved, MODEL_RE, 'model-observed');
  return Object.freeze(obs);
}

/** Validates, then appends exactly one line. The phase directory must
 * already exist — observe never creates a phantom phase. */
function observe(opts) {
  const o = opts || {};
  const root = o.repoRoot || io.repoRoot();
  const obs = buildObservation(o);
  const dir = path.join(root, '.a1', 'phases', obs.phase);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw inputError(`phase directory does not exist: ${dir}`, 'phase_missing');
  }
  const file = path.join(dir, OBSERVATIONS_FILE);
  const line = JSON.stringify(obs);
  fs.appendFileSync(file, `${line}\n`, 'utf8');
  return Object.freeze({ ok: true, file, observation: obs });
}

// ---------- CLI ----------

// stdout/exitCode plumbing and --repo resolution come from xprov-common.cjs.

function cmdXprovObserve(args) {
  const flags = io.parseFlags(args || [], {
    agent: 'string', skill: 'string', phase: 'string', wave: 'string', lane: 'string',
    type: 'string', severity: 'string', msg: 'string', pattern: 'string', provider: 'string',
    'model-requested': 'string', 'model-observed': 'string', repo: 'string',
  });
  if (flags._.length) return usageExit(`observe: unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  const missing = REQUIRED_FLAGS.filter((f) => flags[f] === undefined);
  if (missing.length) return usageExit(`observe requires --${missing.join(' --')}`);
  let root;
  try { root = resolveRepoFlag(flags.repo); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usageExit(`observe: ${e.message}`);
    throw e;
  }
  let r;
  try {
    r = observe({
      repoRoot: root,
      agent: flags.agent, skill: flags.skill, phase: flags.phase, wave: flags.wave, lane: flags.lane,
      type: flags.type, severity: flags.severity, msg: flags.msg, pattern: flags.pattern, provider: flags.provider,
      modelRequested: flags['model-requested'], modelObserved: flags['model-observed'],
    });
  } catch (e) {
    if (e && e.code === 'A1_INPUT') {
      process.stderr.write(`error: xprov observe: ${e.message}\n`);
      return finish({ ok: false, reason: e.reason || 'invalid_input' }, xprov.EXIT_FAIL);
    }
    throw e;
  }
  process.stderr.write(`observe: appended 1 line to ${r.file}\n`);
  return finish(r, xprov.EXIT_PASS);
}

module.exports = { EXTERNAL_AGENT, AGENT_RE, MODEL_RE, TYPES, SEVERITIES, PATTERNS, validateAgent, buildObservation, observe, cmdXprovObserve };
