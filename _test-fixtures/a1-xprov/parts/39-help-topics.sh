#!/usr/bin/env bash
# Part 39 — spec 027 slice 5 (FR-028, D5): `xprov --help <topic>`. The consent, waiver, routing and edge-cases text of
# a1-plan 04b lives in four help topics that one command prints. Sourced by run-tests.sh; static checks on the REAL tree.
#   HT1-HT4  each topic exits 0 and holds its anchor string        HT5  unknown topic exits 2     HT6  no topic keeps exit 2
#   HT7      `a1-tools --help` carries the four topic headers      HT8  edge-cases names the opt-in log and observations.jsonl
#   HT9      XPROV_HELP names the observation line and the opt-in   HT10 line-length and byte-identical command lines

mk_workdir TMP39 "a1x39"
[[ -n "$TMP39" && -d "$TMP39" ]] || { echo "FAIL  part 39: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
LIB39="$REPO_ROOT/_shared/lib"
help39() { H_OUT="$(cd "$TMP39" && node "$TOOLS" xprov --help "$@" 2>"$TMP39/err.txt" </dev/null)"; H_RC=$?; }
norm39() { node -e 'process.stdout.write(require("fs").readFileSync(0,"utf8").replace(/\s+/g," "))'; }

help39 consent;      assert_rc "HT1 xprov --help consent" 0 "$H_RC"
[[ "$H_OUT" == *"consent question --kind consent"* ]] && ok "HT1 consent anchor" || bad "HT1 consent anchor missing"
help39 waiver;       assert_rc "HT2 xprov --help waiver" 0 "$H_RC"
[[ "$H_OUT" == *"consent ensure --kind waiver"* && "$H_OUT" != *"consent question --kind consent"* ]] && ok "HT2 waiver anchor, not the consent text" || bad "HT2 waiver anchor missing or topic mixed with consent"
help39 routing;      assert_rc "HT3 xprov --help routing" 0 "$H_RC"
[[ "$H_OUT" == *"xprov dispose"* ]] && ok "HT3 routing anchor" || bad "HT3 routing anchor missing"
help39 edge-cases;   assert_rc "HT4 xprov --help edge-cases" 0 "$H_RC"
[[ "$H_OUT" == *"plugins_cache_empty"* ]] && ok "HT4 edge-cases anchor" || bad "HT4 edge-cases anchor missing"
EDGE39="$H_OUT"
help39 nonsense;     assert_rc "HT5 unknown topic" 2 "$H_RC"
[[ "$(cat "$TMP39/err.txt")" == *consent*waiver*routing*edge-cases* ]] && ok "HT5 the usage error names the four topics" || bad "HT5 usage error does not name the four topics"
help39;              assert_rc "HT6 xprov --help without a topic" 2 "$H_RC"
help39 consent extra; assert_rc "HT6 xprov --help with two arguments" 2 "$H_RC"

ALL39="$(cd "$TMP39" && node "$TOOLS" --help 2>/dev/null </dev/null)"
for t in consent waiver routing edge-cases; do
  [[ "$ALL39" == *"a1-tools xprov --help $t"* ]] && ok "HT7 a1-tools --help carries the $t topic" || bad "HT7 a1-tools --help lacks the $t topic header"
done

EDGE_N39="$(printf '%s' "$EDGE39" | norm39)"
[[ "$EDGE_N39" == *'with `A1_KEEP_REVIEW_LOGS=1`, in the log entry of `PLAN-REVIEW-LOG.md`'* && "$EDGE_N39" == *observations.jsonl* ]] && ok "HT8 edge-cases: log is opt-in, observation line named" || bad "HT8 edge-cases lacks the opt-in sentence or observations.jsonl"
[[ "$EDGE_N39" != *'and in the log entry of `PLAN-REVIEW-LOG.md`'* ]] && ok "HT8 no unconditional log sentence" || bad "HT8 the unconditional log sentence is still there"

HELP_N39="$(node -e 'process.stdout.write(require(process.argv[1]).XPROV_HELP)' "$LIB39/help-xprov.cjs" | norm39)"
c39() { node -e 'const h=process.argv[1],n=process.argv[2];let c=0,i=-1;while((i=h.indexOf(n,i+1))>=0)c++;process.stdout.write(String(c))' "$1" "$2"; }
assert_eq "HT9 XPROV_HELP names the observation line and the opt-in once" "$(c39 "$HELP_N39" 'in the observation line, and (with A1_KEEP_REVIEW_LOGS=1) in the log entry')" "1"
assert_eq "HT9 XPROV_HELP: the old phrase is gone" "$(c39 "$HELP_N39" 'recovery in stdout and in the log entry')" "0"

# HT10: line lengths and the five command lines, literal here, each also a line of 04b at c6b10a2
CMD39=(
'node <repo>/_shared/a1-tools.cjs xprov consent question --kind consent --phase <phase_name> > "$XREVIEW_DIR/consent-question.json"; RC=$?'
'node <repo>/_shared/a1-tools.cjs xprov consent record --kind consent > "$XREVIEW_DIR/consent-record.last-run.json"; RC=$?'
'node <repo>/_shared/a1-tools.cjs xprov consent question --kind waiver --phase <phase_name> > "$XREVIEW_DIR/waiver-question.last-run.json"; RC=$?'
'node <repo>/_shared/a1-tools.cjs xprov consent ensure --kind waiver --phase <phase_name> > "$XREVIEW_DIR/waiver-ensure.last-run.json"; RC=$?'
'node <repo>/_shared/a1-tools.cjs xprov dispose --phase <phase_name> --gate plan-review-xprov > "$XREVIEW_DIR/dispose.last-run.json"; RC=$?'
)
printf '%s\n' "${CMD39[@]}" > "$TMP39/cmds.txt"
git -C "$REPO_ROOT" show c6b10a2:skills/a1-plan/workflows/04b-xprov-review.md > "$TMP39/04b.old" 2>/dev/null || : > "$TMP39/04b.old"
TOPICS39="$(cd "$TMP39" && node -e '
  const L = process.argv[1], fs = require("fs");
  const C = require(L + "/help-xprov-consent.cjs").XPROV_TOPICS_CONSENT, M = require(L + "/help-xprov-topics.cjs").XPROV_TOPICS_MAIN;
  const topics = [C.consent, C.waiver, M.routing, M["edge-cases"]];
  const cmds = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
  const old = fs.existsSync(process.argv[3]) ? fs.readFileSync(process.argv[3], "utf8").split("\n").map((l) => l.trim()) : null;
  let prose = 0, cmd = 0, badProse = 0, badCmd = 0; const seen = new Set();
  for (const t of topics) for (const raw of t.split("\n")) {
    const l = raw.trim();
    if (l.startsWith("node <repo>/_shared/a1-tools.cjs")) { cmd = Math.max(cmd, l.length); if (l.length > 150 || !cmds.includes(l)) badCmd++; seen.add(l); }
    else { prose = Math.max(prose, raw.length); if (raw.length > 140) badProse++; }
  }
  const missing = cmds.filter((c) => !seen.has(c)).length;
  const notOld = old && old.length > 1 ? cmds.filter((c) => !old.includes(c)).length : 0;
  process.stdout.write([badProse, badCmd, missing, notOld, prose, cmd].join(" "));
' "$LIB39" "$TMP39/cmds.txt" "$TMP39/04b.old" 2>&1 </dev/null)"
read -r BP39 BC39 MS39 NO39 LP39 LC39 <<< "$TOPICS39"
assert_eq "HT10 no prose line over 140 characters in the four topics" "$BP39" "0"
assert_eq "HT10 every command line is one of the five literal lines, at most 150 characters" "$BC39" "0"
assert_eq "HT10 all five command lines appear in the topics" "$MS39" "0"
assert_eq "HT10 the five literal command lines are lines of 04b at c6b10a2" "$NO39" "0"
echo "# HT10 longest prose line: ${LP39:-?}, longest command line: ${LC39:-?}"

rm -rf "$TMP39"
