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
const { LANE_RE, inputError, parseWave } = C;
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
const PATTERNS = Object.freeze(['xprov_finding', 'xprov_waived', 'xprov_not_applicable', 'xprov_disposed']);
const DEFAULT_PROVIDER = 'codex';
const REQUIRED_FLAGS = Object.freeze(['agent', 'skill', 'phase', 'type', 'severity', 'msg']);
const OBSERVATIONS_FILE = 'observations.jsonl';
const OWNER_HANDOFFS_MAX = 99;
const REVIEW_DIR = '.a1-review';
const REVIEW_SUBDIR = 'xreview';
const DIR_MODE = 0o700;

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
  return parseWave(wave, 'wave'); // shared bound 0–9999 (spec 012; was 1–999 here: --wave 1000 passed the gate and failed in observe)
}

function validateMsg(msg) {
  const m = String(msg == null ? '' : msg);
  if (m.trim() === '') throw inputError('--msg must not be empty');
  if (m.includes('\0')) throw inputError('--msg contains a NUL byte');
  if (m.length > xprov.MAX_FIELD_CHARS) throw inputError(`--msg exceeds ${xprov.MAX_FIELD_CHARS} characters (${m.length})`);
  return m;
}

/** The spec 016 FR-035 run fields, each only when given: gate id, owner hand-offs (0..99), codex runs (0|1), abort reason (a reason code or null), recovered (boolean). */
function runFieldsOf(o) {
  const out = {};
  if (o.gate !== undefined) out.gate = oneOf(o.gate, xprov.GATE_ID_LIST, 'gate');
  if (o.ownerHandoffs !== undefined) out.owner_handoffs = boundedInt(o.ownerHandoffs, OWNER_HANDOFFS_MAX, 'owner-handoffs');
  if (o.codexRuns !== undefined) out.codex_runs = boundedInt(o.codexRuns, 1, 'codex-runs');
  if (o.abortReason !== undefined) out.abort_reason = o.abortReason === null ? null : oneOf(o.abortReason, xprov.REASON_LIST, 'abort-reason');
  if (o.recovered !== undefined) {
    if (typeof o.recovered !== 'boolean') throw inputError('--recovered must be true or false');
    out.recovered = o.recovered;
  }
  return out;
}

function boundedInt(value, max, flag) {
  const n = typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(n) || n < 0 || n > max) throw inputError(`--${flag} must be an integer 0..${max}, got ${JSON.stringify(String(value).slice(0, 40))}`);
  return n;
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
  return Object.freeze({ ...obs, ...runFieldsOf(o) });
}

/** `.a1/phases/<name>/observations.jsonl`; the phase directory must already exist. */
function phaseFile(root, phase) {
  const dir = path.join(root, '.a1', 'phases', phase);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw inputError(`phase directory does not exist: ${dir}`, 'phase_missing');
  return path.join(dir, OBSERVATIONS_FILE);
}

/** The `pr-diff-xprov` target `<worktree>/.a1-review/xreview/observations.jsonl` (spec 016 FR-035): an absolute worktree path without `..`,
 * a real directory, and no link anywhere below it (the file is agent-reachable, so a link would redirect the append). */
function reviewFile(worktree) {
  const w = String(worktree == null ? '' : worktree);
  if (!path.isAbsolute(w) || /[\0-\x1f]/.test(w) || w.split(/[\\/]/).includes('..')) throw inputError('--review-worktree must be an absolute path without `..` or control characters', 'worktree_invalid');
  let real;
  try { real = fs.realpathSync(w); } catch (_e) { throw inputError(`--review-worktree does not exist: ${w.slice(0, 120)}`, 'worktree_invalid'); }
  if (!fs.statSync(real).isDirectory()) throw inputError('--review-worktree is not a directory', 'worktree_invalid');
  let dir = real;
  for (const part of [REVIEW_DIR, REVIEW_SUBDIR]) {
    dir = path.join(dir, part);
    let st = null;
    try { st = fs.lstatSync(dir); } catch (_e) { st = null; }
    if (st === null) fs.mkdirSync(dir, { mode: DIR_MODE });
    else if (st.isSymbolicLink() || !st.isDirectory()) throw inputError(`${dir} is not a plain directory`, 'worktree_invalid');
  }
  const file = path.join(dir, OBSERVATIONS_FILE);
  try { if (!fs.lstatSync(file).isFile()) throw inputError(`${file} is not a regular file`, 'worktree_invalid'); } catch (e) { if (e && e.code === 'A1_INPUT') throw e; }
  return file;
}

/** How many lines of the phase file already count a Codex run for this gate target (gate, wave, lane): `codex_runs` is 1 only for the first (FR-022). */
function runsCounted(o) {
  let text = '';
  try { text = fs.readFileSync(o.reviewWorktree === undefined ? phaseFile(o.repoRoot || io.repoRoot(), io.assertSafeSegment(o.phase, '--phase')) : reviewFile(o.reviewWorktree), 'utf8'); } catch (_e) { return 0; }
  const lane = o.lane || null;
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_e) { return null; } })
    .filter((l) => l && l.gate === o.gate && (l.wave === undefined ? null : l.wave) === (o.wave === undefined ? null : o.wave) && (l.lane || null) === lane && l.codex_runs >= 1).length;
}

/** Validates, then appends exactly one line. The phase directory must
 * already exist — observe never creates a phantom phase. */
function observe(opts) {
  const o = opts || {};
  const root = o.repoRoot || io.repoRoot();
  const obs = buildObservation(o);
  const file = o.reviewWorktree === undefined ? phaseFile(root, obs.phase) : reviewFile(o.reviewWorktree);
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
    gate: 'string', 'owner-handoffs': 'string', 'codex-runs': 'string', 'abort-reason': 'string', recovered: 'string', 'review-worktree': 'string',
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
      gate: flags.gate, ownerHandoffs: flags['owner-handoffs'], codexRuns: flags['codex-runs'], reviewWorktree: flags['review-worktree'],
      abortReason: flags['abort-reason'] === undefined ? undefined : (flags['abort-reason'] === 'none' ? null : flags['abort-reason']),
      recovered: flags.recovered === undefined ? undefined : (flags.recovered === 'true' ? true : flags.recovered === 'false' ? false : flags.recovered),
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

module.exports = { EXTERNAL_AGENT, AGENT_RE, MODEL_RE, TYPES, SEVERITIES, PATTERNS, validateAgent, buildObservation, observe, runsCounted, cmdXprovObserve };
