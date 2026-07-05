#!/usr/bin/env bash
# Scenario suite for `a1-tools pack` (Gate-Pack system, ADR 2026-07-05).
# Covers: validate (valid/missing-field/executable-checks), import (staged +
# idempotent re-import), export (anonymization deny-regex leak).
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0

expect_rc() {
  local label="$1" expected="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"
  rc=$?
  if [[ $rc -ne $expected ]]; then
    echo "FAIL  $label: expected exit $expected, got $rc — $out"
    fail=$((fail + 1))
    return 1
  fi
  echo "PASS  $label (exit $rc)"
  pass=$((pass + 1))
  return 0
}

expect_grep() {
  local label="$1" needle="$2"; shift 2
  local out
  out="$("$@" 2>&1)"
  if grep -q "$needle" <<<"$out"; then
    echo "PASS  $label (found '$needle')"
    pass=$((pass + 1))
  else
    echo "FAIL  $label: output missing '$needle' — $out"
    fail=$((fail + 1))
  fi
}

# --- validate ---
expect_rc "validate valid-pack → 0" 0 \
  node "$TOOLS" pack validate "$DIR/valid-pack"
expect_rc "validate missing-field-pack → 1" 1 \
  node "$TOOLS" pack validate "$DIR/missing-field-pack"
expect_grep "validate missing-field names provenance.source" "provenance.source" \
  node "$TOOLS" pack validate "$DIR/missing-field-pack"
expect_rc "validate executable-checks-pack → 1" 1 \
  node "$TOOLS" pack validate "$DIR/executable-checks-pack"
expect_grep "validate rejects executable payload" "executable payloads" \
  node "$TOOLS" pack validate "$DIR/executable-checks-pack"

# --- import (staged in a temp repo) ---
TMP_REPO="$(mktemp -d)"
trap 'rm -rf "$TMP_REPO" "$TMP_VAULT"' EXIT
expect_rc "import valid-pack → 0 (staged)" 0 \
  node "$TOOLS" pack import "$DIR/valid-pack" --dest "$TMP_REPO"
if [[ -f "$TMP_REPO/.a1/packs/valid-pack/pack.yaml" ]]; then
  echo "PASS  import staged manifest present"
  pass=$((pass + 1))
else
  echo "FAIL  import: .a1/packs/valid-pack/pack.yaml not staged"
  fail=$((fail + 1))
fi
# never applies: the target skill file must not be touched (nothing to assert
# beyond staging — the import command exits after copy).
expect_grep "import prints 'apply via a1-evolve'" "apply via a1-evolve" \
  node "$TOOLS" pack import "$DIR/valid-pack" --dest "$TMP_REPO"
# re-import same version → idempotent exit 0
expect_rc "re-import same version → 0 (idempotent)" 0 \
  node "$TOOLS" pack import "$DIR/valid-pack" --dest "$TMP_REPO"
expect_grep "re-import reports idempotent" "idempotent" \
  node "$TOOLS" pack import "$DIR/valid-pack" --dest "$TMP_REPO"

# --- export: planted /Users/rob leak must abort with exit 1 ---
TMP_VAULT="$(mktemp -d)"
mkdir -p "$TMP_VAULT/pattern/a1-learnings"
cat > "$TMP_VAULT/pattern/a1-learnings/patterns.md" <<'EOF'
---
type: pattern
updated: 2026-06-21
---
## Monitoring (watch)

- leaky_pattern (3) — see /Users/rob/secret/path for the real fix
EOF
expect_rc "export with planted /Users/rob leak → 1" 1 \
  env A1_VAULT_ROOT="$TMP_VAULT" \
  node "$TOOLS" pack export --patterns leaky_pattern --anonymize A2 \
    --out "$TMP_REPO/exported" --source "test corpus"
expect_grep "export leak lists /Users/ hit" "Users" \
  env A1_VAULT_ROOT="$TMP_VAULT" \
  node "$TOOLS" pack export --patterns leaky_pattern --anonymize A2 \
    --out "$TMP_REPO/exported" --source "test corpus"
# clean export (no leak) → 0
cat > "$TMP_VAULT/pattern/a1-learnings/patterns.md" <<'EOF'
---
type: pattern
updated: 2026-06-21
---
## Monitoring (watch)

- clean_pattern (3) — mechanism-only description, no paths
EOF
expect_rc "export clean pattern → 0" 0 \
  env A1_VAULT_ROOT="$TMP_VAULT" \
  node "$TOOLS" pack export --patterns clean_pattern --anonymize A2 \
    --out "$TMP_REPO/exported-clean" --source "test corpus"

echo "pack fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
