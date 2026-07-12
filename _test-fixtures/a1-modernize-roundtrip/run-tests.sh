#!/usr/bin/env bash
# Regression: frontmatter round-trip for modernize proposals/waves.
# writeMdAtomic serializes array-of-object entries as JSON strings; on re-read
# the id-lookups must still find them (bug found during M5 validation 2026-07-05:
# approve-proposal failed with "proposal P-001 not found" right after add-proposal).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$REPO/_shared/a1-tools.cjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export A1_VAULT_ROOT="$TMP/vault"
mkdir -p "$TMP/vault" "$TMP/project"

pass=0; fail=0
check() { # <desc> <expected-exit> <cmd...>
  local desc="$1" expected="$2"; shift 2
  set +e; "$@" >/dev/null 2>&1; local code=$?; set -e
  if [ "$code" -eq "$expected" ]; then echo "PASS $desc"; pass=$((pass+1));
  else echo "FAIL $desc (exit $code, expected $expected)"; fail=$((fail+1)); fi
}

MASTER_JSON=$(node "$CLI" modernize init roundtrip-test full --project-path "$TMP/project" --date 2026-01-01)
MASTER=$(node -e "console.log(JSON.parse(process.argv[1]).path)" "$MASTER_JSON")

check "add-proposal" 0 node "$CLI" modernize add-proposal "$MASTER" --title "t" --rationale "r" --risk low --effort "1w" --rollback "revert"
# The critical round-trip: a SECOND process must find P-001 after re-reading the file
check "approve-proposal after re-read" 0 node "$CLI" modernize approve-proposal "$MASTER" P-001 approved
check "approve unknown proposal fails" 1 node "$CLI" modernize approve-proposal "$MASTER" P-999 approved

check "add-wave" 0 node "$CLI" modernize add-wave "$MASTER" --title "w1"
check "start-wave after re-read" 0 node "$CLI" modernize start-wave "$MASTER" W-01
# Legacy (no snapshot_hash yet): claim-based pass/fail still works.
check "complete-wave after re-read (legacy claim)" 0 node "$CLI" modernize complete-wave "$MASTER" W-01 --snapshot-replay pass --fr-ac-checks '{}'
check "complete-wave parity fail blocks" 1 node "$CLI" modernize complete-wave "$MASTER" W-01 --snapshot-replay fail --fr-ac-checks '{}'

# Decision must survive in the file
grep -q 'approved_by_robert.*approved' "$MASTER" || { echo "FAIL decision not persisted"; fail=$((fail+1)); }

# --- FMEA-2: computed parity via snapshot hash + --replay-file ---
SMOKE="$TMP/smoke.txt"; printf 'baseline smoke output\n' > "$SMOKE"
REPLAY_SAME="$TMP/replay-same.txt"; printf 'baseline smoke output\n' > "$REPLAY_SAME"
REPLAY_DIFF="$TMP/replay-diff.txt"; printf 'DRIFTED smoke output\n' > "$REPLAY_DIFF"

# snapshot-behavior stores snapshot_hash of the smoke artifact
node "$CLI" modernize snapshot-behavior "$MASTER" --manual-smoke "$SMOKE" >/dev/null
grep -q 'snapshot_hash=' "$MASTER" \
  && { echo "PASS snapshot_hash stored"; pass=$((pass+1)); } \
  || { echo "FAIL snapshot_hash stored"; fail=$((fail+1)); }
node "$CLI" modernize verify-parity "$MASTER" | grep -q "\"manual_smoke_doc\": \"$SMOKE\"" \
  && { echo "PASS parity_baseline round-trip"; pass=$((pass+1)); } \
  || { echo "FAIL parity_baseline round-trip"; fail=$((fail+1)); }

# (a) replay-file identical → complete-wave exit 0 (computed pass overrides claim)
check "complete-wave computed replay identical" 0 node "$CLI" modernize complete-wave "$MASTER" W-01 --snapshot-replay pass --replay-file "$REPLAY_SAME" --fr-ac-checks '{}'
# (b) replay-file differing → exit 1 (parity drift, even with claim pass)
check "complete-wave computed replay differing" 1 node "$CLI" modernize complete-wave "$MASTER" W-01 --snapshot-replay pass --replay-file "$REPLAY_DIFF" --fr-ac-checks '{}'
# (c) hash present + no replay-file + claim pass → exit 1 (claim alone rejected)
check "complete-wave hash present claim-only rejected" 1 node "$CLI" modernize complete-wave "$MASTER" W-01 --snapshot-replay pass --fr-ac-checks '{}'

# --- FMEA-5: --approved-by audit trail ---
node "$CLI" modernize approve-proposal "$MASTER" P-001 approved --approved-by "harness:test" >/dev/null
grep -q 'approved_by.*harness:test' "$MASTER" \
  && { echo "PASS approved_by audit trail persisted"; pass=$((pass+1)); } \
  || { echo "FAIL approved_by audit trail persisted"; fail=$((fail+1)); }

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
