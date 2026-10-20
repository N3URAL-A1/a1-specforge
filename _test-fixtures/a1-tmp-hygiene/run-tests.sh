#!/usr/bin/env bash
# Fixture: fixture suites leave no temp dirs behind (bug suite-tmpdir-leak, 2026-10-20).
#
# Static half (no bare mktemp) lives in a1-vault-fallback case L2. This is the runtime half:
# run real fast suites with TMPDIR pointing at a fresh private directory and assert it is
# empty afterwards. Plus helper cases for _test-fixtures/lib/tmp.sh (failure exit, read-only
# dirs, subshell registration, guard on a failed mktemp).
#
# Red-making change: removing the cleanup of one suite, e.g. replacing the `mk_workdir WORK`
# line in a1-reservations/run-tests.sh with a bare-template `WORK="$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX")"`,
# leaves a directory in the private TMPDIR: H4 (a1-reservations) goes red. Measured 2026-10-20.
set -u

SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FX_DIR="$(cd "$SUITE_DIR/.." && pwd)"
pass=0
fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; shift; for l in "$@"; do echo "      $l"; done; fail=$((fail + 1)); }

# The private parent for everything this suite creates: explicit template (BSD ignores $TMPDIR otherwise).
PARENT="$(mktemp -d "${TMPDIR:-/tmp}/a1-tmp-hygiene.XXXXXX")" || exit 2
[[ -n "$PARENT" && -d "$PARENT" ]] || exit 2
PARENT="$(cd "$PARENT" && pwd -P)" || exit 2
case "$PARENT" in */a1-tmp-hygiene.*) ;; *) echo "FAIL  harness: odd parent $PARENT" >&2; exit 2 ;; esac
cleanup_parent() { chmod -R u+w "$PARENT" 2>/dev/null; rm -rf "$PARENT"; }
trap cleanup_parent EXIT

# fresh_tmp <name> — a new empty private TMPDIR under $PARENT.
fresh_tmp() { local d="$PARENT/$1"; mkdir -p "$d" && printf '%s' "$d"; }

# ---------- H1..H3: helper behaviour ----------
t="$(fresh_tmp h1)"
out="$(TMPDIR="$t" bash -c '. "$1/lib/tmp.sh" || exit 2; mk_workdir W a; mk_workdir V b; mk_tmpfile F c; echo "$W" "$V" "$F" >/dev/null; exit 3' _ "$FX_DIR" 2>&1)"; rc=$?
left="$(ls -A "$t")"
if [[ $rc -eq 3 && -z "$left" ]]; then ok "H1 failing script (exit 3) leaves its TMPDIR empty"
else bad "H1 failing script left entries or lost its exit code (rc=$rc)" "left: [$left]" "out: [$out]"; fi

t="$(fresh_tmp h2)"
TMPDIR="$t" bash -c '. "$1/lib/tmp.sh" || exit 2; mk_workdir W a; mkdir -p "$W/ro/sub"; touch "$W/ro/sub/f"; chmod 555 "$W/ro/sub" "$W/ro"' _ "$FX_DIR" >/dev/null 2>&1
left="$(ls -A "$t")"
if [[ -z "$left" ]]; then ok "H2 read-only subtree is removed (chmod before rm)"
else bad "H2 read-only subtree survived" "left: [$left]"; chmod -R u+w "$t" 2>/dev/null; fi

t="$(fresh_tmp h3)"
res="$(TMPDIR="$t" bash -c '. "$1/lib/tmp.sh" || exit 2; f() { mk_workdir IN sub; echo made; }; x="$(f)"; echo "$A1_FX_ROOT"' _ "$FX_DIR" 2>&1)"
left="$(ls -A "$t")"
if [[ -z "$left" && -n "$res" ]]; then ok "H3 dirs made inside a \$(...) subshell are still removed"
else bad "H3 subshell-made dir survived" "left: [$left]" "res: [$res]"; fi

# H3b: dir is under the TMPDIR template, not the BSD per-user dir (the macOS class).
t="$(fresh_tmp h3b)"
res="$(TMPDIR="$t" bash -c '. "$1/lib/tmp.sh" || exit 2; mk_workdir W a; echo "$W"' _ "$FX_DIR" 2>&1)"
t_real="$(cd "$t" && pwd -P)"
if [[ "$res" == "$t_real"/a1-fx-root.*/a.* ]]; then ok "H3b workdir lives under \$TMPDIR/a1-fx-root.*/ (not the BSD user temp dir)"
else bad "H3b workdir not under TMPDIR" "res: [$res]" "want prefix: [$t_real/a1-fx-root.]"; fi

# H3c: a suite with its own EXIT trap that calls a1_fx_cleanup keeps both behaviours.
t="$(fresh_tmp h3c)"
res="$(TMPDIR="$t" bash -c 'trap "echo own-trap-ran; a1_fx_cleanup" EXIT; . "$1/lib/tmp.sh" || exit 2; mk_workdir W a' _ "$FX_DIR" 2>&1)"
left="$(ls -A "$t")"
if [[ "$res" == *own-trap-ran* ]]; then ok "H3c the helper does not clobber an existing EXIT trap"
else bad "H3c existing EXIT trap was replaced" "res: [$res]"; fi
[[ -z "$left" ]] && ok "H3d existing trap + a1_fx_cleanup leaves TMPDIR empty" || bad "H3d dirs left after own trap" "left: [$left]"

# H3e: guard — an unusable TMPDIR aborts the suite (exit 2) instead of continuing with an empty path.
out="$(TMPDIR="$PARENT/does-not-exist" bash -c '. "$1/lib/tmp.sh"; echo SHOULD-NOT-RUN' _ "$FX_DIR" 2>&1)"; rc=$?
if [[ $rc -ne 0 && "$out" != *SHOULD-NOT-RUN* ]]; then ok "H3e unusable TMPDIR aborts before any case runs (rc=$rc)"
else bad "H3e unusable TMPDIR did not abort" "rc=$rc out: [$out]"; fi

# ---------- H4: real suites leave a private TMPDIR empty ----------
# Fast suites that were among the leakers; each runs with its own fresh TMPDIR and without the
# real vault. The suite's own result is not judged here (its own run does that) — only the leak.
SUITES=(a1-reservations a1-realpath-check a1-lane-split a1-glob-liveness a1-workflow-lint a1-fix)
for s in "${SUITES[@]}"; do
  script="$FX_DIR/$s/run-tests.sh"
  if [[ ! -f "$script" ]]; then bad "H4 $s: suite script missing ($script)"; continue; fi
  t="$(fresh_tmp "h4-$s")"
  out="$(cd "$FX_DIR/.." && env -u A1_VAULT_ROOT TMPDIR="$t" bash "$script" 2>&1)"; rc=$?
  left="$(ls -A "$t")"
  if [[ -z "$left" ]]; then ok "H4 $s leaves its private TMPDIR empty (suite rc=$rc)"
  else
    bad "H4 $s left entries in its TMPDIR" "left: [$(echo "$left" | head -5 | tr '\n' ' ')]"
    chmod -R u+w "$t" 2>/dev/null
  fi
  # Control: the suite actually ran (a crash at startup would also leave the dir empty).
  if echo "$out" | grep -qE 'passed|PASS'; then ok "H4c $s produced test output (not an empty run)"
  else bad "H4c $s produced no PASS/passed output" "out: [$(echo "$out" | head -3 | tr '\n' ' ')]"; fi
done

echo "a1-tmp-hygiene: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
