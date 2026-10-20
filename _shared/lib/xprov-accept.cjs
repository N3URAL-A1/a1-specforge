'use strict';

// ---------------------------------------------------------------------------
// xprov-accept — the index rows load-check and wave-status accept besides a pass and a waiver (spec 016 FR-025, FR-026).
// Every one is a POINTER: it counts only when the run dir its `result_path` names holds a1's own marker for exactly this PLAN.md sha
// (xprov-runrecord.cjs). Pure over (index, gate, sha); nothing is written.
//   codex_blocked_fallback   twice BLOCKED          a1-blocked.json
//   dispositions             round_cap, no BLOCKER  a1-disposed.json (xprov dispose)
// ---------------------------------------------------------------------------

const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const RR = require('./xprov-runrecord.cjs');
const DL = require('./xprov-delta.cjs');

const DISPOSITIONS = 'dispositions';
const DECLINED = 'secret_declined'; // FR-029: the owner declined the allowlist question for a changed-line hit (xprov dispose --secret-declined)

/** The plan-review side record for `planSha`: { accepted, entry } or null. */
function planSideRecord(index, gate, planSha, root, planText) {
  const fallback = index.find((e) => e.gate === gate && e.reason === X.REASONS.blocked && e.plan_sha256 === planSha && RR.blockedFallbackValid(e.result_path, planSha, 'review', gate, root));
  if (fallback) return Object.freeze({ accepted: X.REASONS.codex_blocked_fallback, entry: fallback });
  const disposed = index.find((e) => e.gate === gate && e.accepted === DISPOSITIONS && e.plan_sha256 === planSha && RR.planDisposed(e.result_path, planSha, root));
  if (disposed) return Object.freeze({ accepted: DISPOSITIONS, entry: disposed });
  const declined = index.find((e) => e.gate === gate && e.accepted === DECLINED && e.plan_sha256 === planSha && RR.declinedMarker(e.result_path, { planSha, gate, wave: null, lane: null }, root));
  if (declined) return Object.freeze({ accepted: DECLINED, entry: declined });
  // FR-030: a whitespace- or heading-only edit of a PLAN.md that passed review keeps the pass (the earlier text is a1's own copy in the pass run dir)
  const carry = typeof planText === 'string' ? DL.cosmeticCarry(index, gate, planText, planSha, root) : null;
  return carry ? Object.freeze({ accepted: 'pass', entry: carry, carried_from: carry.plan_sha256 }) : null;
}

/** The wave candidates of (wave, lane) from side records: [{ kind: 'fallback'|'dispositions', head, base }] — head and base come from the run dir / marker, never the row. */
function waveSideCandidates(index, gate, p, planSha, root) {
  const mine = (e) => e.gate === gate && C.waveNumber(e.wave) === p.wave && C.sameLane(e, p.lane) && e.plan_sha256 === planSha;
  return [
    ...index.filter((e) => mine(e) && e.reason === X.REASONS.blocked).map((e) => RR.blockedFallbackHeadBase(e.result_path, planSha, gate, root)).filter(Boolean).map((hb) => ({ kind: 'fallback', head: hb.head, base: hb.base })),
    ...index.filter((e) => mine(e) && e.accepted === DECLINED).map((e) => RR.declinedMarker(e.result_path, { planSha, gate, wave: p.wave, lane: p.lane }, root)).filter(Boolean).map((m) => ({ kind: DECLINED, head: m.head, base: m.base })),
    ...index.filter((e) => mine(e) && e.accepted === DISPOSITIONS).map((e) => RR.waveDisposedHeadBase(e.result_path, planSha, gate, p.wave, p.lane, root)).filter(Boolean).map((hb) => ({ kind: DISPOSITIONS, head: hb.head, base: hb.base })),
  ];
}

/** The stderr line of a side-record load-check acceptance, or null (pass | waiver). */
const sideNotice = (accepted, blockedNotice) => {
  if (accepted === 'carried') return 'PLAN.md differs from the passed review only in whitespace or heading text; the earlier pass carries (delta review, nothing sent)';
  if (accepted === DECLINED) return 'PLAN.md accepted without Codex: the owner declined the secret-hit allowlist question (Reinhard-only review; xprov dispose --secret-declined)';
  if (accepted === DISPOSITIONS) return 'PLAN.md accepted by recorded round-cap dispositions (no BLOCKER; xprov dispose)';
  return accepted === X.REASONS.codex_blocked_fallback ? blockedNotice : null;
};

module.exports = { DECLINED, DISPOSITIONS, planSideRecord, waveSideCandidates, sideNotice };
