#!/usr/bin/env bash
# Fixture: vaultRoot() 3-tier fallback chain in _shared/a1-tools.cjs.
#
# Tiers:  env (A1_VAULT_ROOT) > repo-local (<git-root>/.a1/learnings) > legacy (~/N3URAL-Vault)
#         → hard-fail exit 2 outside a repo with no env and no legacy vault.
#
# Every case runs with a fresh fake HOME and (except Case A) unset A1_VAULT_ROOT,
# so the test never touches the real vault or the real repo.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

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
# → write lands under <repo>/.a1/learnings/wiki/..., exit 0, source: repo-local.
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
  [[ -d "$repo/.a1/learnings/wiki/lessons/demo-agent/_suggestions" ]] && wrote="yes"
  if [[ $rc -eq 0 ]] \
     && [[ -n "$wrote" ]] \
     && printf '%s' "$err" | grep -q 'source: repo-local'; then
    ok "F wiki subcommand choke point (exit=$rc, wrote under repo-local)"
  else
    bad "F wiki subcommand choke point (exit=$rc, wrote=$wrote)"
    results+=("      out: $out"); results+=("      err: $err")
  fi
}

caseA
caseB
caseC
caseD
caseE
caseF

printf '\n--- a1-vault-fallback fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\nTotal: %d passed, %d failed\n' "$pass" "$fail"

if [[ "$fail" -gt 0 ]]; then exit 1; fi
