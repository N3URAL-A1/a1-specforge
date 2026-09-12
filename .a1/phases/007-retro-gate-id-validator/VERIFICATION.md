---
plan: project/a1-specforge/plans/007-retro-gate-id-validator-wave-plan.md
spec: project/a1-specforge/spec/007-retro-gate-id-validator.md
goal: "Three machine guards for false-green evidence — gate-id validator, glob liveness, pipeline exit propagation"
worktree: /Users/rob/claude-projects/a1-worktrees/spec-007-gate-validator
branch: feature/spec-007-gate-validator
verdict: PASS
passed: 13
gaps: 0
residual_minor: 1
verified: 2026-09-12
verification_rounds: 2
history:
  - "round 1 (b6a8d4a): PARTIAL — SC-006 failed against the real git snippet; usage exit code mismatch"
  - "round 2 (81b3c04): PASS — both fixed and independently re-measured; one cosmetic doc inconsistency left"
  - "round 2 residual closed (abde955): the three stale \"exit 2 = usage error\" strings swept (help.cjs, gates-registry.md x2, retro-template.md). While closing it the orchestrator measured a REAL defect the residual had hidden: `workflow lint --roo <path>` ignored the unrecognised flag, scanned the repo\'s 64 files instead of the intended target, and exited 0 — the only command in the facade behaving that way. Guarded (flags._ check) and covered by new fixture case W10, mutation-proven. Suites now 10/19/6/11."
---

# Verification: 007-retro-gate-id-validator

## Verdict: PASS (round 2, commit `81b3c04`)
**Cost:** 182699867 tokens (in 1634, out 492299, cache 182205934)

All thirteen in-scope criteria now verified by measurement. **SC-006 holds** — the
linter flags the genuine 2026-09-11 snippet recovered from git, and the fixture is
byte-identical to that git extract rather than a reconstruction. Both fixes were
re-measured independently, including the two probes the coordinator explicitly asked
me not to take on report; both reproduced exactly as described.

One **cosmetic** residual remains (three stale "exit 2 = usage error" strings, one of
them self-contradicting inside a single help block). It is a documentation
inconsistency about an already-correctly-documented behaviour, affects no code path,
and does not hold back the verdict — but it should be swept, and it is recorded
below rather than smoothed over.

Round 1's PARTIAL and its evidence are preserved below; the finding history is the
substance of this record.

All verification ran in the worktree `/Users/rob/claude-projects/a1-worktrees/spec-007-gate-validator`,
which was `git status` clean before and after every probe (HEAD `81b3c04`).

---

## Acceptance Criteria Results (spec ACs quoted verbatim)

| Criterion (verbatim from spec) | Command run | Actual output (abbreviated) | R1 | R2 |
|---|---|---|---|---|
| **FR-001** "`a1-tools retro validate <retro-path>` parses every `gates_fired[].id` in the file and exits non-zero when an id is absent from `_shared/gates-registry.md`." | `node _shared/a1-tools.cjs retro validate .../retro-drift.md` | `EXIT=1`; `{"valid":1,"drift":1,"unknown":0}` with per-entry statuses | ✓ | ✓ PASS |
| **FR-002** "The validator resolves the documented drift aliases and reports them as errors naming the canonical id (`lane-split-check` → `lane-split`), so the message is a fix instruction, not a rejection." | same run, streams separated | stderr: ``fix: "lane-split-check" is not a registered gate id — use `lane-split` instead`` | ✓ | ✓ PASS |
| **FR-003** "The validator reads the registry's id column only, never the alias bullet list." | `parseRegistryIds()` on the alias-as-a-table trap fixture | `["alpha-gate","beta-gate","gamma-gate","range-gate1..gate3"]`, `leaked: NONE` | ✓ | ✓ PASS |
| **FR-004** "The check is registered in `_shared/gates-registry.md` per invariant 7, with deterministic exit semantics and its own retro attribution id." | membership probe through `parseRegistryIds`→`isRegisteredId`; exit-code sweep; repo-convention sweep over 6 subcommands | all 3 new ids `REGISTERED` inside the parsed span (35 ids); exits 0/1/2 deterministic; **exit 1 on bad argument confirmed as the repo-wide convention** (6/6 commands) | ⚠ | ✓ PASS |
| **FR-007** "Each guard ships with a RED proof: a fixture that the guard actually rejects, committed alongside it." | re-ran CONVENTIONS.md's claimed mutations myself; verified W9's provenance by byte-diff against git | `unknown`→`drift` kills V3 alone, V2 green; **W9 bash block byte-identical to `git show 9796760^:...`** | ✓ | ✓ PASS |
| **FR-008** "A fixture helper that, for every glob a CLI emits, plants a matching fixture directory and asserts at least one match." | `bash _test-fixtures/a1-glob-liveness/run-tests.sh` | `6 passed, 0 failed` | ✓ | ✓ PASS |
| **FR-009** "A review/lint check that flags any documented `cmd \| parser \|\| fallback` shell snippet in a workflow file." | live scan + 5 snippet runs + 5 adversarial continuation probes | live `{"scanned":64,"findings":[]}`; w1/w4/w9 flagged, w2/w3/w5 clean; all 5 adversarial shapes correct | ⚠ | ✓ PASS |
| **SC-001** "Replaying the corpus through FR-001 flags every drift entry and nothing else. Do not hard-code the count... assert the SET of flagged ids against a checked-in corpus fixture, and against the live store assert only that every flagged id is absent from the registry and every unflagged one is present." | frozen-snapshot replay + my own independent scan of `~/N3URAL-Vault/pattern/a1-learnings` | snapshot `valid:47 drift:11 unknown:0`, `SET: ['consistency-gate-4-5','full-regression-gate','lane-split-check']`; live: 11/58, same 3 spellings, property holds | ✓ | ✓ PASS |
| **SC-002** "Mutating a registry id in a passing fixture turns the validator red." | copied real registry, mutated one id, same retro before/after | `EXIT(before)=0` → `EXIT(after)=1` | ✓ | ✓ PASS |
| **SC-003** "classes 1 and 4 are the subject of spec `008`... and are NOT claimed here... This spec does not claim coverage it does not have." | scope read + grep for overreach in registry Notes and CONVENTIONS.md | no class-1/4 claim anywhere; `workflow-pipeline-exit` Notes state "No catch data yet... zero true positives today" | ✓ | ✓ PASS |
| **SC-004** "No guard carries an exception list that grows by default; an exception needs a named reason." | grep for exemption mechanisms + `Object.isFrozen` probe | no allowlists; `KNOWN_ALIASES` frozen, exactly 3 measured entries, writes dropped; no exemption marker shipped | ✓ | ✓ PASS |
| **SC-005** "Replaying each of the three historical dead globs through FR-008 flags all three; a glob whose target exists is not flagged." | independent replay with `skipPlant` | `DEAD: [0,0,0]` · `FIXED: [1,1]` | ✓ | ✓ PASS |
| **SC-006** "FR-009 flags the exact snippet as committed on 2026-09-11 and does not flag the corrected capture-then-parse form." | linted the **real pre-fix file from git** into a temp root; then linted W2's corrected form | **`EXIT=1`, finding at `01-collect.md:21`** (first physical line of the pipeline, greppable); corrected W2 form → `findings: 0` | ✗ | ✓ **PASS** |

### Phantom BLOCKERs
None. The phantom check remains **inert for this plan rather than clean**: the wave
plan carries no `- [x]` checkbox tasks (`grep -cE '^\s*- \[[ x]\]'` → 0/0), so
`phantom check` reports `total_completed: 0, status: clean` having parsed nothing.
Not evidence. I verified artifacts directly instead — all eight claimed
modules/suites exist and are substantive (gate-ids 208, retro-validate 245+,
workflow-lint 279+38, glob-liveness 131 lines; four suites 546/217+31/243/39 lines;
W9 snippet 14 lines). `glob-liveness.cjs` has no facade dispatch, matching its
stated fixture-library-only design.

### Verify manually (weak phantom matches)
None.

---

## Round 2 — the two fixes, re-measured

### Fix 1 (was MAJOR): `joinContinuations()` — SC-006 now holds

`_shared/lib/workflow-lint.cjs` joins backslash-continued lines into one logical
line before matching, retaining the first physical line's number.
`scanFileForFindings` calls `joinContinuations(extractBashFenceLines(content))`.

**Before trusting the fixture, I checked its provenance** — the reconstruction was
the root cause in round 1. The W9 bash block is byte-identical to
`git show 9796760^:skills/a1-evolve/workflows/01-collect.md`:

```
diff <(git extract lines 2-4 of fence) <(w9 lines 2-4 of fence)
IDENTICAL — fixture is the verbatim git extract
```

Direct AC probe on the real historical file (not the fixture):

```
EXIT=1
{"scanned":1,"findings":[{"file":".../01-collect.md","line":21,
  "snippet":"ROOTS=$(node <repo>/_shared/a1-tools.cjs learnings roots  | python3 -c '...')  || { echo \"no project roots...\"; exit 3; }"}]}
stderr: finding: .../01-collect.md:21 — pipeline exit status swallowed: ...
```

Line 21 is verified greppable — `sed -n '21p'` on that file returns
`ROOTS=$(node <repo>/_shared/a1-tools.cjs learnings roots \`, the pipeline's first
physical line.

**The two requested measurements, redone by me (not taken from the report):**

| # | Mutation | Result | Matches report? |
|---|---|---|---|
| 1 | `joinContinuations(...)` call removed (line 170), confirmed via `git diff` to be the only change | `FAIL W9` (`rc=0 found=0`), **W1–W8 all PASS** → `8 passed, 1 failed` | ✓ exactly |
| 2 | same mutation still applied, live repo scan | **`scanned: 64, findings: 0`, exit 0** | ✓ exactly |

Measurement 2 is the most instructive result in this verification, and the
coordinator's reading of it is correct: with the capability deleted outright, the
live repo scan is indistinguishable from the fixed state. **W6's green scan could
never have proven this capability**, because the repo contains no instance of the
form — which is precisely why SC-006 had to be asserted against the git artifact.
This is the "guard that cannot fail" class caught one layer up, in the evidence
rather than the code.

**Regression risk I probed independently** (the fix touches every bash block in the
repo, so a false positive was the live danger):

| Adversarial shape | findings | Expected |
|---|---|---|
| W2's corrected form — **also a `\`-continued `\| python3`** | 0 | 0 ✓ |
| `grep -c foo \` → `\|\| echo 0` (value-default across a continuation) | 0 | 0 ✓ |
| 4-line continuation ending in `\|\| exit 3` | 1 | 1 ✓ |
| trailing `\` as the fence's last line (no follower) | 0 | 0 ✓ (no hang/crash) |
| continuation joining into `\|\| true` | 0 | 0 ✓ |
| escaped backslash literal, not a continuation | 1 | 1 ✓ |
| live repo, fix active | 0 of 64 | 0 ✓ |

W2 is the sharpest of these: its *corrected* form uses the same continuation-plus-pipe
shape as the defect, so a careless join would have made SC-006's second half fail.
It does not — the joined line carries no status test. The fix is precise, not blunt.

### Fix 2 (was MINOR): exit-code documentation corrected to the measured convention

I verified the convention claim independently before judging the decision. Six
subcommands on a bad/missing argument:

```
learnings roots --bogus -> 1    phantom check      -> 1
workflow lint --bogus   -> 1    cost run --bogus   -> 1
quick eligibility       -> 1    reconcile status --bogus -> 1
```

**The convention is exit 1, uniformly.** Correcting the documentation rather than
changing one command's exit code was the right call — the alternative would have
made `retro validate` the sole outlier in the facade. To answer the coordinator's
question directly: I do not think the convention is the wrong call here, and I would
not re-open it. Uniformity across the facade is worth more than per-command
expressiveness, especially since the two exit-1 meanings are mechanically separable:

```
usage error : exit=1  stdout=0 bytes
real drift  : exit=1  stdout=294 bytes   (JSON report)
empty-string arg: exit=1  stdout=0 bytes
```

(I measure 294 bytes where the report says 201 — different fixture, same property.)
That disambiguation is now documented in both the module header and `help.cjs`.

---

## Residual (MINOR, cosmetic — does not block)

### Three stale "exit 2 = usage error" strings survive the doc fix
Two of three documentation sites were corrected; three strings still promise the
old contract:

| Location | Stale text |
|---|---|
| `_shared/lib/help.cjs:518` | "2 usage error / retro file not found / ..." — **contradicts lines 507-510 of the same help block**, which correctly say exit 1 covers a bad argument |
| `_shared/gates-registry.md:55` | `retro-gate-ids` row: "2 usage/missing-file/unreadable-registry/malformed-block" |
| `_shared/retro-template.md:64` | "`2` usage error, the retro file is missing, ..." — the write-time instruction authors actually read |

- **Why it is not a gap:** no code path is wrong; the behaviour is correct and now
  correctly documented in the authoritative module header. This is drift between
  copies of one sentence.
- **Why it still matters:** `help.cjs` disagreeing with itself fourteen lines apart
  is the same "prose in three places, one of them stale" shape that produced G1 —
  the defect this entire spec exists to remove. Worth one sweep for consistency's
  sake.
- **Fix:** drop "usage" from the exit-2 clause in all three strings (the exit-1
  sentence already covers it).

---

## Build / Test Status
- **Full fixture sweep: 30 suites, all rc=0, 635 cases, 0 failed** (round 1: 634;
  +1 is W9). No regressions from `81b3c04`.
- Phase suites: `a1-workflow-lint` **9/9**, `a1-retro-validate` 19/19,
  `a1-glob-liveness` 6/6, `a1-code-roots` 11/11 — all re-run by me.
- No TS/npm toolchain in this repo by design (bash fixtures); nothing to
  type-check or build.
- Worktree clean after all probes; `_test-fixtures/a1-reconcile/` reset via
  `git checkout --` per the known pre-existing churn (not a finding).

---

## Round 1 record (commit `b6a8d4a`) — PARTIAL, preserved

### Gap 1 (MAJOR, now FIXED): linter missed the defect it was built for
SC-006 requires flagging "the exact snippet as committed on 2026-09-11". The
fixture `w1-piped-dollar-question.md` used a `$?`-on-next-line shape, but the real
snippet — `git show 9796760^:skills/a1-evolve/workflows/01-collect.md` lines 21-23 —
is a backslash-continued pipeline:

```bash
ROOTS=$(node <repo>/_shared/a1-tools.cjs learnings roots \
        | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["roots"]))') \
  || { echo "no project roots — fix A1_CODE_ROOTS before synthesizing"; exit 3; }
```

Linting that file yielded `{"scanned":1,"findings":[]}`, **exit 0**. Root cause:
`isSwallowedExitPipe(line, nextLine)` required parser stage and status test on one
line, with a one-line `$?` lookahead only. Isolated by two probes — same semantics
on one line → flagged; adjacent lines with `$?` → flagged; `\`-continued with `||`
→ missed. Fixed in `81b3c04`, re-verified above.

### Gap 2 (MINOR, now FIXED as documentation): usage exit code
No-argument and empty-argument invocations exited 1 while the header and registry
promised 2. Resolved by correcting the docs to the repo-wide convention; three
stale strings remain (see Residual).

### Round-1 mutation probes (all confirmed via `git diff` before trusting)

| # | Mutation | What died | Verdict |
|---|---|---|---|
| 1 | **Primary probe.** `learnings.cjs:398` `'project'`→`'projects'` | `a1-code-roots` caseF **alone**, message names the dead glob | ✓ guard catches its motivating defect |
| 2 | Same mutation **plus** removing `{skipPlant:true}` from caseF | `PASS F` — **green under the defect it exists to catch** | ✓ `skipPlant` is load-bearing, not decorative |
| 3 | `parseRegistryIds` → whole-file scrape | `FAIL R1` alone, naming leaked alias values | ✓ R1 is a real trap |
| 4 | drift branch widened to include `unknown` | `FAIL V3` alone, V2 green | ✓ statuses independently guarded |

Probe 2 was the key negative result of round 1: it proves the Wave 4
self-adapting-fixture fix does real work.

### Claims checked and confirmed true (both rounds)
- Registry rows sit **inside** the parsed table span (35 ids), via the same code
  path a1-evolve's gate-ROI uses.
- `workflow-pipeline-exit` Notes honestly disclaim catch data.
- Five write-time call sites, all `; RC=$?`, zero pipes.
- `--registry` is test-only — absent from production call sites.
- Plan error #4 genuine: `03-verify.md:140`'s `|` is a BRE alternation inside a
  quoted grep pattern; correctly not flagged.
- SC-001's set-and-property discipline implemented as specified; my independent
  live scan reproduced 11/58 across 3 spellings.

---

## Deviations from Plan
- `glob-liveness.cjs` ships without facade dispatch — intentional, consistent with
  FR-008's "fixture helper".
- No exemption-marker mechanism for `workflow lint` — correct per SC-004.
- `isolation-gate` registered mid-phase (Robert's decision), drift spellings 4 → 3.
- **Plan-quality finding (the lesson of this phase):** the plan's W1 row specified a
  `$?`-after-pipe predicate; the spec asked for the snippet *as committed*. The
  fixture was built to the plan's reconstruction, so SC-006 shipped green over a
  guard that could not fire. RED-proof fixtures for historical defects must be
  recovered verbatim from git, not paraphrased from a plan — now stated in W9's own
  header comment, which is the right place for it. Round 2 also shows why the
  correction had to be an AC-level probe rather than a suite addition: the live-repo
  scan is identical with and without the capability.
