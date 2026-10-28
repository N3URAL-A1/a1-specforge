#!/usr/bin/env bash
# Spec 023 Wave 3: module files modules/<m>/ROADMAP.md + NEXT.md inside the
# all-or-nothing transaction of EVERY derived-file caller, stale-dir cleanup,
# fault injection at every operation index, static caller guard, SC-007.
#
# TOOLS_OVERRIDE / GUARD_LIB_OVERRIDE let a run target another export of the
# repo (used to show each assertion red against the pre-wave tree).
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2
unset A1_VAULT_WRITER_HOST A1_HOST_ID
mk_workdir A1_VAULT_ROOT vault-root   # never mirror into the real vault; removed with the suite root
export A1_VAULT_ROOT

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="${TOOLS_OVERRIDE:-$REPO_ROOT/_shared/a1-tools.cjs}"
GUARD_LIB="${GUARD_LIB_OVERRIDE:-$REPO_ROOT/_shared/lib}"
. "$DIR/lib.sh"

pass=0; fail=0
ck() { # ck <name> <true|false>
  if [[ "$2" == "true" ]]; then echo "PASS  $1"; pass=$((pass + 1))
  else echo "FAIL  $1"; fail=$((fail + 1)); fi
}
has_line() { grep -qxF -- "$2" "$1" 2>/dev/null; }
exists() { [[ -e "$1" ]] && echo true || echo false; }
absent() { [[ ! -e "$1" ]] && echo true || echo false; }

# gen_file <module-id> <ROADMAP.md|NEXT.md> <dest>: a file exactly as the module
# generator writes it (stale-module cleanup only deletes such files).
gen_file() {
  node -e '
    const m = require(process.argv[1]);
    const [id, kind] = process.argv.slice(2, 4);
    const out = kind === "NEXT.md" ? m.renderModuleNext(id, { features: [], milestones: [] }, "2026-01-01")
      : m.renderModuleRoadmap(id, [], [], "2026-01-01");
    process.stdout.write(out);
  ' "$GUARD_LIB/product-modules.cjs" "$1" "$2" > "$3"
}
mode_of() { python3 -c "import os, sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])" "$1"; }

mk_workdir WORK modules-w3
n=0
# fresh <name>: tagged fixture (alpha: m1, beta: m2); echoes the product dir.
fresh() { n=$((n + 1)); local d="$WORK/$1-$n/docs/product"; write_roadmap "$d" w3 "modules: [alpha, beta]" alpha beta; echo "$d"; }
run() { node "$TOOLS" product "$@" >"$WORK/last.out" 2>&1; }
cursor_of() { # cursor_of <file>: the line after '## Next cursor' + blank
  awk '/^## Next cursor/{f=1;next} f&&NF{print;exit}' "$1"
}

# ---- (1) every entry command regenerates the module files -------------------
# Each case: fixture with modules/ removed first, run ONE command, expect both
# module files per module and the expected alpha cursor line.
want_alpha_001='**001-first-feature** — recommended next feature (no unmet dependencies, first eligible feature in roadmap order).'
want_alpha_002='**002-second-feature** — recommended next feature (all dependencies (001-first-feature) are done).'

check_modules() { # check_modules <name> <pd> <expected-alpha-cursor-line>
  local nm="$1" pd="$2" want="$3"
  ck "$nm: modules/alpha/ROADMAP.md exists" "$(exists "$pd/modules/alpha/ROADMAP.md")"
  ck "$nm: modules/alpha/NEXT.md exists" "$(exists "$pd/modules/alpha/NEXT.md")"
  ck "$nm: modules/beta/ROADMAP.md exists" "$(exists "$pd/modules/beta/ROADMAP.md")"
  ck "$nm: modules/beta/NEXT.md exists" "$(exists "$pd/modules/beta/NEXT.md")"
  ck "$nm: alpha cursor line" "$([[ "$(cursor_of "$pd/modules/alpha/NEXT.md")" == "$want" ]] && echo true || echo false)"
  ck "$nm: no leftover tmp files" "$([[ -z "$(find "$pd" -name '*.tmp.*')" ]] && echo true || echo false)"
}

pd="$(fresh stage)"; rm -rf "$pd/modules"
run stage --by 001-first-feature --set done --dir "$pd"; rc=$?
ck "site progress.cjs stage (changed): exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "stage(changed)" "$pd" "$want_alpha_002"

pd="$(fresh stage-noop)"
run stage --by 001-first-feature --set started --dir "$pd" >/dev/null
rm -rf "$pd/modules"
run stage --by 001-first-feature --set started --dir "$pd"; rc=$?
ck "site progress.cjs stage (unchanged branch): exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "stage(unchanged)" "$pd" "$want_alpha_001"

pd="$(fresh markers)"; rm -rf "$pd/modules"
run markers --level feature --id 001-first-feature --set review --dir "$pd"; rc=$?
ck "site markers --set: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "markers" "$pd" "$want_alpha_001"

pd="$(fresh changelog)"; rm -rf "$pd/modules"
run changelog --entry e --why w --dir "$pd"; rc=$?
ck "site changelog: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "changelog" "$pd" "$want_alpha_001"

pd="$(fresh add-feature)"; rm -rf "$pd/modules"
run add-feature --id 004-new-first --milestone m1-first --title "New First" --dir "$pd"; rc=$?
ck "site add-feature: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "add-feature" "$pd" "$want_alpha_001"
ck "add-feature: new feature listed in alpha ROADMAP" "$(grep -q '| 004-new-first | New First |' "$pd/modules/alpha/ROADMAP.md" && echo true || echo false)"

pd="$(fresh feature-init)"; rm -rf "$pd/modules"
run feature-init --id 001-first-feature --dir "$pd"; rc=$?
ck "site feature-init: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "feature-init" "$pd" "$want_alpha_001"

pd="$(fresh add-milestone)"; rm -rf "$pd/modules"
run add-milestone --id m3-third --title Third --dir "$pd"; rc=$?
ck "site add-milestone: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "add-milestone" "$pd" "$want_alpha_001"

pd="$(fresh vision-init)"; rm -rf "$pd/modules"
run vision-init --title V --pillar "p:Pillar:Summary text" --dir "$pd"; rc=$?
ck "site vision-init: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "vision-init" "$pd" "$want_alpha_001"

pd="$(fresh vision-touch)"; write_vision_and_audit "$pd" w3; rm -rf "$pd/modules"
run vision-touch --dir "$pd"; rc=$?
ck "site vision-touch: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "vision-touch" "$pd" "$want_alpha_001"

pd="$(fresh audit-publish)"; rm -rf "$pd/modules"
cat > "$WORK/analysis.md" <<'EOA'
---
type: project-analysis
project: w3
focus: general
title: "general analysis of w3"
status: reported
created_at: 2026-07-13T09:00:00.000Z
findings:
  - "id=F-001; severity=MAJOR; category=cat; location=a.js:1; description=desc; recommendation=fix"
findings_count:
  - "blocker=0"
tags:
  - analysis
---

# Analysis
EOA
run audit-publish --analysis "$WORK/analysis.md" --dir "$pd"; rc=$?
ck "site audit-publish: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "audit-publish" "$pd" "$want_alpha_001"

pd="$(fresh audit-set)"; write_vision_and_audit "$pd" w3; rm -rf "$pd/modules"
run audit-set --audit "$pd/audits/2026-07-13-general.md" --finding F-001 --status accepted --dir "$pd"; rc=$?
ck "site audit-set: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
check_modules "audit-set" "$pd" "$want_alpha_001"

# init and import cannot produce module files (no tags yet), so their wiring is
# proven through the delete entries: a stale modules/ dir in the target dir.
n=$((n + 1)); pd="$WORK/init-$n/docs/product"; mkdir -p "$pd/modules/legacy"
gen_file legacy ROADMAP.md "$pd/modules/legacy/ROADMAP.md"
run init --project w3 --title W3 --dir "$pd"; rc=$?
ck "site scaffold.cjs init: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
ck "site init: stale modules/ removed" "$(absent "$pd/modules")"

n=$((n + 1)); pd="$WORK/import-$n/docs/product"; mkdir -p "$pd/modules/legacy"
gen_file legacy NEXT.md "$pd/modules/legacy/NEXT.md"
cat > "$WORK/legacy.json" <<'EOJ'
{
  "meta": { "title": "Legacy", "version": "v1", "totalSP": 1 },
  "S4_phases": { "id": "S4", "title": "Phases", "phases": [
    { "key": "P0", "name": "First", "window": "KW 1", "sp": 1, "epics": [
      { "name": "E0.1 One", "agent": "x", "stories": [ { "text": "Do it", "sp": 1, "status": "planned" } ] } ] } ] }
}
EOJ
run import --file "$WORK/legacy.json" --project w3 --dir "$pd"; rc=$?
ck "site import.cjs import: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
ck "site import: stale modules/ removed" "$(absent "$pd/modules")"

# ---- AC-1a / AC-2a / hand-edit overwrite -----------------------------------
pd="$(fresh content)"
run changelog --entry e --why w --dir "$pd"
sed -i.bak -e '/id: 001-first-feature/,/stage:/ s/status: planned/status: done/' "$pd/ROADMAP.md"
sed -i.bak -e '/id: 002-second-feature/,/stage:/ s/status: planned/status: cancelled/' "$pd/ROADMAP.md"; rm -f "$pd/ROADMAP.md.bak"
run changelog --entry e2 --why w --dir "$pd"
R="$pd/modules/alpha/ROADMAP.md"
ck "AC-2a: module ROADMAP has header line" "$(has_line "$R" "$(node -e 'process.stdout.write(require(process.argv[1]).GENERATED_HEADER)' "$GUARD_LIB/product-modules.cjs" 2>/dev/null)" && echo true || echo false)"
ck "AC-2a: title line" "$(has_line "$R" '# Module roadmap — alpha' && echo true || echo false)"
ck "AC-2a: section for the epic" "$(has_line "$R" '## m1-first — First Milestone' && echo true || echo false)"
ck "AC-2a: status/target line" "$(has_line "$R" 'Status: in-progress · Target: 2026-08' && echo true || echo false)"
ck "AC-2a: table header" "$(has_line "$R" '| Feature | Title | Status | Stage | Depends on |' && echo true || echo false)"
ck "AC-2a: done row stays listed" "$(has_line "$R" '| 001-first-feature | First Feature | done | none | — |' && echo true || echo false)"
ck "AC-2a: cancelled row stays listed" "$(has_line "$R" '| 002-second-feature | Second Feature | cancelled | none | 001-first-feature |' && echo true || echo false)"
ck "AC-2a: other module's section absent" "$([[ -f "$R" ]] && ! grep -q 'm2-second' "$R" && echo true || echo false)"
ck "AC-2a: beta section present in beta file" "$(has_line "$pd/modules/beta/ROADMAP.md" '## m2-second — Second Milestone' && echo true || echo false)"
ck "AC-1a: alpha NEXT cursor is empty-state (all done/cancelled)" "$([[ "$(cursor_of "$pd/modules/alpha/NEXT.md")" == 'None — no open feature in this module (all done/cancelled, or none planned).' ]] && echo true || echo false)"
ck "AC-1a: beta NEXT cursor 003" "$([[ "$(cursor_of "$pd/modules/beta/NEXT.md")" == '**003-third-feature** — recommended next feature (no unmet dependencies, first eligible feature in roadmap order).' ]] && echo true || echo false)"

echo "hand edit" >> "$R"; echo "hand edit" >> "$pd/modules/beta/NEXT.md"
run changelog --entry e3 --why w --dir "$pd"
ck "hand-edit on module ROADMAP is overwritten" "$([[ -f "$R" ]] && ! grep -q 'hand edit' "$R" && echo true || echo false)"
ck "hand-edit on module NEXT is overwritten" "$([[ -f "$pd/modules/beta/NEXT.md" ]] && ! grep -q 'hand edit' "$pd/modules/beta/NEXT.md" && echo true || echo false)"

# ---- (3) stale directories (AC-7a) -----------------------------------------
pd="$(fresh stale)"; mkdir -p "$pd/modules/legacy"; gen_file legacy ROADMAP.md "$pd/modules/legacy/ROADMAP.md"; gen_file legacy NEXT.md "$pd/modules/legacy/NEXT.md"
run changelog --entry e --why w --dir "$pd"; rc=$?
ck "stale: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
ck "stale: modules/legacy removed" "$(absent "$pd/modules/legacy")"
ck "stale: modules/alpha regenerated" "$(exists "$pd/modules/alpha/NEXT.md")"
ck "stale: modules/beta regenerated" "$(exists "$pd/modules/beta/NEXT.md")"
# untag all milestones -> modules/ gone entirely
sed -i.bak -e '/^    module: /d' -e '/^modules: /d' "$pd/ROADMAP.md"; rm -f "$pd/ROADMAP.md.bak"
run changelog --entry e --why w --dir "$pd"; rc=$?
ck "untag: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
ck "untag: no modules/ directory at all" "$(absent "$pd/modules")"

# B1: foreign entries are never deleted. A sub-directory (or any non-generated
# file) in a stale dir stays; the generated files go; the dir stays; one stderr
# warning line names each kept path; the command carries on (exit 0).
pd="$(fresh foreign)"; mkdir -p "$pd/modules/legacy/sub"; gen_file legacy ROADMAP.md "$pd/modules/legacy/ROADMAP.md"
echo x > "$pd/modules/legacy/sub/keep.md"; echo "my notes" > "$pd/modules/legacy/notes.md"
run changelog --entry e --why w --dir "$pd"; rc=$?
ck "foreign entries: exit 0 (warn and continue)" "$([[ $rc -eq 0 ]] && echo true || echo false)"
ck "foreign entries: sub-directory file survives" "$(has_line "$pd/modules/legacy/sub/keep.md" x && echo true || echo false)"
ck "foreign entries: user note survives byte-for-byte" "$(has_line "$pd/modules/legacy/notes.md" 'my notes' && echo true || echo false)"
ck "foreign entries: generated legacy/ROADMAP.md removed" "$(absent "$pd/modules/legacy/ROADMAP.md")"
ck "foreign entries: stale dir NOT removed (not empty)" "$([[ -d "$pd/modules/legacy" ]] && echo true || echo false)"
ck "foreign entries: warning names modules/legacy/notes.md" "$(grep -q 'warning:.*modules/legacy/notes.md' "$WORK/last.out" && echo true || echo false)"
ck "foreign entries: warning names modules/legacy/sub" "$(grep -q 'warning:.*modules/legacy/sub' "$WORK/last.out" && echo true || echo false)"
ck "foreign entries: alpha/beta still regenerated" "$(exists "$pd/modules/alpha/NEXT.md")"
ck "foreign entries: lock released" "$(absent "$pd/.product-stage.lock.json.lock")"

# a generated-looking name with non-generated content is foreign too
pd="$(fresh lookalike)"; mkdir -p "$pd/modules/legacy"; echo "old" > "$pd/modules/legacy/ROADMAP.md"
run changelog --entry e --why w --dir "$pd"; rc=$?
ck "lookalike: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
ck "lookalike: ROADMAP.md with foreign content survives" "$(has_line "$pd/modules/legacy/ROADMAP.md" old && echo true || echo false)"

# FR-005 / US-023-3: no module in use -> a pre-existing modules/ with foreign content is untouched
n=$((n + 1)); pd="$WORK/nomod-$n/docs/product"; write_roadmap "$pd" w3 "" "" ""
mkdir -p "$pd/modules/foo"; echo "keep me" > "$pd/modules/foo/notes.md"; echo "top" > "$pd/modules/README.md"
before="$(tree_hash "$pd/modules")"
run changelog --entry e --why w --dir "$pd"; rc=$?
ck "no module: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
ck "no module: foreign modules/ byte-identical" "$([[ "$(tree_hash "$pd/modules")" == "$before" ]] && echo true || echo false)"
ck "no module: modules/foo directory kept" "$([[ -d "$pd/modules/foo" ]] && echo true || echo false)"

# B1: symlinks are never followed. Reproductions P7 (modules/ -> outside) and
# P4 (module dir -> outside): abort, nothing written, lock released, outside untouched.
sym_case() { # sym_case <root|moduledir>: the link target is <case>/outside, outside the product dir
  local nm="$1" pd out
  pd="$(fresh "sym-$nm")"; out="$(dirname "$(dirname "$pd")")/outside"
  mkdir -p "$out/alpha"; echo "user file" > "$out/alpha/ROADMAP.md"; echo "user file" > "$out/alpha/keepme.md"
  if [[ "$nm" == root ]]; then ln -s "$out" "$pd/modules"
  else mkdir -p "$pd/modules"; ln -s "$out/alpha" "$pd/modules/alpha"; fi
  local before outbefore; before="$(tree_hash "$pd")"; outbefore="$(tree_hash "$out")"
  run changelog --entry e --why w --dir "$pd"; rc=$?
  ck "symlink $nm: exit non-zero" "$([[ $rc -ne 0 ]] && echo true || echo false)"
  ck "symlink $nm: message mentions symbolic link" "$(grep -q 'symbolic link' "$WORK/last.out" && echo true || echo false)"
  ck "symlink $nm: product tree unchanged (nothing written)" "$([[ "$(tree_hash "$pd")" == "$before" ]] && echo true || echo false)"
  ck "symlink $nm: outside target untouched" "$([[ "$(tree_hash "$out")" == "$outbefore" && -f "$out/alpha/keepme.md" ]] && echo true || echo false)"
  ck "symlink $nm: no lock left" "$(absent "$pd/.product-stage.lock.json.lock")"
}
sym_case root
sym_case moduledir

# B1 / minor 2: modules is a regular file -> clean error (no crash, no lock left)
pd="$(fresh modfile)"; echo "i am a file" > "$pd/modules"
before="$(tree_hash "$pd")"
run changelog --entry e --why w --dir "$pd"; rc=$?
ck "modules is a file: exit non-zero" "$([[ $rc -ne 0 ]] && echo true || echo false)"
ck "modules is a file: clean message, no internal error" "$(grep -q 'not a directory' "$WORK/last.out" && ! grep -qi 'internal error' "$WORK/last.out" && echo true || echo false)"
ck "modules is a file: tree unchanged" "$([[ "$(tree_hash "$pd")" == "$before" ]] && echo true || echo false)"
ck "modules is a file: no lock left" "$(absent "$pd/.product-stage.lock.json.lock")"

# minor 1: rollback restores the MODE of a deleted file (0600 stays 0600)
pd="$(fresh mode)"; setup_stale_gen() { mkdir -p "$1/modules/legacy"; gen_file legacy ROADMAP.md "$1/modules/legacy/ROADMAP.md"; gen_file legacy NEXT.md "$1/modules/legacy/NEXT.md"; }
setup_stale_gen "$pd"; chmod 600 "$pd/modules/legacy/NEXT.md" "$pd/modules/legacy/ROADMAP.md"
A1_TEST_FAIL_RENAME_AT_INDEX=9 node "$TOOLS" product changelog --entry e --why w --dir "$pd" >"$WORK/last.out" 2>&1; rc=$?
ck "mode restore: injected failure at the last op fails the command" "$([[ $rc -ne 0 ]] && echo true || echo false)"
ck "mode restore: deleted NEXT.md is back with mode 600 (got $(mode_of "$pd/modules/legacy/NEXT.md"))" "$([[ "$(mode_of "$pd/modules/legacy/NEXT.md")" == 600 ]] && echo true || echo false)"
ck "mode restore: deleted ROADMAP.md is back with mode 600" "$([[ "$(mode_of "$pd/modules/legacy/ROADMAP.md")" == 600 ]] && echo true || echo false)"

# ---- (2) fault injection at every operation index --------------------------
# fault_sweep <name> <expected-op-count> <setup-fn>: for i in 0..: fresh copy,
# inject failure at i. While the command fails, the tree hash must equal the
# pre-command hash and no tmp file / half-written modules/ entry may remain.
# The first i where the command succeeds equals the operation count.
fault_sweep() {
  local nm="$1" expect="$2" setup="$3" i=0 allok=true count=-1
  while [[ $i -lt 40 ]]; do
    local pd="$WORK/sweep-$nm-$i/docs/product"
    write_roadmap "$pd" w3 "modules: [alpha, beta]" alpha beta
    "$setup" "$pd"
    local before; before="$(tree_hash "$pd")"
    A1_TEST_FAIL_RENAME_AT_INDEX=$i node "$TOOLS" product stage --by 001-first-feature --set done --dir "$pd" >"$WORK/last.out" 2>&1
    local rc=$?
    if [[ $rc -eq 0 ]]; then count=$i; break; fi
    [[ "$(tree_hash "$pd")" == "$before" ]] || { allok=false; echo "  index $i: tree changed after rollback"; }
    [[ -z "$(find "$pd" -name '*.tmp.*')" ]] || { allok=false; echo "  index $i: tmp file left"; }
    [[ ! -e "$pd/.product-stage.lock.json.lock" ]] || { allok=false; echo "  index $i: lock left"; }
    i=$((i + 1))
  done
  ck "fault sweep $nm: operation count is $expect (got $count)" "$([[ $count -eq $expect ]] && echo true || echo false)"
  ck "fault sweep $nm: every injected index leaves all originals unchanged" "$allok"
}
setup_plain() { :; }
setup_stale() { mkdir -p "$1/modules/legacy"; gen_file legacy ROADMAP.md "$1/modules/legacy/ROADMAP.md"; gen_file legacy NEXT.md "$1/modules/legacy/NEXT.md"; }
# 3 base files + 4 module files = 7
fault_sweep plain 7 setup_plain
# + 2 file deletes + 1 rmdir = 10
fault_sweep stale 10 setup_stale
# module dir is not created by a failed run
pd="$WORK/sweep-nomodules/docs/product"; write_roadmap "$pd" w3 "modules: [alpha, beta]" alpha beta
A1_TEST_FAIL_RENAME_AT_INDEX=6 node "$TOOLS" product stage --by 001-first-feature --set done --dir "$pd" >/dev/null 2>&1
ck "fault at last op: no half-written modules/ directory remains" "$(absent "$pd/modules")"
# last module-file position when ALL modules go away (rmdir of modules/ itself)
setup_all_stale() { mkdir -p "$1/modules/a" "$1/modules/b"; gen_file a NEXT.md "$1/modules/a/NEXT.md"; gen_file b ROADMAP.md "$1/modules/b/ROADMAP.md"; }
all_ok=true; i=0
while [[ $i -lt 20 ]]; do
  pd="$WORK/sweep-allstale-$i/docs/product"; write_roadmap "$pd" w3 "" "" ""; setup_all_stale "$pd"
  before="$(tree_hash "$pd")"; hadroot=$(exists "$pd/modules"); hadsub=$(exists "$pd/modules/a")
  A1_TEST_FAIL_RENAME_AT_INDEX=$i node "$TOOLS" product stage --by 001-first-feature --set done --dir "$pd" >/dev/null 2>&1; rc=$?
  [[ $rc -eq 0 ]] && break
  [[ "$(tree_hash "$pd")" == "$before" && -d "$pd/modules/a" && -d "$pd/modules/b" ]] || { all_ok=false; echo "  index $i: not restored"; }
  i=$((i + 1))
done
ck "fault sweep all-stale (rmdir of modules/ included, $i positions): dirs and files restored" "$all_ok"
ck "fault sweep all-stale: operation count is 8 (3 files + 2 deletes + 2 dir rmdirs + modules/ rmdir; got $i)" "$([[ $i -eq 8 ]] && echo true || echo false)"

# ---- (4) hardening: symlinks, case collisions, unreadable entries, rollback fidelity
# Final rework after the security review (SEC-1..5). Every check drives the real tool.
fresh_plain() { n=$((n + 1)); local d="$WORK/$1-$n/docs/product"; write_roadmap "$d" w3 "" "" ""; echo "$d"; }
sub_of() { dirname "$(dirname "$1")"; }   # product dir -> its fixture root
unchanged() { [[ "$(tree_hash "$1")" == "$2" ]] && echo true || echo false; }
case_insensitive=false
mkdir -p "$WORK/casefs/Probe"; [[ -d "$WORK/casefs/probe" ]] && case_insensitive=true

# SEC-1: symlink spelled with a different case than the in-use module id
pd="$(fresh case-link)"; out="$(sub_of "$pd")/outside"; mkdir -p "$out" "$pd/modules"; echo VICTIM > "$out/ROADMAP.md"
ln -s "$out" "$pd/modules/Alpha"
run changelog --entry x --why y --dir "$pd"; rc=$?
ck "SEC-1: case-variant symlink to an outside dir: exit 1" "$([[ $rc -eq 1 ]] && echo true || echo false)"
ck "SEC-1: outside/ROADMAP.md still VICTIM" "$([[ "$(cat "$out/ROADMAP.md")" == "VICTIM" ]] && echo true || echo false)"
ck "SEC-1: nothing else written outside" "$([[ "$(ls "$out")" == "ROADMAP.md" ]] && echo true || echo false)"
ck "SEC-1: no lock left behind" "$([[ -z "$(ls "$pd"/*.lock* 2>/dev/null)" ]] && echo true || echo false)"
# SEC-1 counter-test: a REAL directory with the other spelling is the same dir on a case-insensitive FS
if [[ "$case_insensitive" == "true" ]]; then
  pd="$(fresh case-real)"; mkdir -p "$pd/modules/Alpha"
  run changelog --entry x --why y --dir "$pd"; rc=$?
  ck "SEC-1 counter: real dir modules/Alpha (same dir as alpha) is still written, exit 0" "$([[ $rc -eq 0 && -f "$pd/modules/alpha/ROADMAP.md" ]] && echo true || echo false)"
else
  echo "SKIP  SEC-1 counter: filesystem is case-sensitive"
fi
# case collision on any filesystem: a case-variant FILE next to an in-use id that is not the same dir
if [[ "$case_insensitive" == "false" ]]; then
  pd="$(fresh case-coll)"; mkdir -p "$pd/modules/alpha" "$pd/modules/Alpha"
  run changelog --entry x --why y --dir "$pd"; rc=$?
  ck "SEC-1: distinct case-variant dir next to an in-use id: exit 1 (collision)" "$([[ $rc -eq 1 ]] && grep -q 'collides' "$WORK/last.out" && echo true || echo false)"
fi

# SEC-2: write target that is a symlink (also under fault injection / rollback)
for idx in none 3 6; do
  pd="$(fresh sym-target)"; out="$(sub_of "$pd")/o.md"; echo "SECRET" > "$out"; mkdir -p "$pd/modules/alpha"; ln -s "$out" "$pd/modules/alpha/ROADMAP.md"
  if [[ "$idx" == "none" ]]; then run changelog --entry x --why y --dir "$pd"; rc=$?
  else A1_TEST_FAIL_RENAME_AT_INDEX=$idx node "$TOOLS" product changelog --entry x --why y --dir "$pd" >"$WORK/last.out" 2>&1; rc=$?; fi
  ck "SEC-2 [$idx]: symlink write target: exit 1" "$([[ $rc -eq 1 ]] && echo true || echo false)"
  ck "SEC-2 [$idx]: link still a symlink, outside file intact, no regular file materialised" "$([[ -L "$pd/modules/alpha/ROADMAP.md" && "$(cat "$out")" == "SECRET" ]] && echo true || echo false)"
  ck "SEC-2 [$idx]: nothing from the transaction was written (index.json absent)" "$(absent "$pd/index.json")"
  ck "SEC-2 [$idx]: no leftover tmp" "$([[ -z "$(find "$pd" -name '*.tmp.*')" ]] && echo true || echo false)"
done
# target is a directory: no tmp left behind (Reinhard N7)
pd="$(fresh dir-target)"; mkdir -p "$pd/modules/alpha/ROADMAP.md"; h="$(tree_hash "$pd")"
run changelog --entry x --why y --dir "$pd"; rc=$?
ck "N7: directory as write target: exit 1, tree unchanged, no .tmp left" "$([[ $rc -eq 1 && "$(unchanged "$pd" "$h")" == "true" && -z "$(find "$pd" -name '*.tmp.*')" ]] && echo true || echo false)"

# SEC-3: unreadable entries are foreign, never an abort (name checked before reading)
for mode in module plain; do
  if [[ "$mode" == "module" ]]; then pd="$(fresh unread)"; else pd="$(fresh_plain unread)"; fi
  mkdir -p "$pd/modules/legacy"; echo s > "$pd/modules/legacy/secret.md"; chmod 000 "$pd/modules/legacy/secret.md"
  echo s > "$pd/modules/legacy/ROADMAP.md"; chmod 000 "$pd/modules/legacy/ROADMAP.md"
  run changelog --entry x --why y --dir "$pd"; rc=$?
  ck "SEC-3 [$mode]: unreadable files in a stale dir: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
  ck "SEC-3 [$mode]: both files kept" "$([[ -e "$pd/modules/legacy/secret.md" && -e "$pd/modules/legacy/ROADMAP.md" ]] && echo true || echo false)"
  chmod 600 "$pd/modules/legacy/secret.md" "$pd/modules/legacy/ROADMAP.md"
done
# the name check precedes the read: a non-ROADMAP/NEXT name is never opened (000 file, no warning difference needed)
# and the read covers only the header prefix: a huge generated-looking file is still recognised
pd="$(fresh_plain prefix)"; mkdir -p "$pd/modules/legacy"; gen_file legacy NEXT.md "$pd/modules/legacy/NEXT.md"; head -c 3000000 /dev/zero | tr '\0' 'x' >> "$pd/modules/legacy/NEXT.md"
run changelog --entry x --why y --dir "$pd"; rc=$?
ck "SEC-3: generated-header file with a big body is still deleted (prefix check), stale dir gone" "$([[ $rc -eq 0 && ! -e "$pd/modules/legacy" ]] && echo true || echo false)"

# SEC-4: rmdir rollback keeps the directory mode
all_ok=true; seen_fail=0
for i in 0 1 2 3 4 5 6 7 8 9; do
  pd="$(fresh_plain rmdirmode)"; mkdir -p "$pd/modules/gamma"; gen_file gamma ROADMAP.md "$pd/modules/gamma/ROADMAP.md"; chmod 600 "$pd/modules/gamma/ROADMAP.md"; chmod 700 "$pd/modules/gamma"
  A1_TEST_FAIL_RENAME_AT_INDEX=$i node "$TOOLS" product changelog --entry x --why y --dir "$pd" >/dev/null 2>&1; rc=$?
  [[ $rc -eq 0 ]] && continue
  seen_fail=$((seen_fail + 1))
  [[ "$(mode_of "$pd/modules/gamma")" == "700" && "$(mode_of "$pd/modules/gamma/ROADMAP.md")" == "600" ]] || { all_ok=false; echo "  index $i: dir=$(mode_of "$pd/modules/gamma") file=$(mode_of "$pd/modules/gamma/ROADMAP.md")"; }
done
ck "SEC-4: rolled-back stale dir keeps mode 700 (file 600) at every fault index ($seen_fail failing positions)" "$([[ "$all_ok" == "true" && $seen_fail -gt 0 ]] && echo true || echo false)"

# SEC-5: binary-safe backups
pd="$(fresh bin)"; mkdir -p "$pd/modules/alpha"; printf '\x00\xff\xfe\x80binary\x00\xff' > "$pd/modules/alpha/ROADMAP.md"; cp "$pd/modules/alpha/ROADMAP.md" "$WORK/bin.orig"
A1_TEST_FAIL_RENAME_AT_INDEX=6 node "$TOOLS" product changelog --entry x --why y --dir "$pd" >/dev/null 2>&1; rc=$?
ck "SEC-5: write target with 0x00/0xFF bytes is byte-identical after rollback" "$([[ $rc -eq 1 ]] && cmp -s "$WORK/bin.orig" "$pd/modules/alpha/ROADMAP.md" && echo true || echo false)"

# Policy: no module in use never aborts because of modules/ (FR-005 priority)
pd="$(fresh_plain nomod-link)"; out="$(sub_of "$pd")/out"; mkdir -p "$out/legacy"; gen_file legacy ROADMAP.md "$out/legacy/ROADMAP.md"; ln -s "$out" "$pd/modules"; h="$(tree_hash "$out")"
run changelog --entry x --why y --dir "$pd"; rc=$?
ck "policy: no module, modules/ is a symlink: exit 0" "$([[ $rc -eq 0 ]] && echo true || echo false)"
ck "policy: ... target tree untouched (nothing read through, written or deleted)" "$(unchanged "$out" "$h")"
ck "policy: ... exactly one modules/ warning" "$([[ "$(grep -c 'modules/ skipped' "$WORK/last.out")" == "1" ]] && echo true || echo false)"
pd="$(fresh_plain nomod-quiet)"; mkdir -p "$pd/modules/foo" "$(sub_of "$pd")/t"; echo k > "$pd/modules/foo/notes.md"; ln -s "$(sub_of "$pd")/t" "$pd/modules/shared"
echo x > "$pd/modules/loose.txt"
run changelog --entry x --why y --dir "$pd"; rc=$?
ck "policy: no module, foreign entries and stale symlink: exit 0, no warning noise" "$([[ $rc -eq 0 ]] && ! grep -q 'warning' "$WORK/last.out" && [[ -f "$pd/modules/foo/notes.md" && -L "$pd/modules/shared" && -f "$pd/modules/loose.txt" ]] && echo true || echo false)"
pd="$(fresh stale-link)"; out="$(sub_of "$pd")/t"; mkdir -p "$out" "$pd/modules"; ln -s "$out" "$pd/modules/shared"
run changelog --entry x --why y --dir "$pd"; rc=$?
ck "policy: module in use, stale slug-named symlink: exit 0, kept, warned once" "$([[ $rc -eq 0 && -L "$pd/modules/shared" && "$(grep -c 'modules/shared' "$WORK/last.out")" == "1" ]] && echo true || echo false)"

# Defense in depth (locks.prepareOps): a target whose parent resolves outside `within` aborts before any write,
# even when the planner was fooled. Drives the real exported writeAllOrNothing.
did="$WORK/did"; mkdir -p "$did/prod" "$did/outside"; ln -s "$did/outside" "$did/prod/linked"
node -e '
  const L = require(process.argv[1] + "/locks.cjs"); const path = require("path");
  const prod = process.argv[2];
  L.writeAllOrNothing(path.join(prod, "x.lock"), [
    { target: path.join(prod, "ok.txt"), content: "ok", within: prod },
    { target: path.join(prod, "linked", "evil.txt"), content: "evil", within: prod },
  ], "probe");
' "$GUARD_LIB" "$did/prod" >"$WORK/last.out" 2>&1; rc=$?
ck "defense in depth: parent resolving outside the allowed root aborts (exit 1)" "$([[ $rc -eq 1 ]] && echo true || echo false)"
ck "defense in depth: nothing written outside, nothing written before the abort" "$([[ -z "$(ls "$did/outside")" ]] && absent "$did/prod/ok.txt" | grep -q true && echo true || echo false)"

# ---- static caller guard ---------------------------------------------------
callers="$(grep -n 'regenerateDerived(' "$GUARD_LIB"/*.cjs | grep -v '/product-derived.cjs:' | grep -vc '^\S*:[0-9]*:\s*\(//\|\*\)')"
uses="$(grep -n 'derivedWrites(' "$GUARD_LIB"/*.cjs | grep -v 'function derivedWrites' | grep -vc '^\S*:[0-9]*:\s*\(//\|\*\)')"
ck "static guard: regenerateDerived call sites ($callers) == derivedWrites uses ($uses), both 8" "$([[ "$callers" -eq "$uses" && "$callers" -eq 8 ]] && echo true || echo false)"

# ---- SC-007 ----------------------------------------------------------------
mkdir -p "$WORK/perf"
perf="$(node "$DIR/perf-run.cjs" "$TOOLS" "$WORK/perf")"; prc=$?
echo "  perf: $perf"
ck "SC-007: perf run ok and module files written" "$([[ $prc -eq 0 && "$perf" == *'"modulesWritten":true'* ]] && echo true || echo false)"
diff_ms="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).diff))' "$perf" 2>/dev/null || echo 99999)"
ck "SC-007: median difference with vs without modules <= 1000 ms ($diff_ms ms)" "$([[ "$diff_ms" -le 1000 ]] && echo true || echo false)"

echo
echo "product-modules run-files.sh: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
