# Cases QH1-QH7: quiet-host-poll rule and D19 routing guard (spec 027 slice 3, FR-017).
# Sourced by run-tests.sh (uses ok, bad, REPO_ROOT, TOOLS, copySkills).

# Prints "<quiet_host_checked> <n quiet-host-poll findings> <basenames,...>".
qhSummary() {
  node -e '
    const j=JSON.parse(process.argv[1]);
    const q=j.findings.filter(f=>f.rule==="quiet-host-poll");
    const b=require("path").basename;
    process.stdout.write([j.quiet_host_checked,q.length,q.map(f=>b(f.file)).join(",")].join(" "));
  ' "$1" 2>&1
}

# Append a markdown snippet to a file in a fresh skills copy; expect "<n> <names>".
qhCase() {
  local id="$1" rel="$2" snippet="$3" want="$4" work out rc sum
  work="$(copySkills)"
  mkdir -p "$(dirname "$work/$rel")"
  printf '\n%s\n' "$snippet" >> "$work/$rel"
  out="$(node "$TOOLS" workflow lint --root "$work" 2>/dev/null)"; rc=$?
  sum="$(qhSummary "$out")"; sum="${sum#* }"
  if [[ "$sum" == "$want" ]]; then ok "$id (rc=$rc)"; else bad "$id (rc=$rc sum='$sum' want='$want')"; fi
}

caseQH1() {
  local work out rc sum
  work="$(copySkills)"; out="$(node "$TOOLS" workflow lint --root "$work" 2>/dev/null)"; rc=$?
  sum="$(qhSummary "$out")"
  if [[ $rc -eq 0 && "${sum#* }" == "0 " && "${sum%% *}" -ge 20 ]]; then ok "QH1 real tree: exit 0, no poll finding"
  else bad "QH1 real tree (rc=$rc sum='$sum')"; fi
}

caseQH2() { qhCase "QH2 sh fence with pgrep in 05-merge.md" skills/a1-pr-review/workflows/05-merge.md \
  $'```sh\npgrep -f \'x\' >/dev/null && echo WAIT\n```' "1 05-merge.md"; }
caseQH3() { qhCase "QH3 bash fence in nested file" skills/a1-fix/workflows/sub/x.md \
  $'```bash\npgrep x\n```' "1 x.md"; }
caseQH4() { qhCase "QH4 prose outside a fence" skills/a1-fix/workflows/sub/x.md \
  'No `pgrep` poll here.' "0 "; }
caseQH5() { qhCase "QH5 tilde fence" skills/a1-fix/workflows/sub/x.md \
  $'~~~\npgrep x\n~~~' "1 x.md"; }
caseQH6() { qhCase "QH6 xpgrep and pgrep-like are not polls" skills/a1-fix/workflows/sub/x.md \
  $'```sh\nxpgrep a\npgrep-like\n```' "0 "; }

caseQH7() {
  local ok7=1 f
  for f in skills/a1-execute/workflows/02-execute.md skills/a1-new-feature/workflows/05-implement.md; do
    awk 'BEGIN{fence=0} /^```/{fence=!fence; next} fence && /^if \[ \$RC -eq 2 \]/ && /lock_timeout/ && /not red/ {found=1} END{exit found?0:1}' \
      "$REPO_ROOT/$f" || { ok7=0; echo "QH7 missing D19 branch in $f" >&2; }
  done
  for f in skills/a1-execute/workflows/03-verify.md skills/a1-new-feature/workflows/06-verify.md; do
    grep -q lock_timeout "$REPO_ROOT/$f" || { ok7=0; echo "QH7 no lock_timeout in $f" >&2; }
  done
  if [[ $ok7 -eq 1 ]]; then ok "QH7 D19 lock_timeout routing present in the 4 gate files"
  else bad "QH7 D19 routing"; fi
}
