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
//               entry's plan_sha256, else plan_review_missing.
//   wave-status every completed wave (STATUS*.md `## Wave N` headings, or
//               --waves) needs a wave-inspect-xprov pass or waiver.
//   waive       HUMAN record {waived: true, reason, by: human, ts} + a
//               `## Waiver` XREVIEW section — never a verdict.
//
// Enforcement (`warning|blocking`) is READ here from the gate's registry row —
// the only read site — and ECHOED in stdout; it is never applied. The workflow
// text decides between "warning block + continue" and "halt", so the Wave 7
// flip changes one registry cell and no code.
//
// Rounds: `--round` defaults to 1 + the index entries already held for this
// gate/wave (entries with a numeric `round`, i.e. normalize's rows, never
// waivers); round > 2 is `round_cap` before any runner call; a REVISE at round
// 2 is reported as fail/round_cap. Plan round 2 resumes the round-1 result
// with the host-authored dispositions file; inspect never resumes.
//
// `run` and `normalize` export CLIs only, so the driver invokes them as
// subprocesses of this same a1-tools (argv arrays, cwd = repo root) and reads
// their stdout JSON; permit/preflight/snapshot/observe are in-process calls.
// The runner is reached ONLY through `run`. stdout here is written with a
// blocking fs.writeSync loop + process.exitCode (never process.exit after a
// stdout write — a piped stdout on macOS truncates at 64 KiB).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { parseFlags, repoRoot, assertSafeSegment, writeTextAtomic, nowIso } = require('./io.cjs');
const X = require('./xprov.cjs');
const { permitCheck } = require('./xprov-permit.cjs');
const { preflight } = require('./xprov-preflight.cjs');
const { snapshot, cleanupSnapshot } = require('./xprov-snapshot.cjs');
const { observe, MODEL_RE } = require('./xprov-observe.cjs');
const { appendXreviewNote } = require('./xprov-normalize.cjs');
const runMod = require('./xprov-run.cjs'); // only for its optional exports below

const A1_TOOLS = path.join(__dirname, '..', 'a1-tools.cjs');
const REGISTRY_PATH = path.join(__dirname, '..', 'gates-registry.md');
const LOG_FILE = 'PLAN-REVIEW-LOG.md';
// Shared with `run` when it exports them (read at load, never assumed): the
// `--no-log` flag keeps `run` from writing its own log entry when the driver
// writes the one entry per gate call; the header keeps both writers coherent.
const NO_LOG_FLAG = typeof runMod.NO_LOG_FLAG === 'string' ? runMod.NO_LOG_FLAG : null;
const LOG_HEADER = typeof runMod.LOG_HEADER === 'string' ? runMod.LOG_HEADER
  : '# PLAN-REVIEW-LOG — cross-provider runner calls\n\nWritten by `a1-tools xprov run` and `a1-tools xprov gate`; one entry per call, newest last.\n';
const ENFORCEMENTS = Object.freeze(['warning', 'blocking']);
const REASON_PLAN_REVIEW_MISSING = 'plan_review_missing'; // FR-003 wording; load-check only
const REASON_WAVE_INSPECT_MISSING = 'wave_inspect_missing'; // wave-status only
const RETRO_ISSUE_WAIVED = 'xprov_waived';
const EXTERNAL_AGENT = 'xprov-codex';
const SUB_MAX_BUFFER = 64 * 1024 * 1024;
const BASE_HEX_RE = /^[0-9a-f]{7,40}$/i; // same rule as `run`: a resolved sha, never a symbolic ref
const LANE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// A round is a review that produced a verdict to act on (pass or
// fail-with-findings); every other outcome (blocked, runner_failed, secret_*,
// quarantined, plan_changed, tripwire, …) is an attempt that does not consume
// the cap (team-lead decision, 2026-09-24). normalize owns the distinction: it
// writes `round: N` for rounds and `attempt: N` for the rest, so the driver
// counts rows with a numeric `round` and nothing else — the same key normalize
// uses for its own collision check, which keeps both sides on one number.
const WAVE_HEADING_RE = /^##\s+Wave\s+(\d+)\b/;
const REASON_MAX_CHARS = 500;
const DETAIL_MAX_CHARS = 500;

// ---------- small helpers ----------

function inputError(msg) {
  return Object.assign(new Error(msg), { code: 'A1_INPUT' });
}

function clip(s, max) {
  const t = String(s == null ? '' : s);
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function parsePositive(value, name) {
  if (!/^[1-9]\d{0,3}$/.test(String(value))) throw inputError(`--${name} must be a positive integer, got ${JSON.stringify(clip(value, 80))}`);
  return Number(value);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** [] when absent, the array when every entry is a plain object, else null. */
function readIndex(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(arr) && arr.every(isPlainObject) ? arr : null;
  } catch (_e) { return null; }
}

function sameWave(entry, wave) {
  return wave === null ? (entry.wave === null || entry.wave === undefined) : Number(entry.wave) === wave;
}

function sameLane(entry, lane) {
  return lane === null ? (entry.lane === null || entry.lane === undefined) : entry.lane === lane;
}

/** Index rows that count as rounds for gate/wave/lane: a numeric `round`
 * (normalize writes `attempt` instead of `round` for non-round outcomes;
 * waivers carry neither). */
function roundEntries(index, gate, wave, lane) {
  return index.filter((e) => e.gate === gate && sameWave(e, wave) && sameLane(e, lane) && /^\d+$/.test(String(e.round)));
}

/** Enforcement cell of the registry's id-table row for `id`, or null. Anchored
 * on the header row like gate-ids.cjs — never a whole-file scrape. */
function registryEnforcement(text, id) {
  const lines = String(text).split('\n');
  const headerAt = lines.findIndex((l) => /^\|\s*id\s*\|/i.test(l));
  if (headerAt < 0) return null;
  const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
  const col = cells(lines[headerAt]).findIndex((c) => c.toLowerCase() === 'enforcement');
  if (col < 0) return null;
  for (let i = headerAt + 1; i < lines.length && lines[i].trim() !== ''; i++) {
    if (/^\|[\s:-]+\|/.test(lines[i])) continue;
    const row = cells(lines[i]);
    if (row[0] && row[0].replace(/`/g, '') === id) return row[col] || null;
  }
  return null;
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
  if (!isPlan && (o.resume !== undefined || o.feedback !== undefined)) throw inputError('inspect never resumes: --resume/--feedback are plan-review only');
  const wave = isPlan ? null : parsePositive(o.wave, 'wave');
  if (!isPlan && !BASE_HEX_RE.test(String(o.base))) throw inputError(`--base must be a resolved commit sha (7–40 hex), got ${JSON.stringify(clip(o.base, 80))}`);
  if (o.lane !== undefined && !LANE_RE.test(String(o.lane))) throw inputError(`--lane has an unexpected shape, got ${JSON.stringify(clip(o.lane, 80))}`);
  const lane = o.lane === undefined ? null : String(o.lane);
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
    base: isPlan ? null : String(o.base), workPath, round, prior,
    timeout: o.timeout === undefined ? null : parsePositive(o.timeout, 'timeout'),
    resume: o.resume === undefined ? null : path.resolve(String(o.resume)),
    feedback: o.feedback === undefined ? null : path.resolve(String(o.feedback)),
    enforcement: enforcementFor(gate),
  });
}

function dispositionsPath(ctx, round) {
  return path.join(ctx.phaseDir, 'xreview', `${ctx.gate}-plan-r${round}.dispositions.md`);
}

/** Plan round ≥ 2 resumes the previous round ONLY when that round ended in
 * fail-with-findings (a REVISE the host answered with dispositions); both the
 * result.json and the dispositions file must exist BEFORE the runner is
 * called. A previous pass, or no previous round, is a fresh session. */
function resumeArgs(ctx) {
  if (!ctx.isPlan || ctx.round < 2) return [];
  const prev = ctx.prior.find((e) => Number(e.round) === ctx.round - 1);
  if (!prev || prev.verdict !== X.VERDICTS.FAIL_WITH_FINDINGS) {
    if (ctx.resume || ctx.feedback) throw inputError(`--resume/--feedback need a round-${ctx.round - 1} entry with verdict fail-with-findings to resume; round ${ctx.round} is a fresh session`);
    return [];
  }
  const resume = ctx.resume || (typeof prev.result_path === 'string' ? prev.result_path : null);
  const feedback = ctx.feedback || dispositionsPath(ctx, ctx.round - 1);
  if (!resume || !fs.existsSync(resume)) throw inputError(`round ${ctx.round} needs the round-${ctx.round - 1} result.json to resume (${resume || 'no such index entry'})`);
  if (!fs.existsSync(feedback)) throw inputError(`round ${ctx.round} needs the host-authored dispositions file ${feedback} (finding id → accepted|rejected + reason) — write it first`);
  return ['--resume', resume, '--feedback', feedback];
}

/** One a1-tools xprov subcommand as a child (argv array, cwd = repo root). */
function runSub(ctx, argv) {
  const r = spawnSync(process.execPath, [A1_TOOLS, 'xprov', ...argv], { cwd: ctx.root, encoding: 'utf8', env: process.env, maxBuffer: SUB_MAX_BUFFER });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (_e) { json = null; }
  return { status: r.status, json: isPlainObject(json) ? json : null, stderr: clip((r.stderr || '').trim(), DETAIL_MAX_CHARS) };
}

function headOf(repo) {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function stepSnapshot(ctx) {
  const source = ctx.isPlan ? ctx.root : ctx.workPath;
  const commit = headOf(source);
  if (!commit) return { ok: false, reason: X.REASONS.snapshot_failed, detail: `git rev-parse HEAD failed in ${source}` };
  // `base` (null for plan review) sizes the depth-limited fetch in snapshot():
  // without it an inspect snapshot holds ONE commit and the runner's
  // `git diff <base>` fails. The fake runner never diffs, so no fixture arm can
  // measure this line — contract from xprov-snapshot.cjs (Samuel W5 MAJOR 6).
  const s = snapshot({ sourceRepo: source, commit, base: ctx.base });
  return s.ok ? { ok: true, snapshot: s.snapshot, commit: s.commit } : { ok: false, reason: s.reason, detail: s.detail || s.secret_pattern || null };
}

function stepRun(ctx, snap) {
  const argv = ['run', '--mode', ctx.mode, '--snapshot', snap, '--plan', ctx.planPath, '--phase', ctx.phase, '--gate', ctx.gate, '--round', String(ctx.round)];
  if (ctx.wave !== null) argv.push('--wave', String(ctx.wave));
  if (ctx.lane !== null) argv.push('--lane', ctx.lane);
  if (ctx.base !== null) argv.push('--base', ctx.base);
  if (ctx.workPath !== ctx.root) argv.push('--work-path', ctx.workPath);
  if (ctx.timeout !== null) argv.push('--timeout', String(ctx.timeout));
  if (NO_LOG_FLAG) argv.push(`--${NO_LOG_FLAG}`); // one log entry per gate call: the driver's
  argv.push(...resumeArgs(ctx));
  const r = runSub(ctx, argv);
  if (r.status !== 0 || !r.json || typeof r.json.result_path !== 'string') {
    return { ok: false, reason: (r.json && r.json.reason) || X.REASONS.runner_failed, detail: (r.json && r.json.reason_detail) || r.stderr || `run exited ${r.status}` };
  }
  return { ok: true, resultPath: r.json.result_path };
}

function stepNormalize(ctx, resultPath) {
  const argv = ['normalize', resultPath, '--phase', ctx.phase, '--gate', ctx.gate, '--round', String(ctx.round)];
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

function nextFor(ctx, verdict, resultPath) {
  if (verdict !== X.VERDICTS.FAIL_WITH_FINDINGS || ctx.round >= X.ROUND_CAP) return null;
  if (!ctx.isPlan) return { fix_round: ctx.round };
  const disp = dispositionsPath(ctx, ctx.round);
  return {
    resume_cmd: `node ${A1_TOOLS} xprov gate --phase ${ctx.phase} --gate ${ctx.gate} --round ${ctx.round + 1} --resume ${resultPath} --feedback ${disp}`,
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

function appendLog(ctx, out, snapRemoved) {
  const file = path.join(ctx.phaseDir, LOG_FILE);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : LOG_HEADER;
  const none = (v) => (v == null ? 'none' : String(v).replace(/[\r\n]+/g, ' '));
  const entry = [
    `## gate ${ctx.gate} · ${scopeOf(ctx.wave)}${ctx.lane ? ` · lane ${ctx.lane}` : ''} · round ${ctx.round} · ${nowIso()}`, '',
    `- step: ${none(out.step)}`, `- verdict: ${none(out.verdict)}`, `- reason: ${none(out.reason)}`, `- detail: ${none(clip(out.reason_detail, DETAIL_MAX_CHARS))}`,
    `- enforcement: ${ctx.enforcement}`, `- xreview: ${none(out.xreview_path)}`, `- result: ${none(out.result_path)}`, `- findings: ${none(out.findings_path)}`,
    `- snapshot: ${snapRemoved ? 'removed' : 'none'}`, '',
  ].join('\n');
  writeTextAtomic(file, `${existing}${existing.endsWith('\n') ? '' : '\n'}\n${entry}`);
}

/** Runs the chain; returns a frozen stdout report (never throws for a failing
 * step — only usage errors throw A1_INPUT before anything is created). */
function gate(o) {
  const ctx = resolveGateArgs(o);
  const out = { verdict: X.VERDICTS.FAIL, reason: null, reason_detail: null, step: null, gate: ctx.gate, phase: ctx.phase, wave: ctx.wave, lane: ctx.lane, round: ctx.round, mode: ctx.mode, enforcement: ctx.enforcement, findings_path: null, xreview_path: null, result_path: null, next: null };
  // A failing step is a FAIL whatever `out` already holds — after normalize set
  // verdict to pass, a broken observe step must not leave `pass` in stdout.
  const fail = (step, reason, detail) => Object.freeze({ ...out, verdict: X.VERDICTS.FAIL, step, reason, reason_detail: detail || null, next: null });
  if (ctx.round > X.ROUND_CAP) { const r = fail('round', X.REASONS.round_cap, `round ${ctx.round} > cap ${X.ROUND_CAP}`); appendLog(ctx, r, false); return r; }
  resumeArgs(ctx); // usage errors surface before any side effect
  let snap = null;
  let result;
  try {
    const permit = permitCheck({ repoRoot: ctx.root });
    if (!permit.ok) return (result = fail('permit-check', permit.reason, permit.detail));
    const pre = preflight({});
    if (!pre.ok) return (result = fail('preflight', pre.reason, pre.failed.join(', ')));
    const snapped = stepSnapshot(ctx);
    if (!snapped.ok) return (result = fail('snapshot', snapped.reason, snapped.detail));
    snap = snapped.snapshot;
    const ran = stepRun(ctx, snap);
    if (!ran.ok) return (result = fail('run', ran.reason, ran.detail));
    out.result_path = ran.resultPath;
    const norm = stepNormalize(ctx, ran.resultPath);
    if (!norm.ok) return (result = fail('normalize', norm.reason, norm.detail));
    out.findings_path = norm.findingsPath; out.xreview_path = norm.xreviewPath; out.step = 'normalize';
    out.verdict = norm.verdict; out.reason = norm.reason; out.reason_detail = norm.detail;
    out.next = nextFor(ctx, norm.verdict, ran.resultPath);
    if (norm.verdict === X.VERDICTS.FAIL_WITH_FINDINGS && ctx.round >= X.ROUND_CAP) { out.verdict = X.VERDICTS.FAIL; out.reason = X.REASONS.round_cap; out.reason_detail = `REVISE at round ${ctx.round} = cap`; }
    try { stepObserve(ctx, out, norm.entry); } catch (e) { return (result = fail('observe', X.REASONS.malformed, e.message)); }
    return (result = Object.freeze({ ...out }));
  } finally {
    let removed = false;
    if (snap) { try { cleanupSnapshot(snap); removed = true; } catch (_e) { removed = false; } }
    appendLog(ctx, result || fail('gate', X.REASONS.malformed, 'driver threw'), removed);
  }
}

// ---------- load-check ----------

function loadCheck(o) {
  const ctx = phaseContext(o.phase);
  const gate = X.GATE_IDS.PLAN_REVIEW;
  const enforcement = enforcementFor(gate);
  if (!fs.existsSync(ctx.planPath)) throw inputError(`PLAN.md not found in ${ctx.phaseDir}`);
  const planSha = sha256(fs.readFileSync(ctx.planPath));
  const index = readIndex(ctx.indexPath);
  if (index === null) throw inputError(`index.json unparseable or not an array of objects: ${ctx.indexPath}`);
  const passes = index.filter((e) => e.gate === gate && e.verdict === X.VERDICTS.PASS && e.waived !== true);
  const newest = passes.length ? [...passes].sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')))[passes.length - 1] : null;
  const ok = newest !== null && newest.plan_sha256 === planSha;
  return Object.freeze({
    ok, gate, enforcement, phase: ctx.phase, plan_sha256: planSha,
    matched_entry: ok ? newest : null, newest_pass: newest ? { ts: newest.ts, plan_sha256: newest.plan_sha256, round: newest.round } : null,
    reason: ok ? null : REASON_PLAN_REVIEW_MISSING,
    detail: ok ? null : (newest ? `newest pass entry reviewed plan_sha256 ${newest.plan_sha256}, current PLAN.md is ${planSha}` : 'no plan-review-xprov entry with verdict pass'),
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

/** Coverage key is (wave, lane): a lane wave needs its own pass or waiver. */
function waveStatus(o) {
  const ctx = phaseContext(o.phase);
  const gate = X.GATE_IDS.WAVE_INSPECT;
  const enforcement = enforcementFor(gate);
  const completed = o.waves === undefined ? completedWavesFromStatus(ctx.phaseDir) : parseWavesFlag(o.waves);
  if (!completed.length) throw inputError(`no completed waves: no \`## Wave N\` heading in ${ctx.phaseDir}/STATUS*.md and no --waves given`);
  const index = readIndex(ctx.indexPath);
  if (index === null) throw inputError(`index.json unparseable or not an array of objects: ${ctx.indexPath}`);
  const covered = (p) => index.some((e) => e.gate === gate && Number(e.wave) === p.wave && sameLane(e, p.lane) && (e.verdict === X.VERDICTS.PASS || e.waived === true));
  const lackingDetail = completed.filter((p) => !covered(p));
  const lacking = [...new Set(lackingDetail.map((p) => p.wave))];
  return Object.freeze({
    ok: lacking.length === 0, gate, enforcement, phase: ctx.phase,
    completed_waves: [...new Set(completed.map((p) => p.wave))], completed_detail: completed, lacking, lacking_detail: lackingDetail,
    reason: lacking.length ? REASON_WAVE_INSPECT_MISSING : null,
  });
}

// ---------- waive (human only) ----------

function waive(o) {
  const ctx = phaseContext(o.phase);
  const gate = requireGateId(o.gate);
  enforcementFor(gate);
  const isPlan = gate === X.GATE_IDS.PLAN_REVIEW;
  if (isPlan && o.wave !== undefined) throw inputError('plan-review-xprov takes no --wave');
  if (!isPlan && o.wave === undefined) throw inputError('wave-inspect-xprov requires --wave <N>');
  const wave = isPlan ? null : parsePositive(o.wave, 'wave');
  if (isPlan && o.lane !== undefined) throw inputError('plan-review-xprov takes no --lane');
  if (o.lane !== undefined && !LANE_RE.test(String(o.lane))) throw inputError(`--lane has an unexpected shape, got ${JSON.stringify(clip(o.lane, 80))}`);
  const lane = o.lane === undefined ? null : String(o.lane);
  const reason = String(o.reason == null ? '' : o.reason).trim();
  // one line of text: newlines would let a waiver forge a second XREVIEW bullet or index field
  if (reason === '' || /[\x00-\x1f\x7f]/.test(reason)) throw inputError('--reason must be a non-empty single line without control characters or newlines');
  if (reason.length > REASON_MAX_CHARS) throw inputError(`--reason exceeds ${REASON_MAX_CHARS} characters`);
  const index = readIndex(ctx.indexPath);
  if (index === null) throw inputError(`index.json unparseable or not an array of objects: ${ctx.indexPath}`);
  const entry = Object.freeze({ gate, wave, lane, waived: true, reason, by: 'human', ts: nowIso() });
  writeTextAtomic(ctx.indexPath, `${JSON.stringify([...index, entry], null, 2)}\n`);
  const scope = `${scopeOf(wave)}${lane ? ` · lane ${lane}` : ''}`;
  const xreviewPath = appendXreviewNote(ctx.phaseDir, `Waiver · ${gate} · ${scope}`, [`gate: ${gate}`, `scope: ${scope}`, `waived: true`, `reason: ${reason}`, 'by: human', `ts: ${entry.ts}`]);
  return Object.freeze({ ok: true, entry, index_path: ctx.indexPath, xreview_path: xreviewPath, retro_issue: RETRO_ISSUE_WAIVED, reminder: `add ${RETRO_ISSUE_WAIVED} to the retro's issues and keep gates_fired verdict as it was — a waiver is not a pass` });
}

// ---------- CLI plumbing ----------

function writeStdoutSync(text) {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off, buf.length - off); } catch (e) { if (e.code !== 'EAGAIN') throw e; }
  }
}

function usageExit(msg) {
  process.stderr.write(`usage error: xprov ${msg}\n`);
  process.exitCode = X.EXIT_USAGE;
  return null;
}

function finish(report, code) {
  writeStdoutSync(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = code;
  return null;
}

function withFlags(args, known, sub, body) {
  const flags = parseFlags(args || [], known);
  if (flags._.length) return usageExit(`${sub}: unexpected argument ${JSON.stringify(clip(flags._[0], 80))}`);
  try { return body(flags); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usageExit(`${sub}: ${e.message}`);
    throw e;
  }
}

function cmdXprovGate(args) {
  return withFlags(args, { phase: 'str', gate: 'str', wave: 'str', lane: 'str', base: 'str', 'work-path': 'str', round: 'str', timeout: 'str', resume: 'str', feedback: 'str' }, 'gate', (f) => {
    if (!f.phase || !f.gate) return usageExit('gate requires --phase <name> --gate <id>');
    const r = gate({ phase: f.phase, gate: f.gate, wave: f.wave, lane: f.lane, base: f.base, workPath: f['work-path'], round: f.round, timeout: f.timeout, resume: f.resume, feedback: f.feedback });
    process.stderr.write(`xprov gate ${r.gate} ${scopeOf(r.wave)} round ${r.round}: ${r.verdict}${r.reason ? ` (${r.reason} at ${r.step})` : ''} — enforcement ${r.enforcement}\n`);
    return finish(r, r.verdict === X.VERDICTS.PASS ? X.EXIT_PASS : X.EXIT_FAIL);
  });
}

function cmdXprovLoadCheck(args) {
  return withFlags(args, { phase: 'str' }, 'load-check', (f) => {
    if (!f.phase) return usageExit('load-check requires --phase <name>');
    const r = loadCheck({ phase: f.phase });
    process.stderr.write(r.ok ? `xprov load-check: PLAN.md matches the newest ${r.gate} pass\n` : `xprov load-check: ${r.reason} — ${r.detail} (enforcement ${r.enforcement})\n`);
    return finish(r, r.ok ? X.EXIT_PASS : X.EXIT_FAIL);
  });
}

function cmdXprovWaveStatus(args) {
  return withFlags(args, { phase: 'str', waves: 'str' }, 'wave-status', (f) => {
    if (!f.phase) return usageExit('wave-status requires --phase <name>');
    const r = waveStatus({ phase: f.phase, waves: f.waves });
    process.stderr.write(r.ok ? `xprov wave-status: waves ${r.completed_waves.join(', ')} inspected or waived\n` : `xprov wave-status: waves lacking a ${r.gate} pass or waiver: ${r.lacking.join(', ')} (enforcement ${r.enforcement})\n`);
    return finish(r, r.ok ? X.EXIT_PASS : X.EXIT_FAIL);
  });
}

function cmdXprovWaive(args) {
  return withFlags(args, { phase: 'str', gate: 'str', wave: 'str', lane: 'str', reason: 'str' }, 'waive', (f) => {
    if (!f.phase || !f.gate || f.reason === undefined) return usageExit('waive requires --phase <name> --gate <id> [--wave N [--lane <id>]] --reason "<text>"');
    const r = waive({ phase: f.phase, gate: f.gate, wave: f.wave, lane: f.lane, reason: f.reason });
    process.stderr.write(`xprov waive: recorded a human waiver for ${r.entry.gate} ${scopeOf(r.entry.wave)} — ${r.reminder}\n`);
    return finish(r, X.EXIT_PASS);
  });
}

module.exports = {
  registryEnforcement, readIndex, sameWave, gate, loadCheck, waveStatus, waive,
  cmdXprovGate, cmdXprovLoadCheck, cmdXprovWaveStatus, cmdXprovWaive,
};
