# Cases VS1-VS8: verify-scope and verify-reuse-ban rules (spec 027 slice 2).
# Sourced by run-tests.sh (uses ok, bad, REPO_ROOT, TOOLS, copySkills, mk_workdir).

# Full copy: skills, agents, pr-merge-check.cjs.
copyFull() {
  local work
  work="$(copySkills)"
  cp -R "$REPO_ROOT/agents" "$work/agents"
  mkdir -p "$work/_shared/lib"
  cp "$REPO_ROOT/_shared/lib/pr-merge-check.cjs" "$work/_shared/lib/pr-merge-check.cjs"
  printf '%s' "$work"
}

# Portable in-place sed (no sed -i): write to a temp file, then move it back.
vsSed() { local f="$1"; shift; sed "$@" "$f" > "$f.new" && mv "$f.new" "$f"; }

# Prints "<scope_checked> <reuse_checked> <n scope> <n reuse> <scope basenames,...>".
vsSummary() {
  node -e '
    const j=JSON.parse(process.argv[1]);
    const s=j.findings.filter(f=>f.rule==="verify-scope");
    const r=j.findings.filter(f=>f.rule==="verify-reuse-ban");
    const b=require("path").basename;
    process.stdout.write([j.verify_scope_checked,j.reuse_ban_checked,s.length,r.length,s.map(f=>b(f.file)+":"+f.reason).join("|")].join(" "));
  ' "$1" 2>&1
}

vsRun() { node "$TOOLS" workflow lint --root "$1" 2>/dev/null; }

caseVS1() {
  local work out rc sum
  work="$(copyFull)"; out="$(vsRun "$work")"; rc=$?; sum="$(vsSummary "$out")"
  if [[ $rc -eq 0 && "$sum" == "5 2 0 0 " ]]; then ok "VS1 full copy: exit 0, scope 5, reuse 2"
  else bad "VS1 full copy (rc=$rc sum='$sum')"; fi
}

# Edit a file with sed, require exactly one scope finding naming it.
vsOneFinding() {
  local id="$1" rel="$2" sedexpr="$3" want="$4" work out rc sum
  work="$(copyFull)"
  vsSed "$work/$rel" -e "$sedexpr"
  out="$(vsRun "$work")"; rc=$?; sum="$(vsSummary "$out")"
  if [[ $rc -eq 1 && "$sum" == "5 2 1 0 $(basename "$rel"):$want" ]]; then ok "$id $(basename "$rel"): one verify-scope finding ($want)"
  else bad "$id $(basename "$rel") (rc=$rc sum='$sum')"; fi
}

caseVS2() {
  vsOneFinding VS2 skills/a1-execute/workflows/02-execute.md '/verify run/s/ --affected//' 'per-wave verify run without --affected'
  vsOneFinding VS2 skills/a1-new-feature/workflows/05-implement.md '/verify run/s/ --affected//' 'per-wave verify run without --affected'
}

caseVS3() {
  vsOneFinding VS3 skills/a1-execute/workflows/03-verify.md '/a1-tools.cjs verify run.*--out/s/verify run/verify run --affected/' 'Verify-step verify run with --affected'
  vsOneFinding VS3 skills/a1-new-feature/workflows/06-verify.md '/a1-tools.cjs verify run.*--out/s/verify run/verify run --affected/' 'Verify-step verify run with --affected'
  vsOneFinding VS3 agents/a1-victor-verifier.md '/A1_TOOLS" verify run/s/verify run/verify run --affected/' 'Verify-step verify run with --affected'
}

caseVS4() {
  local work out rc sum
  work="$(copyFull)"; rm "$work/agents/a1-victor-verifier.md"
  out="$(vsRun "$work")"; rc=$?; sum="$(vsSummary "$out")"
  if [[ $rc -eq 1 && "$sum" == "5 2 1 0 a1-victor-verifier.md:file missing or unreadable" ]]; then ok "VS4 Victor deleted with agents/ present: file missing"
  else bad "VS4 Victor deleted (rc=$rc sum='$sum')"; fi
  work="$(copySkills)"
  out="$(vsRun "$work")"; rc=$?; sum="$(vsSummary "$out")"
  if [[ $rc -eq 0 && "$sum" == "4 1 0 0 " ]]; then ok "VS4 skills-only copy: no Victor finding (scope 4, reuse 1)"
  else bad "VS4 skills-only copy (rc=$rc sum='$sum')"; fi
}

caseVS5() {
  local work out rc sum
  work="$(copyFull)"
  printf '\nRun verify reuse --head x before merging.\n' >> "$work/skills/a1-pr-review/workflows/05-merge.md"
  out="$(vsRun "$work")"; rc=$?; sum="$(vsSummary "$out")"
  if [[ $rc -eq 1 && "$sum" == "5 2 0 1 " ]]; then ok "VS5a verify reuse prose in 05-merge.md: verify-reuse-ban finding"
  else bad "VS5a prose reuse (rc=$rc sum='$sum')"; fi
  work="$(copyFull)"
  printf "\nrequire('./verify-reuse.cjs');\n" >> "$work/_shared/lib/pr-merge-check.cjs"
  out="$(vsRun "$work")"; rc=$?; sum="$(vsSummary "$out")"
  if [[ $rc -eq 1 && "$sum" == "5 2 0 1 " ]]; then ok "VS5b require verify-reuse in pr-merge-check.cjs: verify-reuse-ban finding"
  else bad "VS5b require reuse (rc=$rc sum='$sum')"; fi
}

caseVS6() {
  local work out rc sum
  work="$(copyFull)"
  # Re-label the fence holding the call as text: the call is now prose only.
  node -e '
    const fs=require("fs"); const f=process.argv[1];
    const L=fs.readFileSync(f,"utf8").split("\n");
    const i=L.findIndex(l=>/a1-tools\.cjs verify run/.test(l));
    let j=i; while(j>=0 && L[j].trim()!=="```bash") j--;
    L[j]="```text"; fs.writeFileSync(f,L.join("\n"));
  ' "$work/skills/a1-execute/workflows/02-execute.md"
  out="$(vsRun "$work")"; rc=$?; sum="$(vsSummary "$out")"
  if [[ $rc -eq 1 && "$sum" == "5 2 1 0 02-execute.md:no fenced verify run call" ]]; then ok "VS6 fence call turned into prose: no fenced verify run call"
  else bad "VS6 prose only (rc=$rc sum='$sum')"; fi
}

caseVS7() {
  local work out rc sum
  work="$(copyFull)"
  node -e '
    const fs=require("fs"); const f=process.argv[1];
    const L=fs.readFileSync(f,"utf8").split("\n");
    const i=L.findIndex(l=>/a1-tools\.cjs verify run/.test(l));
    L.splice(i,0,"# node a1-tools.cjs verify run --project x"); fs.writeFileSync(f,L.join("\n"));
  ' "$work/skills/a1-execute/workflows/03-verify.md"
  out="$(vsRun "$work")"; rc=$?; sum="$(vsSummary "$out")"
  if [[ $rc -eq 0 && "$sum" == "5 2 0 0 " ]]; then ok "VS7 comment line in a fence is not a call"
  else bad "VS7 comment control (rc=$rc sum='$sum')"; fi
}

caseVS8() {
  vsOneFinding VS8 skills/a1-execute/workflows/02-execute.md '/verify run/s/--affected/--affected-x/' 'per-wave verify run without --affected'
}
