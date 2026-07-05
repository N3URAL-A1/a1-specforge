# Phase 3 — Draft PR

Goal: produce `<worktree>/.a1-review/pr-draft.md` containing PR title
and body in `gh pr create`-compatible format.

## Inputs

- `<worktree>/.a1-review/findings.json` (from Phase 2)
- Commits on branch (from `git log main..HEAD --reverse`)
- Branch name (drives conventional-commit type if commits are mixed)

## Steps

### 3.1 Build PR title

Rules:
- If all commits share the same conventional-commit type+scope → reuse.
- Else → use the most prominent type (priority: feat > fix > refactor >
  perf > docs > test > chore > ci), scope = branch slug.
- Length < 70 chars. Cut + ellipsis if longer.

Format: `<type>(<scope>): <description>` where `<description>` is
derived from the first commit's subject after the type.

### 3.2 Build PR body

Use the `gh pr create` HEREDOC structure. Sections in this order:

```markdown
## Summary

<2-4 bullet points distilled from commit messages and a1-reinhard-reviewer's summary>

## Changes

<bulleted list of commit subjects, in order>

## Review Findings

Reinhard reviewed this branch. <X> BLOCKER, <Y> MAJOR, <Z> MINOR.

### Known Issues (MAJOR)

<one bullet per MAJOR finding: title — file:line. Detail in a quote block.>

<If MAJOR list is empty, omit this section entirely.>

## Test Plan

- [ ] CI passes
- [ ] Manual smoke test on <main feature touched>
- [ ] <any explicit Acceptance Criteria from phase_history, if available>
```

BLOCKER findings are NEVER in the PR body. If the user chose to proceed
despite blockers, add a single line under Summary:
> "Note: <N> BLOCKER findings were acknowledged and deferred."

MINOR findings go into a SEPARATE file
`<worktree>/.a1-review/inline-comments.md` (one bullet per minor,
formatted as `- <file>:<line> — <title>: <detail>`). They are not part
of the PR body.

### 3.3 Use CLI to assemble

```bash
node ~/.claude/skills/_shared/a1-tools.cjs pr findings-summary <id>
```

The CLI returns a structured JSON with `{ counts, major_md,
inline_minor_md, blocker_md }`. Use it to compose `pr-draft.md`.

### 3.4 Write draft

Write `<worktree>/.a1-review/pr-draft.md` containing:

```
TITLE: <pr-title>

---

<pr-body>
```

Atomic write (tmp + rename).

Also write `<worktree>/.a1-review/inline-comments.md` if MINOR findings
exist.

### 3.5 Show draft to user

```
PR draft ready. Title + first 20 lines of body:
<excerpt>

File: <worktree>/.a1-review/pr-draft.md

Should I create the PR now with gh (Phase 4)? (yes / no / adjust draft)
```

- "yes" → Phase 4.
- "no" → stop, registry stays on `reviewed`.
- "adjust draft" → wait for user edits, then ask again.

## Failure modes

- `findings.json` missing → tell user to run Phase 2 first.
- No conventional-commit-style commits → fall back to title `chore(<slug>): <branch-name>` and warn the user.
