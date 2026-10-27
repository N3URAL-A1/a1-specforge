#!/usr/bin/env bash
# Fixture suite: a1-dashboard — `a1-tools dashboard build` (spec 021).
#
# HARNESS ONLY (Wave 1, frozen afterwards): isolation, helpers, counters, summary. Every case lives in
# parts/NN-<group>.sh, sourced below in sorted order; later waves add a part, never edit this file.
# Vault env is set PER CALL (vault_run); nothing vault-related is ever exported. HOME is a temp dir so no
# case can touch the real ~/.a1-* state or the real vault.
#
# Mutation proofs run this suite against a git-archive snapshot (A1_FX_TOOLS points at the snapshot's
# a1-tools.cjs); the live tree is never mutated.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID A1_INTENT_CHILD
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SUITE_DIR/../.." && pwd)"
TOOLS="${A1_FX_TOOLS:-$REPO_ROOT/_shared/a1-tools.cjs}"
SHARED="$(dirname "$TOOLS")"
export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0
export GIT_AUTHOR_NAME=fx GIT_AUTHOR_EMAIL=fx@example.invalid GIT_COMMITTER_NAME=fx GIT_COMMITTER_EMAIL=fx@example.invalid

mk_workdir WORK dashboard
: "${WORK:?}"
mkdir "$WORK/home" && export HOME="$WORK/home"   # the real home is never read or written

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }
expect() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi; }
expect_has()   { if grep -qF -- "$3" <<<"$2"; then ok "$1"; else bad "$1 (missing '$3' in: ${2:0:200})"; fi; }
expect_lacks() { if grep -qF -- "$3" <<<"$2"; then bad "$1 (found '$3')"; else ok "$1"; fi; }
# expect_count <name> <expected> <haystack> <fixed-string>  (count of matching lines)
expect_count() {
  local n; n="$(grep -cF -- "$4" <<<"$3")"
  if [[ "$n" == "$2" ]]; then ok "$1"; else bad "$1 (expected $2 lines with '$4', got $n)"; fi
}

# tree_hash <dir> [<excluded basename>] — cksum + path per file, sorted; GNU and BSD portable.
tree_hash() {
  local d="$1" skip="${2:-}" f
  [[ -d "$d" ]] || { echo "no-dir"; return; }
  (cd "$d" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do
    [[ -n "$skip" && "$(basename "$f")" == "$skip" ]] && continue
    printf '%s %s\n' "$(cksum <"$f")" "$f"
  done)
}

FX_N=0
# mk_fixture_repo <var> — a git repo with the real-file docs/product copy and one commit.
mk_fixture_repo() {
  FX_N=$((FX_N + 1)); local dir="$WORK/repo$FX_N"
  mkdir -p "$dir" && cp -R "$SUITE_DIR/fixtures/repo/." "$dir/"
  git init -q "$dir" && git -C "$dir" add -A && git -C "$dir" -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q -m fx
  printf -v "$1" '%s' "$dir"
}
# mk_fixture_vault <var> — a temp vault whose hub declares a1_writer_host: fx-writer.
mk_fixture_vault() {
  FX_N=$((FX_N + 1)); local dir="$WORK/vault$FX_N"
  mkdir -p "$dir" && cp -R "$SUITE_DIR/fixtures/vault/." "$dir/"
  printf -v "$1" '%s' "$dir"
}

# vault_run <repo> <vault> <args...> — a1-tools in <repo> with the vault env for this call only.
# Sets OUT (stdout), ERR (stderr) and RC.
vault_run() {
  local repo="$1" vault="$2"; shift 2
  local errf="$WORK/err.$$"
  OUT="$(cd "$repo" && A1_VAULT_ROOT="$vault" A1_HOST_ID=fx-writer node "$TOOLS" "$@" 2>"$errf")"; RC=$?
  ERR="$(cat "$errf")"; rm -f "$errf"
}
# harness_run <repo> <vault> <harness args...> — the in-process harness; sets OUT, ERR, RC.
harness_run() {
  local repo="$1" vault="$2"; shift 2
  local errf="$WORK/err.$$"
  OUT="$(A1_FX_SHARED="$SHARED" A1_VAULT_ROOT="$vault" A1_HOST_ID=fx-writer node "$SUITE_DIR/fixtures/harness.cjs" --cwd "$repo" "$@" 2>"$errf")"; RC=$?
  ERR="$(cat "$errf")"; rm -f "$errf"
}
# json_get <json> <js expression over j>
json_get() { node -e 'const j=JSON.parse(process.argv[1]);const v=eval(process.argv[2]);process.stdout.write(typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }

for part in "$SUITE_DIR"/parts/*.sh; do
  [[ -e "$part" ]] || continue
  # shellcheck disable=SC1090
  . "$part"
done

echo
echo "a1-dashboard: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
