# Part 07 — alias skill, hash-pinned installer, trigger-collision check
# (spec 006-specforge-kritis-profile, FR-006, FR-007).
#
# Four guards:
#   A  the alias SKILL.md: <= 40 lines, name: specforge, description quotes
#      only "specforge" and excludes "a1-specforge", body names Modus 8 as
#      not ported plus the three replacements.
#   M  FR-006's grep: 0 occurrences of traceability-matrix content
#      (Traceability Matrix, ExecPlan, tech-debt-tracker) anywhere under
#      _shared/profiles/kritis/ outside the MIGRATION.md disposition row.
#   I  bin/install-specforge-alias.sh: dry run changes nothing, --apply
#      archives + symlinks, a second --apply is a no-op, sha mismatch /
#      hostile symlink / archive-exists all refuse by name. Every case runs
#      with HOME=$WORK/home ONLY — never the real HOME.
#   T  profile-triggers.cjs (profile trigger-check): exit 1 with the old
#      skill present, exit 0 with the alias; usage and hostile-input cases.
#
# RED proof (run for real, quoted in the wave report):
#   mutation 1 — archive to "${dst}.bak" like bin/install.sh's symlink_item
#   (i.e. INSIDE ~/.claude/skills/) turns the "nothing but the symlink under
#   skills/" case red.
#   mutation 2 — match triggers on substring without the "a1-specforge"
#   exclusion turns the substring case red.
# Neither mutation touches the real installer or the real tree; both run
# against throwaway copies inside temp dirs, so this part is self-proving
# without touching production code.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

ALIAS_SRC="$REPO_ROOT/_extras/specforge-alias"
INSTALLER="$REPO_ROOT/bin/install-specforge-alias.sh"
FIXSKILLS="$HERE/fixtures/skills"
REAL_SHA="32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54"

# ---------- A: alias SKILL.md shape ----------
caseAliasShape() {
  local lines name_line desc_block
  lines="$(wc -l <"$ALIAS_SRC/SKILL.md" | tr -d ' ')"
  if [[ "$lines" -le 40 ]]; then
    ok "A alias line count: $lines lines (<= 40)"
  else
    bad "A alias line count: $lines lines, expected <= 40"
  fi

  if grep -qx 'name: specforge' "$ALIAS_SRC/SKILL.md"; then
    ok "A alias frontmatter: name: specforge"
  else
    bad "A alias frontmatter: 'name: specforge' line not found"
  fi

  # The description's ONLY quoted trigger is "specforge", and it explicitly
  # excludes "a1-specforge". Scope the check to the frontmatter block (lines
  # 1 to the second '---'), not the whole file, so body prose mentioning
  # a1-new-feature does not count as a second quoted trigger.
  desc_block="$(awk '/^---$/{c++; next} c==1' "$ALIAS_SRC/SKILL.md")"
  local quoted_count
  quoted_count="$(printf '%s' "$desc_block" | grep -oE '"[^"]*"' | grep -c .)"
  if [[ "$quoted_count" -eq 1 ]] && printf '%s' "$desc_block" | grep -q '"specforge"'; then
    ok "A alias description: exactly one quoted trigger, \"specforge\""
  else
    bad "A alias description: expected exactly one quoted trigger (\"specforge\"), found $quoted_count"
  fi
  if printf '%s' "$desc_block" | grep -qi 'a1-specforge'; then
    ok "A alias description: explicitly excludes \"a1-specforge\""
  else
    bad "A alias description: does not mention excluding \"a1-specforge\""
  fi

  if grep -qi 'Modus 8' "$ALIAS_SRC/SKILL.md" && grep -qi 'not ported' "$ALIAS_SRC/SKILL.md"; then
    ok "A alias body: names Modus 8 as not ported"
  else
    bad "A alias body: does not name Modus 8 as not ported"
  fi
  local replacements=0
  grep -qi 'product status' "$ALIAS_SRC/SKILL.md" && replacements=$((replacements + 1))
  grep -qi 'product markers' "$ALIAS_SRC/SKILL.md" && replacements=$((replacements + 1))
  grep -qi 'N3URAL Brain' "$ALIAS_SRC/SKILL.md" && replacements=$((replacements + 1))
  if [[ "$replacements" -eq 3 ]]; then
    ok "A alias body: names all 3 Modus-8 replacements (product status, product markers, N3URAL Brain)"
  else
    bad "A alias body: names $replacements of 3 Modus-8 replacements, expected 3"
  fi

  if grep -q 'a1-specforge:a1-new-feature' "$ALIAS_SRC/SKILL.md" && grep -q '\-\-profile kritis' "$ALIAS_SRC/SKILL.md"; then
    ok "A alias body: hands off to a1-specforge:a1-new-feature --profile kritis"
  else
    bad "A alias body: does not hand off to a1-specforge:a1-new-feature --profile kritis"
  fi
}
caseAliasShape

# ---------- M: FR-006 grep — 0 traceability-matrix content outside MIGRATION.md ----------
# FR-006 is about PORTED Modus 8 CONTENT, not about the words. Two shapes are
# legitimate and must not count (measured 2026-10-28, Wave 6's golden-principles.md):
#   1. a GP heading whose own migrated name contains the word ("## GP-04: ExecPlan
#      requirement") — the ids and names of Anhang F come from the source and stay
#      unchanged per wave-contract item 10;
#   2. a sentence that DOCUMENTS the non-port ("... are not migrated", "not ported").
# Counting those made the check red for the very sentence proving FR-006 is honoured.
# Measured after Wave 6 landed: zero hits remain even without these three
# exemptions, because Wave 6 renamed GP-04's heading at the source
# ("ExecPlan requirement" -> "Execution-plan requirement"). The exemptions are
# kept anyway: the grep cannot tell Modus 8 jargon from an Anhang F name that
# legitimately carried the same word before migration, so the next migrated
# file hits the same wall. M-neg below is what makes keeping them defensible —
# it proves the guard still fires on real ported content.
# What must still turn it red: actual Modus 8 content — the traceability chain
# (Constitution -> ... -> Work Items), ExecPlan management under plans/active|completed,
# or a tech-debt register. The negative control below proves the check still fires.
caseMigrationGrep() {
  local hits
  hits="$(grep -rn 'Traceability Matrix\|ExecPlan\|tech-debt-tracker' "$REPO_ROOT/_shared/profiles/kritis/" 2>/dev/null \
    | grep -v '^[^:]*MIGRATION\.md:' \
    | grep -viE 'not (migrated|ported)' \
    | grep -viE '^[^:]*:[0-9]+:#+ GP-[0-9]+:' \
    | grep -viE '^[^:]*:[0-9]+:\*\*Enforcement:\*\*' || true)"
  local hit_count
  hit_count="$(printf '%s' "$hits" | grep -c . || true)"
  if [[ "$hit_count" -eq 0 ]]; then
    ok "M FR-006 grep: 0 traceability-matrix hits under _shared/profiles/kritis/ outside MIGRATION.md"
  else
    bad "M FR-006 grep: $hit_count traceability-matrix hit(s) outside MIGRATION.md"
    while IFS= read -r l; do [[ -n "$l" ]] && results+=("      $l"); done <<<"$hits"
  fi
}
caseMigrationGrep

# ---------- M-neg: the FR-006 grep must still fire on real Modus 8 content ----------
# Without this control the exemptions above could silence the check entirely.
caseMigrationGrepControl() {
  local probe="$REPO_ROOT/_shared/profiles/kritis/.fr006-control.md"
  : "${REPO_ROOT:?}"
  printf '%s\n' '**Traceability Matrix**: Constitution -> spec -> ACs -> plan -> Work Items' > "$probe"
  local hits count
  hits="$(grep -rn 'Traceability Matrix\|ExecPlan\|tech-debt-tracker' "$REPO_ROOT/_shared/profiles/kritis/" 2>/dev/null \
    | grep -v '^[^:]*MIGRATION\.md:' \
    | grep -viE 'not (migrated|ported)' \
    | grep -viE '^[^:]*:[0-9]+:#+ GP-[0-9]+:' \
    | grep -viE '^[^:]*:[0-9]+:\*\*Enforcement:\*\*' || true)"
  count="$(printf '%s' "$hits" | grep -c . || true)"
  rm -f "$probe"
  if [[ "$count" -ge 1 ]]; then
    ok "M-neg FR-006 grep still fires on ported Modus 8 content (traceability chain) — the exemptions do not silence it"
  else
    bad "M-neg FR-006 grep no longer fires on ported Modus 8 content — the exemptions are too wide"
  fi
}
caseMigrationGrepControl

# ---------- I: installer ----------
# Every case below seeds ~/.claude/skills/specforge/SKILL.md from the CHECKED-IN
# fixture copy fixtures/skills/old-specforge-full/SKILL.md (byte-identical to
# the real retired skill, sha256 verified at fixture-build time — see
# SOURCES.txt), never from the real host's ~/.claude. HOME is always
# $work/home, a fresh mk_workdir-managed temp dir.
OLD_SKILL_FIXTURE="$FIXSKILLS/old-specforge-full/SKILL.md"

seedOldSkill() {
  # $1 = home dir. Copies the checked-in, sha-pinned fixture into place.
  mkdir -p "$1/.claude/skills/specforge"
  cp "$OLD_SKILL_FIXTURE" "$1/.claude/skills/specforge/SKILL.md"
}

caseInstallerFixtureShaPinned() {
  # Guards the guard: if this fixture ever drifts from the pinned sha, every
  # other I case below would silently test against the wrong bytes. Fail
  # loudly here instead.
  local actual
  actual="$(sha256sum "$OLD_SKILL_FIXTURE" | cut -d' ' -f1)"
  if [[ "$actual" == "$REAL_SHA" ]]; then
    ok "I fixture-sha-pinned: fixtures/skills/old-specforge-full/SKILL.md matches the pinned sha256"
  else
    bad "I fixture-sha-pinned: fixture sha is $actual, expected $REAL_SHA — every other I case below is testing against the wrong bytes"
  fi
}
caseInstallerFixtureShaPinned

caseInstallerDryRunNoop() {
  local work
  mk_workdir work i07-dry
  seedOldSkill "$work/home"
  local before after
  before="$(find "$work/home/.claude/skills" | LC_ALL=C sort)"
  HOME="$work/home" bash "$INSTALLER" >"$work/dry.out" 2>"$work/dry.err"
  local rc=$?
  after="$(find "$work/home/.claude/skills" | LC_ALL=C sort)"
  if [[ "$rc" -eq 0 && "$before" == "$after" ]] && ! grep -qi 'DRY RUN' "$work/dry.err" && grep -qi 'DRY RUN' "$work/dry.out"; then
    ok "I dry-run-noop: no --apply changes nothing under skills/ (exit 0, prints planned moves)"
  else
    bad "I dry-run-noop: dry run changed the tree or did not report planned moves (rc=$rc)"
  fi
}
caseInstallerDryRunNoop

caseInstallerApplyThenNoop() {
  local work
  mk_workdir work i07-apply
  seedOldSkill "$work/home"

  HOME="$work/home" bash "$INSTALLER" --apply >"$work/apply1.out" 2>"$work/apply1.err"
  local rc1=$?
  local extra
  extra="$(find "$work/home/.claude/skills" -mindepth 1 -maxdepth 1 ! -name specforge)"
  local is_symlink=0
  [[ -L "$work/home/.claude/skills/specforge" ]] && is_symlink=1
  local archived
  archived="$(find "$work/home/.claude/skills-archive" -mindepth 1 -maxdepth 1 2>/dev/null | grep -c . || true)"
  if [[ "$rc1" -eq 0 && -z "$extra" && "$is_symlink" -eq 1 && "$archived" -eq 1 ]]; then
    ok "I apply: archives outside skills/ (skills-archive/, 1 entry), symlinks the alias, nothing extra left under skills/"
  else
    bad "I apply: rc=$rc1 extra=[$extra] is_symlink=$is_symlink archived=$archived"
  fi

  local before after
  before="$(find "$work/home/.claude/skills" "$work/home/.claude/skills-archive" | LC_ALL=C sort)"
  HOME="$work/home" bash "$INSTALLER" --apply >"$work/apply2.out" 2>"$work/apply2.err"
  local rc2=$?
  after="$(find "$work/home/.claude/skills" "$work/home/.claude/skills-archive" | LC_ALL=C sort)"
  if [[ "$rc2" -eq 0 && "$before" == "$after" ]] && grep -qi 'no-op' "$work/apply2.out"; then
    ok "I apply-twice: second --apply is a no-op (exit 0, tree unchanged, says no-op)"
  else
    bad "I apply-twice: second --apply changed the tree or did not report a no-op (rc=$rc2)"
  fi
}
caseInstallerApplyThenNoop

caseInstallerShaMismatch() {
  local work
  mk_workdir work i07-sha
  mkdir -p "$work/home/.claude/skills/specforge"
  printf 'not the real skill\n' >"$work/home/.claude/skills/specforge/SKILL.md"
  HOME="$work/home" bash "$INSTALLER" --apply >"$work/out" 2>"$work/err"
  local rc=$?
  if [[ "$rc" -eq 1 ]] && grep -qi 'mismatch' "$work/err" && grep -q "$REAL_SHA" "$work/err" \
     && grep -q "$(sha256sum "$work/home/.claude/skills/specforge/SKILL.md" | cut -d' ' -f1)" "$work/err"; then
    ok "I sha-mismatch: refuses (exit 1), prints both expected and actual sha256"
  else
    bad "I sha-mismatch: rc=$rc, expected exit 1 naming both sha values"
  fi
}
caseInstallerShaMismatch

caseInstallerHostileSymlink() {
  local work
  mk_workdir work i07-symlink
  mkdir -p "$work/home/.claude/skills" "$work/elsewhere"
  ln -s "$work/elsewhere" "$work/home/.claude/skills/specforge"
  HOME="$work/home" bash "$INSTALLER" --apply >"$work/out" 2>"$work/err"
  local rc=$?
  if [[ "$rc" -eq 1 ]] && grep -qi 'symlink to something other than the alias' "$work/err"; then
    ok "I hostile-symlink: a symlink to something other than the alias refuses, exit 1, named"
  else
    bad "I hostile-symlink: rc=$rc, expected exit 1 naming the symlink mismatch"
  fi
}
caseInstallerHostileSymlink

caseInstallerArchiveExists() {
  local work today
  mk_workdir work i07-archexists
  seedOldSkill "$work/home"
  today="$(date -u +%Y-%m-%d)"
  mkdir -p "$work/home/.claude/skills-archive/specforge-$today"
  HOME="$work/home" bash "$INSTALLER" --apply >"$work/out" 2>"$work/err"
  local rc=$?
  if [[ "$rc" -eq 1 ]] && grep -qi 'archive target already exists' "$work/err"; then
    ok "I archive-exists: refuses when the archive target already exists, exit 1, named"
  else
    bad "I archive-exists: rc=$rc, expected exit 1 naming the existing archive target"
  fi
}
caseInstallerArchiveExists

# ---------- I-mut: RED proof 1 — archive INSIDE skills/ like install.sh's .bak ----------
caseInstallerMutationBakInsideSkills() {
  local work
  mk_workdir work i07-mut1
  mkdir -p "$work/mutrepo/bin"
  ln -s "$REPO_ROOT/_extras" "$work/mutrepo/_extras"
  cp "$INSTALLER" "$work/mutrepo/bin/install-specforge-alias.sh"
  if ! grep -qF 'ARCHIVE_DIR="$HOME/.claude/skills-archive"' "$work/mutrepo/bin/install-specforge-alias.sh"; then
    bad "I-mut bak-inside-skills: anchor line not found in installer (mutation cannot be applied — report, do not skip)"
    return
  fi
  # The mutation also removes the archive-inside-skills guard (S8), or the
  # guard would refuse the mutated path and mask the original red proof.
  sed -i.bak -e 's#ARCHIVE_DIR="\$HOME/\.claude/skills-archive"#ARCHIVE_DIR="$HOME/.claude/skills"#' \
    -e '/^# BEGIN archive-inside-skills guard$/,/^# END archive-inside-skills guard$/d' \
    "$work/mutrepo/bin/install-specforge-alias.sh" && rm -f "$work/mutrepo/bin/install-specforge-alias.sh.bak"
  seedOldSkill "$work/home"
  HOME="$work/home" bash "$work/mutrepo/bin/install-specforge-alias.sh" --apply >"$work/out" 2>"$work/err"
  local extra
  extra="$(find "$work/home/.claude/skills" -mindepth 1 -maxdepth 1 ! -name specforge)"
  if [[ -n "$extra" ]]; then
    ok "I-mut bak-inside-skills: archiving into \${dst}.bak-shaped path INSIDE skills/ turns the 'nothing but the symlink' guard red, as required (leftover: $extra)"
  else
    bad "I-mut bak-inside-skills: the mutation did NOT leave anything extra under skills/ — the guard proves nothing"
  fi
}
caseInstallerMutationBakInsideSkills

# ---------- T: profile trigger-check ----------
buildSkillsDir() {
  # $1 = target dir. Builds a --skills-dir tree from the checked-in fixture
  # copies (never hand-authored at run time): old-specforge/ (frontmatter
  # only, from the real retired skill) OR specforge-alias-copy/ (the alias),
  # plus a1-new-feature.
  #
  # The a1-new-feature entry reuses Wave 1's golden full-file copy WITH the
  # one documented Wave-8 allowance applied (golden/prompts.allowed-diff):
  # today's working tree (and this golden copy) does not yet carry the
  # German alias "erstelle eine Spezifikation" — part 01's own
  # casePAllowedSimulated proves that insertion point and exact wording are
  # the only change Wave 8 is allowed to make. Simulating it here, the same
  # way, is how this part exercises the real-world collision the AC names
  # (today the phrase has no claimant at all; post-W8 wiring it must be
  # a1-new-feature's alone) without waiting for Wave 8 to land.
  mkdir -p "$1/a1-new-feature"
  sed '/  <projekt>"), "spec for <project>" (alias: "spec für <projekt>"), "feature pipeline",/a\
  "a1-new-feature", "erstelle eine Spezifikation" (German alias for "spec for <project>"),' \
    "$HERE/golden/prompts/SKILL.md" >"$1/a1-new-feature/SKILL.md"
}

caseTriggerOldSkillPresent() {
  local work
  mk_workdir work i07-trig-old
  buildSkillsDir "$work/skills"
  mkdir -p "$work/skills/specforge"
  cp "$FIXSKILLS/old-specforge/SKILL.md" "$work/skills/specforge/SKILL.md"
  node "$REPO_ROOT/_shared/a1-tools.cjs" profile trigger-check \
    --skills-dir "$work/skills" --phrase "erstelle eine Spezifikation" --expect a1-new-feature \
    >"$work/out" 2>"$work/err"
  local rc=$?
  if [[ "$rc" -eq 1 ]] && grep -q 'specforge' "$work/out"; then
    ok "T old-skill-present: exit 1, names specforge as the (wrong) claimant"
  else
    bad "T old-skill-present: rc=$rc (expected 1), out: $(cat "$work/out")"
  fi
}
caseTriggerOldSkillPresent

caseTriggerAliasPresent() {
  local work
  mk_workdir work i07-trig-alias
  buildSkillsDir "$work/skills"
  mkdir -p "$work/skills/specforge"
  cp "$FIXSKILLS/specforge-alias-copy/SKILL.md" "$work/skills/specforge/SKILL.md"
  node "$REPO_ROOT/_shared/a1-tools.cjs" profile trigger-check \
    --skills-dir "$work/skills" --phrase "erstelle eine Spezifikation" --expect a1-new-feature \
    >"$work/out" 2>"$work/err"
  local rc=$?
  if [[ "$rc" -eq 0 ]]; then
    ok "T alias-present: exit 0 once the alias replaces the old skill"
  else
    bad "T alias-present: rc=$rc (expected 0), out: $(cat "$work/out") err: $(cat "$work/err")"
  fi
}
caseTriggerAliasPresent

caseTriggerSpecforgePhraseAlias() {
  # The bare "specforge" phrase: with the alias installed, it is claimed by
  # the alias (name: specforge) alone — FR-007's own trigger reduction.
  local work
  mk_workdir work i07-trig-bare
  buildSkillsDir "$work/skills"
  mkdir -p "$work/skills/specforge"
  cp "$FIXSKILLS/specforge-alias-copy/SKILL.md" "$work/skills/specforge/SKILL.md"
  node "$REPO_ROOT/_shared/a1-tools.cjs" profile trigger-check \
    --skills-dir "$work/skills" --phrase "specforge" --expect specforge \
    >"$work/out" 2>"$work/err"
  local rc=$?
  if [[ "$rc" -eq 0 ]]; then
    ok "T bare-specforge-alias: exit 0, alias alone claims \"specforge\""
  else
    bad "T bare-specforge-alias: rc=$rc (expected 0), out: $(cat "$work/out")"
  fi
}
caseTriggerSpecforgePhraseAlias

caseTriggerUsageErrors() {
  local work
  mk_workdir work i07-trig-usage
  node "$REPO_ROOT/_shared/a1-tools.cjs" profile trigger-check --phrase x --expect y >"$work/o1" 2>"$work/e1"
  local rc1=$?
  node "$REPO_ROOT/_shared/a1-tools.cjs" profile trigger-check --skills-dir "$work" --expect y >"$work/o2" 2>"$work/e2"
  local rc2=$?
  node "$REPO_ROOT/_shared/a1-tools.cjs" profile trigger-check --skills-dir "$work" --phrase x >"$work/o3" 2>"$work/e3"
  local rc3=$?
  if [[ "$rc1" -eq 1 && "$rc2" -eq 1 && "$rc3" -eq 1 ]]; then
    ok "T usage: missing --skills-dir / --phrase / --expect each exit 1"
  else
    bad "T usage: rc1=$rc1 rc2=$rc2 rc3=$rc3 (expected all 1)"
  fi
}
caseTriggerUsageErrors

caseTriggerHostileSkillsDir() {
  local work
  mk_workdir work i07-trig-hostile
  node "$REPO_ROOT/_shared/a1-tools.cjs" profile trigger-check \
    --skills-dir "$work/does-not-exist" --phrase x --expect y >"$work/out" 2>"$work/err"
  local rc1=$?
  # Oversized SKILL.md (> 256 KiB) under a real skill dir.
  mkdir -p "$work/skills/huge"
  { head -c 300000 /dev/zero | tr '\0' 'x'; } >"$work/skills/huge/SKILL.md"
  node "$REPO_ROOT/_shared/a1-tools.cjs" profile trigger-check \
    --skills-dir "$work/skills" --phrase x --expect y >"$work/out2" 2>"$work/err2"
  local rc2=$?
  if [[ "$rc1" -eq 2 && "$rc2" -eq 2 ]]; then
    ok "T hostile: nonexistent --skills-dir and an oversized SKILL.md (> 256 KiB) both exit 2"
  else
    bad "T hostile: rc1=$rc1 (expected 2, nonexistent dir) rc2=$rc2 (expected 2, oversized file)"
  fi
}
caseTriggerHostileSkillsDir

# ---------- T-mut: RED proof 2 — substring match without the exclusion ----------
caseTriggerMutationSubstring() {
  # The production module's measureCollisions is NOT mutated directly (that
  # would edit shipped code); instead this proves the SAME scenario with a
  # NAIVE matcher (substring only, no "a1-specforge" exclusion) would
  # wrongly claim the bare "specforge" phrase for a skill whose description
  # only contains it as part of "a1-specforge" — demonstrating why the
  # exclusion in profile-triggers.cjs is load-bearing, not decorative.
  local naive_claims
  naive_claims="$(node -e '
    const desc = "trigger when user says: update a1-specforge, erstelle eine Spezifikation";
    const norm = (s) => s.toLowerCase().trim().replace(/\s+/g, " ");
    const phrase = norm("specforge");
    console.log(norm(desc).includes(phrase) ? "claims" : "no-claim");
  ')"
  local real_claims
  real_claims="$(node -e '
    const { measureCollisions } = require(process.argv[1]);
    const skills = [{ skill: "a1-new-feature", description: "trigger when user says: update a1-specforge, erstelle eine Spezifikation" }];
    const r = measureCollisions(skills, ["specforge"]);
    console.log(r[0].claimants.length === 0 ? "no-claim" : "claims");
  ' "$REPO_ROOT/_shared/lib/profile-triggers.cjs")"
  if [[ "$naive_claims" == "claims" && "$real_claims" == "no-claim" ]]; then
    ok "T-mut substring: a naive substring match (no a1-specforge exclusion) WOULD wrongly claim \"specforge\" via \"a1-specforge\" — the real check correctly does not, proving the exclusion is load-bearing"
  else
    bad "T-mut substring: naive=$naive_claims real=$real_claims (expected naive=claims, real=no-claim)"
  fi
}
caseTriggerMutationSubstring

# ---------- I (review S8): a skills-archive that leads back into skills/ is refused ----------
caseInstallerArchiveSymlinkIntoSkills() {
  local work rc inside
  mk_workdir work i07-archsym
  seedOldSkill "$work/home"
  ln -s "$work/home/.claude/skills" "$work/home/.claude/skills-archive"
  HOME="$work/home" bash "$INSTALLER" --apply --expect-sha "$REAL_SHA" >"$work/out" 2>"$work/err"
  rc=$?
  inside="$(find "$work/home/.claude/skills" -mindepth 1 -maxdepth 1 ! -name specforge | grep -c .)"
  if [[ "$rc" -eq 1 && "$inside" == "0" ]] && grep -qi 'archive dir.*symlink' "$work/err" && [[ -d "$work/home/.claude/skills/specforge" && ! -L "$work/home/.claude/skills/specforge" ]]; then
    ok "I archive-symlink: skills-archive -> skills is refused, exit 1, named, nothing moved"
  else
    bad "I archive-symlink: rc=$rc inside=$inside err=[$(cat "$work/err")]"
  fi
}
caseInstallerArchiveSymlinkIntoSkills

caseInstallerExpectShaNoValue() {
  local work rc
  mk_workdir work i07-shanoval
  seedOldSkill "$work/home"
  HOME="$work/home" bash "$INSTALLER" --apply --expect-sha >"$work/out" 2>"$work/err"
  rc=$?
  if [[ "$rc" -eq 1 ]] && grep -q -- '--expect-sha needs a sha256 value' "$work/err" && [[ -d "$work/home/.claude/skills/specforge" && ! -L "$work/home/.claude/skills/specforge" ]]; then
    ok "I expect-sha: --expect-sha without a value is a named usage error, exit 1, nothing changed"
  else
    bad "I expect-sha: rc=$rc err=[$(cat "$work/err")]"
  fi
  HOME="$work/home" bash "$INSTALLER" --expect-sha --apply >"$work/out" 2>"$work/err"
  rc=$?
  if [[ "$rc" -eq 1 ]] && grep -q -- '--expect-sha needs a sha256 value' "$work/err"; then
    ok "I expect-sha: a following flag is not taken as the value"
  else
    bad "I expect-sha: '--expect-sha --apply' rc=$rc err=[$(cat "$work/err")]"
  fi
}
caseInstallerExpectShaNoValue
