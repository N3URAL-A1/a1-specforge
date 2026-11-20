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
