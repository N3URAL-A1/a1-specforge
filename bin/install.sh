#!/usr/bin/env bash
# Install a1-specforge: creates symlinks from ~/.claude/skills/ and ~/.claude/agents/ to this repo.
# Run once per machine: ./bin/install.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
AGENTS_DIR="$HOME/.claude/agents"

echo "→ Installing a1-specforge from $REPO_DIR"
echo "→ Skills: $SKILLS_DIR"
echo "→ Agents: $AGENTS_DIR"
echo ""

symlink_item() {
  local src="$1"
  local dst="$2"
  local label="$3"

  if [ -L "$dst" ]; then
    echo "  ✓ $label (symlink already exists, skipping)"
  elif [ -e "$dst" ]; then
    echo "  ! $label exists but is NOT a symlink — backing up to ${dst}.bak"
    mv "$dst" "${dst}.bak"
    ln -s "$src" "$dst"
    echo "  ✓ $label (backed up + symlinked)"
  else
    ln -s "$src" "$dst"
    echo "  ✓ $label (symlinked)"
  fi
}

# Skills to symlink (existing + new)
SKILLS=(
  "a1-new-feature"
  "a1-fix"
  "a1-analyze"
  "a1-check"
  "a1-checklist"
  "a1-constitution"
  "a1-worktree"
  "a1-pr-review"
  "a1-phantom"
  "a1-reconcile"
  "a1-plan"
  "a1-execute"
  "a1-progress"
  "a1-roadmap"
  "a1-evolve"
  "_shared"
)

echo "Skills:"
for skill in "${SKILLS[@]}"; do
  symlink_item "$REPO_DIR/$skill" "$SKILLS_DIR/$skill" "$skill"
done

# Agents to symlink (all agents from this repo)
AGENTS=(
  "a1-researcher"
  "a1-planner"
  "a1-executor"
  "a1-verifier"
  "a1-mapper"
  "a1-auditor"
  "alex-super-architekt"
  "falk-bug-hunter"
  "rene-requirement-engineer"
  "reinhard"
  "walter"
  "aik-senior-ai-engineer"
  "vincente-vibe-optimizer"
  "tobi-the-checker"
  "uwe-ux-expert"
  "ludwig-legal"
)

echo ""
echo "Agents:"
for agent in "${AGENTS[@]}"; do
  symlink_item "$REPO_DIR/agents/${agent}.md" "$AGENTS_DIR/${agent}.md" "$agent"
done

echo ""
echo "Done. Edit skills/agents in $REPO_DIR, changes are live immediately."
