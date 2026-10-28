# Part 06 — Stakeholder/reviewer simulation roles (spec 006-specforge-kritis-profile, FR-005).
#
# Three guards:
#   C  count asserts on the catalogue files (contract item 2: every
#      equality assert gets a count assert beside it): 9 roles in
#      stakeholder-roles.md, 10 GP items in golden-principles.md.
#   R  `profile simulate-roles --roles <csv>`: 3 known roles -> 3 cards,
#      each with id/focus/method/the mandatory question, exit 0; unknown
#      id, duplicate, >5 roles, injection-shaped id, empty --roles -> exit 1.
#   S  `profile simulate-check --spec <fixture> --roles <csv>`: a complete
#      `## Stakeholder Simulation` section -> exit 0; missing section,
#      missing block, missing "Assumption challenged:" line -> exit 1,
#      naming the role.
#   H  hostile --spec input (missing flag, nonexistent path, symlink,
#      oversized, traversal, injection-shaped) never crashes, never exits 0.
#
# RED proof (quoted in STATUS.md / the wave report, run for real against a
# scratch copy of profile-simulate.cjs, never the live tree):
#   mutation 1 (named by the wave brief) — drop the per-role block lookup,
#     and the missing-block case turns red (it would wrongly pass).
#   mutation 2 (this part's own choice) — widen role-id validation to
#     accept any non-empty string, and the injection-shaped-id case turns
#     red (it would wrongly be treated as a usage problem that still exits
#     1 for the wrong reason instead of being caught by the id-shape guard
#     — proven by checking the specific "invalid_role_id" code disappears).

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

SIM_FX="$HERE/fixtures/simulate"
ROLES_MD="$REPO_ROOT/_shared/profiles/kritis/stakeholder-roles.md"
GP_MD="$REPO_ROOT/_shared/profiles/kritis/golden-principles.md"

# ---------- C: count asserts on the catalogue files (run first — a broken
# catalogue file makes every R/S case below meaningless) ----------
caseCatalogueCounts() {
  local roles gps
  roles="$(grep -coE '^\| `[a-z-]+`' "$ROLES_MD")"
  if [[ "$roles" -eq 9 ]]; then
    ok "C stakeholder-roles.md role count: 9 roles"
  else
    bad "C stakeholder-roles.md role count: got $roles, expected 9"
  fi
  gps="$(grep -coE '^## GP-[0-9]+' "$GP_MD")"
  if [[ "$gps" -eq 10 ]]; then
    ok "C golden-principles.md GP count: 10 principles"
  else
    bad "C golden-principles.md GP count: got $gps, expected 10"
  fi
}
caseCatalogueCounts

# ---------- R: simulate-roles ----------

runCaseR() {
  # runCaseR <label> <roles-csv> <expected-rc> <expected-needle-or-empty>
  local label="$1" roles="$2" expected_rc="$3" needle="${4:-}" work out err errf rc
  mk_workdir work "sim-roles-$label"
  mk_tmpfile errf "sim-roles-err-$label"
  out="$(A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-roles --roles "$roles" 2>"$errf")"; rc=$?
  err="$(cat "$errf")"
  if [[ "$rc" -ne "$expected_rc" ]]; then
    bad "R $label: expected exit $expected_rc, got $rc (out: $out; err: $err)"
    return
  fi
  if [[ -n "$needle" ]] && ! printf '%s%s' "$out" "$err" | grep -q "$needle"; then
    bad "R $label: exit $rc as expected, but output does not name '$needle' (out: $out; err: $err)"
    return
  fi
  ok "R $label: exit $expected_rc${needle:+, output names $needle}"
}

runCaseR "three-known-roles" "security-officer,dpo,ops" 0 ""
runCaseR "unknown-id"        "foo"                       1 "unknown_role"
runCaseR "duplicate"         "dpo,dpo"                   1 "duplicate_role"
runCaseR "too-many"          "product-owner,architect,contract-guardian,security-officer,data-engineer,harness-auditor" 1 "too_many_roles"
runCaseR "injection-shaped"  "dpo; rm -rf /"              1 "invalid_role_id"
runCaseR "empty"             ""                           1 ""

# three-known-roles' output must additionally carry every role id, the
# mandatory question, and exactly 3 "### " blocks — checked separately so
# the generic exit-code assert above still runs even if this stricter one
# fails.
caseRThreeRolesCardShape() {
  local work out errf rc blocks
  mk_workdir work "sim-roles-shape"
  mk_tmpfile errf "sim-roles-shape-err"
  out="$(A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-roles --roles security-officer,dpo,ops 2>"$errf")"; rc=$?
  blocks="$(printf '%s' "$out" | grep -coE '^### ')"
  if [[ $rc -eq 0 && "$blocks" -eq 3 ]] \
    && printf '%s' "$out" | grep -q '### security-officer' \
    && printf '%s' "$out" | grep -q '### dpo' \
    && printf '%s' "$out" | grep -q '### ops' \
    && printf '%s' "$out" | grep -q 'name one assumption the author treats as given'; then
    ok "R three-known-roles: exactly 3 cards, all three ids present, mandatory question present"
  else
    bad "R three-known-roles: card shape wrong (blocks=$blocks, out: $out; err: $(cat "$errf"))"
  fi
}
caseRThreeRolesCardShape

# ---------- S: simulate-check over the fixtures ----------

runCaseS() {
  # runCaseS <label> <fixture-file> <roles-csv> <expected-rc> <expected-needle-or-empty>
  local label="$1" fixture="$2" roles="$3" expected_rc="$4" needle="${5:-}" work out err errf rc
  mk_workdir work "sim-check-$label"
  mk_tmpfile errf "sim-check-err-$label"
  out="$(A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-check --spec "$SIM_FX/$fixture" --roles "$roles" 2>"$errf")"; rc=$?
  err="$(cat "$errf")"
  if [[ "$rc" -ne "$expected_rc" ]]; then
    bad "S $label: expected exit $expected_rc, got $rc (out: $out; err: $err)"
    return
  fi
  if [[ -n "$needle" ]] && ! printf '%s%s' "$out" "$err" | grep -q "$needle"; then
    bad "S $label: exit $rc as expected, but output does not name '$needle' (out: $out; err: $err)"
    return
  fi
  ok "S $label: exit $expected_rc${needle:+, output names $needle}"
}

runCaseS "complete"              "spec-006-with-simulation.md"         "security-officer,dpo,ops" 0 ""
runCaseS "section-missing"       "spec-006-no-section.md"              "security-officer,dpo,ops" 1 "section_missing"
runCaseS "block-missing-ops"     "spec-006-block-missing-ops.md"       "security-officer,dpo,ops" 1 "block_missing"
runCaseS "assumption-missing"    "spec-006-assumption-missing-ops.md"  "security-officer,dpo,ops" 1 "assumption_missing"

# block-missing-ops's finding must additionally name the missing role (ops),
# not just the generic code.
caseSBlockMissingNamesOps() {
  local work out errf rc
  mk_workdir work "sim-check-blockmissing-named"
  mk_tmpfile errf "sim-check-blockmissing-named-err"
  out="$(A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-check --spec "$SIM_FX/spec-006-block-missing-ops.md" --roles security-officer,dpo,ops 2>"$errf")"; rc=$?
  if [[ $rc -eq 1 ]] && printf '%s' "$out" | grep -q 'block_missing ops'; then
    ok "S block-missing-ops: finding names the missing role (ops) specifically"
  else
    bad "S block-missing-ops: finding does not name ops specifically (out: $out; err: $(cat "$errf"))"
  fi
}
caseSBlockMissingNamesOps

# ---------- H: hostile input ----------

caseHMissingSpecFlag() {
  local work rc errf
  mk_workdir work "sim-h-missingflag"
  mk_tmpfile errf "sim-h-missingflag-err"
  A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-check --roles security-officer >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -eq 1 ]]; then
    ok "H missing --spec: usage error, exit 1"
  else
    bad "H missing --spec: expected exit 1, got $rc"
  fi
}
caseHMissingSpecFlag

caseHNonexistentPath() {
  local work rc errf
  mk_workdir work "sim-h-nonexistent"
  mk_tmpfile errf "sim-h-nonexistent-err"
  A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-check --spec "$work/does-not-exist.md" --roles dpo >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -eq 2 ]]; then
    ok "H nonexistent --spec path: exit 2"
  else
    bad "H nonexistent --spec path: expected exit 2, got $rc"
  fi
}
caseHNonexistentPath

caseHSymlink() {
  local work realfile linkfile rc errf
  mk_workdir work "sim-h-symlink"
  realfile="$work/real.md"
  linkfile="$work/link.md"
  cp "$SIM_FX/spec-006-with-simulation.md" "$realfile"
  ln -s "$realfile" "$linkfile"
  mk_tmpfile errf "sim-h-symlink-err"
  A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-check --spec "$linkfile" --roles dpo >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -eq 2 ]]; then
    ok "H symlink --spec: a symlinked file is refused, exit 2"
  else
    bad "H symlink --spec: expected exit 2, got $rc"
  fi
}
caseHSymlink

caseHOversized() {
  local work big rc errf
  mk_workdir work "sim-h-oversized"
  big="$work/big.md"
  cp "$SIM_FX/spec-006-with-simulation.md" "$big"
  head -c 1100000 /dev/zero | tr '\0' 'x' >>"$big"
  mk_tmpfile errf "sim-h-oversized-err"
  timeout 10 env A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-check --spec "$big" --roles dpo >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -eq 2 ]]; then
    ok "H oversized --spec: a spec >= 1 MiB is refused within 10s, exit 2"
  else
    bad "H oversized --spec: expected exit 2, got $rc"
  fi
}
caseHOversized

caseHTraversal() {
  # Measured (2026-10-28): --spec goes through resolveVaultPath, which for
  # an absolute input only runs the intent-sandbox child-mode guard
  # (guardChildPath) — a no-op outside that mode, same as profile-ears.cjs's
  # own --spec handling (03-ears.sh has no traversal case for the same
  # reason). A traversal path that resolves to a real, readable, non-symlink
  # file outside the fixture tree (/etc/passwd) is not refused at the path
  # level; it is read and evaluated like any other file, so the correct
  # outcome here is "no Stakeholder Simulation section", not a path-safety
  # exit 2. This case asserts that real behaviour (never a crash, never a
  # false exit 0) rather than a refusal this module does not implement.
  local work rc errf out
  mk_workdir work "sim-h-traversal"
  mk_tmpfile errf "sim-h-traversal-err"
  out="$(A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-check --spec "$work/../../../../etc/passwd" --roles dpo 2>"$errf")"; rc=$?
  if [[ $rc -eq 1 ]] && printf '%s' "$out" | grep -q 'section_missing'; then
    ok "H traversal --spec: resolves to a real file outside the fixture tree, evaluated (no section found), exit 1 — never a crash or a false exit 0"
  else
    bad "H traversal --spec: expected exit 1/section_missing (no path-level refusal implemented here), got rc=$rc (out: $out; err: $(cat "$errf"))"
  fi
}
caseHTraversal

caseHInjectionShapedSpec() {
  local work rc errf spec='$(echo pwned).md'
  mk_workdir work "sim-h-injection"
  mk_tmpfile errf "sim-h-injection-err"
  A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-check --spec "$work/$spec" --roles dpo >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -eq 2 ]]; then
    ok "H injection-shaped --spec: a shell-metacharacter filename is refused, exit 2"
  else
    bad "H injection-shaped --spec: expected exit 2, got $rc"
  fi
}
caseHInjectionShapedSpec

caseHInjectionShapedRolesOnCheck() {
  local work rc errf
  mk_workdir work "sim-h-injection-roles"
  mk_tmpfile errf "sim-h-injection-roles-err"
  A1_VAULT_ROOT="$work" node "$TOOLS" profile simulate-check --spec "$SIM_FX/spec-006-with-simulation.md" --roles 'dpo; rm -rf /' >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -ne 0 ]]; then
    ok "H injection-shaped --roles on simulate-check: never exits 0, got $rc"
  else
    bad "H injection-shaped --roles on simulate-check: wrongly exited 0"
  fi
}
caseHInjectionShapedRolesOnCheck

# ---------- RED proof 1 (wave-brief mutation): drop the per-role block
# lookup, and the missing-block case turns red ----------
# Copies the whole _shared tree into a scratch dir (never the live tree),
# patches profile-simulate.cjs so evaluateSimulation treats every requested
# role as having a block (skips the lookup into the parsed blocks map),
# reruns the block-missing-ops fixture against the mutated copy, and
# asserts the result flips from exit 1 to exit 0 — proving the real
# check's per-role block lookup is load bearing, the named mutation from
# the wave brief.
caseRedProofBlockLookup() {
  local mutdir mutfile fxdir errf rc out
  mk_workdir mutdir "sim-redproof1"
  cp -R "$REPO_ROOT/_shared" "$mutdir/_shared"
  mutfile="$mutdir/_shared/lib/profile-simulate.cjs"
  if ! grep -q 'const body = blocks\[id\];' "$mutfile"; then
    bad "RED-1: anchor 'const body = blocks[id];' not found in profile-simulate.cjs (mutation cannot be applied — report, do not skip)"
    return
  fi
  # Mutation: look up a block that is always present (the first requested
  # id's own block, which is "security-officer" here) instead of the
  # per-role id, so the per-role block lookup no longer discriminates.
  sed -E 's/const body = blocks\[id\];/const body = blocks[ids[0]];/' "$mutfile" >"$mutfile.new"
  mv "$mutfile.new" "$mutfile"
  mk_workdir fxdir "sim-redproof1-fx"
  mk_tmpfile errf "sim-redproof1-err"
  out="$(A1_VAULT_ROOT="$fxdir" node "$mutdir/_shared/a1-tools.cjs" profile simulate-check --spec "$SIM_FX/spec-006-block-missing-ops.md" --roles security-officer,dpo,ops 2>"$errf")"; rc=$?
  if [[ $rc -eq 0 ]]; then
    ok "RED-1: dropping the per-role block lookup turns block-missing-ops from exit 1 to exit 0 (mutation proves the lookup is load bearing)"
  else
    bad "RED-1: mutation did not flip block-missing-ops to exit 0 (got rc=$rc, out: $out, err: $(cat "$errf")) — the guard may not prove what it claims"
  fi
}
caseRedProofBlockLookup

# ---------- RED proof 2 (this part's own choice): widen role-id
# validation to accept any non-empty string ----------
# Mutation: the kebab-case id-shape guard (ROLE_ID_PATTERN) is replaced
# with a pattern that accepts any non-empty string, so an injection-shaped
# id ("dpo; rm -rf /") is no longer rejected at the shape-check step and
# instead falls through to the catalogue lookup, which reports the more
# generic "unknown_role" rather than "invalid_role_id" — proving the
# shape guard, not just the catalogue lookup, is what the real check
# relies on to name this specific finding.
caseRedProofRoleIdShape() {
  local mutdir mutfile work errf rc out
  mk_workdir mutdir "sim-redproof2"
  cp -R "$REPO_ROOT/_shared" "$mutdir/_shared"
  mutfile="$mutdir/_shared/lib/profile-simulate.cjs"
  if ! grep -q "const ROLE_ID_PATTERN = /\^\[a-z\]\[a-z-\]\*\$/;" "$mutfile"; then
    bad "RED-2: anchor 'const ROLE_ID_PATTERN = ...' not found in profile-simulate.cjs (mutation cannot be applied — report, do not skip)"
    return
  fi
  sed -E "s#const ROLE_ID_PATTERN = /\\^\\[a-z\\]\\[a-z-\\]\\*\\\$/;#const ROLE_ID_PATTERN = /^.+\$/;#" "$mutfile" >"$mutfile.new"
  mv "$mutfile.new" "$mutfile"
  mk_workdir work "sim-redproof2-fx"
  mk_tmpfile errf "sim-redproof2-err"
  out="$(A1_VAULT_ROOT="$work" node "$mutdir/_shared/a1-tools.cjs" profile simulate-roles --roles 'dpo; rm -rf /' 2>"$errf")"; rc=$?
  if [[ $rc -eq 1 ]] && ! printf '%s%s' "$out" "$(cat "$errf")" | grep -q 'invalid_role_id'; then
    ok "RED-2: widening the id-shape guard to accept any non-empty string loses the 'invalid_role_id' code on the injection-shaped id (mutation proves the shape guard is load bearing)"
  else
    bad "RED-2: mutation did not change the finding code as expected (got rc=$rc, out: $out, err: $(cat "$errf")) — the guard may not prove what it claims"
  fi
}
caseRedProofRoleIdShape
