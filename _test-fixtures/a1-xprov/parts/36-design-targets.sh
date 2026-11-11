#!/usr/bin/env bash
# Part 36 — spec 025 Wave 7 Task 7.1: `xprov design-targets --phase <p> (--plan <PLAN.md> | --base <sha> [--head <sha>])` (FR-013).
# Sourced by run-tests.sh. Expectations are literals written from the FR-013 acceptance text, not taken from the module's output.
# Passes are recorded by the REAL gate (`xprov gate --gate design-review-xprov`, fake runner), never forged.
#
# Arm -> the single production change that turns it red. The M-arms run that change on a tree copy and assert the outcome flips:
#   T1  plan mode lists only the named design file without a pass         M1 pass filter dropped; M2 token filter dropped; M4 plan mode scans docs/adr/.
#       (a.md named+no pass, b.md named+pass, c.md unnamed, src/x.ts)
#   T2  a body edit of b.md brings it back, a whitespace edit does not    Red if the pass lookup is not keyed on the current body hash.
#   T3  base mode lists only the changed design file of the wave diff     M5 a deleted file is listed; red if code paths pass the glob filter.
#   T4  two ADRs in ONE commit: 2 targets, one gate call each, re-run 0     Red if targets are deduplicated by commit instead of by document state.
#   T5  one document named twice (symlink alias) is listed once            M6 the realpath-relative dedupe dropped.
#   T6  usage errors exit 2, empty stdout, nothing written                 M3 --base accepts an option-shaped revision (git would write the --output file).
#   T8  a recorded fail-with-findings stays a target (only a pass is skipped); the gate answers it from the record with 0 calls   M7 a REVISE is skipped like a pass; M7b the gate re-sends it.
#   T9  design-targets resolves the repo from the CWD: from outside the lane worktree the same --plan lists nothing (invalid_doc) and a --base of the
#       worktree is unknown, from inside it lists the files — why 02-execute.md 2b-d runs the block inside `cd "$WORK_PATH"`.
#   T7  not a gate: no registry row; read-only (repo tree and index.json unchanged)
# Hygiene: no write target is ever derived from parsed output; every path the harness writes is a fixed path under $TMP36.

mk_workdir TMP36 tmp36
SAVED_HOME_36="$HOME"
export HOME="$TMP36/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
DESIGN_CASES36="$CASES/design"
COUNT36="$TMP36/count.txt"
PWN36="$TMP36/pwn.txt"
GATE36="design-review-xprov"
PLAN_REL36=".a1/phases/p36/PLAN.md"

prep36() {
  make_tree; make_phase p36
  mkdir -p "$PHASE_REPO/docs/adr" "$PHASE_REPO/docs/architecture"
  cp "$DESIGN_CASES36/adr.md" "$PHASE_REPO/docs/adr/a.md"; cp "$DESIGN_CASES36/adr.md" "$PHASE_REPO/docs/adr/b.md"; cp "$DESIGN_CASES36/adr.md" "$PHASE_REPO/docs/adr/c.md"
  printf 'export const y = 1;\n' > "$PHASE_REPO/src/y.ts"
  ( cd "$PHASE_REPO" && git add -A && git commit -qm "fixture: adrs" )
  write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"; export A1_XPROV_CODEX_HOME="$XHOME"
  rm -f "$COUNT36"
}
head36() { ( cd "$PHASE_REPO" && git rev-parse HEAD ); }
commit36() { ( cd "$PHASE_REPO" && git add -A && git commit -qm "$1" ); }

# gate36 <doc> — one real design gate call (the fake runner counts every call in $COUNT36)
gate36() {
  FAKE_RUNNER_CASE="${G36_CASE:-approved}" FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_COUNT_FILE="$COUNT36" FAKE_RUNNER_SEQUENCE='[{}]' fake_runner_env
  ( cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p36 --gate "$GATE36" --doc "$1" --timeout 7 >/dev/null 2>&1 )
}
calls36() { if [[ -f "$COUNT36" ]]; then wc -l < "$COUNT36" | tr -d ' '; else echo 0; fi; }

# dt36 <tools> <args...> -> DT_OUT DT_ERR DT_RC (cwd = $PHASE_REPO, vault unset)
dt36() {
  local tools="$1"; shift
  DT_OUT="$(cd "$PHASE_REPO" && env -u A1_VAULT_ROOT node "$tools" xprov design-targets "$@" 2>"$TMP36/err.txt" </dev/null)"; DT_RC=$?
  DT_ERR="$(cat "$TMP36/err.txt")"
}
TARGETS36="j.targets.join(',')"
SKIPPED36="j.skipped.map(s=>s.path+'|'+s.reason).join(',')"
status36() { ( cd "$PHASE_REPO" && git status --short | tr '\n' ';' ); }

plan36() {
  printf '# PLAN\n\nTouches `docs/adr/a.md`, `docs/adr/b.md` and `src/x.ts`. Also `/etc/passwd`.\n' > "$PHASE_REPO/$PLAN_REL36"
}

# json_of36 <json> <expr> — json_get, but an unparseable document prints UNPARSEABLE and nothing is derived from it
caseT1T2() {
  prep36; printf 'export const x = 1;\n' > "$PHASE_REPO/src/x.ts"; commit36 "fixture: x"
  gate36 docs/adr/b.md
  assert_eq "T1 setup: b.md got exactly one real gate pass" "$(calls36)" "1"
  plan36
  dt36 "$TREE_TOOLS" --phase p36 --plan "$PLAN_REL36"
  assert_rc "T1 plan mode exits 0" 0 "$DT_RC" "$DT_ERR"
  assert_json "T1 only a.md is a target (b has a pass, c is unnamed, src/x.ts is code)" "$DT_OUT" "$TARGETS36" "docs/adr/a.md"
  assert_json "T1 b.md is skipped with pass_recorded; code and non-design tokens are not mentioned" "$DT_OUT" "$SKIPPED36" "docs/adr/b.md|pass_recorded"
  assert_json "T1 output keys are exactly targets and skipped" "$DT_OUT" "Object.keys(j).sort().join(',')" "skipped,targets"
  printf '\n   \n' >> "$PHASE_REPO/docs/adr/b.md"
  dt36 "$TREE_TOOLS" --phase p36 --plan "$PLAN_REL36"
  assert_json "T2 whitespace-only edit of b.md: still only a.md" "$DT_OUT" "$TARGETS36" "docs/adr/a.md"
  cp "$DESIGN_CASES36/adr-body-change.md" "$PHASE_REPO/docs/adr/b.md"
  dt36 "$TREE_TOOLS" --phase p36 --plan "$PLAN_REL36"
  assert_json "T2 body edit of b.md: a.md and b.md are targets, c.md still absent" "$DT_OUT" "$TARGETS36" "docs/adr/a.md,docs/adr/b.md"
}

caseT3T4() {
  prep36; local base base2 base3 f; base="$(head36)"
  cp "$DESIGN_CASES36/adr.md" "$PHASE_REPO/docs/architecture/d.md"
  printf 'export const y = 2;\n' > "$PHASE_REPO/src/y.ts"; commit36 "wave: d.md and y.ts"
  dt36 "$TREE_TOOLS" --phase p36 --base "$base"
  assert_rc "T3 base mode exits 0" 0 "$DT_RC" "$DT_ERR"
  assert_json "T3 only docs/architecture/d.md is a target (src/y.ts is code)" "$DT_OUT" "$TARGETS36" "docs/architecture/d.md"
  base2="$(head36)"
  ( cd "$PHASE_REPO" && git rm -q docs/adr/c.md && git commit -qm "wave: delete c" )
  dt36 "$TREE_TOOLS" --phase p36 --base "$base2"
  assert_json "T3 a deleted design file is not a target" "$DT_OUT" "j.targets.length" "0"
  dt36 "$TREE_TOOLS" --phase p36 --base "$base" --head "$base2"
  assert_json "T3 --head bounds the range (d.md only, the later delete is outside)" "$DT_OUT" "$TARGETS36" "docs/architecture/d.md"
  base3="$(head36)"
  printf '\nSecond line.\n' >> "$PHASE_REPO/docs/adr/a.md"; printf '\nOther line.\n' >> "$PHASE_REPO/docs/adr/b.md"; commit36 "wave: a and b in one commit"
  dt36 "$TREE_TOOLS" --phase p36 --base "$base3"
  assert_json "T4 two ADRs in one commit: two targets" "$DT_OUT" "$TARGETS36" "docs/adr/a.md,docs/adr/b.md"
  rm -f "$COUNT36"
  for f in docs/adr/a.md docs/adr/b.md; do gate36 "$f"; done  # the skill loops over the listed files; the literal list is the one asserted above
  assert_eq "T4 one gate call per listed document (2 calls)" "$(calls36)" "2"
  dt36 "$TREE_TOOLS" --phase p36 --base "$base3"
  assert_json "T4 re-run after the passes: 0 targets" "$DT_OUT" "j.targets.length" "0"
  assert_json "T4 re-run: both documents skipped with pass_recorded" "$DT_OUT" "$SKIPPED36" "docs/adr/a.md|pass_recorded,docs/adr/b.md|pass_recorded"
}

caseT5() {
  prep36
  ln -s a.md "$PHASE_REPO/docs/adr/alias.md"; ln -s /etc/hostname "$PHASE_REPO/docs/adr/out.md"; commit36 "fixture: symlinks"
  printf 'Named: `docs/adr/a.md` `docs/adr/alias.md` `docs/adr/out.md` `docs/adr/missing.md`\n' > "$PHASE_REPO/$PLAN_REL36"
  dt36 "$TREE_TOOLS" --phase p36 --plan "$PLAN_REL36"
  assert_json "T5 alias and target are one document, listed once; escaping and missing files are not targets" "$DT_OUT" "$TARGETS36" "docs/adr/a.md"
  assert_json "T5 the escaping symlink and the missing file are skipped as invalid_doc" "$DT_OUT" "j.skipped.filter(s=>s.reason==='invalid_doc').map(s=>s.path).sort().join(',')" "docs/adr/missing.md,docs/adr/out.md"
}

usage36() { # <name> <args...> — exit 2, empty stdout, repo status unchanged
  local name="$1" before; shift
  before="$(status36)"
  dt36 "$TREE_TOOLS" "$@"
  if [[ "$DT_RC" -eq 2 && -z "$DT_OUT" && "$(status36)" == "$before" ]]; then ok "T6 $name: exit 2, empty stdout, nothing written"
  else bad "T6 $name: rc=$DT_RC stdout=${DT_OUT:0:80} status-unchanged=$([[ "$(status36)" == "$before" ]] && echo yes || echo no)"; fi
}

caseT6() {
  prep36; plan36; local base; base="$(head36)"
  rm -f "$PWN36"
  usage36 "no mode" --phase p36
  usage36 "both modes" --phase p36 --plan "$PLAN_REL36" --base "$base"
  usage36 "no --phase" --plan "$PLAN_REL36"
  usage36 "--head without --base" --phase p36 --plan "$PLAN_REL36" --head "$base"
  usage36 "missing plan file" --phase p36 --plan .a1/phases/p36/NOPE.md
  usage36 "plan is a directory" --phase p36 --plan .a1/phases/p36
  usage36 "unsafe phase" --phase ../x --plan "$PLAN_REL36"
  usage36 "unexpected argument" --phase p36 --plan "$PLAN_REL36" extra
  usage36 "non-hex base" --phase p36 --base notarev
  usage36 "unknown base sha" --phase p36 --base deadbeef
  usage36 "option-shaped --base" --phase p36 --base "--output=$PWN36"
  usage36 "option-shaped --head" --phase p36 --base "$base" --head "--output=$PWN36"
  if [[ ! -e "$PWN36" ]]; then ok "T6 option-shaped revisions did not make git write the --output file"; else bad "T6 git wrote the --output file"; rm -f "$PWN36"; fi
}

caseT7() {
  prep36; plan36; gate36 docs/adr/b.md
  local idx="$PHASE_REPO/.a1/phases/p36/xreview/index.json" s1 st1
  s1="$(sha256_of "$idx")"; st1="$(status36)"
  dt36 "$TREE_TOOLS" --phase p36 --plan "$PLAN_REL36"
  assert_eq "T7 design-targets does not touch index.json" "$(sha256_of "$idx")" "$s1"
  assert_eq "T7 design-targets does not change the repo tree" "$(status36)" "$st1"
  assert_eq "T7 not a gate: no design-targets row in the gate registry" "$(grep -c 'design-targets' "$REPO_ROOT/_shared/gates-registry.md")" "0"
  assert_eq "T7 the router lists it as a subcommand" "$(node -p "require(process.argv[1]).SUBCOMMAND_NAMES.includes('design-targets')" "$REPO_ROOT/_shared/lib/xprov.cjs")" "true"
}

caseT8() {
  prep36; plan36
  G36_CASE=revise gate36 docs/adr/a.md
  assert_eq "T8 setup: a.md got one real REVISE (one runner call)" "$(calls36)" "1"
  dt36 "$TREE_TOOLS" --phase p36 --plan "$PLAN_REL36"
  assert_json "T8 a recorded REVISE stays a target (the gate answers it from the record), nothing is skipped" "$DT_OUT" "$SKIPPED36 + '#' + $TARGETS36" "#docs/adr/a.md,docs/adr/b.md"
  G36_CASE=revise gate36 docs/adr/a.md
  assert_eq "T8 the gate answers the unchanged failed doc from the record (still one runner call)" "$(calls36)" "1"
  mut36 "M7 a recorded REVISE is skipped like a pass" "if (rec !== null && rec.kind === 'pass') skipped.push" "if (rec !== null) skipped.push" "docs/adr/a.md,docs/adr/b.md" probe_plan36
  mut36 "M7b gate: the failed doc is re-sent" "if (e.verdict !== X.VERDICTS.FAIL_WITH_FINDINGS || !failBoundToDoc(e, hash, root)) return null;" "return null;" "0" probe_gate_calls36
  printf '\nA new decision sentence.\n' >> "$PHASE_REPO/docs/adr/a.md"
  dt36 "$TREE_TOOLS" --phase p36 --plan "$PLAN_REL36"
  assert_json "T8 a body edit keeps a.md a target" "$DT_OUT" "$TARGETS36" "docs/adr/a.md,docs/adr/b.md"
}
probe_gate_calls36() {
  local before; before="$(calls36)"
  G36_CASE=revise; ( cd "$PHASE_REPO" && FAKE_RUNNER_CASE=revise FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_COUNT_FILE="$COUNT36" node "$1" xprov gate --phase p36 --gate "$GATE36" --doc docs/adr/a.md --timeout 7 >/dev/null 2>&1 ); unset G36_CASE
  echo "$(( $(calls36) - before ))"
}

caseT9() {
  prep36; plan36
  local inside="$PHASE_REPO" inside_head; inside_head="$(head36)"
  dt36 "$TREE_TOOLS" --phase p36 --plan "$PLAN_REL36"
  assert_json "T9 inside the worktree the plan names a.md and b.md" "$DT_OUT" "$TARGETS36" "docs/adr/a.md,docs/adr/b.md"
  make_phase pout   # another repository: the orchestrator cwd that is NOT the lane worktree
  dt36 "$TREE_TOOLS" --phase p36 --plan "$inside/$PLAN_REL36"
  assert_json "T9 from another repo's cwd the same plan lists nothing and skips both files as invalid_doc" "$DT_OUT" "$TARGETS36 + '#' + $SKIPPED36" "#docs/adr/a.md|invalid_doc,docs/adr/b.md|invalid_doc"
  dt36 "$TREE_TOOLS" --phase p36 --base "$inside_head"
  assert_rc "T9 from another repo's cwd the worktree's base sha is unknown (usage exit 2)" 2 "$DT_RC" "$DT_ERR"
  PHASE_REPO="$inside"
}

# secs36 <file> <start-heading-regex> <end-heading-regex> — the lines of a markdown section, start line included, end line excluded
secs36() { S36="$2" E36="$3" awk '$0 ~ ENVIRON["S36"] { on = 1; print; next } on && $0 ~ ENVIRON["E36"] { exit } on { print }' "$1"; }
# wired36 <section-text> — cd:<0|1> exit_rc:<0|1> exit2:<0|1> break:<0|1> (1 = at least one line carries it)
wired36() {
  local k out=""
  for k in 'cd "\$WORK_PATH"' 'exit "\$RC"' 'exit 2' '\bbreak\b'; do out+="$([[ "$(grep -c -- "$k" <<<"$1")" -gt 0 ]] && echo 1 || echo 0)"; done
  printf 'cd:%s exit_rc:%s exit2:%s break:%s' "${out:0:1}" "${out:1:1}" "${out:2:1}" "${out:3:1}"
}
caseT10() {
  local ex="$REPO_ROOT/skills/a1-execute/workflows/02-execute.md" b4="$REPO_ROOT/skills/a1-plan/workflows/04b-xprov-review.md" sec
  sec="$(secs36 "$ex" '^### 2b-d\.' '^### 2b-v\.')"
  assert_eq "T10 02-execute 2b-d runs inside cd \"\$WORK_PATH\", stops with exit \"\$RC\" and exit 2, has no break" "$(wired36 "$sec")" "cd:1 exit_rc:1 exit2:1 break:0"
  sec="$(secs36 "$b4" '^## Step 1b' '^## Step 2 ')"
  assert_eq "T10 04b step 1b stops with exit \"\$RC\" and exit 2, has no break" "$(wired36 "$sec")" "cd:0 exit_rc:1 exit2:1 break:0"
  # RED: the same check on a copy with the cd line removed, and on one with the break back in, must report it
  sec="$(secs36 "$ex" '^### 2b-d\.' '^### 2b-v\.' | grep -v 'cd "\$WORK_PATH"')"
  assert_eq "T10 RED: without the cd line the check reports cd:0" "$(wired36 "$sec")" "cd:0 exit_rc:1 exit2:1 break:0"
  sec="$(secs36 "$b4" '^## Step 1b' '^## Step 2 ' | sed 's/exit 2; fi/break; fi/')"
  assert_eq "T10 RED: with a break back in, the check reports break:1" "$(wired36 "$sec")" "cd:0 exit_rc:1 exit2:1 break:1"
}

# ---------- mutants: ONE production change each, on a tree copy; the outcome of the probe must differ from the clean tree's ----------
m36_mutate() { # <tree> <lib-file> <from> <to> — refuses unless <from> occurs exactly once
  node -e '
    const fs = require("fs"); const [tree, name, from, to] = process.argv.slice(1);
    const f = tree + "/_shared/lib/" + name; const s = fs.readFileSync(f, "utf8");
    const n = s.split(from).length - 1;
    if (n !== 1) { process.stderr.write("mutation target occurs " + n + " times: " + from + "\n"); process.exit(3); }
    fs.writeFileSync(f, s.split(from).join(to));
  ' "$@" || { echo "FAIL  harness: mutation failed ($2: $3)" >&2; exit 2; }
}
# mut36 <label> <from> <to> <clean-result> <probe-fn> — the probe prints one line; clean tree must give <clean-result>, the mutant must not
mut36() {
  local label="$1" from="$2" to="$3" want="$4" probe="$5" clean got
  clean="$("$probe" "$TREE_TOOLS")"
  mk_workdir M_TREE mtree36; cp -R "$TREE/_shared" "$M_TREE/_shared"
  m36_mutate "$M_TREE" xprov-design.cjs "$from" "$to"
  got="$("$probe" "$M_TREE/_shared/a1-tools.cjs")"
  if [[ "$clean" == "$want" && "$got" != "$want" ]]; then ok "$label: clean tree '$clean', mutant '$got' (red)"
  else bad "$label: clean '$clean' (want '$want'), mutant '$got' — the guard is not proven"; fi
}
probe_plan36() { dt36 "$1" --phase p36 --plan "$PLAN_REL36"; json_get "$DT_OUT" "$TARGETS36"; }
probe_skipped36() { dt36 "$1" --phase p36 --plan "$PLAN_REL36"; json_get "$DT_OUT" "$SKIPPED36"; }
probe_base36() { dt36 "$1" --phase p36 --base "$M_BASE"; json_get "$DT_OUT" "$TARGETS36"; }
probe_pwn36() { rm -f "$PWN36"; dt36 "$1" --phase p36 --base "--output=$PWN36" >/dev/null; if [[ -e "$PWN36" ]]; then echo "written"; rm -f "$PWN36"; else echo "refused rc=$DT_RC"; fi; }

caseM() {
  prep36; printf 'export const x = 1;\n' > "$PHASE_REPO/src/x.ts"; commit36 "fixture: x"; gate36 docs/adr/b.md; plan36
  mut36 "M1 pass filter" "if (rec !== null && rec.kind === 'pass') skipped.push" "if (false) skipped.push" "docs/adr/a.md" probe_plan36
  mut36 "M2 token filter" "const wanted = candidates.filter(inGlobs);" "const wanted = candidates;" "docs/adr/b.md|pass_recorded" probe_skipped36
  mut36 "M4 plan mode scans docs/adr/" "return pathsIn(planText);" "return pathsIn(planText).concat(fs.readdirSync(path.join(process.cwd(), 'docs/adr')).map((n) => 'docs/adr/' + n));" "docs/adr/a.md" probe_plan36
  mut36 "M3 option-shaped revision" "const REV_RE = /^(?:[0-9a-fA-F]{4,64}|HEAD)\$/;" "const REV_RE = /^/;" "refused rc=2" probe_pwn36
  # M5: a deleted design file
  M_BASE="$(head36)"; ( cd "$PHASE_REPO" && git rm -q docs/adr/c.md && git commit -qm "wave: delete c" )
  mut36 "M5 deleted file" "skipped.push(Object.freeze({ path: cand, reason: 'invalid_doc' })); continue;" "targets.push(cand); continue;" "" probe_base36
  # M6: alias dedupe
  ln -s a.md "$PHASE_REPO/docs/adr/alias.md"; commit36 "fixture: alias"
  printf 'Named: `docs/adr/a.md` `docs/adr/alias.md`\n' > "$PHASE_REPO/$PLAN_REL36"
  mut36 "M6 realpath dedupe" "if (seen.has(doc.rel)) continue;" "" "docs/adr/a.md" probe_plan36
}

caseT1T2; caseT3T4; caseT5; caseT6; caseT7; caseT8; caseT9; caseT10; caseM
export HOME="$SAVED_HOME_36"; unset A1_XPROV_CODEX_HOME
