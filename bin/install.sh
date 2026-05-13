#!/usr/bin/env bash
# Install a1-skills: creates symlinks from ~/.claude/skills/ to this repo.
# Run once per machine: ./bin/install.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$HOME/.claude/skills"

echo "→ Installing a1-skills from $REPO_DIR"
echo "→ Target: $SKILLS_DIR"
echo ""

# Skills to symlink
SKILLS=("a1-new-feature" "a1-fix" "a1-analyze" "a1-check" "a1-checklist" "a1-constitution" "a1-worktree" "a1-pr-review" "a1-phantom" "a1-reconcile" "_shared")

for skill in "${SKILLS[@]}"; do
  src="$REPO_DIR/$skill"
  dst="$SKILLS_DIR/$skill"

  if [ -L "$dst" ]; then
    echo "  ✓ $skill (symlink already exists, skipping)"
  elif [ -e "$dst" ]; then
    echo "  ! $skill exists but is NOT a symlink — backing up to ${dst}.bak"
    mv "$dst" "${dst}.bak"
    ln -s "$src" "$dst"
    echo "  ✓ $skill (backed up + symlinked)"
  else
    ln -s "$src" "$dst"
    echo "  ✓ $skill (symlinked)"
  fi
done

echo ""
echo "Done. Edit skills in $REPO_DIR, changes are live immediately."
