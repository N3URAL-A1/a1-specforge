# Phase 03 — Review

Goal: present Alex's draft to the user, capture any change requests, apply them
deterministically, and transition status to `reviewed`. No sub-agent in this
phase — direct dialogue + targeted edits only.

## Preconditions

- Vault file exists with `status: drafted`.
- `CONST_PATH` is set (or recompute from project slug:
  `<vault-root>/projects/<slug>/constitution/constitution.md`).

If status ≠ `drafted`, route to the matching phase based on the routing table
in `SKILL.md`.

## Step 1 — Present the draft

Read the constitution body (skip frontmatter):
```bash
# Use Read tool on CONST_PATH, then display body to the user.
```

Show the user a structured preview:
> "Here is the draft. Please read through it completely:
>
>  ---
>  <full body>
>  ---
>
>  Three possible responses:
>  1) Looks good → I proceed to Phase 4 (Write).
>  2) Small changes → tell me concretely what should change and where.
>  3) Larger rework → I send Alex back with your feedback for a re-draft."

## Step 2 — Capture decision

Wait for the user. Branch:

### 2a — "Looks good"

Proceed to Step 4.

### 2b — Small edits

The user specifies concrete changes (e.g. "Rule 3 needs to be stricter"
or "Override-Precedence table: add an example for each layer").

For each change:
- Read the current body.
- Apply the change with the `Edit` tool **on the vault file directly**.
  Note: this is the ONE phase where direct body edits are allowed because
  they are minor, user-driven, and traceable. Frontmatter is never touched
  by Edit — only via CLI.

After all edits applied: re-show the changed sections to the user for a brief
confirmation ("Does this look right?"). If yes, proceed to Step 4.
If they want more changes, loop within Step 2b.

### 2c — Re-draft

If the user wants a significant rework, write a new tmp file with their feedback:

```json
{
  "previous_body_path": "<CONST_PATH>",
  "user_feedback": "<verbatim>",
  "specific_concerns": ["..."]
}
```

Construct a follow-up brief and re-dispatch Alex with subagent_type
`a1-alex-architekt`, including the previous body and the user's feedback.
Alex returns a revised body. Write it back via `constitution set-body`,
status STAYS at `drafted`, and we loop back to Step 1 (user reviews
the new draft).

Max 2 re-draft cycles before escalating to the user:
> "We are on draft 3. Would you like to take over and edit the constitution
>  directly in the vault file? I can provide the path."

## Step 3 — User cancellation

Anytime the user says "cancel":
```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution update-status \
  "<CONST_PATH>" cancelled
```
Tell the user what happened and stop.

## Step 4 — Transition status to `reviewed`

```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution update-status \
  "<CONST_PATH>" reviewed
```

This appends `phase=review completed=<iso>` to `phase_history`.

## Step 5 — Route to Phase 4

Tell the user:
> "Review complete. Status: `reviewed`. Should I start Phase 4 (Write)?
>  That will: (a) create a history snapshot if needed, (b) write the repo
>  mirror to `<repo-root>/constitution.md`, (c) add a cross-link in CLAUDE.md,
>  (d) set status to `written`."

If yes: proceed to `04-write.md`.

## Hard rules

- Edit-tool may modify the **body** but never the YAML frontmatter.
- After every Edit-tool change, re-read the file before the next Edit to keep
  the in-memory view consistent.
- Re-draft loop max 2 iterations. Beyond that, hand control to the user.
