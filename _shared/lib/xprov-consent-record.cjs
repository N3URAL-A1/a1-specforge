'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-record — turns an owner answer into stores (spec 016 FR-003, FR-005, FR-007, FR-008; wave 2).
//
//   recordConsent  : a matching, unexpired, unused, bound marker with an owner answer becomes
//                      yes -> consent.json evidence + permits.json entry + .a1/xprov.json (allowed)
//                      no  -> permit-denials.json entry (owner-chat, same effect as `permit --deny`) + .a1/xprov.json (denied)
//                    kind classification: yes -> the stored xprov-Einstufung answer in consent.json; no -> nothing is written.
//   revokeConsent  : removes the repository's permit, denial, evidence, repo file and unused markers, whatever channel wrote them.
//
// Order of every write: audit line FIRST (its sha goes into the store entry, spec 016 SEC-1), then the stores. A step that
// fails after an earlier one leaves a state that permit-check reports fail-closed (and the result names it); an unusable
// store is never overwritten. Without a matching answer nothing is written: the caller exits 1.
// Customer repository (no origin, a list of origins, or another org): a consent yes needs the stored Einstufung answer for the
// SAME origin and a vault record passed by the caller (`--ludwig-record`); a chat yes never replaces the legal decision.
// The marker is claimed (used) before the stores are written, so a replay finds it used; if a later step fails the owner answers again.
// Tier 0: a record the same OS user could write; `enforcement: unenforced` stays in permit-check.
// Request-scoped: clock and root are parameters.
// ---------------------------------------------------------------------------

const fs = require('fs');
const io = require('./io.cjs');
const C = require('./xprov-common.cjs');
const OH = require('./xprov-owner-home.cjs');
const RI = require('./xprov-repo-identity.cjs');
const AU = require('./xprov-audit.cjs');
const D = require('./xprov-denials.cjs');
const PM = require('./xprov-permits.cjs');
const P = require('./xprov-permit.cjs');
const Q = require('./xprov-consent-question.cjs');
const M = require('./xprov-consent-marker.cjs');
const CS = require('./xprov-consent-store.cjs');

const BY = C.RESERVED_BY;
// The authority of a chat consent (owner record of 2026-10-14); a customer repository passes its legal record instead.
const CHAT_RECORD = 'record/2026-10-14-a1-autonomy-chat-consent.md';
const CLASS_KIND = 'classification';
const LUDWIG_RECORD_MAX_CHARS = 300; // a vault path; the permit-record pattern itself has no length bound

const refuse = (reason, detail, extra) => Object.freeze({ ok: false, reason, detail, ...(extra || {}) });
const sameOrigin = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const errReason = (e) => (e && e.code === 'A1_INPUT' ? e.message : (e && e.code) || 'error');
const dayOf = (now) => (now || io.nowIso()).slice(0, 10);

const MARKER_DETAIL = Object.freeze({
  no_marker: 'no open consent question for this repository: nothing was asked, or the answer did not reach the hook; nothing written',
  marker_foreign: 'the marker belongs to another repository or question kind; nothing written',
  marker_expired: 'the marker is older than 10 minutes; ask the question again; nothing written',
  marker_used: 'the marker was used already; ask the question again; nothing written',
  marker_unanswered: 'the question has no answer yet; poll `xprov consent ensure`; nothing written',
  marker_unbound: 'the answer is not bound to the question that was asked (tool_use_id, session_id or nonce differ); nothing written',
  question_changed: 'the repository changed since the question was asked (origin or path); ask the question again; nothing written',
});

/** What every operation needs: the repository key, raw origin, the canonical question and the three stores. */
function prepare(o, kind) {
  if (Q.kindDef(kind) === null) return refuse('unknown_kind', 'unknown question kind; nothing written');
  const key = C.commonDirOf(o.root);
  if (key === null) return refuse('not_a_repository', `${o.root} is not a git repository; nothing written`);
  let origin;
  try { origin = RI.readOrigin(o.root); } catch (e) {
    if (!o.lenient) return refuse(e.reason || 'origin_unreadable', `${errReason(e)}; nothing written`);
    origin = null; // revoke only removes: an unreadable origin must not keep a permit alive
  }
  const why = OH.homeMismatch();
  if (why !== null) return refuse('owner_home_mismatch', `${why}; nothing written`);
  const stores = { permits: PM.readPermits(), denials: D.readDenials(), evidence: CS.readStore() };
  const bad = Object.entries(stores).find(([, s]) => !s.ok && !s.missing);
  if (bad) return refuse(`${bad[0]}_store_unusable`, `the ${bad[0]} store is not usable (${bad[1].why}); fix or remove it yourself; nothing written`);
  return { key, origin, question: Q.buildQuestion(kind, Q.repoContext(o.root, origin)), stores };
}

/** A failing step as a refusal that names the state it leaves. */
function step(label, leaves, fn) {
  try { fn(); return null; } catch (e) { return refuse('write_failed', `cannot ${label} (${errReason(e)}); ${leaves}`); }
}

const repoFile = (root, rec) => io.writeTextAtomic(P.permitPath(root), `${JSON.stringify(rec, null, 2)}\n`);

/** Customer prerequisites of a consent yes: the stored Einstufung for this origin, and a valid vault record. */
function customerGate(p, ludwigRecord) {
  if (RI.classifyOrigin(p.origin) !== RI.CLASS.CUSTOMER) return null;
  const cls = p.stores.evidence.classifications[p.key];
  if (!cls || !sameOrigin(cls.origin, p.origin)) {
    return refuse('classification_required', 'customer repository (no origin, a list of origins, or an origin outside N3URAL-A1): answer the xprov-Einstufung question first (`xprov consent question --kind classification`, then `consent record --kind classification`); nothing written');
  }
  if (ludwigRecord === undefined) return refuse('ludwig_record_required', 'customer repository: pass the a1-ludwig-legal vault record with --ludwig-record <vault path>; nothing written');
  return null;
}

function writeYes(o, p, marker, line, ludwigRecord) {
  const sha = AU.lineSha(line);
  const now = o.now || io.nowIso();
  const record = ludwigRecord !== undefined ? ludwigRecord : CHAT_RECORD;
  const evidence = Object.freeze({
    who: BY, when: now, header: Q.kindDef('consent').header, classification: RI.classifyOrigin(p.origin), origin: p.origin,
    question_hash: marker.hash, answer_label: marker.answer.label, record, audit: sha, ...(ludwigRecord !== undefined ? { ludwig_record: ludwigRecord } : {}),
  });
  const entry = Object.freeze({ decided_by: BY, decided_on: dayOf(now), record, ts: now, repo: p.key, origin: p.origin, audit: sha });
  const file = Object.freeze({ external_review: 'allowed', decided_by: BY, decided_on: dayOf(now), record });
  return step('write the consent evidence', 'nothing else was changed; the audit log has the line', () => CS.writeStore(CS.withEntry(p.stores.evidence.consents, p.key, evidence), p.stores.evidence.classifications))
    || (p.stores.denials.denials[p.key] ? step('remove the denial', 'the evidence is written, the permit is not', () => D.writeDenials(D.withDenial(p.stores.denials.denials, p.key, null))) : null)
    || step('write the permit entry', 'the state is not allowed until the question is answered again', () => PM.writePermits(PM.withPermit(p.stores.permits.permits, p.key, entry)))
    || step('write .a1/xprov.json', 'the entry is written, the file is absent or old, so the state is permit_mismatch until the question is answered again', () => repoFile(o.root, file));
}

function writeNo(o, p, line) {
  const now = o.now || io.nowIso();
  const entry = Object.freeze({ decided_by: BY, decided_on: dayOf(now), ts: now, audit: AU.lineSha(line) });
  const file = Object.freeze({ external_review: 'denied', decided_by: BY, decided_on: dayOf(now) });
  return (p.stores.permits.permits[p.key] ? step('remove the permit entry', 'nothing was changed', () => PM.writePermits(PM.withPermit(p.stores.permits.permits, p.key, null))) : null)
    || step('write the denial', 'the state is fail-closed until the owner answers again', () => D.writeDenials(D.withDenial(p.stores.denials.denials, p.key, entry)))
    || step('write .a1/xprov.json', 'the denial is written, the file is absent or old, so the state is denial_mismatch until the owner answers again', () => repoFile(o.root, file));
}

function writeClassification(o, p, marker, line) {
  const now = o.now || io.nowIso();
  const entry = Object.freeze({ who: BY, when: now, header: Q.kindDef(CLASS_KIND).header, origin: p.origin, question_hash: marker.hash, answer_label: marker.answer.label, audit: AU.lineSha(line) });
  return step('write the classification', 'nothing else was changed', () => CS.writeStore(p.stores.evidence.consents, CS.withEntry(p.stores.evidence.classifications, p.key, entry)));
}

/**
 * `o`: { root, kind ('consent' | 'classification'), ludwigRecord?, now? }. Returns
 * { ok: true, kind, decision, repo, ... } or { ok: false, reason, detail }. Never throws for a refusal.
 */
function recordConsent(o) {
  const kind = o.kind;
  if (o.ludwigRecord !== undefined && String(o.ludwigRecord).length > LUDWIG_RECORD_MAX_CHARS) throw C.inputError(`--ludwig-record is longer than ${LUDWIG_RECORD_MAX_CHARS} characters`, 'ludwig_record_too_long');
  if (o.ludwigRecord !== undefined) P.validateRecord(o.ludwigRecord); // a typed input error (exit 2): traversal and junk never reach a store
  const p = prepare(o, kind);
  if (p.ok === false) return p;
  const want = { repo: p.key, kind, hash: p.question.hash, now: o.now };
  const seen = M.checkMarker(want);
  if (!seen.ok) return refuse(seen.reason, MARKER_DETAIL[seen.reason] || 'the marker cannot be used; nothing written');
  const yes = seen.marker.answer.decision === 'yes';
  if (kind === 'consent' && yes) { const gate = customerGate(p, o.ludwigRecord); if (gate) return gate; }
  const claimed = M.claimMarker(want);
  if (!claimed.ok) return refuse(claimed.reason, MARKER_DETAIL[claimed.reason] || 'the marker cannot be used; nothing written');
  const m = claimed.marker;
  if (kind === CLASS_KIND && !yes) return refuse('classification_declined', 'the owner did not confirm the classification; nothing written');
  const action = kind === CLASS_KIND ? AU.ACTION.CONSENT_CLASSIFY : (yes ? AU.ACTION.CONSENT : AU.ACTION.CONSENT_DENY);
  let line;
  try { line = AU.appendAudit({ repo: p.key, action, now: o.now, tool_use_id: m.tool_use_id, session_id: m.session_id, permission_mode: m.answer.permission_mode }); } catch (e) {
    return refuse(e.reason || 'audit_failed', `${errReason(e)}; nothing written (the marker is used: answer the question again)`);
  }
  const failed = kind === CLASS_KIND ? writeClassification(o, p, m, line) : (yes ? writeYes(o, p, m, line, o.ludwigRecord) : writeNo(o, p, line));
  if (failed) return failed;
  return Object.freeze({ ok: true, kind, decision: yes ? 'yes' : 'no', repo: p.key, audit: AU.lineSha(line), state: kind === CLASS_KIND ? 'classified' : (yes ? 'permitted' : 'denied') });
}

/** The `.a1/xprov.json` path when the file is a permit or denial record (an unreadable or foreign file is left alone), else null. */
function removableRepoFile(root) {
  const f = P.permitPath(root);
  try {
    if (!fs.lstatSync(f).isFile()) return null;
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    return C.isPlainObject(rec) && (rec.external_review === 'allowed' || rec.external_review === 'denied') ? f : null;
  } catch (_e) { return null; }
}

/** `o`: { root, now? }. Removes everything the repository's consent left; { ok: true, removed: [...] } or a refusal. */
function revokeConsent(o) {
  const p = prepare({ ...o, lenient: true }, 'consent');
  if (p.ok === false) return p;
  const file = removableRepoFile(o.root);
  const dropFile = file !== null;
  const removed = [
    ...(p.stores.permits.permits[p.key] ? ['permit'] : []), ...(p.stores.denials.denials[p.key] ? ['denial'] : []),
    ...(p.stores.evidence.consents[p.key] ? ['evidence'] : []), ...(p.stores.evidence.classifications[p.key] ? ['classification'] : []),
    ...(dropFile ? ['repo-file'] : []),
  ];
  const markers = M.peekMarker(p.key, 'consent', o.now).state !== M.STATE.NONE || M.peekMarker(p.key, CLASS_KIND, o.now).state !== M.STATE.NONE;
  if (removed.length === 0 && !markers) return Object.freeze({ ok: true, repo: p.key, removed: [], changed: false });
  let line;
  try { line = AU.appendAudit({ repo: p.key, action: AU.ACTION.CONSENT_REVOKE, now: o.now }); } catch (e) {
    return refuse(e.reason || 'audit_failed', `${errReason(e)}; nothing written`);
  }
  const failed = step('drop the markers', 'the revocation is partly done', () => M.dropMarkers(p.key))
    || (p.stores.permits.permits[p.key] ? step('remove the permit entry', 'the revocation is not done', () => PM.writePermits(PM.withPermit(p.stores.permits.permits, p.key, null))) : null)
    || (p.stores.denials.denials[p.key] ? step('remove the denial', 'the revocation is partly done', () => D.writeDenials(D.withDenial(p.stores.denials.denials, p.key, null))) : null)
    || (p.stores.evidence.consents[p.key] || p.stores.evidence.classifications[p.key]
      ? step('remove the evidence', 'the revocation is partly done', () => CS.writeStore(CS.withEntry(p.stores.evidence.consents, p.key, null), CS.withEntry(p.stores.evidence.classifications, p.key, null))) : null)
    || (dropFile ? step('remove .a1/xprov.json', 'the permit is removed; the file is a leftover without effect', () => fs.rmSync(file, { force: true })) : null);
  if (failed) return failed;
  return Object.freeze({ ok: true, repo: p.key, removed, markers, changed: true, audit: AU.lineSha(line) });
}

module.exports = { CHAT_RECORD, recordConsent, revokeConsent };
