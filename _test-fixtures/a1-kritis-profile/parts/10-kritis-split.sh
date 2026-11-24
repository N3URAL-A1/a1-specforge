# Part 10 — the kritis block, the Marketing Gate and the Isolation body leave a1-new-feature/SKILL.md
# (spec 027 slice 5, FR-029/FR-030).
#
#   K5  workflows/kritis.md: line 1 is the conditional header, exactly one balanced a1-profile:kritis block
#       whose first line is the guard, lines 2-40 equal the pre-move SKILL.md text (written out literally)
#   K6  SKILL.md: 0 kritis markers, 0 `## Marketing Gate` lines, exactly 1 line naming a1-landing-feature
#   K7  SKILL.md Isolation section body: exactly 3 non-blank lines naming the three targets
#
# RED proof: one byte changed in kritis.md line 20 -> K5; the Marketing heading back -> K6; a fourth
# Isolation line -> K7 (logged in STATUS-cuts.md).

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

K_KRITIS_EXPECTED="$(cat <<'A1_K5_EOF'
<!-- a1-profile:kritis -->
**KRITIS profile only** — skip this block unless the run profile is `kritis`.

## Profile Gate (optional `kritis` profile, spec 006-specforge-kritis-profile)

**Arguments.** `--profile <name>` selects a profile for this run (the only known value is
`kritis`). `--simulate <csv>` lists stakeholder role ids (1-5, from
`_shared/profiles/kritis/stakeholder-roles.md`) for the optional simulation in Phase 3 Step 2c.
Both are ignored when the run profile is not `kritis`.

**Resolve (after the Roadmap Gate, before Phase 1).** The resolve step is the unguarded
"Profile resolve" line above this block: it runs on every run, with or without `--profile`, so a
profile declared in `docs/product/index.json` or the constitution is found (FR-001). The
precedence is fail-closed: flag, then spec frontmatter, then `docs/product/index.json`, then the
constitution marker.

Exit 0 prints `{profile, source, isolation, ...}`; `profile: null` means no profile and this
whole section is skipped. Exit 1 or 2 stops the run and shows the message. Phases 2 to 6 started
in a new session pass `--spec <path>` and re-resolve from the spec frontmatter.

**Under `kritis`:**

1. Announce it in one line: "KRITIS profile active (source: <source>): EARS requirements, NFR
   injection, STRIDE threat model at Gate C, blank-slate run."
2. Right after `spec init` (Phase 1 Step 2), persist the decision so later sessions re-resolve:

   ```bash
   node <repo>/_shared/a1-tools.cjs profile set --spec <spec-path> kritis
   ```

3. **Blank slate.** During the run do not read `.claude/agent-memory/`, the learning store
   (`pattern/a1-learnings/`, `.a1/learnings/`) or any `_learning.md` file, and append the
   blank-slate clause to every brief you give a sub-agent.
4. **Honest limit.** A skill cannot unload context the harness injected before it ran: the
   project `CLAUDE.md` and the auto-memory index are already in the session. This skill does
   not enforce a clean session and does not claim to. Tell the user to start KRITIS runs in a
   fresh session with auto-memory switched off, and say so in the announcement if the session
   is not fresh.
<!-- /a1-profile:kritis -->
A1_K5_EOF
)"

caseKritisSplit() {
  local f="${K_KRITIS_FILE:-$REPO_ROOT/skills/a1-new-feature/workflows/kritis.md}" first got opens closes
  first="$(sed -n 1p "$f")"
  got="$(sed -n '2,40p' "$f")"
  opens="$(grep -cxF '<!-- a1-profile:kritis -->' "$f")"; closes="$(grep -cxF '<!-- /a1-profile:kritis -->' "$f")"
  if [[ "$first" == '<!-- load: conditional trigger=profile resolve -->' && "$opens" == 1 && "$closes" == 1 \
        && "$(sed -n 3p "$f")" == '**KRITIS profile only** — skip this block unless the run profile is `kritis`.' \
        && "$got" == "$K_KRITIS_EXPECTED" ]]; then
    ok "K5 kritis.md: conditional header, one balanced block with the guard first, lines 2-40 equal the pre-move text"
  else
    bad "K5 kritis.md: header/block/text mismatch (first=[$first] opens=$opens closes=$closes)"
  fi
}
caseKritisSplit

caseSkillCuts() {
  local f="${K_SKILL_FILE:-$REPO_ROOT/skills/a1-new-feature/SKILL.md}" marks mk lp body n names
  marks="$(grep -c 'a1-profile:kritis -->' "$f")"; mk="$(grep -c '^## Marketing Gate' "$f")"; lp="$(grep -c 'a1-landing-feature' "$f")"
  if [[ "$marks" == 0 && "$mk" == 0 && "$lp" == 1 ]]; then
    ok "K6 SKILL.md: 0 kritis block markers, 0 Marketing Gate headings, 1 a1-landing-feature line"
  else
    bad "K6 SKILL.md: kritis-markers=$marks marketing-headings=$mk landing-lines=$lp"
  fi
  body="$(awk '/^## Isolation Gate/{s=1;next} s&&/^## /{exit} s&&NF{print}' "$f")"
  n="$(printf '%s\n' "$body" | grep -c .)"
  names=0
  case "$body" in *'`a1-worktree`'*) names=$((names + 1));; esac
  case "$body" in *'`a1-pr-review`'*) names=$((names + 1));; esac
  case "$body" in *'`_shared/parallel-spec-isolation.md`'*) names=$((names + 1));; esac
  if [[ "$n" == 3 && "$names" == 3 ]]; then ok "K7 Isolation body: 3 non-blank lines naming a1-worktree, a1-pr-review and parallel-spec-isolation"
  else bad "K7 Isolation body: $n non-blank lines, $names of 3 targets named"; fi
}
caseSkillCuts
