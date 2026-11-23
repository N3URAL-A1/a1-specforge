# Phase 3: Verify

Spawn a1-victor-verifier to validate the completed work.

## Step 0.2 — Start `verify run` in the background (spec 027 FR-024)

Start the build/test run before Victor, so it runs while he reads the plan and the code. The run writes no `VERIFICATION.md`
(no `--out`: Victor's file would race with it) and carries no `--affected` (a Verify-step run covers the whole set). Victor's own
`verify run --out` then finds the cached result (same sha, same commands) and waits on no lock.

The marker directory lies in the git common dir (`--path-format=absolute` makes it absolute from any cwd, in a main checkout too),
outside the work tree, so repo content cannot write or commit into it. The block validates `<phase_name>` against
`^[A-Za-z0-9_][A-Za-z0-9._-]*$` (read through a quoted heredoc, as `02-execute.md` does), refuses a symlinked marker root, and empties the
directory it owns before it starts. The orchestrator strips all newlines from the name first. `$WORK_PATH` is the phase worktree.

<!-- a1:background id=verify-bg join=yes -->
```bash
IFS= read -r PHASE <<'A1_PHASE_EOF'
<phase_name>
A1_PHASE_EOF
case "$PHASE" in ""|[!A-Za-z0-9_]*|*[!A-Za-z0-9._-]*) echo "STOP: bad phase name"; exit 2;; esac
GC="$(git -C "$WORK_PATH" rev-parse --path-format=absolute --git-common-dir)"; RC=$?
if [ "$RC" -ne 0 ] || [ -z "$GC" ]; then echo "STOP: no git common dir exit=$RC"; exit 1; fi
if [ -L "$GC/a1-verify-bg" ]; then echo "STOP: $GC/a1-verify-bg is a symlink"; exit 1; fi
VBG="$GC/a1-verify-bg/$PHASE"
rm -rf "$VBG" && mkdir -p "$VBG" && chmod 700 "$VBG" || { echo "STOP: cannot prepare $VBG"; exit 1; }
( node <repo>/_shared/a1-tools.cjs verify run --project "$WORK_PATH" --phase <phase_name> > "$VBG/report.json"; RC=$?; echo "$RC" > "$VBG/rc.tmp" && mv "$VBG/rc.tmp" "$VBG/rc" ) > /dev/null 2>"$VBG/stderr.txt" & echo "$!" > "$VBG/pid"
echo "verify_report=$VBG/report.json verify_rc=$VBG/rc"
```

Put the two printed paths into Victor's brief (`verify_report:`, `verify_rc:`). A start that prints `STOP:` leaves Victor's brief without
them: he then runs `verify run --out` directly, as before. Never `pgrep` for the process and never `wait` on its pid (a later Bash
call is not the parent shell): the join below reads the files.

## Prompt template

```
Verify that the phase goal was achieved.

<files_to_read>
- .a1/phases/<phase_name>/PLAN.md
- .a1/phases/<phase_name>/STATUS.md — multi-lane phases: consolidate the
  per-lane STATUS-<lane-id>.md files into it BEFORE spawning Victor, otherwise
  he verifies against a file the lane executors never wrote
- <spec_path> (if available)
- .a1/phases/<phase_name>/GOAL.md (if it exists) — its `## Decisions` rows (written at 02-execute.md 2c)
  amend the success criteria: verify the decided state, not the original line
</files_to_read>

**Output path:** .a1/phases/<phase_name>/VERIFICATION.md
verify_report: <VBG>/report.json
verify_rc: <VBG>/rc
```

## After Victor returns: build/test evidence (spec 017, gate `gate-1-build`)

Join the background run first (`<!-- a1:join id=verify-bg -->` below). The wait is bounded (240 checks, 15 s apart, 60 minutes). The
recorded pid counts as alive only while `kill -0` succeeds, the process belongs to the current user and its command is a shell or node
(the recorded pid is the subshell that runs the node child); a dead process without an `rc` file ends the wait with
`background verify died`. Neither case is a verdict: the foreground `verify run --out` below always runs and is the evidence.

<!-- a1:join id=verify-bg -->
```bash
IFS= read -r PHASE <<'A1_PHASE_EOF'
<phase_name>
A1_PHASE_EOF
case "$PHASE" in ""|[!A-Za-z0-9_]*|*[!A-Za-z0-9._-]*) echo "STOP: bad phase name"; exit 2;; esac
VBG="$(git -C "$WORK_PATH" rev-parse --path-format=absolute --git-common-dir)/a1-verify-bg/$PHASE"
i=0; while [ ! -f "$VBG/rc" ] && [ $i -lt 240 ]; do
  BP="$(cat "$VBG/pid" 2>/dev/null)"
  case "$BP" in ""|*[!0-9]*) echo "background verify died (no valid pid)"; break;; esac
  if ! kill -0 "$BP" 2>/dev/null || [ "$(ps -o uid= -p "$BP" | tr -d ' ')" != "$(id -u)" ]; then [ -f "$VBG/rc" ] || echo "background verify died"; break; fi
  case "$(ps -o comm= -p "$BP" 2>/dev/null)" in bash|sh|dash|zsh|ksh|node|MainThread) ;; *) [ -f "$VBG/rc" ] || echo "background verify died (pid not ours)"; break;; esac
  sleep 15; i=$((i+1))
done
if [ -f "$VBG/rc" ]; then echo "background verify rc=$(cat "$VBG/rc")"; elif [ $i -ge 240 ]; then echo "WARN: background verify not finished after 60 min, running verify run directly"; fi
```

Victor's build/test evidence is the `verify_run` record in the VERIFICATION.md frontmatter, written
only by `verify run --out`. Re-run it (served from the sha + command cache when nothing changed)
and check it. Both calls carry `--phase <phase_name>` and both exit codes are tested:

```bash
node <repo>/_shared/a1-tools.cjs verify run --project "$WORK_PATH" --out .a1/phases/<phase_name>/VERIFICATION.md --phase <phase_name>; RUN_RC=$?
echo "verify run exit=$RUN_RC"
node <repo>/_shared/a1-tools.cjs verify check .a1/phases/<phase_name>/VERIFICATION.md; CHECK_RC=$?
echo "verify check exit=$CHECK_RC"
if [ $RUN_RC -ne 0 ] || [ $CHECK_RC -ne 0 ]; then echo "VERIFICATION.md cannot be PASS"; fi
```

`verify run` exit 1 (verdict `fail`) or `verify check` exit 1 (PASS without `verify_run`, verdict
not `pass`, or code changed since `head_sha`) means the verdict is FAIL: set `verdict: FAIL` in
VERIFICATION.md, list the failing command as a gap, route as FAIL below. Exit 2 (no test command,
bad config) is a stop: fix the project's `.a1/verify.json`, then re-run. Exit 2 with `error` `lock_timeout` is not a FAIL and not a config error: another local `verify run` held the CLI lock past 15 minutes (host busy); re-run when it is free. Never edit the
`verify_run` block by hand.

## Step 0 — Read `phase_kind` before choosing the build evidence

PLAN.md frontmatter carries `phase_kind: <code | no-code>` (owner:
`agents/a1-pablo-planner.md`). It selects which gate supplies the "is it
actually built" evidence — everything else in this workflow is unchanged.

| `phase_kind` | Gate | Evidence Victor must produce |
|---|---|---|
| `code` (default) | `gate-1-build` | build / type-check / test output, green |
| `no-code` | `phase-artifacts-exist` | per wave: every plan-declared artifact path exists AND satisfies the content assertion the plan names for it |

A `no-code` phase writes only outside the repo (vault notes, docs prose,
external channels), so a build cannot speak to it — and a missing
`phase_kind` reads as `code`, never as a waiver.

**Not to be confused with the `# no-code` task tag** used by the phantom
integration in Step 6.5 below. That tag marks a SINGLE task inside an ordinary
code phase as legitimately producing no artifact; `phase_kind: no-code` is a
property of the WHOLE phase and is what swaps the build gate. They are
independent: a `code` phase may contain `# no-code` tasks, and in a `no-code`
phase the phantom rules of Step 6.5 apply unchanged per task. **Existence alone is not the
gate**: `test -f` on a file the wave just created cannot fail, so each path
needs the plan's named content assertion beside it (invariant 8). Attribute the
gate that actually ran, not both:

```yaml
gates_fired:
  - {id: phase-artifacts-exist, verdict: pass, caught: false}
```

Motivated by 4 measured phases (n3ural-socialmedia M1-P1..P3, ai-server,
2026-09-16/17) verified against a build gate that could never go green.

## Per-AC verification table in VERIFICATION.md (mandatory — never omit)

The verification target is the SPEC's acceptance criteria, quoted VERBATIM — **not** the plan's
task wording. PLAN.md is only the route taken. VERIFICATION.md must contain this table, with one
row per acceptance criterion, the AC quoted directly from the spec file:

```
| Spec AC (quoted verbatim) | Result | Evidence |
|---|---|---|
| "<exact sentence copied from the spec file>" | ✓ / ✗ / partial | <file:line / route status / test exit / command output> |
```

Quote the ACs from the spec file, not from PLAN.md. Where a plan success-criterion has diluted or
reworded a spec AC, verify against the spec sentence — and record the divergence itself as a FINDING.

## Cost line in VERIFICATION.md (mandatory — never omit)

Directly after the verdict line in VERIFICATION.md, the verifier writes a `**Cost:**` line.

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

## Step 6.5 — Phantom integration (enforces — not warning-only)

Run `a1-phantom` over the completed plan to catch tasks claimed done but not actually built.
The `phantom check` CLI always exits 0 (so it stays usable standalone); **enforcement lives in
this verifier contract, not in the exit code.** Victor MUST translate phantom verdicts into
VERIFICATION.md findings as follows:

- **PHANTOM verdict on a task NOT tagged `# no-code`** → this becomes a **BLOCKER finding** in
  VERIFICATION.md. The overall verdict **cannot be PASS** while any such phantom BLOCKER is
  unresolved. List each under a `### Phantom BLOCKERs` heading with the task name and the
  claimed-but-missing artifact.
- **PHANTOM verdict on a task tagged `# no-code`** → not a finding (docs/analysis/coordination
  tasks legitimately produce no code). Note it as informational only.
- **Weak-match verdict (2-weak-token match — an artifact matched only on weak/ambiguous
  tokens)** → becomes a **"verify manually"** item listed in the report under a
  `### Verify manually (weak phantom matches)` heading. Not a BLOCKER, but Victor must surface it
  so a human confirms the artifact is the real one.

```
### Phantom BLOCKERs
- <task name> — claimed done but <artifact> not found (phantom PHANTOM, not `# no-code`)

### Verify manually (weak phantom matches)
- <task name> — matched only on weak tokens <tokens>; confirm the artifact is correct
```

If any Phantom BLOCKER is present and unresolved, the verdict routes to FAIL (or PARTIAL only if
the user explicitly accepts the gap) — never PASS.

## Routing by verdict

### PASS
```
✅ Phase complete: <goal>

All <N> success criteria verified.
Build: ✓  Tests: ✓  TypeScript: ✓

Commits: <list>

What's next?
- Deploy: use a1-checklist then Dirk/Dennis
- New phase: use a1-plan
- Check project status: use a1-progress
```

### PARTIAL
```
⚠ Phase mostly complete — <N> gaps remain:

<gap list>

Options:
1. Fix gaps now (I'll spawn a1-erik-executor for the specific missing pieces)
2. Accept and move on (gaps are minor)
3. Show full VERIFICATION.md
```

### FAIL
```
❌ Phase incomplete — <N> criteria not met:

<failure list>

I recommend targeted re-execution. Which gaps should I fix first?
```

For FAIL/PARTIAL re-execution: spawn a1-erik-executor with a targeted prompt listing only the missing work, not the full plan.

## Vault phase mirror (spec 010, FR-008)

After VERIFICATION.md is written and the verdict is presented — PASS,
PARTIAL or FAIL — and before the retro, mirror the phase into the vault so the
cockpit shows the verdict. `<project-slug>` is the `project:` of
`docs/product/ROADMAP.md`; a repo without a roadmap passes `--slug <slug>`
instead, to the `vault sync` line (phases only) and to the `dashboard build` line
alike. Skipped silently when `A1_VAULT_ROOT` is not set (tier
repo-local). A failed sync is a warning, never a change of verdict:

```bash
if [ -n "${A1_VAULT_ROOT:-}" ]; then
  VSYNC_OUT="$(mktemp)"
  node <repo>/_shared/a1-tools.cjs vault sync <project-slug> --phases > "$VSYNC_OUT"; RC=$?
  if [ $RC -ne 0 ]; then echo "⚠ vault sync --phases exit=$RC — vault mirror not updated, continuing (stderr above, JSON in $VSYNC_OUT)"; fi
  node <repo>/_shared/a1-tools.cjs dashboard build <project-slug> >/dev/null; RC=$?
  if [ $RC -ne 0 ]; then echo "⚠ dashboard build exit=$RC — dashboard not refreshed, continuing"; fi
fi
```

---

## Retro (mandatory, every run)

After presenting the verdict — PASS, PARTIAL, or FAIL — write one retro entry
per `_shared/retro-template.md` (entry format + write targets: learning store
first, dev cache best-effort), with skill = `a1-execute`.

### Step 1 — Gather observation metrics

```bash
OBS_FILE=".a1/phases/<phase_name>/observations.jsonl"
OBS_COUNT=$(wc -l < "$OBS_FILE" 2>/dev/null || echo 0)
MAJOR_COUNT=$(grep -c '"severity":"major\|critical"' "$OBS_FILE" 2>/dev/null || echo 0)
```

### Step 2 — Additional fields beyond the base schema

```
phase: <phase-name>
result: <pass|partial|fail>
waves_executed: <N>
observations_total: $OBS_COUNT
observations_major_plus: $MAJOR_COUNT
issue_classes: [<from: plan_drift, missing_dependency, wave_too_large, flaky_test, env_issue, spec_omission, unverifiable_criterion, blocker_unforeseen, xprov_waived, xprov_not_applicable, xprov_disposed>]
phase_that_produced_most_issues: <plan|implement|verify>
```

Use the `issue_classes` tags consistently — they feed `patterns.md`
clustering. A run with zero issues still gets an entry
(`observations_total: 0`).

**`gates_fired` is required** — a1-execute is the framework's main gate
consumer, so its retros are the primary source of gate-ROI data. Add one line
per gate that actually ran across this phase's waves, ids verbatim from
`_shared/gates-registry.md`:

```yaml
gates_fired:
  - {id: gate-0-self-report,  verdict: pass, caught: false}
  - {id: gate-0.6-schema,     verdict: pass, caught: false}
  - {id: gate-1-build,        verdict: fail, caught: true}
  - {id: gate-2-deploy,       verdict: pass, caught: false}
```

Set `caught: true` only where that gate surfaced a real problem (a wave that
had to be reworked because of it). A gate that fired and found nothing is
`caught: false` — that is the normal case and exactly the datapoint gate-ROI
needs; without those the framework cannot tell a cheap useful gate from an
expensive gate that has never caught anything.

Before appending this retro, validate the `gates_fired` block — full
contract and exit codes in `_shared/retro-template.md`, which is the owner
of this instruction:

```bash
GATE_LOG=".a1/phases/<phase_name>/gate-log.jsonl"
node <repo>/_shared/a1-tools.cjs gates fired --log "$GATE_LOG"; RC=$?
if [ $RC -ne 0 ]; then echo "gate log unreadable or broken (exit $RC) - fix it before the entry counts"; exit $RC; fi
node <repo>/_shared/a1-tools.cjs retro validate "$RETRO_FILE" --gate-log "$GATE_LOG" --phase retro-<phase_name>; RC=$?
if [ $RC -ne 0 ]; then echo "fix the gates_fired block above before the entry counts"; exit $RC; fi
```

### Step 3 — Threshold check

Count entries in the **learning store** (not the dev cache — plugin installs
have no cache):

```bash
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
ENTRY_COUNT=$(grep -c "^date:" "$VAULT/pattern/a1-learnings/a1-execute.md" 2>/dev/null || echo 0)
```
If `$ENTRY_COUNT` is a multiple of 5:
> "5 new learnings accumulated in the learning store. Run `a1-evolve`?"
