'use strict';

// ---------------------------------------------------------------------------
// xprov-hook-merge — the PreToolUse Bash decision of the plugin hook: `gh pr merge` and `gh api .../pulls/<n>/merge` run only when the
// merge check of the PR diff gate says so (spec 016 wave 10, Samuel W10-1). The check itself is code (xprov-pr-merge.cjs); this module is
// the enforcement point that does not depend on the skill text being followed.
//
//   decideMerge(payload, deps?) -> { action: 'allow' } | { action: 'deny', reason, detail }
//
// What the hook resolves (merges are often run from the primary checkout, not from the review worktree):
//   1. The command (plan decision 2026-10-19, merge hook parsing: ALLOW ONE CANONICAL FORM instead of recognising merge forms). Merge intent =
//      the text contains `gh` as a word and `merge`, `mergePullRequest` or `enablePullRequestAutoMerge`. With merge intent only ONE command passes
//      to the check: the whole text is exactly `gh pr merge <number> [--squash|--merge|--rebase] [--delete-branch|-d] [--match-head-commit <40 hex>]`
//      (no cd, env assignment, wrapper, grouping, substitution, repo flag or other flag). Everything else is denied with a hint, except a
//      read-only mention: every segment starts with grep, rg, git log, git grep, git show or git diff, and the text has no `$(`, `<(`, `>(`, backtick, `eval`,
//      `bash -c` / `sh -c`. The session `cwd` is the repository of the canonical form (it has no `cd`).
//   2. The repository: the session `payload.cwd` -> `git rev-parse --show-toplevel`. Not a git repository: allow (no a1 context).
//   3. The permit context, from the same lookup the gate uses (`permitCheck`): state `absent` or `denied` = Reinhard-only = allow, so
//      merges in repositories that never joined xprov are untouched. Every other state (allowed, a voided permit, a broken store) is a
//      context where the merge check decides.
//   4. The PR: the number of the canonical form; `gh pr view <n> --json number,headRefOid,headRefName` gives head sha and branch.
//   5. The worktree: `git worktree list --porcelain` of the repository; the one whose branch is the PR's head branch and whose HEAD is the PR's
//      head sha (the primary checkout counts when it has that branch). None: deny with the hint to review from the PR's own worktree.
//   6. The decision: `a1-tools xprov gate --gate pr-diff-xprov --work-path <worktree> --pr <n> --merge-check` as a child with a timeout.
//      Exit 0 allows. Any other exit (1 blocked, 2 usage or refused, 77 sandbox refusal), a spawn error and a timeout deny: fail closed.
// Tier 0: text detection cannot see a merge built from variables, `eval` of assembled text or a merge outside this tool call (the GitHub web
// UI, another machine). The hook stops the agent's direct attempt; branch protection on the remote is the control for the rest.
// ---------------------------------------------------------------------------

const path = require('path');
const { spawnSync } = require('child_process');

const CHECK_TIMEOUT_MS = 90000;
const LOOKUP_TIMEOUT_MS = 30000;
const MAX_COMMAND_CHARS = 100000;
const SKIP_REF = /^refs\/heads\//;
const A1_TOOLS = path.join(__dirname, '..', 'a1-tools.cjs');
const GH_WORD_RE = /(?:^|[^A-Za-z0-9_-])gh(?![A-Za-z0-9_-])/;
const MERGE_WORD_RE = /(?<![\w-])merge(?![\w-])|mergePullRequest|enablePullRequestAutoMerge/; // whole word: not mergedAt, mergeable, merged, merge-base
const CANONICAL_RE = /^gh pr merge ([1-9][0-9]{0,8})((?: --squash| --merge| --rebase| --delete-branch| -d| --match-head-commit [0-9a-f]{40})*)$/;
const READONLY_FIRST = Object.freeze(['grep', 'rg']);
const READONLY_GIT = Object.freeze(['log', 'grep', 'show', 'diff']);
const SUBSTITUTION_RE = /\$\(|<\(|>\(|`|\beval\b|\b(?:bash|sh|zsh)\s+-c\b/;
const CANONICAL_HINT = 'run exactly `gh pr merge <number> [--squash|--merge|--rebase] [--delete-branch|-d] [--match-head-commit <sha>]` as the only command (no cd, env prefix, wrapper, grouping, --repo or other flags), from the PR\'s worktree or the primary checkout';

const allow = () => Object.freeze({ action: 'allow' });
const deny = (reason, detail) => Object.freeze({ action: 'deny', reason, detail });

/** True when every segment starts with a read-only program and the text has no substitution, eval or shell -c: it only prints or searches text. */
function readOnlyMention(text) {
  if (SUBSTITUTION_RE.test(text)) return false;
  const segments = text.split(/[;&|\n\r]+/).map((x) => x.trim()).filter(Boolean);
  return segments.length > 0 && segments.every((seg) => {
    const w = seg.split(/\s+/);
    return READONLY_FIRST.includes(w[0]) || (w[0] === 'git' && READONLY_GIT.includes(w[1]));
  });
}

/**
 * { kind: 'none' } (no merge intent), { kind: 'canonical', pr }, { kind: 'readonly' } or { kind: 'other' } (merge intent in any other shape:
 * denied). Pure; no normalisation of quotes or backslashes: the canonical form is matched byte for byte.
 */
function classify(command) {
  const text = String(command == null ? '' : command);
  if (text.length > MAX_COMMAND_CHARS) return { kind: 'other' };
  if (!GH_WORD_RE.test(text) || !MERGE_WORD_RE.test(text)) return { kind: 'none' };
  const m = CANONICAL_RE.exec(text.trim());
  if (m !== null) return { kind: 'canonical', pr: Number(m[1]) };
  return readOnlyMention(text) ? { kind: 'readonly' } : { kind: 'other' };
}

const run = (cmd, args, cwd, timeout) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });

function topLevel(cwd) {
  const r = run('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], cwd, LOOKUP_TIMEOUT_MS);
  return r.status === 0 ? r.stdout.trim() : null;
}

/** [{ path, head, branch }] of the repository's worktrees. */
function worktrees(root) {
  const r = run('git', ['-C', root, 'worktree', 'list', '--porcelain'], root, LOOKUP_TIMEOUT_MS);
  if (r.status !== 0) return [];
  return r.stdout.split(/\n\n+/).map((block) => {
    const get = (k) => { const l = block.split('\n').find((x) => x.startsWith(`${k} `)); return l ? l.slice(k.length + 1) : null; };
    const ref = get('branch');
    return { path: get('worktree'), head: get('HEAD'), branch: ref && SKIP_REF.test(ref) ? ref.replace(SKIP_REF, '') : null };
  }).filter((x) => x.path && x.head);
}

/** The PR facts from gh: { number, head, branch } or null. */
function prFacts(root, m) {
  const args = ['pr', 'view'];
  args.push(String(m.pr));
  args.push('--json', 'number,headRefOid,headRefName');
  const r = run('gh', args, root, LOOKUP_TIMEOUT_MS);
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    return Number.isInteger(j.number) && /^[0-9a-f]{40,64}$/.test(String(j.headRefOid)) && typeof j.headRefName === 'string'
      ? { number: j.number, head: j.headRefOid, branch: j.headRefName } : null;
  } catch (_e) { return null; }
}

/** True when this repository never joined xprov (state absent) or the owner denied it: Reinhard-only, the merge is not ours to judge. */
function reinhardOnly(root, deps) {
  const { permitCheck, STATES } = deps.permit || require('./xprov-permit.cjs');
  const state = permitCheck({ repoRoot: root }).state;
  return state === STATES.ABSENT || state === STATES.DENIED;
}

function decideMerge(payload, deps) {
  const d = deps || {};
  try {
    const input = payload && payload.tool_input;
    const m = classify(input && input.command);
    if (m.kind === 'none' || m.kind === 'readonly') return allow();
    if (m.kind === 'other') return deny('merge_not_canonical', `a merge is allowed in one form only: ${CANONICAL_HINT}`);
    const cwd = typeof payload.cwd === 'string' && payload.cwd.startsWith('/') ? payload.cwd : process.cwd();
    const root = topLevel(cwd);
    if (root === null || reinhardOnly(root, d)) return allow();
    const pr = prFacts(root, m);
    if (pr === null) return deny('merge_pr_unresolved', 'the pull request could not be read from GitHub (gh pr view); the PR diff gate cannot judge the merge');
    if (m.pr !== pr.number) return deny('merge_pr_unresolved', 'gh pr view answered another pull request than the command names');
    const wt = worktrees(root).find((x) => x.branch === pr.branch && x.head === pr.head);
    if (!wt) return deny('merge_no_worktree', `no worktree of this repository has the PR branch ${pr.branch} at the PR head ${pr.head.slice(0, 12)}; review and merge from the PR's own worktree (a1-pr-review step 2.7) or push so the head matches`);
    const r = (d.spawn || run)(process.execPath, [A1_TOOLS, 'xprov', 'gate', '--gate', 'pr-diff-xprov', '--work-path', wt.path, '--pr', String(pr.number), '--merge-check'], wt.path, CHECK_TIMEOUT_MS);
    if (r.status === 0) return allow();
    let why = '';
    try { why = JSON.parse(r.stdout).blocked.map((b) => b.reason).join(', '); } catch (_e) { why = ''; }
    const how = r.status === null ? 'did not finish (timeout or spawn error)' : `exited ${r.status}`;
    return deny('merge_blocked', `the PR diff merge check ${how}${why ? `: ${why}` : ''}. Merge only after \`xprov gate --gate pr-diff-xprov --merge-check\` exits 0 (a1-pr-review step 2.7); exit 1 = blocked, 2 = refused arguments, 77 = sandbox refusal`);
  } catch (e) {
    return deny('merge_check_failed', `the merge check could not run (${String((e && e.message) || 'error').slice(0, 120)})`);
  }
}

module.exports = { classify, decideMerge, reinhardOnly };
