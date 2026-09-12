# W4 fixture — status-testing via `|| exit`, not `$?` (still a swallowed exit)

Same defect class as W1 (the pipeline's status, not the first command's, is
what gets tested) but expressed as `|| exit` directly on the pipeline instead
of a `$?` read on a following line. A matcher that implements ONLY the `$?`
form must miss this.

```bash
node /repo/_shared/a1-tools.cjs learnings roots | python3 -c 'import json,sys; json.load(sys.stdin)' || exit 3
```

Red-making change (per the wave plan's W4 row): implementing only the `$?`
form of the status-testing predicate, never the `|| exit`/`|| abort`/
`|| return` form.
