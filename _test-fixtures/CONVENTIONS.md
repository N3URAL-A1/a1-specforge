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
