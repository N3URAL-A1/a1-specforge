---
focus: all
generated: 2026-11-23
---

# Codebase Map: 027-lean-pipeline slice 5 (Reading path and bookkeeping, FR-027..FR-032)

Measured at `main` c6b10a2 (clean tree, 1 repo, plugin 1.18.0). Spec: `$A1_VAULT_ROOT/project/a1-specforge/spec/027-lean-pipeline.md` (US-027-10/11, FR-027..032, SC-006).
Slice 4 is merged (PR #108, #112). `skills/reading-budget.json` does not exist yet (`ls` exit 2).

## Reading path: line counts per skill (SKILL.md + workflows/*.md, measured `wc -l`)

| Skill | SKILL | workflow files | wf lines | total |
|---|---|---|---|---|
| a1-new-feature | 461 | 8 | 2099 | **2560** |
| a1-ux-studio | 180 | 10 | 1174 | 1354 |
| a1-fix | 272 | 5 | 911 | 1183 |
| a1-execute | 234 | 3 | 887 | 1121 |
| a1-modernize | 222 | 7 | 841 | 1063 |
| a1-analyze | 246 | 5 | 766 | 1012 |
| a1-pr-review | 144 | 5 | 720 | 864 |
| a1-plan | 110 | 5 | 652 | 762 |
| a1-roadmap | 378 | 4 | 341 | 719 |
| a1-new-project | 169 | 5 | 535 | 704 |
| a1-constitution | 186 | 4 | 517 | 703 |
| a1-reconcile | 207 | 4 | 472 | 679 |
| a1-worktree | 158 | 4 | 484 | 642 |
| a1-evolve | 105 | 4 | 517 | 622 |
| a1-quick | 295 | 0 | 0 | 295 |
| a1-progress | 162 | 1 | 153 | 315 |
| a1-phantom | 186 | 1 | 93 | 279 |
| a1-checklist | 78 | 1 | 143 | 221 |

18 skills, none has a budget entry. FR-027 requires an entry for every skill (a skill without entry fails).
The sums above count every workflow file; "default path" in FR-027 excludes files marked `<!-- load: conditional trigger=<cmd> -->` (marker does not exist anywhere yet: `grep -rl "load: conditional\|reading-budget"` returned no file).

### a1-new-feature files
SKILL.md 461; workflows: 00-roadmap-gate 50, 01-discover 169, 02-specify 141, 03-clarify 342, 04-plan 261, 04.5-consistency-gate 152, 05-implement 462, 06-verify 522. Also `_learning.md`, `agents/rene-link.md`, `templates/spec-template.md` (not counted above).

### SC-006 baseline problem (important)
- Spec baseline 2378 lines. Current default path is 2560 (+182 over the baseline). Slices 1-4 grew the files.
- The 2378 figure is not reproducible from the repo: at commit d4b8d42 (before 2026-11-12 12:00) SKILL + 8 workflows = 2339 (450+36+153+140+304+251+152+386+467). The counting rule of the baseline (which files, which path) is unknown. Open question for the plan: fix the counting rule in the budget script and record it.
- Cuts the spec names, measured on the current files:

| Cut | Lines now | Where |
|---|---|---|
| KRITIS blocks (FR-029) | 130 total: SKILL 39 (l.150-188), 02-specify 26 (l.67-77, 88-102), 03-clarify 53 (l.199-223, 299-326), 04.5 12 (l.41-52) | `<!-- a1-profile:kritis -->` blocks |
| Marketing Gate (FR-029) | 30 (SKILL l.311-340) | to global skill `a1-landing-feature` (outside repo) |
| Isolation Gate (FR-030) | 34 (SKILL l.341-374) -> 3 | raw `git worktree add` at l.352, `--delete-branch` at l.360 |
| Sum if all land | about 194 less, plus 3 added | 2560 - 194 + 3 = about 2369, only about 9 lines under 2378 |

  Margin to SC-006 is thin. The kritis move adds a conditional pointer line per block site and the new `kritis.md` is conditional (off the default path). `Size triage` table (SKILL l.90-124) was already cut by FR-025 in S4.
- Pointer lines added by FR-029/030 must be counted against the margin.

## Other skills touched by FR-028/FR-030

| Item | Current state |
|---|---|
| a1-plan 04b-xprov-review.md | 358 lines (spec target: at most 80 read per run). Sections: Precondition l.14, Inputs 26, Step 1.0 Consent 32-90 (59), Step 1 91, Step 1b design review 118, Step 2 route 167, Step 3 REVISE 216, Step 4 retro fields 257, Step 5 Waiver 274-325 (52), Edge cases 326-358. a1-plan total 762 (04b = 47%) |
| a1-plan 04-audit.md | 119 lines. PASS branch: "Then load `04b-xprov-review.md`" (l.~25) and vault-sync background fence (l.~44-58, `a1:background id=vault-mirror join=no`). FR-028(a) adds a permit-check step before the load. 04b is currently loaded on every PASS |
| a1-execute SKILL.md | 234 lines. `## Multi-lane phases` l.169-213 (45 lines, spec says 44) moves to NEW `workflows/multi-lane.md`. `## Isolation Gate` l.147-168 with raw `git worktree add` at l.158 |
| a1-fix SKILL.md | 272. Isolation Gate l.148; raw `git -C <repo> worktree add` l.159; forbidding mention l.166 |
| Forbidding mentions (need `lint-allow` marker) | a1-quick SKILL l.88, 281; a1-pr-review SKILL l.139; 05-merge.md l.98; a1-fix SKILL l.166 |
| Other matches of the FR-030 regex outside `a1-worktree/` | none: grep over `skills/` shows only the sites above plus a1-worktree itself (excluded) |
| xprov help | `_shared/lib/help-xprov.cjs` 534 lines (under the 800 cap), `help-xprov-consent.cjs` 155. Target of the 04b consent/waiver/edge-case move; `help.cjs` imports help modules |
| `_shared/parallel-spec-isolation.md` | exists (FR-030 pointer target) |

## Existing lints and pins that guard (or will fight) the cuts

### workflow-lint (`node _shared/a1-tools.cjs workflow lint [--root]`)
- `_shared/lib/workflow-lint.cjs` 443 lines; rule modules `workflow-lint-flow.cjs` 127, `-parallel.cjs` 184, `-verify.cjs` 181 (hook point near l.404-418 in the main file; cap 800 lines). Scans `skills/*/workflows/*.md` only (`listWorkflowFiles`), bash fences (`extractBashFenceLines`).
- `vault-sync-step` rule: `REQUIRED_VAULT_SYNC_FILES` = `04-audit.md`, `02-execute.md`, `03-verify.md`; each must hold a bash fence matching `/a1-tools\.cjs vault sync .* --phases/`. Scope: only when `skills/a1-plan` or `skills/a1-execute` exists under `--root`. Fixture W11 asserts `vault_sync_checked == 3`. FR-032 ("`vault sync --phases` once at each phase end, in no per-wave file") conflicts with this rule: the per-wave fence at `02-execute.md` l.262-265 is required by the rule today. The rule and W11 must change together with the cut.
- Per-wave sync sites now: `02-execute.md` l.248-265 (per wave); phase end: `03-verify.md` l.266-279, `04-audit.md` l.44-58. `cost run`: `03-verify.md` l.179, `a1-new-feature/06-verify.md` l.303, `a1-fix/04-verify.md` l.116.
- Suite: `_test-fixtures/a1-workflow-lint/` (`run-tests.sh` + `cases-flow.sh`, `cases-flow-cli.sh`, `cases-parallel.sh`, `cases-quiet-host.sh`, `cases-verify-bg.sh`, `cases-verify-scope.sh`, `snippets/`). Slice 4 added the `a1:parallel` and `a1:background` rule families.
- NEW rules needed: conditional-load reference lint (FR-028), `worktree\s+add` / `--delete-branch` lint with allow marker (FR-030), budget check (FR-027, either a workflow-lint rule or a `bin/` check).

### gates-lint
- `_shared/lib/gates-lint.cjs` 204 lines; reads `_shared/gates-registry.md` (rows with invoke column, `rowInvokes` in `gate-ids.cjs`), `_shared/quality-invariants.json` (12 keep-list gates incl. `pr-reinhard`, `owner_ref` + `must_contain`). Fixtures `_test-fixtures/a1-gates-lint/` with a frozen `corpus/skills/{a1-new-feature,a1-execute,a1-fix}/SKILL.md` + `corpus/.../02-execute.md`; `check-wave11-callsites.cjs` pins per-file call counts (e.g. `skills/a1-execute/SKILL.md`: `lane-split check` exactly 1). Moving the multi-lane text out of a1-execute SKILL.md must keep that call count (check whether the `lane-split check` call sits inside the moved section; it is pinned at 1 in SKILL.md).
- Gate chain of xprov (permit-check, preflight, gitleaks, tripwire) is not to be edited (FR-028). `a1-xprov` parts pin 04b: `06-gate.sh` l.154-157 (04b exists, `04-audit.md` links `04b-xprov-review.md`, SKILL row `| 4b |`, `xprov gate --phase <phase_name> --gate plan-review-xprov` in 04b); `12-permit-states.sh` l.399-402; `19-review-quality.sh` l.196, 269 (RQ8, sentences inside 04b); `36-design-targets.sh` l.195. Cutting 04b text to 80 lines breaks those greps unless the pinned strings stay.

### kritis golden (`_test-fixtures/a1-kritis-profile/`)
- `golden/prompts/` holds frozen copies of `SKILL.md`, `02-specify.md`, `03-clarify.md`, `04.5-consistency-gate.md` plus two agents; `parts/01-golden.sh` strips `a1-profile:kritis` blocks (`fixtures/strip-blocks.cjs`) from the current files and byte-compares to the golden after applying `golden/prompts.allowed-diff` (133 lines, ops `insert-after`, `delete-after`; each anchor must match exactly once, else exit 3). Every non-kritis line removed from or added to those files (Marketing Gate, Isolation Gate, pointer lines) needs an allowed-diff row, or the golden goes red.
- `parts/08-wiring.sh`: block lint (balanced markers, guard sentence directly after each open marker, block count per file 1/2/2/1/1/1), wiring greps with exact counts (`profile resolve` 1, `set` 1, `nfr-inject` 1, `ears-check` 2, `threat-model-check` 1, ...), `profile resolve` line pinned as `WIRE_RESOLVE` text, intent allowlist count 30 for new-feature/continue-feature, `gates lint` exit 0. FR-029 moves the blocks to `workflows/kritis.md`: the strip/compare logic, the block-count pin and the wiring greps (`grep -rhoE "a1-tools\.cjs [a-z-]+ [a-z-]+" skills/a1-new-feature` in 01-golden l.128 already scans the whole dir) need a deliberate rewrite. FR-029 states "the existing fixture passes unchanged": that cannot hold literally for the block-count and strip checks (open question for the plan).
- `_test-fixtures/a1-pr-review/run-tests.sh` l.336-340: stale-merge-command scan excludes `skills/a1-new-feature/SKILL.md` (it still carries `--squash --delete-branch`); l.228 pins the `no --delete-branch` string in a1-pr-review SKILL; l.234 loop over `05-implement.md`, `a1-fix/SKILL.md`, `06-verify.md`.

### a1-intent allowlists
- `_shared/lib/intent-sandbox.cjs` l.225-250: `NEW_FEATURE_ALLOW` (used for `new-feature` and `continue-feature`), `plan`, `execute`, `fix` ... lists of `<group> <sub>` keys; everything absent is refused (exit 77). `NEW_FEATURE_ALLOW` already includes `feature plan-steps`, `wave next-check`, `profile resolve` and the other profile commands. `feature close`, `run record`, `vault sync`, `dashboard build`, `cost run` are not in it; the XPROV/VAULT_WIDE/OUTSIDE_STORE exclusion records follow l.250.
- Consequence: any new CLI step the S5 flows call from an intent child (for example a budget check or `xprov permit-check`) is refused there unless listed. `xprov permit-check` is deliberately excluded (reads owner permit store; headless = Reinhard-only, spec 016). So in a1-plan under intent, the FR-028(a) permit-check step will exit 77 (intent child); the plan must define that outcome as "treat like denied" or it stalls. Not measured by running; read from code.
- Fixtures: `_test-fixtures/a1-intent/cases/06-run.sh` (X31: sealed SKILL.md declares no bare Bash and a1-quick's list; copies six SKILL.md files into a seal; `INTENT_SEAL_SKILL_REWRITE`), `06a-entry.sh` and `06-run.sh` l.306/591 contain a German text referencing the "Isolation Gate" in the load step (text pin about execute; check that the Isolation Gate heading stays in a1-execute).
- kritis part 08 pin "I": 30 allowlist entries for new-feature and continue-feature. Adding an entry changes that pin.

## Retros and learnings: where wired

- Prose retro per skill, each with `retro validate "$RETRO_FILE" --gate-log "$GATE_LOG" --phase ...`: `a1-new-feature/workflows/06-verify.md` l.445-495 (Step 6), `a1-execute/workflows/03-verify.md` l.287-342, `a1-fix/workflows/04-verify.md` Step 2b l.235-288 (mandatory, appended count check l.273), a1-pr-review `04-submit.md` Retro + `05-merge.md` l.103-106 (two retros validated against both gate logs; the caller's retro uses repeated `--gate-log`), a1-plan `04b` Step 4 l.257-273 plus the 04-audit Retro block; a1-analyze/05-report l.145, a1-constitution/04-write l.118, a1-checklist/01-run l.137, a1-phantom/01-check l.87, a1-modernize/07-publish l.125 (all per `_shared/retro-template.md`); a1-quick micro-retro (SKILL l.185, 272).
- Code: `_shared/lib/retro-validate.cjs` (416 lines; `cmdRetroValidate`, facade `retro` group at `a1-tools.cjs` l.690), `retro-gatelog.cjs` (124 lines, exports `checkRetroAgainstLog, firedYaml, readGateLog, isLegacy, retroVerdict, lastVerdicts, gatesFired`; `lastVerdicts` and `gatesFired` already exported, so the FR-031 note "exporting `lastVerdicts`" is done), `learnings.cjs` (409 lines, store writer), `_shared/retro-template.md`, `_shared/learning-schema.md`. a1-evolve reads `gates_fired` from retros: the machine record must keep the retro schema (spec Dependencies).
- `_shared/lib/feature-close.cjs` (337 lines, `feature close` from slice 4): grep for `retro|learn` returns 0 hits. FR-031 (machine retro record derived from the run record, prose only on catch/fail/`--issues`) is entirely new there. Cap headroom 463 lines. Facade `_shared/a1-tools.cjs` is 787/800 (13 lines headroom); new groups need one-line lazy branches. Facade `usage()` string at l.775 lists "Spec 027 slice 4 adds: ..." and must be extended.
- Gate log files are gitignored and deleted with the worktree (06-verify.md l.329-330), so the machine record has to be written before `worktree exit` (FR-035 run record).

## Sync / opt-in wiring

- Vault sync: facade `vault` group -> `vault-cli.cjs`, `vault-sync.cjs`, `vault-mirror.cjs`, `vault-writer.cjs`, `help-vault.cjs`. `dashboard build` -> `dashboard*.cjs`, `help-dashboard.cjs`. Skipped silently when `A1_VAULT_ROOT` is unset.
- Workflow sites listed above (execute per wave `02-execute.md:248-265`; phase ends `03-verify.md:266-279`, `04-audit.md:44-58`, background fence). `a1-progress` never runs sync (SKILL l.141-147).
- `PLAN-REVIEW-LOG.md`: written by `_shared/lib/xprov-run.cjs` (l.72, 110-112, 586, `appendLog`) and `xprov-gate.cjs` (l.79, 427 nopermit = no write). Documented in `a1-plan/SKILL.md` l.81 (tree), `04b`. `*.last-run.json`: written by redirect in `a1-execute/workflows/01-load.md` l.54 (`load-check.last-run.json`), `02-execute.md` l.72, 219-226 (`design-targets.wave.last-run.json`, `design-review-*.wave.last-run.json`) and `04b`. Reader check (FR-032) must cover: `02-execute.md` l.219-226 reads its own targets file, and spec Edge cases say xprov's unchanged-document logic may read them (`xprov-run.cjs` / `xprov-gate.cjs`). The spec's own note: 04b reads its own `*.last-run.json`, so the reader check exits non-zero until changed.
- Per-repo opt-in precedent: `.a1/xprov.json` (`external_review`), `.a1/verify.json`. The opt-in flag/env for FR-032 has no name yet (plan decides).

## Tech Stack
Node >= 18 CommonJS, no deps, Bash fixture suites (`_test-fixtures/<suite>/run*.sh`, run by `bash bin/run-suites.sh`, CI `.github/workflows/test.yml` with split jobs; `.a1/verify.json` `each: _test-fixtures/*/run*.sh`, `ci_evidence` lists the nine check names). Markdown skills. 800-line cap per code file. `_test-fixtures/suite-groups.json` groups suites for CI; a NEW fixture suite or part likely needs a group entry (see S2/S3 precedent; not re-measured here).

## Quality Notes
- `_shared/lib/checklist.cjs` is 823 lines (over cap, already known from S4 MAP; do not edit).
- Facade headroom 13 lines: the biggest constraint for new subcommands.
- Docs counting: README/Install-Sync (`bin/verify-install-sync.sh`, CLAUDE.md "Single Source of Truth") is unaffected unless skills/agents are added or removed; a new `workflows/*.md` or `kritis.md` is not a skill.
- ADR dir latest: `2026-10-28-optional-profile-lane.md` (a1-new-feature profile design that FR-029 changes in effect).

## Concerns (ordered)
1. SC-006 margin: about 9 lines under 2378 if every named cut lands (see table). Counting rule of the baseline is unreproducible; budget entries are set from "achieved size" so the rule must be fixed first.
2. kritis golden/allowed-diff and part 08 block-count/guard pins fight FR-029; "passes unchanged" is not literally achievable.
3. FR-032 vs the `vault-sync-step` rule and W11: rule requires the per-wave fence file `02-execute.md`.
4. a1-intent: `xprov permit-check` is not on any allowlist, FR-028(a) runs it inside a1-plan; behaviour under an intent child (exit 77) needs a defined branch.
5. Ratchet needs a commit-trailer check (`budget-raise:`) that reads git history; CI checkout depth and the local run mode are open (not measured).
6. Cross-repo dependency: Marketing Gate questions go to global `~/.claude/skills/a1-landing-feature` (not in this repo; not measured whether the skill exists at that path here).
7. Facade 787/800 and `usage()` text maintenance.

## Relevant for This Task
- Facts the planner needs: exact current line counts above; the three kinds of existing guard (workflow-lint rule modules with fixture snippets, golden byte-compare with allowed-diff anchors, per-file grep pins in xprov/pr-review/gates-lint suites) each reference text that FR-028..030 move; the retro machinery has `gatesFired`/`lastVerdicts` but `feature close` has no retro code; no `skills/reading-budget.json`, no conditional-load marker, no budget script exist yet.
- Open questions (not findings): the baseline counting rule; whether a1-landing-feature exists locally; the opt-in flag name; behaviour of the plan step under intent; CI shallow-clone for the `budget-raise:` trailer check.
