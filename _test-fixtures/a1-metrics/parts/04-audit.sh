# Part 04 — spec 018 Wave 4: suite audit (FR-005, FR-014, FR-016, FR-017).
# Sourced by run-tests.sh. Pure file reads: no vault, no network.
#
# Each case names the single change that turns it red:
#   AU1 stub          : a "not implemented — spec 018" string back in the facade or lib
#   AU2 workflow      : --found-by / --should-have-caught dropped from the fenced init-postmortem call
#   AU3 cost step     : the `cost run` step or its exit-code test removed from 04-verify.md
#   AU4 offline       : require('https') (or http, net, dns, child_process, ...) added to a metrics module
#   AU5 deps          : a package.json with dependencies appears
#   AU6 inventory     : a requirement loses its named case
#   AU7 exit codes    : a usage error of one metrics command exits 2 instead of 1

VERIFY_MD="$REPO_ROOT/skills/a1-fix/workflows/04-verify.md"

# ---- AU1 no spec 018 stub left (count 0 beside a scanned-file count) ----
STUB_N="$(grep -rEc 'not implemented — spec 018|not implemented, spec 018' "$TOOLS" "$SHARED"/lib/*.cjs | awk -F: '{n+=$NF} END{print n+0}')"
LIB_N="$(ls "$SHARED"/lib/*.cjs | wc -l | tr -d ' ')"
assert_eq "AU1a no 'not implemented — spec 018' stub in facade or lib (count 0)" "$STUB_N" "0"
assert_eq "AU1b scanned more than 50 lib files" "$([[ "$LIB_N" -gt 50 ]] && echo yes || echo no)" "yes"

# ---- AU2 FR-005 the fenced init-postmortem call carries both flags ----
CALL="$(awk '/fix init-postmortem/{c=1} c{print} c && !/\\$/{exit}' "$VERIFY_MD")"
assert_eq "AU2a init-postmortem call found (count 1 line with the command)" "$(grep -c 'fix init-postmortem' <<<"$CALL")" "1"
assert_has "AU2b call has --found-by" "$CALL" '--found-by'
assert_has "AU2c call has --should-have-caught" "$CALL" '--should-have-caught'
assert_eq "AU2d --found-by appears once in 04-verify.md call blocks (count)" "$(grep -c -- '--found-by "' "$VERIFY_MD")" "1"
assert_eq "AU2e rule 'found_by: user' stated (count >= 1)" "$([[ "$(grep -c 'found_by: user' "$VERIFY_MD")" -ge 1 ]] && echo yes || echo no)" "yes"
assert_eq "AU2f reviewer:<agent> option named (count >= 1)" "$([[ "$(grep -c 'reviewer:<agent>' "$VERIFY_MD")" -ge 1 ]] && echo yes || echo no)" "yes"

# ---- AU3 the fix cost step, after "Mark fixed", with an explicit exit-code test ----
assert_eq "AU3a cost run call in 04-verify.md (count 1)" "$(grep -c 'a1-tools.cjs cost run --project' "$VERIFY_MD")" "1"
assert_has "AU3b cost line format" "$(cat "$VERIFY_MD")" 'Cost: N tokens (in X, out Y, cache Z)'
COST_AT="$(grep -n 'a1-tools.cjs cost run' "$VERIFY_MD" | head -1 | cut -d: -f1)"
FIXED_AT="$(grep -n '^## Step 3 — Mark fixed' "$VERIFY_MD" | head -1 | cut -d: -f1)"
STEP4_AT="$(grep -n '^## Step 4' "$VERIFY_MD" | head -1 | cut -d: -f1)"
assert_eq "AU3c cost step sits between Mark fixed and Step 4" "$([[ -n "$COST_AT" && -n "$FIXED_AT" && -n "$STEP4_AT" && "$COST_AT" -gt "$FIXED_AT" && "$COST_AT" -lt "$STEP4_AT" ]] && echo yes || echo no)" "yes"
assert_eq "AU3d cost step tests its exit code (count 1)" "$(sed -n "${COST_AT:-1},$((${COST_AT:-1} + 4))p" "$VERIFY_MD" | grep -c 'RC=\$?')" "1"
G0="$(grep -n '^### 0.1' "$VERIFY_MD" | cut -d: -f1)"; G1="$(grep -n '^### 0.2' "$VERIFY_MD" | cut -d: -f1)"; G2="$(grep -n '^### 0.3' "$VERIFY_MD" | cut -d: -f1)"
assert_eq "AU3e 017 gate blocks keep order 0.1 < 0.2 < 0.3" "$([[ -n "$G0" && "$G0" -lt "$G1" && "$G1" -lt "$G2" ]] && echo yes || echo no)" "yes"
run_tools "$V1" workflow lint
assert_rc "AU3f workflow lint stays green" 0 "$RC" "${OUT:0:300}"

# ---- AU4 FR-014 no network or process access in the metrics modules ----
MODS=("$SHARED"/lib/metrics*.cjs "$SHARED/lib/postmortem-fields.cjs" "$SHARED/lib/help-metrics.cjs")
assert_eq "AU4a metrics module files found (count 6)" "${#MODS[@]}" "6"
NET_RE="(require|import)[ (]*['\"](node:)?(https?|http2|net|dns|dgram|tls|child_process|cluster|worker_threads|vm)(/[a-z]+)?['\"]|\\bfetch[ ]*\\(|\\bXMLHttpRequest\\b|process\\.binding"
NET_N="$(grep -Ec "$NET_RE" "${MODS[@]}" | awk -F: '{n+=$NF} END{print n+0}')"
assert_eq "AU4b no http/https/net/dns/child_process require or fetch (count 0)" "$NET_N" "0"
# the pattern really matches what it must forbid (control)
CTRL_N="$(printf "const h = require('https');\nconst c = require(\"node:child_process\");\n" | grep -Ec "$NET_RE")"
assert_eq "AU4c control: the pattern flags both planted requires (count 2)" "$CTRL_N" "2"

# ---- AU5 FR-014 no new dependency ----
assert_eq "AU5 repo has no package.json (no dependency can have been added)" "$([[ -e "$REPO_ROOT/package.json" ]] && echo present || echo absent)" "absent"

# ---- AU6 FR-017 every requirement has a named case in this suite ----
SUITE_SRC="$(cat "$SUITE"/parts/0[123]-*.sh)"
inv=0
for pair in 'FR-001:PM1a' 'FR-002:PM2a' 'FR-003:PM3a' 'FR-004:PM4a' 'FR-016:PM5d' 'FR-006:ES1a' 'FR-007:ES2a' 'FR-008:ES5a' \
            'FR-009:ES4a' 'FR-015:ES7b' 'FR-010:CO1c' 'FR-011:CO2' 'FR-012:CO3' 'FR-013:CO4'; do
  fr="${pair%%:*}"; id="${pair#*:}"
  if grep -qF -- "\"$id" <<<"$SUITE_SRC"; then inv=$((inv + 1)); else bad "AU6 $fr has no case starting with $id"; fi
done
assert_eq "AU6a requirements with a named case (count 14 of 14)" "$inv" "14"
assert_eq "AU6b byte-copy checks present for postmortems and base set (count 2)" "$(grep -cE '"(PM0b|ES0b) ' <<<"$SUITE_SRC")" "2"

# ---- AU7 exit-code convention: usage error 1, I/O or absent vault 2 — the same for both commands ----
mk_vault V9 au7
for sub in escaped cost; do
  run_tools "$V9" metrics "$sub" --project demo --last 0
  assert_rc "AU7 $sub --last 0 (usage error)" 1 "$RC" "${OUT:0:200}"
  run_tools "$V9" metrics "$sub" --project demo --bogus-flag
  if [[ "$sub" == escaped ]]; then assert_rc "AU7 $sub unknown flag (usage error)" 1 "$RC" "${OUT:0:200}"; fi
  run_tools "$V9/absent" metrics "$sub" --project demo
  assert_rc "AU7 $sub vault absent (I/O)" 2 "$RC" "${OUT:0:200}"
done
run_tools "$V9" metrics
assert_rc "AU7 metrics without subcommand (FR-016)" 1 "$RC" "${OUT:0:200}"
