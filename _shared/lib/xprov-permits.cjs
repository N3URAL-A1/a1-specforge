'use strict';

// ---------------------------------------------------------------------------
// xprov-permits — the owner-only permit store (spec 014 FR-001..FR-003;
// owner decision 2026-10-08: a separate file, not an extension of the denial store).
//
// `.a1/xprov.json` is a plain working-tree file; any agent with Bash can write it.
// `allowed` therefore counts only when the owner's store agrees:
//
//   ~/.a1-xprov/permits.json
//     { "version": 1, "permits": { "<git-common-dir>": { decided_by, decided_on, record, ts, default_branch? } } }
//
// The store is WRITTEN only by `xprov permit` / `xprov permit --deny` (xprov-permit.cjs
// `permit` / `permitDeny`, behind guardRefusal() and the typed-back word) through the
// guarded writer (0700 dir, 0600 file, atomic). It is READ through the guarded reader
// (lstat, O_NOFOLLOW, mode and owner checks). An existing store that the reader reports
// as unusable is never overwritten.
//
// API mirrors xprov-denials.cjs. The guarded reader/writer are required lazily (the
// allowlist module requires xprov-permit.cjs at load time: no import cycle at load).
// ---------------------------------------------------------------------------

const path = require('path');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');

const PERMITS_FILE = 'permits.json';
const STORE_LABEL = 'permit store';
const REQUIRED_KEYS = Object.freeze(['decided_by', 'decided_on', 'record', 'ts']);
const OPTIONAL_KEYS = Object.freeze(['default_branch']);

const guarded = () => require('./xprov-allowlist.cjs');
const writer = () => require('./xprov-approve.cjs').writeGuardedStore;

const permitsPath = () => path.join(X.xprovHome(), PERMITS_FILE);

const nonEmptyString = (v) => typeof v === 'string' && v !== '';

/** An entry holds the four required keys, optionally `default_branch`, nothing else; every value a non-empty string. */
function validEntry(entry) {
  if (!C.isPlainObject(entry)) return false;
  const keys = Object.keys(entry);
  const allowed = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];
  return REQUIRED_KEYS.every((k) => k in entry) && keys.every((k) => allowed.includes(k)) && keys.every((k) => nonEmptyString(entry[k]));
}

/** The permits map of a parsed store document, or null when it is off-format. */
function parsePermitsDoc(doc) {
  if (!guarded().exactKeys(doc, ['version', 'permits']) || doc.version !== 1 || !C.isPlainObject(doc.permits)) return null;
  const permits = {};
  for (const [key, entry] of Object.entries(doc.permits)) {
    if (!validEntry(entry)) return null;
    permits[key] = Object.freeze({ ...entry });
  }
  return permits;
}

/** { ok: true, permits } | { ok: false, missing, why, permits: {} } — `missing` means
 * "no store yet" (no entry), anything else is an unusable store. */
function readPermits() {
  const r = guarded().readGuardedStore(permitsPath(), STORE_LABEL, parsePermitsDoc);
  return r.ok ? { ok: true, permits: r.value } : { ok: false, missing: Boolean(r.missing), why: r.why, permits: {} };
}

/** A new permits map with `key` set to `entry` (or removed when entry is null). */
function withPermit(permits, key, entry) {
  const next = Object.fromEntries(Object.entries(permits).filter(([k]) => k !== key));
  return entry === null ? next : { ...next, [key]: entry };
}

/** Writes the whole permits map through the guarded writer; returns the path. */
function writePermits(permits) {
  return writer()(PERMITS_FILE, { version: 1, permits });
}

module.exports = { PERMITS_FILE, permitsPath, readPermits, withPermit, writePermits, parsePermitsDoc };
