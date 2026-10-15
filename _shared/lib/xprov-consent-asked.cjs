'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-asked — "ask once per phase", enforced in code (spec 016 FR-002; wave 5; Samuel wave 2 finding).
//
// Without this module the rule lived in skill text only: after an owner No (a denial in permit-denials.json) or an unanswered question,
// an agent could run `xprov consent revoke` (it removes the denial) and put the question again, until the owner said yes.
//
//   <owner home>/.a1-xprov/consent-asked.json   (dir 0700, file 0600, atomic, no symlink: the guarded reader and writer of the other stores)
//     { version: 1, asked: { "<sha256(repo key NUL kind NUL scope type NUL scope)>": { repo, kind, scope_type, scope, hash, at, audit } } }
//
// `consent question --kind consent|classification` calls `claimAsk` before it prints the question. The first call for repo + kind + scope
// (scope = a phase `.a1/phases/<name>` that exists, or a PR review run id) is recorded: an audit line `consent-asked` first, then the entry.
// Every later call for the same triple is refused (`already_asked_this_scope`), whatever happened in between: an owner No, no answer,
// an expired or used marker, a `consent revoke` (revoke never touches this store). The one exception is a re-show of the SAME question
// (same hash) while its marker is still open (pending or answered, not expired, not used): the owner has not been asked twice.
// A refusal prints no question: the agent goes on Reinhard-only.
// An unusable store refuses too (`asked_store_unusable`, fail closed: no question) and is never overwritten.
// Entries older than a year are dropped on the next write; more than MAX_ENTRIES live entries refuse (`asked_store_full`).
//
// Tier 0: the same OS user could delete the file or choose a fresh phase name; the plugin hook denies agent edits of ~/.a1-xprov/
// and the audit chain shows every ask. The waiver and allowlist questions are not covered: their targets change by design (FR-013).
// Request-scoped: clock and paths are parameters.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const path = require('path');
const io = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const AU = require('./xprov-audit.cjs');
const M = require('./xprov-consent-marker.cjs');
const R = require('./xprov-consent-record.cjs');
const CT = require('./xprov-consent-targets.cjs');

const ASKED_FILE = 'consent-asked.json';
const STORE_LABEL = 'consent-asked store';
const ASK_KINDS = Object.freeze(['consent', 'classification']);
const SCOPE_TYPES = Object.freeze({ PHASE: 'phase', RUN: 'run' });
const ENTRY_KEYS = Object.freeze(['repo', 'kind', 'scope_type', 'scope', 'hash', 'at', 'audit']);
const RETAIN_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;
const SHA_RE = /^[0-9a-f]{64}$/;
const RUN_MAX_CHARS = 80;
const RUN_RE = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,${RUN_MAX_CHARS - 1}}$`);

const guarded = () => require('./xprov-allowlist.cjs');
const writer = () => require('./xprov-approve.cjs').writeGuardedStore;
const askedPath = () => path.join(X.xprovHome(), ASKED_FILE);
const nonEmpty = (v) => typeof v === 'string' && v !== '';
const entryId = (key, kind, scope) => crypto.createHash('sha256').update([key, kind, scope.type, scope.id].join('\0')).digest('hex');

function validEntry(e) {
  return guarded().exactKeys(e, ENTRY_KEYS) && ENTRY_KEYS.every((k) => nonEmpty(e[k])) && Object.values(SCOPE_TYPES).includes(e.scope_type)
    && ASK_KINDS.includes(e.kind) && SHA_RE.test(e.hash) && SHA_RE.test(e.audit) && !Number.isNaN(Date.parse(e.at));
}

function parseDoc(doc) {
  if (!guarded().exactKeys(doc, ['version', 'asked']) || doc.version !== 1 || !C.isPlainObject(doc.asked)) return null;
  const asked = {};
  for (const [id, entry] of Object.entries(doc.asked)) {
    if (!SHA_RE.test(id) || !validEntry(entry)) return null;
    asked[id] = Object.freeze({ ...entry });
  }
  return asked;
}

/** { ok: true, asked } | { ok: false, missing, why, asked: {} } — `missing` is "no store yet"; anything else is an unusable store. */
function readAsked() {
  const r = guarded().readGuardedStore(askedPath(), STORE_LABEL, parseDoc);
  return r.ok ? { ok: true, asked: r.value } : { ok: false, missing: Boolean(r.missing), why: r.why, asked: {} };
}

/** The scope of the flags as { type, id }, or a typed input error: a phase must exist as `.a1/phases/<name>`; a run id is one safe segment. */
function scopeOf(root, flags) {
  const hasPhase = flags.phase !== undefined;
  const hasRun = flags.run !== undefined;
  if (hasPhase === hasRun) throw C.inputError('give exactly one of --phase <name> (an existing .a1/phases/<name>) or --run <id> (a PR review run): the question is asked once per phase or run', 'scope_required');
  if (hasPhase) return Object.freeze({ type: SCOPE_TYPES.PHASE, id: CT.phaseOf(root, flags.phase).phase });
  if (!RUN_RE.test(flags.run)) throw C.inputError(`--run must be a plain run id such as pr-12 (letters, digits, . _ -; at most ${RUN_MAX_CHARS} characters), got ${JSON.stringify(C.clip(flags.run, 40))}`, 'scope_invalid');
  return Object.freeze({ type: SCOPE_TYPES.RUN, id: flags.run });
}

const refuseAsked = (scope) => R.refuse('already_asked_this_scope',
  `the ${scope.type} ${JSON.stringify(scope.id)} has been asked already: no second question in this ${scope.type}; continue Reinhard-only (a new phase may ask once)`);

/** The same question (hash) with a marker that is still open: shown again, not asked a second time. */
function reshow(key, kind, hash, prior, now) {
  const open = M.peekMarker(key, kind, now);
  return prior.hash === hash && (open.state === M.STATE.PENDING || open.state === M.STATE.ANSWERED) && open.marker.hash === hash;
}

function pruned(asked, nowMs) {
  return Object.fromEntries(Object.entries(asked).filter(([, e]) => nowMs - Date.parse(e.at) <= RETAIN_MS));
}

function claimLocked(o) {
  const store = readAsked();
  if (!store.ok && !store.missing) return R.refuse('asked_store_unusable', `the ${STORE_LABEL} is not usable (${store.why}); fix or remove it yourself; no question`);
  const now = o.now || io.nowIso();
  const id = entryId(o.key, o.kind, o.scope);
  const prior = store.asked[id];
  if (prior !== undefined) return reshow(o.key, o.kind, o.hash, prior, o.now) ? Object.freeze({ ok: true, reshown: true }) : refuseAsked(o.scope);
  const live = pruned(store.asked, Date.parse(now));
  if (Object.keys(live).length >= MAX_ENTRIES) return R.refuse('asked_store_full', `the ${STORE_LABEL} holds ${MAX_ENTRIES} entries; no question`);
  let line;
  try { line = AU.appendAudit({ repo: o.key, action: AU.ACTION.CONSENT_ASKED, now }); } catch (e) { return R.refuse(e.reason || 'audit_failed', `${R.errReason(e)}; no question`); }
  const entry = Object.freeze({ repo: o.key, kind: o.kind, scope_type: o.scope.type, scope: o.scope.id, hash: o.hash, at: now, audit: AU.lineSha(line) });
  try { writer()(ASKED_FILE, { version: 1, asked: { ...live, [id]: entry } }); } catch (e) { return R.refuse('write_failed', `cannot record the ask (${R.errReason(e)}); no question`); }
  return Object.freeze({ ok: true, reshown: false });
}

/**
 * Records that the question of `o.kind` for repo `o.key` is asked in `o.scope`, or refuses.
 * `o`: { key (git-common-dir), kind ('consent' | 'classification'), scope ({ type, id } from scopeOf), hash (question hash), now? }.
 * Returns { ok: true, reshown } or { ok: false, reason, detail } (already_asked_this_scope, asked_store_unusable, asked_store_full, write_failed, lock reasons).
 */
function claimAsk(o) {
  if (!ASK_KINDS.includes(o.kind)) return R.refuse('unknown_kind', 'only the consent and classification questions are asked once per scope');
  return R.locked(() => claimLocked(o));
}

module.exports = { ASKED_FILE, ASK_KINDS, SCOPE_TYPES, askedPath, readAsked, scopeOf, claimAsk, entryId };
