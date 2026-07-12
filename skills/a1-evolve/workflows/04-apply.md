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

**Append target for agent-prompt lessons (HARD RULE, M12 decision 7.3a):**
when a proposal adds a lesson to an *agent* file, the narrative (incident
story, dated provenance, observed failure mode) goes into
`_shared/agent-lessons.md` under `## <agent> — <slug>`, NOT into the agent
prompt. The agent prompt gets at most **one compressed imperative sentence
plus a pointer** (`see _shared/agent-lessons.md#<anchor>`) — and only if the
lesson introduces a rule category no existing principle in that prompt
covers; if it reinforces/refines an existing rule, only the lessons file
grows. This bounds prompt growth: prompts hold stable operating principles,
the lessons file holds the append-only incident log.

### 4d. Verify change is syntactically correct
Quick read-back to confirm the edit landed cleanly.

## After all proposals processed

### Update the learning store — patterns.md (repo-local `.a1/learnings/` by default; `A1_VAULT_ROOT` for an optional external sink, e.g. Obsidian)
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
# Learning Index (cache — canonical is the learning store's pattern/a1-learnings/patterns.md, repo-local by default with A1_VAULT_ROOT for an optional external sink, e.g. Obsidian)

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

Write one retro entry exactly as defined in `_shared/retro-template.md`
(entry format + write targets: learning store first, dev cache best-effort),
with skill = `a1-evolve`.

- task wording: synthesize learnings → propose+apply improvements
- issue tags: [<relevant tags: low_signal, false_pattern, diff_too_big, vault_index_stale, threshold_too_loose, threshold_too_tight, ...>]

