#!/usr/bin/env bash
# Fixture runner for `a1-tools phantom check`.
#
# Nested-repo bootstrap (deterministic, idempotent):
#   `git clone` NEVER transports nested `.git/` dirs — they are stripped and
#   gitlinks clone empty. So this runner never relies on any committed `.git/`
#   state. On every run it rebuilds each fixture's git history from the
#   committed file trees:
#     commit 1 = baseline (.baseline/ : plan + stub src `module.exports = {}`)
#     commit 2 = final impl (the real src that is tracked in the main tree)
#   `phantom check` diffs commit1..HEAD, so the implementation that landed in
#   commit 2 is exactly what the keyword matcher sees.
#
# The bootstrap runs unconditionally: missing-content is detected via FILE
# PRESENCE (test -f PLAN.md), never via `git rev-parse` — a failed rev-parse is
# the EXPECTED fresh-clone state, not an error. There is no "fail and list what
# to restore" branch.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
FIX="$REPO_ROOT/_test-fixtures/a1-phantom"

DIRS=(clean phantoms no-code-tag)

bootstrap() {
  local dir="$1"
  # Content must be present in the working tree (carried by the main repo).
  if [[ ! -f "$dir/PLAN.md" ]]; then
    echo "MISSING CONTENT: $dir/PLAN.md not found — fixture content not carried by clone" >&2
    return 2
  fi
  # Rebuild history whenever the fixture has no OWN git repo. We must test the
  # nested `.git` directly: `git -C "$dir" log -1` would walk UP to the parent
  # repo and falsely succeed. A fresh `git clone` strips nested `.git/`, so its
  # absence is exactly the fresh-clone state the bootstrap exists to repair. We
  # also treat a `.git` that is not this dir's own toplevel as absent.
  local own_top
  own_top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ ! -d "$dir/.git" || "$own_top" != "$(cd "$dir" && pwd)" ]]; then
    rm -rf "$dir/.git"
    git -C "$dir" init -q
    # commit 1: baseline (stubs) — copy .baseline/ over the real files.
    local saved
    saved="$(mktemp -d)"
    cp -R "$dir/PLAN.md" "$dir/src" "$saved/" 2>/dev/null || true
    cp -R "$dir/.baseline/." "$dir/"
    git -C "$dir" add -A
    git -C "$dir" -c user.email=ci@test -c user.name=ci commit -qm 'init: plan and stubs'
    # restore final impl and commit 2.
    rm -rf "$dir/PLAN.md" "$dir/src"
    cp -R "$saved/." "$dir/"
    rm -rf "$saved"
    git -C "$dir" add -A
    git -C "$dir" -c user.email=ci@test -c user.name=ci commit -qm 'feat: implement plan tasks'
  fi
  return 0
}

# phantom check never exits non-zero (warning-level), so we assert on the JSON.
jget() { printf '%s' "$1" | grep -m1 "\"$2\"" | sed -E "s/.*\"$2\": *([0-9]+|\"[^\"]*\").*/\1/" | tr -d '"'; }

pass=0
fail=0
results=()

check_case() {
  local dir="$1" want_status="$2" want_phantoms="$3" want_skipped="$4"
  local out
  out="$(cd "$FIX" && node "$TOOLS" phantom check "$dir/PLAN.md" --repo-path "$dir" --format json 2>&1)"
  local status phantoms skipped
  status="$(jget "$out" status)"
  # count array entries by counting "reason"/"task" markers robustly
  phantoms="$(printf '%s' "$out" | grep -c '"reason"')"
  skipped="$(printf '%s' "$out" | grep -c '"line"')"
  # skipped counts docs_only entries; each has a "line" — but phantoms also have
  # "line". Derive skipped = total "line" minus phantom "line" occurrences.
  skipped=$(( skipped - phantoms ))

  if [[ "$status" == "$want_status" && "$phantoms" == "$want_phantoms" && "$skipped" == "$want_skipped" ]]; then
    results+=("PASS  $dir (status=$status phantoms=$phantoms skipped=$skipped)")
    pass=$((pass + 1))
  else
    results+=("FAIL  $dir want[status=$want_status phantoms=$want_phantoms skipped=$want_skipped] got[status=$status phantoms=$phantoms skipped=$skipped]")
    while IFS= read -r line; do results+=("        $line"); done <<< "$out"
    fail=$((fail + 1))
  fi
}

# Operate from the fixture root so relative $dir paths resolve regardless of
# the caller's cwd (the runner may be invoked from anywhere, incl. a clone).
cd "$FIX"

for d in "${DIRS[@]}"; do
  bootstrap "$d" || { echo "bootstrap failed for $d" >&2; exit 1; }
done

# Expectations (a1-phantom/SKILL.md check semantics):
#   clean/       — every completed code task has a diff match → clean, 0 phantoms.
#   phantoms/    — slack.js untouched + bullmq has no file → 2 phantoms.
#   no-code-tag/ — 2 tasks carry `# no-code` → SKIPPED (docs_only); the one code
#                  task (LAUNCH_FLAG) is implemented → clean, 0 phantoms, 2 skipped.
#                  (phantom check never exits non-zero; the `# no-code` tag WORKING
#                  is the assertion here, not a non-zero exit.)
check_case clean        clean           0 0
check_case phantoms     phantoms_found  2 0
check_case no-code-tag  clean           0 2

printf '\n--- a1-phantom fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\nTotal: %d passed, %d failed\n' "$pass" "$fail"

if [[ "$fail" -gt 0 ]]; then exit 1; fi
exit 0
