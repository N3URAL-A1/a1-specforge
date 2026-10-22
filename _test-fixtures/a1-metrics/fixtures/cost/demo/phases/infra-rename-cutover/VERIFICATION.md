---
plan: .a1/phases/infra-rename-cutover/PLAN.md
goal: Production pulls the app image from the Scaleway registry namespace `a1-office` and the repo's `infra/` labels, CI and runbooks name it, while the old namespace `n3ural-platform` and all its images stay untouched as the rollback path.
verdict: PASS
passed: 7
gaps: 0
verified: 2026-10-14T07:50:00Z
---

# Verification: infra-rename-cutover

## Verdict: PASS
**Cost:** 101126344 tokens (in 1512, out 135448, cache 100989384)

All seven SCs hold. I measured them against production on 2026-10-14 between 07:45Z and 07:50Z: cluster, registry API, `scw`, `gh` and the public smoke check. Every command was read-only. The repo state was checked at the merged commit `93b9b127` (origin/main).
SC-5 holds in substance. Five literal counts differ from the plan text. Each difference comes from a recorded xprov or Reinhard fix (see Deviations). None of them weakens the goal, so none is counted as a gap.
Spec note: the plan names RESEARCH.md + MAP.md as the spec. Neither file contains acceptance criteria, so the PLAN SC-1..SC-7 are the verification targets.

## Acceptance Criteria Results (PLAN SC-*, no spec ACs exist)

| Criterion | Status | Evidence (measured 2026-10-14) |
|---|---|---|
| SC-1 Wave 1 `infra/` text | PASS | origin/main: `part-of: n3ural-platform` in infra = 0, `n3ural-platform` in infra = 0, `scw.cloud/n3ural([^-]\|$)` = 0; `git diff --shortstat 80d4d293 9b10060a -- infra` = 7 files, 12+/12-. PR #337 MERGED 2026-10-13T15:03:03Z (`9b10060a`). |
| SC-2 CI build into `a1-office`, no local docker | PASS | `git diff --numstat 9b10060a 7a140616` = `1 1 .github/workflows/build-image.yml` (only IMAGE line). Run `38438082634`: `attempt 1, completed, success, workflow_dispatch, chore/build-image-a1-office, headSha 07606c66…, updatedAt 2026-10-13T17:27:31Z`. Log: exactly 1 `Digest:     sha256:267dbbe5…f27c` (= D2), 1 `Tag wird: 07606c6`. a1-office inventory (`scw`): `IMAGES=1 TAGS=2 WITH_D=1`, tags `07606c6 → D2` and `buildcache`, sha256 `65da1c05…b83b` = B3d. Digest-set D2: `IDX_MT=…oci.image.index.v1+json IDX_SHA_MATCH=1 AMD64_COUNT=1 CONFIG_PLATFORM=linux/amd64 17 3 14 11 UNIQUE=17`. Old-ns inventory sha256 `7a57b8e5…ae08` = B0, diff empty. Tree `07606c66^{tree}` = `7a140616^{tree}` = `d903602b` (TREE_EQUAL). PR #338 MERGED 2026-10-13T17:57:47Z. |
| SC-3 (a) B5c, (c) probe pull, (d) anon 401 | PASS | (a) B5c re-run on D2: `ROWS=17 MAN_OK=3 BLOB_OK=14 ANON_401=17 MISSING=0 CONTROL=404`. (c) Probe pod events have expired, so the recorded STATUS line is the evidence (`Successfully pulled image "rg.fr-par.scw.cloud/a1-office/a1office-app@sha256:267dbbe5…" in 3.625s`, phase Succeeded). Today `kubectl get pod regprobe-a1office` = NotFound, and both nodes (`b3b8ff5a…` = NODE, `ef2430a6…`) list `a1-office/a1office-app@D2` in `.status.images`. (d) Anonymous `curl -I …/v2/a1-office/a1office-app/manifests/D2` = `401`. (b) dropped by plan (AS-7). |
| SC-4 live deploy on D2 + smoke | PASS | `deploy/n3ural-app` app image = `rg.fr-par.scw.cloud/a1-office/a1office-app@sha256:267dbbe5859eb816a26ef12cce66fe25822e15769787f3f04f7b8e7087a9f27c`; `GEN=38 ST=38 2 2 2 2 2` (= EXP_GEN after B7); 2 pods `Running true restarts=0`, each imageID exactly `rg.fr-par.scw.cloud/a1-office/a1office-app@D2` (`PODS_EXACT_D2=2`); pull secret `scw-registry`; no BackOff/ErrImage events. Smoke: `SMOKE ROOT=307 HEALTH=200 HEALTH_OK=1 LOGIN=200 text/html; charset=utf-8 PROVIDERS=200 KEYS=credentials,google,microsoft-entra-id` = baseline. `ROLLBACK_REF_B6` (= D under n3ural-platform) and `ROLLBACK_REF_B7` (= D2) are recorded in STATUS.md. The Deployment RV is unchanged since the Wave-3 dry run (`18497016895`). |
| SC-5 repo text + capture procedure | PASS (5 documented deviations, see below) | At `93b9b127`: TP old = build-image 0, OPERATIONS 0, setup-qa 0, registry/README 2, p4 1; `git diff --quiet 7a140616 93b9b127 -- p4-runtime-cutover.md` exit 0. TP new = build-image 1, OPERATIONS 2, registry/README 1, setup-qa 1, p4 0. LD = 0 lines in OPERATIONS/scripts/ops/expense-mail-intake/infra/app README; Rosetta 0. RG old = 0; new = deploy.yml 2, uptime-monitor 1, OPERATIONS 1; `Rückweg-<image-ref> notieren` 1. GB `if RUECKWEG_ZEILE=…&&` = OPERATIONS 1, build-image 1, `-l` (excl. .a1, tests) lists exactly these 2; switch line `kubectl patch deployment/n3ural-app` 1 each, between `if` (OPERATIONS 570 / build-image 230) and `else` (OPERATIONS 598); `<<'SCHRITT0'` 1; `outputs.short }} -n n3ural` 0. CR: capture-rollback-ref.sh = OPERATIONS 3, build-image 1, expense-mail-intake 1, infra/app README 1; `set image deploy` in expense-mail-intake 0; `<RUECKWEG-image-ref>` 1. Both test files listed in `tests/ci/unit-job-dateien.txt` (203, 204); `gate-unit-job-liste.mjs` exit 0. Tests: capture-rollback-ref 43/43, registry-ref-exists 9/9, uptime-monitor-audit 19/19, classify-changes 53/53 (124 total); `A1_GUARD_SHELLS=bash,zsh` capture 61/61 (+9 resolver = 70). Read-only production: capture `n3ural` exit 0 → `RUECKWEG=rg.fr-par.scw.cloud/a1-office/a1office-app@D2 NS=n3ural DEPLOYMENT_UID=9d803687-… RV=18497016895 SPEC_IMAGE=…@D2 ERFASST=2026-10-14T07:49:40Z` + stderr `BEOBACHTET: …a1-office/a1office-app@D2`; `does-not-exist` → `STOP: Deployment nicht lesbar`; `A1_K8S_NAMESPACE=other` → `widerspricht`. Resolver: D under n3ural-platform exit 0, D2 under a1-office exit 0, 64×0 → exit 1 `HTTP 404`, `evil.example.invalid/x/y@D` → exit 1 `nicht vertrauenswuerdig`. DI: Wave-3 diff = the CHANGE rows plus the scripts/tests and a recorded classify-changes fix; remaining `set image` hits are only build-image.yml 28/77 and deploy.yml 13 (KEEP comments) plus the rollback lines. |
| SC-6 PS delta per PR | PASS | PS: `80d4d293`=531 → `9b10060a`=522 (Wave 1 Δ9); `9b10060a`=522 → `7a140616`=521 (B3 PR Δ1); `7a140616`=521 → `93b9b127`=516 (Wave 3 Δ5). Remaining hits listed by AS-5 class in STATUS.md (Wave 3 step 7). |
| SC-7 old namespace untouched, freeze clean | PASS | `n3ural-platform` exists (`a85973f4-…`, private, ready). Digest-set D: `IDX_SHA_MATCH=1 AMD64_COUNT=1 CONFIG_PLATFORM=linux/amd64 17 3 14 11 UNIQUE=17`. Inventory `IMAGES=1 TAGS=15 WITH_D=1`, sha256 `7a57b8e57b024757b8040eee66bdb1821d9e4640d923f51021486819e3f1ae08` = B0, `diff` vs the B0 text in STATUS.md empty. a1-office inventory = B3d (diff empty). Build-run (`ALLOW=38438082634`): `BUILD_RUNS TOTAL=17 NEW=0 OPEN=0`, no HIT, exactly one `ALLOWED id=38438082634 attempt=1 status=completed conclusion=success updatedAt=2026-10-13T17:27:31Z`. Anonymous HEAD of D = 401. STATUS records the B3d/B8/8b diffs empty and `FREEZE_RELEASED 2026-10-14T07:38:47Z`. |

### Phantom BLOCKERs
none (`phantom check` → `status: clean`, `phantoms: []`, since `7a140616`).

### Verify manually (weak phantom matches)
none

## Gaps
None blocking. Minor findings (no re-execution needed, documentation hygiene only):

### Finding 1: STATUS SC-5 line is stale versus the merged head
- **Criterion affected:** SC-5, plus Verification checklist line 412
- **What was expected:** the SC-5 counts at the Wave-3 head before merge.
- **What exists:** STATUS line 130 records the counts at `9f64adb4`, before the R1/R2/F1/F2 fixes. At that commit `kubectl set image deployment/n3ural-app` = 1 and resolver counts were 2/1. The final counts are only in this file.
- **Fix:** none needed. This VERIFICATION holds the counts at `93b9b127`.

### Finding 2: PLAN.md SC-5 / Verification text not amended after the fixes
- **Criterion affected:** SC-5, Verification line 412 (`kubectl set image deployment/n3ural-app` inside `then`, 28/34 test cases)
- **What exists:** the switch is `kubectl patch` with uid/resourceVersion preconditions. Tests are 43/61 + 9. The plan sha `65a4b16e` was deliberately frozen, and the deviations are recorded in STATUS.
- **Fix:** none for this phase. This is a plan-process observation (see observations.jsonl).

## Build / Test Status
- TypeScript: not run (no TS product code changed; scope is scripts/docs/workflows)
- Tests: PASS. `npx vitest run tests/unit/ops tests/unit/scripts/classify-changes.test.ts` = 4 files, 124/124. The zsh guard run passed 70/70. I used a temporary `node_modules` symlink and removed it before the commit.
- `node scripts/gate-unit-job-liste.mjs`: exit 0
- Build: not applicable. The deployed image D2 came from CI run 38438082634 (success).

## Cross-provider review evidence
From `xreview/index.json` and `XREVIEW.md`:
- Plan: `plan-review-xprov` r1 and r2 were fail-with-findings. Robert then gave three human waivers (plan sha `bf706673` round_cap, `d23a849b` CI-build revision, `65a4b16e` after R7–R9).
- Wave 1: `wave-inspect-xprov` r1 **pass** (head `5707a3e4`, plan `bf706673`, 2026-10-13T14:49Z).
- Wave 2: r1 fail-with-findings (R7–R9, head `5ca6e8d0`), r2 **pass** (head `1f575dd5`, plan `65a4b16e`, 2026-10-13T20:18Z).
- Wave 3: r1 and r2 were fail-with-findings (R1 capture/switch binding, R2 patch-failure classification). Both were fixed with tests and red proofs (STATUS j–m). Robert gave two **human waivers**: round_cap at head `901e7c13` and at head `c4675652` (2026-10-14T07:24Z, "Reinhard APPROVE, minors fixed; CI classify fix, CI 6/6 green"). The orchestrator reports that `wave-status` was ok before the merge, at the waiver-mirror commit `abd2890c`. That commit exists locally.
- **Tool gap:** `xprov wave-status --phase infra-rename-cutover` today exits 1 with `waves lacking a wave-inspect-xprov pass or waiver: 1, 2, 3`. Two things break the chain: the squash merge per wave (#337, #338, #339) replaces the reviewed heads, and the PLAN.md sha changed between waves (`bf706673` → `65a4b16e`). The wave-status chain does not survive squash-per-wave. Per Robert's decision of 2026-10-14 this is not counted as an SC failure. It belongs in `a1-evolve` (xprov wave-status should accept reviewed heads whose tree is contained in the squash commit, or record the plan sha per wave).

## Deviations from Plan
1. **Switch command:** the plan has `kubectl set image` inside `GB`. The code has `kubectl patch` with `metadata.uid` + `resourceVersion` preconditions, plus a re-read classification on failure (xprov wave-3 R1/R2). SC-5 counts `kubectl set image deployment/n3ural-app` = 0 instead of 1. `kubectl patch deployment/n3ural-app` = 1 each, inside the guard. Acceptable: strictly safer.
2. **Resolver counts:** `registry-ref-exists.sh` appears 4 times in OPERATIONS (plan: 2) and 3 times in registry/README (plan: 1). Cause: Reinhard F2 (the guard checks NEUES_IMAGE through the resolver) and F1. Acceptable.
3. **AS-5 lines in `automation/registry/README.md`:** two lines the plan marked untouchable changed. Former line 32 (now 34) got the suffix `(historische Messung 2026-09-24)`. Former line 49 (`docker pull …@<digest>`) was replaced by the resolver call (Reinhard F1). LD in registry/README is now 1 docker line (34) instead of 2. This conflicts with AS-5 as written. It is in line with AS-7 (no active local-docker instruction) and was reviewed. The historical record (measurement + "Pull" log excerpt) stays. Acceptable, but it is an AS-5 deviation that Robert did not approve explicitly.
4. **Tests:** 43 capture cases (61 with zsh) instead of 28/34, plus 9 resolver cases. Red proofs a–p are recorded (16 instead of 9).
5. **Unplanned file:** `scripts/ci/classify-changes.mjs` (+ test) now classifies `docs/OPERATIONS.md` as code. Reason: a test executes its guard block, so a docs-only change there must run CI. This is recorded in the #339 commit body and the c4675652 waiver. Acceptable.
6. **Live label:** `deploy/n3ural-app` still carries `app.kubernetes.io/part-of: n3ural-platform` live. This is intended (AS-2: repo-only change, no live relabel).
7. **Operations:** the B6/B7 writes were run by Robert in his terminal, because the classifier blocked the agent. The executor verified them read-only. Within the plan's CONFIRM model.

## Addendum 2026-10-14 (orchestrator, after restore commit 0eb65798)
- Deviation 3 is **resolved**: the AS-5 lines in `automation/registry/README.md` (6, 34, 51) are byte-identical to `7a140616` again (Reinhard, PR #340). The docker-free resolver command now stands beside the historical `docker pull` line, marked as the current way. LD in registry/README = 2 docker lines (34, 51), as planned.
- SC-6 re-measured with the PLAN `PS` pathspec: `7a140616`=521, `93b9b127`=516, PR #340 head=517. Wave 3 net delta = 4, not 5: the restored line 51 and the added resolver example both name `n3ural-platform`, which is correct because the rollback image D lives only there. Not an SC failure; recorded here instead of changing PLAN.md.

