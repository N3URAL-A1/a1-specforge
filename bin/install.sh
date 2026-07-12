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

# Ensure target dirs exist (fresh machine: ~/.claude may not exist yet)
mkdir -p "$SKILLS_DIR" "$AGENTS_DIR"

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
  "a1-modernize"
  "a1-new-project"
)

echo "Skills:"
for skill in "${SKILLS[@]}"; do
  symlink_item "$REPO_DIR/skills/$skill" "$SKILLS_DIR/$skill" "$skill"
done

# _shared is a helper dir, not a skill — lives at repo root
symlink_item "$REPO_DIR/_shared" "$SKILLS_DIR/_shared" "_shared"

# Agents to symlink (all agents from this repo). Deliberate exclusions (none
# today) are documented in bin/install-exclusions.txt, not here.
AGENTS=(
  "a1-rico-researcher"
  "a1-pablo-planner"
  "a1-erik-executor"
  "a1-victor-verifier"
  "a1-marco-mapper"
  "a1-adam-auditor"
  "a1-alex-architekt"
  "a1-falk-fault-finder"
  "a1-rene-requirement-engineer"
  "a1-reinhard-reviewer"
  "a1-walter-web-developer"
  "a1-aik-ai-engineer"
  "a1-vincente-vibe-optimizer"
  "a1-tobi-tester"
  "a1-uwe-ux-expert"
  "a1-ludwig-legal"
  "a1-rafael-reverse-spec"
  "a1-theo-test-engineer"
  "a1-samuel-security"
  "a1-diana-docs"
  "a1-dario-devops"
)

echo ""
echo "Agents:"
for agent in "${AGENTS[@]}"; do
  symlink_item "$REPO_DIR/agents/${agent}.md" "$AGENTS_DIR/${agent}.md" "$agent"
done

echo ""
echo "Done. Edit skills/agents in $REPO_DIR, changes are live immediately."
