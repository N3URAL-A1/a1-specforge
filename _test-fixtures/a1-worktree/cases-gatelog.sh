# Sourced by run-tests.sh (spec 028 FR-011, wave 2; review round m6/m8). Uses the suite helpers: make_repo, extract_field, assert_eq,
# TOOLS, REPO_ROOT, WORK. Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# ----------------------------------------------------------------------------
# Spec 028 FR-011: worktree exit refuses to lose an unrecorded gate log
# Red-making change for each case is named on its line. A1_VAULT_ROOT points at a temp store;
# the "no store" case sets HOME to an empty dir and runs outside any repo, so neither the
# repo-local nor the legacy ~/N3URAL-Vault tier can resolve.
# ----------------------------------------------------------------------------
unset A1_VAULT_ROOT
WG_STORE="$WORK/wg-vault"; mkdir -p "$WG_STORE/pattern/a1-learnings"
mkdir -p "$WORK/wg-nohome"
printf -- '- [x] Add `b` in `a.js`\n' > "$WORK/wg-plan.md"

# wg_setup <name> — a prepared and entered worktree; sets WG_REPO WG_ID WG_WT. `.a1/` is excluded
# in the repo so the gate log does not count as untracked content when the worktree is removed.
wg_setup() {
  WG_REPO="$WORK/wg-$1"; make_repo "$WG_REPO"
  echo '.a1/' >> "$WG_REPO/.git/info/exclude"
  local out; out=$(node "$TOOLS" worktree prepare "$WG_REPO" "wg-$1" 2>&1)
  WG_ID=$(extract_field id "$out")
  node "$TOOLS" worktree enter "$WG_ID" >/dev/null 2>&1
  WG_WT="$WORK/a1-worktrees/wg-$1"
}
# wg_log <scope> — one real gate-log line for the scope, written from inside the worktree.
wg_log() { (cd "$WG_WT" && node "$TOOLS" phantom check "$WORK/wg-plan.md" --repo-path "$WG_WT" --since HEAD --phase "$1" >/dev/null 2>&1); }
wg_record() { A1_VAULT_ROOT="$WG_STORE" node "$TOOLS" run record --repo "$WG_WT" --scope "$1" >/dev/null 2>&1; }
wg_exit() { WG_OUT=$(A1_VAULT_ROOT="$WG_STORE" node "$TOOLS" worktree exit "$WG_ID" "$@" 2>&1); WG_EX=$?; }
wg_has() { [[ "$WG_OUT" == *"$1"* ]] && echo yes || echo no; }

# G1 — red-making: no refusal in cmdWorktreeExit (exit 0, worktree removed, log lost).
wg_setup g1; wg_log s028
wg_exit --mode keep
assert_eq "gl-keep-unrecorded-refused" "1" "$WG_EX"
assert_eq "gl-keep-unrecorded-prints-record-command" "yes" "$(wg_has "a1-tools run record --repo $WG_WT --scope s028")"
assert_eq "gl-keep-unrecorded-removes-nothing" "yes" "$([[ -d "$WG_WT" ]] && echo yes || echo no)"
assert_eq "gl-keep-unrecorded-registry-not-cleaned" "prepared-or-active" "$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const e=r.worktrees.find(x=>x.id===process.argv[2]);process.stdout.write(e&&e.status!=="cleaned"?"prepared-or-active":String(e&&e.status))' "$A1_WORKTREE_REGISTRY" "$WG_ID")"
# G2 — after `run record` the same exit succeeds (control: the refusal is about the missing record).
wg_record s028
wg_exit --mode keep
assert_eq "gl-keep-after-record-succeeds" "0" "$WG_EX"
assert_eq "gl-keep-after-record-removed" "no" "$([[ -d "$WG_WT" ]] && echo yes || echo no)"

# G3 — discard is refused too; --force-discard skips the check (red: force flag ignored or check absent).
wg_setup g3; wg_log s028
wg_exit --mode discard
assert_eq "gl-discard-unrecorded-refused" "1" "$WG_EX"
assert_eq "gl-discard-unrecorded-prints-record-command" "yes" "$(wg_has "run record --repo $WG_WT --scope s028")"
wg_exit --mode discard --force-discard
assert_eq "gl-force-discard-skips-check" "0" "$WG_EX"

# G4 — handoff is unchanged (red: the check placed before the handoff return).
wg_setup g4; wg_log s028
wg_exit --mode handoff
assert_eq "gl-handoff-unchanged" "0" "$WG_EX"

# G5 — no learning store resolves: stderr warning gate_log_unpreserved, exit proceeds (red: exit 1 traps keep).
wg_setup g5; wg_log s028
WG_OUT=$(cd "$WORK" && HOME="$WORK/wg-nohome" node "$TOOLS" worktree exit "$WG_ID" --mode keep 2>&1); WG_EX=$?
assert_eq "gl-no-store-exit-proceeds" "0" "$WG_EX"
assert_eq "gl-no-store-warning-code" "yes" "$(wg_has "gate_log_unpreserved")"
assert_eq "gl-no-store-hint-text" "yes" "$(wg_has "set A1_VAULT_ROOT, then run run record")"

# G6 — no gate log at all: no check, no refusal (red: refusing when the list is empty).
wg_setup g6
wg_exit --mode keep
assert_eq "gl-no-gate-log-no-refusal" "0" "$WG_EX"
# G6b — an empty gate-log file is not a log worth preserving.
wg_setup g6b; mkdir -p "$WG_WT/.a1/phases/s028"; : > "$WG_WT/.a1/phases/s028/gate-log.jsonl"
wg_exit --mode keep
assert_eq "gl-empty-gate-log-no-refusal" "0" "$WG_EX"

# G7 — the worktree folder is already gone: no check, no refusal.
wg_setup g7; wg_log s028; rm -rf "$WG_WT"
wg_exit --mode keep
assert_eq "gl-folder-gone-no-refusal" "0" "$WG_EX"

# G8 — two scopes, one recorded: only the unrecorded scope is named (red: listing every scope).
wg_setup g8; wg_log s028; wg_log s029; wg_record s028
wg_exit --mode keep
assert_eq "gl-two-scopes-refused" "1" "$WG_EX"
assert_eq "gl-two-scopes-names-unrecorded" "yes" "$(wg_has "--scope s029")"
assert_eq "gl-two-scopes-omits-recorded" "no" "$(wg_has "--scope s028")"
wg_record s029
wg_exit --mode keep
assert_eq "gl-two-scopes-all-recorded-succeeds" "0" "$WG_EX"

# G9 — review round m6: a learning-store lookup error other than no_learning_store is an error, not "no store": exit 1, nothing removed.
# The real exported cmdWorktreeExit runs; only run-record.storeDir is made to throw an unrelated error (red: every error took the warn-and-proceed path).
wg_setup g9; wg_log s028
WG_OUT=$(A1_VAULT_ROOT="$WG_STORE" node -e '
  const rr = require(process.argv[1] + "/_shared/lib/run-record.cjs");
  rr.storeDir = () => { throw new Error("EACCES: simulated store lookup failure"); };
  require(process.argv[1] + "/_shared/lib/worktree.cjs").cmdWorktreeExit([process.argv[2], "--mode", "keep"]);
' "$REPO_ROOT" "$WG_ID" 2>&1); WG_EX=$?
assert_eq "gl-store-error-exit-1" "1" "$WG_EX"
assert_eq "gl-store-error-names-cause" "yes" "$(wg_has "simulated store lookup failure")"
assert_eq "gl-store-error-removes-nothing" "yes" "$([[ -d "$WG_WT" ]] && echo yes || echo no)"
