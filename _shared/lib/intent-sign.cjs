'use strict';

// ---------------------------------------------------------------------------
// intent-sign — canonical string, HMAC signature and freshness window of an
// intent (spec 011, Wave 3: FR-010, FR-012, FR-013). Pure functions: nothing
// here reads the devices file, logs or prints. The caller passes the secret.
//
// Canonical string (FR-010), the contract Lumen reproduces byte for byte:
//   schema_version \n id \n action \n project \n target-or-empty \n
//   created_at \n created_by \n nonce \n sha256hex(payload)
// joined by "\n", no trailing newline, payload hashed over its UTF-8 bytes.
// With the approval audit group (FR-045) four more fields follow the hash:
//   approved_from_device \n approved_at \n approved_via \n
//   approved_by_intent-or-empty
// Without the group the string is exactly the nine fields (S1 holds).
// For action approve, target_sha256 (64 hex, the sha256 of the target's raw
// bytes) follows the payload hash as the tenth field, before any group field;
// every other action adds nothing (spec round 6).
// `schema_version` is written in decimal ("1"). The HMAC key is the device
// secret's 32 RAW bytes (hex-decoded), not the 64-character hex text.
// Frozen vector (fixture S1): the fields of _test-fixtures/a1-intent/vault/
// valid.md with secret 00…01 give
//   18aa9d63d9cd70dac2bc0c8177b2d32e2587327e951fef71ff9bae77696bafb0
// (openssl dgst -sha256 -mac HMAC -macopt hexkey:<secret> over the string).
//
// Never log or print the secret or the canonical string; a log line may carry
// payloadSha256(fm) only.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const { approvalCanonicalTail } = require('./intent-approval.cjs');

const SIGNATURE_PREFIX = 'hmac-sha256:';
const SIGNATURE_RE = /^hmac-sha256:([0-9a-f]{64})$/;
const SECRET_HEX_RE = /^[0-9a-f]{64}$/;
// Spec round 6: for action approve, target_sha256 is the tenth field, after
// the payload hash and before any group field; other actions add nothing.
const CANONICAL_TARGET_SHA256_FIELD = 'target_sha256';
const CANONICAL_STRING_FIELDS = Object.freeze([
  'schema_version', 'id', 'action', 'project', 'target', 'created_at', 'created_by', 'nonce', 'payload',
]);

function sha256hex(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function payloadSha256(fm) {
  return typeof fm.payload === 'string' ? sha256hex(fm.payload) : null;
}

const isStr = (v) => typeof v === 'string';

// -> the canonical string, or null when a field has the wrong type (a shape
// the validator refuses anyway; null then verifies as signature_invalid).
function canonicalString(fm) {
  const target = fm.target === undefined || fm.target === null ? '' : fm.target;
  const version = Number.isSafeInteger(fm.schema_version) ? String(fm.schema_version) : null;
  const parts = [version, fm.id, fm.action, fm.project, target, fm.created_at, fm.created_by, fm.nonce];
  const approval = approvalCanonicalTail(fm); // FR-045: [] without the group
  const bound = fm.action === 'approve' ? [fm[CANONICAL_TARGET_SHA256_FIELD]] : []; // spec round 6
  if (!parts.every(isStr) || !isStr(fm.payload) || !bound.every(isStr) || approval === null) return null;
  return [...parts, sha256hex(fm.payload), ...bound, ...approval].join('\n');
}

function hmacBytes(canonical, secretHex) {
  return crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(canonical, 'utf8').digest();
}

function assertSecretHex(secretHex) {
  if (!isStr(secretHex) || !SECRET_HEX_RE.test(secretHex)) {
    throw new Error('intent-sign: the device secret must be 64 lowercase hex characters');
  }
}

// -> "hmac-sha256:<64 hex>". Throws on a malformed secret or intent (the
// signer is a1 itself — approve, fixtures — so a bad input is a bug).
function sign(fm, secretHex) {
  assertSecretHex(secretHex);
  const canonical = canonicalString(fm);
  if (canonical === null) throw new Error('intent-sign: intent fields have the wrong type; cannot sign');
  return `${SIGNATURE_PREFIX}${hmacBytes(canonical, secretHex).toString('hex')}`;
}

// FR-012 — true only for a well-formed signature equal to the recomputed one.
// Both buffers are 32 bytes before timingSafeEqual is called (the regex pins
// the length), so the compare itself never throws and never short-circuits.
// `deps.timingSafeEqual` exists so the fixture can prove the call happens.
function verify(fm, secretHex, deps = {}) {
  const equal = deps.timingSafeEqual || crypto.timingSafeEqual;
  assertSecretHex(secretHex);
  const m = isStr(fm.signature) ? fm.signature.match(SIGNATURE_RE) : null;
  const canonical = canonicalString(fm);
  if (!m || canonical === null) return false;
  const given = Buffer.from(m[1], 'hex');
  const expected = hmacBytes(canonical, secretHex);
  if (given.length !== expected.length) return false;
  return equal(given, expected) === true;
}

// FR-013 — `created_at` at most freshnessMs in the past and at most skewMs in
// the future of nowMs; both bounds inclusive. An unparsable timestamp is a
// shape error (Wave 2 refuses it first), reported here as schema_invalid so
// it can never read as fresh.
function checkFreshness(fm, nowMs, limits) {
  const created = isStr(fm.created_at) ? Date.parse(fm.created_at) : NaN;
  if (!Number.isFinite(created) || !Number.isFinite(nowMs)) return { ok: false, reason: 'schema_invalid', detail: null };
  if (nowMs - created > limits.freshnessMs) return { ok: false, reason: 'stale', detail: 'stale_past' };
  if (created - nowMs > limits.skewMs) return { ok: false, reason: 'stale', detail: 'stale_future' };
  return { ok: true, reason: null, detail: null };
}

// FR-012, FR-013 — device lookup -> signature -> freshness, stopping at the
// first failure: a forged intent from a provisioned device is
// signature_invalid, never stale (an unauthenticated created_at means
// nothing). `lookupSecret(id)` returns the secret of a provisioned,
// non-revoked device or null. -> { reason, detail }, reason null when ok.
function checkAuthenticity(fm, lookupSecret, nowMs, limits, deps = {}) {
  const secretHex = lookupSecret(fm.created_by);
  if (secretHex === null) return { reason: 'device_unknown', detail: null };
  if (!verify(fm, secretHex, deps)) return { reason: 'signature_invalid', detail: null };
  const fresh = checkFreshness(fm, nowMs, limits);
  return { reason: fresh.reason, detail: fresh.detail };
}

module.exports = {
  SIGNATURE_PREFIX,
  CANONICAL_STRING_FIELDS,
  CANONICAL_TARGET_SHA256_FIELD,
  canonicalString,
  payloadSha256,
  sign,
  verify,
  checkFreshness,
  checkAuthenticity,
};
