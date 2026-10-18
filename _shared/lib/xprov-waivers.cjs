'use strict';

// ---------------------------------------------------------------------------
// xprov-waivers — the guarded waiver store (spec 009 FR-007, amended
// 2026-10-03 after a1-samuel-security's Wave 7 review).
//
// A waiver is the only way past a `fail` under `blocking` (a Codex quota
// outage, for one). It is a HUMAN act, written only by `xprov waive` behind
// the same guards as the allowlist owner approval (xprov-approve.cjs
// guardRefusal), into ~/.a1-xprov/waivers.json under the same store rules
// (lstat, 0700 dir / 0600 file, own uid, O_NOFOLLOW read, atomic write).
//
// Key (every part computed by a1, never taken from a flag or a copy):
//   repo        realpath of the primary checkout's git-common-dir
//   phase, gate
//   plan_sha256 sha256 of the raw bytes of <toplevel>/.a1/phases/<phase>/PLAN.md
//   wave-inspect-xprov additionally: wave, lane (or null), head (HEAD of
//   --work-path, same git-common-dir) and base (full sha).
//
// Authority: load-check and wave-status accept a waiver ONLY from this store
// and only when the key equals what they compute at check time. The
// `waived: true` row in index.json and the XREVIEW.md section are a mirror.
// Wave coverage (passes and waivers alike, chainCoverage below; Samuel MAJOR 2
// on da103f3): per lane the covered waves form a CHAIN — base is an ancestor
// of head, head of wave N leads to base of the next completed wave, and the
// last completed wave's head leads to the lane's work-path HEAD. "Leads to"
// is equality, or ancestry where every commit in between only touches the
// files the workflows write at those points (exemptFiles, measured from
// 02-execute 2b-x…2c, SKILL.md `product stage`, 03-verify) as regular files
// (`git diff --raw` mode 100644 — no symlink, no executable, no gitlink).
// No caller-chosen "current wave".
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const AL = require('./xprov-allowlist.cjs');

const WAIVERS_FILE = 'waivers.json';
const STORE_LABEL = 'waiver store';
const SHA_RE = /^[0-9a-f]{40,64}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const RECORD_KEYS = Object.freeze(['repo', 'phase', 'gate', 'plan_sha256', 'wave', 'lane', 'head', 'base', 'reason', 'by', 'ts']);

const waiversPath = () => path.join(X.xprovHome(), WAIVERS_FILE);

/** A store record has exactly RECORD_KEYS with the right shapes, else null. */
function validRecord(r) {
  if (!AL.exactKeys(r, RECORD_KEYS)) return null;
  const str = (v) => typeof v === 'string' && v !== '';
  if (![r.repo, r.phase, r.gate, r.reason, r.by, r.ts].every(str) || !SHA256_HEX_RE.test(r.plan_sha256)) return null;
  const isWave = r.gate === X.GATE_IDS.WAVE_INSPECT || r.gate === X.GATE_IDS.PR_DIFF; // the PR diff gate is keyed like a wave (wave 0, lane pr<head>)
  if (isWave && !(Number.isInteger(r.wave) && r.wave >= 0 && SHA_RE.test(String(r.head)) && SHA_RE.test(String(r.base)))) return null;
  if (isWave && r.lane !== null && !C.LANE_RE.test(String(r.lane))) return null;
  if (!isWave && (r.wave !== null || r.lane !== null || r.head !== null || r.base !== null)) return null;
  return { ...r };
}

function parseWaiversDoc(doc) {
  if (!AL.exactKeys(doc, ['version', 'waivers']) || doc.version !== 1 || !Array.isArray(doc.waivers)) return null;
  const list = doc.waivers.map(validRecord);
  return list.some((r) => r === null) ? null : list;
}

/** { ok: true, waivers } or { ok: false, missing, why, waivers: [] }. */
function readWaivers() {
  const r = AL.readGuardedStore(waiversPath(), STORE_LABEL, parseWaiversDoc);
  return r.ok ? { ok: true, waivers: r.value } : { ...r, waivers: [] };
}

const planShaOf = (planPath) => C.sha256(fs.readFileSync(planPath));

/** HEAD of `workPath` when it shares `repo`'s git-common-dir, else { problem }. */
function headIn(workPath, repo) {
  if (C.commonDirOf(workPath) !== repo) return { problem: `--work-path ${workPath} does not share the git-common-dir of the primary checkout` };
  const out = C.gitOut(['-C', workPath, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  return out === null ? { problem: `HEAD does not resolve in ${workPath}` } : { head: out.trim() };
}

/** `ancestor` is `descendant` or one of its ancestors (both full shas). */
function inHistory(workPath, ancestor, descendant) {
  if (ancestor === descendant) return true;
  const r = C.gitSpawn(['-C', workPath, 'merge-base', '--is-ancestor', ancestor, descendant]);
  return r.status === 0;
}

/** The plan-review waiver matching (repo, phase, plan sha) — newest first — or null. */
function planWaiver(store, key) {
  const hits = store.waivers.filter((w) => w.gate === X.GATE_IDS.PLAN_REVIEW && w.repo === key.repo && w.phase === key.phase && w.plan_sha256 === key.plan_sha256);
  return hits.length ? hits[hits.length - 1] : null;
}

/** Store waivers for (repo, phase, plan sha, wave, lane), oldest first. */
function waveWaivers(store, key) {
  return store.waivers.filter((w) => w.gate === (key.gate === X.GATE_IDS.PR_DIFF ? X.GATE_IDS.PR_DIFF : X.GATE_IDS.WAVE_INSPECT) && w.repo === key.repo && w.phase === key.phase
    && w.plan_sha256 === key.plan_sha256 && w.wave === key.wave && w.lane === (key.lane || null));
}

/** The files a1's own workflows write between a wave's inspection and the
 * next wave's PRE_WAVE_HEAD, or after the last wave (measured 2026-10-04):
 * the phase's STATUS*.md, VERIFICATION.md, observations.jsonl,
 * PLAN-REVIEW-LOG.md, XREVIEW.md and xreview/*.json|*.md (02-execute 2b-x,
 * 2c, lane consolidation, 03-verify), and what `product stage` writes at the
 * 2c checkpoint (a1-execute SKILL.md "docs/product Wiring", product.cjs):
 * docs/product/{ROADMAP.md,index.json,NEXT.md,CHANGELOG-archive.md},
 * docs/product/features/<id>/feature.md and .a1/reservations.json. */
function exemptFiles(phase) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ph = `\\.a1/phases/${esc(phase)}/`;
  return [
    new RegExp(`^${ph}(STATUS(-[A-Za-z0-9_-]+)?\\.md|VERIFICATION\\.md|observations\\.jsonl|PLAN-REVIEW-LOG\\.md|XREVIEW\\.md|xreview/[^/]+\\.(json|md))$`),
    /^docs\/product\/(ROADMAP\.md|index\.json|NEXT\.md|CHANGELOG-archive\.md|features\/[^/]+\/feature\.md)$/,
    /^\.a1\/reservations\.json$/,
  ];
}

const RAW_META_RE = /^:[0-7]{6} [0-7]{6} [0-9a-f]+ [0-9a-f]+ [A-Z][0-9]*$/;

/** Parse `git diff --raw -z` output: [{ mode, path }], or null on ANY entry
 * off the format (fail closed, Samuel NIT b). */
function parseRawZ(stdout) {
  const parts = String(stdout).split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  if (parts.length % 2 !== 0) return null;
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    if (!RAW_META_RE.test(parts[i]) || parts[i + 1] === '') return null;
    out.push({ mode: parts[i].slice(1).split(' ')[1], path: parts[i + 1] });
  }
  return out;
}

/** `git diff --raw -z` entries between two commits, or null. */
function rawChanges(workPath, from, to) {
  const r = C.gitSpawn(['-C', workPath, 'diff', '--raw', '-z', '--no-renames', from, to, '--']);
  return r.status === 0 ? parseRawZ(r.stdout) : null;
}

/** `from` leads to `to`: equal, or an ancestor whose later commits only write
 * exempt files as regular files (mode 100644). */
function leadsTo(workPath, from, to, phase) {
  if (from === to) return true;
  if (!inHistory(workPath, from, to)) return false;
  const changes = rawChanges(workPath, from, to);
  const allowed = exemptFiles(phase);
  return changes !== null && changes.every((c) => c.mode === '100644' && allowed.some((re) => re.test(c.path)));
}

/** Coverage of completed (wave, lane) pairs by candidate entries.
 * candidates(p) → [{ kind, head, base }] oldest first; tips[lane|''] →
 * { workPath, head } or undefined (no work path for that lane → fail closed).
 * Returns a Map pair-key → chosen entry or null. Walks each lane from its last
 * completed wave down: the last must sit at the tip (atTip), every earlier one
 * must end exactly where the next one's base starts; a lacking successor makes
 * every earlier wave of the lane lack too (fail closed). `exempt` (Set of `wave|lane`, optional) and `ranges` (Map wave -> verified { base, head }): placement-exempt waves are skipped; the
 * gap around them keeps the ancestry rule via the wave's verified range; the workflow-files-only rule is dropped there (the gap is exactly the verified exempt ranges). */
function chainCoverage(pairs, candidates, tips, phase, exempt, ranges) {
  const chosen = new Map();
  const skip = exempt instanceof Set ? exempt : new Set();
  const key = (p) => `${p.wave}|${p.lane || ''}`;
  const lanes = [...new Set(pairs.map((p) => p.lane || ''))];
  for (const lane of lanes) {
    const waves = pairs.filter((p) => (p.lane || '') === lane).sort((a, b) => a.wave - b.wave);
    const tip = tips[lane];
    let next = null;
    let seenRequired = false; // a required (non-exempt) wave lies after this one
    let gap = false; // exempt waves (placement, spec 016 FR-020) lie between this wave and `next` / the tip: their commits are not reviewed by design
    for (let i = waves.length - 1; i >= 0; i--) {
      const p = waves[i];
      if (skip.has(key(p))) { gap = true; continue; }
      const isLast = !seenRequired;
      // across exempt waves (gap) the head must STILL be an ancestor of the next base / the tip; the "workflow files only" rule is relaxed
      // because the caller passes `exempt` only for waves whose ranges it verified to tile the gap (xprov-wave-ranges.cjs, spec 016 FR-020)
      // and the pass head must lead to the END of the wave's verified range (only workflow files between): commits added to the wave after its review
      // are not left unclassified in the gap (Samuel wave 7 round 3)
      const viaRange = (c, to) => {
        const r = ranges instanceof Map ? ranges.get(p.wave) : undefined;
        return r !== undefined && leadsTo(tip.workPath, c.head, r.head, phase) && inHistory(tip.workPath, r.head, to);
      };
      const reaches = (c, to) => leadsTo(tip.workPath, c.head, to, phase) || (gap && viaRange(c, to));
      const ok = (c) => SHA_RE.test(String(c.head)) && SHA_RE.test(String(c.base)) && inHistory(tip.workPath, c.base, c.head)
        && (isLast ? reaches(c, tip.head) : next !== null && reaches(c, next.base));
      const pick = tip ? [...candidates(p)].reverse().find(ok) || null : null;
      chosen.set(key(p), pick);
      next = pick;
      seenRequired = true;
      gap = false;
    }
  }
  return chosen;
}

/** Appends the records in ONE atomic write; a broken existing store is never replaced (Samuel S-m5 for approvals).
 * The caller holds the owner-store lock (xprov-audit.cjs withStoreLock): this reads the store and writes it back (spec 016 R-4). */
function appendWaivers(records, writeGuardedStore) {
  const current = readWaivers();
  if (!current.ok && !current.missing) throw C.inputError(`the existing ${STORE_LABEL} is not usable (${current.why}); fix or remove ${waiversPath()} yourself`, 'store_broken');
  const recs = records.map(validRecord);
  if (recs.some((r) => r === null)) throw new Error('internal: waiver record off-format');
  return writeGuardedStore(WAIVERS_FILE, { version: 1, waivers: [...current.waivers, ...recs] });
}

/** Appends one record (see appendWaivers). */
const appendWaiver = (record, writeGuardedStore) => appendWaivers([record], writeGuardedStore);

module.exports = { WAIVERS_FILE, RECORD_KEYS, waiversPath, readWaivers, planShaOf, headIn, inHistory, planWaiver, waveWaivers, chainCoverage, leadsTo, exemptFiles, parseRawZ, appendWaiver, appendWaivers, validRecord };
