#!/usr/bin/env bash
# cases/08-seal-guard.sh — regression for 2026-11-18-suite-strips-root-write-bit:
# a failed seal must abort loudly, and the tamper step of X14/B11 must never
# chmod outside the seal. Everything runs from a throwaway cwd under $WORK,
# never from the checkout root. Sourced after 07-bounds.sh.

sg_cwd="$(mktemp -d "$WORK/sg-cwd.XXXXXX")"
chmod 755 "$sg_cwd"
sg_mode_before="$(stat -c %a "$sg_cwd")"

# S1: a seal that fails (real SealRefusal via the stub's `refuse` mode) aborts
# w6_sandbox with a clear message naming the seal output; no chmod happens.
# The subshell keeps the abort (exit 3) away from the suite itself.
sg_err="$( cd "$sg_cwd" && W6_SEAL_MODE=refuse w6_sandbox sg-fail 2>&1 >/dev/null )"; sg_rc=$?
sg_mode_s1="$(stat -c %a "$sg_cwd")"
if [[ "$sg_rc" -eq 3 && "$sg_err" == *"seal setup failed"* && "$sg_err" == *"claude_code_context"* && "$sg_mode_s1" == "$sg_mode_before" ]]; then
  ok "S1 a failed seal aborts w6_sandbox (exit 3) naming the seal output; the cwd mode stays $sg_mode_before [FR-039, bug 2026-11-18]"
else bad "S1 a failed seal aborts w6_sandbox (exit 3) naming the seal output; the cwd mode stays $sg_mode_before [FR-039, bug 2026-11-18]" "rc $sg_rc mode $sg_mode_s1" "err: ${sg_err:0:300}"; fi

# S2: the X14/B11 tamper step with an empty or foreign target refuses without
# a chmod (the old inline code ran `chmod a-w "" "$(dirname "")"` = the cwd).
sg_ok=1; sg_detail=""
for sg_target in "" "$sg_cwd" "$sg_cwd/missing" "/etc/hostname"; do
  sg_msg="$( cd "$sg_cwd" && W6_SEAL="" w6_tamper_seal "$sg_target" 2>&1 )"; sg_trc=$?
  [[ "$sg_trc" -ne 0 && "$sg_msg" == *"no chmod done"* && "$(stat -c %a "$sg_cwd")" == "$sg_mode_before" ]] || { sg_ok=""; sg_detail="$sg_detail | '$sg_target' rc $sg_trc: ${sg_msg:0:100}"; }
done
if [[ -n "$sg_ok" ]]; then
  ok "S2 w6_tamper_seal refuses an empty, directory, missing or foreign target without any chmod; the cwd mode stays $sg_mode_before [FR-039, bug 2026-11-18]"
else bad "S2 w6_tamper_seal refuses an empty, directory, missing or foreign target without any chmod; the cwd mode stays $sg_mode_before [FR-039, bug 2026-11-18]" "${sg_detail:0:300}"; fi
