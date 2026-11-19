# Sourced by run-tests.sh (spec 027 slice 3, FR-011). Uses the suite helpers: new_pr, mc, js, reasons, expect, WORK.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# merge-check runs the base side lazily: head first, base only for commands red on head (or with a counting reporter).
# RED-proof (scratch copy, see STATUS-verify.md): pr-merge-check.cjs `lazyBase: true` removed : ML1 red.
. "$REPO_ROOT/_test-fixtures/a1-verify/leak-assert.sh"; lk_leak_start

# ml_run <label> <base-exit> <head-exit> [mc args]: new_pr + mc with the spawn seam; sets ML_LOG.
ml_run() {
  local label="$1" b="$2" h="$3"; shift 3
  new_pr "$label" "$b" "$h"
  ML_LOG="$WORK/ml-$label.log"; : > "$ML_LOG"
  mkdir -p "$WORK/vl-$label"
  export A1_VERIFY_LOCK_DIR="$WORK/vl-$label/lock" A1_VERIFY_SPAWN_LOG="$ML_LOG"
  lk_token_reset
  mc "$@"
  vlock_restore; unset A1_VERIFY_SPAWN_LOG
}
ml_base() { grep -c '^b' "$ML_LOG" | tr -d ' '; }

ml_run ml1 0 0
expect "ML1 green head: exit 0" 0 "$RC"
expect "ML1b green head: zero base commands (spawn seam)" 0 "$(ml_base)"
expect "ML1c suites verdict pass" pass "$(js 'j.suites.verdict')"

ml_run ml2 0 1
expect "ML2 red head: exit 1" 1 "$RC"
expect "ML2b red head: exactly one base run" 1 "$(ml_base)"
case ",$(reasons)," in *,suite_red_on_head,*) ok "ML2c reasons include suite_red_on_head" ;; *) bad "ML2c reasons: $(reasons)" ;; esac

ml_run ml3 1 1
expect "ML3 red on base and head: exit 1" 1 "$RC"
expect "ML3b one base run" 1 "$(ml_base)"
case ",$(reasons)," in *,base_red_unreported,*) ok "ML3c reasons include base_red_unreported" ;; *) bad "ML3c reasons: $(reasons)" ;; esac

lk_leak_end ML
