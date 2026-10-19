'use strict';

// ---------------------------------------------------------------------------
// xprov-hook-merge — the PreToolUse Bash decision of the plugin hook: `gh pr merge` and `gh api .../pulls/<n>/merge` run only when the
// merge check of the PR diff gate says so (spec 016 wave 10, Samuel W10-1). The check itself is code (xprov-pr-merge.cjs); this module is
// the enforcement point that does not depend on the skill text being followed.
//
//   decideMerge(payload, deps?) -> { action: 'allow' } | { action: 'deny', reason, detail }
//
// What the hook resolves (merges are often run from the primary checkout, not from the review worktree):
//   1. The command: a segment (split on ; & | and newline) whose first word is `gh` (or a shell/eval/xargs running such text) with `pr merge`, or
//      `gh api` naming `/pulls/<n>/merge`. Anything else is allowed at once and untouched (no git, no gh, no node work).
//   2. The repository: `payload.cwd` -> `git rev-parse --show-toplevel`. Not a git repository: allow (no a1 context).
//   3. The permit context, from the same lookup the gate uses (`permitCheck`): state `absent` or `denied` = Reinhard-only = allow, so
//      merges in repositories that never joined xprov are untouched. Every other state (allowed, a voided permit, a broken store) is a
//      context where the merge check decides.
//   4. The PR: a number or URL in the command, else `gh pr view [<arg>] --json number,headRefOid,headRefName` from the repository
//      (the current branch's PR when no argument is given). `--repo`/`-R` names another repository: deny (the check needs this checkout).
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
const PR_NUMBER_RE = /^[1-9]\d{0,8}$/;
const PR_URL_RE = /\/pull\/([1-9]\d{0,8})(?:[/?#].*)?$/;
const API_MERGE_RE = /\/pulls\/([1-9]\d{0,8})\/merge(?:\b|$)/;
const WRAPPERS = Object.freeze(['bash', 'sh', 'zsh', 'eval', 'xargs', 'env', 'command', 'exec', 'time', 'nohup', 'sudo']);
const SKIP_REF = /^refs\/heads\//;
const A1_TOOLS = path.join(__dirname, '..', 'a1-tools.cjs');

const allow = () => Object.freeze({ action: 'allow' });
const deny = (reason, detail) => Object.freeze({ action: 'deny', reason, detail });

/** Normalised words of one command segment: quotes and backslashes dropped (the same view the deny hook of the repo takes). */
const wordsOf = (segment) => segment.replace(/\\\r?\n/g, '').replace(/\\/g, '').replace(/["']/g, '').trim().split(/\s+/).filter(Boolean);

/** { pr: number|null, arg: string|null, repoFlag: boolean } for a merge command, else null. Pure. */
function parseMerge(command) {
  const text = String(command || '');
  if (text.length > MAX_COMMAND_CHARS) return { pr: null, arg: null, repoFlag: false, oversize: true };
  if (!/\bgh\b/.test(text) || !/\b(merge|pulls)\b/.test(text)) return null;
  for (const segment of text.split(/[;&|\n\r]+/)) {
    let w = wordsOf(segment);
    while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w = w.slice(1);
    if (w.length === 0) continue;
    const first = path.basename(w[0]);
    if (WRAPPERS.includes(first)) { // `bash -c "gh pr merge 5"`, `eval ...`, `xargs gh pr merge`: the wrapped text is judged as a whole
      const m = parseMerge(w.slice(1).join(' ').replace(/^-c\s+/, ''));
      if (m !== null) return m;
      continue;
    }
    if (first !== 'gh') continue;
    const rest = w.slice(1);
    const repoFlag = rest.some((t) => t === '-R' || t === '--repo' || t.startsWith('--repo=') || (t.startsWith('-R') && t.length > 2));
    const pr = rest.indexOf('pr');
    if (pr >= 0 && rest[pr + 1] === 'merge') {
      const args = rest.slice(pr + 2).filter((t) => !t.startsWith('-'));
      const arg = args.length ? args[0] : null;
      const num = arg === null ? null : PR_NUMBER_RE.test(arg) ? Number(arg) : (PR_URL_RE.exec(arg) || [])[1];
      return { pr: num === undefined || num === null ? null : Number(num), arg, repoFlag };
    }
    const api = rest.indexOf('api');
    if (api >= 0) {
      const hit = rest.slice(api + 1).map((t) => API_MERGE_RE.exec(t)).find(Boolean);
      if (hit) return { pr: Number(hit[1]), arg: String(hit[1]), repoFlag };
    }
  }
  return null;
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
  if (m.arg !== null && m.arg !== undefined && !m.arg.startsWith('-')) args.push(m.arg);
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
    let m;
    try { m = parseMerge(input && input.command); } catch (_e) { // an unreadable command must not stop every Bash call: only a merge-looking one is denied
      return /\bgh\b[\s\S]*\bmerge\b/.test(String(input && input.command)) ? deny('merge_unreadable', 'the command looks like a merge but cannot be parsed') : allow();
    }
    if (m === null) return allow();
    if (m.oversize) return deny('merge_unreadable', 'the command is too long to judge');
    const cwd = typeof payload.cwd === 'string' && payload.cwd.startsWith('/') ? payload.cwd : process.cwd();
    const root = topLevel(cwd);
    if (root === null || reinhardOnly(root, d)) return allow();
    if (m.repoFlag) return deny('merge_other_repo', 'the merge names another repository (--repo / -R); run it from that repository\'s own checkout so the PR diff gate can judge it');
    const pr = prFacts(root, m);
    if (pr === null) return deny('merge_pr_unresolved', 'the pull request could not be read from GitHub (gh pr view); the PR diff gate cannot judge the merge');
    if (m.pr !== null && m.pr !== pr.number) return deny('merge_pr_unresolved', 'gh pr view answered another pull request than the command names');
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

module.exports = { parseMerge, decideMerge, reinhardOnly };
