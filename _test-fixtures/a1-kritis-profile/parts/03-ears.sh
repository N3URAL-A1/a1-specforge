# Part 03 — canonical EARS template and deterministic EARS check
# (spec 006-specforge-kritis-profile, FR-002).
#
# Guards:
#   E1  five canonical patterns (fixture families: bullet-indented, bare
#       lazy-paragraph, heading) pass with checked == FR count, exit 0.
#   E2  the unmodified copy of spec 006 exits 1 with exactly 8 no_tag findings.
#   E3  a tag/structure mismatch (event-driven tag, "The system shall..."
#       text) reports structure_mismatch.
#   E4  the German EARS form ("Wenn ..., shall das System ...") fails
#       structurally — it is not accepted as event-driven.
#   E5  vague terms are warnings only and never change the exit code.
#   E6  no_frs, multiple_shall, table-rows-ignored, FR-NFR-### section.
#   E7  hostile --spec: missing flag, nonexistent path, symlink, oversized
#       (> 1 MiB), injection-shaped value, 10,000-char value.
#
# RED proofs (quoted in STATUS.md / the wave report, run for real against a
# scratch copy of _shared/lib/profile-ears.cjs, never the live tree):
#   mutation 1 — widen the event-driven opener to accept "Wenn" too, and the
#     German-form case (structure_mismatch under correct code) turns green.
#   mutation 2 — stop joining a bullet entry's indented continuation lines,
#     and the multi-line FR case (spec 006's wrapped FR-001..FR-008) turns
#     red (no_tag: the [EARS: ...] tag lives on the dropped continuation).

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

EARS_FX="$HERE/fixtures/ears"
EARS_LIB="$REPO_ROOT/_shared/lib/profile-ears.cjs"

# ---------- E1: five canonical patterns, three FR shape families ----------

caseEarsPositive() {
  local name="$1" file="$2" expect_checked="$3" work abs out err rc
  mk_workdir work "w3e-$name"
  abs="$EARS_FX/$file"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$abs" --json >"$out" 2>"$err"
  rc=$?
  local checked findings
  checked="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).checked)" 2>/dev/null)"
  findings="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings.length)" 2>/dev/null)"
  if [[ "$rc" -eq 0 && "$checked" == "$expect_checked" && "$findings" == "0" ]]; then
    ok "E1 $name: exit 0, checked=$expect_checked, 0 findings"
  else
    bad "E1 $name: exit=$rc checked=$checked findings=$findings (expected exit 0, checked=$expect_checked, 0 findings) — $(cat "$err")"
  fi
  rm -rf "$work"
}
caseEarsPositive "bullet-shape-spec006" "spec-006-ears-tagged.md" 8
caseEarsPositive "bare-shape" "bare-fr-shape.md" 2
caseEarsPositive "heading-shape" "heading-fr-shape.md" 2

# ---------- E2: unmodified spec 006 -> exactly 8 no_tag findings ----------

caseSpec006Unmodified() {
  local work out err rc checked no_tag_count
  mk_workdir work "w3e-spec006-unmod"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/spec-006-unmodified.md" --json >"$out" 2>"$err"
  rc=$?
  checked="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).checked)" 2>/dev/null)"
  no_tag_count="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings.filter(f=>f.code==='no_tag').length)" 2>/dev/null)"
  if [[ "$rc" -eq 1 && "$checked" == "8" && "$no_tag_count" == "8" ]]; then
    ok "E2 spec-006 unmodified: exit 1, checked=8, exactly 8 no_tag findings (AC)"
  else
    bad "E2 spec-006 unmodified: exit=$rc checked=$checked no_tag=$no_tag_count (expected exit 1, checked=8, no_tag=8)"
  fi
  rm -rf "$work"
}
caseSpec006Unmodified

# ---------- E3: tag/structure mismatch ----------

caseStructureMismatch() {
  local work out err rc code
  mk_workdir work "w3e-structmis"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/structure-mismatch.md" --json >"$out" 2>"$err"
  rc=$?
  code="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings[0].code)" 2>/dev/null)"
  if [[ "$rc" -eq 1 && "$code" == "structure_mismatch" ]]; then
    ok "E3 structure mismatch: exit 1, finding structure_mismatch"
  else
    bad "E3 structure mismatch: exit=$rc code=$code (expected exit 1, structure_mismatch)"
  fi
  rm -rf "$work"
}
caseStructureMismatch

# ---------- E4: German EARS form fails ----------

caseGermanForm() {
  local work out err rc code
  mk_workdir work "w3e-german"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/german-form.md" --json >"$out" 2>"$err"
  rc=$?
  code="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings[0].code)" 2>/dev/null)"
  if [[ "$rc" -eq 1 && "$code" == "structure_mismatch" ]]; then
    ok "E4 German EARS form ('Wenn ...') fails: exit 1, structure_mismatch (not accepted as event-driven)"
  else
    bad "E4 German EARS form: exit=$rc code=$code (expected exit 1, structure_mismatch)"
  fi
  rm -rf "$work"
}
caseGermanForm

# ---------- E5: vague terms are warnings only ----------

caseVagueWarnings() {
  local work out err rc findings warnings
  mk_workdir work "w3e-vague"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/vague-warnings.md" --json >"$out" 2>"$err"
  rc=$?
  findings="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings.length)" 2>/dev/null)"
  warnings="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).warnings.length)" 2>/dev/null)"
  if [[ "$rc" -eq 0 && "$findings" == "0" && "$warnings" -ge 1 ]]; then
    ok "E5 vague terms: exit 0, 0 findings, $warnings warning(s) (vague terms never gate)"
  else
    bad "E5 vague terms: exit=$rc findings=$findings warnings=$warnings (expected exit 0, 0 findings, >=1 warning)"
  fi
  rm -rf "$work"
}
caseVagueWarnings

# ---------- E6: no_frs, multiple_shall, table rows ignored, NFR section ----------

caseNoFrs() {
  local work out err rc code checked
  mk_workdir work "w3e-nofrs"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/no-frs.md" --json >"$out" 2>"$err"
  rc=$?
  checked="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).checked)" 2>/dev/null)"
  code="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings[0].code)" 2>/dev/null)"
  if [[ "$rc" -eq 1 && "$checked" == "0" && "$code" == "no_frs" ]]; then
    ok "E6a no_frs: exit 1, checked=0, finding no_frs"
  else
    bad "E6a no_frs: exit=$rc checked=$checked code=$code (expected exit 1, checked=0, no_frs)"
  fi
  rm -rf "$work"
}
caseNoFrs

caseMultipleShall() {
  local work out err rc code
  mk_workdir work "w3e-multishall"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/multiple-shall.md" --json >"$out" 2>"$err"
  rc=$?
  code="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings[0].code)" 2>/dev/null)"
  if [[ "$rc" -eq 1 && "$code" == "multiple_shall" ]]; then
    ok "E6b multiple_shall: exit 1, finding multiple_shall"
  else
    bad "E6b multiple_shall: exit=$rc code=$code (expected exit 1, multiple_shall)"
  fi
  rm -rf "$work"
}
caseMultipleShall

caseTableRowsIgnored() {
  local work out err rc checked findings
  mk_workdir work "w3e-tablerows"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/table-rows-ignored.md" --json >"$out" 2>"$err"
  rc=$?
  checked="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).checked)" 2>/dev/null)"
  findings="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings.length)" 2>/dev/null)"
  if [[ "$rc" -eq 0 && "$checked" == "1" && "$findings" == "0" ]]; then
    ok "E6c table rows ignored: exit 0, checked=1 (the two '| FR-...' table rows are not FR entries)"
  else
    bad "E6c table rows ignored: exit=$rc checked=$checked findings=$findings (expected exit 0, checked=1)"
  fi
  rm -rf "$work"
}
caseTableRowsIgnored

caseNfrSectionRead() {
  local work out err rc checked findings
  mk_workdir work "w3e-nfrsection"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/nfr-section.md" --json >"$out" 2>"$err"
  rc=$?
  checked="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).checked)" 2>/dev/null)"
  findings="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings.length)" 2>/dev/null)"
  if [[ "$rc" -eq 0 && "$checked" == "3" && "$findings" == "0" ]]; then
    ok "E6d FR-NFR-### lines under the profile's NFR section are read too: checked=3 (1 FR + 2 FR-NFR)"
  else
    bad "E6d NFR section: exit=$rc checked=$checked findings=$findings (expected exit 0, checked=3)"
  fi
  rm -rf "$work"
}
caseNfrSectionRead

# ---------- E7: hostile --spec ----------

caseHostile() {
  local work rc
  mk_workdir work "w3e-hostile"

  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check --json \
    >"$work/missing.out" 2>"$work/missing.err"
  rc=$?
  if [[ "$rc" -eq 1 ]]; then ok "E7a missing --spec: exit 1 (usage)"; else bad "E7a missing --spec: exit=$rc (expected 1)"; fi

  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$work/does-not-exist.md" --json >"$work/missingfile.out" 2>"$work/missingfile.err"
  rc=$?
  if [[ "$rc" -eq 2 ]]; then ok "E7b nonexistent --spec: exit 2"; else bad "E7b nonexistent --spec: exit=$rc (expected 2)"; fi

  ln -s "$EARS_FX/spec-006-unmodified.md" "$work/link.md"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$work/link.md" --json >"$work/link.out" 2>"$work/link.err"
  rc=$?
  if [[ "$rc" -eq 2 ]]; then ok "E7c symlinked --spec: exit 2 (refused)"; else bad "E7c symlinked --spec: exit=$rc (expected 2)"; fi

  {
    head -c 1100000 /dev/zero | tr '\0' 'x'
    printf '\n## Functional Requirements\n'
  } >"$work/big.md"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$work/big.md" --json >"$work/big.out" 2>"$work/big.err"
  rc=$?
  if [[ "$rc" -eq 2 ]]; then ok "E7d oversized --spec (> 1 MiB): exit 2"; else bad "E7d oversized --spec: exit=$rc (expected 2)"; fi

  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec '$(echo pwned)' --json >"$work/inj.out" 2>"$work/inj.err"
  rc=$?
  if [[ "$rc" -eq 2 ]] && ! grep -q 'pwned' "$work/inj.out" "$work/inj.err" 2>/dev/null; then
    ok "E7e injection-shaped --spec: exit 2, never evaluated"
  else
    bad "E7e injection-shaped --spec: exit=$rc (expected 2, no evaluation)"
  fi

  local longval
  longval="$(head -c 10000 /dev/zero | tr '\0' 'x')"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$longval" --json >"$work/long.out" 2>"$work/long.err"
  rc=$?
  if [[ "$rc" -eq 2 ]]; then ok "E7f 10,000-char --spec value: exit 2, no hang/crash"; else bad "E7f 10,000-char value: exit=$rc (expected 2)"; fi

  rm -rf "$work"
}
caseHostile

# ---------- node --check on the module ----------

caseNodeCheck() {
  if node --check "$EARS_LIB" >/dev/null 2>"$A1_FX_ROOT/earscheck.err"; then
    ok "node --check profile-ears.cjs"
  else
    bad "node --check profile-ears.cjs: $(cat "$A1_FX_ROOT/earscheck.err")"
  fi
}
caseNodeCheck

# ---------- E5 (review M3): FR lines in unparsed shapes are findings, never skipped ----------
# Four distinct FR ids, three of them in shapes no reader understands. The old
# parser reported checked=1 / 0 findings / exit 0. Now every distinct id is
# checked and the three unreadable ones are no_tag findings.
caseUnparsedShapes() {
  local work out err rc checked ids no_tag distinct
  mk_workdir work "w3e-unparsed"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/unparsed-shapes.md" --json >"$out" 2>"$err"
  rc=$?
  distinct="$(grep -oE '\bFR-[0-9]{3,}\b' "$EARS_FX/unparsed-shapes.md" | sort -u | grep -c .)"
  checked="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).checked)" 2>/dev/null)"
  no_tag="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings.filter(f=>f.code==='no_tag').map(f=>f.id).join(','))" 2>/dev/null)"
  if [[ "$rc" -eq 1 && "$checked" == "$distinct" && "$no_tag" == "FR-002,FR-003,FR-004" ]]; then
    ok "E5 unparsed shapes: exit 1, checked == $distinct distinct FR ids, no_tag on FR-002,FR-003,FR-004"
  else
    bad "E5 unparsed shapes: exit=$rc checked=$checked (distinct=$distinct) no_tag=[$no_tag]"
  fi
  rm -rf "$work"
}
caseUnparsedShapes

# ---------- E5b (re-review R2): prose cross-references and fenced examples are not FR lines ----------
# FR-010 is named in a prose note, FR-011 inside a closed ``` fence: neither is a
# requirement of this spec. FR-002 is a real FR line in an unread shape, and
# FR-003 follows an UNCLOSED ~~~ fence, which is read as text (same rule as
# _shared/lib/check.cjs), so both stay findings. Before the fix: checked=5,
# no_tag on FR-002,FR-003,FR-010,FR-011.
caseUnparsedProseAndFences() {
  local work out err rc checked no_tag
  mk_workdir work "w3e-prose"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/unparsed-prose-and-fences.md" --json >"$out" 2>"$err"
  rc=$?
  checked="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).checked)" 2>/dev/null)"
  no_tag="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings.filter(f=>f.code==='no_tag').map(f=>f.id).join(','))" 2>/dev/null)"
  if [[ "$rc" -eq 1 && "$checked" == "3" && "$no_tag" == "FR-002,FR-003" ]]; then
    ok "E5b prose and fenced ids ignored: exit 1, checked 3, no_tag on FR-002,FR-003 only"
  else
    bad "E5b prose/fences: exit=$rc checked=$checked no_tag=[$no_tag] (want 1, 3, FR-002,FR-003)"
  fi
  rm -rf "$work"
}

# ---------- E5c (final review MINOR-1): wrapped FR lines stay findings ----------
# A blockquote, a task box, backticks and italics around the id. E5b's
# "id opens the line" rule first let these four slip through silently
# (checked 1, exit 0); at 592c56d they were no_tag findings.
caseUnparsedWrappedShapes() {
  local work out err rc checked no_tag
  mk_workdir work "w3e-wrapped"
  out="$work/out.json"; err="$work/err.txt"
  A1_VAULT_ROOT="$work" node "$REPO_ROOT/_shared/a1-tools.cjs" profile ears-check \
    --spec "$EARS_FX/unparsed-wrapped-shapes.md" --json >"$out" 2>"$err"
  rc=$?
  checked="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).checked)" 2>/dev/null)"
  no_tag="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$out','utf8')).findings.filter(f=>f.code==='no_tag').map(f=>f.id).join(','))" 2>/dev/null)"
  if [[ "$rc" -eq 1 && "$checked" == "5" && "$no_tag" == "FR-002,FR-003,FR-004,FR-005" ]]; then
    ok "E5c wrapped shapes: exit 1, checked 5, no_tag on FR-002..FR-005"
  else
    bad "E5c wrapped shapes: exit=$rc checked=$checked no_tag=[$no_tag] (want 1, 5, FR-002,FR-003,FR-004,FR-005)"
  fi
  rm -rf "$work"
}
caseUnparsedProseAndFences
caseUnparsedWrappedShapes
