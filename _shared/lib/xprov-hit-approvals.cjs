'use strict';

// ---------------------------------------------------------------------------
// xprov-hit-approvals — the owner's chat approvals of secret-scan hits (spec 016 FR-014; Samuel W3 SEC-1).
//
// Its OWN store ~/.a1-xprov/hit-approvals.json, separate from the blob-approval store of `xprov allowlist approve`. The FR-029 hit check
// is the only reader: xprov-hit-cover.cjs (called from xprov-snapshot.cjs when a scan stops on changed-line hits; wave 12). The allowlist evaluation (xprov-allowlist.cjs) never requires this module and never reads the file: two
// consumers of one approval set would let a yes to one question act as a yes to another. A hit blob that parses as an allowlist document
// is never approved here (xprov-consent-allowlist.cjs refuses it first).
//
// One record per approved path + rule: { repo, path, rule, blob, scan, by: owner-chat, audit, ts, count }
//   repo   realpath of the git-common-dir      path, rule  from the scan hits record     blob  sha256 of the blob the hit sits in
//   count  how many occurrences of the rule the question listed in that blob (a record without it is legacy and never covers a hit)
//   scan   the scan record basename            audit       sha256 of the consent-allowlist audit line written before this record
// Same store rules as the other owner stores (xprov-allowlist.cjs readGuardedStore: 0700 dir, 0600 file, own uid, O_NOFOLLOW read, atomic write).
// The caller holds the owner-store lock: `append` reads the store and writes it back (spec 016 R-4). Request-scoped: no module state.
// ---------------------------------------------------------------------------

const path = require('path');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const AL = require('./xprov-allowlist.cjs');

const STORE_LABEL = 'hit approval store';
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const RECORD_KEYS_LEGACY = Object.freeze(['repo', 'path', 'rule', 'blob', 'scan', 'by', 'audit', 'ts']); // before `count`: still readable, never covers a hit
const RECORD_KEYS = Object.freeze([...RECORD_KEYS_LEGACY, 'count']);
const COUNT_MAX = 100000;
const APPROVALS_MAX = 5000; // read bound of one store

const storePath = () => path.join(X.xprovHome(), X.HIT_APPROVALS_FILE);
const sameHit = (a, b) => a.repo === b.repo && a.path === b.path && a.rule === b.rule && a.blob === b.blob && a.scan === b.scan;

/** A store record has exactly RECORD_KEYS with the right shapes, else null. */
function validRecord(r) {
  const legacy = AL.exactKeys(r, RECORD_KEYS_LEGACY);
  if (!legacy && !AL.exactKeys(r, RECORD_KEYS)) return null;
  if (!legacy && !(Number.isInteger(r.count) && r.count >= 1 && r.count <= COUNT_MAX)) return null;
  const str = (v) => typeof v === 'string' && v !== '';
  if (![r.repo, r.path, r.rule, r.scan, r.ts].every(str) || !SHA256_HEX_RE.test(r.blob) || !SHA256_HEX_RE.test(r.audit) || r.by !== C.RESERVED_BY) return null;
  return Object.freeze({ ...r });
}

function parseDoc(doc) {
  if (!AL.exactKeys(doc, ['version', 'approvals']) || doc.version !== 1 || !Array.isArray(doc.approvals) || doc.approvals.length > APPROVALS_MAX) return null;
  const list = doc.approvals.map(validRecord);
  return list.some((r) => r === null) ? null : list;
}

/** { ok: true, approvals } or { ok: false, missing, why, approvals: [] }. */
function readHitApprovals() {
  const r = AL.readGuardedStore(storePath(), STORE_LABEL, parseDoc);
  return r.ok ? { ok: true, approvals: r.value } : { ...r, approvals: [] };
}

/** The hit check's question: did the owner approve exactly this hit (repo, path, rule, blob sha256) in some scan? */
function isHitApproved(store, hit) {
  return store.approvals.some((a) => a.repo === hit.repo && a.path === hit.path && a.rule === hit.rule && a.blob === hit.blob);
}

/** Appends `records` (same hit again: the newer record replaces the older) in ONE atomic write; a broken existing store is never replaced. */
function appendHitApprovals(records, writeGuardedStore) {
  const current = readHitApprovals();
  if (!current.ok && !current.missing) throw C.inputError(`the existing ${STORE_LABEL} is not usable (${current.why}); fix or remove ${storePath()} yourself`, 'store_broken');
  const recs = records.map(validRecord);
  if (recs.some((r) => r === null)) throw new Error('internal: hit approval record off-format');
  const kept = current.approvals.filter((old) => !recs.some((n) => sameHit(old, n)));
  return writeGuardedStore(X.HIT_APPROVALS_FILE, { version: 1, approvals: [...kept, ...recs] });
}

module.exports = { STORE_LABEL, RECORD_KEYS, storePath, validRecord, readHitApprovals, isHitApproved, appendHitApprovals };
