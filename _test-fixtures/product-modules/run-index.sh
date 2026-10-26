#!/usr/bin/env bash
# Spec 023 Wave 4: index.json `module`/`modules`, schema lockstep, SCHEMA.md v1.2,
# `product status` modules output, `add-milestone --module`.
#
# SRC_OVERRIDE points the suite at another export of the repo (tools + docs); used
# to show each assertion red against the pre-wave tree.
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${SRC_OVERRIDE:-$(cd "$DIR/../.." && pwd)}"
TOOLS="$SRC/_shared/a1-tools.cjs"
SCHEMA="$SRC/docs/product/index.schema.json"
. "$DIR/lib.sh"
PIN="--require $DIR/pin-date.cjs"

pass=0; fail=0
ck() { if [[ "$2" == "true" ]]; then echo "PASS  $1"; pass=$((pass + 1)); else echo "FAIL  $1"; fail=$((fail + 1)); fi; }
jget() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);const r=(function(){return eval(process.argv[1])})();process.stdout.write(typeof r==="string"?r:JSON.stringify(r))})' "$2"; }
tf() { if "$@" >/dev/null 2>&1; then echo true; else echo false; fi; }
run() { NODE_OPTIONS="$PIN" node "$TOOLS" product "$@" >"$WORK/last.out" 2>&1; }

mk_workdir WORK modules-w4

# ---- AC-6a: index.json validates (modules project + golden cases) ----------
MP="$WORK/mod/docs/product"
write_roadmap "$MP" w4 "modules: [alpha, beta]" alpha beta
run changelog --entry "w4 regen" --why "index" --dir "$MP"; RC=$?
ck "index-modules-changelog-exit-0" "$([[ $RC -eq 0 ]] && echo true || echo false)"
IDX="$MP/index.json"
ck "index-modules-validates-top-level-helper" "$(tf check_index_against_schema "$IDX" "$SCHEMA")"
ck "index-modules-validates-deep" "$(tf check_index_deep "$IDX" "$SCHEMA")"
ck "index-modules-key-present" "$(jget "$(cat "$IDX")" 'Array.isArray(d.modules)')"
ck "index-modules-summary-values" "$([[ "$(jget "$(cat "$IDX")" 'd.modules')" == '[{"id":"alpha","milestones":["m1-first"],"cursor":"001-first-feature"},{"id":"beta","milestones":["m2-second"],"cursor":"003-third-feature"}]' ]] && echo true || echo false)"
ck "index-milestones-carry-module" "$([[ "$(jget "$(cat "$IDX")" 'd.milestones.map(m=>m.module)')" == '["alpha","beta"]' ]] && echo true || echo false)"
ck "index-schema-version-still-1" "$([[ "$(jget "$(cat "$IDX")" 'd.schema_version')" == "1" ]] && echo true || echo false)"

# untagged milestone in a modules project -> module: null (key present)
UP="$WORK/untag/docs/product"
write_roadmap "$UP" w4u "modules: [alpha]" alpha ""
run changelog --entry "w4 regen" --why "index" --dir "$UP"
ck "index-untagged-milestone-module-null" "$([[ "$(jget "$(cat "$UP/index.json")" 'd.milestones.map(m=>"module" in m ? m.module : "ABSENT")')" == '["alpha",null]' ]] && echo true || echo false)"
ck "index-untagged-validates-deep" "$(tf check_index_deep "$UP/index.json" "$SCHEMA")"

for c in a b c; do
  GP="$WORK/golden-$c/docs/product"
  build_case "$c" "$GP"
  ck "golden-$c-validates-deep" "$(tf check_index_deep "$GP/index.json" "$SCHEMA")"
  ck "golden-$c-no-module-keys" "$(jget "$(cat "$GP/index.json")" '!("modules" in d) && d.milestones.every(m=>!("module" in m))')"
  ck "golden-$c-no-module-text" "$([[ "$(grep -c '"module' "$GP/index.json")" == "0" ]] && echo true || echo false)"
done

# schema negatives: nested additionalProperties:false is active. A negative only
# counts when the mutated file was produced (mutation script exit 0) AND the
# unmutated index validates, so a crashed mutation cannot pass as "fails".
neg() { # neg <js-mutation> <out-file> <name>
  if node -e "$1" "$IDX" "$2" 2>/dev/null && check_index_deep "$IDX" "$SCHEMA" 2>/dev/null; then
    ck "$3" "$([[ "$(tf check_index_deep "$2" "$SCHEMA")" == "false" ]] && echo true || echo false)"
  else ck "$3" false; fi
}
neg 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1]));d.modules[0].extra=1;fs.writeFileSync(process.argv[2],JSON.stringify(d))' "$WORK/neg-modules-extra.json" "schema-negative-extra-key-in-modules-entry-fails"
neg 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1]));delete d.modules[0].cursor;fs.writeFileSync(process.argv[2],JSON.stringify(d))' "$WORK/neg-modules-nocursor.json" "schema-negative-missing-cursor-fails"
neg 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1]));d.milestones[0].module="Bad/Slug";fs.writeFileSync(process.argv[2],JSON.stringify(d))' "$WORK/neg-ms-badslug.json" "schema-negative-bad-milestone-module-slug-fails"
neg 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1]));d.milestones[0].bogus=1;fs.writeFileSync(process.argv[2],JSON.stringify(d))' "$WORK/neg-ms-extra.json" "schema-negative-extra-milestone-key-fails"

# ---- AC-6b: product status ---------------------------------------------------
ST="$(node "$TOOLS" product status --dir "$MP" 2>&1)"
ck "status-milestones-carry-module" "$([[ "$(jget "$ST" 'd.milestones.map(m=>m.module)')" == '["alpha","beta"]' ]] && echo true || echo false)"
ck "status-modules-deep-equals-index" "$([[ "$(jget "$ST" 'd.modules')" == "$(jget "$(cat "$IDX")" 'd.modules')" && "$(jget "$ST" 'Array.isArray(d.modules)')" == "true" ]] && echo true || echo false)"
ck "status-existing-keys-unchanged" "$([[ "$(jget "$ST" 'Object.keys(d)')" == '["project","milestones","features","next","modules"]' ]] && echo true || echo false)"
# no-module fixture: status keys equal the pre-wave baseline
node "$TOOLS" product status --dir "$WORK/golden-a/docs/product" > "$WORK/status-a.json" 2>&1
ck "status-no-modules-keys-baseline" "$([[ "$(jget "$(cat "$WORK/status-a.json")" 'Object.keys(d)')" == '["project","milestones","features","next"]' ]] && echo true || echo false)"
ck "status-no-modules-no-module-field" "$(jget "$(cat "$WORK/status-a.json")" 'd.milestones.every(m=>!("module" in m))')"
node "$TOOLS" product status --dir "$WORK/golden-c/docs/product" > "$WORK/status-c.json" 2>&1
ck "status-list-only-no-modules-key" "$(jget "$(cat "$WORK/status-c.json")" '!("modules" in d)')"

# ---- AC-4c: add-milestone --module -------------------------------------------
AP="$WORK/add/docs/product"
write_roadmap "$AP" w4a "modules: [immobilien, crm-core]" "" ""
run changelog --entry "seed" --why "derived files" --dir "$AP"
before="$(tree_hash "$AP")"
for bad in "Bad/Slug" "platform"; do
  run add-milestone --id p11-test --title "Test" --module "$bad" --dir "$AP"; RC=$?
  ck "add-milestone-module-$(echo "$bad" | tr -c 'a-zA-Z\n' _)-exit-1" "$([[ $RC -eq 1 ]] && echo true || echo false)"
  ck "add-milestone-module-$(echo "$bad" | tr -c 'a-zA-Z\n' _)-names-value" "$(grep -qF "$bad" "$WORK/last.out" && echo true || echo false)"
  ck "add-milestone-module-$(echo "$bad" | tr -c 'a-zA-Z\n' _)-validator-text" "$(grep -qE "must be kebab-case slug|is not in modules" "$WORK/last.out" && echo true || echo false)"
  ck "add-milestone-module-$(echo "$bad" | tr -c 'a-zA-Z\n' _)-tree-unchanged" "$([[ "$(tree_hash "$AP")" == "$before" ]] && echo true || echo false)"
  ck "add-milestone-module-$(echo "$bad" | tr -c 'a-zA-Z\n' _)-no-lock-left" "$([[ -z "$(find "$AP" -name '*.lock*' | head -1)" ]] && echo true || echo false)"
done
run add-milestone --id p11-test --title "Test" --module immobilien --dir "$AP"; RC=$?
ck "add-milestone-valid-module-exit-0" "$([[ $RC -eq 0 ]] && echo true || echo false)"
ck "add-milestone-module-stored-after-target" "$(awk '/id: p11-test/{f=1} f&&/target:/{t=1;next} f&&t{print; exit}' "$AP/ROADMAP.md" | grep -qx '    module: immobilien' && echo true || echo false)"
ck "add-milestone-module-files-appear" "$([[ -f "$AP/modules/immobilien/ROADMAP.md" && -f "$AP/modules/immobilien/NEXT.md" ]] && echo true || echo false)"
ck "add-milestone-module-index-lists-it" "$([[ "$(jget "$(cat "$AP/index.json")" 'd.modules.map(m=>m.id+":"+m.milestones.join(","))')" == '["immobilien:p11-test"]' ]] && echo true || echo false)"
ck "add-milestone-no-module-flag-unchanged" "$(run add-milestone --id p12-plain --title Plain --dir "$AP"; grep -A5 'id: p12-plain' "$AP/ROADMAP.md" | grep -q 'module' && echo false || echo true)"
# no modules: list -> free-form slug accepted, bad slug still rejected
FP="$WORK/free/docs/product"
write_roadmap "$FP" w4f "" "" ""
run changelog --entry "seed" --why "x" --dir "$FP"
run add-milestone --id q1 --title Q --module Bad_Slug --dir "$FP"; RC=$?
ck "add-milestone-free-form-bad-slug-exit-1" "$([[ $RC -eq 1 ]] && echo true || echo false)"
run add-milestone --id q1 --title Q --module anything --dir "$FP"; RC=$?
ck "add-milestone-free-form-good-slug-exit-0" "$([[ $RC -eq 0 ]] && echo true || echo false)"

# ---- docs lockstep -----------------------------------------------------------
SM="$SRC/docs/product/SCHEMA.md"
ck "schema-md-exactly-one-h2-8" "$([[ "$(grep -c '^## 8\.' "$SM")" == "1" ]] && echo true || echo false)"
ck "schema-md-h2-8-is-modules" "$(grep -qx '## 8\. Modules (v1\.2)' "$SM" && echo true || echo false)"
ck "schema-md-vault-mirror-is-9" "$(grep -qx '## 9\. Vault mirror (spec 010)' "$SM" && echo true || echo false)"
ck "schema-md-labelled-v1-2" "$(head -1 "$SM" | grep -q 'Schema v1\.2' && echo true || echo false)"
ck "vault-md-points-at-section-9" "$(grep -q 'SCHEMA.md) §9' "$SRC/docs/vault.md" && ! grep -q 'SCHEMA.md) §8' "$SRC/docs/vault.md" && echo true || echo false)"
ck "no-stale-section-8-vault-reference" "$([[ -z "$(grep -rnI 'Vault mirror.*§8\|§8.*[Vv]ault mirror' "$SRC/docs" "$SRC/skills" "$SRC/_shared" 2>/dev/null)" ]] && echo true || echo false)"

echo "----"; echo "passed: $pass  failed: $fail"
[[ $fail -eq 0 ]]
