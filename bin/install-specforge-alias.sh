#!/usr/bin/env bash
# Owner-run installer for the retired SpecForge skill's alias (spec
# 006-specforge-kritis-profile, FR-007). Archives the real
# ~/.claude/skills/specforge/ directory OUTSIDE ~/.claude/skills/ (never as
# an in-place `.bak`, which bin/install.sh's symlink_item does and which
# would leave the retired skill still inside the skills tree, still loadable,
# still competing for its old triggers) and symlinks this repo's
# _extras/specforge-alias/ in its place.
#
# Usage: bin/install-specforge-alias.sh [--apply] [--expect-sha <sha256>]
#   (no --apply)  dry run: prints the planned moves, writes nothing.
#   --apply       performs the archive + symlink. A second --apply run is a
#                 no-op (exit 0, nothing changed) once the alias is in place.
#   --expect-sha  overrides the sha256 this installer requires the CURRENT
#                 ~/.claude/skills/specforge/SKILL.md to match before it will
#                 touch anything. Default: the hash recorded in
#                 _shared/profiles/kritis/MIGRATION.md (the one measured and
#                 pinned at Wave 1 time).
#
# Exit codes (house contract): 0 done (incl. no-op) / 1 refusal (archive
# target exists, sha mismatch, hostile symlink, usage) — the reason is always
# named / 2 internal error (HOME unusable, unexpected filesystem state).
#
# This script NEVER runs against the real HOME inside this repo's test
# suite — every fixture case in parts/07-alias.sh sets HOME=$WORK/home.

set -euo pipefail

DEFAULT_SHA="32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ALIAS_SRC="$REPO_DIR/_extras/specforge-alias"

APPLY=0
EXPECT_SHA="$DEFAULT_SHA"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --expect-sha)
      if [[ $# -lt 2 || -z "${2:-}" || "${2:-}" == --* ]]; then
        echo "install-specforge-alias: --expect-sha needs a sha256 value (usage: --expect-sha <sha256>)" >&2
        exit 1
      fi
      EXPECT_SHA="$2"; shift 2 ;;
    *) echo "install-specforge-alias: unknown argument: $1" >&2; exit 1 ;;
  esac
done

# Guard: HOME must be a non-empty, existing directory. An installer that
# wrote under an empty or unresolved HOME would be a path-traversal-shaped
# footgun, not a refusal with a name.
if [[ -z "${HOME:-}" ]]; then
  echo "install-specforge-alias: HOME is unset or empty — refusing" >&2
  exit 1
fi
if [[ ! -d "$HOME" ]]; then
  echo "install-specforge-alias: HOME ($HOME) is not a directory — refusing" >&2
  exit 1
fi

SKILLS_DIR="$HOME/.claude/skills"
ARCHIVE_DIR="$HOME/.claude/skills-archive"
OLD_SKILL="$SKILLS_DIR/specforge"

echo "install-specforge-alias: alias source: $ALIAS_SRC"
echo "install-specforge-alias: target symlink: $OLD_SKILL"
echo "install-specforge-alias: archive dir: $ARCHIVE_DIR"

if [[ ! -e "$ALIAS_SRC/SKILL.md" ]]; then
  echo "install-specforge-alias: alias source $ALIAS_SRC/SKILL.md does not exist — refusing" >&2
  exit 1
fi

# Case 1: the symlink is already in place and already points at our alias —
# no-op, regardless of --apply.
if [[ -L "$OLD_SKILL" ]]; then
  current_target="$(readlink "$OLD_SKILL")"
  resolved_target="$(cd "$(dirname "$OLD_SKILL")" && cd "$(dirname "$current_target")" 2>/dev/null && pwd -P)/$(basename "$current_target")" || resolved_target=""
  if [[ "$current_target" == "$ALIAS_SRC" ]] || [[ "$resolved_target" == "$ALIAS_SRC" ]]; then
    echo "install-specforge-alias: $OLD_SKILL already symlinks to the alias — no-op"
    exit 0
  fi
  echo "install-specforge-alias: $OLD_SKILL is a symlink to something other than the alias ($current_target) — refusing" >&2
  exit 1
fi

# Case 2: nothing to archive and nothing to install — a fresh machine with
# no SpecForge skill at all. Treat as a no-op (no real directory means there
# is nothing this installer needs to protect or move).
if [[ ! -e "$OLD_SKILL" ]]; then
  echo "install-specforge-alias: $OLD_SKILL does not exist — nothing to archive"
  if [[ "$APPLY" -eq 1 ]]; then
    mkdir -p "$SKILLS_DIR"
    ln -s "$ALIAS_SRC" "$OLD_SKILL"
    echo "install-specforge-alias: symlinked $OLD_SKILL -> $ALIAS_SRC"
  else
    echo "install-specforge-alias: DRY RUN — would symlink $OLD_SKILL -> $ALIAS_SRC"
  fi
  exit 0
fi

# Case 3: a real directory is present. It must be a plain directory (not a
# symlink — handled above) before this installer archives it.
if [[ ! -d "$OLD_SKILL" ]]; then
  echo "install-specforge-alias: $OLD_SKILL exists but is neither a directory nor a symlink — refusing" >&2
  exit 1
fi

if [[ ! -f "$OLD_SKILL/SKILL.md" ]]; then
  echo "install-specforge-alias: $OLD_SKILL/SKILL.md does not exist — refusing (nothing safe to verify)" >&2
  exit 1
fi

actual_sha="$(sha256sum "$OLD_SKILL/SKILL.md" | cut -d' ' -f1)"
if [[ "$actual_sha" != "$EXPECT_SHA" ]]; then
  echo "install-specforge-alias: sha256 mismatch for $OLD_SKILL/SKILL.md — refusing" >&2
  echo "  expected: $EXPECT_SHA" >&2
  echo "  actual:   $actual_sha" >&2
  exit 1
fi

# BEGIN archive-inside-skills guard
# The archive must live OUTSIDE the skills tree, or the retired skill is still
# discoverable. A symlinked skills-archive can quietly point back into skills/,
# so refuse a symlink outright and compare real paths for everything else.
if [[ -L "$ARCHIVE_DIR" ]]; then
  echo "install-specforge-alias: archive dir $ARCHIVE_DIR is a symlink — refusing (it could point back into $SKILLS_DIR)" >&2
  exit 1
fi
skills_real="$(cd "$SKILLS_DIR" && pwd -P)"
archive_parent_real="$(cd "$(dirname "$ARCHIVE_DIR")" 2>/dev/null && pwd -P)" || archive_parent_real=""
if [[ -z "$archive_parent_real" ]]; then
  echo "install-specforge-alias: parent of archive dir $ARCHIVE_DIR is not a directory — refusing" >&2
  exit 1
fi
archive_real="$archive_parent_real/$(basename "$ARCHIVE_DIR")"
if [[ "$archive_real" == "$skills_real" || "$archive_real" == "$skills_real"/* ]]; then
  echo "install-specforge-alias: archive dir $ARCHIVE_DIR resolves inside $SKILLS_DIR ($archive_real) — refusing" >&2
  exit 1
fi
# END archive-inside-skills guard

today="$(date -u +%Y-%m-%d)"
ARCHIVE_TARGET="$ARCHIVE_DIR/specforge-$today"

if [[ -e "$ARCHIVE_TARGET" ]]; then
  echo "install-specforge-alias: archive target already exists: $ARCHIVE_TARGET — refusing" >&2
  exit 1
fi

if [[ "$APPLY" -eq 0 ]]; then
  echo "install-specforge-alias: DRY RUN — would move $OLD_SKILL -> $ARCHIVE_TARGET"
  echo "install-specforge-alias: DRY RUN — would symlink $OLD_SKILL -> $ALIAS_SRC"
  exit 0
fi

mkdir -p "$ARCHIVE_DIR"
mv "$OLD_SKILL" "$ARCHIVE_TARGET"
ln -s "$ALIAS_SRC" "$OLD_SKILL"
echo "install-specforge-alias: archived $ARCHIVE_TARGET (sha256 $actual_sha verified)"
echo "install-specforge-alias: symlinked $OLD_SKILL -> $ALIAS_SRC"
