# Cases RS1-RS6 (spec 027 slice 5, plan Task 10.2): the retro decision block T in 05-merge.md close-out item 1, and the
# `workflow budget --base` line in the 5.3 block. Sourced by run-tests.sh (uses bj, BJ, MRG, pass_case, fail_case, mk_workdir).
# Measured red (one edit each on a scratch copy of 05-merge.md, suite run):
#   block T placed after the run record block              -> RS1 (and the order case)
#   the second `read` of the <issue_tags> guard removed      -> RS2
#   the `RD=` temp-file line removed                         -> RS2b
#   `--by "$SPEC_ID"` replaced by a raw `--by <caller_spec_id>` -> RS5

TB="$(bj 'b.find(x=>/prose_required/.test(x))')"
BUDGET_LINE="$(bj 'b.filter(x=>/pr merge-check/.test(x)).map(x=>x.split("\n").filter(l=>/workflow budget/.test(l)).join("\n")).join("")')"

# RS1 block T lies between G (gh pr merge) and R (run record).
if [ -n "$TB" ] && [ "$(bj 'b.map(x=>/prose_required/.test(x)?"T":/^gh pr merge /m.test(x)?"G":/run record/.test(x)?"R":"-").join("").replace(/-/g,"")')" = "GTR" ]; then
  pass_case "RS1 block T lies between the merge block G and the run record block R"
else fail_case "RS1 block T position (blocks: $(bj 'b.map(x=>/prose_required/.test(x)?"T":/^gh pr merge /m.test(x)?"G":/run record/.test(x)?"R":"-").join("")'))"; fi

# stub run, as CB2: stub a1-tools.cjs on a planted repo dir, JSON on stdout for --check-only.
mk_workdir RST rs-step; mkdir -p "$RST/repo/_shared" "$RST/rr"
cat > "$RST/repo/_shared/a1-tools.cjs" <<'STUB'
const a = process.argv.slice(2);
require("fs").appendFileSync(process.env.RS_LOG, a.join(" ") + "\n");
process.stdout.write(JSON.stringify({ ok: true, retro: { prose_required: process.env.RS_PROSE === "1", reasons: process.env.RS_PROSE === "1" ? ["issues"] : [] } }));
STUB
rs_run() { # $1 = caller_spec_id, $2 = issue_tags (either may hold a newline)
  printf '%s' "$TB" | sed -e "s#<repo_root>#$RST/rr#g" -e "s#<repo>#$RST/repo#g" -e "s#<n>#7#g" > "$RST/blk0.sh"
  node -e 'const fs=require("fs");fs.writeFileSync(process.argv[2],fs.readFileSync(process.argv[1],"utf8").split("<caller_spec_id>").join(process.argv[3]).split("<issue_tags>").join(process.argv[4]))' "$RST/blk0.sh" "$RST/blk.sh" "$1" "$2"
  : > "$RST/log"
  (cd "$RST" && RS_LOG="$RST/log" bash "$RST/blk.sh" > "$RST/out" 2>&1); echo $?
}
# RS2 a two-line <issue_tags> ends with STOP before any call.
rc="$(rs_run fx-spec "$(printf 'a\ntouch PWNED')")"
if [ "$rc" = "2" ] && [ ! -s "$RST/log" ] && [ -z "$(find "$RST" -name PWNED)" ] && grep -q 'STOP: bad issue tags' "$RST/out"; then pass_case "RS2 a two-line <issue_tags> value: STOP bad issue tags, exit 2, the stub never ran"
else fail_case "RS2 rc=$rc log=$(cat "$RST/log") out=$(cat "$RST/out")"; fi
# RS2b RD is defined on a line before its first use.
if [ "$(printf '%s\n' "$TB" | awk '/^RD="\$\(mk[a-z]+\)"/{d=NR} /"\$RD"/&&!/^RD=/{if(!u)u=NR} END{print (d>0&&u>d)?"ok":"bad:"d","u}')" = "ok" ]; then pass_case "RS2b block T defines RD from a temp file before the first \"\$RD\""
else fail_case "RS2b RD definition order in block T"; fi
# RS3 `none` passes no --issues; a tag list is passed through; the decision is printed.
rc="$(rs_run fx-spec none)"
if [ "$rc" = "0" ] && [ "$(cat "$RST/log")" = "feature close --check-only --by fx-spec --pr 7" ] && grep -q '^prose_required=false' "$RST/out"; then pass_case "RS3a issue tags none: no --issues flag, prose_required=false printed"
else fail_case "RS3a rc=$rc log=$(cat "$RST/log") out=$(cat "$RST/out")"; fi
rc="$(RS_PROSE=1 rs_run fx-spec a-b,c_d)"
if [ "$rc" = "0" ] && [ "$(cat "$RST/log")" = "feature close --check-only --by fx-spec --pr 7 --issues a-b,c_d" ] && grep -q '^prose_required=true' "$RST/out" && grep -q '^reasons=\["issues"\]' "$RST/out"; then pass_case "RS3b issue tags a-b,c_d: passed as --issues, prose_required=true and reasons printed"
else fail_case "RS3b rc=$rc log=$(cat "$RST/log") out=$(cat "$RST/out")"; fi
rc="$(rs_run fx-spec 'a b')"
if [ "$rc" = "2" ] && [ ! -s "$RST/log" ]; then pass_case "RS3c a tag value with a space or a leading dash is refused before any call"
else fail_case "RS3c rc=$rc log=$(cat "$RST/log")"; fi
rc="$(rs_run none none)"
if [ "$rc" = "0" ] && [ ! -s "$RST/log" ]; then pass_case "RS3d no caller spec id: SKIP, the stub never ran"
else fail_case "RS3d rc=$rc log=$(cat "$RST/log")"; fi
# RS4 the text after block T, in the same close-out item, names retro-prose.md.
if node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const i=t.indexOf("prose_required");const e=t.indexOf("\n2. Run record",i);const after=t.slice(t.indexOf("```\n",i)+4,e);process.exit(i>0&&e>i&&/retro-prose\.md/.test(after)&&/When `prose_required` is true/.test(after)?0:1)' "$MRG"; then pass_case "RS4 the text after block T names retro-prose.md and the prose_required rule"
else fail_case "RS4 retro-prose.md not named after block T"; fi
# RS5 every raw <token> outside the heredoc bodies is an orchestrator placeholder (block T and the 5.3 workflow budget line).
rs5() { printf '%s\n' "$1" | awk '/<<.A1_[A-Z]+_EOF.$/{h=1;next} /^A1_[A-Z]+_EOF$/{h=0;next} !h' | grep -o '<[a-z_]*>' | grep -vxE '<(repo|n|base|repo_root|worktree_path)>' | head -1; }
bad5="$(rs5 "$TB")"
if [ -n "$TB" ] && [ -z "$bad5" ]; then pass_case "RS5a block T carries only orchestrator placeholders outside its heredocs"; else fail_case "RS5a raw $bad5 in block T"; fi
bad5="$(rs5 "$BUDGET_LINE")"
if printf '%s' "$BUDGET_LINE" | grep -q 'workflow budget --base' && [ -z "$bad5" ]; then pass_case "RS5b the 5.3 workflow budget --base line carries only orchestrator placeholders"; else fail_case "RS5b budget line missing or raw $bad5: $BUDGET_LINE"; fi
# RS6 exactly one block holds prose_required, and block T holds none of the other blocks' signatures (classifier precedence).
if [ "$(bj 'b.filter(x=>/prose_required/.test(x)).length')" = "1" ] && ! printf '%s' "$TB" | grep -qE 'disposition review|run record|probe run|pr merge-check'; then pass_case "RS6 one block holds prose_required and it holds no other block's signature"
else fail_case "RS6 prose_required block count or signature overlap"; fi

# RS7 (review fix round 1, R2/SEC-3) `issue_tags` is a declared input of 02-review.md, with the default none, and a1-new-feature's
# hand-off line carries it next to caller_spec_id. Measured red before the fix: neither file named it.
if node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");const s=t.slice(t.indexOf("## Inputs"),t.indexOf("## Steps"));process.exit(/^- `issue_tags`.*none/m.test(s)?0:1)' "$SK/a1-pr-review/workflows/02-review.md"; then pass_case "RS7a 02-review.md Inputs declares issue_tags with the default none"
else fail_case "RS7a issue_tags not declared in 02-review.md Inputs"; fi
if grep -q 'caller_spec_id`.*issue_tags\|issue_tags.*caller_spec_id' "$SK/a1-new-feature/workflows/06-verify.md"; then pass_case "RS7b the a1-new-feature hand-off line carries issue_tags next to caller_spec_id"
else fail_case "RS7b hand-off line lacks issue_tags"; fi
# RS8 the text before block T (item 1) and before block F (item 3) names the orchestrator newline strip for both placeholders.
rs8() { node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const a=t.indexOf(process.argv[2]);const e=t.indexOf("```bash",a);const s=t.slice(a,e);process.exit(/strips all newlines/.test(s)&&s.includes("<issue_tags>")&&s.includes("<caller_spec_id>")?0:1)' "$MRG" "$1"; }
if rs8 '1. Retros, each with'; then pass_case "RS8a the item 1 text names the newline strip for <issue_tags> and <caller_spec_id>"; else fail_case "RS8a item 1 strip rule incomplete"; fi
if rs8 '3. `feature close`'; then pass_case "RS8b the item 3 text names the newline strip for <issue_tags> and <caller_spec_id>"; else fail_case "RS8b item 3 strip rule incomplete"; fi
# RS9 the bash case for <issue_tags> rejects what ISSUES_RE rejects in structure: trailing or leading comma, empty tag, tag starting with _ or -.
for v in 'a,' ',a' 'a,,b' 'a,_b' 'a,-b' '-a' '_a' 'a b' 'A'; do
  rc="$(RS_PROSE=1 rs_run fx-spec "$v")"
  if [ "$rc" = "2" ] && [ ! -s "$RST/log" ] && grep -q 'STOP: bad issue tags' "$RST/out"; then pass_case "RS9 issue tags '$v': STOP bad issue tags before any call"
  else fail_case "RS9 issue tags '$v' rc=$rc log=$(cat "$RST/log")"; fi
done
for v in 'a' 'a-b,c_d' 'a-,b_,c9'; do
  rc="$(RS_PROSE=1 rs_run fx-spec "$v")"
  if [ "$rc" = "0" ] && [ "$(cat "$RST/log")" = "feature close --check-only --by fx-spec --pr 7 --issues $v" ]; then pass_case "RS9 issue tags '$v' accepted and passed through"
  else fail_case "RS9 issue tags '$v' rc=$rc log=$(cat "$RST/log")"; fi
done
# RS9b length and count are the CLI's check (ISSUES_RE): the real CLI refuses a 42-char tag and 21 tags with exit 2 before any work,
# and passes a 41-char tag and 20 tags through the tag check (positive controls: no exit 2, no --issues usage message).
L41="$(printf 'a%.0s' $(seq 1 41))"; N20="$(printf 'a,%.0s' $(seq 1 19))a"
for c in "one tag of 42 characters:${L41}a" "21 tags:$N20,a"; do
  v="${c#*:}"; $CLI feature close --check-only --by fx-spec --pr 7 --issues "$v" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "2" ]; then pass_case "RS9b the CLI refuses ${c%%:*} with exit 2"; else fail_case "RS9b CLI rc=$rc for ${c%%:*}"; fi
done
# The positive controls pin the step after parseArgs: --repo is a fixed non-git dir, so a passed tag check ends in rc=1 not_a_repo
# (independent of cwd and vault); A1_GH_BIN is unset because a relative value from the caller exits 2 after parseArgs.
mkdir -p "$RST/nogit"
for c in "one tag of 41 characters:$L41" "20 tags:$N20"; do
  v="${c#*:}"; out="$(env -u A1_GH_BIN $CLI feature close --check-only --by fx-spec --pr 7 --repo "$RST/nogit" --issues "$v" 2>/dev/null)"; rc=$?
  if [ "$rc" = "1" ] && printf '%s' "$out" | grep -q '"reason":"not_a_repo"'; then pass_case "RS9b the CLI passes ${c%%:*} through the tag check (rc 1 not_a_repo)"
  else fail_case "RS9b CLI on ${c%%:*}: rc=$rc out=$out"; fi
done

# RS10 (review fix round 1, R6) block T removes its RD temp file on the success path and on the check-only failure path (stub run
# with TMPDIR pointing at an empty directory); the 04-audit.md permit-state block removes PC_OUT after the read.
# Measured red before the fix: one file was left in TMPDIR on each path.
mkdir -p "$RST/tmpd"
rs_tmp() { # $1 = RS_RC (stub exit code for --check-only) ; prints the count of files left in TMPDIR
  rm -rf "$RST/tmpd"; mkdir -p "$RST/tmpd"
  printf '%s' "$TB" | sed -e "s#<repo_root>#$RST/rr#g" -e "s#<repo>#$RST/repo#g" -e "s#<n>#7#g" -e "s#<caller_spec_id>#fx-spec#g" -e "s#<issue_tags>#none#g" > "$RST/blk-tmp.sh"
  (cd "$RST" && TMPDIR="$RST/tmpd" RS_LOG="$RST/log" RS_EXIT="$1" bash "$RST/blk-tmp.sh" > "$RST/out" 2>&1)
  find "$RST/tmpd" -type f | wc -l | tr -d ' '
}
# Insert the RS_EXIT stub line with node, not sed: GNU sed reads \n in the replacement as a newline, BSD sed does not (audit F-006).
node -e 'const fs=require("fs");const p=process.argv[1];const t=fs.readFileSync(p,"utf8");const i=t.search(/^require\("fs"\)\.appendFileSync/m);if(i<0)process.exit(3);fs.writeFileSync(p,t.slice(0,i)+"if (process.env.RS_EXIT && process.argv.includes(\"--check-only\")) process.exit(Number(process.env.RS_EXIT));\n"+t.slice(i))' "$RST/repo/_shared/a1-tools.cjs" \
  || fail_case "RS10 stub line not inserted into the fixture a1-tools.cjs"
# RS10a proves the success path ran (prose_required= printed), not only that no temp file is left.
if [ "$(rs_tmp "")" = "0" ] && grep -qE '^prose_required=(true|false)$' "$RST/out"; then pass_case "RS10a block T leaves no temp file after a successful decision"
else fail_case "RS10a success path did not run or left a temp file: $(cat "$RST/out")"; fi
if [ "$(rs_tmp 3)" = "0" ] && grep -q 'STOP: feature close --check-only exit=3' "$RST/out"; then pass_case "RS10b block T leaves no temp file when --check-only fails"; else fail_case "RS10b temp file left on the failure path: $(cat "$RST/out")"; fi
if node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const i=t.indexOf("PC_OUT=");const e=t.indexOf("```",i);const b=t.slice(i,e);process.exit(i>0&&/\nrm -f "\$PC_OUT"|\n *rm -f "\$PC_OUT"/.test(b)&&b.indexOf("rm -f")>b.indexOf("readFileSync")?0:1)' "$SK/a1-plan/workflows/04-audit.md"; then pass_case "RS10c the 04-audit.md permit-state block removes PC_OUT after the read"
else fail_case "RS10c PC_OUT is never removed"; fi
