# Phase 1: Collect

Gather all learning data from all sources.

## Steps

### 1a. Read ALL learning stores (repo-local per project — collect every one, not just the current repo's)

Since M7, canonical stores are REPO-LOCAL: each project keeps its own
`.a1/learnings/`. A single-`$VAULT` read misses every sibling project's
retros (proven 2026-07-17: 13 of 16 new retros lived in OTHER repos' stores).
Collect across all of them, plus `A1_VAULT_ROOT` if set:

**Never hardcode the checkout path.** Ask for it — the roots differ per machine
(`~/claude-projects` here, `~/code` elsewhere), and a glob that matches nothing
reports "no learnings" instead of failing. `learnings roots` resolves them via
`A1_CODE_ROOTS` → autodetect → the current repo's parent, and exits 3 (loudly)
when nothing resolves. **Exit 3 aborts the run; it is never "0 new entries".**

**Capture node's exit code, then parse.** `$?` of a pipeline is the LAST
command's status, so `node ... | python3 ... || abort` reads python's success and
the abort never fires — the tool exits 3 with a valid `{"roots": []}` payload
that python parses happily. That bug shipped in this very step on 2026-09-11
and was caught in review: the guard against "collect silently found nothing" was
itself a guard that guarded nothing. Two separate statuses matter (2 = bad
`A1_CODE_ROOTS`, 3 = nothing resolved), so do not collapse them.

```bash
ROOTS_JSON=$(node <repo>/_shared/a1-tools.cjs learnings roots); RC=$?
if [ $RC -ne 0 ]; then
  case $RC in
    2) echo "A1_CODE_ROOTS is set but points nowhere — fix it before synthesizing" ;;
    3) echo "no project roots resolved — set A1_CODE_ROOTS before synthesizing" ;;
    *) echo "learnings roots failed (exit $RC)" ;;
  esac
  exit $RC
fi
ROOTS=$(printf '%s' "$ROOTS_JSON" \
        | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["roots"]))')

STORES=""
for R in $ROOTS; do
  STORES="$STORES $(ls -d "$R"/*/.a1/learnings/pattern/a1-learnings 2>/dev/null)"
done
[ -n "$A1_VAULT_ROOT" ] && STORES="$STORES $A1_VAULT_ROOT/pattern/a1-learnings"
for S in $STORES; do echo "== $S"; ls "$S"; done
```

Reuse `$ROOTS` for every glob in this phase (1c, 1c-quater, 1c-quinquies) rather
than re-deriving a path. Historical note: this step read `~/code/*` until
2026-09-11, a directory that does not exist on Rob's machine — the 6th synthesis
run would have collected nothing while reporting success. Third collect-scope
defect in six runs (2026-07-17 single-repo read, 2026-08-02 write-side omission,
this one), hence the CLI owner instead of a fourth hardcode.

The SKILLS-REPO store (`<repo>/.a1/learnings`) is the primary one —
its `index.md`/`patterns.md` hold the cross-project synthesis state. Read in
this order:
1. Skills-repo `pattern/a1-learnings/index.md` — overview, entry counts, last synthesis date
2. Skills-repo `pattern/a1-learnings/patterns.md` — existing pattern history (avoid re-proposing already-applied fixes)
3. Per-skill files from EVERY store found above: `a1-execute.md`, `a1-plan.md`, `a1-new-feature.md`, `a1-fix.md`, `a1-analyze.md`, etc.

Extract from each entry:
- Date and project (follow `[[project/<slug>]]` wikilinks for context if needed)
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
for R in $ROOTS; do
  find "$R" -path "*/.a1/phases/*/observations.jsonl" 2>/dev/null
done | head -30
```
Parse JSONL for granular pattern data not yet summarized in retros.

### 1c-bis. Read a1-fix postmortems (richest bug evidence — invariant 4)
a1-fix keeps detail in the vault (project/*/postmortems/) AND appends normalized retros to the
primary `pattern/a1-learnings/a1-fix.md` glob (read in 1a). Also collect the
detail stores so the optimizer sees the full bug corpus:
```bash
find "$A1_VAULT_ROOT"/project/*/postmortems -name "*.md" 2>/dev/null | sort
find "$A1_VAULT_ROOT"/pattern/a1-learnings/lessons -path "*_active.md" 2>/dev/null | sort
[ -n "$A1_VAULT_ROOT" ] && find "$A1_VAULT_ROOT/wiki" -name "*.md" 2>/dev/null | sort
```
Extract `root_cause_class`, `one_line_learning`, and terminal verdict per postmortem.
These cluster alongside the pattern-tagged retros in Phase 2.

**Read `type:` before counting.** `project/*/postmortems/` is not homogeneous: some
projects file `type: feature-note` entries (shipped features, no defect) in the
same directory. Counting files instead of reading their type inflates bug
clusters — on 2026-08-02 this turned 7 real niimo bugs into a reported 19-strong
cluster until the backfill read each file. Count only entries whose `type:` is
absent (legacy postmortem) or `postmortem`/`bugfix`, and note excluded
feature-notes rather than silently dropping them.

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
for m in $(for R in $ROOTS; do find "$R" -path "*/.a1/packs/*" -name pack.yaml 2>/dev/null; done); do
  node <repo>/_shared/a1-tools.cjs pack validate "$(dirname "$m")" \
    || echo "SKIP invalid pack: $(dirname "$m")"
done
```
Then collect patterns from the packs that validated, so community-contributed
gates enter clustering:
```bash
for R in $ROOTS; do find "$R" -path "*/.a1/packs/*/patterns/*.md" 2>/dev/null; done | sort
```
(Exclude pattern files under any pack directory that failed validation above.)
Each such pattern enters Phase 2 clustering as `source: community` with its
provenance count **capped at 2** (ADR §4) — i.e. one local occurrence is still
required before a community pattern reaches the propose-threshold of 3. Community
evidence lowers the bar but never replaces local evidence, so a poisoned pack can
propose nothing on its own.

### 1c-quinquies. Read a1-quick run records (weighted, spec 004-xs-quick-lane)

`a1-quick` (the XS quick lane) doesn't write per-skill `_learning.md`/store
entries like other skills — each run leaves exactly one run-record file at
`project/<slug>/quick/<YYYY-MM-DD>-<slug>.md` with its retro inline as a
one-line `retro:` frontmatter field (see `_shared/retro-template.md`'s
"Quick-run micro-retro" section). Collect these the same repo-local way as
1a's per-project glob, but under `quick/` instead of
`pattern/a1-learnings/`:

```bash
for R in $ROOTS; do find "$R"/*/.a1/learnings/project/*/quick -name "*.md" 2>/dev/null; done | sort
[ -n "$A1_VAULT_ROOT" ] && find "$A1_VAULT_ROOT/projects/*/quick" -name "*.md" 2>/dev/null | sort
```

Or, equivalently, via the aggregate CLI report (same data, pre-computed):

```bash
node <repo>/_shared/a1-tools.cjs quick stats
```

Extract `result` and `escalated` per record — these feed `quick stats`'
`escalation_rate`/`regression_rate` telemetry (FR-018), which a1-evolve's
Phase 2 clustering can treat as a pattern signal like any other cluster
input (e.g. repeated escalations for structurally similar intents).

**Weighted learning count (FR-019):** a quick-run entry is much cheaper to
produce than a full retro (one line vs. a structured multi-section entry),
so it must not dominate the "N new learnings since last synthesis" count
that triggers the periodic-synthesis offer (owned by
`~/.claude/rules/common/a1-framework.md`, referenced here per Constitution
invariant 1 — not edited by this step). Each quick-run entry counts at
**1/5 (0.2) of a normal learning entry** toward that count:

```
weighted_quick_count = (number of quick-run entries collected above) * 0.2
```

`quick stats`' JSON report already exposes this as `weighted_learning_count`
— add it to the count of full learning entries from 1a/1b/1c when computing
"new since last synthesis" in step 1e below, rather than counting quick-run
entries 1-for-1. Example: 5 completed quick runs + 0 other new entries =
weighted count 1.0, not 5 — the "offer at 5" trigger does not fire on quick
runs alone until ~25 of them have accumulated.

### 1d. Check last synthesis date
From `$VAULT/pattern/a1-learnings/patterns.md` frontmatter `updated:` field.
Only process entries newer than that date to avoid double-counting.

### 1e. Summarize what was collected
Output:
```
Collected:
- <N> learning entries across <M> skills
- <N> raw observations from <M> projects
- <N> a1-quick run records (weighted count: <N * 0.2>)
- Date range: <oldest> to <newest>
- New since last synthesis: <N> entries (full-weight entries + weighted quick count from 1c-quinquies)
```

Proceed to Phase 2.
