#!/usr/bin/env bash
# Fixture suite: a1-vault-cockpit — vault cockpit contract (spec 010).
#
# HARNESS ONLY (Wave 1, frozen afterwards): helpers, counters, the summary
# line. Every case lives in parts/NN-<group>.sh — one file per wave, sourced
# below in NN order — so parallel waves never write the same test file.
#
# Golden: golden/schema-export.v1.json is the frozen `schema export --json`
# document at contract version 1. Regenerate it ONLY together with a version
# bump, from the repo root:
#
#   node _shared/a1-tools.cjs schema export --json \
#     > _test-fixtures/a1-vault-cockpit/golden/schema-export.v<N>.json
#
# Rule (FR-021): bump VAULT_CONTRACT_VERSION in _shared/lib/status-constants.cjs
# in the SAME commit as any change to the exported shape or values, and point
# GOLDEN below at the new file. A golden mismatch with an unchanged version is a
# test failure, by design — never "fix" it by regenerating alone.
#
# Every expectation in parts/ is a literal typed into the fixture, never
# imported from the module under test (testing.md class 4). Every case names
# the single production change that turns it red (CONVENTIONS.md "RED proof").
#
# RED record (2026-09-25, section S run before any Wave 1 production code
# existed — `schema` was an unknown command group): 18 of 24 assertions red.
# Green before the code existed, by construction: S3 (two empty outputs are
# identical), the exit-code halves of S7a/S7b (unknown group already exits 1 —
# their stderr-text halves were red), S9b (`spec set-size XL` → 1) and
# S10c/S10d (`product validate` paused → 0, bogus → 1). The last three are the
# regression halves that must flip TOGETHER with their export half under the
# named mutation (M9a/M10 in the Wave 1 report did exactly that). Everything
# that reads the export was red.
#
# RED record, Wave 2 (2026-09-25, section M run before vault-mirror.cjs and
# vaultRootInfo() existed): 28 of 35 assertions red. Green before the code
# existed, by construction: the pure absence / "nothing changed" checks
# (M1b ×2, M2b, M6 "dir not created", M7 ×3) — each is the negative half of
# a positive assertion in the same case that was red.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUITE="$REPO_ROOT/_test-fixtures/a1-vault-cockpit"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
GOLDEN="$SUITE/golden/schema-export.v1.json"

pass=0; fail=0; results=()
ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

# assert_rc <name> <expected> <actual> [detail]
assert_rc() {
  local name="$1" expected="$2" actual="$3" detail="${4:-}"
  if [[ "$actual" -eq "$expected" ]]; then ok "$name (exit $actual)"
  else bad "$name: expected exit $expected, got $actual${detail:+ — $detail}"; fi
}

# assert_eq <name> <got> <want>
assert_eq() {
  local name="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then ok "$name"
  else bad "$name (want=$want got=$got)"; fi
}

# json_get <json-text> <node-expression over j> — evaluates the expression with
# `j` bound to the parsed JSON and prints the result (strings verbatim, else
# JSON). The JSON travels through a TEMP FILE, never as an argv element (a
# > 64 KiB argv blew ARG_MAX in CI). Unparseable JSON prints UNPARSEABLE.
JSON_TMP="$(mktemp -d)"
json_get() {
  local file="$JSON_TMP/json.$$.$RANDOM"
  printf '%s' "$1" > "$file"
  JSON_FILE="$file" node -e "
    let j; try { j = JSON.parse(require('fs').readFileSync(process.env.JSON_FILE, 'utf8')); } catch (e) { process.stdout.write('UNPARSEABLE'); process.exit(0); }
    const v = ($2); process.stdout.write(v === undefined ? 'undefined' : typeof v === 'string' ? v : JSON.stringify(v));
  " 2>&1
  rm -f "$file"
}

# assert_json <name> <json-text> <node-expression over j> <expected-string>
assert_json() {
  local name="$1" json="$2" expr="$3" want="$4" got
  got="$(json_get "$json" "$expr")"
  if [[ "$got" == "$want" ]]; then ok "$name"
  else bad "$name (want=$want got=$got)"; fi
}

# ---------- parts, in NN order ----------
shopt -s nullglob
parts=("$SUITE"/parts/*.sh)
shopt -u nullglob
if [[ ${#parts[@]} -eq 0 ]]; then
  echo "FAIL  harness: no parts/*.sh found under $SUITE" >&2
  fail=1
fi
for p in "${parts[@]}"; do
  # shellcheck disable=SC1090
  source "$p"
done

rm -rf "$JSON_TMP"
printf '%s\n' "${results[@]}"
echo "----"
echo "a1-vault-cockpit: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
