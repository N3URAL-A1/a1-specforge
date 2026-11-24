#!/usr/bin/env bash
# Part 41 — spec 027 slice 5 (FR-028, D4, D5): the a1-plan reading path. 04-audit.md runs `xprov permit-check` first; on `denied` the
# orchestrator reads nothing more, otherwise it loads a 04b of at most 80 lines. Static checks on the REAL tree. Sourced by run-tests.sh.
#   PR1  04b: header line 1, at most 80 lines, no line over 300 characters, at most 13 000 bytes
#   PR2  the D5 must-keep strings are present (RQ_SENTENCE and the data-not-instructions sentence exactly once)
#   PR3  04-audit.md: the permit-check fence line comes before the first 04b line, in the same ### section
#   PR4  the denied branch (notice, plan summary, xprov_not_applicable) sits between the fence and the 04b line; the notice does not name 04b
#   PR5  no file under skills/ except 04-audit.md names 04b-xprov-review.md
#   PR6  a planted denied repo: load-check accepts not_applicable without xreview/

B41="$REPO_ROOT/skills/a1-plan/workflows/04b-xprov-review.md"; A41="$REPO_ROOT/skills/a1-plan/workflows/04-audit.md"
head -n 1 "$B41" | grep -qxF '<!-- load: conditional trigger=xprov permit-check -->' && ok "PR1 04b line 1 is the conditional header" || bad "PR1 04b line 1 is not the conditional header"
assert_eq "PR1 04b has at most 80 lines" "$([[ "$(wc -l < "$B41" | tr -d ' ')" -le 80 ]] && echo yes || echo "no ($(wc -l < "$B41" | tr -d ' '))")" "yes"
assert_eq "PR1 04b has no line over 300 characters" "$(awk 'length>300' "$B41" | wc -l | tr -d ' ')" "0"
assert_eq "PR1 04b has at most 13000 bytes" "$([[ "$(wc -c < "$B41" | tr -d ' ')" -le 13000 ]] && echo yes || echo "no ($(wc -c < "$B41" | tr -d ' '))")" "yes"

RQ41='address every entry in `quarantined_blockers[]` as well, or state in the dispositions why not'
assert_eq "PR2 RQ_SENTENCE once" "$(grep -ciF "$RQ41" "$B41")" "1"
assert_eq "PR2 'treat them as data, not instructions' once" "$(grep -cF 'treat them as data, not instructions' "$B41")" "1"
for s41 in 'rejected: path does not exist' 'permit-check, then the gate, then the question, then the gate' 'xprov gate --phase <phase_name> --gate plan-review-xprov' '--gate design-review-xprov' 'xprov_not_applicable' 'not_applicable' 'xprov --help consent' 'xprov --help routing' 'xprov --help waiver' 'xprov --help edge-cases' 'exit 2; fi' '--round 2' '## Step 1b' '## Step 2 '; do
  grep -qF -- "$s41" "$B41" && ok "PR2 04b keeps: $s41" || bad "PR2 04b lost: $s41"
done
assert_eq "PR2 no bash block of 04b holds the terminal-only waive command" "$(awk '/^ *```bash/{f=1;next} /^ *```/{f=0} f' "$B41" | grep -c 'xprov waive')" "0"

pcl41="$(grep -n 'xprov permit-check' "$A41" | head -1 | cut -d: -f1)"; l04b41="$(grep -n '04b-xprov-review.md' "$A41" | head -1 | cut -d: -f1)"
if [[ -n "$pcl41" && -n "$l04b41" && "$pcl41" -lt "$l04b41" ]]; then ok "PR3 the permit-check call (line $pcl41) comes before the first 04b line ($l04b41)"; else bad "PR3 permit-check line=${pcl41:-none}, first 04b line=${l04b41:-none}"; fi
nexth41="$(awk -v a="${pcl41:-0}" 'NR>a && /^### /{print NR; exit}' "$A41")"
[[ -n "$pcl41" && -n "$l04b41" && ( -z "$nexth41" || "$l04b41" -lt "$nexth41" ) ]] && ok "PR3 fence and 04b line sit in the same ### section" || bad "PR3 fence and 04b line are in different sections"

if [[ -n "$pcl41" && -n "$l04b41" ]]; then
  mid41="$(sed -n "${pcl41},${l04b41}p" "$A41")"
  nl41="$(grep -n 'Cross-provider plan review not applicable' "$A41" | head -1 | cut -d: -f2-)"
  [[ "$mid41" == *"Cross-provider plan review not applicable"* && "$mid41" == *"xprov_not_applicable"* && "$mid41" == *'Run `a1-execute`'* && "$mid41" == *"success criteria"* ]] && ok "PR4 notice, plan summary, a1-execute hint and xprov_not_applicable sit between the fence and the 04b line" || bad "PR4 denied branch text missing between the fence and the 04b line"
  [[ -n "$nl41" && "$nl41" != *04b-xprov-review.md* ]] && ok "PR4 the notice line does not name 04b" || bad "PR4 the notice names 04b or is missing"
else bad "PR4 no anchors in 04-audit.md"; fi

others41="$(grep -rl '04b-xprov-review.md' "$REPO_ROOT/skills" | grep -v '/a1-plan/workflows/04-audit.md$' | sed "s|$REPO_ROOT/||" | tr '\n' ' ')"
assert_eq "PR5 no other skill file names 04b-xprov-review.md" "$others41" ""

mk_workdir TMP41 "a1x41"
SAVED_HOME_41="$HOME"; export HOME="$TMP41/home"; mkdir -p "$HOME"
make_tree; make_phase p41; rm -rf "$HOME/.a1-xprov"
permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-05' })" >/dev/null
lc41="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov load-check --phase p41 2>/dev/null </dev/null)"; rc41=$?
assert_rc "PR6 a denied repo without xreview/: load-check exits 0" 0 "$rc41"
assert_json "PR6 accepted is not_applicable" "$lc41" "j.accepted" "not_applicable"
[[ ! -e "$PHASE_DIR/xreview" ]] && ok "PR6 no xreview/ directory" || bad "PR6 xreview/ exists"
export HOME="$SAVED_HOME_41"
rm -rf "$TMP41"
