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

/** result.json of a run dir in our artifacts, or null. */
function runRecord(resultPath, root) {
  return inOwnArtifacts(resultPath, root) ? readJsonNoFollow(path.resolve(resultPath)) : null;
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

module.exports = { REVIEWED_FILE, PASS_MARKER_FILE, BLOCKED_MARKER_FILE, blockedFallbackValid, blockedFallbackHeadBase, hasPassMarker, inOwnArtifacts, readJsonNoFollow, runRecord, reviewedHeadBase, planPassValid, inspectPass };
