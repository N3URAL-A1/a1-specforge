# Part 03 (Wave 1) — isolation environment, sentinel leak check, a1-reconcile restore. Sourced by run-tests.sh.
# FR-021: every suite runs once with its own empty sentinel A1_VAULT_ROOT, its own fresh HOME,
# A1_HOST_ID=leak and A1_VAULT_WRITER_HOST unset; a suite that leaves files in its sentinel fails
# (at most 3 leaked paths printed); a1-reconcile is restored once after all workers.
#
# Red-making changes (one production-code line each, on a git archive snapshot):
#  I1a: not replacing HOME (the probe sees the outer HOME) · I1b: dropping `A1_HOST_ID=leak` ·
#  I1c: dropping `-u A1_VAULT_WRITER_HOST` (the outer value survives) · I1d: sharing one sentinel
#  vault between workers · I1e: passing the outer A1_VAULT_ROOT through · I1f: a sentinel that is
#  not empty at suite start (EMPTY=no).
#  L1a-L1d: dropping the sentinel emptiness check after a suite, or removing `head -3` from the
#           leaked-path listing (5+ paths printed).
#  H1: not removing the per-run work directory (a1-suite-XXXXXX stays in TMPDIR).
#  R1a-R1c: dropping the `git checkout HEAD -- _test-fixtures/a1-reconcile` restore · R2: restoring
#  although the path had local edits before the run · R3: printing no skip line outside a git work tree
#  (or running git checks there) · R4: running the check although a1-reconcile was not selected.

# ---- I1: environment facts seen by two concurrent probe suites ----
mk_tree T_ENV env
mk_workdir OUTER_V outer-vault
ENV_A="$T_ENV/facts-a"
ENV_B="$T_ENV/facts-b"
PROBE_ENV_BODY='f="__F__"
{ echo "HOME=$HOME"; echo "HOST=${A1_HOST_ID-UNSET}"; echo "WRITER=${A1_VAULT_WRITER_HOST-UNSET}"
  echo "VAULT=${A1_VAULT_ROOT-UNSET}"
  if [ -n "${A1_VAULT_ROOT:-}" ] && [ -d "$A1_VAULT_ROOT" ] && [ -z "$(ls -A "$A1_VAULT_ROOT")" ]; then echo EMPTY=yes; else echo EMPTY=no; fi
} > "$f"
sleep 1
echo "env: 1 passed, 0 failed"'
plant_suite "$T_ENV" e/run-a.sh "${PROBE_ENV_BODY//__F__/$ENV_A}"
plant_suite "$T_ENV" e/run-b.sh "${PROBE_ENV_BODY//__F__/$ENV_B}"
RS_ENV_EXTRA="A1_VAULT_WRITER_HOST=outerhost A1_HOST_ID=outer A1_VAULT_ROOT=$OUTER_V" rs_run "$T_ENV" --workers 2
assert_eq "I1z both probe suites passed" "$RS_RC" "0"
fact() { sed -n "s/^$2=//p" "$1" | head -1; }
HOME_A="$(fact "$ENV_A" HOME)"; HOME_B="$(fact "$ENV_B" HOME)"
VAULT_A="$(fact "$ENV_A" VAULT)"; VAULT_B="$(fact "$ENV_B" VAULT)"
if [[ -n "$HOME_A" && "$HOME_A" != "$HOME" ]]; then ok "I1a probe HOME differs from the outer HOME"; else bad "I1a probe HOME differs from the outer HOME" "probe: [$HOME_A] outer: [$HOME]"; fi
assert_eq "I1b A1_HOST_ID=leak" "$(fact "$ENV_A" HOST)" "leak"
assert_eq "I1c A1_VAULT_WRITER_HOST unset although the outer env set it" "$(fact "$ENV_A" WRITER)" "UNSET"
if [[ -n "$HOME_A" && -n "$HOME_B" && "$HOME_A" != "$HOME_B" ]]; then ok "I1d each suite has its own HOME"; else bad "I1d each suite has its own HOME" "a: [$HOME_A] b: [$HOME_B]"; fi
if [[ -n "$VAULT_A" && -n "$VAULT_B" && "$VAULT_A" != "$VAULT_B" ]]; then ok "I1d2 each suite has its own sentinel vault"; else bad "I1d2 each suite has its own sentinel vault" "a: [$VAULT_A] b: [$VAULT_B]"; fi
if [[ -n "$VAULT_A" && "$VAULT_A" != "$OUTER_V" && "$VAULT_B" != "$OUTER_V" ]]; then ok "I1e the outer A1_VAULT_ROOT is replaced"; else bad "I1e the outer A1_VAULT_ROOT is replaced" "a: [$VAULT_A] outer: [$OUTER_V]"; fi
assert_eq "I1f sentinel vault is empty at suite start (a)" "$(fact "$ENV_A" EMPTY)" "yes"
assert_eq "I1f sentinel vault is empty at suite start (b)" "$(fact "$ENV_B" EMPTY)" "yes"
assert_eq "I1g the outer vault stays empty" "$(ls -A "$OUTER_V" | grep -c '')" "0"
assert_eq "H1 the per-run work directory is removed from TMPDIR" \
  "$(find "$RS_TMPD" -maxdepth 1 -name 'a1-suite-??????' | grep -c '')" "0"

# ---- L1: a suite that writes into its sentinel vault fails; at most 3 leaked paths are printed ----
mk_tree T_LEAK leak
LEAK_PROBE="$T_LEAK/clean-ran"
plant_suite "$T_LEAK" leaker/run-tests.sh 'mkdir -p "$A1_VAULT_ROOT/project/x"
for n in 1 2 3 4 5; do : > "$A1_VAULT_ROOT/project/x/f$n"; done
echo "leaker: 1 passed, 0 failed"'
plant_suite "$T_LEAK" clean/run-tests.sh ": > \"$LEAK_PROBE\"; echo 'clean: 1 passed, 0 failed'"
rs_run "$T_LEAK"
assert_eq "L1a leaking run exits 1" "$RS_RC" "1"
assert_file_present "L1b the clean suite ran in the same run" "$LEAK_PROBE"
assert_contains "L1c the leaker is named" "$RS_OUT" "done: FAIL leaker/run-tests.sh"
assert_contains "L1c2 the clean suite passed" "$RS_OUT" "done: PASS clean/run-tests.sh"
assert_contains "L1d a leaked path is printed" "$RS_OUT" "/project"
assert_eq "L1e exactly 3 leaked paths printed (7 existed)" "$(printf '%s\n' "$RS_OUT" | grep -c 'leaked: ')" "3"
mk_tree T_CLEAN cleanonly
plant_ok "$T_CLEAN" clean/run-tests.sh
rs_run "$T_CLEAN"
assert_eq "L1f a clean suite alone exits 0" "$RS_RC" "0"

# ---- R: a1-reconcile restore/clean check, once after all workers, in a git work tree only ----
mk_git_tree() { # VAR — a git copy with a planted a1-reconcile suite that dirties its fixture file
  mk_tree "$1" gittree
  local __t="${!1}"
  plant_suite "$__t" a1-reconcile/run-tests.sh 'cd "$(dirname "$0")" && echo "dirtied-by-suite" >> fixture.txt && : > ../../reconcile-ran
echo "a1-reconcile: 1 passed, 0 failed"'
  printf 'committed\n' > "$__t/_test-fixtures/a1-reconcile/fixture.txt"
  git -C "$__t" init -q 2>/dev/null
  git -C "$__t" config user.name fixture
  git -C "$__t" config user.email fixture@example.invalid
  git -C "$__t" add -A
  git -C "$__t" -c commit.gpgsign=false commit -q -m base
}
mk_git_tree T_R1
rs_run "$T_R1"
assert_eq "R1a clean path: run exits 0" "$RS_RC" "0"
assert_file_present "R1x the planted a1-reconcile suite really ran and dirtied its fixture" "$T_R1/reconcile-ran"
assert_eq "R1b fixture file restored to the committed content" "$(cat "$T_R1/_test-fixtures/a1-reconcile/fixture.txt")" "committed"
assert_eq "R1c a1-reconcile path reported and left clean" "$(git -C "$T_R1" status --porcelain -- _test-fixtures/a1-reconcile)" ""
assert_contains "R1d the restore is announced" "$RS_OUT" "restored _test-fixtures/a1-reconcile"
mk_git_tree T_R2
printf 'committed\nlocal edit\n' > "$T_R2/_test-fixtures/a1-reconcile/fixture.txt"
rs_run "$T_R2"
assert_eq "R2a pre-existing local edit: run exits 0" "$RS_RC" "0"
assert_file_present "R2x the planted a1-reconcile suite really ran" "$T_R2/reconcile-ran"
assert_contains "R2b the local edit is left untouched" "$(cat "$T_R2/_test-fixtures/a1-reconcile/fixture.txt")" "local edit"
assert_contains "R2c a skip line names the local edits" "$RS_OUT" "had local edits before the run"
mk_tree T_R3
plant_suite "$T_R3" a1-reconcile/run-tests.sh 'echo "a1-reconcile: 1 passed, 0 failed"'
rs_run "$T_R3"
assert_eq "R3a non-git copy: run exits 0" "$RS_RC" "0"
assert_eq "R3b exactly one 'no git work tree' skip line" "$(printf '%s\n' "$RS_OUT" | grep -c 'no git work tree')" "1"
