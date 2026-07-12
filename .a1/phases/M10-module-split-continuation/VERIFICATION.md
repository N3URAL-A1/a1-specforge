---
plan: .a1/phases/M10-module-split-continuation/PLAN.md
goal: Extract the 14 remaining command groups out of the 7196-line _shared/a1-tools.cjs facade into _shared/lib/<group>.cjs modules, fixing F-011 (usage/HELP injection coupling), F-007 (fix/constitution zero fixture coverage), F-009 (5 oversized functions), and F-006 (facade line-count reduction) — while keeping the CLI contract byte-identical and every fixture suite green after every wave.
verdict: PASS
passed: 8
gaps: 0
verified: 2026-07-12T12:29:53Z
---

# Verification: M10-module-split-continuation

## Verdict: PASS

All 8 success criteria (SC-1 through SC-8) were independently re-verified against the actual codebase state (not STATUS.md's claims) using direct grep/wc/diff/runtime checks. The facade dropped from a verified 7196-line baseline (`git show dbeba25:_shared/a1-tools.cjs | wc -l`) to a real, currently-checked-out 561 lines. All 22 fixture suites pass, including an explicit standalone re-run of the security-sensitive `a1-cmd-injection` suite. Git history shows a genuine, atomic, monotonically-shrinking 17-wave commit sequence with no squashing or missing waves.

## Success Criteria Results

| SC | Criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | usage/HELP injection coupling fixed at root; zero new init()-injection call sites | PASS | `grep -c "usage: deps.usage\|init({ usage\|function buildHelp" _shared/lib/*.cjs _shared/a1-tools.cjs` → 0 everywhere. 16 lib modules `require('./help.cjs')`. 7 lib modules `require('./status-constants.cjs')` (spec, analyze, modernize, reconcile, fix, constitution, help.cjs itself) — exceeds the ≥6 bar. |
| SC-2 | All 14 command groups' functions live in lib/, none in facade | PASS | `grep -n "^function " _shared/a1-tools.cjs` → only `main()` remains (line 346). Zero `^function cmd*` anywhere in facade. Spot-checked all 14 groups' representative dispatcher functions individually — all return 0 in facade. |
| SC-3 | a1-fix / a1-constitution fixtures exist, follow CONVENTIONS.md shape, green, written BEFORE extraction | PASS | Both suites exist, executable, run green (46 passed/0 failed; 57 passed/0 failed). `git log --follow` confirms fixture commit `4aa52d7` (Wave 15) predates extraction commits `7619d07`/`3acdacc` (Wave 16). |
| SC-4 | runChecklistChecks split into parse/compute/format helpers, no helper >~100 lines | PASS | `_shared/lib/checklist.cjs` has 16 functions; largest is `cmdChecklistRun` (97 lines, pre-existing dispatcher, never an F-009 target) and `evaluateChecklistRules` (92 lines, the actual split-produced compute orchestrator). `runChecklistChecks` itself is now a thin 15-line orchestrator. |
| SC-5 | main()'s dispatcher trimmed, no dead per-group section comments | PASS | `main()` is 214 lines (down from 220-line baseline). `grep -c "^// ---------- .* subcommands ----------"` → 0. All 20 remaining section markers use the unified `// ---------- <group> group (lib/<group>.cjs) ----------` format and each sits directly above a live `require()`. |
| SC-6 | product.cjs's init() dropped; CODE_SCOPE_STAGES imported directly from lib/code-scope.cjs | PASS | `grep -c "init(" _shared/lib/product.cjs` → 0. `grep -n "require.*code-scope.cjs" _shared/lib/product.cjs` → present (`const { CODE_SCOPE_STAGES } = require('./code-scope.cjs');`). |
| SC-7 | Facade shrinks to <900 lines (from verified 7196 baseline) | PASS | `wc -l _shared/a1-tools.cjs` → 561 lines. Baseline independently re-verified: `git show dbeba25:_shared/a1-tools.cjs \| wc -l` → 7196. Net reduction: 6635 lines (−92.2%). |
| SC-8 | All fixture suites green every wave; a1-cmd-injection explicitly re-run after reconcile wave | PASS | Full aggregate loop (`for r in _test-fixtures/*/run*.sh`) → 22/22 suites green. Explicit standalone `bash _test-fixtures/a1-cmd-injection/run.sh` → 7 passed, 0 failed. `gitLastTouchIso` byte-diffed between pre-Wave-14 facade and post-move `lib/reconcile.cjs` → IDENTICAL. |

## Independent Verification Detail (beyond STATUS.md's own claims)

**Syntax / load checks (re-run independently):**
```
node --check _shared/a1-tools.cjs            → OK
for f in _shared/lib/*.cjs; do node --check "$f"; done  → OK (22 lib files, all clean)
node -e "require('./_shared/a1-tools.cjs')"  → loads and prints HELP, no ReferenceError
```

**Full fixture suite loop (independently re-run):** 22/22 suites green (`_test-fixtures/*/run*.sh`), zero failures.

**Explicit a1-cmd-injection re-run (independently re-run, not just aggregate):** 7 passed, 0 failed — hostile `$(...)` payloads in anchor text, `--repo-path`, and `--since` all rejected/inert, no shell invocation, no marker file created.

**Facade line-count progression across every wave commit (re-derived from git history, not copied from STATUS.md):**
```
dbeba25 (pre-Wave1): 7196   618b029 (W1): 6728   fb2312c (W2): 6287
b9d1c31 (W3): 6095    5d33155 (W4): 5831   4b94c7f (W5): 5561
f653a6e (W6): 5122    60956f9 (W7): 4398   c5bf97b (W8): 3975
731798b (W9): 3685    7299033 (W10): 3065  bbc8fbd (W11): 2946
7476e98 (W12): 2490   711fcef (W13): 1942  151506d (W14): 1412
4aa52d7 (W15): 1412   7619d07 (W16.1): 986 3acdacc (W16.2): 575
2e98804 (W17): 561
```
Monotonically decreasing across every single commit — matches STATUS.md's per-wave figures exactly, confirming they are not fabricated.

**Group-body spot check (broader than STATUS.md's 15-function sample):** `grep -n "^function " _shared/a1-tools.cjs` shows exactly one function left in the entire 561-line facade — `main()` at line 346. This is a stronger check than sampling individual group names: it proves zero function bodies of any kind (not just the 14 named groups) remain in the facade.

**"Hidden constant" claims spot-checked directly** (the recurring `*_STATUS_TO_PHASE` / stopword / regex findings STATUS.md reports across Waves 2, 11-14, 16): `SPEC_STATUS_TO_PHASE`, `ANALYSIS_STATUS_TO_PHASE`, `MODERNIZE_STATUS_TO_PHASE`, `RECONCILE_STATUS_TO_PHASE`, `CONSTITUTION_STATUS_TO_PHASE`, `SQL_TYPE_ALIASES`, `CLAUDEMD_LINK_MARKER_START/END` — all confirmed absent from the facade (0 hits each) and present in exactly their claimed `lib/<group>.cjs` destination. No stranded references, no latent ReferenceError risk.

**F-015 security-sensitive byte-diff (independently re-derived, not trusted from STATUS.md):** extracted `gitLastTouchIso`'s body from the pre-Wave-14 facade commit (`711fcef`) and diffed it against the post-move body in `_shared/lib/reconcile.cjs` — `diff` output empty, confirmed IDENTICAL. The `execFileSync`-array form (via `gitSafe`) survived the move unchanged.

**Git history integrity (independently re-derived):** `git log --oneline` shows 18 distinct "M10 Wave N" refactor/test commits (Waves 1, 7, 8, 16 each produced 2 commits for paired/multi-task waves; every other wave produced exactly 1), each followed by its own `docs(a1): update M10 STATUS.md after Wave N` commit — 34 total commits for the phase (18 code + 16 status-doc, wave 17 only has 1 status commit after it since it's the last). No squashed multi-wave commits, no missing waves, no out-of-order waves. This is a real, atomic-per-wave sequence, not a fabricated log.

**CLI contract stability (independently re-run):**
- From outside repo cwd: `cd /tmp && node /Users/rob/code/a1-skills/_shared/a1-tools.cjs check reservations --list --file /tmp/m10-verify-smoke.json` → exit 0, valid JSON.
- `--help` still resolves and prints the usage banner.
- Cross-section smoke across groups extracted in different waves — `spec list`, `fix list`, `modernize list`, `worktree list`, `pack validate <nonexistent>` — all produced valid JSON or a clean, expected user-facing error (never a crash or `ReferenceError`).

## Gaps

None found. All 8 success criteria independently confirmed true against the current codebase state, not merely re-stated from STATUS.md.

## Build / Test Status
- Syntax (`node --check`): PASS — facade + all 22 lib modules clean.
- Runtime load (`node -e "require(...)"`): PASS — no ReferenceError, HELP renders.
- Fixture suites: PASS — 22/22 green (aggregate loop + explicit a1-cmd-injection re-run).
- Facade line count: 561 (target <900) — PASS with 339 lines of margin.

## Deviations from Plan

These are pre-existing, already self-reported deviations in STATUS.md, independently spot-checked as non-blocking:

1. **a1-reconcile fixture suite writes live timestamps into checked-in fixture files** during each regression run (a pre-existing Isolation-convention violation, not introduced by this phase). Each wave's executor reverted the resulting diff via `git checkout --` before staging rather than fixing the suite itself — correctly scoped as out-of-phase-scope, and confirmed the working tree is currently clean (no stray diff left behind).
2. **Checklist split used 5 helpers instead of the plan's suggested 3-phase (parse/compute/format) shape** — the plan explicitly authorized this ("executor's judgment, whichever keeps the diff smallest and clearest"); verified the resulting functions all still satisfy the <~100-line ceiling that was the actual binding constraint (SC-4), so this is an acceptable, plan-sanctioned deviation, not a gap.
3. **Wave 17 kept Option B (unchanged if/else dispatcher) rather than Option A (dispatch-table collapse)** — the plan explicitly recommended Option B by name for exactly this reason (facade already well under the SC-7 target; a structural rewrite on the final wave would add regression risk for no measurable benefit). Confirmed acceptable.

No deviation found that affects any SC's binding pass/fail condition.
