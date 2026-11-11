# Phase 2 — Review (a1-reinhard-reviewer sub-agent)

Goal: run a structured code review via `a1-reinhard-reviewer` (and `a1-samuel-security` when the diff has a security surface). Output:
`<worktree>/.a1-review/findings.json` with BLOCKER / MAJOR / MINOR
arrays.

## Inputs (from Phase 1)

- `repo_root` (the main checkout, NOT the worktree)
- `worktree_path` (the isolated checkout a1-reinhard-reviewer reads)
- `branch` (the feature branch)
- `phase_history` (last entry, used as scope hint)

## Steps

### 2.1 Compute diff range

Determine the base branch (default `main`; allow override if registry
entry has `base`). Then:

```bash
git -C "<worktree_path>" rev-parse --abbrev-ref HEAD
git -C "<worktree_path>" log --oneline main..HEAD
git -C "<worktree_path>" diff --stat main...HEAD
```

If `main..HEAD` is empty: BLOCKER, no commits to review. Abort.

### 2.2 Spawn a1-reinhard-reviewer via Agent tool

Use the `Agent` tool with `subagent_type: "a1-reinhard-reviewer"`. The brief MUST
include:

```
Worktree path: <worktree_path>
Branch: <branch>
Diff range: main...HEAD (run from worktree_path)
Last phase note: <last phase_history entry, if any>

Deliverable: review findings ONLY as a single JSON block at the end of
your response, fenced with ```json. Schema:

{
  "summary": "<one-paragraph English summary>",
  "blocker": [{"file": "...", "line": 42, "title": "...", "detail": "..."}],
  "major":   [{"file": "...", "line": 42, "title": "...", "detail": "..."}],
  "minor":   [{"file": "...", "line": 42, "title": "...", "detail": "..."}]
}

Dispositions changed between base and head (step 2.3b): <list of fingerprints, or none>.

Focus areas: security, immutability, multi-tenant correctness, error
handling, input validation. Use the project's CLAUDE.md and rules as the
review baseline.
```

Wait for a1-reinhard-reviewer's response.

### 2.2b Security-surface check -> a1-samuel-security

Reinhard (2.2) reviews every PR. This step adds a second reviewer when the diff touches a security surface. The detector is the
code `xprov scope` (`_shared/lib/xprov-scope.cjs`); it reads git only and sends nothing to a third party. Remote base sha:
`gh pr view <n> --json baseRefOid`.

```bash
git -C "<worktree_path>" fetch origin
BASE_SHA="$(gh pr view <n> --json baseRefOid --jq .baseRefOid)"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: gh pr view exit=$RC"; exit "$RC"; fi
SURF="$(node <repo>/_shared/a1-tools.cjs xprov scope --repo "<worktree_path>" --base "$BASE_SHA" --head HEAD)"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: xprov scope exit=$RC"; exit "$RC"; fi
node -e 'console.log("security_surface=" + JSON.parse(process.argv[1]).security_surface)' "$SURF"
```

Read the JSON field `security_surface`:

- `true`: spawn the `Agent` tool with `subagent_type: "a1-specforge:a1-samuel-security"` and no `name` (the model comes from the agent
  frontmatter). Start it in the same turn as the 2.2 spawn so both review in parallel. Brief: worktree path, branch, diff range
  `<BASE_SHA>...HEAD` (run from the worktree), the `matched` paths of the scope output, and "return one JSON block at the end of your
  response, fenced with ```json, with the arrays `blocker`, `major`, `minor`; each entry `{file, line, title, detail}`; add a one-paragraph `summary`".
  Wait for the response and parse the fenced block like 2.3. STOP when the Samuel spawn fails or the response holds no JSON block:
  print `STOP: samuel review missing (spawn failed or no JSON block), no merge`, report it to the user, and do not go to Phase 3 or 5.
  A silent skip is not allowed: the detector fired.
- `false`: no Samuel spawn. Reinhard-only. Note `security surface: none` for the PR body (03-draft omits the Samuel section).

An intent run (headless child) that cannot spawn the agent takes the STOP branch.

### 2.3 Extract JSON block

Parse the fenced ```json block from a1-reinhard-reviewer's response (and, in 2.2b, from Samuel's). If parsing
fails, tell the user and re-prompt a1-reinhard-reviewer with a stricter
"JSON only, no prose" directive (max one retry).

### 2.3b Disposition review (spec 017, FR-025)

Reinhard reviews every disposition added or changed in the diff: `git -C "<worktree_path>" diff main...HEAD -- .a1/dispositions.json`
(list the fingerprints for the 2.2 brief before spawning). Each gets a verdict: `upheld` (the reason justifies it) or
`overturned` (the reason does not justify it, or the finding is real). Record each one. `disposition` takes no `--phase`.
No changed disposition: nothing to record, go to 2.4.

```bash
node <repo>/_shared/a1-tools.cjs disposition review <fingerprint> --verdict <upheld|overturned> --reason "<why>" --by a1-reinhard-reviewer; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: disposition review exit=$RC"; exit "$RC"; fi
```

After the last verdict, commit and push the file, then run the merge check again (`workflows/05-merge.md` 5.3): it reads verdicts from
the committed `HEAD` only and refuses `dispositions_uncommitted`. Use `--by a1-reinhard-reviewer` on every review; the author of an entry never
reviews it (`disposition_self_reviewed`). Push once per review round (`_shared/push-cadence.md` P1).

```bash
git commit -m "chore(review): disposition verdicts for pr <n>" -- .a1/dispositions.json; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: commit of .a1/dispositions.json exit=$RC"; exit "$RC"; fi
git push; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: push exit=$RC"; exit "$RC"; fi
```

An `overturned` verdict is a MAJOR finding in `findings.json` (title `disposition overturned: <fingerprint>`) and blocks the
merge check of `workflows/05-merge.md` until the finding is fixed.

### 2.3c Workflow lint (`workflow-pipeline-exit`)

The linter reads the `skills/*/workflows/*.md` of the a1-tools installation, so this step guards a PR that changes those files:
a fenced bash block must not test a pipeline's status where `$?` reads the last command instead of the parser.

```bash
node <repo>/_shared/a1-tools.cjs workflow lint --phase pr-<n>; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: workflow lint exit=$RC, findings[] on stdout"; exit "$RC"; fi
```

Exit 1 is a MAJOR finding in `findings.json` until the block is fixed.

### 2.4 Persist findings

Write ONE `findings.json` to `<worktree_path>/.a1-review/findings.json` (atomic: write to `.tmp`, then `mv`) holding the findings of both reviewers.
Every finding carries a `source` field: `"reinhard"` for a finding from 2.3, `"samuel"` for a finding of the 2.2b review (when it ran).
The arrays stay `blocker`, `major`, `minor`, so `pr findings-summary` counts both sources. BLOCKER and MAJOR of either source follow the same
fix-then-merge rule: every one is fixed before `workflows/05-merge.md` 5.4 runs `gh pr merge`. Findings of the two reviewers that name the
same file and line are listed once with `"source": "reinhard+samuel"`.

### 2.5 Update registry status

```bash
node <repo>/_shared/a1-tools.cjs pr mark-status <id> reviewed
```

### 2.6 Report to user

Show counts: "Reinhard reviewed: X BLOCKER, Y MAJOR, Z MINOR." (add "Samuel reviewed: ..." when 2.2b ran). Then:

- If BLOCKER count > 0: list each BLOCKER (title + file:line). Ask
  the user explicitly:
  > "There are BLOCKERs. Draft the PR anyway (Phase 3), or fix them
  > in the worktree first?"

  - Answer "anyway" / "continue" → Phase 3.
  - Answer "fix first" / "stop" → exit skill. User edits worktree, re-
    runs Phase 2 later.

- If only MAJOR/MINOR or zero findings: proceed to Phase 3 automatically.

### 2.6b Fix rounds

Every fix commit for a BLOCKER or MAJOR gets a re-review of the fix diff (spawn as in 2.2, range = fix commits) that
re-runs every probe and red-before test of the earlier rounds against the new head, and checks every caller of a changed
shared predicate, not only the path of the finding. A fix the reviewer suggested is tested like any other fix.
Second round on the same symptom: stop patching; the author writes down the state model (which value each path or view
holds, and when it changes), the reviewer checks the model, then one fix replaces the patches.

## Failure modes

- Reinhard returns no JSON → one retry, then escalate to user.
- Reinhard times out → tell user, do not change registry status.
- Empty diff → BLOCKER, halt.
- `xprov scope` fails (exit non-zero) or the Samuel review is missing after a surface hit -> STOP, no merge (2.2b).
