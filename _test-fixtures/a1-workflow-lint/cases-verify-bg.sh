# Cases VB1-VB2: the background `verify run` line stays under the verify-scope rule (spec 027 slice 4, plan D13, Task 8.1).
# Sourced by run-tests.sh AFTER cases-verify-scope.sh (uses vsOneFinding, copyFull from that file).
# The foreground `--out` lines carry the VS3 pin (`verify run.*--out`); the background start line has no `--out`, so VS3 does not
# reach it. VB1/VB2 add `--affected` to the background line only and require the rule to fire on it.
#
# Measured red 2026-11-23 (scratch copy, one edit each):
#   VS3 old address `/a1-tools.cjs verify run/` on the new tree -> VS3 (03-verify, 06-verify) red, 2 findings each
#   VS3 new address with the foreground --out line removed      -> VS3 red, 0 findings
#   `--affected` added to the background line                    -> VB1/VB2 are the cases that expect this finding

caseVB1() {
  vsOneFinding VB1 skills/a1-execute/workflows/03-verify.md '/a1-tools.cjs verify run.*VBG/s/verify run/verify run --affected/' 'Verify-step verify run with --affected'
}
caseVB2() {
  vsOneFinding VB2 skills/a1-new-feature/workflows/06-verify.md '/a1-tools.cjs verify run.*VBG/s/verify run/verify run --affected/' 'Verify-step verify run with --affected'
}
