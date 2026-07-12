#!/usr/bin/env bash
# Deterministic drift gate: asserts the installed set (bin/install.sh arrays)
# stays in sync with (a) the repo's skills/ and agents/ directories, (b)
# README's skills/agents tables, and (c) README's own scope-note comment
# counts. Exits 1 with a named diff on the first mismatch found; runs all
# four checks and reports every failure before exiting, so a single run
# surfaces the full drift picture rather than stopping at the first hit.
#
# Usage: bin/verify-install-sync.sh [--repo-root <dir>] [--install-sh <path>] [--readme <path>]
# Defaults resolve relative to this script's location, but every input is
# overridable so the fixture suite (_test-fixtures/install-sync/) can point
# this checker at temp-dir copies instead of the live repo tree.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_SH="$REPO_ROOT/bin/install.sh"
README="$REPO_ROOT/README.md"
EXCLUSIONS_FILE="$REPO_ROOT/bin/install-exclusions.txt"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root)
      REPO_ROOT="$2"
      INSTALL_SH="$REPO_ROOT/bin/install.sh"
      README="$REPO_ROOT/README.md"
      EXCLUSIONS_FILE="$REPO_ROOT/bin/install-exclusions.txt"
      shift 2
      ;;
    --install-sh)
      INSTALL_SH="$2"
      shift 2
      ;;
    --readme)
      README="$2"
      shift 2
      ;;
    --exclusions-file)
      EXCLUSIONS_FILE="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

fail=0

diff_named() {
  # $1 = check name, $2 = expected description, $3 = actual description
  echo "DRIFT  $1"
  echo "  expected: $2"
  echo "  actual:   $3"
  fail=1
}

# ---------------------------------------------------------------------------
# Known, currently-correct skills-side exclusion. No file-based mechanism
# exists for this side (per Task 1.3's scope note) — hero-animation-builder
# is simply absent from install.sh's SKILLS array and README's skills table,
# and both already agree. Hardcoding the one known name here is intentional.
# ---------------------------------------------------------------------------
SKILLS_EXCLUDE=("hero-animation-builder")

is_excluded() {
  # $1 = name to test; remaining args = exclusion list (may be empty — guard
  # with ${arr[@]+"${arr[@]}"} at call sites so `set -u` doesn't choke on an
  # empty array under bash 3.2, which treats `${arr[@]}` on a zero-length
  # array as an unbound-variable reference).
  local name="$1"
  shift
  local x
  for x in "$@"; do
    [[ "$name" == "$x" ]] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Parse bin/install-exclusions.txt (agents-side, future-proofing): format is
# `<name>: <reason>` one entry per line; blank lines and lines starting with
# `#` are comments/headers and ignored.
# ---------------------------------------------------------------------------
AGENTS_EXCLUDE=()
if [[ -f "$EXCLUSIONS_FILE" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue
    name="${line%%:*}"
    # trim whitespace
    name="$(echo "$name" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [[ -n "$name" ]] && AGENTS_EXCLUDE+=("$name")
  done < "$EXCLUSIONS_FILE"
fi

# ---------------------------------------------------------------------------
# Check 1 — Skills side: dirs (minus known exclusion) == install.sh SKILLS
# array == README skills table row count.
# ---------------------------------------------------------------------------
skills_dirs=()
if [[ -d "$REPO_ROOT/skills" ]]; then
  while IFS= read -r d; do
    name="$(basename "$d")"
    is_excluded "$name" "${SKILLS_EXCLUDE[@]+"${SKILLS_EXCLUDE[@]}"}" && continue
    skills_dirs+=("$name")
  done < <(find "$REPO_ROOT/skills" -mindepth 1 -maxdepth 1 -type d | sort)
fi
skills_dir_count="${#skills_dirs[@]}"

skills_install_count=0
if [[ -f "$INSTALL_SH" ]]; then
  skills_install_count="$(sed -n '/^SKILLS=(/,/^)/p' "$INSTALL_SH" | grep -c '^\s*"[^"]*"' || true)"
fi

skills_readme_count=0
if [[ -f "$README" ]]; then
  # README skills table: count data rows in the section between "## Skills"
  # and the next "## " heading. Table rows are of the form
  # "| `skill-name` | ... |" — the backtick-quoted first cell distinguishes
  # data rows from the header row ("| Skill | ... |") and the separator row
  # ("|---|---|...").
  skills_readme_count="$(awk '/^## Skills/{flag=1; next} /^## /{flag=0} flag' "$README" | grep -cE '^\| `[a-zA-Z0-9_-]+` \|' || true)"
fi

if [[ "$skills_dir_count" -ne "$skills_install_count" || "$skills_dir_count" -ne "$skills_readme_count" ]]; then
  diff_named "skills-side count mismatch" \
    "dirs=$skills_dir_count install.sh=$skills_install_count readme=$skills_readme_count (all equal)" \
    "dirs=$skills_dir_count install.sh=$skills_install_count readme=$skills_readme_count"
else
  echo "OK     skills-side count: $skills_dir_count"
fi

# ---------------------------------------------------------------------------
# Check 2 — Agents side: agents/*.md (minus exclusions file entries) ==
# install.sh AGENTS array == README agent table row count.
# ---------------------------------------------------------------------------
agents_files=()
if [[ -d "$REPO_ROOT/agents" ]]; then
  while IFS= read -r f; do
    name="$(basename "$f" .md)"
    is_excluded "$name" "${AGENTS_EXCLUDE[@]+"${AGENTS_EXCLUDE[@]}"}" && continue
    agents_files+=("$name")
  done < <(find "$REPO_ROOT/agents" -mindepth 1 -maxdepth 1 -name '*.md' | sort)
fi
agents_dir_count="${#agents_files[@]}"

agents_install_count=0
if [[ -f "$INSTALL_SH" ]]; then
  agents_install_count="$(sed -n '/^AGENTS=(/,/^)/p' "$INSTALL_SH" | grep -c '^\s*"[^"]*"' || true)"
fi

agents_readme_count=0
if [[ -f "$README" ]]; then
  agents_readme_count="$(awk '/^## Agents/{flag=1; next} /^## /{flag=0} flag' "$README" | grep -cE '^\| `[a-zA-Z0-9_-]+` \|' || true)"
fi

if [[ "$agents_dir_count" -ne "$agents_install_count" || "$agents_dir_count" -ne "$agents_readme_count" ]]; then
  diff_named "agents-side count mismatch" \
    "dirs=$agents_dir_count install.sh=$agents_install_count readme=$agents_readme_count (all equal)" \
    "dirs=$agents_dir_count install.sh=$agents_install_count readme=$agents_readme_count"
else
  echo "OK     agents-side count: $agents_dir_count"
fi

echo "Counts — skills: dirs=$skills_dir_count install.sh=$skills_install_count readme=$skills_readme_count | agents: dirs=$agents_dir_count install.sh=$agents_install_count readme=$agents_readme_count"

# ---------------------------------------------------------------------------
# Check 3 — README scope-note comment: parse the "N skills + M agent names"
# claim and assert both numbers match the live counts computed above.
# ---------------------------------------------------------------------------
if [[ -f "$README" ]]; then
  scope_line="$(grep -oE '[0-9]+ skills? \+ [0-9]+ agent' "$README" | head -1 || true)"
  if [[ -z "$scope_line" ]]; then
    diff_named "README scope-note comment not found" \
      "a line matching '<N> skills + <M> agent'" \
      "no match found in $README"
  else
    claimed_skills="$(echo "$scope_line" | grep -oE '^[0-9]+')"
    claimed_agents="$(echo "$scope_line" | grep -oE '[0-9]+ agent' | grep -oE '^[0-9]+')"
    if [[ "$claimed_skills" -ne "$skills_dir_count" || "$claimed_agents" -ne "$agents_dir_count" ]]; then
      diff_named "README scope-note comment count mismatch" \
        "$skills_dir_count skills + $agents_dir_count agent" \
        "$claimed_skills skills + $claimed_agents agent"
    else
      echo "OK     README scope-note comment: $claimed_skills skills + $claimed_agents agent (matches live counts)"
    fi
  fi
fi

if [[ $fail -eq 0 ]]; then
  echo "verify-install-sync: PASS (all checks in sync)"
  exit 0
else
  echo "verify-install-sync: FAIL (drift detected, see DRIFT lines above)" >&2
  exit 1
fi
