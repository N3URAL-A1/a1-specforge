#!/usr/bin/env bash
# Fixture suite: a1-ux-studio (spec 024-ux-studio).
#
# Harness only: isolation, the shared counters, and parts/*.sh sourced in
# sorted order so later waves add a part file without editing this one.
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

# Shared bounded-run helper: portable replacement for the GNU `timeout`
# command, which stock macOS does not have (fix gnu-only-fixture-idioms).
# shellcheck source=../lib/bounded.sh
. "$(cd "$HERE/../lib" && pwd)/bounded.sh" || exit 2

# Temp HOME: no case may read or write the real ~/.claude.
mk_workdir FX_HOME ux-home
export HOME="$FX_HOME"

# Gate-store seam (spec 024 PR review): the store lives under the passwd home, no environment variable can redirect it in production.
# The gate parts therefore run the gate from a tree COPY whose owner-home module is swapped for fake/xprov-owner-home.cjs
# (same seam as the a1-xprov suite). UX_GATE is the copy's ux-gate.cjs; the real tree is never written by a gate case.
mk_workdir UX_TREE ux-tree
mkdir -p "$UX_TREE/skills" "$UX_TREE/_shared"
cp -R "$REPO_ROOT/skills/a1-ux-studio" "$UX_TREE/skills/a1-ux-studio"
cp -R "$REPO_ROOT/_shared/lib" "$UX_TREE/_shared/lib"
cp "$HERE/fake/xprov-owner-home.cjs" "$UX_TREE/_shared/lib/xprov-owner-home.cjs"
UX_GATE="$UX_TREE/skills/a1-ux-studio/scripts/gate/ux-gate.cjs"
UX_STORE_DIR="$FX_HOME/.a1-ux-studio"

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
echo "a1-ux-studio: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
