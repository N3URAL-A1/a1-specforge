#!/usr/bin/env bash
# Scenario suite for spec 023 Wave 1: module keys in ROADMAP.md (`module:` on a
# milestone, `modules:` top-level), validator rules, key order, byte-identity.
#
#   SC-001/FR-005  golden: with no module in use, index.json and NEXT.md are
#                  byte-identical to the output of main at c2a3252 (golden/,
#                  taken from an unchanged export of that commit with the same
#                  inputs and a pinned clock), after masking `generated` and
#                  the `updated:` line only. No docs/product/modules/ exists.
#   SC-005/FR-002/FR-003  validate errors: unknown module with `modules:`
#                  present, unsafe slugs. Exit 1, error names the value.
#   FR-004         validate warnings: exact texts, valid stays true.
#   FR-016/AC-3b   stage, markers, changelog, add-feature, feature-init keep
#                  `modules:` and every `module:`; `modules` sits before
#                  `milestones`. product import writes neither key.
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

unset A1_VAULT_ROOT
unset A1_VAULT_WRITER_HOST A1_HOST_ID

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="${TOOLS_OVERRIDE:-$REPO_ROOT/_shared/a1-tools.cjs}"
GOLDEN="${GOLDEN_DIR:-$DIR/golden}"
. "$DIR/lib.sh"

pass=0
fail=0

assert_true() {
  local name="$1" cond="$2"
  if [[ "$cond" == "true" ]]; then echo "PASS  $name"; pass=$((pass + 1))
  else echo "FAIL  $name"; fail=$((fail + 1)); fi
}

assert_rc() {
  local name="$1" expected="$2" actual="$3" out="$4"
  if [[ "$actual" -ne "$expected" ]]; then
    echo "FAIL  $name: expected exit $expected, got $actual"
    echo "----- output -----"; echo "$out"; echo "------------------"
    fail=$((fail + 1))
  else echo "PASS  $name (exit $actual)"; pass=$((pass + 1)); fi
}

mk_workdir WORK modules-w1

# jget <json> <js-expression-on-d>: evaluate an expression on parsed JSON.
jget() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);const r=(function(){return eval(process.argv[1])})();process.stdout.write(typeof r==="string"?r:JSON.stringify(r))})' "$2"; }

# ---------------------------------------------------------------- golden ----
for c in a b c; do
  PD="$WORK/golden-$c/docs/product"
  build_case "$c" "$PD"
  assert_true "golden-$c-build-ok" "$([[ -f "$PD/index.json" && -f "$PD/NEXT.md" ]] && echo true || echo false)"
  exp_i="$(_sha_stdin < "$GOLDEN/$c/index.masked.json")"
  exp_n="$(_sha_stdin < "$GOLDEN/$c/NEXT.masked.md")"
  assert_true "golden-$c-index-byte-identical" "$([[ "$(hash_masked index "$PD/index.json")" == "$exp_i" ]] && echo true || echo false)"
  assert_true "golden-$c-next-byte-identical" "$([[ "$(hash_masked next "$PD/NEXT.md")" == "$exp_n" ]] && echo true || echo false)"
  assert_true "golden-$c-no-modules-dir" "$([[ ! -e "$PD/modules" ]] && echo true || echo false)"
done

# The guard must be able to fail: a golden copy with one changed byte differs.
cp "$GOLDEN/a/index.masked.json" "$WORK/tampered.json"
printf 'X' >> "$WORK/tampered.json"
assert_true "golden-guard-detects-one-changed-byte" "$([[ "$(_sha_stdin < "$WORK/tampered.json")" != "$(hash_masked index "$WORK/golden-a/docs/product/index.json")" ]] && echo true || echo false)"

# ----------------------------------------------------------- validator ------
validate() { node "$TOOLS" product validate --dir "$1" 2>&1; }

# V1: unknown module while modules: is present -> error naming milestone index and value.
V1="$WORK/v1/docs/product"
write_roadmap "$V1" v1 "modules: [immobilien, crm-core]" "immobilien" "platform"
OUT="$(validate "$V1")"; RC=$?
assert_rc "validate-unknown-module-exit-1" 1 "$RC" "$OUT"
assert_true "validate-unknown-module-error-text" "$([[ "$(jget "$OUT" 'd.errors.filter(e=>e==="milestones[1].module: '"'"'platform'"'"' is not in modules")')" != "[]" ]] && echo true || echo false)"
assert_true "validate-unknown-module-valid-false" "$([[ "$(jget "$OUT" 'd.valid')" == "false" ]] && echo true || echo false)"

# V2: unsafe / non-kebab slugs each give an error naming the value.
n=0
for bad in 'Bad/Slug' '../x' 'Immobilien'; do
  n=$((n + 1))
  P="$WORK/v2-$n/docs/product"
  write_roadmap "$P" v2 "" "\"$bad\"" ""
  OUT="$(validate "$P")"; RC=$?
  assert_rc "validate-bad-module-slug-$n-exit-1" 1 "$RC" "$OUT"
  export VAL="$bad"
  assert_true "validate-bad-module-slug-$n-names-value" "$([[ "$(jget "$OUT" 'd.errors.some(e=>e.startsWith("milestones[0].module:")&&e.includes(process.env.VAL))')" == "true" ]] && echo true || echo false)"
done
P="$WORK/v2-list/docs/product"
write_roadmap "$P" v2l "modules: [crm-core, Crm_Core]" "crm-core" ""
OUT="$(validate "$P")"; RC=$?
assert_rc "validate-bad-modules-entry-exit-1" 1 "$RC" "$OUT"
assert_true "validate-bad-modules-entry-names-value" "$([[ "$(jget "$OUT" 'd.errors.some(e=>e.startsWith("modules[1]:")&&e.includes("Crm_Core"))')" == "true" ]] && echo true || echo false)"

# V3: module: without a modules: list accepts any kebab-case value.
P="$WORK/v3/docs/product"
write_roadmap "$P" v3 "" "anything-goes" "anything-goes"
OUT="$(validate "$P")"; RC=$?
assert_rc "validate-no-modules-list-accepts-kebab-exit-0" 0 "$RC" "$OUT"

# V4: one untagged milestone in a tagged project -> exact warning, valid true.
P="$WORK/v4/docs/product"
write_roadmap "$P" v4 "modules: [immobilien]" "immobilien" ""
OUT="$(validate "$P")"; RC=$?
assert_rc "validate-untagged-milestone-exit-0" 0 "$RC" "$OUT"
export WANT="milestones[1].module: milestone 'm2-second' has no module; it appears only under \"Unassigned milestones\" in NEXT.md"
assert_true "validate-untagged-milestone-exact-warning" "$([[ "$(jget "$OUT" 'd.warnings.filter(w=>w.startsWith("milestones[")).length===1&&d.warnings.includes(process.env.WANT)')" == "true" ]] && echo true || echo false)"

# V5: modules: list with no tagged milestone -> exactly one warning, no per-milestone ones.
P="$WORK/v5/docs/product"
write_roadmap "$P" v5 "modules: [a, b]" "" ""
OUT="$(validate "$P")"; RC=$?
assert_rc "validate-list-without-tags-exit-0" 0 "$RC" "$OUT"
assert_true "validate-list-without-tags-single-warning" "$([[ "$(jget "$OUT" 'd.warnings.filter(w=>w.includes("module")).length===1&&d.warnings.includes("modules: list present but no milestone has a module")')" == "true" ]] && echo true || echo false)"

# V6: no module keys at all -> no module warning, no module error (FR-005 side).
P="$WORK/v6/docs/product"
write_roadmap "$P" v6 "" "" ""
OUT="$(validate "$P")"; RC=$?
assert_rc "validate-no-module-keys-exit-0" 0 "$RC" "$OUT"
assert_true "validate-no-module-keys-no-module-warning" "$([[ "$(jget "$OUT" 'd.warnings.filter(w=>w.includes("module")).length')" == "0" ]] && echo true || echo false)"

# ------------------------------------------------------------ preservation --
# fm_check <roadmap> <label>: modules list intact, directly before milestones,
# and every milestone keeps its module value.
fm_check() {
  RM="$1" REPO_ROOT="$REPO_ROOT" node -e '
    const fs=require("fs");const {parseNestedFrontmatter}=require(process.env.REPO_ROOT+"/_shared/lib/io.cjs");
    const {fm}=parseNestedFrontmatter(fs.readFileSync(process.env.RM,"utf8"));
    const keys=Object.keys(fm);
    const ok=JSON.stringify(fm.modules)===JSON.stringify(["immobilien","crm-core"])
      && keys.indexOf("modules")===keys.indexOf("milestones")-1
      && fm.milestones[0].module==="immobilien" && fm.milestones[1].module==="crm-core";
    process.stdout.write(ok?"true":"false: "+JSON.stringify({keys,modules:fm.modules,m:fm.milestones.map(m=>m.module)}));'
}
fm_check_assert() { local r; r="$(fm_check "$2")"; assert_true "$1" "$([[ "$r" == "true" ]] && echo true || echo false)"; [[ "$r" == "true" ]] || echo "  detail: $r"; }

PP="$WORK/pres/docs/product"
write_roadmap "$PP" pres "modules: [immobilien, crm-core]" "immobilien" "crm-core"
RM="$PP/ROADMAP.md"
OUT="$(node "$TOOLS" product stage --by 001-first-feature --set started --dir "$PP" 2>&1)"; RC=$?
assert_rc "preserve-stage-exit-0" 0 "$RC" "$OUT"; fm_check_assert "preserve-after-stage" "$RM"
OUT="$(node "$TOOLS" product markers --level milestone --id m2-second --set in-progress --dir "$PP" 2>&1)"; RC=$?
assert_rc "preserve-markers-exit-0" 0 "$RC" "$OUT"; fm_check_assert "preserve-after-markers" "$RM"
OUT="$(node "$TOOLS" product changelog --entry "x" --why "y" --dir "$PP" 2>&1)"; RC=$?
assert_rc "preserve-changelog-exit-0" 0 "$RC" "$OUT"; fm_check_assert "preserve-after-changelog" "$RM"
OUT="$(node "$TOOLS" product add-feature --id 004-fourth-feature --milestone m2-second --title "Fourth" --dir "$PP" 2>&1)"; RC=$?
assert_rc "preserve-add-feature-exit-0" 0 "$RC" "$OUT"; fm_check_assert "preserve-after-add-feature" "$RM"
OUT="$(node "$TOOLS" product feature-init --id 004-fourth-feature --dir "$PP" 2>&1)"; RC=$?
assert_rc "preserve-feature-init-exit-0" 0 "$RC" "$OUT"; fm_check_assert "preserve-after-feature-init" "$RM"
OUT="$(node "$TOOLS" product add-milestone --id m3-third --title "Third" --dir "$PP" 2>&1)"; RC=$?
assert_rc "preserve-add-milestone-exit-0" 0 "$RC" "$OUT"; fm_check_assert "preserve-after-add-milestone" "$RM"

# Key order: after a rewrite of a file that had `modules` AFTER the features
# block, the serializer still emits modules directly before milestones.
KP="$WORK/keyorder/docs/product"
write_roadmap "$KP" keyorder "" "immobilien" "crm-core"
node -e '
  const fs=require("fs");const f=process.argv[1];
  let s=fs.readFileSync(f,"utf8");
  s=s.replace(/^next: (.*)$/m,"next: $1\nmodules: [immobilien, crm-core]");
  fs.writeFileSync(f,s);' "$KP/ROADMAP.md"
OUT="$(node "$TOOLS" product changelog --entry "x" --why "y" --dir "$KP" 2>&1)"; RC=$?
assert_rc "keyorder-changelog-exit-0" 0 "$RC" "$OUT"
fm_check_assert "keyorder-modules-directly-before-milestones" "$KP/ROADMAP.md"
assert_true "keyorder-line-order-in-file" "$([[ "$(awk 'f==1&&/^  - /{next} f==1{print ($0=="milestones:")?"true":"false"; f=2} /^modules:/{f=1} END{if(f!=2)print "false"}' "$KP/ROADMAP.md")" == "true" ]] && echo true || echo false)"

# ---------------------------------------------------------------- importer --
# Reuse the legacy sources of the product-import suite (extract its heredocs).
SRC="$REPO_ROOT/_test-fixtures/product-import/run-tests.sh"
extract_heredoc() { awk -v start="cat > \"\$WORK/$1\" <<'EOF'" '$0==start{on=1;next} on&&$0=="EOF"{exit} on{print}' "$SRC" > "$2"; }
extract_heredoc fixture-a.html "$WORK/fixture-a.html"
extract_heredoc fixture-b.json "$WORK/fixture-b.json"
assert_true "import-sources-extracted" "$([[ -s "$WORK/fixture-a.html" && -s "$WORK/fixture-b.json" ]] && echo true || echo false)"
IA="$WORK/imp-a/docs/product"; mkdir -p "$IA"
OUT="$(node "$TOOLS" product import --file "$WORK/fixture-a.html" --project niimo-test --dir "$IA" 2>&1)"; RC=$?
assert_rc "import-html-exit-0" 0 "$RC" "$OUT"
IB="$WORK/imp-b/docs/product"; mkdir -p "$IB"
OUT="$(node "$TOOLS" product import --file "$WORK/fixture-b.json" --project a1office-test --dir "$IB" 2>&1)"; RC=$?
assert_rc "import-json-exit-0" 0 "$RC" "$OUT"
for d in "$IA" "$IB"; do
  assert_true "import-writes-no-module-key-$(basename "$(dirname "$(dirname "$d")")")" "$(! grep -qE '^[[:space:]]*(module|modules):' "$d/ROADMAP.md" && ! grep -q '"module' "$d/index.json" && [[ ! -e "$d/modules" ]] && echo true || echo false)"
done

echo ""
echo "product-modules run.sh: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
