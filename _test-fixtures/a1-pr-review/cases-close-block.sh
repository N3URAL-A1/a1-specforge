# Spec 027 slice 4 PR B (FR-026, plan D17): the feature close block F of workflows/05-merge.md, and the quoted-heredoc
# conversion of the run record block's PHASE assignment.
# Sourced by run-tests.sh (uses pass_case, fail_case, bj, BJ, mk_workdir, RRB).
#
# Measured red (each on a git-archive copy of 05-merge.md, suite run):
#   `exit "$RC"` removed from the F block      -> CB1
#   the F block placed before the G block      -> the order case (DCMFGRP)
#   the "<"* arm removed from the F `case`     -> CB2 (the placeholder run calls the stub)
#   the run record block back to PHASE='<phase_name>' -> FLR (the quote breaks out and runs the substitution)

FB="$(bj 'b.find(x=>/feature close/.test(x))')"
if printf '%s' "$FB" | grep -qF 'feature close --by "$SPEC_ID" --pr <n>' && printf '%s' "$FB" | grep -qF 'RC=$?' \
   && printf '%s' "$FB" | grep -qF 'echo "STOP: feature close exit=$RC"; exit "$RC"' && printf '%s' "$FB" | grep -qE 'case "\$SPEC_ID" in ""\|none\|"<"\*\)'; then
  pass_case "CB1 the F block carries feature close --by \"\$SPEC_ID\" --pr <n>, RC=\$?, exit \"\$RC\" and a case that skips none"
else fail_case "CB1 F block incomplete: $FB"; fi

# CB2 stub run (RR-guard pattern): stub a1-tools.cjs, gh and git on PATH.
mk_workdir CBT cb-close; mkdir -p "$CBT/repo/_shared" "$CBT/rr" "$CBT/bin"
cat > "$CBT/repo/_shared/a1-tools.cjs" <<'STUB'
require("fs").appendFileSync(process.env.CB_LOG, process.argv.slice(2).join(" ") + "\n");
STUB
cat > "$CBT/bin/gh" <<'STUB'
#!/bin/sh
echo MERGED
STUB
cat > "$CBT/bin/git" <<'STUB'
#!/bin/sh
echo "$*" >> "$CB_GITLOG"
case "$*" in *ls-remote*) [ -n "$CB_LS" ] && echo "deadbeef refs/heads/x" ;; esac
exit 0
STUB
chmod +x "$CBT/bin/gh" "$CBT/bin/git"
cb_run() { # $1 = caller_spec_id value (empty: leave the placeholder)
  printf '%s' "$FB" | sed -e "s#<repo_root>#$CBT/rr#g" -e "s#<repo>#$CBT/repo#g" -e "s#<n>#7#g" ${1:+-e "s#<caller_spec_id>#$1#g"} > "$CBT/blk.sh"
  : > "$CBT/log"; : > "$CBT/gitlog"
  (cd "$CBT" && PATH="$CBT/bin:$PATH" CB_LOG="$CBT/log" CB_GITLOG="$CBT/gitlog" bash "$CBT/blk.sh" > "$CBT/out" 2>&1); echo $?
}
rc="$(cb_run "")"
if [ "$rc" = "0" ] && grep -q 'SKIP: feature close' "$CBT/out" && [ ! -s "$CBT/log" ]; then pass_case "CB2a unreplaced <caller_spec_id>: SKIP printed, the stub never ran"
else fail_case "CB2a rc=$rc log=$(cat "$CBT/log") out=$(cat "$CBT/out")"; fi
rc="$(cb_run fx-spec)"
if [ "$rc" = "0" ] && [ "$(wc -l < "$CBT/log")" = "1" ] && [ "$(cat "$CBT/log")" = "feature close --by fx-spec --pr 7" ]; then pass_case "CB2b spec id fx-spec: one stub line 'feature close --by fx-spec --pr 7'"
else fail_case "CB2b rc=$rc log=$(cat "$CBT/log") out=$(cat "$CBT/out")"; fi
if grep -q ' ls-remote --heads origin MERGED$' "$CBT/gitlog" && ! grep -q 'push' "$CBT/gitlog"; then pass_case "CB2c an empty ls-remote (branch already gone) runs no push --delete"
else fail_case "CB2c git calls: $(cat "$CBT/gitlog")"; fi
CB_LS=1 cb_run fx-spec >/dev/null
if grep -q ' push origin --delete MERGED$' "$CBT/gitlog" && [ "$(cat "$CBT/log")" = "feature close --by fx-spec --pr 7" ]; then pass_case "CB2e a MERGED PR whose remote branch still exists: git push origin --delete, then feature close"
else fail_case "CB2e git calls: $(tr '\n' '|' < "$CBT/gitlog") log=$(cat "$CBT/log")"; fi
rc="$(cb_run '$(touch PWNED)')"
if [ -z "$(find "$CBT" -name PWNED)" ] && [ "$rc" = "2" ] && [ ! -s "$CBT/log" ] && grep -q 'STOP: bad spec id' "$CBT/out"; then pass_case "CB2d a \$(touch PWNED) spec id is not executed (no PWNED file, STOP bad spec id, the stub never ran)"
else fail_case "CB2d rc=$rc found=$(find "$CBT" -name PWNED) log=$(cat "$CBT/log") out=$(cat "$CBT/out")"; fi

# FLR the run record block: a phase value with a quote must not run (the old PHASE='...' form broke out of the quotes).
rc="$(rr_run "x'\$(touch PWNED)'")"
if [ -z "$(find "$RRT" -name PWNED)" ] && [ "$rc" = "2" ] && [ "$(wc -l < "$RRT/log")" = "1" ] && grep -q 'STOP: bad phase name' "$RRT/out"; then pass_case "FLR a phase value x'\$(touch PWNED)' ends with STOP bad phase name, runs no substitution and writes no PWNED file"
else fail_case "FLR rc=$rc found=$(find "$RRT" -name PWNED) log=$(cat "$RRT/log") out=$(cat "$RRT/out")"; fi
