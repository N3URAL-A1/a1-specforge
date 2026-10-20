'use strict';

// ---------------------------------------------------------------------------
// xprov-feedback — round N >= 2 feedback of the gate driver, moved out of
// xprov-gate.cjs unchanged (spec 016 Wave 8 prep, behaviour-neutral): the
// dispositions path, the prior-round reader and the feedback file writer.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const { inputError, clip, sha256, isPlainObject } = C;
const { PRIOR_FINDINGS_FILE } = require('./xprov-normalize.cjs');
const { ensureArtifactsDir, isUnder } = require('./xprov-artifacts.cjs');

const FEEDBACK_DETAIL_MAX_CHARS = X.TITLE_MAX_CHARS * 4; // spec 014 FR-013: same bound as the filter's display_detail

/** The host-authored dispositions of a round (Pablo/Adam at Plan, Erik's fix
 * summary at Execute), named like normalize's findings file. */
function dispositionsPath(ctx, round) {
  const scope = `${ctx.wave === null ? 'plan' : `wave-${ctx.wave}`}${ctx.lane ? `-${ctx.lane}` : ''}`;
  return path.join(ctx.phaseDir, 'xreview', `${ctx.gate}-${scope}-r${round}.dispositions.md`);
}

const readNoFollow = C.readNoFollow;

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
  const bytes = readNoFollow(file, X.MAX_RESULT_BYTES);
  if (!bytes) throw inputError(`round ${ctx.round} needs the round-${ctx.round - 1} findings ${file} (a regular file normalize wrote)`);
  // The index row is agent-writable: it must carry the sha normalize recorded, and the file must name this round (Samuel MINOR a).
  if (typeof prev.findings_sha256 !== 'string' || sha256(bytes) !== prev.findings_sha256) throw inputError(`round-${ctx.round - 1} findings ${file} do not match the sha256 the index entry recorded`);
  const doc = parseOrNull(bytes);
  if (!doc || doc.phase !== ctx.phase || doc.gate !== ctx.gate || doc.wave !== ctx.wave || doc.lane !== ctx.lane || doc.round !== ctx.round - 1) throw inputError(`round-${ctx.round - 1} findings ${file} belong to another phase, gate, wave, lane or round`);
  const rec = parseOrNull(readNoFollow(path.join(runDir, 'result.json'), X.MAX_RESULT_BYTES) || Buffer.from(''));
  if (!rec || rec.mode !== ctx.mode) throw inputError(`round-${ctx.round - 1} run dir ${runDir} holds no ${ctx.mode} result.json`);
  const disp = readNoFollow(dispositionsPath(ctx, ctx.round - 1), X.MAX_RESULT_BYTES);
  if (!disp) throw inputError(`round ${ctx.round} needs the host-authored dispositions file ${dispositionsPath(ctx, ctx.round - 1)} (finding id → accepted|rejected + reason) — write it first`);
  return Object.freeze({ round: ctx.round - 1, doc, dispositions: disp.toString('utf8') });
}

/** One finding as a feedback line: id, severity, place, then its detail. */
function feedbackFinding(f) {
  const where = `${f.file}${f.line === null || f.line === undefined ? '' : `:${f.line}`}`;
  return `- ${f.id} [${f.severity}] ${where}\n  ${String(f.detail || f.title || '').replace(/\n/g, '\n  ')}`;
}

/** One quarantined item as feedback: `- id: reason`, and for a path_not_in_repo item that passed the marker scan
 * (spec 014 FR-013) its detail, already clipped to 480 chars by the filter, on an indented second line. */
function feedbackQuarantined(q) {
  const head = `- ${C.oneLine(clip(String(q.id), X.TITLE_MAX_CHARS))}: ${C.oneLine(clip(String(q.reason), 40))}`;
  return typeof q.display_detail === 'string' && q.display_detail !== '' ? `${head}\n  ${clip(q.display_detail, FEEDBACK_DETAIL_MAX_CHARS).replace(/\r?\n/g, '\n  ')}` : head;
}

/** The feedback text of round N: round N−1's normalized findings, quarantined
 * ones as id + reason (plus the clipped detail of a path_not_in_repo item without a marker), and the dispositions verbatim. */
function feedbackText(prior) {
  const parsed = prior.doc;
  const list = ['blocker', 'major', 'minor'].flatMap((b) => (Array.isArray(parsed[b]) ? parsed[b] : [])).filter(isPlainObject);
  const held = (Array.isArray(parsed.quarantined) ? parsed.quarantined : []).filter(isPlainObject)
    .map(feedbackQuarantined);
  return [
    `PRIOR FINDINGS (round ${prior.round}, normalized by a1; this is a fresh session):`,
    ...(list.length ? list.map(feedbackFinding) : ['- none']), '',
    `QUARANTINED IN ROUND ${prior.round} (id and reason; a path_not_in_repo item also its clipped detail):`, ...(held.length ? held : ['- none']), '',
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

module.exports = { dispositionsPath, priorRound, writeFeedback };
