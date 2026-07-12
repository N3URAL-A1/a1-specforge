---
name: a1-phantom
description: >
  Phantom-Task detection for a1-style PLAN.md files. Identifies completed
  `[X]` checkbox tasks that have NO corresponding code-change in the repo's
  git history — i.e. the box was ticked but nothing actually shipped.
  Warning-level only: never blocks, always exits 0, report is informational.
  Tasks tagged `# no-code` (docs-only, manual ops) are skipped.
  MUST trigger when the user says: "phantom check", "phantom-task detection",
  "a1-phantom", "check PLAN for phantom tasks" (alias: "prüfe PLAN auf phantom
  tasks"), "was this actually built" (alias: "wurde das wirklich gebaut"), "was
  all of this really done" (alias: "wurde das alles wirklich gemacht"), "check
  completed tasks have code", "verify work was done", "check for false successes"
  (alias: "scheinerfolge prüfen"), "were all boxes ticked rightfully" (alias:
  "wurden alle haken zu recht gesetzt"), or when an upstream verifier (e.g.
  a1-victor-verifier) requests phantom detection as part of phase verification.
  Do NOT activate for: full goal verification (a1-victor-verifier owns that), code
  review (a1-reinhard-reviewer), spec-drift (a1-reconcile), or anti-pattern
  scans of source files (a1-analyze).
allowed-tools:
  - Bash
  - Read
---

# a1-phantom — Phantom-Task Detection

Language: English-first; German trigger aliases supported.

Thin Markdown wrapper around the deterministic CLI:
`_shared/a1-tools.cjs phantom check`. The CLI parses a PLAN.md, extracts every
completed task, builds a keyword set, and confirms each task has at least one
match in the git diff since the plan was last touched. Tasks without a match
are reported as phantoms.

## When to use

- An a1 phase claims to be done — verify no checkboxes were ticked
  without corresponding code.
- a1-victor-verifier Step 6.5 (phantom detection): the verifier shells out to this
  CLI and folds the report into its VERIFICATION.md.
- Manual sanity check before a phase hand-off, PR, or release.

Do NOT use as a hard quality gate. It is a heuristic. False positives are
possible (very abstract task wording, refactors that touch unrelated
identifiers); false negatives are possible (a task that name-drops a file
that was touched for unrelated reasons). The signal is "look at this human",
not "block the merge". Exception: when called through a1-victor-verifier's
enforcing contract, strong phantom verdicts on non-`# no-code` tasks become
BLOCKERs — see "Caller integration" below.

## CLI contract

```bash
node <repo>/_shared/a1-tools.cjs phantom check <plan-path> \
  [--repo-path <abs>] \
  [--since <git-ref>] \
  [--format json|human]
```

| Flag | Default | Purpose |
|---|---|---|
| `--repo-path` | walks up from plan-path until a `.git` is found | repo root used for `git diff` |
| `--since` | parent of the commit that last modified PLAN.md (fallback `HEAD~20`) | left side of the diff range |
| `--format` | `json` | `human` prints a readable text summary |

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

## Caller integration: a1-victor-verifier

When a1-victor-verifier runs phase verification, it can insert a Phantom
Detection step between Requirements Coverage (Step 6) and Anti-Pattern Scan
(Step 7) by shelling out:

```bash
PHANTOM_JSON=$(node <repo>/_shared/a1-tools.cjs phantom check \
  "$PHASE_DIR"/*-PLAN.md --format json)
echo "$PHANTOM_JSON" | jq '.phantoms | length'
```

The CLI itself always exits 0 — **enforcement lives in the verifier contract**
(`a1-execute` `workflows/03-verify.md`, Step 6.5), which the verifier translates
into VERIFICATION.md findings as follows:

- **PHANTOM verdict on a task NOT tagged `# no-code`** → 🛑 **BLOCKER** finding;
  the overall verdict cannot be PASS while it is unresolved.
- **PHANTOM verdict on a `# no-code` task** → informational only, no finding.
- **Weak/heuristic match (2-weak-token match)** → ⚠️ Warning, listed as a
  "Verify manually" item so a human confirms the artifact is the real one.

Standalone/manual invocations of this skill remain warning-level (see "Do NOT
use as a hard quality gate" above) — the BLOCKER semantics apply only inside
the verifier contract.

## Workflow

See `workflows/01-check.md`.

## Hard rules

- Read-only. Never edit PLAN.md or any file in the repo under test.
- No LLM calls. The CLI is the authority; the workflow file only translates
  output for the user.
- User-facing output (summary lines, fix suggestion) follows
  `_shared/language-policy.md`: respond in the user's language. CLI
  `--format human` prints English — translate when relaying if the user's
  language differs.
- Exit code from the CLI is always 0. The skill must NOT treat
  `phantoms_found` as an error.
