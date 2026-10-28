# Part 01 — golden baseline (spec 006-specforge-kritis-profile, FR-008, SC-002).
#
# Three guards:
#   G  the 12 CLI scenarios equal their goldens from GOLDEN_COMMIT (SC-002:
#      no-profile behaviour of every touched CLI path stays byte-identical).
#   I  the call-site inventory recomputes the 22-subcommand grep and asserts
#      set equality plus the exact count 22 (= 11 covered + 11 excluded).
#   P  every golden prompt file, stripped of `a1-profile:kritis` blocks,
#      equals its golden copy (prompts.allowed-diff lists the one exception).
#
# RED proof (quoted in STATUS.md / the wave report, run for real, not just
# asserted): mutation 1 — insert one line OUTSIDE a block in a copy of
# 02-specify.md turns its P case red. Mutation 2 — change `spec
# update-status`'s stdout wording on a git-archive snapshot turns the G
# spec-update-status case(s) red. Neither mutation is applied to the live
# tree by this part; both are exercised against throwaway copies inside a
# temp dir, so this part is self-proving without touching production code.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

GOLDEN="$HERE/golden"
# shellcheck source=../golden/scenarios.sh
source "$GOLDEN/scenarios.sh"

# ---------- G: scenario count, then the 12 CLI scenarios ----------
# Count assert beside the equality asserts below (contract item 2): a
# scenario silently dropped from G_SCENARIOS must not go unnoticed just
# because every remaining scenario still compares equal.
if [[ "${#G_SCENARIOS[@]}" -eq 12 ]]; then
  ok "G scenario count: golden/scenarios.sh declares exactly 12 scenarios"
else
  bad "G scenario count: golden/scenarios.sh declares ${#G_SCENARIOS[@]} scenarios, expected 12"
fi
caseG() {
  local name="$1" fn="$2" work ext diffs="" leak="" hdr
  work="$(g_mktemp w1k-gcase)"; g_need_dir work "$work"
  hdr="$(head -n 1 "$GOLDEN/$name.out")"
  if [[ "$hdr" != *"commit cb3fd99a6be44891d52b96cc4223f4897823e7c9"* ]]; then
    bad "G $name golden header does not name the golden commit: $hdr"
    rm -rf "$work"
    return
  fi
  "$fn" "$TOOLS" "$work/$name"
  leak="$(find "$G_HOME" -mindepth 1 2>/dev/null)"
  g_cleanup
  for ext in out err files; do
    tail -n +2 "$GOLDEN/$name.$ext" >"$work/golden.$ext"
    cp "$work/$name.$ext" "$work/current.$ext"
    if ! cmp -s "$work/golden.$ext" "$work/current.$ext"; then
      diffs="$diffs $ext"
      results+=("      --- $name.$ext: golden vs current")
      while IFS= read -r l; do results+=("      $l"); done \
        < <(diff "$work/golden.$ext" "$work/current.$ext" | head -n 12)
    fi
  done
  rm -rf "$work"
  if [[ -z "$diffs" && -z "$leak" ]]; then
    ok "G $name golden (out, err, files byte-identical; nothing left under HOME)"
  else
    bad "G $name golden (differs:${diffs:- none}; HOME leak: ${leak:-none})"
  fi
}
for entry in "${G_SCENARIOS[@]}"; do
  gname="${entry%%:*}"; gfn="${entry#*:}"
  caseG "$gname" "$gfn"
done

# ---------- G-mut: RED proof 2 — spec update-status wording mutation ----------
# Copies _shared/lib/spec.cjs (and its dependents' resolution via a full
# archive-tree copy, never the live tree) from GOLDEN_COMMIT into a scratch
# dir, changes ONE stdout-shaping literal, reruns the spec-update-status
# scenario against the mutated copy, and asserts the golden case would now
# fail. This proves the G case actually discriminates wording, not just
# shape — the named red-making change from the wave-plan brief.
caseGMutSpecUpdateStatus() {
  local mutroot work
  mutroot="$(g_mktemp w1k-mut)"; g_need_dir mutroot "$mutroot"
  git -C "$REPO_ROOT" archive cb3fd99a6be44891d52b96cc4223f4897823e7c9 | tar -x -C "$mutroot"
  # The mutation: rename the JSON key `status` to `STATUS_MUTATED` in
  # cmdSpecUpdateStatus's return object (the literal `    status: fm.status,`
  # line) — a single-token change to the command's own stdout shape, the
  # smallest possible wording mutation.
  if ! grep -qF '    status: fm.status,' "$mutroot/_shared/lib/spec.cjs"; then
    bad "G-mut spec-update-status: anchor line not found in GOLDEN_COMMIT's spec.cjs (mutation cannot be applied — report, do not skip)"
    rm -rf "$mutroot"
    return
  fi
  sed -E 's/^(\s*)status: fm\.status,$/\1STATUS_MUTATED: fm.status,/' \
    "$mutroot/_shared/lib/spec.cjs" >"$mutroot/_shared/lib/spec.cjs.new"
  mv "$mutroot/_shared/lib/spec.cjs.new" "$mutroot/_shared/lib/spec.cjs"
  work="$(g_mktemp w1k-mutcase)"; g_need_dir work "$work"
  run_spec_update_status "$mutroot/_shared/a1-tools.cjs" "$work/mut"
  g_cleanup
  tail -n +2 "$GOLDEN/spec-update-status.out" >"$work/golden.out"
  if cmp -s "$work/golden.out" "$work/mut.out"; then
    bad "G-mut spec-update-status: mutated stdout wording (status -> STATUS_MUTATED) did NOT turn the golden comparison red — the guard proves nothing"
  else
    ok "G-mut spec-update-status: mutated stdout wording (status -> STATUS_MUTATED) turns the golden comparison red, as required"
  fi
  rm -rf "$mutroot" "$work"
}
caseGMutSpecUpdateStatus

# ---------- I: call-site inventory ----------
caseI() {
  local recomputed expected_count=22
  recomputed="$(cd "$REPO_ROOT" && grep -rhoE "a1-tools\.cjs [a-z-]+ [a-z-]+" skills/a1-new-feature | sort -u)"
  local recomputed_count
  recomputed_count="$(printf '%s\n' "$recomputed" | grep -c .)"
  if [[ "$recomputed_count" -ne "$expected_count" ]]; then
    bad "I inventory count: re-grepped $recomputed_count subcommands, expected $expected_count"
  else
    ok "I inventory count: re-grepped exactly $expected_count subcommands"
  fi

  # Set equality: every inventory.txt row's subcommand (text before the tab)
  # with the "a1-tools.cjs " prefix restored must equal the re-grepped set.
  local inv_subs
  inv_subs="$(grep -v '^#' "$GOLDEN/inventory.txt" | grep . | cut -f1 | sed 's/^/a1-tools.cjs /' | LC_ALL=C sort)"
  local regrepped_sorted
  regrepped_sorted="$(printf '%s\n' "$recomputed" | LC_ALL=C sort)"
  if [[ "$inv_subs" == "$regrepped_sorted" ]]; then
    ok "I inventory set equality: inventory.txt rows match the re-grepped set exactly"
  else
    bad "I inventory set equality: inventory.txt rows differ from the re-grepped set"
    results+=("      inventory.txt has, re-grep does not:")
    while IFS= read -r line; do [[ -n "$line" ]] && results+=("        $line"); done \
      < <(comm -23 <(printf '%s\n' "$inv_subs") <(printf '%s\n' "$regrepped_sorted"))
    results+=("      re-grep has, inventory.txt does not:")
    while IFS= read -r line; do [[ -n "$line" ]] && results+=("        $line"); done \
      < <(comm -13 <(printf '%s\n' "$inv_subs") <(printf '%s\n' "$regrepped_sorted"))
  fi

  # Every row must be covered:<x> or excluded:<x> — no row left undisposed.
  local undisposed
  undisposed="$(grep -v '^#' "$GOLDEN/inventory.txt" | grep . | grep -vcE '	(covered|excluded):')"
  if [[ "$undisposed" -eq 0 ]]; then
    ok "I inventory disposition: every row is covered:<x> or excluded:<x>"
  else
    bad "I inventory disposition: $undisposed row(s) have neither covered: nor excluded:"
  fi

  # Exactly 11 covered + 11 excluded.
  local covered_count excluded_count
  covered_count="$(grep -c '	covered:' "$GOLDEN/inventory.txt")"
  excluded_count="$(grep -c '	excluded:' "$GOLDEN/inventory.txt")"
  if [[ "$covered_count" -eq 11 && "$excluded_count" -eq 11 ]]; then
    ok "I inventory 11+11: $covered_count covered, $excluded_count excluded"
  else
    bad "I inventory 11+11: got $covered_count covered, $excluded_count excluded (want 11 and 11)"
  fi
}
caseI

# ---------- P: prompt goldens, stripped of a1-profile:kritis blocks ----------
PROMPT_FILES_REPO=(
  "skills/a1-new-feature/SKILL.md"
  "skills/a1-new-feature/workflows/02-specify.md"
  "skills/a1-new-feature/workflows/03-clarify.md"
  "skills/a1-new-feature/workflows/04.5-consistency-gate.md"
  "agents/a1-rene-requirement-engineer.md"
  "agents/a1-samuel-security.md"
)
# Count assert beside the equality asserts below (contract item 2).
if [[ "${#PROMPT_FILES_REPO[@]}" -eq 6 ]]; then
  ok "P prompt file count: exactly 6 golden prompt files declared"
else
  bad "P prompt file count: ${#PROMPT_FILES_REPO[@]} golden prompt files declared, expected 6"
fi
caseP() {
  local relpath="$1" base work allowed
  base="$(basename "$relpath")"
  work="$(g_mktemp w1k-pcase)"; g_need_dir work "$work"
  if ! node "$HERE/fixtures/strip-blocks.cjs" "$REPO_ROOT/$relpath" >"$work/current.stripped" 2>"$work/strip.err"; then
    bad "P $base: strip-blocks refused the current file: $(cat "$work/strip.err")"
    rm -rf "$work"
    return
  fi
  cp "$GOLDEN/prompts/$base" "$work/golden.body"
  allowed="$GOLDEN/prompts.allowed-diff"
  # Direct compare FIRST: at Wave 1, the current tree has not made the
  # allowed W8 edit yet, so golden (raw) and current (stripped) must match
  # exactly with no allowance applied — the allowed-diff only comes into
  # play once a later wave actually makes that one documented change. Only
  # when the direct compare fails do we fall back to the allowed-diff, so a
  # file with no listed allowance (or one not yet exercised) is still
  # compared byte for byte, never silently waved through.
  if cmp -s "$work/golden.body" "$work/current.stripped"; then
    ok "P $base: stripped current equals golden (no allowance needed)"
    rm -rf "$work"
    return
  fi
  if [[ -f "$allowed" ]] && grep -q "^${base}	" "$allowed"; then
    if ! node "$GOLDEN/apply-prompts-allowed.cjs" "$allowed" "$base" \
         "$work/golden.body" "$work/current.stripped" "$work/golden.applied" "$work/current.applied" 2>"$work/apply.err"; then
      bad "P $base: apply-prompts-allowed.cjs refused: $(cat "$work/apply.err")"
      rm -rf "$work"
      return
    fi
    if cmp -s "$work/golden.applied" "$work/current.applied"; then
      ok "P $base: stripped current equals golden (prompts.allowed-diff applied)"
    else
      bad "P $base: stripped current differs from golden, even after prompts.allowed-diff"
      results+=("      $(diff "$work/golden.applied" "$work/current.applied" | head -n 8)")
    fi
  else
    bad "P $base: stripped current differs from golden, and no allowance is listed for it"
    results+=("      $(diff "$work/golden.body" "$work/current.stripped" | head -n 8)")
  fi
  rm -rf "$work"
}
for rel in "${PROMPT_FILES_REPO[@]}"; do
  caseP "$rel"
done

# ---------- P-allowed: the allowed-diff mechanism itself, simulated ----------
# caseP above never exercises apply-prompts-allowed.cjs for real (the direct
# compare passes today — the allowed edit has not landed yet). This proves
# the allowed-diff path works when the ONE documented change HAS landed: a
# simulated current SKILL.md with exactly the allowed line inserted still
# compares equal via prompts.allowed-diff.
casePAllowedSimulated() {
  local work
  work="$(g_mktemp w1k-pallow)"; g_need_dir work "$work"
  sed '/  <projekt>"), "spec for <project>" (alias: "spec für <projekt>"), "feature pipeline",/a\
  "a1-new-feature", "erstelle eine Spezifikation" (German alias for "spec for <project>"),' \
    "$GOLDEN/prompts/SKILL.md" >"$work/simulated-current.stripped"
  cp "$GOLDEN/prompts/SKILL.md" "$work/golden.body"
  if ! node "$GOLDEN/apply-prompts-allowed.cjs" "$GOLDEN/prompts.allowed-diff" "SKILL.md" \
       "$work/golden.body" "$work/simulated-current.stripped" "$work/golden.applied" "$work/current.applied" 2>"$work/apply.err"; then
    bad "P-allowed SKILL.md: apply-prompts-allowed.cjs refused on a simulated post-W8 file: $(cat "$work/apply.err")"
  elif cmp -s "$work/golden.applied" "$work/current.applied"; then
    ok "P-allowed SKILL.md: a simulated post-W8 file (golden + exactly the allowed line) compares equal via prompts.allowed-diff"
  else
    bad "P-allowed SKILL.md: a simulated post-W8 file does NOT compare equal via prompts.allowed-diff (format mismatch)"
    results+=("      $(diff "$work/golden.applied" "$work/current.applied" | head -n 8)")
  fi
  rm -rf "$work"
}
casePAllowedSimulated

# ---------- P-mut: RED proof 1 — a line outside a block turns the prompt case red ----------
caseMutOutsideBlock() {
  local work
  work="$(g_mktemp w1k-pmut)"; g_need_dir work "$work"
  cp "$REPO_ROOT/skills/a1-new-feature/workflows/02-specify.md" "$work/02-specify.md"
  # Mutation: one line inserted OUTSIDE any a1-profile:kritis block (there are
  # none yet in this file, so the whole file is "outside a block" today —
  # exactly the case the wave-plan RED proof names).
  { cat "$work/02-specify.md"; printf '%s\n' '<!-- mutation: a stray line outside any profile block -->'; } \
    >"$work/02-specify.mutated.md"
  node "$HERE/fixtures/strip-blocks.cjs" "$work/02-specify.mutated.md" >"$work/mutated.stripped"
  if cmp -s "$GOLDEN/prompts/02-specify.md" "$work/mutated.stripped"; then
    bad "P-mut 02-specify: a line inserted outside any block did NOT turn the golden comparison red — the guard proves nothing"
  else
    ok "P-mut 02-specify: a line inserted outside any block turns the golden comparison red, as required"
  fi
  rm -rf "$work"
}
caseMutOutsideBlock

# ---------- strip-blocks.cjs structural guards (unit-level, no golden needed) ----------
caseStripGuards() {
  local work injection_out
  work="$(g_mktemp w1k-stripguard)"; g_need_dir work "$work"

  printf '%s\n' \
    '<!-- a1-profile:kritis -->' \
    '**KRITIS profile only** — skip this block unless the run profile is `kritis`.' \
    'body' \
    '<!-- /a1-profile:kritis -->' \
    'tail' >"$work/balanced.md"
  if node "$HERE/fixtures/strip-blocks.cjs" "$work/balanced.md" >"$work/balanced.out" 2>/dev/null \
     && [[ "$(cat "$work/balanced.out")" == "tail" ]]; then
    ok "strip-blocks: balanced block with guard sentence strips cleanly to the tail line"
  else
    bad "strip-blocks: balanced block with guard sentence did not strip as expected"
  fi

  printf '%s\n' '<!-- a1-profile:kritis -->' 'body' '<!-- /a1-profile:kritis -->' >"$work/noguard.md"
  if node "$HERE/fixtures/strip-blocks.cjs" "$work/noguard.md" >/dev/null 2>"$work/noguard.err"; then
    bad "strip-blocks: a block missing the guard sentence was accepted (must exit 2)"
  else
    ok "strip-blocks: a block missing the guard sentence is refused, exit 2 ($(cat "$work/noguard.err" | head -c 80))"
  fi

  printf '%s\n' '<!-- a1-profile:kritis -->' '**KRITIS profile only** — skip this block unless the run profile is `kritis`.' 'body' >"$work/unbalanced.md"
  if node "$HERE/fixtures/strip-blocks.cjs" "$work/unbalanced.md" >/dev/null 2>"$work/unbalanced.err"; then
    bad "strip-blocks: an unbalanced open block was accepted (must exit 2)"
  else
    ok "strip-blocks: an unbalanced open block is refused, exit 2"
  fi

  printf '%s\n' \
    '<!-- a1-profile:kritis -->' \
    '**KRITIS profile only** — skip this block unless the run profile is `kritis`.' \
    '<!-- a1-profile:kritis -->' \
    '**KRITIS profile only** — skip this block unless the run profile is `kritis`.' \
    'inner' \
    '<!-- /a1-profile:kritis -->' \
    '<!-- /a1-profile:kritis -->' >"$work/nested.md"
  if node "$HERE/fixtures/strip-blocks.cjs" "$work/nested.md" >/dev/null 2>"$work/nested.err"; then
    bad "strip-blocks: a nested open block was accepted (must exit 2)"
  else
    ok "strip-blocks: a nested open block is refused, exit 2"
  fi

  printf '%s\n' 'head' '<!-- /a1-profile:kritis -->' >"$work/closeonly.md"
  if node "$HERE/fixtures/strip-blocks.cjs" "$work/closeonly.md" >/dev/null 2>"$work/closeonly.err"; then
    bad "strip-blocks: a close marker with no matching open was accepted (must exit 2)"
  else
    ok "strip-blocks: a close marker with no matching open is refused, exit 2"
  fi

  # Hostile (a): nonexistent file — exit 2, no crash/stack trace.
  if node "$HERE/fixtures/strip-blocks.cjs" "$work/does-not-exist.md" >/dev/null 2>"$work/missing.err"; then
    bad "strip-blocks: a nonexistent file was accepted (must exit 2)"
  else
    ok "strip-blocks: a nonexistent file is refused, exit 2"
  fi

  # Hostile (b): injection-shaped content inside a VALID block body is
  # treated as inert text and passes through the strip (never evaluated) —
  # the block is still removed as a whole, so none of it reaches stdout.
  printf '%s\n' \
    '<!-- a1-profile:kritis -->' \
    '**KRITIS profile only** — skip this block unless the run profile is `kritis`.' \
    '; rm -rf / #' \
    '$(echo pwned)' \
    '<script>alert(1)</script>' \
    '<!-- /a1-profile:kritis -->' \
    'tail' >"$work/injection.md"
  injection_out="$(node "$HERE/fixtures/strip-blocks.cjs" "$work/injection.md" 2>"$work/injection.err")"
  if [[ "$injection_out" == "tail" ]] && ! grep -q 'pwned\|rm -rf\|<script>' "$work/injection.err"; then
    ok "strip-blocks: injection-shaped block body is removed whole, never evaluated or echoed"
  else
    bad "strip-blocks: injection-shaped block body leaked into output (out: [$injection_out])"
  fi

  # Hostile (c): oversized block body (>= 10,000 chars) — must not hang or crash.
  {
    printf '%s\n' '<!-- a1-profile:kritis -->' \
      '**KRITIS profile only** — skip this block unless the run profile is `kritis`.'
    head -c 10000 /dev/zero | tr '\0' 'x'
    printf '\n%s\n%s\n' '<!-- /a1-profile:kritis -->' 'tail'
  } >"$work/oversized.md"
  if timeout 10 node "$HERE/fixtures/strip-blocks.cjs" "$work/oversized.md" >"$work/oversized.out" 2>"$work/oversized.err" \
     && [[ "$(cat "$work/oversized.out")" == "tail" ]]; then
    ok "strip-blocks: a >= 10,000 char block body strips cleanly within 10s, no hang/crash"
  else
    bad "strip-blocks: a >= 10,000 char block body did not strip cleanly (timeout, crash, or wrong output)"
  fi

  rm -rf "$work"
}
caseStripGuards
