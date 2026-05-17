# Phase 3: Verify

Spawn a1-verifier to validate the completed work.

## Prompt template

```
Verify that the phase goal was achieved.

<files_to_read>
- .a1/phases/<phase_name>/PLAN.md
- .a1/phases/<phase_name>/STATUS.md
- <spec_path> (if available)
</files_to_read>

**Output path:** .a1/phases/<phase_name>/VERIFICATION.md
```

## Routing by verdict

### PASS
```
✅ Phase complete: <goal>

All <N> success criteria verified.
Build: ✓  Tests: ✓  TypeScript: ✓

Commits: <list>

What's next?
- Deploy: use a1-checklist then Dirk/Dennis
- New phase: use a1-plan
- Check project status: use a1-progress
```

### PARTIAL
```
⚠ Phase mostly complete — <N> gaps remain:

<gap list>

Options:
1. Fix gaps now (I'll spawn a1-executor for the specific missing pieces)
2. Accept and move on (gaps are minor)
3. Show full VERIFICATION.md
```

### FAIL
```
❌ Phase incomplete — <N> criteria not met:

<failure list>

I recommend targeted re-execution. Which gaps should I fix first?
```

For FAIL/PARTIAL re-execution: spawn a1-executor with a targeted prompt listing only the missing work, not the full plan.

---

## Retro-Capture (always — after verdict is shown)

After presenting the verdict, write the learning entry to **two places**:
1. Local cache: `~/.claude/skills/a1-execute/_learning.md`
2. **Obsidian Vault** (canonical): `~/Documents/Obsidian Vault/areas/a1-learnings/a1-execute.md`

The Vault is the brain — always write there. The local file is a fast-access cache for a1-evolve.

### Build the retro content

```bash
OBS_FILE=".a1/phases/<phase_name>/observations.jsonl"
OBS_COUNT=$(wc -l < "$OBS_FILE" 2>/dev/null || echo 0)
MAJOR_COUNT=$(grep -c '"severity":"major\|critical"' "$OBS_FILE" 2>/dev/null || echo 0)
PROJECT_NAME=$(basename $(pwd))
DATE=$(date +%Y-%m-%d)
```

**Retro format — fill in honestly (3-5 bullets max):**
```
✅ <what worked well — specific, not generic>
✅ <what worked well>
⚠️ <what didn't work / required unplanned effort>
⚠️ <pattern that's recurring across runs>
💡 Suggestion: <one concrete sentence: which file, what change>
```

### Write to local cache
```bash
LEARNING_FILE="$HOME/.claude/skills/a1-execute/_learning.md"

cat >> "$LEARNING_FILE" << ENTRY

## $DATE — $PROJECT_NAME / <phase_name>
**Outcome:** <PASS|PARTIAL|FAIL> | **Stack:** <e.g. Next.js + Postgres> | **Obs:** $OBS_COUNT ($MAJOR_COUNT major+)

<observations summary — one line per observation>

<retro bullets>
ENTRY
```

### Write to Obsidian Vault
```bash
VAULT="$HOME/Documents/Obsidian Vault"
VAULT_FILE="$VAULT/areas/a1-learnings/a1-execute.md"

cat >> "$VAULT_FILE" << ENTRY

## $DATE — [[projects/<project-slug>]] / <phase_name>
**Outcome:** <PASS|PARTIAL|FAIL> | **Stack:** <stack> | **Obs:** $OBS_COUNT ($MAJOR_COUNT major+)
Patterns: [[a1-learnings/patterns]]

### Observations
<observations — one line per item, with pattern tag>

### Retro
<retro bullets>
ENTRY

# Update the index table (sed the entry count + last-date)
sed -i '' "s/| a1-execute | \[\[a1-learnings\/a1-execute\]\] | .* |/| a1-execute | [[a1-learnings\/a1-execute]] | $DATE | $(grep -c "^## 20" "$VAULT_FILE") |/" "$VAULT/areas/a1-learnings/index.md"
```

### Threshold check
```bash
ENTRY_COUNT=$(grep -c "^## 20" "$LEARNING_FILE" 2>/dev/null || echo 0)
```
If `$ENTRY_COUNT` is a multiple of 5:
> "📚 5 neue Learnings akkumuliert — in Vault unter [[areas/a1-learnings/index]] gespeichert. `a1-evolve` ausführen?"
