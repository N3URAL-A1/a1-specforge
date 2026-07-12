# Phase 1: Collect

Gather all learning data from all sources.

## Steps

### 1a. Read the learning store (repo-local `.a1/learnings/` by default; `A1_VAULT_ROOT` for an optional external sink, e.g. Obsidian)
```bash
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
ls "$VAULT/pattern/a1-learnings/"
```

Read in this order:
1. `$VAULT/pattern/a1-learnings/index.md` — overview, entry counts, last synthesis date
2. `$VAULT/pattern/a1-learnings/patterns.md` — existing pattern history (avoid re-proposing already-applied fixes)
3. Per-skill files: `a1-execute.md`, `a1-plan.md`, `a1-new-feature.md`, `a1-fix.md`, `a1-analyze.md`, etc.

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

### 1c-bis. Read a1-fix postmortems (richest bug evidence — invariant 4)
a1-fix keeps detail in `wiki/`-style stores AND appends normalized retros to the
primary `pattern/a1-learnings/a1-fix.md` glob (read in 1a). Also collect the
detail stores so the optimizer sees the full bug corpus:
```bash
find "$VAULT/wiki/postmortems" -name "*.md" 2>/dev/null | sort
find "$VAULT/wiki/lessons" -path "*_active.md" 2>/dev/null | sort
```
Extract `root_cause_class`, `one_line_learning`, and terminal verdict per postmortem.
These cluster alongside the pattern-tagged retros in Phase 2.

### 1c-ter. Retro-integrity cross-check (FMEA-3)
For every retro entry collected in 1a/1b whose `result:` (or Outcome) claims a
pass AND which names a referenced verification artifact (a VERIFICATION.md path,
or an `evidence:` field), cross-check the claim against that artifact's actual
verdict:
```bash
# for each retro that references a VERIFICATION.md path:
grep -iE "verdict|outcome|PASS|FAIL|PARTIAL" "<referenced-VERIFICATION.md>" | head
```
- If the retro claims `pass` but the referenced VERIFICATION verdict is FAIL/PARTIAL
  (or the referenced file is missing), record a `retro_integrity` finding
  (fields: retro date, project, claimed result, actual verdict, reference path).
- Retros with no reference are noted as `unverified` but not flagged as integrity
  violations. Retros whose claim matches the verdict pass silently.

`retro_integrity` findings surface in the Phase 2 cluster and the Phase 3
proposal report so rosy self-reports cannot silently harden the wrong things.

### 1c-quater. Read staged Gate-Packs (community source)
Imported Gate-Packs (see `docs/adr/2026-07-05-gate-pack-format.md`) stage their
patterns under `.a1/packs/*/patterns/*.md`. Packs are staged via
`a1-tools pack import <dir>` (which validates before copying — see
`packs/README.md`). Before ingesting, re-validate every staged pack — a
manifest that no longer validates (hand-edited, partially copied) is excluded:
```bash
for m in $(find ~/code -path "*/.a1/packs/*" -name pack.yaml 2>/dev/null); do
  node <repo>/_shared/a1-tools.cjs pack validate "$(dirname "$m")" \
    || echo "SKIP invalid pack: $(dirname "$m")"
done
```
Then collect patterns from the packs that validated, so community-contributed
gates enter clustering:
```bash
find ~/code -path "*/.a1/packs/*/patterns/*.md" 2>/dev/null | sort
```
(Exclude pattern files under any pack directory that failed validation above.)
Each such pattern enters Phase 2 clustering as `source: community` with its
provenance count **capped at 2** (ADR §4) — i.e. one local occurrence is still
required before a community pattern reaches the propose-threshold of 3. Community
evidence lowers the bar but never replaces local evidence, so a poisoned pack can
propose nothing on its own.

### 1d. Check last synthesis date
From `$VAULT/pattern/a1-learnings/patterns.md` frontmatter `updated:` field.
Only process entries newer than that date to avoid double-counting.

### 1e. Summarize what was collected
Output:
```
Collected:
- <N> learning entries across <M> skills
- <N> raw observations from <M> projects
- Date range: <oldest> to <newest>
- New since last synthesis: <N> entries
```

Proceed to Phase 2.
