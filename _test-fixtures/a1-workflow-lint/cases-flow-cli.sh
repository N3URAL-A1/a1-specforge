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

# FC4-FC6 (review fix round 2, m8): generic prompt patterns for the two wave files, and a size limit for stop blocks.
fcPlant() { # <relative file> <text to append>: echoes "<rc>|<stderr>" of workflow lint on a real copy with the text appended
  local work err rc
  work="$(copySkills)"
  printf '%s' "$2" >> "$work/$1"
  err="$(node "$TOOLS" workflow lint --root "$work" 2>&1 >/dev/null)"; rc=$?
  printf '%s|%s' "$rc" "$err"
  rm -rf "${work:?}"
}
caseFC4() {
  local r f bad_f=""
  for f in skills/a1-execute/workflows/02-execute.md skills/a1-new-feature/workflows/05-implement.md; do
    r="$(fcPlant "$f" $'\nReady for wave 3? [yes / no]\n')"
    [[ "$r" == 1\|*wave-checkpoint* ]] || bad_f="$bad_f $f(${r:0:80})"
  done
  if [[ -z "$bad_f" ]]; then ok "FC4 a reworded '? [yes / no]' prompt outside a stop block is flagged in both wave files"
  else bad "FC4 generic [y pattern missed:$bad_f"; fi
}
caseFC5() {
  local r f bad_f=""
  for f in skills/a1-execute/workflows/02-execute.md skills/a1-new-feature/workflows/05-implement.md; do
    r="$(fcPlant "$f" $'\nShall we proceed with wave 3?\n')"
    [[ "$r" == 1\|*wave-checkpoint* ]] || bad_f="$bad_f $f(${r:0:80})"
  done
  if [[ -z "$bad_f" ]]; then ok "FC5 a 'proceed ... ?' question outside a stop block is flagged in both wave files"
  else bad "FC5 generic proceed pattern missed:$bad_f"; fi
}
caseFC6() {
  local r f bad_f="" body i
  body=$'\n<!-- a1:stop -->\n'
  for i in $(seq 1 26); do body="${body}line $i of a long stop block"$'\n'; done
  body="${body}<!-- /a1:stop -->"$'\n'
  for f in skills/a1-execute/workflows/02-execute.md skills/a1-new-feature/workflows/05-implement.md; do
    r="$(fcPlant "$f" "$body")"
    [[ "$r" == 1\|*wave-checkpoint*25* ]] || bad_f="$bad_f $f(${r:0:100})"
  done
  if [[ -z "$bad_f" ]]; then ok "FC6 a stop block of 26 lines is flagged (limit 25) in both wave files"
  else bad "FC6 long stop block not flagged:$bad_f"; fi
}
