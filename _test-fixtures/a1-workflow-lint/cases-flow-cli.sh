# Cases FC1-FC3: the flow rules through the CLI (spec 027 slice 4, Task 5.1).
# Sourced by run-tests.sh (uses ok, bad, REPO_ROOT, TOOLS, copySkills).

caseFC1() {
  local work out rc n
  work="$(copySkills)"
  out="$(node "$TOOLS" workflow lint --root "$work" 2>/dev/null)"; rc=$?
  n="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).flow_checked))' "$out" 2>&1)"
  if [[ $rc -eq 0 && "$n" == "5" ]]; then ok "FC1 workflow lint on a real copy: exit 0, flow_checked 5"
  else bad "FC1 real copy (rc=$rc flow_checked='$n')"; fi
  rm -rf "${work:?}"
}

caseFC2() {
  local work err rc
  work="$(copySkills)"
  printf '\nContinue? [y to proceed / n to stop]\n' >> "$work/skills/a1-execute/workflows/02-execute.md"
  err="$(node "$TOOLS" workflow lint --root "$work" 2>&1 >/dev/null)"; rc=$?
  if [[ $rc -eq 1 && "$err" == *wave-checkpoint* ]]; then ok "FC2 planted 'Continue? [y': exit 1, wave-checkpoint in stderr"
  else bad "FC2 planted prompt (rc=$rc err='$err')"; fi
  rm -rf "${work:?}"
}

caseFC3() {
  local work out keys
  work="$(copySkills)"
  out="$(node "$TOOLS" workflow lint --root "$work" 2>/dev/null)"
  keys="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(["vault_sync_checked","verify_scope_checked","reuse_ban_checked","quiet_host_checked"].every(k=>typeof j[k]==="number")?"yes":"no")' "$out" 2>&1)"
  if [[ "$keys" == "yes" ]]; then ok "FC3 JSON still carries the four earlier *_checked counters"
  else bad "FC3 counters ($keys)"; fi
  rm -rf "${work:?}"
}
