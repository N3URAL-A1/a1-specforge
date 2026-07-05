# Phase 4: Apply

Show each proposal in detail and apply on user confirmation.

## Per-proposal flow

For each proposal from Phase 3:

### 4a. Show full diff
Present the exact before/after change clearly.

### 4b. Ask for decision
```
Apply this change? 
[y] Apply  [n] Skip  [e] Edit first  [a] Apply all remaining
```

### 4c. Apply if confirmed
Use Edit tool to make the exact change.

### 4d. Verify change is syntactically correct
Quick read-back to confirm the edit landed cleanly.

## After all proposals processed

### Update Obsidian Vault — patterns.md (primary)
```bash
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
PATTERNS="$VAULT/pattern/a1-learnings/patterns.md"
```

Update `patterns.md`:
1. Update frontmatter `updated:` date
2. Update "Aktive Patterns" table — add/update rows for each processed pattern
3. Append to "Changelog" table — one row per applied change with commit hash

Format for new pattern rows:
```markdown
| missing_wiring | 8 | HIGH | agents/a1-pablo-planner.md | ✅ applied 2026-05-17 |
| wave_ordering | 3 | MED | agents/a1-pablo-planner.md | ✅ applied 2026-05-17 |
| vague_action | 2 | LOW | — | 👀 monitoring |
```

Also update `index.md` — set "Last synthesis" date in the intro block.

### Update local cache
```bash
cat > ~/.claude/skills/_shared/learnings-index.md << EOF
# Learning Index (cache — canonical is Obsidian Vault pattern/a1-learnings/patterns.md)

Last synthesis: $(date +%Y-%m-%d)
Applied: <count> | Skipped: <count> | Monitoring: <count>
EOF
```

### Commit applied changes
```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
git -C "$REPO_ROOT" add agents/ */SKILL.md */workflows/
git -C "$REPO_ROOT" commit -m "evolve: apply <N> skill improvements from <M> observations

Patterns addressed:
- missing_wiring (8 occurrences) → a1-pablo-planner.md
- wave_ordering (3 occurrences) → a1-pablo-planner.md
"
```

### Final report
```
━━━ Evolution Complete ━━━━━━━━━━━━━━━━━━

Applied: <N> improvements
Skipped: <N>
Monitoring: <N> patterns (below threshold)

Skills improved:
- agents/a1-pablo-planner.md (+2 sections)

Committed: feat(<hash>)

Next evolution: after ~5 more skill runs.
```

## Retro (mandatory, every run)

After every run — pass or fail — write one structured entry. Takes 2 minutes. Do not skip.

**To local cache:**
```bash
cat >> ~/.claude/skills/a1-evolve/_learning.md <<'EOF'
---
date: <YYYY-MM-DD>
task: synthesize learnings → propose+apply improvements
project: a1-skills (meta)
result: <pass|fail|partial>
issues: [<relevant tags: low_signal, false_pattern, diff_too_big, vault_index_stale, threshold_too_loose, threshold_too_tight, ...>]
what_worked: <one sentence>
one_line_learning: <what would have prevented the main issue, or "no issues">
EOF
```

**To Vault:**
Append the same entry to:
`$VAULT/pattern/a1-learnings/a1-evolve.md` (the learning store — defaults to repo-local `.a1/learnings/`; set `A1_VAULT_ROOT` to use an external vault, e.g. Obsidian)

A run with no issues is still useful data — write the entry.
