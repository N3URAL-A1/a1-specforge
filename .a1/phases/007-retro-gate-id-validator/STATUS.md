---
phase: 007-retro-gate-id-validator
spec: project/a1-specforge/spec/007-retro-gate-id-validator.md
plan: project/a1-specforge/plans/007-retro-gate-id-validator-wave-plan.md
worktree: /Users/rob/claude-projects/a1-worktrees/spec-007-gate-validator
branch: feature/spec-007-gate-validator
waves_total: 4
waves_done: 3
updated: 2026-09-12
---

# STATUS — spec 007 retro-gate-id-validator

## Wave 1 — Registry reader + gate-id resolver ⟶ done

Commits: `ba9d532` (module + suite), `2f2f2a2` (range-agreement fix),
`26c398a` (isolation-gate registry row).

Delivered `_shared/lib/gate-ids.cjs` (199 lines) + suite
`_test-fixtures/a1-retro-validate/` with 9 cases.

**Verified independently, not taken on report.** Each mutation re-applied by the
orchestrator and reverted:

| mutation | case killed |
|---|---|
| whole-file `^\| \`` scrape instead of header anchor | R1 only (leak message names the leaked alias values) |
| `unknown` collapsed into `drift` | R5 only |
| `Object.freeze` removed | R6 only |
| range bound check widened to any suffix | R3 only |
| `resolveGateId` back to literal-only membership | R8 only |

R1 is the designed positive trap: a fixture registry whose alias section IS a
table with real-looking ids in the right column. A whole-file scraper passes the
other eight cases and fails only R1 — confirmed by temporarily writing one.

### Defect found during acceptance (not by the executor's own suite)

`resolveGateId` took a literal `Set` and never saw the registry's range row,
while `isRegisteredId` took `{literal, ranges}` and resolved ranges correctly:

    modernize-g3   resolve: unknown   | isRegisteredId: true

Both functions correct alone, contradictory together. A retro attributing
`{id: modernize-g3}` would have been told "not registered; add a row per
invariant 7" against a row that exists — the "guard reports falsely" class this
spec exists to remove. R3 never saw it because R3 only asked `isRegisteredId`.
Fixed in `2f2f2a2` by delegating to one single truth; R8 asserts the agreement
in both directions and is mutation-proven.

### Numbers that moved while the wave was being built

The registry id count and the corpus drift figures shifted four times in two
days: "9 of 33" (spec, repo-local stores uncounted) → 11 of 54 (plan time) →
11 of 59 with 3 spellings (after `isolation-gate` was registered) → 11 drift /
48 valid (2026-09-12). The drift count held at 11 by coincidence; the valid
count went 42 → 48 because this run's own retros keep writing `gates_fired`
lines. Both the plan and SC-001 were rewritten to assert SETS against frozen
fixtures instead of counts against the live store — class-4 false-green per
`_shared/agent-lessons.md#theo-mutation-question`.

## Wave 2 — `retro validate` CLI + registry row + write-time wiring ⟶ done

Commits: `3b65fc2` (CLI + registry row + wiring + 9 fixture cases), `74ed424`
(corpus provenance).

Suite grew 9 → 19 cases (R1–R8 + V1–V9). Live probe against a synthetic retro
carrying one drift, one valid and one invented id: exit 1, and the two stderr
lines are genuine fix instructions — the canonical id for the drift, the
invariant-7 row instruction for the unknown. JSON on stdout, prose on stderr,
verified by writing both streams to separate files (my first check used
`2>&1 >/dev/null`, whose order redirects stderr to the OLD stdout and made the
streams look mixed — my error, not the tool's).

Five call sites wired (`retro-template.md` owns the full instruction, four
workflow files link to it), all capture-then-check, zero pipe forms.

### The executor found a false-green in its OWN test and fixed it

V2's original assertion was `grep -q 'lane-split'` — a SUBSTRING of the written
id `lane-split-check`. A mutation that deleted the canonical from the message
entirely would have left it green. Corrected to a backtick-delimited match and
re-probed. Proven independently: against the mutated message
`use \`REMOVED\` instead`, the weak grep matches and the corrected one does not.

This is the same substring class as fixture case D yesterday (an expected path
that was a prefix of the wrong one). Third instance this week — and the first
time an executor caught it in its own work before review.

### Three plan errors reported rather than built around

1. **Corpus count 58 vs 59** — both right, different scopes. 58 is the vault
   store alone; 59 adds the repo-local stores, whose one extra entry
   (`{id: lane-split, …}` in obsidian-lumen) is VALID, which is why only the
   valid count differed (47 vs 48) and the drift set was identical. The same
   scope trap that has hit a1-evolve three times.
2. **The plan's `unknown`-branch example was no longer valid** — `isolation-gate`
   was registered in `26c398a` (my own change, earlier the same day), so it now
   resolves `ok` and could not exercise the branch V3 names. The executor
   switched to a synthetic `never-registered-gate`. Exactly the "test cannot
   enter the branch it names" class, caught before it shipped.
3. **The CLI's single-document scope was unstated** — real vault files are many
   `---`-delimited entries concatenated, and `parseFrontmatter` reads only the
   first block. Implemented as validating one standalone retro document
   (matching the write-time use case: validate before append), with the frozen
   V4 snapshot a synthetic single-document replay. Documented in the module
   header.

Scope addition, declared: a test-only `--registry <path>` override so SC-002's
registry-mutation case does not mutate the real repo registry. Verified absent
from all five production call sites.

## Wave 3 — `workflow lint` for pipeline exit propagation ⟶ done

Commit `59705a7`. New suite `a1-workflow-lint` 8/8; `a1-retro-validate` still
19/19 (shared facade untouched in effect). Live scan: `scanned: 64,
findings: []`, exit 0.

Two predicates instead of one regex, as the plan required: `isValueDefaulting`
(`|| echo`, `|| true`, `|| :`) runs FIRST and excludes the legitimate idioms;
`isStatusTesting` then matches naively (`$?` on this or the next line, or any
`||`). The executor restructured its own first attempt after noticing the two
predicates were disjoint by construction — so the value-defaulting one could
never actually prevent a finding. That correction is what makes the pair real.

**No exemption marker was implemented**, per SC-004: the two predicates separate
every live case on their own, and the plan says to leave the mechanism out
entirely rather than ship an unused exception list.

### Mutation probes — re-run independently by the orchestrator

| mutation | cases killed |
|---|---|
| `isValueDefaulting` → `false` | W3 alone |
| generic `\|\|` arm removed (only `$?` form) | W4 alone |
| fence restriction lifted (whole-file scan) | W5 **+ W6 + W7** |
| glob typo `workflows` → `workflow` | W7 **+ W1 + W4** |

Both overlapping kills are informative, not defects:

- Lifting the fence restriction makes the linter flag **the prose line I wrote
  yesterday** in `01-collect.md:21`, which describes this very bug and contains
  `| python3 ... || abort` as illustration. So prose immunity is not cosmetic —
  it prevents a concrete false positive in the live repo.
- The glob typo yields `scanned: 0` with **exit 0**: a green scan that scanned
  nothing. That is exactly the dead-glob class that shipped three times this
  week, and W7 catches it by asserting the `scanned` count. The linter applies
  glob-liveness to itself.

Note on method: my first two mutation attempts hit the wrong lines (a regex
replacement that matched elsewhere, and an `if (!inFence) continue;` that does
not exist in the file). Both produced misleading results until I mutated the
real statements at lines 92 and 124. A mutation probe is only evidence when you
confirm it changed what you intended.

### Plan error #4 — and I had repeated it

The plan named `skills/a1-execute/workflows/03-verify.md:140` as "the only
remaining pipe-with-`||` line". It is not a pipe at all: in
`grep -c '"severity":"major\|critical"' … || echo 0` the `|` sits INSIDE the
single-quoted grep pattern as a BRE alternation (offset 41, within the quotes);
the real `||` at 77/78 has no pipeline before it. The plan's `grep -rn '|.*||'`
matched any `|` regardless of context — and I repeated that exact mistake when I
"verified" the claim before dispatching the wave. Corrected in the plan.

Consequence the executor caught: its first W3 fixture had no pipe either, so it
never reached the predicate it was meant to test — the "test cannot enter the
branch it names" class, fourth instance this week. Fixed by putting a real
`cat … | grep -c … || echo 0` in the fixture.

## Wave 4 — Glob-liveness fixture helper + RED-proof convention ⟶ in progress


## Notes for Victor (Phase 6)

- `isolation-gate` was registered as a real gate during this phase (Robert's
  decision): the Isolation Gate is a HARD RULE in a1-new-feature and a1-fix,
  blocking, and was already attributed twice in retros with no registry row —
  invariant 7 breach by omission. Effect: drift spellings 4 → 3.
- Pre-existing defect, out of scope, do not fix here: the `a1-reconcile` fixture
  suite rewrites its own checked-in fixture files on every run (timestamps +
  absolute paths). Reset with `git checkout -- _test-fixtures/a1-reconcile/`
  before each commit. Reported by the Wave-1 executor, confirmed by the
  orchestrator.
