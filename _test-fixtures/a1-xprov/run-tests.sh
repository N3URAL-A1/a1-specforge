#!/usr/bin/env bash
# Fixture suite: a1-xprov — cross-provider review gate (spec 009).
#
# HARNESS ONLY (Wave 1, frozen afterwards): helpers, the temp copy of _shared/
# with the fake runner swapped in, the fake PATH, the summary line. Every case
# lives in parts/NN-<group>.sh — one file per wave, sourced below in NN order —
# so parallel waves never write the same test file.
#
# Isolation of the runner path WITHOUT an override flag: production resolves
# the runner relative to its own module (_shared/vendor/claudex-loop/runner.py).
# make_tree() copies the whole _shared/ tree into mktemp -d, replaces the
# vendored runner.py with fake/fake-runner.py and regenerates the copy's
# SHA256SUMS. No environment variable can redirect production code to another
# runner — the only way to run a fake is to own the tree.
#
# Frozen expectations are written HERE as literals, never imported from the
# module under test (testing.md class 4): the runner sha256, version, upstream
# commit and CLI version were measured on 2026-09-24 before any adapter code
# existed.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUITE="$REPO_ROOT/_test-fixtures/a1-xprov"
CASES="$SUITE/cases"
FAKE="$SUITE/fake"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"          # REAL tree — static checks only
XPROV_LIB="$REPO_ROOT/_shared/lib/xprov.cjs"
VENDOR="$REPO_ROOT/_shared/vendor/claudex-loop"
REGISTRY="$REPO_ROOT/_shared/gates-registry.md"
ADR="$REPO_ROOT/docs/adr/2026-09-24-cross-provider-review-gate.md"

EXPECTED_RUNNER_SHA256="962dfdfe5d67b75eb73ec7c38b9186e6e6e0ca96a68d4ec82595305d8f737c8c"
EXPECTED_RUNNER_VERSION="2.1.0"
EXPECTED_UPSTREAM_COMMIT="8cf5e2c1771c5151d90c12642391d0ba8fa71b0e"
EXPECTED_CLI_VERSION="codex-cli 0.155.1"
GATE_PLAN="plan-review-xprov"
GATE_WAVE="wave-inspect-xprov"
# The five-line compliant config measured in ~/.codex-a1-review/config.toml
# (2026-09-24) plus its comment header; make_home() writes exactly this.
COMPLIANT_CONFIG='# a1-specforge — dedicated Codex home for cross-provider REVIEW runs only.
# Created 2026-09-24 (analysis finding F-049, spec 009-cross-provider-review-gate).
# Invariants: read-only sandbox, on-request approvals, NO MCP servers, NO plugins.
# The claudex-loop runner overrides approval_policy per call; the sandbox and the
# absence of MCP servers are what this file guarantees.
sandbox_mode = "read-only"
approval_policy = "on-request"'

pass=0; fail=0; results=()
ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

# assert_rc <name> <expected> <actual> [detail]
assert_rc() {
  local name="$1" expected="$2" actual="$3" detail="${4:-}"
  if [[ "$actual" -eq "$expected" ]]; then ok "$name (exit $actual)"
  else bad "$name: expected exit $expected, got $actual${detail:+ — $detail}"; fi
}

# assert_json <name> <json-text> <node-expression over j> <expected-string>
# The expression is evaluated with `j` bound to the parsed JSON; its result is
# stringified and compared exactly. Unparseable JSON fails the case (never a
# silent pass).
assert_json() {
  local name="$1" json="$2" expr="$3" want="$4" got
  got="$(node -e "
    let j; try { j = JSON.parse(process.argv[1]); } catch (e) { process.stdout.write('UNPARSEABLE'); process.exit(0); }
    const v = ($expr); process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));
  " "$json" 2>&1)"
  if [[ "$got" == "$want" ]]; then ok "$name"
  else bad "$name (want=$want got=$got)"; fi
}

# assert_eq <name> <got> <want>
assert_eq() {
  local name="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then ok "$name"
  else bad "$name (want=$want got=$got)"; fi
}

# sha256_of <file> — macOS ships shasum (perl), ubuntu ships both.
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

# sums_check <dir> — `shasum -c SHA256SUMS` inside <dir>; exit status is the verdict.
sums_check() {
  if command -v shasum >/dev/null 2>&1; then (cd "$1" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1)
  else (cd "$1" && sha256sum -c SHA256SUMS >/dev/null 2>&1); fi
}

# make_tree — sets TREE (temp dir holding a copy of _shared/), TREE_TOOLS,
# TREE_VENDOR; swaps the fake runner in, regenerates the copy's SHA256SUMS,
# prepends fake/bin to PATH (once) and exports FAKE_RUNNER_CASES_DIR.
FAKE_PATH_PREPENDED=0
make_tree() {
  TREE="$(mktemp -d)"
  cp -R "$REPO_ROOT/_shared" "$TREE/_shared"
  TREE_TOOLS="$TREE/_shared/a1-tools.cjs"
  TREE_VENDOR="$TREE/_shared/vendor/claudex-loop"
  cp "$FAKE/fake-runner.py" "$TREE_VENDOR/runner.py"
  ( cd "$TREE_VENDOR" && if command -v shasum >/dev/null 2>&1; then shasum -a 256 runner.py > SHA256SUMS; else sha256sum runner.py > SHA256SUMS; fi )
  # The fake CLIs are COPIED into a temp bin and made executable there — the
  # suite never chmods a file in the real tree (Samuel, Wave 1 review). The
  # fake runner needs no exec bit: production and H1 invoke it as
  # `python3 <path>`.
  if [[ $FAKE_PATH_PREPENDED -eq 0 ]]; then
    FAKE_BIN="$(mktemp -d)"
    cp "$FAKE/bin/"* "$FAKE_BIN/"
    chmod +x "$FAKE_BIN"/*
    export PATH="$FAKE_BIN:$PATH"
    FAKE_PATH_PREPENDED=1
  fi
  export FAKE_RUNNER_CASES_DIR="$CASES"
}

# make_phase <name> [plan-file] — builds a temp git checkout with one commit
# holding .a1/phases/<name>/PLAN.md (default: cases/approved.PLAN.md) and
# src/add.js (the probe layout). Sets PHASE_REPO, PHASE_DIR, PHASE_PLAN,
# PHASE_HEAD.
make_phase() {
  local name="$1" plan="${2:-$CASES/approved.PLAN.md}"
  PHASE_REPO="$(mktemp -d)"
  PHASE_DIR="$PHASE_REPO/.a1/phases/$name"
  PHASE_PLAN="$PHASE_DIR/PLAN.md"
  mkdir -p "$PHASE_DIR" "$PHASE_REPO/src"
  cp "$plan" "$PHASE_PLAN"
  printf 'export function add(a, b) { return a + b; }\n' > "$PHASE_REPO/src/add.js"
  ( cd "$PHASE_REPO" \
    && git init -q \
    && git config user.name fixture && git config user.email fixture@example.invalid \
    && git config commit.gpgsign false \
    && git add -A && git commit -qm "fixture: phase $name" )
  PHASE_HEAD="$(cd "$PHASE_REPO" && git rev-parse HEAD)"
}

# make_home — builds a 0700 dedicated Codex home with the compliant
# config.toml (0600). Sets XHOME. Callers set A1_XPROV_CODEX_HOME=$XHOME.
make_home() {
  XHOME="$(mktemp -d)"
  chmod 700 "$XHOME"
  printf '%s\n' "$COMPLIANT_CONFIG" > "$XHOME/config.toml"
  chmod 600 "$XHOME/config.toml"
}

# ---------- parts, in NN order ----------
shopt -s nullglob
parts=("$SUITE"/parts/*.sh)
shopt -u nullglob
if [[ ${#parts[@]} -eq 0 ]]; then
  echo "FAIL  harness: no parts/*.sh found under $SUITE" >&2
  fail=1
fi
for p in "${parts[@]}"; do
  # shellcheck disable=SC1090
  source "$p"
done

printf '%s\n' "${results[@]}"
echo "----"
echo "a1-xprov: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
