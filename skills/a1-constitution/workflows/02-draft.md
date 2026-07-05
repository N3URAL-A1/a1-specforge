# Phase 02 — Draft

Goal: dispatch Alex (a1-alex-architekt) to generate the constitution body
from the discovery payload, then write the body atomically into the vault
file and transition status to `drafted`.

## Preconditions

- Phase 1 completed successfully.
- `DISCOVERY_PAYLOAD_PATH` is a tmp JSON file with project, repo_root,
  vault_path, discovery{}, interview{}.
- `CONST_PATH` is the absolute vault path to the constitution file (status
  `discovering`).

If preconditions missing, route back to `01-discover.md`.

## Step 1 — Construct Alex's brief

Read `DISCOVERY_PAYLOAD_PATH`. Also read the constitution template:
`~/.claude/skills/a1-constitution/templates/constitution-template.md`.

Construct the brief by filling `templates/alex-brief-template.md` with:
- `<PROJECT_SLUG>` — from payload
- `<REPO_ROOT>` — from payload
- `<CLAUDEMD_EXCERPT>` — from payload.discovery.claudemd_excerpt
- `<GLOBAL_RULES_LIST>` — formatted list of payload.discovery.global_rules
- `<USER_PROJECT_RULES>` — payload.interview.project_rules
- `<USER_AGENT_RESTRICTIONS>` — payload.interview.agent_restrictions
- `<USER_KEY_CONVENTION>` — payload.interview.key_convention
- `<TEMPLATE_SKELETON>` — verbatim content of `constitution-template.md`

## Step 2 — Dispatch Alex via the Task tool

Use the `Task` tool with:
- **subagent_type:** `a1-alex-architekt`
- **description:** "Draft constitution.md body for <slug>"
- **prompt:** the fully populated brief from Step 1

Alex is read-only with respect to project code. He returns Markdown only.

## Step 3 — Validate Alex's output

Alex's response should be a Markdown document with these top-level sections
(verify by simple string-contains):

- `# Constitution`  (or `# Constitution for <slug>`)
- `## Override Precedence`  (the 4-Layer section)
- `## Project Behavioral Rules`
- `## Agent-Specific Constraints` (may be empty if no Q2 input)
- `## Key Convention` (may be a short single-rule section from Q3)

If any required section is missing, **re-ask Alex ONCE** with a follow-up:
> "Your response did not contain the section `<missing-section>`.
>  Please provide the complete Markdown document with ALL four required
>  sections again."

If the second attempt also fails: surface the issue to the user
("Alex did not return a complete constitution Markdown — would you like to see
the output and adjust it manually?") and stop. Do NOT advance status.

The response must NOT contain a YAML frontmatter block (no `---` at start) —
frontmatter stays under skill control. If it does, strip it before saving.

## Step 4 — Persist the body atomically via CLI

Write Alex's validated Markdown to a tmp file:
```bash
# Write tool: /tmp/a1-const-body-<slug>-<timestamp>.md
```

Then push it into the vault file via the helper:
```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution set-body \
  "<CONST_PATH>" \
  --body-file "/tmp/a1-const-body-<slug>-<timestamp>.md"
```

`set-body` preserves frontmatter and atomically replaces the body.

## Step 5 — Transition status to `drafted`

```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution update-status \
  "<CONST_PATH>" drafted
```

This appends a `phase=draft completed=<iso>` entry to `phase_history`.

## Step 6 — Confirm and route to Phase 3

Tell the user:
> "Draft complete. Alex has formulated <N> behavioral rules and the 4-layer
>  override precedence. Status: `drafted`.
>
>  Should I start Phase 3? You will see the draft and can request changes
>  before we write it."

If yes: proceed to `03-review.md`.

## Special exits

- **Alex returns prose explaining why he can't draft:** surface his text to
  the user. Most common cause: discovery payload is too thin (CLAUDE.md empty,
  no interview answers). Re-enter Phase 1 to fill gaps, do not advance status.

- **CLI `set-body` fails (e.g. body-file unreadable):** surface error, do not
  advance status. Status stays at `discovering`.

- **User cancels in Phase 2:**
  ```bash
  node ~/.claude/skills/_shared/a1-tools.cjs constitution update-status \
    "<CONST_PATH>" cancelled
  ```
