'use strict';

// ---------------------------------------------------------------------------
// xprov-gate-nopermit — the "no permit" branch of the gate drivers (spec 016 FR-012; wave 5).
//
// A repository the owner never permitted (state `absent`), whose permit the repository change voided (`origin_changed`, FR-006) or whose
// permit entry carries no evidence (`unbound_legacy`, plan R-3 / spec 016 clarification of 2026-10-14) is not a failure: nothing may
// leave, and the pipeline continues with the Reinhard review. `xprov gate` returns `not_applicable` with reason
// `external_review_not_permitted`, `xprov load-check` and `xprov wave-status` accept it (exit 0).
//
// Fail closed stays for every other state: a denial next to a permit, a permit without its file, an unusable store, a broken audit
// chain, a corrupt `.a1/xprov.json`, an owner-home mismatch. Only the listed states below are "no permit"; the list is closed.
//
// The result carries no a1 write: no PLAN-REVIEW-LOG.md entry, no xreview/, no observation (a repository without permission record gets no
// a1 write, Reinhard PR review MAJOR 1 / fixtures RC9b, R2b). The retro tag `xprov_not_applicable` is written by the skill.
// Pure functions; request-scoped.
// ---------------------------------------------------------------------------

const X = require('./xprov.cjs');
const { STATES } = require('./xprov-permit.cjs');

const NO_PERMIT_STATES = Object.freeze([STATES.ABSENT, STATES.ORIGIN_CHANGED, STATES.UNBOUND_LEGACY]);
const NOTICE = 'not_applicable — no external review permit for this repository (external_review_not_permitted); no code leaves, the pipeline continues with the Reinhard review';

/** True for a permit-check result that is "no permit" (not allowed, and in one of the listed states). */
const isNoPermit = (permit) => Boolean(permit) && permit.ok === false && NO_PERMIT_STATES.includes(permit.state);
const isNoPermitState = (state) => NO_PERMIT_STATES.includes(state);

/** The gate report for a repository without permit: the gate's own `base` fields plus the not_applicable verdict. Nothing is written. */
function result(base, permit) {
  return Object.freeze({
    ...base, verdict: X.VERDICT_NOT_APPLICABLE, step: 'permit-check', reason: X.REASONS.external_review_not_permitted, permit_state: permit.state,
    reason_detail: `no permit (${permit.state}); nothing was sent to the external reviewer`,
  });
}

module.exports = { NO_PERMIT_STATES, NOTICE, isNoPermit, isNoPermitState, result };
