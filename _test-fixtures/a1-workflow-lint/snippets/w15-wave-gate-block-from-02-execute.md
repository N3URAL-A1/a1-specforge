### 2b-g. Per-wave deterministic gates (spec 017)

Runs once per wave in the COMPLETE branch, after the commit-landed gate and before
2b-x. Each call carries `--phase <phase_name>` (the gate-log scope) and its exit code is
tested. **Any non-zero exit stops the wave**: no 2b-x, no 2c checkpoint, no next wave. Fix
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

```bash
node <repo>/_shared/a1-tools.cjs verify run --project "$WORK_PATH" --phase <phase_name>; RC=$?
echo "verify run (gate-1-build) exit=$RC"
if [ $RC -ne 0 ]; then echo "STOP: gate-1-build red (verdict fail or no test command)"; fi
```

Multi-lane: run the block per lane with the lane's own `$WORK_PATH` and `$PRE_WAVE_HEAD`.

