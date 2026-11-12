# Part 07 — pipeline integration (spec 024-ux-studio, FR-015, FR-020, FR-021).
#
# Reads the real prompt files; nothing is copied or re-implemented here. Each case header names the
# single production edit that turns it red (contract item 4); the mutations are run once for real
# in the wave report. FR-020's post-merge routing row lives outside the repo, so the in-repo half
# is measured: `profile trigger-check` over skills/ only (CI has no ~/.claude/skills).

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

IN_CLARIFY="$REPO_ROOT/skills/a1-new-feature/workflows/03-clarify.md"
IN_NF_SKILL="$REPO_ROOT/skills/a1-new-feature/SKILL.md"
IN_UWE="$REPO_ROOT/agents/a1-uwe-ux-expert.md"
IN_UWE_REL="agents/a1-uwe-ux-expert.md"
IN_FORMAT='UX/<screen-name>: Variant <X> chosen. Reason: <1-sentence>.'

# Count of lines matching a fixed string (grep -c exits 1 on 0 hits; the count is what matters).
in_count() { grep -cF -- "$1" "$2" || true; }

# The body of a "### <heading prefix>" section: from its heading to the next "### ".
in_section() {
  awk -v pfx="### $1" 'index($0, pfx) == 1 { on = 1; print; next } /^### / { on = 0 } on' "$2"
}

# I1 [FR-015] sub-step 2b-2a exists exactly once and sits between 2b-2 and 2b-3.
# Red: delete the "### 2b-2a — …" heading from 03-clarify.md (count 0), or paste it twice (count 2).
caseI1() {
  local n l2 la l3
  n="$(grep -c '^### 2b-2a — ' "$IN_CLARIFY" || true)"
  l2="$(grep -n '^### 2b-2 — ' "$IN_CLARIFY" | head -n 1 | cut -d: -f1)"
  la="$(grep -n '^### 2b-2a — ' "$IN_CLARIFY" | head -n 1 | cut -d: -f1)"
  l3="$(grep -n '^### 2b-3 — ' "$IN_CLARIFY" | head -n 1 | cut -d: -f1)"
  if [[ "$n" -eq 1 && -n "$l2" && -n "$la" && -n "$l3" && "$l2" -lt "$la" && "$la" -lt "$l3" ]]; then
    ok "I1 [FR-015] 03-clarify.md has the 2b-2a sub-step exactly once, between 2b-2 (line $l2) and 2b-3 (line $l3)"
  else
    bad "I1 [FR-015] 2b-2a heading count=$n (want 1), lines 2b-2=${l2:-none} 2b-2a=${la:-none} 2b-3=${l3:-none}"
  fi
}
caseI1

# I2 [FR-015] the size rule: reads spec `size:`, M/L runs the studio via the Skill tool, S only on request.
# Red: remove "size: M" or "Skill tool" or the "size S … only on request" wording from the 2b-2a section.
caseI2() {
  local sec miss="" want
  sec="$(in_section '2b-2a' "$IN_CLARIFY")"
  if [[ -z "$sec" ]]; then bad "I2 [FR-015] no 2b-2a section to read the size rule from"; return; fi
  for want in 'size:' 'M or L' 'a1-specforge:a1-ux-studio' 'Skill tool'; do
    grep -qF -- "$want" <<<"$sec" || miss="$miss [$want]"
  done
  grep -Eqi '^\| S \|.*only on request' <<<"$sec" || miss="$miss [S row: only on request]"
  if [[ -z "$miss" ]]; then
    ok "I2 [FR-015] 2b-2a states the size rule (spec size:, M or L, Skill tool, a1-specforge:a1-ux-studio, S only on request)"
  else
    bad "I2 [FR-015] 2b-2a lacks:$miss"
  fi
}
caseI2

# I3 [FR-015] the decision line format is written verbatim, once, inside 2b-2a.
# Red: reword the line in 03-clarify.md (e.g. "Variant <X> picked").
caseI3() {
  local sec n
  sec="$(in_section '2b-2a' "$IN_CLARIFY")"
  n="$(grep -cF -- "$IN_FORMAT" <<<"$sec" || true)"
  if [[ "$n" -eq 1 ]]; then
    ok "I3 [FR-015] 2b-2a carries the line '$IN_FORMAT' exactly once"
  else
    bad "I3 [FR-015] format line occurs $n times in 2b-2a (want 1)"
  fi
}
caseI3

# I4 [FR-015] `Skill` is in a1-new-feature's allowed-tools (frontmatter only, once).
# Red: delete the "  - Skill" line from skills/a1-new-feature/SKILL.md.
caseI4() {
  local fm n
  fm="$(awk 'NR == 1 && $0 == "---" { on = 1; next } on && $0 == "---" { exit } on' "$IN_NF_SKILL")"
  n="$(grep -cx '  - Skill' <<<"$fm" || true)"
  if [[ "$n" -eq 1 ]] && awk '/^allowed-tools:/ { on = 1; next } on && /^[^ ]/ { exit } on' <<<"$fm" | grep -qx '  - Skill'; then
    ok "I4 [FR-015] a1-new-feature SKILL.md frontmatter lists Skill under allowed-tools once"
  else
    bad "I4 [FR-015] '  - Skill' occurs $n times under allowed-tools (want 1)"
  fi
}
caseI4

# I5 [FR-015] step 2b-4 is untouched: exactly one `grep -c "UX/" <spec-path>` line and its requirement line.
# Red: edit that line in 03-clarify.md (e.g. grep -c "UX" or a second occurrence).
caseI5() {
  local sec n m
  sec="$(in_section '2b-4' "$IN_CLARIFY")"
  n="$(grep -cxF 'grep -c "UX/" <spec-path>' <<<"$sec" || true)"
  m="$(grep -cxF 'Must return ≥ 1 per screen identified in 2b-1.' <<<"$sec" || true)"
  if [[ "$n" -eq 1 && "$m" -eq 1 && "$(in_count 'grep -c "UX/"' "$IN_CLARIFY")" -eq 1 ]]; then
    ok "I5 [FR-015] 2b-4 keeps its grep -c \"UX/\" line and requirement line unchanged (one each)"
  else
    bad "I5 [FR-015] 2b-4 grep line count=$n, requirement line count=$m (want 1 and 1)"
  fi
}
caseI5

# I6 [FR-021] Uwe's body routes rendered options through a1-ux-studio via the orchestrator and keeps ASCII as fallback.
# Red: remove the paragraph from agents/a1-uwe-ux-expert.md.
caseI6() {
  local miss="" want
  for want in 'a1-ux-studio' 'orchestrator'; do
    grep -qF -- "$want" "$IN_UWE" || miss="$miss [$want]"
  done
  grep -Eqi 'ASCII wireframes?' "$IN_UWE" || miss="$miss [ASCII wireframes]"
  grep -Eqi 'fallback' "$IN_UWE" || miss="$miss [fallback]"
  if [[ -z "$miss" ]]; then
    ok "I6 [FR-021] Uwe's prompt names a1-ux-studio, the orchestrator and the ASCII-wireframe fallback"
  else
    bad "I6 [FR-021] Uwe's prompt lacks:$miss"
  fi
}
caseI6

# I7 [FR-021] Uwe's `tools:` line is byte-equal to the line on origin/main (no tool, no Agent, added).
# Red: append ", Skill" to the tools: line of agents/a1-uwe-ux-expert.md.
# Without a base ref (shallow CI checkout of the PR merge commit, or a snapshot without .git) the
# line is compared with the pinned main value below — still a real assertion, never a skip.
IN_UWE_PINNED_TOOLS='tools: [Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch]'
caseI7() {
  local ref="" r base cur
  for r in origin/main main HEAD^1; do
    if git -C "$REPO_ROOT" cat-file -e "$r:$IN_UWE_REL" 2>/dev/null; then ref="$r"; break; fi
  done
  if [[ -z "$ref" ]]; then
    cur="$(grep -E '^tools:' "$IN_UWE")"
    if [[ "$(grep -cE '^tools:' "$IN_UWE")" -eq 1 && "$cur" == "$IN_UWE_PINNED_TOOLS" ]]; then
      ok "I7 [FR-021] no base ref (shallow checkout or snapshot): tools: line equals the pinned main line ($cur)"
    else
      bad "I7 [FR-021] no base ref: tools: line [$cur] differs from the pinned main line [$IN_UWE_PINNED_TOOLS]"
    fi
    return
  fi
  base="$(git -C "$REPO_ROOT" show "$ref:$IN_UWE_REL" | grep -E '^tools:')"
  cur="$(grep -E '^tools:' "$IN_UWE")"
  if [[ "$(grep -cE '^tools:' "$IN_UWE")" -eq 1 && -n "$base" && "$base" == "$cur" ]]; then
    ok "I7 [FR-021] Uwe's tools: line is byte-equal to $ref ($cur)"
  else
    bad "I7 [FR-021] tools: line differs from $ref — now [$cur], was [$base]"
  fi
}
caseI7

# I8 [FR-020] every studio phrase has exactly one claimant, a1-ux-studio, across skills/ (repo only).
# Red: drop one phrase from the a1-ux-studio description, or add it to another skill's description.
IN_PHRASES=("UX/UI design" "look and feel" "design variants" "design options" "render design variants" "a1-ux-studio" "UX/UI-Design" "Look & Feel" "Look and Feel" "Design-Varianten" "Designoptionen" "UI-Entwurf rendern")
caseI8() {
  local p fails="" out
  if [[ "${#IN_PHRASES[@]}" -ne 12 ]]; then bad "I8 [FR-020] phrase list has ${#IN_PHRASES[@]} entries, want 12"; return; fi
  for p in "${IN_PHRASES[@]}"; do
    out="$(node "$TOOLS" profile trigger-check --skills-dir "$REPO_ROOT/skills" --phrase "$p" --expect a1-ux-studio 2>&1)" \
      || fails="$fails [$p: $(head -n 1 <<<"$out")]"
  done
  if [[ -z "$fails" ]]; then
    ok "I8 [FR-020] all 12 studio phrases resolve to exactly one claimant, a1-ux-studio (skills/ only)"
  else
    bad "I8 [FR-020] trigger-check failed for:$fails"
  fi
}
caseI8
