---
plan: .a1/phases/027-lean-pipeline-s5/PLAN.md
plan_revision: 2
round: 2
verdict: PASS
blockers: 0
majors: 4
minors: 7
lanes_audited: 4
lane_split_check: PASS
generated: 2026-11-23
---

# Plan Audit

## Round 2 (PLAN.md revision 2)

### Verdict: PASS

No BLOCKER. Four new MAJOR findings and seven MINOR. R2-M1, R2-M2 and R2-M4 name a Done-when probe that goes red as planned (RP0, CLI1, the Task 5.1 caps). Under the PASS-branch rule they go back to Pablo in revision mode before execution. R2-M3 should be fixed in the same round.

All round-1 findings are addressed. M1 and M4 are fixed in substance, but the fix relies on a regex export that does not exist yet (R2-M1).

Measured at `main` c6b10a2 during this round:
- `lane-split check --plan … --phase 027-lean-pipeline-s5` exit 0. The plan is unchanged since the planner's run at 06:25Z, so the result was reused. With `--imports .`: exit 0, 4 lanes, 9 lane waves, `sequential_after_lanes` [10, 11, 12, 13], 0 findings.
- `plan depth-check --plan … --phase 027-lean-pipeline-s5`: verdict pass; section, subheadings, placeholders and oracle all pass.
- These red runs were reproduced:
  - V1: rc=1, `ls` rc=2.
  - V2: 2560.
  - V3: keys end at `background_checked,findings`, `reading_path` false, 0 conditional files.
  - V5: 358 / 925 / 26802, `xprov --help consent` and `--help edge-cases` rc=2.
  - V8: 9.
  - V9: `retro validate` on lines 329 and 495.
  - V10: 1, `check-optin-readers.cjs` absent.
  - V13: rc=1, with the six new files listed as missing.
  - V16 / Task 13.1: both vault greps print 0, and `grep -c 'Would a customer notice this'` in the global skill prints 0.
- M7 red: `buildObservation({…, recovered: true, recovery: [...]})` returns keys ending at `recovered`, without `recovery`.
- D11 counts (fenced lines via `extractBashFenceLines`, substring vs anchored):
  - `04-audit.md`: vault sync 2/1, dashboard build 2/1;
  - `03-verify.md`: 2/1, 2/1, cost run 1/1;
  - a1-fix `04-verify.md`: cost run 2/1;
  - `06-verify.md`: cost run 1/1;
  - `05-implement.md`: 0.

  This matches the plan exactly.
- The planned 04-audit permit fence was run verbatim on this repo. It printed `xprov permit-check exit=1 state=denied`, so the JSON is on stdout and the human lines are on stderr. The denied branch fires as designed.
- The default paths re-measured as a1-new-feature 2560, a1-execute 1121, a1-pr-review 864, a1-plan 762, with 18 skills.

### Round-1 findings: status

| Id | Status | Evidence |
|---|---|---|
| M1 | Fixed, with a new gap | W12 is now module-level in Task 10.1 and RP8 is the CLI form after the hook, with one id `sync_per_wave`. RED-proof (b)/(d)/(e) are real W12 red runs. The case passes `VAULT_SYNC_CALL_RE`, but that constant is not exported (R2-M1). |
| M2 | Fixed | D12a scope. Measured: `copySkills` (`run-tests.sh:287-291`), `copyFull` (`cases-verify-scope.sh:5-12`, adds `agents/` and a single `pr-merge-check.cjs`) and `copy_tree` (`run-wave13.sh:29`, `run-wave14.sh:31`) never copy `_shared/a1-tools.cjs`. a1-fix wave12 (`--root "$REPO_ROOT"`) and a1-metrics AU3f (default root) lint the real tree. **Bypass on the real tree: none found.** CI runs `node _shared/a1-tools.cjs workflow lint` (`.github/workflows/test.yml:91`), the root resolves through `git rev-parse --show-toplevel` (`io-roots.cjs:285`), and `_shared/a1-tools.cjs` is a tracked regular file (mode 100755). It is also present in the merge-check `git archive` snapshot. The scope only switches off on trees that lack the facade, which is the consumer-repo case (see R2-M3). |
| M3 | Fixed | Action 2(g) quotes 06-verify.md:329-330 verbatim (checked). RED-proof (d) is measured. RR_POS (`run-tests.sh:262`) is added to the suite run. |
| M4 | Fixed, with a new gap | The anchored regexes are defined, SP5 copies the real files, and RED-proof (f) is measured. The import of `VAULT_SYNC_CALL_RE` cannot work as written (R2-M1). |
| M5 | Fixed | Exempt placeholders are named, block T defines `RD="$(mktemp)"`, and RS2b and RS5 cover it. The 5.3 line is included in RS5. |
| M6 | Fixed | Task 13.1 writes the readings to the spec `## Clarifications` (append-only; the section ends at spec line 340, before `## Quality Invariants`) and to the hub (new section above line 23). The final report is the consumer. The grep probes are red today (0/0). |
| M7 | Fixed | The `recovery` field is checked against the code: the four actions exist in `xprov-recover.cjs` (`runner_retry` :151, `blocked_retry` :152, `base_recomputed` :211, `preflight_repair` :269/279). Retries are bounded (`RETRY_DELAYS_MS`, at most 3 attempts), so the `attempts` 0..9 and ≤ 8 items bounds hold. OL7 expects `attempts: 2` for OB3 (`SEQ29="[$NET29,$OK29]"`, `29-recovery.sh:432`), which is consistent. No other observation reader rejects unknown keys: `wave-next-check.cjs:46-52` parses JSON only, and `learnings.cjs:392` treats the file as a glob. The part-29 mutation needles (`return Object.freeze({ ...obs, ...runFieldsOf(o) });`, `if (!state.observed) {`) stay unique under the planned edits. Remaining notes in R2-m1 and R2-m7. |
| M8 | Fixed | RP3 is `lines <= budget`, and RP3b is a one-time equality line in STATUS. Task 12.1 action 5 re-runs `--write`. The `<=` rule fits FR-027 ("a later change may lower an entry"), and the reading is listed for reconcile. Interplay with the ratchet: see R2-m3. |
| m1 | Fixed | One form, `base.budget == "absent"`. |
| m2 | Fixed | The missing paths are added to code_scope. |
| m3 | Fixed | The text now says "any lane". |
| m4 | Fixed | D3 now says headings are found outside fences only. RD8 and RED-proof 2.1 (g) are added. |
| m5 | Fixed | D14 is in the reconcile list. |
| m6 | Fixed | `MENTIONS_ALLOWED` is now line-exact, and OL8 covers it. |
| m7 | Fixed | The global skill is now edited after the merge (Task 13.1). |
| m8 | Fixed | Red runs are listed: 4.1 (e)/(f), 10.2 (h)/(i). |
| m9 | Fixed | The a1-evolve note is now a hub item. |

Wave 13 as an orchestrator task after the merge is sound in structure. Its writes are outside the repo and outside the claim. `STATUS.md` is tracked (s4 precedent: `git ls-files .a1/phases/027-lean-pipeline-s4/` lists STATUS.md), so the `fallback:` line can be read from `main` after the pull. The global skill exists on this host (`~/.claude/skills/a1-landing-feature/SKILL.md`, a regular directory) and the question text is verbatim in `SKILL.md:321`. The execution context is unnamed (R2-m5).

### BLOCKERS (must fix before execution)
None.

### MAJOR (high risk of failure)

- **[R2-M1]** `VAULT_SYNC_CALL_RE` is not exported, and the three places that pass it disagree.
  - `workflow-lint.cjs:260` defines `const VAULT_SYNC_CALL_RE`. The exports at :433-443 are `cmdWorkflowLint, isStatusTesting, isValueDefaulting, isSwallowedExitPipe, extractBashFenceLines, joinContinuations, listWorkflowFiles, checkVaultSyncSteps, REQUIRED_VAULT_SYNC_FILES` (measured with `Object.keys(require(...))`).
  - The plan says the following:
    - D11 and Task 2.1 say "imported from `workflow-lint.cjs` … add it to the `helpers` argument". Lane lint does not own `workflow-lint.cjs`, so Wave 2 cannot add the export.
    - The Task 2.1 cases pass only `extractBashFenceLines`.
    - Task 10.1 W12 passes `VAULT_SYNC_CALL_RE`, with no source for it.
    - The Task 11.1 hook passes `{ extractBashFenceLines }` only (PLAN line 1006).
  - At the hook, `helpers.VAULT_SYNC_CALL_RE` is therefore `undefined`. Either `.test` throws (workflow lint crashes), or a guarded count is 0, which makes `sync_phase_end_count` fire on `04-audit.md` and `03-verify.md`. Both turn RP0 red, which is a STOP.
  > Fix: in Task 10.1 action 3, add `VAULT_SYNC_CALL_RE,` to `module.exports`. The line arithmetic is 443 − 1 (array element) + 1 (export) = 443, then + 2 in 11.1 = 445 ≤ 445; state it. Make the 11.1 hook pass `{ extractBashFenceLines, VAULT_SYNC_CALL_RE }`. In Task 2.1, have `checkReadingPath` throw `A1_INPUT` when `helpers.VAULT_SYNC_CALL_RE` is not a RegExp (fail closed, never count 0), let the RD/SP cases pass the D11 literal, and add a RED-proof "hook without the regex → RP0 red". Alternatively, let `workflow-lint-read.cjs` own the regex and have `workflow-lint.cjs` import it in Wave 10. Pick one source.

- **[R2-M2]** CLI1 (Task 10.2 action 6) is red as planned. Task 10.1 action 6 writes `skills/reading-budget.json` with equality budgets. Task 10.2 then grows a1-pr-review's default path: the 5.3 lines, block T and its prose in `05-merge.md`, plus the `04-submit.md` change. `workflow budget` without flags reports `findings` and exits 1 on any finding (Task 1.1: "0 clean, 1 finding"), so CLI1 ("`workflow budget` exits 0 on the real tree") gets `budget_exceeded:a1-pr-review`. The 10.2 Done-when ("the suites of action 7 pass", which includes a1-workflow-lint) is then red, which is a STOP. RED-proof (d) ("the facade line removed → CLI1 red") is not affected.
  > Fix: in Task 10.2, after the skill edits and before action 6, re-run `node _shared/a1-tools.cjs workflow budget --write` (the facade line exists by then) and commit the file. Or make CLI1 assert rc ∈ {0,1} plus the JSON shape until Task 11.1 tightens it, but a tightening is an assert edit, so the first option is better. Also name it in D12 ("Task 10.2 rewrites after its skill edits").

- **[R2-M3]** The 05-merge 5.3 ratchet line runs in every repository that uses a1-pr-review, and the plan does not define or test what `workflow budget` does there.
  - In 05-merge, `<repo>` is the a1-specforge path and `<repo_root>` is the reviewed repo (lines 137, 150, 159), so cwd is a consumer worktree such as a1-office or niimo.
  - `workflow budget`'s default root is `git rev-parse --show-toplevel` of cwd. That root holds no `skills/`, no `reading-budget.json` and no facade.
  - D12a is specified for `checkBudget` only. Task 1.1 does not say what `measureSkills` does on a missing `skills/` (a bare `readdirSync` throws, which gives exit 2), or whether the CLI reports `budget_file_missing` outside `checkBudget`.
  - Any non-zero exit hits the new `STOP … no merge` line. After release 1.19.0, that blocks every merge in every consumer repo. BG3-BG14 all use a planted tree with the facade, or a planted repo whose shape is not specified.
  > Fix: in Task 1.1, specify that `cmdWorkflowBudget` on a root outside the D12a scope (no `skills/` or no facade) prints `{…, scope: "out", skills: []}` and exits 0, with and without `--base`. Add BG15: a planted git repo without `skills/` and without a facade, `--base HEAD~1` → exit 0. Add a RED-proof "scope check removed from the CLI path → BG15 red (exit 1 `budget_file_missing` or exit 2)". Name consumer repos in the 5.3 STOP text rationale.

- **[R2-M4]** The `help-xprov.cjs` cap (620; 534 today, 86 lines of headroom) very likely cannot hold the moved text without reflowing it into long lines.
  - Measured sizes of what Task 5.1 moves into `routing` and `edge-cases`:
    - Edge cases: 3269 bytes.
    - From Step 2: the five `not_applicable` detail rows 173-177 (552 + 414 + 523 + 925 + 455 bytes, about 2.9 kB), the notice lines 181-185 (about 0.9 kB), the warning/halt block 187-198 (about 0.6 kB), and the round-cap/dispositions text 200-214 (about 1.3 kB).
    - Total: about 8.9 kB.
  - `help-xprov.cjs` averages 74 characters per line, and its longest line is 137. At that density the move is about 120 lines; even at 100 characters per line it is about 89.
  - The Task 5.1 Done-when ("the three files are within their caps") then goes red. The only way to stay under the cap is the reflow-to-long-lines gaming that the Depth Pass itself rules out. `help-xprov-consent.cjs` (about 6.3 kB into 105 lines of headroom) is fine.
  > Fix: measure the bytes to be moved with `sed -n` before setting the cap, then either raise the `help-xprov.cjs` cap (about 680) or put `routing` and `edge-cases` into a new lane-xprov module `help-xprov-topics.cjs` (cap about 200, added to `owns:` and V13), interpolated from `help-xprov.cjs`. Add a check to the Task 5.1 Done-when: no line in the moved topics is longer than 140 characters.

### MINOR (execution proceeds, but note)

- **[R2-m1]** A second M7-class sentence survives. `help-xprov.cjs:324-325` (xprov gate help) says "Self-recovery (… xprov-recover.cjs; recovery in stdout and in the log entry)". It does not contain the literal `PLAN-REVIEW-LOG`, so `check-optin-readers` and HT8 cannot see it, but with the log off by default it becomes false. Rewrite it to "recovery in stdout, in the observation line, and (with `A1_KEEP_REVIEW_LOGS=1`) in the log entry", and add an HT anchor. Lines 167/171/345 (the observe field lists naming `recovered`) could name `recovery` as well. `_shared/learning-schema.md` lists no run fields, so it needs no edit (precedent: `recovered` is not listed either).
- **[R2-m2]** Permanent real-tree pins on quantities that will change (the M8 class). RP0 requires `budget_skills == 18`, so adding a skill means editing the assert. RP1 requires `conditional_files == 4`, so a new conditional file means editing it. RP2 requires a1-new-feature ≤ 2360, which is stricter than SC-006's "below 2378", so a later raise that FR-027 permits with a trailer turns RP2 red. Under the existing-assert rule every one of those is an assert edit. Prefer: RP0 `budget_skills` equal to the number of `skills/*/SKILL.md`; RP1 listing the four files by name (≥); RP2 as a one-time STATUS line like RP3b, with the permanent case `< 2378`.
- **[R2-m3]** Interaction of `<=` and the ratchet. The ratchet compares budget entries, not sizes. With `<=`, a PR that shrinks a skill without lowering its entry leaves slack, and a later PR can grow back into it with no lint finding and no trailer. That fits "may lower", but it weakens "locks the achieved size". Say this in the D12 reading for the owner (Task 13.1), so the reconcile decides with the trade-off in view. Optionally, `--base` could warn `budget_slack:<skill>` for skills whose files changed in `<base>..HEAD` and whose lines are below their entry.
- **[R2-m4]** In the Task 11.1 reserve-cut path ("STOP and apply the reserve cuts … re-measure"), the budget file written in action 2 is not rewritten. RP3 stays green, but the RP3b equality line fails for a1-new-feature. Add "re-run `workflow budget --write`" after the reserve cuts.
- **[R2-m5]** The Wave 13 execution context is not named. After Task 12.1 action 7 (`feature close`) no worktree exists, so the per-wave gate (`verify run --affected --project "$WORK_PATH"`) has no target, and the scope is already released. Say: Wave 13 runs from the primary checkout on pulled `main`; the per-wave gate is not applicable; the evidence goes into the final report (V16), not into a repo STATUS file. Say also that SC-7's post-merge clause and SC-13 are checked by the orchestrator, not by the pre-merge VERIFICATION.md. Also, Task 13.1 action 1 runs `claude plugin update a1-specforge` on the Mac, but the 1.19.0 release is only proposed (Task 12.1 item 8). Either drop the update from 13.1 or make it follow the release.
- **[R2-m6]** The block-order classifier at `a1-pr-review/run-tests.sh:265` maps any block that contains `feature close` to `F`. Block T contains `feature close --check-only`, so without a new pattern placed before the F test (for example `/prose_required/` → `T`), the order reads `DCMGFRFP`, not `DCMGTRFP`. Add this sentence to the pin-table row.
- **[R2-m7]** D9 says the per-repair detail "(action, attempts, `codex_blocked_fallback`)" is redirected. The compact shape `{action, ok, attempts?}` drops the `fallback` flag of `blocked_retry` and the `from`/`to`/`actions` fields. The fallback reason does reach the observation `msg` (`(codex_blocked_fallback at …)`, `xprov-gate.cjs:555`), so state that. Also, `stepObserve` (`xprov-gate.cjs:340-352`) calls `observe()` outside a `try`, so an `A1_INPUT` thrown by the new `recovery` validation would abort a gate run after Codex already ran. Make the `runFields` mapping clamp or truncate to the valid shape, so that it can never throw.

### What's Good (round 2)
- The revision measures before it claims. The VS7 1122/1121 example, the W12 old-pin `removed=0`, the substring/anchored counts, the `buildObservation` drop, the RS5 stub and the vault greps all reproduced.
- The D12a scope was the right choice over re-pinning a dozen copy-based cases. It is guarded by BG13 and by the post-hook run of every copy-based suite (Task 11.1 action 5), with "fix the scope, never the case".
- M7 was solved within FR-032: the trail moved to the always-written observation line, with a closed enum, bounded ints, no error text, and OL7/OL9 tests. The planner did not reopen the opt-in file.

---

# Round 1 (PLAN.md revision 1, kept unchanged)


## Verdict (round 1): PASS

No BLOCKER. Eight MAJOR findings. M1, M3, M4 and M8 name Done-when or Verification probes, so under the 04-audit PASS-branch rule they go back to Pablo in revision mode before execution. The other MAJORs should be fixed in the same round.

Measured at `main` c6b10a2 during this audit:
- `lane-split check` exits 0 both without and with `--imports .` (4 lanes, 9 lane waves, `sequential_after_lanes` [10, 11, 12]).
- `plan depth-check`: no offending answers.
- These red-run values were reproduced: V1 rc=1, V2 2560, V3 0 conditional files, V5 rc=2 / 925 chars / 26802 bytes, V8 9 lines, V9 `retro validate` count 2, V10 count 1.
- Caps: facade 787, `workflow-lint.cjs` 443, `xprov-run.cjs` 918, `xprov-gate.cjs` 734, `xprov.cjs` 444, `help-lean.cjs` 68, `help-xprov.cjs` 534, `help-xprov-consent.cjs` 155.
- Facade arithmetic: 787 + 1 (`workflow budget` branch; the `else usage` line exists at `a1-tools.cjs:704`) = 788 ≤ 790. `workflow-lint.cjs`: 443 − 1 + 2 = 444 ≤ 445. `xprov-run.cjs` stays at 918: the guard fits into the existing `if (ctx.noLog) return null;` line 596.
- SC-006 arithmetic: SKILL.md 461 − 38 (39-line kritis block, +1 pointer) − 28 (Marketing 311-340, +pointer +blank) − 29 (Isolation body 343-374 → 3) + 1 = 367. 06-verify 522 − 112 = 410. Total 2354. Reproducible: the counting function is "the count of `\n`", and `cat … | wc -l` equals the sum of the per-file counts. The Task 8.1 glob `workflows/0*.md` excludes `kritis.md` and `retro-prose.md` correctly.

## Findings

### BLOCKERS (must fix before execution)
None.

### MAJOR (high risk of failure)

- **[M1]** The W12 re-pin in Task 10.1 depends on a rule that is only hooked in Task 11.1. Task 10.1 redefines W12 as "a planted `vault sync … --phases` fence in 02-execute.md → one `sync-per-wave` finding". W12 lives in `a1-workflow-lint/run-tests.sh` (`vaultSyncCase`) and runs the CLI `workflow lint --root <copy>`. `checkReadingPath` reaches the CLI only in Task 11.1 action 1. So in Wave 10 the new W12 cannot see a `sync_per_wave` finding, and the 10.1 Done-when ("the suites of action 7 pass") is red, which is a STOP under the plan's own rule. Two smaller problems:
  - The rule name differs: the pin table says `sync-per-wave`, Task 2.1 says `sync_per_wave`.
  - RED-proof (d) ("new W12 green but SP1 red") is not a red run of W12.
  > Fix: either move the W12 redefinition, with its two red runs, into Task 11.1 after the hook, or have the 10.1 W12 call `workflow-lint-read.cjs` directly. Pick one rule id spelling. Restate RED-proof (d) as a real W12 red run.

- **[M2]** The budget check will turn existing copy-based lint cases red when the hook lands, and none of them is in the pin table.
  - `copySkills()` (`a1-workflow-lint/run-tests.sh:287-291`) copies all of `skills/`, so it also copies `skills/reading-budget.json`. By D12 every budget equals the exact line count, so a copy has zero headroom.
  - Any copy-plus-append case that asserts `rc=0` gets a `budget_exceeded` finding once Task 11.1 hooks the rule. Measured example: `cases-verify-scope.sh` VS7 (lines 100-111) inserts one line into a1-execute `03-verify.md` and expects `rc -eq 0`. It goes red.
  - The pin table lists only W11/W12. The 11.3 CONVENTIONS note shows the planner saw the effect but planned no task for it.
  > Fix: in Task 11.1, run a1-workflow-lint, a1-gates-lint (bundle/run-wave13/14 copy `skills/`), a1-fix (wave12 lint) and a1-metrics AU3f after the hook. Add VS7, and every other case found that way, to the pin table with two red runs each. Or define the budget scope so that a copied tree without `_shared/a1-tools.cjs` is checked only when a case opts in. State which one.

- **[M3]** The Task 8.1 Done-when cannot be reached with the listed actions. It requires `grep -c 'retro validate' skills/a1-new-feature/workflows/06-verify.md` to print 0, and V9 requires the same. One of today's two hits is outside Step 6: line 329, in the Step 5 Lifecycle Completion Gate, item 3 ("after the retros (this skill's Step 6 incl. `retro validate --gate-log`, and the `a1-pr-review` retro …"). Action 2(a)-(f) never touches it, and the sentence becomes wrong under D7: the a1-pr-review retro is folded, and the prose retro is conditional.
  > Fix: add an action 2(g) that rewrites 06-verify.md:329 to "after the close-out retro decision (a1-pr-review 05-merge item 1; `feature close` writes the machine record)". Count it in the 06-verify line arithmetic, and run a1-pr-review (`RR_POS` :263 reads this ordering) and a1-probe.

- **[M4]** The sync and `cost run` placement rules (D11, Task 2.1) have no regex. The real files contain the command names in `echo` lines inside the same fences:
  - `04-audit.md:54` ("⚠ vault sync --phases exit=") and `:56` ("⚠ dashboard build exit=");
  - `03-verify.md:277`, `:279`;
  - a1-fix `04-verify.md:117` ("cost run exit=$RC").

  A substring count reports 2 per file, which makes `sync_phase_end_count` and `cost_run_placement` fire on the real tree in Task 11.1 (RP0 red, STOP). SP5 plants a "correct shape" by hand, so the planted file may not contain these echo lines.
  > Fix: in D11, define the call regexes anchored like the existing `VAULT_SYNC_CALL_RE` (`/a1-tools\.cjs vault sync .* --phases/`, `/a1-tools\.cjs dashboard build\b/`, `/a1-tools\.cjs cost run\b/`). Make SP5 a copy of the three real phase-end and closing files (fixture convention: copy real files), and add a RED-proof "substring match instead of the anchored regex → SP5 red".

- **[M5]** The placeholder rule contradicts the planned fences. The rule says "Every new fenced block reads a placeholder value through the two-line quoted-heredoc guard … uses the quoted variable"; the only stated exception is `--phase <placeholder>`. But:
  - Task 10.2 block T (new) uses raw `--pr <n>` and `"<repo_root>"`.
  - The new 5.3 line uses a raw `origin/<base>` inside `$(…)`. If a shell runs that literally, `<base> HEAD` parses as stdin from file `base` and stdout to file `HEAD`.
  - The Task 6.1 fence uses raw `<repo>`.
  - Block T writes to `"$RD"` without defining it.

  The existing 05-merge lines (81, 137, 159) use the same raw forms, so the executor has to guess which rule wins.
  > Fix: name the exempt orchestrator-substituted placeholders explicitly (`<repo>`, `<n>`, `<base>`, `<repo_root>`, as existing 05-merge convention), or guard them in block T. Add `RD="$(mktemp)"` to block T. RS2 should then also cover the chosen form.

- **[M6]** Several deferred items have no consumer step:
  - The "readings for the owner's reconcile" (D1, D2, D4, D6, D8) land only in the PR text (Task 12.1 item 8). The owner does not review PRs (standing instruction: review by subagent, merge by the assistant), so nothing ever reaches the spec's `## Clarifications` or a1-reconcile. D9 (the `*.last-run.json` scope) and D14 (heading kept, see m5) are missing from that list.
  - The Task 11.1 fallback "record the shortfall … as a proposed spec Clarification" has no writer, location or step.
  - Out of scope: "Separate a1-fix" (two s4 follow-ups) and "noted for the next a1-evolve run" are recorded nowhere durable.
  - Task 11.2: "report that the Mac copy is pending" has no follow-up.
  > Fix: add an orchestrator action to Task 12.1 that appends each reading as a dated proposed entry under the spec `## Clarifications` (or runs `a1-specforge:a1-reconcile` with the list). File the s4 follow-ups and the a1-evolve note as `docs/product/NEXT.md` rows (or roadmap items) in the same PR. Make the Mac copy a named item of the post-merge release step (`claude plugin update` on both hosts already visits the Mac).

- **[M7]** Making PLAN-REVIEW-LOG.md opt-in silently falsifies text that moves, and it reduces the recovery audit trail without telling the reviewer.
  - `04b-xprov-review.md:341-342` (Edge cases, "Self-recovery") says the gate records each repair "in `recovery` (stdout) and in the log entry of `PLAN-REVIEW-LOG.md`". By D5 this text moves into the `edge-cases` topic in `help-xprov.cjs`.
  - D9 allows `help-xprov.cjs` as a whole file, so `check-optin-readers` does not flag the moved sentence.
  - With the default off, the retry history (attempts, 30 s / 120 s backoff, `codex_blocked_fallback`) persists nowhere but stdout. The Samuel brief item 3 checks only XREVIEW.md and `xreview/index.json`.
  > Fix: in Task 5.1, rewrite the moved sentence to "(and, with `A1_KEEP_REVIEW_LOGS=1`, in the log entry of `PLAN-REVIEW-LOG.md`)" and add an HT anchor for it. Add "self-recovery trail with the log off" to Samuel brief item 3. If the trail must persist, name where (XREVIEW.md or the gate log) and test it in part 40.

- **[M8]** RP3 ("every budget equals the measured lines") is a permanent suite case and is stricter than FR-027. FR-027 says "a later change may lower an entry". A permanent equality case forces every future PR that shortens a skill to edit `reading-budget.json` in the same PR, or the suite goes red. That changes "may" to "must", and no reconcile item names the change. The plan also has no step to re-run `workflow budget --write` after Wave 12 review fixes touch `skills/`, so a fix that removes one line turns RP3 red on the head.
  > Fix: make RP3 a one-time Wave 11/12 evidence line in STATUS.md (SC-2 needs equality only on this PR's head), or assert `lines <= budget` in the suite. Add to Task 12.1 action 5: "when a fix touches `skills/`, re-run `workflow budget --write`, commit, re-run RP0-RP3".

### MINOR (execution proceeds, but note)

- **[m1]** The ratchet field name is inconsistent. SC-1, D8 and Task 12.1 item 6 say `base_budget: absent`; Task 1.1 output and BG12b use `base: {sha, budget: "absent"}` / `base.budget == "absent"`. Pick one.
- **[m2]** The P0 `code_scope` claim misses paths the plan writes or may write:
  - `_test-fixtures/a1-pr-review/cases-retro-step.sh` (Task 10.2; only `run-tests.sh` is claimed);
  - `_test-fixtures/CONVENTIONS.md` (11.3);
  - `skills/a1-new-feature/workflows/05-implement.md` (11.1 reserve cut);
  - likely deferred-pin targets: `_test-fixtures/a1-xprov/parts/{06,12,19,36}-*.sh`, `a1-ux-studio`, `a1-metrics/parts/04-audit.sh`, `a1-verify/cases-envred.sh`.

  The claim is an overlap registry, not a diff gate, so nothing blocks the work, but parallel specs will not see these paths.
- **[m3]** Task 10.1 action 5 applies deferred pins "recorded by lanes xprov or cuts". The deferred-pin rule applies to every lane, and lane retro (help-lean usage line → W13c sweep in a1-gates-lint) can defer too. Say "any lane".
- **[m4]** The D3 section boundary does not say that headings are detected outside fences only. A bash `# comment` inside a fence (block T may have one) would split the section and give a false `conditional_ref_untriggered`. Add that sentence and an RD8 case (a `# comment` line in the trigger fence → 0 findings).
- **[m5]** FR-030 says "the Isolation Gate section … is at most 3 lines". D14 and K7 read this as body lines only, with the heading and blank line kept for the intent pins. The reading is sound but it is not named. Add it to the reconcile list (see M6).
- **[m6]** `MENTIONS_ALLOWED` allows whole files (04b, `help-xprov.cjs`, a1-plan SKILL.md). A future real reader in those files passes unseen; M7 is one case. Prefer `file → exact allowed substring`.
- **[m7]** Task 11.2 edits the live global skill on both hosts in Wave 11, before review and merge. If the PR is revised or abandoned, the global skill has already changed. Move it after the merge (Task 12.1 item 7), next to the plugin update.
- **[m8]** The help-lean pin change (Task 4.1, Task 10.2) has no line in either task's RED-proof list. The global rule needs two red runs, so list them as with the other pins.
- **[m9]** Step 6b, the 5-entry a1-evolve threshold notice, moves into `retro-prose.md`. On the default (no-prose) path, nothing prompts `a1-evolve` any more. This ties in with the Out-of-scope a1-evolve note. Make the note durable (M6).

## What's Good
- The baselines are measured, not assumed. Every red-run figure in V1-V10 and every cap value reproduced exactly on c6b10a2 during this audit. The SC-006 path to ≤ 2360 adds up line by line and has a reserve cut plus the Answers fallback.
- The lane split is real and checked. Four disjoint write sets, `lane-split check` green with and without `--imports`, unowned importers reasoned per `lane-split.cjs`, and an honest yield statement (3 wave-times instead of 9).
- Keep-list gates are protected concretely. The D5 must-keep strings for 04b (R2e, T10, RQ8/12, P13, R7) are listed one by one. The `load-check` permit branch (`xprov-gate.cjs:582-590`) is verified to accept a denied plan without 04b. The kritis goldens stay byte-identical (`git diff` probe on `golden/prompts/`), with all changes through `prompts.allowed-diff` plus an independent literal P-allowed simulation.
