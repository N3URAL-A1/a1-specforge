'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-store — the consent evidence store (spec 016 FR-003, FR-007; wave 2).
//
//   <owner home>/.a1-xprov/consent.json   (dir 0700, file 0600, atomic, no symlink: the guarded reader/writer of the permit store)
//     { version: 1,
//       consents:        { "<git-common-dir>": { who, when, header, classification, origin, question_hash, answer_label, record, audit, ludwig_record? } },
//       classifications: { "<git-common-dir>": { who, when, header, origin, question_hash, answer_label, audit, ludwig_record? } } }
//
// `consents` is the evidence of a permit written by `xprov consent record` (who = owner-chat, when, the canonical header,
// the classification and raw origin at the decision, the hash of the question the owner saw, the label the owner chose, the
// audit line). `classifications` holds the stored xprov-Einstufung answer of a customer repository: FR-007 reads it from here,
// never from an agent argument. Tier 0: the same OS user can write this file; the `audit` key names the chain line.
// An unusable store is never overwritten. Pure functions plus the guarded read and write.
// ---------------------------------------------------------------------------

const path = require('path');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');

const CONSENT_FILE = 'consent.json';
const STORE_LABEL = 'consent store';
const CONSENT_REQUIRED = Object.freeze(['who', 'when', 'header', 'classification', 'origin', 'question_hash', 'answer_label', 'record', 'audit']);
const CONSENT_OPTIONAL = Object.freeze(['ludwig_record']);
const CLASS_REQUIRED = Object.freeze(['who', 'when', 'header', 'origin', 'question_hash', 'answer_label', 'audit']);
const CLASS_OPTIONAL = Object.freeze(['ludwig_record']); // the vault path the owner saw in the Einstufung question (security review MAJOR-3)

const guarded = () => require('./xprov-allowlist.cjs');
const writer = () => require('./xprov-approve.cjs').writeGuardedStore;
const consentPath = () => path.join(X.xprovHome(), CONSENT_FILE);

const nonEmpty = (v) => typeof v === 'string' && v !== '';
const validOrigin = (v) => v === null || nonEmpty(v) || (Array.isArray(v) && v.length >= 2 && v.every(nonEmpty));

function validEntry(entry, required, optional) {
  if (!C.isPlainObject(entry)) return false;
  const keys = Object.keys(entry);
  const allowed = [...required, ...optional];
  return required.every((k) => k in entry) && keys.every((k) => allowed.includes(k))
    && keys.every((k) => (k === 'origin' ? validOrigin(entry[k]) : nonEmpty(entry[k])));
}

function parseMap(map, required, optional) {
  if (!C.isPlainObject(map)) return null;
  const out = {};
  for (const [key, entry] of Object.entries(map)) {
    if (!validEntry(entry, required, optional)) return null;
    out[key] = Object.freeze({ ...entry });
  }
  return out;
}

function parseDoc(doc) {
  if (!guarded().exactKeys(doc, ['version', 'consents', 'classifications']) || doc.version !== 1) return null;
  const consents = parseMap(doc.consents, CONSENT_REQUIRED, CONSENT_OPTIONAL);
  const classifications = parseMap(doc.classifications, CLASS_REQUIRED, CLASS_OPTIONAL);
  return consents === null || classifications === null ? null : { consents, classifications };
}

/** { ok: true, consents, classifications } | { ok: false, missing, why, consents: {}, classifications: {} }. */
function readStore() {
  const r = guarded().readGuardedStore(consentPath(), STORE_LABEL, parseDoc);
  return r.ok ? { ok: true, ...r.value } : { ok: false, missing: Boolean(r.missing), why: r.why, consents: {}, classifications: {} };
}

/** A new map with `key` set to `entry` (removed when entry is null). */
function withEntry(map, key, entry) {
  const next = Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
  return entry === null ? next : { ...next, [key]: entry };
}

/** Writes both maps through the guarded writer; returns the path. */
function writeStore(consents, classifications) {
  return writer()(CONSENT_FILE, { version: 1, consents, classifications });
}

module.exports = { CONSENT_FILE, consentPath, readStore, withEntry, writeStore, parseDoc };
