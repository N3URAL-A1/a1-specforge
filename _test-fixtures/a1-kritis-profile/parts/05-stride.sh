# Part 05 — STRIDE template and threat-model check (spec 006-specforge-kritis-profile, FR-003).
#
# Three guards:
#   T  `profile threat-model-check --id <###-slug> --repo-root <dir>` on a
#      filled threat-model.md: exit 0 on a complete template, exit 1 with the
#      named finding code on each broken fixture, exit 2 on a missing file, a
#      symlinked file, and an id outside ^[0-9]{3}-[a-z0-9-]+$.
#   C  the 42-item/6-category count asserts on stride.md (contract item 2:
#      every equality assert gets a count assert beside it).
#   H  hostile --id / --repo-root input (traversal, injection-shaped, >=10,000
#      chars) never crashes and never exits 0.
#
# RED proof (quoted in STATUS.md / the wave report, run for real):
#   mutation 1 — count five categories as complete (drop the D-category
#   lookup) turns the category-missing-D case red (it would wrongly pass).
#   mutation 2 — skip the accepted-risks lookup turns the accepted-high-open
#   case red (exit 0 expected; without the lookup the checker would call it
#   unmitigated and exit 1).

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

STRIDE_FX="$HERE/fixtures/stride"
STRIDE_MD="$REPO_ROOT/_shared/profiles/kritis/stride.md"

# ---------- C: count asserts on stride.md (run first — a broken catalogue
# file makes every T case below meaningless) ----------
caseStrideCatalogueCounts() {
  local total s t r i d e
  total="$(grep -coE '^\| (S|T|R|I|D|E)-[0-9]+' "$STRIDE_MD")"
  if [[ "$total" -eq 42 ]]; then
    ok "C stride.md item count: 42 STRIDE items across 6 categories"
  else
    bad "C stride.md item count: got $total, expected 42"
  fi
  s="$(grep -coE '^\| S-[0-9]+' "$STRIDE_MD")"
  t="$(grep -coE '^\| T-[0-9]+' "$STRIDE_MD")"
  r="$(grep -coE '^\| R-[0-9]+' "$STRIDE_MD")"
  i="$(grep -coE '^\| I-[0-9]+' "$STRIDE_MD")"
  d="$(grep -coE '^\| D-[0-9]+' "$STRIDE_MD")"
  e="$(grep -coE '^\| E-[0-9]+' "$STRIDE_MD")"
  if [[ "$s" -eq 6 && "$t" -eq 7 && "$r" -eq 6 && "$i" -eq 8 && "$d" -eq 8 && "$e" -eq 7 ]]; then
    ok "C stride.md per-category counts: S=6 T=7 R=6 I=8 D=8 E=7"
  else
    bad "C stride.md per-category counts: got S=$s T=$t R=$r I=$i D=$d E=$e, expected S=6 T=7 R=6 I=8 D=8 E=7"
  fi
}
caseStrideCatalogueCounts

# ---------- T: threat-model-check over the fixtures ----------
buildStrideRepo() {
  # buildStrideRepo <workvar> <id> <fixture-file>
  local __workvar="$1" __id="$2" __fixture="$3" __dir
  mk_workdir __dir "stride-repo"
  mkdir -p "$__dir/docs/product/features/$__id"
  cp "$STRIDE_FX/$__fixture" "$__dir/docs/product/features/$__id/threat-model.md"
  printf -v "$__workvar" '%s' "$__dir"
}

runCaseT() {
  # runCaseT <label> <fixture-file> <expected-rc> <expected-needle-or-empty>
  local label="$1" fixture="$2" expected_rc="$3" needle="${4:-}" dir out err errf rc
  buildStrideRepo dir "006-sample" "$fixture"
  mk_tmpfile errf "stride-err"
  out="$(node "$TOOLS" profile threat-model-check --id "006-sample" --repo-root "$dir" 2>"$errf")"; rc=$?
  err="$(cat "$errf")"
  if [[ "$rc" -ne "$expected_rc" ]]; then
    bad "T $label: expected exit $expected_rc, got $rc (out: $out; err: $err)"
    return
  fi
  if [[ -n "$needle" ]] && ! printf '%s%s' "$out" "$err" | grep -q "$needle"; then
    bad "T $label: exit $rc as expected, but output does not name '$needle' (out: $out; err: $err)"
    return
  fi
  ok "T $label: exit $expected_rc${needle:+, output names $needle}"
}

runCaseT "complete"                   "complete.md"                  0 ""
runCaseT "category-missing-D"         "category-missing-D.md"        1 "category_missing"
runCaseT "unmitigated-high-open"      "unmitigated-high-open.md"     1 "unmitigated"
runCaseT "accepted-high-open"         "accepted-high-open.md"        0 ""
runCaseT "bad-risk"                   "bad-risk.md"                  1 "bad_risk"
runCaseT "bad-status"                 "bad-status.md"                1 "bad_status"
runCaseT "not-applicable-no-reason"   "not-applicable-no-reason.md"  1 "not_applicable_without_reason"
runCaseT "section-missing-actors"     "section-missing-actors.md"    1 "section_missing"

# category-missing-D's finding must additionally name the missing category
# letter (D), not just the generic code — checked separately so the
# generic-code assert above still runs even if this stricter one fails.
caseTCategoryMissingNamesD() {
  local dir errf rc out err
  buildStrideRepo dir "006-sample" "category-missing-D.md"
  mk_tmpfile errf "stride-err-catd"
  out="$(node "$TOOLS" profile threat-model-check --id "006-sample" --repo-root "$dir" 2>"$errf")"; rc=$?
  err="$(cat "$errf")"
  if [[ "$rc" -eq 1 ]] && printf '%s%s' "$out" "$err" | grep -qi '\bd\b'; then
    ok "T category-missing-D: finding also names the missing category (D)"
  else
    bad "T category-missing-D: finding does not name D specifically (out: $out; err: $err)"
  fi
}
caseTCategoryMissingNamesD

# ---------- H: hostile input ----------
caseHMissingFile() {
  local dir rc errf
  mk_workdir dir "stride-missing"
  mkdir -p "$dir/docs/product/features/006-sample"
  mk_tmpfile errf "stride-err-missing"
  node "$TOOLS" profile threat-model-check --id "006-sample" --repo-root "$dir" >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -eq 2 ]]; then
    ok "H missing file: no threat-model.md present exits 2"
  else
    bad "H missing file: expected exit 2, got $rc"
  fi
}
caseHMissingFile

caseHSymlink() {
  local dir realdir rc errf
  mk_workdir dir "stride-symlink"
  mk_workdir realdir "stride-symlink-target"
  mkdir -p "$dir/docs/product/features/006-sample"
  cp "$STRIDE_FX/complete.md" "$realdir/threat-model.md"
  ln -s "$realdir/threat-model.md" "$dir/docs/product/features/006-sample/threat-model.md"
  mk_tmpfile errf "stride-err-symlink"
  node "$TOOLS" profile threat-model-check --id "006-sample" --repo-root "$dir" >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -eq 2 ]]; then
    ok "H symlink: a symlinked threat-model.md is refused, exit 2"
  else
    bad "H symlink: expected exit 2, got $rc"
  fi
}
caseHSymlink

caseHBadId() {
  local dir rc errf badid
  mk_workdir dir "stride-badid"
  for badid in "../../etc/passwd" '$(echo pwned)' "006_Sample" "6-sample" "006-Sample!"; do
    mk_tmpfile errf "stride-err-badid"
    node "$TOOLS" profile threat-model-check --id "$badid" --repo-root "$dir" >/dev/null 2>"$errf"; rc=$?
    if [[ $rc -ne 2 ]]; then
      bad "H bad id '$badid': expected exit 2, got $rc"
      return
    fi
  done
  ok "H bad id: every id outside ^[0-9]{3}-[a-z0-9-]+\$ exits 2"
}
caseHBadId

caseHOversized() {
  local dir rc errf id="006-sample"
  mk_workdir dir "stride-oversized"
  mkdir -p "$dir/docs/product/features/$id"
  cp "$STRIDE_FX/complete.md" "$dir/docs/product/features/$id/threat-model.md"
  head -c 600000 /dev/zero | tr '\0' 'x' >>"$dir/docs/product/features/$id/threat-model.md"
  mk_tmpfile errf "stride-err-oversized"
  mk_tmpfile outf "stride-out-oversized"
  run_bounded 10 "$outf" "$errf" \
    -- node "$TOOLS" profile threat-model-check --id "$id" --repo-root "$dir"; rc=$?
  if [[ $rc -eq 2 ]]; then
    ok "H oversized: a threat-model.md >= 512 KiB is refused within 10s, exit 2"
  else
    bad "H oversized: expected exit 2, got $rc"
  fi
}
caseHOversized

caseHTraversalRepoRoot() {
  local dir rc errf id="006-sample"
  mk_workdir dir "stride-traversal"
  mk_tmpfile errf "stride-err-traversal"
  node "$TOOLS" profile threat-model-check --id "$id" --repo-root "$dir/../../../etc" >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -eq 2 ]]; then
    ok "H traversal --repo-root: a path reaching outside the fixture tree is refused, exit 2"
  else
    bad "H traversal --repo-root: expected exit 2, got $rc"
  fi
}
caseHTraversalRepoRoot

caseHInjectionShapedId() {
  local dir rc errf id='006-sample; rm -rf /'
  mk_workdir dir "stride-injection"
  mk_tmpfile errf "stride-err-injection"
  node "$TOOLS" profile threat-model-check --id "$id" --repo-root "$dir" >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -eq 2 ]]; then
    ok "H injection-shaped id: a shell-metacharacter id is refused, exit 2"
  else
    bad "H injection-shaped id: expected exit 2, got $rc"
  fi
}
caseHInjectionShapedId

# ---------- RED proof 1: count five categories as complete ----------
# Copies the whole _shared tree into a scratch dir (never the live tree),
# patches profile-stride.cjs so the category-completeness check accepts 5 of
# the 6 required categories as complete, reruns category-missing-D.md
# against the mutated copy, and asserts the result flips from exit 1 to
# exit 0 — proving the real check's full-category requirement is load
# bearing, the named mutation from the wave brief.
caseRedProofCategoryCount() {
  local mutdir mutfile fxdir errf rc
  mk_workdir mutdir "stride-redproof1"
  cp -R "$REPO_ROOT/_shared" "$mutdir/_shared"
  mutfile="$mutdir/_shared/lib/profile-stride.cjs"
  if ! grep -q 'for (const required of REQUIRED_CATEGORIES)' "$mutfile"; then
    bad "RED-1: anchor 'for (const required of REQUIRED_CATEGORIES)' not found in profile-stride.cjs (mutation cannot be applied — report, do not skip)"
    return
  fi
  # Mutation: the category-completeness loop drops "Denial of Service" from
  # the set it requires — the simplest "count five categories as complete"
  # edit, chosen to match this fixture's actually-missing category (D), so
  # the mutated check wrongly calls category-missing-D.md complete.
  sed -E "s/for \(const required of REQUIRED_CATEGORIES\)/for (const required of REQUIRED_CATEGORIES.filter(function (c) { return c !== 'Denial of Service'; }))/" "$mutfile" >"$mutfile.new"
  mv "$mutfile.new" "$mutfile"
  mk_workdir fxdir "stride-redproof1-fx"
  mkdir -p "$fxdir/docs/product/features/006-sample"
  cp "$STRIDE_FX/category-missing-D.md" "$fxdir/docs/product/features/006-sample/threat-model.md"
  mk_tmpfile errf "stride-redproof1-err"
  node "$mutdir/_shared/a1-tools.cjs" profile threat-model-check --id "006-sample" --repo-root "$fxdir" >/dev/null 2>"$errf"; rc=$?
  if [[ $rc -eq 0 ]]; then
    ok "RED-1: counting 5 categories as complete turns category-missing-D from exit 1 to exit 0 (mutation proves the real check discriminates)"
  else
    bad "RED-1: mutation did not flip category-missing-D to exit 0 (got rc=$rc) — the guard may not prove what it claims"
  fi
}
caseRedProofCategoryCount

# ---------- RED proof 2: skip the accepted-risks lookup ----------
caseRedProofAcceptedLookup() {
  local mutdir mutfile fxdir errf rc out
  mk_workdir mutdir "stride-redproof2"
  cp -R "$REPO_ROOT/_shared" "$mutdir/_shared"
  mutfile="$mutdir/_shared/lib/profile-stride.cjs"
  if ! grep -q 'function parseAcceptedRisks' "$mutfile"; then
    bad "RED-2: anchor 'function parseAcceptedRisks' not found in profile-stride.cjs (mutation cannot be applied — report, do not skip)"
    return
  fi
  # Mutation: the accepted-risks parser always reports no accepted entries,
  # so every high/open row is unmitigated regardless of a matching
  # "## Accepted risks" line.
  sed -E 's/function parseAcceptedRisks\(([a-zA-Z0-9_]*)\) \{/function parseAcceptedRisks(\1) { return [];/' "$mutfile" >"$mutfile.new"
  mv "$mutfile.new" "$mutfile"
  mk_workdir fxdir "stride-redproof2-fx"
  mkdir -p "$fxdir/docs/product/features/006-sample"
  cp "$STRIDE_FX/accepted-high-open.md" "$fxdir/docs/product/features/006-sample/threat-model.md"
  mk_tmpfile errf "stride-redproof2-err"
  out="$(node "$mutdir/_shared/a1-tools.cjs" profile threat-model-check --id "006-sample" --repo-root "$fxdir" 2>"$errf")"; rc=$?
  if [[ $rc -eq 1 ]] && printf '%s%s' "$out" "$(cat "$errf")" | grep -q 'unmitigated'; then
    ok "RED-2: skipping the accepted-risks lookup turns accepted-high-open from exit 0 to exit 1/unmitigated (mutation proves the lookup is load bearing)"
  else
    bad "RED-2: mutation did not flip accepted-high-open to exit 1/unmitigated (got rc=$rc) — the guard may not prove what it claims"
  fi
}
caseRedProofAcceptedLookup
