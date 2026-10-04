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
const SHA_RE = /^[0-9a-f]{40,64}$/;

/** The run dir of `resultPath` lies in THIS repository's artifacts dir (realpath). */
function inOwnArtifacts(resultPath) {
  if (typeof resultPath !== 'string' || resultPath === '') return false;
  const A = require('./xprov-artifacts.cjs');
  const root = X.artifactsDir(A.repoSlug());
  const runDir = path.dirname(path.resolve(resultPath));
  return A.isUnder(runDir, root) && path.resolve(runDir) !== path.resolve(root);
}

/** A JSON object read with O_NOFOLLOW (C.readNoFollow), or null. */
function readJsonNoFollow(p) {
  const buf = C.readNoFollow(p);
  if (!buf) return null;
  try { const v = JSON.parse(buf.toString('utf8')); return C.isPlainObject(v) ? v : null; } catch (_e) { return null; }
}

/** result.json of a run dir in our artifacts, or null. */
function runRecord(resultPath) {
  return inOwnArtifacts(resultPath) ? readJsonNoFollow(path.resolve(resultPath)) : null;
}

/** { head, base } of an inspection ONLY from a1-reviewed.json, and only when
 * it agrees with the record's snapshot.base and diff_sha256; else nulls. */
function reviewedHeadBase(resultPath, record) {
  const none = { head: null, base: null };
  const rec = record === undefined ? runRecord(resultPath) : record;
  if (!inOwnArtifacts(resultPath) || !C.isPlainObject(rec) || !C.isPlainObject(rec.snapshot)) return none;
  const rev = readJsonNoFollow(path.join(path.dirname(path.resolve(resultPath)), REVIEWED_FILE));
  if (!rev || !SHA_RE.test(String(rev.commit)) || !SHA_RE.test(String(rev.base))) return none;
  if (rev.base !== rec.snapshot.base || rev.diff_sha256 !== rec.snapshot.diff_sha256) return none;
  return { head: rev.commit, base: rev.base };
}

const approvedAs = (rec, mode, planSha) => C.isPlainObject(rec) && rec.status === 'completed' && rec.mode === mode
  && C.isPlainObject(rec.response) && rec.response.verdict === 'APPROVED' && rec.plan_sha256 === planSha;

/** A plan-review pass row counts only when its run dir holds a completed,
 * APPROVED review of exactly this PLAN.md (load-check, FR-003). */
function planPassValid(resultPath, planSha) {
  return approvedAs(runRecord(resultPath), 'review', planSha);
}

/** A wave pass row counts only through its run dir: a completed, APPROVED
 * inspect of this PLAN.md with a matching a1-reviewed.json → { head, base },
 * else null (wave-status, FR-004). The row's own head/base are never read. */
function inspectPass(resultPath, planSha) {
  const rec = runRecord(resultPath);
  if (!approvedAs(rec, 'inspect', planSha)) return null;
  const hb = reviewedHeadBase(resultPath, rec);
  return hb.head === null ? null : hb;
}

module.exports = { REVIEWED_FILE, inOwnArtifacts, readJsonNoFollow, runRecord, reviewedHeadBase, planPassValid, inspectPass };
