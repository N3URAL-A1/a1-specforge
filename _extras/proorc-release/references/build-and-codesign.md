# Build & Codesign — Shared Prefix

This is the shared build+codesign sequence used by both `proorc-release` and
`proorc-quick-install`. It covers the 5 steps both skills have in common
(version extraction, icon regeneration, Flutter build, post-build icon
replacement, ad-hoc codesign). Neither `SKILL.md` duplicates this content —
each references this file by relative path and executes the steps in place.

Source of truth: `/Users/rob/code/project_orchestration/scripts/build-dmg.sh`
(authoritative, `set -euo pipefail`).

Working directory for all commands below: repo root
`/Users/rob/code/project_orchestration` unless noted otherwise.

## Step 1 — Version extraction

```bash
VERSION=$(grep 'version:' pro_orc/pubspec.yaml | head -1 | awk '{print $2}' | cut -d'+' -f1)
```

`pro_orc/pubspec.yaml` line format: `version: 3.3.1+16` → `VERSION=3.3.1`.

**Gotcha — semver validation (brittleness):** the grep/awk extraction assumes
a single `version:` line, space-separated, `X.Y.Z+BUILD` format. If the
format ever changes, the extraction fails silently with a malformed string.
Validate before using `VERSION` anywhere downstream:

```bash
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: extracted VERSION '$VERSION' does not match semver X.Y.Z — aborting" >&2
  exit 1
fi
```

Do not proceed to Step 3 (build) with an unvalidated `VERSION`.

## Step 2 — Icon regeneration (BEFORE flutter build)

Must run **before** `flutter build macos --release` so `Assets.car` bakes in
the new icon. Xcode's auto-generated icns from the asset catalog is
low-quality (documented gotcha) — extract from the full-quality source icon
instead.

```bash
ICON_SRC="img/icon.icns"
APPICONSET="pro_orc/macos/Runner/Assets.xcassets/AppIcon.appiconset"

if [ ! -f "$ICON_SRC" ]; then
  echo "ERROR: $ICON_SRC not found — cannot regenerate icons, aborting" >&2
  exit 1
fi

ICONSET_TMP=$(mktemp -d)/icon.iconset
iconutil -c iconset -o "$ICONSET_TMP" "$ICON_SRC"

cp "$ICONSET_TMP/icon_16x16.png"      "$APPICONSET/app_icon_16.png"
cp "$ICONSET_TMP/icon_32x32.png"      "$APPICONSET/app_icon_32.png"
cp "$ICONSET_TMP/icon_32x32@2x.png"   "$APPICONSET/app_icon_64.png"
cp "$ICONSET_TMP/icon_128x128.png"    "$APPICONSET/app_icon_128.png"
cp "$ICONSET_TMP/icon_256x256.png"    "$APPICONSET/app_icon_256.png"
cp "$ICONSET_TMP/icon_512x512.png"    "$APPICONSET/app_icon_512.png"
cp "$ICONSET_TMP/icon_512x512@2x.png" "$APPICONSET/app_icon_1024.png"
```

**Gotcha — icon quality regression risk:** these steps are mandatory, not
optional. Verify all 7 PNGs were written (no silent skip) before continuing —
if the app ships with the Xcode-generated icon, Finder display quality
regresses (a known past issue).

## Step 3 — Flutter build

```bash
cd pro_orc
flutter build macos --release
```

Output: `build/macos/Build/Products/Release/pro_orc.app`. Timing: ~2–4
minutes depending on machine.

**Gotcha — build-lock detection/recovery:** if a previous Flutter build is
still running (another terminal, a crashed session), this hangs or fails with
"database is locked." Check and clear before starting:

```bash
if pgrep -f "flutter build" > /dev/null; then
  echo "Previous flutter build detected — killing before starting a new one."
  pkill -f flutter || true
fi
```

## Step 4 — Post-build icon replacement

Xcode's build-time icns is lower quality than the original source icon; copy
the full-quality one back in for Finder display.

```bash
cp "$ICON_SRC" "build/macos/Build/Products/Release/pro_orc.app/Contents/Resources/AppIcon.icns"
```

(Run from `pro_orc/`, so `$ICON_SRC` here is `../img/icon.icns` relative to
that working directory — adjust the path if not already `cd`'d into
`pro_orc/`.)

## Step 5 — Ad-hoc codesign

```bash
codesign --deep --force -s - "build/macos/Build/Products/Release/pro_orc.app"
```

`-s -` = self-sign (ad-hoc); no Apple Developer certificate required. End
users will see a Gatekeeper quarantine warning on first launch — see the
`xattr -cr` note in each skill's output/verify phase.

---

Both consuming skills pick up from here with their own tail:
`proorc-release` continues into DMG packaging + GitHub release + cask update;
`proorc-quick-install` continues straight into a direct `/Applications` copy.
