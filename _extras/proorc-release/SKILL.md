---
name: proorc-release
description: Automates Pro Orc macOS release pipeline — tag verification, version extraction, Flutter build, DMG packaging, GitHub release, and Homebrew cask update. Triggers on "release pro orc" (alias "Pro Orc Release"), "publish pro orc", "new pro orc version", "cut a pro orc release".
---

# Pro Orc Release

Automates the full Pro Orc macOS release pipeline: build, sign, package,
publish, and update the Homebrew cask. Runs in five phases — never skip
Phase 1's pre-flight checks, and never tag without the milestone confirmation.

User-facing output language: see `_shared/language-policy.md` (artifacts
English, conversation in the user's language).

Working directory for all commands below: repo root
`/Users/rob/code/project_orchestration` unless noted otherwise.

## Phase 1 — Pre-flight checks

Run all four checks before touching the build. Stop and report if any fails.

1. **`create-dmg` availability:**
   ```bash
   which create-dmg || echo "MISSING — run: brew install create-dmg"
   ```
   If missing, prompt the user to `brew install create-dmg` and stop until
   resolved.

2. **GitHub auth account match (replaces any `delete_repo`-scope check —
   that check belongs to ProOrc's unrelated in-app repo-deletion feature,
   not this skill):**
   ```bash
   gh auth status
   ```
   Capture the active account from the output and compare it against the
   repo owner, `n3urala1-rob`. If the active account does not match:
   - Instruct: `gh auth switch -u n3urala1-rob` (if that account is already
     logged in locally) or `gh auth login` (if not).
   - Do not proceed to Phase 3 until `gh auth status` shows `n3urala1-rob`
     as active — a mismatched account causes `gh release create` and the
     later cask push to fail or hang awaiting credential resolution.

3. **Release workflow permissions:**
   ```bash
   grep -n "permissions:" .github/workflows/release.yml
   ```
   Confirm `contents: write` is present. If absent, warn explicitly: without
   this permission, `gh release create` inside the CI workflow runs but the
   publish step **silently fails** — no error, just no release. This is a
   documented past bug source; do not proceed with the CI path without it
   (the local-build path in Phase 2–3 is unaffected, since it uses the
   user's own `gh auth`, not the workflow's token).

4. **Tag-milestone confirmation (mandatory gate, `tag-milestone-confirmation`):**

   Ask the user: *"This will tag v\<VERSION\>. Confirm this is a milestone
   release (not a micro-fix)."*

   - If confirmed → continue to Phase 2.
   - If declined → stop here and direct the user to `proorc-quick-install`
     instead for a local, untagged build. Do not proceed with tagging or
     any release step.

   Policy source: CLAUDE.md convention — "only tag a formal release for
   bundled milestones, not every fix."

## Phase 2 — Build

Read and execute `references/build-and-codesign.md` in full (version
extraction with semver validation, icon regeneration, `flutter build macos
--release` with build-lock detection, post-build icon replacement, ad-hoc
codesign). Do not duplicate those steps here — that file is the single
source for this sequence, shared with `proorc-quick-install`.

## Phase 3 — Package & release

1. **Create the DMG** with the exact flags from `build-dmg.sh` (authoritative
   source — do not deviate from this geometry):
   ```bash
   mkdir -p dist
   VERSION="<from Phase 2>"
   DMG_NAME="ProOrc-${VERSION}-macOS.dmg"
   rm -f "dist/$DMG_NAME"

   create-dmg \
     --volname "Pro Orc" \
     --volicon "img/icon.icns" \
     --window-pos 200 120 \
     --window-size 600 400 \
     --icon-size 100 \
     --icon "pro_orc.app" 175 190 \
     --app-drop-link 425 190 \
     --hide-extension "pro_orc.app" \
     "dist/$DMG_NAME" \
     "pro_orc/build/macos/Build/Products/Release/pro_orc.app"
   ```

2. **Create the GitHub release:**
   ```bash
   gh release create "v${VERSION}" "dist/${DMG_NAME}" \
     --title "Pro Orc v${VERSION}" \
     --generate-notes
   ```

3. **CI-503 fallback branch (explicit):** if a prior GitHub Actions run for
   this tag failed with "Failed to resolve action download info / Service
   Unavailable" at the "Set up job" step, this is a **transient GitHub 503**
   during Action download — not a repo/code issue. Do not retry the workflow.
   Instead, run this same local Phase 2–3 path to completion (build →
   codesign → create-dmg → `gh release create`) and finish the release
   manually. Detect this by checking recent workflow run logs
   (`gh run list --workflow=release.yml --limit=3`) if the user reports a
   stuck/failed Action before invoking this skill.

## Phase 4 — Cask update

Hardcoded constant — never accept this as a variable input:

```bash
TAP_REPO="n3urala1-rob/homebrew-tap"
```

**Guard (mandatory, do not skip):** before any push in this phase, check
the target remote URL. If it contains `mellow-rob` anywhere, fail
immediately with an explicit error and do not push:

```bash
if [[ "$PUSH_URL" == *"mellow-rob"* ]]; then
  echo "ERROR: cask push URL references the obsolete mellow-rob/tap — refusing to push. Use n3urala1-rob/homebrew-tap." >&2
  exit 1
fi
```

Steps:

1. Download the DMG from the GitHub release just created (or reuse the local
   `dist/${DMG_NAME}` built in Phase 3 — same bytes).
2. Calculate the checksum: `shasum -a 256 "dist/${DMG_NAME}"`.
3. Edit `Casks/pro-orc.rb` in a local checkout of `$TAP_REPO`: bump the
   version string and replace the `sha256` value.
4. Commit and push to `$TAP_REPO`. If `gh auth status`'s active account does
   not match `n3urala1-rob` (re-check — Phase 1's check may be stale by this
   point in a long-running session), push manually with a token:
   ```bash
   git push "https://x-access-token:$(gh auth token)@github.com/${TAP_REPO}.git" <branch>
   ```
5. **Immediately after any token-based push**, reset the git remote config
   to avoid storing the token in plaintext:
   ```bash
   git config branch.<name>.remote origin
   ```
   (or whatever the original remote name was before the token URL was used).

Note: Homebrew tap propagation lag (1–2 hours before `brew install` picks up
the new version) is normal — do not treat it as a failure.

## Phase 5 — Output

Release notes (or a message to the user, if `--generate-notes` output is
insufficient) must mention the Gatekeeper quarantine step for end users:

```bash
xattr -cr /Applications/pro_orc.app
```

Ad-hoc signing means every fresh download triggers this quarantine warning on
first launch — this is expected, not a bug, and must be surfaced to whoever
installs the DMG.

## Retro

Per `_shared/retro-template.md`. Skill name: `proorc-release`.

- **Task wording template:** "Ran proorc-release for v\<VERSION\> — \<pass/fail/partial\> at Phase \<N\>."
- **Issue-tag vocabulary:** `ci-503`, `auth-mismatch`, `permissions-missing`, `cask-lag`, `build-lock`, `icon-regen-skipped`.
- **`gates_fired`:** include one entry for `tag-milestone-confirmation` on every run that reached Phase 1 step 4 (verdict `pass` if confirmed and release proceeded, `fail` if declined and the run stopped there). Include `pre-flight-github-scope` and `version-consistency-gate` entries if those checks ran (see `_shared/gates-registry.md`).
- **Write target:**
  ```bash
  VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
  # append to: $VAULT/pattern/a1-learnings/proorc-release.md
  ```
  Optionally mirror to `~/.claude/skills/proorc-release/_learning.md` if that
  path is a writable symlink checkout.
