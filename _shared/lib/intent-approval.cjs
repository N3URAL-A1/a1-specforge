'use strict';

// ---------------------------------------------------------------------------
// intent-approval — the approval audit group (spec 011, Wave 10: FR-045).
// Pure functions: no filesystem, no clock. Used by intent-validate (shape and
// environment stage) and intent-sign (canonical string).
//
//   approved_from_device  the original `created_by` (device regex of FR-007)
//   approved_at           ISO-8601 UTC with Z (same form as `created_at`)
//   approved_via          "intent" | "tty"
//   approved_by_intent    the approve intent's lowercase v4 UUID when via is
//                         "intent", null when via is "tty"
//
// All four keys or none (INTENT_APPROVAL_KEYS). Only a1's approve step writes
// them, always under the executor device, so the environment stage refuses
// the group unless `created_by` is the executor device of executor.json — and
// refuses it when no executor device is known. Without the group the
// canonical string is exactly the nine fields of FR-010 (vector S1 holds).
// ---------------------------------------------------------------------------

const { INTENT_APPROVAL_KEYS, INTENT_ID_RE } = require('./intent-constants.cjs');

// The device regex and the timestamp rule of FR-007 have one home,
// intent-validate.cjs. It requires this module at load, so it is required
// here lazily, at call time (a top-level require would be circular).
const validateRules = () => require('./intent-validate.cjs');

const APPROVED_VIA = Object.freeze(['intent', 'tty']);

const has = (fm, key) => Object.prototype.hasOwnProperty.call(fm, key);

// -> the number of group keys present (0 … 4).
function approvalKeyCount(fm) {
  return INTENT_APPROVAL_KEYS.filter((k) => has(fm, k)).length;
}

function approvalGroupPresent(fm) {
  return approvalKeyCount(fm) > 0;
}

// Same form as `created_at`: ISO-8601 UTC with Z, a real instant.
function isUtcTimestamp(v) {
  return validateRules().validateTimestamps({ created_at: v }) === null;
}

// Shape stage: none of the keys, or all four in their forms with `via` and
// `by_intent` paired. -> 'schema_invalid' | null.
function approvalGroupShape(fm) {
  const count = approvalKeyCount(fm);
  if (count === 0) return null;
  if (count !== INTENT_APPROVAL_KEYS.length) return 'schema_invalid';
  const via = fm.approved_via;
  const byIntent = fm.approved_by_intent;
  const paired = (via === 'intent' && typeof byIntent === 'string' && INTENT_ID_RE.test(byIntent))
    || (via === 'tty' && byIntent === null);
  const ok = typeof fm.approved_from_device === 'string' && validateRules().DEVICE_ID_RE.test(fm.approved_from_device)
    && isUtcTimestamp(fm.approved_at)
    && APPROVED_VIA.includes(via)
    && paired;
  return ok ? null : 'schema_invalid';
}

// Environment stage (after authenticity): the group only under the executor
// device; no known executor device -> refused. -> 'schema_invalid' | null.
function approvalGroupEnv(fm, executorDevice) {
  if (!approvalGroupPresent(fm)) return null;
  const known = typeof executorDevice === 'string' && executorDevice !== '';
  return known && fm.created_by === executorDevice ? null : 'schema_invalid';
}

// FR-010 — the four fields after the payload hash, in INTENT_APPROVAL_KEYS
// order, `approved_by_intent` null as ""; [] without the group. A field of
// the wrong type gives null (the canonical string is then null too).
function approvalCanonicalTail(fm) {
  if (!approvalGroupPresent(fm)) return [];
  const tail = INTENT_APPROVAL_KEYS.map((k) => (k === 'approved_by_intent' && fm[k] === null ? '' : fm[k]));
  return tail.every((v) => typeof v === 'string') ? tail : null;
}

module.exports = {
  APPROVED_VIA,
  approvalGroupPresent,
  approvalGroupShape,
  approvalGroupEnv,
  approvalCanonicalTail,
};
