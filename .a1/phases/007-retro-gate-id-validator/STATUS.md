---
phase: 007-retro-gate-id-validator
spec: project/a1-specforge/spec/007-retro-gate-id-validator.md
plan: project/a1-specforge/plans/007-retro-gate-id-validator-wave-plan.md
worktree: /Users/rob/claude-projects/a1-worktrees/spec-007-gate-validator
branch: feature/spec-007-gate-validator
waves_total: 4
waves_done: 4
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

## Wave 4 — Glob-liveness fixture helper + RED-proof convention ⟶ done

Commit `b6a8d4a`. New suite `a1-glob-liveness` 6/6; `a1-code-roots` 11/11 with
the retrofit; retro-validate 19/19 and workflow-lint 8/8 unregressed.

### The test that justifies the whole wave, run by the orchestrator

Reverting the `quick` glob in `_shared/lib/learnings.cjs` from `project` to
`projects` (the actual defect that shipped this week and hid 9 real quick
records, 1.8 weighted entries):

    FAIL  F all 4 globs derived+live (verdict=yes, live=dead:…/projects/*/quick)
    10 passed, 1 failed

Note `verdict=yes` in that output: **the old shape check still passed.** The
plural glob was correctly shaped and correctly derived from the resolved root —
shape was never the defect. Only the new liveness arm catches it. Reverted, 11/11
green again.

### The executor caught the self-adapting-fixture trap in its own work

Its first `caseF` retrofit let `plantFor` build a tree matching whichever glob
was emitted, then measured against it — so the test adapted itself to the
mutation and could never go red, singular or plural. Class-1 false green,
found by its own G6 mutation probe and fixed with `liveness(…, {skipPlant:true})`
against a fixed planted layout.

Verified experimentally rather than taken on report: with planting, both
spellings report `matches: 1`; against a fixed singular layout with
`skipPlant`, singular reports 1 and plural reports 0. The distinction is real
and the fixture depends on it.

### Two further honest findings from the wave

- **G5 (expansion parity) was initially too weak.** With a single planted root, a
  wrong `fs.readdir(parent).length` implementation coincidentally agreed with
  `ls -d` (both 1). Hardened with a second, partially-matching sibling directory;
  it now catches the divergence (`helper=2` vs `shell=1`).
- **G1 cannot kill the plural/singular mutation and was left that way
  deliberately** — G1 is a unit test of the helper over four arbitrary correct
  patterns; G6 carries the regression probe against the real production code.
  A documented deviation from the plan's G1 row, stated in the code rather than
  quietly absorbed.

No fifth plan error found in this wave.

## Phase 6 — Verify ⟶ PASS (a1-victor-verifier, round 2, 13/13)

Round 1 PARTIAL on one MAJOR: the pipeline linter did not flag the very
2026-09-11 snippet it was built for, because the matcher was line-local while
the real snippet spreads one pipeline across three backslash-continued lines.
Found because the verifier fetched the file from git instead of trusting the
fixture. Fixed (`joinContinuations`), new case W9 uses the byte-identical git
extract. Round 2: PASS, both requested mutations reproduced independently.

The instructive measurement: with the fix mutated back out, the live repo scan
STILL reports `scanned: 64, findings: 0`. W6's green scan was honest and proved
nothing about this capability, because the repo no longer contains the form.
Fixture-based RED proof was the only possible evidence.

## Pre-merge review ⟶ all findings closed (a1-reinhard-reviewer + a1-samuel-security)

Reinhard: REQUEST CHANGES — 1 BLOCKER, 3 MAJOR, 5 MINOR, 3 NITs. Every one
real; every one fixed (commits `defb53b`, `ca0fb23`). He also verified the
things that were sound rather than only hunting: both critical fixtures are
byte-faithful recoveries (from git and from the live vault), `skipPlant` is
decisively load-bearing (removing it makes caseF go GREEN under the plural
mutation), and the zero-catch disclosure is correct.

### The BLOCKER, and why it went to Samuel

`glob-liveness.cjs` interpolated the glob into `execSync`. Reinhard measured a
canary firing and recommended escalation because the naive fix conflicts with
the module's expansion-parity constraint. Samuel rated it MAJOR rather than
BLOCKER on the threat model (nothing in the repo sets `A1_CODE_ROOTS`; the only
writer is the developer's own shell profile) but said fix before merge, because
the module header asserted a safety premise that was false.

**Samuel argued against Reinhard's allowlist and I followed him.** It would have
blessed the space that causes the second defect, and it rejects real macOS paths
(`Müller-Projekte`, `c++tools`, `foo@bar`) that `codeRoots()` accepts — a
blocking guard with false positives gets disabled by whoever hits it. The fix
passes the pattern as an argv entry; bash still expands `*` (G5 pins parity) but
does not re-parse the value.

**Samuel found a second defect at the same line that neither Reinhard nor I
saw:** the sink gave WRONG ANSWERS. Word splitting made a glob under
`My Projects/` report `matches: 0` with two live targets planted — a
glob-liveness guard declaring a live glob dead, the exact false negative the
module exists to prevent. Measured 0 before, 2 after.

### The MAJOR that was mine

My claim in `abde955` — "the other commands exit 1 on an unknown flag" — was
false; all three exit 0. I re-measured, got rc=1, and contradicted Reinhard —
then found my own error: an unquoted `$c` in a shell loop split the arguments
differently from what I thought I was testing. A measurement inside a loop over
unquoted variables is not a measurement. Corrected in both places it appeared.

### Layering worth knowing about (G8)

Removing EITHER the argv passing OR the env denylist leaves G8 green via the
other path — it reports which layer held ("closed at the boundary" vs "closed
at the sink"). Removing BOTH turns it red with a canary. The only case in the
branch whose green state is ambiguous by design, and deliberately so.

## Merged and closed ⟶ done

`ca7dfbd` merged to main (41 files, 3753 insertions), pushed as `7e0231f`,
CI green on GitHub. Worktree exited via `a1-worktree` (mode keep), reservation
released (0 remaining), spec `done`, roadmap `status: done` / `stage: done`.
Plugin 1.3.0 → 1.4.0 so the cache picks the changes up.

Lifecycle: complete → verify → merge → origin-cleanup → done. The `review`
transition was refused by the CLI as a backward move (`verify` was already
ahead) — correct behaviour, noted rather than forced.

### What the gates actually earned, in one place

| gate | verdict | what it caught |
|---|---|---|
| roadmap-gate | fail→pass | a two-month-old parser gap; fixing it made 22 of 22 retros machine-readable |
| gate-4.5 | fail→pass ×2 | FR mentions in prose; two FRs not buildable here → spec 008 |
| scope-claim | pass, caught | my own space-vs-comma scope list (the overlap check was inert) |
| isolation-gate | fail→pass | an uncommitted reservations.json |
| phase-6-verify | fail→pass | the linter missing the defect it was built for |
| pr-reinhard | fail→pass | 1 BLOCKER, 3 MAJOR, 5 MINOR, 3 NIT — every one real |

Six instances of "a guard that guards nothing" in a feature against guards that
guard nothing. Three were caught by the executors in their OWN work before any
review saw them — in the preceding a1-evolve run that number was zero.


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
