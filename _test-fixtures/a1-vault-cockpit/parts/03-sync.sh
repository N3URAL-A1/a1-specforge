#!/usr/bin/env bash
# Part 03 — Wave 3, section C: `a1-tools vault sync` and `a1-tools vault status`
# (_shared/lib/vault-sync.cjs), driven through the real CLI. Sourced by
# run-tests.sh. Cases C1–C11 from the wave plan's Wave 3 fixture table, plus
# C12–C17 for the slug rules (FR-009/FR-015), flag hygiene, the FR-010 skip
# (C16/C16b: sync, status, lint and link-hub — review M1) and the prune
# boundary against a linked set folder. Every case names the
# single production change that turns it red. Counts and paths are literals
# typed here from the planted tree, never read from the module under test.
#
# Isolation: every repo and vault lives under `mktemp -d`; HOME, A1_VAULT_ROOT
# and A1_CODE_ROOTS point there for every call — the real vault is never read.
#
# RED record (2026-09-26, section C run before vault-sync.cjs and its router
# lines existed — `vault sync|status` were unknown subcommands, usage exit 1):
# 52 of 79 assertions red. Green before the code existed, by construction:
# exit-code halves whose expected code is 1 (usage exit), the absence /
# "nothing changed" checks (C5, C7, C8 no store, C9/C11/C12/C13 untouched,
# C14 product absent, C16 root not created, C17 victim survives) and the C13
# setup check. Each is the negative half of a red positive in the same case;
# the named mutations (Wave 3 report) each turn their case red, except the
# plain-unlink one, which C17 documents as unreachable defence in depth.

C_WORK="$(mktemp -d)"
C_HOME="$C_WORK/home"; C_CODE="$C_WORK/code"; C_ERR="$C_WORK/stderr"
mkdir -p "$C_HOME" "$C_CODE"
C_OUT=""; C_RC=0

# c_run <repo> <vault|""> <vault-subcommand args...> — sets C_OUT/C_RC, stderr
# in $C_ERR. An empty vault argument runs with A1_VAULT_ROOT unset.
# A1_CODE_ROOTS is the repo's own parent dir: each case's repos are alone
# there, so the FR-015 duplicate scan sees only what the case planted.
c_run() {
  local repo="$1" vault="$2" code; shift 2
  code="$(dirname "$repo")"
  if [[ -n "$vault" ]]; then
    C_OUT="$(cd "$repo" && HOME="$C_HOME" A1_VAULT_ROOT="$vault" A1_CODE_ROOTS="$code" node "$TOOLS" vault "$@" 2>"$C_ERR")"; C_RC=$?
  else
    C_OUT="$(cd "$repo" && env -u A1_VAULT_ROOT HOME="$C_HOME" A1_CODE_ROOTS="$code" node "$TOOLS" vault "$@" 2>"$C_ERR")"; C_RC=$?
  fi
}

# make_sync_repo <dir> [project] — a git repo with exactly 11 mirrorable files
# (product 5: ROADMAP, VISION, NEXT, index.json, one feature; phases 6: M1-P1
# ×4, M1-P2 GOAL, RESEARCH) plus non-whitelisted noise. Without a project
# argument no ROADMAP.md is written (phase-only repo, 7 → 6 phase files).
make_sync_repo() {
  local r="$1" project="${2:-}"
  mkdir -p "$r/docs/product/features/001-login" "$r/.a1/phases/M1-P1" "$r/.a1/phases/M1-P2"
  git -C "$r" init -q 2>/dev/null || git init -q "$r"
  if [[ -n "$project" ]]; then
    printf -- '---\nproject: %s\nstatus: active\n---\n# Roadmap\n' "$project" > "$r/docs/product/ROADMAP.md"
  fi
  printf 'vision\n' > "$r/docs/product/VISION.md"
  printf 'next up\n' > "$r/docs/product/NEXT.md"
  printf '{"features":[]}\n' > "$r/docs/product/index.json"
  printf '# feature 001\n' > "$r/docs/product/features/001-login/feature.md"
  printf 'not mirrored\n' > "$r/docs/product/notes.md"
  printf '{}\n' > "$r/docs/product/reservations.json"
  for f in GOAL PLAN STATUS VERIFICATION MAP; do printf '# %s P1\n' "$f" > "$r/.a1/phases/M1-P1/$f.md"; done
  printf '{"a":1}\n' > "$r/.a1/phases/M1-P1/observations.jsonl"
  printf '# GOAL P2\n' > "$r/.a1/phases/M1-P2/GOAL.md"
  printf '# research\n' > "$r/.a1/RESEARCH.md"
}

# make_sync_vault <dir> — a vault with the hub note project/demo.md only.
make_sync_vault() {
  mkdir -p "$1/project"
  printf -- '---\ntype: project\nstatus: build\n---\n# demo\n\n## Relations\n' > "$1/project/demo.md"
}

c_files() { (cd "$1" 2>/dev/null && find . -type f | sed 's#^\./##' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//'); }
c_newer() { (cd "$1" && find . -newer "$2" | sed 's#^\./##' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//'); }

C_REPO="$C_CODE/repo"; C_VAULT="$C_WORK/vault"
make_sync_repo "$C_REPO" demo; make_sync_vault "$C_VAULT"
C_PRODUCT="$C_VAULT/project/demo/product"; C_PHASES="$C_VAULT/project/demo/phases"

# ---------- C1 sync counts, then idempotence ----------
# Red-making change: counting `unchanged` entries as `added` (second run then
# reports added 11).
caseC1() {
  c_run "$C_REPO" "$C_VAULT" sync demo
  assert_rc "C1 first sync exits 0" 0 "$C_RC" "$(head -c 300 "$C_ERR")"
  assert_json "C1 first sync: added 11, updated 0, unchanged 0, extra 0, pruned 0" "$C_OUT" \
    "[j.added, j.updated, j.unchanged, j.extra, j.pruned].join(',')" "11,0,0,0,0"
  assert_eq "C1 the vault holds the 11 planted files" "$(c_files "$C_VAULT/project/demo")" \
    "phases/M1-P1/GOAL.md phases/M1-P1/PLAN.md phases/M1-P1/STATUS.md phases/M1-P1/VERIFICATION.md phases/M1-P2/GOAL.md phases/RESEARCH.md product/NEXT.md product/ROADMAP.md product/VISION.md product/features/001-login/feature.md product/index.json"
  c_run "$C_REPO" "$C_VAULT" sync demo
  assert_json "C1 second sync: added 0, unchanged 11" "$C_OUT" "[j.added, j.unchanged].join(',')" "0,11"
  c_run "$C_REPO" "$C_VAULT" status demo --json
  assert_rc "C1 status after sync exits 0 (no drift)" 0 "$C_RC"
  assert_json "C1 status reports 11 in sync, 0 drift" "$C_OUT" "[j.in_sync, j.drift].join(',')" "11,0"
}

# ---------- C2 missing + C7 read-only status ----------
# C2 red-making change: reporting `add` plans as `stale` instead of `missing`.
# C7 red-making change: status calling applyMirror (or writing a tmp file) —
# with a missing and a stale file present, any write shows up under -newer and
# the missing file comes back.
caseC2C7() {
  rm "$C_PRODUCT/NEXT.md"
  sed -i.bak 's/^# GOAL P2$/# GOAL Q2/' "$C_PHASES/M1-P2/GOAL.md" && rm -f "$C_PHASES/M1-P2/GOAL.md.bak"
  touch "$C_WORK/marker.c7"; sleep 1
  c_run "$C_REPO" "$C_VAULT" status demo --json
  assert_rc "C2 status with a deleted mirror file exits 1" 1 "$C_RC"
  assert_json "C2 findings: missing product/NEXT.md, stale phases/M1-P2/GOAL.md" "$C_OUT" \
    "j.findings.map(f => f.class + ' ' + f.path).join(',')" "stale phases/M1-P2/GOAL.md,missing product/NEXT.md"
  assert_eq "C7 status changed nothing under the vault (find -newer marker is empty)" "$(c_newer "$C_VAULT" "$C_WORK/marker.c7")" ""
  [[ ! -e "$C_PRODUCT/NEXT.md" ]] && ok "C7 status did not restore the missing file" || bad "C7 status wrote product/NEXT.md"
  c_run "$C_REPO" "$C_VAULT" status demo
  assert_eq "C2 human output: one line per finding" "$C_OUT" "$(printf 'stale  phases/M1-P2/GOAL.md\nmissing  product/NEXT.md')"
  c_run "$C_REPO" "$C_VAULT" sync demo
  assert_json "C2 sync restores: added 1, updated 1" "$C_OUT" "[j.added, j.updated].join(',')" "1,1"
  cmp -s "$C_REPO/docs/product/NEXT.md" "$C_PRODUCT/NEXT.md" && ok "C2 restored NEXT.md is byte-identical" || bad "C2 NEXT.md differs after sync"
}

# ---------- C3 stale, same length ----------
# Red-making change: comparing sizes instead of bytes (active → paused keeps
# the length, so a size compare stays blind).
caseC3() {
  sed -i.bak 's/^status: active$/status: paused/' "$C_PRODUCT/ROADMAP.md" && rm -f "$C_PRODUCT/ROADMAP.md.bak"
  c_run "$C_REPO" "$C_VAULT" status demo --json
  assert_rc "C3 status after a same-length vault edit exits 1" 1 "$C_RC"
  assert_json "C3 the edit is class stale" "$C_OUT" "j.findings.map(f => f.class + ' ' + f.path).join(',')" "stale product/ROADMAP.md"
  c_run "$C_REPO" "$C_VAULT" sync demo
  cmp -s "$C_REPO/docs/product/ROADMAP.md" "$C_PRODUCT/ROADMAP.md" && ok "C3 sync restores ROADMAP.md" || bad "C3 ROADMAP.md still differs"
}

# ---------- C4 extra, dry-run prune, prune ----------
# Red-making change: the dry-run path still calling unlinkSync (foreign.md is
# gone after `--dry-run --prune`).
caseC4() {
  printf 'foreign\n' > "$C_PRODUCT/foreign.md"
  c_run "$C_REPO" "$C_VAULT" sync demo
  assert_json "C4 sync without --prune: extra 1, pruned 0" "$C_OUT" "[j.extra, j.pruned].join(',')" "1,0"
  [[ -f "$C_PRODUCT/foreign.md" ]] && ok "C4 foreign.md survives sync without --prune" || bad "C4 foreign.md deleted without --prune"
  c_run "$C_REPO" "$C_VAULT" sync demo --dry-run --prune
  assert_json "C4 --dry-run --prune lists delete product/foreign.md" "$C_OUT" \
    "j.planned.map(p => p.action + ' ' + p.path).join(',')" "delete product/foreign.md"
  [[ -f "$C_PRODUCT/foreign.md" ]] && ok "C4 foreign.md still exists after --dry-run --prune" || bad "C4 dry-run deleted foreign.md"
  c_run "$C_REPO" "$C_VAULT" sync demo --prune
  assert_json "C4 --prune: pruned 1" "$C_OUT" "j.pruned" "1"
  [[ ! -e "$C_PRODUCT/foreign.md" ]] && ok "C4 --prune removed foreign.md" || bad "C4 foreign.md survived --prune"
}

# ---------- C5 prune boundary ----------
# Red-making change: prune walking project/<slug>/ instead of the two set
# folders (spec/ and plans/ files would then be extra and deleted).
caseC5() {
  mkdir -p "$C_VAULT/project/demo/spec" "$C_VAULT/project/demo/plans"
  printf 'spec\n' > "$C_VAULT/project/demo/spec/foreign.md"
  printf 'plan\n' > "$C_VAULT/project/demo/plans/x.md"
  cp "$C_VAULT/project/demo.md" "$C_WORK/hub.c5"
  printf 'foreign\n' > "$C_PHASES/M1-P1/foreign.md"
  c_run "$C_REPO" "$C_VAULT" sync demo --prune
  assert_json "C5 --prune removes the phases extra only: pruned 1" "$C_OUT" "j.pruned" "1"
  [[ -f "$C_VAULT/project/demo/spec/foreign.md" && -f "$C_VAULT/project/demo/plans/x.md" ]] \
    && ok "C5 spec/foreign.md and plans/x.md survive --prune" || bad "C5 --prune deleted outside product/ and phases/"
  cmp -s "$C_WORK/hub.c5" "$C_VAULT/project/demo.md" && ok "C5 hub note unchanged" || bad "C5 hub note changed"
}

# ---------- C6 conflict copies, both patterns ----------
# Red-making change: matching only ` (conflict` (the .sync-conflict- assert
# goes red) or only `.sync-conflict-` (the spec/ assert goes red).
caseC6() {
  local a="$C_VAULT/project/demo/spec/x (conflicted copy 2026-09-24).md"
  local b="$C_PRODUCT/ROADMAP.sync-conflict-20260924-120000-ABC.md"
  printf 'copy a\n' > "$a"; printf 'copy b\n' > "$b"
  cp "$a" "$C_WORK/c6a"; cp "$b" "$C_WORK/c6b"
  c_run "$C_REPO" "$C_VAULT" status demo --json
  assert_rc "C6 status with conflict copies exits 1" 1 "$C_RC"
  assert_json "C6 spec/ conflict copy (\" (conflict\" pattern) is one conflict entry" "$C_OUT" \
    "j.findings.filter(f => f.class === 'conflict' && f.path === 'spec/x (conflicted copy 2026-09-24).md').length" "1"
  assert_json "C6 product/ conflict copy (\".sync-conflict-\" pattern) is one conflict entry" "$C_OUT" \
    "j.findings.filter(f => f.class === 'conflict' && f.path === 'product/ROADMAP.sync-conflict-20260924-120000-ABC.md').length" "1"
  assert_json "C6 counts: conflict 2, extra 0 (a conflict copy is not also extra)" "$C_OUT" "[j.counts.conflict, j.counts.extra].join(',')" "2,0"
  c_run "$C_REPO" "$C_VAULT" sync demo --prune
  assert_json "C6 --prune deletes no conflict copy: pruned 0" "$C_OUT" "j.pruned" "0"
  cmp -s "$C_WORK/c6a" "$a" && ok "C6 spec/ conflict copy byte-identical after --prune" || bad "C6 spec/ conflict copy changed"
  cmp -s "$C_WORK/c6b" "$b" && ok "C6 product/ conflict copy byte-identical after --prune" || bad "C6 product/ conflict copy changed"
  rm -f "$a" "$b"
}

# ---------- C8 repo-local refusal (FR-001) ----------
# Red-making change: falling through to vaultRootInfo()'s repo-local tier and
# mirroring into <repo>/.a1/learnings/project/.
caseC8() {
  local r="$C_WORK/c8/repo" v="$C_WORK/c8/vault" cmd
  make_sync_repo "$r" demo; make_sync_vault "$v"
  for cmd in sync status; do
    c_run "$r" "" "$cmd" demo
    assert_rc "C8 $cmd without A1_VAULT_ROOT exits 2" 2 "$C_RC"
    grep -q "vault $cmd: no external vault root.*A1_VAULT_ROOT" "$C_ERR" && ok "C8 $cmd stderr names the missing external root and A1_VAULT_ROOT" || bad "C8 $cmd stderr: $(head -c 300 "$C_ERR")"
  done
  [[ ! -e "$r/.a1/learnings" ]] && ok "C8 no .a1/learnings/ (and no project/ mirror) in the repo" || bad "C8 repo-local store was written"
  c_run "$r" "$v" sync demo
  assert_rc "C8 the same repo with A1_VAULT_ROOT set syncs (exit 0)" 0 "$C_RC"
}

# ---------- C9 hostile slugs ----------
# Red-making change: skipping assertSafeSegment on the argv slug — the
# traversal shapes then fail later with the kebab-case message instead of the
# path-separator one (the message asserts go red). Runs in a phase-only repo so
# no roadmap-mismatch refusal can mask the slug check.
caseC9() {
  local r="$C_WORK/c9/repo" v="$C_WORK/c9/vault" s long
  make_sync_repo "$r"; make_sync_vault "$v"
  long="$(printf 'a%.0s' $(seq 1 10000))"
  touch "$C_WORK/marker.c9"; sleep 1
  for s in '../../etc' 'x; rm -rf /'; do
    c_run "$r" "$v" sync "$s"
    assert_rc "C9 sync '$s' exits 1" 1 "$C_RC"
    grep -q 'plain identifier without path separators' "$C_ERR" && ok "C9 '$s' refused by the path-segment guard" || bad "C9 '$s' stderr: $(head -c 200 "$C_ERR")"
  done
  c_run "$r" "$v" sync "$long"
  assert_rc "C9 sync with a 10000-char slug exits 1" 1 "$C_RC"
  grep -q 'at most 100 characters' "$C_ERR" && ok "C9 10000-char slug refused by the length bound" || bad "C9 long slug stderr: $(head -c 200 "$C_ERR")"
  assert_eq "C9 vault untouched by all three" "$(c_newer "$v" "$C_WORK/marker.c9")" ""
}

# ---------- C10 set selection ----------
# Red-making change: ignoring --product/--phases (both sets written).
caseC10() {
  local r="$C_WORK/c10/repo" v1="$C_WORK/c10/v1" v2="$C_WORK/c10/v2"
  make_sync_repo "$r" demo; make_sync_vault "$v1"; make_sync_vault "$v2"
  c_run "$r" "$v1" sync demo --product
  assert_json "C10 --product: added 5" "$C_OUT" "j.added" "5"
  [[ -d "$v1/project/demo/product" && ! -e "$v1/project/demo/phases" ]] && ok "C10 --product leaves phases/ absent" || bad "C10 --product: $(c_files "$v1/project/demo")"
  c_run "$r" "$v2" sync demo --phases
  assert_json "C10 --phases: added 6" "$C_OUT" "j.added" "6"
  [[ -d "$v2/project/demo/phases" && ! -e "$v2/project/demo/product" ]] && ok "C10 --phases leaves product/ absent" || bad "C10 --phases: $(c_files "$v2/project/demo")"
  c_run "$r" "$v1" sync demo --product --prune
  assert_json "C10 --product --prune does not treat phases/ as extra" "$C_OUT" "[j.extra, j.pruned].join(',')" "0,0"
}

# ---------- C11 dry-run ----------
# Red-making change: applying in dry-run (files appear under the vault).
caseC11() {
  local r="$C_WORK/c11/repo" v="$C_WORK/c11/vault"
  make_sync_repo "$r" demo; make_sync_vault "$v"
  touch "$C_WORK/marker.c11"; sleep 1
  c_run "$r" "$v" sync demo --dry-run
  assert_rc "C11 --dry-run exits 0" 0 "$C_RC"
  assert_json "C11 --dry-run plans 11 adds" "$C_OUT" "j.planned.filter(p => p.action === 'add').length" "11"
  assert_json "C11 the add list names product/ROADMAP.md and phases/RESEARCH.md" "$C_OUT" \
    "['product/ROADMAP.md', 'phases/RESEARCH.md'].every(x => j.planned.some(p => p.path === x))" "true"
  assert_eq "C11 nothing written (find -newer marker is empty)" "$(c_newer "$v" "$C_WORK/marker.c11")" ""
}

# ---------- C12 slug comes from the roadmap (FR-009) ----------
# Red-making change: trusting the argv slug over docs/product/ROADMAP.md
# `project:` (the mismatch then syncs into project/other/).
caseC12() {
  local r="$C_WORK/c12/repo" v="$C_WORK/c12/vault"
  make_sync_repo "$r" demo; make_sync_vault "$v"
  c_run "$r" "$v" sync other
  assert_rc "C12 sync with a slug that disagrees with the roadmap exits 1" 1 "$C_RC"
  grep -q '"other"' "$C_ERR" && grep -q '"demo"' "$C_ERR" && ok "C12 stderr names both slugs" || bad "C12 stderr: $(cat "$C_ERR")"
  [[ ! -e "$v/project/other" ]] && ok "C12 nothing written under project/other/" || bad "C12 mirrored into the argv slug"
  c_run "$r" "$v" status other
  assert_rc "C12 status with the mismatching slug exits 2 (cannot run)" 2 "$C_RC"
  c_run "$r" "$v" sync
  assert_json "C12 sync without a slug resolves it from the roadmap" "$C_OUT" "[j.slug, j.added].join(',')" "demo,11"
}

# ---------- C13 duplicate claim under the code roots (FR-015) ----------
# Red-making change: dropping the codeRoots() scan (sync then exits 0). The
# worktree arm: treating a git worktree of the SAME repository as a second
# claimant (every sync from a worktree would then refuse).
caseC13() {
  local base="$C_WORK/c13" r v other wt
  r="$base/code/repo"; v="$base/vault"; other="$base/code/other"; wt="$base/code/repo-wt"
  make_sync_repo "$r" demo; make_sync_vault "$v"
  git -C "$r" add -A >/dev/null 2>&1
  HOME="$C_HOME" git -C "$r" -c user.name=t -c user.email=t@example.invalid commit -qm init >/dev/null 2>&1
  HOME="$C_HOME" git -C "$r" worktree add -q "$wt" >/dev/null 2>&1
  [[ -f "$wt/docs/product/ROADMAP.md" ]] && ok "C13 setup: worktree with the same roadmap exists under the code root" || bad "C13 setup: git worktree add failed"
  c_run "$r" "$v" sync demo --dry-run
  assert_rc "C13 a git worktree of the same repo is not a duplicate claim" 0 "$C_RC" "$(head -c 300 "$C_ERR")"
  make_sync_repo "$other" demo
  c_run "$r" "$v" sync demo
  assert_rc "C13 a second repo claiming project demo -> exit 1" 1 "$C_RC"
  grep -q "$r" "$C_ERR" && grep -q "$other" "$C_ERR" && ok "C13 stderr names both repo paths" || bad "C13 stderr: $(cat "$C_ERR")"
  [[ ! -e "$v/project/demo/product" ]] && ok "C13 nothing mirrored on refusal" || bad "C13 mirrored despite the duplicate"
}

# ---------- C14 phase-only repo (FR-009) ----------
# Red-making change: mirroring product/ although the repo has no ROADMAP.md
# (or accepting a slug-less call there).
caseC14() {
  local r="$C_WORK/c14/repo" v="$C_WORK/c14/vault"
  make_sync_repo "$r"; make_sync_vault "$v"
  c_run "$r" "$v" sync
  assert_rc "C14 no ROADMAP.md and no slug -> exit 1" 1 "$C_RC"
  grep -q -- 'vault sync: no docs/product/ROADMAP.md — pass --slug' "$C_ERR" && ok "C14 stderr asks for --slug" || bad "C14 stderr: $(cat "$C_ERR")"
  c_run "$r" "$v" sync --slug demo
  assert_json "C14 --slug demo mirrors phases only: added 6, sets [phases]" "$C_OUT" "[j.added, j.sets.join('+')].join(',')" "6,phases"
  [[ ! -e "$v/project/demo/product" ]] && ok "C14 product/ absent" || bad "C14 product/ was mirrored without a roadmap"
  c_run "$r" "$v" sync --slug demo --product
  assert_rc "C14 --product without a roadmap -> exit 1" 1 "$C_RC"
}

# ---------- C15 unknown flags ----------
# Red-making change: letting parseFlags' leftover `--x` tokens through (they
# land in `_` and would be taken as the slug or ignored).
caseC15() {
  c_run "$C_REPO" "$C_VAULT" sync demo --bogus
  assert_rc "C15 sync --bogus exits 1" 1 "$C_RC"
  grep -q 'unknown flag --bogus' "$C_ERR" && ok "C15 sync stderr names the flag" || bad "C15 stderr: $(cat "$C_ERR")"
  c_run "$C_REPO" "$C_VAULT" status demo --bogus
  assert_rc "C15 status --bogus exits 2 (1 is reserved for drift)" 2 "$C_RC"
}

# ---------- C16 configured root missing or read-only (FR-010) ----------
# FR-010, verbatim: "a configured but missing or read-only root MUST yield
# exit 0 plus that one warning, never exit 2" — for vault sync, status, lint
# and link-hub. Each arm checks the three parts separately: exit 0, exactly one
# `skipped:` line naming the root, and the root not created. Rewritten from
# the spec (review M1, 2026-09-26); the old arm pinned status at exit 2.
# Red-making changes, one per arm:
#   sync      creating the missing root instead of warning + skip;
#   status    throwing cannot_run on rootProblem (exit 2, the old code);
#   lint demo dropping exitIfRootUnusable (exit 2 "project folder not found");
#   lint      the same (exit 0 but no warning — the silent `[]` of the review);
#   link-hub  dropping its rootProblem check (single: exit 1 "artifact not
#             found"; demo --all-specs: exit 1 "hub note missing"; --all-specs
#             without slug: exit 0 but no warning);
#   read-only (C16b) checking R_OK instead of W_OK for the writing commands —
#             the write then fails with EACCES and the command crashes.
c16_arm() {
  local label="$1" v="$2" warn="$3"; shift 3
  c_run "$C_REPO" "$v" "$@"
  assert_rc "C16 $label exits 0" 0 "$C_RC" "$(head -c 300 "$C_ERR")"
  assert_eq "C16 $label: exactly one skipped line" "$(grep -c '^\[a1-tools\] .*skipped: ' "$C_ERR" | tr -d ' ')" "1"
  assert_eq "C16 $label: the warning names the root" \
    "$(grep -cF "[a1-tools] $warn skipped: vault root does not exist: $v" "$C_ERR" | tr -d ' ')" "1"
  [[ ! -e "$v" ]] && ok "C16 $label: the missing root was not created" || bad "C16 $label: vault root was created"
}
caseC16() {
  local v="$C_WORK/c16/absent-vault"
  c16_arm "sync demo" "$v" "vault mirror" sync demo
  assert_json "C16 sync JSON status skipped" "$C_OUT" "j.status" "skipped"
  c16_arm "status demo" "$v" "vault status" status demo
  c16_arm "status demo --json" "$v" "vault status" status demo --json
  assert_json "C16 status JSON status skipped" "$C_OUT" "j.status" "skipped"
  c16_arm "lint demo" "$v" "vault lint" lint demo
  if grep -q 'project folder' "$C_ERR"; then bad "C16 lint demo blames the project folder: $(cat "$C_ERR")"
  else ok "C16 lint demo does not blame the project folder"; fi
  c16_arm "lint (all slugs)" "$v" "vault lint" lint
  c16_arm "lint --fix-type" "$v" "vault lint" lint demo --fix-type
  c16_arm "link-hub demo --spec 001-x" "$v" "vault link-hub" link-hub demo --spec 001-x
  assert_json "C16 link-hub JSON status skipped" "$C_OUT" "j.status" "skipped"
  c16_arm "link-hub demo --all-specs" "$v" "vault link-hub" link-hub demo --all-specs
  c16_arm "link-hub --all-specs" "$v" "vault link-hub" link-hub --all-specs
}

# C16b — a configured root that exists but is read-only (chmod -R a-w):
# every command that WRITES (sync, lint --fix-type, link-hub) warns once and
# exits 0; nothing in the vault changes. Skipped as root (chmod is not
# enforced for uid 0).
c16b_arm() {
  local label="$1" v="$2" warn="$3"; shift 3
  c_run "$C_REPO" "$v" "$@"
  assert_rc "C16b $label on a read-only root exits 0" 0 "$C_RC" "$(head -c 300 "$C_ERR")"
  assert_eq "C16b $label: exactly one skipped line naming the root" \
    "$(grep -cF "[a1-tools] $warn skipped: vault root not accessible: $v (EACCES)" "$C_ERR" | tr -d ' ')/$(grep -c '^\[a1-tools\] .*skipped: ' "$C_ERR" | tr -d ' ')" "1/1"
}
caseC16b() {
  if [[ "$(id -u)" -eq 0 ]]; then ok "C16b skipped (running as root: chmod is not enforced)"; return; fi
  local v="$C_WORK/c16b/ro-vault"
  make_sync_vault "$v"
  mkdir -p "$v/project/demo/spec"
  printf -- '---\nstatus: draft\n---\n# no type\n' > "$v/project/demo/spec/001-x.md"
  cp -R "$v" "$C_WORK/c16b/before"
  chmod -R a-w "$v"
  c16b_arm "sync demo" "$v" "vault mirror" sync demo
  c16b_arm "lint demo --fix-type" "$v" "vault lint" lint demo --fix-type
  c16b_arm "link-hub demo --spec 001-x" "$v" "vault link-hub" link-hub demo --spec 001-x
  c16b_arm "link-hub --all-specs" "$v" "vault link-hub" link-hub --all-specs
  chmod -R u+w "$v"
  if diff -r "$v" "$C_WORK/c16b/before" >/dev/null; then ok "C16b the read-only vault is unchanged"
  else bad "C16b a command wrote into the read-only vault"; fi
}

# ---------- C17 a set folder linked out of the vault: no write, no delete ----------
# Red-making changes: (a) resolving the real set root as realpath(setRoot)
# instead of path.join(realpath(project/<slug>), set) — the linked product/
# then resolves "inside itself" and the mirror files land in the outside
# directory (5 asserts red, measured); (b) dropping the up-front
# assertSetRootsReal() in applyMirror — the per-write check still refuses, but
# only after phases/ was created (2 asserts red, measured). The prune guard in
# vault-sync.cjs (guardedUnlink) is defence in depth behind (a): with the
# up-front refusal no delete is ever reached through a linked set folder, so
# replacing it by a plain unlinkSync stays green here — measured, by design.
caseC17() {
  local r="$C_WORK/c17/repo" v="$C_WORK/c17/vault" out1="$C_WORK/c17/out-sync" out2="$C_WORK/c17/out-prune"
  make_sync_repo "$r" demo; make_sync_vault "$v"
  mkdir -p "$out1" "$out2" "$v/project/demo"
  ln -s "$out1" "$v/project/demo/product"
  c_run "$r" "$v" sync demo
  [[ $C_RC -ne 0 ]] && ok "C17 sync through a linked product/ refuses (exit $C_RC)" || bad "C17 sync exit 0 through a linked product/"
  grep -q 'resolves outside the project folder via a link' "$C_ERR" && ok "C17 stderr names the linked set folder" || bad "C17 stderr: $(head -c 300 "$C_ERR")"
  assert_eq "C17 the outside target holds no mirrored file" "$(c_files "$out1")" ""
  [[ ! -e "$v/project/demo/phases" ]] && ok "C17 refused before the first write (phases/ not created either)" || bad "C17 phases/ written before the refusal"
  rm "$v/project/demo/product"
  printf 'victim\n' > "$out2/victim.md"
  ln -s "$out2" "$v/project/demo/product"
  c_run "$r" "$v" sync demo --prune
  [[ $C_RC -ne 0 ]] && ok "C17 sync --prune through a linked product/ refuses (exit $C_RC)" || bad "C17 --prune exit 0 through a linked product/"
  assert_eq "C17 outside keeps victim.md and gains no mirrored file" "$(c_files "$out2")" "victim.md"
}

caseC1; caseC2C7; caseC3; caseC4; caseC5; caseC6; caseC8; caseC9; caseC10; caseC11
caseC12; caseC13; caseC14; caseC15; caseC16; caseC16b; caseC17
rm -rf "$C_WORK"
