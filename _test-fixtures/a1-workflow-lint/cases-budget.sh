# Cases BG1-BG15: counting function and `workflow budget` module (spec 027 slice 5, FR-027, plan Task 1.1, D8/D12/D12a).
# Sourced by run-tests.sh (uses ok, bad, REPO_ROOT, mk_workdir). The modules are called directly through
# `require(...).cmdWorkflowBudget`, never through the facade (the facade line lands in Task 10.2).
#
# Measured red 2026-11-23 (scratch copy, one edit each, suite run, file restored):
#   countLines as split('\n').length          -> BG2
#   the trailer check skipped                 -> BG9
#   malformed header treated as conditional   -> BG8
#   budget_unknown_skill rule dropped         -> BG6
#   scope also on skills/reading-budget.json  -> BG13
#   `lines >= budget`                         -> BG14
#   scope test removed from the CLI path      -> BG15a

BG_LIB="$REPO_ROOT/_shared/lib/workflow-budget.cjs"
BG_LINT="$REPO_ROOT/_shared/lib/workflow-lint-budget.cjs"

# bgLines <n>: n newline-terminated lines.
bgLines() { local i; for ((i = 1; i <= $1; i++)); do printf 'line %s\n' "$i"; done; }

# bgPlant <varname> <x-workflow-lines> <x-budget>: an opted-in tree (empty _shared/a1-tools.cjs). x default path = 5 + workflow lines.
bgPlant() {
  local _bw
  mk_workdir _bw bg
  mkdir -p "$_bw/_shared" "$_bw/skills/a1-plan" "$_bw/skills/x/workflows"
  : > "$_bw/_shared/a1-tools.cjs"
  bgLines 3 > "$_bw/skills/a1-plan/SKILL.md"
  bgLines 5 > "$_bw/skills/x/SKILL.md"
  bgLines "$2" > "$_bw/skills/x/workflows/01-a.md"
  printf '{"schema":1,"budgets":{"a1-plan":3,"x":%s}}\n' "$3" > "$_bw/skills/reading-budget.json"
  printf -v "$1" '%s' "$_bw"
}

# bgRun <cwd> <args...>: sets BG_OUT (stdout) and BG_RC. Isolated env: no vault, HOME under the temp root.
bgRun() {
  local cwd="$1"; shift
  case " $* " in *" --root "*) ;; *) [[ -n "${BG_NOROOT:-}" ]] || set -- --root "$cwd" "$@" ;; esac
  BG_OUT="$(cd "$cwd" && env -u A1_VAULT_ROOT HOME="$cwd" node -e 'require(process.argv[1]).cmdWorkflowBudget(process.argv.slice(2))' "$BG_LIB" "$@" 2>/dev/null)"; BG_RC=$?
}

# bgJs <json> <js expr on j>
bgJs() { node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(String('"$2"'))' "$1" 2>&1; }

bgGit() { local r="$1"; shift; git -C "$r" -c user.name=fx -c user.email=fx@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"; }

caseBG1() {
  local a b
  a="$(cd "$REPO_ROOT" && ls skills/*/SKILL.md skills/*/workflows/*.md | while IFS= read -r f; do printf '%s %s\n' "$f" "$(wc -l < "$f" | tr -d ' ')"; done)"
  b="$(cd "$REPO_ROOT" && node -e 'const l=require(process.argv[1]),fs=require("fs");for(const f of process.argv.slice(2))console.log(f+" "+l.countLines(fs.readFileSync(f,"utf8")))' "$BG_LINT" $(ls skills/*/SKILL.md skills/*/workflows/*.md))"
  if [[ -n "$a" && "$a" == "$b" ]]; then ok "BG1 countLines equals wc -l for every real SKILL.md and workflow"; else bad "BG1 countLines vs wc -l differ"; fi
}
caseBG2() {
  local n; n="$(node -e 'const l=require(process.argv[1]);process.stdout.write(l.countLines("a\nb")+","+l.countLines("a\nb\n")+","+l.countLines(""))' "$BG_LINT" 2>&1)"
  if [[ "$n" == "1,2,0" ]]; then ok "BG2 a last line without newline is not counted"; else bad "BG2 (got $n)"; fi
}
caseBG3() {
  local w; bgPlant w 4 8; bgRun "$w"
  if [[ $BG_RC -eq 1 && "$(bgJs "$BG_OUT" 'j.findings.map(f=>f.rule+"@"+f.file).join()')" == "budget_exceeded@skills/x" ]]; then ok "BG3 over budget: exit 1, finding names x"; else bad "BG3 (rc=$BG_RC out=$BG_OUT)"; fi
}
caseBG4() {
  local w; bgPlant w 4 9; bgRun "$w"
  if [[ $BG_RC -eq 0 && "$(bgJs "$BG_OUT" 'j.scope+":"+j.findings.length')" == "in:0" ]]; then ok "BG4 under budget: exit 0"; else bad "BG4 (rc=$BG_RC out=$BG_OUT)"; fi
}
caseBG5() {
  local w; bgPlant w 4 9; printf '{"schema":1,"budgets":{"a1-plan":3}}\n' > "$w/skills/reading-budget.json"; bgRun "$w"
  if [[ $BG_RC -eq 1 && "$(bgJs "$BG_OUT" 'j.findings.map(f=>f.rule).join()')" == "budget_missing_entry" ]]; then ok "BG5 missing entry: budget_missing_entry"; else bad "BG5 (rc=$BG_RC out=$BG_OUT)"; fi
}
caseBG6() {
  local w; bgPlant w 4 9; printf '{"schema":1,"budgets":{"a1-plan":3,"x":9,"ghost":4}}\n' > "$w/skills/reading-budget.json"; bgRun "$w"
  if [[ $BG_RC -eq 1 && "$(bgJs "$BG_OUT" 'j.findings.map(f=>f.rule).join()')" == "budget_unknown_skill" ]]; then ok "BG6 unknown entry: budget_unknown_skill"; else bad "BG6 (rc=$BG_RC out=$BG_OUT)"; fi
}
caseBG7() {
  local w; bgPlant w 4 9; printf '{not json' > "$w/skills/reading-budget.json"; bgRun "$w"
  if [[ $BG_RC -eq 1 && "$(bgJs "$BG_OUT" 'j.findings.map(f=>f.rule).join()')" == "budget_file_invalid" ]]; then ok "BG7 invalid JSON: budget_file_invalid"; else bad "BG7 (rc=$BG_RC out=$BG_OUT)"; fi
}
caseBG8() {
  local w; bgPlant w 4 9
  { printf '<!-- load: conditional trigger=profile resolve -->\n'; bgLines 50; } > "$w/skills/x/workflows/02-cond.md"
  { printf '<!-- load: conditional trigger=Bad Trigger -->\n'; bgLines 2; } > "$w/skills/x/workflows/03-bad.md"
  bgRun "$w"
  # 03-bad is counted (9 + 3 = 12 > 9) and flagged malformed; 02-cond is not counted.
  if [[ $BG_RC -eq 1 && "$(bgJs "$BG_OUT" 'j.findings.map(f=>f.rule).sort().join()')" == "budget_exceeded,conditional_header_malformed" && "$(bgJs "$BG_OUT" 'j.skills.find(s=>s.skill==="x").lines')" == "12" ]]; then
    ok "BG8 conditional file not counted; malformed header counted and flagged"
  else bad "BG8 (rc=$BG_RC out=$BG_OUT)"; fi
}

# bgRepo <varname> <x-budget>: a git repo with the opted-in tree, base commit holds the budget file.
bgRepo() {
  local _rw; bgPlant _rw 2 "$2"; rm -f "$_rw/skills/a1-plan/SKILL.md"; rmdir "$_rw/skills/a1-plan"
  printf '{"schema":1,"budgets":{"x":%s}}\n' "$2" > "$_rw/skills/reading-budget.json"
  bgGit "$_rw" init -q && bgGit "$_rw" add -A && bgGit "$_rw" commit -qm base
  printf -v "$1" '%s' "$_rw"
}
bgHead() { printf '{"schema":1,"budgets":{"x":%s}}\n' "$2" > "$1/skills/reading-budget.json"; bgGit "$1" add -A; shift 2; bgGit "$@"; }

caseBG9() {
  local w; bgRepo w 10; bgHead "$w" 12 "$w" commit -qm "raise"
  bgRun "$w" --base HEAD~1
  if [[ $BG_RC -eq 1 && "$(bgJs "$BG_OUT" 'j.findings.map(f=>f.rule).join()')" == "budget_raised:x" ]]; then ok "BG9 raised entry without trailer: budget_raised:x"; else bad "BG9 (rc=$BG_RC out=$BG_OUT)"; fi
}
caseBG10() {
  local w; bgRepo w 10; bgHead "$w" 12 "$w" commit -qm "raise" -m "budget-raise: x"
  bgRun "$w" --base HEAD~1
  if [[ $BG_RC -eq 0 && "$(bgJs "$BG_OUT" 'j.raised.join()')" == "x" ]]; then ok "BG10 trailer budget-raise: x clears the ratchet"; else bad "BG10 (rc=$BG_RC out=$BG_OUT)"; fi
}
caseBG11() {
  local w; bgRepo w 10; bgHead "$w" 8 "$w" commit -qm "lower"
  bgRun "$w" --base HEAD~1
  if [[ $BG_RC -eq 0 && "$(bgJs "$BG_OUT" 'j.findings.length+":"+j.raised.length')" == "0:0" ]]; then ok "BG11 lowered entry: exit 0"; else bad "BG11 (rc=$BG_RC out=$BG_OUT)"; fi
}
caseBG12() {
  local w; bgRepo w 10
  bgRun "$w" --base nope
  local rc_a=$BG_RC
  # base without the budget file: the base commit lacks it, the head commit adds it
  local u; bgPlant u 2 7; rm "$u/skills/reading-budget.json"; bgGit "$u" init -q; bgGit "$u" add -A; bgGit "$u" commit -qm base
  printf '{"schema":1,"budgets":{"a1-plan":3,"x":7}}\n' > "$u/skills/reading-budget.json"; bgGit "$u" add -A; bgGit "$u" commit -qm head
  bgRun "$u" --base HEAD~1
  if [[ $rc_a -eq 2 ]]; then ok "BG12a unresolvable --base nope: exit 2"; else bad "BG12a (rc=$rc_a)"; fi
  if [[ $BG_RC -eq 0 && "$(bgJs "$BG_OUT" 'j.base.budget')" == "absent" ]]; then ok "BG12b base without the file: exit 0, base.budget absent"; else bad "BG12b (rc=$BG_RC out=$BG_OUT)"; fi
  bgRun "$w" --write; local h1; h1="$(shasum "$w/skills/reading-budget.json" | cut -d' ' -f1)"
  bgRun "$w" --write; local h2; h2="$(shasum "$w/skills/reading-budget.json" | cut -d' ' -f1)"
  if [[ $BG_RC -eq 0 && "$h1" == "$h2" && "$(bgJs "$(cat "$w/skills/reading-budget.json")" 'j.budgets.x+":"+j.schema')" == "7:1" ]]; then ok "BG12c --write twice gives a byte-identical file"; else bad "BG12c (rc=$BG_RC h1=$h1 h2=$h2)"; fi
}
caseBG13() {
  local w; bgPlant w 4 8; rm "$w/_shared/a1-tools.cjs"
  local r; r="$(node -e 'const r=require(process.argv[1]).checkBudget(process.argv[2]);process.stdout.write(r.checked+":"+r.findings.length)' "$BG_LINT" "$w" 2>&1)"
  if [[ "$r" == "0:0" ]]; then ok "BG13 copied skills/ tree without _shared/a1-tools.cjs: no budget check"; else bad "BG13 (got $r)"; fi
}
caseBG14() {
  local w; bgPlant w 4 9; bgRun "$w"
  local a=$BG_RC; bgPlant w 4 8; bgRun "$w"
  if [[ $a -eq 0 && $BG_RC -eq 1 ]]; then ok "BG14 lines == budget passes, lines > budget fails"; else bad "BG14 (equal rc=$a over rc=$BG_RC)"; fi
}
caseBG15() {
  local w; mk_workdir w bg15
  bgGit "$w" init -q; echo a > "$w/a.txt"; bgGit "$w" add -A; bgGit "$w" commit -qm one; echo b >> "$w/a.txt"; bgGit "$w" add -A; bgGit "$w" commit -qm two
  local ex='j.scope+":"+j.skills.length+":"+j.findings.length'
  bgRun "$w" --root "$w" --base HEAD~1
  if [[ $BG_RC -eq 0 && "$(bgJs "$BG_OUT" "$ex")" == "out:0:0" ]]; then ok "BG15a consumer repo --root --base: exit 0, scope out"; else bad "BG15a (rc=$BG_RC out=$BG_OUT)"; fi
  BG_NOROOT=1 bgRun "$w" --base HEAD~1
  if [[ $BG_RC -eq 0 && "$(bgJs "$BG_OUT" 'j.scope')" == "out" ]]; then ok "BG15b default root (git top level): scope out"; else bad "BG15b (rc=$BG_RC out=$BG_OUT)"; fi
  bgRun "$w" --root "$w" --base ""
  if [[ $BG_RC -eq 0 ]]; then ok "BG15c empty --base out of scope: exit 0"; else bad "BG15c (rc=$BG_RC out=$BG_OUT)"; fi
  mkdir -p "$w/skills/x"; bgLines 3 > "$w/skills/x/SKILL.md"; bgGit "$w" add -A; bgGit "$w" commit -qm skills
  bgRun "$w" --root "$w" --base HEAD~1
  if [[ $BG_RC -eq 0 && "$(bgJs "$BG_OUT" 'j.scope')" == "out" ]]; then ok "BG15d skills/ without the facade: scope out"; else bad "BG15d (rc=$BG_RC out=$BG_OUT)"; fi
  bgRun "$w" --root "$w" --write
  if [[ $BG_RC -eq 2 && ! -e "$w/skills/reading-budget.json" ]]; then ok "BG15e --write out of scope: exit 2, no file created"; else bad "BG15e (rc=$BG_RC)"; fi
}
