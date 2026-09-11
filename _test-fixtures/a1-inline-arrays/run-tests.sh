#!/usr/bin/env bash
# Fixture: non-empty inline arrays (`[a, b]`) in BOTH frontmatter parsers.
#
# Until 2026-09-11 only `[]` was handled, so `[a, b]` came back as the STRING
# "[a, b]" — silently, because a string is a plausible-looking value. Measured
# consequences: docs/product/ROADMAP.md failed `product validate` for two months
# ("features[1].depends_on: must be an array"), and every retro's
# `issues:`/`finding_classes:` field was unreadable as a list, forcing
# a1-evolve's clustering to re-parse them out of raw text with a regex.
#
# Both parsers have their OWN value handling (parseFrontmatter does not route
# through parseScalarToken), so each is tested separately — a fix in one does
# not imply the other.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IO="$REPO_ROOT/_shared/lib/io.cjs"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0
results=()
ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

# Assert a node expression prints the expected JSON.
expect_json() {
  local label="$1" expr="$2" want="$3" got
  got="$(node -e "const io=require('$IO'); $expr" 2>&1)"
  if [[ "$got" == "$want" ]]; then ok "$label"
  else bad "$label (want=$want got=$got)"; fi
}

# ---------- parseScalarToken ----------
expect_json "A1 scalar: [a, b] → array" \
  'process.stdout.write(JSON.stringify(io.parseScalarToken("[a, b]")))' \
  '["a","b"]'
expect_json "A2 scalar: [] stays empty array" \
  'process.stdout.write(JSON.stringify(io.parseScalarToken("[]")))' \
  '[]'
# `[]` is caught by the exact-match line ABOVE the new branch, so it cannot
# detect the empty-inner guard. `[ ]` (whitespace) is the input that only the
# guard handles — without it, split(",") yields [""] and the value becomes
# [null]. Found by mutation probe: removing the guard left all 15 cases green
# ("the test never enters the branch it names",
# _shared/agent-lessons.md#theo-mutation-question).
expect_json "A2b scalar: [ ] with whitespace → empty array, not [null]" \
  'process.stdout.write(JSON.stringify(io.parseScalarToken("[ ]")))' \
  '[]'
expect_json "A3 scalar: single item [a]" \
  'process.stdout.write(JSON.stringify(io.parseScalarToken("[a]")))' \
  '["a"]'
expect_json "A4 scalar: quoted items unwrapped" \
  'process.stdout.write(JSON.stringify(io.parseScalarToken("[\"a\", \"b\"]")))' \
  '["a","b"]'
expect_json "A5 scalar: numbers stay numbers" \
  'process.stdout.write(JSON.stringify(io.parseScalarToken("[1, 2]")))' \
  '[1,2]'
# Deliberate limit: nested inline arrays are not YAML this repo emits, and
# silently half-parsing them would be worse than leaving them a string.
expect_json "A6 scalar: nested [[a]] left as string (documented limit)" \
  'process.stdout.write(JSON.stringify(io.parseScalarToken("[[a]]")))' \
  '"[[a]]"'
# A plain scalar must NOT be touched by the new branch.
expect_json "A7 scalar: plain value unaffected" \
  'process.stdout.write(JSON.stringify(io.parseScalarToken("plain")))' \
  '"plain"'

# ---------- parseFrontmatter (its own value handling) ----------
expect_json "B1 flat parser: inline array → array" \
  'const {fm}=io.parseFrontmatter("---\nissues: [a, b]\n---\nx\n"); process.stdout.write(JSON.stringify(fm.issues))' \
  '["a","b"]'
expect_json "B2 flat parser: [] stays empty array" \
  'const {fm}=io.parseFrontmatter("---\ne: []\n---\nx\n"); process.stdout.write(JSON.stringify(fm.e))' \
  '[]'
expect_json "B3 flat parser: block list still works" \
  'const {fm}=io.parseFrontmatter("---\nl:\n  - a\n  - b\n---\nx\n"); process.stdout.write(JSON.stringify(fm.l))' \
  '["a","b"]'
expect_json "B4 flat parser: a date is not mistaken for a list" \
  'const {fm}=io.parseFrontmatter("---\ndate: 2026-09-11\n---\nx\n"); process.stdout.write(JSON.stringify(fm.date))' \
  '"2026-09-11"'

# ---------- parseNestedFrontmatter ----------
expect_json "C1 nested parser: depends_on inline array" \
  'const {fm}=io.parseNestedFrontmatter("---\nfeatures:\n  - id: x\n    depends_on: [001-a, 002-b]\n---\ny\n"); process.stdout.write(JSON.stringify(fm.features[0].depends_on))' \
  '["001-a","002-b"]'

# ---------- Round-trip (the write path must not lose the list) ----------
# parse -> serialize -> parse must yield the same value. Serialization emits a
# block list rather than inline; that is fine, but it must read back as a list.
# Compared key-by-key, NOT via JSON.stringify of the whole object: key ORDER
# may differ after a round-trip (serializeFrontmatter honours detectKeyOrder),
# and an order-sensitive compare reports a loss where none exists — a false red
# is as useless as a false green.
roundtrip() {
  local got
  got="$(node -e "
    const io=require('$IO');
    const src='---\nissues: [a, b]\ndate: 2026-09-11\n---\nbody\n';
    const {fm,body}=io.parseFrontmatter(src);
    const out=io.serializeFrontmatter(fm, io.detectKeyOrder(src));
    const {fm:fm2}=io.parseFrontmatter('---\n'+out+'\n---\n'+body);
    const norm=(o)=>JSON.stringify(Object.keys(o).sort().map((k)=>[k,o[k]]));
    process.stdout.write(norm(fm)===norm(fm2) ? 'lossless' : 'LOSS '+JSON.stringify(fm2));
  " 2>&1)"
  if [[ "$got" == "lossless" ]]; then ok "D1 round-trip parse→serialize→parse keeps every value"
  else bad "D1 round-trip keeps every value ($got)"; fi
}

# The list must survive as a LIST, not merely as some value — this is the half
# of D1 that actually concerns the fix (D1 alone would pass if both sides were
# equally broken strings).
roundtrip_type() {
  local got
  got="$(node -e "
    const io=require('$IO');
    const src='---\nissues: [a, b]\n---\nbody\n';
    const {fm,body}=io.parseFrontmatter(src);
    const out=io.serializeFrontmatter(fm, io.detectKeyOrder(src));
    const {fm:fm2}=io.parseFrontmatter('---\n'+out+'\n---\n'+body);
    process.stdout.write(Array.isArray(fm2.issues) && fm2.issues.length===2 ? 'array' : 'NOT-ARRAY '+JSON.stringify(fm2.issues));
  " 2>&1)"
  if [[ "$got" == "array" ]]; then ok "D2 round-trip keeps the list a LIST (not a string)"
  else bad "D2 round-trip keeps the list a list ($got)"; fi
}
roundtrip
roundtrip_type

# ---------- The real corpus: the defect this fix was found through ----------
# The repo's own ROADMAP.md must validate. It failed for two months on exactly
# this parser gap, so a regression here is directly observable.
corpus() {
  local out rc
  out="$(cd "$REPO_ROOT" && node "$TOOLS" product validate --project a1-specforge 2>/dev/null)"; rc=$?
  if [[ $rc -eq 0 ]] && printf '%s' "$out" | grep -q '"valid": true'; then
    ok "E1 repo ROADMAP.md validates (the two-month-old failure)"
  else
    bad "E1 repo ROADMAP.md validates (rc=$rc)"; results+=("      out: $(printf '%s' "$out" | tail -4)")
  fi
}
corpus

printf '%s\n' "${results[@]}"
echo "----"
echo "a1-inline-arrays: $pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
