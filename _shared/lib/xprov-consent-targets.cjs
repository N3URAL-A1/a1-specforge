'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-targets — the gate targets of a phase that are failed RIGHT NOW (spec 016 FR-013; wave 3).
//
// The waiver question lists exactly these targets and `consent waive` writes exactly these records; both call `collectTargets` and
// nothing else decides. The facts come from the phase's `xreview/index.json` and from the run records it points to, never from
// agent arguments. An index row is only a POINTER (index.json is agent-writable, see xprov-runrecord.cjs): a row counts as a failure
// only when its run dir lies in this repository's artifacts dir and holds a readable result.json; head and base of a wave come
// from the run dir's a1-reviewed.json, never from the row.
//
// A target is (gate, wave, lane) at the CURRENT PLAN.md sha. It is failed when
//   - the newest failing row (`fail` | `fail-with-findings`, not a `waived` mirror) of that scope and sha is BOUND to a run record
//     (Samuel W3 SEC-2): result.json names this PLAN.md sha and the gate's own mode, and for a wave a verified a1-findings.json names
//     the same gate, wave and lane; a row that is not bound counts for nothing, and
//   - the row's verdict and reason equal what the normalizer's total mapping (`classify`) derives from result.json, else the whole
//     phase is refused (`index_row_mismatch`, SEC-3), and
//   - no valid pass of that scope and sha exists (plan: planPassValid, wave: inspectPass), and
//   - the owner's waiver store holds no waiver for exactly that key.
// A wave without a reviewed head and base (the inspection never completed: blocked, runner_failed) cannot be keyed by the waiver
// store; it is reported in `skipped` and left to the terminal `xprov waive`.
// Open BLOCKER and MAJOR titles are read from the run record's response (never from the row); a fail-with-findings row whose
// a1-findings.json does not match its findings_sha256 lists no finding text (`findings: null`, the question prints a fixed line).
// A round number is shown only when that verified findings record names it.
// Request-scoped: root, phase and the stores are read per call; no module state.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { assertSafeSegment } = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const WV = require('./xprov-waivers.cjs');
const RR = require('./xprov-runrecord.cjs');
const { PRIOR_FINDINGS_FILE, classify } = require('./xprov-normalize.cjs');

const FAIL_VERDICTS = Object.freeze([X.VERDICTS.FAIL, X.VERDICTS.FAIL_WITH_FINDINGS]);
const GATE_ORDER = Object.freeze([X.GATE_IDS.PLAN_REVIEW, X.GATE_IDS.WAVE_INSPECT]);
const WANT_MODE = Object.freeze({ [X.GATE_IDS.PLAN_REVIEW]: 'review', [X.GATE_IDS.WAVE_INSPECT]: 'inspect' }); // the runner mode of each gate (normalize's own rule)
const SEVERITY_BUCKETS = Object.freeze(['blocker', 'major']);
const FINDINGS_PER_BUCKET_MAX = 50; // read bound; the question lists fewer
const ID_MAX_CHARS = 40;

const refuse = (reason, detail) => Object.freeze({ ok: false, reason, detail });
const str = (v) => (typeof v === 'string' ? v : '');

/** The phase directory under `root`, as { phase, phaseDir, planPath, indexPath }; a typed input error for a traversal-shaped or missing phase. */
function phaseOf(root, phaseFlag) {
  const phase = assertSafeSegment(phaseFlag, '--phase');
  const phasesDir = path.join(root, '.a1', 'phases');
  const phaseDir = path.join(phasesDir, phase);
  let st = null;
  try { st = fs.lstatSync(phaseDir); } catch (_e) { st = null; }
  if (st === null || st.isSymbolicLink() || !st.isDirectory()) throw C.inputError(`phase dir not found: ${C.clip(phaseDir, 200)}`, 'phase_not_found');
  return { phase, phaseDir, planPath: path.join(phaseDir, 'PLAN.md'), indexPath: path.join(phaseDir, 'xreview', 'index.json') };
}

/** The run dir's a1-findings.json when its bytes match the row's findings_sha256 (a parsed object), else null. */
function findingsDoc(row, root) {
  if (typeof row.result_path !== 'string' || typeof row.findings_sha256 !== 'string' || !RR.inOwnArtifacts(row.result_path, root)) return null;
  const bytes = C.readNoFollow(path.join(path.dirname(path.resolve(row.result_path)), PRIOR_FINDINGS_FILE), X.MAX_RESULT_BYTES);
  if (!bytes || C.sha256(bytes) !== row.findings_sha256) return null;
  try { const doc = JSON.parse(bytes.toString('utf8')); return C.isPlainObject(doc) ? doc : null; } catch (_e) { return null; }
}

/** The open BLOCKER / MAJOR findings the RUN RECORD's response holds (the normalizer's own mapping): [{ severity, id, title }]. */
function openFindings(derived) {
  return Object.freeze(SEVERITY_BUCKETS.flatMap((bucket) => (Array.isArray(derived.findings) ? derived.findings : []).filter((f) => f.bucket === bucket).slice(0, FINDINGS_PER_BUCKET_MAX)
    .map((f) => ({ severity: bucket, id: C.clip(str(f.id), ID_MAX_CHARS), title: str(f.title) }))));
}

const laneOf = (v) => (v === undefined ? null : v);
const nullable = (v) => (v === undefined ? null : v);

/**
 * One failing index row as a candidate, or null / { skip } (spec 016 Samuel W3 SEC-2). The row is a pointer; it counts only when its run
 * record names THIS PLAN.md sha and the gate's own mode, and (a wave) a verified findings record names the same gate, wave and lane.
 */
function candidate(e, planSha, root) {
  if (!FAIL_VERDICTS.includes(e.verdict) || typeof e.result_path !== 'string') return null;
  const rec = RR.runRecord(e.result_path, root);
  if (rec === null || rec.plan_sha256 !== planSha || rec.mode !== WANT_MODE[e.gate]) return null;
  const wave = C.waveNumber(e.wave);
  const lane = laneOf(e.lane);
  const doc = e.verdict === X.VERDICTS.FAIL_WITH_FINDINGS ? findingsDoc(e, root) : null;
  if (doc !== null && !(doc.gate === e.gate && C.waveNumber(doc.wave) === wave && laneOf(doc.lane) === lane)) return null;
  if (wave !== null && doc === null) return { skip: { gate: e.gate, wave, lane, why: 'no verified findings record' } };
  return { e, rec, doc, wave, lane };
}

const scopeKey = (gate, wave, lane) => `${gate}|${wave === null ? '' : wave}|${lane || ''}`;
const planRows = (index, planSha) => index.filter((e) => e.waived !== true && typeof e.verdict === 'string' && e.plan_sha256 === planSha && GATE_ORDER.includes(e.gate));

/** True when the scope holds a pass whose run dir proves it. */
function passed(rows, gate, planSha, root) {
  return rows.some((e) => e.verdict === X.VERDICTS.PASS && typeof e.result_path === 'string'
    && (gate === X.GATE_IDS.PLAN_REVIEW ? RR.planPassValid(e.result_path, planSha, root) : RR.inspectPass(e.result_path, planSha, root) !== null));
}

function covered(store, key) {
  if (key.gate === X.GATE_IDS.PLAN_REVIEW) return WV.planWaiver(store, key) !== null;
  return WV.waveWaivers(store, key).some((w) => w.head === key.head && w.base === key.base);
}

/** One target for the newest failing row of a scope, or { skipped } / null. */
function targetOf(scopeRows, base, root, store) {
  const cands = scopeRows.map((e) => candidate(e, base.planSha, root)).filter((c) => c !== null);
  const real = cands.filter((c) => !c.skip);
  if (real.length === 0) return cands.length === 0 ? null : { skipped: cands[cands.length - 1].skip };
  const { e: row, rec, doc, wave, lane } = real[real.length - 1];
  if (lane !== null && !C.LANE_RE.test(String(lane))) return null;
  // SEC-3: verdict and reason come from the run record by the normalizer's own total mapping; a row that says otherwise is a lie.
  const derived = classify(rec, base.planSha);
  if (derived.verdict !== row.verdict || nullable(derived.reason) !== nullable(row.reason)) {
    return { refuse: refuse('index_row_mismatch', `the index row for ${row.gate}${wave === null ? '' : ` wave ${wave}`} says ${row.verdict}/${nullable(row.reason)} but its run record gives ${derived.verdict}/${nullable(derived.reason)}; no chat waiver is offered for this phase: waive that target with the terminal command; nothing written`) };
  }
  if (doc !== null && Number.isInteger(row.round) && doc.round !== row.round) {
    return { refuse: refuse('index_row_mismatch', `the index row for ${row.gate}${wave === null ? '' : ` wave ${wave}`} names round ${row.round} but its findings record names round ${nullable(doc.round)}; no chat waiver is offered for this phase; nothing written`) };
  }
  const hb = wave === null ? { head: null, base: null } : RR.reviewedHeadBase(row.result_path, rec, root);
  const key = { repo: base.repo, phase: base.phase, gate: row.gate, plan_sha256: base.planSha, wave, lane, head: hb.head, base: hb.base };
  if (wave !== null && hb.head === null) return { skipped: { gate: row.gate, wave, lane, why: 'no reviewed head and base' } };
  if (covered(store, key)) return null;
  const unverified = row.verdict === X.VERDICTS.FAIL_WITH_FINDINGS && doc === null; // the findings record does not match its hash: no finding text is shown
  return { target: Object.freeze({
    key: Object.freeze(key), verdict: derived.verdict, reason: typeof derived.reason === 'string' && X.REASON_LIST.includes(derived.reason) ? derived.reason : null,
    round: doc !== null && Number.isInteger(row.round) ? row.round : null,
    findings: unverified ? null : openFindings(derived), quarantined: doc !== null && Array.isArray(doc.quarantined) ? doc.quarantined.length : 0,
  }) };
}

const order = (a, b) => GATE_ORDER.indexOf(a.key.gate) - GATE_ORDER.indexOf(b.key.gate) || (a.key.wave || 0) - (b.key.wave || 0) || String(a.key.lane).localeCompare(String(b.key.lane));

/**
 * `o`: { root (checkout toplevel), phase }. Returns { ok: true, repo, phase, planSha, targets: [...], skipped: [...] } (targets sorted,
 * possibly empty) or a refusal { ok: false, reason, detail }. Throws a typed input error for a traversal-shaped or unknown phase.
 */
function collectTargets(o) {
  const ctx = phaseOf(o.root, o.phase);
  const repo = C.commonDirOf(o.root);
  if (repo === null) return refuse('not_a_repository', `${o.root} is not a git repository`);
  const planBytes = C.readNoFollow(ctx.planPath, X.MAX_RESULT_BYTES * 4);
  if (!planBytes) return refuse('plan_missing', `PLAN.md not found (or not a regular file) in the phase ${C.clip(ctx.phase, 80)}`);
  const index = C.readIndex(ctx.indexPath);
  if (index === null) return refuse('index_unreadable', 'xreview/index.json is unparseable or not an array of objects');
  const store = WV.readWaivers();
  if (!store.ok && !store.missing) return refuse('waiver_store_unusable', `the waiver store is not usable (${store.why}); fix or remove it yourself; nothing written`);
  const planSha = C.sha256(planBytes);
  const base = { repo, phase: ctx.phase, planSha };
  const rows = planRows(index, planSha);
  const scopes = new Map();
  for (const e of rows) {
    const k = scopeKey(e.gate, C.waveNumber(e.wave), e.lane);
    scopes.set(k, [...(scopes.get(k) || []), e]);
  }
  const targets = [];
  const skipped = [];
  for (const scopeRows of scopes.values()) {
    const gate = scopeRows[0].gate;
    if (passed(scopeRows, gate, planSha, o.root)) continue;
    const t = targetOf(scopeRows, base, o.root, store);
    if (t === null) continue;
    if (t.refuse) return t.refuse;
    if (t.skipped) skipped.push(Object.freeze(t.skipped)); else targets.push(t.target);
  }
  return Object.freeze({ ok: true, repo, phase: ctx.phase, planSha, ctx, targets: Object.freeze(targets.sort(order)), skipped: Object.freeze(skipped) });
}

module.exports = { collectTargets, phaseOf, order };
