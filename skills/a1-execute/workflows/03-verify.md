# Phase 3: Verify

Spawn a1-victor-verifier to validate the completed work.

## Precondition — every completed wave inspected (`wave-status`)

Victor is not spawned while any completed wave lacks a `wave-inspect-xprov`
entry in `.a1/phases/<phase_name>/xreview/index.json` with `verdict: pass` or
a waiver in the guarded store `~/.a1-xprov/waivers.json`, both bound to this
PLAN.md, that wave and lane, and chained: each wave's head equals the next
wave's base, the last wave's head equals `$WORK_PATH`'s HEAD — in between
only commits that write the workflow's own phase files and the `product
stage` files as plain files (spec 009, FR-004, FR-007); a `waived: true`
row in `index.json` alone counts for nothing. The completed waves come from
`STATUS*.md` — consolidate the per-lane files first (see the prompt template
below); pass `--waves 1,2,3` only when STATUS is not yet consolidated.

```bash
mkdir -p .a1/phases/<phase_name>/xreview
node <repo>/_shared/a1-tools.cjs xprov wave-status --phase <phase_name> --work-path $WORK_PATH --expect-sha "$LOADED_PLAN_SHA" --wave-range "$WAVE_RANGES" > .a1/phases/<phase_name>/xreview/wave-status.last-run.json; RC=$?
# multi-lane: append --lane-work-path <lane-id>=<that lane's WORK_PATH>[,…] (a lane without one lacks)
echo "xprov wave-status exit=$RC"
```
`$WAVE_RANGES` as in `02-execute.md` 2c. `--expect-sha "$LOADED_PLAN_SHA"` binds the exemption to the PLAN.md accepted at Load (a different sha fails `plan_changed`); `--wave-range <N>=<PRE_WAVE_HEAD of wave N>..<HEAD after wave N>[,…]` gives wave-status the real diff of EVERY completed wave and wave-status verifies it against git: the ranges must tile (only the workflow's own files between them), end at the work path's tip and start where the branch leaves the default branch (`git merge-base`); any mismatch (`exempt_refused` in the JSON, with a reason) refuses all exemptions, so the waves lack. A wave that a later wave depends on counts as `scope_exempt` only when its diff is no security surface; a wave nobody depends on is exempt, and when its diff is surface it is listed under `deferred_to_pr`: name those waves in the PR body, the PR diff gate reviews them.

- **Exit 0** → continue to the prompt template. A non-empty `not_applicable`
  list in the stdout JSON means the owner denied external review for this
  repository (`xprov permit --deny`, confirmed by the owner's store): no wave was
  inspected and none is lacking. Record `{id: wave-inspect-xprov, verdict:
  not_applicable, caught: false}` in the retro with the issue tag
  `xprov_not_applicable`; it is not a pass.
  **Spec 016 accepted verdicts.** This step never asks the owner anything
  (the consent question belongs to `02-execute.md` 2b-x.0). The `not_applicable`
  list is also non-empty for a repository with no permit (`permit_state: absent`,
  `origin_changed` or `unbound_legacy`, reason `external_review_not_permitted`):
  exit 0, Reinhard-only, retro `{id: wave-inspect-xprov, verdict: not_applicable, caught: false}`
  with the issue tag `xprov_not_applicable` (see `issue_classes` below). For `origin_changed` or
  `unbound_legacy` the retro names the `permit_state` ("Codex review skipped: permit void (<state>)").
  A mismatch
  or broken state (`*_mismatch`, `audit_broken`, `invalid`) stays exit 1.
  **Placement (spec 016 FR-020).** Waves the placement rule exempts (no later wave depends on them, or the plan names no security
  surface for them and their real diff, `--wave-range`, is none either) are listed under `scope_exempt` and need no pass or waiver; a wave
  that has a gate row is judged on its rows. Retro: `{id: wave-inspect-xprov, verdict: not_applicable, caught: false}`
  with reason `scope_exempt` and the issue tag `xprov_not_applicable`.
  **Blocked fallback (spec 016 FR-026).** A wave Codex answered BLOCKED twice is covered by a1's marker in its run dir and listed under
  `blocked_fallback`: Reinhard is the only review for it. Retro: `{id: wave-inspect-xprov, verdict: not_applicable, caught: false}` with reason
  `codex_blocked_fallback` and the issue tag `xprov_not_applicable`.
- **Exit 1** → the stdout JSON lists the lacking waves. For each: go back to
  `02-execute.md` step 2b-x for that wave (re-run the inspection with that
  wave's `--base`), or the owner waives it. Main path: the chat waiver of
  `02-execute.md` 2b-x.0 item 5 (`xprov consent question --kind waiver --phase <phase_name>`,
  AskUserQuestion exactly as printed, `xprov consent ensure --kind waiver --phase <phase_name>` and `xprov consent waive --phase <phase_name>`).
  Fallback for headless runs only: the owner runs
  `a1-tools xprov waive --phase <phase_name> --gate wave-inspect-xprov --wave <N> --base <that wave's PRE_WAVE_HEAD> --work-path $WORK_PATH --reason "<text>" --by <name>`
  in a separate terminal (it refuses agent process trees); this skill never does. While the registry row says `warning`,
  an exit 1 here is the same warning block as in step 2b-x and Victor is
  spawned anyway (record `verdict: fail` in the retro); once `blocking`, stop
  here.
- **Exit 2** → usage error / module not shipped; no JSON. Fix the call.

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
```

## After Victor returns: build/test evidence (spec 017, gate `gate-1-build`)

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
bad config) is a stop: fix the project's `.a1/verify.json`, then re-run. Never edit the
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
instead (phases only). Skipped silently when `A1_VAULT_ROOT` is not set (tier
repo-local). A failed sync is a warning, never a change of verdict:

```bash
if [ -n "${A1_VAULT_ROOT:-}" ]; then
  VSYNC_OUT="$(mktemp)"
  node <repo>/_shared/a1-tools.cjs vault sync <project-slug> --phases > "$VSYNC_OUT"; RC=$?
  if [ $RC -ne 0 ]; then echo "⚠ vault sync --phases exit=$RC — vault mirror not updated, continuing (stderr above, JSON in $VSYNC_OUT)"; fi
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
  - {id: wave-inspect-xprov,  verdict: pass, caught: false}   # wave 1
  - {id: wave-inspect-xprov,  verdict: fail, caught: true}    # wave 2 — fix round forced
```

`wave-inspect-xprov` gets **one line per wave** (per lane wave in multi-lane
phases), `verdict: fail` for every non-pass outcome including a
`warning`-enforced continue, a `round_cap` (also one closed by `xprov dispose`: keep `verdict: fail` and add `xprov_disposed` to `issue_classes`) and a waived wave (a waiver is
never a pass — it additionally puts `xprov_waived` into `issue_classes`,
a1-execute's own tag field; a1-plan records the same waiver in the base
`issues` field of `_shared/retro-template.md`, and a1-evolve reads both).
`caught: true` only where the inspection forced a fix round that changed code.

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
