#!/usr/bin/env bash
# Scenario suite for `a1-tools learnings count-since-watermark` (M11-P4
# learning-loop counter).
# Cooperative cases:
#   valid-count-mixed      -> 0, count 6 (3 h2 blocks + 2 date blocks + 1 postmortem)
#   no-watermark-found     -> 2 (patterns.md present, no 'updated:' field)
#   watermark-file-missing -> 3 (no patterns.md anywhere under the root)
#   empty-store             -> 0, count 0 (valid watermark, zero learning entries)
# Hostile-input cases (per _test-fixtures/CONVENTIONS.md), all against
# --projects-root:
#   hostile-traversal       -> observed safe outcome (exit 3, no out-of-tree leak)
#   hostile-injection        -> observed safe outcome (exit 3, no code execution)
#   hostile-overlong          -> observed safe outcome (exit 3, no hang)
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0

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

# --- valid-count-mixed: count == 6 -> 0 ---
OUT="$(node "$TOOLS" learnings count-since-watermark --projects-root "$DIR/valid-count-mixed" --json 2>&1)"
RC=$?
assert_rc "valid-count-mixed" 0 "$RC" "$OUT"
COUNT="$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).count)}catch(e){console.log("PARSE_ERROR")}})' <<<"$OUT")"
if [[ "$COUNT" != "6" ]]; then
  echo "FAIL  valid-count-mixed-count: expected count 6, got $COUNT"; fail=$((fail + 1))
else
  echo "PASS  valid-count-mixed-count (count 6)"; pass=$((pass + 1))
fi

# --- no-watermark-found: patterns.md present, no 'updated:' field -> 2 ---
OUT="$(node "$TOOLS" learnings count-since-watermark --projects-root "$DIR/no-watermark-found" --json 2>&1)"
RC=$?
assert_rc "no-watermark-found" 2 "$RC" "$OUT"

# --- watermark-file-missing: no patterns.md anywhere -> 3 ---
OUT="$(node "$TOOLS" learnings count-since-watermark --projects-root "$DIR/watermark-file-missing" --json 2>&1)"
RC=$?
assert_rc "watermark-file-missing" 3 "$RC" "$OUT"

# --- empty-store: valid watermark, zero learning entries -> 0, count 0 ---
OUT="$(node "$TOOLS" learnings count-since-watermark --projects-root "$DIR/empty-store" --json 2>&1)"
RC=$?
assert_rc "empty-store" 0 "$RC" "$OUT"
COUNT="$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).count)}catch(e){console.log("PARSE_ERROR")}})' <<<"$OUT")"
if [[ "$COUNT" != "0" ]]; then
  echo "FAIL  empty-store-count: expected count 0, got $COUNT"; fail=$((fail + 1))
else
  echo "PASS  empty-store-count (count 0)"; pass=$((pass + 1))
fi

# --- Hostile inputs (per _test-fixtures/CONVENTIONS.md) ---
# All three land on the counter's own defined exit 3 ("watermark source
# missing") — observed once against the real implementation and pinned here,
# per this task's "observe, then pin" requirement, not guessed in advance.

# hostile-traversal: relative path traversal outside any project tree must
# not read or report on anything under the real filesystem outside the
# fixture root — assert exit 3 AND that no real project name leaked into
# the JSON/stderr output.
OUT="$(cd "$DIR" && node "$TOOLS" learnings count-since-watermark --projects-root '../../../../etc' --json 2>&1)"
RC=$?
assert_rc "hostile-traversal" 3 "$RC" "$OUT"
if grep -q '"a1-skills"' <<<"$OUT" || grep -q '"project_orchestration"' <<<"$OUT"; then
  echo "FAIL  hostile-traversal-no-leak: real project name leaked into output"; fail=$((fail + 1))
else
  echo "PASS  hostile-traversal-no-leak"; pass=$((pass + 1))
fi

# hostile-injection: shell-injection-shaped value must be treated as an
# inert string (no command execution) — assert exit 3 AND that the touch
# target file was never created.
rm -f /tmp/pwned-learnings
OUT="$(node "$TOOLS" learnings count-since-watermark --projects-root 'x:$(touch /tmp/pwned-learnings)' --json 2>&1)"
RC=$?
assert_rc "hostile-injection" 3 "$RC" "$OUT"
if [[ -e /tmp/pwned-learnings ]]; then
  echo "FAIL  hostile-injection-inert: injection was executed, /tmp/pwned-learnings exists"; fail=$((fail + 1))
  rm -f /tmp/pwned-learnings
else
  echo "PASS  hostile-injection-inert"; pass=$((pass + 1))
fi

# hostile-overlong: oversized --projects-root value must not hang. No
# portable timeout/gtimeout on every dev machine (notably stock macOS) —
# bound it manually via a background job + wait/kill instead, same pattern
# as a1-reservations/run-tests.sh's hostile-release-overlong case.
OVERLONG_VALUE="$(head -c 12000 /dev/zero | tr '\0' 'a')"
WORK="$(mktemp -d)"
OVERLONG_OUT_FILE="$WORK/overlong.out"
node "$TOOLS" learnings count-since-watermark --projects-root "$OVERLONG_VALUE" --json >"$OVERLONG_OUT_FILE" 2>&1 &
OVERLONG_PID=$!
OVERLONG_WAITED=0
while kill -0 "$OVERLONG_PID" 2>/dev/null && [[ $OVERLONG_WAITED -lt 10 ]]; do
  sleep 1
  OVERLONG_WAITED=$((OVERLONG_WAITED + 1))
done
if kill -0 "$OVERLONG_PID" 2>/dev/null; then
  kill -9 "$OVERLONG_PID" 2>/dev/null
  RC=124
else
  wait "$OVERLONG_PID"
  RC=$?
fi
OUT="$(cat "$OVERLONG_OUT_FILE")"
assert_rc "hostile-overlong" 3 "$RC" "$OUT"

echo "a1-learnings: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
