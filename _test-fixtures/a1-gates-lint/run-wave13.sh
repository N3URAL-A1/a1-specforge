#!/usr/bin/env bash
# Fixture: spec 017 Wave 13 - registry settlement (FR-007) and the call-site flag sweep.
#
# Inputs are the REAL registry, skills/ and agents/ trees (copied for mutations, never derived
# from the parser). check-callsite-flags.cjs derives the accepted flags from the real CLI
# (--help usage blocks plus the flag specs in the source of the group's modules).
#
# Measured red 2026-10-21 (git-archive snapshot, one change, suite run):
#   05-merge.md: `--phase pr-<n>` put on the disposition review call -> W13d (the Wave 10 defect)
#   a bogus `--zz-bogus` flag on a `fix list` call                    -> W13e
#   `--phase` on a `verify check` call                                -> W13f (exit 2 in the real CLI)
#   `consistency-check` (a command that does not exist) in a call      -> W13g
#   02-review.md: the fenced `workflow lint` call removed              -> W13b (gates lint exit 1)
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
SWEEP="$REPO_ROOT/_test-fixtures/a1-gates-lint/check-callsite-flags.cjs"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2
mk_workdir WORK wave13

pass=0
fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

# copy_tree <dir>: fresh copy of the real skills/ and agents/ trees
copy_tree() { rm -rf "${WORK:?}/$1"; mkdir -p "$WORK/$1"; cp -R "$REPO_ROOT/skills" "$REPO_ROOT/agents" "$WORK/$1/"; }
# edit <dir> <relative file> <js edit on s>: apply one planted change, fail loudly when it did not apply
edit() {
  node -e '
    const fs=require("fs"); const f=process.argv[1]; let s=fs.readFileSync(f,"utf8"); const before=s;
    '"$3"'
    if (s===before) { console.error("plant did not change "+f); process.exit(3); }
    fs.writeFileSync(f, s);' "$WORK/$1/$2"
}
sweep() { SOUT="$(node "$SWEEP" "$WORK/$1" 2>&1)"; SRC=$?; }

# W13a: the real registry and tree settle with zero exemptions
OUT="$(node "$TOOLS" gates lint 2>"$WORK/err")"; RC=$?
EX="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.exemptions.length+":"+j.findings.length+":"+(j.rows>0))' "$OUT")"
[[ $RC -eq 0 && "$EX" == "0:0:true" ]] && ok "W13a real registry + real skills tree: gates lint exit 0, exemptions=0, findings=0 (rows>0)" || bad "W13a (rc=$RC ex:findings:rows=$EX)"
UNW="$(grep -c 'unwired_until=2026' "$REPO_ROOT/_shared/gates-registry.md")"
[[ "$UNW" == "0" ]] && ok "W13a2 registry rows carry no unwired_until suffix (count 0)" || bad "W13a2 ($UNW rows)"

# W13b: mutation - drop the fenced workflow lint call from a1-pr-review: lint exits 1 and names the gate
copy_tree w13b
edit w13b skills/a1-pr-review/workflows/02-review.md 's = s.replace(/^node [^\n]*workflow lint[^\n]*$/m, "");'
OUT="$(node "$TOOLS" gates lint --root "$WORK/w13b" --registry "$REPO_ROOT/_shared/gates-registry.md" 2>"$WORK/err")"; RC=$?
[[ $RC -eq 1 && "$OUT" == *workflow-pipeline-exit* ]] && ok "W13b workflow lint call dropped from a1-pr-review: gates lint exit 1 naming workflow-pipeline-exit" || bad "W13b (rc=$RC)"

# W13c: the real tree passes the flag sweep and the count assert is non-trivial
SOUT="$(node "$SWEEP" "$REPO_ROOT" 2>&1)"; SRC=$?
N="$(printf '%s\n' "$SOUT" | sed -n 's/^calls=//p')"
echo "      call sites checked: $N"
[[ $SRC -eq 0 && "${N:-0}" -ge 150 ]] && ok "W13c real tree: every fenced a1-tools call uses only accepted flags (calls=$N >= 150)" || bad "W13c (rc=$SRC calls=${N:-?}; $SOUT)"

# W13d: the Wave 10 defect - --phase on disposition review
copy_tree w13d
edit w13d skills/a1-pr-review/workflows/05-merge.md 's = s.replace("--by a1-reinhard-reviewer; RC=$?", "--by a1-reinhard-reviewer --phase pr-<n>; RC=$?");'
sweep w13d
[[ $SRC -eq 1 && "$SOUT" == *"05-merge.md"*"disposition review: flag --phase"* ]] && ok "W13d --phase planted on disposition review: sweep red, names file and flag" || bad "W13d (rc=$SRC $SOUT)"

# W13e: a bogus flag on any other call
copy_tree w13e
edit w13e skills/a1-fix/workflows/01-report.md 's = s.replace(/(a1-tools\.cjs fix find-duplicates)/, "$1 --zz-bogus x");'
sweep w13e
[[ $SRC -eq 1 && "$SOUT" == *"flag --zz-bogus"* ]] && ok "W13e bogus flag planted on a fix call: sweep red" || bad "W13e (rc=$SRC $SOUT)"

# W13f: --phase on verify check (the real command exits 2 on it)
copy_tree w13f
edit w13f skills/a1-execute/workflows/03-verify.md 's = s.replace("VERIFICATION.md; CHECK_RC=$?", "VERIFICATION.md --phase x; CHECK_RC=$?");'
sweep w13f
[[ $SRC -eq 1 && "$SOUT" == *"verify check: flag --phase"* ]] && ok "W13f --phase planted on verify check: sweep red" || bad "W13f (rc=$SRC $SOUT)"
W13_RC="$(cd "$WORK" && node "$TOOLS" verify check "$WORK/none.md" --phase x >/dev/null 2>&1; echo $?)"
[[ "$W13_RC" == "2" ]] && ok "W13f2 the real CLI rejects verify check --phase with exit 2 (ground truth for W13f)" || bad "W13f2 (rc=$W13_RC)"

# W13g: a command the CLI does not have
copy_tree w13g
edit w13g skills/a1-new-feature/workflows/05-implement.md 's = s.replace("checklist run <project-slug>/<###>-<feature-slug> --only 9,10,11 --format json", "consistency-check <plan-path> <spec-path>");'
sweep w13g
[[ $SRC -eq 1 && "$SOUT" == *"consistency-check: command does not exist"* ]] && ok "W13g unknown command planted: sweep red" || bad "W13g (rc=$SRC $SOUT)"

# W13h: hostile input - a root with no skills/agents yields calls=0 and exit 1, never a green pass
mkdir -p "$WORK/empty"
sweep empty
[[ $SRC -eq 1 && "$SOUT" == *"calls=0"* ]] && ok "W13h empty root: calls=0 and exit 1 (zero checked is not a pass)" || bad "W13h (rc=$SRC $SOUT)"

echo "a1-gates-lint wave 13: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
