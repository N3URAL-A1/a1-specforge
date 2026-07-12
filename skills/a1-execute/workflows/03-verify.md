# Phase 3: Verify

Spawn a1-victor-verifier to validate the completed work.

## Prompt template

```
Verify that the phase goal was achieved.

<files_to_read>
- .a1/phases/<phase_name>/PLAN.md
- .a1/phases/<phase_name>/STATUS.md
- <spec_path> (if available)
</files_to_read>

**Output path:** .a1/phases/<phase_name>/VERIFICATION.md
```

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
issue_classes: [<from: plan_drift, missing_dependency, wave_too_large, flaky_test, env_issue, spec_omission, unverifiable_criterion, blocker_unforeseen>]
phase_that_produced_most_issues: <plan|implement|verify>
```

Use the `issue_classes` tags consistently — they feed `patterns.md`
clustering. A run with zero issues still gets an entry
(`observations_total: 0`).

### Step 3 — Threshold check

Count entries in the **learning store** (not the dev cache — plugin installs
have no cache):

```bash
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
ENTRY_COUNT=$(grep -c "^date:" "$VAULT/pattern/a1-learnings/a1-execute.md" 2>/dev/null || echo 0)
```
If `$ENTRY_COUNT` is a multiple of 5:
> "5 new learnings accumulated in the learning store. Run `a1-evolve`?"
