#!/usr/bin/env bash
# Fixture: spec 027 slice 1 Wave 4 - the Samuel trigger is the registered, logged gate
# `pr-security-surface` (FR-033). Wave 6 appends the quality-invariant cases.
#
# Inputs are the REAL registry, skills/ tree and xprov-scope-globs.json (copied for mutations).
#
# Measured red 2026-11-13 (scratch copy, one change, suite run):
#   02-review.md: the `xprov scope` call line removed          -> W14b (gates lint exit 1, unwired)
#   02-review.md: `cd "<worktree_path>" && ` removed from call -> W14c-red proves the log lands in the primary checkout
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
SWEEP="$REPO_ROOT/_test-fixtures/a1-gates-lint/check-callsite-flags.cjs"
REVIEW="$REPO_ROOT/skills/a1-pr-review/workflows/02-review.md"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2
mk_workdir WORK wave14

pass=0
fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

copy_tree() { rm -rf "${WORK:?}/$1"; mkdir -p "$WORK/$1"; cp -R "$REPO_ROOT/skills" "$REPO_ROOT/agents" "$WORK/$1/"; }
edit() {
  node -e '
    const fs=require("fs"); const f=process.argv[1]; let s=fs.readFileSync(f,"utf8"); const before=s;
    '"$3"'
    if (s===before) { console.error("plant did not change "+f); process.exit(3); }
    fs.writeFileSync(f, s);' "$WORK/$1/$2"
}
g() { git -C "$1" -c user.name=t -c user.email=t@t -c commit.gpgsign=false "${@:2}"; }

# W14a: the real tree settles and pr-security-surface is wired once in a1-pr-review
OUT="$(node "$TOOLS" gates lint 2>"$WORK/err")"; RC=$?
HIT="$(node -e 'const j=JSON.parse(process.argv[1]);const w=j.wired.filter(x=>x.gate==="pr-security-surface"&&x.skill==="a1-pr-review"&&x.calls===1);process.stdout.write(String(w.length))' "$OUT")"
[[ $RC -eq 0 && "$HIT" == "1" ]] && ok "W14a real gates lint exit 0, pr-security-surface wired in a1-pr-review (calls=1)" || bad "W14a (rc=$RC hit=$HIT)"

# W14b: drop the call line -> unwired
copy_tree w14b
edit w14b skills/a1-pr-review/workflows/02-review.md 's = s.replace(/^SURF=[^\n]*xprov scope[^\n]*$/m, "");'
OUT="$(node "$TOOLS" gates lint --root "$WORK/w14b" --registry "$REPO_ROOT/_shared/gates-registry.md" 2>"$WORK/err")"; RC=$?
FIND="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.findings.filter(f=>f.gate==="pr-security-surface"&&/unwired/.test(JSON.stringify(f))).length+"")' "$OUT" 2>/dev/null)"
[[ $RC -eq 1 && "$FIND" -ge 1 ]] && ok "W14b call line removed: gates lint exit 1, finding unwired for pr-security-surface" || bad "W14b (rc=$RC find=${FIND:-?})"

# W14c: run the real call line against a temp primary repo + worktree
T="$WORK/c"; PRIMARY="$T/primary"; WT="$T/wt"; mkdir -p "$PRIMARY"
git -C "$PRIMARY" init -q
echo a > "$PRIMARY/a.txt"; g "$PRIMARY" add -A; g "$PRIMARY" commit -qm one
echo b > "$PRIMARY/b.txt"; g "$PRIMARY" add -A; g "$PRIMARY" commit -qm two
BASE_SHA="$(git -C "$PRIMARY" rev-parse HEAD)"
git -C "$PRIMARY" worktree add -q -b feat "$WT"
echo c > "$WT/c.txt"; g "$WT" add -A; g "$WT" commit -qm three
LINE="$(grep -m1 'a1-tools.cjs xprov scope' "$REVIEW")"
run_line() { # <line> <basedir>
  L="${1//<repo>/$REPO_ROOT}"; L="${L//<worktree_path>/$WT}"; L="${L//<n>/9}"
  (cd "$2" && BASE_SHA="$BASE_SHA" bash -c "$L"'
printf "%s" "$SURF" > "'"$WORK"'/surf.json"; exit $RC') >/dev/null 2>&1
}
run_line "$LINE" "$PRIMARY"; RC=$?
LOG="$WT/.a1/phases/pr-9/gate-log.jsonl"
SURFOK="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(typeof j.security_surface)' "$WORK/surf.json" 2>/dev/null)"
N="$(wc -l < "$LOG" 2>/dev/null | tr -d ' ')"
REC="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim());process.stdout.write([r.gate,r.verdict,r.scope].join(","))' "$LOG" 2>/dev/null)"
[[ $RC -eq 0 && "$SURFOK" == "boolean" && "$N" == "1" && "$REC" == "pr-security-surface,pass,pr-9" && ! -e "$PRIMARY/.a1/phases" ]] \
  && ok "W14c call line in the worktree: SURF JSON boolean, 1 log line in the worktree (pass, pr-9), primary has no .a1/phases" \
  || bad "W14c (rc=$RC surf=$SURFOK n=$N rec=$REC primary=$(ls "$PRIMARY/.a1" 2>&1))"

# W14c-red: without the cd the log lands in the primary checkout (proves W14c discriminates)
rm -rf "$WT/.a1" "$PRIMARY/.a1"
LINE_NOCD="${LINE//cd \"<worktree_path>\" && /}"
[[ "$LINE_NOCD" != "$LINE" ]] || bad "W14c-red plant did not change the line"
run_line "$LINE_NOCD" "$PRIMARY"
[[ -e "$PRIMARY/.a1/phases/pr-9/gate-log.jsonl" ]] && ok "W14c-red cd removed: the log lands in the primary checkout" || bad "W14c-red (no log in primary)"

# W14d: a security-surface path still exits 0 with security_surface:true; unknown base exits 2 with verdict error
rm -rf "$WT/.a1" "$PRIMARY/.a1"
SECPATH="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const p=j.categories.payment.find(x=>x==="**/checkout/**");process.stdout.write(p?"checkout/x.txt":"")' "$REPO_ROOT/_shared/lib/xprov-scope-globs.json")"
if [[ -z "$SECPATH" ]]; then bad "W14d no checkout glob in xprov-scope-globs.json"; else
  mkdir -p "$WT/checkout"; echo s > "$WT/$SECPATH"; g "$WT" add -A; g "$WT" commit -qm sec
  run_line "$LINE" "$PRIMARY"; RC=$?
  SV="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).security_surface))' "$WORK/surf.json" 2>/dev/null)"
  VERD="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").pop());process.stdout.write(r.verdict)' "$WT/.a1/phases/pr-9/gate-log.jsonl" 2>/dev/null)"
  [[ $RC -eq 0 && "$SV" == "true" && "$VERD" == "pass" ]] && ok "W14d security-surface path: exit 0, security_surface:true, log verdict pass" || bad "W14d (rc=$RC sv=$SV verdict=$VERD)"
fi
rm -rf "$WT/.a1"
BASE_SHA="deadbeefdeadbeef"; run_line "$LINE" "$PRIMARY"; RC=$?
VERD="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").pop());process.stdout.write(r.verdict)' "$WT/.a1/phases/pr-9/gate-log.jsonl" 2>/dev/null)"
[[ $RC -eq 2 && "$VERD" == "error" ]] && ok "W14d2 unknown base sha: exit 2, log verdict error" || bad "W14d2 (rc=$RC verdict=$VERD)"

# W14e: --phase accepted on xprov scope by the call-site sweep
node "$SWEEP" "$REPO_ROOT" >"$WORK/sweep.out" 2>&1; RC=$?
[[ $RC -eq 0 ]] && ok "W14e call-site flag sweep exit 0 (--phase accepted on xprov scope)" || bad "W14e (rc=$RC $(head -3 "$WORK/sweep.out"))"

echo "a1-gates-lint wave 14: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
