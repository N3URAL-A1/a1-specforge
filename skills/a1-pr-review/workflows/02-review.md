# Phase 2 — Review (a1-reinhard-reviewer sub-agent)

Goal: run a structured code review via `a1-reinhard-reviewer` (and `a1-samuel-security` when the diff has a security surface). Output:
`<worktree>/.a1-review/findings.json` with BLOCKER / MAJOR / MINOR
arrays.

## Inputs (from Phase 1)

- `repo_root` (the main checkout, NOT the worktree)
- `worktree_path` (the isolated checkout a1-reinhard-reviewer reads)
- `branch` (the feature branch)
- `phase_history` (last entry, used as scope hint)
- `caller_spec_id` (a1-new-feature hands over its spec id; any other caller: `none`). Read by 2.3d and by 05-merge.md.
- `issue_tags` (problems of the run that the caller or the owner names in chat as comma-separated tags a-z 0-9 _ -; default `none`). Read by 05-merge.md items 1 and 3; the orchestrator strips all newlines first.

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

### 2.1b Review evidence

Reinhard reviews one head sha once (spec 027 FR-019). Ask whether a `pass` is already recorded for the current head:

```bash
HEAD_SHA="$(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git -C "<worktree_path>" rev-parse HEAD)"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: rev-parse exit=$RC"; exit "$RC"; fi
echo "head_sha=$HEAD_SHA"
(cd "<worktree_path>" && node <repo>/_shared/a1-tools.cjs pr review-evidence --head "$HEAD_SHA" --phase pr-<n>); EV=$?
echo "review-evidence exit=$EV"
FH=""
if [ -d "<worktree_path>/.a1-review" ] && [ ! -L "<worktree_path>/.a1-review" ] \
   && [ -f "<worktree_path>/.a1-review/findings.json" ] && [ ! -L "<worktree_path>/.a1-review/findings.json" ] \
   && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git -C "<worktree_path>" ls-files -o -- .a1-review/findings.json | grep -qx '.a1-review/findings.json' \
   && ! env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git -C "<worktree_path>" ls-files --error-unmatch -- ':(icase).a1-review/findings.json' >/dev/null 2>&1; then
  FH="$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).head_sha||""))}catch(e){}' "<worktree_path>/.a1-review/findings.json")"
fi
if [ "$FH" = "$HEAD_SHA" ]; then echo "findings_head=match"; else echo "findings_head=stale-or-missing"; fi
```

The git calls of the block run with `env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE`, so an inherited repo-location variable cannot point them at another repository or index (the gate-log reader drops the same variables).

Note the printed `head_sha` value as `<head_sha>` for 2.3a and 2.4. Exit 0 **and** `findings_head=match` (the `findings.json` exists, `.a1-review` and the file are real (no symlink, no submodule), `git ls-files -o` lists the file as untracked, no case-insensitive spelling of it is tracked, and it carries this head's `head_sha`, written by 2.4; a PR branch can commit a findings file, a symlink or a submodule at `.a1-review`, so none of those ever counts): skip 2.2 and 2.3a for this head, reuse the findings, and run 2.3d. Exit 0 with `findings_head=stale-or-missing` (a restart between 2.3a and 2.4, or a reset to an earlier reviewed head): the saved findings belong to another head, so go on to 2.2 and review this head again. 2.2b still runs; Samuel's spawn is not skipped by this. Exit 1: go on to 2.2 as today. Exit 2: STOP (usage).

### 2.2 Spawn a1-reinhard-reviewer via Agent tool

Run the 2.2b scope check FIRST (it only reads git, no spawn), then spawn Reinhard here and, when the surface is hit, Samuel in the same
turn, so both review in parallel.

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

The spawn of a1-reinhard-reviewer is issued together with the 2.2b one; wait for the responses of both in 2.3.

### 2.2b Security-surface check -> a1-samuel-security

Reinhard (2.2) reviews every PR. This step adds a second reviewer when the diff touches a security surface. The detector is the
code `xprov scope` (`_shared/lib/xprov-scope.cjs`); it reads git only and sends nothing to a third party. Remote base sha:
`gh pr view <n> --json baseRefOid`.

This call is the registered gate `pr-security-surface` (spec 027 FR-033): the facade hook appends one line to `.a1/phases/pr-<n>/gate-log.jsonl` of the worktree, so the call runs inside the worktree (`cd`) and carries `--phase pr-<n>`.

```bash
git -C "<worktree_path>" fetch origin
BASE_SHA="$(gh pr view <n> --json baseRefOid --jq .baseRefOid)"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: gh pr view exit=$RC"; exit "$RC"; fi
SURF="$(cd "<worktree_path>" && node <repo>/_shared/a1-tools.cjs xprov scope --repo "<worktree_path>" --base "$BASE_SHA" --head HEAD --phase pr-<n>)"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: xprov scope exit=$RC"; exit "$RC"; fi
node -e 'console.log("security_surface=" + JSON.parse(process.argv[1]).security_surface)' "$SURF"
```

Read the JSON field `security_surface`:

- `true`: spawn the `Agent` tool with `subagent_type: "a1-specforge:a1-samuel-security"` and no `name` (the model comes from the agent
  frontmatter). Start it in the same turn as the 2.2 spawn so both review in parallel. Brief: worktree path, branch, diff range
  `<BASE_SHA>...HEAD` (run from the worktree), the `matched` paths of the scope output, and "return one JSON block at the end of your
  response, fenced with ```json, with the arrays `blocker`, `major`, `minor`; each entry `{file, line, title, detail}`; add a one-paragraph `summary`".
  Parse the fenced block like 2.3 once the response is in. STOP when the Samuel spawn fails or the response holds no JSON block:
  print `STOP: samuel review missing (spawn failed or no JSON block), no merge`, report it to the user, and do not go to Phase 3 or 5.
  A silent skip is not allowed: the detector fired.
- `false`: no Samuel spawn. Reinhard-only. Note `security surface: none` for the PR body (03-draft omits the Samuel section).

An intent run (headless child) that cannot spawn the agent takes the STOP branch.

### 2.3 Extract JSON block

Parse the fenced ```json block from a1-reinhard-reviewer's response (and, in 2.2b, from Samuel's). If parsing
fails, tell the user and re-prompt a1-reinhard-reviewer with a stricter
"JSON only, no prose" directive (max one retry).

### 2.3a Record the verdict

Right after 2.3 parsed Reinhard's JSON, record one verdict for this head (the registered gate `pr-reinhard`). `<head_sha>` is the value 2.1b printed, substituted by the orchestrator like `<BASE_SHA>` in 2.2b; it is never a shell variable, because 2.1b ran in an earlier Bash call. The verdict is `fail` when the parsed `blocker` array is non-empty, else `pass`.

```bash
(cd "<worktree_path>" && node <repo>/_shared/a1-tools.cjs pr review-record --head <head_sha> --verdict <pass|fail> --phase pr-<n>); RC=$?
echo "review-record exit=$RC"
```

Exit 2: STOP (the head moved since 2.1b: re-run 2.1b and 2.2). Exit 1 is the recorded fail and does not stop here (the BLOCKER flow of 2.6 applies).

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

### 2.3d Lifecycle stages

Runs after a 2.3a exit 0 (`pass`) **and** after a 2.1b exit 0 (the same-head skip path). Never after a recorded `fail`. Only when the caller handed over a `caller_spec_id` that holds a `code_scope` reservation does it advance `review` and then `verify`; each target is skipped when the current stage is at or past it, so a fix round or a restart never tries a backward move.

```bash
{ IFS= read -r PHASE; if IFS= read -r EXTRA; then echo "STOP: bad spec id (more than one line)"; exit 2; fi; } <<'A1_PHASE_EOF'
<caller_spec_id>
A1_PHASE_EOF
case "$PHASE" in ""|none|"<"*) echo "SKIP: lifecycle stages, no caller spec id"; exit 0 ;; esac
case "$PHASE" in [!A-Za-z0-9_]*|*[!A-Za-z0-9._-]*) echo "STOP: bad spec id"; exit 2 ;; esac
SCOPES="$(cd "<repo_root>" && node <repo>/_shared/a1-tools.cjs code-scope list)"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: code-scope list exit=$RC"; exit "$RC"; fi
NEED="$(node -e 'const d=JSON.parse(process.argv[1]);const r=(d.reservations||[]).find((x)=>x.by===process.argv[2]);const O=["started","complete","review","verify","merge","origin-cleanup","done"];const i=r?O.indexOf(r.stage):-1;console.log(i<0?"none":(["review","verify"].filter((t)=>O.indexOf(t)>i).join(" ")||"none"))' "$SCOPES" "$PHASE")"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: stage lookup exit=$RC"; exit "$RC"; fi
for S in $NEED; do [ "$S" = none ] && break; (cd "<repo_root>" && node <repo>/_shared/a1-tools.cjs code-scope stage --by "$PHASE" --set "$S"); RC=$?; if [ "$RC" -ne 0 ]; then echo "STOP: code-scope stage $S exit=$RC"; exit "$RC"; fi; done
```

The block reads `caller_spec_id` through a quoted heredoc (`A1_PHASE_EOF`), as `02-execute.md` does for the phase name: single quotes
would let a value holding a quote (`x'$(...)'`) run at the assignment. The orchestrator strips all newlines from the id and checks it
against `^[A-Za-z0-9_][A-Za-z0-9._-]*$` before it substitutes it; the block repeats that check (`none` and an unreplaced `<...>` are a
SKIP, decided first; anything else that fails the check is `STOP: bad spec id`, exit 2).

Without a reservation (a1-execute phase, a1-fix, a standalone review) the block prints SKIP or runs no stage call. When the block ran a stage call and `.a1/reservations.json` is tracked and differs from HEAD, commit it on the primary checkout's `main` at once and push it with this session step (`_shared/push-cadence.md` P3, "committed immediately, so the tree is never dirty"); `feature close`'s `reservations_commit_pending` covers only its own later changes.

### 2.4 Persist findings

Write ONE `findings.json` to `<worktree_path>/.a1-review/findings.json` (atomic: write to `.tmp`, then `mv`) holding the findings of both reviewers.
The file carries a top-level `"head_sha": "<head_sha>"` (the sha printed by 2.1b, written in the same atomic write): 2.1b reuses the findings only when it equals the current head.
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
A fix commit makes a new head, so 2.1b exits 1 and Reinhard runs again.
An empty fix hand-back or a "flaky / pre-existing" claim: Gate 0 in `a1-new-feature/workflows/05-implement.md` applies first.
Before fixing a finding, enumerate the same field/path class (grep) and fix the class, not the instance.
Second round on the same symptom: stop patching; the author writes down the state model (which value each path or view
holds, and when it changes), the reviewer checks the model, then one fix replaces the patches. If the symptom is a spec question, take it to the spec owner instead.

## Failure modes

- Reinhard returns no JSON → one retry, then escalate to user.
- Reinhard times out → tell user, do not change registry status.
- Empty diff → BLOCKER, halt.
- `xprov scope` fails (exit non-zero) or the Samuel review is missing after a surface hit -> STOP, no merge (2.2b).
