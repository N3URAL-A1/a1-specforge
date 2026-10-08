'use strict';

// intent-approval.cjs — the approval audit group of an intent (spec 011,
// Wave 10: FR-045). Pure functions; the signer and validator rely on them.

const path = require('path');
const { check, eq, done } = require('../lib.cjs');

const A = require(path.join(process.argv[2], 'intent-approval.cjs'));

const UUID = '3f2b8c1e-9d4a-4e6b-8a1c-0123456789ab';
const base = { created_by: 'mac-mini', created_at: '2026-10-08T08:00:00Z' };
const viaIntent = { ...base, approved_from_device: 'iphone-rob', approved_at: '2026-10-08T08:05:00Z', approved_via: 'intent', approved_by_intent: UUID };
const viaTty = { ...viaIntent, approved_via: 'tty', approved_by_intent: null };
const shape = (fm) => A.approvalGroupShape(fm);

eq('A0 approved_via values', A.APPROVED_VIA, ['intent', 'tty']);

// A1 — no group: nothing to check, the canonical tail is empty.
eq('A1 no group: shape ok', shape(base), null);
eq('A1 no group: env ok without executor', A.approvalGroupEnv(base, undefined), null);
eq('A1 no group: tail []', A.approvalCanonicalTail(base), []);
eq('A1 no group: not present', A.approvalGroupPresent(base), false);

// A2 — the two valid pairings.
eq('A2 via intent with uuid: ok', shape(viaIntent), null);
eq('A2 via tty with null: ok', shape(viaTty), null);

// A3 — all four keys or none. Not a RED-proof case: the count check and the
// per-field form checks both reject a partial group, so removing the count
// check alone keeps A3 green (measured 2026-10-08).
for (const k of ['approved_from_device', 'approved_at', 'approved_via', 'approved_by_intent']) {
  const fm = { ...viaIntent };
  delete fm[k];
  eq(`A3 missing ${k}: invalid`, shape(fm), 'schema_invalid');
}
eq('A3 one key set to undefined still counts as present', shape({ ...base, approved_via: undefined }), 'schema_invalid');

// A4 — via and by_intent must pair.
eq('A4 via intent with null: invalid', shape({ ...viaIntent, approved_by_intent: null }), 'schema_invalid');
eq('A4 via tty with uuid: invalid', shape({ ...viaTty, approved_by_intent: UUID }), 'schema_invalid');
eq('A4 via tty with "": invalid', shape({ ...viaTty, approved_by_intent: '' }), 'schema_invalid');
eq('A4 unknown via: invalid', shape({ ...viaIntent, approved_via: 'cli' }), 'schema_invalid');

// A5 — field forms.
eq('A5 uppercase uuid: invalid', shape({ ...viaIntent, approved_by_intent: UUID.toUpperCase() }), 'schema_invalid');
eq('A5 non-v4 uuid: invalid', shape({ ...viaIntent, approved_by_intent: '3f2b8c1e-9d4a-1e6b-8a1c-0123456789ab' }), 'schema_invalid');
eq('A5 uppercase device: invalid', shape({ ...viaIntent, approved_from_device: 'Mac-Mini' }), 'schema_invalid');
eq('A5 device with a slash: invalid', shape({ ...viaIntent, approved_from_device: '../etc' }), 'schema_invalid');
eq('A5 non-Z timestamp: invalid', shape({ ...viaIntent, approved_at: '2026-10-08T08:05:00+02:00' }), 'schema_invalid');
eq('A5 impossible date: invalid', shape({ ...viaIntent, approved_at: '2026-02-30T08:05:00Z' }), 'schema_invalid');
eq('A5 numeric timestamp: invalid', shape({ ...viaIntent, approved_at: 1759910700 }), 'schema_invalid');
eq('A5 oversized device: invalid', shape({ ...viaIntent, approved_from_device: 'a'.repeat(10000) }), 'schema_invalid');

// A6 — environment stage: the group only under the known executor device.
// Red-making change: treating an unknown executor device as "no check".
eq('A6 created_by is the executor: ok', A.approvalGroupEnv(viaIntent, 'mac-mini'), null);
eq('A6 created_by is another device: invalid', A.approvalGroupEnv(viaIntent, 'other-host'), 'schema_invalid');
eq('A6 no executor device known: invalid', A.approvalGroupEnv(viaIntent, undefined), 'schema_invalid');
eq('A6 empty executor device: invalid', A.approvalGroupEnv(viaIntent, ''), 'schema_invalid');

// A7 — canonical tail: fixed order, tty's null as "".
eq('A7 tail via intent', A.approvalCanonicalTail(viaIntent), ['iphone-rob', '2026-10-08T08:05:00Z', 'intent', UUID]);
eq('A7 tail via tty', A.approvalCanonicalTail(viaTty), ['iphone-rob', '2026-10-08T08:05:00Z', 'tty', '']);
eq('A7 tail with a wrong-typed field is null', A.approvalCanonicalTail({ ...viaIntent, approved_at: 1759910700 }), null);
check('A7 tail ignores key order of the input', JSON.stringify(A.approvalCanonicalTail({ approved_by_intent: UUID, approved_via: 'intent', approved_at: '2026-10-08T08:05:00Z', approved_from_device: 'iphone-rob' })) === JSON.stringify(A.approvalCanonicalTail(viaIntent)));

done();
