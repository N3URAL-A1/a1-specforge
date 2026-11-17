# Sourced by run-tests.sh (spec 027 slice 2, FR-008, wave 3). Uses the suite helpers newproj/stub/cfg/seal/vrun/vcheck/check/check_rc/g/ok/bad.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# The report copy under <git-common-dir>/a1-verify-reports and `verify reuse` (D7, D8, Clarification 2026-11-16).
# RED-proof (wave 3 report): checkReuse skips the scope check -> RU4b; skips the tree check -> RU6a; statSync instead of lstatSync -> RU8;
# copy also written with --base -> RU10; prune keeps everything -> RU9; findCandidate HEAD only -> RU13; changedOutsideA1 skipped -> RU14;
# directory mode check removed -> RU17.

RUCFG='{"commands":[{"id":"u","argv":["./bin/ok"]}]}'
modeof() { node -e 'console.log((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$1"; }
# vreuse <proj> <sha> [extra args] -> OUT, RC, ERR
vreuse() {
  local p="$1" s="$2"; shift 2
  OUT="$(cd "$p" && node "$TOOLS" verify reuse --head "$s" "$@" 2>"$WORK/err")"; RC=$?
  ERR="$(cat "$WORK/err")"
}
rhead() { g "$P" rev-parse HEAD; }
rdir() { printf '%s/.git/a1-verify-reports' "$P"; }
# ruproj <label> [stub body] -> $P on branch feat with a green stub, committed
ruproj() { newproj "$1"; stub ok "${2:-exit 0}"; cfg "$RUCFG"; seal; }
# plant <js mutating r> : writes $F from $ORIG (mode 0600)
plant() {
  node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); eval(process.argv[3]); fs.writeFileSync(process.argv[2], JSON.stringify(r)+"\n"); fs.chmodSync(process.argv[2], 0o600);' "$ORIG" "$F" "$1"
}

# RU1 / RU2 / RU3
ruproj ru1; vrun "$P" --no-cache; R1="$(rhead)"
check "RU1 green full run: report_copy.path ends in a1-verify-reports/<sha>-full.json" 0 'j.report_copy.path.endsWith("/a1-verify-reports/"+j.head_sha+"-full.json")+"/"+j.tree_clean+"/"+j.scope' "true/true/full"
F1="$(rdir)/$R1-full.json"
[[ -f "$F1" && "$(modeof "$F1")" == "600" && "$(modeof "$(rdir)")" == "700" ]] && ok "RU1b copy exists, mode 600, directory mode 700" || bad "RU1b copy/modes (file=$(modeof "$F1" 2>&1) dir=$(modeof "$(rdir)" 2>&1))"
SAME="$(node -e 'const fs=require("fs"); const a=JSON.parse(process.argv[1]); delete a.ok; delete a.out; delete a.report_copy; process.stdout.write(String(JSON.stringify(a)===JSON.stringify(JSON.parse(fs.readFileSync(process.argv[2],"utf8")))))' "$OUT" "$F1")"
[[ "$SAME" == "true" ]] && ok "RU1c copy equals the stdout record without ok, out, report_copy" || bad "RU1c content differs"
vreuse "$P" "$R1"
check "RU2 reuse for the same sha: exit 0, report_sha = sha, 0 later commits" 0 'j.ok+"/"+(j.report_sha==="'"$R1"'")+"/"+j.a1_only_commits+"/"+j.reason' "true/true/0/null"
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am "code"
vreuse "$P" "$R1"
check "RU3 reuse with an old sha after a new commit: exit 1 head_moved" 1 'j.reason' "head_moved"

# RU4: affected report, a code commit after the full one
R4="$(rhead)"; vrun "$P" --affected --no-cache
[[ -f "$(rdir)/$R4-affected.json" && ! -e "$(rdir)/$R4-full.json" ]] && ok "RU4 --affected run writes <sha>-affected.json only" || bad "RU4 affected copy name"
vreuse "$P" "$R4"
check "RU4a nearest full report is older and a code commit follows: exit 1 code_changed_after_run" 1 'j.reason+"/"+(j.report_sha==="'"$R1"'")' "code_changed_after_run/true"
cp "$(rdir)/$R4-affected.json" "$(rdir)/$R4-full.json"; chmod 600 "$(rdir)/$R4-full.json"
vreuse "$P" "$R4"
check "RU4b a -full.json whose content says scope affected: exit 1 scope_not_full" 1 'j.reason' "scope_not_full"

# RU5: red run
ruproj ru5; vrun "$P" --no-cache; printf '#!/usr/bin/env bash\nexit 1\n' > "$P/bin/ok"; g "$P" commit -q -am "red stub"
vrun "$P" --no-cache; R5="$(rhead)"
check_rc "RU5 red run: exit 1" 1
[[ -f "$(rdir)/$R5-full.json" ]] && ok "RU5b red run still leaves its copy" || bad "RU5b no copy for the red run"
vreuse "$P" "$R5"
check "RU5c reuse of a red report: exit 1 verdict_not_pass" 1 'j.reason' "verdict_not_pass"

# RU6: dirty trees
ruproj ru6; vrun "$P" --no-cache; R6="$(rhead)"
printf 'x\n' > "$P/src/new.js"
vreuse "$P" "$R6"
check "RU6a untracked src/new.js after a green run: exit 1 tree_dirty" 1 'j.reason' "tree_dirty"
vrun "$P" --no-cache
check "RU6b a run started with an untracked file: tree_clean false" 0 'j.tree_clean' "false"
rm -f "$P/src/new.js"
vreuse "$P" "$R6"
check "RU6c clean again, but the run saw a dirty tree: exit 1 run_tree_dirty" 1 'j.reason' "run_tree_dirty"

# RU7: planted reports
ruproj ru7; vrun "$P" --no-cache; R7="$(rhead)"; F="$(rdir)/$R7-full.json"; ORIG="$WORK/ru7.orig"; cp "$F" "$ORIG"
plant 'r.skipped_on_host=[{id:"x",reason:"y"}]'; vreuse "$P" "$R7"
check "RU7a skipped_on_host non-empty: exit 1 commands_skipped" 1 'j.reason' "commands_skipped"
plant 'r.env_red=[{id:"x",host:"h",reason:"y"}]'; vreuse "$P" "$R7"
check "RU7b env_red non-empty: exit 1 env_red_excused" 1 'j.reason' "env_red_excused"
plant 'r.commands=[]'; vreuse "$P" "$R7"
check "RU7c commands empty: exit 1 no_commands" 1 'j.reason' "no_commands"
plant 'r.head_sha="b".repeat(40)'; vreuse "$P" "$R7"
check "RU7d head_sha of another sha: exit 1 report_sha_mismatch" 1 'j.reason' "report_sha_mismatch"
printf '{"verdict":"pa' > "$F"; chmod 600 "$F"; vreuse "$P" "$R7"
check "RU7e truncated JSON: exit 1 report_invalid" 1 'j.reason' "report_invalid"
plant ''; chmod 644 "$F"; vreuse "$P" "$R7"
check "RU7f valid report with mode 644: exit 1 report_invalid" 1 'j.reason' "report_invalid"
plant ''; vreuse "$P" "$R7"
check "RU7g control: the unchanged report at mode 600 is reusable" 0 'j.ok' "true"
plant 'r.tree_clean=null'; vreuse "$P" "$R7"
check "RU7h tree_clean not true: exit 1 run_tree_dirty" 1 'j.reason' "run_tree_dirty"

# RU8: symlinks
cp "$ORIG" "$WORK/ru8.other"; chmod 600 "$WORK/ru8.other"; rm -f "$F"; ln -s "$WORK/ru8.other" "$F"
vreuse "$P" "$R7"
check "RU8 the report replaced by a symlink to a valid report: exit 1 report_invalid" 1 'j.reason' "report_invalid"
rm -f "$F"; plant ''; D="$(rdir)"; mv "$D" "$WORK/ru8dir"; ln -s "$WORK/ru8dir" "$D"
BEFORE="$(cat "$WORK/ru8dir/$R7-full.json")"; NB="$(ls "$WORK/ru8dir" | wc -l | tr -d ' ')"
vrun "$P" --no-cache
check "RU8b reports directory is a symlink: run exit 0, report_copy.path null with an error" 0 '(j.report_copy.path===null)+"/"+(typeof j.report_copy.error)' "true/string"
[[ "$(cat "$WORK/ru8dir/$R7-full.json")" == "$BEFORE" && "$(ls "$WORK/ru8dir" | wc -l | tr -d ' ')" == "$NB" ]] && ok "RU8c nothing written through the link" || bad "RU8c the link target changed"
vreuse "$P" "$R7"
check "RU8d reuse through a symlinked directory: exit 1 report_invalid" 1 'j.reason' "report_invalid"

# RU9: pruning
ruproj ru9; vrun "$P" --no-cache; D="$(rdir)"
node -e 'const fs=require("fs"); const d=process.argv[1]; for (let i=1;i<=101;i++){ const f=d+"/"+i.toString(16).padStart(40,"0")+"-full.json"; fs.writeFileSync(f,"{}\n",{mode:0o600}); fs.utimesSync(f,1e9+i,1e9+i);} fs.writeFileSync(d+"/keep.txt","k\n");' "$D"
vrun "$P" --no-cache
N="$(ls "$D" | grep -cE '^[0-9a-f]{40}-(full|affected)\.json$')"
[[ "$N" == "100" && ! -e "$D/$(printf '%040x' 1)-full.json" && -e "$D/keep.txt" ]] && ok "RU9 pruned to the newest 100 named files, oldest gone, keep.txt stays" || bad "RU9 prune (named=$N)"

# RU10: --base writes nothing
ruproj ru10; vrun "$P" --no-cache; D="$(rdir)"; N0="$(ls "$D" | wc -l | tr -d ' ')"; printf 'module.exports = 3;\n' > "$P/src/app.js"; g "$P" commit -q -am c2
vrun "$P" --base main --no-cache
N1="$(ls "$D" | wc -l | tr -d ' ')"
[[ "$N0" == "$N1" && "$(js 'j.report_copy')" == "null" ]] && ok "RU10 --base run: no new file, report_copy null" || bad "RU10 (before=$N0 after=$N1 copy=$(js 'j.report_copy'))"

# RU11: hostile input
ruproj ru11; vrun "$P" --no-cache; R11="$(rhead)"; : > "$WORK/ru11.canary"
for bad_head in '../../etc/passwd' "$(printf 'a%.0s' $(seq 1 10000))" 'abc;rm -rf /' "$(printf 'A%.0s' $(seq 1 40))"; do
  vreuse "$P" "$bad_head"; check_rc "RU11 hostile --head ($(printf '%.20s' "$bad_head")): exit 2" 2
done
OUT="$(cd "$P" && node "$TOOLS" verify reuse --phase fx 2>/dev/null)"; RC=$?; check_rc "RU11b --head missing: exit 2" 2
OUT="$(cd "$P" && node "$TOOLS" verify reuse --head "$R11" --bogus 2>/dev/null)"; RC=$?; check_rc "RU11c unknown flag: exit 2" 2
OUT="$(cd "$P" && node "$TOOLS" verify reuse --head "$R11" --project "$WORK/no-such-dir" 2>/dev/null)"; RC=$?; check_rc "RU11d missing --project: exit 2" 2
[[ -e "$WORK/ru11.canary" && ! -e /passwd ]] && ok "RU11e canary intact" || bad "RU11e canary"

# RU12: not a git repo
mkdir -p "$WORK/ru12"
OUT="$(node "$TOOLS" verify reuse --head "$R11" --project "$WORK/ru12" 2>"$WORK/err")"; RC=$?
check "RU12 plain directory: exit 1 not_a_git_repo" 1 'j.reason' "not_a_git_repo"

# RU13..RU16: the Verify-then-push flow (Clarification 2026-11-16)
ru13proj() {
  ruproj "$1"; mkdir -p "$P/.a1/phases/x"; printf -- '---\nverdict: PASS\n---\n' > "$P/.a1/phases/x/VERIFICATION.md"
  vrun "$P" --no-cache --out "$P/.a1/phases/x/VERIFICATION.md"; RR="$(rhead)"
  g "$P" add .a1; g "$P" commit -q -m "verification"
  printf 'status\n' > "$P/.a1/phases/x/STATUS.md"; g "$P" add .a1; g "$P" commit -q -m "status"
}
ru13proj ru13
vreuse "$P" "$(rhead)"
check "RU13 report at R, two .a1/-only commits after it: reuse exit 0, report_sha R, 2 commits" 0 'j.ok+"/"+(j.report_sha==="'"$RR"'")+"/"+j.a1_only_commits' "true/true/2"
vcheck "$P/.a1/phases/x/VERIFICATION.md"
check "RU13b verify check agrees: exit 0, no reasons, no note (not the vacuous path)" 0 'j.ok+"/"+j.reasons.length+"/"+(j.note===undefined)' "true/0/true"
printf 'module.exports = 9;\n' > "$P/src/app.js"; g "$P" commit -q -am "code after"
vreuse "$P" "$(rhead)"
check "RU14 a code commit after the report: reuse exit 1 code_changed_after_run" 1 'j.reason' "code_changed_after_run"
vcheck "$P/.a1/phases/x/VERIFICATION.md"
check "RU14b verify check gives the same answer" 1 'j.reasons.join()' "code_changed_after_run"
ru13proj ru15
printf 'x\n' > "$P/src/b.js"; vreuse "$P" "$(rhead)"
check "RU15 untracked src/b.js: exit 1 tree_dirty" 1 'j.reason' "tree_dirty"
rm -f "$P/src/b.js"; printf 'x\n' > "$P/.a1/x.md"; vreuse "$P" "$(rhead)"
check "RU15b untracked .a1/x.md instead: exit 0" 0 'j.ok' "true"
ruproj ru16; vrun "$P" --no-cache
for i in $(seq 1 51); do printf '%s\n' "$i" > "$P/.a1/n$i.md"; g "$P" add .a1; g "$P" commit -q -m "n$i"; done
vreuse "$P" "$(rhead)"
check "RU16 report at HEAD~51 (outside the 50-commit window): exit 1 no_report" 1 'j.reason' "no_report"

# RU17: failed write leaves the earlier copy, reuse refuses the wrong directory mode
if [[ "$(id -u)" == "0" ]]; then ok "RU17 skipped: running as root"; else
  ruproj ru17 "[ -e \"$WORK/ru17.red\" ] && exit 1; exit 0"; rm -f "$WORK/ru17.red"
  vrun "$P" --no-cache; R17="$(rhead)"; D="$(rdir)"
  chmod 0500 "$D"; : > "$WORK/ru17.red"
  vrun "$P" --no-cache
  check "RU17 write into a 0500 directory fails: red run exit 1, report_copy.error set" 1 '(j.report_copy.path===null)+"/"+(typeof j.report_copy.error)+"/"+j.verdict' "true/string/fail"
  vreuse "$P" "$R17"
  check "RU17b reuse with directory mode 0500: exit 1 report_invalid" 1 'j.reason' "report_invalid"
  chmod 0700 "$D"; rm -f "$WORK/ru17.red"
fi
