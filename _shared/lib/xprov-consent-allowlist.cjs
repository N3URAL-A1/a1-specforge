'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-allowlist — the chat allowlist approval (spec 016 FR-014; wave 3).
//
//   buildFor({ root, scan })  -> { ok: true, key, question, hits, blobs } | a refusal
//       The canonical xprov-Allowlist question for one secret scan: every hit of the scan's hits record (xprov-consent-hits.cjs) with
//       file path, line, rule id, the sha256 of the blob it sits in (computed here from the repository) and a FIXED mask where an excerpt
//       would be. The matched text is never read, so it cannot be shown. Plugin hook (wave 4): read the repository path and the scan name
//       out of the question text with `scopeFromText`, call `buildFor` again and compare byte for byte.
//   approve({ root, scan, now? })  -> { ok: true, ... } | { ok: false, reason, detail }
//       Writes one HIT approval per listed hit (repo, path, rule, blob sha256, scan, by owner-chat, audit link) into the own store
//       hit-approvals.json (xprov-hit-approvals.cjs), only against a marker with a real owner yes whose hash equals the question rebuilt NOW.
//       It NEVER writes the blob-approval store of `xprov allowlist approve`, and the allowlist evaluation never reads the hit store (Samuel
//       W3 SEC-1: otherwise a hit file whose bytes are a valid allowlist document, approved here, would later load as the allowlist).
//       For the same reason a hit blob that parses as an allowlist document is refused (`allowlist_blob_hit`).
//       A changed blob, a new hit or another commit changes the question: `question_changed`, nothing written. A No writes nothing.
//
// Order of every write (SEC-6): question text and git work FIRST, outside the lock; inside the store lock only: read the hit store, claim the
// marker, the audit line (consent-allowlist), the store write. Request-scoped. Tier 0: see help-xprov-consent.cjs.
// ---------------------------------------------------------------------------

const io = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const OH = require('./xprov-owner-home.cjs');
const RI = require('./xprov-repo-identity.cjs');
const AU = require('./xprov-audit.cjs');
const AL = require('./xprov-allowlist.cjs');
const HA = require('./xprov-hit-approvals.cjs');
const Q = require('./xprov-consent-question.cjs');
const R = require('./xprov-consent-record.cjs');
const H = require('./xprov-consent-hits.cjs');

const KIND = 'allowlist';
const HITS_LISTED_MAX = 40;
const MASK = '[maskiert]';
const PATH_LINE_RE = /^Pfad: (.*)$/m;
const SCAN_LINE_RE = /^Scan: (.*)$/m;

const { refuse } = R;

/** The question text from the repository context and `ctx.allowlist` = { scan, commit, hits: [{ path, line, column, rule, blob }] }. */
function buildText(ctx) {
  const a = ctx.allowlist;
  return [
    `Soll ich ${a.hits.length === 1 ? 'die folgende Fundstelle' : `die folgenden ${a.hits.length} Fundstellen`} (mögliche Geheimnisse) für die Prüfung durch Codex freigeben?`,
    `Repo: ${ctx.name}`,
    `Pfad: ${ctx.path}`,
    `Scan: ${Q.clean(a.scan)}`,
    `Commit: ${a.commit}`,
    `Je Fundstelle: Datei, Zeile, Regel, sha256 des Blobs und eine feste Maske statt des Fundtexts. Der Wert selbst wird nie gezeigt.`,
    ...a.hits.map((h, i) => `Fund ${i + 1} von ${a.hits.length}: ${Q.clean(h.path)}:${h.line}:${h.column} · Regel ${Q.clean(h.rule)} · Blob sha256 ${h.blob} · Auszug ${MASK}`),
    'Das Ja deckt genau diese Blobs ab. Ein geänderter Blob und ein neuer Fund brauchen eine neue Frage.',
    'Es ersetzt weder die Freigabe zum Senden an Codex (xprov-Freigabe) noch einen Waiver.',
    'Ein Nein oder keine Antwort heisst: nichts wird freigegeben; Codex bekommt diese Dateien nicht, die Prüfung läuft ohne Codex (nur Reinhard).',
  ].join('\n');
}

/** The scope an allowlist question names, read back from its text: { path, scan } (strings as printed) or null. For the hook's recompute. */
function scopeFromText(text) {
  const p = PATH_LINE_RE.exec(String(text));
  const s = SCAN_LINE_RE.exec(String(text));
  return p && s ? { path: p[1], scan: s[1] } : null;
}

/** Every hit with its blob sha256, or a refusal. The list is bounded and may not name the allowlist file itself (its sha would read as an allowlist blob approval). */
function withBlobs(root, rec) {
  if (rec.hits.length === 0) return refuse('no_hits', 'the scan has no hit to approve; nothing written');
  if (rec.hits.length > HITS_LISTED_MAX) return refuse('too_many_hits', `the scan has ${rec.hits.length} hits, more than the ${HITS_LISTED_MAX} one question can list; narrow the scan first; nothing written`);
  const out = [];
  for (const h of rec.hits) {
    if (h.path === X.ALLOWLIST_FILE) return refuse('allowlist_file_hit', `a hit sits in ${X.ALLOWLIST_FILE} itself; its sha256 would read as an allowlist approval, so it cannot be approved by chat; nothing written`);
    const b = H.blobSha256(root, rec.commit, h.path);
    if (!b.ok) return refuse(b.reason, `${b.detail}; nothing written`);
    if (AL.parseAllowlist(b.bytes.toString('utf8')).ok) return refuse('allowlist_blob_hit', `the blob of ${C.clip(h.path, 120)} parses as an allowlist document; approving an allowlist stays the terminal \`xprov allowlist approve\`; nothing written`);
    out.push(Object.freeze({ ...h, blob: b.sha256 }));
  }
  return out;
}

/**
 * `o`: { root, scan (a snap-… basename) }. Throws a typed input error (exit 2) for a malformed scan name; otherwise
 * { ok: false, reason, detail } or { ok: true, key, question, hits, blobs }.
 */
function buildFor(o) {
  const key = C.commonDirOf(o.root);
  if (key === null) throw C.inputError(`${o.root} is not a git repository`, 'not_a_repository');
  const read = H.readHits(o.scan);
  if (!read.ok) return refuse(read.missing ? 'scan_not_found' : 'scan_unusable', `${read.why}; nothing written`);
  const rec = read.value;
  if (rec.repo_key !== key) return refuse('scan_foreign', 'the scan hits record belongs to another repository; nothing written');
  const hits = withBlobs(o.root, rec);
  if (!Array.isArray(hits)) return hits;
  const ctx = { ...Q.repoContext(o.root, RI.readOrigin(o.root)), allowlist: { scan: o.scan, commit: rec.commit, hits } };
  return Object.freeze({ ok: true, key, question: Q.buildQuestion(KIND, ctx), hits, blobs: Object.freeze([...new Set(hits.map((h) => h.blob))].sort()) });
}

const BY = C.RESERVED_BY;

/** One record per path + rule + blob with the number of occurrences the question listed (an extra occurrence later is not covered). */
function recordsOf(b, scan, audit, ts) {
  const groups = new Map();
  for (const h of b.hits) {
    const k = `${h.path}\t${h.rule}\t${h.blob}`;
    groups.set(k, { h, count: (groups.has(k) ? groups.get(k).count : 0) + 1 });
  }
  return [...groups.values()].map(({ h, count }) => HA.validRecord({ repo: b.key, path: h.path, rule: h.rule, blob: h.blob, scan, by: BY, audit, ts, count }));
}

/** Inside the store lock only: the hit store, the marker, the audit line, the write. `b` is the question built OUTSIDE the lock (SEC-6). */
function approveLocked(o, b) {
  const store = HA.readHitApprovals();
  if (!store.ok && !store.missing) return refuse('approvals_store_unusable', `the hit approval store is not usable (${store.why}); fix or remove it yourself; nothing written`);
  const claim = R.claimDecision({ repo: b.key, kind: KIND, hash: b.question.hash, now: o.now }, { reason: 'allowlist_declined', detail: 'the owner did not approve the blobs; nothing written' });
  if (!claim.ok) return claim;
  const m = claim.marker;
  let line;
  try { line = AU.appendAudit({ repo: b.key, action: AU.ACTION.CONSENT_ALLOWLIST, now: o.now, tool_use_id: m.tool_use_id, session_id: m.session_id, permission_mode: m.answer.permission_mode }); } catch (e) {
    return refuse(e.reason || 'audit_failed', `${R.errReason(e)}; nothing written (the marker is used: answer the question again)`);
  }
  const audit = AU.lineSha(line);
  const now = o.now || io.nowIso();
  const records = recordsOf(b, o.scan, audit, now);
  if (records.some((r) => r === null)) return refuse('hit_record_invalid', 'a hit approval record is off-format; nothing written (the marker is used: answer the question again)');
  const failed = R.step('write the hit approvals', 'no approval was written; the audit log has the line', () => HA.appendHitApprovals(records, require('./xprov-approve.cjs').writeGuardedStore));
  if (failed) return failed;
  return Object.freeze({ ok: true, kind: KIND, decision: 'yes', repo: b.key, scan: o.scan, audit, approved: b.blobs, hits: b.hits.length, store: X.HIT_APPROVALS_FILE, state: 'approved' });
}

/** `o`: { root, scan, now? }. See the header. Never throws for a refusal; a malformed scan name is a typed input error (exit 2). */
function approve(o) {
  const why = OH.homeMismatch();
  if (why !== null) return refuse('owner_home_mismatch', `${why}; nothing written`);
  const b = buildFor(o); // question text and git work outside the lock; a malformed scan name is a typed input error (exit 2) before any lock
  if (!b.ok) return b;
  return R.locked(() => approveLocked(o, b));
}

module.exports = { KIND, HITS_LISTED_MAX, MASK, buildText, scopeFromText, buildFor, approve };
