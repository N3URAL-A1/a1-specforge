# Fixture Suite Conventions

Every CLI change needs fixture coverage. Suites live at
`_test-fixtures/<suite>/run-tests.sh` — this is the standardized name across
all suites (the historical mix of `run.sh` / `run-test.sh` / `run-tests.sh`
was unified 2026-07-12). Run all of them with:

```bash
for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done
```

## Runner pattern

Each suite is a self-contained bash script with `set -u`, a `pass=0 fail=0` counter pair,
and `assert_rc`/`assert_true`-style helpers that print `PASS`/`FAIL  <name>` per case. The
last two lines of every suite are a summary echo and the exit gate:

```bash
# from _test-fixtures/a1-reservations/run-tests.sh:14-30
set -u

pass=0
fail=0

WORK="$(mktemp -d)"
FILE="$WORK/reservations.json"

assert_rc() {
  local name="$1" expected="$2" actual="$3" out="$4"
  if [[ "$actual" -ne "$expected" ]]; then
    echo "FAIL  $name: expected exit $expected, got $actual"
    echo "----- output -----"; echo "$out"; echo "------------------"
    fail=$((fail + 1))
  else
    echo "PASS  $name (exit $actual)"
    pass=$((pass + 1))
  fi
}
```

```bash
# last two lines of every suite
echo "<suite>: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
```

The final `[[ $fail -eq 0 ]]` is the script's exit status: exit 0 means all cases in the
suite are green, exit 1 means at least one case failed.

## Isolation

- All mutable state goes into `mktemp -d` — never write into the repo tree or a fixed path.
- CI additionally runs with `HOME=$(mktemp -d)` so suites cannot depend on a developer's
  real `~/.claude/` state.
- Original fixture data (vault fixtures, sample registries, etc.) is immutable — copy it
  into the temp workdir before mutating, never edit the checked-in fixture in place.
- JSON assertions go through `node -e '...'` rather than shell string matching/quoting,
  to avoid brittle quoting and to actually parse the structure being asserted on.

## Hostile inputs (mandatory)

**Every new CLI subcommand must ship at least one rejection test** covering, where
applicable:

- **(a) Path traversal** — `../../etc/passwd`, absolute paths where a relative path is
  expected.
- **(b) Injection-shaped input** — `; rm -rf /`, `$(...)`, backticks, `<script>` — these
  must be treated as inert strings and never evaluated/executed.
- **(c) Oversized values** — ≥ 10 000 chars — must fail fast or handle gracefully, and must
  never hang or crash the process.

Expected behavior: non-zero exit with clear stderr, OR safe inert handling — the fixture
must assert one of the two explicitly (don't just "not crash", assert the actual outcome).

Reference example: the stale-lock cases at `_test-fixtures/product-docs/run-tests.sh:820-871`
show the house style for this kind of edge-case coverage.

Context note: the historical path-traversal findings in this codebase were fixed in
commit `d639b8e`. This section exists so regressions are caught going forward, not to fix
anything that is currently broken.

## RED proof (mandatory for every new guard)

**Every new guard ships with a fixture case the guard actually rejects, committed
alongside it, and the case's fixture-file header (or its commit message) names the single
production-code change that turns it red.** A case without that line proves nothing and is
not a RED-proof instance — it is a case the guard happens to pass, which is not the same
claim.

This exists because a guard's correctness is *measured*, not *read*. A session that had
just documented the four false-green test classes (see `~/.claude/rules/common/testing.md`)
then shipped six guards-that-guard-nothing in three commits (2026-09-11, found by
Reinhard, 18 mutations). The fix is structural, not a reminder: pair every guard with a
case proven to die under a named mutation, before the guard is considered done.

**Practical test:** for each case, ask "which single line of production code, changed,
makes this red?" If the answer does not fit in one sentence, the case is not RED-proof yet
— either it never reaches the branch it names (Class 1, `testing.md`), or the assertion is
checking a result where the guarantee is about a process (Class 2), or the expectation
moves with the thing it measures (Class 4). Run the mutation for real before committing;
do not trust the one-sentence answer alone — two of Wave 4's own cases (below) needed a
second pass after the first mutation attempt did not kill them.

### Instances that satisfy this rule (spec 007-retro-gate-id-validator)

| Guard | Case(s) | Named red-making change |
|---|---|---|
| `retro validate` (Wave 2) | V2, V3 | V2: dropping the `canonical` field from the drift message template. V3: collapsing `unknown` into `drift` (V2 stays green, V3 alone fails — proving the two statuses are independently guarded). |
| `workflow lint` (Wave 3) | W1, W4 | W1: removing the `$?`-after-pipe predicate. W4: implementing only the `$?` form (misses the `\|\| exit`/`\|\| abort`/`\|\| return` status-testing shape). |
| `glob-liveness` (Wave 4) | G2 | Making `liveness()` return 1 (or throw) on zero matches instead of reporting `matches: 0` — verified live: this mutation kills G2 and, as a side effect, G3 (both assert a zero-match case), which is the expected overlap, not a weakness. |

### Instances that satisfy this rule (spec 010-vault-cockpit-contract)

Each red-making change below is quoted from the case's header comment in the named fixture file.

| Guard | Case(s) | Named red-making change |
|---|---|---|
| Suite isolation from the real vault (sentinel-vault arm, `a1-vault-cockpit/parts/04c-suite-isolation.sh`) | I1 | Deleting the `unset A1_VAULT_ROOT` line from `product-docs/run-tests.sh`: the empty `mktemp -d` sentinel vault then holds `project/<fixture-slug>/product/`. Every suite is found by the glob `_test-fixtures/*/run-tests.sh` + `*/run.sh` (no fixed list), so adding a new suite that runs `product init` without the `unset` is red as well. Measured red on 2026-09-26 for product-docs, product-schema-v11, product-adopt and product-audit-mirror. The other suites' arms are precautionary. |
| Vault-free goldens from `475382a` (`a1-vault-fallback/run-tests.sh`, `golden/capture.sh`) | G1, G2, G2b, G3 | G1: printing the `vault_mirror` key or any stderr line in the inactive tier. G2: any stderr line besides the one FR-031 `hint:` line, or any file change besides the FR-030 body header. G2b: resolving the learnings root eagerly (creates `.a1/learnings/`, two stderr lines). G3: any new stderr line or written file in the inactive tier. The goldens come from `git archive 475382a`, never from the working tree, so the expectation cannot move with the code (Class 4). `golden/spec-update-status.allowed-diff` lists the only two lines G2 may differ in. `golden/apply-allowed.cjs` exits 3 when an allowance matches zero or two lines, so an allowance that no longer matches cannot pass silently. |
| Symlink refusal on the mirror source side (`a1-vault-cockpit/parts/05-hosts.sh`) | S1, S2, S3, S4 | S1: removing the `lstat` check in `sourceProblem` (the linked `VISION.md`/`PLAN.md` is followed and the secret reaches the vault). S2: dropping the realpath containment in `sourceProblem` (a regular file behind a linked phase folder is mirrored). S3: dropping `baseProblem` (secret mirrored through a linked `docs/product/`), or computing extras for a refused set (`--prune` then deletes the earlier honest vault copy). S4: same as S1, via the product transaction hook. |
| Single vault writer, `A1_VAULT_WRITER_HOST` (`a1-vault-cockpit/parts/05-hosts.sh`) | H1–H8 | H1: skipping the gate in the product hook, or comparing against something other than `os.hostname()`. H2: inverting the comparison. H3: refusing when no writer is declared; H3b: taking `""` as a host name. H4: exiting 2 on a non-writer `vault sync` (the tightening Clarify deferred), or no gate in `vault sync`. H5: dropping the `host`/`writer_host`/`may_write` fields or hard-coding `may_write: true`. H6: removing the gate from `vault lint --fix-type`, or the generic `vault mirror` skip label. H7: removing the gate from `cmdVaultLinkHub`, or the generic label. H8: removing the gate from `spec init` (hub linked), or gating the whole command (no spec file written). |
| No BSD-only shell idioms in fixture suites (`a1-vault-fallback/run-tests.sh`) | L1 | Putting `mktemp -d -t w8a-grepo` back into `golden/scenarios.sh`, or any such idiom (`mktemp -t` without X's, `sed -i ''`, `stat -f`, BSD `date -j/-v`) into any suite script under `_test-fixtures/**/*.sh`; comment lines are ignored. |
| Checklist goldens from `475382a` (`a1-vault-fallback/run-tests.sh`) | G4, G4b | G4 (`--only 9,10`): evaluating check #11 although it is not selected, or its roadmap lookup announcing `code roots:` on stderr (`wants(11)` / `quiet: true` in `checklist.cjs`). G4b (full run): the same `code roots:` line (lookup without `quiet: true`), or any output change besides the check #11 entry allowed by `golden/checklist-full.allowed-diff`, whose `insert-after` op requires its anchor line to occur exactly once. |
| Unparseable roadmap fails #11 (`a1-checklist/run-tests.sh`) | CL3a–CL3d | CL3a: `readRoadmapAt` returning null on a parse error again, or #11 ignoring `fm: null`. CL3b: `brokenBelongsTo` attributing a broken cwd roadmap that names another project. CL3c: `brokenBelongsTo` never attributing a code-root checkout. CL3d: treating a code-root checkout like the cwd (a broken sibling without a `project:` line would block every gate). |
| No roadmap scan under `--only 9,10` (`a1-checklist/run-tests.sh`) | CL4a, CL4b | CL4a: dropping the `wants(11)` guard in `runChecklistChecks` — #11 runs, is filtered from the output, and the `readFileSync` trace shim shows the `ROADMAP.md` read. CL4b is the control under `--only 11`: it proves the shim sees the lookup at all. |
| Released schema goldens are frozen (`a1-vault-cockpit/parts/01-schema-export.sh`) | S12a, S12b | S12a: regenerating `schema-export.v1.json` from a changed export without a `contract_version` bump (S1 stays green). S12b: adding `schema-export.v2.json` without a sha256 pin line. |
| Sentinel arm reports child failures and restores reconcile fixtures (`a1-vault-cockpit/parts/04c-suite-isolation.sh`) | I1-exit, I2 | I1-exit: dropping the rc assertion (a child suite that exits 1, e.g. B1 on ubuntu, turns nothing red). I2: dropping the a1-reconcile restore (its 2 fixture files stay modified after the arm). |
| FR-010: a configured root that is missing or read-only (`a1-vault-cockpit/parts/03-sync.sh`) | C16, C16b | C16, one mutation per command: throwing `cannot_run` on `rootProblem` in `vault status` (exit 2); dropping `exitIfRootUnusable` in `vault lint` (single slug: exit 2 "project folder not found"; all slugs: exit 0 without a warning); dropping the `rootProblem` check in `vault link-hub` (single: exit 1 "artifact not found"; `<slug> --all-specs`: exit 1 "hub note missing"; `--all-specs`: no warning). C16b: checking `R_OK` instead of `W_OK` for the writing commands (`lint --fix-type`, `link-hub`), so the write fails with EACCES. C16b is skipped as uid 0. |
| `vault lint --fix-type` scope and bytes (`a1-vault-cockpit/parts/06a-lint.sh`) | L5, L5b, L8, L10, L11 | L5: stamping on any finding instead of on `type_missing` (files with a type gain a second `type:`). L5b: dropping the `frontmatter_folded` skip in `applyFixType` (the folded file is stamped and no longer listed under `skipped`). L8: resolving the tier with `vaultRootInfo()` before the refusal (creates `.a1/learnings/`, prints `learnings root:`). L10: dropping the `emptyTypeLine()` replacement (an empty `type:` gets duplicated and every run adds another). L11: restoring the "type_missing is the ONLY finding" guard (status outliers stay unstamped). |
| Hub linking: conflict copies and CRLF (`a1-vault-cockpit/parts/06b-hub.sh`) | HB11, HB12 | HB11: dropping `&& !isConflictCopy(f)` in `listSpecBasenames` (`(conflict 2)`, `(Conflicted copy …)` and friends get linked). HB12: dropping the `cr` suffix in `insertRelationLine`, in the insert or the append branch (bare-LF lines in a CRLF hub). |
| Writer gate order and linked set roots (`a1-vault-cockpit/parts/05-hosts.sh`) | H7c, S3, S5 | H7c: running the writer gate before the argument checks in `cmdVaultLinkHub` (a bare `vault link-hub` exits 0 `skipped` instead of 1). S3/S5 text: the old "source folder resolves outside the repo" reason instead of the FR-005 set-root refusal. S5 hook: dropping the `patterns.length === 0` early return in `planSet` (the product hook warns about a `phases/` set it never mirrors). |

### A worked lesson from Wave 4: a case that could not enter its own branch

Wave 4's first draft of the `a1-code-roots` `caseF` retrofit (the liveness arm added to
prove a glob is live, not just correctly shaped) **planted a fixture directory for
whichever glob pattern the code under test had just emitted**, then measured matches
against that same self-planted tree. Reverting the `quick` glob to the historical plural
spelling (`.a1/learnings/projects/*/quick`) left the case green: `plantFor` happily built a
`projects/` tree to satisfy the mutated glob, so the arm always found what it had just
planted for itself, regardless of whether the emitted glob name matched the real store
layout. This is Class 1 from `testing.md` — the case could not enter the branch it named,
because its own setup adapted to whatever the mutation produced.

The fix: plant the **real, fixed store layout** once (`project/` singular, independent of
whatever the code emits), then measure the **emitted** globs against that fixed layout with
`liveness(..., { skipPlant: true })`. Only then did reverting the glob to plural reliably
turn the case red — see `_test-fixtures/a1-glob-liveness/run-tests.sh`'s G6, which commits
this exact mutation as a probe against the real `_shared/lib/learnings.cjs` glob, applied
and reverted in place on every run.

A second, narrower instance of the same lesson: G5 (expansion parity) initially planted
only a single matching root. A native `fs.readdir(parent).length` reimplementation that
diverges from `ls -d` on multi-child directories happened to agree with `ls -d`'s count
(both `1`) under that single-root layout — the mutation did not turn G5 red on the first
attempt. G5 now plants a second, non-matching sibling directory specifically so an
overcounting reimplementation and the shell's exact-pattern match diverge, which a
mutation run confirmed.
