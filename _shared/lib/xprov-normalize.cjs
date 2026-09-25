'use strict';

// ---------------------------------------------------------------------------
// xprov-normalize — `a1-tools xprov normalize <result.json> --phase <name>
// --gate <id> [--wave N] [--round N] [--work-path <dir>]`
// (spec 009-cross-provider-review-gate, Wave 2; hardened after Reinhard's
// mutation review, 2026-09-24).
//
// Turns ANY runner output into exactly one of `pass`, `fail-with-findings` or
// `fail/<reason>` — a total mapping, evaluated in a fixed order:
//   read (missing / empty / unparseable / > 5 MB / not an object → malformed)
//   → secret filter over the raw text + reply.txt for EVERY readable record,
//     before any classification (a token in `error`, `limitations` or
//     `coverage` must never reach XREVIEW.md) → secret_in_output
//   → status !== completed → runner_failed
//   → mode ∉ review|inspect (exact, case-sensitive) → wrong_mode
//   → verdict ∉ APPROVED|REVISE|BLOCKED (exact) → malformed
//   → plan_sha256 missing → malformed; ≠ sha256(PLAN.md) → plan_changed
//   → findings shape (five own string fields ≤ 10 000 chars, severity in the
//     own-property set high|medium|low, non-empty file) → malformed
//   → quarantine hook: quarantined item on APPROVED → quarantined
//   → APPROVED → pass · REVISE → fail-with-findings · BLOCKED → blocked.
// Both hooks come from xprov-filter.cjs (Wave 3) through a lazy require; a
// missing module, a thrown hook or a result outside the contract is
// `malformed` — never `pass` without a filter verdict.
//
// Writers (all through writeTextAtomic, every rendered cell sanitised):
// XREVIEW.md section, the Reinhard-shaped findings file (pass and
// fail-with-findings only), index.json (read → new array → atomic write).
// Exit 0 only on pass; 1 on any fail with stdout JSON naming `reason`; 2 on
// usage errors and on collisions (existing round / findings file, corrupt
// index) with no stdout JSON and nothing written.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { parseFlags, repoRoot, assertSafeSegment, writeTextAtomic, nowIso } = require('./io.cjs');
const { parseRegistryIds } = require('./gate-ids.cjs');
const X = require('./xprov.cjs');

const FLAGS = Object.freeze({ phase: 'str', gate: 'str', wave: 'str', round: 'str', lane: 'str', 'work-path': 'str' });
const REGISTRY_PATH = path.join(__dirname, '..', 'gates-registry.md');
const FILTER_MODULE = path.join(__dirname, 'xprov-filter.cjs');
const ARTIFACTS_MODULE = path.join(__dirname, 'xprov-artifacts.cjs');
const SEVERITY_BUCKET = Object.freeze({ high: 'blocker', medium: 'major', low: 'minor' });
const SEVERITIES = new Set(Object.keys(SEVERITY_BUCKET));
const FINDING_FIELDS = Object.freeze(['id', 'severity', 'path', 'evidence', 'fix']);
const RESPONSE_VERDICTS = new Set(['APPROVED', 'REVISE', 'BLOCKED']);
const RUNNER_MODES = new Set(X.RUNNER_MODES);
const FIX_MARKER = 'Fix (reviewer proposal, not applied): ';
// greedy `(.*)` keeps `a.js:42:7` as file `a.js:42` line 7; an empty file part
// (`:42`) is rejected by mapFinding, a > 7-digit suffix is not a line number.
const LINE_RE = /^(.*):(\d{1,7})$/;
const XREVIEW_HEADER = '# XREVIEW — cross-provider review log\n\nWritten by `a1-tools xprov normalize`; one section per run, newest last.\n';

// ---------- small helpers ----------

function usage(msg) {
  process.stderr.write(`usage error: xprov normalize ${msg}\n`);
  process.stderr.write('  usage: xprov normalize <result.json> --phase <name> --gate <id> [--wave N] [--round N] [--work-path <dir>]\n');
  process.exit(X.EXIT_USAGE);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const fail = (reason, extra) => ({ verdict: X.VERDICTS.FAIL, reason, ...(extra || {}) });

function parsePositive(value, name) {
  if (!/^[1-9]\d*$/.test(String(value))) usage(`--${name} must be an integer >= 1`);
  return Number(value);
}

/** Markdown sanitiser: one line, pipes escaped, bounded length. */
function cell(value, max) {
  const s = String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').replace(/\|/g, '\\|');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s; // total length ≤ max
}
const bullet = (value) => cell(value, X.MAX_FIELD_CHARS);

// ---------- read + classify (pure over the record) ----------

/** Read the runner record. Every read problem is `malformed` — including the
 * runner's own pre-run_dir refusals, which leave no result.json at all. */
function readRecord(file) {
  let raw;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0 || st.size > X.MAX_RESULT_BYTES) return { ok: false, raw: '' };
    raw = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return { ok: false, raw: '' };
  }
  try {
    const record = JSON.parse(raw);
    return isPlainObject(record) ? { ok: true, record, raw } : { ok: false, raw };
  } catch (_e) {
    return { ok: false, raw };
  }
}

function splitPath(p) {
  const m = String(p).match(LINE_RE);
  return m ? { file: m[1], line: Number(m[2]) } : { file: String(p), line: null };
}

function firstSentence(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*?[.!?])(\s|$)/);
  return (m ? m[1] : t).trim();
}

/** Map one runner finding into the Reinhard shape; null when the finding
 * violates the contract (missing/inherited/non-string/oversized field,
 * unknown severity, empty file). */
function mapFinding(f) {
  if (!isPlainObject(f)) return null;
  for (const k of FINDING_FIELDS) {
    if (!own(f, k) || typeof f[k] !== 'string' || f[k].length > X.MAX_FIELD_CHARS) return null;
  }
  if (!SEVERITIES.has(f.severity)) return null;
  const { file, line } = splitPath(f.path);
  if (file === '') return null;
  const title = `${f.id}: ${firstSentence(f.evidence)}`.replace(/[\r\n\t]+/g, ' ').slice(0, X.TITLE_MAX_CHARS);
  return {
    id: f.id, severity: f.severity, bucket: SEVERITY_BUCKET[f.severity], file, line, title,
    detail: `${f.evidence.trim()}\n\n${FIX_MARKER}${f.fix.trim()}`, evidence: f.evidence, fix: f.fix,
  };
}

function mapFindings(list) {
  if (!Array.isArray(list)) return null;
  const mapped = list.map(mapFinding);
  return mapped.some((m) => m === null) ? null : mapped;
}

/** The total mapping after the secret filter and before the quarantine hook. */
function classify(record, planSha) {
  if (record.status !== 'completed') {
    return fail(X.REASONS.runner_failed, { reason_detail: typeof record.error === 'string' ? record.error : null });
  }
  if (!RUNNER_MODES.has(record.mode)) return fail(X.REASONS.wrong_mode, { reason_detail: `mode=${String(record.mode)}` });
  const response = record.response;
  if (!isPlainObject(response) || !RESPONSE_VERDICTS.has(response.verdict)) return fail(X.REASONS.malformed, { reason_detail: 'response.verdict' });
  for (const key of ['limitations', 'coverage']) {
    if (own(response, key) && (!Array.isArray(response[key]) || response[key].some((x) => typeof x !== 'string'))) {
      return fail(X.REASONS.malformed, { reason_detail: `response.${key}` });
    }
  }
  if (typeof record.plan_sha256 !== 'string') return fail(X.REASONS.malformed, { reason_detail: 'plan_sha256' });
  if (record.plan_sha256 !== planSha) return fail(X.REASONS.plan_changed, { reason_detail: `record ${record.plan_sha256} vs PLAN.md ${planSha}` });
  const findings = mapFindings(response.findings);
  if (findings === null) return fail(X.REASONS.malformed, { reason_detail: 'response.findings' });
  if (response.verdict === 'BLOCKED') {
    return fail(X.REASONS.blocked, { findings, limitations: Array.isArray(response.limitations) ? [...response.limitations] : [] });
  }
  return { verdict: response.verdict === 'APPROVED' ? X.VERDICTS.PASS : X.VERDICTS.FAIL_WITH_FINDINGS, reason: null, findings };
}

// ---------- model fields (FR-013) ----------

function requestedFromCommandJson(resultPath) {
  try {
    const argv = JSON.parse(fs.readFileSync(path.join(path.dirname(resultPath), 'command.json'), 'utf8'));
    if (!Array.isArray(argv)) return null;
    const i = argv.findIndex((a) => a === '--model' || a === '-m');
    return i >= 0 && typeof argv[i + 1] === 'string' ? argv[i + 1] : null;
  } catch (_e) {
    return null;
  }
}

/** model_observed = observed_models[0] (index.json); XREVIEW.md lists them all. */
function modelFields(record, resultPath) {
  const fromArgv = requestedFromCommandJson(resultPath);
  const requested = fromArgv || (typeof record.requested_model === 'string' && record.requested_model !== '' ? record.requested_model : X.MODEL_REQUESTED_DEFAULT);
  const obs = Array.isArray(record.observed_models) ? record.observed_models.filter((m) => typeof m === 'string' && m !== '') : [];
  return {
    model_requested: requested, model_observed: obs.length > 0 ? obs[0] : X.MODEL_OBSERVED_UNKNOWN,
    model_observed_all: obs.length > 0 ? obs.join(', ') : X.MODEL_OBSERVED_UNKNOWN,
    cli_version: typeof record.cli_version === 'string' ? record.cli_version : null,
  };
}

// ---------- filter hooks (Wave 3 module, lazy, strict contract) ----------

function loadFilter() {
  if (!fs.existsSync(FILTER_MODULE)) return null;
  const mod = require(FILTER_MODULE);
  return typeof mod.filterOutput === 'function' && typeof mod.quarantineFindings === 'function' ? mod : null;
}

function lsFilesSet(repo) {
  try {
    const out = execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return new Set(out.split('\0').filter(Boolean));
  } catch (_e) {
    process.stderr.write(`xprov normalize: git ls-files failed in ${repo}; quarantine sees an empty file set\n`);
    return new Set();
  }
}

/** reply.txt sibling, bounded like result.json (Samuel re-check): a reply above
 * MAX_RESULT_BYTES is `{ ok: false }` and the run fails closed as `malformed` —
 * it cannot be scanned, so it is not cleared; it is NOT `secret_in_output`,
 * which would claim a pattern hit that never happened. Absent file → ''. */
function readReply(resultPath) {
  const file = path.join(path.dirname(resultPath), 'reply.txt');
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { ok: true, text: '' };
    if (st.size > X.MAX_RESULT_BYTES) return { ok: false, text: '' };
    return { ok: true, text: fs.readFileSync(file, 'utf8') };
  } catch (_e) {
    return { ok: true, text: '' };
  }
}

const contractFail = () => fail(X.REASONS.malformed, { reason_detail: 'filter contract' });

/** Secret filter over the raw texts. Returns null when clean, else the fail outcome. */
function secretScan(filter, ctx) {
  const reply = readReply(ctx.resultPath);
  if (!reply.ok) return fail(X.REASONS.malformed, { reason_detail: `reply.txt exceeds ${X.MAX_RESULT_BYTES} bytes and cannot be scanned` });
  let hit;
  try { hit = filter.filterOutput([ctx.raw, reply.text]); } catch (_e) { return contractFail(); }
  if (!isPlainObject(hit) || typeof hit.hit !== 'boolean') return contractFail();
  if (hit.hit === false) return null;
  return fail(X.REASONS.secret_in_output, { secret_pattern: typeof hit.pattern_name === 'string' ? hit.pattern_name : 'unnamed' });
}

/** Quarantine hook over a non-fail outcome. Returns a NEW outcome. */
function quarantine(filter, outcome, ctx) {
  let q;
  try {
    q = filter.quarantineFindings(outcome.findings || [], { lsFiles: lsFilesSet(ctx.workPath), planPath: ctx.planRel, repoRoot: ctx.workPath });
  } catch (_e) { return contractFail(); }
  if (!isPlainObject(q) || !Array.isArray(q.kept) || !Array.isArray(q.quarantined)) return contractFail();
  if (outcome.verdict === X.VERDICTS.PASS && q.quarantined.length > 0) return { ...fail(X.REASONS.quarantined), findings: q.kept, quarantined: q.quarantined };
  return { ...outcome, findings: q.kept, quarantined: q.quarantined };
}

// ---------- writers ----------

function bucketize(findings) {
  const out = { blocker: [], major: [], minor: [] };
  for (const f of findings) out[f.bucket].push({ id: f.id, file: f.file, line: f.line, title: f.title, detail: f.detail, severity: f.severity });
  return out;
}

function writeFindingsFile(file, summary, findings) {
  writeTextAtomic(file, JSON.stringify({ summary, ...bucketize(findings) }, null, 2) + '\n');
}

function renderTable(rows) {
  if (rows.length === 0) return '_none_\n';
  const line = (f) => `| ${cell(f.id, X.TITLE_MAX_CHARS)} | ${cell(f.severity, 20)} | ${cell(f.file, X.TITLE_MAX_CHARS)} | ${f.line === null || f.line === undefined ? '' : cell(f.line, 10)} | ${cell(f.title, X.TITLE_MAX_CHARS)} |${f.reason ? ` ${cell(f.reason, 40)} |` : ''}`;
  return `| id | severity | file | line | title |\n|---|---|---|---|---|\n${rows.map(line).join('\n')}\n`;
}

const LIST_MAX_ITEMS = 50;

function renderList(items) {
  if (!Array.isArray(items) || items.length === 0) return ['_none_'];
  const shown = items.slice(0, LIST_MAX_ITEMS).map((l) => `- ${bullet(l)}`);
  return items.length > LIST_MAX_ITEMS ? [...shown, `- …and ${items.length - LIST_MAX_ITEMS} more`] : shown;
}

/** stdout is a pipe more often than not: process.stdout.write + process.exit
 * truncates at 64 KiB (measured by Samuel, 3 MB → 65 536 bytes). Write the
 * whole buffer synchronously on fd 1 and let the process end by itself. */
function writeStdoutSync(text) {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off, buf.length - off); } catch (e) { if (e.code !== 'EAGAIN') throw e; }
  }
}

const DETAIL_MAX_CHARS = 500;
const clip = (v, max) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1)}…` : v); // total length ≤ max
const echoQuarantined = (q) => ({ id: q.id, file: q.file, line: q.line === undefined ? null : q.line, reason: q.reason, marker: q.marker === undefined ? null : q.marker, title: clip(q.title, X.TITLE_MAX_CHARS) });

function renderSection(ctx, outcome, model, runnerSha) {
  const scope = ctx.wave === null ? 'plan' : `wave ${ctx.wave}`;
  const resp = outcome.reason === X.REASONS.secret_in_output ? {} : (ctx.response || {});
  const lines = [
    `## ${ctx.gate} · ${scope} · ${ctx.isRound ? `round ${ctx.round}` : `attempt ${ctx.attempt}`} · ${ctx.ts}`, '',
    `- verdict: ${outcome.verdict}`, `- reason: ${outcome.reason === null ? 'none' : outcome.reason}`,
    ...(outcome.reason_detail ? [`- reason_detail: ${bullet(outcome.reason_detail)}`] : []),
    ...(outcome.secret_pattern ? [`- secret_pattern: ${bullet(outcome.secret_pattern)}`] : []),
    `- model_requested: ${bullet(model.model_requested)}`, `- model_observed: ${bullet(model.model_observed_all)}`,
    `- cli_version: ${model.cli_version === null ? 'unknown' : bullet(model.cli_version)}`,
    `- runner_sha256: ${runnerSha}`, `- plan_sha256: ${ctx.planSha}`, `- result: ${bullet(ctx.resultPath)}`,
    ...(ctx.findingsPath ? [`- findings: ${path.relative(ctx.phaseDir, ctx.findingsPath)}`] : []), '',
    '### Findings', renderTable(outcome.findings || []),
    '### Quarantined', renderTable(outcome.quarantined || []),
    '### Limitations', ...renderList(resp.limitations), '',
    '### Coverage', ...renderList(resp.coverage), '',
  ];
  return `${lines.join('\n')}\n`;
}

function appendToXreview(phaseDir, section) {
  const file = path.join(phaseDir, 'XREVIEW.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : XREVIEW_HEADER;
  writeTextAtomic(file, `${existing.replace(/\n*$/, '\n\n')}${section}`);
  return file;
}

/** Exported for Wave 5's tripwire: one titled note appended to XREVIEW.md. */
function appendXreviewNote(phaseDir, title, lines) {
  return appendToXreview(phaseDir, `## ${cell(title, X.TITLE_MAX_CHARS)} · ${nowIso()}\n\n${lines.map((l) => `- ${bullet(l)}`).join('\n')}\n`);
}

/** [] when absent, the array when every entry is a plain object, else null. */
function readIndex(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(arr) && arr.every(isPlainObject) ? arr : null;
  } catch (_e) {
    return null;
  }
}

const sameWave = (entry, wave) => (wave === null ? entry.wave === null || entry.wave === undefined : Number(entry.wave) === wave);

function runGcIfPresent() {
  if (!fs.existsSync(ARTIFACTS_MODULE)) {
    process.stderr.write('xprov normalize: gc skipped (xprov-artifacts.cjs not shipped yet)\n');
    return;
  }
  try {
    const mod = require(ARTIFACTS_MODULE);
    if (typeof mod.gc === 'function') mod.gc({ now: Date.now(), maxAgeDays: X.ARTIFACT_MAX_AGE_DAYS });
  } catch (e) {
    process.stderr.write(`xprov normalize: gc failed: ${e.message}\n`);
  }
}

// ---------- argument resolution (usage errors exit 2, no stdout JSON, nothing written) ----------

function resolveArgs(args) {
  const flags = parseFlags(args, FLAGS);
  const stray = flags._.filter((a) => a.startsWith('--'));
  if (stray.length) usage(`unknown flag ${stray[0]}`);
  if (flags._.length !== 1) usage('exactly one <result.json> is required');
  if (!flags.phase) usage('--phase is required');
  if (!flags.gate) usage('--gate is required');
  const phase = assertSafeSegment(flags.phase, '--phase');
  const root = repoRoot();
  const phaseDir = path.join(root, '.a1', 'phases', phase);
  if (!fs.existsSync(phaseDir) || !fs.statSync(phaseDir).isDirectory()) usage(`phase dir not found: ${phaseDir}`);
  let ids;
  try { ids = parseRegistryIds(fs.readFileSync(REGISTRY_PATH, 'utf8')); } catch (_e) { usage(`registry unreadable: ${REGISTRY_PATH}`); }
  if (!ids.includes(flags.gate)) usage(`--gate ${JSON.stringify(String(flags.gate).slice(0, 80))} is not a registered gate id`);
  const wave = flags.wave === undefined ? null : parsePositive(flags.wave, 'wave');
  const workPath = flags['work-path'] ? path.resolve(flags['work-path']) : root;
  if (!fs.existsSync(workPath) || !fs.statSync(workPath).isDirectory()) usage(`--work-path is not a directory: ${workPath}`);
  const indexPath = path.join(phaseDir, 'xreview', 'index.json');
  const existing = readIndex(indexPath);
  if (existing === null) usage(`index.json unparseable or not an array of objects: ${indexPath} — repair or move it before re-running`);
  // Round key = gate + wave + lane: two lanes of one wave each get their own round 1.
  const lane = flags.lane === undefined ? null : assertSafeSegment(flags.lane, '--lane');
  const sameLane = (e) => (lane === null ? e.lane === null || e.lane === undefined : e.lane === lane);
  // Rounds vs attempts (Reinhard W6): only pass | fail-with-findings consume a
  // round (FR-006 caps REVISE rounds); every other fail is an `attempt` — a
  // provider outage must never drive a wave into round_cap.
  const sameKey = existing.filter((e) => e.gate === flags.gate && sameWave(e, wave) && sameLane(e));
  const priorRounds = sameKey.filter((e) => Number.isInteger(e.round));
  const priorAttempts = sameKey.filter((e) => !Number.isInteger(e.round));
  const round = flags.round === undefined ? 1 + priorRounds.length : parsePositive(flags.round, 'round');
  const attempt = 1 + priorAttempts.length;
  const roundTaken = priorRounds.some((e) => Number(e.round) === round);
  const scope = `${wave === null ? 'plan' : `wave-${wave}`}${lane ? `-${lane}` : ''}`;
  const findingsPath = path.join(phaseDir, 'xreview', `${flags.gate}-${scope}-r${round}.findings.json`);
  const roundKey = `${flags.gate} ${wave === null ? 'plan' : `wave ${wave}`}${lane ? ` lane ${lane}` : ''} round ${round}`;
  const planPath = path.join(phaseDir, 'PLAN.md');
  if (!fs.existsSync(planPath)) usage(`PLAN.md not found in ${phaseDir}`);
  return {
    resultPath: path.resolve(flags._[0]), phase, phaseDir, gate: flags.gate, wave, lane, round, attempt, roundTaken, roundKey, workPath, indexPath, findingsPath,
    planPath, planRel: path.relative(root, planPath), planSha: sha256(fs.readFileSync(planPath)), ts: nowIso(),
  };
}

// ---------- command ----------

function evaluate(ctx, read) {
  if (!read.ok) return fail(X.REASONS.malformed, { reason_detail: 'result file missing, empty, unparseable, oversized or not an object' });
  const filter = loadFilter();
  if (!filter) {
    process.stderr.write('xprov normalize: filter module missing (xprov-filter.cjs) — failing closed\n');
    return fail(X.REASONS.malformed, { reason_detail: 'filter module missing' });
  }
  const secret = secretScan(filter, { ...ctx, raw: read.raw });
  if (secret) return secret;
  const outcome = classify(read.record, ctx.planSha);
  return outcome.verdict === X.VERDICTS.FAIL ? outcome : quarantine(filter, outcome, ctx);
}

function cmdXprovNormalize(args) {
  const ctx = resolveArgs(args);
  const read = readRecord(ctx.resultPath);
  const record = read.ok ? read.record : {};
  const outcome = evaluate(ctx, read);
  // After a secret hit the WHOLE record is tainted (Samuel W3 BLOCKER): no
  // field of it is rendered or copied — model fields fall back to the argv
  // sibling or the literals, cli_version to null, response to nothing.
  const tainted = outcome.reason === X.REASONS.secret_in_output;
  ctx.response = !tainted && isPlainObject(record.response) ? record.response : null;
  const model = modelFields(tainted ? {} : record, ctx.resultPath);
  const writesFindings = outcome.verdict === X.VERDICTS.PASS || outcome.verdict === X.VERDICTS.FAIL_WITH_FINDINGS;
  // A round is consumed only now that the verdict is known; collisions are usage
  // errors and nothing has been written yet.
  ctx.isRound = writesFindings;
  if (ctx.isRound && ctx.roundTaken) usage(`index.json already holds ${ctx.roundKey}`);
  if (ctx.isRound && fs.existsSync(ctx.findingsPath)) usage(`findings file already exists for this round: ${ctx.findingsPath}`);
  if (!writesFindings) ctx.findingsPath = null;
  if (writesFindings) writeFindingsFile(ctx.findingsPath, ctx.response ? bullet(ctx.response.summary) : '', outcome.findings || []);
  const pin = X.checkRunnerPin();
  const xreviewPath = appendToXreview(ctx.phaseDir, renderSection(ctx, outcome, model, pin.actual || `unverified (${pin.reason})`));
  const entry = {
    gate: ctx.gate, wave: ctx.wave, lane: ctx.lane, ...(ctx.isRound ? { round: ctx.round } : { attempt: ctx.attempt }), verdict: outcome.verdict, reason: outcome.reason,
    plan_sha256: ctx.planSha, result_path: ctx.resultPath, ts: ctx.ts,
    model_requested: model.model_requested, model_observed: model.model_observed, cli_version: model.cli_version,
  };
  const index = readIndex(ctx.indexPath);
  if (index === null) usage(`index.json changed underneath the run: ${ctx.indexPath}`);
  writeTextAtomic(ctx.indexPath, JSON.stringify([...index, entry], null, 2) + '\n');
  runGcIfPresent();
  const limitations = tainted ? [] : (outcome.limitations || []).map((l) => clip(l, DETAIL_MAX_CHARS));
  writeStdoutSync(`${JSON.stringify({
    verdict: outcome.verdict, reason: outcome.reason, reason_detail: clip(outcome.reason_detail || null, DETAIL_MAX_CHARS),
    secret_pattern: outcome.secret_pattern || null, findings_path: ctx.findingsPath, xreview_path: xreviewPath,
    index_entry: entry, quarantined: (outcome.quarantined || []).map(echoQuarantined), limitations,
  }, null, 2)}\n`);
  process.exitCode = outcome.verdict === X.VERDICTS.PASS ? X.EXIT_PASS : X.EXIT_FAIL;
}

module.exports = { cmdXprovNormalize, appendXreviewNote, classify, mapFinding, splitPath, firstSentence, modelFields, cell };
