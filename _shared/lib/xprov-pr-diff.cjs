'use strict';

// ---------------------------------------------------------------------------
// xprov-pr-diff — the target of the `pr-diff-xprov` gate (spec 016 wave 10; FR-017, FR-018, FR-021; Addition and preconditions 1, 3).
//
//   xprov gate --gate pr-diff-xprov --work-path <abs worktree> [--base <remote base sha>] [--pr <number>] [--spec <relative .md>] [--timeout S]
//
// The PR diff is reviewed ONCE per head sha, next to Reinhard, and it is the security boundary behind every plan and wave exemption
// (placement is a cost optimisation, this gate is the boundary). Everything the exemption depends on comes from here, in code:
//   - The anchor is the REMOTE base, never a local ref: `gh pr view <n> --json baseRefOid` (with --pr), else `git ls-remote --symref origin HEAD`
//     at gate time. Local `origin/<default>` and `<default>` are agent-settable; the diff is `merge-base(remote base, head)..head` whatever
//     they say, and a local ref that differs from the remote is reported (the merge check blocks on it). Wave 8's base recomputation
//     (local refs, `remote.origin.url`) is never used here (xprov-recover.cjs skips it for this gate).
//   - `--base` is only an EXPECTATION the skill passes (the sha it read from the remote): a different value than the one resolved here
//     is `pr_base_mismatch`. `--spec` names a spec (relative .md path) whose `size:` can exempt a diff WITHOUT security surface; it never
//     exempts a surface diff. Without it only a docs-only (or empty) diff is exempt.
//   - Target key = head sha: lane `pr<12 hex of the head>`, wave 0, state under `<work-path>/.a1-review/xreview/`. A new head reviews only the
//     commits since the newest covered head (the stored pass chain, xprov-pr-cover.cjs); the same head reuses the stored pass, zero runner calls.
//   - The "plan" the runner gets is a brief a1 writes to `<work-path>/.a1-review/PLAN.md`: head, base and merge-base shas, the spec path. No text
//     from the agent but a validated path; its sha256 is the binding the run record carries. `.a1-review/` is untracked state; the snapshot
//     is a clone of the committed head and never contains it.
// Request-scoped; the clock, git and gh are the only outside inputs. Throws typed input errors (exit 2) for bad arguments, before any write.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const io = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const SC = require('./xprov-scope.cjs');
const PL = require('./xprov-placement.cjs');
const WV = require('./xprov-waivers.cjs');
const PF = require('./xprov-preflight.cjs');
const PC = require('./xprov-pr-cover.cjs');

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const PR_NUMBER_RE = /^[1-9]\d{0,8}$/;
const SPEC_REF_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.md$/;
const SPEC_REF_MAX_CHARS = 300;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const EXTERNAL_TIMEOUT_MS = 30000;
const BRIEF_FILE = 'PLAN.md';
const SIZE_S = 'S';
const SKILL = 'a1-pr-review';

const short = (sha) => String(sha).slice(0, 12);
const ownerGit = (args) => C.gitSpawn(args, { env: C.ownerGitEnv(), timeout: EXTERNAL_TIMEOUT_MS });
const gitLine = (args) => { const r = ownerGit(args); return r.status === 0 ? r.stdout.trim() : null; };

// ---------- arguments ----------

/** Validated arguments of the gate or the merge check: { workPath, expectBase, spec, pr } — typed input errors, nothing written. */
function argsOf(o, root) {
  if (typeof o.workPath !== 'string' || o.workPath === '') throw C.inputError('pr-diff-xprov requires --work-path <absolute worktree path>', 'work_path');
  const workPath = C.realWorkPath(o.workPath);
  if (C.commonDirOf(workPath) !== C.commonDirOf(root)) throw C.inputError(`--work-path ${C.clip(workPath, 200)} does not share the git-common-dir of the repository`, 'work_path_foreign');
  if (o.base !== undefined && !SHA_RE.test(String(o.base))) throw C.inputError(`--base must be a full commit sha (40 hex), got ${JSON.stringify(C.clip(o.base, 80))}`, 'bad_base');
  if (o.spec !== undefined) {
    const s = String(o.spec);
    if (s.length > SPEC_REF_MAX_CHARS || !SPEC_REF_RE.test(s) || s.split('/').includes('..') || s.includes('//')) throw C.inputError(`--spec must be a relative .md path of at most ${SPEC_REF_MAX_CHARS} characters without \`..\`, got ${JSON.stringify(C.clip(s, 80))}`, 'bad_spec');
  }
  if (o.pr !== undefined && !PR_NUMBER_RE.test(String(o.pr))) throw C.inputError(`--pr must be a pull request number, got ${JSON.stringify(C.clip(o.pr, 40))}`, 'bad_pr');
  return Object.freeze({ workPath, expectBase: o.base === undefined ? null : String(o.base), spec: o.spec === undefined ? null : String(o.spec), pr: o.pr === undefined ? null : String(o.pr) });
}

// ---------- the anchor: the remote base ----------

const unavailable = (detail) => Object.freeze({ ok: false, detail });

/** `gh pr view <n> --json baseRefOid,baseRefName,headRefOid` from the work path: { ok, base, branch, prHead, source } or { ok: false, detail }. */
function ghAnchor(a) {
  const gh = PF.resolveTool('gh');
  if (gh === null) return unavailable('gh is not on PATH; the PR base cannot be read from GitHub');
  const r = spawnSync(gh, ['pr', 'view', a.pr, '--json', 'baseRefOid,baseRefName,headRefOid'], { cwd: a.workPath, encoding: 'utf8', timeout: EXTERNAL_TIMEOUT_MS, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  if (r.status !== 0) return unavailable(`gh pr view ${a.pr} failed: ${C.clip((r.stderr || '').trim(), 200)}`);
  let j = null;
  try { j = JSON.parse(r.stdout); } catch (_e) { j = null; }
  if (!C.isPlainObject(j) || !SHA_RE.test(String(j.baseRefOid)) || !SHA_RE.test(String(j.headRefOid)) || !BRANCH_RE.test(String(j.baseRefName))) return unavailable('gh pr view answered off-format');
  return Object.freeze({ ok: true, base: j.baseRefOid, branch: j.baseRefName, prHead: j.headRefOid, source: 'gh' });
}

/** `git ls-remote --symref origin HEAD`: the remote's default branch and its tip. Trusts `remote.origin.url` (documented residual, ADR). */
function lsRemoteAnchor(a) {
  const r = ownerGit(['-C', a.workPath, 'ls-remote', '--symref', 'origin', 'HEAD']);
  if (r.status !== 0) return unavailable(`git ls-remote origin failed: ${C.clip(r.stderr, 200)}`);
  const ref = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(r.stdout);
  const tip = /^([0-9a-f]{40}(?:[0-9a-f]{24})?)\tHEAD$/m.exec(r.stdout);
  if (ref === null || tip === null || !BRANCH_RE.test(ref[1])) return unavailable('git ls-remote answered no default branch and tip');
  return Object.freeze({ ok: true, base: tip[1], branch: ref[1], prHead: null, source: 'ls-remote' });
}

/** The commit must be in the local object store: an object is self-verifying, so fetching it by sha from any remote cannot forge it. */
function ensureObject(workPath, sha, branch) {
  const has = () => ownerGit(['-C', workPath, 'cat-file', '-e', `${sha}^{commit}`]).status === 0;
  if (has()) return true;
  ownerGit(['-C', workPath, 'fetch', '--quiet', '--no-write-fetch-head', 'origin', sha]);
  if (has()) return true;
  ownerGit(['-C', workPath, 'fetch', '--quiet', '--no-write-fetch-head', 'origin', branch]);
  return has();
}

/** Local refs that were MOVED away from the remote base: [{ ref, local }] (shas only). A ref that merely lags (an ancestor of the remote
 * base) is stale, not forged: the diff never uses it, so it is no stop (W10-3). The merge check blocks on a non-empty list. */
function localRefProblems(workPath, branch, base) {
  const out = [];
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    const sha = gitLine(['-C', workPath, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (sha === null || sha === base) continue;
    if (ownerGit(['-C', workPath, 'merge-base', '--is-ancestor', sha, base]).status === 0) continue;
    out.push(Object.freeze({ ref, local: sha }));
  }
  return Object.freeze(out);
}

/** { surface, docsOnly, total } of `mergeBase..head`; git cannot say = surface (guarded). */
function classifyDiff(workPath, mergeBase, head) {
  try {
    const c = SC.classifyPaths(SC.diffPaths(workPath, mergeBase, head), SC.loadGlobs());
    return Object.freeze({ surface: c.security_surface, docsOnly: c.docs_only, total: c.total });
  } catch (_e) { return Object.freeze({ surface: true, docsOnly: false, total: null }); }
}

/** The PR target: { ok: true, ... } or { ok: false, reason, detail }. Reads git and gh; writes nothing. */
function target(a, root) {
  const h = WV.headIn(a.workPath, C.commonDirOf(root));
  if (h.problem) return Object.freeze({ ok: false, reason: X.REASONS.pr_anchor_unavailable, detail: h.problem });
  const anc = a.pr !== null ? ghAnchor(a) : lsRemoteAnchor(a);
  if (!anc.ok) return Object.freeze({ ok: false, reason: X.REASONS.pr_anchor_unavailable, detail: anc.detail });
  if (a.expectBase !== null && a.expectBase !== anc.base) return Object.freeze({ ok: false, reason: X.REASONS.pr_base_mismatch, detail: `--base ${short(a.expectBase)} is not the remote base ${short(anc.base)} (${anc.source}); use the sha the remote reports` });
  if (!ensureObject(a.workPath, anc.base, anc.branch)) return Object.freeze({ ok: false, reason: X.REASONS.pr_anchor_unavailable, detail: `the remote base ${short(anc.base)} is not in the local object store and could not be fetched` });
  const mergeBase = gitLine(['-C', a.workPath, 'merge-base', anc.base, h.head]);
  if (mergeBase === null || !SHA_RE.test(mergeBase)) return Object.freeze({ ok: false, reason: X.REASONS.pr_anchor_unavailable, detail: `no merge-base of the remote base ${short(anc.base)} and HEAD ${short(h.head)}` });
  return Object.freeze({
    ok: true, workPath: a.workPath, head: h.head, remoteBase: anc.base, branch: anc.branch, source: anc.source, prHead: anc.prHead, mergeBase,
    localProblems: localRefProblems(a.workPath, anc.branch, anc.base), cls: classifyDiff(a.workPath, mergeBase, h.head), lane: PC.laneOf(h.head), spec: a.spec,
  });
}

// ---------- placement ----------

const exempt = (detail) => Object.freeze({ run: false, reason: PL.REASON, detail });
const runs = (detail) => Object.freeze({ run: true, reason: null, detail });

/** { run, reason, detail }: an empty or docs-only diff, or a diff without surface under a size-S spec, is exempt (FR-021). Never a surface diff. */
function placement(t, root) {
  if (t.cls.total === 0) return exempt('the PR diff is empty');
  if (t.cls.docsOnly) return exempt('the PR diff is docs-only');
  if (t.cls.surface) return runs('the PR diff touches security surface');
  if (t.spec !== null && PL.sizeOfSpec(root, t.spec) === SIZE_S) return exempt('spec size S and no security surface in the PR diff');
  return runs(t.spec === null ? 'no --spec: only a docs-only diff is exempt' : 'the spec is not size S');
}

// ---------- brief ----------

function briefText(t, runnerBase) {
  return [
    '# PR diff review (pr-diff-xprov)', '',
    'Review the diff `base..head` of this pull request before it is merged: defects, security problems, missing tests and drift from the spec.',
    'This is a code review of a diff, not a plan.', '',
    `- head: ${t.head}`, `- base: ${runnerBase}`, `- merge-base with the target branch: ${t.mergeBase}`, `- target branch tip: ${t.remoteBase}`,
    `- spec: ${t.spec === null ? 'none' : t.spec}`, `- security surface in the PR diff: ${t.cls.surface ? 'yes' : 'no'}`, '',
  ].join('\n');
}

// ---------- the context the gate driver runs with ----------

/** The newest covered pass head that is an ancestor of `t.head` (FR-018: only the commits since it are sent), else the merge-base. */
function runnerBaseFor(t, links) {
  const passes = links.filter(PC.acceptPass).map((l) => l.head).filter((h, i, all) => h !== t.head && all.indexOf(h) === i && WV.inHistory(t.workPath, h, t.head)
    && PC.cover(links, h, t.mergeBase, t.workPath, PC.acceptPass) !== null);
  let best = null;
  let bestN = -1;
  for (const h of passes) {
    const n = Number(gitLine(['-C', t.workPath, 'rev-list', '--count', `${t.mergeBase}..${h}`]));
    if (Number.isInteger(n) && n > bestN) { best = h; bestN = n; }
  }
  return best === null ? t.mergeBase : best;
}

/**
 * The context `driveGate` runs with, or the same context with `review.failure` when the target cannot be resolved.
 * `o`: the gate flags; `deps`: { root, enforcement, index, store, repo, round, prior, pluginAllowlist, timeout }.
 */
function contextOf(o, deps) {
  const a = argsOf(o, deps.root);
  const t = target(a, deps.root);
  const dir = C.reviewDirOf(a.workPath, false);
  const common = { root: deps.root, phase: C.PR_PHASE, phaseDir: dir, planPath: path.join(dir, BRIEF_FILE), indexPath: path.join(dir, 'xreview', 'index.json'), gate: X.GATE_IDS.PR_DIFF, isPlan: false, mode: 'inspect', wave: 0, lane: null, workPath: a.workPath, enforcement: deps.enforcement, pluginAllowlist: deps.pluginAllowlist, timeout: deps.timeout };
  if (!t.ok) return Object.freeze({ ...common, base: null, round: 1, prior: [], review: Object.freeze({ failure: Object.freeze({ reason: t.reason, detail: t.detail }) }) });
  const index = C.readIndex(common.indexPath);
  if (index === null) throw C.inputError(`index.json unparseable or not an array of objects: ${common.indexPath}`, 'index_unreadable');
  const store = WV.readWaivers();
  const links = PC.linksOf(index, deps.root, store, C.commonDirOf(deps.root));
  const runnerBase = runnerBaseFor(t, links);
  const text = briefText(t, runnerBase);
  const prior = index.filter((e) => e.gate === common.gate && C.sameWave(e, 0) && C.sameLane(e, t.lane) && /^\d+$/.test(String(e.round)));
  const round = deps.round === undefined ? 1 + prior.length : deps.round;
  return Object.freeze({
    ...common, lane: t.lane, base: runnerBase, round, prior,
    review: Object.freeze({
      failure: null, target: t, placed: placement(t, deps.root), links, index, text, planSha: C.sha256(Buffer.from(text, 'utf8')),
      report: Object.freeze({ head: t.head, lane: t.lane, remote_base: t.remoteBase, base_source: t.source, merge_base: t.mergeBase, runner_base: runnerBase, spec: t.spec, surface: t.cls.surface, docs_only: t.cls.docsOnly, local_ref_problems: t.localProblems }),
    }),
  });
}

/** The stored pass for exactly this head (FR-018): a chain of passes from the head down to the merge-base, or null. */
function reusedPass(ctx) {
  const t = ctx.review.target;
  const chain = PC.cover(ctx.review.links, t.head, t.mergeBase, t.workPath, PC.acceptPass);
  if (chain === null) return null;
  const row = ctx.review.index.filter((e) => e.gate === ctx.gate && e.verdict === X.VERDICTS.PASS && typeof e.result_path === 'string' && e.lane === t.lane).pop();
  return row === undefined ? null : row;
}

/** The `.a1-review/` state dir (and xreview/) as plain directories; typed input error for a link or a file in the way. */
function ensureDir(workPath) {
  const dir = C.reviewDirOf(workPath, true);
  const x = path.join(dir, 'xreview');
  let st = null;
  try { st = fs.lstatSync(x); } catch (_e) { st = null; }
  if (st === null) C.mkdir0700(x);
  else if (st.isSymbolicLink() || !st.isDirectory()) throw C.inputError(`${C.clip(x, 200)} is not a plain directory`, 'worktree_invalid');
  return dir;
}

/** Writes the brief the runner reads (and normalize binds): `.a1-review/PLAN.md`. */
function writeBrief(ctx) {
  ensureDir(ctx.workPath);
  io.writeTextAtomic(ctx.planPath, ctx.review.text);
}

module.exports = { SKILL, SHA_RE, argsOf, target, placement, contextOf, reusedPass, ensureDir, writeBrief, briefText, localRefProblems, classifyDiff, short };
