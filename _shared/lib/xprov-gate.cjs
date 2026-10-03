'use strict';

// ---------------------------------------------------------------------------
// xprov-gate — the one deterministic driver the workflows call
// (spec 009-cross-provider-review-gate, Wave 6; FR-002, FR-003, FR-004,
// FR-006, FR-007). Sole writer: this wave.
//
//   gate        permit-check → preflight → snapshot → run → normalize →
//               observe → cleanupSnapshot, in that order, stopping at the
//               first non-zero step; every outcome appends one entry to
//               .a1/phases/<name>/PLAN-REVIEW-LOG.md naming the step and
//               reason. Plan review snapshots the primary checkout at HEAD;
//               wave inspect snapshots $WORK_PATH at its HEAD.
//   load-check  sha256(PLAN.md) must equal the newest plan-review-xprov PASS
//               entry's plan_sha256, or a waiver in the guarded store must be
//               bound to that sha (xprov-waivers.cjs), else plan_review_missing.
//               --expect-sha <sha>: the plan accepted at Load (a1-execute
//               re-runs this before every wave; FR-003 TOCTOU).
//   wave-status every completed wave (STATUS*.md `## Wave N` headings, or
//               --waves) needs a wave-inspect-xprov pass or a store waiver
//               for that wave, lane, plan sha and a head in --work-path's history.
//   waive       HUMAN ONLY (FR-007): the guards of the allowlist owner
//               approval (TTY, no CLAUDE* env, no Claude Code ancestor), the
//               key computed here, the gate id typed back, then one record in
//               ~/.a1-xprov/waivers.json; index.json/XREVIEW.md get a mirror
//               without authority. Never a verdict.
//
// Enforcement (`warning|blocking`) is READ here from the gate's registry row —
// the only read site — and ECHOED in stdout; it is never applied. The workflow
// text decides between "warning block + continue" and "halt", so the Wave 7
// flip changes one registry cell and no code.
//
// Rounds: `--round` defaults to 1 + the index entries already held for this
// gate/wave (entries with a numeric `round`, i.e. normalize's rows, never
// waivers); round > 2 is `round_cap` before any runner call; a REVISE at round
// 2 is reported as fail/round_cap. No round ever resumes a Codex session
// (Samuel, Wave 7 MAJOR): `codex exec resume` replays the earlier conversation
// from the dedicated home's rollout/sqlite files, which are runtime — outside
// the tripwire and the preflight — so a Bash-capable agent could rewrite round
// 1 between the rounds. Plan round N ≥ 2 after a REVISE is a FRESH session
// whose `--feedback` a1 builds itself: the round N−1 findings as normalize
// wrote them into a1's own 0700 run dir, plus the host-authored dispositions;
// the snapshot scans and copies that file like the PLAN.md.
//
// `run` and `normalize` export CLIs only, so the driver invokes them as
// subprocesses of this same a1-tools (argv arrays, cwd = repo root) and reads
// their stdout JSON; permit/preflight/snapshot/observe are in-process calls.
// The runner is reached ONLY through `run`. stdout here is written with a
// blocking fs.writeSync loop + process.exitCode (never process.exit after a
// stdout write — a piped stdout on macOS truncates at 64 KiB).
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseFlags, repoRoot, assertSafeSegment, writeTextAtomic, nowIso } = require('./io.cjs');
const { parseRegistryRow } = require('./gate-ids.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
// Shared helpers — one definition each, in xprov-common.cjs.
const { REGISTRY_PATH, LANE_RE, DETAIL_MAX_CHARS, inputError, clip, parsePositive, sha256, isPlainObject, readIndex, sameWave, sameLane, writeStdoutSync, gitOut } = C;
const { permitCheck } = require('./xprov-permit.cjs');
const { preflight } = require('./xprov-preflight.cjs');
const { snapshot, cleanupSnapshot, INPUTS_SUFFIX, INPUT_FILES } = require('./xprov-snapshot.cjs');
const { observe, MODEL_RE } = require('./xprov-observe.cjs');
const WV = require('./xprov-waivers.cjs');
const { guardRefusal, readTypedLine, writeGuardedStore } = require('./xprov-approve.cjs');
const { appendXreviewNote, PRIOR_FINDINGS_FILE } = require('./xprov-normalize.cjs');
const { ensureArtifactsDir, isUnder } = require('./xprov-artifacts.cjs');
// Owned by run (one header text, one flag name): the `--no-log` flag keeps `run`
// from writing its own log entry when the driver writes the one entry per call.
const { LOG_HEADER, NO_LOG_FLAG } = require('./xprov-run.cjs');

const A1_TOOLS = path.join(__dirname, '..', 'a1-tools.cjs');
const LOG_FILE = 'PLAN-REVIEW-LOG.md';
const ENFORCEMENTS = Object.freeze(['warning', 'blocking']);
const RETRO_ISSUE_WAIVED = 'xprov_waived';
const EXTERNAL_AGENT = 'xprov-codex';
const SUB_MAX_BUFFER = 64 * 1024 * 1024;
const BASE_HEX_RE = /^[0-9a-f]{7,40}$/i; // same rule as `run`: a resolved sha, never a symbolic ref
// A round is a review that produced a verdict to act on (pass or
// fail-with-findings); every other outcome (blocked, runner_failed, secret_*,
// quarantined, plan_changed, tripwire, …) is an attempt that does not consume
// the cap (team-lead decision, 2026-09-24). normalize owns the distinction: it
// writes `round: N` for rounds and `attempt: N` for the rest, so the driver
// counts rows with a numeric `round` and nothing else — the same key normalize
// uses for its own collision check, which keeps both sides on one number.
const WAVE_HEADING_RE = /^##\s+Wave\s+(\d+)\b/;
const REASON_MAX_CHARS = DETAIL_MAX_CHARS;
const BY_MAX_CHARS = 64;
const RESUME_GONE = 'gate: --resume/--feedback are not accepted — every round is a fresh session; round N ≥ 2 builds its feedback from the round N−1 findings and the dispositions file';

// ---------- small helpers ----------

/** Index rows that count as rounds for gate/wave/lane: a numeric `round`
 * (normalize writes `attempt` instead of `round` for non-round outcomes;
 * waivers carry neither). */
function roundEntries(index, gate, wave, lane) {
  return index.filter((e) => e.gate === gate && sameWave(e, wave) && sameLane(e, lane) && /^\d+$/.test(String(e.round)));
}

/** Enforcement cell of the registry's id-table row for `id`, or null — read
 * through gate-ids.cjs' header-anchored row parser (the one registry parser). */
function registryEnforcement(text, id) {
  const row = parseRegistryRow(text, id);
  return row && row.enforcement ? row.enforcement : null;
}

function enforcementFor(gateId) {
  let text;
  try { text = fs.readFileSync(REGISTRY_PATH, 'utf8'); } catch (_e) { throw inputError(`registry unreadable: ${REGISTRY_PATH}`); }
  const e = registryEnforcement(text, gateId);
  if (!e || !ENFORCEMENTS.includes(e)) throw inputError(`--gate ${gateId}: registry row missing or its enforcement cell is not warning|blocking (${JSON.stringify(e)})`);
  return e;
}

function phaseContext(phaseFlag) {
  const phase = assertSafeSegment(phaseFlag, '--phase');
  const root = repoRoot();
  const phaseDir = path.join(root, '.a1', 'phases', phase);
  if (!fs.existsSync(phaseDir) || !fs.statSync(phaseDir).isDirectory()) throw inputError(`phase dir not found: ${phaseDir}`);
  return { phase, root, phaseDir, planPath: path.join(phaseDir, 'PLAN.md'), indexPath: path.join(phaseDir, 'xreview', 'index.json') };
}

function requireGateId(gateFlag) {
  const gate = String(gateFlag == null ? '' : gateFlag);
  if (!X.GATE_ID_LIST.includes(gate)) throw inputError(`--gate must be one of ${X.GATE_ID_LIST.join('|')}, got ${JSON.stringify(clip(gate, 80))}`);
  return gate;
}

const scopeOf = (wave) => (wave === null ? 'plan' : `wave-${wave}`);

// ---------- gate driver ----------

function resolveGateArgs(o) {
  const ctx = phaseContext(o.phase);
  const gate = requireGateId(o.gate);
  const isPlan = gate === X.GATE_IDS.PLAN_REVIEW;
  if (isPlan && (o.wave !== undefined || o.base !== undefined || o.lane !== undefined)) throw inputError('plan-review-xprov takes no --wave, --base or --lane');
  if (!isPlan && (o.wave === undefined || o.base === undefined)) throw inputError('wave-inspect-xprov requires --wave <N> and --base <PRE_WAVE_HEAD>');
  const wave = isPlan ? null : parsePositive(o.wave, 'wave');
  if (!isPlan && !BASE_HEX_RE.test(String(o.base))) throw inputError(`--base must be a resolved commit sha (7–40 hex), got ${JSON.stringify(clip(o.base, 80))}`);
  const lane = C.parseLane(o.lane);
  const pluginAllowlist = o.allowPlugins === undefined ? [] : String(o.allowPlugins).split(',').map((s) => s.trim()).filter(Boolean);
  const workPath = o.workPath === undefined ? ctx.root : path.resolve(String(o.workPath));
  if (!fs.existsSync(workPath) || !fs.statSync(workPath).isDirectory()) throw inputError(`--work-path is not a directory: ${workPath}`);
  if (!fs.existsSync(ctx.planPath)) throw inputError(`PLAN.md not found in ${ctx.phaseDir}`);
  const index = readIndex(ctx.indexPath);
  if (index === null) throw inputError(`index.json unparseable or not an array of objects: ${ctx.indexPath}`);
  const prior = roundEntries(index, gate, wave, lane);
  const round = o.round === undefined ? 1 + prior.length : parsePositive(o.round, 'round');
  // An explicit round the index already holds is a usage error BEFORE any side
  // effect (normalize would refuse it only after the runner had been called).
  const taken = index.find((e) => e.gate === gate && sameWave(e, wave) && sameLane(e, lane) && Number(e.round) === round);
  if (o.round !== undefined && taken) throw inputError(`index.json already holds ${gate} ${scopeOf(wave)}${lane ? ` lane ${lane}` : ''} round ${round} (verdict ${taken.verdict}) — omit --round to take the next one`);
  return Object.freeze({
    ...ctx, gate, isPlan, mode: isPlan ? 'review' : 'inspect', wave, lane,
    base: isPlan ? null : String(o.base), workPath, round, prior, pluginAllowlist,
    timeout: o.timeout === undefined ? null : parsePositive(o.timeout, 'timeout'),
    enforcement: enforcementFor(gate),
  });
}

/** The host-authored dispositions of a round (Pablo/Adam at Plan, Erik's fix
 * summary at Execute), named like normalize's findings file. */
function dispositionsPath(ctx, round) {
  const scope = `${ctx.wave === null ? 'plan' : `wave-${ctx.wave}`}${ctx.lane ? `-${ctx.lane}` : ''}`;
  return path.join(ctx.phaseDir, 'xreview', `${ctx.gate}-${scope}-r${round}.dispositions.md`);
}

/** A regular file, never a symlink (lstat) — or null. */
/** Bytes of a regular file opened with O_NOFOLLOW and checked on the open
 * descriptor (no lstat-then-read window), or null (Samuel NIT). */
function readNoFollow(p) {
  let fd;
  try { fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch (_e) { return null; }
  try { return fs.fstatSync(fd).isFile() ? fs.readFileSync(fd) : null; } catch (_e) { return null; } finally { fs.closeSync(fd); }
}

const parseOrNull = (buf) => { try { const v = JSON.parse(buf.toString('utf8')); return isPlainObject(v) ? v : null; } catch (_e) { return null; } };

/** Round ≥ 2 after a REVISE (plan review AND wave inspect, FR-006): where its feedback comes from. The round
 * N−1 findings are read from a1's own run dir (the dir of the index entry's
 * result_path, under this repo's 0700 artifacts dir), never from the phase
 * dir; the dispositions file must exist before the runner is called. A
 * previous pass, or no previous round, is a fresh session without feedback. */
function priorRound(ctx) {
  if (ctx.round < 2) return null;
  const prev = ctx.prior.find((e) => Number(e.round) === ctx.round - 1);
  if (!prev || prev.verdict !== X.VERDICTS.FAIL_WITH_FINDINGS) return null;
  const runDir = typeof prev.result_path === 'string' ? path.dirname(path.resolve(prev.result_path)) : null;
  if (!runDir || !isUnder(runDir, ensureArtifactsDir())) throw inputError(`round ${ctx.round} needs the round-${ctx.round - 1} run dir under a1's artifacts dir (index entry result_path: ${clip(String(prev.result_path), 120)})`);
  const file = path.join(runDir, PRIOR_FINDINGS_FILE);
  const bytes = readNoFollow(file);
  if (!bytes) throw inputError(`round ${ctx.round} needs the round-${ctx.round - 1} findings ${file} (a regular file normalize wrote)`);
  // The index row is agent-writable: it must carry the sha normalize recorded, and the file must name this round (Samuel MINOR a).
  if (typeof prev.findings_sha256 !== 'string' || sha256(bytes) !== prev.findings_sha256) throw inputError(`round-${ctx.round - 1} findings ${file} do not match the sha256 the index entry recorded`);
  const doc = parseOrNull(bytes);
  if (!doc || doc.phase !== ctx.phase || doc.gate !== ctx.gate || doc.wave !== ctx.wave || doc.lane !== ctx.lane || doc.round !== ctx.round - 1) throw inputError(`round-${ctx.round - 1} findings ${file} belong to another phase, gate, wave, lane or round`);
  const rec = parseOrNull(readNoFollow(path.join(runDir, 'result.json')) || Buffer.from(''));
  if (!rec || rec.mode !== ctx.mode) throw inputError(`round-${ctx.round - 1} run dir ${runDir} holds no ${ctx.mode} result.json`);
  const disp = readNoFollow(dispositionsPath(ctx, ctx.round - 1));
  if (!disp) throw inputError(`round ${ctx.round} needs the host-authored dispositions file ${dispositionsPath(ctx, ctx.round - 1)} (finding id → accepted|rejected + reason) — write it first`);
  return Object.freeze({ round: ctx.round - 1, doc, dispositions: disp.toString('utf8') });
}

/** One finding as a feedback line: id, severity, place, then its detail. */
function feedbackFinding(f) {
  const where = `${f.file}${f.line === null || f.line === undefined ? '' : `:${f.line}`}`;
  return `- ${f.id} [${f.severity}] ${where}\n  ${String(f.detail || f.title || '').replace(/\n/g, '\n  ')}`;
}

/** The feedback text of round N: round N−1's normalized findings, quarantined
 * ones as id + reason only (never their text), and the dispositions verbatim. */
function feedbackText(prior) {
  const parsed = prior.doc;
  const list = ['blocker', 'major', 'minor'].flatMap((b) => (Array.isArray(parsed[b]) ? parsed[b] : [])).filter(isPlainObject);
  const held = (Array.isArray(parsed.quarantined) ? parsed.quarantined : []).filter(isPlainObject)
    .map((q) => `- ${C.oneLine(clip(String(q.id), X.TITLE_MAX_CHARS))}: ${C.oneLine(clip(String(q.reason), 40))}`);
  return [
    `PRIOR FINDINGS (round ${prior.round}, normalized by a1; this is a fresh session):`,
    ...(list.length ? list.map(feedbackFinding) : ['- none']), '',
    `QUARANTINED IN ROUND ${prior.round} (id and reason only):`, ...(held.length ? held : ['- none']), '',
    `HOST DISPOSITIONS (round ${prior.round}):`, prior.dispositions,
  ].join('\n');
}

/** The feedback file in a fresh 0700 mktemp dir (removed by the caller); the
 * text is built first, so a failure leaves no empty dir behind (Samuel NIT). */
function writeFeedback(prior) {
  const text = feedbackText(prior);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-xprov-feedback-'));
  fs.chmodSync(dir, C.DIR_MODE);
  const file = path.join(dir, 'feedback.md');
  fs.writeFileSync(file, text, { mode: 0o600 });
  return file;
}

/** What the snapshot copies and scans besides the tree (Wave 7, Samuel): the
 * PLAN.md the runner will read and, for round N ≥ 2 after a REVISE, the
 * feedback file. The runner only ever gets these COPIES (`snapshot().inputs`). */
function snapshotInputs(ctx, feedback) {
  const inputs = [{ key: 'plan', source: ctx.planPath, label: `.a1/phases/${ctx.phase}/PLAN.md` }];
  if (feedback) inputs.push({ key: 'feedback', source: feedback, label: `round-${ctx.round - 1} findings + dispositions` });
  return inputs;
}

/** One a1-tools xprov subcommand as a child (argv array, cwd = repo root). */
function runSub(ctx, argv) {
  const r = spawnSync(process.execPath, [A1_TOOLS, 'xprov', ...argv], { cwd: ctx.root, encoding: 'utf8', env: process.env, maxBuffer: SUB_MAX_BUFFER });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (_e) { json = null; }
  return { status: r.status, json: isPlainObject(json) ? json : null, stderr: clip((r.stderr || '').trim(), DETAIL_MAX_CHARS) };
}

function headOf(repo) {
  const out = gitOut(['-C', repo, 'rev-parse', 'HEAD']);
  return out === null ? null : out.trim();
}

function stepSnapshot(ctx, feedback) {
  const source = ctx.isPlan ? ctx.root : ctx.workPath;
  const commit = headOf(source);
  if (!commit) return { ok: false, reason: X.REASONS.snapshot_failed, detail: `git rev-parse HEAD failed in ${source}` };
  // `base` (null for plan review) sizes the depth-limited fetch in snapshot():
  // without it an inspect snapshot holds ONE commit and the runner's
  // `git diff <base>` fails. The fake runner never diffs, so no fixture arm can
  // measure this line — contract from xprov-snapshot.cjs (Samuel W5 MAJOR 6).
  // FR-030 (b): every allowlist read runs against the PRIMARY checkout; the
  // gate kind decides the first-parent step (plan review only).
  const s = snapshot({ sourceRepo: source, commit, base: ctx.base, primaryRoot: ctx.root, gateKind: ctx.isPlan ? 'plan' : 'inspect', inputs: snapshotInputs(ctx, feedback) });
  const allowlist = allowlistFields(s);
  return s.ok ? { ok: true, snapshot: s.snapshot, commit: s.commit, inputs: s.inputs, allowlist } : { ok: false, reason: s.reason, detail: s.reason_detail || s.detail || s.secret_pattern || null, allowlist };
}

// ---------- allowlist reporting (FR-030 f, g) ----------

/** The allowlist fields of a snapshot result, with the no-allowlist defaults. */
function allowlistFields(s) {
  return Object.freeze({
    allowlisted_hits: Number.isInteger(s.allowlisted_hits) ? s.allowlisted_hits : 0,
    allowlist_anchor: s.allowlist_anchor || null,
    allowlist_approved_blob: s.allowlist_approved_blob || null,
    allowlist_stale: Array.isArray(s.allowlist_stale) ? s.allowlist_stale : [],
    allowlisted: Array.isArray(s.allowlisted) ? s.allowlisted : [],
    uncovered: Array.isArray(s.uncovered) ? s.uncovered : [],
    allowlist_note: s.allowlist_note || null,
  });
}

/** XREVIEW.md "Allowlisted snapshot hits", on pass AND fail, whenever an
 * allowlist was applied: path, pattern NAME, count and class per pair — never
 * the matched text or a fingerprint — plus stale and uncovered pairs. */
function noteAllowlist(ctx, al) {
  if (!al || !al.allowlist_anchor) return;
  const lines = [
    `anchor: ${al.allowlist_anchor}`, `approved blob: ${al.allowlist_approved_blob}`, `allowlisted_hits: ${al.allowlisted_hits}`,
    ...al.allowlisted.map((a) => `${a.path} · ${a.pattern} · count ${a.count} · ${a.class}`),
    ...al.allowlist_stale.map((x) => `allowlist_stale: ${x.path} · ${x.pattern}`),
    ...al.uncovered.map((u) => `uncovered: ${u.path} · ${u.pattern}`),
  ];
  appendXreviewNote(ctx.phaseDir, `Allowlisted snapshot hits · ${ctx.gate} · ${scopeOf(ctx.wave)}`, lines);
}

function stepRun(ctx, snap, inputs) {
  const argv = ['run', '--mode', ctx.mode, '--snapshot', snap, '--plan', inputs.plan, '--phase', ctx.phase, '--gate', ctx.gate, '--round', String(ctx.round)];
  if (ctx.wave !== null) argv.push('--wave', String(ctx.wave));
  if (ctx.lane !== null) argv.push('--lane', ctx.lane);
  if (ctx.base !== null) argv.push('--base', ctx.base);
  if (ctx.workPath !== ctx.root) argv.push('--work-path', ctx.workPath);
  if (ctx.timeout !== null) argv.push('--timeout', String(ctx.timeout));
  if (NO_LOG_FLAG) argv.push(`--${NO_LOG_FLAG}`); // one log entry per gate call: the driver's
  if (inputs.feedback) argv.push('--feedback', inputs.feedback);
  const r = runSub(ctx, argv);
  if (r.status !== 0 || !r.json || typeof r.json.result_path !== 'string') {
    return { ok: false, reason: (r.json && r.json.reason) || X.REASONS.runner_failed, detail: (r.json && r.json.reason_detail) || r.stderr || `run exited ${r.status}`, porcelain: (r.json && r.json.porcelain) || null };
  }
  return { ok: true, resultPath: r.json.result_path, porcelain: r.json.porcelain || null };
}

/** normalize writes the ONE index entry; the snapshot's allowlist result
 * travels as flags so no second write of index.json is needed (Reinhard R-M5). */
function stepNormalize(ctx, resultPath, al) {
  const argv = ['normalize', resultPath, '--phase', ctx.phase, '--gate', ctx.gate, '--round', String(ctx.round), '--allowlisted-hits', String(al.allowlisted_hits)];
  if (al.allowlist_anchor) argv.push('--allowlist-anchor', al.allowlist_anchor);
  if (al.allowlist_approved_blob) argv.push('--allowlist-approved-blob', al.allowlist_approved_blob);
  if (ctx.wave !== null) argv.push('--wave', String(ctx.wave));
  if (ctx.lane !== null) argv.push('--lane', ctx.lane);
  if (ctx.workPath !== ctx.root) argv.push('--work-path', ctx.workPath);
  const r = runSub(ctx, argv);
  if (!r.json || !Object.values(X.VERDICTS).includes(r.json.verdict)) {
    return { ok: false, reason: X.REASONS.malformed, detail: r.stderr || `normalize exited ${r.status} without a verdict` };
  }
  // A pass is a pass only when normalize also EXITED 0 — a `pass` in stdout next
  // to a non-zero exit is a contract break, never a verdict to trust.
  if (r.json.verdict === X.VERDICTS.PASS && r.status !== 0) {
    return { ok: false, reason: X.REASONS.malformed, detail: `normalize printed pass but exited ${r.status}` };
  }
  const j = r.json;
  return { ok: true, verdict: j.verdict, reason: j.reason || null, detail: j.reason_detail || null, findingsPath: j.findings_path || null, xreviewPath: j.xreview_path || null, entry: isPlainObject(j.index_entry) ? j.index_entry : {} };
}

function nextFor(ctx, verdict) {
  if (verdict !== X.VERDICTS.FAIL_WITH_FINDINGS || ctx.round >= X.ROUND_CAP) return null;
  const disp = dispositionsPath(ctx, ctx.round);
  if (!ctx.isPlan) return { fix_round: ctx.round, dispositions_path: disp };
  return {
    round_cmd: `node ${A1_TOOLS} xprov gate --phase ${ctx.phase} --gate ${ctx.gate} --round ${ctx.round + 1}`,
    dispositions_path: disp,
  };
}

function stepObserve(ctx, out, entry) {
  const pass = out.verdict === X.VERDICTS.PASS;
  const msg = clip(`${ctx.gate} ${scopeOf(ctx.wave)}${ctx.lane ? ` lane ${ctx.lane}` : ''} round ${ctx.round}: ${out.verdict}${out.reason ? ` (${out.reason})` : ''}${out.findings_path ? ` — findings ${path.basename(out.findings_path)}` : ''}`, X.TITLE_MAX_CHARS * 4);
  observe({
    repoRoot: ctx.root, agent: EXTERNAL_AGENT, skill: ctx.isPlan ? 'a1-plan' : 'a1-execute', phase: ctx.phase, wave: ctx.wave, lane: ctx.lane || undefined,
    type: pass ? 'gap' : 'blocker', severity: pass ? 'minor' : 'major', msg, provider: 'codex',
    // Model strings come from the runner record; only a shape observe accepts
    // is forwarded, anything else falls back to observe's literals — a hostile
    // observed_models[0] must never cost the observation.
    modelRequested: typeof entry.model_requested === 'string' && MODEL_RE.test(entry.model_requested) ? entry.model_requested : undefined,
    modelObserved: typeof entry.model_observed === 'string' && MODEL_RE.test(entry.model_observed) ? entry.model_observed : undefined,
  });
}

function appendLog(ctx, out, snapState) {
  const file = path.join(ctx.phaseDir, LOG_FILE);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : LOG_HEADER;
  const none = C.oneLine;
  const entry = [
    `## gate ${ctx.gate} · ${scopeOf(ctx.wave)}${ctx.lane ? ` · lane ${ctx.lane}` : ''} · round ${ctx.round} · ${nowIso()}`, '',
    `- step: ${none(out.step)}`, `- verdict: ${none(out.verdict)}`, `- reason: ${none(out.reason)}`, `- detail: ${none(clip(out.reason_detail, DETAIL_MAX_CHARS))}`,
    `- enforcement: ${ctx.enforcement}`, `- xreview: ${none(out.xreview_path)}`, `- result: ${none(out.result_path)}`, `- findings: ${none(out.findings_path)}`,
    `- snapshot: ${none(snapState)}`, '',
  ].join('\n');
  writeTextAtomic(file, `${existing}${existing.endsWith('\n') ? '' : '\n'}\n${entry}`);
}

/** Runs the chain; returns a frozen stdout report (never throws for a failing
 * step — only usage errors throw A1_INPUT before anything is created). */
function gate(o) {
  const ctx = resolveGateArgs(o);
  const base = Object.freeze({ verdict: X.VERDICTS.FAIL, reason: null, reason_detail: null, step: null, gate: ctx.gate, phase: ctx.phase, wave: ctx.wave, lane: ctx.lane, round: ctx.round, mode: ctx.mode, enforcement: ctx.enforcement, findings_path: null, xreview_path: null, result_path: null, next: null, ...allowlistFields({}) });
  // A failing step is a FAIL whatever was reached so far — after normalize
  // produced a pass, a broken observe step must not leave `pass` in stdout.
  // `extra` carries the fields already known at that step (e.g. result_path).
  const fail = (step, reason, detail, extra) => Object.freeze({ ...base, ...(extra || {}), verdict: X.VERDICTS.FAIL, step, reason, reason_detail: detail || null, next: null });
  // permit-check FIRST and outside the logged section: a repository without a
  // permission record gets no a1 write at all — no PLAN-REVIEW-LOG.md entry, no
  // xreview/ (Reinhard, PR review MAJOR 1; the W5 rule for every xprov writer).
  const permit = permitCheck({ repoRoot: ctx.root });
  if (!permit.ok) return fail('permit-check', permit.reason, permit.detail);
  if (ctx.round > X.ROUND_CAP) { const r = fail('round', X.REASONS.round_cap, `round ${ctx.round} > cap ${X.ROUND_CAP}`); appendLog(ctx, r, 'none'); return r; }
  const prior = priorRound(ctx); // usage errors surface before any side effect (exit 2 writes nothing)
  let snap = null;
  let feedback = null;
  let result;
  try {
    const pre = preflight({ pluginAllowlist: ctx.pluginAllowlist });
    if (!pre.ok) return (result = fail('preflight', pre.reason, pre.failed.join(', ')));
    if (prior) feedback = writeFeedback(prior);
    const snapped = stepSnapshot(ctx, feedback);
    const al = snapped.allowlist;
    noteAllowlist(ctx, al);
    if (!snapped.ok) return (result = fail('snapshot', snapped.reason, snapped.detail, al));
    snap = snapped.snapshot;
    const ran = stepRun(ctx, snap, snapped.inputs);
    if (!ran.ok) return (result = fail('run', ran.reason, ran.detail, { ...al, run_porcelain: ran.porcelain || null }));
    const norm = stepNormalize(ctx, ran.resultPath, al);
    if (!norm.ok) return (result = fail('normalize', norm.reason, norm.detail, { ...al, result_path: ran.resultPath }));
    const reviewed = Object.freeze({
      ...base, ...al, run_porcelain: ran.porcelain, result_path: ran.resultPath, findings_path: norm.findingsPath, xreview_path: norm.xreviewPath, step: 'normalize',
      verdict: norm.verdict, reason: norm.reason, reason_detail: norm.detail, next: nextFor(ctx, norm.verdict),
    });
    const capped = norm.verdict === X.VERDICTS.FAIL_WITH_FINDINGS && ctx.round >= X.ROUND_CAP
      ? Object.freeze({ ...reviewed, verdict: X.VERDICTS.FAIL, reason: X.REASONS.round_cap, reason_detail: `REVISE at round ${ctx.round} = cap`, next: null })
      : reviewed;
    try { stepObserve(ctx, capped, norm.entry); } catch (e) { return (result = fail('observe', X.REASONS.malformed, e.message, { ...al, result_path: ran.resultPath, findings_path: norm.findingsPath, xreview_path: norm.xreviewPath })); }
    return (result = capped);
  } finally {
    // MINOR (a): a failed cleanup is logged by path, never disguised as 'none'.
    let snapState = 'none';
    if (snap) { try { cleanupSnapshot(snap); snapState = 'removed'; } catch (_e) { snapState = `cleanup failed: ${snap}`; } }
    if (feedback) fs.rmSync(path.dirname(feedback), { recursive: true, force: true });
    // Only a step OUTCOME is logged. A throw (usage error from preflight's
    // codexHome(), an unexpected exception) leaves `result` unset: exit 2 must
    // write nothing, and an internal error must not pose as a gate entry.
    if (result) appendLog(ctx, result, snapState);
  }
}

// ---------- load-check ----------

/** Why load-check refuses, for the detail line. */
function loadCheckDetail(newest, planSha, store) {
  const pass = newest ? `newest pass entry reviewed plan_sha256 ${newest.plan_sha256}, current PLAN.md is ${planSha}` : 'no plan-review-xprov entry with verdict pass';
  return store.ok || store.missing ? `${pass}; no store waiver bound to this PLAN.md` : `${pass}; waiver store not usable (${store.why})`;
}

function loadCheck(o) {
  const ctx = phaseContext(o.phase);
  const gate = X.GATE_IDS.PLAN_REVIEW;
  const enforcement = enforcementFor(gate);
  if (!fs.existsSync(ctx.planPath)) throw inputError(`PLAN.md not found in ${ctx.phaseDir}`);
  if (o.expectSha !== undefined && !/^[0-9a-f]{64}$/.test(String(o.expectSha))) throw inputError('--expect-sha must be a lowercase sha256');
  const planSha = sha256(fs.readFileSync(ctx.planPath));
  const index = readIndex(ctx.indexPath);
  if (index === null) throw inputError(`index.json unparseable or not an array of objects: ${ctx.indexPath}`);
  // index.json `waived: true` rows are a mirror without authority (FR-007): only verdict pass rows count here.
  const passes = index.filter((e) => e.gate === gate && e.verdict === X.VERDICTS.PASS && e.waived !== true);
  const newest = passes.length ? [...passes].sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')))[passes.length - 1] : null;
  const store = WV.readWaivers();
  const waiver = newest !== null && newest.plan_sha256 === planSha ? null : WV.planWaiver(store, { repo: C.commonDirOf(ctx.root), phase: ctx.phase, plan_sha256: planSha });
  const accepted = newest !== null && newest.plan_sha256 === planSha ? 'pass' : (waiver ? 'waiver' : null);
  const moved = o.expectSha !== undefined && o.expectSha !== planSha;
  const ok = accepted !== null && !moved;
  return Object.freeze({
    ok, gate, enforcement, phase: ctx.phase, plan_sha256: planSha, accepted,
    matched_entry: accepted === 'pass' ? newest : null, matched_waiver: accepted === 'waiver' ? waiver : null,
    newest_pass: newest ? { ts: newest.ts, plan_sha256: newest.plan_sha256, round: newest.round } : null,
    reason: ok ? null : (moved ? X.REASONS.plan_changed : X.REASONS.plan_review_missing),
    detail: ok ? null : (moved ? `PLAN.md changed since Load: accepted ${o.expectSha}, now ${planSha}` : loadCheckDetail(newest, planSha, store)),
  });
}

// ---------- wave-status ----------

/** Completed (wave, lane) pairs from STATUS.md (lane null) and every
 * STATUS-<lane>.md (lane from the file name) — `## Wave N` headings. */
function completedWavesFromStatus(phaseDir) {
  const pairs = [];
  for (const f of fs.readdirSync(phaseDir).sort()) {
    const m = f.match(/^STATUS(?:-([A-Za-z0-9_-]+))?\.md$/);
    if (!m) continue;
    const lane = m[1] || null;
    for (const line of fs.readFileSync(path.join(phaseDir, f), 'utf8').split('\n')) {
      const w = line.match(WAVE_HEADING_RE);
      if (w && !pairs.some((p) => p.wave === Number(w[1]) && p.lane === lane)) pairs.push({ wave: Number(w[1]), lane });
    }
  }
  return pairs.sort((a, b) => a.wave - b.wave || String(a.lane).localeCompare(String(b.lane)));
}

function parseWavesFlag(value) {
  const waves = String(value).split(',').map((s) => s.trim()).filter(Boolean).map((s) => parsePositive(s, 'waves'));
  if (!waves.length) throw inputError('--waves must list at least one wave number');
  return [...new Set(waves)].sort((a, b) => a - b).map((wave) => ({ wave, lane: null }));
}

/** Coverage key is (wave, lane): a lane wave needs its own pass or a store
 * waiver bound to this phase's PLAN.md and to a head still in --work-path's
 * history (FR-004, FR-007); an index.json `waived: true` row counts for nothing. */
function waveStatus(o) {
  const ctx = phaseContext(o.phase);
  const gate = X.GATE_IDS.WAVE_INSPECT;
  const enforcement = enforcementFor(gate);
  const completed = o.waves === undefined ? completedWavesFromStatus(ctx.phaseDir) : parseWavesFlag(o.waves);
  if (!completed.length) throw inputError(`no completed waves: no \`## Wave N\` heading in ${ctx.phaseDir}/STATUS*.md and no --waves given`);
  const index = readIndex(ctx.indexPath);
  if (index === null) throw inputError(`index.json unparseable or not an array of objects: ${ctx.indexPath}`);
  const workPath = o.workPath === undefined ? ctx.root : path.resolve(String(o.workPath));
  const repo = C.commonDirOf(ctx.root);
  const h = WV.headIn(workPath, repo);
  if (h.problem) throw inputError(h.problem);
  const store = WV.readWaivers();
  const planSha = fs.existsSync(ctx.planPath) ? sha256(fs.readFileSync(ctx.planPath)) : null;
  const waived = (p) => planSha !== null && WV.waveWaiver(store, { repo, phase: ctx.phase, plan_sha256: planSha, wave: p.wave, lane: p.lane }, workPath, h.head) !== null;
  const covered = (p) => index.some((e) => e.gate === gate && Number(e.wave) === p.wave && sameLane(e, p.lane) && e.verdict === X.VERDICTS.PASS && e.waived !== true) || waived(p);
  const lackingDetail = completed.filter((p) => !covered(p));
  const lacking = [...new Set(lackingDetail.map((p) => p.wave))];
  return Object.freeze({
    ok: lacking.length === 0, gate, enforcement, phase: ctx.phase,
    completed_waves: [...new Set(completed.map((p) => p.wave))], completed_detail: completed, lacking, lacking_detail: lackingDetail,
    reason: lacking.length ? X.REASONS.wave_inspect_missing : null,
  });
}

// ---------- waive (human only) ----------

/** The single-line text flags of a waiver (`--reason`, `--by`). */
function oneLineFlag(value, name, max) {
  const s = String(value == null ? '' : value).trim();
  // one line of text: newlines would let a waiver forge a second XREVIEW bullet or index field
  if (s === '' || /[\x00-\x1f\x7f]/.test(s)) throw inputError(`--${name} must be a non-empty single line without control characters or newlines`);
  if (s.length > max) throw inputError(`--${name} exceeds ${max} characters`);
  return s;
}

/** Every key part, computed here (FR-007 binding) — never from a flag value but --base/--work-path. */
function waiverKey(ctx, gate, wave, lane, o) {
  const repo = C.commonDirOf(ctx.root);
  if (!repo) throw inputError(`no git-common-dir for ${ctx.root}`);
  if (!fs.existsSync(ctx.planPath)) throw inputError(`PLAN.md not found in ${ctx.phaseDir}`);
  const key = { repo, phase: ctx.phase, gate, plan_sha256: WV.planShaOf(ctx.planPath), wave, lane, head: null, base: null };
  if (gate === X.GATE_IDS.PLAN_REVIEW) return key;
  const workPath = o.workPath === undefined ? ctx.root : path.resolve(String(o.workPath));
  const h = WV.headIn(workPath, repo);
  if (h.problem) throw Object.assign(new Error(h.problem), { code: 'A1_WAIVE_KEY' });
  const b = gitOut(['-C', workPath, 'rev-parse', '--verify', '--quiet', `${String(o.base)}^{commit}`]);
  if (b === null || !BASE_HEX_RE.test(String(o.base))) throw inputError(`--base must be a commit sha that resolves in ${workPath}`);
  return { ...key, head: h.head, base: b.trim() };
}

/** Mirror without authority: index.json row, XREVIEW section, observation. */
function mirrorWaiver(ctx, rec) {
  const index = readIndex(ctx.indexPath);
  if (index === null) throw inputError(`index.json unparseable or not an array of objects: ${ctx.indexPath}`);
  const entry = Object.freeze({ gate: rec.gate, wave: rec.wave, lane: rec.lane, waived: true, reason: rec.reason, by: rec.by, ts: rec.ts, plan_sha256: rec.plan_sha256, head: rec.head, base: rec.base, authority: 'store' });
  fs.mkdirSync(path.dirname(ctx.indexPath), { recursive: true });
  writeTextAtomic(ctx.indexPath, `${JSON.stringify([...index, entry], null, 2)}\n`);
  const scope = `${scopeOf(rec.wave)}${rec.lane ? ` · lane ${rec.lane}` : ''}`;
  const xreviewPath = appendXreviewNote(ctx.phaseDir, `Waiver · ${rec.gate} · ${scope}`, [`gate: ${rec.gate}`, `scope: ${scope}`, 'waived: true', `reason: ${rec.reason}`, `by: ${rec.by}`, `plan_sha256: ${rec.plan_sha256}`, ...(rec.head ? [`head: ${rec.head}`, `base: ${rec.base}`] : []), `ts: ${rec.ts}`, 'authority: ~/.a1-xprov waiver store (this section is a mirror)']);
  // MINOR (b): a waiver is an observation too — the learning loop must see it
  // (pattern xprov_waived, the tag the retro carries in `issues`).
  const obs = observe({
    repoRoot: ctx.root, agent: EXTERNAL_AGENT, skill: rec.wave === null ? 'a1-plan' : 'a1-execute', phase: ctx.phase, wave: rec.wave, lane: rec.lane || undefined,
    type: 'gap', severity: 'major', pattern: RETRO_ISSUE_WAIVED, msg: clip(`waived ${rec.gate} ${scope}: ${rec.reason}`, X.TITLE_MAX_CHARS * 4), provider: 'codex',
  });
  return { entry, xreviewPath, observationFile: obs && obs.file ? obs.file : null };
}

/** HUMAN ONLY. Returns { code, msg, out? }; nothing is written unless every guard holds and the gate id is typed back. */
function waive(o) {
  const ctx = phaseContext(o.phase);
  const gate = requireGateId(o.gate);
  enforcementFor(gate);
  const isPlan = gate === X.GATE_IDS.PLAN_REVIEW;
  if (isPlan && (o.wave !== undefined || o.lane !== undefined || o.base !== undefined || o.workPath !== undefined)) throw inputError('plan-review-xprov takes no --wave, --lane, --base or --work-path');
  if (!isPlan && (o.wave === undefined || o.base === undefined)) throw inputError('wave-inspect-xprov requires --wave <N> and --base <PRE_WAVE_HEAD>');
  const wave = isPlan ? null : parsePositive(o.wave, 'wave');
  const lane = isPlan ? null : C.parseLane(o.lane);
  const reason = oneLineFlag(o.reason, 'reason', REASON_MAX_CHARS);
  const by = oneLineFlag(o.by, 'by', BY_MAX_CHARS);
  const refusal = guardRefusal(); // the owner-approval guards, one implementation (xprov-approve.cjs)
  if (refusal) return { code: X.EXIT_USAGE, msg: `${refusal}. Run it yourself in a separate terminal (not through an agent and not via the ! prefix). Nothing written.` };
  let key;
  try { key = waiverKey(ctx, gate, wave, lane, o); } catch (e) { if (e.code === 'A1_WAIVE_KEY') return { code: X.EXIT_FAIL, msg: `${e.message}; nothing written` }; throw e; }
  const err = (line) => process.stderr.write(`${line}\n`);
  err(`Waiver for ${gate} · phase ${ctx.phase}${wave === null ? '' : ` · wave ${wave}${lane ? ` · lane ${lane}` : ''}`}`);
  for (const k of ['repo', 'plan_sha256', 'head', 'base']) if (key[k] !== null) err(`  ${k}: ${key[k]}`);
  err(`  reason: ${reason}`); err(`  by: ${by}`);
  err('A waiver is not a pass; it unblocks only this key, and only until PLAN.md (or the head) changes.');
  process.stderr.write(`Type the gate id (${gate}) to record it: `);
  const typed = readTypedLine();
  if (typed !== gate) return { code: X.EXIT_USAGE, msg: `typed ${JSON.stringify(clip(typed, 40))}, expected ${gate}; nothing written` };
  const rec = { ...key, reason, by, ts: nowIso() };
  const file = WV.appendWaiver(rec, writeGuardedStore);
  const m = mirrorWaiver(ctx, rec);
  return { code: X.EXIT_PASS, msg: `recorded a human waiver for ${gate} ${scopeOf(wave)} in ${file} — add ${RETRO_ISSUE_WAIVED} to the retro's issues and keep gates_fired verdict as it was — a waiver is not a pass`,
    out: { ok: true, waiver: rec, store: file, entry: m.entry, index_path: ctx.indexPath, xreview_path: m.xreviewPath, observation_file: m.observationFile, retro_issue: RETRO_ISSUE_WAIVED } };
}

// ---------- CLI plumbing ----------

const usageExit = (msg) => C.usageExit('', msg);
const finish = (report, code) => C.emitJson(report, code);

function withFlags(args, known, sub, body) {
  const flags = parseFlags(args || [], known);
  if (flags._.length) return usageExit(`${sub}: unexpected argument ${JSON.stringify(clip(flags._[0], 80))}`);
  try { return body(flags); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usageExit(`${sub}: ${e.message}`);
    throw e;
  }
}

function cmdXprovGate(args) {
  if ((args || []).some((a) => /^--(resume|feedback)(=|$)/.test(String(a)))) return usageExit(RESUME_GONE);
  return withFlags(args, { phase: 'str', gate: 'str', wave: 'str', lane: 'str', base: 'str', 'work-path': 'str', round: 'str', timeout: 'str', 'allow-plugins': 'str' }, 'gate', (f) => {
    if (!f.phase || !f.gate) return usageExit('gate requires --phase <name> --gate <id>');
    const r = gate({ phase: f.phase, gate: f.gate, wave: f.wave, lane: f.lane, base: f.base, workPath: f['work-path'], round: f.round, timeout: f.timeout, allowPlugins: f['allow-plugins'] });
    process.stderr.write(`xprov gate ${r.gate} ${scopeOf(r.wave)} round ${r.round}: ${r.verdict}${r.reason ? ` (${r.reason} at ${r.step})` : ''} — enforcement ${r.enforcement}\n`);
    if (r.allowlist_note) process.stderr.write(`xprov gate: allowlist not applied: ${r.allowlist_note}\n`);
    for (const x of r.allowlist_stale) process.stderr.write(`xprov gate: warning allowlist_stale: ${x.path} · ${x.pattern}\n`);
    for (const u of r.uncovered) process.stderr.write(`xprov gate: uncovered secret-pattern hit: ${u.path} · ${u.pattern}\n`);
    return finish(r, r.verdict === X.VERDICTS.PASS ? X.EXIT_PASS : X.EXIT_FAIL);
  });
}

function cmdXprovLoadCheck(args) {
  return withFlags(args, { phase: 'str', 'expect-sha': 'str' }, 'load-check', (f) => {
    if (!f.phase) return usageExit('load-check requires --phase <name> [--expect-sha <sha256>]');
    const r = loadCheck({ phase: f.phase, expectSha: f['expect-sha'] });
    process.stderr.write(r.ok ? `xprov load-check: PLAN.md matches ${r.accepted === 'waiver' ? `a store waiver for ${r.gate} (not a pass)` : `the newest ${r.gate} pass`}\n` : `xprov load-check: ${r.reason} — ${r.detail} (enforcement ${r.enforcement})\n`);
    return finish(r, r.ok ? X.EXIT_PASS : X.EXIT_FAIL);
  });
}

function cmdXprovWaveStatus(args) {
  return withFlags(args, { phase: 'str', waves: 'str', 'work-path': 'str' }, 'wave-status', (f) => {
    if (!f.phase) return usageExit('wave-status requires --phase <name> [--waves 1,2] [--work-path <dir>]');
    const r = waveStatus({ phase: f.phase, waves: f.waves, workPath: f['work-path'] });
    process.stderr.write(r.ok ? `xprov wave-status: waves ${r.completed_waves.join(', ')} inspected or waived\n` : `xprov wave-status: waves lacking a ${r.gate} pass or waiver: ${r.lacking.join(', ')} (enforcement ${r.enforcement})\n`);
    return finish(r, r.ok ? X.EXIT_PASS : X.EXIT_FAIL);
  });
}

function cmdXprovWaive(args) {
  return withFlags(args, { phase: 'str', gate: 'str', wave: 'str', lane: 'str', base: 'str', 'work-path': 'str', reason: 'str', by: 'str' }, 'waive', (f) => {
    if (!f.phase || !f.gate || f.reason === undefined || f.by === undefined) return usageExit('waive requires --phase <name> --gate <id> [--wave N [--lane <id>] --base <sha> [--work-path <dir>]] --reason "<text>" --by <name>');
    const r = waive({ phase: f.phase, gate: f.gate, wave: f.wave, lane: f.lane, base: f.base, workPath: f['work-path'], reason: f.reason, by: f.by });
    process.stderr.write(`xprov waive: ${r.msg}\n`);
    if (r.out) return finish(r.out, r.code);
    process.exitCode = r.code;
    return null;
  });
}

module.exports = {
  registryEnforcement, readIndex, sameWave, gate, loadCheck, waveStatus, waive,
  cmdXprovGate, cmdXprovLoadCheck, cmdXprovWaveStatus, cmdXprovWaive,
};
