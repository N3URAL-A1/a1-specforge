# Phase 03 — Fix (Code Agent)

Goal: turn `status: diagnosed` into `status: fixing` while a project code agent
implements the fix, then record `fix_commit` once the commit lands. The skill
itself does NOT write code in this phase — it briefs the code agent and tracks
state.

## Inputs

- Vault path to the bug-report file (status must be `diagnosed`)
- `recommended_code_agent` set in frontmatter

## Step 1 — Read context

1. Read the bug report (full content).
2. Note `severity`, `affected_repos`, `recommended_code_agent`, and the
   `## Diagnosis` section (Confidence + Suggested fix approach).
3. If `severity` is `blocker` or `major`: a regression test BEFORE the fix is
   strongly recommended (so we have a red test that turns green).

## Step 1.5 — Scope-Clarify Gate (reasoning-tier, mandatory for UI changes)

**When to run:** Run this gate if the diagnosis involves ANY of:
- Adding or removing table columns, buttons, links, or form fields
- New UI component or screen section
- Changing an existing page layout or form
- A "fix" whose scope touches more than one isolated code path

**When to skip:** Pure logic bugs (wrong value, crash, null-pointer, wrong HTTP method,
type error) with no UI surface — skip directly to Step 2.

**How to run (model: the pinned reasoning-tier model):**

Read the diagnosis and the affected UI surface, then ask the user up to
**3 questions** — only the ones that could cause a rework loop if answered wrong.
Pick from this catalogue the most relevant ones for this fix:

| Probe category | Example question |
|---|---|
| **In / Out — elements** | "The table currently has columns [X, Y, Z]. Which should stay, which should go?" |
| **Surrounding actions** | "Next to the new button there are [Delete / Receipt]. Do they stay, or does one go too?" |
| **State after save/action** | "After the user saves — do they stay on the page or go back to the list?" |
| **Empty / error state** | "What should happen when [no entry / API error]?" |
| **Permissions / visibility** | "Should this be visible to all tenant users or only the owner?" |
| **Mobile vs Desktop** | "Does this apply to the desktop table, the mobile view, or both?" |

Format the questions as a concise numbered list. Wait for answers before dispatching
the code agent. Incorporate answers into the code agent brief in Step 3.

If the user says "just do it" or waves the question away: use sensible defaults,
document the defaults in the bug report `## Notes` section, and proceed.

## Step 2 — Propose the code agent dispatch

Tell the user, summarizing the brief that would go to the agent:

> "Phase 3 — Fix. Proposal:
>
> - **Code agent:** <agent-name>
> - **Severity:** <severity> → <"Regression test recommended first" if ≥ MAJOR, else "Test optional">
> - **Bug report:** `<vault-path>`
> - **Affected repos:** <repos>
> - **Diagnosis confidence:** <level>
> - **Fix approach (from diagnosis):** <one-line summary>
>
> Should I dispatch `<agent-name>` with this brief, or would you like a
> different agent / take over manually?"

If the user confirms a different agent: use that one. If the user wants to fix
manually: skip Step 3, jump to Step 4 once they have a commit hash.

## Step 3 — Spawn the code agent

Flip status to `fixing` BEFORE spawning, so the bug-report reflects the active
work:

```bash
node <repo>/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" fixing
```

Spawn the code agent via the `Agent` tool with this brief:

> **Task:** Bug fix following diagnosis.
>
> **Bug report (single source of truth):** <ABSOLUTE_VAULT_PATH>
>   → Read the file fully. Symptom, repro steps, diagnosis, confidence,
>   and suggested fix approach are all in there.
>
> **Affected Repos:** <list with concrete files from Diagnosis>
>
> **Severity:** <severity>
>   → If ≥ MAJOR: write a regression test FIRST that reproduces the symptom
>   (red). Then fix. The test must turn green.
>
> **Hard Rules:**
> - Do NOT manually edit the bug report frontmatter — the skill handles that.
> - Commit message: `fix(<scope>): <one-line> — <bug-report-filename>`
> - After the commit: report the commit hash back to the skill.
>
> **Expected output:** Commit hash + one-sentence description of what changed
> + confirmation that the reproduction steps no longer apply (or explanation
> of why the diagnosis needs to be extended).

## Step 4 — Record the fix commit

When the agent (or the user) returns with a commit hash:

```bash
node <repo>/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" fixing \
  --fix-commit <commit-hash>
```

Status stays `fixing` — the transition to `fixed` only happens after Phase 4
verifies the symptom is gone. Setting `fix_commit` while still in `fixing`
preserves the audit trail.

Also use the Edit tool to fill the `## Fix Plan (Phase 03 — filled by code agent)`
section in the bug report with the agent's summary (approach, files, regression
test path, risk).

## Step 5 — Hand off

Tell the user:

> "Fix commit recorded: `<hash>`. Status stays `fixing` until Phase 4
> confirms the symptom is gone. Should I start Phase 4 (Verify)?"

If yes: proceed to `04-verify.md`.

## Special exits from Phase 03

- **Code agent reports the diagnosis was wrong / incomplete:** do NOT set
  fix_commit. Run
  `a1-tools fix update-status <bug-path> reported`
  and offer to re-run Phase 2 with the new evidence in `## Notes`.
- **User cancels mid-fix:** run
  `a1-tools fix update-status <bug-path> cancelled`. Slot stays.
