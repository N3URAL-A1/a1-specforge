# Fixture Suite Conventions

Every CLI change needs fixture coverage. Suites live at `_test-fixtures/<suite>/run*.sh`
(most use `run.sh`; `a1-worktree` uses `run-tests.sh`, `a1-pr-review` uses `run-test.sh`).
Run all of them with:

```bash
for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done
```

## Runner pattern

Each suite is a self-contained bash script with `set -u`, a `pass=0 fail=0` counter pair,
and `assert_rc`/`assert_true`-style helpers that print `PASS`/`FAIL  <name>` per case. The
last two lines of every suite are a summary echo and the exit gate:

```bash
# from _test-fixtures/a1-reservations/run.sh:14-30
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

Reference example: the stale-lock cases at `_test-fixtures/product-docs/run.sh:820-871`
show the house style for this kind of edge-case coverage.

Context note: the historical path-traversal findings in this codebase were fixed in
commit `d639b8e`. This section exists so regressions are caught going forward, not to fix
anything that is currently broken.
