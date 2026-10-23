---
plan: ~/N3URAL-Vault/project/a1-specforge/plans/020-live-probes-wave-plan.md
spec: ~/N3URAL-Vault/project/a1-specforge/spec/020-live-probes.md
goal: "Live probes: measure the real effect after merge or deploy (a1-tools probe run, gate live-probes)"
verdict: PASS
passed: 26
gaps: 0
verified: 2026-10-24
head: 0f601e3
---

# Verification: 020-live-probes

## Verdict: PASS
**Cost:** unavailable (verification ran in a session that also covers other work; no per-phase transcript directory)

All 20 FR acceptance criteria and all 6 SCs verified against code, an independent loopback spot-check and suite runs on a
`git archive` snapshot of HEAD `0f601e3` (env without `A1_VAULT_ROOT`, `A1_VAULT_WRITER_HOST`, `A1_HOST_ID`).
The live probe against a real deploy is a post-merge step (Lifecycle Completion Gate step 3 in `06-verify.md`, a1-pr-review 5.5)
and is NOT part of this verification. See `## Live probes` below.

## Acceptance Criteria Results (spec ACs quoted verbatim)

| FR | Criterion (quoted verbatim) | Status | Evidence |
|---|---|---|---|
| FR-001 | "fixture file with 3 probes prints exactly 3 result lines and a summary `pass=N fail=N not_measured=N`." | PASS | Spot-check: 3 lines + `pass=2 fail=1 not_measured=0`; `_shared/lib/probe.cjs:169-191`; suite `parts/04-runner.sh` |
| FR-002 | "one fixture per exit code (all pass, one fail, unknown kind)." | PASS | Spot-check rc 0 (302 probe), 1 (500), 2 (`kind: command`); `exitCodeOf` probe.cjs:158; internal error -> `die` exit 2 (probe.cjs:228) |
| FR-003 | "each of the four hostile inputs, a 0-byte file and a host entry without `class` exits 2 and runs no probe." | PASS | Spot-check 0-byte -> `empty_file` rc 2; suite `parts/01-config.sh` (unknown key, dup id, alias, tag, control chars, missing class) |
| FR-004 | "`kind: command` exits 2; a grep of the new module for `child_process` and `eval` finds none." | PASS | Spot-check `unknown_kind` rc 2; `grep child_process\|eval` over `_shared/lib/probe*.cjs`: 0 hits. Note deviation D1 |
| FR-005 | "local test server returns 200 with `{"ok":true}`; probe with status 200 and json `ok` equals `true` passes; with status 500 fails with reason `status_mismatch`." | PASS | Spot-check probe a pass, probe b `fail status_mismatch status=500` |
| FR-006 | "fixture with a listening and a closed local port pass for the matching expectation and fail for the opposite one." | PASS | Spot-check tcp open pass; suite `parts/02-net.sh` (tp open/closed both ways) |
| FR-007 | "allow=200 and deny=403 passes; allow=200 and deny=200 fails with `deny_half_open`; allow fails and deny passes still fails." | PASS | Spot-check `deny_half_open` rc 1; `runPair` probe.cjs:88-101; suite `parts/04-runner.sh` pairfile cases |
| FR-008 | "literal `Authorization: Bearer x` exits 2; unset env gives `not_measured`." | PASS | Spot-check `literal_value_refused` rc 2; `Authorization: {env: SPOT_UNSET_VAR}` over https -> `not_measured env_missing` rc 1 |
| FR-009 | "fixture sets a distinctive env secret; the full stdout, stderr, JSON and gate log do not contain it, nor the server's response body." | PASS | Suite `parts/05-leak.sh` + gate-log half in `parts/06-wiring.sh` (BODYMARK/HDRMARK, secret); `scrubMessage` via `intent-redact.cjs` probe.cjs:24 |
| FR-010 | "a hosts-listed name resolving to `169.254.169.254` exits 2; a probe URL outside `hosts` exits 2; a 302 to another host is reported as 302, not followed." | PASS | Spot-check: unlisted `localhost` -> `host_not_listed` rc 2; 302 reported `status=302`, server saw 1 request; loopback without env -> `blocked_host` rc 2; suite R4b metadata host rc 2 even with ALLOW_LOOPBACK |
| FR-011 | "server that never answers yields `timeout` within limit plus 1 s; oversized body does not exhaust memory." | PASS | Suite N14 (1000 ms, <= 2 s), N15 slow-loris, `/big` 5 MiB capped at `MAX_BODY` 1 MiB (`probe-net.cjs:18,347`) |
| FR-012 | "`method: POST` against a `production` host exits 2 and sends no request; the same probe against a `staging` host runs; `method: PATCH` exits 2 on every class." | PASS | Spot-check POST/production `mutating_method_on_production` rc 2, no `/ok` extra request; PATCH/staging `method_refused` rc 2; staging POST in `parts/01-config.sh` |
| FR-013 | "server that returns 503 twice then 200 passes with `--wait 30` and reports `attempts=3`." | PASS | Spot-check `/flaky --wait 30` -> pass `attempts=3`, server count `/flaky:3` |
| FR-014 | "empty dir exits 0, prints the `no_probes` line, `--json` holds `"no_probes": true`." | PASS | Spot-check rc 0, `no_probes: <dir>/.a1/live-probes.yaml not found`, JSON `"no_probes":true` |
| FR-015 | "fixture suite passes with network disabled in Docker (`--network none`) using the local server only." | PASS | `docker run --rm --network none -u 1000:1000 -v <snapshot>:/w:ro node:20 bash /w/_test-fixtures/a1-probe/run-tests.sh`: 876 passed, 0 failed, 2 skipped (FS-folding cases); offline case L4 ran (exit 1, `unreachable/dns_error`, nothing sent). `.github/` untouched by the branch |
| FR-016 | "`gates lint` exits 0; `probe run --project <fixture-repo> --phase 020-live-probes` writes one line to `<fixture-repo>/.a1/phases/020-live-probes/gate-log.jsonl` with gate `live-probes` and the exit code." | PASS | `gates lint` rc 0, findings []; spot-check gate-log line `{"gate":"live-probes","verdict":"fail","exit":1,...,"scope":"020-live-probes"}`; registry row `_shared/gates-registry.md:76` (deterministic, blocking, invoke `` `probe run` @ a1-new-feature,a1-pr-review ``) |
| FR-017 | "`gates lint` exits 0 with no `unwired` finding for `live-probes` (both named skills hold a fenced `probe run` call with `--phase`); grep shows the prose line in `skills/a1-fix/workflows/04-verify.md`." | PASS | lint `wired`: live-probes @ a1-new-feature (1), a1-pr-review (1); `06-verify.md` sub-step after step 3 with `## Live probes` append; `05-merge.md` `## 5.5 Live probes` after 5.4; prose line `04-verify.md:107`; Victor rule `agents/a1-victor-verifier.md:96` |
| FR-018 | "fixture with `A1_INTENT_CHILD=1` exits 77, stdout holds `intent_child_refused`, and the loopback server records no request." | PASS | Spot-check rc 77, stdout `{"ok":false,"error":"intent_child_refused",...}`; server count unchanged; `intent-sandbox.cjs:275` exclusion `'probe run': NETWORK` |
| FR-019 | "fixture PR that adds a host blocks with `probes_config_changed`; with an upheld disposition by a second reviewer it passes; a disposition reviewed by its own author does not clear it." | PASS | `pr-merge-guards.cjs` guard `{reason:'probes_config_changed', rule:'probes-config'}`, `configChangeChecks` used by `pr-merge-check.cjs`; suite `parts/03-merge-guard.sh` G5b/G6/G8; `05-merge.md` 5.3 lists four reasons |
| FR-020 | "suite exits 0 on macOS and GNU/Linux Docker; `a1-tools probe` without subcommand exits 2 (house usage code, measured 2026-10-23 for `gates` and `verify`)." | PASS | macOS: 877 passed, 0 failed, 1 skipped (offline case, network present); Docker node:20: 876/0/2; `probe` without sub -> rc 2; `--help` and unknown-group usage list `probe`; `verify-install-sync.sh` PASS |

### Success Criteria

| SC | Criterion (quoted verbatim) | Status | Evidence |
|---|---|---|---|
| SC-001 | "A fixture modelled on the 2026-09-26 postmortem (route answering 500) makes `probe run` exit 1 in under 15 s." | PASS | Suite R2 (`/boom`, < 15 s); spot-check 500 probe 1 ms |
| SC-002 | "A fixture modelled on the 2026-10-15 postmortem (anon role allowed) makes a `pair` probe exit 1 with reason `deny_half_open`; the same fixture with the fix exits 0." | PASS | Suite S1/S2 (`/anon` vs `--fixed`); spot-check `deny_half_open` rc 1 |
| SC-003 | "Across all fixture runs, zero occurrences of the test secret or any response body in stdout, stderr, JSON report and gate log." | PASS | `parts/05-leak.sh` + `parts/06-wiring.sh`, green on macOS and Docker |
| SC-004 | "100 percent of hostile-file fixtures (unknown kind, literal secret, alias, private IP, non-listed host, mutating method on a `production` host) exit 2 before any request is sent." | PASS | Suite (01-config, 02-net, 04-runner R4b) plus spot-check: server counts show no request from any rc-2 case |
| SC-005 | "The full fixture suite stays green and the new suite has at least one test per FR." | PASS | Suite V1 "per-FR case inventory covers 20 requirements"; affected suites green (below). Full 49-runner loop not re-run here |
| SC-006 | "`gates lint` exits 0 with the new row and its two call sites (a1-new-feature, a1-pr-review)." | PASS | `gates lint` rc 0, 48 rows, findings [] |

### Phantom BLOCKERs
none (`phantom check` on the wave plan: status clean; the wave plan has no checkbox tasks, so the check is weak evidence; the per-FR table above is the real proof)

### Verify manually (weak phantom matches)
none

## Live probes

Not run in this verification. The real live probe is post-merge (spec Clarification 2026-10-23 "Victor citation"; Lifecycle
Completion Gate step 3 in `skills/a1-new-feature/workflows/06-verify.md`). After the merge, the orchestrator appends the
`probe run --project <merged main checkout> --phase 020-live-probes` result lines here. Until then: not verified live.
Note: a1-specforge itself has no `.a1/live-probes.yaml`, so the expected result is `no_probes` -> "not verified live (no_probes)".

## Gaps
none blocking.

## Build / Test Status (snapshot of HEAD 0f601e3)
- TypeScript: n/a (Node CJS)
- a1-probe (macOS): 877 passed, 0 failed, 1 skipped (offline case needs no network)
- a1-probe (Docker node:20, `--network none`, uid 1000, read-only mount): 876 passed, 0 failed, 2 skipped (FS folding cases)
- a1-exit2-audit: 31/0 · a1-pr-review: 45/0 · a1-pr-merge-check: 128/0 · a1-intent: 1105/0
- `workflow lint`: exit 0, findings [] · `gates lint`: exit 0, findings [] · `bin/verify-install-sync.sh`: PASS

## Deviations from Plan / Spec
- **D1 (minor, documentation):** Clarification 2026-10-23 (ADR §7) says "no child process at all". Since SEC-11 the loader
  runs fixed-argv `git` reads through `git-safe.cjs` (`probe-config-file.cjs:94-163`), with injected git config stripped. The FR-004
  AC (grep for `child_process`/`eval` in the new modules, no kind spawns a process) still holds, and Clarification 2026-10-24
  accepts the committed-file check, but it never states that the git reads are an exception to §7. Recommend: one Clarification line.
- **D2 (operational, accepted):** `probe run` refuses a probe file that is not equal to the `origin/HEAD` or `origin/main`
  blob (`probes_no_reviewed_ref`, `probes_file_unreviewed`, exit 2). A repo without an `origin` remote cannot run declared
  probes. Both call sites document "checkout of merged main with origin fetched". Spec text covers only `probes_file_uncommitted`.
- **D3 (accepted in Clarification 2026-10-24):** `{env:}` values refused over `http:`; extra reason codes and result fields;
  >1 MiB body truncated and judged; max 50 probes; `probes-config` rule in `disposition-store`.
- **D4 (accepted in Clarification 2026-10-24):** run budget is 300 s plus the `--wait` window; offline name gives `dns_error`.
- Side effect of this verification: the `phantom check` call in the worktree appended one line to the gitignored
  `.a1/phases/_unscoped/gate-log.jsonl`. No tracked file changed.

## Addendum 2026-10-24 (after verification)

Two security MINORs were fixed after this verification ran at 0f601e3: 9d4aa51 (SEC-13, reviewed ref must stay under `refs/remotes/origin/`) and 91df9fd (SEC-14, a probe file deleted only on disk exits 2 `probes_file_uncommitted`). Both touch only `_shared/lib/probe-config-file.cjs` and `_test-fixtures/a1-probe/`. Re-run at 91df9fd: a1-probe 894/0 (skipped 1) on macOS, 893/0 (skipped 2) in node:20 `--network none` as uid 1000; a1-exit2-audit 31/0; `workflow lint`, `gates lint`, `verify-install-sync.sh` exit 0. The FR verdicts above are unchanged.
