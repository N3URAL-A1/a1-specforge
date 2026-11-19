#!/usr/bin/env bash
# FR-012 guard (spec 027 slice 3): no assertion line may be deleted or edited in the two suite directories.
# Usage: bin/check-assert-deletions.sh --base <ref> [dir...]
#   exit 0  no deleted lines (an edited line counts as one deletion)
#   exit 1  deletions found (prints deleted=<n> and one "<file> <n>" line per file)
#   exit 2  usage error or unknown ref
set -u

usage() { echo "usage: check-assert-deletions.sh --base <ref> [dir...]" >&2; exit 2; }

BASE=""
if [ "${1:-}" = "--base" ]; then
  [ $# -ge 2 ] || usage
  BASE="$2"; shift 2
else
  usage
fi
if [ $# -eq 0 ]; then
  # default dirs are repo-relative: resolve them from the top level, whatever the caller's cwd (a subdirectory gave deleted=0 for nothing)
  TOP="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -n "$TOP" ] && cd "$TOP" || usage
  set -- _test-fixtures/a1-pr-merge-check _test-fixtures/a1-verify
fi

git rev-parse --verify "${BASE}^{commit}" >/dev/null 2>&1 || usage

OUT="$(git diff --numstat "${BASE}...HEAD" -- "$@")" || exit 2
printf '%s\n' "$OUT" | awk -F'\t' '
  NF >= 3 { n = ($2 == "-") ? 1 : $2 + 0; total += n; if (n > 0) per[++k] = $3 " " n }
  END { print "deleted=" total + 0; for (i = 1; i <= k; i++) print per[i]; exit (total > 0) }
'
