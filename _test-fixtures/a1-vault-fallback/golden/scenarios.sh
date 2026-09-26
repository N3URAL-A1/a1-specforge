#!/usr/bin/env bash
# Golden scenarios G1-G3 for spec 010 FR-037 / SC-002: vault-free output of
# `product stage`, `spec update-status` and `analyze init` must stay
# byte-identical to the pre-feature release.
#
# Sourced by two callers with DIFFERENT tool trees:
#   golden/capture.sh   — runs them with the a1-tools.cjs of commit 475382a
#                         (the last commit before spec 010) and stores goldens.
#   ../run-tests.sh     — runs them with the CURRENT tree and cmp's the result.
# The goldens are never regenerated from the working tree: an expectation
# captured from the code under test moves with that code (testing.md class 4).
#
# Each scenario: run_<name> <tools.cjs> <outprefix>
#   writes <outprefix>.out  (stdout, per command, normalised)
#          <outprefix>.err  (stderr, per command, normalised)
#          <outprefix>.files (sorted repo + HOME file list with normalised content)
# and returns 0 even when a command fails — the rc is recorded in the output,
# so a changed exit code is a golden mismatch, not a silent pass.

# Every command runs vault-free: the real vault on this Mac must never be reached.
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST

G_REPO=""
G_HOME=""

# Temp paths appear both as /var/... and as their realpath /private/var/...;
# ISO stamps and calendar dates change per run. Longest pattern first.
g_normalise() {
  local repo_real home_real
  repo_real="$(cd "$G_REPO" && pwd -P)"
  home_real="$(cd "$G_HOME" && pwd -P)"
  sed -E \
    -e "s#${repo_real}#<REPO>#g" -e "s#${G_REPO}#<REPO>#g" \
    -e "s#${home_real}#<HOME>#g" -e "s#${G_HOME}#<HOME>#g" \
    -e 's#[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z#<ISO>#g' \
    -e 's#[0-9]{4}-[0-9]{2}-[0-9]{2}#<DATE>#g'
}

g_setup() {
  G_REPO="$(mktemp -d -t w8a-grepo)"
  G_HOME="$(mktemp -d -t w8a-ghome)"
  git -C "$G_REPO" init -q
}

# g_run <tools> <outprefix> <args...> — one command, cwd = repo, HOME = temp.
g_run() {
  local tools="$1" prefix="$2" rc
  shift 2
  (cd "$G_REPO" && env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST HOME="$G_HOME" \
      node "$tools" "$@" >"$prefix.raw.out" 2>"$prefix.raw.err")
  rc=$?
  { printf '## %s rc=%d\n' "$*" "$rc" | g_normalise; g_normalise <"$prefix.raw.out"; } >>"$prefix.out"
  { printf '## %s rc=%d\n' "$*" "$rc" | g_normalise; g_normalise <"$prefix.raw.err"; } >>"$prefix.err"
  rm -f "$prefix.raw.out" "$prefix.raw.err"
}

# Sorted entry list of repo (minus .git) and HOME — directories end in "/",
# files are followed by their normalised content. An empty directory is a
# write too (a created .a1/learnings/ must show). HOME must stay empty
# (SC-002: nothing is written outside the repo).
g_files() {
  local prefix="$1" f
  : >"$prefix.files"
  while IFS= read -r f; do
    if [[ -d "$G_REPO/$f" ]]; then
      printf '== repo/%s/\n' "$f" >>"$prefix.files"
    else
      printf '== repo/%s\n' "$f" >>"$prefix.files"
      g_normalise <"$G_REPO/$f" >>"$prefix.files"
    fi
  done < <(cd "$G_REPO" && find . -mindepth 1 -path ./.git -prune -o -print | sed 's#^\./##' | LC_ALL=C sort)
  while IFS= read -r f; do
    printf '== home/%s\n' "$f" >>"$prefix.files"
  done < <(cd "$G_HOME" && find . -mindepth 1 -print | sed 's#^\./##' | LC_ALL=C sort)
}

g_roadmap() {
  local tools="$1" prefix="$2"
  g_run "$tools" "$prefix" product init --project demo --title "Demo project"
  g_run "$tools" "$prefix" product add-milestone --id m1 --title "Milestone one"
  g_run "$tools" "$prefix" product add-feature --id 001-demo --milestone m1 --title "Demo feature"
}

# G1 — the SC-002 sequence: init → add-milestone → add-feature → stage.
run_product_stage() {
  local tools="$1" prefix="$2"
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_roadmap "$tools" "$prefix"
  g_run "$tools" "$prefix" product stage --by 001-demo --set started
  g_files "$prefix"
}

# G2 — spec update-status implementing → done on a template-shaped spec
# (frontmatter status + body blockquote "Status: `…`", as 75 live specs have)
# in a repo whose roadmap lists the same feature id — the realistic input.
run_spec_update_status() {
  local tools="$1" prefix="$2" spec
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_roadmap "$tools" "$prefix"
  : >"$prefix.out"; : >"$prefix.err"   # setup output is G1's business
  spec="$G_REPO/.a1/learnings/project/demo/spec/001-demo.md"
  mkdir -p "$(dirname "$spec")"
  cat >"$spec" <<'SPEC'
---
id: 001-demo
project: demo
feature_slug: demo
title: "Demo feature"
status: implementing
created: 2026-01-01
phase_history:
  - "phase=discover completed=2026-01-01T10:00:00.000Z"
size: S
---

# Demo feature

> Spec ID: `001-demo` · Project: `demo` · Status: `implementing`

## Problem

Body text that must survive untouched.
SPEC
  g_run "$tools" "$prefix" spec update-status "$spec" done
  g_files "$prefix"
}

# G2b — the same command where neither FR-030 (no body header) nor FR-031
# (non-terminal status, no roadmap) applies: nothing may differ at all.
run_spec_update_status_plain() {
  local tools="$1" prefix="$2" spec
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  spec="$G_REPO/specs/001-demo.md"
  mkdir -p "$(dirname "$spec")"
  printf -- '---\nid: 001-demo\nproject: demo\nstatus: draft\n---\n\n# Demo feature\n\nBody.\n' >"$spec"
  g_run "$tools" "$prefix" spec update-status "$spec" clarified
  g_files "$prefix"
}

# G3 — analyze init with a fixed date and title.
run_analyze_init() {
  local tools="$1" prefix="$2"
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_run "$tools" "$prefix" analyze init demo general --date 2026-01-01 --title "Demo analysis"
  g_files "$prefix"
}

G_SCENARIOS=(product-stage:run_product_stage spec-update-status:run_spec_update_status spec-update-status-plain:run_spec_update_status_plain analyze-init:run_analyze_init)

g_cleanup() {
  [[ -n "$G_REPO" && -d "$G_REPO" ]] && rm -rf "$G_REPO"
  [[ -n "$G_HOME" && -d "$G_HOME" ]] && rm -rf "$G_HOME"
  G_REPO=""; G_HOME=""
}
