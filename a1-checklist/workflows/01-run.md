# Run Checklist — Pre-Flight Readiness Gate

**Goal:** Run the 8 deterministic readiness checks for a feature's wave-plan
and translate the structured result into a user-facing report with a
concrete next-step suggestion.

**Sub-agent:** none. All logic is in the CLI.

## Step 1 — Collect input

You need ONE value: a target string in either form:

- `<project-slug>/<feature-id>` — exact, e.g. `my-project/003-login` or `my-project/003`
- `<project-slug>` only — latest spec is auto-resolved

If the user did not provide a target, ask **one** question:

> "Which feature should the pre-flight checklist run for?
> (project slug or slug/feature-id, e.g. `my-project/003-login`)"

Do not enumerate features from disk unless the user explicitly asks.

## Step 2 — Run the gate

Use the **Bash** tool to call the CLI in human format:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs checklist run <target> --format human
```

Capture stdout AND the exit code. Stdout already contains the report;
the exit code drives what comes next.

If the user explicitly asked you to save the audit trail, add `--save`:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs checklist run <target> --format human --save
```

If a vault override is needed (`$A1_VAULT_ROOT` not set, or user gave
`--vault <path>`), forward it. Default is `~/N3URAL-Vault`.

## Step 3 — Branch on exit code

### Exit 0 — PASS or PASS_WITH_WARNINGS

Show the user the stdout verbatim. Then re-run the CLI with
`--format json` to read the structured `status` field:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs checklist run <target> --format json
```

Parse the JSON.

- If `status == "PASS"`:
  > "All green. The wave plan is ready for implementation. Would you like to
  > start the implementation now?"

- If `status == "PASS_WITH_WARNINGS"`:
  List the failed MAJOR/MINOR checks (from `.checks[]` where
  `result == "FAIL"`), then:
  > "The plan is essentially ready for implementation, but there are
  > {N} MAJOR and {M} MINOR notes. Should I address these before starting,
  > or begin implementation directly?"

### Exit 1 — FAIL (one or more BLOCKER)

Show the user the stdout verbatim. Re-run with `--format json`,
parse, find the failed BLOCKER checks (`severity == "BLOCKER"` AND
`result == "FAIL"`).

Map each failed BLOCKER to a fix-path suggestion:

| Failed Check | Suggestion |
|---|---|
| `spec_status_clarified` | "The spec is not yet in status `clarified`. Should I trigger `a1-rene-requirement-engineer` to clarify it?" |
| `wave_plan_exists` | "There is no wave plan under `projects/<slug>/plans/`. Should I trigger `a1-vincente-vibe-optimizer` to create the plan — or start `a1-new-feature` Phase 4?" |
| `wave_dependencies_dag` | "The wave dependencies contain a cycle. This must be resolved manually — would you like me to trigger `a1-vincente-vibe-optimizer` for a plan revision?" |

Then stop. Do not auto-trigger the suggested agent — wait for user consent.

### Exit 2 — ERROR (setup)

Show the user the stdout verbatim. Then:

> "The checklist could not run because artifacts are missing or the
> frontmatter is not parseable. Please check and repair the listed paths,
> then call it again."

Stop. Do not propose any agent re-entry — the problem is below that level.

## Hard rules for this workflow

- Never edit any file from this workflow. The gate is read-only.
- Always pass `--format human` first for user display, then re-run with
  `--format json` only when you need the structured fields to drive the
  follow-up question.
- Never combine multiple gate invocations in one command line. One target
  per run.
- If the user provided a `--vault <path>` override (or `$A1_VAULT_ROOT`
  is set), forward it.

## When this workflow ends

- After PASS confirmation and user decision on implementation start, or
- After FAIL with the user's decision on whether to invoke a fix-path
  agent, or
- After ERROR with the user acknowledging the setup issue.

The skill does not maintain state between invocations.

## Retro (mandatory, every run)

After every run — PASS, PASS_WITH_WARNINGS, FAIL, or ERROR — write one
structured entry. Takes 2 minutes. Do not skip.

**To local cache:**
```bash
cat >> ~/.claude/skills/a1-checklist/_learning.md <<'EOF'
---
date: <YYYY-MM-DD>
task: pre-flight checklist for <feature-target>
project: <project-slug>
result: <pass|pass_with_warnings|fail|error>
issues: [<relevant tags: spec-not-clarified, missing-wave-plan, dep-cycle, missing-claude-md, frontmatter-incomplete, setup-error, ...>]
what_worked: <one sentence — e.g. "all 8 checks passed first try">
one_line_learning: <what would have prevented the failed check, or "no issues">
EOF
```

**To Vault:**
Append the same entry to:
`~/N3URAL-Vault/pattern/a1-learnings/a1-checklist.md`

A run with no issues is still useful data — write the entry.
