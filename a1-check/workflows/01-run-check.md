# Run Check — Consistency Gate (manual invocation)

**Goal:** Run the deterministic spec ↔ wave-plan consistency check for one
feature and present the result to the user with a concrete fix-path
suggestion when needed.

**Sub-agent:** none. All logic is in the CLI.

## Step 1 — Collect inputs

You need two values:

- `<project-slug>` — the Obsidian Vault project folder name
- `<feature>` — the feature id in the form `<###>-<feature-slug>` (e.g. `001-login`)

If the user did not provide both, ask **one** question for the missing one.
Do not ask both at once. Example:

> "Which project should the consistency check run for?"

Do not infer the feature id from filesystem listings unless the user
explicitly asks you to list features. The check is cheap; ambiguity is the
real cost.

## Step 2 — Run the gate

Use the **Bash** tool to call the CLI in human-format mode:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs check <project-slug> \
  --feature <feature> --format human
```

Capture both stdout and the exit code. Stdout already contains the report;
the exit code drives what comes next.

## Step 3 — Branch on exit code

### Exit 0 — PASS

Show the user the stdout verbatim, then:

> "Spec and wave-plan are consistent. You can start Phase 5 (Implement)."

Stop. No further action.

### Exit 1 — FAIL (content inconsistency)

Show the user the stdout verbatim. Then re-run the CLI with
`--format json` to read the structured diff:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs check <project-slug> \
  --feature <feature> --format json
```

Parse the JSON. Pick the fix-path suggestion from the table below based on
which diff fields are non-empty (multiple may apply — list all that match).

| Diff field | Suggestion |
|---|---|
| `diffs.missing_in_plan` not empty | "Some FRs are missing from the waves. Should I restart `a1-new-feature` Phase 4 (Plan) so the wave plan can be revised?" |
| `diffs.duplicated_in_plan` not empty | "One or more FRs appear in multiple waves. Should I start `a1-new-feature` Phase 4 to fix the wave assignment?" |
| `diffs.phantom_in_plan` not empty | "The wave plan references FR-IDs that don't exist in the spec. Would you like to restart Phase 3 (Clarify) to add the missing FRs — or remove the phantom references directly from the plan?" |
| `checks.frontmatter_link == "FAIL"` | "The plan frontmatter points to the wrong spec. Should I correct the `spec_path` in the plan frontmatter directly?" |

If the user says **yes** to a suggestion: invoke the named action (e.g.
trigger `a1-new-feature` for the same project/feature; it will route into the
right phase based on spec status). If the user says **no** or wants to fix it
themselves, stop and let them work.

### Exit 2 — ERROR (setup)

Show the user the stdout verbatim. Then:

> "The gate could not run the check because artifacts are incomplete.
> Please create the missing file or repair the frontmatter, then call it again."

Stop. Do not propose `a1-new-feature` re-entry — the problem is below that level.

## Hard rules for this workflow

- Never edit any file from this workflow. The gate is read-only.
- Always pass `--format human` first for user display, then re-run with
  `--format json` only when you need to drive the fix-path suggestion.
- Never combine multiple gate invocations in one command line. One project +
  one feature per run.
- If the user provided a `--vault <path>` override (or the env var
  `A1_VAULT_ROOT` is set), forward it; otherwise the CLI defaults to
  `~/N3URAL-Vault`.

## When this workflow ends

- After PASS confirmation, or
- After FAIL with the user's decision on whether to re-enter `a1-new-feature`, or
- After ERROR with the user acknowledging the setup issue.

The skill does not maintain state between invocations.

## Retro (mandatory, every run)

After every run — PASS, FAIL, or ERROR — write one structured entry. Takes 2
minutes. Do not skip.

**To local cache:**
```bash
cat >> ~/.claude/skills/a1-check/_learning.md <<'EOF'
---
date: <YYYY-MM-DD>
task: spec ↔ wave-plan consistency check for <feature>
project: <project-slug>
result: <pass|fail|error>
issues: [<relevant tags: missing-fr-in-plan, duplicated-fr, phantom-fr, frontmatter-link-broken, file-missing, frontmatter-unparseable, ...>]
what_worked: <one sentence — e.g. "PASS first run, plan and spec aligned">
one_line_learning: <what would have prevented the FAIL/ERROR, or "no issues">
EOF
```

**To Vault:**
Append the same entry to:
`~/N3URAL-Vault/pattern/a1-learnings/a1-check.md`

A run with no issues is still useful data — write the entry.
