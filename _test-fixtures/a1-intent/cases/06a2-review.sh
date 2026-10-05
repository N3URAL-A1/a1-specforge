#!/usr/bin/env bash
# cases/06a2-review.sh — spec 011 Wave 6 part A, fixes of the security review
# of Part A (scratchpad 011-w6a-security.md). Sourced after 06a-entry.sh; its
# helpers (w5b_*, child, x21_git, w5_*) come from 05, 05b and 06a. MAJOR-A
# (repository config) is in 06a X21a–X21n; MAJOR-B (internal git) in 05b P/Pg.
#
#   RV1  MAJOR-C option injection through a flag value or positional
#   RV2  MINOR-1 A1_INTENT_ID and an undecidable ancestry
#   RV3  MINOR-3 a split home refuses every intent command
#   RV4  MINOR-6 the ledger temp file lives in ~/.a1-intents
#   RV5  MAJOR-B the internal-git router for every call form
#   RV6  re-review MINOR-1 no module loaded before the routing holds a
#        child_process function; the slug rule equals worktree-registry's
#   RV7  re-review MINOR-2 only git (and CHILD_SPAWN_ALLOW) may be started
#   RV8  re-review MINOR-5 no recursion into a nested repository
#   RV9  re-review MINOR-6 A1_INTENT_CHILD=1 needs A1_INTENT_ID
#
# RED proof (CONVENTIONS.md), each measured on a `git archive HEAD` copy:
#   RV1 dropping optionProblem from childGuard (RV1a–R1d: the value reaches the
#      subcommand; RV1b writes the outside file); dropping the ref check of
#      --diff-base (RV1e: `a..b` and `--output=…` in the spaced form pass);
#      R1f is the control (HEAD runs).
#   RV2 not comparing A1_INTENT_ID with the lock (RV2a); not treating
#      A1_INTENT_ID as a child flag (RV2b: normal mode, the write runs);
#      treating an undecidable walk as a valid context (RV2c).
#   RV3 dropping assertHomeConsistent from the intent router (RV3a/R3b);
#      R3c is the control (the same home passes the check).
#   RV4 the temp file back beside the ledger (RV4: the trace shows it in $HOME).
#   RV6 intent-child loading worktree-registry again (RV6: it takes
#       execFileSync before the routing); a slug rule that drifts from it.
#   RV7 matching git only by name (RV7a: /usr/bin/env git runs git); letting
#       any other binary (RV7b) or a shell option (RV7c) through.
#   RV8 is a pin, green on d44d602 too (measured 2026-09-28): the -c keys and
#       the FR-042 env reach the recursive git of a nested repository, so its
#       fsmonitor is already off, and a nested clean filter runs neither for
#       plain status nor diff. submodule.recurse=false and
#       --ignore-submodules=all are the third layer; RV8ctl proves plain git
#       does enter the nested repository.
#   RV7d letting a shell string without git through (execSync).
#   RV9 not requiring A1_INTENT_ID with A1_INTENT_CHILD=1 (RV9a); RV9b control.
#   RV5 not routing execSync strings (RV5a: 2 of 3 calls reach the spy);
#       passing a shell string through (RV5b), an async spawn (RV5c), a
#       repository outside the scope (RV5d).

R_LOCK_ID="3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b"

# ---------- RV1: option-shaped values ----------
w5b_project_sandbox w6a2-r1
printf 'x\n' >"$CWD/f.txt"
git -C "$CWD" -c core.hooksPath=/dev/null add f.txt
git -C "$CWD" -c user.name=f -c user.email=f@invalid -c core.hooksPath=/dev/null commit -q -m base
printf 'y\n' >>"$CWD/f.txt"
r1_out="$SB/outside-diff.txt"
child new-feature real-proj realpath-check run --diff-base=-x
expect_refused "RV1a --diff-base=-x -> 77 subcommand_not_allowed [FR-041, review MAJOR-C]" subcommand_not_allowed
child new-feature real-proj realpath-check run "--diff-base=--output=$r1_out"
if [[ ! -e "$r1_out" ]]; then expect_refused "RV1b --diff-base=--output=<outside> -> 77, no file outside [FR-041, review MAJOR-C]" subcommand_not_allowed
else bad "RV1b --diff-base=--output=<outside> -> 77, no file outside [FR-041, review MAJOR-C]" "the file outside was written (exit $RC)"; fi
child new-feature real-proj realpath-check run --diff-base "--output=$r1_out"
if [[ ! -e "$r1_out" ]]; then expect_refused "RV1c --diff-base --output=<outside> (spaced) -> 77, no file outside [FR-041, review MAJOR-C]" subcommand_not_allowed
else bad "RV1c --diff-base --output=<outside> (spaced) -> 77, no file outside [FR-041, review MAJOR-C]" "the file outside was written (exit $RC)"; fi
child new-feature real-proj code-scope claim --by=-x --scope src/
expect_refused "RV1d a flag value starting with - (--by=-x) -> 77 [FR-041, review MAJOR-C]" subcommand_not_allowed
child fix real-proj fix next-suffix real-proj -rf
expect_refused "RV1d2 a positional starting with - -> 77 [FR-041, review MAJOR-C]" subcommand_not_allowed
child new-feature real-proj realpath-check run --diff-base HEAD..main
expect_refused "RV1e --diff-base with .. is no revision -> 77 [FR-041, review MAJOR-C]" subcommand_not_allowed
child new-feature real-proj realpath-check run --diff-base HEAD
expect_not_refused "RV1f control: --diff-base HEAD runs [FR-041]"

# ---------- RV2: A1_INTENT_ID and an undecidable ancestry ----------
w5b_project_sandbox w6a2-r2
W5B_SPEC="$(w5b_lockspec fix real-proj)"
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_ID=00000000-0000-4000-8000-000000000000 -- fix next-suffix real-proj 2026-09-27
expect_refused "RV2a A1_INTENT_ID other than the lock's intent_id -> 77 child_context_invalid [FR-047, review MINOR-1]" child_context_invalid
W5B_SPEC=-
mkdir -p "$FHOME/claude-projects/other"
w5b_run "$CWD" "$A1_TOOLS" "A1_INTENT_ID=$R_LOCK_ID" -- product stage --by 011-x --set started --dir "$FHOME/claude-projects/other"
expect_refused "RV2b A1_INTENT_ID alone (no A1_INTENT_CHILD, no lock) is a child signal -> 77 child_context_invalid [FR-047, review MINOR-1]" child_context_invalid
W5B_RAW='{}'
W5B_VIA_SH=1
W5B_SPEC='{"psFail":true}'
w5b_run "$CWD" "$A1_TOOLS" -- fix next-suffix real-proj 2026-09-27
expect_refused "RV2c an ancestry walk that cannot decide (injected ps failure) -> 77 child_context_invalid, never a valid context [FR-047, review MINOR-1]" child_context_invalid
W5B_SPEC=-
W5B_VIA_SH=
W5B_RAW=
rm -f "$FHOME/.a1-intents/executor.lock"

# ---------- RV3: a split home ----------
new_sandbox w6a2-r3
r3_before="$(tree_listing "$FHOME")"
HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_TOOLS" intent validate "$Q/x.md" >"$SB/.out" 2>"$SB/.err" </dev/null
RC=$?; OUT="$(cat "$SB/.out")"; ERR="$(cat "$SB/.err")"
if [[ "$RC" -eq 2 && -z "$OUT" && "$ERR" == *A1_HOME_SPLIT* && "$(tree_listing "$FHOME")" == "$r3_before" ]]; then
  ok "RV3a HOME other than the real passwd home (no seam) -> every intent command exits 2 A1_HOME_SPLIT, nothing written [FR-011, review MINOR-3]"
else bad "RV3a HOME other than the real passwd home (no seam) -> every intent command exits 2 A1_HOME_SPLIT, nothing written [FR-011, review MINOR-3]" "exit $RC stderr: ${ERR:0:200}"; fi
mkdir -p "$SB/passwd-home"
HOME="$FHOME" A1_VAULT_ROOT="$VAULT" node "$A1_AS" "$SB/passwd-home" - "$A1_TOOLS" intent device revoke pixel-robert >"$SB/.out" 2>"$SB/.err" </dev/null
RC=$?; ERR="$(cat "$SB/.err")"
if [[ "$RC" -eq 2 && "$ERR" == *A1_HOME_SPLIT* ]] && grep -q '"revoked_at":null' "$FHOME/.a1-intents/devices.json"; then ok "RV3b an injected passwd home other than HOME -> device revoke refused, devices.json unchanged [FR-011, review MINOR-3]"
else bad "RV3b an injected passwd home other than HOME -> device revoke refused, devices.json unchanged [FR-011, review MINOR-3]" "exit $RC stderr: ${ERR:0:200}"; fi
run_intent validate "$Q/x.md"
if [[ "$ERR" != *A1_HOME_SPLIT* ]]; then ok "RV3c control: HOME equal to the passwd home passes the check [FR-011]"
else bad "RV3c control: HOME equal to the passwd home passes the check [FR-011]" "stderr: ${ERR:0:200}"; fi

# ---------- RV4: the ledger temp file ----------
w5_sandbox w6a2-r4
: >"$TRACE"
w5_claimed
r4_home="$(node -e 'process.stdout.write(require("path").normalize(process.argv[1]))' "$FHOME")"
if grep -qF "write $r4_home/.a1-intents/ledger.tmp." "$TRACE" && ! grep -qF "write $r4_home/.a1-intents-ledger.json.tmp" "$TRACE" && [[ -f "$FHOME/.a1-intents-ledger.json" ]]; then
  ok "RV4 the ledger is written through a temp file inside ~/.a1-intents (under the directory deny), not beside the ledger [FR-014, review MINOR-6]"
else bad "RV4 the ledger is written through a temp file inside ~/.a1-intents (under the directory deny), not beside the ledger [FR-014, review MINOR-6]" "$(grep -F ledger "$TRACE" | grep '^write' | head -3)"; fi

# ---------- RV5: the internal-git router itself (review MAJOR-B) ----------
# The allowlisted subcommands reach git only through spawnSync/execFileSync
# (5b-Pg); these are the other forms a module could use.
w5b_project_sandbox w6a2-rv5
mkdir -p "$CWD/docs" && printf '# Plan\n' >"$CWD/docs/PLAN.md"
: >"$SB/.spylog"
RV5_SPY="$(w5b_spy "$SB/.spylog")"
rv5() { # rv5 <mode> — the probe from $CWD; sets RC, OUT
  (cd "$CWD" && env -u A1_INTENT_CHILD HOME="$FHOME" A1_VAULT_ROOT="$VAULT" A1_FIXTURE_CANARY=leak \
    node "$STUB_DIR/route-probe.cjs" "$FHOME" "$INTENT_LIB" "$VAULT" "$RV5_SPY" "$1"; exit $?) >"$SB/.out" 2>"$SB/.err" </dev/null
  RC=$?; OUT="$(cat "$SB/.out")"
}
rv5 sync
rv5_lines="$(grep -c '^ARGS:' "$SB/.spylog")"
rv5_hard="$(grep '^ARGS:' "$SB/.spylog" | grep -cF "ARGS: $W5B_GIT_LEADING ")"
if [[ "$RC" -eq 0 && "$OUT" == ran && "$rv5_lines" -eq 3 && "$rv5_hard" -eq 3 ]] && ! grep -q ENV-LEAK "$SB/.spylog"; then
  ok "RV5a execSync string, execFileSync and spawnSync by absolute path all run the injected git, hardened, without caller variables [FR-048, review MAJOR-B]"
else bad "RV5a execSync string, execFileSync and spawnSync by absolute path all run the injected git, hardened, without caller variables [FR-048, review MAJOR-B]" "exit $RC calls $rv5_lines hardened $rv5_hard" "$(head -3 "$SB/.spylog")"; fi
: >"$SB/.spylog"
rv5 shell
if [[ "$RC" -eq 77 && ! -e "$FHOME/shell-ran" && ! -s "$SB/.spylog" ]]; then ok "RV5b git inside a shell string -> 77, the shell never runs [FR-048, review MAJOR-B]"
else bad "RV5b git inside a shell string -> 77, the shell never runs [FR-048, review MAJOR-B]" "exit $RC ran: $(ls "$FHOME/shell-ran" 2>&1)"; fi
rv5 async
if [[ "$RC" -eq 77 && ! -s "$SB/.spylog" ]]; then ok "RV5c an async git spawn -> 77 [FR-048, review MAJOR-B]"
else bad "RV5c an async git spawn -> 77 [FR-048, review MAJOR-B]" "exit $RC"; fi
rv5 outside
if [[ "$RC" -eq 77 && "$OUT" == *path_outside_scope* && ! -s "$SB/.spylog" ]]; then ok "RV5d internal git in a repository outside the scope (-C /) -> 77 path_outside_scope [FR-048, review MAJOR-B]"
else bad "RV5d internal git in a repository outside the scope (-C /) -> 77 path_outside_scope [FR-048, review MAJOR-B]" "exit $RC stdout: ${OUT:0:200}"; fi

# ---------- RV6: nothing loaded before the routing holds a child_process function ----------
rv5 modules
rv6_count="${OUT%% *}"
if [[ "$RC" -eq 0 && "${OUT#* }" == "none true" && "$rv6_count" -gt 0 ]]; then ok "RV6 none of the $rv6_count modules loaded before the routing took a child_process function at load; the slug rule equals worktree-registry's [FR-048, re-review MINOR-1]"
else bad "RV6 none of the modules loaded before the routing took a child_process function at load; the slug rule equals worktree-registry's [FR-048, re-review MINOR-1]" "exit $RC: $OUT"; fi

# ---------- RV7: only git (routed) and CHILD_SPAWN_ALLOW may be started ----------
: >"$SB/.spylog"
rv5 envgit
if [[ "$RC" -eq 77 && ! -s "$SB/.spylog" ]]; then ok "RV7a git through an intermediate program (/usr/bin/env git, execFile without a shell) -> 77 [FR-048, re-review MINOR-2]"
else bad "RV7a git through an intermediate program (/usr/bin/env git, execFile without a shell) -> 77 [FR-048, re-review MINOR-2]" "exit $RC"; fi
rv5 other
if [[ "$RC" -eq 77 && "$OUT" == *"may not be started"* ]]; then ok "RV7b any other program (/bin/echo) -> 77 [FR-048, re-review MINOR-2]"
else bad "RV7b any other program (/bin/echo) -> 77 [FR-048, re-review MINOR-2]" "exit $RC stdout: ${OUT:0:200}"; fi
rv5 shellstr
if [[ "$RC" -eq 77 && ! -e "$FHOME/shellstr-ran" ]]; then ok "RV7d a shell string without git (execSync) -> 77, the shell never runs [FR-048, re-review MINOR-2]"
else bad "RV7d a shell string without git (execSync) -> 77, the shell never runs [FR-048, re-review MINOR-2]" "exit $RC"; fi
rv5 shellopt
if [[ "$RC" -eq 77 ]]; then ok "RV7c a spawn with the shell option -> 77 [FR-048, re-review MINOR-2]"
else bad "RV7c a spawn with the shell option -> 77 [FR-048, re-review MINOR-2]" "exit $RC"; fi

# ---------- RV8: no recursion into a nested repository (gitlink) ----------
w5b_project_sandbox w6a2-rv8
RV8_M="$SB/markers"
mkdir -p "$RV8_M" "$CWD/docs"
printf '# Plan\n' >"$CWD/docs/PLAN.md"
printf '#!/bin/sh\necho ran >"%s/nested-fsmonitor"\nexit 0\n' "$RV8_M" >"$SB/canary.sh"
chmod 755 "$SB/canary.sh"
git init -q "$CWD/sub"
printf 'a\n' >"$CWD/sub/f"
git -C "$CWD/sub" -c core.hooksPath=/dev/null add f
git -C "$CWD/sub" -c user.name=f -c user.email=f@invalid -c core.hooksPath=/dev/null commit -q -m sub
git -C "$CWD" -c core.hooksPath=/dev/null add sub docs >/dev/null 2>&1
git -C "$CWD" -c user.name=f -c user.email=f@invalid -c core.hooksPath=/dev/null commit -q -m parent
git -C "$CWD/sub" config core.fsmonitor "$SB/canary.sh"
printf 'b\n' >>"$CWD/sub/f"
(cd "$CWD" && git status --porcelain >/dev/null 2>&1)
if [[ -f "$RV8_M/nested-fsmonitor" ]]; then ok "RV8ctl control: plain git status in the parent runs the nested repository's fsmonitor [FR-048]"
else bad "RV8ctl control: plain git status in the parent runs the nested repository's fsmonitor [FR-048]" "no canary: RV8 would not enter its path"; fi
rm -f "$RV8_M"/*
W5B_SPEC="$(w5b_lockspec execute real-proj)"
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=1 -- git status --porcelain
rv8a="$RC $(ls "$RV8_M" | tr '\n' ' ')"
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=1 -- git diff
rv8b="$RC $(ls "$RV8_M" | tr '\n' ' ')"
W5B_SPEC=-
if [[ "$rv8a" == "0 " ]]; then ok "RV8a the wrapper's git status does not enter the nested repository (no canary) [FR-048, re-review MINOR-5]"
else bad "RV8a the wrapper's git status does not enter the nested repository (no canary) [FR-048, re-review MINOR-5]" "exit+markers: $rv8a"; fi
if [[ "$rv8b" == "0 " ]]; then ok "RV8b the wrapper's git diff does not enter the nested repository (no canary) [FR-048, re-review MINOR-5]"
else bad "RV8b the wrapper's git diff does not enter the nested repository (no canary) [FR-048, re-review MINOR-5]" "exit+markers: $rv8b"; fi
: >"$SB/.spylog"
RV5_SPY="$(w5b_spy "$SB/.spylog")"
rv5 status
if [[ "$RC" -eq 0 && -z "$(ls -A "$RV8_M")" ]]; then ok "RV8c an internal git status of a1-tools does not enter the nested repository [FR-048, re-review MINOR-5]"
else bad "RV8c an internal git status of a1-tools does not enter the nested repository [FR-048, re-review MINOR-5]" "exit $RC markers: $(ls -A "$RV8_M" | tr '\n' ' ')"; fi

# ---------- RV9: A1_INTENT_CHILD=1 needs A1_INTENT_ID ----------
w5b_project_sandbox w6a2-rv9
W5B_SPEC="$(w5b_lockspec fix real-proj)"
W5B_NO_ID=1
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=1 -- fix next-suffix real-proj 2026-09-27
expect_refused "RV9a A1_INTENT_CHILD=1 without A1_INTENT_ID under a valid lock -> 77 child_context_invalid [FR-047, re-review MINOR-6]" child_context_invalid
W5B_NO_ID=
w5b_run "$CWD" "$A1_TOOLS" A1_INTENT_CHILD=1 -- fix next-suffix real-proj 2026-09-27
expect_not_refused "RV9b control: the same call with the lock's A1_INTENT_ID runs [FR-047]"
W5B_SPEC=-
