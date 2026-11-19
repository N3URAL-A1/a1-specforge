---
plan: .a1/phases/027-lean-pipeline-s3/PLAN.md
verdict: PASS
blockers: 0
majors: 4
minors: 12
lanes_audited: 3
lane_split_check: PASS
generated: 2026-11-18
---

# Plan Audit

## Verdict: PASS

No BLOCKER. All spec ACs for slice 3 map to a success criterion and a fixture, and the mechanical lane split holds (`lane-split check` exit 0, `plan depth-check` exit 0). The four MAJORs are execution risks with cheap fixes. M4 names Done-when/Verification probes (V3, SC-8), so per `skills/a1-plan/workflows/04-audit.md` it goes back to Pablo now. The same applies to m1-m3 (verification lines).

Measured during this audit (on `main` @ `bc47b07`, primary checkout, read-only):
- `lane-split check` exit 0, 0 findings; `plan depth-check` exit 0.
- `bin/run-suites.sh` 756 lines, `run-suites-proc.sh` 456, `run-suites-report.sh` 140, `verify-run.cjs` 561, `runVerify` body 62 lines.
- `grep -rn pgrep skills/` gives 2 lines, both in `05-merge.md` (V4 red run confirmed). 05-merge.md has exactly one non-bash fence (the `sh` block), so the D13 reasoning holds.
- `git diff --quiet 3a6d00c~1 3a6d00c -- .a1/verify.json _test-fixtures/suite-groups.json` gives rc=1 (V6 red run confirmed).
- `printf '0\t256\tx\n' | awk '{d+=$2} END {exit d+0}'` gives rc=0 (see m2).
- A `git clone --no-local` of a linked worktree path yields the worktree's branch head (scratch test). The Task 9.1 rehearsal snippet works as written.
- The `.a1/verify.json` `affected` map covers `bin/` and the prefix `_shared/lib/verify-`. New `bin/check-assert-deletions.sh`, `verify-lock.cjs` and `verify-runner-path.cjs` therefore need no map edit, and D14 (no config change) is achievable. All commands share `timeout_ms` 427500 (`fromConfig` uses `defTimeout`), and `RS_PARSER_RUNNER` makes `a1-schema-check/parser/run-parser.sh` discoverable. The real plan is therefore D4-eligible, and the SC-9 rehearsal will not fall back.

### Judgement on the decisions the planner flagged

| Decision | Judgement |
|---|---|
| D1 lazy base only for merge-check | **Accepted, but the justification is partly wrong (m1).** K1/K1b/K2/K3/K3b/K6 run `vrun --base main` *with* cache (`a1-verify/run-tests.sh:383-408`). Under D1's own condition `noCache === true` they would stay eager even with a lazy CLI. The real pins are VD2 (`cases-durations.sh:17`, `--base main --no-cache`) and PT0 (`a1-metrics/parts/06-phase-time.sh:130`, CLI `--base --no-cache`). Both assert an integer `duration_ms.base` on a green head, so the CLI must stay eager. The conclusion holds; the "eight asserts" count does not. |
| D5 runner only from base sha + handshake + fallback reasons | **Accepted.** The runner sources only `$RS_BIN_DIR/run-suites-{proc,report}.sh` (`run-suites.sh:34,36`) and executes no other repo file, so the 4-file `git archive` is complete. Main answers `--contract` with `unknown argument` exit 2 (`run-suites.sh:662`), so the slice's own merge-check falls back as stated. |
| D8 new reason `leak_note` | **Accepted.** It is not in `RETRYABLE`, and `NEVER_PRE_EXISTING` stays unchanged. A leak on both sides becomes pre-existing red and still blocks through `base_red_unreported` without `--bug`. See m9 on a reason name that sits next to it. |
| D12 per-worker `A1_VERIFY_LOCK_DIR`, nesting list | **Accepted.** Re-measured: `a1-probe/parts/03-merge-guard.sh:26` executes `pr merge-check` and PT0 executes `verify run`. `a1-intent/cases/05b-child-seal.sh` calls `verify run` only to be refused (exit 77), and `a1-cli-output`, `a1-gates-lint`, `a1-retro-validate` and `a1-workflow-lint` only read text. Six executing suites is correct; the spec's list of four is stale (m12). No nesting suite uses `env -i`, so the token survives. |
| D13 one `sh` fence with the load line stays | **Accepted.** It is required by `a1-pr-review/run-tests.sh:326-333` (≥1 non-bash fence) and by owner decision (a). The inserted text has no `pgrep` and no `exit`. |
| D14 no config change | **Accepted** (affected-map prefix coverage verified above). |

## Findings

### BLOCKERS (must fix before execution)

None.

### MAJOR (high risk of failure)

- **[M1]** `bin/run-suites.sh` cap ≤ 800 is very likely exceeded, and the plan names no other place for the code. *Tasks 3.1 and 4.1; D14; V9.*
  - The file has 44 lines of headroom (756 today).
  - Wave 3 puts the following into this file: 5 option arms; `--json-out` checks (absolute, not existing, parent owned and not group/world-writable); `--groups-file` checks; the `--check-groups` exclusion; the default `RS_GROUPS_FILE`; 3 check-state globals; state setters in 3 `rs_*_post` functions (about 8 branches); the json-out call; separate `leak`/`sumnote` variables; up to 6 header lines. That is about 35-40 lines.
  - Wave 4 adds 4 option arms, two range checks, the ceil conversion, the timed-note branch and header lines, about 12 more.
  - The estimate (about 47-52) is above the headroom, and "No new runner file" rules out a new file. Wave 4's Done-when "Caps hold" will then fail, with no stated fallback.
  > Fix: in Task 3.1/4.1, place all validation and parsing helpers in `bin/run-suites-proc.sh` (456/600): `rs_check_json_out`, `rs_check_groups_file`, `rs_parse_ms <v> <min> <max>` (reuse `rs_is_ms`), and a `rs_set_check <name> <state>` setter. `run-suites.sh` then gets only the case arms, one call line per helper, and the header. Add a Done-when line in Wave 3 that `run-suites.sh` stays ≤ 775, leaving room for Wave 4.

- **[M2]** US-027-4 scenario 2 is implemented in one reading, and the plan does not say so. *SC-8; spec US-027-4 AC 2 vs FR-016/FR-018.*
  - The AC says: "Given a held **runner** lock When `verify run` starts Then it waits, records `lock_wait_ms`, runs when free; and given a permanent lock Then it exits 2 `lock_timeout`".
  - In the plan, a held *runner* lock (RR5) is waited on by the runner, but `lock_wait_ms` counts only the verify-lock wait, so it stays about 0.
  - A permanent runner lock (RR6) gives exit 2 `runner_failed` (message passed through per FR-016), not `lock_timeout`.
  - LK1/LK3 satisfy the AC only if "runner lock" is read as the CLI verify lock. That is FR-018's own fixture list, but the spec contradicts itself here, and the PLAN takes no position. Victor will check the AC literally.
  > Fix: add a decision D18 that states the reading, with LK1/LK3 for the verify lock and RR5/RR6 for the runner lock. Then choose one of two routes.
  > - (a) Keep `runner_failed` and record the AC wording as a spec decision through `a1-reconcile` (PR text names it).
  > - (b) Map a runner exit 2 whose stderr starts with `run-suites: lock wait of` to reason `lock_timeout`, keeping the message passed through, and add the runner's measured wait to the record as `runner.sides.<side>.lock_wait_ms`. Assert it in RR5 (≥ 3000) and RR6 (`error` `lock_timeout`).
  >
  > Either way, SC-8 must say which reading it proves.

- **[M3]** Integration gap: every local `verify run` now serialises, and the a1-execute multi-lane gate is not adjusted. *Wave 5 / Wave 8 docs; D11.*
  - `skills/a1-execute/workflows/02-execute.md:149-154` runs `verify run --affected` "per lane", concurrently.
  - Any `bin/`, runner or config change selects the full set: about 25-30 min serial (this plan's own Execution location says so). That is longer than the 15-min ceiling.
  - After this slice merges, the second lane's gate waits 15 min, then exits 2 `lock_timeout`. The block then prints `STOP: gate-1-build red (verdict fail or no test command)`, which is wrong and makes the user look for a test failure.
  - `03-verify.md:30` and `06-verify.md` have the same exit-2 handling. The plan rewrites only 05-merge.md and 06-verify.md:78.
  > Fix: add to Wave 8, or to the lint lane's owns, `skills/a1-execute/workflows/02-execute.md`, plus the exit-2 lines of `03-verify.md` if needed. Add one sentence and one branch: exit 2 with `error` `lock_timeout` means another local run held the lock; re-run, it is not red. Name the lane-serialisation consequence in the PR text and in help-verify. Re-run `a1-gates-lint` (W11 pins call lines in those files; add text only and leave the call lines unchanged).

- **[M4]** Two timing races make SC-8 fixtures flaky. These are verification lines (V3, SC-8). *Tasks 2.1 and 4.1.*
  - (a) Task 4.1(c) builds the runner wait deadline as `SECONDS + ceil(ms/1000)`. Bash `SECONDS` ticks at wall-clock second boundaries, so `--lock-wait 1000` waits anywhere from about 0.05 s to about 1.5 s. W3 asserts "elapsed ≥ 1 s" and will go red on some runs. RR6 (2000 ms) has the same ±1 s slack.
  - (b) `vl_holder` (Task 2.1 action 4) writes `cmd="$(ps -o command= -p $!)"` right after `node ... &`. Before `exec`, ps can still show the forking bash's command line. The holder then fails the D11 cmd check, is judged reused and is taken over. LK1/LK3/LK5/MLK1/MLK2 then pass through or exit 0 instead of waiting or timing out.
  > Fix (a): compute the deadline in ms from one `node -e 'process.stdout.write(String(Date.now()))'` at start and per tick (the runner already calls node), or use `SECONDS + ceil(ms/1000) + 1` and document that the wait may run up to 1 s longer. Measure W3 elapsed with the same clock and assert `≥ 1000 ms`.
  > Fix (b): in `vl_holder`, poll (bounded, 0.05 s steps, max 2 s) until `ps -o command= -p $!` contains `a1-tools-fx-holder`, then write `owner.json`. Do the same in the part-19 fake runner holder unless part 06's helper already waits.

### MINOR (execution proceeds, but note)

- **[m1]** (verification line, PR text) Rewrite the D1 "Why" and Depth Pass §1/§2 to name the true pins, VD2 and PT0 (see the table above). K1-K6 use the cache and would stay eager under `noCache === true` anyway. Also record the FR-011 narrowing ("merge-check only") as a spec decision through `a1-reconcile`, so the spec does not drift from the code.
- **[m2]** (verification line) The Done-when numstat probe `awk '{d+=$2} END {exit d+0}'` reports exit 0 for 256·k deletions, because the exit status wraps mod 256 (measured rc=0 for 256). It also diffs two-dot against `origin/main`, while Task 9.1 uses three-dot. Use `git diff --numstat origin/main...HEAD -- … | awk '{d+=($2=="-"?1:$2)} END {print "deleted="d; exit (d>0)}'`, or simply call `bin/check-assert-deletions.sh` once it exists.
- **[m3]** (verification line) V9 "Red run: eyeball". The check is executable, so run it red once (for example `[ "$(wc -l < bin/run-suites.sh)" -le 700 ]` gives rc=1 today) and quote the result.
- **[m4]** LK12 sets no `A1_VERIFY_LOCK_WAIT_MS`. RED-proof (g) (lock before `resolveCommands`) would then wait the full 900 s against the permanent holder, and no kill bound is named. Set `A1_VERIFY_LOCK_WAIT_MS=3000` in LK12 so the mutation turns red as `lock_timeout` within seconds.
- **[m5]** `verify-runner-path.cjs` must throw `vb.VerifyError` from `verify-base.cjs`, the same class `verify-run.cjs:24` re-exports. A second class would fail `instanceof VerifyError` in `cmdPrMergeCheck` (`pr-merge-check.cjs:273`), and the exit-2 reason would become `internal`. State this in Task 6.1.
- **[m6]** Task 7.1 never calls `rp.release()`. The `a1-verify-runner-*` dir lives until process exit (`cleanupOnExit`). Release it in the `runnerSides`/`selectSides` `finally`.
- **[m7]** D17: Σ `timeoutMs` can pass 2^31-1 ms (for example 25 commands × the 86 400 000 ms max). Node's `setTimeout` in `groupRunnerMain` then overflows to 1 ms and kills the runner at once. This fails closed as `runner_failed`, but on a valid plan. Cap the ceiling at `2147483647 - KILL_GRACE_MS`.
- **[m8]** `runVerify` is already 62 lines, so Task 1.1's "extract `eagerSides` only if it would exceed 50 lines" is already met. Do the extraction in Wave 1 rather than deferring it to Task 7.1(d).
- **[m9]** The new exit-2 reason `runner_failed` already exists in `_shared/lib/xprov.cjs:80` with a different meaning. Run-record and metrics counts by reason would mix the two. Consider `suite_runner_failed`, or name the collision in help.
- **[m10]** The lock path `os.tmpdir()/a1-verify-lock-<uid>` follows `TMPDIR` (spec-mandated), while the runner lock is fixed `/tmp`. Two sessions with different `TMPDIR` do not serialise. Add one clause to the help text.
- **[m11]** `bin/check-assert-deletions.sh` runs only in Task 9.1 and V5 and is not wired into CI or 05-merge (`.github/` is frozen by D14). That is enough for FR-012 in this slice; note it as a follow-up, so the script does not sit unused.
- **[m12]** The spec FR-018 nesting list (four suites) is stale. Besides the PR text, update the spec through `a1-reconcile`.
- **[m13]** The "real-lock state" assert at the end of every new case file compares the real per-uid locks before and after. On a dev host, another session's real `verify run` can start or end during the suite and make the assert red with no defect. Assert only "absent stays absent unless now held by a PID that is not a descendant of this suite", or skip the "present" half when the recorded PID is not this suite's.

## What's Good

- **Measured instead of assumed.** The plan reads the eager-pinning asserts, re-measures the nesting suites (a1-probe and a1-metrics confirmed during this audit) and executes red probes for V1-V7. The D2 equivalence argument matches `verify-base.cjs` `settle`: `baseIds` matters only when the first run failed or a retry ran.
- **Closes the RESEARCH HIGH risk on runner trust.** The groups file comes from the runner's own base tree (`--groups-file`), there is a contract handshake, strict JSON with set equality, red wins over logs, and the record names a fallback reason. RP2 has a control showing the edited head script does write the marker when run directly, so the "never created" assert can go red.
- **One RED-proof per mutation (42 in total), on `git archive` scratch copies.** Every new case lives in new `cases-*.sh` files or runner parts, so FR-012's zero-deletion rule is structurally achievable.
