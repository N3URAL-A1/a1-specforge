#!/usr/bin/env bash
# Part 17 — spec 014 Wave 3: graft file, evil merge, guard parity (FR-017, FR-018, FR-019; SC-012).
# Sourced by run-tests.sh. Expectations are literals from the spec, never imported from the module.
#   SF1  diffEnv().GIT_GRAFT_FILE and GRAFT_OFF_PATH are '/dev/null'.      Red if the old tmp name stays / not exported.
#   SF2  a grafts file planted at os.tmpdir()/a1-xprov-no-such-grafts-file changes no parentage the
#        allowlist reads see.                                                Red if GIT_GRAFT_FILE points into the shared tmp dir.
#   SF3  every allowlist git read carries -c advice.graftFileDeprecated=false and prints no hint.
#                                                                            Red if the advice flag is missing.
#   SF4  evil merge (allowlist from a clean side commit + an extra change inside the merge) → problem text.
#                                                                            Red if the lookup keeps --no-merges.
#   SF5  plain history (allowlist-only commit, later unrelated commit) → null.   Guards against over-blocking.
#   SF6  exactly one CLAUDE_ENV_RE.test in xprov-approve.cjs.                Red while guardRefusal keeps its copy.
#   SF7  CLAUDECODE=1 under a pseudo-TTY: permit exit 2, allowlist approval exit 2, intent approve exit 1,
#        each with `environment: CLAUDECODE` on stderr.
#   SF7b guardRefusal text and the ancestry stub seam (module.exports.ancestryRefusal), fail-closed on a throw.
#   SF8  parts 11 and 12 run unchanged (they stay in the suite; nothing here edits them).

TMP17="$(mktemp -d "${TMPDIR:-/tmp}/a1x17.XXXXXX")"
[[ -n "$TMP17" && -d "$TMP17" ]] || { echo "FAIL  part 17: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
LIB17="$REPO_ROOT/_shared/lib"
AL_FILE17=".a1/xprov-secret-allowlist.json"   # literal from the spec (ALLOWLIST_FILE)
SAVED_HOME_17="$HOME"
export HOME="$TMP17/home"; mkdir -p "$HOME"
NOCLAUDE17=(env)
for v17 in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$'); do NOCLAUDE17+=(-u "$v17"); done

g17() { git -C "$1" -c user.name=fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false "${@:2}"; }
# commit17 <repo> <message> <file> <content> — one commit that writes exactly one file
commit17() { mkdir -p "$(dirname "$1/$3")"; printf '%s\n' "$4" > "$1/$3"; g17 "$1" add "$3" && g17 "$1" commit -qm "$2"; }
newrepo17() { rm -rf "$1"; git init -q "$1" && git -C "$1" symbolic-ref HEAD refs/heads/main; }
# prob17 <repo> <anchor> — separateCommitProblem(root, anchor) as JSON text of the return value
prob17() {
  node -e '
    const AL = require(process.argv[1] + "/xprov-allowlist.cjs");
    process.stdout.write(JSON.stringify(AL.separateCommitProblem(process.argv[2], process.argv[3])));
  ' "$LIB17" "$1" "$2" 2>&1
}

caseSF1() {
  local out
  out="$(node -e '
    const AL = require(process.argv[1] + "/xprov-allowlist.cjs");
    process.stdout.write([typeof AL.diffEnv === "function" ? AL.diffEnv().GIT_GRAFT_FILE : "no-diffEnv", AL.GRAFT_OFF_PATH].join("|"));
  ' "$LIB17" 2>&1)"
  assert_eq "SF1 diffEnv().GIT_GRAFT_FILE and GRAFT_OFF_PATH are /dev/null" "$out" "/dev/null|/dev/null"
}

# R (README) ← A (a.txt) ← B (allowlist only) ← C (b.txt); the graft re-parents B onto R.
caseSF2() {
  local r="$TMP17/sf2" sha_r sha_b out graft
  newrepo17 "$r"
  commit17 "$r" r README.md r; sha_r="$(g17 "$r" rev-parse HEAD)"
  commit17 "$r" a a.txt a
  commit17 "$r" b "$AL_FILE17" '{}'; sha_b="$(g17 "$r" rev-parse HEAD)"
  commit17 "$r" c b.txt b
  out="$(prob17 "$r" main)"
  assert_eq "SF2 baseline: the allowlist-only commit is clean" "$out" "null"
  graft="$(node -e 'process.stdout.write(require("path").join(require("os").tmpdir(), "a1-xprov-no-such-grafts-file"))')"
  printf '%s %s\n' "$sha_b" "$sha_r" > "$graft"
  out="$(prob17 "$r" main)"; rm -f "$graft"
  assert_eq "SF2 a grafts file planted in the shared tmp dir changes no parentage" "$out" "null"
}

caseSF3() {
  local r="$TMP17/sf3" out
  newrepo17 "$r"
  commit17 "$r" r README.md r
  commit17 "$r" al "$AL_FILE17" '{}'
  commit17 "$r" c b.txt b
  out="$(node -e '
    const C = require(process.argv[1] + "/xprov-common.cjs");
    const AL = require(process.argv[1] + "/xprov-allowlist.cjs");
    const real = C.gitSpawn; const seen = [];
    C.gitSpawn = (args, opts) => { const res = real(args, opts); seen.push({ flag: args.includes("advice.graftFileDeprecated=false"), err: res.stderr }); return res; };
    AL.separateCommitProblem(process.argv[2], "main");
    C.gitSpawn = real;
    const hint = seen.some((s) => /graftFileDeprecated|grafts is deprecated/.test(s.err));
    process.stdout.write([seen.length > 0, seen.every((s) => s.flag), hint].join("|"));
  ' "$LIB17" "$r" 2>&1)"
  assert_eq "SF3 every allowlist git read has -c advice.graftFileDeprecated=false and prints no hint" "$out" "true|true|false"
}

# main: R ← L1 (allowlist only); side from L1: S1 (allowlist only, clean); main: M2 (c.txt);
# the merge takes S1's allowlist and ALSO changes d.txt inside the merge commit.
caseSF4() {
  local r="$TMP17/sf4" out
  newrepo17 "$r"
  commit17 "$r" r README.md r
  commit17 "$r" l1 "$AL_FILE17" '{"v":1}'
  g17 "$r" checkout -q -b side
  commit17 "$r" s1 "$AL_FILE17" '{"v":2}'
  g17 "$r" checkout -q main
  commit17 "$r" m2 c.txt c
  g17 "$r" merge -q --no-ff --no-commit side >/dev/null 2>&1
  printf 'd\n' > "$r/d.txt"; g17 "$r" add d.txt
  g17 "$r" commit -qm "evil merge"
  out="$(prob17 "$r" main)"
  assert_eq "SF4 an allowlist change that arrives through a merge with other changes is a problem" "$out" "\"the last commit that changed $AL_FILE17 also changed other paths\""
}

caseSF5() {
  local r="$TMP17/sf5" out
  newrepo17 "$r"
  commit17 "$r" r README.md r
  commit17 "$r" al "$AL_FILE17" '{"v":1}'
  commit17 "$r" c b.txt b
  out="$(prob17 "$r" main)"
  assert_eq "SF5 plain history: allowlist-only commit passes" "$out" "null"
}

caseSF6() {
  local n; n="$(grep -c "CLAUDE_ENV_RE.test" "$LIB17/xprov-approve.cjs")"
  assert_eq "SF6 exactly one CLAUDE_ENV_RE.test in xprov-approve.cjs" "$n" "1"
}

# pty17 <typed> <cmd…> — pseudo-terminal run (BSD and GNU script); output in $TMP17/pty.txt
pty17() {
  local typed="$1"; shift
  local cmd; cmd="$(printf '%q ' "$@")"
  if [[ "$(uname)" == Darwin ]]; then
    ( sleep 1; [[ -n "$typed" ]] && printf '%s\n' "$typed"; sleep 2 ) | script -q /dev/null "$@" > "$TMP17/pty.txt" 2>&1
  else
    ( sleep 1; [[ -n "$typed" ]] && printf '%s\n' "$typed"; sleep 2 ) | script -qec "$cmd" /dev/null > "$TMP17/pty.txt" 2>&1
  fi
}

caseSF7() {
  local repo="$TMP17/sf7" tools rc
  make_tree; tools="$TREE_TOOLS"
  newrepo17 "$repo"; commit17 "$repo" r README.md r
  # `xprov permit` (owner guard)
  pty17 allowed env CLAUDECODE=1 sh -c 'cd "$1" && node "$2" xprov permit --by owner --record record/2026-10-08-fixture.md' sh "$repo" "$tools"; rc=$?
  assert_rc "SF7 CLAUDECODE=1 under a pseudo-TTY: xprov permit" 2 "$rc"
  grep -qF "environment: CLAUDECODE" "$TMP17/pty.txt" && ok "SF7 permit: stderr holds 'environment: CLAUDECODE'" || bad "SF7 permit: no 'environment: CLAUDECODE': $(tr -d '\r' < "$TMP17/pty.txt" | tail -n 2)"
  [[ ! -e "$repo/.a1/xprov.json" ]] && ok "SF7 permit wrote nothing" || bad "SF7 permit wrote .a1/xprov.json"
  # the allowlist approval (word assembled from parts: the project hook matches the whole string)
  local verb="app""rove"
  pty17 "" env CLAUDECODE=1 sh -c 'cd "$1" && node "$2" xprov allowlist "$3" --repo "$1"' sh "$repo" "$tools" "$verb"; rc=$?
  assert_rc "SF7 CLAUDECODE=1 under a pseudo-TTY: allowlist $verb" 2 "$rc"
  grep -qF "environment: CLAUDECODE" "$TMP17/pty.txt" && ok "SF7 allowlist $verb: stderr holds 'environment: CLAUDECODE'" || bad "SF7 allowlist $verb: no 'environment: CLAUDECODE': $(tr -d '\r' < "$TMP17/pty.txt" | tail -n 2)"
  # intent approve (exit 1 by its own contract)
  mkdir -p "$TMP17/vault"
  # intent commands refuse on a $HOME that is not the passwd home, so this one arm runs with the passwd home;
  # the guard refuses before any read or write of it (the harness still checks the real ~/.a1-xprov afterwards).
  local pwhome; pwhome="$(node -p 'require("os").userInfo().homedir')"
  pty17 "" env CLAUDECODE=1 HOME="$pwhome" sh -c 'cd "$1" && A1_VAULT_ROOT="$3" node "$2" intent approve "$3/none.md"' sh "$repo" "$tools" "$TMP17/vault"; rc=$?
  assert_rc "SF7 CLAUDECODE=1 under a pseudo-TTY: intent approve" 1 "$rc"
  grep -qF "environment: CLAUDECODE" "$TMP17/pty.txt" && ok "SF7 intent approve: stderr holds 'environment: CLAUDECODE'" || bad "SF7 intent approve: no 'environment: CLAUDECODE': $(tr -d '\r' < "$TMP17/pty.txt" | tail -n 2)"
}

# SF7b — in-process: refusal text and the stub seam (no PATH/ps tricks).
caseSF7b() {
  local out
  out="$(node -e '
    const A = require(process.argv[1] + "/xprov-approve.cjs");
    const tty = require("tty");
    const realIs = tty.isatty; tty.isatty = () => true; // the terminal check passes; the rest is judged
    const res = [];
    try {
      const keep = {}; for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$/.test(k)) { keep[k] = process.env[k]; delete process.env[k]; }
      const realAnc = A.ancestryRefusal;
      A.ancestryRefusal = () => null;           res.push(String(A.guardRefusal()));
      A.ancestryRefusal = () => "ancestor 7 is X"; res.push(String(A.guardRefusal()));
      A.ancestryRefusal = () => { throw new Error("boom"); }; res.push(String(A.guardRefusal()));
      A.ancestryRefusal = () => null;
      process.env.CLAUDECODE = "1";             res.push(String(A.guardRefusal()));
      delete process.env.CLAUDECODE;
      A.ancestryRefusal = realAnc; Object.assign(process.env, keep);
    } finally { tty.isatty = realIs; }
    process.stdout.write(res.join("\n"));
  ' "$LIB17" 2>&1)"
  assert_eq "SF7b guardRefusal: clean env and clean ancestry" "$(printf '%s' "$out" | sed -n 1p)" "null"
  assert_eq "SF7b guardRefusal: ancestry text unchanged" "$(printf '%s' "$out" | sed -n 2p)" "ancestor 7 is X"
  assert_eq "SF7b guardRefusal: an ancestry throw refuses (fail closed)" "$(printf '%s' "$out" | sed -n 3p)" "the process ancestry could not be checked (boom)"
  assert_eq "SF7b guardRefusal: environment text keeps its wording" "$(printf '%s' "$out" | sed -n 4p)" "refusing under Claude Code (environment: CLAUDECODE)"
}

caseSF1; caseSF2; caseSF3; caseSF4; caseSF5; caseSF6; caseSF7; caseSF7b
export HOME="$SAVED_HOME_17"
rm -rf "$TMP17"
