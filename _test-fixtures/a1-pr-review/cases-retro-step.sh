# Cases RS1-RS6 (spec 027 slice 5, plan Task 10.2): the retro decision block T in 05-merge.md close-out item 1, and the
# `workflow budget --base` line in the 5.3 block. Sourced by run-tests.sh (uses bj, BJ, MRG, pass_case, fail_case, mk_workdir).
# Measured red (one edit each on a scratch copy of 05-merge.md, suite run):
#   block T placed after the run record block              -> RS1 (and the order case)
#   the second `read` of the <issue_tags> guard removed      -> RS2
#   the `RD="$(mktemp)"` line removed                        -> RS2b
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
if [ "$(printf '%s\n' "$TB" | awk '/RD="\$\(mktemp\)"/{d=NR} /"\$RD"/&&!/RD="\$\(mktemp\)"/{if(!u)u=NR} END{print (d>0&&u>d)?"ok":"bad:"d","u}')" = "ok" ]; then pass_case "RS2b block T defines RD=\"\$(mktemp)\" before the first \"\$RD\""
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
