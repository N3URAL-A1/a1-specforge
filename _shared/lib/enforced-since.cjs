'use strict';

// ENFORCED_SINCE — the first day the spec 017 rules apply to a record
// (docs/adr/2026-10-14-gate-invoke-and-log.md §5). Retros dated before it skip
// the gate-log cross-check (FR-009); bug files dated before it skip the
// `class_query` requirement (FR-027). Legacy records are skipped, never rewritten.
//
// Set to the 017 release date (Wave 14, 2026-10-21). Fixtures that need another
// day run against a copy of _shared/ and replace this line; they never edit the real file.
const ENFORCED_SINCE = '2026-10-21';

module.exports = { ENFORCED_SINCE };
