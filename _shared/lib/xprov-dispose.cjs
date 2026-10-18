'use strict';

// ---------------------------------------------------------------------------
// xprov dispose — the round-cap dispositions (spec 016 Wave 9, FR-025; owner decision 2026-10-14).
//
//   a1-tools xprov dispose --phase <name> --gate plan-review-xprov|wave-inspect-xprov [--wave N [--lane L] --work-path <dir>]
//
// Round 2 of a gate target ended without APPROVED (`round_cap`). When round 2 holds NO blocker, the agent writes the host-authored
// dispositions file `xreview/<gate>-<target>-r2.dispositions.md` — one line per finding id:
//     <id>: fixed: <what changed>        or        <id>: accepted: <reason>
// and runs this command. It succeeds only when EVERY major, minor and quarantined id of round 2 carries one of the two with a non-empty
// reason (secret- and instruction-shaped reasons do not count). Then it
//   - writes a1's marker `a1-disposed.json` (0600, flag wx) into the run dir of the round-2 answer (plan sha after the fixes, findings hash,
//     for a wave the work path's HEAD now and the reviewed base),
//   - appends the index row { gate, wave, lane, accepted: 'dispositions', … } (no `verdict`, no `round`: it is no round and no verdict),
//   - appends an XREVIEW.md section and one observation (pattern xprov_disposed).
// `load-check` and `wave-status` accept the row ONLY through the marker (xprov-runrecord.cjs disposedMarker), like a pass: the index is a
// pointer. A blocker keeps the hard stop (refused `blocker_open`); an id without a usable disposition refuses `undisposed` and the target
// goes to the per-phase waiver question. The facts come from the round-2 run dir in a1's artifacts dir, not from the index row or the
// phase-dir findings file. No owner store is read or written; a hostile dispositions file never reaches a path (ids are opaque strings).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseFlags, repoRoot, assertSafeSegment, writeTextAtomic, nowIso } = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const RR = require('./xprov-runrecord.cjs');
const WV = require('./xprov-waivers.cjs');
const { dispositionsPath } = require('./xprov-feedback.cjs');
const { filterOutput, instructionMarker } = require('./xprov-filter.cjs');
const { appendXreviewNote } = require('./xprov-normalize.cjs');
const { observe } = require('./xprov-observe.cjs');

const ACCEPTED = 'dispositions';
const RETRO_ISSUE = 'xprov_disposed';
const KINDS = Object.freeze(['fixed', 'accepted']);
const REASON_MAX_CHARS = 1000;
const NOTE_REASON_CHARS = 200;
const SHOWN_IDS_MAX = 20;
const ID_SHOWN_CHARS = 60;
const EXTERNAL_AGENT = 'xprov-codex';
const REFUSALS = Object.freeze({
  not_at_cap: 'round_cap_not_reached', not_a_revise: 'not_a_revise', blocker_open: 'blocker_open', undisposed: 'undisposed', run_unbound: 'round_unbound',
  already: 'already_disposed', no_base: 'no_reviewed_base', head_moved: 'head_not_descendant', unwritable: 'dispose_unwritable',
});

const refuse = (code, detail, extra) => Object.freeze({ ok: false, refused: code, detail, ...(extra || {}) });
const scopeOf = (wave, lane) => `${wave === null ? 'plan' : `wave ${wave}`}${lane ? ` lane ${lane}` : ''}`;
const shown = (id) => C.oneLine(C.clip(String(id), ID_SHOWN_CHARS));

// ---------- dispositions file ----------

/** One reason as { ok, reason } | { ok: false, why }: non-empty, one line, bounded, not secret- or instruction-shaped. */
function usableReason(raw) {
  const reason = String(raw).trim();
  if (reason === '') return { ok: false, why: 'empty_reason' };
  if (reason.length > REASON_MAX_CHARS) return { ok: false, why: 'reason_too_long' };
  if (/[\u0000-\u001f\u007f]/.test(reason) || new RegExp(C.LINE_BREAKERS_RE.source).test(reason)) return { ok: false, why: 'reason_control_chars' };
  const secret = filterOutput([reason]);
  if (secret && secret.hit) return { ok: false, why: 'reason_secret_shaped' };
  if (instructionMarker({ id: '', evidence: reason, fix: '' }, []) !== null) return { ok: false, why: 'reason_instruction_shaped' };
  return { ok: true, reason };
}

/** The disposition of `id` in `text`: the FIRST line `[- ]<id>[:|-|—] fixed|accepted: <reason>` (a bullet and backticks around the id are fine). */
function dispositionOf(lines, id) {
  const head = new RegExp(`^\\s*(?:[-*]\\s+)?\`?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`?\\s*(?:[:\\u2014\\u2013-])\\s*(fixed|accepted)\\s*:\\s*(.*)$`);
  for (const line of lines) {
    const m = head.exec(line);
    if (m) return { kind: m[1], ...usableReason(m[2]) };
  }
  return { kind: null, ok: false, why: 'no_line' };
}

/** { dispositions: [{ id, kind, reason }], problems: [{ id, why }] } for the required `ids` over the file text. */
function judgeDispositions(text, ids) {
  const lines = text.split(/\r?\n/);
  const dispositions = [];
  const problems = [];
  for (const id of ids) {
    const d = dispositionOf(lines, id);
    if (d.ok && KINDS.includes(d.kind)) dispositions.push(Object.freeze({ id, kind: d.kind, reason: d.reason })); else problems.push(Object.freeze({ id: shown(id), why: d.why }));
  }
  return { dispositions, problems };
}

// ---------- the round-2 facts ----------

/** The ids round 2 left open: major, minor and quarantined (a quarantined blocker is disposed like a major), and the open blocker ids. */
function openIds(doc) {
  const ids = (bucket) => (Array.isArray(doc[bucket]) ? doc[bucket] : []).filter(C.isPlainObject).map((f) => f.id).filter((id) => typeof id === 'string' && id !== '');
  return { blockers: ids('blocker'), others: [...new Set([...ids('major'), ...ids('minor'), ...ids('quarantined')])] };
}

/** The round-cap index row and its verified run record + findings, or a refusal. */
function capRound(ctx, index) {
  const rows = index.filter((e) => e.gate === ctx.gate && C.sameWave(e, ctx.wave) && C.sameLane(e, ctx.lane) && /^\d+$/.test(String(e.round)));
  const row = rows.find((e) => Number(e.round) === X.ROUND_CAP);
  if (!row) return refuse(REFUSALS.not_at_cap, `${ctx.gate} ${scopeOf(ctx.wave, ctx.lane)} holds ${rows.length} completed round(s); dispositions close round ${X.ROUND_CAP} only`);
  if (row.verdict !== X.VERDICTS.FAIL_WITH_FINDINGS) return refuse(REFUSALS.not_a_revise, `round ${X.ROUND_CAP} of ${ctx.gate} ${scopeOf(ctx.wave, ctx.lane)} is ${row.verdict}; there is nothing to dispose`);
  const rec = RR.runRecord(row.result_path, ctx.root);
  const mode = ctx.gate === X.GATE_IDS.PLAN_REVIEW ? 'review' : 'inspect';
  const runDir = typeof row.result_path === 'string' ? path.dirname(path.resolve(row.result_path)) : null;
  const doc = rec === null || runDir === null ? null : RR.verifiedFindings(runDir, row.findings_sha256);
  if (rec === null || doc === null || rec.mode !== mode || rec.status !== 'completed' || !C.isPlainObject(rec.response) || rec.response.verdict !== 'REVISE'
    || doc.gate !== ctx.gate || C.waveNumber(doc.wave) !== ctx.wave || (doc.lane === undefined ? null : doc.lane) !== ctx.lane || doc.round !== X.ROUND_CAP) {
    return refuse(REFUSALS.run_unbound, `the round-${X.ROUND_CAP} row does not match a completed REVISE run record and a verified findings record in a1's artifacts dir`);
  }
  return Object.freeze({ ok: true, row, rec, doc, runDir });
}

/** The binding of the target at dispose time: the plan sha now and, for a wave, the work path's HEAD and the reviewed base. */
function bindingOf(ctx, cap) {
  const planSha = C.sha256(fs.readFileSync(ctx.planPath));
  if (ctx.wave === null) return Object.freeze({ ok: true, planSha, head: null, base: null });
  const repo = C.commonDirOf(ctx.root);
  const h = WV.headIn(ctx.workPath, repo);
  if (h.problem) return refuse(REFUSALS.unwritable, h.problem);
  const hb = RR.reviewedHeadBase(cap.row.result_path, cap.rec, ctx.root);
  if (hb.base === null) return refuse(REFUSALS.no_base, 'the round-2 run dir holds no reviewed head and base');
  if (!WV.inHistory(ctx.workPath, hb.head, h.head)) return refuse(REFUSALS.head_moved, 'the work path HEAD does not contain the commit round 2 reviewed');
  return Object.freeze({ ok: true, planSha, head: h.head, base: hb.base });
}

// ---------- the command ----------

function context(o) {
  const phase = assertSafeSegment(o.phase, '--phase');
  if (![X.GATE_IDS.PLAN_REVIEW, X.GATE_IDS.WAVE_INSPECT, X.GATE_IDS.PR_DIFF].includes(o.gate)) throw C.inputError(`--gate must be ${X.GATE_IDS.PLAN_REVIEW}, ${X.GATE_IDS.WAVE_INSPECT} or ${X.GATE_IDS.PR_DIFF}, got ${JSON.stringify(C.clip(String(o.gate), 80))}`);
  const isPlan = o.gate === X.GATE_IDS.PLAN_REVIEW;
  if (isPlan && (o.wave !== undefined || o.lane !== undefined || o.workPath !== undefined)) throw C.inputError('plan-review-xprov takes no --wave, --lane or --work-path');
  if (!isPlan && o.wave === undefined) throw C.inputError('wave-inspect-xprov and pr-diff-xprov require --wave <N> (and --work-path <dir> for a worktree)');
  const root = repoRoot();
  const workPath = o.workPath === undefined ? root : path.resolve(String(o.workPath));
  if (!fs.existsSync(workPath) || !fs.statSync(workPath).isDirectory()) throw C.inputError(`--work-path is not a directory: ${workPath}`);
  const phaseDir = C.phaseDirOf(root, phase, workPath); // the reserved PR phase keeps its state in <work-path>/.a1-review (pr-diff-xprov)
  if (!fs.existsSync(phaseDir) || !fs.statSync(phaseDir).isDirectory()) throw C.inputError(`phase dir not found: ${phaseDir}`);
  const planPath = path.join(phaseDir, 'PLAN.md');
  if (!fs.existsSync(planPath)) throw C.inputError(`PLAN.md not found in ${phaseDir}`);
  const indexPath = path.join(phaseDir, 'xreview', 'index.json');
  const index = C.readIndex(indexPath);
  if (index === null) throw C.inputError(`index.json unparseable or not an array of objects: ${indexPath}`);
  return Object.freeze({ phase, root, phaseDir, planPath, indexPath, index, workPath, gate: o.gate, isPlan, wave: isPlan ? null : C.parseWave(o.wave, 'wave'), lane: isPlan ? null : C.parseLane(o.lane) });
}

/** a1's marker in the round-2 run dir, then the index row; the marker is `wx`: a second dispose of the same round is an `already_disposed`. */
function record(ctx, cap, bind, judged, dispositionsSha) {
  const marker = {
    gate: ctx.gate, wave: ctx.wave, lane: ctx.lane, round: X.ROUND_CAP, plan_sha256: bind.planSha, reviewed_plan_sha256: cap.rec.plan_sha256,
    findings_sha256: cap.row.findings_sha256, dispositions_sha256: dispositionsSha, head: bind.head, base: bind.base, ts: nowIso(),
    fixed: judged.dispositions.filter((d) => d.kind === 'fixed').length, accepted: judged.dispositions.filter((d) => d.kind === 'accepted').length,
  };
  try { fs.writeFileSync(path.join(cap.runDir, RR.DISPOSED_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); } catch (e) {
    return refuse(e.code === 'EEXIST' ? REFUSALS.already : REFUSALS.unwritable, e.code === 'EEXIST' ? 'this round-2 run dir is already disposed; a later PLAN.md change needs a new review, not a second disposition' : `marker not written: ${C.clip(e.message, 120)}`);
  }
  const entry = Object.freeze({
    gate: ctx.gate, wave: ctx.wave, lane: ctx.lane, accepted: ACCEPTED, reason: X.REASONS.round_cap, plan_sha256: bind.planSha, result_path: cap.row.result_path,
    ...(ctx.wave === null ? {} : { head: bind.head, base: bind.base }), fixed: marker.fixed, accepted_count: marker.accepted, ts: marker.ts,
  });
  const fresh = C.readIndex(ctx.indexPath);
  if (fresh === null) return refuse(REFUSALS.unwritable, 'index.json changed underneath the command');
  writeTextAtomic(ctx.indexPath, `${JSON.stringify([...fresh, entry], null, 2)}\n`);
  return Object.freeze({ ok: true, marker, entry });
}

function note(ctx, bind, judged) {
  const lines = [`gate: ${ctx.gate}`, `scope: ${scopeOf(ctx.wave, ctx.lane)}`, `accepted: ${ACCEPTED}`, `plan_sha256: ${bind.planSha}`, ...(bind.head ? [`head: ${bind.head}`, `base: ${bind.base}`] : []),
    ...judged.dispositions.map((d) => `${shown(d.id)} · ${d.kind} · ${C.clip(d.reason, NOTE_REASON_CHARS)}`)];
  const xreviewPath = appendXreviewNote(ctx.phaseDir, `Dispositions · ${ctx.gate} · ${scopeOf(ctx.wave, ctx.lane)}`, lines);
  let obs = null;
  try {
    obs = observe({
      repoRoot: ctx.root, agent: EXTERNAL_AGENT, skill: ctx.isPlan ? 'a1-plan' : 'a1-execute', phase: ctx.phase, wave: ctx.wave, lane: ctx.lane || undefined,
      type: 'gap', severity: 'minor', pattern: RETRO_ISSUE, provider: 'codex',
      msg: C.clip(`${ctx.gate} ${scopeOf(ctx.wave, ctx.lane)}: round_cap closed by dispositions (${judged.dispositions.length} id(s))`, X.TITLE_MAX_CHARS * 4),
    });
  } catch (e) { process.stderr.write(`xprov dispose: observation not written: ${C.clip(String(e && e.message), 200)}\n`); } // the disposition itself stands
  return { xreviewPath, observationFile: obs && obs.file ? obs.file : null };
}

/** { ok: true, … } or a refusal { ok: false, refused, detail }. Throws A1_INPUT for a usage error before anything is written. */
function dispose(o) {
  const ctx = context(o);
  const cap = capRound(ctx, ctx.index);
  if (!cap.ok) return cap;
  const open = openIds(cap.doc);
  if (open.blockers.length) return refuse(REFUSALS.blocker_open, `round ${X.ROUND_CAP} holds ${open.blockers.length} blocker(s): ${open.blockers.slice(0, SHOWN_IDS_MAX).map(shown).join(', ')} — the hard stop stays; only an owner waiver leads on`, { blockers: open.blockers.slice(0, SHOWN_IDS_MAX).map(shown) });
  const file = dispositionsPath(ctx, X.ROUND_CAP);
  const bytes = open.others.length ? C.readNoFollow(file, X.MAX_RESULT_BYTES) : Buffer.from('');
  if (!bytes) return refuse(REFUSALS.undisposed, `the dispositions file ${file} is missing (a regular file is required)`, { undisposed: open.others.slice(0, SHOWN_IDS_MAX).map((id) => ({ id: shown(id), why: 'no_file' })) });
  const judged = judgeDispositions(bytes.toString('utf8'), open.others);
  if (judged.problems.length) return refuse(REFUSALS.undisposed, `${judged.problems.length} of ${open.others.length} finding id(s) carry no usable fixed|accepted line — the target goes to the waiver question`, { undisposed: judged.problems.slice(0, SHOWN_IDS_MAX) });
  const bind = bindingOf(ctx, cap);
  if (!bind.ok) return bind;
  const done = record(ctx, cap, bind, judged, C.sha256(bytes));
  if (!done.ok) return done;
  const n = note(ctx, bind, judged);
  return Object.freeze({
    ok: true, gate: ctx.gate, phase: ctx.phase, wave: ctx.wave, lane: ctx.lane, accepted: ACCEPTED, plan_sha256: bind.planSha, head: bind.head, base: bind.base,
    fixed: done.marker.fixed, accepted_count: done.marker.accepted, entry: done.entry, index_path: ctx.indexPath, xreview_path: n.xreviewPath, observation_file: n.observationFile, retro_issue: RETRO_ISSUE,
  });
}

function cmdXprovDispose(args) {
  const flags = parseFlags(args || [], { phase: 'str', gate: 'str', wave: 'str', lane: 'str', 'work-path': 'str', 'secret-declined': 'str', base: 'str' });
  const usage = (m) => C.usageExit('dispose', m);
  if (flags._.length) return usage(`unexpected argument ${JSON.stringify(C.clip(String(flags._[0]), 80))}`);
  if (!flags.phase || !flags.gate) return usage('requires --phase <name> --gate <id> [--wave N [--lane <id>] --work-path <dir>]');
  if (flags.base !== undefined && flags['secret-declined'] === undefined) return usage('--base belongs to --secret-declined');
  let r;
  try {
    const target = { phase: flags.phase, gate: flags.gate, wave: flags.wave, lane: flags.lane, workPath: flags['work-path'] };
    r = flags['secret-declined'] === undefined ? dispose(target) : require('./xprov-decline.cjs').decline(context(target), { scan: flags['secret-declined'], base: flags.base });
  } catch (e) {
    if (e && e.code === 'A1_INPUT') return usage(e.message);
    throw e;
  }
  if (r.ok && r.accepted === 'secret_declined') {
    process.stderr.write(`xprov dispose: ${r.gate} ${scopeOf(r.wave, r.lane)} closed without Codex: the allowlist question was declined (Reinhard-only review; record verdict not_applicable, reason secret_declined)\n`);
    return C.emitJson(r, X.EXIT_PASS);
  }
  process.stderr.write(r.ok
    ? `xprov dispose: ${r.gate} ${scopeOf(r.wave, r.lane)} closed by dispositions (${r.fixed} fixed, ${r.accepted_count} accepted) — add ${RETRO_ISSUE} to the retro's issues and keep gates_fired verdict fail\n`
    : `xprov dispose: refused (${r.refused}): ${r.detail}\n`);
  return C.emitJson(r, r.ok ? X.EXIT_PASS : X.EXIT_FAIL);
}

module.exports = { ACCEPTED, RETRO_ISSUE, REFUSALS, REASON_MAX_CHARS, judgeDispositions, openIds, dispose, cmdXprovDispose };
