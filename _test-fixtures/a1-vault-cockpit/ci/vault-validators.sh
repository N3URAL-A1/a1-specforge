#!/usr/bin/env bash
# CI step "Vault cockpit validators" (spec 010, wave 8B): runs the two vault
# validators through the real CLI against a throwaway vault and asserts their
# exit codes explicitly.
#
#   vault lint demo --json    on planted defects  → exit 1 (and on a clean vault → 0)
#   vault status demo --json  on a synced repo    → exit 0 (and after drift → 1)
#
# Each check has its counter-check, so neither validator can pass by always
# returning the same code. Fixture shapes are copied from parts/06a-lint.sh
# (make_sc004_vault) and parts/03-sync.sh (make_sync_repo/make_sync_vault).
#
# Isolation: A1_VAULT_ROOT must be set by the caller to an empty mktemp -d
# directory; the script refuses anything else, in particular ~/N3URAL-Vault.
# HOME and A1_CODE_ROOTS are redirected into a second mktemp -d directory.
#
# Red-making change: dropping the `status` line from the vault router
# (_shared/lib/vault-cli.cjs) — the call exits 1 with a usage error and the
# synced-fixture check fails. Dropping the `lint` line fails the findings
# count (usage text is no JSON); making lint ignore a planted class fails it too.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

fail() { echo "FAIL  $1" >&2; exit 1; }
pass() { echo "PASS  $1"; }

[[ -n "${A1_VAULT_ROOT:-}" ]] || fail "A1_VAULT_ROOT is not set (the caller passes a mktemp -d directory)"
[[ -z "${A1_VAULT_WRITER_HOST:-}" ]] || fail "A1_VAULT_WRITER_HOST must be unset"
VAULT="$(cd "$A1_VAULT_ROOT" 2>/dev/null && pwd -P)" || fail "A1_VAULT_ROOT does not exist: $A1_VAULT_ROOT"
case "$VAULT" in
  *N3URAL-Vault*) fail "A1_VAULT_ROOT points at a real vault: $VAULT" ;;
esac
[[ -z "$(ls -A "$VAULT")" ]] || fail "A1_VAULT_ROOT is not empty: $VAULT"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/home" "$WORK/code"
export HOME="$WORK/home"
export A1_CODE_ROOTS="$WORK/code"

# ---------- lint: planted defects → exit 1 ----------
LINT="$VAULT/lint"
p="$LINT/project/demo"
mkdir -p "$p/spec"
printf -- '---\ntype: spec\nid: 001-valid\nstatus: draft\n---\n# Valid\n' > "$p/spec/001-valid.md"
printf -- '---\nid: 002-no-type\nstatus: clarified\n---\n# No type\n' > "$p/spec/002-no-type.md"
printf -- '---\ntype: spec\nstatus: ux-draft\n---\n# Bad status\n' > "$p/spec/003-ux-draft.md"
printf -- '---\ntype: spec\nstatus: draft\n# closing fence lost\n' > "$p/spec/004-broken.md"

set +e
out="$(A1_VAULT_ROOT="$LINT" node "$TOOLS" vault lint demo --json)"; rc=$?
set -e
echo "vault lint demo --json (planted defects): rc=$rc"
[ "$rc" = 1 ] || fail "vault lint on planted defects: expected exit 1, got $rc"
n="$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).findings.length)))' 2>/dev/null)" || n="UNPARSEABLE"
[ "$n" = 3 ] || fail "vault lint on planted defects: expected 3 findings, got $n"
pass "vault lint on planted defects exits 1 with 3 findings"

# counter-check: a clean vault → exit 0
rm "$p/spec/002-no-type.md" "$p/spec/003-ux-draft.md" "$p/spec/004-broken.md"
set +e
A1_VAULT_ROOT="$LINT" node "$TOOLS" vault lint demo --json >/dev/null; rc=$?
set -e
echo "vault lint demo --json (clean): rc=$rc"
[ "$rc" = 0 ] || fail "vault lint on a clean vault: expected exit 0, got $rc"
pass "vault lint on a clean vault exits 0"

# ---------- status: synced fixture → exit 0 ----------
SYNC="$VAULT/sync"
mkdir -p "$SYNC/project"
printf -- '---\ntype: project\nstatus: build\n---\n# demo\n\n## Relations\n' > "$SYNC/project/demo.md"
r="$WORK/code/repo"
mkdir -p "$r/docs/product/features/001-login" "$r/.a1/phases/M1-P1"
git init -q "$r"
printf -- '---\nproject: demo\nstatus: active\n---\n# Roadmap\n' > "$r/docs/product/ROADMAP.md"
printf 'vision\n' > "$r/docs/product/VISION.md"
printf '# feature 001\n' > "$r/docs/product/features/001-login/feature.md"
printf '# GOAL P1\n' > "$r/.a1/phases/M1-P1/GOAL.md"

set +e
(cd "$r" && A1_VAULT_ROOT="$SYNC" node "$TOOLS" vault sync demo --json >/dev/null); rc=$?
set -e
[ "$rc" = 0 ] || fail "vault sync (fixture setup): expected exit 0, got $rc"

set +e
(cd "$r" && A1_VAULT_ROOT="$SYNC" node "$TOOLS" vault status demo --json >/dev/null); rc=$?
set -e
echo "vault status demo --json (synced): rc=$rc"
[ "$rc" = 0 ] || fail "vault status on a synced fixture: expected exit 0, got $rc"
pass "vault status on a synced fixture exits 0"

# counter-check: drift → exit 1
printf 'vision changed\n' > "$r/docs/product/VISION.md"
set +e
(cd "$r" && A1_VAULT_ROOT="$SYNC" node "$TOOLS" vault status demo --json >/dev/null); rc=$?
set -e
echo "vault status demo --json (drift): rc=$rc"
[ "$rc" = 1 ] || fail "vault status with drift: expected exit 1, got $rc"
pass "vault status with drift exits 1"
