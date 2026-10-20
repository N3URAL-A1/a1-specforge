#!/usr/bin/env bash
# Scenario suite for `a1-tools schema-check run` (M6 Task 2.1b).
# 5 scenarios with asserted exit codes (0/1/1/1/2) + the 2.1a parser fixture.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0

check_scenario() {
  local scenario="$1" expected_rc="$2" expected_grep="${3:-}"
  local out rc
  out="$(node "$TOOLS" schema-check run --migrations "$DIR/$scenario/migrations" 2>&1)"
  rc=$?
  if [[ $rc -ne $expected_rc ]]; then
    echo "FAIL  $scenario: expected exit $expected_rc, got $rc — $out"
    fail=$((fail + 1))
    return
  fi
  if [[ -n "$expected_grep" ]] && ! grep -q "$expected_grep" <<<"$out"; then
    echo "FAIL  $scenario: exit ok but output missing '$expected_grep' — $out"
    fail=$((fail + 1))
    return
  fi
  echo "PASS  $scenario (exit $rc)"
  pass=$((pass + 1))
}

check_scenario "pass" 0 "schema-check: PASS"
check_scenario "fail-no-audit-trigger" 1 "audit_trigger"
check_scenario "fail-no-rls" 1 "ENABLE ROW LEVEL SECURITY"
check_scenario "fail-fk-type-mismatch" 1 "FK type mismatch"
check_scenario "error-no-migrations" 2 "migrations dir not found"

# Parser unit fixture from Task 2.1a
if bash "$DIR/parser/run-parser.sh"; then
  pass=$((pass + 1))
else
  echo "FAIL  parser fixture"
  fail=$((fail + 1))
fi

# Spec 017 FR-008: the gate call appends one log line (gate-0.6-schema) to the repo it runs in.
# Measured red 2026-10-20 (git-archive snapshot): gate-log.cjs recordRun() not called -> no log file;
# verdictForExit() 0 -> fail -> verdict assert fails.
LOGW="$(mktemp -d "${TMPDIR:-/tmp}/a1-fx-schema-log.XXXXXX")" || exit 1
[[ -n "$LOGW" && -d "$LOGW" ]] || exit 1
trap 'rm -rf "${LOGW:?}"' EXIT
git -C "$LOGW" init -q && git -C "$LOGW" config user.email t@t.dev && git -C "$LOGW" config user.name test
echo seed > "$LOGW/seed.txt"; git -C "$LOGW" add -A; git -C "$LOGW" commit -qm base
(cd "$LOGW" && node "$TOOLS" schema-check run --phase s1 --migrations "$DIR/pass/migrations" >/dev/null 2>&1); rc=$?
line="$(cat "$LOGW/.a1/phases/s1/gate-log.jsonl" 2>/dev/null)"
got="$(node -e 'const r=JSON.parse(process.argv[1]); process.stdout.write([r.gate,r.verdict,r.exit,r.scope].join("|"))' "$line" 2>&1)"
if [[ $rc -eq 0 && "$got" == "gate-0.6-schema|pass|0|s1" ]]; then
  echo "PASS  gate-log line (gate-0.6-schema, pass, exit 0, scope s1)"; pass=$((pass + 1))
else
  echo "FAIL  gate-log line (rc=$rc got=$got)"; fail=$((fail + 1))
fi

echo "schema-check fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
