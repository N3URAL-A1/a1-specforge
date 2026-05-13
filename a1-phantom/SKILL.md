---
name: a1-phantom
description: >
  Phantom-Task detection for GSD-style PLAN.md files. Identifies completed
  `[X]` checkbox tasks that have no corresponding code-change in the repo's
  git history — i.e. the box was ticked but nothing actually shipped. Pure
  warning-level: never blocks, always returns 0, the report is informational.
  Tasks tagged inline with `# no-code` (docs-only, manual ops, etc.) are
  skipped. MUST trigger when the user says: "phantom check", "phantom-task
  detection", "a1-phantom", "prüfe PLAN auf phantom tasks", "check completed
  tasks have code", "verify work was done", or when an upstream verifier
  (e.g. phase-verifier) asks for phantom detection as part of phase
  verification. Do NOT activate for: full goal verification (phase-verifier
  owns that), code review (reinhard), or anti-pattern scans of source files
  (a1-analyze / phase-verifier Step 7).
allowed-tools:
  - Bash
  - Read
---

# a1-phantom — Phantom-Task Detection

Thin Markdown wrapper around the deterministic CLI:
`_shared/a1-tools.cjs phantom check`. The CLI parses a PLAN.md, extracts every
completed task, builds a keyword set, and confirms each task has at least one
match in the git diff since the plan was last touched. Tasks without a match
are reported as phantoms.

## When to use

- A GSD phase claims to be done — verify no checkboxes were ticked
  without corresponding code.
- phase-verifier Step 6.5 (phantom detection): the verifier shells out to this
  CLI and folds the report into its VERIFICATION.md.
- Manual sanity check before a phase hand-off, PR, or release.

Do NOT use as a hard quality gate. It is a heuristic. False positives are
possible (very abstract task wording, refactors that touch unrelated
identifiers); false negatives are possible (a task that name-drops a file
that was touched for unrelated reasons). The signal is "look at this human",
not "block the merge".

## CLI contract

```bash
node ~/.claude/skills/_shared/a1-tools.cjs phantom check <plan-path> \
  [--repo-path <abs>] \
  [--since <git-ref>] \
  [--format json|human]
```

| Flag | Default | Purpose |
|---|---|---|
| `--repo-path` | walks up from plan-path until a `.git` is found | repo root used for `git diff` |
| `--since` | parent of the commit that last modified PLAN.md (fallback `HEAD~20`) | left side of the diff range |
| `--format` | `json` | `human` prints a German summary |

Exit code is **always 0** (warning-level). The presence of phantoms is
encoded in the `status` field (`clean` | `phantoms_found`) and the
`phantoms[]` array.

Debug helper:

```bash
node _shared/a1-tools.cjs phantom list-tasks <plan-path>
```

Lists every checkbox row with line number, `completed`, `no_code`, and the
raw text — useful when a task is unexpectedly flagged or skipped.

## `# no-code` tag

Tasks that legitimately have no code footprint (writing docs, sending an
email, manual ops) should be tagged inline:

```markdown
- [X] Send release announcement to #eng-announce # no-code
- [X] Update wiki page describing the new endpoint # no-code
```

These tasks are reported under `docs_only_skipped` and never produce a
phantom finding. Place the tag at the **end of the same line**.

## Heuristik

For each `[X]` task without `# no-code`:

1. Extract two keyword sets from the task text:
   - **strong:** tokens in backticks (paths, identifiers) and
     code-shaped identifiers (camelCase, snake_case, kebab-case, dotted
     paths) of at least 4 characters.
   - **weak:** plain words of at least 5 characters, minus a stop-word
     list (the, with, update, create, task, file, ...).
2. Collect `git diff <since>..HEAD --name-only` and the full diff body.
3. Match rule:
   - One **strong** token found in changed filenames OR diff body → MATCH.
   - Otherwise: at least **two distinct weak** tokens found in diff body
     → MATCH.
   - Otherwise: **PHANTOM**.

If the task has no extractable keywords, it is reported as a phantom with
reason "no extractable keywords" so the human can either reword the task
or mark it `# no-code`.

## Output shape

```json
{
  "plan": "/abs/path/PLAN.md",
  "repo_path": "/abs/repo",
  "since": "abcd1234",
  "total_completed": 12,
  "docs_only_skipped": [{ "task": "...", "line": 23 }],
  "phantoms": [
    {
      "task": "Implement `validateInput` in `src/util.ts`",
      "line": 17,
      "keywords": ["validateInput", "src/util.ts"],
      "reason": "no match in changed files or diff body"
    }
  ],
  "status": "phantoms_found"
}
```

## Hand-offs

- `status: clean` → report "Keine Phantoms gefunden" and return to caller.
- `status: phantoms_found` → list each phantom (line + task + reason),
  suggest the human either:
  - implement the missing code,
  - revert the checkbox to `[ ]`, or
  - add `# no-code` if it is genuinely docs-only.

Never auto-edit PLAN.md from this skill. Never invoke a sub-agent. The
caller decides next steps.

## Caller integration: phase-verifier

When phase-verifier runs phase verification, it can insert a Phantom
Detection step between Requirements Coverage (Step 6) and Anti-Pattern Scan
(Step 7) by shelling out:

```bash
PHANTOM_JSON=$(node ~/.claude/skills/_shared/a1-tools.cjs phantom check \
  "$PHASE_DIR"/*-PLAN.md --format json)
echo "$PHANTOM_JSON" | jq '.phantoms | length'
```

The phantom array can be folded into the verifier's anti-pattern table as a
new "Phantom Task" severity ⚠️ Warning (never 🛑 Blocker — heuristic).

## Workflow

See `workflows/01-check.md`.

## Hard rules

- Read-only. Never edit PLAN.md or any file in the repo under test.
- No LLM calls. The CLI is the authority; the workflow file only translates
  output for the user.
- User-facing output (summary lines, fix suggestion) in **German**.
  CLI `--format human` already produces German — pass it through.
- Exit code from the CLI is always 0. The skill must NOT treat
  `phantoms_found` as an error.
