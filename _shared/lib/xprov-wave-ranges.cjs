'use strict';

// ---------------------------------------------------------------------------
// xprov wave ranges — spec 016 Wave 7 (FR-020), Samuel wave 7 WP2-a; plan decision of 2026-10-16.
//
// `xprov wave-status --wave-range <n>=<base>..<head>,…` is written by the agent. Everything an agent writes can be wrong, so a wave exemption
// built on it needs anchors the agent cannot steer: git objects. `verify` checks that the ranges
//   - name commits that exist, with base an ancestor of head and base != head (an empty range proves nothing),
//   - cover every completed wave and tile: the head of one wave leads to the base of the next (equal, or an ancestor with only the workflow's own
//     files in between: leadsTo of xprov-waivers.cjs),
//   - end at the work path's tip (same rule),
//   - start where the branch leaves the default branch: `git merge-base <default branch> <tip>` leads to the first base (same rule).
// Any mismatch refuses ALL exemptions (fail closed) with a named reason. The default branch is the first of refs/remotes/origin/{main,master},
// refs/heads/{main,master} that resolves. Pure given the repository; no write.
// ---------------------------------------------------------------------------

const C = require('./xprov-common.cjs');
const WV = require('./xprov-waivers.cjs');

const DEFAULT_BRANCH_REFS = Object.freeze(['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']);

const bad = (reason, detail) => Object.freeze({ ok: false, reason, detail });

function resolveCommit(workPath, rev) {
  const out = C.gitOut(['-C', workPath, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return out === null ? null : out.trim();
}

/** The merge-base of the default branch and `tip`, or null. */
function anchorOf(workPath, tip) {
  for (const ref of DEFAULT_BRANCH_REFS) {
    const def = resolveCommit(workPath, ref);
    if (def === null) continue;
    const mb = C.gitOut(['-C', workPath, 'merge-base', def, tip]);
    return mb === null ? null : mb.trim();
  }
  return null;
}

/**
 * `o`: { workPath, phase, ranges (Map wave -> { base, head }), waves (completed wave numbers) }.
 * Returns { ok: true, ranges: Map wave -> { base, head } (full shas) } or { ok: false, reason, detail }.
 */
function verify(o) {
  const order = [...new Set(o.waves)].sort((a, b) => a - b);
  const rs = [];
  for (const w of order) {
    const r = o.ranges.get(w);
    if (r === undefined) return bad('range_missing', `wave ${w} has no --wave-range entry`);
    const base = resolveCommit(o.workPath, r.base);
    const head = resolveCommit(o.workPath, r.head);
    if (base === null || head === null) return bad('range_unresolvable', `wave ${w}: ${C.clip(r.base, 12)}..${C.clip(r.head, 12)} is not a pair of commits of this repository`);
    if (base === head) return bad('range_empty', `wave ${w}: base and head are the same commit`);
    if (!WV.inHistory(o.workPath, base, head)) return bad('range_not_ancestor', `wave ${w}: base is not an ancestor of head`);
    rs.push(Object.freeze({ wave: w, base, head }));
  }
  for (let i = 1; i < rs.length; i++) {
    if (!WV.leadsTo(o.workPath, rs[i - 1].head, rs[i].base, o.phase)) return bad('range_gap', `wave ${rs[i - 1].wave} does not lead to wave ${rs[i].wave}: commits between them are not the workflow's own files`);
  }
  const tip = resolveCommit(o.workPath, 'HEAD');
  if (tip === null) return bad('range_tip', 'HEAD does not resolve');
  if (!WV.leadsTo(o.workPath, rs[rs.length - 1].head, tip, o.phase)) return bad('range_tip', `the last wave (${rs[rs.length - 1].wave}) does not end at the work path's tip`);
  const anchor = anchorOf(o.workPath, tip);
  if (anchor === null) return bad('range_anchor', 'no default branch (origin/main, origin/master, main, master) to anchor the first wave');
  if (!WV.leadsTo(o.workPath, anchor, rs[0].base, o.phase)) return bad('range_anchor', `the first wave (${rs[0].wave}) does not start where the branch leaves the default branch`);
  return Object.freeze({ ok: true, ranges: new Map(rs.map((r) => [r.wave, r])) });
}

module.exports = { DEFAULT_BRANCH_REFS, anchorOf, verify };
