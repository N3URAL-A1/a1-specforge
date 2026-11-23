# Part 09 — the `delete-after` op of golden/apply-prompts-allowed.cjs (spec 027 slice 4,
# FR-025: SKILL.md replaces its S-path table by the `feature plan-steps` pointer).
#
#   K1  a delete-after whose gone row does not match the golden -> exit 3
#   K2  an anchor that occurs twice -> exit 3
#   K3  a correct delete plus insert on a planted golden pair -> the applied golden
#       equals the planted current byte for byte
#   K4  the P-mut guard with the allowance applied: the current 02-specify.md plus one
#       stray line outside any block does NOT compare equal with the applied golden
#
# RED proof (run for real): mutation (c) removes the gone-row comparison from
# apply-prompts-allowed.cjs on a copy -> K1 red; mutation (k) makes the script write
# the current text as the applied golden on a copy -> K4 red.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

# k_apply <apply-script> <allowed> <file> <golden> <current> <work> -> exit code of the script
k_apply() {
  node "$1" "$2" "$3" "$4" "$5" "$6/golden.applied" "$6/current.applied" 2>"$6/apply.err"
}

caseDeleteAfter() {
  local work apply allowed rc
  work="$(g_mktemp w1k-del)"; g_need_dir work "$work"
  apply="${K_APPLY_SCRIPT:-$HERE/golden/apply-prompts-allowed.cjs}"
  allowed="$work/allowed.tsv"
  printf '%s\n' 'alpha' 'ANCHOR' 'old one' '' 'old two' 'omega' >"$work/golden.txt"
  printf '%s\n' 'alpha' 'ANCHOR' 'new one' '' 'new two' 'new three' 'omega' >"$work/current.txt"

  # K1: the gone rows do not match the golden lines after the anchor.
  printf 'T.md\tmd\tdelete-after\tANCHOR\nT.md\tmd\tgone\told one\nT.md\tmd\tgone\twrong\nT.md\tmd\tgone\told two\n' >"$allowed"
  k_apply "$apply" "$allowed" T.md "$work/golden.txt" "$work/current.txt" "$work"; rc=$?
  if [[ "$rc" -eq 3 ]]; then ok "K1 delete-after with a gone row that does not match the golden: exit 3"
  else bad "K1 delete-after with a gone row that does not match the golden: exit $rc, expected 3"; fi

  # K2: the anchor occurs twice in the golden.
  printf '%s\n' 'ANCHOR' 'old one' 'ANCHOR' 'old one' >"$work/golden2.txt"
  printf 'T.md\tmd\tdelete-after\tANCHOR\nT.md\tmd\tgone\told one\n' >"$allowed"
  k_apply "$apply" "$allowed" T.md "$work/golden2.txt" "$work/current.txt" "$work"; rc=$?
  if [[ "$rc" -eq 3 ]]; then ok "K2 delete-after on an anchor that occurs twice: exit 3"
  else bad "K2 delete-after on an anchor that occurs twice: exit $rc, expected 3"; fi

  # K3: a correct delete followed by an insert on the same anchor (the SKILL.md shape).
  printf 'T.md\tmd\tdelete-after\tANCHOR\nT.md\tmd\tgone\told one\nT.md\tmd\tgone\t\nT.md\tmd\tgone\told two\nT.md\tmd\tinsert-after\tANCHOR\nT.md\tmd\tline\tnew one\nT.md\tmd\tline\t\nT.md\tmd\tline\tnew two\nT.md\tmd\tline\tnew three\n' >"$allowed"
  if k_apply "$apply" "$allowed" T.md "$work/golden.txt" "$work/current.txt" "$work" && cmp -s "$work/golden.applied" "$work/current.applied" && cmp -s "$work/current.applied" "$work/current.txt"; then
    ok "K3 a correct delete plus insert on a planted pair: the applied golden equals the planted current byte for byte"
  else bad "K3 a correct delete plus insert on a planted pair: applied golden differs ($(cat "$work/apply.err"))"; fi
  rm -rf "$work"
}
caseDeleteAfter

# K4: the P-mut guard with the real allowance applied (the 02-specify.md insertion made P-mut's
# own mutation redundant: the stripped file already differs from the raw golden).
caseMutWithAllowance() {
  local work apply
  work="$(g_mktemp w1k-k4)"; g_need_dir work "$work"
  apply="${K_APPLY_SCRIPT:-$HERE/golden/apply-prompts-allowed.cjs}"
  { cat "$REPO_ROOT/skills/a1-new-feature/workflows/02-specify.md"; printf '%s\n' '<!-- mutation: a stray line outside any profile block -->'; } >"$work/02-specify.mutated.md"
  node "$HERE/fixtures/strip-blocks.cjs" "$work/02-specify.mutated.md" >"$work/mutated.stripped"
  cp "$GOLDEN/prompts/02-specify.md" "$work/golden.body"
  if ! k_apply "$apply" "$GOLDEN/prompts.allowed-diff" 02-specify.md "$work/golden.body" "$work/mutated.stripped" "$work"; then
    bad "K4 02-specify with a stray line: apply-prompts-allowed.cjs refused ($(cat "$work/apply.err"))"
  elif cmp -s "$work/golden.applied" "$work/current.applied"; then
    bad "K4 02-specify with a stray line outside any block still equals the allowance-applied golden: the guard proves nothing"
  else
    ok "K4 02-specify with a stray line outside any block does not equal the allowance-applied golden"
  fi
  rm -rf "$work"
}
caseMutWithAllowance
