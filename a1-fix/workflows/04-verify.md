# Phase 04 — Verify

Goal: confirm the fix actually removed the symptom. Output: `status: fixed` with
`verify_result` recorded — or, if the symptom is still there, back to Phase 2
with the new data point.

## Inputs

- Vault path to the bug-report file (status must be `fixing`, `fix_commit` set)

If `fix_commit` is null: abort and tell the user in German that Phase 3 is not
complete (no commit recorded).

## Step 1 — Re-run reproduction

Read the bug report's `## Reproduction Steps` section. Walk the user through
each step **in German**, one at a time:

> "Verify Schritt 1: <step>. Tritt das Symptom noch auf?"

Wait for an answer before moving to the next step. If the user reports the
symptom is gone at any step where it was previously reproducible: continue.
If the user reports the symptom still appears: stop the walk-through and skip
to Step 4 (back to Phase 2).

## Step 2 — Optional: Quak QA-regression for severity ≥ MAJOR

If `severity` is `blocker` or `major`, propose a QA regression run **in German**:

> "Severity ist <severity>. Ich kann Quak für eine QA-Regression-Suite
> anstoßen, um sicherzugehen, dass der Fix nichts anderes gebrochen hat.
> Möchtest du das?"

If yes: spawn Quak via `Task` with this brief:

> Du bist Quak. Aufgabe: QA-Regression für einen frisch gefixten Bug.
> **Bug-Report:** <ABSOLUTE_VAULT_PATH>
> **Fix-Commit:** <hash>
> **Affected Repos:** <list>
>
> Lies den Bug-Report, identifiziere kritische User-Journeys, die durch den
> Fix berührt sein könnten, und führe die Regression-Suite des Projekts aus
> (E2E + Integration). Output: pass/fail pro Suite plus Liste neuer Failures
> (falls vorhanden).

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

4. Tell the user **in German**:

> "Fix verifiziert. Status: fixed. Bug-Report:
> `projects/<slug>/fixes/<file>`. Audit-Trail vollständig in
> `phase_history`."

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

4. Tell the user **in German**:

> "Symptom noch da. Status zurück auf `diagnosed`. Soll ich Phase 2 erneut
> starten mit den neuen Erkenntnissen?"

If yes: proceed to `02-diagnose.md`. Falk should read `## Notes` plus the new
`verify_result` as additional evidence.

## Special exits

- **User wants to close as wont-fix:** run
  `a1-tools fix update-status <bug-path> wont-fix --verify-result "<reason>"`.
  The slot stays.
