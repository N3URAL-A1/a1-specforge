# Spec 027 slice 4 (FR-019): 02-review.md steps 2.1b, 2.3a, 2.3d and the Inputs list.
# Sourced by run-tests.sh (uses pass_case, fail_case, sec, REV, mk_workdir).
#
# Measured red 2026-11-20 (each on a copy of 02-review.md):
#   2.3a written with --head "$HEAD_SHA"          -> RV1
#   2.1b trigger dropped from the 2.3d prose      -> RV3
#   P3 commit sentence dropped from the 2.3d prose -> RV6

fence_of() { # fence_of <section text>: first fenced bash block of a section
  node -e 'const t=process.argv[1];const m=/```bash\n([\s\S]*?)```/.exec(t);process.stdout.write(m?m[1]:"")' "$1"
}
S21B="$(sec "$REV" '### 2.1b')"
S23A="$(sec "$REV" '### 2.3a')"
S23D="$(sec "$REV" '### 2.3d')"
B21B="$(fence_of "$S21B")"
B23A="$(fence_of "$S23A")"
B23D="$(fence_of "$S23D")"

if printf '%s' "$B23A" | grep -qF -- 'pr review-record --head <head_sha>' && ! printf '%s' "$B23A" | grep -qF '$HEAD_SHA'; then
  pass_case "RV1 the 2.3a block carries the literal --head <head_sha> and no \$HEAD_SHA (2.1b ran in another Bash call)"
else fail_case "RV1 2.3a block: $B23A"; fi
if printf '%s' "$B21B" | grep -qF 'echo "head_sha=' && printf '%s' "$S21B" | grep -qF '<head_sha>' && printf '%s' "$S21B" | grep -qF 'skip 2.2'; then
  pass_case "RV2 the 2.1b block echoes head_sha= and its prose names <head_sha> and \"skip 2.2\""
else fail_case "RV2 2.1b section incomplete"; fi
if printf '%s' "$S23D" | grep -qF '2.3a exit 0' && printf '%s' "$S23D" | grep -qF '2.1b exit 0'; then
  pass_case "RV3 the 2.3d prose names both triggers (2.3a exit 0 and 2.1b exit 0)"
else fail_case "RV3 2.3d triggers missing"; fi
if sed -n '/^## Inputs/,/^## Steps/p' "$REV" | grep -qF '`caller_spec_id`'; then pass_case "RV4 the Inputs list names caller_spec_id"
else fail_case "RV4 caller_spec_id missing from the Inputs list"; fi
if printf '%s' "$S23D" | grep -qF '.a1/reservations.json' && printf '%s' "$S23D" | grep -qF 'push-cadence'; then
  pass_case "RV6 the 2.3d prose names .a1/reservations.json and push-cadence (the P3 commit)"
else fail_case "RV6 2.3d prose lacks the reservations commit sentence"; fi

# RV5 stub run of the 2.3d block (RR-guard pattern)
mk_workdir RVT rv-stage; mkdir -p "$RVT/repo/_shared" "$RVT/rr"
cat > "$RVT/repo/_shared/a1-tools.cjs" <<'STUB'
const fs = require("fs");
fs.appendFileSync(process.env.RV_LOG, process.argv.slice(2).join(" ") + "\n");
if (process.argv[2] === "code-scope" && process.argv[3] === "list") {
  process.stdout.write(JSON.stringify({ reservations: [{ by: "fx", stage: process.env.RV_STAGE || "complete" }] }));
}
STUB
rv_run() { # $1 = caller_spec_id value, $2 = stage reported by the stub
  printf '%s' "$B23D" | sed -e "s#<repo_root>#$RVT/rr#g" -e "s#<repo>#$RVT/repo#g" ${1:+-e "s#<caller_spec_id>#$1#g"} > "$RVT/blk.sh"
  : > "$RVT/log"; (cd "$RVT" && RV_LOG="$RVT/log" RV_STAGE="${2:-complete}" bash "$RVT/blk.sh" > "$RVT/out" 2>&1); echo $?
}
rc="$(rv_run "")"
if [ "$rc" = "0" ] && grep -q 'SKIP: lifecycle stages' "$RVT/out" && [ ! -s "$RVT/log" ]; then pass_case "RV5a unreplaced <caller_spec_id>: SKIP, the stub never ran"
else fail_case "RV5a rc=$rc log=$(cat "$RVT/log") out=$(cat "$RVT/out")"; fi
rc="$(rv_run fx)"
if [ "$rc" = "0" ] && [ "$(grep -c 'code-scope stage' "$RVT/log")" = "2" ] && grep 'code-scope stage' "$RVT/log" | sed -n 1p | grep -q -- '--set review' && grep 'code-scope stage' "$RVT/log" | sed -n 2p | grep -q -- '--set verify'; then
  pass_case "RV5b spec id fx at stage complete: two stage calls, --set review then --set verify"
else fail_case "RV5b rc=$rc log=$(cat "$RVT/log") out=$(cat "$RVT/out")"; fi
rc="$(rv_run fx verify)"
if [ "$rc" = "0" ] && [ "$(grep -c 'code-scope stage' "$RVT/log")" = "0" ]; then pass_case "RV5c stage verify in the stub: no stage call (never backward)"
else fail_case "RV5c rc=$rc log=$(cat "$RVT/log")"; fi
rc="$(rv_run '$(touch PWNED)')"
if [ -z "$(find "$RVT" -name PWNED)" ] && [ "$(grep -c 'code-scope stage' "$RVT/log")" = "0" ]; then pass_case "RV5d a \$(touch PWNED) value is not executed (no PWNED file, no matching reservation, no stage call)"
else fail_case "RV5d rc=$rc found=$(find "$RVT" -name PWNED) log=$(cat "$RVT/log")"; fi

# ---- review fix round 1 (PR #108, M1): findings.json is bound to the head it was written for ----
S24="$(sec "$REV" '### 2.4')"
if printf '%s' "$S24" | grep -qF '"head_sha": "<head_sha>"'; then pass_case "RV7 2.4 writes head_sha into findings.json"
else fail_case "RV7 2.4 does not name the head_sha field of findings.json"; fi
# RV8 stub run of the 2.1b block: stale / missing / matching findings head
mk_workdir RVB rv-bind; mkdir -p "$RVB/repo/_shared" "$RVB/wt/.a1-review"
cat > "$RVB/repo/_shared/a1-tools.cjs" <<'STUB'
process.exit(0);
STUB
git -C "$RVB/wt" init -q -b main 2>/dev/null
git -C "$RVB/wt" -c user.name=fx -c user.email=fx@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q --allow-empty -m base
RVB_HEAD="$(git -C "$RVB/wt" rev-parse HEAD)"
printf '%s' "$B21B" | sed -e "s#<worktree_path>#$RVB/wt#g" -e "s#<repo>#$RVB/repo#g" -e "s#<n>#7#g" > "$RVB/blk.sh"
rvb_run() { (cd "$RVB" && bash "$RVB/blk.sh" 2>&1); }
printf '{"head_sha":"%s","blocker":[],"major":[],"minor":[]}\n' "$RVB_HEAD" > "$RVB/wt/.a1-review/findings.json"
if rvb_run | grep -qx 'findings_head=match'; then pass_case "RV8a findings.json head_sha equals HEAD: findings_head=match"
else fail_case "RV8a match case: $(rvb_run)"; fi
printf '{"head_sha":"%040d","blocker":[],"major":[],"minor":[]}\n' 0 > "$RVB/wt/.a1-review/findings.json"
if rvb_run | grep -qx 'findings_head=stale-or-missing'; then pass_case "RV8b findings.json of another head: findings_head=stale-or-missing"
else fail_case "RV8b stale case: $(rvb_run)"; fi
printf '{"blocker":[],"major":[],"minor":[]}\n' > "$RVB/wt/.a1-review/findings.json"
if rvb_run | grep -qx 'findings_head=stale-or-missing'; then pass_case "RV8c findings.json without head_sha: stale-or-missing"
else fail_case "RV8c no-head case: $(rvb_run)"; fi
rm -f "$RVB/wt/.a1-review/findings.json"
if rvb_run | grep -qx 'findings_head=stale-or-missing'; then pass_case "RV8d no findings.json: stale-or-missing"
else fail_case "RV8d missing file case: $(rvb_run)"; fi
# RV8e/f (review fix round 2, SEC-1 addendum): a findings.json that git tracks (a PR branch can commit one) or that is a symlink never matches
printf '{"head_sha":"%s","blocker":[],"major":[],"minor":[]}\n' "$RVB_HEAD" > "$RVB/wt/.a1-review/findings.json"
git -C "$RVB/wt" add -f .a1-review/findings.json
if rvb_run | grep -qx 'findings_head=stale-or-missing'; then pass_case "RV8e a git-tracked findings.json with the matching head_sha does not match"
else fail_case "RV8e tracked case: $(rvb_run)"; fi
git -C "$RVB/wt" rm -q --cached .a1-review/findings.json; rm -f "$RVB/wt/.a1-review/findings.json"
printf '{"head_sha":"%s","blocker":[],"major":[],"minor":[]}\n' "$RVB_HEAD" > "$RVB/real-findings.json"
ln -s "$RVB/real-findings.json" "$RVB/wt/.a1-review/findings.json"
if rvb_run | grep -qx 'findings_head=stale-or-missing'; then pass_case "RV8f a symlinked findings.json does not match"
else fail_case "RV8f symlink case: $(rvb_run)"; fi
rm -f "$RVB/wt/.a1-review/findings.json"
# RV8g-j (review fix round 3, SEC-8, R-n1): in-repo path tricks around findings.json. Each case plants a fresh work tree whose
# findings.json carries the matching head_sha and must NOT match.
rvc_git() { local d="$1"; shift; git -C "$d" -c user.name=fx -c user.email=fx@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null -c protocol.file.allow=always "$@"; }
rvc_fj() { printf '{"head_sha":"%s","blocker":[],"major":[],"minor":[]}\n' "$(git -C "$1" rev-parse HEAD)"; } # findings text bound to the CURRENT head
rvc_commit() { rvc_git "$1" add -A -f; rvc_git "$1" commit -q -m attack; }
# each setup commits its (placeholder) attack first, then writes the findings text for the resulting HEAD into the planted path
rvc_sym_tracked() { mkdir -p "$1/docs/r"; echo '{}' > "$1/docs/r/findings.json"; ln -s docs/r "$1/.a1-review"; rvc_commit "$1"; rvc_fj "$1" > "$1/docs/r/findings.json"; }
rvc_sym_untracked() { mkdir -p "$1/elsewhere"; ln -s elsewhere "$1/.a1-review"; rvc_fj "$1" > "$1/elsewhere/findings.json"; }
rvc_icase() { mkdir -p "$1/.a1-review"; echo '{}' > "$1/.a1-review/FINDINGS.json"; rvc_commit "$1"; rvc_git "$1" config core.ignorecase true; mv "$1/.a1-review/FINDINGS.json" "$1/.a1-review/findings.json"; rvc_fj "$1" > "$1/.a1-review/findings.json"; }
rvc_submodule() {
  local s="$RVB/sub-$$"; rm -rf "$s"; mkdir -p "$s"; git -C "$s" init -q -b main 2>/dev/null; echo '{}' > "$s/findings.json"; rvc_git "$s" add -A; rvc_git "$s" commit -q -m s
  rvc_git "$1" submodule add -q "$s" .a1-review 2>/dev/null; rvc_commit "$1"; rvc_fj "$1" > "$1/.a1-review/findings.json"
}
rvc_case() { # $1 = case id, $2 = description, $3 = setup function name (arg: the work tree)
  local wt="$RVB/wt-$1"; rm -rf "$wt"; mkdir -p "$wt"
  git -C "$wt" init -q -b main 2>/dev/null
  rvc_git "$wt" commit -q --allow-empty -m base
  "$3" "$wt"
  printf '%s' "$B21B" | sed -e "s#<worktree_path>#$wt#g" -e "s#<repo>#$RVB/repo#g" -e "s#<n>#7#g" > "$RVB/blk-$1.sh"
  local out; out="$(cd "$RVB" && bash "$RVB/blk-$1.sh" 2>&1)"
  if printf '%s\n' "$out" | grep -qx 'findings_head=stale-or-missing' && [ "$(grep -c . "$wt/.a1-review/findings.json" 2>/dev/null)" -ge 1 ] && grep -qF "$(git -C "$wt" rev-parse HEAD)" "$wt/.a1-review/findings.json"; then pass_case "$1 $2"
  else fail_case "$1 $2: $out"; fi
}
rvc_case RV8g "a tracked symlink .a1-review -> docs/r does not match" rvc_sym_tracked
rvc_case RV8h "an untracked symlinked .a1-review directory does not match" rvc_sym_untracked
rvc_case RV8i "a tracked FINDINGS.json on a case-insensitive checkout does not match" rvc_icase
rvc_case RV8j "a submodule at .a1-review does not match" rvc_submodule
if printf '%s' "$S21B" | grep -qF 'findings_head=match'; then pass_case "RV9 the 2.1b prose requires findings_head=match for the skip"
else fail_case "RV9 2.1b prose does not name findings_head=match"; fi

# RV10 (review fix round 4, R3-m2 / SEC-10): the 2.1b git calls ignore an inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE.
# A GIT_DIR naming another repository would make rev-parse report that repository's head, so the matching findings.json of
# THIS work tree would read as stale; with the variables unset the block still reports findings_head=match.
mk_workdir RVD rv-env; mkdir -p "$RVD/repo/_shared" "$RVD/wt/.a1-review" "$RVD/other"
echo 'process.exit(0);' > "$RVD/repo/_shared/a1-tools.cjs"
git -C "$RVD/wt" init -q -b main 2>/dev/null; rvc_git "$RVD/wt" commit -q --allow-empty -m base
git -C "$RVD/other" init -q -b main 2>/dev/null; rvc_git "$RVD/other" commit -q --allow-empty -m other-one; rvc_git "$RVD/other" commit -q --allow-empty -m other-two
rvc_fj "$RVD/wt" > "$RVD/wt/.a1-review/findings.json"
printf '%s' "$B21B" | sed -e "s#<worktree_path>#$RVD/wt#g" -e "s#<repo>#$RVD/repo#g" -e "s#<n>#7#g" > "$RVD/blk.sh"
out="$(cd "$RVD" && GIT_DIR="$RVD/other/.git" GIT_WORK_TREE="$RVD/other" GIT_INDEX_FILE="$RVD/other/.git/index" bash "$RVD/blk.sh" 2>&1)"
if printf '%s\n' "$out" | grep -qx 'findings_head=match'; then pass_case "RV10 inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE do not redirect the 2.1b git calls"
else fail_case "RV10 env-redirect case: $out"; fi
