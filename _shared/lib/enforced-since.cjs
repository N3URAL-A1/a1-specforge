'use strict';

// ENFORCED_SINCE — the first day the spec 017 rules apply to a record
// (docs/adr/2026-10-14-gate-invoke-and-log.md §5). Retros dated before it skip
// the gate-log cross-check (FR-009); bug files dated before it skip the
// `class_query` requirement (FR-027). Legacy records are skipped, never rewritten.
//
// PLACEHOLDER: a far-future date keeps every date-gated rule dormant until
// Wave 14 sets the 017 release date. Do not edit before then.
const ENFORCED_SINCE = '2999-12-31';

module.exports = { ENFORCED_SINCE };
