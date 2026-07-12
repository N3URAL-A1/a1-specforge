# Phase 06 — Execute

Goal: implement each wave with behavior parity guaranteed. Per wave:
snapshot → test-skeleton → implement → unit-tests → parity-verify → commit.

**Stop-gate G4 before each wave (Robert approves), G5 after each wave.**

## Wave loop

Repeat for each wave in dependency order.

---

### Pre-wave: Gate G4

Present the wave brief to Robert:

```
Wave <W-NN>: <title>

Goal: <goal sentence>
FRs:
  - FR-001 — AC: <behavioral sentence>
  - FR-002 — AC: ...
Deployment chain: <migrations, ENV vars, services>
Rollback: <how to undo>
Dependencies: <W-XX done ✅>

Shall I start this wave?
```

Do not start until Robert confirms.

---

### Step 1: Behavior Snapshot

Before any code changes, freeze the current behavior baseline.

If tests exist:
```bash
# Run existing tests and capture results
cd "<analyzed_path>"
<test-runner> 2>&1 | tee .a1/phases/<slug>/waves/<wave-id>/snapshot-pre.txt
```

If no tests exist:
```bash
# Document manual smoke steps
node <repo>/_shared/a1-tools.cjs modernize snapshot-behavior \
  "<master-path>" \
  --manual-smoke ".a1/phases/<slug>/waves/<wave-id>/smoke-steps.md"
```

Write smoke steps document listing: which screens/routes to visit, what to
check, expected outcomes. Robert confirms the steps are correct before proceeding.

```bash
node <repo>/_shared/a1-tools.cjs modernize start-wave "<master-path>" <wave-id>
```

---

### Step 2: Test Pattern Lookup

Spawn `a1-theo-test-engineer`:

```
Stack: <from discover.tech_stack>
Component type: <type of code being changed in this wave>
Component path: <path to source file>
Wave brief: <wave goal + FRs>
Output path: <test file path>
```

Review the skeleton Theo produces. Confirm parity assertions are present.

---

### Step 3: Implement

Spawn `a1-erik-executor` with the wave brief:

```
Wave: <W-NN> — <title>
Goal: <goal>
FRs with ACs: <list>
Deployment chain: <list>
Plan path: .a1/phases/<slug>/PLAN.md
Constraints:
  - Do not break any behavior outside this wave's FRs
  - Fill in Theo's test skeleton (path: <test-path>) after implementation
  - Write commit: "feat(modernize/<slug>): W-NN <title>"
  - No DB schema change without migration in this wave
```

---

### Step 4: Unit Tests (Erik fills Theo's skeleton)

After Erik's implementation, verify the test skeleton has been filled:

```bash
cd "<analyzed_path>"
<test-runner> <test-file-path> 2>&1
```

All tests (including parity assertions) must be GREEN before proceeding.
If any test is red: ask Erik to fix the implementation, not the test.

---

### Step 4b: Test Review (optional — Theo in review mode)

Optionally spawn `a1-theo-test-engineer` in review mode on the wave's filled tests:

```
Mode: review
Test file(s): <test-file-path(s)>
Wave brief: <wave goal + FRs>
```

Theo returns read-only findings — he never edits the tests. BLOCKER-class
findings (e.g. parity assertions removed or weakened, tests asserting the wrong
behavior, mocked-away real paths) loop back to `a1-erik-executor` for a fix
before proceeding to Step 5.

---

### Step 5: Parity Verification

Run the parity check:

```bash
node <repo>/_shared/a1-tools.cjs modernize verify-parity "<master-path>"
```

Exit-1 = behavior drift detected. Stop wave, ask Robert how to proceed.
Exit-0 = parity confirmed.

Also spawn `a1-victor-verifier`:

```
Wave: <W-NN>
Goal: <goal>
FRs with ACs: <list>
Commit: <hash>
Verify: does the codebase now deliver what the FRs + ACs promised?
Output: VERIFICATION.md at .a1/phases/<slug>/waves/<wave-id>/VERIFICATION.md
```

---

### Step 6: Gate G5 — Post-wave approval

Present to Robert:

```
Wave <W-NN> complete.

Changed files: <list>
Tests: <N> passing, 0 failing
Parity replay: ✅ green
FR-AC-Checks:
  - FR-001: ✅ <AC satisfied>
  - FR-002: ✅ <AC satisfied>

Commit: <hash> "<message>"

Deployment chain executed:
  - Migrations: <done/none>
  - ENV vars: <done/none>
  - Services restarted: <done/none>

Shall I continue with Wave <W-NN+1>?
```

Complete the wave in CLI:

```bash
node <repo>/_shared/a1-tools.cjs modernize complete-wave \
  "<master-path>" <wave-id> \
  --snapshot-replay pass \
  --fr-ac-checks '[{"id": "FR-001", "passed": true, "evidence": "..."}]'
```

---

### After all waves complete

Update status:

```bash
node <repo>/_shared/a1-tools.cjs modernize update-status \
  "<master-path>" executed \
  --phase-data '{"waves_completed": <N>, "commits": ["<hash1>", "..."]}'
```

Ask Robert:
> "All <N> waves complete. Shall I start Phase 7 (Publish — report to Notion)?"

Proceed to `07-publish.md`.
