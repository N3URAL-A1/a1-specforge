'use strict';

// ---------------------------------------------------------------------------
// xprov-waivers — the guarded waiver store (spec 009 FR-007, amended
// 2026-10-03 after a1-samuel-security's Wave 7 review).
//
// A waiver is the only way past a `fail` under `blocking` (a Codex quota
// outage, for one). It is a HUMAN act, written only by `xprov waive` behind
// the same guards as the allowlist owner approval (xprov-approve.cjs
// guardRefusal), into ~/.a1-xprov/waivers.json under the same store rules
// (lstat, 0700 dir / 0600 file, own uid, O_NOFOLLOW read, atomic write).
//
// Key (every part computed by a1, never taken from a flag or a copy):
//   repo        realpath of the primary checkout's git-common-dir
//   phase, gate
//   plan_sha256 sha256 of the raw bytes of <toplevel>/.a1/phases/<phase>/PLAN.md
// Authority: load-check accepts a waiver ONLY from this store and only when
// the key equals what it computes at check time. The `waived: true` row in
// index.json and the XREVIEW.md section are a mirror. Records of a retired
// gate id (wave-inspect-xprov, spec 025) stay in the store byte for byte and
// are inert.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const AL = require('./xprov-allowlist.cjs');

const WAIVERS_FILE = 'waivers.json';
const STORE_LABEL = 'waiver store';
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const RECORD_KEYS = Object.freeze(['repo', 'phase', 'gate', 'plan_sha256', 'wave', 'lane', 'head', 'base', 'reason', 'by', 'ts']);

const waiversPath = () => path.join(X.xprovHome(), WAIVERS_FILE);

/** A store record has exactly RECORD_KEYS with the right shapes, else null. */
function validRecord(r) {
  if (!AL.exactKeys(r, RECORD_KEYS)) return null;
  const str = (v) => typeof v === 'string' && v !== '';
  if (![r.repo, r.phase, r.gate, r.reason, r.by, r.ts].every(str) || !SHA256_HEX_RE.test(r.plan_sha256)) return null;
  if ((r.wave !== null || r.lane !== null || r.head !== null || r.base !== null)) return null;
  return { ...r };
}

function parseWaiversDoc(doc) {
  if (!AL.exactKeys(doc, ['version', 'waivers']) || doc.version !== 1 || !Array.isArray(doc.waivers)) return null;
  // a record of a retired gate id is kept verbatim and inert (the lookups below filter by gate): it must neither invalidate the store nor vanish on the next write
  const list = doc.waivers.map((r) => (r !== null && typeof r === 'object' && X.RETIRED_GATE_IDS.includes(r.gate) ? { ...r } : validRecord(r)));
  return list.some((r) => r === null) ? null : list;
}

/** { ok: true, waivers } or { ok: false, missing, why, waivers: [] }. */
function readWaivers() {
  const r = AL.readGuardedStore(waiversPath(), STORE_LABEL, parseWaiversDoc);
  return r.ok ? { ok: true, waivers: r.value } : { ...r, waivers: [] };
}

const planShaOf = (planPath) => C.sha256(fs.readFileSync(planPath));

/** HEAD of `workPath` when it shares `repo`'s git-common-dir, else { problem }. */
function headIn(workPath, repo) {
  if (C.commonDirOf(workPath) !== repo) return { problem: `--work-path ${workPath} does not share the git-common-dir of the primary checkout` };
  const out = C.gitOut(['-C', workPath, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  return out === null ? { problem: `HEAD does not resolve in ${workPath}` } : { head: out.trim() };
}

/** The plan-review waiver matching (repo, phase, plan sha) — newest first — or null. */
function planWaiver(store, key) {
  const hits = store.waivers.filter((w) => w.gate === X.GATE_IDS.PLAN_REVIEW && w.repo === key.repo && w.phase === key.phase && w.plan_sha256 === key.plan_sha256);
  return hits.length ? hits[hits.length - 1] : null;
}

/** Appends the records in ONE atomic write; a broken existing store is never replaced (Samuel S-m5 for approvals).
 * The caller holds the owner-store lock (xprov-audit.cjs withStoreLock): this reads the store and writes it back (spec 016 R-4). */
function appendWaivers(records, writeGuardedStore) {
  const current = readWaivers();
  if (!current.ok && !current.missing) throw C.inputError(`the existing ${STORE_LABEL} is not usable (${current.why}); fix or remove ${waiversPath()} yourself`, 'store_broken');
  const recs = records.map(validRecord);
  if (recs.some((r) => r === null)) throw new Error('internal: waiver record off-format');
  return writeGuardedStore(WAIVERS_FILE, { version: 1, waivers: [...current.waivers, ...recs] });
}

/** Appends one record (see appendWaivers). */
const appendWaiver = (record, writeGuardedStore) => appendWaivers([record], writeGuardedStore);

module.exports = { WAIVERS_FILE, RECORD_KEYS, waiversPath, readWaivers, planShaOf, headIn, planWaiver, appendWaiver, appendWaivers, validRecord };
