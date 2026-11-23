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
const a = process.argv.slice(2);
require("fs").appendFileSync(process.env.CB_LOG, a.join(" ") + "\n");
if (process.env.CB_CHECK_RC && a.includes("--check-only")) process.exit(Number(process.env.CB_CHECK_RC));
STUB
cat > "$CBT/bin/gh" <<'STUB'
#!/bin/sh
case "$*" in
  *headRefName*) echo "${CB_BRANCH:-MERGED}" ;;
  *headRefOid*) echo deadbeef ;;
  *isCrossRepository*) echo "${CB_FORK:-false}" ;;
  *) echo MERGED ;;
esac
STUB
cat > "$CBT/bin/git" <<'STUB'
#!/bin/sh
echo "$*" >> "$CB_GITLOG"
case "$*" in *ls-remote*) [ -n "$CB_LS" ] && echo "${CB_LS_OID:-deadbeef} refs/heads/x" ;; esac
exit 0
STUB
chmod +x "$CBT/bin/gh" "$CBT/bin/git"
cb_run() { # $1 = caller_spec_id value (empty: leave the placeholder; may hold a newline, substituted by node)
  printf '%s' "$FB" | sed -e "s#<repo_root>#$CBT/rr#g" -e "s#<repo>#$CBT/repo#g" -e "s#<n>#7#g" > "$CBT/blk0.sh"
  if [ -n "$1" ]; then node -e 'const fs=require("fs");fs.writeFileSync(process.argv[2],fs.readFileSync(process.argv[1],"utf8").split("<caller_spec_id>").join(process.argv[3]))' "$CBT/blk0.sh" "$CBT/blk.sh" "$1"; else cp "$CBT/blk0.sh" "$CBT/blk.sh"; fi
  : > "$CBT/log"; : > "$CBT/gitlog"
  (cd "$CBT" && PATH="$CBT/bin:$PATH" CB_LOG="$CBT/log" CB_GITLOG="$CBT/gitlog" bash "$CBT/blk.sh" > "$CBT/out" 2>&1); echo $?
}
rc="$(cb_run "")"
if [ "$rc" = "0" ] && grep -q 'SKIP: feature close' "$CBT/out" && [ ! -s "$CBT/log" ]; then pass_case "CB2a unreplaced <caller_spec_id>: SKIP printed, the stub never ran"
else fail_case "CB2a rc=$rc log=$(cat "$CBT/log") out=$(cat "$CBT/out")"; fi
rc="$(cb_run fx-spec)"
if [ "$rc" = "0" ] && [ "$(wc -l < "$CBT/log")" = "2" ] && [ "$(sed -n 1p "$CBT/log")" = "feature close --check-only --by fx-spec --pr 7" ] && [ "$(sed -n 2p "$CBT/log")" = "feature close --by fx-spec --pr 7" ]; then pass_case "CB2b spec id fx-spec: two stub lines, 'feature close --check-only --by fx-spec --pr 7' first, then 'feature close --by fx-spec --pr 7'"
else fail_case "CB2b rc=$rc log=$(cat "$CBT/log") out=$(cat "$CBT/out")"; fi
if grep -q ' ls-remote --heads origin refs/heads/MERGED$' "$CBT/gitlog" && ! grep -q 'push' "$CBT/gitlog"; then pass_case "CB2c an empty ls-remote (branch already gone) runs no push --delete"
else fail_case "CB2c git calls: $(cat "$CBT/gitlog")"; fi
CB_LS=1 cb_run fx-spec >/dev/null
if grep -q ' push --force-with-lease=refs/heads/MERGED:deadbeef origin --delete refs/heads/MERGED$' "$CBT/gitlog" && [ "$(sed -n 2p "$CBT/log")" = "feature close --by fx-spec --pr 7" ]; then pass_case "CB2e a MERGED PR whose remote branch still exists at the PR head: git push with a lease on that tip --delete, then feature close"
else fail_case "CB2e git calls: $(tr '\n' '|' < "$CBT/gitlog") log=$(cat "$CBT/log")"; fi
rc="$(cb_run '$(touch PWNED)')"
if [ -z "$(find "$CBT" -name PWNED)" ] && [ "$rc" = "2" ] && [ ! -s "$CBT/log" ] && grep -q 'STOP: bad spec id' "$CBT/out"; then pass_case "CB2d a \$(touch PWNED) spec id is not executed (no PWNED file, STOP bad spec id, the stub never ran)"
else fail_case "CB2d rc=$rc found=$(find "$CBT" -name PWNED) log=$(cat "$CBT/log") out=$(cat "$CBT/out")"; fi

# FLR the run record block: a phase value with a quote must not run (the old PHASE='...' form broke out of the quotes).
rc="$(rr_run "x'\$(touch PWNED)'")"
if [ -z "$(find "$RRT" -name PWNED)" ] && [ "$rc" = "2" ] && [ "$(wc -l < "$RRT/log")" = "1" ] && grep -q 'STOP: bad phase name' "$RRT/out"; then pass_case "FLR a phase value x'\$(touch PWNED)' ends with STOP bad phase name, runs no substitution and writes no PWNED file"
else fail_case "FLR rc=$rc found=$(find "$RRT" -name PWNED) log=$(cat "$RRT/log") out=$(cat "$RRT/out")"; fi

# CB3 (SEC-4): the remote delete needs the remote tip to equal the PR headRefOid, the PR to come from this repository, and runs
# only after the --check-only pass. Measured red against the pre-fix block: the stub saw a push in CB3a, CB3b and CB3c.
CB_LS=1 CB_LS_OID=cafebabe cb_run fx-spec >/dev/null
if ! grep -q ' push ' "$CBT/gitlog" && grep -q 'WARN: origin has' "$CBT/out"; then pass_case "CB3a a remote tip that differs from the PR headRefOid: no push, WARN, remote delete skipped"
else fail_case "CB3a git calls: $(tr '\n' '|' < "$CBT/gitlog") out=$(cat "$CBT/out")"; fi
CB_LS=1 CB_FORK=true cb_run fx-spec >/dev/null
if ! grep -q ' push ' "$CBT/gitlog" && grep -q 'WARN: PR head is not in this repository' "$CBT/out"; then pass_case "CB3b a cross-repository PR: no push, WARN"
else fail_case "CB3b git calls: $(tr '\n' '|' < "$CBT/gitlog") out=$(cat "$CBT/out")"; fi
CB_LS=1 CB_CHECK_RC=1 cb_run fx-spec >/dev/null; rc=$(CB_LS=1 CB_CHECK_RC=1 cb_run fx-spec)
if [ "$rc" = "1" ] && ! grep -q ' push ' "$CBT/gitlog" && [ "$(wc -l < "$CBT/log")" = "1" ] && grep -q 'STOP: feature close --check-only exit=1' "$CBT/out"; then pass_case "CB3c a refusing --check-only (exit 1): STOP, no push, the real feature close never ran"
else fail_case "CB3c rc=$rc git calls: $(tr '\n' '|' < "$CBT/gitlog") log=$(cat "$CBT/log") out=$(cat "$CBT/out")"; fi
rc="$(CB_LS=1 CB_BRANCH=-x cb_run fx-spec)"
if [ "$rc" = "2" ] && ! grep -q ' push ' "$CBT/gitlog" && grep -q 'STOP: bad branch name' "$CBT/out"; then pass_case "CB3d a PR head branch named -x: STOP bad branch name, no push"
else fail_case "CB3d rc=$rc out=$(cat "$CBT/out")"; fi

# CB4 (SEC-2): a spec id of more than one line (a newline after a harmless first line) ends with STOP before anything runs; the
# call lines use "$SPEC_ID", never the raw placeholder. Measured red against the pre-fix block: the touch ran.
rc="$(cb_run "$(printf 'ok\ntouch PWNED')")"
if [ -z "$(find "$CBT" -name PWNED)" ] && [ "$rc" = "2" ] && [ ! -s "$CBT/log" ] && grep -q 'STOP: bad spec id' "$CBT/out"; then pass_case "CB4a spec id 'ok' + newline + 'touch PWNED': STOP bad spec id, no PWNED file, the stub never ran"
else fail_case "CB4a rc=$rc found=$(find "$CBT" -name PWNED) log=$(cat "$CBT/log") out=$(cat "$CBT/out")"; fi
rc="$(cb_run "$(printf 'ok\n\nA1_SPEC_EOF\ntouch PWNED')")"
if [ -z "$(find "$CBT" -name PWNED)" ] && [ "$rc" = "2" ] && [ ! -s "$CBT/log" ]; then pass_case "CB4b a value that closes the heredoc after an empty line (the terminator line, then 'touch PWNED'): STOP before the command, no PWNED file"
else fail_case "CB4b rc=$rc found=$(find "$CBT" -name PWNED) log=$(cat "$CBT/log") out=$(cat "$CBT/out")"; fi
# CB4d KNOWN LIMIT (PR B review fix round 2, Samuel MINOR-1): a value that CONTAINS the terminator closes the heredoc early; the guard
# sees only "ok" and the command after the terminator runs. This case documents today's behaviour, it is NOT coverage: the only control
# is the orchestrator's newline strip (prompt level). Follow-up: carry placeholder values via a Write-tool file or env var, not shell source.
rc="$(cb_run "$(printf 'ok\nA1_SPEC_EOF\ntouch PWNED')")"
if [ -n "$(find "$CBT" -name PWNED)" ]; then pass_case "CB4d (documented limit, not coverage) a value holding the terminator line then 'touch PWNED': the command still runs; only the orchestrator newline strip stops it"
else fail_case "CB4d the documented limit no longer holds (good news: update the docs and this case) rc=$rc out=$(cat "$CBT/out")"; fi
find "$CBT" -name PWNED -delete
if ! printf '%s' "$FB" | grep -q '<caller_spec_id>.*--pr\|--by <'; then pass_case "CB4c the F block call lines carry no raw <caller_spec_id> after the heredoc"; else fail_case "CB4c raw placeholder on a call line"; fi

# FLN the run record block: a phase value of two lines ends with STOP bad phase name before the second call.
RRNL="$(printf 'ok\ntouch PWNED')"
printf '%s' "$RRB" | sed -e "s#<repo>#$RRT/repo#g" -e "s#<worktree_path>#$RRT/wt#g" -e "s#<n>#7#g" > "$RRT/blk0.sh"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[2],fs.readFileSync(process.argv[1],"utf8").split("<phase_name>").join(process.argv[3]))' "$RRT/blk0.sh" "$RRT/blk.sh" "$RRNL"
: > "$RRT/log"; (cd "$RRT" && RR_LOG="$RRT/log" bash "$RRT/blk.sh" > "$RRT/out" 2>&1); rc=$?
if [ -z "$(find "$RRT" -name PWNED)" ] && [ "$rc" = "2" ] && [ "$(wc -l < "$RRT/log")" = "1" ] && grep -q 'STOP: bad phase name' "$RRT/out"; then pass_case "FLN a phase value 'ok' + newline + 'touch PWNED': STOP bad phase name, no PWNED file, one stub call only"
else fail_case "FLN rc=$rc found=$(find "$RRT" -name PWNED) log=$(cat "$RRT/log") out=$(cat "$RRT/out")"; fi
