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
# The compliant config measured in ~/.codex-a1-review/config.toml (2026-09-24):
# comment header, the two runtime keys, and — added the same day after Wave 4
# measured that Codex auto-installs remote plugins unless `features.plugins`
# and `features.remote_plugin` are off (`codex features disable <f>` writes
# exactly this table) — the [features] switch. make_home() writes exactly this.
COMPLIANT_CONFIG='# a1-specforge — dedicated Codex home for cross-provider REVIEW runs only.
# Created 2026-09-24 (analysis finding F-049, spec 009-cross-provider-review-gate).
# Invariants: read-only sandbox, on-request approvals, NO MCP servers, NO plugins.
# The claudex-loop runner overrides approval_policy per call; the sandbox and the
# absence of MCP servers are what this file guarantees.
sandbox_mode = "read-only"
approval_policy = "on-request"

[features]
plugins = false
remote_plugin = false'

pass=0; fail=0; results=()
ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

# assert_rc <name> <expected> <actual> [detail]
assert_rc() {
  local name="$1" expected="$2" actual="$3" detail="${4:-}"
  if [[ "$actual" -eq "$expected" ]]; then ok "$name (exit $actual)"
  else bad "$name: expected exit $expected, got $actual${detail:+ — $detail}"; fi
}

# json_get <json-text> <node-expression over j> — evaluates the expression with
# `j` bound to the parsed JSON and prints the result (strings verbatim, else
# JSON). The JSON travels through a TEMP FILE, never as an argv element: a
# > 64 KiB stdout blew Linux ARG_MAX ("Argument list too long") in CI.
# Unparseable JSON prints UNPARSEABLE (never a silent pass).
JSON_TMP="$(mktemp -d)"
json_get() {
  local file="$JSON_TMP/json.$$.$RANDOM"
  printf '%s' "$1" > "$file"
  JSON_FILE="$file" node -e "
    let j; try { j = JSON.parse(require('fs').readFileSync(process.env.JSON_FILE, 'utf8')); } catch (e) { process.stdout.write('UNPARSEABLE'); process.exit(0); }
    const v = ($2); process.stdout.write(v === undefined ? 'undefined' : typeof v === 'string' ? v : JSON.stringify(v));
  " 2>&1
  rm -f "$file"
}

# assert_json <name> <json-text> <node-expression over j> <expected-string>
assert_json() {
  local name="$1" json="$2" expr="$3" want="$4" got
  got="$(json_get "$json" "$expr")"
  if [[ "$got" == "$want" ]]; then ok "$name"
  else bad "$name (want=$want got=$got)"; fi
}

# mode_of <path> — permission bits as octal (e.g. 700). GNU stat has no -f %Lp and
# BSD stat has no -c %a; python3 is on every machine that runs the fake runner.
mode_of() {
  python3 -c "import os, sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])" "$1"
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

# fake_runner_env — production `xprov run` hands the runner an ALLOWLISTED
# environment (Samuel W5 MAJOR 2), so FAKE_RUNNER_* knobs cannot travel as env
# vars through `run`. This writes every FAKE_RUNNER_* variable of the CURRENT
# environment into <TREE_VENDOR>/fake-runner.env.json, which the fake reads
# next to itself. Usage: `FAKE_RUNNER_CASE=revise fake_runner_env` right before
# the `xprov run`/`xprov gate` call. Direct `python3 fake-runner.py` calls
# still read the environment when no file exists.
fake_runner_env() {
  node -e "
    const o = {}; for (const [k, v] of Object.entries(process.env)) if (k.startsWith('FAKE_RUNNER_')) o[k] = v;
    require('fs').writeFileSync(process.argv[1], JSON.stringify(o, null, 1) + '\n');
  " "$TREE_VENDOR/fake-runner.env.json"
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
