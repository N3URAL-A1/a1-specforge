# Phase 02 — Diagnose (Root Cause by Falk)

Goal: turn `status: reported` into `status: diagnosed` by identifying the most
likely root cause with file:line evidence and a confidence level. Output: the
`## Diagnosis` section of the bug report is filled, `recommended_code_agent` is
set in frontmatter.

## Inputs

- Vault path to the bug-report file
- Bug-report frontmatter must be in `status: reported`

If status is not `reported`, abort and explain to the user which phase
is actually next based on the current status.

## Step 1 — Read the bug report and the project

1. Read the bug-report file (Read tool, full content).
2. Identify `affected_repos` in frontmatter. For each repo:
   - Read its `CLAUDE.md` (project root) to learn structure and Agent Workflow table.
   - Note recent commits with `git log --oneline -20` in the repo.
3. If reproduction steps point at specific routes, files, or services: use
   Glob and Grep to find them. **Do not** read entire files end-to-end; targeted
   reads only.

## Step 2 — Spawn Falk for diagnosis

Use the `Task` tool to spawn Falk (`~/.claude/agents/a1-falk-fault-finder.md`) with this brief:

> You are Falk in diagnosis mode. Task: derive the most likely root cause from
> the bug report and back it with evidence. Never fix, never commit, never write
> files outside the bug report.
>
> **Vault path to bug report:** <ABSOLUTE_PATH>
> **Affected Repos:** <list>
> **Symptom + Repro Steps:** (in the file)
>
> **Approach:**
> 1. Read the bug report, internalize symptom + reproduction steps.
> 2. Follow the stack trace if present — Glob/Grep, not full-file reads.
> 3. Check git log of affected files in the suspected window
>    (`related_deploy` as anchor).
> 3b. **Sibling-site sweep (root vs. symptom).** Once you locate the broken
>     site, grep for sibling sites that do the same job: other write paths
>     (`INSERT INTO <table>`, `create<Entity>`, `update<Entity>`), other
>     consumers of the same route/field, the read/JOIN that loads it, the
>     detail renderer. A bug that shows up on ONE record/screen is often a
>     class: the fix belongs at the shared root, not the instance. If the
>     symptom is "data is wrong on this invoice/page", confirm whether the
>     other creation/render paths have the same gap BEFORE recommending a
>     one-spot fix. Name the full set of affected sites in the diagnosis.
> 4. Formulate a hypothesis with:
>    - **Root Cause** (one statement of what is actually broken)
>    - **Evidence** (file:line references, log excerpts, commit hashes)
>    - **Confidence** (low / medium / high) — explicitly justified
>    - **Recommended code agent** (a1-walter-web-developer / bernd / aik / toni / felix / alex),
>      based on the stack of the affected repo
>    - **Suggested fix approach** (one paragraph, no code)
>
> **Hard Rules:**
> - Never guess without evidence. If no evidence: "Confidence low,
>   further reproduction needed" and stop.
> - If the most likely hypothesis only partially explains the symptom:
>   say so explicitly, do not paper over it.
>
> Output: complete diagnosis block (Markdown) in the format of the `## Diagnosis`
> section of the bug report template, plus a recommendation on whether to start
> Phase 03.

## Step 3 — Update the bug report

When Falk returns:

1. Use the Edit tool to replace the `## Diagnosis (Phase 02 — filled by Falk)`
   block in the bug report with Falk's filled-in content.
2. Run the CLI to flip status and set the recommended agent:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" diagnosed \
  --recommended-code-agent <agent-name>
```

This appends `phase=diagnose completed=<iso>` to phase_history and sets
`recommended_code_agent` atomically.

## Step 4 — Hand off

Tell the user:

> "Diagnosis complete. Root Cause: <one-line summary>. Confidence: <level>.
> Suggested code agent: **<agent>**. Should I start Phase 3 (Fix)?"

If yes: proceed to `03-fix.md`.
If no: stop. State persists.

## Special exits from Phase 02

- **Confidence too low to proceed:** Falk says diagnosis is unsafe. Do NOT flip
  status to `diagnosed`. Tell the user that more reproduction data is needed
  and recommend extending Phase 1 with additional logging or scenarios.
- **Discovery: it's a duplicate:** if Falk's diagnosis points to a known earlier
  bug, run
  `a1-tools fix update-status <bug-path> duplicate --duplicate-of <path-to-original>`
  and stop.
- **Discovery: it's intended behaviour (wont-fix):** flip status to `wont-fix`
  with a note explaining why; surface to user before flipping.
