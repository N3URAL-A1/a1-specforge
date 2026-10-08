#!/usr/bin/env bash
# lib-split — guards the 2026-10-08 split of product.cjs and io.cjs into
# product-*.cjs / io-*.cjs. The two facades must keep their export lists,
# every submodule must load on its own (no require cycle), no submodule may
# require its own facade, and no submodule may grow past the 800-line cap.
set -u

pass=0
fail=0

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$REPO_ROOT/_shared/lib"

check() {
  local name="$1" rc="$2" out="$3"
  if [[ "$rc" -eq 0 ]]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "FAIL  $name"
    echo "----- output -----"; echo "$out"; echo "------------------"
    fail=$((fail + 1))
  fi
}

# --- facade export lists (exact, in order) ---
out="$(node -e '
const want = process.argv[2].split(",");
const got = Object.keys(require(process.argv[1]));
if (JSON.stringify(got) !== JSON.stringify(want)) { console.log("got  " + got.join(",")); process.exit(1); }
' "$LIB/product.cjs" "PRODUCT_SLUG_RE,cmdProductStatus,cmdProductStage,cmdProductMarkers,cmdProductChangelog,cmdProductInit,cmdProductAddMilestone,cmdProductAddFeature,cmdProductFeatureInit,cmdProductImport,cmdProductValidate,cmdProductVisionInit,cmdProductVisionTouch,cmdProductAuditPublish,cmdProductAuditSet,cmdProductAuditMirror" 2>&1)"
check "product.cjs export list unchanged" $? "$out"

out="$(node -e '
const want = process.argv[2].split(",");
const got = Object.keys(require(process.argv[1]));
if (JSON.stringify(got) !== JSON.stringify(want)) { console.log("got  " + got.join(",")); process.exit(1); }
' "$LIB/io.cjs" "vaultRoot,vaultRootInfo,peekVaultRoot,codeRoots,repoRoot,resolveVaultPath,parseFrontmatter,serializeScalar,detectKeyOrder,serializeFrontmatter,readMd,writeMdAtomic,nowIso,writeTextAtomic,parseScalarToken,parseNestedFrontmatter,serializeNestedFrontmatter,writeNestedMdAtomic,parseFlags,fail,assertSafeSegment,projectsPath,copyDirRecursive,tmpPathFor,nearestExistingAncestor,assertAncestorInside" 2>&1)"
check "io.cjs export list unchanged" $? "$out"

out="$(node -e 'const a = require(process.argv[1]), b = require(process.argv[2]); process.exit(a.PRODUCT_SLUG_RE === b.PRODUCT_SLUG_RE ? 0 : 1)' "$LIB/product.cjs" "$LIB/product-schema.cjs" 2>&1)"
check "PRODUCT_SLUG_RE has one owner (product-schema.cjs)" $? "$out"

# --- every submodule loads alone in a fresh process (catches require cycles
# that leave a destructured name undefined) and exports no undefined value ---
for f in "$LIB"/product-*.cjs "$LIB"/io-*.cjs "$LIB"/fs-safe.cjs; do
  out="$(node -e '
const m = require(process.argv[1]);
const bad = Object.entries(m).filter(([, v]) => v === undefined).map(([k]) => k);
if (bad.length) { console.log("undefined exports: " + bad.join(",")); process.exit(1); }
' "$f" 2>&1)"
  check "loads alone: $(basename "$f")" $? "$out"
done

# --- no submodule requires its own facade ---
out="$(grep -l "require('./product.cjs')" "$LIB"/product-*.cjs 2>/dev/null)"
[[ -z "$out" ]]; check "no product-*.cjs requires product.cjs" $? "$out"
out="$(grep -l "require('./io.cjs')" "$LIB"/io-*.cjs "$LIB"/fs-safe.cjs 2>/dev/null)"
[[ -z "$out" ]]; check "no io-*.cjs or fs-safe.cjs requires io.cjs" $? "$out"

# --- size cap (800 lines) for the split modules and both facades ---
out="$(wc -l "$LIB"/product*.cjs "$LIB"/io*.cjs "$LIB"/fs-safe.cjs | awk '$2 != "total" && $1 > 800')"
[[ -z "$out" ]]; check "split modules stay at or under 800 lines" $? "$out"

echo "lib-split: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
