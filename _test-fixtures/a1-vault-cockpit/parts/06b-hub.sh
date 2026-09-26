#!/usr/bin/env bash
# Part 06b — Wave 6 agent B, section HB: `vault link-hub` (FR-024, FR-026
# `--all-specs`) and `spec init` (FR-017, FR-025) plus the template (T1).
# Sourced by run-tests.sh (never run on its own): uses its helpers and
# counters. Every case builds its own vault under `mktemp -d` and runs the CLI
# with A1_VAULT_ROOT and HOME pointing there, from a cwd outside any git repo
# — the real vault is never touched. Every case names the single production
# change that turns it red.
#
# Literals below (the relation line shape, `type: spec`, `discovering`) are
# typed here from FR-017/FR-024 — NOT read from vault-contract.cjs or the
# template under test.

HB_TEMPLATE="$REPO_ROOT/skills/a1-new-feature/templates/spec-template.md"

# hb_vault <dir> — a vault with project demo: a hub whose `## Relations` block
# sits between two other sections (bytes after the block must survive), one
# spec 003-x, and a hub body with CRLF-free, trailing-newline text.
hb_vault() {
  local v="$1/v"
  mkdir -p "$v/project/demo/spec"
  printf -- '---\ntype: project\nstatus: build\npath: ~/claude-projects/demo\n---\n# demo\n\nIntro text.\n\n## Relations\n\n- references [[x]]\n- uses [[y]]\n\n## Notes\n\nkeep me\n' > "$v/project/demo.md"
  printf -- '---\ntype: spec\nid: 003-x\n---\n# x\n' > "$v/project/demo/spec/003-x.md"
}

# hb_run <workdir> <args...> — the CLI against <workdir>/v, stdout to
# <workdir>/out, stderr to <workdir>/err; returns the exit code.
hb_run() {
  local w="$1"; shift
  (cd "$w" && A1_VAULT_ROOT="$w/v" HOME="$w" node "$TOOLS" "$@" >"$w/out" 2>"$w/err")
}

hb_mtime() { python3 -c "import os, sys; print(os.stat(sys.argv[1]).st_mtime_ns)" "$1"; }
hb_files() { (cd "$1" && find . -type f | LC_ALL=C sort | tr '\n' ' '); }
# hb_count <file> <exact line> — number of lines equal to the literal.
hb_count() { grep -cxF -- "$2" "$1" 2>/dev/null || true; }

# ---------- HB1 one-line diff, every other byte unchanged ----------
# Red-making change: in insertRelationLine, `lines.slice(insertAt)` →
# `lines.slice(insertAt + 1)` (the splice eats the line after the insertion
# point) — the hub minus the added line no longer equals the original.
caseHB1() {
  local w rc; w="$(mktemp -d)"; hb_vault "$w"
  cp "$w/v/project/demo.md" "$w/hub.before"
  hb_run "$w" vault link-hub demo --spec 003-x; rc=$?
  assert_rc "HB1 link-hub demo --spec 003-x exits 0" 0 "$rc" "$(head -c 300 "$w/err")"
  assert_json "HB1 JSON says hub linked" "$(cat "$w/out")" "j.hub" "linked"
  diff "$w/hub.before" "$w/v/project/demo.md" > "$w/diff"
  assert_eq "HB1 diff has exactly one added line" "$(grep -c '^>' "$w/diff")" "1"
  assert_eq "HB1 diff has no removed line" "$(grep -c '^<' "$w/diff")" "0"
  assert_eq "HB1 the added line is the literal FR-024 line" "$(grep '^>' "$w/diff")" \
    "> - references [[project/demo/spec/003-x]]"
  grep -vxF -- '- references [[project/demo/spec/003-x]]' "$w/v/project/demo.md" > "$w/hub.minus"
  if cmp -s "$w/hub.minus" "$w/hub.before"; then ok "HB1 hub minus the added line is byte-identical to before"
  else bad "HB1 other hub bytes changed"; fi
  # inside the block: the line follows the last existing bullet
  assert_eq "HB1 line sits after the last bullet of ## Relations" \
    "$(grep -A1 -xF -- '- uses [[y]]' "$w/v/project/demo.md" | tail -1)" "- references [[project/demo/spec/003-x]]"
  rm -rf "$w"
}

# ---------- HB2 idempotent ----------
# Red-making change: removing the exact-line check (`lines.some(...) → return
# null`) in insertRelationLine — the second run appends a duplicate.
caseHB2() {
  local w rc m1 m2; w="$(mktemp -d)"; hb_vault "$w"
  hb_run "$w" vault link-hub demo --spec 003-x
  cp "$w/v/project/demo.md" "$w/hub.after1"; m1="$(hb_mtime "$w/v/project/demo.md")"
  sleep 1
  hb_run "$w" vault link-hub demo --spec 003-x; rc=$?
  m2="$(hb_mtime "$w/v/project/demo.md")"
  assert_rc "HB2 second link-hub exits 0" 0 "$rc" "$(head -c 300 "$w/err")"
  assert_json "HB2 second run reports hub unchanged" "$(cat "$w/out")" "j.hub" "unchanged"
  assert_eq "HB2 the relation line occurs exactly once" \
    "$(hb_count "$w/v/project/demo.md" '- references [[project/demo/spec/003-x]]')" "1"
  if cmp -s "$w/hub.after1" "$w/v/project/demo.md"; then ok "HB2 hub bytes unchanged by the second run"
  else bad "HB2 second run changed the hub"; fi
  assert_eq "HB2 hub mtime unchanged by the second run" "$m2" "$m1"
  rm -rf "$w"
}

# ---------- HB3 missing ## Relations → heading created once, at the end ----------
# Red-making change: the heading-missing branch prepends
# (`${RELATIONS_HEADING}\n\n${line}\n\n${text}`) instead of appending — the
# last two non-empty lines are no longer heading + line.
caseHB3() {
  local w rc; w="$(mktemp -d)"; hb_vault "$w"
  printf -- '---\ntype: project\n---\n# demo\n\nNo relations yet.\n' > "$w/v/project/demo.md"
  cp "$w/v/project/demo.md" "$w/hub.before"
  hb_run "$w" vault link-hub demo --spec 003-x; rc=$?
  assert_rc "HB3 link-hub on a hub without ## Relations exits 0" 0 "$rc" "$(head -c 300 "$w/err")"
  assert_eq "HB3 last two non-empty lines are the heading and the line" \
    "$(grep -v '^$' "$w/v/project/demo.md" | tail -2 | tr '\n' '|')" \
    "## Relations|- references [[project/demo/spec/003-x]]|"
  assert_eq "HB3 original bytes are an unchanged prefix" \
    "$(head -c "$(wc -c < "$w/hub.before")" "$w/v/project/demo.md" | cmp -s - "$w/hub.before" && echo same)" "same"
  hb_run "$w" vault link-hub demo --spec 003-x
  assert_eq "HB3 heading exists exactly once after a second run" "$(hb_count "$w/v/project/demo.md" '## Relations')" "1"
  rm -rf "$w"
}

# ---------- HB4 missing hub → exit 1, nothing created ----------
# Red-making change: in linkHub, replacing the `hub: 'missing'` return with
# `writeTextAtomic(hubPath, '')` (creating the hub) — the call then links into
# the new file and exits 0.
caseHB4() {
  local w rc; w="$(mktemp -d)"; hb_vault "$w"
  rm -f "$w/v/project/demo.md"
  hb_run "$w" vault link-hub demo --spec 003-x; rc=$?
  assert_rc "HB4 link-hub with a missing hub exits 1" 1 "$rc"
  [[ ! -e "$w/v/project/demo.md" ]] && ok "HB4 no hub file created" || bad "HB4 link-hub created project/demo.md"
  if grep -q 'hub note missing' "$w/err"; then ok "HB4 stderr names the missing hub"
  else bad "HB4 stderr lacks 'hub note missing': $(head -c 200 "$w/err")"; fi
  rm -rf "$w"
}

# ---------- HB5 --dry-run writes nothing, prints the line ----------
# Red-making change: removing `if (opts.dryRun) return ... 'would-link'` in
# linkHub (single) — the hub is written. HB5b: removing `&& !dryRun` in
# linkSpecsIntoHub (all-specs) — the backfill writes during a dry run.
caseHB5() {
  local w rc m1; w="$(mktemp -d)"; hb_vault "$w"
  cp "$w/v/project/demo.md" "$w/hub.before"; m1="$(hb_mtime "$w/v/project/demo.md")"
  sleep 1
  hb_run "$w" vault link-hub demo --spec 003-x --dry-run; rc=$?
  assert_rc "HB5a link-hub --dry-run exits 0" 0 "$rc" "$(head -c 300 "$w/err")"
  if cmp -s "$w/hub.before" "$w/v/project/demo.md"; then ok "HB5a hub byte-identical after --dry-run"
  else bad "HB5a --dry-run changed the hub"; fi
  assert_eq "HB5a hub mtime unchanged after --dry-run" "$(hb_mtime "$w/v/project/demo.md")" "$m1"
  assert_json "HB5a JSON reports would-link with the literal line" "$(cat "$w/out")" "j.hub + ' ' + j.line" \
    "would-link - references [[project/demo/spec/003-x]]"
  hb_run "$w" vault link-hub demo --all-specs --dry-run; rc=$?
  assert_rc "HB5b link-hub --all-specs --dry-run exits 0" 0 "$rc" "$(head -c 300 "$w/err")"
  if cmp -s "$w/hub.before" "$w/v/project/demo.md"; then ok "HB5b hub byte-identical after --all-specs --dry-run"
  else bad "HB5b --all-specs --dry-run changed the hub"; fi
  if grep -qF -- '- references [[project/demo/spec/003-x]]' "$w/err"; then ok "HB5b dry run prints the line it would add"
  else bad "HB5b dry-run output lacks the line: $(head -c 300 "$w/err")"; fi
  rm -rf "$w"
}

# ---------- HB6 --all-specs skips VERIFICATION companions ----------
# Red-making change: dropping the SPEC_EXCLUDE_RE filter in
# listSpecBasenames — 001-a-VERIFICATION gets a relation line.
caseHB6() {
  local w rc; w="$(mktemp -d)"; hb_vault "$w"
  printf '# a\n' > "$w/v/project/demo/spec/001-a.md"
  printf '# verification\n' > "$w/v/project/demo/spec/001-a-VERIFICATION.md"
  cp "$w/v/project/demo.md" "$w/hub.before"
  hb_run "$w" vault link-hub demo --all-specs; rc=$?
  assert_rc "HB6 link-hub demo --all-specs exits 0" 0 "$rc" "$(head -c 300 "$w/err")"
  assert_eq "HB6 001-a linked once" "$(hb_count "$w/v/project/demo.md" '- references [[project/demo/spec/001-a]]')" "1"
  assert_eq "HB6 003-x linked once" "$(hb_count "$w/v/project/demo.md" '- references [[project/demo/spec/003-x]]')" "1"
  assert_eq "HB6 no line for the VERIFICATION companion" "$(grep -c 'VERIFICATION' "$w/v/project/demo.md")" "0"
  diff "$w/hub.before" "$w/v/project/demo.md" > "$w/diff"
  assert_eq "HB6 exactly two lines added, none removed" \
    "$(grep -c '^>' "$w/diff")/$(grep -c '^<' "$w/diff")" "2/0"
  rm -rf "$w"
}

# ---------- HB7 hostile slug / id → exit 1, nothing written ----------
# Red-making change: removing safeSegmentOrFail on the --spec id in
# resolveArtifactRef (HB7b: `../x` then reaches projectsPath, which throws →
# exit 2, not the clean exit 1); removing the assertSafeSegment guard on the
# project slug in cmdSpecInit (HB7d: exit 2); removing SPEC_TITLE_MAX_CHARS
# (HB7f: a 10 000-char title is written).
caseHB7() {
  local w rc before long; w="$(mktemp -d)"; hb_vault "$w"
  cp "$w/v/project/demo.md" "$w/hub.before"; before="$(hb_files "$w/v")"
  hb_run "$w" vault link-hub '../x' --spec 003-x; rc=$?
  assert_rc "HB7a link-hub '../x' --spec 003-x is refused" 1 "$rc"
  hb_run "$w" vault link-hub demo --spec '../x'; rc=$?
  assert_rc "HB7b link-hub demo --spec '../x' is refused" 1 "$rc"
  hb_run "$w" vault link-hub '../x' --all-specs; rc=$?
  assert_rc "HB7c link-hub '../x' --all-specs is refused" 1 "$rc"
  hb_run "$w" spec init '../x' feat --title t; rc=$?
  assert_rc "HB7d spec init '../x' feat is refused" 1 "$rc"
  hb_run "$w" spec init demo '../x' --title t; rc=$?
  assert_rc "HB7e spec init demo '../x' is refused" 1 "$rc"
  long="$(python3 -c "print('t' * 10000)")"
  hb_run "$w" spec init demo long-title --title "$long"; rc=$?
  assert_rc "HB7f spec init with a 10 000-char title is refused" 1 "$rc"
  assert_eq "HB7 no file created or removed anywhere in the vault" "$(hb_files "$w/v")" "$before"
  [[ ! -e "$w/x.md" && ! -e "$w/x" ]] && ok "HB7 nothing written outside the vault" || bad "HB7 traversal wrote outside the vault"
  if cmp -s "$w/hub.before" "$w/v/project/demo.md"; then ok "HB7 hub unchanged by hostile calls"
  else bad "HB7 a hostile call changed the hub"; fi
  rm -rf "$w"
}

# ---------- HB8 spec init: type: spec first, discovering, next number, hub +1 ----------
# Red-making change: moving `type: spec` below `id:` in the template (HB8a —
# the self-check refuses, exit 2, and head -2 differs); separately, deleting
# the linkHub call in cmdSpecInit (HB8d — the hub gains nothing).
caseHB8() {
  local w rc f; w="$(mktemp -d)"; hb_vault "$w"
  cp "$w/v/project/demo.md" "$w/hub.before"
  hb_run "$w" spec init demo search-index --title "Search index"; rc=$?
  f="$w/v/project/demo/spec/004-search-index.md"
  assert_rc "HB8 spec init demo search-index exits 0" 0 "$rc" "$(head -c 300 "$w/err")"
  assert_json "HB8 JSON path is the next number (004 after 003-x)" "$(cat "$w/out")" "j.spec_path" "$f"
  assert_eq "HB8a head -2 is '---' then 'type: spec'" "$(head -2 "$f" 2>/dev/null | tr '\n' '|')" "---|type: spec|"
  assert_eq "HB8b status: discovering" "$(grep -c '^status: discovering$' "$f" 2>/dev/null)" "1"
  assert_eq "HB8c id, project and feature_slug filled" \
    "$(grep -E '^(id|project|feature_slug):' "$f" 2>/dev/null | tr '\n' '|')" \
    "id: 004-search-index|project: demo|feature_slug: search-index|"
  assert_json "HB8d JSON says hub linked" "$(cat "$w/out")" "j.hub" "linked"
  diff "$w/hub.before" "$w/v/project/demo.md" > "$w/diff"
  assert_eq "HB8d hub gained exactly the one literal line (SC-006)" \
    "$(grep -c '^>' "$w/diff")/$(grep -c '^<' "$w/diff")/$(grep '^>' "$w/diff")" \
    "1/0/> - references [[project/demo/spec/004-search-index]]"
  rm -rf "$w"
}

# ---------- HB9 spec init twice → second refuses, nothing changes ----------
# Red-making change: removing the refuseExistingFeatureSlug call in
# cmdSpecInit — the second run exits 0 and writes 005-search-index.md.
caseHB9() {
  local w rc before; w="$(mktemp -d)"; hb_vault "$w"
  hb_run "$w" spec init demo search-index --title "Search index"
  cp "$w/v/project/demo/spec/004-search-index.md" "$w/spec.after1"
  cp "$w/v/project/demo.md" "$w/hub.after1"; before="$(hb_files "$w/v")"
  hb_run "$w" spec init demo search-index --title "Other title"; rc=$?
  assert_rc "HB9 second spec init for the same feature slug is refused" 1 "$rc"
  if grep -q 'already exists' "$w/err"; then ok "HB9 stderr says the spec already exists"
  else bad "HB9 stderr lacks 'already exists': $(head -c 200 "$w/err")"; fi
  if cmp -s "$w/spec.after1" "$w/v/project/demo/spec/004-search-index.md"; then ok "HB9 first spec file unchanged"
  else bad "HB9 second run changed the first spec"; fi
  assert_eq "HB9 no second spec file created" "$(hb_files "$w/v")" "$before"
  if cmp -s "$w/hub.after1" "$w/v/project/demo.md"; then ok "HB9 hub unchanged by the refused run"
  else bad "HB9 refused run changed the hub"; fi
  rm -rf "$w"
}

# ---------- HB10 spec init with a missing hub (FR-025) ----------
# Red-making change: the same hub-creating mutation as HB4 (linkHub writes the
# hub instead of returning `missing`) — JSON says linked and the hub exists.
caseHB10() {
  local w rc; w="$(mktemp -d)"; hb_vault "$w"
  rm -f "$w/v/project/demo.md"
  hb_run "$w" spec init demo search-index --title "Search index"; rc=$?
  assert_rc "HB10 spec init without a hub still exits 0" 0 "$rc" "$(head -c 300 "$w/err")"
  [[ -f "$w/v/project/demo/spec/004-search-index.md" ]] && ok "HB10 spec file created" || bad "HB10 spec file missing"
  assert_json "HB10 JSON says hub missing" "$(cat "$w/out")" "j.hub" "missing"
  [[ ! -e "$w/v/project/demo.md" ]] && ok "HB10 no hub created" || bad "HB10 spec init created the hub"
  rm -rf "$w"
}

# ---------- T1 template carries type: spec on line 2 ----------
# Red-making change: deleting `type: spec` from spec-template.md.
caseT1() {
  assert_eq "T1 template has exactly one 'type: spec' line" "$(grep -c '^type: spec$' "$HB_TEMPLATE")" "1"
  assert_eq "T1 'type: spec' is line 2" "$(sed -n 2p "$HB_TEMPLATE")" "type: spec"
}

caseHB1; caseHB2; caseHB3; caseHB4; caseHB5; caseHB6; caseHB7; caseHB8; caseHB9; caseHB10; caseT1
