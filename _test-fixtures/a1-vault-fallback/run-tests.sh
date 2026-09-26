#!/usr/bin/env bash
# Fixture: vaultRoot() 3-tier fallback chain in _shared/a1-tools.cjs.
#
# Tiers:  env (A1_VAULT_ROOT) > repo-local (<git-root>/.a1/learnings) > legacy (~/N3URAL-Vault)
#         → hard-fail exit 2 outside a repo with no env and no legacy vault.
#
# Every case runs with a fresh fake HOME and (except Case A) unset A1_VAULT_ROOT,
# so the test never touches the real vault or the real repo.

set -u

# Spec 010 Wave 4: every product writer mirrors docs/product into A1_VAULT_ROOT.
# A fixture must never reach the developer's real vault, and its expectations
# are the vault-free ones (SC-002) — so the suite runs without a vault root.
# Cases that need a vault set A1_VAULT_ROOT per call to a mktemp -d directory.
# A1_VAULT_WRITER_HOST (Wave 5) is unset for the same reason.
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
HERE="$REPO_ROOT/_test-fixtures/a1-vault-fallback"
SCAN_MD="$REPO_ROOT/skills/a1-progress/workflows/01-scan.md"
GOLDEN_COMMIT=475382a
# shellcheck source=golden/scenarios.sh
source "$HERE/golden/scenarios.sh"

pass=0
fail=0
results=()

ok()   { results+=("PASS  $1"); pass=$((pass + 1)); }
bad()  { results+=("FAIL  $1"); fail=$((fail + 1)); }

# ---------- Case A: env wins ----------
# A1_VAULT_ROOT set → path under the env dir, exit 0, stderr source: env.
caseA() {
  local home tmpvault out err rc
  home="$(mktemp -d)"
  tmpvault="$(mktemp -d)"
  out="$(cd "$REPO_ROOT" && env HOME="$home" A1_VAULT_ROOT="$tmpvault/vault" \
        node "$TOOLS" spec next-number demo 2>/tmp/a1vf.errA)"
  rc=$?
  err="$(cat /tmp/a1vf.errA)"
  if [[ $rc -eq 0 ]] \
     && printf '%s' "$out" | grep -q "$tmpvault/vault" \
     && printf '%s' "$err" | grep -q 'source: env'; then
    ok "A env wins (exit=$rc, source: env)"
  else
    bad "A env wins (exit=$rc)"; results+=("      out: $out"); results+=("      err: $err")
  fi
}

# ---------- Case B: repo-local ----------
# unset env, cwd = fresh git repo → path under <repo>/.a1/learnings, source: repo-local.
caseB() {
  local home repo out err rc
  home="$(mktemp -d)"
  repo="$(mktemp -d)"
  git -C "$repo" init -q
  out="$(cd "$repo" && env -u A1_VAULT_ROOT HOME="$home" \
        node "$TOOLS" spec next-number demo 2>/tmp/a1vf.errB)"
  rc=$?
  err="$(cat /tmp/a1vf.errB)"
  if [[ $rc -eq 0 ]] \
     && printf '%s' "$out" | grep -q "$repo/.a1/learnings" \
     && printf '%s' "$err" | grep -q 'source: repo-local' \
     && [[ -d "$repo/.a1/learnings" ]]; then
    ok "B repo-local (exit=$rc, source: repo-local, dir created)"
  else
    bad "B repo-local (exit=$rc)"; results+=("      out: $out"); results+=("      err: $err")
  fi
}

# ---------- Case C: legacy ----------
# unset env, non-git cwd, ~/N3URAL-Vault exists → legacy + deprecation warning.
caseC() {
  local home nongit out err rc
  home="$(mktemp -d)"
  nongit="$(mktemp -d)"     # mktemp dirs are not git repos
  mkdir -p "$home/N3URAL-Vault"
  out="$(cd "$nongit" && env -u A1_VAULT_ROOT HOME="$home" \
        node "$TOOLS" spec next-number demo 2>/tmp/a1vf.errC)"
  rc=$?
  err="$(cat /tmp/a1vf.errC)"
  if [[ $rc -eq 0 ]] \
     && printf '%s' "$err" | grep -q 'Using legacy vault' \
     && printf '%s' "$err" | grep -q 'source: legacy'; then
    ok "C legacy (exit=$rc, deprecation warning)"
  else
    bad "C legacy (exit=$rc)"; results+=("      out: $out"); results+=("      err: $err")
  fi
}

# ---------- Case D: repo-local auto-create + status ----------
# fresh git repo with NO .a1/ → exit 0, .a1/learnings created, both status lines.
caseD() {
  local home repo out err rc
  home="$(mktemp -d)"
  repo="$(mktemp -d)"
  git -C "$repo" init -q
  [[ -e "$repo/.a1" ]] && rm -rf "$repo/.a1"
  out="$(cd "$repo" && env -u A1_VAULT_ROOT HOME="$home" \
        node "$TOOLS" spec next-number demo 2>/tmp/a1vf.errD)"
  rc=$?
  err="$(cat /tmp/a1vf.errD)"
  if [[ $rc -eq 0 ]] \
     && [[ -d "$repo/.a1/learnings" ]] \
     && printf '%s' "$err" | grep -q 'created .a1/learnings/' \
     && printf '%s' "$err" | grep -q 'source: repo-local'; then
    ok "D auto-create + status (exit=$rc)"
  else
    bad "D auto-create + status (exit=$rc)"; results+=("      out: $out"); results+=("      err: $err")
  fi
}

# ---------- Case E: hard fail ----------
# unset env, non-git cwd, no legacy vault → exit 2, error names A1_VAULT_ROOT.
caseE() {
  local home nongit out err rc
  home="$(mktemp -d)"       # fresh HOME: no N3URAL-Vault
  nongit="$(mktemp -d)"
  out="$(cd "$nongit" && env -u A1_VAULT_ROOT HOME="$home" \
        node "$TOOLS" spec next-number demo 2>/tmp/a1vf.errE)"
  rc=$?
  err="$(cat /tmp/a1vf.errE)"
  if [[ $rc -eq 2 ]] && printf '%s' "$err" | grep -q 'A1_VAULT_ROOT'; then
    ok "E hard fail (exit=$rc, mentions A1_VAULT_ROOT)"
  else
    bad "E hard fail (exit=$rc)"; results+=("      out: $out"); results+=("      err: $err")
  fi
}

# ---------- Case F: wiki subcommand proves the choke point ----------
# fresh git repo, unset env, run a wiki/-writing subcommand (fix write-suggestion)
# → write lands under <repo>/.a1/learnings/pattern/a1-learnings/..., exit 0, source: repo-local.
caseF() {
  local home repo out err rc wrote
  home="$(mktemp -d)"
  repo="$(mktemp -d)"
  git -C "$repo" init -q
  out="$(cd "$repo" && env -u A1_VAULT_ROOT HOME="$home" \
        node "$TOOLS" fix write-suggestion demo-agent --title "Test" --body "b" 2>/tmp/a1vf.errF)"
  rc=$?
  err="$(cat /tmp/a1vf.errF)"
  wrote=""
  [[ -d "$repo/.a1/learnings/pattern/a1-learnings/lessons/demo-agent/_suggestions" ]] && wrote="yes"
  if [[ $rc -eq 0 ]] \
     && [[ -n "$wrote" ]] \
     && printf '%s' "$err" | grep -q 'source: repo-local'; then
    ok "F wiki subcommand choke point (exit=$rc, wrote under repo-local)"
  else
    bad "F wiki subcommand choke point (exit=$rc, wrote=$wrote)"
    results+=("      out: $out"); results+=("      err: $err")
  fi
}

# ---------- Cases G1-G3: vault-free goldens (spec 010 FR-037, SC-002) ----------
# The goldens under golden/ were captured from commit 475382a (the last commit
# before spec 010) by golden/capture.sh — never from this tree. Each case runs
# the same scenario with the CURRENT a1-tools.cjs, normalised identically, and
# cmp's stdout, stderr and the written-entry list (with content) against them.
# Red-making change, one per case:
#   G1  product stage: printing the vault_mirror key or any stderr line in the
#       inactive tier (SC-002).
#   G2  spec update-status (terminal, template-shaped spec, roadmap lists the
#       feature): any stderr line besides the one FR-031 "hint:" line, or any
#       file change besides the FR-030 body header (golden/spec-update-status
#       .allowed-diff lists exactly those two).
#   G2b spec update-status (non-terminal, no body header, no roadmap): resolving
#       the learnings root eagerly (creates .a1/learnings/, two stderr lines).
#   G3  analyze init: any new stderr line or written file in the inactive tier.
#   G4  checklist run --only 9,10 (Gate 4.5): evaluating check #11 although it
#       is not selected, or its roadmap lookup announcing `code roots:` on
#       stderr (review 010 M2; checklist.cjs `wants(11)` / `quiet: true`).
#   G4b checklist run (full): the same `code roots:` stderr line — the lookup
#       without `quiet: true`; any output change besides the check #11 entry
#       in golden/checklist-full.allowed-diff.
caseG() {
  local label="$1" name="$2" fn="$3" work ext diffs="" leak="" hdr
  # golden/<name>.allowed-diff lists the ONLY lines allowed to differ (G2:
  # FR-030 body header, FR-031 hint — documented SC-002 exception, team-lead
  # 2026-09-26). Everything else is still compared byte for byte.
  local allowed="$HERE/golden/$name.allowed-diff"
  work="$(g_mktemp w8a-gcase)"; g_need_dir work "$work"
  hdr="$(head -n 1 "$HERE/golden/$name.out")"
  if [[ "$hdr" != *"commit $GOLDEN_COMMIT"* ]]; then
    bad "$label golden header does not name commit $GOLDEN_COMMIT: $hdr"; rm -rf "$work"; return
  fi
  "$fn" "$TOOLS" "$work/$name"
  leak="$(find "$G_HOME" -path '*project*' 2>/dev/null)"
  g_cleanup
  for ext in out err files; do
    tail -n +2 "$HERE/golden/$name.$ext" >"$work/golden.$ext"
    cp "$work/$name.$ext" "$work/current.$ext"
    if [[ -f "$allowed" ]] \
       && ! node "$HERE/golden/apply-allowed.cjs" "$allowed" "$ext" "$work/golden.$ext" "$work/$name.$ext" \
              "$work/golden.$ext" "$work/current.$ext" 2>"$work/allowed.err"; then
      diffs="$diffs $ext"; results+=("      $(cat "$work/allowed.err")"); continue
    fi
    if ! cmp -s "$work/golden.$ext" "$work/current.$ext"; then
      diffs="$diffs $ext"
      results+=("      --- $name.$ext: golden (475382a) vs current")
      while IFS= read -r l; do results+=("      $l"); done \
        < <(diff "$work/golden.$ext" "$work/current.$ext" | head -n 12)
    fi
  done
  rm -rf "$work"
  if [[ -z "$diffs" && -z "$leak" ]]; then
    if [[ -f "$allowed" ]]; then
      ok "$label golden $name (out, err, files byte-identical to $GOLDEN_COMMIT except the lines in golden/$name.allowed-diff; nothing under HOME)"
    else
      ok "$label golden $name (out, err, files byte-identical to $GOLDEN_COMMIT; nothing under HOME)"
    fi
  else
    bad "$label golden $name (differs:${diffs:- none}; HOME project paths: ${leak:-none})"
  fi
}

# ---------- Cases P1/P2: a1-progress "Vault cockpit" step (FR-022) ----------
# no-code artifact assertion: the bash block documented as step 7 of
# skills/a1-progress/workflows/01-scan.md is extracted and executed as is.
vault_block() {
  awk '/^### 7\. Vault cockpit/{f=1} f&&/^```bash$/{b=1;next} b&&/^```$/{exit} b' "$SCAN_MD"
}

# P1 inactive: env unset, fresh git repo → stdout exactly "vault: not configured",
# nothing written in the repo. Red: printing empty summary lines (or a
# "cannot run" line) instead of the not-configured line.
caseP1() {
  local home repo out block entries
  home="$(g_mktemp w8a-p1home)"; g_need_dir home "$home"
  repo="$(g_mktemp w8a-p1repo)"; g_need_dir repo "$repo"
  git -C "$repo" init -q
  block="$(vault_block)"
  out="$(cd "$repo" && env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST HOME="$home" A1_TOOLS="$TOOLS" \
        bash -c "$block" 2>/dev/null)"
  entries="$(cd "$repo" && find . -mindepth 1 -path ./.git -prune -o -print)"
  if [[ -n "$block" && "$out" == "vault: not configured" && -z "$entries" ]]; then
    ok "P1 progress inactive prints exactly 'vault: not configured', writes nothing"
  else
    bad "P1 progress inactive"; results+=("      out: [$out]"); results+=("      written: [$entries]")
  fi
  rm -rf "$home" "$repo"
}

# P2 active: temp vault with one spec lacking type:, repo with an unsynced
# docs/product → the two summary lines with the real counts. Red: dropping a
# class from either line, or reading counts from the wrong JSON key.
caseP2() {
  local home repo vault out block expected
  home="$(g_mktemp w8a-p2home)"; g_need_dir home "$home"
  repo="$(g_mktemp w8a-p2repo)"; g_need_dir repo "$repo"
  vault="$(g_mktemp w8a-p2vault)"; g_need_dir vault "$vault"
  git -C "$repo" init -q
  (cd "$repo" && env -u A1_VAULT_ROOT HOME="$home" node "$TOOLS" product init --project demo --title Demo >/dev/null 2>&1)
  mkdir -p "$vault/project/demo/spec"
  printf -- '---\nid: 001-x\nstatus: draft\n---\n\n# X\n' >"$vault/project/demo/spec/001-x.md"
  block="$(vault_block)"
  out="$(cd "$repo" && env -u A1_VAULT_WRITER_HOST HOME="$home" A1_VAULT_ROOT="$vault" A1_TOOLS="$TOOLS" \
        bash -c "$block" 2>/dev/null)"
  expected="$(printf 'vault status: 3 missing, 0 stale, 0 extra, 0 conflict\nvault lint: 1 type_missing')"
  if [[ "$out" == "$expected" ]]; then
    ok "P2 progress active prints status + lint summary lines with measured counts"
  else
    bad "P2 progress active"; results+=("      out: [$out]"); results+=("      expected: [$expected]")
  fi
  rm -rf "$home" "$repo" "$vault"
}

# ---------- Case L1: no BSD-only shell idioms in the fixture suites ----------
# CI runs on ubuntu (GNU coreutils). `mktemp -d -t <name>` is a prefix on
# macOS but a template on GNU, which refuses it without trailing X's — that
# turned CI run 36229485863 red and, with the temp vars empty, ran the
# scenarios in the checkout (review 010 B1). Same class: `sed -i ''`,
# `stat -f`, BSD `date -j/-v`. Comment lines are ignored.
# Red-making change: putting `mktemp -d -t w8a-grepo` back into
# golden/scenarios.sh (or any such idiom into any suite script).
caseL1() {
  local hits re
  # The pattern is assembled from pieces so this very case does not match it.
  re="mk""temp[^#]*[[:space:]]-t([[:space:]]|\$)|mk""temp[^#]*[[:space:]]-[a-zA-Z]*t[[:space:]]+[^[:space:]-]+"
  re="$re|se""d -i ''|se""d -i \"\"|st""at -f |da""te -[jv] "
  hits="$(cd "$REPO_ROOT" && find _test-fixtures -name '*.sh' -type f -print0 \
    | xargs -0 grep -nE "$re" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true)"
  if [[ -z "$hits" ]]; then ok "L1 no BSD-only shell idioms in _test-fixtures/**/*.sh"
  else bad "L1 BSD-only shell idioms found"; while IFS= read -r l; do results+=("      $l"); done <<<"$hits"; fi
}

caseA
caseB
caseC
caseD
caseE
caseF
caseG G1 product-stage run_product_stage
caseG G2 spec-update-status run_spec_update_status
caseG G2b spec-update-status-plain run_spec_update_status_plain
caseG G3 analyze-init run_analyze_init
caseG G4 checklist-gate run_checklist_gate
caseG G4b checklist-full run_checklist_full
caseP1
caseP2
caseL1

printf '\n--- a1-vault-fallback fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\nTotal: %d passed, %d failed\n' "$pass" "$fail"

if [[ "$fail" -gt 0 ]]; then exit 1; fi
