#!/usr/bin/env bash
# Fixture test for `a1-tools cost run` (M6 Task 2.2).
# Asserts against expected.md: totals 51100 (dedup by message.id + sub-agent
# logs added), per-model breakdown, --since window, malformed-line skip
# (injected into a TEMP COPY — the committed fixture stays valid JSON).
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0
record() {
  if [[ "$1" == PASS ]]; then pass=$((pass + 1)); else fail=$((fail + 1)); fi
  echo "$1  $2"
}

assert_json() {
  # assert_json <label> <json> <node-expr returning true/false>
  local label="$1" json="$2" expr="$3"
  if node -e "const r=JSON.parse(process.argv[1]); process.exit(($expr)?0:1);" "$json"; then
    record PASS "$label"
  else
    record FAIL "$label — got: $json"
  fi
}

# --- Case 1: full aggregation (dedup + sub-agent) ---
out="$(node "$TOOLS" cost run --project "$DIR" --json 2>&1)"
rc=$?
if [[ $rc -ne 0 ]]; then
  record FAIL "cost run exited $rc — $out"
else
  assert_json "totals (in 9200, out 1700, cacheRead 33500, cacheCreation 6700, total 51100)" "$out" \
    "r.totals.input===9200 && r.totals.output===1700 && r.totals.cacheRead===33500 && r.totals.cacheCreation===6700 && r.totals.total===51100"
  assert_json "summary line" "$out" \
    "r.summary==='Cost: 51100 tokens (in 9200, out 1700, cache 40200)'"
  assert_json "per-model opus" "$out" \
    "r.perModel['claude-opus-4-8'].input===7000 && r.perModel['claude-opus-4-8'].output===1200 && r.perModel['claude-opus-4-8'].cacheRead===30000 && r.perModel['claude-opus-4-8'].cacheCreation===6000"
  assert_json "per-model haiku (sub-agent)" "$out" \
    "r.perModel['claude-haiku-4-5'].input===1700 && r.perModel['claude-haiku-4-5'].output===400"
  assert_json "no skipped lines in clean fixture" "$out" "r.skippedLines===0"
fi

# --- Case 2: time window (--since 2026-07-02 → only msg_D, total 25700) ---
out="$(node "$TOOLS" cost run --project "$DIR" --since 2026-07-02T00:00:00Z --json 2>&1)"
rc=$?
if [[ $rc -ne 0 ]]; then
  record FAIL "cost run --since exited $rc — $out"
else
  assert_json "--since window (total 25700)" "$out" \
    "r.totals.input===4000 && r.totals.output===700 && r.totals.cacheRead===20000 && r.totals.cacheCreation===1000 && r.totals.total===25700"
fi

# --- Case 3: malformed line skipped (temp copy, per expected.md delegation) ---
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$DIR/session-sample.jsonl" "$TMP/session-sample.jsonl"
mkdir -p "$TMP/session-sample/subagents"
cp "$DIR/session-sample/subagents/"*.jsonl "$TMP/session-sample/subagents/"
echo '{"type":"assistant","message":{"id":"msg_broken","usage":{' >> "$TMP/session-sample.jsonl"
out="$(node "$TOOLS" cost run --project "$TMP" --json 2>&1)"
rc=$?
if [[ $rc -ne 0 ]]; then
  record FAIL "malformed-line run crashed (exit $rc) — $out"
else
  assert_json "malformed line: skippedLines===1, totals unchanged (51100)" "$out" \
    "r.skippedLines===1 && r.totals.total===51100"
fi

# --- Case 4: error path (missing project dir → exit 2) ---
node "$TOOLS" cost run --project "$TMP/does-not-exist" >/dev/null 2>&1
rc=$?
if [[ $rc -eq 2 ]]; then
  record PASS "missing project dir → exit 2"
else
  record FAIL "missing project dir: expected exit 2, got $rc"
fi

echo "a1-cost fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
