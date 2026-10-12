#!/usr/bin/env bash
# Installs a PINNED gitleaks release for CI (spec 014 FR-011).
#
# Usage: bin/ci-install-gitleaks.sh <version> <sha256> <dest-dir> [--archive <local file>]
#
#   <version>   release number, e.g. 8.30.1 (a leading "v" is accepted)
#   <sha256>    expected sha256 of gitleaks_<version>_linux_x64.tar.gz (64 lowercase hex)
#   <dest-dir>  receives the `gitleaks` binary (created when missing)
#   --archive   use this local file instead of downloading (fixtures; the checksum still applies)
#
# The archive is checked with `sha256sum -c` BEFORE anything is extracted. A mismatch exits 1
# and extracts nothing; a usage error exits 2.

set -u

usage() { echo "usage: $0 <version> <sha256> <dest-dir> [--archive <local file>]" >&2; exit 2; }

[[ $# -ge 3 ]] || usage
VERSION="${1#v}"; EXPECTED="$2"; DEST="$3"; shift 3
ARCHIVE=""
if [[ $# -gt 0 ]]; then
  [[ "$1" == "--archive" && $# -eq 2 ]] || usage
  ARCHIVE="$2"
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ci-install-gitleaks: version must look like 8.30.1 (got: $VERSION)" >&2; exit 2; }
[[ "$EXPECTED" =~ ^[0-9a-f]{64}$ ]] || { echo "ci-install-gitleaks: sha256 must be 64 lowercase hex characters" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ -n "$ARCHIVE" ]]; then
  [[ -f "$ARCHIVE" ]] || { echo "ci-install-gitleaks: archive not found: $ARCHIVE" >&2; exit 2; }
  cp "$ARCHIVE" "$WORK/gitleaks.tar.gz"
else
  URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz"
  curl -fsSL --retry 3 -o "$WORK/gitleaks.tar.gz" "$URL" || { echo "ci-install-gitleaks: download failed: $URL" >&2; exit 1; }
fi

if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$WORK" && printf '%s  gitleaks.tar.gz\n' "$EXPECTED" | sha256sum -c - >/dev/null 2>&1 ); ok=$?
else
  ( cd "$WORK" && printf '%s  gitleaks.tar.gz\n' "$EXPECTED" | shasum -a 256 -c - >/dev/null 2>&1 ); ok=$?
fi
if [[ $ok -ne 0 ]]; then
  echo "ci-install-gitleaks: checksum mismatch for gitleaks ${VERSION} (expected ${EXPECTED}); nothing extracted" >&2
  exit 1
fi

mkdir -p "$DEST"
tar -xzf "$WORK/gitleaks.tar.gz" -C "$DEST" gitleaks || { echo "ci-install-gitleaks: no gitleaks binary in the archive" >&2; exit 1; }
chmod +x "$DEST/gitleaks"
echo "ci-install-gitleaks: gitleaks ${VERSION} installed to ${DEST}"
