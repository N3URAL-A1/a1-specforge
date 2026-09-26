#!/usr/bin/env bash
# Captures the G1-G3 goldens from commit 475382a — the last commit before
# spec 010 — NEVER from the working tree (testing.md class 4).
#
#   bash _test-fixtures/a1-vault-fallback/golden/capture.sh
#
# Extracts the commit with `git archive`, runs golden/scenarios.sh with that
# tree's a1-tools.cjs (vault-free, temp HOME, fresh git repos) and writes
# <name>.{out,err,files} here, each with a one-line header naming the commit
# and this command. Re-running it must reproduce the committed goldens
# byte for byte; a diff means the capture itself is not deterministic.
set -euo pipefail
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST

GOLDEN_COMMIT=475382a
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
# shellcheck source=scenarios.sh
source "$HERE/scenarios.sh"
PRE="$(g_mktemp w8a-pre)"; g_need_dir PRE "$PRE"
trap 'rm -rf "$PRE"' EXIT

git -C "$REPO_ROOT" archive "$GOLDEN_COMMIT" | tar -x -C "$PRE"

HEADER="# golden: commit $GOLDEN_COMMIT, captured by: bash _test-fixtures/a1-vault-fallback/golden/capture.sh"
for entry in "${G_SCENARIOS[@]}"; do
  name="${entry%%:*}"; fn="${entry#*:}"
  work="$(g_mktemp w8a-cap)"; g_need_dir work "$work"
  "$fn" "$PRE/_shared/a1-tools.cjs" "$work/$name"
  g_cleanup
  for ext in out err files; do
    { printf '%s\n' "$HEADER"; cat "$work/$name.$ext"; } >"$HERE/$name.$ext"
  done
  rm -rf "$work"
  printf 'captured %s\n' "$name"
done
