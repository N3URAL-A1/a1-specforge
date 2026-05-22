# Phase 04 — Verify

Goal: confirm the fix actually removed the symptom. Output: `status: fixed` with
`verify_result` recorded — or, if the symptom is still there, back to Phase 2
with the new data point.

## Inputs

- Vault path to the bug-report file (status must be `fixing`, `fix_commit` set)

If `fix_commit` is null: abort and tell the user that Phase 3 is not
complete (no commit recorded).

## Step 1 — Re-run reproduction

Read the bug report's `## Reproduction Steps` section. Walk the user through
each step one at a time:

> "Verify step 1: <step>. Does the symptom still occur?"

Wait for an answer before moving to the next step. If the user reports the
symptom is gone at any step where it was previously reproducible: continue.
If the user reports the symptom still appears: stop the walk-through and skip
to Step 4 (back to Phase 2).

## Step 2 — Optional: Quak QA-regression for severity ≥ MAJOR

If `severity` is `blocker` or `major`, propose a QA regression run:

> "Severity is <severity>. I can trigger Quak for a QA regression suite
> to make sure the fix didn't break anything else. Would you like that?"

If yes: spawn Quak via `Task` with this brief:

> You are Quak. Task: QA regression for a freshly fixed bug.
> **Bug report:** <ABSOLUTE_VAULT_PATH>
> **Fix commit:** <hash>
> **Affected repos:** <list>
>
> Read the bug report, identify critical user journeys that could be affected
> by the fix, and run the project's regression suite (E2E + integration).
> Output: pass/fail per suite plus list of new failures (if any).

If Quak reports failures: do NOT mark `fixed`. Add failures to `## Notes` and
recommend re-opening (Step 4).

## Step 3 — Mark fixed

If reproduction confirms symptom is gone (and Quak is green or skipped):

1. Build a one-line `verify_result` string:
   `"<YYYY-MM-DD>: symptom not reproducible after commit <short-hash>; regression: <passed|skipped>"`

2. Run:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" fixed \
  --verify-result "<verify_result_string>"
```

3. Use the Edit tool to fill the `## Verification (Phase 04 — filled by skill)`
   section in the bug report with the verification details.

4. Tell the user:

> "Fix verified. Status: fixed. Bug report:
> `projects/<slug>/fixes/<file>`. Audit trail complete in `phase_history`."

## Step 4 — Symptom still present → back to Phase 2

If the user reports the symptom remains, OR Quak finds a regression:

1. Capture what we learned:
   - Which step reproduced it (or which Quak suite failed)
   - Whether anything changed in behavior (partial fix?)
2. Append to `## Notes` in the bug report:

   ```
   - <YYYY-MM-DD HH:MM> Verify after fix_commit <hash>: symptom still present.
     Detail: <one paragraph with new evidence>
   ```

3. Set verify_result and reset status:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" diagnosed \
  --verify-result "<YYYY-MM-DD>: fix incomplete — <one-line>"
```

   We move back to `diagnosed` (not `reported`), so Phase 2 can refine the
   diagnosis with the new data point. The `verify_result` becomes input to the
   next diagnosis round.

4. Tell the user:

> "Symptom still present. Status back to `diagnosed`. Should I restart Phase 2
> with the new findings?"

If yes: proceed to `02-diagnose.md`. Falk should read `## Notes` plus the new
`verify_result` as additional evidence.

## Special exits

- **User wants to close as wont-fix:** run
  `a1-tools fix update-status <bug-path> wont-fix --verify-result "<reason>"`.
  The slot stays.

---

## Retro (mandatory, after every terminal verdict)

Run this once the bug reaches a terminal status (`fixed`, `wont-fix`, `cant-reproduce`,
`duplicate`). Takes ~2 minutes. Do not skip. Used by `a1-evolve` for pattern clustering.

### Step 1 — Append to local cache

```bash
cat >> ~/.claude/skills/a1-fix/_learning.md <<EOF
---
date: <YYYY-MM-DD>
bug: <bug-slug>
project: <project-slug>
severity: <blocker|major|minor|nit>
terminal_status: <fixed|wont-fix|cant-reproduce|duplicate>
diagnosis_confidence: <low|medium|high>
diagnosis_rounds: <1|2|...>
root_cause_class: [<from: missing_wiring, schema_flaw, regression, race_condition, env_config, third_party_change, ui_state_bug, auth_tenant, spec_omission, off_by_one>]
fix_required_test_first: <true|false>
quak_regression: <passed|failed|skipped>
phase_that_produced_most_friction: <report|diagnose|fix|verify>
one_line_learning: <what would have prevented the bug, or shortened triage/diagnosis>
EOF
```

### Step 2 — Append the same entry to the Vault

```
~/Documents/Obsidian Vault/areas/a1-learnings/a1-fix.md
```

Use the `root_cause_class` tags consistently — they feed into `patterns.md` clustering:
`missing_wiring` | `schema_flaw` | `regression` | `race_condition` | `env_config` | `third_party_change` | `ui_state_bug` | `auth_tenant` | `spec_omission` | `off_by_one`

For `cant-reproduce` / `duplicate`: still write the entry — the recurrence signal is valuable.

### Step 3 — Threshold check

```bash
ENTRY_COUNT=$(grep -c "^date:" ~/.claude/skills/a1-fix/_learning.md 2>/dev/null || echo 0)
```
If `$ENTRY_COUNT` is a multiple of 5:
> "5 neue Bug-Learnings akkumuliert — in Vault unter [[areas/a1-learnings/index]] gespeichert. `a1-evolve` ausführen?"
