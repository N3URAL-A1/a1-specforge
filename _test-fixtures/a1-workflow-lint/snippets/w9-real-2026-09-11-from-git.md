<!-- Extracted verbatim from git: `git show 9796760^:skills/a1-evolve/workflows/01-collect.md`,
     lines 18-26. NOT reconstructed from the plan's prose — the reconstruction is
     exactly how SC-006 came to pass over a guard that could not fire. The pipeline
     spans three physical lines joined by backslash continuations. -->

when nothing resolves. **Exit 3 aborts the run; it is never "0 new entries".**

```bash
ROOTS=$(node <repo>/_shared/a1-tools.cjs learnings roots \
        | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["roots"]))') \
  || { echo "no project roots — fix A1_CODE_ROOTS before synthesizing"; exit 3; }

STORES=""
for R in $ROOTS; do
