#!/usr/bin/env bash
# Part 04a — Wave 4 agent A, section TX: the product transaction hook
# (vault-mirror.cjs productMirrorHook, passed as writeAllOrNothing's
# `afterCommit` by every product-mutating command in product.cjs) plus the
# slug rules of `vault sync` seen from the transaction side. Sourced by
# run-tests.sh. Cases TX1–TX14 from the wave plan's Wave 4 fixture table, plus
# TX15 (a free --dir is never mirrored). Every case names the single production
# change that turns it red. Listings and counts are literals typed here from
# FR-002 and the files each command writes, never read from the module.
#
# Isolation: every repo and vault lives under `mktemp -d`; HOME and
# A1_VAULT_ROOT point there (or A1_VAULT_ROOT is unset) for every call — the
# real vault is never read or written.
#
# RED record (2026-09-26, section TX run against the pre-wave product.cjs,
# locks.cjs and vault-mirror.cjs): 64 of 118 assertions red — every
# vault_mirror, listing and cmp assertion. Green before the code existed, by
# construction: the exit-code and "no skipped line" halves of TX1–TX9a, the
# absence / "nothing changed" checks (TX4 lock/hub, TX9b root/repos, TX10 kept
# and nothing mirrored, TX11 stderr/.a1/HOME, TX15 untouched), the TX9b exit
# comparison, and TX12–TX14, whose slug rules shipped with `vault sync` in
# Wave 3 (their red-makers are mutations of vault-sync.cjs, measured there
# and again here). Each named mutation below was applied to a throwaway copy
# and turned its case red (Wave 4A report).

T_WORK="$(mktemp -d)"
T_HOME="$T_WORK/home"; T_ERR="$T_WORK/stderr"
mkdir -p "$T_HOME"
T_OUT=""; T_RC=0

# t_run <repo> <vault|""> <product args...> — runs `a1-tools product …` in
# <repo> (default product dir <repo>/docs/product). Sets T_OUT/T_RC, stderr in
# $T_ERR. An empty vault argument runs with A1_VAULT_ROOT unset.
t_run() {
  local repo="$1" vault="$2"; shift 2
  if [[ -n "$vault" ]]; then
    T_OUT="$(cd "$repo" && HOME="$T_HOME" A1_VAULT_ROOT="$vault" A1_CODE_ROOTS="$T_WORK/none" node "$TOOLS" product "$@" 2>"$T_ERR")"; T_RC=$?
  else
    T_OUT="$(cd "$repo" && env -u A1_VAULT_ROOT HOME="$T_HOME" A1_CODE_ROOTS="$T_WORK/none" node "$TOOLS" product "$@" 2>"$T_ERR")"; T_RC=$?
  fi
}

t_git_repo() { mkdir -p "$1"; git -C "$1" init -q 2>/dev/null || git init -q "$1"; }
t_vault() { mkdir -p "$1/project"; printf -- '---\ntype: project\nstatus: build\n---\n# demo\n' > "$1/project/demo.md"; }
t_files() { (cd "$1" 2>/dev/null && find . -type f | sed 's#^\./##' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//'); }
t_skip_lines() { grep -c 'vault mirror skipped' "$T_ERR" | tr -d ' '; }

# t_cmp_mirror <name> <repo> <vault> — every file of the vault product folder
# is byte-identical (cmp) to its repo source, and the folder is not empty.
t_cmp_mirror() {
  local name="$1" src="$2/docs/product" dst="$3/project/demo/product" f bad_files=""
  local listing; listing="$(t_files "$dst")"
  if [[ -z "$listing" ]]; then bad "$name: vault product folder empty"; return; fi
  for f in $listing; do cmp -s "$src/$f" "$dst/$f" || bad_files="$bad_files $f"; done
  if [[ -z "$bad_files" ]]; then ok "$name: cmp 0 for every mirrored file"
  else bad "$name: cmp differs for$bad_files"; fi
}

# t_snap / t_changed — the independent oracle for `vault_mirror.files`: copy
# the vault product folder before a command, then count the files that are
# new or whose bytes differ afterwards (cmp). Never read from the module.
t_snap() { rm -rf "$T_WORK/snap"; mkdir -p "$T_WORK/snap"; cp -R "$T_VAULT/project/demo/product/." "$T_WORK/snap/" 2>/dev/null || true; }
t_changed() {
  local n=0 f
  for f in $(t_files "$T_VAULT/project/demo/product"); do
    cmp -s "$T_WORK/snap/$f" "$T_VAULT/project/demo/product/$f" || n=$((n + 1))
  done
  echo "$n"
}

# t_mirrored <case> <expected listing> <product args...> — snapshot, run the
# command against the sequence repo/vault, then the shared assertions: exit 0,
# vault_mirror ok, `files` equal to the measured number of changed vault files,
# the literal vault listing, byte identity, no skipped line.
t_mirrored() {
  local c="$1" listing="$2"; shift 2
  t_snap
  t_run "$T_REPO" "$T_VAULT" "$@"
  assert_rc "$c exit" 0 "$T_RC" "$(cat "$T_ERR")"
  assert_json "$c vault_mirror.status" "$T_OUT" "j.vault_mirror && j.vault_mirror.status" "ok"
  assert_json "$c vault_mirror.files = changed vault files" "$T_OUT" "j.vault_mirror && j.vault_mirror.files" "$(t_changed)"
  assert_eq "$c vault listing" "$(t_files "$T_VAULT/project/demo/product")" "$listing"
  t_cmp_mirror "$c" "$T_REPO" "$T_VAULT"
  assert_eq "$c no skipped line" "$(t_skip_lines)" "0"
}

T_REPO="$T_WORK/seq/repo"; T_VAULT="$T_WORK/seq/vault"
t_git_repo "$T_REPO"; t_vault "$T_VAULT"
L3="NEXT.md ROADMAP.md index.json"

# ---------- TX1–TX4 SC-001 sequence: init → add-milestone → add-feature → stage ----------
# Red-making change, per case: removing the productMirrorHook(dir) argument
# from THAT command's writeAllOrNothing call (vault_mirror then absent and the
# vault copy stale).
t_mirrored "TX1 init" "$L3" init --project demo --title Demo
assert_json "TX1 files literal (fresh vault, three product files)" "$T_OUT" "j.vault_mirror && j.vault_mirror.files" "3"
t_mirrored "TX2 add-milestone" "$L3" add-milestone --id m1 --title "Milestone one"
t_mirrored "TX3 add-feature" "$L3" add-feature --id 001-login --milestone m1 --title Login
t_mirrored "TX4 stage" "$L3" stage --by 001-login --set started
# the transaction's own lock file never reaches the vault (FR-004)
if [[ -e "$T_VAULT/project/demo/product/.product-stage.lock.json" ]]; then bad "TX4 lock file mirrored"
else ok "TX4 lock file not mirrored"; fi
assert_eq "TX4 hub untouched" "$(cat "$T_VAULT/project/demo.md")" "$(printf -- '---\ntype: project\nstatus: build\n---\n# demo')"

# ---------- TX5–TX7 markers --set / changelog / vision-init + vision-touch ----------
# Red-making change: same, per call site.
t_mirrored "TX5 markers --set" "$L3" markers --level milestone --id m1 --set in-progress
t_mirrored "TX6 changelog" "$L3" changelog --entry "t6 entry" --why "fixture"
t_mirrored "TX7a vision-init" "NEXT.md ROADMAP.md VISION.md index.json" vision-init --title "Demo vision" --pillar "p1:Pillar one:Summary one"
t_mirrored "TX7b vision-touch" "NEXT.md ROADMAP.md VISION.md index.json" vision-touch

# ---------- TX8 feature-init ----------
# Red-making change: same, for cmdProductFeatureInit.
t_mirrored "TX8 feature-init" "NEXT.md ROADMAP.md VISION.md features/001-login/feature.md index.json" feature-init --id 001-login

# ---------- TX9 audit chain: mirrored, then with a missing root ----------
# Red-making changes: (a) removing the hook from audit-publish / audit-set /
# audit-mirror (TX9a status per command); (b) printing the skipped line twice
# in one process (TX9b exactly one line per command). The hook's once-flag is
# not observable through the CLI: every command runs its hook once per process.
T_ANALYSIS="$T_WORK/analysis.md"
cp "$REPO_ROOT/_test-fixtures/product-audit-mirror/fixtures/niimo-2026-07-05-general.md" "$T_ANALYSIS"
T_AUDIT="$T_REPO/docs/product/audits/2026-07-05-general.md"
t_mirrored "TX9a audit-publish" "NEXT.md ROADMAP.md VISION.md audits/2026-07-05-general.md features/001-login/feature.md index.json" audit-publish --analysis "$T_ANALYSIS" --project demo
t_mirrored "TX9a audit-set" "NEXT.md ROADMAP.md VISION.md audits/2026-07-05-general.md features/001-login/feature.md index.json" audit-set --audit "$T_AUDIT" --finding F-001 --status fixed --commit abc1234
t_mirrored "TX9a audit-mirror" "NEXT.md ROADMAP.md VISION.md audits/2026-07-05-general.md features/001-login/feature.md index.json" audit-mirror --audit "$T_AUDIT" --milestone m1
# idempotent re-run: no repo write, the mirror still runs and reports in-sync
t_mirrored "TX9a audit-mirror no-op" "NEXT.md ROADMAP.md VISION.md audits/2026-07-05-general.md features/001-login/feature.md index.json" audit-mirror --audit "$T_AUDIT" --milestone m1

# missing root: every command keeps the vault-free exit code, one warning each
caseTX9b() {
  local free="$T_WORK/t9/free" miss="$T_WORK/t9/miss" rc_free rc_miss cmd
  local absent="$T_WORK/t9/nonexistent"
  for r in "$free" "$miss"; do
    t_git_repo "$r"
    t_run "$r" "" init --project demo --title Demo
    t_run "$r" "" add-milestone --id m1 --title M1
  done
  for cmd in publish set mirror; do
    local args=()
    case "$cmd" in
      publish) args=(audit-publish --analysis "$T_ANALYSIS" --project demo) ;;
      set)     args=(audit-set --audit docs/product/audits/2026-07-05-general.md --finding F-002 --status fixed --commit abc1234) ;;
      mirror)  args=(audit-mirror --audit docs/product/audits/2026-07-05-general.md --milestone m1) ;;
    esac
    t_run "$free" "" "${args[@]}"; rc_free=$T_RC
    t_run "$miss" "$absent" "${args[@]}"; rc_miss=$T_RC
    assert_eq "TX9b audit-$cmd exit equals vault-free run" "$rc_miss" "$rc_free"
    assert_eq "TX9b audit-$cmd exactly one skipped line" "$(t_skip_lines)" "1"
    assert_json "TX9b audit-$cmd status skipped" "$T_OUT" "j.vault_mirror && j.vault_mirror.status" "skipped"
  done
  if [[ -e "$absent" ]]; then bad "TX9b missing root was created"; else ok "TX9b missing root not created"; fi
  assert_eq "TX9b repos identical (index.json carries a timestamp)" "$(diff -r -x index.json "$free/docs/product" "$miss/docs/product" >/dev/null 2>&1; echo $?)" "0"
}
caseTX9b

# ---------- TX10 unwritable root: write kept, exit 0, one warning ----------
# Red-making change: rethrowing from the hook (or running it inside the
# rollback try) — the stage exits non-zero and/or the repo write is reverted.
caseTX10() {
  local r="$T_WORK/t10/repo" v="$T_WORK/t10/vault"
  t_git_repo "$r"; t_vault "$v"
  t_run "$r" "" init --project demo --title Demo
  t_run "$r" "" add-milestone --id m1 --title M1
  t_run "$r" "" add-feature --id 001-login --milestone m1 --title Login
  chmod 0555 "$v"
  t_run "$r" "$v" stage --by 001-login --set started
  chmod 0755 "$v"
  assert_rc "TX10 stage exit" 0 "$T_RC" "$(cat "$T_ERR")"
  assert_json "TX10 status skipped" "$T_OUT" "j.vault_mirror && j.vault_mirror.status" "skipped"
  assert_eq "TX10 one skipped line" "$(t_skip_lines)" "1"
  assert_eq "TX10 repo write kept" "$(grep -c 'stage: started' "$r/docs/product/ROADMAP.md" | tr -d ' ')" "1"
  if [[ -e "$v/project/demo/product" ]]; then bad "TX10 mirror written into read-only root"; else ok "TX10 nothing mirrored"; fi
}
caseTX10

# ---------- TX11 inactive: no vault configured (SC-002 / FR-037) ----------
# Byte-identical to the pre-feature release: no `vault_mirror` key, no stderr.
# Red-making change: emitting {status:'inactive'} (EMIT_INACTIVE_RESULT=true),
# printing the skipped line, or resolving vaultRootInfo() (which creates
# .a1/learnings/) when A1_VAULT_ROOT is unset.
caseTX11() {
  local r="$T_WORK/t11/repo"
  t_git_repo "$r"
  t_run "$r" "" init --project demo --title Demo
  assert_rc "TX11 init exit" 0 "$T_RC"
  assert_json "TX11 no vault_mirror key" "$T_OUT" "Object.prototype.hasOwnProperty.call(j, 'vault_mirror')" "false"
  assert_json "TX11 result keys unchanged" "$T_OUT" "Object.keys(j).join(',')" "status,project,files_written"
  assert_eq "TX11 stderr empty" "$(cat "$T_ERR")" ""
  if [[ -e "$r/.a1" ]]; then bad "TX11 .a1/ created in the repo"; else ok "TX11 no .a1/ created"; fi
  assert_eq "TX11 no project dir under HOME" "$(find "$T_HOME" -path '*project*' | wc -l | tr -d ' ')" "0"
}
caseTX11

# ---------- TX12 slug mismatch (vault sync, FR-009) ----------
# Red-making change: trusting the argv slug over the roadmap `project:`.
# ---------- TX13 no roadmap (FR-009) ----------
# Red-making change: defaulting the slug to the directory name.
# ---------- TX14 duplicate roadmaps (FR-015) ----------
# Red-making change: scanning only cwd (dropping the codeRoots() scan).
t_sync() {
  local repo="$1" vault="$2" code="$3"; shift 3
  T_OUT="$(cd "$repo" && HOME="$T_HOME" A1_VAULT_ROOT="$vault" A1_CODE_ROOTS="$code" node "$TOOLS" vault sync "$@" 2>"$T_ERR")"; T_RC=$?
}
caseTX12to14() {
  local code="$T_WORK/t12/code" v="$T_WORK/t12/vault" marker="$T_WORK/t12/marker"
  t_vault "$v"
  t_git_repo "$code/one"; t_run "$code/one" "" init --project demo --title Demo
  t_sync "$code/one" "$v" "$code" otherslug
  assert_rc "TX12 mismatch exit" 1 "$T_RC"
  assert_eq "TX12 names both slugs" "$(grep -c 'otherslug.*demo\|demo.*otherslug' "$T_ERR" | tr -d ' ')" "1"

  t_git_repo "$code/bare"; mkdir -p "$code/bare/.a1/phases/M1-P1"; printf '# goal\n' > "$code/bare/.a1/phases/M1-P1/GOAL.md"
  t_sync "$code/bare" "$v" "$code"
  assert_rc "TX13 no roadmap, no --slug exit" 1 "$T_RC"
  assert_eq "TX13 asks for --slug" "$(grep -c -- '--slug' "$T_ERR" | tr -d ' ')" "1"
  t_sync "$code/bare" "$v" "$code" --slug phaseonly
  assert_rc "TX13 --slug exit" 0 "$T_RC" "$(cat "$T_ERR")"
  if [[ -e "$v/project/phaseonly/product" ]]; then bad "TX13 product/ created"; else ok "TX13 product/ absent"; fi
  assert_eq "TX13 phases mirrored" "$(t_files "$v/project/phaseonly/phases")" "M1-P1/GOAL.md"

  t_git_repo "$code/two"; t_run "$code/two" "" init --project demo --title Demo2
  touch "$marker"; sleep 1
  t_sync "$code/one" "$v" "$code" demo
  assert_rc "TX14 duplicate exit" 1 "$T_RC"
  local p1 p2; p1="$(cd "$code/one" && pwd -P)"; p2="$(cd "$code/two" && pwd -P)"
  if grep -q "t12/code/one" "$T_ERR" && grep -q "t12/code/two" "$T_ERR"; then ok "TX14 names both repo paths"
  else bad "TX14 names both repo paths ($(cat "$T_ERR"); want $p1 and $p2)"; fi
  assert_eq "TX14 nothing written" "$(find "$v" -newer "$marker" | wc -l | tr -d ' ')" "0"
}
caseTX12to14

# ---------- TX15 a free --dir is never mirrored ----------
# Red-making change: deriving the repo root from a product dir that is not
# <repo>/docs/product (a scratch dir would then overwrite the slug's mirror).
caseTX15() {
  local d="$T_WORK/t15/scratch" v="$T_WORK/t15/vault"
  t_vault "$v"; mkdir -p "$d"
  t_run "$T_WORK/t15" "$v" init --project demo --title Demo --dir "$d"
  assert_rc "TX15 exit" 0 "$T_RC" "$(cat "$T_ERR")"
  assert_json "TX15 status skipped" "$T_OUT" "j.vault_mirror && j.vault_mirror.status" "skipped"
  assert_eq "TX15 one skipped line naming docs/product" "$(grep -c 'vault mirror skipped: product dir is not <repo>/docs/product' "$T_ERR" | tr -d ' ')" "1"
  if [[ -e "$v/project/demo/product" ]]; then bad "TX15 scratch dir mirrored"; else ok "TX15 vault untouched"; fi
}
caseTX15

rm -rf "$T_WORK"
