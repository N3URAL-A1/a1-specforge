# Part 01 — skill skeleton (spec 024-ux-studio, FR-001, FR-019).
#
# Guards on skills/a1-ux-studio/SKILL.md. Each case header names the production
# change that turns it red (contract item 4).

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

SK_DIR="$REPO_ROOT/skills/a1-ux-studio"
SK_MD="$SK_DIR/SKILL.md"

# Frontmatter = lines between the first two `---` lines.
sk_front() { awk 'NR==1 && $0!="---"{exit} /^---[[:space:]]*$/{n++; if(n==2)exit; next} n==1{print}' "$SK_MD"; }

if [[ ! -f "$SK_MD" ]]; then
  bad "S0 SKILL.md exists (missing: $SK_MD)"
else
  ok "S0 SKILL.md exists"
  FRONT="$(sk_front)"

  # RED: delete the `description:` or `allowed-tools:` key from the frontmatter.
  keys="$(printf '%s\n' "$FRONT" | grep -E '^(name|description|allowed-tools):' | sed 's/:.*//' | sort -u)"
  nkeys="$(printf '%s\n' "$keys" | grep -c .)"
  if [[ "$nkeys" -eq 3 ]]; then
    ok "S1 frontmatter keys name/description/allowed-tools present (count 3)"
  else
    bad "S1 frontmatter keys (count $nkeys, want 3: $(printf '%s' "$keys" | tr '\n' ' '))"
  fi

  # RED: rename `name: a1-ux-studio` to any other value.
  nm="$(printf '%s\n' "$FRONT" | sed -n 's/^name:[[:space:]]*//p' | head -n 1 | tr -d '\r')"
  if [[ "$nm" == "a1-ux-studio" ]]; then ok "S2 name == a1-ux-studio"; else bad "S2 name is '$nm'"; fi

  # RED: add `- Agent` (or `Agent` in the inline list) to allowed-tools (decision 3).
  tools="$(printf '%s\n' "$FRONT" | awk '/^allowed-tools:/{f=1; print; next} f&&/^[[:space:]]*-/{print; next} f{exit}')"
  ntools="$(printf '%s\n' "$tools" | grep -c .)"
  if [[ "$ntools" -ge 1 ]] && ! printf '%s\n' "$tools" | grep -Eq '(^|[^A-Za-z])Agent([^A-Za-z]|$)'; then
    ok "S3 allowed-tools has no Agent (block lines: $ntools)"
  else
    bad "S3 allowed-tools contains Agent or is empty: $(printf '%s' "$tools" | tr '\n' ' ')"
  fi

  # RED: remove the sentence "No _learning.md" from SKILL.md.
  if grep -Eq '[Nn]o `?_learning\.md`?' "$SK_MD"; then
    ok "S4 SKILL.md carries the no-_learning.md note (decision 3)"
  else
    bad "S4 SKILL.md lacks the no-_learning.md note"
  fi
fi

# RED: delete the workflows/ or templates/ folder.
for d in workflows templates; do
  if [[ -d "$SK_DIR/$d" ]]; then ok "S5 $d/ exists"; else bad "S5 $d/ missing"; fi
done

# RED: delete or rename any one of the ten workflow files.
WF_NAMES=(01-brief 02-diverge 03-converge 04-assets 05-gate 06-handoff 07-taste-vault 08-tweaks 09-remix 10-motion)
present=0
for w in "${WF_NAMES[@]}"; do
  if [[ -f "$SK_DIR/workflows/$w.md" ]]; then present=$((present + 1)); else bad "S6 workflows/$w.md missing"; fi
done
if [[ "$present" -eq "${#WF_NAMES[@]}" && "${#WF_NAMES[@]}" -eq 10 ]]; then
  ok "S6 all ten workflow files exist (count $present)"
fi
