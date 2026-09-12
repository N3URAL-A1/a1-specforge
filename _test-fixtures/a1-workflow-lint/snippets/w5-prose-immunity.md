# W5 fixture — prose describing the bug must stay clean

The sentence below is PROSE (outside any fenced bash block) that describes the
exact W1 defect in words, including a pipe character and a `||` token. It must
never be flagged — only fenced ```bash blocks are in scope for this linter.

Capture node's exit code, then parse. `$?` of a pipeline is the LAST
command's status, so `node ... | python3 ... || abort` reads python's success
and the abort never fires — the tool exits 3 with a valid `{"roots": []}`
payload that python parses happily.

```bash
echo "this fenced block is unrelated and clean"
```

Red-making change (per the wave plan's W5 row): scanning the whole file
instead of restricting the scan to lines inside fenced ```bash blocks.
