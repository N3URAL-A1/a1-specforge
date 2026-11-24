# Cases RD1-RD9, FB1-FB6, SP1-SP5: reading-path rule module (spec 027 slice 5, plan Task 2.1, D3/D10/D11).
# Sourced by run-tests.sh (uses ok, bad, REPO_ROOT, mk_workdir). Every case plants a tree under a temp root and calls
# `checkReadingPath` at module level with the two helpers a caller supplies (the Task 11.1 hook takes them from workflow-lint.cjs).
# VSRE_LIT is the D11 vault-sync regex, written once here; VR1 (Task 10.1) ties it to the workflow-lint.cjs export.
# SP5 plants copies of the real files, taken from $REPO_ROOT at run time.
#
# Measured red 2026-11-23 (scratch copy, one edit each, suite run, file restored):
#   section boundary ignored (trigger anywhere in the file)           -> RD4
#   allow marker ignored                                              -> FB4
#   only fenced lines scanned for forbidden patterns                  -> FB6
#   PER_WAVE_FILES loses 02-execute.md                                -> SP1
#   references inside conditional files checked                       -> RD5
#   sync/cost counts as substring matches instead of anchored regexes -> SP5
#   headings detected inside fences too                               -> RD8
#   fail-closed helper guard removed                                  -> RD9

RD_LIB="$REPO_ROOT/_shared/lib/workflow-lint-read.cjs"
RD_LINT="$REPO_ROOT/_shared/lib/workflow-lint.cjs"
VSRE_LIT='/a1-tools\.cjs vault sync .* --phases/'

# rdTree <varname>: an empty planted root with skills/ (no _shared/a1-tools.cjs, so no budget check).
rdTree() { local _t; mk_workdir _t rd; mkdir -p "$_t/skills"; printf -v "$1" '%s' "$_t"; }
# rdPut <root> <rel>: file content from stdin.
rdPut() { mkdir -p "$(dirname "$1/$2")"; cat > "$1/$2"; }
# rdRules <root>: "rule@file,..." for every finding, in module order.
rdRules() {
  env -u A1_VAULT_ROOT node -e '
    const lint=require(process.argv[2]);
    const re=new RegExp(process.argv[4].slice(1,-1));
    const r=require(process.argv[1]).checkReadingPath(process.argv[3],{extractBashFenceLines:lint.extractBashFenceLines,VAULT_SYNC_CALL_RE:re});
    process.stdout.write(r.findings.map(f=>f.rule+"@"+f.file).join(","));
  ' "$RD_LIB" "$RD_LINT" "$1" "$VSRE_LIT" 2>&1
}
rdCheck() { # <id> <label> <root> <expected>
  local got; got="$(rdRules "$3")"
  if [[ "$got" == "$4" ]]; then ok "$1 $2"; else bad "$1 $2 (got '$got', want '$4')"; fi
}
RD_COND='<!-- load: conditional trigger=profile resolve -->'
rdCond() { printf '%s\nbody\n' "$RD_COND" | rdPut "$1" "skills/x/workflows/kritis.md"; }

caseRD1() { local w; rdTree w; rdCond "$w"
  rdPut "$w" skills/x/SKILL.md <<'X'
## Step
```bash
node /r/_shared/a1-tools.cjs profile resolve
```
Then read workflows/kritis.md
X
  rdCheck RD1 "reference after the trigger call in a bash fence: no finding" "$w" ""; }
caseRD2() { local w; rdTree w; rdCond "$w"
  rdPut "$w" skills/x/SKILL.md <<'X'
## Step
Run `node a1-tools.cjs profile resolve` first.
Then read workflows/kritis.md
X
  rdCheck RD2 "inline-code trigger form: no finding" "$w" ""; }
caseRD3() { local w; rdTree w; rdCond "$w"
  rdPut "$w" skills/x/SKILL.md <<'X'
## Step
Read workflows/kritis.md
```bash
node /r/_shared/a1-tools.cjs profile resolve
```
X
  rdCheck RD3 "reference before the trigger: finding" "$w" "conditional_ref_untriggered@skills/x/SKILL.md"; }
caseRD4() { local w; rdTree w; rdCond "$w"
  rdPut "$w" skills/x/SKILL.md <<'X'
## One
```bash
node /r/_shared/a1-tools.cjs profile resolve
```
## Two
Read workflows/kritis.md
X
  rdCheck RD4 "trigger in the previous section: finding" "$w" "conditional_ref_untriggered@skills/x/SKILL.md"; }
caseRD5() { local w; rdTree w; rdCond "$w"
  printf '<!-- load: conditional trigger=other -->\nsee workflows/kritis.md\n' | rdPut "$w" skills/x/workflows/more.md
  rdPut "$w" skills/x/SKILL.md <<'X'
## Step
nothing here
X
  rdCheck RD5 "reference inside a conditional file is not checked" "$w" ""; }
caseRD6() { local w; rdTree w; rdCond "$w"
  printf '%s\nbody\n' "$RD_COND" | rdPut "$w" skills/y/workflows/kritis.md
  printf '## s\n' | rdPut "$w" skills/x/SKILL.md; printf '## s\n' | rdPut "$w" skills/y/SKILL.md
  rdCheck RD6 "same basename in two skills: finding" "$w" "conditional_basename_duplicate@skills/y/workflows/kritis.md"; }
caseRD7() { local w; rdTree w; mkdir -p "$w/_shared"; : > "$w/_shared/a1-tools.cjs"
  printf 'a\nb\nc\n' | rdPut "$w" skills/x/SKILL.md
  printf '<!-- load: conditional trigger=Bad Trigger -->\nbody\n' | rdPut "$w" skills/x/workflows/m.md
  printf '{"schema":1,"budgets":{"x":5}}\n' | rdPut "$w" skills/reading-budget.json
  rdCheck RD7 "malformed header: conditional_header_malformed" "$w" "conditional_header_malformed@skills/x/workflows/m.md"; }
caseRD8() { local w; rdTree w; rdCond "$w"
  rdPut "$w" skills/x/SKILL.md <<'X'
## Step
```bash
node /r/_shared/a1-tools.cjs profile resolve
# a comment line, not a heading
```
Then read workflows/kritis.md
X
  rdCheck RD8 "a # comment inside a fence does not split the section" "$w" ""; }
caseRD9() { local w r1 r2; rdTree w; printf '## s\n' | rdPut "$w" skills/x/SKILL.md
  r1="$(node -e 'const l=require(process.argv[2]);try{require(process.argv[1]).checkReadingPath(process.argv[3],{extractBashFenceLines:l.extractBashFenceLines});process.stdout.write("no throw")}catch(e){process.stdout.write(String(e.code))}' "$RD_LIB" "$RD_LINT" "$w" 2>&1)"
  r2="$(node -e 'const l=require(process.argv[2]);try{require(process.argv[1]).checkReadingPath(process.argv[3],{extractBashFenceLines:l.extractBashFenceLines,VAULT_SYNC_CALL_RE:"x"});process.stdout.write("no throw")}catch(e){process.stdout.write(String(e.code))}' "$RD_LIB" "$RD_LINT" "$w" 2>&1)"
  if [[ "$r1" == "A1_INPUT" && "$r2" == "A1_INPUT" ]]; then ok "RD9 missing or mistyped helper throws A1_INPUT (fail closed)"; else bad "RD9 (r1=$r1 r2=$r2)"; fi; }

# FB: forbidden command text. fbCase <id> <label> <rel> <line> <expected>
fbCase() { local w; rdTree w; printf 'intro\n%s\n' "$4" | rdPut "$w" "$3"; rdCheck "$1" "$2" "$w" "$5"; }
caseFB1() { fbCase FB1 "git worktree add flagged" skills/x/workflows/01-a.md 'git -C repo worktree add x' "forbidden_command@skills/x/workflows/01-a.md"; }
caseFB2() { fbCase FB2 "worktree  add (two spaces) flagged" skills/x/workflows/01-a.md 'git worktree  add x' "forbidden_command@skills/x/workflows/01-a.md"; }
caseFB3() { fbCase FB3 "--delete-branch flagged" skills/x/workflows/01-a.md 'gh pr merge 1 --squash --delete-branch' "forbidden_command@skills/x/workflows/01-a.md"; }
caseFB4() { fbCase FB4 "allow marker clears the line" skills/x/workflows/01-a.md 'gh pr merge 1 --squash --delete-branch <!-- lint-allow: forbidden-example -->' ""; }
caseFB5() { fbCase FB5 "a1-worktree skill is outside the rule" skills/a1-worktree/SKILL.md 'git worktree add x' ""; }
caseFB6() { fbCase FB6 "a prose line in SKILL.md is flagged" skills/x/SKILL.md 'Run git worktree add by hand' "forbidden_command@skills/x/SKILL.md"; }

# SP: sync placement. spFile <root> <rel> <vault> <dash> <cost>: a bash fence with that many of each call.
spFile() {
  local n i out='```bash'
  out+=$'\n'"echo \"vault sync --phases exit=0\""
  for ((i = 0; i < $3; i++)); do out+=$'\n'"node /r/_shared/a1-tools.cjs vault sync x --phases p"; done
  for ((i = 0; i < $4; i++)); do out+=$'\n'"node /r/_shared/a1-tools.cjs dashboard build --phase p"; done
  for ((i = 0; i < $5; i++)); do out+=$'\n'"node /r/_shared/a1-tools.cjs cost run --phase p"; done
  printf '%s\n```\n' "$out" | rdPut "$1" "$2"
}
caseSP1() { local w; rdTree w; spFile "$w" skills/a1-execute/workflows/02-execute.md 1 0 0
  rdCheck SP1 "fenced vault sync in 02-execute.md: sync_per_wave" "$w" "sync_per_wave@skills/a1-execute/workflows/02-execute.md"; }
caseSP2() { local w; rdTree w; spFile "$w" skills/a1-execute/workflows/03-verify.md 2 1 1
  rdCheck SP2 "two fenced vault sync in 03-verify.md: sync_phase_end_count" "$w" "sync_phase_end_count@skills/a1-execute/workflows/03-verify.md"; }
caseSP3() { local w; rdTree w; spFile "$w" skills/a1-plan/workflows/04-audit.md 1 1 1
  rdCheck SP3 "fenced cost run in 04-audit.md: cost_run_placement" "$w" "cost_run_placement@skills/a1-plan/workflows/04-audit.md"; }
caseSP4() { local w; rdTree w; spFile "$w" skills/a1-execute/workflows/03-verify.md 1 1 2
  rdCheck SP4 "two cost run in a closing file: cost_run_placement" "$w" "cost_run_placement@skills/a1-execute/workflows/03-verify.md"; }
caseSP5() { local w f; rdTree w
  for f in skills/a1-plan/workflows/04-audit.md skills/a1-execute/workflows/03-verify.md skills/a1-new-feature/workflows/06-verify.md skills/a1-fix/workflows/04-verify.md skills/a1-new-feature/workflows/05-implement.md; do
    mkdir -p "$w/$(dirname "$f")"; cp "$REPO_ROOT/$f" "$w/$f"
  done
  rdCheck SP5 "copies of the real files: no sync finding (anchored regexes)" "$w" ""; }

# VR1: the lane literal VSRE_LIT cannot drift from the single source (workflow-lint.cjs export, D11).
caseVR1() { local got
  got="$(node -e 'const r=require(process.argv[1]).VAULT_SYNC_CALL_RE;process.stdout.write(r instanceof RegExp?String(r):"not-a-regexp")' "$RD_LINT" 2>&1)"
  if [[ "$got" == "$VSRE_LIT" ]]; then ok "VR1 exported VAULT_SYNC_CALL_RE equals the lane literal"; else bad "VR1 (got '$got', want '$VSRE_LIT')"; fi; }

# ---------- RP0-RP8: the reading-path rules hooked into `workflow lint` (spec 027 slice 5, Task 11.1) ----------
# Measured red (scratch copy, one edit each, suite run, file restored):
#   the hook line removed from workflow-lint.cjs                       -> RP0, RP8
#   the hook passes only { extractBashFenceLines } (revision 2 form)    -> RP0 (checkReadingPath throws A1_INPUT)
#   one budget entry lowered by 1                                       -> RP3
#   reading_path.budget_skills reported as a literal                    -> RP0 (counted by the case from the tree)
# rpLint <root>: RP_OUT, RP_RC from `workflow lint --root <root>` (no vault).
rpLint() { RP_OUT="$(cd "$1" && env -u A1_VAULT_ROOT node "$TOOLS" workflow lint --root "$1" 2>/dev/null)"; RP_RC=$?; }
# rpOptIn <root>: opt the copied tree in to the budget check (D12a): an empty _shared/a1-tools.cjs.
rpOptIn() { mkdir -p "$1/_shared"; : > "$1/_shared/a1-tools.cjs"; }
# rpRules <json>: sorted "rule,rule" of every finding.
rpRules() { bgJs "$1" 'j.findings.map(f=>f.rule).sort().join()'; }
rpBudgetJson() { (cd "$REPO_ROOT" && env -u A1_VAULT_ROOT node "$TOOLS" workflow budget 2>/dev/null); }

caseRP0() {
  local want got; want="$(cd "$REPO_ROOT" && ls skills/*/SKILL.md | wc -l | tr -d ' ')"
  rpLint "$REPO_ROOT"; got="$(bgJs "$RP_OUT" 'j.reading_path.budget_skills')"
  if [[ $RP_RC -eq 0 && "$got" == "$want" && "$want" -gt 0 ]]; then ok "RP0 real tree: workflow lint exit 0, reading_path.budget_skills == $want SKILL.md files"
  else bad "RP0 (rc=$RP_RC got='$got' want='$want' rules='$(rpRules "$RP_OUT" 2>&1 | head -c 200)')"; fi
}
caseRP1() {
  local j missing=""; j="$(rpBudgetJson)"
  for f in skills/a1-new-feature/workflows/kritis.md skills/a1-new-feature/workflows/retro-prose.md skills/a1-execute/workflows/multi-lane.md skills/a1-plan/workflows/04b-xprov-review.md; do
    [[ "$(bgJs "$j" "j.skills.some(s=>(s.conditional||[]).includes('$f'))")" == "true" ]] || missing+=" $f"
  done
  if [[ -z "$missing" ]]; then ok "RP1 workflow budget lists the four conditional files by path"; else bad "RP1 missing:$missing"; fi
}
caseRP2() {
  local n; n="$(bgJs "$(rpBudgetJson)" 'j.skills.find(s=>s.skill==="a1-new-feature").lines')"
  if [[ "$n" =~ ^[0-9]+$ && "$n" -lt 2378 ]]; then ok "RP2 a1-new-feature default path is $n lines (below the SC-006 bound 2378)"; else bad "RP2 a1-new-feature lines '$n' (want < 2378)"; fi
}
caseRP3() {
  local over; over="$(bgJs "$(rpBudgetJson)" 'j.skills.filter(s=>s.budget===null||s.lines>s.budget).map(s=>s.skill).join()')"
  if [[ -z "$over" ]]; then ok "RP3 every skill's measured lines are at most its budget"; else bad "RP3 red: over ${over}"; fi
}
caseRP4() {
  local w; w="$(copySkills)"; rpOptIn "$w"; printf 'one more line\n' >> "$w/skills/a1-new-feature/SKILL.md"
  rpLint "$w"
  if [[ $RP_RC -eq 1 && "$(bgJs "$RP_OUT" 'j.findings.filter(f=>f.rule==="budget_exceeded"&&f.file.endsWith("skills/a1-new-feature")).length')" == "1" ]]; then ok "RP4 one appended line in a1-new-feature SKILL.md: exit 1, budget_exceeded for a1-new-feature"
  else bad "RP4 (rc=$RP_RC rules=$(rpRules "$RP_OUT"))"; fi
}
caseRP5() {
  local w; w="$(copySkills)"; printf '\nRun git worktree add by hand.\n' >> "$w/skills/a1-fix/SKILL.md"
  rpLint "$w"
  if [[ $RP_RC -eq 1 && "$(rpRules "$RP_OUT")" == "forbidden_command" ]]; then ok "RP5 an unmarked worktree add line in a1-fix SKILL.md: exit 1, forbidden_command"
  else bad "RP5 (rc=$RP_RC rules=$(rpRules "$RP_OUT"))"; fi
}
caseRP6() {
  local w f; w="$(copySkills)"; f="$w/skills/a1-plan/workflows/04-audit.md"
  awk 'NR==3{print; print "See 04b-xprov-review.md for the review."; next} {print}' "$f" > "$f.new" && mv "$f.new" "$f"
  rpLint "$w"
  if [[ $RP_RC -eq 1 && "$(rpRules "$RP_OUT")" == "conditional_ref_untriggered" ]]; then ok "RP6 04-audit names 04b-xprov-review.md above the permit fence: exit 1, conditional_ref_untriggered"
  else bad "RP6 (rc=$RP_RC rules=$(rpRules "$RP_OUT"))"; fi
}
caseRP7() {
  local w; w="$(copySkills)"
  printf '\n```bash\nnode <repo>/_shared/a1-tools.cjs retro validate --entry x\n```\n' >> "$w/skills/a1-new-feature/workflows/06-verify.md"
  rpLint "$w"
  # Documents that no lint rule owns SC-9: the planted fence passes (exit 0); RP7b below is what guards the real tree.
  if [[ $RP_RC -eq 0 && "$(grep -c 'retro validate' "$w/skills/a1-new-feature/workflows/06-verify.md")" == "1" ]]; then ok "RP7 a retro validate fence back in 06-verify: lint exit 0 (no rule), grep -c 1"
  else bad "RP7 (rc=$RP_RC rules=$(rpRules "$RP_OUT"))"; fi
  local n; n="$(grep -c 'retro validate' "$REPO_ROOT/skills/a1-new-feature/workflows/06-verify.md")"
  if [[ "$n" == "0" ]]; then ok "RP7b real tree: grep -c 'retro validate' 06-verify.md is 0"; else bad "RP7b 06-verify.md holds $n retro validate lines"; fi
}
caseRP8() {
  local w; w="$(copySkills)"
  printf '\n```bash\nnode <repo>/_shared/a1-tools.cjs vault sync x --phases\n```\n' >> "$w/skills/a1-execute/workflows/02-execute.md"
  rpLint "$w"
  if [[ $RP_RC -eq 1 && "$(bgJs "$RP_OUT" 'j.findings.filter(f=>f.rule==="sync_per_wave").length')" == "1" && "$(rpRules "$RP_OUT")" == "sync_per_wave" ]]; then ok "RP8 per-wave vault sync fence in 02-execute.md: exit 1, exactly one sync_per_wave finding (CLI form of W12)"
  else bad "RP8 (rc=$RP_RC rules=$(rpRules "$RP_OUT"))"; fi
}
