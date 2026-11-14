'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-decline — the owner says "no Codex" for ONE unrun plan-review-xprov target (spec 028 FR-022, FR-023, FR-024; wave 6).
//
//   buildFor({ root, phase })  -> { ok: true, key, question, planSha, head, phaseCtx } | a refusal
//       The canonical xprov-Decline question for the plan-review-xprov target of the phase: repo, phase, target and PLAN.md sha256, and the
//       sentence that nothing is sent to Codex. Only for a target with NO index row at the current PLAN.md sha: a row means the target already ran
//       (or was closed), `target_already_run`. The target is never an argument; design-review-xprov is not offered.
//   decline({ root, phase, now? })  -> { ok: true, ... } | { ok: false, reason, detail }
//       Acts only on a recorded canonical yes bound to the question hash (`claimDecision`, the claim path of the chat waiver). Any other answer, a
//       missing answer or an edited PLAN.md: `decline_not_confirmed`, nothing written. The decline covers the PLAN.md content (its sha), not the head: a moved head
//       leaves the yes valid (the marker records the head it was written at, for information only). A yes writes a1's marker `a1-declined.json`
//       (kind owner_declined) into a new `declined-` run dir of the artifacts dir and appends the index row { accepted: 'owner_declined', … }
//       (no verdict), exactly like `xprov dispose --secret-declined`; load-check reads the row only through that marker. A second call for the same
//       PLAN.md sha: `already_declined` (ok, nothing written).
//
// What it never does (FR-024): write `.a1/xprov.json`, the permit store or the waiver store, create a waiver, or send anything to Codex. This module
// imports neither the guarded store writer nor the waiver appender; it reads no Codex endpoint. Request-scoped: clock and paths are parameters.
// Tier 0: the same OS user could write the marker by hand; the recorded owner answer is the audit trail, not a lock.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeTextAtomic, nowIso } = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const OH = require('./xprov-owner-home.cjs');
const RI = require('./xprov-repo-identity.cjs');
const RR = require('./xprov-runrecord.cjs');
const A = require('./xprov-artifacts.cjs');
const Q = require('./xprov-consent-question.cjs');
const R = require('./xprov-consent-record.cjs');
const T = require('./xprov-consent-targets.cjs');

const KIND = 'decline';
const ACCEPTED = 'owner_declined';
const DIR_PREFIX = 'declined-';
const MARKER_FILE = 'a1-declined.json';
const GATE = X.GATE_IDS.PLAN_REVIEW;
const PATH_LINE_RE = /^Pfad: (.*)$/m;
const PHASE_LINE_RE = /^Phase: (.*)$/m;

const { refuse } = R;

/** The question text from the repository context and `ctx.decline` = { phase, planSha, head }. */
function buildText(ctx) {
  const d = ctx.decline;
  return [
    `Soll für das Ziel ${GATE} der Phase "${Q.clean(d.phase)}" nichts an Codex gesendet werden?`,
    `Repo: ${ctx.name}`,
    `Pfad: ${ctx.path}`,
    `Phase: ${Q.clean(d.phase)}`,
    `Ziel: ${GATE} (Plan)`,
    `PLAN.md sha256: ${d.planSha}`,
    'Das Ja heisst: für dieses Ziel wird nichts an Codex gesendet. Es läuft nur die Claude-Prüfung (Reinhard, bei Sicherheitsfläche Samuel).',
    'Das Ja gilt nur für genau dieses Ziel und diesen PLAN.md-sha (den Inhalt der PLAN.md). Eine geänderte PLAN.md braucht eine neue Frage.',
    'Es ist kein Waiver und keine Freigabe zum Senden; die Freigabe des Repos bleibt davon unberührt.',
    'Ein Nein oder keine Antwort heisst: Codex-Prüfung wie vorgesehen.',
  ].join('\n');
}

/** The scope a decline question names, read back from its text: { path, phase } (strings as printed) or null. For the hook's recompute. */
function scopeFromText(text) {
  const p = PATH_LINE_RE.exec(String(text));
  const ph = PHASE_LINE_RE.exec(String(text));
  return p && ph ? { path: p[1], phase: ph[1] } : null;
}

const headOf = (root) => {
  const out = C.gitOut(['-C', root, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  return out === null ? null : out.trim();
};

/** `o`: { root, phase }. See the header. Throws a typed input error (exit 2) for a missing phase flag or a traversal-shaped or unknown phase. */
function buildFor(o) {
  if (o.phase === undefined) throw C.inputError('give --phase <name>', 'scope_flags');
  const key = C.commonDirOf(o.root);
  if (key === null) throw C.inputError(`${o.root} is not a git repository`, 'not_a_repository');
  const ctx = T.phaseOf(o.root, o.phase);
  const planBytes = C.readNoFollow(ctx.planPath, X.MAX_RESULT_BYTES * 4);
  if (!planBytes) return refuse('plan_missing', `PLAN.md not found (or not a regular file) in the phase ${C.clip(ctx.phase, 80)}`);
  const index = C.readIndex(ctx.indexPath);
  if (index === null) return refuse('index_unreadable', 'xreview/index.json is unparseable or not an array of objects');
  const planSha = C.sha256(planBytes);
  const ran = index.some((e) => e.gate === GATE && e.plan_sha256 === planSha);
  if (ran) return refuse('target_already_run', `${GATE} already has an index row at the current PLAN.md sha of the phase ${C.clip(ctx.phase, 80)}; a decline is only for a target that has not run; nothing written`);
  const head = headOf(o.root);
  if (head === null) return refuse('head_unusable', 'HEAD does not resolve in the repository; nothing written');
  const dctx = { ...Q.repoContext(o.root, RI.readOrigin(o.root)), decline: { phase: ctx.phase, planSha, head } };
  return Object.freeze({ ok: true, key, question: Q.buildQuestion(KIND, dctx), planSha, head, phaseCtx: ctx });
}

/** The index row + marker of an earlier decline for exactly this PLAN.md sha (the head is not part of the binding), or null. */
function earlierDecline(o) {
  const ctx = T.phaseOf(o.root, o.phase);
  const planBytes = C.readNoFollow(ctx.planPath, X.MAX_RESULT_BYTES * 4);
  const index = planBytes ? C.readIndex(ctx.indexPath) : null;
  if (!planBytes || index === null) return null;
  const planSha = C.sha256(planBytes);
  const row = index.find((e) => e.gate === GATE && e.accepted === ACCEPTED && e.plan_sha256 === planSha
    && RR.declinedMarker(e.result_path, { planSha, gate: GATE, wave: null, lane: null, kind: ACCEPTED }, o.root) !== null);
  const marker = row ? RR.declinedMarker(row.result_path, { planSha, gate: GATE, wave: null, lane: null, kind: ACCEPTED }, o.root) : null;
  return row ? { row, planSha, head: marker.head, ctx } : null;
}

/** Inside the owner-store lock only: the claim of the recorded yes, then marker and index row. `b` is the question built OUTSIDE the lock. */
function declineLocked(o, b) {
  // the target may have run between the question build (outside the lock) and now: re-read the index under the lock before the yes is spent
  const now = C.readIndex(b.phaseCtx.indexPath);
  if (now === null) return refuse('index_unreadable', 'xreview/index.json is unparseable or not an array of objects; nothing written');
  if (now.some((e) => e.gate === GATE && e.plan_sha256 === b.planSha)) return refuse('target_already_run', `${GATE} got an index row at the current PLAN.md sha while the decline was prepared; nothing written`);
  const claim = R.claimDecision({ repo: b.key, kind: KIND, hash: b.question.hash, now: o.now }, { reason: 'decline_not_confirmed', detail: 'the owner did not confirm the decline' });
  if (!claim.ok) return refuse('decline_not_confirmed', `the owner's yes is not recorded for this question (${claim.reason}); nothing written`);
  const m = claim.marker;
  const ts = o.now || nowIso();
  const marker = Object.freeze({
    version: 1, kind: ACCEPTED, gate: GATE, wave: null, lane: null, plan_sha256: b.planSha, head: b.head, base: null,
    question_hash: b.question.hash, tool_use_id: m.tool_use_id, session_id: m.session_id, answered_at: m.answer.at, ts,
  });
  const dir = path.join(X.artifactsDir(A.repoSlug(o.root)), `${DIR_PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
  const file = path.join(dir, MARKER_FILE);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const fresh = C.readIndex(b.phaseCtx.indexPath);
    if (fresh === null) throw new Error('index.json changed underneath the command');
    const entry = Object.freeze({ gate: GATE, wave: null, lane: null, accepted: ACCEPTED, reason: ACCEPTED, plan_sha256: b.planSha, result_path: file, ts });
    fs.mkdirSync(path.dirname(b.phaseCtx.indexPath), { recursive: true });
    writeTextAtomic(b.phaseCtx.indexPath, `${JSON.stringify([...fresh, entry], null, 2)}\n`);
    return Object.freeze({ ok: true, gate: GATE, phase: b.phaseCtx.phase, accepted: ACCEPTED, plan_sha256: b.planSha, head: b.head, marker_path: file, index_path: b.phaseCtx.indexPath, state: 'declined' });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    return refuse('decline_unwritable', `not written: ${C.clip(e.message, 160)} (the marker is used: answer the question again)`);
  }
}

/** `o`: { root, phase, now? }. See the header. Never throws for a refusal; a bad scope is a typed input error (exit 2). */
function decline(o) {
  if (o.phase === undefined) throw C.inputError('give --phase <name>', 'scope_flags');
  T.phaseOf(o.root, o.phase); // a traversal-shaped or unknown phase is exit 2 before any lock
  const why = OH.homeMismatch();
  if (why !== null) return refuse('owner_home_mismatch', `${why}; nothing written`);
  const earlier = earlierDecline(o);
  if (earlier !== null) {
    return Object.freeze({ ok: true, reason: 'already_declined', gate: GATE, phase: earlier.ctx.phase, accepted: ACCEPTED, plan_sha256: earlier.planSha, head: earlier.head, state: 'declined' });
  }
  const b = buildFor(o); // question text and git work outside the lock
  if (!b.ok) return b;
  return R.locked(() => declineLocked(o, b));
}

module.exports = { KIND, ACCEPTED, MARKER_FILE, buildText, scopeFromText, buildFor, decline };
