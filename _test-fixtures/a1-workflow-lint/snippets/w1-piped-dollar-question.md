# W1 fixture — the verbatim pre-fix 2026-09-11 defect

This is the exact shape committed to `01-collect.md` before the 2026-09-11 fix:
a command piped into a parser, then `$?` read as if it belonged to the first
command in the pipeline. `$?` after a pipe is the LAST command's exit status
(the parser's), so a failing first command is invisible here.

```bash
ROOTS_JSON=$(node /repo/_shared/a1-tools.cjs learnings roots)
echo "$ROOTS_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["roots"])'
if [ $? -ne 0 ]; then
  echo "no project roots resolved"
  exit 3
fi
```

Red-making change (per the wave plan's W1 row): removing the `$?`-after-pipe
predicate in `workflow-lint.cjs`.
