#!/usr/bin/env bash
# Part 11 — Wave 7 review (Samuel MAJOR, team-lead decision 2026-10-03): the
# waiver is a HUMAN act behind the owner-approval guards and lives in a guarded
# store (spec 009 FR-007; SC-010, SC-013). Sourced by run-tests.sh. Authority
# and binding (index-only rows, stale plan sha, other phase/gate, wave head,
# --expect-sha) are arms R4d/R7a–R7k in part 06; this part covers the guards
# and the positive owner path. Each arm names its red-making change:
#   W1  stdin not a TTY → exit 2, store absent.            Red if waive skips guardRefusal.
#   W1b …an existing store stays byte-identical.           Red if waive writes before the guard.
#   W2  pseudo-TTY with CLAUDECODE=1 → exit 2.            Red if the env check is dropped.
#   W3  launched from a parent whose start name is claude → exit 2.
#       Red if the ancestry walk is dropped.
#   W4  the PreToolUse hook denies a Bash command containing `xprov waive`
#       (also obfuscated) or the store path `a1-xprov/waivers`; `git status`
#       passes.                                            Red if the hook pattern is dropped.
#   W4b the same without node on PATH (raw-JSON fallback): escaped quotes / \n.
#       Red if the fallback keeps backslashes.
#   W5  (owner path, pseudo-TTY outside Claude Code) the gate id typed back →
#       exit 0; the store record's key equals what THIS file computes from the
#       spec (realpath of git-common-dir, sha256 of the raw PLAN.md); index.json
#       mirror without `verdict`; `## Waiver` section; xprov_waived observation;
#       load-check exit 0 with accepted: waiver.          Red if the key drops plan_sha256 / waive writes verdict.
#   W6  (owner path) a wrong typed gate id → exit 2, store unchanged.
#       Red if the typed id is not compared.
#   W7  (owner path) wave waiver: head = HEAD of --work-path, base = full sha →
#       wave-status exit 0.                                Red if the wave key drops head.
#   W8  (owner path) a second waiver is written by temp file + rename: the
#       store's inode changes and the first record survives.
# The owner-path arms need a process tree that does not descend from Claude
# Code: under Claude Code they print `SKIP (claude-code ancestor)`; with
# CI=true a SKIP is a FAIL, so CI always runs them (as part 08's R30j2).

TMP11="$(mktemp -d "${TMPDIR:-/tmp}/a1x11.XXXXXX")"
[[ -n "$TMP11" && -d "$TMP11" ]] || { echo "FAIL  part 11: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_11="$HOME"
export HOME="$TMP11/home"; mkdir -p "$HOME"
STORE11="$HOME/.a1-xprov/waivers.json"

# Own helpers (a part never depends on a helper another part defines).
claude_ancestor11() {
  [[ -n "${CLAUDECODE:-}" || -n "${CLAUDE_PID:-}" ]] && return 0
  local p=$$ c
  while [[ -n "$p" && "$p" -gt 1 ]]; do
    c="$(ps -o comm= -p "$p" 2>/dev/null)"
    [[ "$(basename -- "${c:-x}")" == claude ]] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
  done
  return 1
}
skip11() {
  if [[ "${CI:-}" == "true" ]]; then bad "$1: SKIP (claude-code ancestor) is not allowed when CI=true"
  else results+=("SKIP (claude-code ancestor)  $1"); fi
}
NOCLAUDE11=(env)
for v11 in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$'); do NOCLAUDE11+=(-u "$v11"); done
pty11() {
  local cmd; cmd="$(printf '%q ' "$@")"
  if [[ "$(uname)" == Darwin ]]; then
    ( sleep 1; [[ -n "${PTY_TYPED:-}" ]] && printf '%s\n' "$PTY_TYPED"; sleep 2 ) | script -q /dev/null "$@" > "$TMP11/pty-out.txt" 2>&1
  else
    ( sleep 1; [[ -n "${PTY_TYPED:-}" ]] && printf '%s\n' "$PTY_TYPED"; sleep 2 ) | script -qec "$cmd" /dev/null > "$TMP11/pty-out.txt" 2>&1
  fi
}
fakeparent11() {
  mkdir -p "$(dirname "$1")"
  if [[ "$(uname)" == Darwin ]]; then cp /bin/bash "$1" && codesign -s - -f "$1" >/dev/null 2>&1
  else cp /bin/sh "$1"; fi
  chmod +x "$1"
}
said11() { grep -qF -- "$3" "$2" && ok "$1: output says '$3'" || bad "$1: output lacks '$3': $(tr -d '\r' < "$2" | tail -n 2)"; }
storesum11() { if [[ -e "$STORE11" ]]; then (shasum -a 256 "$STORE11" 2>/dev/null || sha256sum "$STORE11") | cut -d' ' -f1; else echo absent; fi; }
repokey11() { (cd "$PHASE_REPO" && cd "$(git rev-parse --git-common-dir)" && pwd -P); }
plansha11() { (shasum -a 256 "$PHASE_PLAN" 2>/dev/null || sha256sum "$PHASE_PLAN") | cut -d' ' -f1; }
prep11() { make_tree; make_phase p11; rm -rf "$HOME/.a1-xprov"; }
# seed11 — one valid record of another phase, written in the documented format
seed11() {
  mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  printf '{"version":1,"waivers":[{"repo":"%s","phase":"other","gate":"%s","plan_sha256":"%s","wave":null,"lane":null,"head":null,"base":null,"reason":"seed","by":"seed","ts":"2026-10-03T00:00:00.000Z"}]}\n' \
    "$(repokey11)" "$GATE_PLAN" "$(plansha11)" > "$STORE11"
  chmod 600 "$STORE11"
}

caseW() {
  local tools rc before
  prep11; tools="$TREE_TOOLS"
  # stdin is /dev/null: not a TTY
  ( cd "$PHASE_REPO" && "${NOCLAUDE11[@]}" node "$tools" xprov waive --phase p11 --gate "$GATE_PLAN" --reason "quota" --by owner < /dev/null > "$TMP11/w1.out" 2>&1 ); rc=$?
  assert_rc "W1 stdin not a TTY → exit 2" 2 "$rc"
  [[ "$(storesum11)" == absent ]] && ok "W1 no store written" || bad "W1 a store was written"
  said11 "W1" "$TMP11/w1.out" "must both be a terminal"
  ( cd "$PHASE_REPO" && seed11 ); before="$(storesum11)"
  ( cd "$PHASE_REPO" && "${NOCLAUDE11[@]}" node "$tools" xprov waive --phase p11 --gate "$GATE_PLAN" --reason "quota" --by owner < /dev/null > "$TMP11/w1b.out" 2>&1 ); rc=$?
  assert_rc "W1b stdin not a TTY with a store present → exit 2" 2 "$rc"
  assert_eq "W1b the existing store is byte-identical" "$(storesum11)" "$before"

  PTY_TYPED="$GATE_PLAN" pty11 env CLAUDECODE=1 sh -c 'cd "$1" && node "$2" xprov waive --phase p11 --gate "$3" --reason quota --by owner' sh "$PHASE_REPO" "$tools" "$GATE_PLAN"; rc=$?
  assert_rc "W2 CLAUDECODE=1 under a pseudo-TTY → exit 2" 2 "$rc"
  assert_eq "W2 the store is byte-identical" "$(storesum11)" "$before"
  said11 "W2" "$TMP11/pty-out.txt" "CLAUDECODE"

  local fp="$TMP11/bin/claude"; fakeparent11 "$fp"
  PTY_TYPED="$GATE_PLAN" pty11 "${NOCLAUDE11[@]}" "$fp" -c 'cd "$1" && node "$2" xprov waive --phase p11 --gate "$3" --reason quota --by owner; exit $?' sh "$PHASE_REPO" "$tools" "$GATE_PLAN"; rc=$?
  assert_rc "W3 launched from a parent whose start name is claude → exit 2" 2 "$rc"
  assert_eq "W3 the store is byte-identical" "$(storesum11)" "$before"
  said11 "W3" "$TMP11/pty-out.txt" "started as claude"

  local hook="$REPO_ROOT/.claude/hooks/xprov-deny-allowlist-approve.sh" p hv
  local -a deny=(
    'node _shared/a1-tools.cjs xprov waive --phase p --gate plan-review-xprov --reason x --by y'
    'xprov  waive --phase p'
    'xprov \"waive\" --phase p'
    'xprov \\\nwaive --phase p'
    'cat ~/.a1-xprov/waivers.json')
  for p in "${deny[@]}"; do
    hv="$(printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$p" | bash "$hook" 2>/dev/null)"
    assert_json "W4 hook denies ${p}" "$hv" "j.hookSpecificOutput.permissionDecision" "deny"
  done
  hv="$(printf '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | bash "$hook" 2>/dev/null)"
  [[ "$hv" != *deny* ]] && ok "W4 hook lets git status through" || bad "W4 hook denied git status"
  # W4b — the fallback without node judges the raw JSON (Samuel NIT): escaped quotes and \n
  local nonode="$TMP11/nonode-bin"; mkdir -p "$nonode"
  for tool in cat sed tr printf; do [[ -x "/usr/bin/$tool" ]] && ln -sf "/usr/bin/$tool" "$nonode/$tool"; [[ -x "/bin/$tool" ]] && ln -sf "/bin/$tool" "$nonode/$tool"; done
  for p in 'xprov \"waive\" --phase p' 'xprov \\\nwaive --phase p' 'xprov  waive --phase p'; do
    hv="$(printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$p" | PATH="$nonode" /bin/bash "$hook" 2>/dev/null)"
    [[ "$hv" == *'"deny"'* ]] && ok "W4b hook without node denies ${p}" || bad "W4b hook without node let ${p} through"
  done
  hv="$(printf '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | PATH="$nonode" /bin/bash "$hook" 2>/dev/null)"
  [[ "$hv" != *deny* ]] && ok "W4b hook without node lets git status through" || bad "W4b hook without node denied git status"

  if claude_ancestor11; then
    skip11 "W5 owner waiver for the plan gate"; skip11 "W6 wrong typed gate id"; skip11 "W7 owner waiver for a wave"; skip11 "W8 atomic second write"
    return 0
  fi
  prep11
  PTY_TYPED="$GATE_PLAN" pty11 "${NOCLAUDE11[@]}" sh -c 'cd "$1" && node "$2" xprov waive --phase p11 --gate "$3" --reason "codex quota" --by owner-fixture' sh "$PHASE_REPO" "$tools" "$GATE_PLAN"; rc=$?
  assert_rc "W5 owner waiver (gate id typed back) → exit 0" 0 "$rc"
  assert_json "W5 the store record's key equals the spec's computation" "$(cat "$STORE11" 2>/dev/null || echo '{}')" \
    "(j.waivers || []).map((w) => [w.repo, w.phase, w.gate, w.plan_sha256, w.wave, w.by].join('|')).join(',')" "$(repokey11)|p11|$GATE_PLAN|$(plansha11)||owner-fixture"
  assert_eq "W5 store mode 0600" "$(node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$STORE11")" "600"
  assert_json "W5 index.json mirror: waived true, no verdict, by the owner" "$(cat "$PHASE_DIR/xreview/index.json" 2>/dev/null || echo '[{}]')" \
    "[j[0].waived, 'verdict' in j[0], j[0].by, j[0].plan_sha256].join('/')" "true/false/owner-fixture/$(plansha11)"
  # W5by (Rene, spec FR-007 mirror): the mirror's `by` is exactly the --by value typed by the owner,
  # never the literal 'human'. Mutation MW5by (mirror by: 'human') turns it red — run in node:20.
  assert_json "W5by the index.json mirror's by equals the --by value (owner-fixture)" "$(cat "$PHASE_DIR/xreview/index.json" 2>/dev/null || echo '[{}]')" "String(j[0].by)" "owner-fixture"
  grep -q "^## Waiver" "$PHASE_DIR/XREVIEW.md" 2>/dev/null && ok "W5 XREVIEW.md has a ## Waiver section" || bad "W5 no ## Waiver section"
  grep -q '"pattern":"xprov_waived"' "$PHASE_DIR/observations.jsonl" 2>/dev/null && ok "W5 one xprov_waived observation" || bad "W5 no xprov_waived observation"
  local lc; lc="$(cd "$PHASE_REPO" && node "$tools" xprov load-check --phase p11 2>/dev/null)"; rc=$?
  assert_rc "W5 load-check exit 0 on the store waiver" 0 "$rc"
  assert_json "W5 load-check accepted: waiver" "$lc" "j.accepted" "waiver"

  before="$(storesum11)"
  PTY_TYPED="wave-inspect-xprov" pty11 "${NOCLAUDE11[@]}" sh -c 'cd "$1" && node "$2" xprov waive --phase p11 --gate "$3" --reason again --by owner-fixture' sh "$PHASE_REPO" "$tools" "$GATE_PLAN"; rc=$?
  assert_rc "W6 a wrong typed gate id → exit 2" 2 "$rc"
  assert_eq "W6 the store is byte-identical" "$(storesum11)" "$before"

  printf '## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"
  ( cd "$PHASE_REPO" && git add -A && git commit -qm "wave 1" ); local h7; h7="$(git -C "$PHASE_REPO" rev-parse HEAD)"
  local ino; ino="$(ls -i "$STORE11" | awk '{print $1}')"
  PTY_TYPED="$GATE_WAVE" pty11 "${NOCLAUDE11[@]}" sh -c 'cd "$1" && node "$2" xprov waive --phase p11 --gate "$3" --wave 1 --base "$4" --reason "codex quota" --by owner-fixture' sh "$PHASE_REPO" "$tools" "$GATE_WAVE" "$PHASE_HEAD"; rc=$?
  assert_rc "W7 owner waiver for wave 1 → exit 0" 0 "$rc"
  assert_json "W7 the wave record carries head = HEAD and the full base" "$(cat "$STORE11")" \
    "(j.waivers.find((w) => w.gate === '$GATE_WAVE') || {}).head + '/' + (j.waivers.find((w) => w.gate === '$GATE_WAVE') || {}).base" "$h7/$PHASE_HEAD"
  ( cd "$PHASE_REPO" && node "$tools" xprov wave-status --phase p11 >/dev/null 2>&1 ); rc=$?
  assert_rc "W7 wave-status exit 0 on the store waiver" 0 "$rc"
  [[ "$(ls -i "$STORE11" | awk '{print $1}')" != "$ino" ]] && ok "W8 the second write replaced the file (temp + rename)" || bad "W8 the store was written in place"
  assert_json "W8 the first record survives" "$(cat "$STORE11")" "j.waivers.map((w) => w.gate).join(',')" "$GATE_PLAN,$GATE_WAVE"
}

caseW
export HOME="$SAVED_HOME_11"
rm -rf "$TMP11"
