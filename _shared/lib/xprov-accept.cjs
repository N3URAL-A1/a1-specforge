'use strict';

// ---------------------------------------------------------------------------
// xprov-accept — the index rows load-check accepts besides a pass and a waiver (spec 016 FR-025, FR-026).
// Every one is a POINTER: it counts only when the run dir its `result_path` names holds a1's own marker for exactly this PLAN.md sha
// (xprov-runrecord.cjs). Pure over (index, gate, sha); nothing is written.
//   codex_blocked_fallback   twice BLOCKED          a1-blocked.json
//   dispositions             round_cap, no BLOCKER  a1-disposed.json (xprov dispose)
//   codex_unavailable        the Codex run failed   a1-unavailable.json (usage limit, transport error, timeout; spec 025 W6 FR-019)
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
  // SEC-3: an outage never clears open findings — a recorded REVISE (fail-with-findings) for this very PLAN.md and gate keeps the plan unaccepted
  const openFindings = index.some((e) => e.gate === gate && e.verdict === X.VERDICTS.FAIL_WITH_FINDINGS && e.plan_sha256 === planSha);
  const unavailable = openFindings ? undefined : index.find((e) => e.gate === gate && e.reason === X.REASONS.codex_unavailable && e.plan_sha256 === planSha && RR.unavailableValid(e.result_path, planSha, gate, root));
  if (unavailable) return Object.freeze({ accepted: X.REASONS.codex_unavailable, entry: unavailable });
  const disposed = index.find((e) => e.gate === gate && e.accepted === DISPOSITIONS && e.plan_sha256 === planSha && RR.planDisposed(e.result_path, planSha, root));
  if (disposed) return Object.freeze({ accepted: DISPOSITIONS, entry: disposed });
  const declined = index.find((e) => e.gate === gate && e.accepted === DECLINED && e.plan_sha256 === planSha && RR.declinedMarker(e.result_path, { planSha, gate, wave: null, lane: null }, root));
  if (declined) return Object.freeze({ accepted: DECLINED, entry: declined });
  // FR-030: a whitespace- or heading-only edit of a PLAN.md that passed review keeps the pass (the earlier text is a1's own copy in the pass run dir)
  const carry = typeof planText === 'string' ? DL.cosmeticCarry(index, gate, planText, planSha, root) : null;
  return carry ? Object.freeze({ accepted: 'pass', entry: carry, carried_from: carry.plan_sha256 }) : null;
}

/** The stderr line of a side-record load-check acceptance, or null (pass | waiver). */
const UNAVAILABLE_NOTICE = 'not_applicable — the Codex run failed (usage limit or runner error); the Claude-only review (Reinhard; Samuel on a security surface) is the review for this plan, no waiver is needed';
const sideNotice = (accepted, blockedNotice) => {
  if (accepted === X.REASONS.codex_unavailable) return UNAVAILABLE_NOTICE;
  if (accepted === 'carried') return 'PLAN.md differs from the passed review only in whitespace or heading text; the earlier pass carries (delta review, nothing sent)';
  if (accepted === DECLINED) return 'PLAN.md accepted without Codex: the owner declined the secret-hit allowlist question (Reinhard-only review; xprov dispose --secret-declined)';
  if (accepted === DISPOSITIONS) return 'PLAN.md accepted by recorded round-cap dispositions (no BLOCKER; xprov dispose)';
  return accepted === X.REASONS.codex_blocked_fallback ? blockedNotice : null;
};

module.exports = { UNAVAILABLE_NOTICE, DECLINED, DISPOSITIONS, planSideRecord, sideNotice };
