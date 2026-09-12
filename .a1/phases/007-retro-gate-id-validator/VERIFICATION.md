---
plan: project/a1-specforge/plans/007-retro-gate-id-validator-wave-plan.md
spec: project/a1-specforge/spec/007-retro-gate-id-validator.md
goal: "Three machine guards for false-green evidence — gate-id validator, glob liveness, pipeline exit propagation"
worktree: /Users/rob/claude-projects/a1-worktrees/spec-007-gate-validator
branch: feature/spec-007-gate-validator
verdict: PARTIAL
passed: 12
gaps: 1
verified: 2026-09-12
---

# Verification: 007-retro-gate-id-validator

## Verdict: PARTIAL
**Cost:** 167441833 tokens (in 1542, out 467375, cache 166972916)

Twelve of thirteen in-scope criteria verified by measurement in the worktree. One
real gap: **SC-006 does not hold for the actual snippet committed on 2026-09-11.**
The workflow linter is line-local and misses the backslash-continued pipeline
shape, which is precisely the shape the historical defect had. Everything else —
including the primary requested mutation probe and the `skipPlant` fix — is sound,
and several guards proved stronger than the reports claimed.

All verification ran in the worktree at `/Users/rob/claude-projects/a1-worktrees/spec-007-gate-validator`.

---

## Acceptance Criteria Results (spec ACs quoted verbatim)

| Criterion (verbatim from spec) | Command run | Actual output (abbreviated) | Status |
|---|---|---|---|
| **FR-001** "`a1-tools retro validate <retro-path>` parses every `gates_fired[].id` in the file and exits non-zero when an id is absent from `_shared/gates-registry.md`." | `node _shared/a1-tools.cjs retro validate _test-fixtures/a1-retro-validate/corpus/retro-drift.md` | `EXIT=1`; stdout `{"entries":[{"id":"plan-audit","status":"ok"},{"id":"lane-split-check","status":"drift","canonical":"lane-split"}],"valid":1,"drift":1,"unknown":0}` | ✓ PASS |
| **FR-002** "The validator resolves the documented drift aliases and reports them as errors naming the canonical id (`lane-split-check` → `lane-split`), so the message is a fix instruction, not a rejection." | same run, stderr captured to a separate file | `fix: "lane-split-check" is not a registered gate id — use \`lane-split\` instead (gates_fired entry 2).` | ✓ PASS |
| **FR-003** "The validator reads the registry's id column only, never the alias bullet list (that list is deliberately not a table)." | `parseRegistryIds()` on `corpus/fixture-registry-alias-as-table.md` (a fixture whose alias section IS a table with real-looking ids) | `parsed: ["alpha-gate","beta-gate","gamma-gate","range-gate1..gate3"]` · `leaked alias values: NONE` | ✓ PASS |
| **FR-004** "The check is registered in `_shared/gates-registry.md` per invariant 7, with deterministic exit semantics and its own retro attribution id." | `parseRegistryIds` membership probe + exit-code sweep | `retro-gate-ids REGISTERED`, `workflow-pipeline-exit REGISTERED`, `isolation-gate REGISTERED` (all inside the parsed span, 35 ids); exits: 0 clean / 1 drift / 2 missing-file / 2 malformed / 0 missing-field | ⚠ PARTIAL — rows + attribution ids correct; **usage exit code documented as 2, measured 1** (see Gap 2) |
| **FR-007** "Each guard ships with a RED proof: a fixture that the guard actually rejects, committed alongside it." | `_test-fixtures/CONVENTIONS.md` RED-proof table + independent re-run of its claimed mutations | Mutation "`unknown` collapsed into `drift`" → **V3 fails alone, V2 stays green**, exactly as the table claims | ✓ PASS |
| **FR-008** "A fixture helper that, for every glob a CLI emits, plants a matching fixture directory and asserts at least one match." | `bash _test-fixtures/a1-glob-liveness/run-tests.sh` | `a1-glob-liveness: 6 passed, 0 failed` (G1–G6) | ✓ PASS |
| **FR-009** "A review/lint check that flags any documented `cmd \| parser \|\| fallback` shell snippet in a workflow file." | `node _shared/a1-tools.cjs workflow lint` + per-snippet runs | live repo `{"scanned":64,"findings":[]}` exit 0; w1 exit 1, w2/w3/w5 exit 0, w4 exit 1 | ⚠ PARTIAL — flags the single-line and adjacent-line forms; **misses the backslash-continued form** (see Gap 1) |
| **SC-001** "Replaying the corpus through FR-001 flags every drift entry and nothing else. Do not hard-code the count... assert the SET of flagged ids against a checked-in corpus fixture, and against the live store assert only that every flagged id is absent from the registry and every unflagged one is present." | frozen snapshot replay + independent live-store scan of `~/N3URAL-Vault/pattern/a1-learnings` | snapshot: `valid:47 drift:11 unknown:0`, `FLAGGED SET: ['consistency-gate-4-5','full-regression-gate','lane-split-check']`. Live store (my own scan, not the suite): 11 flagged of 58 occurrences, same 3 spellings, property `every flagged id absent from registry -> true` | ✓ PASS |
| **SC-002** "Mutating a registry id in a passing fixture turns the validator red." | copied real registry, `sed 's/\`lane-split\`/\`lane-split-x\`/'`, same retro before/after | `EXIT(before)=0` → `EXIT(after)=1`, stderr names `lane-split` | ✓ PASS |
| **SC-003** "classes 1 and 4 are the subject of spec `008`... and are NOT claimed here. Classes 2 and 3 remain discipline. This spec does not claim coverage it does not have." | read spec scope + grepped registry Notes and CONVENTIONS.md for overreach | No artifact claims class-1/4 coverage; `workflow-pipeline-exit` Notes state "No catch data yet... the live repo has zero true positives today" | ✓ PASS (honest non-claim) |
| **SC-004** "No guard carries an exception list that grows by default; an exception needs a named reason." | grep for skip/exempt/allowlist/ignore in both guards + `Object.isFrozen` probe | Only `stdio:['ignore',...]` and an unreadable-file `continue`; `KNOWN_ALIASES` `frozen: true`, exactly the 3 measured entries, write attempt silently dropped. No exemption marker shipped for `workflow lint`. | ✓ PASS |
| **SC-005** "Replaying each of the three historical dead globs through FR-008 flags all three; a glob whose target exists is not flagged." | independent replay of all three dead globs + corrected forms via `liveness(..., {skipPlant:true})` | `DEAD : [0, 0, 0]` · `FIXED : [1, 1]` | ✓ PASS |
| **SC-006** "FR-009 flags the exact snippet as committed on 2026-09-11 and does not flag the corrected capture-then-parse form." | linted the **true pre-fix file from git** (`git show 9796760^:skills/a1-evolve/workflows/01-collect.md`) | `{"scanned":1,"findings":[]}` **exit 0 — not flagged** | ✗ FAIL (second half holds: corrected form not flagged) |

### Phantom BLOCKERs
None — but the phantom check is **inert for this plan, not clean**:

```
node _shared/a1-tools.cjs phantom check <plan> --repo-path <worktree> --since main --format json
{"total_completed": 0, "phantoms": [], "status": "clean"}
```

`total_completed: 0` because the wave plan uses no `- [x]` checkbox task format
(`grep -cE '^\s*- \[[ x]\]'` → 0 checked, 0 unchecked). The checker had nothing
to parse, so its "clean" verdict is not evidence. I verified artifact existence
directly instead: all seven claimed modules/suites exist and are substantive
(gate-ids 208, retro-validate 245, workflow-lint 279, glob-liveness 131 lines;
suites 546/217/243 lines). `glob-liveness.cjs` has no facade dispatch, which
matches its stated fixture-library-only design.

### Verify manually (weak phantom matches)
None.

---

## Mutation probes — applied, observed, reverted

Every mutation below was confirmed via `git diff` to have landed on the intended
line **before** trusting its outcome (per the brief's warning about mutating the
wrong line). Worktree confirmed clean (`git status --short` empty) after each revert.

| # | Mutation applied | Expected to die | What actually died | Verdict |
|---|---|---|---|---|
| 1 | **The primary probe.** `_shared/lib/learnings.cjs:398` `quick` glob `'project'` → `'projects'` (the real 2026-09-11 defect that made 9 quick records invisible) | `a1-code-roots` caseF | `FAIL F ... live=dead:.../\.a1/learnings/projects/*/quick` — **caseF alone**, 10 passed 1 failed; failure message names the dead glob | ✓ **The guard catches the defect it exists for** |
| 2 | Same plural mutation **plus** removing `{ skipPlant: true }` from caseF (line 182) | caseF should stay green → proves `skipPlant` is load-bearing | `PASS F` — **caseF goes green under the very defect it exists to catch** | ✓ `skipPlant` fix is genuine, not decorative |
| 3 | `parseRegistryIds` → whole-file `^\| \`` scrape (the wrong implementation FR-003 forbids) | R1 only | `FAIL R1 (LEAK:{"leaked":["beta-gate-old","lane-split-check"]})` — R1 alone, 18 others pass; message names the leaked values | ✓ R1 is a real positive trap |
| 4 | `retro-validate.cjs` drift branch widened to `status === 'drift' \|\| status === 'unknown'` | V3 only (CONVENTIONS.md claim) | `FAIL V3 (err=... use \`undefined\` instead)`, `PASS V2` | ✓ Statuses independently guarded, as claimed |
| 5 | Semantic-equivalence probe: the historical defect rewritten onto **one line** | should be flagged | flagged, exit 1 | ✓ confirms the miss in Gap 1 is purely line-locality |
| 6 | Historical defect with `|`+`||` on **adjacent** lines (no continuation) | should be flagged | flagged (the `$?`-next-line lookahead works) | ✓ isolates the gap to backslash continuation |

Probe 2 is the most important negative result in this verification: it proves the
Wave 4 self-adapting-fixture fix does real work rather than being narrative.

---

## Gaps

### Gap 1 (MAJOR): SC-006 fails against the real 2026-09-11 snippet — the linter is line-local
- **Criterion affected:** SC-006, FR-009
- **What was expected:** "FR-009 flags **the exact snippet as committed on 2026-09-11**".
- **What exists:** The linter flags the fixture `w1-piped-dollar-question.md`, which
  uses a `$?`-on-the-next-line shape. But the snippet actually committed that day —
  recovered from git, `git show 9796760^:skills/a1-evolve/workflows/01-collect.md`
  lines 21–23 — is a backslash-continued pipeline:

  ```bash
  ROOTS=$(node <repo>/_shared/a1-tools.cjs learnings roots \
          | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["roots"]))') \
    || { echo "no project roots — fix A1_CODE_ROOTS before synthesizing"; exit 3; }
  ```

  Linting that genuine file yields `{"scanned":1,"findings":[]}`, **exit 0**.
- **Root cause (measured, not inferred):** `isSwallowedExitPipe(line, nextLine)` requires
  `PARSER_STAGE_RE` and the status test to coincide on one line, with a one-line
  lookahead for `$?` only. Here `| python3` is on line 22 and the `||` on line 23,
  reached only via a `\` continuation, so no single line carries both. Probes 5 and 6
  isolate this: identical semantics on one line → flagged; adjacent lines with `$?` →
  flagged; `\`-continued with `||` → missed.
- **Mitigating datum:** I scanned all `skills/*/workflows/*.md` bash fences for
  continued pipelines with a parser stage — **zero occurrences today**. The gap is
  latent (it would not catch a regression to the historical form), not currently
  masking a live defect. W6's clean scan of the live repo is therefore genuine.
- **Fix:** join `\`-continued lines into one logical line before applying the
  predicates (a small pre-pass in `extractBashFenceLines`, preserving the first
  line's number for reporting), then add the recovered git snippet verbatim as a
  fixture case so SC-006 is asserted against the historical artifact rather than a
  reconstruction of it.

### Gap 2 (MINOR): documented exit-2 usage semantics measured as exit 1
- **Criterion affected:** FR-004 ("deterministic exit semantics")
- **What was expected:** The registry row and `retro-validate.cjs`'s header both say
  exit `2` covers "usage error".
- **What exists:** `retro validate` with no argument, and with an empty-string
  argument, exit **1** (`error: retro validate requires <retro-path>`) because
  `rejectHostilePath` routes that case through `fail()`. Exit 1 is the same code as
  "drift found", so a caller using the documented contract cannot distinguish
  "forgot the path" from "the retro has a bad gate id". Oversized (5000-char) and
  traversal arguments correctly exit 2.
- **Fix:** route the empty/missing-argument case to `process.exit(2)`, or narrow the
  registry row and module header to say exit 1 for missing-argument.
- **Note on method:** my first sweep of these codes was wrong — I read `$?` after an
  `echo` in the same pipeline and got all zeros. Re-measured with the exit code
  captured into `rc` immediately. Same class of error the spec exists to prevent.

### Non-gap, recorded for accuracy
`workflow lint --root` with no value silently falls back to the repo root and scans
64 files rather than erroring. Benign (it is the documented default), but it means a
typo'd flag invocation looks like a successful scan.

---

## Build / Test Status
- **Full fixture suite: 30 suites, all rc=0, 634 cases, 0 failed.** No regressions
  from the 32-file change. Counts include the four suites this phase touched:
  `a1-retro-validate` 19/19, `a1-workflow-lint` 8/8, `a1-glob-liveness` 6/6,
  `a1-code-roots` 11/11.
- No TypeScript/npm toolchain in this repo by design (bash fixtures only) — nothing
  to type-check or build.
- Worktree clean after all probes; `_test-fixtures/a1-reconcile/` reset with
  `git checkout --` per the known pre-existing churn (not a finding for this phase).

## Claims checked and confirmed true
- **Registry rows are inside the parsed table span** (the brief's point 4). All three
  new ids resolve `REGISTERED` through `parseRegistryIds` → `isRegisteredId`, the same
  path a1-evolve's gate-ROI uses; 35 ids parsed.
- **Registry Notes honesty** (point 5). `workflow-pipeline-exit` states "No catch data
  yet; RED proof is fixture-based ... the live repo has zero true positives today". It
  claims no catches it does not have.
- **Write-time wiring, 5 call sites, zero pipes.** `retro-template.md` plus four
  workflow files, all `retro validate "$RETRO_FILE"; RC=$?`. The only grep hit
  containing a pipe is the registry row's own prose.
- **`--registry` is test-only.** Absent from all production call sites; appears only in
  `help.cjs` and the module header.
- **Plan error #4 confirmed genuine.** `skills/a1-execute/workflows/03-verify.md:140`
  is not a pipe — the `|` is a BRE alternation inside the single-quoted grep pattern.
  The live linter correctly does not flag it.
- **SC-001's moving-target discipline is implemented as specified**: the suite asserts
  a SET against a frozen snapshot and only a property against the live store. My
  independent live scan reproduced 11/58 across 3 spellings.

## Deviations from Plan
- `glob-liveness.cjs` ships without facade dispatch. Intentional (fixture library, not
  a CLI) and consistent with FR-008, which asks for a fixture helper.
- No exemption-marker mechanism for `workflow lint`. Correct per SC-004 — shipping an
  unused exception list would be the anti-pattern the criterion forbids.
- `isolation-gate` registered mid-phase (Robert's decision), reducing drift spellings
  4 → 3. Reflected in the measured corpus.
- Spec-vs-plan divergence worth noting: the plan's W1 row specifies the `$?`-after-pipe
  predicate, and the executor built exactly that. The spec's SC-006 asks for the
  snippet **as committed**, which has a different shape. The plan diluted the AC, and
  the fixture was built to the plan rather than to the spec — which is how Gap 1 shipped
  under a green suite. This is the plan-quality finding of the phase.
