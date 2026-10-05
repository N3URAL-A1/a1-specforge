#!/usr/bin/env bash
# a1-intent — fixture suite for spec 011-intent-queue-consumer (the intent
# queue consumer). One runner; one case file per wave under cases/NN-*.sh,
# sourced in name order. Every result line names the requirement it belongs to
# (spec SC-001): "PASS  <case> ... [FR-NNN]".
#
# Isolation: every `a1-tools intent` call runs with HOME and A1_VAULT_ROOT
# pointed at a per-case sandbox under ONE mktemp -d work dir; the real vault
# and the real ~/.a1-intents are never touched. `claude` is replaced by
# stub/claude, first on PATH. stub/trace.cjs (NODE_OPTIONS preload) logs every
# file read and every child-process call of the CLI, so "no read outside" and
# "0 spawns" are measured, not assumed.
set -u
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SUITE_DIR/../.." && pwd)"

pass=0
fail=0

WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-intent.XXXXXX")"
if [[ -z "$WORK" || ! -d "$WORK" ]]; then
  echo "a1-intent: mktemp gave no directory — aborting before any case runs" >&2
  exit 3
fi
trap 'rm -rf "$WORK"' EXIT

# shellcheck source=lib.sh
source "$SUITE_DIR/lib.sh"

export LC_ALL=C
for case_file in "$SUITE_DIR"/cases/*.sh; do
  [[ -f "$case_file" ]] || continue
  # shellcheck disable=SC1090
  source "$case_file"
done

echo "a1-intent: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
