# Cases FL1-FL17: flow rules D8-D10 and the event-store blocks (spec 027 slice 4, FR-019/021/022).
# Sourced by run-tests.sh (uses ok, bad, REPO_ROOT, copySkills, mk_workdir).
# The rules are tested at module level: workflow-lint-flow.cjs is not hooked into the CLI before Wave 5.

FL_LIB="$REPO_ROOT/_shared/lib/workflow-lint-flow.cjs"
FL_EX="skills/a1-execute/workflows/02-execute.md"
FL_IMPL="skills/a1-new-feature/workflows/05-implement.md"
FL_VER="skills/a1-new-feature/workflows/06-verify.md"
FL_DRAFT="skills/a1-pr-review/workflows/03-draft.md"
FL_SUBMIT="skills/a1-pr-review/workflows/04-submit.md"

# flRun <root> <isSkills 1|0>: prints "<checked> <rule,rule,...>" over the three rules.
flRun() {
  node -e '
    const f=require(process.argv[1]); const sk=process.argv[3]==="1"; const t=()=>sk;
    const rs=[f.checkEarlyReview(process.argv[2],t),f.checkWaveCheckpoint(process.argv[2],t),f.checkPrConfirmation(process.argv[2],t)];
    const fnd=[].concat(...rs.map(r=>r.findings));
    process.stdout.write(rs.reduce((n,r)=>n+r.checked,0)+" "+fnd.map(x=>x.rule+(x.reason.startsWith("file missing")?":missing":"")).join(","));
  ' "$FL_LIB" "$1" "$2" 2>&1
}

# flAppend <id> <rel> <text> <want>: append text to a file in a skills copy, expect the summary.
flAppend() {
  local id="$1" rel="$2" text="$3" want="$4" work sum
  work="$(copySkills)"; printf '\n%s\n' "$text" >> "$work/$rel"
  sum="$(flRun "$work" 1)"
  if [[ "$sum" == "$want" ]]; then ok "$id"; else bad "$id (sum='$sum' want='$want')"; fi
}

caseFL1() { local s; s="$(flRun "$REPO_ROOT" 1)"
  if [[ "$s" == "5 " ]]; then ok "FL1 real tree: 5 files, 0 findings"; else bad "FL1 real tree (sum='$s')"; fi; }
caseFL2() { local w s; mk_workdir w w; s="$(flRun "$w" 0)"
  if [[ "$s" == "0 " ]]; then ok "FL2 non-skills root: checked 0"; else bad "FL2 non-skills root (sum='$s')"; fi; }
caseFL3() { flAppend "FL3 reviewer spawn in 06-verify.md" "$FL_VER" 'Spawn a1-reinhard-reviewer' "5 verify-early-review"; }
caseFL4() { flAppend "FL4 prompt outside a stop block" "$FL_EX" 'Continue? [y to proceed / n to stop]' "5 wave-checkpoint"; }
caseFL5() { flAppend "FL5 prompt inside a stop block" "$FL_EX" $'<!-- a1:stop -->\nContinue? [y to proceed / n to stop]\n<!-- /a1:stop -->' "5 "; }
caseFL6() { flAppend "FL6 unclosed stop block" "$FL_IMPL" '<!-- a1:stop -->' "5 wave-checkpoint"; }
caseFL7() { flAppend "FL7 PR creation question in 03-draft.md" "$FL_DRAFT" \
  'Should I create the PR now with gh (Phase 4)? (yes / no / adjust draft)' "5 pr-confirmation"; }
caseFL8() { flAppend "FL8 Are you sure in 04-submit.md" "$FL_SUBMIT" \
  '> "Are you sure you want to create the PR now? (yes / no)"' "5 pr-confirmation"; }
caseFL9() {
  local s; s="$(flRun "$REPO_ROOT" 1)"
  if [[ "$s" == "5 " ]] && grep -q 'force-with-lease' "$REPO_ROOT/$FL_SUBMIT"; then ok "FL9 force-push lines stay, no finding"
  else bad "FL9 force-push lines (sum='$s')"; fi
}
caseFL10() { local w s; w="$(copySkills)"; rm "${w:?}/${FL_SUBMIT:?}"; s="$(flRun "$w" 1)"
  if [[ "$s" == "5 pr-confirmation:missing" ]]; then ok "FL10 04-submit.md deleted: file missing"; else bad "FL10 (sum='$s')"; fi; }
caseFL11() { flAppend "FL11 Once the user confirms outside a stop block" "$FL_IMPL" \
  'Once the user confirms (or names a different agent), spawn the agent' "5 wave-checkpoint"; }

# ---------- event-store runs (real git, real block text) ----------
# flPlant: sets FL_T FL_REPO FL_WT FL_CWD FL_HOME FL_GC. Call directly, not in $(...).
flPlant() {
  mk_workdir FL_T fl
  FL_HOME="$FL_T/home"; FL_REPO="$FL_T/repo"; FL_WT="$FL_T/wt"; FL_CWD="$FL_T/cwd"; FL_GC="$FL_T/gitconfig"
  mkdir -p "$FL_HOME" "$FL_REPO" "$FL_CWD"
  printf '[user]\n\tname = fx\n\temail = fx@example.invalid\n[commit]\n\tgpgsign = false\n[core]\n\thooksPath = /dev/null\n' > "$FL_GC"
  flGit "$FL_REPO" init -q -b main
  : > "$FL_REPO/a.txt"; flGit "$FL_REPO" add a.txt; flGit "$FL_REPO" commit -q -m init
  flGit "$FL_REPO" worktree add -q -b feat "$FL_WT"
}
flGit() { local d="$1"; shift; env HOME="$FL_HOME" GIT_CONFIG_GLOBAL="${FL_GC_USE:-$FL_GC}" git -C "$d" "$@"; }

# flBlock <file> <heading> [k v]...: first bash fence after the heading line, placeholders replaced.
flBlock() {
  node -e '
    const a=process.argv.slice(1); const L=require("fs").readFileSync(a[0],"utf8").split("\n");
    let i=L.findIndex(l=>l.includes(a[1])); while(!L[i].startsWith("```bash")) i++;
    let j=i+1; while(!L[j].startsWith("```")) j++;
    let t=L.slice(i+1,j).join("\n");
    for(let k=2;k<a.length;k+=2) t=t.split(a[k]).join(a[k+1]);
    process.stdout.write(t+"\n");
  ' "$REPO_ROOT/$1" "${@:2}"
}
# flExec <script>: run it with bash from FL_CWD, same git environment.
flExec() { ( cd "$FL_CWD" && env HOME="$FL_HOME" GIT_CONFIG_GLOBAL="${FL_GC_USE:-$FL_GC}" WORK_PATH="$FL_WT" bash "$1" ); }

FL_GOAL='it'"'"'s a "goal" with $(touch PWNED)'
flPhaseBlock() { flBlock "$FL_EX" 'Phase start' '<phase_name>' ph '<phase_goal>' "$FL_GOAL" > "$FL_T/b.sh"; }
flStoreChecks() { # <phase> <goal-line>: echoes "ok" or a reason
  local ph="$1" want="$2" st files first pw
  st="$(flGit "$FL_WT" status --porcelain --untracked-files=all)"
  files="$(flGit "$FL_WT" show --name-only --format= HEAD)"
  first="$(head -n 1 "$FL_WT/.a1/phases/$ph/GOAL.md")"
  pw="$(find "$FL_T" -name PWNED | head -n 1)"
  if [[ -n "$st" ]]; then echo "dirty:$st"; return; fi
  [[ "$files" == *".a1/phases/$ph/GOAL.md"* && "$files" == *".a1/phases/$ph/observations.jsonl"* ]] || { echo "files:$files"; return; }
  [[ "$first" == "$want" ]] || { echo "goal:$first"; return; }
  [[ -z "$pw" ]] || { echo "PWNED:$pw"; return; }
  echo ok
}

caseFL12() {
  local rc r; flPlant; flPhaseBlock; flExec "$FL_T/b.sh" >/dev/null 2>&1; rc=$?
  r="$(flStoreChecks ph "# Goal: $FL_GOAL")"
  if [[ $rc -eq 0 && "$r" == ok ]]; then ok "FL12 Phase-start block: exit 0, committed, goal verbatim, no PWNED"
  else bad "FL12 Phase-start block (rc=$rc $r)"; fi
}
caseFL12b() {
  local rc1 rc2 n0 n1 r hk; flPlant; flPhaseBlock
  n0="$(flGit "$FL_WT" rev-list --count HEAD)"
  hk="$FL_T/hooks"; mkdir -p "$hk"; printf '#!/bin/sh\nexit 1\n' > "$hk/pre-commit"; chmod +x "$hk/pre-commit"
  sed "s#/dev/null#$hk#" "$FL_GC" > "$FL_T/gitconfig-hook"
  FL_GC_USE="$FL_T/gitconfig-hook" flExec "$FL_T/b.sh" >/dev/null 2>&1; rc1=$?
  flExec "$FL_T/b.sh" >/dev/null 2>&1; rc2=$?
  n1="$(flGit "$FL_WT" rev-list --count HEAD)"; r="$(flStoreChecks ph "# Goal: $FL_GOAL")"
  if [[ $rc1 -ne 0 && $rc2 -eq 0 && $((n1 - n0)) -eq 1 && "$r" == ok ]]; then ok "FL12b re-run after a failed commit commits the staged stores"
  else bad "FL12b failed-commit recovery (rc1=$rc1 rc2=$rc2 commits+=$((n1 - n0)) $r)"; fi
}
caseFL13() {
  local n0 n1 rc st; flPlant; flPhaseBlock; flExec "$FL_T/b.sh" >/dev/null 2>&1
  n0="$(flGit "$FL_WT" rev-list --count HEAD)"
  flExec "$FL_T/b.sh" >/dev/null 2>&1; rc=$?
  n1="$(flGit "$FL_WT" rev-list --count HEAD)"; st="$(flGit "$FL_WT" status --porcelain --untracked-files=all)"
  if [[ $rc -eq 0 && "$n0" == "$n1" && -z "$st" ]]; then ok "FL13 second run: no new commit, status clean"
  else bad "FL13 second run (rc=$rc $n0->$n1 st='$st')"; fi
}
caseFL14() {
  local rc r title='Rob'"'"'s "title"'; flPlant
  flBlock "$FL_IMPL" 'Step 1b' '<dir>' "$FL_WT" '<spec-id>' fx-spec '<spec title>' "$title" > "$FL_T/b.sh"
  flExec "$FL_T/b.sh" >/dev/null 2>&1; rc=$?
  r="$(flStoreChecks fx-spec "# Goal: $title")"
  if [[ $rc -eq 0 && "$r" == ok ]]; then ok "FL14 Step 1b block: exit 0, committed, title verbatim"
  else bad "FL14 Step 1b block (rc=$rc $r)"; fi
}
caseFL15() {
  local rc1 rc2 b side n P=".a1/phases/ph"; flPlant; flPhaseBlock; flExec "$FL_T/b.sh" >/dev/null 2>&1
  for side in a b; do
    flGit "$FL_WT" checkout -q -b "l$side" feat
    echo "{\"side\":\"$side\"}" >> "$FL_WT/$P/observations.jsonl"
    n=1; [[ $side == b ]] && n=2
    echo "- 2026-11-20T10:0$n:00Z — x$side — affects: y" >> "$FL_WT/$P/GOAL.md"
    flGit "$FL_WT" commit -q -am "l$side"
  done
  flGit "$FL_WT" checkout -q feat
  flGit "$FL_WT" merge -q --no-edit la >/dev/null 2>&1; rc1=$?
  flGit "$FL_WT" merge -q --no-edit lb >/dev/null 2>&1; rc2=$?
  b="$(cat "$FL_WT/$P/observations.jsonl" "$FL_WT/$P/GOAL.md")"
  if [[ $rc1 -eq 0 && $rc2 -eq 0 && "$b" == *'"side":"a"'* && "$b" == *'"side":"b"'* && "$b" == *xa* && "$b" == *xb* ]]; then
    ok "FL15 union merge keeps both lines and both rows"
  else bad "FL15 union merge (rc1=$rc1 rc2=$rc2)"; fi
}
caseFL16() {
  local rc; flPlant; flPhaseBlock; flExec "$FL_T/b.sh" >/dev/null 2>&1
  flGit "$FL_REPO" worktree remove "$FL_WT" >/dev/null 2>&1; rc=$?
  if [[ $rc -eq 0 ]]; then ok "FL16 worktree remove without --force exits 0"; else bad "FL16 worktree remove (rc=$rc)"; fi
}

# FL17: each store-append paragraph holds a git -C ... commit ... -- <store file> command (the line may continue).
flHas() { # <file> <from> <to|""> <regex>
  node -e '
    const [f,from,to,re]=process.argv.slice(1); const t=require("fs").readFileSync(f,"utf8");
    const s=t.indexOf(from); if(s<0) process.exit(2);
    let e=to?t.indexOf(to,s+from.length):t.indexOf("\n## ",s+from.length); if(e<0) e=t.length;
    process.exit(new RegExp(re).test(t.slice(s,e))?0:1);
  ' "$REPO_ROOT/$1" "$2" "$3" "$4"
}
caseFL17() {
  local g='git -C [^\n]*commit [^\n]* -- "[^"\n]*' a b c
  flHas "$FL_EX" '**Mid-run decision' '' "$g"'GOAL\.md"'; a=$?
  flHas "$FL_IMPL" "When the agent's hand-back reports" '**Mid-run decision rule.**' "$g"'observations\.jsonl"'; b=$?
  flHas "$FL_IMPL" '**Mid-run decision rule.**' '' "$g"'GOAL\.md"'; c=$?
  if [[ $a -eq 0 && $b -eq 0 && $c -eq 0 ]]; then ok "FL17 append paragraphs commit their store file"
  else bad "FL17 append commits (02-execute=$a 05-f=$b 05-g=$c)"; fi
}

# ---------- review fix round 1 (PR #108): m6 and n2 ----------
# FL18 (m6): a GOAL.md that has `## Decisions needed` but no `## Decisions` heading gets the heading appended (the guard is as strict as the parser).
flGoalNeeded() { # <phase> : plants a committed GOAL.md with only a "## Decisions needed" heading
  local d="$FL_WT/.a1/phases/$1"; mkdir -p "$d"
  printf '# Goal: x\n\n## Decisions needed\n- foo\n' > "$d/GOAL.md"; : > "$d/observations.jsonl"
  flGit "$FL_WT" add -A; flGit "$FL_WT" commit -q -m seed
}
caseFL18() {
  local rc; flPlant; flGoalNeeded ph; flPhaseBlock; flExec "$FL_T/b.sh" >/dev/null 2>&1; rc=$?
  if [[ $rc -eq 0 ]] && grep -qE '^##[[:space:]]+Decisions[[:space:]]*$' "$FL_WT/.a1/phases/ph/GOAL.md"; then ok "FL18 02-execute block: '## Decisions needed' does not satisfy the guard, the heading is appended"
  else bad "FL18 02-execute guard (rc=$rc)"; fi
}
caseFL18b() {
  local rc; flPlant; flGoalNeeded fx-spec
  flBlock "$FL_IMPL" 'Step 1b' '<dir>' "$FL_WT" '<spec-id>' fx-spec '<spec title>' t > "$FL_T/b.sh"
  flExec "$FL_T/b.sh" >/dev/null 2>&1; rc=$?
  if [[ $rc -eq 0 ]] && grep -qE '^##[[:space:]]+Decisions[[:space:]]*$' "$FL_WT/.a1/phases/fx-spec/GOAL.md"; then ok "FL18b 05-implement Step 1b block: same strict guard"
  else bad "FL18b 05-implement guard (rc=$rc)"; fi
}
# FL19 (n2): the documented removal command drops exactly the two union lines, also when they are the only lines.
caseFL19() {
  local cmd t a keep='*.bin merge=union' u1='.a1/phases/*/observations.jsonl merge=union' u2='.a1/phases/*/GOAL.md merge=union'
  mk_workdir t fl19
  cmd="$(node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const m=/`((?:\{ )?grep -v[^`\n]*"\$A\.new" && mv[^`\n]*)`/.exec(t);process.stdout.write(m?m[1]:"")' "$REPO_ROOT/$FL_EX")"
  a="$t/attributes"; printf '%s\n%s\n%s\n' "$u1" "$keep" "$u2" > "$a"
  ( A="$a"; eval "$cmd" ) >/dev/null 2>&1; local rc1=$? left1; left1="$(cat "$a")"
  printf '%s\n%s\n' "$u1" "$u2" > "$a"
  ( A="$a"; eval "$cmd" ) >/dev/null 2>&1; local rc2=$? left2; left2="$(cat "$a")"
  if [[ -n "$cmd" && $rc1 -eq 0 && "$left1" == "$keep" && $rc2 -eq 0 && -z "$left2" ]]; then ok "FL19 removal command keeps unrelated lines and also empties a file holding only the union lines"
  else bad "FL19 removal command (cmd='$cmd' rc1=$rc1 left1='$left1' rc2=$rc2 left2='$left2')"; fi
}

# ---------- review fix round 2 (PR #108): SEC-4 ----------
# FL20: the phase name / spec id is validated in the block itself (the value is placed in single quotes, so $(...) never runs
# before the guard); an invalid value stops with exit 2 and creates nothing.
caseFL20() {
  local bad_ok=1 v rc made pw; flPlant
  for v in '$(touch PWNED)' 'a b' '../x' '-lead' 'a;b' '.hid'; do
    flBlock "$FL_EX" 'Phase start' '<phase_name>' "$v" '<phase_goal>' g > "$FL_T/b.sh"
    flExec "$FL_T/b.sh" >/dev/null 2>&1; rc=$?
    made="$(find "$FL_WT/.a1" -mindepth 2 2>/dev/null | head -n 1)"; pw="$(find "$FL_T" -name PWNED | head -n 1)"
    if [[ $rc -ne 2 || -n "$made" || -n "$pw" ]]; then bad_ok=0; bad "FL20 02-execute block accepted phase name '$v' (rc=$rc made='$made' pw='$pw')"; fi
  done
  if [[ $bad_ok -eq 1 ]]; then ok "FL20 02-execute block: six invalid phase names exit 2, create nothing, run nothing"; fi
}
caseFL20b() {
  local bad_ok=1 v rc made pw; flPlant
  for v in '$(touch PWNED)' 'a b' '../x' 'x`y`'; do
    flBlock "$FL_IMPL" 'Step 1b' '<dir>' "$FL_WT" '<spec-id>' "$v" '<spec title>' t > "$FL_T/b.sh"
    flExec "$FL_T/b.sh" >/dev/null 2>&1; rc=$?
    made="$(find "$FL_WT/.a1" -mindepth 2 2>/dev/null | head -n 1)"; pw="$(find "$FL_T" -name PWNED | head -n 1)"
    if [[ $rc -ne 2 || -n "$made" || -n "$pw" ]]; then bad_ok=0; bad "FL20b 05-implement Step 1b accepted spec id '$v' (rc=$rc made='$made' pw='$pw')"; fi
  done
  if [[ $bad_ok -eq 1 ]]; then ok "FL20b 05-implement Step 1b: four invalid spec ids exit 2, create nothing, run nothing"; fi
}
caseFL20c() {
  local f a=0 b=0
  for f in "$FL_EX" "$FL_IMPL"; do
    grep -qF '^[A-Za-z0-9_][A-Za-z0-9._-]*$' "$REPO_ROOT/$f" && grep -qiE 'strip(s)? (all )?newlines' "$REPO_ROOT/$f" || { [[ $f == "$FL_EX" ]] && a=1 || b=1; }
  done
  if [[ $a -eq 0 && $b -eq 0 ]]; then ok "FL20c both blocks' prose mandates the name regex and newline stripping"
  else bad "FL20c prose mandate missing (02-execute=$a 05-implement=$b)"; fi
}
