# Phase 2 — Review (a1-reinhard-reviewer sub-agent)

Goal: run a structured code review via `a1-reinhard-reviewer`. Output:
`<worktree>/.a1-review/findings.json` with BLOCKER / MAJOR / MINOR
arrays.

## Inputs (from Phase 1)

- `repo_root` (the main checkout, NOT the worktree)
- `worktree_path` (the isolated checkout a1-reinhard-reviewer reads)
- `branch` (the feature branch)
- `phase_history` (last entry, used as scope hint)

## Steps

### 2.1 Compute diff range

Determine the base branch (default `main`; allow override if registry
entry has `base`). Then:

```bash
git -C "<worktree_path>" rev-parse --abbrev-ref HEAD
git -C "<worktree_path>" log --oneline main..HEAD
git -C "<worktree_path>" diff --stat main...HEAD
```

If `main..HEAD` is empty: BLOCKER, no commits to review. Abort.

### 2.2 Spawn a1-reinhard-reviewer via Agent tool

Use the `Agent` tool with `subagent_type: "a1-reinhard-reviewer"`. The brief MUST
include:

```
Worktree path: <worktree_path>
Branch: <branch>
Diff range: main...HEAD (run from worktree_path)
Last phase note: <last phase_history entry, if any>

Deliverable: review findings ONLY as a single JSON block at the end of
your response, fenced with ```json. Schema:

{
  "summary": "<one-paragraph English summary>",
  "blocker": [{"file": "...", "line": 42, "title": "...", "detail": "..."}],
  "major":   [{"file": "...", "line": 42, "title": "...", "detail": "..."}],
  "minor":   [{"file": "...", "line": 42, "title": "...", "detail": "..."}]
}

Focus areas: security, immutability, multi-tenant correctness, error
handling, input validation. Use the project's CLAUDE.md and rules as the
review baseline.
```

Wait for a1-reinhard-reviewer's response.

### 2.2b Cross-provider PR diff review (`pr-diff-xprov`, spec 016 wave 10)

Start this in the SAME turn as the 2.2 `Agent` call, so Codex and Reinhard review in parallel. a1-pr-review is the ONLY place a PR diff reaches
Codex: `a1-new-feature` (05-implement) and `a1-fix` never call `xprov gate`; they hand the worktree over. This step is the security boundary behind every
plan and wave `scope_exempt`: it reviews the real diff `merge-base(remote base, head)..head` once per head sha.

```bash
git -C "<worktree_path>" fetch origin
mkdir -p "<worktree_path>/.a1-review"
node <repo>/_shared/a1-tools.cjs xprov gate --gate pr-diff-xprov --work-path "<worktree_path>" [--base <remote base sha>] [--pr <n>] [--spec <spec path from the hand-off>] > "<worktree_path>/.a1-review/xprov-gate.last-run.json"; RC=$?
echo "xprov gate pr-diff-xprov exit=$RC"
```

`--base` is optional and only an expectation (the sha the remote reports; the gate resolves the real base itself: `gh pr view --json baseRefOid` with `--pr`, else
`git ls-remote origin`). `--spec` is the spec path the hand-off names (a1-new-feature `06-verify.md` passes it); it can exempt only a diff without security
surface, never a surface diff. Without `--spec` only a docs-only diff is exempt. The same head sha again reuses the stored pass (zero runner calls); a new head
sha sends only the commits since the covered head. The stdout field `pr` names `head`, `lane`, `runner_base`, `remote_base`, `merge_base` and `surface`.

| Result | What to do |
|---|---|
| `pass` (also `reused: true`) | Codex found no BLOCKER or MAJOR. Continue; the stored result is the one the merge check accepts. |
| `fail-with-findings` | Read the findings (`findings_path`). BLOCKER and MAJOR follow the rule of 2.6: fix them, commit, run this step again (a new head sha sends only the new commits). |
| `not_applicable`, `reason: scope_exempt` (exit 1) | Docs-only, empty, or size-S spec without surface: nothing was sent, nothing was written. Print `ℹ Codex PR review not applicable (scope_exempt); Reinhard-only.` and continue. |
| `not_applicable`, `reason: external_review_not_permitted` (exit 1) | No permit. Ask once per run, only when you can ask the owner (not headless, not CI, not a subagent): `xprov consent question --kind consent --run "<worktree_path>"`, put the printed question with AskUserQuestion exactly as printed, then `xprov consent record --kind consent`; on `decision: yes` repeat the gate call. A No, no answer or no chat: print `ℹ No Codex permit and no chat to ask: Reinhard-only review.` and continue. The question is refused a second time in the same run. |
| `not_applicable`, `reason: external_review_denied` | The owner denied external review: continue Reinhard-only. |
| `not_applicable`, `reason: codex_blocked_fallback` | Codex answered BLOCKED twice. On a security-surface diff this is NOT a review result: the merge check refuses it. Put it into the PR body ("Codex review blocked") and ask the owner for a waiver (Step 2.2c). |
| `fail`, `reason: secret_in_snapshot` | A secret-shaped string is in a changed line. Ask the allowlist question for the scan (`xprov consent question --kind allowlist --scan <scan_record>`). A Yes allows a repeat of the gate call. A No or no answer: `xprov dispose --phase pr-review --gate pr-diff-xprov --wave 0 --lane <pr.lane> --work-path "<worktree_path>" --base <pr.runner_base> --secret-declined <scan_record>`; the merge check counts that only with the owner No the hook recorded, otherwise the merge stays blocked and the owner is told (Step 2.2c). |
| `fail`, any other reason (`tripwire`, `quarantined`, `secret_in_output`, `pr_anchor_unavailable`, `pr_base_mismatch`, `round_cap`, …) | A stop. Do not retry it by re-running the gate. Report the reason in the PR body. On a surface diff the merge check blocks until a pass, dispositions or an owner waiver exists for this head sha. |

Never run a terminal-only owner command (`xprov permit`, `xprov waive`, `xprov allowlist approve`) and never write `.a1/xprov.json` or `~/.a1-xprov/`. An intent run
(headless child) allows no `xprov gate`, `xprov consent` or `xprov dispose` call: a refusal by the sandbox (exit 77) is final, take the Reinhard-only branch.

### 2.2c Owner waiver for a PR diff (only when the merge check blocks)

When 2.7 blocks and the owner may accept the risk: report what failed first, then `xprov consent question --kind waiver --work-path "<worktree_path>"`,
put it with AskUserQuestion exactly as printed, then `xprov consent ensure --kind waiver --work-path "<worktree_path>"` and `xprov consent waive --work-path "<worktree_path>"`
(the same flow as a1-plan `04b-xprov-review.md` Step 5, keyed to the head sha). A blocked fallback is named in that question and in the PR body.

### 2.3 Extract JSON block

Parse the fenced ```json block from a1-reinhard-reviewer's response. If parsing
fails, tell the user and re-prompt a1-reinhard-reviewer with a stricter
"JSON only, no prose" directive (max one retry).

### 2.4 Persist findings

Write ONE `findings.json` to `<worktree_path>/.a1-review/findings.json` (atomic: write to `.tmp`, then `mv`) holding the findings of both reviewers.
Every finding carries a `source` field: `"reinhard"` for a finding from 2.3, `"codex"` for a finding from the `findings_path` file of 2.2b (when 2.2b ran).
The arrays stay `blocker`, `major`, `minor`, so `pr findings-summary` counts both sources. BLOCKER and MAJOR of either source follow the same
fix-then-merge rule. Findings of the two reviewers that name the same file and line are listed once with `"source": "reinhard+codex"`.

### 2.5 Update registry status

```bash
node <repo>/_shared/a1-tools.cjs pr mark-status <id> reviewed
```

### 2.6 Report to user

Show counts: "Reinhard reviewed: X BLOCKER, Y MAJOR, Z MINOR." Then:

- If BLOCKER count > 0: list each BLOCKER (title + file:line). Ask
  the user explicitly:
  > "There are BLOCKERs. Draft the PR anyway (Phase 3), or fix them
  > in the worktree first?"

  - Answer "anyway" / "continue" → Phase 3.
  - Answer "fix first" / "stop" → exit skill. User edits worktree, re-
    runs Phase 2 later.

- If only MAJOR/MINOR or zero findings: proceed to Phase 3 automatically.

### 2.7 Merge check (code, before `gh pr merge`)

Immediately before the merge (Phase 4 hand-off), after the final push and after `git fetch origin`:

```bash
node <repo>/_shared/a1-tools.cjs xprov gate --gate pr-diff-xprov --work-path "<worktree_path>" --pr <n> --merge-check; RC=$?
echo "xprov merge-check exit=$RC"
```

Merge only on exit 0. Any other exit means no merge: exit 1 = blocked, exit 2 = refused arguments or an unusable setup (fix the call, do not retry blind), exit 77 = refused by the intent sandbox. The plugin Bash hook enforces it: with merge intent it allows exactly ONE command, run as the only command of the Bash call from the PR's worktree or the primary checkout: `gh pr merge <number> [--squash|--merge|--rebase] [--delete-branch|-d] [--match-head-commit <40-hex sha>]`. No `cd`, env prefix, wrapper, grouping, `--repo`/`-R`, other flags, `gh api` or GraphQL merge: those are denied with a hint. The canonical form runs the check above itself and is allowed only when it exits 0 (a repository without a permit is not affected). PR bodies are passed with `--body-file <path>`, never inline in a command that also says `merge`. Exit 1 detail follows. The stdout `blocked[]` names why (`pr_merge_blocked`: no pass, dispositions or owner waiver for this head sha on a
security-surface diff; `local_ref_differs`: sync the local `origin/<default>` and `<default>` with the remote; `pr_head_mismatch`: push so the reviewed commit is the merged one;
`blocked_fallback_not_accepted`, `secret_declined_without_owner_no`, `permit_voided`: ask the owner, Step 2.2c). Run 2.2b again for a new head sha. No permit or a denied repository: the check
returns `ok` (Reinhard-only, unchanged). The check reads git and the remote itself; PLAN.md, `deferred_to_pr` and `--spec` do not influence it.
`deferred_to_pr` waves from `xprov wave-status` and any `pr_body` lines of the check go into the PR body (Phase 3).

## Failure modes

- Reinhard returns no JSON → one retry, then escalate to user.
- Reinhard times out → tell user, do not change registry status.
- Empty diff → BLOCKER, halt.
- `xprov gate --gate pr-diff-xprov` unreachable or refused by the sandbox → Reinhard-only; on a security-surface diff the merge check (2.7) still blocks the merge.
