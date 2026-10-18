'use strict';

// ---------------------------------------------------------------------------
// xprov-pr-cover — what covers the PR diff of a head sha (spec 016 wave 10; FR-018, Addition and preconditions 2-4).
//
// A "link" is one reviewed range { kind, head, base } that a1's own artifacts prove (index rows are only POINTERS: a row counts through the run
// dir its result_path names, as for wave-status). The PR diff `merge-base..head` is covered when a chain of accepted links reaches from `head`
// down to the merge-base: the newest review sent only the commits since the head before it (FR-018), so the links stack.
//   pass           a completed APPROVED inspect of the brief (run dir: a1-reviewed.json + a1-pass.json)
//   dispositions   round_cap closed by `xprov dispose` (a1-disposed.json, no BLOCKER)
//   waiver         the owner's chat waiver (guarded store ~/.a1-xprov/waivers.json, gate pr-diff-xprov)
//   secret_declined  the owner declined the allowlist question; counts ONLY with an owner No recorded by the consent hook (`ownerNo`)
//   fallback       twice BLOCKED, Reinhard-only: NEVER counts on a surface diff (diff content can prompt Codex into BLOCKED)
// Pure over (index, store, git); nothing is written.
// ---------------------------------------------------------------------------

const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const RR = require('./xprov-runrecord.cjs');
const AC = require('./xprov-accept.cjs');
const WV = require('./xprov-waivers.cjs');

const KINDS = Object.freeze({ PASS: 'pass', DISPOSITIONS: AC.DISPOSITIONS, DECLINED: AC.DECLINED, FALLBACK: 'fallback', WAIVER: 'waiver' });
const MAX_DEPTH = 30;
const TEXT_MAX_CHARS = 200;

/** The lane of a head: one target per head sha (FR-018). */
const laneOf = (head) => `pr${String(head).slice(0, 12)}`;

const mine = (e) => C.isPlainObject(e) && e.gate === X.GATE_IDS.PR_DIFF && C.waveNumber(e.wave) === 0 && typeof e.lane === 'string' && C.LANE_RE.test(e.lane)
  && e.waived !== true && typeof e.plan_sha256 === 'string' && typeof e.result_path === 'string';

const plain = (v) => typeof v === 'string' && v !== '' && v.length <= TEXT_MAX_CHARS && !/[\u0000-\u001f\u007f]/.test(v);

/** True when the declined marker carries an owner No the consent hook recorded (xprov-decline.cjs ownerNo) for the scan it names. */
function ownerNoValid(m) {
  const o = m && m.owner_no;
  return C.isPlainObject(o) && o.decision === 'no' && o.kind === 'allowlist' && plain(o.tool_use_id) && plain(o.session_id) && typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at))
    && /^[0-9a-f]{64}$/.test(String(o.hash)) && o.scan === m.scan;
}

/** Every link the artifacts prove. `store` is the waiver store read result ({ ok, waivers }); `repo` the git-common-dir key. */
function linksOf(index, root, store, repo) {
  const rows = index.filter(mine);
  const out = [];
  for (const e of rows.filter((r) => r.verdict === X.VERDICTS.PASS)) {
    const hb = RR.inspectPass(e.result_path, e.plan_sha256, root);
    if (hb) out.push(Object.freeze({ kind: KINDS.PASS, head: hb.head, base: hb.base }));
  }
  const seen = new Set();
  for (const e of rows) {
    const k = `${e.lane}|${e.plan_sha256}`;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const c of AC.waveSideCandidates(index, X.GATE_IDS.PR_DIFF, { wave: 0, lane: e.lane }, e.plan_sha256, root)) {
      if (c.kind === AC.DECLINED) continue; // read below, with the owner No
      out.push(Object.freeze({ kind: c.kind === 'fallback' ? KINDS.FALLBACK : c.kind, head: c.head, base: c.base }));
    }
  }
  for (const e of rows.filter((r) => r.accepted === AC.DECLINED)) {
    const m = RR.declinedMarker(e.result_path, { planSha: e.plan_sha256, gate: X.GATE_IDS.PR_DIFF, wave: 0, lane: e.lane }, root);
    if (m) out.push(Object.freeze({ kind: KINDS.DECLINED, head: m.head, base: m.base, ownerNo: ownerNoValid(m) }));
  }
  if (store && Array.isArray(store.waivers)) {
    for (const w of store.waivers.filter((x) => x.gate === X.GATE_IDS.PR_DIFF && x.repo === repo && x.phase === C.PR_PHASE && x.wave === 0)) {
      out.push(Object.freeze({ kind: KINDS.WAIVER, head: w.head, base: w.base }));
    }
  }
  return Object.freeze(out);
}

/**
 * The chain of accepted links from `head` down to `mergeBase`, newest first, or null. A link reaches the merge-base when its base IS the
 * merge-base or an ancestor of it (it reviewed at least the whole diff); otherwise the link below must end exactly at its base.
 */
function cover(links, head, mergeBase, workPath, accept) {
  const walk = (h, depth, seen) => {
    if (depth > MAX_DEPTH || seen.has(h)) return null;
    for (const l of links) {
      if (l.head !== h || !accept(l) || !WV.inHistory(workPath, l.base, l.head)) continue;
      if (l.base === mergeBase || WV.inHistory(workPath, l.base, mergeBase)) return [l];
      const rest = walk(l.base, depth + 1, new Set([...seen, h]));
      if (rest) return [l, ...rest];
    }
    return null;
  };
  return walk(head, 0, new Set());
}

const acceptPass = (l) => l.kind === KINDS.PASS;
/** What the merge block accepts on a surface diff: a pass, dispositions, an owner waiver, a decline with an owner No. Never the blocked fallback. */
const acceptMerge = (l) => l.kind === KINDS.PASS || l.kind === KINDS.DISPOSITIONS || l.kind === KINDS.WAIVER || (l.kind === KINDS.DECLINED && l.ownerNo === true);

module.exports = { KINDS, laneOf, linksOf, cover, acceptPass, acceptMerge, ownerNoValid };
