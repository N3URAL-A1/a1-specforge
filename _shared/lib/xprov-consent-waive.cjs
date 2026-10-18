'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-waive — the chat waiver (spec 016 FR-013; wave 3).
//
//   buildFor({ root, phase | workPath })  -> { ok: true, key, question, targets, skipped } | a refusal
//       The canonical xprov-Waiver question for every gate target of the phase that is failed at this moment (xprov-consent-targets.cjs
//       decides, from xreview/index.json and the run records; nothing comes from agent arguments). Plugin hook (wave 4): parse the repo
//       path and the scope out of the question text with `scopeFromText`, call `buildFor` again and compare byte for byte.
//   waive({ root, phase | workPath, now? })  -> { ok: true, ... } | { ok: false, reason, detail }
//       Writes one waiver record per LISTED target, same shape as the terminal `xprov waive` (`by: owner-chat`), through the existing
//       xprov-waivers.cjs store, and only against a marker with a real owner yes whose hash equals the question rebuilt NOW. A target that
//       changed since the question (new PLAN.md sha, new head) or a gate that failed after it changes the question: `question_changed`,
//       nothing written, a new question is needed. A No, free text or a missing answer writes nothing. The consent to send never implies it.
//
// Per phase (or per PR review run): marker kind `waiver`, one per repository. `--work-path` names a worktree of the same repository for the
// PR diff gate; the waiver store cannot key a pr-diff-xprov target yet (wave 10), so it lists no target and writes nothing.
// Order of every write (SEC-6): the question text, run-record reads and git work OUTSIDE the lock; inside the store lock: the marker, the audit
// line FIRST (consent-waive, the marker's tool_use_id and session_id), then the store (read again inside), then the mirror (index row, XREVIEW note, observation: no authority, failures are reported, not hidden). Tier 0: see help-xprov-consent.cjs.
// Request-scoped: clock and paths are parameters.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const io = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const OH = require('./xprov-owner-home.cjs');
const RI = require('./xprov-repo-identity.cjs');
const AU = require('./xprov-audit.cjs');
const WV = require('./xprov-waivers.cjs');
const Q = require('./xprov-consent-question.cjs');
const R = require('./xprov-consent-record.cjs');
const T = require('./xprov-consent-targets.cjs');

const KIND = 'waiver';
const BY = C.RESERVED_BY;
const TARGETS_LISTED_MAX = 12;
const FINDINGS_LISTED_MAX = 8;
const FINDINGS_UNVERIFIED = 'Befunde nicht prüfbar'; // a fixed line: the findings record does not match the run record, so no finding text is shown
const PR_REVIEW_DIR = path.join('.a1-review', 'xreview');
const PATH_LINE_RE = /^Pfad: (.*)$/m;
const PHASE_LINE_RE = /^Phase: (.*)$/m;
const WORKTREE_LINE_RE = /^Worktree: (.*)$/m;

const { refuse } = R;
const scopeLabel = (k) => (k.gate === X.GATE_IDS.PR_DIFF ? 'PR-Diff' : k.wave === null ? 'Plan' : `Wave ${k.wave}${k.lane ? `, Lane ${Q.clean(k.lane)}` : ''}`);
const shortSha = (s) => (s === null ? '-' : s);

function targetLines(t, i, n) {
  const k = t.key;
  const verdict = t.reason ? `${t.verdict} (${t.reason})` : t.verdict;
  const round = t.round !== null ? `, Runde ${t.round}${t.round >= X.ROUND_CAP ? ' (Rundenlimit erreicht)' : ''}` : ''; // only a round the run record proves (SEC-3)
  const out = [
    `Ziel ${i + 1} von ${n}: ${k.gate} (${scopeLabel(k)})`,
    `  Schlüssel: Repo ${Q.clean(k.repo)} · Phase ${Q.clean(k.phase)} · PLAN.md sha256 ${k.plan_sha256}`,
    ...(k.wave === null ? [] : [`  Wave ${k.wave} · Lane ${k.lane || '-'} · head ${shortSha(k.head)} · base ${shortSha(k.base)}`]),
    `  Fehlschlag: ${verdict}${round}`,
  ];
  if (t.findings === null) out.push(`  ${FINDINGS_UNVERIFIED}`);
  for (const sev of ['blocker', 'major']) {
    const list = (t.findings || []).filter((f) => f.severity === sev);
    if (list.length === 0) continue;
    out.push(`  Offene ${sev.toUpperCase()}:`);
    for (const f of list.slice(0, FINDINGS_LISTED_MAX)) out.push(`    - ${Q.clean(f.id)}: ${Q.clean(f.title)}`);
    if (list.length > FINDINGS_LISTED_MAX) out.push(`    (+${list.length - FINDINGS_LISTED_MAX} weitere)`);
  }
  if (t.quarantined > 0) out.push(`  Zurückgehaltene Befunde (quarantined): ${t.quarantined}`);
  return out;
}

/** The question text from the repository context and `ctx.waiver` = { phase, listed, more, skipped }. */
function buildText(ctx) {
  const w = ctx.waiver;
  return [
    `Soll ich ${w.listed.length === 1 ? 'das folgende fehlgeschlagene Ziel' : `die folgenden ${w.listed.length} fehlgeschlagenen Ziele`} per Waiver freigeben?`,
    `Repo: ${ctx.name}`,
    `Pfad: ${ctx.path}`,
    `Phase: ${Q.clean(w.phase)}`,
    ...(w.workPath ? [`Worktree: ${Q.clean(w.workPath)}`] : []), // the PR diff gate: the hook rebuilds the question from this path
    'Ein Waiver ist kein Bestanden. Er gilt nur für genau diese Ziele und nur, solange PLAN.md und Stand unverändert sind.',
    ...w.listed.flatMap((t, i) => targetLines(t, i, w.listed.length)),
    ...(w.more > 0 ? [`Weitere Ziele (${w.more}) sind hier nicht aufgeführt; das Ja deckt sie nicht ab.`] : []),
    ...(w.skipped.length ? [`Nicht per Chat waivbar: ${w.skipped.map((s) => `${s.gate}${s.wave === null ? '' : ` Wave ${s.wave}`} (${Q.clean(s.why)})`).join(', ')}.`] : []),
    'Das Ja deckt genau diese Ziele ab. Ein Ziel, das sich danach ändert (neue PLAN.md, neuer Head), und eine Prüfung, die danach fehlschlägt, brauchen eine neue Frage.',
    'Die Freigabe zum Senden an Codex (xprov-Freigabe) ist davon unabhängig und ersetzt keinen Waiver.',
    'Ein Nein oder keine Antwort heisst: nichts wird geschrieben, die Ziele bleiben fehlgeschlagen.',
  ].join('\n');
}

/** The scope a waiver question names, read back from its text: { path, phase } (strings as printed) or null. For the hook's recompute. */
function scopeFromText(text) {
  const p = PATH_LINE_RE.exec(String(text));
  const ph = PHASE_LINE_RE.exec(String(text));
  const w = WORKTREE_LINE_RE.exec(String(text));
  return p && ph ? { path: p[1], phase: ph[1], workPath: w ? w[1] : null } : null;
}

/** A worktree of the same repository for the PR diff gate: { dir } or a typed input error (exit 2). */
function workPathOf(root, workPath) {
  const dir = path.resolve(String(workPath));
  let st = null;
  try { st = fs.statSync(dir); } catch (_e) { st = null; }
  if (st === null || !st.isDirectory()) throw C.inputError(`--work-path is not a directory: ${C.clip(dir, 200)}`, 'work_path');
  if (C.commonDirOf(dir) !== C.commonDirOf(root)) throw C.inputError(`--work-path ${C.clip(dir, 200)} does not share the git-common-dir of the repository`, 'work_path_foreign');
  return { dir, reviewDir: path.join(dir, PR_REVIEW_DIR) };
}

/**
 * `o`: { root, phase | workPath }. The question for the failed targets of a phase. Throws a typed input error (exit 2) for a
 * traversal-shaped or unknown phase or work path; otherwise { ok: false, reason, detail } or { ok: true, key, question, targets, skipped, scan }.
 */
function buildFor(o) {
  if ((o.phase === undefined) === (o.workPath === undefined)) throw C.inputError('give exactly one of --phase <name> or --work-path <worktree>', 'scope_flags');
  const key = C.commonDirOf(o.root);
  if (key === null) throw C.inputError(`${o.root} is not a git repository`, 'not_a_repository');
  if (o.workPath !== undefined) {
    workPathOf(o.root, o.workPath);
  }
  const scan = T.collectTargets({ root: o.root, phase: o.phase, workPath: o.workPath });
  if (!scan.ok) return scan;
  if (scan.targets.length === 0) {
    return refuse('no_failed_targets', `no gate target of the phase ${C.clip(scan.phase, 80)} is failed at the current PLAN.md${scan.skipped.length ? ' that a chat waiver can key' : ''}; nothing to waive`);
  }
  const origin = RI.readOrigin(o.root);
  const listed = scan.targets.slice(0, TARGETS_LISTED_MAX);
  const ctx = { ...Q.repoContext(o.root, origin), waiver: { phase: scan.phase, workPath: o.workPath === undefined ? null : scan.ctx.workPath, listed, more: scan.targets.length - listed.length, skipped: scan.skipped } };
  return Object.freeze({ ok: true, key, question: Q.buildQuestion(KIND, ctx), targets: listed, skipped: scan.skipped, scan });
}

const recordOf = (t, hash, now) => Object.freeze({
  ...t.key, reason: C.clip(`chat waiver (xprov-Waiver ${hash.slice(0, 12)}): ${t.verdict}${t.reason ? `/${t.reason}` : ''}`, C.DETAIL_MAX_CHARS), by: BY, ts: now,
});

/** The mirrors (index row, XREVIEW note, observation) of the written records; failures are named, never hidden. */
function mirrorAll(root, scan, records) {
  const G = require('./xprov-gate.cjs');
  const ctx = { root, phase: scan.phase, workPath: scan.ctx.workPath, phaseDir: scan.ctx.phaseDir, planPath: scan.ctx.planPath, indexPath: scan.ctx.indexPath };
  const errors = [];
  for (const rec of records) {
    try { G.mirrorWaiver(ctx, rec); } catch (e) { errors.push(`${rec.gate} ${rec.wave === null ? 'plan' : `wave-${rec.wave}`}: ${C.clip(e && e.message ? e.message : String(e), 200)}`); }
  }
  return errors;
}

/** Inside the store lock only: the marker, the audit line, the waiver write, the mirror. `b` is the question built OUTSIDE the lock (SEC-6). */
function waiveLocked(o, b) {
  const now = o.now || io.nowIso();
  const claim = R.claimDecision({ repo: b.key, kind: KIND, hash: b.question.hash, now: o.now }, { reason: 'waiver_declined', detail: 'the owner did not confirm the waiver; nothing written' });
  if (!claim.ok) return claim;
  const m = claim.marker;
  let line;
  try { line = AU.appendAudit({ repo: b.key, action: AU.ACTION.CONSENT_WAIVE, now: o.now, tool_use_id: m.tool_use_id, session_id: m.session_id, permission_mode: m.answer.permission_mode }); } catch (e) {
    return refuse(e.reason || 'audit_failed', `${R.errReason(e)}; nothing written (the marker is used: answer the question again)`);
  }
  const records = b.targets.map((t) => recordOf(t, b.question.hash, now));
  const failed = R.step('write the waiver records', 'no record was written; the audit log has the line', () => WV.appendWaivers(records, require('./xprov-approve.cjs').writeGuardedStore));
  if (failed) return failed;
  const mirrorErrors = mirrorAll(o.root, b.scan, records);
  return Object.freeze({
    ok: true, kind: KIND, decision: 'yes', repo: b.key, phase: b.scan.phase, audit: AU.lineSha(line), waived: Object.freeze(records.map((r) => ({ gate: r.gate, wave: r.wave, lane: r.lane, head: r.head, base: r.base, plan_sha256: r.plan_sha256 }))),
    skipped: b.skipped, ...(mirrorErrors.length ? { mirror_errors: mirrorErrors } : {}), state: 'waived',
  });
}

/** `o`: { root, phase | workPath, now? }. See the header. Never throws for a refusal; a bad scope is a typed input error (exit 2). */
function waive(o) {
  if ((o.phase === undefined) === (o.workPath === undefined)) throw C.inputError('give exactly one of --phase <name> or --work-path <worktree>', 'scope_flags');
  if (o.phase !== undefined) T.phaseOf(o.root, o.phase); // a traversal-shaped or unknown phase is exit 2 before any lock
  else workPathOf(o.root, o.workPath);
  const why = OH.homeMismatch();
  if (why !== null) return refuse('owner_home_mismatch', `${why}; nothing written`);
  const b = buildFor(o); // question text, run-record reads and git work outside the lock; a bad scope is a typed input error (exit 2)
  if (!b.ok) return b;
  return R.locked(() => waiveLocked(o, b));
}

module.exports = { KIND, TARGETS_LISTED_MAX, buildText, scopeFromText, buildFor, waive };
