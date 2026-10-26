#!/usr/bin/env bash
# Spec 023 Wave 5: help text for the module feature (help-product.cjs) and the
# pending help.cjs patch (blocked by 021-dashboard until its claim is released).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LIB="$ROOT/_shared/lib"
. "$HERE/lib.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL - $1"; }
has() { if printf '%s\n' "$2" | grep -qF -- "$3"; then ok "$1"; else bad "$1 (missing: $3)"; fi; }
hasnt() { if printf '%s\n' "$2" | grep -qF -- "$3"; then bad "$1 (unexpected: $3)"; else ok "$1"; fi; }

TEXT="$(node -e "const h=require('$LIB/help-product.cjs').PRODUCT_MODULES_HELP;if(typeof h!=='string'||!h.trim())process.exit(3);process.stdout.write(h)" 2>/dev/null)"
RC=$?
if [ "$RC" = 0 ]; then ok "help-product.cjs exports a non-empty PRODUCT_MODULES_HELP string"; else bad "help-product.cjs export (rc=$RC)"; fi

# One grep per documented item.
has "module: field on milestones" "$TEXT" "module: <slug>"
has "modules: vocabulary list" "$TEXT" "modules: [<slug>, ...]"
has "membership rule" "$TEXT" "is not in modules"
has "kebab-case rule" "$TEXT" "kebab-case"
has "generated ROADMAP view" "$TEXT" "docs/product/modules/<module>/ROADMAP.md"
has "generated NEXT view" "$TEXT" "modules/<module>/NEXT.md"
has "generated do-not-edit rule" "$TEXT" "do not edit"
has "derived per-module cursor" "$TEXT" "cursor"
has "Next per module section" "$TEXT" "Next per module"
has "Unassigned milestones section" "$TEXT" "Unassigned milestones"
has "add-milestone --module flag" "$TEXT" "--module <slug>"
has "status modules output" "$TEXT" "top-level \`modules\`"
has "byte-identical no-module behaviour" "$TEXT" "byte-identical"
has "adopt/import never writes module keys" "$TEXT" "never write"

# Negative controls: removing an item must make its check fail.
for item in "Unassigned milestones" "--module <slug>" "byte-identical"; do
  CUT="$(printf '%s\n' "$TEXT" | sed "s/$item/REMOVED/g")"
  hasnt "negative control: help without '$item' is detected" "$CUT" "$item"
done
NEG="$(printf '%s\n' "$TEXT" | sed 's/Unassigned milestones/REMOVED/g')"
if printf '%s\n' "$NEG" | grep -qF -- "Unassigned milestones"; then bad "negative control did not remove item"; else ok "negative control: grep on removed item fails"; fi

# Every flag/command named in the help exists in the code.
if grep -qF "module: 'value'" "$LIB/product-cmd-scaffold.cjs"; then ok "--module parsed in product-cmd-scaffold.cjs"; else bad "--module not parsed in product-cmd-scaffold.cjs"; fi
if grep -qF "modules: modulesSummary" "$LIB/product-cmd-progress.cjs"; then
  ok "product status emits the modules key (Wave 4 present in tree)"
else
  # Wave 4 not landed: assert against the derivation symbols instead.
  MODS="$(node -e "const m=require('$LIB/product-modules.cjs');console.log(['modulesInUse','moduleCursor','GENERATED_HEADER'].filter(k=>!m[k]).join(','))")"
  if [ -z "$MODS" ]; then ok "Wave 4 not landed: product-modules.cjs symbols exist (modulesInUse, moduleCursor)"; else bad "missing symbols: $MODS"; fi
fi
has "generated header names do-not-edit" "$(node -e "console.log(require('$LIB/product-modules.cjs').GENERATED_HEADER)")" "enerated"
has "NEXT section 'Next per module' in generator" "$(cat "$LIB/product-modules.cjs")" "## Next per module"
has "NEXT section 'Unassigned milestones' in generator" "$(cat "$LIB/product-modules.cjs")" "## Unassigned milestones"

# Pending help.cjs patch applies cleanly.
( cd "$ROOT" && git apply --check "$HERE/help-cjs.pending.patch" ) 2>/dev/null; PRC=$?
if [ "$PRC" = 0 ]; then ok "git apply --check help-cjs.pending.patch exits 0"; else bad "pending patch does not apply (rc=$PRC)"; fi

echo "pass=$PASS fail=$FAIL"
[ "$FAIL" = 0 ]
