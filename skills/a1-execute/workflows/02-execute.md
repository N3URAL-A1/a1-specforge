# Phase 2: Execute Waves

Execute each wave via a1-erik-executor, with checkpoints between waves.

## Work path (`$WORK_PATH`)

Every git command below runs against `$WORK_PATH` — the worktree the wave
actually executes in, never the primary checkout:

```bash
WORK_PATH=<phase worktree path>        # sequential phase (Isolation Gate)
WORK_PATH=<lane worktree path>         # multi-lane: one per lane
```

Getting this wrong is silent: `git -C <primary checkout> rev-parse HEAD` in a
lane run measures a tree the executor never touched, so the commit-landed gate
below either reports a false "empty" or counts another lane's commits as this
one's.

## Per-wave loop

For each wave in PLAN.md (skipping already-completed waves per STATUS.md):

**Plan unchanged since Load (spec 009 FR-003, time-of-check/time-of-use).**
Before every wave — not only at Load — re-run load-check against the sha
accepted in `01-load.md` Step 0c:
```bash
node <repo>/_shared/a1-tools.cjs xprov load-check --phase <phase_name> --expect-sha "$LOADED_PLAN_SHA" > .a1/phases/<phase_name>/xreview/load-check.last-run.json; RC=$?
echo "xprov load-check (pre-wave) exit=$RC"
```
Exit 0 → continue to 2a. Exit 1 with `reason: plan_changed` (PLAN.md edited
since Load) or `plan_review_missing` → under `blocking` **halt before this
wave** and route the user to `a1-plan` Phase 4b; under `warning` print the
warning block of Step 0c and continue.

### 2a. Spawn a1-erik-executor

Dispatch with `subagent_type: "a1-specforge:a1-erik-executor"` and **no `name`**, so the
executor's frontmatter tier applies (`_shared/spawn-policy.md` S1). A named spawn such as
`erik-<spec>-w<n>` runs as a teammate on the inherited session model — the measured leak.

Record the pre-wave HEAD first — step 2b compares against it:

```bash
PRE_WAVE_HEAD=$(git -C "$WORK_PATH" rev-parse HEAD)
```

```
Execute Wave <N> of the plan.

<files_to_read>
- .a1/phases/<phase_name>/PLAN.md
- .a1/phases/<phase_name>/RESEARCH.md
- .a1/phases/<phase_name>/STATUS.md        (lane run: STATUS-<lane-id>.md)
- ./CLAUDE.md (if exists)
</files_to_read>

**Wave:** <N>
**Phase dir:** .a1/phases/<phase_name>/
**Project path:** $WORK_PATH
<lane runs only>
**Lane:** <lane-id> — write status to STATUS-<lane-id>.md, and expect only this
lane's earlier waves in the git history.
</lane runs only>
```

### 2b. Process wave result

After a1-erik-executor returns:

**If COMPLETE:**
```bash
git -C "$WORK_PATH" log --oneline "$PRE_WAVE_HEAD"..HEAD
git -C "$WORK_PATH" status --porcelain
```
Show commit list to user.
Note: if the plan declares a one-commit-per-wave ground rule, the expected
commit count is per-wave, not per-task — expect one commit for the whole wave.

**Commit-landed gate (blocking).** A "COMPLETE" report is a claim; HEAD is the
evidence. Treat the wave as NOT complete if either holds:

- `"$PRE_WAVE_HEAD"..HEAD` is **empty** → the executor changed nothing, or its
  work sits uncommitted. Do not advance to the next wave. Show
  `git status --porcelain` to the user: dirty tree → have the executor commit
  its own work (never commit it for them — the commit message and task
  attribution are theirs); clean tree → the wave did nothing, re-dispatch or
  escalate.
- `git status --porcelain` is **non-empty** after a COMPLETE report → part of
  the wave is uncommitted. Same handling: back to the executor before the
  checkpoint.

Observed 2026-07-22 (pro-orc 008): a fully implemented, 705-tests-green Wave 1
sat uncommitted in a worktree and was only noticed by Wave 2's agent — one
discarded worktree away from silent total loss. The next run (009) explicitly
demanded commit proof and was clean, so this gate is cheap and it works.

**Hand-back claims.** An empty hand-back, or a "flaky / pre-existing / green alone" claim: run the checks in
`a1-new-feature/workflows/05-implement.md` Gate 0 before accepting (only when the claim occurs).

**Audit auto-close (FR-022):** if the project has `docs/product/audits/*.md`,
check each new wave commit message for the explicit closing convention before
moving to the checkpoint — see "Audit Auto-Close" below.

**If PARTIAL (some tasks blocked):**
Show which tasks are blocked and why.
Ask: "Wave <N> is partially complete. <N> tasks blocked. Continue to next wave or stop?"

**If BLOCKED (wave couldn't start):**
Surface error to user. Do not continue.

### 2b-g. Per-wave deterministic gates (spec 017)

Runs once per wave in the COMPLETE branch, after the commit-landed gate and before
2b-v. Each call carries `--phase <phase_name>` (the gate-log scope) and its exit code is
tested. **Any non-zero exit stops the wave**: no 2b-v, no 2c checkpoint, no next wave. Fix
the cause and re-run the failed call. Calls run in this order:

```bash
node <repo>/_shared/a1-tools.cjs realpath-check run --diff-base "$PRE_WAVE_HEAD" --project "$WORK_PATH" --phase <phase_name>; RC=$?
echo "realpath-check exit=$RC"
if [ $RC -ne 0 ]; then echo "STOP: realpath-check red, wave not signed off (needs .a1/realpath-evidence.md)"; fi
```

Migration waves only (the diff adds or changes SQL migrations); skip this block otherwise:

```bash
node <repo>/_shared/a1-tools.cjs schema-check run --migrations "$WORK_PATH/<migrations dir>" --phase <phase_name>; RC=$?
echo "schema-check exit=$RC"
if [ $RC -ne 0 ]; then echo "STOP: schema-check red, wave not signed off"; fi
```

```bash
node <repo>/_shared/a1-tools.cjs test-fidelity --diff-base "$PRE_WAVE_HEAD" --project "$WORK_PATH" --phase <phase_name>; RC=$?
echo "test-fidelity exit=$RC"
if [ $RC -ne 0 ]; then echo "STOP: test-fidelity red (findings as JSON above)"; fi
```

Exit 1 of `test-fidelity` lists tests that mock the subject, are skipped, return early or do not
run in CI. Re-dispatch the executor to fix the test. The only other way out is a recorded
disposition (`disposition add --kind fidelity ... --reason <why> --by <agent>`); Reinhard reviews
it at PR review and an overturned one blocks the merge. There is no skip flag.

Intent child (`A1_INTENT_CHILD=1`): skip the block below. A child cannot run `verify run` (the spawn guard refuses it, exit 77).
Record "gate-1-build: verify deferred to owner" in the wave report instead. The owner runs `verify run` after the child ends and
before any merge; `pr merge-check` runs the suites itself, so a deferred gate never lets a red suite through.

```bash
node <repo>/_shared/a1-tools.cjs verify run --project "$WORK_PATH" --phase <phase_name>; RC=$?
echo "verify run (gate-1-build) exit=$RC"
if [ $RC -ne 0 ]; then echo "STOP: gate-1-build red (verdict fail or no test command)"; fi
```

Multi-lane: run the block per lane with the lane's own `$WORK_PATH` and `$PRE_WAVE_HEAD`.

### 2b-d. Design review (only waves that changed a design file)

Spec 025 FR-013. Runs once per wave in the COMPLETE branch, after 2b-g has passed and before 2b-v. Only
design files are reviewed: ADRs under `docs/adr/` and documents under `docs/architecture/` that the wave
changed. A code diff is never sent. `design-targets` reads the wave diff against `"$PRE_WAVE_HEAD"` and lists
only those design files that have no pass on their current body; an empty list means skip this block.

Run the block from the wave's own worktree: both commands resolve the repo from the current directory, so from
the primary checkout they would diff and read the wrong tree and the review would silently miss the wave's files.

```bash
( cd "$WORK_PATH" || { echo "STOP: cannot enter WORK_PATH=$WORK_PATH"; exit 2; }
XREVIEW_DIR=".a1/phases/<phase_name>/xreview"
mkdir -p "$XREVIEW_DIR"
TARGETS_JSON="$XREVIEW_DIR/design-targets.wave.last-run.json"
TARGETS_LIST="$XREVIEW_DIR/design-targets.wave.list"
node <repo>/_shared/a1-tools.cjs xprov design-targets --phase <phase_name> --base "$PRE_WAVE_HEAD" > "$TARGETS_JSON"; RC=$?
echo "xprov design-targets exit=$RC"
if [ $RC -ne 0 ]; then echo "STOP: design-targets usage error, fix the call"; exit "$RC"; fi
node -e 'for (const t of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).targets) console.log(t)' "$TARGETS_JSON" > "$TARGETS_LIST"
while IFS= read -r f; do
  OUT="$XREVIEW_DIR/design-review-$(printf '%s' "$f" | tr '/' '_').wave.last-run.json"
  node <repo>/_shared/a1-tools.cjs xprov gate --gate design-review-xprov --phase <phase_name> --doc "$f" > "$OUT"; RC=$?
  echo "xprov gate design-review-xprov $f exit=$RC"
  if [ $RC -eq 2 ]; then echo "STOP: usage error for $f, fix the call (not a review result)"; exit 2; fi
done < "$TARGETS_LIST"
); RC=$?
echo "design review block exit=$RC"
```

Only exit 2 stops the wave (a non-zero exit of the block means stop, fix the call). Routing per file (`verdict` in the stdout JSON): `pass` → continue; `fail` or `fail-with-findings` (also when the gate answers an unchanged file from its recorded result with no Codex call) → print
`⚠ Design review did not pass (gate design-review-xprov, enforcement: warning) — <file>: <reason>, details <xreview_path>`
and continue (the row is `warning`); `not_applicable` (no permit, `codex_unavailable`, any other reason) → print one line
`ℹ Design review not applicable for <file> — <reason>; Reinhard-only, continuing.` and continue. No consent question is asked
here. Record one `gates_fired` line per file in the retro: `{id: design-review-xprov, verdict: <pass|fail|not_applicable>, caught: false}`.
Multi-lane: run per lane with the lane's own `$PRE_WAVE_HEAD` and `$WORK_PATH`.

### 2b-v. Vault phase mirror (spec 010, FR-008)

Runs once per wave in the COMPLETE branch — after 2b-g has passed and before the 2c
checkpoint. The
executor has updated STATUS.md for this wave; the vault cockpit reads
`project/<slug>/phases/` from the vault, never the repo, so without this step
it shows the state before the wave. Run it from `$WORK_PATH` — `vault sync`
mirrors the checkout it is started in, and the primary checkout does not
carry this wave's STATUS.md (same silent failure as the commit-landed gate).
Multi-lane runs: once per lane wave, from that lane's `$WORK_PATH`.

`<project-slug>` is the `project:` of `docs/product/ROADMAP.md`; a repo
without a roadmap passes `--slug <slug>` instead, to the `vault sync` line (phases
only) and to the `dashboard build` line alike. Skipped
silently when `A1_VAULT_ROOT` is not set (tier repo-local). A failed sync is a
warning in the 2c summary, never a reason to stop the wave:

```bash
if [ -n "${A1_VAULT_ROOT:-}" ]; then
  VSYNC_OUT="$(mktemp)"
  (cd "$WORK_PATH" && node <repo>/_shared/a1-tools.cjs vault sync <project-slug> --phases) > "$VSYNC_OUT"; RC=$?
  if [ $RC -ne 0 ]; then echo "⚠ vault sync --phases exit=$RC — vault mirror not updated, continuing (stderr above, JSON in $VSYNC_OUT)"; fi
  (cd "$WORK_PATH" && node <repo>/_shared/a1-tools.cjs dashboard build <project-slug>) >/dev/null; RC=$?
  if [ $RC -ne 0 ]; then echo "⚠ dashboard build exit=$RC — dashboard not refreshed, continuing"; fi
fi
```

### 2c. Checkpoint

Present wave summary:
```
Wave <N> — <name> ✓ Complete
Tasks done: <N>/<N>
Commits: <list>
Deviations: <list or "none">
Vault mirror: <✓ synced | ⚠ sync exit <RC> | – no vault root>

→ Next: Wave <N+1> — <name> (<N> tasks)
Continue? [y to proceed / n to stop]
```

**Mid-run decision (before the next wave).** If the user changed a requirement during this
wave — scope cut, altered success criterion, "do it differently" — append it to
`.a1/phases/<phase_name>/GOAL.md` under `## Decisions` now:
`- <date> — <decision> — affects: <success criterion or task id>`. GOAL.md missing (a phase
planned by `a1-plan` without a roadmap scaffold — 8 of 8 phases in this repo) → create it with
`# Goal: <phase_goal from the PLAN.md frontmatter>` and the `## Decisions` heading. PLAN.md stays as loaded
(its sha is bound by `--expect-sha`); Victor reads `## Decisions` as amendments to the
success criteria (03-verify.md). A decision that lives only in the chat is verified against
the old criterion (2026-10-15 captrader 012, 2026-10-08/09 ai-net M1-P1/P2).

Wait for user input before starting next wave.

## Audit Auto-Close (FR-022, spec `003-product-schema-v1.1-vision-audits`)

Wave commits can close tracked audit findings the same way a fix commit can.
This check runs once per wave, in Step 2b's COMPLETE branch, after the commit
list is retrieved and before the Step 2c checkpoint is shown.

**When it applies:** only if the project has `docs/product/audits/*.md`
(schema v1.1). If not, skip this section entirely — no note needed.

**Detection logic:** for each commit message in the wave's `git log` output,
match against:

```
/\b(closes?|fix(?:es|ed)?)\s+F-(\d{3})\b/i
```

- The keyword (`Closes`/`Close`/`Fixes`/`Fix`/`Fixed`, case-insensitive) MUST
  immediately precede the `F-0NN` token — e.g. `Closes F-007` or
  `Fixes F-012` match; a commit that merely mentions `F-007` in passing,
  without one of these keywords right before it, does NOT match and MUST NOT
  auto-close anything. This mirrors `a1-fix`'s identical Step 4.5 logic
  (`skills/a1-fix/workflows/03-fix.md`) — same regex, same rationale (a bare
  substring match is too false-positive-prone per FR-022).

**If a commit matches:** resolve which audit file contains the extracted
`F-0NN` finding id by searching `docs/product/audits/*.md` for a
`findings[]` entry with that `id`, then auto-call (no extra confirmation
step — the explicit convention is the deliberate signal):

```bash
node <repo>/_shared/a1-tools.cjs product audit-set \
  --audit <resolved-audit-path> \
  --finding <finding-id> \
  --status fixed \
  --commit <commit-sha>
```

**If no audit file contains the finding id** (or the project has no
`docs/product/` at all): skip silently and mention it in the wave summary
shown at the Step 2c checkpoint, e.g. "Commit `<sha>` used `Closes F-007`
but no audit file declares finding F-007 — skipped auto-close." Do not block
the checkpoint on this.

**If `audit-set` itself fails** (finding already `fixed`, invalid `--feature`
id, etc.): surface the CLI error in the wave summary as a note; never fail
the wave or block the checkpoint because of it.

## After all waves

Proceed to Phase 3 (Verify) automatically.
