'use strict';

// ---------------------------------------------------------------------------
// xprov-hit-cover — the FR-029 hit check's reader of the owner's chat hit approvals (spec 016 FR-014 / FR-029, wave 12).
//
//   coverage(hits, { root, repoKey, commit, counts }) -> { covered: true, approved: [{ path, rule, audit }] } | { covered: false }
//
// A secret-scan hit in a changed line sends nothing and puts the allowlist question of FR-014 to the owner. After a chat Yes
// (`xprov consent allowlist`) the owner store ~/.a1-xprov/hit-approvals.json holds one record per listed hit. The next scan of the same
// content is let through here, and only here: the allowlist evaluation (xprov-allowlist.cjs) never reads this store.
// A hit is covered when ALL of these hold (anything else is uncovered, fail closed):
//   - the store is readable and well-formed (guarded owner store: 0700 dir, 0600 file, own uid, exact record shape, `by: owner-chat`);
//   - a record matches repo key + path + rule id + the sha256 of THIS hit's blob at the scanned commit (not the scan id: a new scan of the
//     same blob is covered; a changed blob, another path, another rule or another repository is not);
//   - the record's `count` (occurrences of that rule in that blob, as the owner saw them listed) equals the occurrences found NOW (`counts`, a Map
//     path<TAB>rule -> n): an extra occurrence the owner never saw is uncovered. A legacy record without `count` is uncovered;
//   - the record's audit link is in the audit chain, belongs to this repository, has the action consent-allowlist and is not superseded by
//     a later consent-revoke (xprov-audit.cjs verifyLineOf).
// Only head-side hits in a plain relative path can be approved (the question lists those only). Never the matched value: the result and the
// run-dir record name path, rule id and the audit link. Tier 0: the same OS user can write the store and the audit chain.
// Request-scoped; reads only.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const C = require('./xprov-common.cjs');
const AU = require('./xprov-audit.cjs');
const H = require('./xprov-consent-hits.cjs');
const HA = require('./xprov-hit-approvals.cjs');
const RR = require('./xprov-runrecord.cjs');

const APPROVED_FILE = 'a1-hit-approved.json';
const MAX_APPROVED = 50;

/** The approved record of one hit, or null. */
function recordOf(store, hit, repoKey, blob, count) {
  return store.approvals.find((a) => a.repo === repoKey && a.path === hit.path && a.rule === hit.rule && a.blob === blob && a.count === count) || null;
}

function coverage(hits, o) {
  const none = Object.freeze({ covered: false });
  if (!Array.isArray(hits) || hits.length === 0 || hits.length > MAX_APPROVED) return none;
  const store = HA.readHitApprovals();
  if (!store.ok) return none;
  const approved = [];
  for (const h of hits) {
    if (h.side !== 'head' || !H.plainRelPath(h.path) || typeof h.rule !== 'string') return none;
    const b = H.blobSha256(o.root, o.commit, h.path);
    if (!b.ok) return none;
    const count = o.counts instanceof Map ? o.counts.get(`${h.path}\t${h.rule}`) : undefined; // occurrences NOW; a legacy record has no count and never equals it
    if (!Number.isInteger(count) || count < 1) return none;
    const rec = recordOf(store, h, o.repoKey, b.sha256, count);
    if (rec === null) return none;
    if (AU.verifyLineOf(rec.audit, o.repoKey, AU.ACTION.CONSENT_ALLOWLIST, AU.auditPath()).state !== AU.STATE.OK) return none;
    approved.push(Object.freeze({ path: h.path, rule: h.rule, audit: rec.audit }));
  }
  return Object.freeze({ covered: true, approved: Object.freeze(approved) });
}

/** Writes the covered-hits record into the run dir of `resultPath` (own artifacts only; 0600, once). true when it is there afterwards. */
function writeApproved(resultPath, approved, root) {
  if (!RR.inOwnArtifacts(resultPath, root)) return false;
  const file = path.join(path.dirname(path.resolve(resultPath)), APPROVED_FILE);
  try {
    fs.writeFileSync(file, `${JSON.stringify({ version: 1, approved: approved.map((x) => ({ path: x.path, rule: x.rule, audit: x.audit })), ts: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return true;
  } catch (e) { return e.code === 'EEXIST'; }
}

module.exports = { APPROVED_FILE, coverage, writeApproved };
