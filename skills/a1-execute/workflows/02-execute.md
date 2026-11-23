# Phase 2: Execute Waves

Execute each wave via a1-erik-executor. Waves continue on their own while `wave next-check` prints `continue`; a stop reason (or `--checkpoint-each-wave`) asks the owner.

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

## Phase start (once per phase worktree, before the per-wave loop)

The event stores of this phase are `.a1/phases/<phase_name>/observations.jsonl` and `GOAL.md` (with a `## Decisions` heading).
`wave next-check` stops when either is missing (owner decision 2026-11-20, "missing source = stop"). This block creates what is
missing, registers the union merge for both paths and commits what it created or changed, so neither the commit-landed gate nor the
worktree exit meets an untracked store, and a missing store later means the run broke. It decides about the commit by the git state of
the two files, not by what it created itself: after a failed commit (a pre-commit hook, an index lock) a re-run commits the staged files.
`<phase_goal>` is substituted as one line inside the quoted heredoc, so quotes, `$(...)` and backticks stay literal. The orchestrator
strips all newlines from the goal first (a goal line equal to `A1_GOAL_EOF` would close the heredoc early) and checks `<phase_name>`
against `^[A-Za-z0-9_][A-Za-z0-9._-]*$` before running the block; a name that fails the check is a STOP, not a value to repair. The
block repeats the check on the `PHASE` value, which it reads through a quoted heredoc (`A1_PHASE_EOF`): single quotes alone are not
enough, because a name holding a single quote (`x'$(...)'`) ends the quoting and runs at the assignment, before the guard. The orchestrator
strips all newlines from the name too (a name line equal to `A1_PHASE_EOF` would close the heredoc early). A bad value is
`STOP: bad phase name`, exit 2, so a name that slipped through never reaches a path or a commit message.

```bash
{ IFS= read -r PHASE; if IFS= read -r EXTRA; then echo "STOP: bad phase name (more than one line)"; exit 2; fi; } <<'A1_PHASE_EOF'
<phase_name>
A1_PHASE_EOF
case "$PHASE" in ""|[!A-Za-z0-9_]*|*[!A-Za-z0-9._-]*) echo "STOP: bad phase name"; exit 2;; esac
P="$WORK_PATH/.a1/phases/$PHASE"; mkdir -p "$P"
if [ ! -e "$P/observations.jsonl" ]; then : > "$P/observations.jsonl"; fi
if [ ! -e "$P/GOAL.md" ]; then
  cat > "$P/GOAL.md" <<'A1_GOAL_EOF'
# Goal: <phase_goal>

## Decisions
A1_GOAL_EOF
fi
if ! grep -qE '^##[[:space:]]+Decisions[[:space:]]*$' "$P/GOAL.md"; then printf '\n## Decisions\n' >> "$P/GOAL.md"; fi
A="$(git -C "$WORK_PATH" rev-parse --path-format=absolute --git-common-dir)/info/attributes"; mkdir -p "${A%/*}"
for L in '.a1/phases/*/observations.jsonl merge=union' '.a1/phases/*/GOAL.md merge=union'; do grep -qxF "$L" "$A" 2>/dev/null || printf '%s\n' "$L" >> "$A"; done
if [ -n "$(git -C "$WORK_PATH" status --porcelain -- "$P/observations.jsonl" "$P/GOAL.md")" ]; then git -C "$WORK_PATH" add -- "$P/observations.jsonl" "$P/GOAL.md" && git -C "$WORK_PATH" commit -q -m "chore($PHASE): event stores" -- "$P/observations.jsonl" "$P/GOAL.md"; RC=$?; if [ "$RC" -ne 0 ]; then echo "STOP: event-store commit exit=$RC"; exit "$RC"; fi; fi
echo "event stores ready: $P"
```

On `STOP: event-store commit exit=<n>`: fix the cause (hook output above, a held `.git/index.lock` of this worktree), then run the block again.

Multi-lane: run it once in the phase worktree before the lane worktrees branch off; the lanes inherit the tracked stores, and the union
attribute lets the lane merges keep both sides' appended lines. The two `merge=union` lines stay in `<git-common-dir>/info/attributes`
(local, never committed, repo-wide for these two append-only paths: it applies to every worktree and every branch merge of this repository, so a merge of a foreign branch also unions the `GOAL.md` Decisions rows and `observations.jsonl` lines of that branch instead of conflicting). On `GOAL.md` a union merge also keeps both sides of a non-append
edit (for example a changed goal heading). To remove them, delete the two lines from that file:
`{ grep -vxF -e '.a1/phases/*/observations.jsonl merge=union' -e '.a1/phases/*/GOAL.md merge=union' "$A" || :; } > "$A.new" && mv "$A.new" "$A"` (with `$A` as set in the block; it drops exactly those two lines and no other).

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

Then run `date -u +%Y-%m-%dT%H:%M:%SZ` and keep the printed value as `<wave_start>` for this wave (shell state does not persist; it is
substituted literally into the `wave next-check` call in 2c).

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
<!-- a1:stop -->
Ask: "Wave <N> is partially complete. <N> tasks blocked. Continue to next wave or stop?"
<!-- /a1:stop -->

**If BLOCKED (wave couldn't start):**
Surface error to user. Do not continue.

### 2b-g. Per-wave deterministic gates (spec 017)

Runs once per wave in the COMPLETE branch, after the commit-landed gate and before
2b-v. The call carries `--phase <phase_name>` (the gate-log scope) and its exit code is
tested. **Any non-zero exit stops the wave**: no 2b-v, no 2c checkpoint, no next wave. Fix
the cause and re-run the call. The calls run in this order:

```bash
{ IFS= read -r PHASE; if IFS= read -r EXTRA; then echo "STOP: bad phase name (more than one line)"; exit 2; fi; } <<'A1_PHASE_EOF'
<phase_name>
A1_PHASE_EOF
case "$PHASE" in ""|[!A-Za-z0-9_]*|*[!A-Za-z0-9._-]*) echo "STOP: bad phase name"; exit 2;; esac
node <repo>/_shared/a1-tools.cjs wave checks "$PHASE" <N> --diff-base "$PRE_WAVE_HEAD" --project "$WORK_PATH" --phase "$PHASE"; RC=$?
echo "wave checks exit=$RC"
if [ $RC -ne 0 ]; then echo "STOP: wave checks red (checks[] above: gate, exit)"; fi
```

`wave checks` runs the three registry gates `gate-0.7-realpath` (needs `.a1/realpath-evidence.md` when it is red),
`gate-0.6-schema` and `test-fidelity` as children, one gate-log line each, and reports every child's exit in
`checks[]` even when an earlier one failed. On a migration wave (the diff adds or changes SQL migrations) add
`--migrations "$WORK_PATH/<migrations dir>"` before `--phase`; without it the schema check is skipped and
reported as skipped. Intent child (`A1_INTENT_CHILD=1`): `wave checks` starts node child processes, which the child's spawn guard refuses (exit 77, `wave checks` is excluded like `verify run`); record "wave checks: deferred to owner" in the wave report. The owner runs it over the whole phase diff in `03-verify.md` Step 0.1, before Victor and before any merge.

Exit 1 of `test-fidelity` lists tests that mock the subject, are skipped, return early or do not
run in CI. Re-dispatch the executor to fix the test. The only other way out is a recorded
disposition (`disposition add --kind fidelity ... --reason <why> --by <agent>`); Reinhard reviews
it at PR review and an overturned one blocks the merge. There is no skip flag.

Intent child (`A1_INTENT_CHILD=1`): skip the block below. A child cannot run `verify run` (the spawn guard refuses it, exit 77).
Record "gate-1-build: verify deferred to owner" in the wave report instead. The owner runs `verify run` after the child ends and
before any merge; `pr merge-check` runs the suites itself, so a deferred gate never lets a red suite through.

```bash
node <repo>/_shared/a1-tools.cjs verify run --project "$WORK_PATH" --affected --phase <phase_name>; RC=$?
echo "verify run (gate-1-build) exit=$RC"
if [ $RC -eq 2 ]; then echo "STOP: gate-1-build not run (exit 2: error lock_timeout = another local verify run held the CLI lock past 15 min, host busy, re-run, not red; any other error = usage or config)"; elif [ $RC -ne 0 ]; then echo "STOP: gate-1-build red (verdict fail, exit $RC)"; fi
```

Multi-lane: run the block per lane with the lane's own `$WORK_PATH` and `$PRE_WAVE_HEAD`, one lane after another, never concurrently: the CLI lock of `verify run` serialises local runs on one host, and a concurrent start only spends its 15-minute wait. Exit 2 with `error` `lock_timeout` means another run (another lane or session) held the lock: re-run, it is not red.

Reading the `verify run` record (spec 028): name every `skipped_on_host` id in the wave report and never count a skipped id as a pass (it did not run on this host); name every `env_red` entry (a known environment-red suite, excused on this platform only, never on a head-only red) and every `env_red_stale` warning (`warnings[]`: the entry is green or names no command, remove it from `.a1/verify.json`); copy each `hints` line into the report. `skipped_on_host`, `env_red_stale` and `hints` do not change the exit code; an `env_red` entry takes its id out of the verdict on this platform (under `--base` only when the id is red on base and head), and a run where zero commands ran fails with `all_commands_skipped_on_host`. None of this adds a step.

`--affected` runs the suites the `affected` map in `.a1/verify.json` selects for the branch's changed paths plus `smoke`; anything unmapped runs the full set. The record says `scope: "affected"` and is never Verify evidence: 03-verify.md runs the full set once. Name `affected.selection` and `affected.reason` in the wave report.

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

### 2c. Wave summary and next-check

Present wave summary:
```
Wave <N> — <name> ✓ Complete
Tasks done: <N>/<N>
Commits: <list>
Deviations: <list or "none">
Vault mirror: <✓ synced | ⚠ sync exit <RC> | – no vault root>

→ Next: Wave <N+1> — <name> (<N> tasks)
```

Then run `wave next-check <phase_name> <N> --since <wave_start> --project "$WORK_PATH"` (block below; add `--checkpoint-each-wave`
when the owner started the run with it).

```bash
NEXT="$(node <repo>/_shared/a1-tools.cjs wave next-check <phase_name> <N> --since <wave_start> --project "$WORK_PATH")"; RC=$?
echo "wave next-check: $NEXT (exit $RC)"
```

- `continue` (exit 0) → start Wave N+1 at once, no question.
- `stop:<reason>` (exit 1) → the stop block below.
- Exit 2 → STOP, fix the call.

<!-- a1:stop -->
Stop reasons (`stop:<reason>`):

| Reason | What to do |
|---|---|
| `gate_red` | fix the cause and re-run the failed gate call |
| `deviation` | read `observations.jsonl`; a missing file is itself the stop: recreate it per Phase start |
| `scope_change` | confirm the GOAL.md decision; a date-only row stops every wave of its day, rewrite it with an ISO timestamp to clear it |
| `agent_unnamed` | name the agent of the next wave in PLAN.md |
| `owner_requested` | the owner started the run with `--checkpoint-each-wave` |

Continue? [y to proceed / n to stop]
<!-- /a1:stop -->

Multi-lane: run `wave next-check` per lane with the lane's own `$WORK_PATH`. A lane's last wave hands over to the lane merge, not to
Wave N+1, so there only the gate, deviation and decision results count.

**Mid-run decision (before the next wave).** If the user changed a requirement during this
wave — scope cut, altered success criterion, "do it differently" — append it to
`$WORK_PATH/.a1/phases/<phase_name>/GOAL.md` under `## Decisions` now (where `wave next-check` reads it):
`- <ISO-8601 UTC timestamp from date -u +%Y-%m-%dT%H:%M:%SZ> — <decision> — affects: <success criterion or task id>`.
GOAL.md missing: create it per Phase start. PLAN.md stays as loaded
(its sha is bound by `--expect-sha`); Victor reads `## Decisions` as amendments to the
success criteria (03-verify.md). A decision that lives only in the chat is verified against
the old criterion (2026-10-15 captrader 012, 2026-10-08/09 ai-net M1-P1/P2).

After writing the row, commit it in that worktree at once (the file is tracked since Phase start, so no `git add`):

```bash
git -C "$WORK_PATH" commit -q -m "chore(<phase_name>): decision" -- ".a1/phases/<phase_name>/GOAL.md"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: store commit exit=$RC"; fi
```

On `STOP: store commit`: fix the cause (a held `.git/index.lock`, a hook) and commit again; an uncommitted row blocks the worktree exit.
Never commit while an executor works in that worktree (index lock): a decision taken during a wave is written and committed
after the wave's COMPLETE report and the commit-landed gate, before `wave next-check`; its ISO token is the time of the decision.
Erik's own `observations.jsonl` lines ride in his task commit; Victor's lines (03-verify) ride in the phase's closing commit with VERIFICATION.md.

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
