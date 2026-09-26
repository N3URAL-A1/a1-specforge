#!/usr/bin/env bash
# Part 06a — Wave 6 agent A, section L: `vault lint` (_shared/lib/vault-lint.cjs,
# FR-018/FR-019/FR-014, SC-004). Sourced by run-tests.sh (never run on its
# own). Every case names the single production change that turns it red.
#
# Every vault here is a mktemp -d directory with A1_VAULT_ROOT and HOME
# redirected — NEVER the real vault. File shapes are modelled on measured
# vault files (2026-09-24): a spec without `type:`, `status: ux-draft`,
# `status: "GELB — …"`, a plain `title:` folded onto an indented line
# (n3ural-contentbot/spec/002), a `-VERIFICATION.md` companion, a
# `(conflicted copy …)` copy. Class names and counts are literals typed from
# the spec, not read from the module.
#
# RED record (2026-09-26, section L with the `lint` router line removed, i.e.
# before the command existed): 32 of 42 assertions red. Green by
# construction: the pure "nothing changed" halves (L1 read-only, L5, L6
# bytes, L9b) and the exit-2 cases of L8 (an unknown subcommand already
# exits non-zero) — each is the negative half of a red positive assertion.
# Mutation record: 23 single-line mutations of vault-lint.cjs (one per class
# detection, per guard, per byte rule) each turned at least one L assert red.

L_WORK="$(mktemp -d)"
mkdir -p "$L_WORK/home"

# lint_run <vault> <args…> — sets L_OUT (stdout), L_RC, stderr in $L_WORK/stderr.
lint_run() {
  local vault="$1"; shift
  L_OUT="$(A1_VAULT_ROOT="$vault" HOME="$L_WORK/home" node "$TOOLS" vault lint "$@" 2>"$L_WORK/stderr")"
  L_RC=$?
}

# make_sc004_vault <dir> — SC-004: one file per finding class (8), one valid
# file per artifact type, one companion, one non-a1 folder (kpi/).
make_sc004_vault() {
  local p="$1/project/demo"
  mkdir -p "$p/spec" "$p/plans" "$p/fixes" "$p/postmortems" "$p/analyses" "$p/quick" "$p/kpi"
  # valid, one per artifact type (wave-plan/postmortem without status:, quick-run on result:)
  printf -- '---\ntype: spec\nid: 001-valid\nstatus: draft\n---\n# Valid\n' > "$p/spec/001-valid.md"
  printf -- '---\ntype: wave-plan\nproject: demo\nspec: 001-valid\n---\n# Plan\n' > "$p/plans/001-valid-wave-plan.md"
  printf -- '---\ntype: bug-report\nstatus: fixed\nseverity: minor\n---\n# Bug\n' > "$p/fixes/2026-01-01-crash.md"
  printf -- '---\ntype: postmortem\nproject: demo\n---\n# PM\n' > "$p/postmortems/2026-01-01-crash.md"
  printf -- '---\ntype: project-analysis\nstatus: reported\nfocus: general\n---\n# A\n' > "$p/analyses/2026-01-01-general.md"
  printf -- '---\ntype: quick-run\nresult: completed\n---\n# Q\n' > "$p/quick/2026-01-01-tiny.md"
  # companion: no type:, never a finding, counted
  printf -- '---\nphase: 001-valid\nverdict: PASS\n---\n# Verification\n' > "$p/plans/001-valid-VERIFICATION.md"
  # non-a1 folder: its broken file is never reported
  printf 'no frontmatter at all\n' > "$p/kpi/weekly.md"
  # the eight findings, one class each
  printf -- '---\nid: 002-no-type\nproject: demo\ntitle: "Search: index"\nstatus: clarified\ntags: [a, "b, c"]\n---\n\n# Body stays\n' > "$p/spec/002-no-type.md"
  printf -- '---\ntype: research\nstatus: draft\n---\n# R\n' > "$p/spec/003-unknown.md"
  printf -- '---\ntype: wave-plan\nstatus: draft\n---\n# M\n' > "$p/spec/004-mismatch.md"
  printf -- '---\ntype: spec\ntitle: No status\n---\n# S\n' > "$p/spec/005-no-status.md"
  printf -- '---\ntype: spec\nstatus: ux-draft\n---\n# U\n' > "$p/spec/006-ux-draft.md"
  printf -- '---\ntype: spec\nstatus: draft\ntitle: Gemma-generated conversational reply for the other/smalltalk and confident-question\n  intake branches\n---\n# F\n' > "$p/spec/007-folded.md"
  printf -- '---\ntype: spec\nstatus: draft\n# closing fence lost\n' > "$p/spec/008-broken.md"
  printf -- '---\ntype: spec\nstatus: draft\n---\n# Valid\n' > "$p/spec/001-valid (conflicted copy 2026-09-25).md"
}

L_V1="$L_WORK/v1"; make_sc004_vault "$L_V1"
L_P1="$L_V1/project/demo"
cp -R "$L_V1" "$L_WORK/v1.orig"
lint_run "$L_V1" demo --json
L1_OUT="$L_OUT"; L1_RC=$L_RC

# ---------- L1 eight classes (SC-004 first half) ----------
# Red-making change: removing any one class detection → its own count assert
# (and the total) fails. Folded: a lint that ignores continuation lines
# (foldedKeys() returning []) turns L1-frontmatter_folded red.
caseL1() {
  assert_rc "L1 lint with findings exits 1" 1 "$L1_RC" "$(head -c 300 "$L_WORK/stderr")"
  assert_json "L1 total findings = 8" "$L1_OUT" "j.findings.length" "8"
  local c
  for c in frontmatter_unparseable type_missing type_unknown type_folder_mismatch \
           status_missing status_invalid frontmatter_folded conflict; do
    assert_json "L1 counts.$c = 1" "$L1_OUT" "j.counts['$c']" "1"
  done
  assert_json "L1 each class names its file" "$L1_OUT" \
    "j.findings.map(f => f.class + '=' + f.path.replace('project/demo/', '')).sort().join(' ')" \
    "conflict=spec/001-valid (conflicted copy 2026-09-25).md frontmatter_folded=spec/007-folded.md frontmatter_unparseable=spec/008-broken.md status_invalid=spec/006-ux-draft.md status_missing=spec/005-no-status.md type_folder_mismatch=spec/004-mismatch.md type_missing=spec/002-no-type.md type_unknown=spec/003-unknown.md"
  assert_json "L1 frontmatter_folded names the key title" "$L1_OUT" \
    "j.findings.filter(f => f.class === 'frontmatter_folded').map(f => f.key).join(',')" "title"
  assert_json "L1 ignored = 1 (kpi/)" "$L1_OUT" "j.ignored" "1"
  # Red-making change: type-checking companions (plans/ expects wave-plan).
  assert_json "L1 VERIFICATION companion: no finding, companions = 1" "$L1_OUT" \
    "[j.findings.filter(f => /VERIFICATION/.test(f.path)).length, j.companions].join(',')" "0,1"
  assert_json "L1 kpi/ never reported" "$L1_OUT" "j.findings.filter(f => f.path.includes('/kpi/')).length" "0"
  # A read-only run writes nothing.
  if diff -r "$L_V1" "$L_WORK/v1.orig" >/dev/null; then ok "L1 lint without --fix-type leaves the vault byte-identical"
  else bad "L1 lint without --fix-type changed the vault"; fi
}

# ---------- L2 no-status types ----------
# Red-making change: checking status: for every type (adding wave-plan or
# postmortem to STATUS_RULES).
caseL2() {
  assert_json "L2 valid plans/ and postmortems/ without status: → 0 findings" "$L1_OUT" \
    "j.findings.filter(f => /\/(plans|postmortems)\//.test(f.path)).length" "0"
}

# ---------- L3 quick-run judged on result:, GELB status ----------
# Red-making change: reading `status:` instead of `result:` for quick-run
# (the completed file then reports status_missing).
caseL3() {
  local v="$L_WORK/v3" p="$L_WORK/v3/project/q3"
  mkdir -p "$p/quick" "$p/fixes"
  printf -- '---\ntype: quick-run\nresult: completed\n---\n' > "$p/quick/a-completed.md"
  printf -- '---\ntype: quick-run\nresult: bogus\n---\n' > "$p/quick/b-bogus.md"
  printf -- '---\ntype: bug-report\nstatus: "GELB — Review offen"\n---\n' > "$p/fixes/c-gelb.md"
  lint_run "$v" q3 --json
  assert_rc "L3 lint q3 exits 1" 1 "$L_RC"
  assert_json "L3 findings: bogus result and GELB status are status_invalid, completed is clean" "$L_OUT" \
    "j.findings.map(f => f.class + ':' + f.key + '@' + f.path.split('/').pop()).sort().join(' ')" \
    "status_invalid:result@b-bogus.md status_invalid:status@c-gelb.md"
}

# ---------- L4 fix-type bytes (FR-019) ----------
# Red-making change: rewriting through serializeFrontmatter / writeMdAtomic
# (requotes `title: "Search: index"`, rewrites the inline array, drops the
# blank line after the fence).
L_V4="$L_WORK/v4"
cp -R "$L_WORK/v1.orig" "$L_V4"
lint_run "$L_V4" demo --json --fix-type
L4_OUT="$L_OUT"; L4_RC=$L_RC; cp "$L_WORK/stderr" "$L_WORK/stderr.l4"
caseL4() {
  local expected="$L_WORK/l4.expected"
  { printf -- '---\ntype: spec\n'; tail -n +2 "$L_WORK/v1.orig/project/demo/spec/002-no-type.md"; } > "$expected"
  if cmp -s "$L_V4/project/demo/spec/002-no-type.md" "$expected"; then ok "L4 fixed file = '---\\ntype: spec\\n' + original minus line 1"
  else bad "L4 fixed file bytes differ from the string insertion"; fi
  assert_json "L4 fixed lists exactly the type_missing file" "$L4_OUT" "j.fixed.join(',')" "project/demo/spec/002-no-type.md"
  assert_eq "L4 rewritten path printed (stderr under --json)" \
    "$(grep -c 'project/demo/spec/002-no-type.md' "$L_WORK/stderr.l4")" "1"
}

# ---------- L5 fix-type scope; second run reports seven (SC-004) ----------
# Red-making change: fixing files that carry another finding too (dropping
# the `own.length !== 1` guard) — 003/004 lose nothing but 007-style files
# with type_missing + folded would be stamped (L5b), and the second run count
# changes.
caseL5() {
  local f same=1
  for f in 001-valid 003-unknown 004-mismatch 005-no-status 006-ux-draft 007-folded 008-broken \
           "001-valid (conflicted copy 2026-09-25)"; do
    cmp -s "$L_V4/project/demo/spec/$f.md" "$L_WORK/v1.orig/project/demo/spec/$f.md" || same=0
  done
  cmp -s "$L_V4/project/demo/plans/001-valid-VERIFICATION.md" "$L_WORK/v1.orig/project/demo/plans/001-valid-VERIFICATION.md" || same=0
  assert_eq "L5 every other file (incl. folded, companion, conflict copy) byte-identical after --fix-type" "$same" "1"
  lint_run "$L_V4" demo --json
  assert_json "L5 second run reports seven, type_missing gone" "$L_OUT" \
    "[j.findings.length, j.counts.type_missing === undefined].join(',')" "7,true"
  assert_rc "L5 second run still exits 1" 1 "$L_RC"
}

# ---------- L5b folded + type_missing on one file: never touched ----------
# Red-making change: dropping the "type_missing is the ONLY finding" guard.
# ---------- L5c no frontmatter block · L5d CRLF ----------
# Red-making change (L5c): inserting `type:` after line 1 of a file without a
# frontmatter block (would eat the heading). (L5d): hardcoding '\n' after the
# opening fence of a CRLF file.
caseL5bcd() {
  local v="$L_WORK/v5" p="$L_WORK/v5/project/fx"
  mkdir -p "$p/spec" "$p/plans"
  printf -- '---\nstatus: draft\ntitle: "A long quoted title folded by the foreign writer at\n  eighty columns"\n---\n# B\n' > "$p/spec/001-folded-no-type.md"
  printf '# Plan without frontmatter\n\nbody\n' > "$p/plans/raw.md"
  printf -- '---\r\nstatus: draft\r\ntitle: CRLF spec\r\n---\r\n# C\r\n' > "$p/spec/002-crlf.md"
  cp -R "$v" "$L_WORK/v5.orig"
  lint_run "$v" fx --json --fix-type
  if cmp -s "$p/spec/001-folded-no-type.md" "$L_WORK/v5.orig/project/fx/spec/001-folded-no-type.md"; then
    ok "L5b folded file without type: untouched by --fix-type"
  else bad "L5b --fix-type rewrote a frontmatter_folded file"; fi
  assert_json "L5b folded file still reported as type_missing + frontmatter_folded" "$L_OUT" \
    "j.findings.filter(f => f.path.endsWith('001-folded-no-type.md')).map(f => f.class).sort().join(',')" \
    "frontmatter_folded,type_missing"
  local want="$L_WORK/l5c.expected"
  { printf -- '---\ntype: wave-plan\n---\n'; cat "$L_WORK/v5.orig/project/fx/plans/raw.md"; } > "$want"
  if cmp -s "$p/plans/raw.md" "$want"; then ok "L5c no-frontmatter file gains a block in front, content unchanged"
  else bad "L5c no-frontmatter file bytes wrong after --fix-type"; fi
  { printf -- '---\r\ntype: spec\r\n'; tail -n +2 "$L_WORK/v5.orig/project/fx/spec/002-crlf.md"; } > "$want"
  if cmp -s "$p/spec/002-crlf.md" "$want"; then ok "L5d CRLF file: inserted line uses CRLF, rest byte-identical"
  else bad "L5d CRLF file bytes wrong after --fix-type"; fi
}

# ---------- L6 unparseable: skipped, bytes unchanged ----------
# Red-making change: attempting to stamp unparseable files (or not listing
# them under skipped).
caseL6() {
  assert_json "L6 unparseable file listed as skipped" "$L4_OUT" "j.skipped.join(',')" "project/demo/spec/008-broken.md"
  if cmp -s "$L_V4/project/demo/spec/008-broken.md" "$L_WORK/v1.orig/project/demo/spec/008-broken.md"; then
    ok "L6 unparseable file bytes unchanged"; else bad "L6 unparseable file was modified"; fi
}

# ---------- L7 all slugs ----------
# Red-making change: defaulting to one project when <slug> is omitted.
caseL7() {
  local v="$L_WORK/v7"
  mkdir -p "$v/project/alpha/spec" "$v/project/beta/fixes"
  printf -- '---\nstatus: draft\n---\n' > "$v/project/alpha/spec/001-a.md"
  printf -- '---\nstatus: fixed\n---\n' > "$v/project/beta/fixes/2026-01-01-b.md"
  printf -- '---\ntype: project\n---\n' > "$v/project/alpha.md"
  lint_run "$v" --json
  assert_rc "L7 lint without slug exits 1" 1 "$L_RC"
  assert_json "L7 findings from both slugs" "$L_OUT" "j.findings.map(f => f.path).sort().join(' ')" \
    "project/alpha/spec/001-a.md project/beta/fixes/2026-01-01-b.md"
}

# ---------- L8 cannot run → exit 2, no stdout ----------
# Red-making change: missing assertSafeSegment on <slug> ('../project/demo'
# is then walked, exit 1 with JSON on stdout — '../x' alone would still exit 2
# through the "folder not found" check); treating the repo-local tier as a
# vault (exit 0/1 instead of 2).
caseL8() {
  lint_run "$L_V1" '../x' --json
  assert_rc "L8 hostile slug '../x' exits 2" 2 "$L_RC"
  assert_eq "L8 hostile slug writes no stdout" "$L_OUT" ""
  # The traversal target EXISTS here (project/../project/demo), so only the
  # segment guard — not the "folder not found" check — can stop it.
  lint_run "$L_V1" '../project/demo' --json
  assert_rc "L8 hostile slug resolving to an existing folder exits 2" 2 "$L_RC"
  assert_eq "L8 that slug writes no stdout (nothing walked)" "$L_OUT" ""
  lint_run "$L_V1" nosuch --json
  assert_rc "L8 unknown slug exits 2" 2 "$L_RC"
  lint_run "$L_V1" demo --dry-run
  assert_rc "L8 --dry-run without --fix-type exits 2" 2 "$L_RC"
  local repo="$L_WORK/repo" rc
  mkdir -p "$repo" && git -C "$repo" init -q
  (cd "$repo" && env -u A1_VAULT_ROOT HOME="$L_WORK/home" node "$TOOLS" vault lint --json >/dev/null 2>&1); rc=$?
  assert_rc "L8 repo-local tier (no A1_VAULT_ROOT, inside a git repo) exits 2" 2 "$rc"
}

# ---------- L9 clean vault → exit 0; dry-run writes nothing ----------
# Red-making change (L9a): exit 1 on an empty findings list; (L9b): writing
# under --dry-run.
caseL9() {
  local v="$L_WORK/v9"
  cp -R "$L_WORK/v1.orig" "$v"
  rm -f "$v/project/demo/spec/00"[2-8]"-"*.md "$v/project/demo/spec/"*conflicted*
  lint_run "$v" demo --json
  assert_rc "L9a clean vault exits 0" 0 "$L_RC"
  assert_json "L9a clean vault: no findings, ignored still 1" "$L_OUT" "[j.findings.length, j.ignored].join(',')" "0,1"
  cp -R "$L_WORK/v1.orig" "$L_WORK/v9b"
  lint_run "$L_WORK/v9b" demo --json --fix-type --dry-run
  if diff -r "$L_WORK/v9b" "$L_WORK/v1.orig" >/dev/null; then ok "L9b --dry-run leaves the vault byte-identical"
  else bad "L9b --dry-run wrote to the vault"; fi
  assert_json "L9b --dry-run: would_fix names the file, fixed empty" "$L_OUT" \
    "[j.would_fix.join(','), j.fixed.length].join('|')" "project/demo/spec/002-no-type.md|0"
}

caseL1; caseL2; caseL3; caseL4; caseL5; caseL5bcd; caseL6; caseL7; caseL8; caseL9
rm -rf "$L_WORK"
