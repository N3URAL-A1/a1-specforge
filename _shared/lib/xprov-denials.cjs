'use strict';

// ---------------------------------------------------------------------------
// xprov-denials — the owner-only permit-denial store (spec 012 D1, FR-001,
// FR-007; decided by Robert 2026-10-05, GATE-C-1 = (a)).
//
// `.a1/xprov.json` is a plain working-tree file. If `external_review: "denied"`
// alone turned a `blocking` gate into `not_applicable`, any pipeline agent with
// write access could switch the gate off by writing that file. So a denial
// counts only when the owner's store agrees:
//
//   ~/.a1-xprov/permit-denials.json
//     { "version": 1, "denials": { "<git-common-dir>": { decided_by, decided_on, ts } } }
//
// The store is written ONLY by `xprov permit --deny` / `xprov permit` (xprov-
// permit.cjs, behind guardRefusal() and the typed-back word), through the same
// guarded writer as the waiver store (0700 dir, 0600 file, atomic). It is READ
// through the same guarded reader (lstat, O_NOFOLLOW, mode and owner checks).
// An existing store that the reader reports as unusable is never overwritten.
//
// The allowlist module requires xprov-permit.cjs at load time, so the guarded
// reader/writer are required lazily here (no import cycle at module load).
// ---------------------------------------------------------------------------

const path = require('path');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');

const DENIALS_FILE = 'permit-denials.json';
const STORE_LABEL = 'permit denial store';
const ENTRY_KEYS = Object.freeze(['decided_by', 'decided_on', 'ts']);

const guarded = () => require('./xprov-allowlist.cjs');
const writer = () => require('./xprov-approve.cjs').writeGuardedStore;

const denialsPath = () => path.join(X.xprovHome(), DENIALS_FILE);

/** The denials map of a parsed store document, or null when it is off-format. */
function parseDenialsDoc(doc) {
  const AL = guarded();
  if (!AL.exactKeys(doc, ['version', 'denials']) || doc.version !== 1 || !C.isPlainObject(doc.denials)) return null;
  const denials = {};
  for (const [key, entry] of Object.entries(doc.denials)) {
    if (!AL.exactKeys(entry, ENTRY_KEYS) || !ENTRY_KEYS.every((k) => typeof entry[k] === 'string' && entry[k] !== '')) return null;
    denials[key] = Object.freeze({ ...entry });
  }
  return denials;
}

/** { ok: true, denials } | { ok: false, missing, why, denials: {} } — `missing`
 * means "no store yet" (no denial), anything else is an unusable store. */
function readDenials() {
  const r = guarded().readGuardedStore(denialsPath(), STORE_LABEL, parseDenialsDoc);
  return r.ok ? { ok: true, denials: r.value } : { ok: false, missing: Boolean(r.missing), why: r.why, denials: {} };
}

/** A new store document: `denials` with `key` set to `entry` (or removed when entry is null). */
function withDenial(denials, key, entry) {
  const next = Object.fromEntries(Object.entries(denials).filter(([k]) => k !== key));
  return entry === null ? next : { ...next, [key]: entry };
}

/** Writes the whole denials map through the guarded writer; returns the path. */
function writeDenials(denials) {
  return writer()(DENIALS_FILE, { version: 1, denials });
}

module.exports = { DENIALS_FILE, denialsPath, readDenials, withDenial, writeDenials, parseDenialsDoc };
