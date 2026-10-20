'use strict';

// ---------------------------------------------------------------------------
// xprov-pr-merge — the merge block of a1-pr-review (spec 016 wave 10; Addition and preconditions 1-4). A code check, not skill text:
//
//   xprov gate --gate pr-diff-xprov --work-path <abs worktree> --merge-check [--pr <n>] [--base <remote base sha>]
//
// Exit 0 = the merge may go ahead, exit 1 = blocked (stdout JSON: ok, blocked[{reason, detail}], pr_body[], covered_by[]). Read-only: no runner
// call, no write. It computes everything itself from git and the remote, independent of PLAN.md, `deferred_to_pr` and `--spec`:
//   1. No permit / denied repository: ok, Reinhard-only, unchanged.
//   2. The anchor is the remote base (gh pr view / ls-remote). A local `origin/<default>` or `<default>` that differs from it blocks the merge
//      (`local_ref_differs`). With --pr the PR's head on GitHub must be the local HEAD (`pr_head_mismatch`): the reviewed commit is the merged one.
//   3. Surface comes from `merge-base(remote base, head)..head`. No surface: ok. Surface: a pr-diff-xprov result for exactly this head is
//      required (xprov-pr-cover.cjs): a pass, dispositions, an owner waiver, or a decline with an owner No recorded by the consent hook.
//      `codex_blocked_fallback` never counts (`blocked_fallback_not_accepted`); a decline without the owner No does not count
//      (`secret_declined_without_owner_no`). Both are named in `pr_body` and `owner_question` so the owner sees them.
// ---------------------------------------------------------------------------

const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const WV = require('./xprov-waivers.cjs');
const PD = require('./xprov-pr-diff.cjs');
const PC = require('./xprov-pr-cover.cjs');

const VOIDED_STATES = Object.freeze(['origin_changed', 'unbound_legacy']);
const blockedOf = (reason, detail) => Object.freeze({ reason, detail });

/** The merge check: a frozen report. Typed input errors (exit 2) for bad arguments. `deps`: { root, enforcement, permitFor }. */
function mergeCheck(o, deps) {
  const a = PD.argsOf({ workPath: o.workPath, base: o.base, pr: o.pr }, deps.root);
  const gate = X.GATE_IDS.PR_DIFF;
  const head = { ok: true, gate, mode: 'merge-check', enforcement: deps.enforcement, blocked: [], pr_body: [], covered_by: [] };
  const np = deps.permitFor(deps.root, gate);
  // Only `absent` and `denied` are Reinhard-only. A voided permit (origin_changed, unbound_legacy) is the owner's repository with a permit that
  // lost its binding: a surface diff blocks and the owner is told (W10-2, like W5-4).
  const voided = np.notApplicable && VOIDED_STATES.includes(np.permit.state);
  if (np.notApplicable && !voided) return Object.freeze({ ...head, placement: 'not_applicable', permit_state: np.permit.state, detail: 'no permit or denied: Reinhard-only review, the merge check does not apply' });
  if (!np.permit.ok && !voided) return Object.freeze({ ...head, ok: false, permit_state: np.permit.state, blocked: [blockedOf('permit', np.permit.detail || 'the permit state is not usable')] });
  const t = PD.target(a, deps.root);
  if (!t.ok) return Object.freeze({ ...head, ok: false, blocked: [blockedOf(t.reason, t.detail)] });
  const blocked = [];
  for (const p of t.localProblems) blocked.push(blockedOf('local_ref_differs', `${p.ref} is ${PD.short(p.local)} but the remote base is ${PD.short(t.remoteBase)}; run git fetch origin and sync the local branch, then check again`));
  if (t.prHead !== null && t.prHead !== t.head) blocked.push(blockedOf('pr_head_mismatch', `the PR head on GitHub is ${PD.short(t.prHead)} but the work path HEAD is ${PD.short(t.head)}; push or reset so the reviewed commit is the merged one`));
  const report = { ...head, head: t.head, remote_base: t.remoteBase, base_source: t.source, merge_base: t.mergeBase, surface: t.cls.surface, docs_only: t.cls.docsOnly, lane: t.lane };
  if (!t.cls.surface) return Object.freeze({ ...report, ok: blocked.length === 0, blocked, placement: 'no_surface' });
  if (voided) {
    const b = blockedOf('permit_voided', `the permit of this repository is ${np.permit.state}: Codex cannot review the surface diff. ask the owner to consent again in the chat or to approve a chat waiver for this head`);
    return Object.freeze({ ...report, ok: false, blocked: [...blocked, b], pr_body: [`permit_voided: ${b.detail}`], owner_question: true, permit_state: np.permit.state });
  }
  const index = C.readIndex(C.reviewDirOf(a.workPath, false) + '/xreview/index.json');
  if (index === null) return Object.freeze({ ...report, ok: false, blocked: [...blocked, blockedOf('pr_merge_blocked', 'xreview/index.json is unparseable')] });
  const links = PC.linksOf(index, deps.root, WV.readWaivers(), C.commonDirOf(deps.root));
  const chain = PC.cover(links, t.head, t.mergeBase, t.workPath, PC.acceptMerge);
  if (chain !== null) return Object.freeze({ ...report, ok: blocked.length === 0, blocked, covered_by: chain.map((l) => l.kind) });
  const extra = [];
  if (PC.cover(links, t.head, t.mergeBase, t.workPath, (l) => l.kind === PC.KINDS.FALLBACK) !== null) {
    extra.push(blockedOf('blocked_fallback_not_accepted', 'Codex answered BLOCKED twice; on a surface diff that is not a review result (diff content can prompt Codex into BLOCKED). Ask the owner for a waiver'));
  }
  if (PC.cover(links, t.head, t.mergeBase, t.workPath, (l) => l.kind === PC.KINDS.DECLINED && l.ownerNo !== true) !== null) {
    extra.push(blockedOf('secret_declined_without_owner_no', 'the allowlist question was declined without an owner No recorded by the consent hook; put the question to the owner and record the decline again'));
  }
  const why = extra.length ? extra : [blockedOf('pr_merge_blocked', `the PR diff touches security surface and the xreview index holds no pr-diff-xprov result (pass, dispositions or owner waiver) for head ${PD.short(t.head)}`)];
  return Object.freeze({ ...report, ok: false, blocked: [...blocked, ...why], pr_body: extra.map((b) => `${b.reason}: ${b.detail}`), owner_question: extra.length > 0 });
}

/** CLI entry: prints the report, exit 0 / 1. */
function cmdMergeCheck(o) {
  const r = mergeCheck(o, { root: require('./io.cjs').repoRoot(), enforcement: o.enforcement, permitFor: o.permitFor });
  process.stderr.write(r.ok ? `xprov gate pr-diff-xprov merge-check: ok${r.covered_by.length ? ` (${r.covered_by.join(', ')})` : ''}\n` : `xprov gate pr-diff-xprov merge-check: BLOCKED — ${r.blocked.map((b) => b.reason).join(', ')}\n`);
  return C.emitJson(r, r.ok ? X.EXIT_PASS : X.EXIT_FAIL);
}

module.exports = { mergeCheck, cmdMergeCheck };
