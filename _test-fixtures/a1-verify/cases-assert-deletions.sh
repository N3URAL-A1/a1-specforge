# Sourced by run-tests.sh (spec 027 slice 3, FR-012). Planted repos for bin/check-assert-deletions.sh. Uses the suite helpers: ok, bad.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# RED-proof (scratch copy, see STATUS.md):
#   (a) the script sums column 1 (additions) instead of column 2 : AD1 red
#   (b) the default dirs dropped (whole repo)                    : AD5 red

AD_SCRIPT="$REPO_ROOT/bin/check-assert-deletions.sh"

# ad_repo <name>: planted repo with two suite files and one outside file; sets ADR.
ad_repo() {
  ADR="$WORK/ad-$1"; rm -rf "$ADR"; mkdir -p "$ADR/_test-fixtures/a1-verify" "$ADR/_test-fixtures/a1-pr-merge-check" "$ADR/docs"
  printf 'check one\ncheck two\ncheck three\n' > "$ADR/_test-fixtures/a1-verify/run-tests.sh"
  printf 'check a\ncheck b\n' > "$ADR/_test-fixtures/a1-pr-merge-check/run-tests.sh"
  printf 'x\ny\n' > "$ADR/docs/notes.md"
  git -C "$ADR" init -q -b main
  git -C "$ADR" -c user.name=t -c user.email=t@t -c commit.gpgsign=false add -A
  git -C "$ADR" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m base
}
ad_commit() { git -C "$ADR" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -am "$1"; }
# ad_run <args...>: sets ADOUT, ADRC (cwd = planted repo)
ad_run() { ADOUT="$(cd "$ADR" && bash "$AD_SCRIPT" "$@" 2>&1)"; ADRC=$?; }

ad_repo ad1; git -C "$ADR" checkout -q -b topic
printf 'check four\n' >> "$ADR/_test-fixtures/a1-verify/run-tests.sh"; ad_commit add
ad_run --base main
[[ $ADRC -eq 0 && "$ADOUT" == "deleted=0" ]] && ok "AD1 add-only change: exit 0, deleted=0" || bad "AD1 rc=$ADRC out=$ADOUT"

ad_repo ad2; git -C "$ADR" checkout -q -b topic
sed -i.bak '2d' "$ADR/_test-fixtures/a1-verify/run-tests.sh"; rm -f "$ADR/_test-fixtures/a1-verify/run-tests.sh.bak"; ad_commit del
ad_run --base main
[[ $ADRC -eq 1 && "$ADOUT" == *"deleted=1"* && "$ADOUT" == *"_test-fixtures/a1-verify/run-tests.sh 1"* ]] && ok "AD2 one deleted line: exit 1, names the file" || bad "AD2 rc=$ADRC out=$ADOUT"

ad_repo ad3; git -C "$ADR" checkout -q -b topic
sed -i.bak '2s/two/TWO/' "$ADR/_test-fixtures/a1-verify/run-tests.sh" ; rm -f "$ADR"/_test-fixtures/*/run-tests.sh.bak
ad_commit edit
ad_run --base main
[[ $ADRC -eq 1 && "$ADOUT" == *"deleted=1"* ]] && ok "AD3 one edited line: exit 1" || bad "AD3 rc=$ADRC out=$ADOUT"

ad_repo ad4
ad_run --base nope
[[ $ADRC -eq 2 && "$ADOUT" == *"usage"* ]] && ok "AD4 unknown base ref: exit 2 with usage line" || bad "AD4 rc=$ADRC out=$ADOUT"

ad_repo ad5; git -C "$ADR" checkout -q -b topic
printf 'x\n' > "$ADR/docs/notes.md"; ad_commit outside
ad_run --base main
[[ $ADRC -eq 0 && "$ADOUT" == "deleted=0" ]] && ok "AD5 deletion outside the default dirs: exit 0" || bad "AD5 rc=$ADRC out=$ADOUT"
