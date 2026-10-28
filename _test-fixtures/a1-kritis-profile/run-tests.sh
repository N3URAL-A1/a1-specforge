#!/usr/bin/env bash
# Fixture suite: a1-kritis-profile — SpecForge folded into a1 as
# `--profile kritis` (spec 006-specforge-kritis-profile).
#
# Harness only (Wave 1, frozen afterwards): isolation, the shared counters,
# and parts/*.sh sourced in sorted order so later waves add a part file
# without editing this one. Each part defines its own case functions and
# calls them, accumulating into the shared pass/fail/results below.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

# Isolation (wave-plan Wave 1, Standard wave contract item 3): never touch
# the real vault or the real ~/.claude. A1_VAULT_ROOT is unset at the top of
# every part too (defence in depth — a part must not rely on this line alone).
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0

# Shared temp helper: guarded, explicit template, one EXIT trap.
# shellcheck source=../lib/tmp.sh
. "$(cd "$HERE/../lib" && pwd)/tmp.sh" || exit 2

pass=0
fail=0
results=()

ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

parts=("$HERE"/parts/*.sh)
if [[ ! -e "${parts[0]}" ]]; then
  echo "FAIL  harness: no parts/*.sh found under $HERE" >&2
  exit 2
fi
for p in "${parts[@]}"; do
  # A syntax error in a part must not drop the whole part silently while the
  # suite still prints "N passed, 0 failed" for it.
  if ! bash -n "$p" 2>"$A1_FX_ROOT/syntax.err"; then
    bad "harness: $(basename "$p") has a bash syntax error: $(head -n 1 "$A1_FX_ROOT/syntax.err")"
    continue
  fi
  # shellcheck disable=SC1090
  source "$p"
done

printf '%s\n' "${results[@]}"
echo "----"
echo "a1-kritis-profile: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
