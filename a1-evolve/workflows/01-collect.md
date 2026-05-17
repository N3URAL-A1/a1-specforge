# Phase 1: Collect

Gather all learning data from all sources.

## Steps

### 1a. Read from Obsidian Vault (primary — the brain)
```bash
VAULT="$HOME/Documents/Obsidian Vault"
ls "$VAULT/areas/a1-learnings/"
```

Read in this order:
1. `$VAULT/areas/a1-learnings/index.md` — overview, entry counts, last synthesis date
2. `$VAULT/areas/a1-learnings/patterns.md` — existing pattern history (avoid re-proposing already-applied fixes)
3. Per-skill files: `a1-execute.md`, `a1-plan.md`, `a1-new-feature.md`, `a1-fix.md`, etc.

Extract from each entry:
- Date and project (follow `[[projects/<slug>]]` wikilinks for context if needed)
- Outcome (PASS/PARTIAL/FAIL)
- Observations with pattern tags
- Retro bullets and 💡 suggestions

### 1b. Read local _learning.md files (cache — cross-check)
```bash
find ~/.claude/skills -name "_learning.md" | sort
```
Use to cross-check against Vault. If local has entries not in Vault, those are missing — note but don't block.

### 1c. Read raw observations from projects
```bash
find ~/code -path "*/.a1/phases/*/observations.jsonl" 2>/dev/null | head -30
```
Parse JSONL for granular pattern data not yet summarized in retros.

### 1d. Check last synthesis date
From `$VAULT/areas/a1-learnings/patterns.md` frontmatter `updated:` field.
Only process entries newer than that date to avoid double-counting.

### 1d. Summarize what was collected
Output:
```
Collected:
- <N> learning entries across <M> skills
- <N> raw observations from <M> projects
- Date range: <oldest> to <newest>
- New since last synthesis: <N> entries
```

Proceed to Phase 2.
