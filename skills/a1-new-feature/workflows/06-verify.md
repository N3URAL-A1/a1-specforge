# Phase 6 — Verify

**Goal:** Walk through every Acceptance Scenario in the spec with the user. Confirm each one
behaves as specified. Document failures in `verify_failures`. Close the spec only when
everything is green.

**Sub-agent:** the skill itself drives the walkthrough. Optionally Tobi for a final audit.

**Status transition:** `implementing` → `done` (all green) or stays `implementing` (failures).

## Precondition

All waves in the wave-plan are marked `⟶ status: done`. Spec status is `implementing`.
The E2E test from Step 5b (Phase 5) is green. The production URL or preview URL from the last
deploy is known — if not, run `vercel ls` and note the URL.

## Step 0 — Code review happens once, in a1-pr-review

The full-diff review runs in `a1-pr-review` `workflows/02-review.md`, once per head sha
(`pr review-evidence` / `pr review-record`); a fix round makes a new head and runs it again.
Phase 6 spawns no reviewer of its own (spec 027 FR-019).

Why a full-diff review at all: in three consecutive features (2026-07) it caught real functional bugs that
hundreds of green per-wave tests and the walkthrough missed, and that review still runs before any merge.

## Step 0.5 — Live-URL Reachability Check

Before the scenario walkthrough, confirm every feature route is reachable. This takes 2 minutes and prevents false-negatives from a silent deployment gap.

```bash
# Check each feature route added in the wave plan:
for path in <route-1> <route-2> ...; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "<production-url>$path")
  echo "$path → $code"
done
# Expected: 200 or 30x — never 404/500
```

If any route returns 4xx/5xx: do NOT proceed to the scenario walkthrough. Run `vercel ls` to confirm the active deployment, trigger a fresh deploy if needed, and re-check before continuing. A 404 here means the feature was not deployed — not that it's broken.

**If you verify against a LOCAL server instead of a deployment:** restart it by
port (`kill $(lsof -ti :PORT)`), never by name pattern, and confirm the serving
process's `cwd` matches the checkout under test before trusting any result — a
stale server manufactures false bug evidence.
See `_shared/agent-lessons.md#verify-stale-server`.

## Step 0.6 — Build/test evidence (`verify run`, then `verify check`)

On a host that has not run this project's gates yet (new machine, after a handover, fresh worktree), check the host first:
every binary that `.a1/verify.json` starts is on PATH, gitignored workspace builds (`dist/`) exist, host-bound baselines
were made on this host. A red caused by the host is fixed on the host, never reported as a code finding.
The check prints `HOST:` lines and does not stop the run (a precondition of the registered gate, not a new gate).

```bash
BINS="$(node -e 'let c;try{c=JSON.parse(require("fs").readFileSync(require("path").resolve(process.argv[1],".a1/verify.json"),"utf8")).commands||[]}catch(e){console.log("HOST: no verify.json");process.exit(0)}for(const x of c){const a=x&&x.argv;if(Array.isArray(a)&&a[0])console.log(a[0])}' <dir>)"
echo "$BINS" | grep '^HOST:'
for b in $(echo "$BINS" | grep -v '^HOST:' | sort -u); do
  command -v -- "$b" >/dev/null || echo "HOST: $b not on PATH"
done
```

Start the build/test run in the background now, before the walkthrough and before any agent (Diana, Tobi) is spawned (spec 027 FR-024).
It writes no `VERIFICATION.md` (no `--out`) and carries no `--affected`. The marker directory lies in the git common dir, outside the work
tree, so repo content cannot write or commit into it. The block reads `<spec-id>` and `<dir>` through quoted heredocs, checks the id
against `^[A-Za-z0-9_][A-Za-z0-9._-]*$` and the directory for an absolute path, refuses a symlinked marker root and empties the directory it
owns. The orchestrator strips all newlines from both values first. A start that prints `STOP:` is not a verdict: the foreground
`verify run --out` below runs as before. Never `pgrep` for the process and never `wait` on its pid; the join below reads the files.

<!-- a1:background id=verify-bg join=yes -->
```bash
IFS= read -r SPEC_ID <<'A1_SPEC_EOF'
<spec-id>
A1_SPEC_EOF
IFS= read -r WORK_PATH <<'A1_DIR_EOF'
<dir>
A1_DIR_EOF
case "$SPEC_ID" in ""|[!A-Za-z0-9_]*|*[!A-Za-z0-9._-]*) echo "STOP: bad spec id"; exit 2;; esac
case "$WORK_PATH" in /*) ;; *) echo "STOP: project dir must be absolute"; exit 2;; esac
GC="$(git -C "$WORK_PATH" rev-parse --path-format=absolute --git-common-dir)"; RC=$?
if [ "$RC" -ne 0 ] || [ -z "$GC" ]; then echo "STOP: no git common dir exit=$RC"; exit 1; fi
if [ -L "$GC/a1-verify-bg" ]; then echo "STOP: $GC/a1-verify-bg is a symlink"; exit 1; fi
VBG="$GC/a1-verify-bg/$SPEC_ID"
rm -rf "$VBG" && mkdir -p "$VBG" && chmod 700 "$VBG" || { echo "STOP: cannot prepare $VBG"; exit 1; }
( node <repo>/_shared/a1-tools.cjs verify run --project "$WORK_PATH" --phase <spec-id> > "$VBG/report.json"; RC=$?; echo "$RC" > "$VBG/rc.tmp" && mv "$VBG/rc.tmp" "$VBG/rc" ) > /dev/null 2>"$VBG/stderr.txt" & echo "$!" > "$VBG/pid"
echo "verify_report=$VBG/report.json verify_rc=$VBG/rc"
```

Join before the foreground run (`<!-- a1:join id=verify-bg -->`). The wait is bounded (240 checks, 15 s apart, 60 minutes). The recorded pid counts
as alive only while `kill -0` succeeds, the process belongs to the current user and its command is a shell or node (the recorded pid is
the subshell that runs the node child). A dead process without an `rc` file ends the wait with `background verify died`. Neither case is a
verdict: the foreground run below always runs.

<!-- a1:join id=verify-bg -->
```bash
IFS= read -r SPEC_ID <<'A1_SPEC_EOF'
<spec-id>
A1_SPEC_EOF
IFS= read -r WORK_PATH <<'A1_DIR_EOF'
<dir>
A1_DIR_EOF
case "$SPEC_ID" in ""|[!A-Za-z0-9_]*|*[!A-Za-z0-9._-]*) echo "STOP: bad spec id"; exit 2;; esac
case "$WORK_PATH" in /*) ;; *) echo "STOP: project dir must be absolute"; exit 2;; esac
VBG="$(git -C "$WORK_PATH" rev-parse --path-format=absolute --git-common-dir)/a1-verify-bg/$SPEC_ID"
i=0; while [ ! -f "$VBG/rc" ] && [ $i -lt 240 ]; do
  BP="$(cat "$VBG/pid" 2>/dev/null)"
  case "$BP" in ""|*[!0-9]*) echo "background verify died (no valid pid)"; break;; esac
  if ! kill -0 "$BP" 2>/dev/null || [ "$(ps -o uid= -p "$BP" | tr -d ' ')" != "$(id -u)" ]; then [ -f "$VBG/rc" ] || echo "background verify died"; break; fi
  case "$(ps -o comm= -p "$BP" 2>/dev/null)" in bash|sh|dash|zsh|ksh|node|MainThread) ;; *) [ -f "$VBG/rc" ] || echo "background verify died (pid not ours)"; break;; esac
  sleep 15; i=$((i+1))
done
if [ -f "$VBG/rc" ]; then echo "background verify rc=$(cat "$VBG/rc")"; elif [ $i -ge 240 ]; then echo "WARN: background verify not finished after 60 min, running verify run directly"; fi
```

Before the walkthrough, record the build and test result in the spec's VERIFICATION.md (path:
`.a1/phases/<spec-id>/VERIFICATION.md`, create the directory). The `verify_run` frontmatter block
is written only by this command:

```bash
mkdir -p .a1/phases/<spec-id>
node <repo>/_shared/a1-tools.cjs verify run --project <dir> --out .a1/phases/<spec-id>/VERIFICATION.md --phase <spec-id>; RUN_RC=$?
echo "verify run exit=$RUN_RC"
```

`verify run` waits on its CLI lock (at most 15 minutes, `lock_wait_ms` in the record, exit 2 `lock_timeout` after the ceiling). Record the host load and treat a red from a busy host as `a1-pr-review` `workflows/05-merge.md` §5.3 says (owner of that rule).

Exit 1 or 2 stops Phase 6: fix the failing command (or `.a1/verify.json`), re-run. Exit 2 with `error` `lock_timeout` is neither: another local `verify run` held the CLI lock past 15 minutes (host busy); re-run when it is free. After the
walkthrough result is written to VERIFICATION.md (keep the `verify_run` key), and again before
any verdict `PASS` is reported:

```bash
node <repo>/_shared/a1-tools.cjs verify check .a1/phases/<spec-id>/VERIFICATION.md; CHECK_RC=$?
echo "verify check exit=$CHECK_RC"
if [ $CHECK_RC -ne 0 ]; then echo "STOP: verify check refused PASS (re-run verify run --out)"; fi
```

Exit 1 = no PASS: the spec stays `implementing`. Code changed since the run → re-run `verify run --out`.

## Step 1 — Extract Acceptance Scenarios

Read the spec. Collect every Given/When/Then block under `## Acceptance Scenarios`, grouped
by User Story. Each scenario is one verification item.

**Verification target — acceptance criteria VERBATIM:** The verification target is the SPEC's
acceptance criteria quoted VERBATIM — the wave plan is only the route taken, never the truth.
Quote each AC directly from the spec file, not from the plan task wording. When a plan
success-criterion has diluted or reworded a spec AC, verify against the spec sentence and record
the divergence itself as a failure entry. Build a per-AC table as you walk through:

```
| Spec AC (quoted verbatim) | Result | Evidence |
|---|---|---|
| "<exact sentence copied from the spec file>" | ✓ / ✗ / partial | <observed behavior / route status / command output> |
```

## Step 1.5 — De-duplicate against Gate 3 (don't re-run what per-wave smoke already proved)

Gate 3 (Phase 5) already smoke-tested each FR-AC live against the preview URL, per wave. Phase 6
must NOT blindly re-run every FR-AC — that is the single biggest redundant cost block in the
pipeline. Instead, Phase 6 re-runs ONLY:

- **(a)** FR-ACs that FAILED at Gate 3, OR whose code was re-touched after their Gate-3 pass.
- **(b)** cross-wave integration scenarios (behavior spanning waves that no single Gate 3 covered).
- **(c)** edge cases (Step 3) + success criteria (Step 4).

Everything Gate 3 already proved per-wave gets a **✓-reference row**, not a re-run.

**How to decide, per FR-AC:**

1. Read the `gate3:` lines in STATUS.md (written per Gate-3 bookkeeping in 05-implement.md):
   `gate3: <FR-AC id> PASS @<wave> <date>`.
2. Check `git log` for commits touching that AC's code AFTER the Gate-3 pass date/wave:
   ```bash
   git -C <repo> log --oneline --since="<gate3-pass-date>" -- <files-for-this-FR>
   ```
3. Classify:
   - **Recorded `gate3: … PASS` AND no later touch** → ✓-reference row, do NOT re-run.
   - **Failed at Gate 3, OR re-touched after pass, OR no `gate3:` line found** → RE-RUN in Step 2.

**Safety rule — when in doubt, re-run.** If no `gate3:` line is found for an AC, or you cannot
determine whether code was re-touched, treat it as unverified and re-run it. Referencing is an
optimization; a missing reference must never silently skip verification.

In the per-AC table (Step 1), referenced ACs get this row form instead of a live result:

```
| "<exact spec sentence>" | ✓ (ref) | verified at Gate 3, wave N — not re-run |
```

## Step 2 — Verify scenarios against the running app (not against the user's memory)

Walk through only the FR-ACs classified as RE-RUN in Step 1.5 (failed at Gate 3, re-touched, or
no `gate3:` line) plus cross-wave integration scenarios. FR-ACs with a ✓-reference row are already
recorded — skip them here.

For each User Story to verify (P1 first, then P2, P3):

**Not:** "Did you test that?" — that is not verification.

**Instead:** Walk through the scenario's steps against the production/preview URL.
Use browser automation if available (mcp__claude-in-chrome__*), otherwise give the user
**a concrete, step-by-step instruction with the exact URL and the expected UI reaction**:

> "**Story <US-ID> — <short title>**
>
> Please open: `<production-url>/<path>`
> Step 1: <click/input>
> Step 2: <click/input>
> Expected result: <what exactly should be visible>
>
> Does it behave like this? (yes / no / partially)"

Do not accept "should work" or "I haven't tested it" as a `yes`.
Only "I just did it and it works" counts as green.

For technical SCs (response time, RLS isolation, error handling):
Provide a concrete verification command instead of asking a question:

```bash
# Example RLS isolation:
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer <other-user-token>" \
  "<api-url>/api/expenses/<own-expense-id>"
# Expected: 404 (not 200)

# Example response shape:
curl -s -H "Cookie: <session>" "<api-url>/api/expenses/list" | jq 'keys'
# Expected: ["expenses","total"] — NOT ["data"]
```

Capture the answer:

- **yes** → mark scenario `✓` in your tracking buffer.
- **no / partially** → ask for the exact deviation. Capture as a failure entry:
  ```
  - story: US-<###>-N
    scenario: <short title or first line of the Given>
    expected: <what the spec says>
    actual: <what the user reports>
    timestamp: <iso>
  ```

Move to the next scenario only after the current one is answered.

## Step 3 — Edge-case spot check

After the User Stories, walk through the `## Edge Cases` list. For each edge case ask:

> "Edge Case: <text> — was this handled in the code?"

This is a softer check; flag edge cases that don't have explicit handling and add them as
verify_failures with `kind: edge-case`.

**Size-S fast path:** verify every AC once (Step 2 is never reduced) and run
the project's regression suite, but limit this edge-case walk to the **single
riskiest** edge case instead of the full list. Steps 1, 2, 4, 5 and the Retro
run unchanged.

## Step 4 — Success Criteria sanity

Read the SC-### list. Ask the user whether each SC is met (some are quantitative — request
the actual number if available, e.g. response time, test coverage).

## Step 5 — Apply result

### Cost line in VERIFICATION.md (mandatory — never omit)

Directly after the verdict line in VERIFICATION.md, write a `**Cost:**` line.

Compute it with:

```bash
node <repo>/_shared/a1-tools.cjs cost run --project ~/.claude/projects/<project-dir> --since <phase-start-ISO>
```

Summary-line format:

```
Cost: NNN tokens (in X, out Y, cache Z)
```

If the cost command fails for any reason, write the fallback instead — the line is never omitted:

```
Cost: unavailable (<reason>)
```

### All scenarios green AND all SCs met — Lifecycle Completion Gate (Review → Verify → Merge → Origin cleanup → Done)

The spec does not move to `done` on Phase 6 passing alone. Drive the
remaining lifecycle-stage transitions in order (see SKILL.md's Lifecycle
Completion Gate), each after its own confirmation:

1. **Review** and **Verify** are recorded by `a1-pr-review` `workflows/02-review.md` step 2.3d, after the
   `pr-reinhard` pass record (or on its same-head skip path), in that order. The walkthrough is all-green
   before the hand-off, so both conditions hold there. Phase 6 runs no `code-scope stage` call before the
   hand-off. (SKILL.md's Lifecycle table stays as written: its Review row still holds.)
3. **Merge** — after the pre-merge check below and the PR's squash merge into `main` (`a1-pr-review`, verified via
   `gh pr view --json state,mergedAt`), and after the retros (this skill's Step 6 incl. `retro validate --gate-log`, and the `a1-pr-review`
   retro: the gate logs are gitignored (FR-008) and are deleted with the worktree), `a1-pr-review` `workflows/05-merge.md` 5.4 item 3 runs
   `feature close --by <spec-id> --pr <n>` (the F block, spec 027 FR-026). One call does steps 3, 4 and 5: it refuses unless the PR is MERGED and the
   remote branch is gone, exits the worktree, advances `merge` and `origin-cleanup`, releases the scope reservation and sets the spec `done`. This
   skill runs no `code-scope stage --set merge`, `--set origin-cleanup`, `code-scope release` or `spec update-status ... done` call of its own.
   When the output names `reservations_commit_pending`, commit `.a1/reservations.json` as 05-merge.md says.

   **Live probes (spec 020, gate `live-probes`)** — after the merge is confirmed and the deploy of the merged `main` is
   live, after the close-out call. Measures the merged effect from outside with the probes in `.a1/live-probes.yaml` (owner-side only;
   an intent child is refused with exit 77). `<dir>` is a checkout of the merged `main` with `origin` fetched: `probe run`
   reads the probe file from the git blob and refuses an uncommitted, modified, local-only or unreviewed one (exit 2,
   `probes_file_uncommitted`, `probes_no_reviewed_ref`, `probes_file_unreviewed`). Exit 1 or 2 stops the run: the feature is not verified live; fix
   the cause; the merge and the close-out stay done. A probe-file change goes through a new PR (merge-check blocks it as
   `probes_config_changed`), never through an edit of the working tree.
   ```bash
   node <repo>/_shared/a1-tools.cjs probe run --project <dir> --phase <spec-id> --wait 120; RC=$?
   if [ "$RC" -ne 0 ]; then echo "STOP: probe run exit=$RC (1 = a probe failed or was not measured, 2 = usage error or hostile file), not verified live"; exit "$RC"; fi
   ```
   Append the result lines (one per probe plus the `pass=N fail=N not_measured=N` summary) under a new `## Live probes`
   section of `.a1/phases/<spec-id>/VERIFICATION.md`. A `no_probes` result is reported as "not verified live (no_probes)",
   never as "verified live".

4. **Origin cleanup** — done by the `feature close` call of step 3 (the remote branch is checked gone there).
5. **Done** — done by the same call (scope released, spec `done`).

The helper:
- appends `phase: implement, completed: <iso>` and `phase: verify, completed: <iso>` to
  `phase_history`,
- clears `verify_failures` to `[]`.

### Pre-merge check — rebase + migration-number collision (do this BEFORE merging to main)

The feature branch was cut from `origin/main` at the START of Phase 5. By the time Verify
passes, a PARALLEL feature may have merged to `main` and claimed the same migration numbers
or touched the same shared files. Merging naively then either reverts their work or ships two
migrations with the same number (runner breaks). Before the PR is opened:

```bash
git -C <repo> fetch origin main
# 1. Is the branch behind origin/main?
git -C <repo> log --oneline <feature-branch>..origin/main        # non-empty → rebase needed
# 2. Migration-number collision? Compare your new migration numbers against origin/main's:
git -C <repo> ls-tree origin/main automation/db/migrations/ | grep -E '<your-new-numbers>'
```

- If behind: `git rebase origin/main` while the branch is still unpushed; once it is pushed, use
  `git merge origin/main` instead (no force push; `_shared/push-cadence.md` P1 rule 2). Resolve
  conflicts (keep BOTH sides for additive files like a capability manifest or a shared route's
  imports — never drop the other feature's lines).
- If migration numbers collide: renumber YOUR migrations (up + down + every in-file and in-code
  comment reference) to the next free numbers AFTER origin/main's highest. Re-run the dry-run.
- "main looks build-red after pull": first rebuild gitignored package `dist/` (`pnpm --filter <pkg> build`)
  before concluding main is broken — a stale local build masquerades as a red main.

Only after a clean rebase or merge + no number collision + green build on the rebased or merged tree do you hand
the branch to `a1-pr-review`, which makes its first push (`_shared/push-cadence.md` P1).
The hand-off carries the worktree and branch and the spec id as `caller_spec_id` (`a1-pr-review` 2.3d reads it); `a1-pr-review` reviews the diff (Reinhard always, Samuel on security surface). No cross-provider gate runs on code.

Tell the user:

> "Phase 6 green. Spec is `done`. Wave plan can be archived or used as a reference for
> similar features. Optional: Tobi for a final audit?"

### One or more scenarios failed

Write the failures into the spec frontmatter via the helper. The helper accepts a JSON file
containing the failure entries via `--verify-failures-file <path>`:

```bash
# 1. Write the failures to a temp JSON file:
cat > /tmp/verify-failures.json <<EOF
[
  { "story": "US-001-1", "scenario": "user adds new entry", "expected": "...", "actual": "...", "timestamp": "..." }
]
EOF

# 2. Pass the file path to the helper:
node <repo>/_shared/a1-tools.cjs spec update-status \
  <spec-path> implementing --verify-failures-file /tmp/verify-failures.json
```

The helper reads the JSON file, validates the schema, and writes the entries into the
`verify_failures` frontmatter array atomically.

Status stays `implementing`. Tell the user:

> "Phase 6 found N points that don't match. Would you like to:
> a) Send these back to the code agents as bugs (re-run Phase 5 for affected waves)?
> b) Open the spec, if the expectation itself was wrong (back to Phase 2/3)?"

Do not advance to `done` until all failures are resolved and a re-verify is green.

## Step 5.5 — Docs-drift lane (report-only, spawn a1-diana-docs)

After the verdict is applied and **before** the Retro, spawn `a1-diana-docs`
via the `Agent` tool with this brief (wired M12, decision doc 7.4 candidate
3a — mirrors how Samuel is an always-on lane in a1-analyze):

> Diana, the feature `<###>-<feature-slug>` just shipped (spec:
> `<spec-path>`, verification verdict: `<pass|partial>`). Check the project's
> user-facing docs for drift introduced by this feature: README sections,
> API docs, user guides, onboarding steps that this feature's changes make
> stale or incomplete. Return a short report as TEXT (write NO files):
> per finding — doc path, what is stale, one-line suggested fix. If nothing
> drifted, say so explicitly.

Rules:

- **Report-only.** Diana's findings go to the user; they do NOT block the
  lifecycle gate and do NOT auto-trigger edits. The user decides whether to
  have Diana apply doc updates as a follow-up.
- Skip this lane only when the run has no user-facing surface at all (pure
  internal refactor) — say that you skipped it and why.

## Step 6 — Retro (MANDATORY, every run — this closes the self-learning loop)

After every Phase 6 run — PASS, PARTIAL, or FAIL — write one retro entry **before you tell
the user the feature is done**, per `_shared/retro-template.md` (entry format + write
targets: learning store first, dev cache best-effort), with skill = `a1-new-feature`.
This is not optional — without it `a1-evolve` is blind and the skills stop improving.
A long run is exactly when the most learnings exist; that is when it is most tempting
to skip and most costly to.

### Step 6a — Additional fields beyond the base schema

```
spec: <###>-<feature-slug>
result: <pass|partial|fail>
waves_total: <N>
bugs_found_in_verify: <N>
bug_classes: [<from: missing_wiring, wrong_behavior_vs_spec, deployment_incomplete, schema_flaw, regression, spec_omission, gate_friction, agent_self_report_false, parallel_collision>]
gate_that_caught_most: <Gate 0|Gate 1|Gate 2|Gate 3|Phase 6|none>
phase_that_produced_most_bugs: <discover|specify|clarify|plan|implement|verify>
gates_fired:
  - {id: <slug>, verdict: <pass|fail>, caught: <true|false>}
```

**`gates_fired` is required** (not the free-text `gate_that_caught_most` alone —
that one stays for continuity but a1-evolve cannot score it). List every gate
this run actually passed through, using ids verbatim from
`_shared/gates-registry.md`. For a standard feature run that is typically:

```yaml
gates_fired:
  - {id: gate-c-ac-dryrun,        verdict: pass, caught: false}
  - {id: gate-4.5-fr-consistency, verdict: pass, caught: false}
  - {id: check-reservations,      verdict: pass, caught: false}
  - {id: phase-6-verify,          verdict: pass, caught: true}
```

`caught: true` marks the gate that surfaced a real problem — at most a few per
run, often none. This is what lets a1-evolve tell a gate that earns its cost
from one that has never caught anything in 10+ runs.

Use the `bug_classes` tags consistently — they feed `patterns.md` clustering.
A run with zero bugs is still useful data — write the entry with
`bugs_found_in_verify: 0` and `one_line_learning: no failures`.

Before appending this retro, validate the `gates_fired` block — full
contract and exit codes in `_shared/retro-template.md`, which is the owner
of this instruction:

```bash
GATE_LOG=".a1/phases/<spec-id>/gate-log.jsonl"
node <repo>/_shared/a1-tools.cjs gates fired --log "$GATE_LOG"; RC=$?
if [ $RC -ne 0 ]; then echo "gate log unreadable or broken (exit $RC) - fix it before the entry counts"; exit $RC; fi
node <repo>/_shared/a1-tools.cjs retro validate "$RETRO_FILE" --gate-log "$GATE_LOG" --phase retro-<spec-id>; RC=$?
if [ $RC -ne 0 ]; then echo "fix the gates_fired block above before the entry counts"; exit $RC; fi
```

### Step 6b — Threshold check

Count entries in the **learning store** (not the dev cache — plugin installs
have no cache):

```bash
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
ENTRY_COUNT=$(grep -c "^date:" "$VAULT/pattern/a1-learnings/a1-new-feature.md" 2>/dev/null || echo 0)
```
If `$ENTRY_COUNT` is a multiple of 5:
> "5 new a1-new-feature learnings accumulated in the learning store. Run `a1-evolve`?"

## Optional — Tobi audit

If the user wants a deeper audit before declaring done, spawn `a1-tobi-tester` with this
brief:

> Tobi, do a final audit on the spec `<spec-path>` and the code implemented under the
> wave plan `<plan-path>`. Cross-cutting check: Vision (does it fit the product?),
> UX (is the user flow coherent?), Architecture (clean separation?), Compliance
> (data protection, security, project-specific rules). Output as BLOCKER / MAJOR / MINOR.

Tobi findings do NOT automatically become verify_failures — the user decides whether a finding
triggers a bug back to Phase 5 or goes to the backlog.
