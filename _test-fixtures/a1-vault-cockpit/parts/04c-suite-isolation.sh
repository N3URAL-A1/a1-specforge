#!/usr/bin/env bash
# Part 04c — Wave 4 agent A, section I: suite isolation from the real vault.
# Sourced by run-tests.sh.
#
# Since Wave 4 every product writer mirrors docs/product into A1_VAULT_ROOT.
# On a developer machine that variable points at the real vault (~/.zshenv),
# so every suite that runs product writers starts with `unset A1_VAULT_ROOT`.
# This arm proves it: each suite runs once with A1_VAULT_ROOT set to an empty
# mktemp -d SENTINEL vault, and the sentinel must still be empty afterwards.
#
# Red-making change: deleting the `unset A1_VAULT_ROOT` line from one of the
# product suites — the sentinel then holds project/<fixture-slug>/product/.
# Measured 2026-09-26 on throwaway copies: red for product-docs,
# product-schema-v11, product-adopt and product-audit-mirror. Green without the
# line, and therefore precautionary: product-import (`product import` is not a
# FR-007 hooked command), a1-checklist, a1-vault-fallback, roadmap-gate and
# a1-quick (no product writer reaches a docs/product dir there today, or every
# call already sets its own vault). Their arms guard the day that changes.

# Spec 026 FR-022: the arm no longer runs the real suite set. The fixture-suite runner
# (bin/run-suites.sh) runs every suite exactly once under the same isolation (empty sentinel
# A1_VAULT_ROOT, fresh HOME, A1_HOST_ID=leak, A1_VAULT_WRITER_HOST unset), fails a suite whose
# sentinel is non-empty, does the a1-reconcile restore/clean check and compares `.a1/learnings` before and
# after once per run; CI calls the runner in its `Fixtures` jobs, so exactly these checks hold there too.
# What the runner checks: sentinel vault, fresh HOME, learnings fallback store (and reconcile).
# It does NOT check anything else a suite might write outside its isolation. What remains here
# is a self-test of that check on a copied tree, so a runner that stops detecting leaks turns this
# suite red:
#   I1a  a planted suite that writes into its sentinel vault: runner exits 1 and names the leaked path
#   I1b  the planted clean suite of the same run passes, and a clean suite alone exits 0
#   I2   a planted suite that modifies a committed file under the copied a1-reconcile/ path: the
#        runner restores it, reports it and ends clean (the copy is a git repo with one commit,
#        so "committed state" exists; local git identity, never the global one)
# The runner starts with the seam A1_SUITE_LOCK_DIR under this arm's workdir, so a run inside a worker
# of an outer run does not meet the outer lock (FR-026).
# Red-making changes (in bin/run-suites.sh): dropping the sentinel emptiness check (I1a red);
# dropping the exit-1 on a leak (I1a rc red); dropping the a1-reconcile restore (I2 red).

I_RECONCILE_REL="_test-fixtures/a1-reconcile"

# i_run_runner <tree> — runs the real runner on <tree> in the background, polled (a hang turns one
# case red instead of blocking the suite; only the PID from $! is signalled). Sets I_OUT, I_RC.
i_run_runner() {
  local tree="$1" rd rpid ticks=0
  mk_workdir rd i-run
  mkdir -p "$rd/tmp" || { I_OUT="no run dir"; I_RC=99; return; }
  ( cd "$rd" && exec env -u A1_SUITE_RUN_MARKER -u A1_VAULT_ROOT \
      A1_SUITE_LOCK_DIR="$rd/lock" TMPDIR="$rd/tmp" LC_ALL=C \
      bash "$REPO_ROOT/bin/run-suites.sh" --root "$tree" --workers 2 ) >"$rd/out.txt" 2>&1 </dev/null &
  rpid=$!
  while kill -0 "$rpid" 2>/dev/null; do
    sleep 0.2; ticks=$((ticks + 1))
    if [[ $ticks -ge 300 ]]; then kill -TERM "$rpid" 2>/dev/null; break; fi
  done
  wait "$rpid"; I_RC=$?
  I_OUT="$(cat "$rd/out.txt")"
  [[ $ticks -lt 300 ]] || I_OUT="$I_OUT"$'\n'"TIMED OUT after 60 s"
}

# i_has <name> <haystack> <needle> — a substring assert (the harness has assert_eq/assert_rc only).
i_has() {
  if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (missing: $3)"; fi
}

# i_commit <tree> — commits every planted file so the a1-reconcile path starts clean.
i_commit() {
  git -C "$1" add -A >/dev/null 2>&1
  git -C "$1" -c commit.gpgsign=false commit -q -m plant >/dev/null 2>&1
}

# i_plant <tree> <identity> <body> — a planted suite runner.
i_plant() {
  mkdir -p "$(dirname "$1/_test-fixtures/$2")"
  printf '#!/usr/bin/env bash\n%s\n' "$3" > "$1/_test-fixtures/$2"
}

# i_git_tree VAR — a git copy: the real a1-reconcile/ path, one commit, local identity only.
i_git_tree() {
  mk_workdir "$1" i-tree
  local t="${!1}"
  [[ -n "$t" && -d "$t" ]] || return 1
  mkdir -p "$t/_test-fixtures"
  # the runner's declaration file (empty groups, no timings): required in every tree it runs on
  printf '{"serial":[],"no_count":[],"ci_jobs":{},"timings":{"measured":"2026-01-01","seconds":{}}}\n' > "$t/_test-fixtures/suite-groups.json"
  cp -R "$REPO_ROOT/$I_RECONCILE_REL" "$t/_test-fixtures/a1-reconcile"
  git init -q "$t" 2>/dev/null
  git -C "$t" config user.name fixture
  git -C "$t" config user.email fixture@example.invalid
  git -C "$t" add -A >/dev/null 2>&1
  git -C "$t" -c commit.gpgsign=false commit -q -m base >/dev/null 2>&1
}

caseI1() {
  local t probe leaked_n
  i_git_tree t || { bad "I1 could not build the planted git tree"; return; }
  probe="$t/clean-ran"
  i_plant "$t" a1-reconcile/run-tests.sh 'echo "a1-reconcile: 1 passed, 0 failed"'
  i_plant "$t" leaker/run-tests.sh 'mkdir -p "$A1_VAULT_ROOT/project/x"; : > "$A1_VAULT_ROOT/project/x/f1"
echo "leaker: 1 passed, 0 failed"'
  i_plant "$t" clean/run-tests.sh ": > \"$probe\"; echo 'clean: 1 passed, 0 failed'"
  i_commit "$t"
  i_run_runner "$t"
  assert_eq "I1a a planted leaking suite makes the runner exit 1" "$I_RC" "1"
  i_has "I1a the leaker is named" "$I_OUT" "FAIL leaker/run-tests.sh"
  i_has "I1a the leaked path is named" "$I_OUT" "/project"
  leaked_n="$(printf '%s\n' "$I_OUT" | grep -c 'leaked: ')"
  if [[ "$leaked_n" -ge 1 ]]; then ok "I1a a leaked: line is printed ($leaked_n)"; else bad "I1a a leaked: line is printed" "none in the runner output"; fi
  if [[ -e "$probe" ]]; then ok "I1b the clean suite of the same run ran"; else bad "I1b the clean suite of the same run ran" "no probe file"; fi
  i_has "I1b the clean suite passed" "$I_OUT" "PASS clean/run-tests.sh"
  # clean alone → exit 0
  rm -rf "$t/_test-fixtures/leaker"
  i_commit "$t"
  i_run_runner "$t"
  assert_eq "I1c a clean run exits 0" "$I_RC" "0"
}
caseI1

caseI2() {
  local t
  i_git_tree t || { bad "I2 could not build the planted git tree"; return; }
  # the planted a1-reconcile suite modifies a committed file (like the real one rewrites timestamps)
  local target="fixture.txt"
  printf 'committed\n' > "$t/$I_RECONCILE_REL/$target"
  i_plant "$t" a1-reconcile/run-tests.sh "echo dirtied >> \"\$(dirname \"\$0\")/$target\"
echo 'a1-reconcile: 1 passed, 0 failed'"
  i_commit "$t"
  i_run_runner "$t"
  assert_eq "I2 the run exits 0" "$I_RC" "0"
  i_has "I2 the restore is reported" "$I_OUT" "restored $I_RECONCILE_REL"
  assert_eq "I2 the a1-reconcile path is clean again in the copy" "$(git -C "$t" status --porcelain -- "$I_RECONCILE_REL")" ""
}
caseI2

# X1 — Wave 10 (spec 010 edge case "Test isolation"): the host id A1_HOST_ID
# (FR-039) must not reach a suite's child processes either. The I1 arm above
# exports A1_HOST_ID=leak into every suite. This arm proves the suites drop it:
#   static  — every runner line that unsets A1_VAULT_WRITER_HOST (`unset …` or
#             `env -u …`) also names A1_HOST_ID;
#   dynamic — every top-level `unset …A1_VAULT_WRITER_HOST…` line of every
#             runner is EXECUTED in a subshell that starts with A1_HOST_ID=leak,
#             and a node child started after it must not see the variable; for
#             this suite's own runner the child is a real `vault status --json`,
#             which must report host_source "os".
# Red-making change: removing one `A1_HOST_ID` from such a line (static half;
# for an `unset` line also the dynamic half: the child then sees "leak").
caseX1() {
  local f line missing="" n=0 w out leaks="" m=0 own
  for f in "$REPO_ROOT"/_test-fixtures/*/run-tests.sh "$REPO_ROOT"/_test-fixtures/*/run.sh \
           "$REPO_ROOT"/_test-fixtures/*/golden/*.sh "$REPO_ROOT"/_test-fixtures/a1-vault-cockpit/parts/*.sh; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line; do
      [[ "$line" == *"grep -E"* ]] && continue   # this arm's own pattern line
      n=$((n + 1))
      [[ "$line" == *A1_HOST_ID* ]] || missing+="${f#"$REPO_ROOT/_test-fixtures/"}: $line"$'\n'
    done < <(grep -E '^[[:space:]]*unset [^#]*A1_VAULT_WRITER_HOST|env -u [^#]*-u A1_VAULT_WRITER_HOST|env -u A1_VAULT_WRITER_HOST' "$f")
    while IFS= read -r line; do
      m=$((m + 1))
      out="$(A1_HOST_ID=leak bash -c "$line"$'\n''node -e "process.stdout.write(process.env.A1_HOST_ID || \"-\")"' 2>&1)"
      [[ "$out" == "-" ]] || leaks+="${f#"$REPO_ROOT/_test-fixtures/"}: $line -> $out"$'\n'
    done < <(grep -E '^unset [^#]*A1_VAULT_WRITER_HOST' "$f")
  done
  assert_eq "X1 static: every A1_VAULT_WRITER_HOST unset line also drops A1_HOST_ID ($n lines)" "$missing" ""
  assert_eq "X1 dynamic: A1_HOST_ID=leak does not survive any runner's unset line ($m lines run)" "$leaks" ""
  own="$(grep -E '^unset [^#]*A1_VAULT_WRITER_HOST' "$SUITE/run-tests.sh" | head -1)"
  mk_workdir w w; mkdir -p "$w/vault/project" "$w/repo/docs/product"
  git -C "$w/repo" init -q 2>/dev/null || git init -q "$w/repo"
  printf -- '---\nproject: demo\nstatus: active\n---\n# Roadmap\n' > "$w/repo/docs/product/ROADMAP.md"
  out="$(cd "$w/repo" && A1_HOST_ID=leak A1_VAULT_ROOT="$w/vault" HOME="$w" A1_CODE_ROOTS="$w" TOOLS="$TOOLS" \
    bash -c "$own"$'\n''node "$TOOLS" vault status --json' 2>/dev/null)"
  assert_json "X1 dynamic: this runner's unset line + real vault status under A1_HOST_ID=leak → host_source os" "$out" "j.host_source" "os"
  rm -rf "$w"
}
caseX1
