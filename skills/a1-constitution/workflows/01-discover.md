# Phase 01 — Discover

Goal: turn a vague request ("Constitution for my-project") into a fully scoped
discovery payload ready to feed Alex in Phase 2. Output: vault constitution
file on disk with `status: discovering` and a `discovery_payload.json` cached
in a tmp file for Phase 2.

## Inputs you need before starting

- Project slug (e.g. `my-project`, `my-platform`)
- Repo root (absolute path on disk) — needed for CLAUDE.md scan + later mirror
- 3-5 project-specific behavioral concerns from the user (interview)

Max 3 user-facing questions, one per turn.

## Step 1 — Determine project slug

If the user named a project, derive the slug:
- "my-project" → `my-project`
- "my-platform" / "platform" → `my-platform`
- "a1-specforge" → `a1-specforge`

If unclear, ask the user:
> "Which project should the constitution be built for? (slug, e.g. `my-project`, `my-platform`)"

## Step 2 — Determine repo root

Default mapping (verify via Bash before using):

| Slug | Default repo root |
|---|---|
| `my-project` | `/path/to/my-project` |
| `my-platform` | `/path/to/my-platform` |
| `a1-specforge` | `/path/to/a1-specforge` |

Verify:
```bash
ls -d <candidate-path> 2>&1
```

If ambiguous or missing, ask the user:
> "Where is the repo located locally? (absolute path, e.g. `/path/to/<slug>`)"

## Step 3 — Check preconditions and existing state

Run the CLI discover command:
```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution discover <project-slug> \
  --project-path "<repo-root>"
```

Parse the JSON. Check three things:

1. **CLAUDE.md missing?** If `claudemd_present: false` → soft-block. Tell the user:
   > "CLAUDE.md is missing at `<repo-root>/CLAUDE.md`. Constitution requires CLAUDE.md
   > as its data counterpart. Please create it first from
   > `~/.claude/templates/CLAUDE.md.template`, then try again."

   Stop. Do not init the vault file.

2. **Vault constitution already exists?** Check
   `ls "<vault-root>/projects/<slug>/constitution/constitution.md"`. If yes:
   - Read its frontmatter (via Read tool, just to inspect — do NOT modify).
   - If `status` is `written`: ask the user:
     > "A constitution for `<slug>` already exists (version <N>, last written <date>).
     > Would you like to start a new version? (yes = current will be archived in
     > `history/`, then re-init / no = cancel)"
     If yes: run `archive-current` (this also bumps version in the live file)
     and continue with init. Note: re-init will fail if the live file still
     exists, so we delete the live file after archiving:
     ```bash
     node ~/.claude/skills/_shared/a1-tools.cjs constitution archive-current <slug>
     rm "<vault-root>/projects/<slug>/constitution/constitution.md"
     ```
     Then proceed to Step 4.
   - If `status` is `discovering`, `drafted`, or `reviewed`: do NOT init. Tell
     the user and offer to resume that phase instead.
   - If `status` is `cancelled`: tell the user and ask them to clean up manually
     (move or delete the cancelled file).

3. **Repo constitution.md already exists but no vault file?** That is a drift.
   Tell the user: "The repo already has a `constitution.md`, but no vault version
   exists. Should I import the vault version from the repo (manual step — please
   review the content) or start from scratch and overwrite the repo mirror later?"
   — wait for decision.

## Step 4 — Initialize the vault file

```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution init <project-slug> \
  --title "Constitution for <project-slug>"
```

Returns JSON with the absolute vault path. Capture it as `CONST_PATH`.

## Step 5 — Behavioral-rules interview (3 questions)

Now collect project-specific behavioral concerns. These become the "Project
Behavioral Rules" section in the constitution. Ask **one question per turn**,
max 3 questions total. Suggested:

1. > "What are 2-3 project-wide rules that are not in the global rules?
   >  (e.g. RLS required everywhere, no hotfix without PR review, migrations always
   >  in a dedicated PR, ...)"

2. > "Are there agent roles that are **restricted** in this project?
   >  (e.g. 'Walter may not deploy here, only build locally', 'Aik does no RAG
   >  experiments in production code', ...)"

3. > "What is the most important convention a new agent must know in 30 seconds
   >  before touching any code?"

Capture answers verbatim. They go into the Alex brief in Phase 2.

## Step 6 — Stash discovery payload for Phase 2

Write a tmp JSON file with everything Alex needs. Use `Write` tool to a path
like `/tmp/a1-const-<slug>-<timestamp>.json`. Schema:

```json
{
  "project": "<slug>",
  "repo_root": "<abs>",
  "vault_path": "<CONST_PATH>",
  "discovery": {
    "claudemd_path": "...",
    "claudemd_excerpt": "...",
    "global_rules": ["common/coding-style.md", "common/agents.md", ...],
    "has_link_to_constitution": false,
    "repo_constitution_present": false
  },
  "interview": {
    "project_rules": "<verbatim Q1 answer>",
    "agent_restrictions": "<verbatim Q2 answer>",
    "key_convention": "<verbatim Q3 answer>"
  }
}
```

Capture the tmp path as `DISCOVERY_PAYLOAD_PATH`.

## Step 7 — Confirm and route to Phase 2

Tell the user:
> "Discovery complete. Vault file: `projects/<slug>/constitution/constitution.md`
>  (status: discovering). Global rules captured: <N>, CLAUDE.md read, interview done.
>
>  Should I start Phase 2? Alex (a1-alex-architekt) will receive the discovery output
>  and draft the constitution."

If yes: proceed to `02-draft.md`. Do NOT auto-update status — the status moves
to `drafted` only AFTER Alex returns successfully in Phase 2.

## Special exits

- **User cancels in Phase 1:**
  ```bash
  node ~/.claude/skills/_shared/a1-tools.cjs constitution update-status \
    "<CONST_PATH>" cancelled
  ```
  Tell the user: "Constitution cancelled before Draft. Status set to cancelled.
  Vault file is kept for audit. Please clean up manually before the next run."

- **CLI-Error in `init` (file already exists):** that means there's a leftover
  file the routing in Step 3 missed. Tell the user what is broken and offer to
  help clean up — but do not edit any files without explicit confirmation.
