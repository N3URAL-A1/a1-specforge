# Part 04 — KRITIS NFR catalogue injection (spec 006-specforge-kritis-profile, FR-004).
#
# Guards (N1..N9 = the nine cases of the wave brief):
#   N1  happy path: 41 added / 0 skipped, exit 0, 41 new FR lines.
#   N2  idempotence: run 2 prints "added 0, skipped 41", file hash unchanged.
#   N3  tag dedup: two (covers kritis-nfr:..) tags -> 39 added / 2 skipped,
#       the covered ids are not injected again, numbering continues at FR-003.
#   N4  open thresholds PER-01/02/03 become [NEEDS CLARIFICATION: ...], no raw [X..].
#   N5  no "## Functional Requirements" -> no_fr_section, exit 2, file untouched.
#   N6  broken catalogue (short row / heading gone / 40 rows) -> exit 2 catalogue_invalid.
#   N7  injected lines are EARS-clean: ears-check on the injected spec, anchored
#       on checked == 42 and "no finding except the one untagged hand-written FR-001".
#   N8  hostile --spec, every call bounded (a hang is rc 124, not a stuck suite).
#   N9  Source: line of SEC-10, AUD-06, DAT-02 equals the legal-review literal
#       AND the catalogue row.
#
# RED proofs: run for real against a scratch copy of _shared (never the live
# tree); the mutation exit code and file effect were captured. See the wave report.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

NFR_FX="$HERE/fixtures/nfr"
NFR_CAT_REL="_shared/profiles/kritis/nfr-catalogue.md"

# nfr_hash <file> — sha256 via node (no shasum/sha256sum split between macOS and GNU).
nfr_hash() {
  node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))" "$1"
}

# nfr_run <tools> <spec> <outfile> <errfile> — bounded; rc is the CLI's own.
nfr_run() {
  run_bounded 30 "$3" "$4" -- env A1_VAULT_ROOT= node "$1" profile nfr-inject --spec "$2"
}

# nfr_count_fr <file> — number of "- **FR-nnn**" lines.
nfr_count_fr() { grep -c -E '^- \*\*FR-[0-9]+\*\*' "$1"; }

# ---------- N1: happy path ----------

caseNfrHappy() {
  local work spec rc
  mk_workdir work "w4n-happy"
  spec="$work/spec.md"; cp "$NFR_FX/base.md" "$spec"
  nfr_run "$TOOLS" "$spec" "$work/out" "$work/err"; rc=$?
  local frs; frs="$(nfr_count_fr "$spec")"
  if [[ "$rc" -eq 0 ]] && grep -q 'added 41, skipped 0' "$work/out" && [[ "$frs" == "42" ]] \
     && grep -q '^## Non-Functional Requirements (KRITIS profile)$' "$spec" \
     && grep -q '^- \*\*FR-042\*\*' "$spec" && grep -q '^## Out of Scope$' "$spec"; then
    ok "N1 happy path: exit 0, added 41 skipped 0, 42 FR lines (FR-001 + FR-002..FR-042), NFR heading, later section kept"
  else
    bad "N1 happy path: exit=$rc out=$(cat "$work/out") frs=$frs err=$(cat "$work/err")"
  fi
  rm -rf "$work"
}
caseNfrHappy

# ---------- N2: idempotence ----------

caseNfrIdempotent() {
  local work spec rc1 rc2 h1 h2
  mk_workdir work "w4n-idem"
  spec="$work/spec.md"; cp "$NFR_FX/base.md" "$spec"
  nfr_run "$TOOLS" "$spec" "$work/out1" "$work/err1"; rc1=$?
  h1="$(nfr_hash "$spec")"
  nfr_run "$TOOLS" "$spec" "$work/out2" "$work/err2"; rc2=$?
  h2="$(nfr_hash "$spec")"
  if [[ "$rc1" -eq 0 && "$rc2" -eq 0 && -n "$h1" && "$h1" == "$h2" ]] \
     && grep -q 'added 41, skipped 0' "$work/out1" && grep -q 'added 0, skipped 41' "$work/out2"; then
    ok "N2 idempotent: run 2 prints 'added 0, skipped 41', file byte-identical (sha256 equal)"
  else
    bad "N2 idempotent: rc1=$rc1 rc2=$rc2 hash1=$h1 hash2=$h2 out2=$(cat "$work/out2")"
  fi
  rm -rf "$work"
}
caseNfrIdempotent

# ---------- N3: tag deduplication ----------

caseNfrDedup() {
  local work spec rc srcs
  mk_workdir work "w4n-dedup"
  spec="$work/spec.md"; cp "$NFR_FX/two-covers.md" "$spec"
  nfr_run "$TOOLS" "$spec" "$work/out" "$work/err"; rc=$?
  srcs="$(grep -c -E 'Source: kritis-nfr:(SEC-01|AVA-01)( |\))' "$spec")"
  if [[ "$rc" -eq 0 ]] && grep -q 'added 39, skipped 2' "$work/out" && [[ "$srcs" == "0" ]] \
     && [[ "$(nfr_count_fr "$spec")" == "41" ]] && grep -q '^- \*\*FR-003\*\*' "$spec" \
     && grep -q '^- \*\*FR-041\*\*' "$spec"; then
    ok "N3 dedup: two covers tags -> added 39 skipped 2, covered ids not re-injected, numbering FR-003..FR-041"
  else
    bad "N3 dedup: exit=$rc out=$(cat "$work/out") reinjected=$srcs frs=$(nfr_count_fr "$spec")"
  fi
  rm -rf "$work"
}
caseNfrDedup

# ---------- N4: open thresholds ----------

caseNfrOpenThresholds() {
  local work spec rc nc raw missing=""
  mk_workdir work "w4n-open"
  spec="$work/spec.md"; cp "$NFR_FX/base.md" "$spec"
  nfr_run "$TOOLS" "$spec" "$work/out" "$work/err"; rc=$?
  nc="$(grep -c 'NEEDS CLARIFICATION: PER-0[123] threshold' "$spec")"
  raw="$(grep -c -E '\[X( [^]]*)?\]' "$spec")"
  for id in PER-01 PER-02 PER-03; do
    grep -F "Source: kritis-nfr:$id " "$spec" | grep -q -F "[NEEDS CLARIFICATION: $id threshold" || missing="$missing $id"
  done
  if [[ "$rc" -eq 0 && "$nc" -ge 3 && "$raw" == "0" && -z "$missing" ]]; then
    ok "N4 open thresholds: PER-01/02/03 carry [NEEDS CLARIFICATION: ...], 0 raw [X ..] placeholders"
  else
    bad "N4 open thresholds: exit=$rc needs_clar_lines=$nc raw_placeholders=$raw missing:$missing"
  fi
  rm -rf "$work"
}
caseNfrOpenThresholds

# ---------- N5: no FR section ----------

caseNfrNoFrSection() {
  local work spec rc h1 h2
  mk_workdir work "w4n-nofr"
  spec="$work/spec.md"; cp "$NFR_FX/no-fr.md" "$spec"
  h1="$(nfr_hash "$spec")"
  nfr_run "$TOOLS" "$spec" "$work/out" "$work/err"; rc=$?
  h2="$(nfr_hash "$spec")"
  if [[ "$rc" -eq 2 ]] && grep -q 'no_fr_section' "$work/err" && [[ "$h1" == "$h2" ]]; then
    ok "N5 no FR section: exit 2, no_fr_section on stderr, spec untouched"
  else
    bad "N5 no FR section: exit=$rc err=$(cat "$work/err") unchanged=$([[ "$h1" == "$h2" ]] && echo yes || echo no)"
  fi
  rm -rf "$work"
}
caseNfrNoFrSection

# ---------- N6: broken catalogue ----------

# nfr_break <kind> <catalogue-file> — rewrite the scratch catalogue with node
# (never sed -i: GNU and BSD disagree and a silent no-op would hide a dead guard).
# Prints nothing; exit 0 only when the file really changed.
nfr_break() {
  node -e '
    const fs = require("fs"); const [kind, f] = process.argv.slice(1);
    const before = fs.readFileSync(f, "utf8"); const lines = before.split("\n");
    const i = lines.findIndex((l) => l.startsWith("| SEC-03 |"));
    if (i === -1) process.exit(3);
    if (kind === "short-row") lines[i] = lines[i].replace(/\|[^|]*\|\s*$/, "");
    else if (kind === "heading") lines[lines.findIndex((l) => l.trim() === "## Catalogue")] = "## Catalog";
    else if (kind === "missing-row") lines.splice(i, 1);
    const after = lines.join("\n");
    if (after === before) process.exit(4);
    fs.writeFileSync(f, after);
  ' "$1" "$2"
}

caseNfrBrokenCatalogue() {
  local work kind rc brc tree h1 h2
  mk_workdir work "w4n-cat"
  for kind in short-row heading missing-row; do
    tree="$work/tree-$kind"; mkdir -p "$tree"
    cp -R "$REPO_ROOT/_shared" "$tree/_shared"
    nfr_break "$kind" "$tree/$NFR_CAT_REL"; brc=$?
    cp "$NFR_FX/base.md" "$work/spec-$kind.md"
    h1="$(nfr_hash "$work/spec-$kind.md")"
    nfr_run "$tree/_shared/a1-tools.cjs" "$work/spec-$kind.md" "$work/out-$kind" "$work/err-$kind"; rc=$?
    h2="$(nfr_hash "$work/spec-$kind.md")"
    if [[ "$brc" -eq 0 && "$rc" -eq 2 ]] && grep -q 'catalogue_invalid' "$work/err-$kind" && [[ "$h1" == "$h2" ]]; then
      ok "N6 broken catalogue ($kind): exit 2, catalogue_invalid, spec untouched"
    else
      bad "N6 broken catalogue ($kind): mutate_rc=$brc exit=$rc err=$(cat "$work/err-$kind")"
    fi
  done
  rm -rf "$work"
}
caseNfrBrokenCatalogue

# ---------- N7: injected lines are EARS-clean ----------

caseNfrEarsClean() {
  local work spec rc out checked bad_ids inj
  mk_workdir work "w4n-ears"
  spec="$work/spec.md"; cp "$NFR_FX/base-untagged.md" "$spec"
  nfr_run "$TOOLS" "$spec" "$work/out" "$work/err"; rc=$?
  A1_VAULT_ROOT="$work" node "$TOOLS" profile ears-check --spec "$spec" --json >"$work/ears.json" 2>"$work/ears.err"
  # Anchor: the 41 injected lines are FR-002..FR-042. Count findings on exactly
  # those ids, and require checked == 42 so a skipped section cannot pass.
  out="$(node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const n = (id) => parseInt(id.replace("FR-", ""), 10);
    const inj = r.findings.filter((f) => f.id && n(f.id) >= 2 && n(f.id) <= 42);
    const other = r.findings.filter((f) => !(f.id && n(f.id) >= 2 && n(f.id) <= 42));
    console.log([r.checked, inj.length, other.map((f) => f.id + ":" + f.code).join(",")].join(" "));
  ' "$work/ears.json" 2>/dev/null)"
  checked="${out%% *}"; inj="$(echo "$out" | cut -d' ' -f2)"; bad_ids="$(echo "$out" | cut -d' ' -f3-)"
  if [[ "$rc" -eq 0 && "$checked" == "42" && "$inj" == "0" && "$bad_ids" == "FR-001:no_tag" ]]; then
    ok "N7 EARS-clean: checked=42, 0 findings on the 41 injected lines (only the hand-written untagged FR-001 reports no_tag)"
  else
    bad "N7 EARS-clean: inject_rc=$rc checked=$checked injected_findings=$inj others=[$bad_ids] raw=[$out]"
  fi
  rm -rf "$work"
}
caseNfrEarsClean

# ---------- N8: hostile --spec ----------

caseNfrHostile() {
  local work rc
  mk_workdir work "w4n-hostile"

  run_bounded 20 "$work/m.out" "$work/m.err" -- env A1_VAULT_ROOT= node "$TOOLS" profile nfr-inject; rc=$?
  if [[ "$rc" -eq 1 ]]; then ok "N8a missing --spec: exit 1 (usage)"; else bad "N8a missing --spec: exit=$rc (expected 1, 124 = hang)"; fi

  nfr_run "$TOOLS" "$work/does-not-exist.md" "$work/n.out" "$work/n.err"; rc=$?
  if [[ "$rc" -eq 2 ]]; then ok "N8b nonexistent --spec: exit 2"; else bad "N8b nonexistent --spec: exit=$rc (expected 2)"; fi

  {
    head -c 1100000 /dev/zero | tr '\0' 'x'
    printf '\n## Functional Requirements\n'
  } >"$work/big.md"
  nfr_run "$TOOLS" "$work/big.md" "$work/b.out" "$work/b.err"; rc=$?
  if [[ "$rc" -eq 2 ]] && grep -q 'cap' "$work/b.err"; then ok "N8c oversized --spec (> 1 MiB): exit 2, cap message"; else bad "N8c oversized --spec: exit=$rc (expected 2 + cap message)"; fi

  nfr_run "$TOOLS" '$(echo pwned)' "$work/i.out" "$work/i.err"; rc=$?
  if [[ "$rc" -eq 2 ]] && ! grep -q 'pwned' "$work/i.out" 2>/dev/null; then
    ok "N8d injection-shaped --spec: exit 2, never evaluated"
  else
    bad "N8d injection-shaped --spec: exit=$rc (expected 2, no evaluation)"
  fi

  ln -s "$NFR_FX/base.md" "$work/link.md"
  nfr_run "$TOOLS" "$work/link.md" "$work/l.out" "$work/l.err"; rc=$?
  if [[ "$rc" -eq 2 ]]; then ok "N8e symlinked --spec: exit 2 (refused)"; else bad "N8e symlinked --spec: exit=$rc (expected 2)"; fi

  nfr_run "$TOOLS" "$(head -c 10000 /dev/zero | tr '\0' 'x')" "$work/x.out" "$work/x.err"; rc=$?
  if [[ "$rc" -eq 2 ]]; then ok "N8f 10,000-char --spec: exit 2, no hang"; else bad "N8f 10,000-char --spec: exit=$rc (expected 2)"; fi
  rm -rf "$work"
}
caseNfrHostile

# ---------- N9: label and source integrity ----------

# PARITY with the legal review: these three literals were corrected by it.
caseNfrSourceIntegrity() {
  local work spec rc id want row
  mk_workdir work "w4n-src"
  spec="$work/spec.md"; cp "$NFR_FX/base.md" "$spec"
  nfr_run "$TOOLS" "$spec" "$work/out" "$work/err"; rc=$?
  for pair in "SEC-10|NIS2 Art. 21(2)(f); GDPR Art. 32(1)(d)" \
              "AUD-06|NIS2 Art. 23(4)(a),(b),(d)" \
              "DAT-02|GDPR Art. 6, Art. 5(2)"; do
    id="${pair%%|*}"; want="${pair#*|}"
    # catalogue row, read independently of profile-nfr.cjs: 5th data cell
    row="$(node -e '
      const l = require("fs").readFileSync(process.argv[1], "utf8").split("\n").find((x) => x.startsWith("| " + process.argv[2] + " |"));
      console.log(l ? l.split("|")[5].trim() : "ROW-NOT-FOUND");
    ' "$REPO_ROOT/$NFR_CAT_REL" "$id")"
    if [[ "$rc" -eq 0 ]] && node -e '
        const [f, id, want] = process.argv.slice(1);
        const l = require("fs").readFileSync(f, "utf8").split("\n").filter((x) => x.includes("Source: kritis-nfr:" + id + " "));
        process.exit(l.length === 1 && l[0].endsWith("(_shared/profiles/kritis/nfr-catalogue.md); " + want) ? 0 : 1);
      ' "$spec" "$id" "$want" && [[ "$row" == "$want" ]]; then
      ok "N9 $id: injected Source line ends with the legal-review literal and the catalogue row agrees ($want)"
    else
      bad "N9 $id: exit=$rc catalogue source cell=[$row] expected=[$want]; line=[$(grep -F "Source: kritis-nfr:$id " "$spec")]"
    fi
  done
  rm -rf "$work"
}
caseNfrSourceIntegrity

caseNfrNodeCheck() {
  if node --check "$REPO_ROOT/_shared/lib/profile-nfr.cjs" >/dev/null 2>"$A1_FX_ROOT/nfrcheck.err"; then
    ok "node --check profile-nfr.cjs"
  else
    bad "node --check profile-nfr.cjs: $(cat "$A1_FX_ROOT/nfrcheck.err")"
  fi
}
caseNfrNodeCheck
