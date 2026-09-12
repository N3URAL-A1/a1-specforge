# W3 fixture — value-defaulting `|| echo <literal>` is not a swallowed exit

`... | grep -c ... || echo 0` is a legitimate default-on-no-match idiom:
`grep -c` exits 1 when it finds zero matches in its input (not an error
condition here), and the `|| echo 0` supplies the same "zero matches" value
that `grep -c` would have printed had it exited 0. No exit status is being
*tested* — the right-hand side never inspects `$?`, it just substitutes a
literal value. Must NOT be flagged.

Note: unlike `03-verify.md:140` (which is a single `grep -c` invocation with
no actual shell pipe — its `\|` is a literal alternation character inside the
grep pattern, not a pipe operator, and never reaches this linter's
pipe-with-parser gate at all), this fixture is a REAL pipeline into a parser
stage so it actually reaches the branch this case names — otherwise removing
the value-defaulting predicate could never change its outcome.

```bash
OBS_FILE=".a1/phases/some-phase/observations.jsonl"
MAJOR_COUNT=$(cat "$OBS_FILE" 2>/dev/null | grep -c '"severity":"major"' || echo 0)
```

Red-making change (per the wave plan's W3 row): dropping the value-defaulting
predicate in `workflow-lint.cjs` — W3 must fail ALONE when this happens; W1
must stay green.
