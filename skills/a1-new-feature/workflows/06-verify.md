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

## Step 0 — Live-URL Reachability Check

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

1. **Review** — once code review (Reinhard or equivalent) has confirmed the
   implementation:
   ```bash
   node <repo>/_shared/a1-tools.cjs code-scope stage --by <spec-id> --set review
   ```
2. **Verify** — once this Phase 6 walkthrough is all-green (this step):
   ```bash
   node <repo>/_shared/a1-tools.cjs code-scope stage --by <spec-id> --set verify
   ```
3. **Merge** — after the pre-merge check below and a clean `git merge` to
   `main` with a green post-merge build:
   ```bash
   node <repo>/_shared/a1-tools.cjs code-scope stage --by <spec-id> --set merge
   ```
4. **Origin cleanup** — after the feature branch's remote copy is deleted
   (via `a1-worktree`'s Exit workflow, Step 4.5). **Hard gate — verify the
   remote branch is actually gone before advancing:**
   ```bash
   git -C <repo> ls-remote --heads origin <feature-branch>
   ```
   Non-empty output → the remote branch still exists → **refuse** to set
   `origin-cleanup` or `done`. Go run `a1-worktree` exit (discard mode) to
   delete the remote branch, then re-check. Only once empty:
   ```bash
   node <repo>/_shared/a1-tools.cjs code-scope stage --by <spec-id> --set origin-cleanup
   ```
5. **Done** — only after all four transitions above are confirmed, release
   the scope reservation (frees it for other features) and close the spec:
   ```bash
   node <repo>/_shared/a1-tools.cjs code-scope release --by <spec-id>
   node <repo>/_shared/a1-tools.cjs spec update-status <spec-path> done
   ```

The helper:
- appends `phase: implement, completed: <iso>` and `phase: verify, completed: <iso>` to
  `phase_history`,
- clears `verify_failures` to `[]`.

### Pre-merge check — rebase + migration-number collision (do this BEFORE merging to main)

The feature branch was cut from `origin/main` at the START of Phase 5. By the time Verify
passes, a PARALLEL feature may have merged to `main` and claimed the same migration numbers
or touched the same shared files. Merging naively then either reverts their work or ships two
migrations with the same number (runner breaks). Before `git merge`:

```bash
git -C <repo> fetch origin main
# 1. Is the branch behind origin/main?
git -C <repo> log --oneline <feature-branch>..origin/main        # non-empty → rebase needed
# 2. Migration-number collision? Compare your new migration numbers against origin/main's:
git -C <repo> ls-tree origin/main automation/db/migrations/ | grep -E '<your-new-numbers>'
```

- If behind: `git rebase origin/main`, resolve conflicts (keep BOTH sides for additive files
  like a capability manifest or a shared route's imports — never drop the other feature's lines).
- If migration numbers collide: renumber YOUR migrations (up + down + every in-file and in-code
  comment reference) to the next free numbers AFTER origin/main's highest. Re-run the dry-run.
- "main looks build-red after pull": first rebuild gitignored package `dist/` (`pnpm --filter <pkg> build`)
  before concluding main is broken — a stale local build masquerades as a red main.

Only after a clean rebase + no number collision + green build on the merged tree do you push.

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
```

Use the `bug_classes` tags consistently — they feed `patterns.md` clustering.
A run with zero bugs is still useful data — write the entry with
`bugs_found_in_verify: 0` and `one_line_learning: no failures`.

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
