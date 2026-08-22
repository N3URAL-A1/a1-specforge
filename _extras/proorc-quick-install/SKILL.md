---
name: proorc-quick-install
description: Deploys Pro Orc to /Applications without the full release cycle — Flutter build, codesign, direct app copy. Triggers on "quick install pro orc", "local install pro orc", "dev build pro orc", "install pro orc locally".
---

# Pro Orc Quick Install

Deploys a local build of Pro Orc straight to `/Applications` for fast
iteration — no DMG, no GitHub release, no Homebrew cask update, no git tag.
Runs in four phases.

**Scope boundary (explicit):** this skill never tags, never pushes, never
touches the Homebrew tap. It shares the build+codesign prefix with
`proorc-release` but stops after the local `/Applications` copy. For a
tagged, distributable release, use `proorc-release` instead.

User-facing output language: see `_shared/language-policy.md` (artifacts
English, conversation in the user's language).

Working directory for all commands below: repo root
`/Users/rob/code/project_orchestration` unless noted otherwise.

## Phase 1 — Pre-flight

**Build-lock gotcha:** check for a still-running Flutter build before
starting — a concurrent build causes the new one to hang or fail with
"database is locked."

```bash
if pgrep -f "flutter build" > /dev/null; then
  echo "Previous flutter build detected — killing before starting a new one."
  pkill -f flutter || true
fi
```

## Phase 2 — Build & sign

Read and execute
`../proorc-release/references/build-and-codesign.md` (relative path — the
same shared content `proorc-release` uses, not duplicated here): version
extraction with semver validation, icon regeneration, `flutter build macos
--release`, post-build icon replacement, ad-hoc codesign.

## Phase 3 — Install

Direct copy to `/Applications`, replacing whatever version is currently
installed there — no versioning, no DMG, no installer:

```bash
cp -r pro_orc/build/macos/Build/Products/Release/pro_orc.app /Applications/pro_orc.app
```

## Phase 4 — Verify

1. Open the app to confirm the install worked:
   ```bash
   open /Applications/pro_orc.app
   ```
2. **Gatekeeper quarantine gotcha:** if launch is blocked by a quarantine
   warning (expected for ad-hoc-signed builds on first launch after a fresh
   copy), clear it:
   ```bash
   xattr -cr /Applications/pro_orc.app
   ```

No tag, no GitHub release, no cask update happen anywhere in this skill.

## Retro

Per `_shared/retro-template.md`. Skill name: `proorc-quick-install`.

- **Task wording template:** "Ran proorc-quick-install — \<pass/fail/partial\>."
- **Issue-tag vocabulary:** `build-lock`, `gatekeeper-quarantine`, `icon-regen-skipped`.
- **`gates_fired`:** typically empty — this skill has no registered blocking
  gates (no tag confirmation, no auth check). Omit the field if no gate ran.
- **Write target:**
  ```bash
  VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
  # append to: $VAULT/pattern/a1-learnings/proorc-quick-install.md
  ```
  Optionally mirror to `~/.claude/skills/proorc-quick-install/_learning.md`
  if that path is a writable symlink checkout.
