'use strict';

// ---------------------------------------------------------------------------
// xprov-runrecord — what a run dir in a1's own artifacts dir proves (spec 009
// Wave 7; Samuel MAJOR 1 on da103f3, Reinhard M1 on 5f724a9).
//
// index.json is agent-writable, so a row is only a POINTER: normalize (when it
// writes the row) and load-check / wave-status (when they count it) read the
// facts from the run dir the row names — which must lie in this repository's
// 0700 artifacts dir (realpath; never created here) — and nowhere else:
//   - result.json (O_NOFOLLOW): status, mode, verdict, plan_sha256, snapshot;
//   - a1-reviewed.json (O_NOFOLLOW): written by `xprov run` after a clean
//     inspect — {commit, base, diff_sha256}, cross-checked with
//     result.json snapshot.base and diff_sha256.
// A fully forged row plus a forged run dir stays the documented residual
// (ADR §4): the deny/hook guard against accidental or helpful use only.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');

const REVIEWED_FILE = 'a1-reviewed.json';
// a1's own pass marker: written by normalize ONLY when it emits `pass`, so a run
// dir the runner called APPROVED but a1 discarded (secret_in_output, quarantine)
// never counts as a pass and never earns the long retention (Samuel SEC-1).
const PASS_MARKER_FILE = 'a1-pass.json';
const SHA_RE = /^[0-9a-f]{40,64}$/;
// Spec 016 FR-026: a1's marker in the run dir of the SECOND BLOCKED answer of a gate target; load-check and wave-status accept the
// `codex_blocked_fallback` only through it (the index row is a pointer, as for a pass).
const BLOCKED_MARKER_FILE = 'a1-blocked.json';
// Spec 016 FR-025: a1's marker in the run dir of the ROUND-CAP answer (a REVISE without BLOCKER) that `xprov dispose` accepted; load-check and
// wave-status accept the `accepted: dispositions` index row only through it. FINDINGS_FILE is the run-dir findings record normalize writes
// (xprov-normalize.cjs PRIOR_FINDINGS_FILE; a fixture asserts both names stay equal).
const DISPOSED_MARKER_FILE = 'a1-disposed.json';
const FINDINGS_FILE = 'a1-findings.json';
const EXCLUDED_FILE = 'a1-excluded.json'; // FR-029: unchanged files left out of the snapshot (path + rule id), next to the run record

/** The run dir of `resultPath` lies in THIS repository's artifacts dir (realpath). */
function inOwnArtifacts(resultPath, root) {
  if (typeof resultPath !== 'string' || resultPath === '') return false;
  const A = require('./xprov-artifacts.cjs');
  const dir = X.artifactsDir(A.repoSlug(root));
  const runDir = path.dirname(path.resolve(resultPath));
  return A.isUnder(runDir, dir) && path.resolve(runDir) !== path.resolve(dir);
}

/** A JSON object read with O_NOFOLLOW (C.readNoFollow), or null. */
function readJsonNoFollow(p) {
  const buf = C.readNoFollow(p, X.MAX_RESULT_BYTES);
  if (!buf) return null;
  try { const v = JSON.parse(buf.toString('utf8')); return C.isPlainObject(v) ? v : null; } catch (_e) { return null; }
}

/** The run dir holds a1's pass marker (regular file, O_NOFOLLOW) — bound to
 * `planSha` when given: the marker names the PLAN.md the pass was normalized for. */
function hasPassMarker(runDir, planSha) {
  const m = readJsonNoFollow(path.join(runDir, PASS_MARKER_FILE));
  return m !== null && (planSha === undefined || m.plan_sha256 === planSha);
}

// Spec 016 FR-030: a delta plan review sends the changed sections only, so the runner records the sha of THAT text. a1's marker in the run dir
// (written by the gate before normalize) maps it back to the PLAN.md sha it stands for; `runRecord` and normalize read the record through it.
const DELTA_MARKER_FILE = 'a1-delta.json';
const PLAN_COPY_FILE = 'a1-plan.md'; // the approved PLAN.md next to the pass marker (the base of a later delta or cosmetic carry)
const SHA256_RE = /^[0-9a-f]{64}$/;

/** `rec` with plan_sha256 = the full PLAN.md sha when the run dir holds a delta marker for exactly this record, else `rec` itself. */
function mapDelta(rec, resultPath, root) {
  if (!C.isPlainObject(rec) || !inOwnArtifacts(resultPath, root)) return rec;
  const m = readJsonNoFollow(path.join(path.dirname(path.resolve(resultPath)), DELTA_MARKER_FILE));
  return m !== null && SHA256_RE.test(String(m.plan_sha256)) && m.sent_plan_sha256 === rec.plan_sha256 ? { ...rec, plan_sha256: m.plan_sha256, sent_plan_sha256: m.sent_plan_sha256 } : rec;
}

/** Write one of a1's small run-dir files once (0600, wx); true when it is there afterwards. */
function writeRunDirFile(resultPath, name, body, root) {
  if (!inOwnArtifacts(resultPath, root)) return false;
  try { fs.writeFileSync(path.join(path.dirname(path.resolve(resultPath)), name), body, { mode: 0o600, flag: 'wx' }); return true; } catch (e) { return e.code === 'EEXIST'; }
}

/** The gate's note that THIS run saw a delta: { plan_sha256 (full), sent_plan_sha256 (what the runner hashed), base_plan_sha256 }. */
function writeDeltaMarker(resultPath, doc, root) {
  return writeRunDirFile(resultPath, DELTA_MARKER_FILE, `${JSON.stringify({ version: 1, ...doc, ts: new Date().toISOString() }, null, 2)}\n`, root);
}

/** Keep the approved PLAN.md next to the pass marker, only when its bytes hash to the sha the pass names. */
function writePlanCopy(resultPath, planPath, planSha, root) {
  const buf = C.readNoFollow(planPath, X.MAX_RESULT_BYTES * 4);
  return buf !== null && C.sha256(buf) === planSha && writeRunDirFile(resultPath, PLAN_COPY_FILE, buf, root);
}

/** result.json of a run dir in our artifacts, or null (read through the delta marker). */
function runRecord(resultPath, root) {
  return inOwnArtifacts(resultPath, root) ? mapDelta(readJsonNoFollow(path.resolve(resultPath)), resultPath, root) : null;
}

/** { head, base } of an inspection ONLY from a1-reviewed.json, and only when
 * it agrees with the record's snapshot.base and diff_sha256; else nulls. */
function reviewedHeadBase(resultPath, record, root) {
  const none = { head: null, base: null };
  const rec = record === undefined ? runRecord(resultPath, root) : record;
  if (!inOwnArtifacts(resultPath, root) || !C.isPlainObject(rec) || !C.isPlainObject(rec.snapshot)) return none;
  const rev = readJsonNoFollow(path.join(path.dirname(path.resolve(resultPath)), REVIEWED_FILE));
  if (!rev || !SHA_RE.test(String(rev.commit)) || !SHA_RE.test(String(rev.base))) return none;
  if (rev.base !== rec.snapshot.base || rev.diff_sha256 !== rec.snapshot.diff_sha256) return none;
  return { head: rev.commit, base: rev.base };
}

const approvedAs = (rec, mode, planSha) => C.isPlainObject(rec) && rec.status === 'completed' && rec.mode === mode
  && C.isPlainObject(rec.response) && rec.response.verdict === 'APPROVED' && rec.plan_sha256 === planSha;

/** A plan-review pass row counts only when its run dir holds a completed,
 * APPROVED review of exactly this PLAN.md (load-check, FR-003). */
function planPassValid(resultPath, planSha, root) {
  const rec = runRecord(resultPath, root);
  return approvedAs(rec, 'review', planSha) && hasPassMarker(path.dirname(path.resolve(resultPath)), planSha);
}

/** A wave pass row counts only through its run dir: a completed, APPROVED
 * inspect of this PLAN.md with a matching a1-reviewed.json → { head, base },
 * else null (wave-status, FR-004). The row's own head/base are never read. */
function inspectPass(resultPath, planSha, root) {
  const rec = runRecord(resultPath, root);
  if (!approvedAs(rec, 'inspect', planSha) || !hasPassMarker(path.dirname(path.resolve(resultPath)), planSha)) return null;
  const hb = reviewedHeadBase(resultPath, rec, root);
  return hb.head === null ? null : hb;
}

/** The run dir holds a BLOCKED answer for exactly this PLAN.md and gate, with a1's twice-blocked marker; mode: review (plan gate) | inspect (wave gate). */
function blockedFallbackValid(resultPath, planSha, mode, gate, root) {
  const rec = runRecord(resultPath, root);
  if (!C.isPlainObject(rec) || rec.status !== 'completed' || rec.mode !== mode || rec.plan_sha256 !== planSha || !C.isPlainObject(rec.response) || rec.response.verdict !== 'BLOCKED') return false;
  const m = readJsonNoFollow(path.join(path.dirname(path.resolve(resultPath)), BLOCKED_MARKER_FILE));
  return m !== null && m.blocked_twice === true && m.plan_sha256 === planSha && m.gate === gate;
}

/** { head, base } of a valid blocked-fallback inspect run (as inspectPass), else null. */
function blockedFallbackHeadBase(resultPath, planSha, gate, root) {
  if (!blockedFallbackValid(resultPath, planSha, 'inspect', gate, root)) return null;
  const hb = reviewedHeadBase(resultPath, undefined, root);
  return hb.head === null ? null : hb;
}

/** The run dir's findings record when its bytes hash to `sha`, as a parsed object, else null. */
function verifiedFindings(runDir, sha) {
  const bytes = C.readNoFollow(path.join(runDir, FINDINGS_FILE), X.MAX_RESULT_BYTES);
  if (!bytes || typeof sha !== 'string' || C.sha256(bytes) !== sha) return null;
  try { const v = JSON.parse(bytes.toString('utf8')); return C.isPlainObject(v) ? v : null; } catch (_e) { return null; }
}

const laneOrNull = (v) => (v === undefined ? null : v);

/**
 * The disposition marker of a round-cap run dir when everything it claims still holds: the run record is a completed REVISE of the gate's
 * own mode, the marker names this gate, wave, lane and the expected PLAN.md sha at round X.ROUND_CAP, and the run dir's findings record
 * (hash-checked against the marker) holds NO blocker. → the marker object or null. `want`: { planSha, gate, wave, lane }.
 */
function disposedMarker(resultPath, want, root) {
  const rec = runRecord(resultPath, root);
  const mode = want.gate === X.GATE_IDS.PLAN_REVIEW ? 'review' : 'inspect';
  if (!C.isPlainObject(rec) || rec.status !== 'completed' || rec.mode !== mode || !C.isPlainObject(rec.response) || rec.response.verdict !== 'REVISE') return null;
  const runDir = path.dirname(path.resolve(resultPath));
  const m = readJsonNoFollow(path.join(runDir, DISPOSED_MARKER_FILE));
  if (m === null || m.gate !== want.gate || C.waveNumber(m.wave) !== C.waveNumber(want.wave) || laneOrNull(m.lane) !== laneOrNull(want.lane)) return null;
  if (m.plan_sha256 !== want.planSha || m.round !== X.ROUND_CAP || m.reviewed_plan_sha256 !== rec.plan_sha256) return null;
  const doc = verifiedFindings(runDir, m.findings_sha256);
  const blockers = doc === null ? null : doc.blocker;
  return doc !== null && Array.isArray(blockers) && blockers.length === 0 && doc.round === X.ROUND_CAP && doc.gate === want.gate ? m : null;
}

/** Plan gate: the round-cap run dir is disposed for exactly this PLAN.md sha. */
function planDisposed(resultPath, planSha, root) {
  return disposedMarker(resultPath, { planSha, gate: X.GATE_IDS.PLAN_REVIEW, wave: null, lane: null }, root) !== null;
}

/** Wave gate: { head, base } of a disposed round-cap inspect (head = the work path's HEAD at dispose time, base = the reviewed base), else null. */
function waveDisposedHeadBase(resultPath, planSha, gate, wave, lane, root) {
  const m = disposedMarker(resultPath, { planSha, gate, wave, lane }, root);
  if (m === null || !SHA_RE.test(String(m.head)) || !SHA_RE.test(String(m.base))) return null;
  const hb = reviewedHeadBase(resultPath, undefined, root);
  return hb.base === m.base ? { head: m.head, base: m.base } : null;
}

/** Write the excluded-files record into the run dir of `resultPath` (own artifacts only; 0600, once). true when it is there afterwards. */
function writeExcluded(resultPath, excluded, root) {
  if (!inOwnArtifacts(resultPath, root)) return false;
  const file = path.join(path.dirname(path.resolve(resultPath)), EXCLUDED_FILE);
  try {
    fs.writeFileSync(file, `${JSON.stringify({ version: 1, excluded: excluded.map((x) => ({ path: x.path, rule: x.rule })), ts: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return true;
  } catch (e) { return e.code === 'EEXIST'; }
}

/** FR-029: a1's `secret_declined` marker (xprov-decline.cjs) at `resultPath`, bound to the gate, scope and PLAN.md sha. → the marker or null. */
function declinedMarker(resultPath, want, root) {
  if (!inOwnArtifacts(resultPath, root)) return null;
  const m = readJsonNoFollow(path.resolve(resultPath));
  if (m === null || m.kind !== 'secret_declined' || m.gate !== want.gate || m.plan_sha256 !== want.planSha) return null;
  if (C.waveNumber(m.wave) !== C.waveNumber(want.wave) || laneOrNull(m.lane) !== laneOrNull(want.lane)) return null;
  return want.wave === null || (SHA_RE.test(String(m.head)) && SHA_RE.test(String(m.base))) ? m : null;
}

module.exports = { DELTA_MARKER_FILE, PLAN_COPY_FILE, mapDelta, writeDeltaMarker, writePlanCopy, declinedMarker, EXCLUDED_FILE, writeExcluded, REVIEWED_FILE, PASS_MARKER_FILE, BLOCKED_MARKER_FILE, DISPOSED_MARKER_FILE, FINDINGS_FILE, verifiedFindings, disposedMarker, planDisposed, waveDisposedHeadBase, blockedFallbackValid, blockedFallbackHeadBase, hasPassMarker, inOwnArtifacts, readJsonNoFollow, runRecord, reviewedHeadBase, planPassValid, inspectPass };
