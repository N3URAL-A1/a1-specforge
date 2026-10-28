# Golden scenarios for spec 006-specforge-kritis-profile, FR-008 / SC-002:
# without the `kritis` profile, a1-new-feature's CLI surface MUST stay
# byte-identical. These 11 scenarios cover every a1-tools subcommand the
# a1-new-feature skill calls (see golden/inventory.txt for the full 22-item
# call-site inventory; 11 of those 22 are covered here, 11 are listed
# exclusions).
#
# Sourced by two callers with DIFFERENT tool trees, same pattern as
# ../../a1-vault-fallback/golden/scenarios.sh:
#   golden/capture.sh   — runs them with the a1-tools.cjs of GOLDEN_COMMIT
#                         (cb3fd99a6be44891d52b96cc4223f4897823e7c9, the post-023
#                         merge-base with origin/main) and stores goldens.
#   ../run-tests.sh     — runs them with the CURRENT tree and cmp's the result.
# The goldens are never regenerated from the working tree: an expectation
# captured from the code under test moves with that code (testing.md class 4).
#
# Sourcing-vs-copying decision (wave-plan brief item 1, read 2026-10-28):
# sourcing ../../a1-vault-fallback/golden/scenarios.sh is side-effect-free at
# source time beyond its own `unset` line, BUT it also defines G_SCENARIOS
# (its own 6-entry array) and 6 run_* functions (run_product_stage,
# run_spec_update_status, run_spec_update_status_plain, run_analyze_init,
# run_checklist_gate, run_checklist_full) in the SAME shell namespace this
# file would use. This suite needs its own run_product_stage and its own
# checklist-run scenario with different names/shapes; sourcing would make
# this file silently depend on whichever function bodies a1-vault-fallback
# happens to define that week, and a rename or signature change over there
# (its functions are private to that suite, not a published contract) could
# shadow or break this suite without a single line changing here. The two
# suites are otherwise unrelated (different feature, different FR). Given
# that, copying the small, stable g_* primitives below (with this header as
# provenance) keeps a1-kritis-profile self-contained and immune to a
# refactor two directories over. The copy is verbatim except where noted.

# Every command runs vault-free: the real vault on this Mac/Linux host must
# never be reached.
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

G_BASE=""
G_REPO=""
G_HOME=""

# g_mktemp <name> — a fresh temp dir, portable across BSD and GNU mktemp.
# (`mktemp -d -t <name>` is a prefix on macOS but a template on GNU, which
# refuses it without trailing X's.) Prints the path.
g_mktemp() {
  local base="${TMPDIR:-/tmp}"
  mktemp -d "${base%/}/$1.XXXXXX"
}

# g_need_dir <label> <path> — hard guard after every g_mktemp: an empty or
# missing temp dir aborts the WHOLE run (exit 97). Without it `cd ""` is a
# no-op and the scenario could write into the checkout.
g_need_dir() {
  if [[ -z "$2" || ! -d "$2" ]]; then
    printf 'FATAL: temp dir %s is empty or not a directory (%s) — aborting, nothing runs in the checkout\n' "$1" "$2" >&2
    exit 97
  fi
}

# Temp paths appear both as /var/... and as their realpath /private/var/...
# on macOS; ISO stamps and calendar dates change per run. The plan-depth-check
# scenario passes an absolute --plan path OUTSIDE $G_REPO/$G_HOME (the
# checked-in fixture file), which the golden would otherwise bake in as a
# machine/checkout-specific path — normalised separately so the golden is
# portable across checkouts. Longest pattern first.
g_normalise() {
  local repo_real home_real plan_fixture_real
  repo_real="$(cd "$G_REPO" && pwd -P)"
  home_real="$(cd "$G_HOME" && pwd -P)"
  plan_fixture_real="$(cd "$G_PLAN_FIXTURE" && pwd -P)"
  sed -E \
    -e "s#${repo_real}#<REPO>#g" -e "s#${G_REPO}#<REPO>#g" \
    -e "s#${home_real}#<HOME>#g" -e "s#${G_HOME}#<HOME>#g" \
    -e "s#${plan_fixture_real}#<PLAN_FIXTURE>#g" -e "s#${G_PLAN_FIXTURE}#<PLAN_FIXTURE>#g" \
    -e 's#[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z#<ISO>#g' \
    -e 's#[0-9]{4}-[0-9]{2}-[0-9]{2}#<DATE>#g'
}

# Repo and HOME share a private parent: without code roots, a1-tools falls
# back to the repo's parent dir (codeRoots tier "repo-parent"), and a shared
# $TMPDIR would expose every other run's leftovers to that lookup.
g_setup() {
  G_BASE="$(g_mktemp w1k-gbase)"; g_need_dir G_BASE "$G_BASE"
  G_REPO="$G_BASE/repo"; G_HOME="$G_BASE/home"
  mkdir "$G_REPO" "$G_HOME"
  g_need_dir G_REPO "$G_REPO"; g_need_dir G_HOME "$G_HOME"
  git -C "$G_REPO" init -q
}

# g_run <tools> <outprefix> <args...> — one command, cwd = repo, HOME = temp.
g_run() {
  local tools="$1" prefix="$2" rc
  shift 2
  g_need_dir G_REPO "$G_REPO"; g_need_dir G_HOME "$G_HOME"
  # `--phase <scope>` only scopes the gate log (a side file pruned in
  # g_files below); keep it out of the compared header.
  local shown=() skip=0 a
  for a in "$@"; do if ((skip)); then skip=0; elif [[ "$a" == --phase ]]; then skip=1; else shown+=("$a"); fi; done
  (cd "$G_REPO" && env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST -u A1_HOST_ID HOME="$G_HOME" \
      node "$tools" "$@" >"$prefix.raw.out" 2>"$prefix.raw.err")
  rc=$?
  { printf '## %s rc=%d\n' "${shown[*]}" "$rc" | g_normalise; g_normalise <"$prefix.raw.out"; } >>"$prefix.out"
  { printf '## %s rc=%d\n' "${shown[*]}" "$rc" | g_normalise; g_normalise <"$prefix.raw.err"; } >>"$prefix.err"
  rm -f "$prefix.raw.out" "$prefix.raw.err"
}

# Sorted entry list of repo (minus .git and .a1/phases, the gate-log side
# file) and HOME — directories end in "/", files are followed by their
# normalised content. HOME must stay empty (SC-002: nothing is written
# outside the repo).
g_files() {
  local prefix="$1" f
  g_need_dir G_REPO "$G_REPO"; g_need_dir G_HOME "$G_HOME"
  : >"$prefix.files"
  while IFS= read -r f; do
    if [[ -d "$G_REPO/$f" ]]; then
      printf '== repo/%s/\n' "$f" >>"$prefix.files"
    else
      printf '== repo/%s\n' "$f" >>"$prefix.files"
      g_normalise <"$G_REPO/$f" >>"$prefix.files"
    fi
  done < <(cd "$G_REPO" && find . -mindepth 1 \( -path ./.git -o -path ./.a1/phases \) -prune -o -print | sed 's#^\./##' | LC_ALL=C sort)
  while IFS= read -r f; do
    printf '== home/%s\n' "$f" >>"$prefix.files"
  done < <(cd "$G_HOME" && find . -mindepth 1 -print | sed 's#^\./##' | LC_ALL=C sort)
}

g_cleanup() {
  [[ -n "$G_BASE" && -d "$G_BASE" ]] && rm -rf "$G_BASE"
  G_BASE=""; G_REPO=""; G_HOME=""
}

# ---------- Scenario inputs copied from real files (see fixtures/SOURCES.txt) ----------
# The 001-login spec/plan pair used by the checklist-run scenario is the
# existing fixture at _test-fixtures/a1-checklist/pass/ (already a real,
# passing spec+plan pair; re-copying its bytes here would duplicate the
# fixture for no benefit, so the scenario copies it fresh per-run from its
# checked-in location instead of embedding a second copy).
G_CHECKLIST_FIXTURE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../a1-checklist/pass" && pwd)"
# The real wave plan used by the plan-depth-check scenario is copied once,
# byte for byte, into fixtures/plan-depth-check/ (see SOURCES.txt) — the
# "real spec/plan pair that passes #9/#10" named in the wave-plan brief.
G_PLAN_FIXTURE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../fixtures/plan-depth-check" && pwd)"

# ---------- S1: spec init ----------
run_spec_init() {
  local tools="$1" prefix="$2"
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_run "$tools" "$prefix" spec init demo kritis-golden-sample --title "Kritis Golden Sample" --phase w1-golden
  g_files "$prefix"
}

# S2: spec set-size, on the spec S1 would have created.
run_spec_set_size() {
  local tools="$1" prefix="$2" spec
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_run "$tools" "$prefix" spec init demo kritis-golden-sample --title "Kritis Golden Sample" --phase w1-golden
  : >"$prefix.out"; : >"$prefix.err"   # the init call above is S1's business
  spec="$G_REPO/.a1/learnings/project/demo/spec/001-kritis-golden-sample.md"
  g_run "$tools" "$prefix" spec set-size "$spec" M --phase w1-golden
  g_files "$prefix"
}

# S3: spec update-status, plain (discovering -> draft, no extra flags).
run_spec_update_status() {
  local tools="$1" prefix="$2" spec
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_run "$tools" "$prefix" spec init demo kritis-golden-sample --title "Kritis Golden Sample" --phase w1-golden
  : >"$prefix.out"; : >"$prefix.err"
  spec="$G_REPO/.a1/learnings/project/demo/spec/001-kritis-golden-sample.md"
  g_run "$tools" "$prefix" spec update-status "$spec" draft --phase w1-golden
  g_files "$prefix"
}

# S4: spec update-status with --wave-plan-path (the second named call shape).
run_spec_update_status_wave_plan() {
  local tools="$1" prefix="$2" spec
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_run "$tools" "$prefix" spec init demo kritis-golden-sample --title "Kritis Golden Sample" --phase w1-golden
  g_run "$tools" "$prefix" spec update-status "$G_REPO/.a1/learnings/project/demo/spec/001-kritis-golden-sample.md" draft --phase w1-golden
  : >"$prefix.out"; : >"$prefix.err"
  spec="$G_REPO/.a1/learnings/project/demo/spec/001-kritis-golden-sample.md"
  g_run "$tools" "$prefix" spec update-status "$spec" clarified \
    --wave-plan-path project/demo/plans/001-kritis-golden-sample-wave-plan.md --phase w1-golden
  g_files "$prefix"
}

# S5: checklist run --only 9,10,11 (Gate 4.5), on the real a1-checklist pass fixture.
run_checklist_run() {
  local tools="$1" prefix="$2"
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  mkdir -p "$G_REPO/.a1/learnings"
  cp -R "$G_CHECKLIST_FIXTURE/project" "$G_REPO/.a1/learnings/"
  g_run "$tools" "$prefix" checklist run demo/001-login --only 9,10,11 --format json --phase w1-golden
  g_files "$prefix"
}

# S6: product feature-init, on a roadmap built by the real product CLI
# (init -> add-milestone -> add-feature), outside docs/product (--dir) so
# the scenario never depends on this repo's own ROADMAP.md.
g_product_roadmap() {
  local tools="$1" prefix="$2" dir="$3"
  g_run "$tools" "$prefix" product init --project demo --title "Demo project" --dir "$dir"
  g_run "$tools" "$prefix" product add-milestone --id m1 --title "Milestone one" --dir "$dir"
  g_run "$tools" "$prefix" product add-feature --id 001-demo --milestone m1 --title "Demo feature" --dir "$dir"
}
run_product_feature_init() {
  local tools="$1" prefix="$2" dir
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  dir="$G_REPO/pd"
  g_product_roadmap "$tools" "$prefix" "$dir"
  : >"$prefix.out"; : >"$prefix.err"   # the roadmap build above is not this scenario's business
  g_run "$tools" "$prefix" product feature-init --id 001-demo --dir "$dir" --phase w1-golden
  g_files "$prefix"
}

# S7: product stage, on a roadmap with an already-init'd feature.
run_product_stage() {
  local tools="$1" prefix="$2" dir
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  dir="$G_REPO/pd"
  g_product_roadmap "$tools" "$prefix" "$dir"
  g_run "$tools" "$prefix" product feature-init --id 001-demo --dir "$dir" --phase w1-golden
  : >"$prefix.out"; : >"$prefix.err"
  g_run "$tools" "$prefix" product stage --by 001-demo --set started --dir "$dir" --phase w1-golden
  g_files "$prefix"
}

# S8: plan depth-check, on the real 021-dashboard wave plan copy.
run_plan_depth_check() {
  local tools="$1" prefix="$2"
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_run "$tools" "$prefix" plan depth-check --plan "$G_PLAN_FIXTURE/021-dashboard-wave-plan.md" --phase w1-golden
  g_files "$prefix"
}

# S9: code-scope claim.
run_code_scope_claim() {
  local tools="$1" prefix="$2"
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_run "$tools" "$prefix" code-scope claim --by 001-kritis-golden-sample \
    --scope "_shared/lib/kritis-golden-sample.cjs" --phase w1-golden
  g_files "$prefix"
}

# S10: code-scope stage, after a claim.
run_code_scope_stage() {
  local tools="$1" prefix="$2"
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_run "$tools" "$prefix" code-scope claim --by 001-kritis-golden-sample \
    --scope "_shared/lib/kritis-golden-sample.cjs" --phase w1-golden
  : >"$prefix.out"; : >"$prefix.err"
  g_run "$tools" "$prefix" code-scope stage --by 001-kritis-golden-sample --set started --phase w1-golden
  g_files "$prefix"
}

# S11: code-scope release, after claim + stage.
run_code_scope_release() {
  local tools="$1" prefix="$2"
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_run "$tools" "$prefix" code-scope claim --by 001-kritis-golden-sample \
    --scope "_shared/lib/kritis-golden-sample.cjs" --phase w1-golden
  g_run "$tools" "$prefix" code-scope stage --by 001-kritis-golden-sample --set started --phase w1-golden
  : >"$prefix.out"; : >"$prefix.err"
  g_run "$tools" "$prefix" code-scope release --by 001-kritis-golden-sample --phase w1-golden
  g_files "$prefix"
}

# S12: check reservations --claim.
run_check_reservations_claim() {
  local tools="$1" prefix="$2"
  : >"$prefix.out"; : >"$prefix.err"
  g_setup
  g_run "$tools" "$prefix" check reservations --claim migration-number:042 \
    --by 001-kritis-golden-sample --phase w1-golden
  g_files "$prefix"
}

# 11 scenarios, matching FR-008's AC list: spec init, spec set-size, spec
# update-status x2 (plain + --wave-plan-path), checklist run --only 9,10,11,
# product feature-init, product stage, plan depth-check, code-scope
# claim/stage/release, check reservations --claim.
G_SCENARIOS=(
  spec-init:run_spec_init
  spec-set-size:run_spec_set_size
  spec-update-status:run_spec_update_status
  spec-update-status-wave-plan:run_spec_update_status_wave_plan
  checklist-run:run_checklist_run
  product-feature-init:run_product_feature_init
  product-stage:run_product_stage
  plan-depth-check:run_plan_depth_check
  code-scope-claim:run_code_scope_claim
  code-scope-stage:run_code_scope_stage
  code-scope-release:run_code_scope_release
  check-reservations-claim:run_check_reservations_claim
)
