'use strict';

// ---------------------------------------------------------------------------
// xprov dispose --secret-declined <snap-basename> — the owner said no to the allowlist question (spec 016 FR-029, wave 9).
//
//   a1-tools xprov dispose --phase <name> --gate plan-review-xprov|wave-inspect-xprov [--wave N [--lane L] --work-path <dir> --base <sha>]
//                          --secret-declined <snap-basename>
//
// A secret hit in a CHANGED line stopped the scan (secret_in_snapshot) and the owner declined the allowlist question, or gave no answer,
// or there is no chat. Nothing is sent to Codex; the target ends `not_applicable` with reason `secret_declined` (Reinhard-only review).
// a1 does not take the agent's word for it: the command needs the hits record the failed scan wrote (xprov-snapshot.cjs), for THIS
// repository and exactly the HEAD of the target. It writes a1's marker `a1-declined.json` in a new run-style dir of the artifacts dir
// and appends the index row { accepted: 'secret_declined', … }. load-check and wave-status accept the row only through the marker.
// The marker is no pass: it carries no verdict, and a later PLAN.md edit (new sha) or a moved head needs a fresh review or decision.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeTextAtomic, nowIso } = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const RR = require('./xprov-runrecord.cjs');
const WV = require('./xprov-waivers.cjs');
const CH = require('./xprov-consent-hits.cjs');
const A = require('./xprov-artifacts.cjs');
const M = require('./xprov-consent-marker.cjs');
const AL = require('./xprov-consent-allowlist.cjs');

const ACCEPTED = 'secret_declined';
const DIR_PREFIX = 'declined-';
const BASE_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const REFUSALS = Object.freeze({ scan: 'scan_unusable', stale: 'scan_stale', base: 'base_unusable', unwritable: 'decline_unwritable', head: 'head_unusable' });
const refuse = (code, detail) => Object.freeze({ ok: false, refused: code, detail });

/** { ok, head, base } — the commit the stopped scan saw, and for a wave the reviewed base (resolved in the work path). */
function targetOf(ctx, o) {
  const repo = C.commonDirOf(ctx.root);
  const h = WV.headIn(ctx.workPath, repo);
  if (h.problem) return refuse(REFUSALS.head, h.problem);
  if (ctx.wave === null) return Object.freeze({ ok: true, head: h.head, base: null });
  const b = BASE_RE.test(String(o.base)) ? C.gitOut(['-C', ctx.workPath, 'rev-parse', '--verify', '--quiet', `${o.base}^{commit}`]) : null;
  return b === null ? refuse(REFUSALS.base, '--base must be a full commit sha that resolves in the work path') : Object.freeze({ ok: true, head: h.head, base: b.trim() });
}

/**
 * The owner No on the allowlist question for this scan, as the consent hook recorded it on the marker (spec 016 wave 10, precondition 4): the
 * marker of kind allowlist is ANSWERED with decision no, bound by nonce, tool_use_id and session_id, and its hash equals the question rebuilt now.
 * → { decision, kind, hash, scan, tool_use_id, session_id, at } or null (no chat, no answer, a yes, a stale or foreign question). The merge block
 * on a PR diff counts a decline only with this record. Tier 0: the same OS user can write the marker by hand (see xprov-consent-marker.cjs).
 */
function ownerNo(root, scan) {
  try {
    const b = AL.buildFor({ root, scan });
    if (!b.ok) return null;
    const p = M.peekMarker(b.key, AL.KIND);
    const m = p.marker;
    if (p.state !== M.STATE.ANSWERED || !m || m.hash !== b.question.hash || !m.answer || m.answer.decision !== 'no') return null;
    if (m.answer.nonce !== m.nonce || m.answer.tool_use_id !== m.tool_use_id || m.answer.session_id !== m.session_id) return null;
    return Object.freeze({ decision: 'no', kind: AL.KIND, hash: m.hash, scan, tool_use_id: m.tool_use_id, session_id: m.session_id, at: m.answer.at });
  } catch (_e) { return null; }
}

function decline(ctx, o) {
  const scan = String(o.scan);
  if (!/^snap-[A-Za-z0-9._-]{1,120}$/.test(scan)) return refuse(REFUSALS.scan, 'the scan name must look like snap-…');
  const read = CH.readHits(scan);
  if (!read.ok) return refuse(REFUSALS.scan, `no usable scan hits record: ${read.why}`);
  const target = targetOf(ctx, o);
  if (!target.ok) return target;
  if (read.value.repo_key !== C.commonDirOf(ctx.root)) return refuse(REFUSALS.scan, 'the scan hits record belongs to another repository');
  if (read.value.commit !== target.head) return refuse(REFUSALS.stale, 'the scan hits record was written for another commit than the HEAD of this target; run the gate again');
  const planSha = C.sha256(fs.readFileSync(ctx.planPath));
  const marker = Object.freeze({
    version: 1, kind: ACCEPTED, gate: ctx.gate, wave: ctx.wave, lane: ctx.lane, plan_sha256: planSha, head: target.head, base: target.base,
    scan, hits: read.value.hits.length, owner_no: ownerNo(ctx.root, scan), ts: nowIso(),
  });
  const dir = path.join(X.artifactsDir(A.repoSlug(ctx.root)), `${DIR_PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
  const file = path.join(dir, 'a1-declined.json');
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const fresh = C.readIndex(ctx.indexPath);
    if (fresh === null) throw new Error('index.json changed underneath the command');
    const entry = Object.freeze({
      gate: ctx.gate, wave: ctx.wave, lane: ctx.lane, accepted: ACCEPTED, reason: ACCEPTED, plan_sha256: planSha, result_path: file,
      ...(ctx.wave === null ? {} : { head: target.head, base: target.base }), ts: marker.ts,
    });
    writeTextAtomic(ctx.indexPath, `${JSON.stringify([...fresh, entry], null, 2)}\n`);
    return Object.freeze({ ok: true, gate: ctx.gate, phase: ctx.phase, wave: ctx.wave, lane: ctx.lane, accepted: ACCEPTED, plan_sha256: planSha, head: target.head, base: target.base, marker_path: file, index_path: ctx.indexPath, entry });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    return refuse(REFUSALS.unwritable, `not written: ${C.clip(e.message, 160)}`);
  }
}

module.exports = { decline, ownerNo, ACCEPTED, REFUSALS };
