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

**Audit auto-close (FR-022):** if the project has `docs/product/audits/*.md`,
check each new wave commit message for the explicit closing convention before
moving to the checkpoint — see "Audit Auto-Close" below.

**If PARTIAL (some tasks blocked):**
Show which tasks are blocked and why.
Ask: "Wave <N> is partially complete. <N> tasks blocked. Continue to next wave or stop?"

**If BLOCKED (wave couldn't start):**
Surface error to user. Do not continue.

### 2b-x. Cross-provider wave inspection (gate `wave-inspect-xprov`)

Runs once per wave in the COMPLETE branch — **after** the commit-landed gate
has passed (HEAD is the evidence the inspector reads) and **before** the 2c
checkpoint. Sends the wave diff `$PRE_WAVE_HEAD..HEAD` of `$WORK_PATH` to Codex
through the vendored runner in `inspect` mode (spec 009, FR-004). The driver
snapshots `$WORK_PATH` at wave HEAD itself — never point it at the primary
checkout (same silent failure as the commit-landed gate above).

```bash
XREVIEW_DIR=".a1/phases/<phase_name>/xreview"
mkdir -p "$XREVIEW_DIR"
INSPECT_OUT="$XREVIEW_DIR/wave-inspect-xprov.wave-<N>.last-run.json"
node <repo>/_shared/a1-tools.cjs xprov gate --phase <phase_name> --gate wave-inspect-xprov --wave <N> --base $PRE_WAVE_HEAD --work-path $WORK_PATH > "$INSPECT_OUT"; RC=$?
echo "xprov gate wave <N> exit=$RC"
```

**Multi-lane form:** one call per lane wave, with the lane's own `$WORK_PATH`
and `$PRE_WAVE_HEAD`, plus `--lane <lane-id>` so the `index.json` entry carries
the lane. Lane inspections are independent — a blocked storage lane must not
hold up a green runtime lane, exactly as the per-lane checkpoint rule says.

```bash
node <repo>/_shared/a1-tools.cjs xprov gate --phase <phase_name> --gate wave-inspect-xprov --wave <N> --base $PRE_WAVE_HEAD --work-path $WORK_PATH --lane <lane-id> > "$INSPECT_OUT"; RC=$?
echo "xprov gate wave <N> lane <lane-id> exit=$RC"
```

Read `verdict`, `enforcement`, `reason`, `findings_path` and `next` from
`$INSPECT_OUT` (exit 0 = pass · 1 = fail, JSON names `reason` · 2 = usage, no
JSON — fix the call). `enforcement` echoes the `wave-inspect-xprov` row of
`_shared/gates-registry.md`; this step applies it, the driver never does.

| `verdict` | `enforcement` | Action |
|---|---|---|
| `pass` | any | Note "cross-provider inspected ✓" in the 2c summary. Proceed to 2c. |
| `not_applicable` (exit 1, `reason: external_review_denied`) | any | The owner denied external review for this repository (`xprov permit --deny`, confirmed by the owner's store); no Codex call happened. **Continue to 2c — do not halt.** Print `ℹ Wave <N> inspection not applicable — the owner denied external review for this repository; continuing.` in the 2c summary. Retro: `{id: wave-inspect-xprov, verdict: not_applicable, caught: false}` and the issue tag `xprov_not_applicable`. Not a pass; `wave-status` reports it under `not_applicable` and Phase 3 may start. |
| `fail-with-findings` | any | **Fix round in the same wave.** Re-dispatch a1-erik-executor with `<findings_path>` (Reinhard schema) and the instruction to fix every blocker/major or record why not (address every entry in `quarantined_blockers[]` as well, or state in the dispositions why not), commit, then re-run the commit-landed gate and this step again — same `--base $PRE_WAVE_HEAD` (the whole wave diff is re-inspected), **fresh session**: the driver never resumes a Codex session. Before the
re-run, write Erik's fix summary to the `next.dispositions_path` of the first
inspect (`xreview/wave-inspect-xprov-wave-<N>[-<lane>]-r1.dispositions.md`, one
line per finding id: fixed / not fixed + why); the driver refuses the fix round
without it and builds the reviewer's `--feedback` from round 1's normalized
findings plus that summary. One fix round per wave (`next.fix_round` is always 1); a second REVISE comes back as `fail` with `reason: round_cap`. Only `pass` and `fail-with-findings` count as rounds — a failed attempt (`blocked`, `runner_failed`, `tripwire`, `secret_*`) does not consume one, so fixing its cause and re-running this step is not a second round. |
| `fail` (any `reason`) | `warning` | Print the block below, proceed to 2c with the warning in the summary. Retro: `verdict: fail`. |
| `fail` (any `reason`) | `blocking` | **Do not show the 2c checkpoint as passable.** Print the block with the first line `❌ … enforcement: blocking`. Ways out: fix the cause and re-run this step, or a human waiver (below). Phase 3 will refuse to start while this wave lacks a pass or waiver (`wave-status`). |

```
⚠ Cross-provider wave inspection did not pass (gate wave-inspect-xprov, wave <N>, enforcement: warning)
   reason:   <reason>
   details:  .a1/phases/<phase_name>/XREVIEW.md (section for wave <N>)
   Continuing to the checkpoint because the registry row is still `warning`.
```

**Waiver — human only.** When the provider is down or the user accepts the
risk, tell the user the command and wait; the human runs
`a1-tools xprov waive --phase <phase_name> --gate wave-inspect-xprov --wave <N> --base $PRE_WAVE_HEAD --work-path $WORK_PATH --reason "<text>" --by <name>`
in a separate terminal. It runs only in the owner's own terminal — never through an agent's Bash tool or the `!` prefix: like the allowlist owner approval it refuses without a TTY, under Claude Code's environment or with a Claude Code ancestor, and, in a1-specforge itself, the project's PreToolUse hook denies any Bash command containing it (the plugin does not ship the hook to other repositories; there the TTY/ancestor guard is the control). It shows the key it computed itself (the PLAN.md sha256, the work path's HEAD and the full
base sha), asks for the gate id typed back and records the waiver in
`~/.a1-xprov/waivers.json`; `index.json` gets a mirror row without authority.
It is never `verdict: pass`. `wave-status` counts it only while PLAN.md keeps
that sha and the waived head stays in the work path's history. This skill
never executes it (fixture R7 greps every `bash` block for it). Record `xprov_waived` in the
retro's `issue_classes` when a waiver exists — a1-execute's own tag field
(a1-plan uses the base `issues` field of `_shared/retro-template.md`; a1-evolve
reads both).

The driver already wrote the observation (`agent: xprov-codex`) and the
XREVIEW.md section; do not duplicate them. Per wave, the retro's `gates_fired`
gets `{id: wave-inspect-xprov, verdict: <pass|fail>, caught: <true if a finding forced a fix round>}`
(`03-verify.md` Retro block).

**Edge cases (2b-x):**

- **Exit 2 (usage / module not shipped).** No stdout JSON. Do not route; fix
  the call — the most common cause is a missing `--phase <phase_name>`.
- **Preflight FAIL `plugins_cache_empty`.** Codex has installed plugins into
  `$CODEX_HOME/plugins/cache/` on its own (measured 2026-09-24: the
  `openai-curated-remote` set); `init-home` never deletes anything, so the home
  stays non-compliant until a human acts. Remedy: `rm -rf ~/.codex-a1-review/plugins`
  — ONLY the dedicated review home, never `~/.codex` — then check
  `codex features disable plugins` and the `remote_plugin` feature flag so it
  does not come back. Alternative: pass `--allow-plugins <name>` on the gate
  call to allowlist a plugin you have read; the driver hands the flag through to
  `preflight`. Then re-run this step — a failed attempt consumed no fix round.
- **`tripwire`, `secret_in_snapshot`, `secret_in_output`, `quarantined`.** The
  result was discarded by design; XREVIEW.md carries a BLOCKER note naming the
  cause in the worktree. Read it before re-running.

### 2b-v. Vault phase mirror (spec 010, FR-008)

Runs once per wave in the COMPLETE branch — after 2b-x has written its
`xreview/` files, whatever its verdict, and before the 2c checkpoint. The
executor has updated STATUS.md for this wave; the vault cockpit reads
`project/<slug>/phases/` from the vault, never the repo, so without this step
it shows the state before the wave. Run it from `$WORK_PATH` — `vault sync`
mirrors the checkout it is started in, and the primary checkout does not
carry this wave's STATUS.md (same silent failure as the commit-landed gate).
Multi-lane runs: once per lane wave, from that lane's `$WORK_PATH`.

`<project-slug>` is the `project:` of `docs/product/ROADMAP.md`; a repo
without a roadmap passes `--slug <slug>` instead (phases only). Skipped
silently when `A1_VAULT_ROOT` is not set (tier repo-local). A failed sync is a
warning in the 2c summary, never a reason to stop the wave:

```bash
if [ -n "${A1_VAULT_ROOT:-}" ]; then
  VSYNC_OUT="$(mktemp)"
  (cd "$WORK_PATH" && node <repo>/_shared/a1-tools.cjs vault sync <project-slug> --phases) > "$VSYNC_OUT"; RC=$?
  if [ $RC -ne 0 ]; then echo "⚠ vault sync --phases exit=$RC — vault mirror not updated, continuing (stderr above, JSON in $VSYNC_OUT)"; fi
fi
```

### 2c. Checkpoint

**This wave is covered at its own HEAD (spec 009 FR-004).** Before the
summary, check the wave just inspected — or waived — against the work path as
it is now:
```bash
node <repo>/_shared/a1-tools.cjs xprov wave-status --phase <phase_name> --work-path $WORK_PATH > .a1/phases/<phase_name>/xreview/wave-status.last-run.json; RC=$?
echo "xprov wave-status (after wave <N>) exit=$RC"
```
(multi-lane, per lane checkpoint: `--waves <N> --lane <lane-id> --lane-work-path <lane-id>=$WORK_PATH`
checks that lane's pair (N, lane-id) against that lane's HEAD). The covered waves must form a chain: each wave's recorded
head equals the next wave's base, and the last completed wave's head equals
`$WORK_PATH`'s HEAD — only commits that write the workflow's own files may
sit after it or between two waves: the phase's STATUS*.md, VERIFICATION.md,
observations.jsonl, PLAN-REVIEW-LOG.md, XREVIEW.md, xreview/*.json|*.md and
what `product stage` writes at 2c (docs/product ROADMAP.md, index.json,
NEXT.md, CHANGELOG-archive.md, features/<id>/feature.md, .a1/reservations.json),
each as a plain file. A commit added after the inspection is
unreviewed and fails the check. Exit 1 under `blocking` → back to 2b-x
(re-inspect at the new HEAD) or the human waiver; under `warning` show the
checkpoint with the warning line.

Present wave summary:
```
Wave <N> — <name> ✓ Complete
Tasks done: <N>/<N>
Commits: <list>
Deviations: <list or "none">
Cross-provider inspection: <✓ pass | ⚠ fail/<reason> (warning) | waived by human>
Vault mirror: <✓ synced | ⚠ sync exit <RC> | – no vault root>

→ Next: Wave <N+1> — <name> (<N> tasks)
Continue? [y to proceed / n to stop]
```

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
