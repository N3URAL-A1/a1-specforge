# W2 fixture — the corrected capture-then-check form (SC-006)

This is the form now in `01-collect.md` after the 2026-09-11 fix: the node
command's own exit code is captured immediately into `RC`, and the pipeline
into `python3` used afterward is a separate statement that is never
status-tested. Must NOT be flagged.

```bash
ROOTS_JSON=$(node /repo/_shared/a1-tools.cjs learnings roots); RC=$?
if [ $RC -ne 0 ]; then
  echo "learnings roots failed (exit $RC)"
  exit $RC
fi
ROOTS=$(printf '%s' "$ROOTS_JSON" \
        | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["roots"]))')
```

Red-making change (per the wave plan's W2 row): widening the matcher to flag
any pipe near a status test, rather than requiring the pipe and the status
test to apply to the SAME pipeline.
