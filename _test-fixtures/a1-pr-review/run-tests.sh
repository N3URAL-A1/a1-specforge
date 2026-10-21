#!/usr/bin/env bash
# Test-Mode für a1-pr-review CLI-Subcommands.
# Verwendet einen Dummy-Registry via A1_WORKTREE_REGISTRY und einen
# temporären Worktree-Pfad. Mutiert nichts Echtes.

set -u

CLI="node $(cd "$(dirname "${BASH_SOURCE[0]}")/../../_shared" && pwd)/a1-tools.cjs"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

REGISTRY="$TMP/registry.json"
WT="$TMP/worktrees/demo-feature"
mkdir -p "$WT/.a1-review"

cat > "$REGISTRY" <<JSON
{
  "version": 1,
  "worktrees": [
    {
      "id": "20260513-1200-demo-feature",
      "slug": "demo-feature",
      "repo_root": "/fake/repo",
      "worktree_path": "$WT",
      "branch": "feature/demo-feature",
      "base": "main",
      "created_at": "2026-05-13T12:00:00Z",
      "status": "handoff",
      "phase_history": [
        { "at": "2026-05-13T11:55:00Z", "from": "active", "to": "handoff", "by": "a1-worktree" }
      ]
    },
    {
      "id": "20260513-1300-other",
      "slug": "other",
      "repo_root": "/fake/repo",
      "worktree_path": "/nonexistent",
      "branch": "feature/other",
      "created_at": "2026-05-13T13:00:00Z",
      "status": "active",
      "phase_history": []
    }
  ]
}
JSON

export A1_WORKTREE_REGISTRY="$REGISTRY"

pass=0
fail=0

pass_case() { echo "  PASS — $1"; pass=$((pass + 1)); }
fail_case() { echo "  FAIL — $1"; fail=$((fail + 1)); }

echo "== Test 1: list-handoff returns one entry"
out="$($CLI pr list-handoff)"
count="$(echo "$out" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(String(o.count));})')"
[ "$count" = "1" ] && pass_case "count=1" || fail_case "expected count=1, got $count"

echo "== Test 2: findings-summary fails without findings.json"
if $CLI pr findings-summary demo-feature 2>/dev/null; then
  fail_case "should have errored on missing findings.json"
else
  pass_case "errored as expected"
fi

echo "== Test 3: findings-summary with findings.json"
cat > "$WT/.a1-review/findings.json" <<JSON
{
  "summary": "Looks fine overall.",
  "blocker": [],
  "major": [
    { "file": "src/auth.ts", "line": 42, "title": "Missing tenant check", "detail": "Function bypasses tenantId filter." }
  ],
  "minor": [
    { "file": "src/util.ts", "line": 10, "title": "Unused import" }
  ]
}
JSON
out="$($CLI pr findings-summary demo-feature)"
echo "$out" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);if(o.counts.major!==1)process.exit(1);if(o.counts.minor!==1)process.exit(1);if(!o.major_md.includes("Missing tenant check"))process.exit(1);if(!o.inline_minor_md.includes("Unused import"))process.exit(1);})' && pass_case "counts + markdown ok" || fail_case "summary mismatch"

echo "== Test 4: mark-status transitions"
$CLI pr mark-status demo-feature in-review > /dev/null
$CLI pr mark-status demo-feature reviewed > /dev/null
status="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.env.A1_WORKTREE_REGISTRY,"utf8"));process.stdout.write(r.worktrees[0].status)')"
[ "$status" = "reviewed" ] && pass_case "status=reviewed" || fail_case "expected reviewed, got $status"

echo "== Test 5: invalid status is rejected"
if $CLI pr mark-status demo-feature bogus 2>/dev/null; then
  fail_case "should have rejected invalid status"
else
  pass_case "rejected invalid status"
fi

echo "== Test 6: mark-pr-open requires valid URL"
if $CLI pr mark-pr-open demo-feature "not-a-url" 2>/dev/null; then
  fail_case "should have rejected bad URL"
else
  pass_case "rejected bad URL"
fi

echo "== Test 7: mark-pr-open success"
$CLI pr mark-pr-open demo-feature "https://github.com/foo/bar/pull/42" > /dev/null
pr_url="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.env.A1_WORKTREE_REGISTRY,"utf8"));process.stdout.write(r.worktrees[0].pr_url||"")')"
[ "$pr_url" = "https://github.com/foo/bar/pull/42" ] && pass_case "pr_url stored" || fail_case "pr_url mismatch: $pr_url"

echo "== Test 8: unknown slug fails clean"
if $CLI pr findings-summary nonexistent-slug 2>/dev/null; then
  fail_case "should have failed on unknown slug"
else
  pass_case "unknown slug rejected"
fi

echo "== Test 9: findings-direct-path — findings-summary --worktree-path works without registry entry"
DIRECT_WT="$TMP/direct-worktree"
mkdir -p "$DIRECT_WT/.a1-review"
cat > "$DIRECT_WT/.a1-review/findings.json" <<JSON
{
  "summary": "Direct path summary.",
  "blocker": [],
  "major": [
    { "file": "src/db.ts", "line": 7, "title": "N+1 query", "detail": "Loop issues one query per row." }
  ],
  "minor": [
    { "file": "src/util.ts", "line": 3, "title": "Dead code" }
  ]
}
JSON
out="$($CLI pr findings-summary --worktree-path "$DIRECT_WT" 2>&1)"
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);if(o.source!=="direct-path")process.exit(1);if(o.counts.major!==1)process.exit(1);if(o.counts.minor!==1)process.exit(1);})'; then
  pass_case "findings-direct-path: source=direct-path, counts correct"
else
  fail_case "findings-direct-path: unexpected output (rc=$rc): $out"
fi

echo "== Test 10: hostile — findings-summary --worktree-path with nonexistent path"
out="$($CLI pr findings-summary --worktree-path '../../nonexistent' 2>&1)"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "does not exist"; then
  pass_case "hostile-nonexistent-worktree-path: exit $rc, stderr mentions 'does not exist'"
else
  fail_case "hostile-nonexistent-worktree-path: expected non-zero exit + 'does not exist', got rc=$rc: $out"
fi

echo "== Test 11: positional slug path still works after parseFlags conversion"
if $CLI pr findings-summary __no_such_slug__ 2>&1 | grep -q "no registry entry for"; then
  pass_case "positional slug still reaches registry lookup (flags._[0] wired)"
else
  fail_case "positional slug did not reach registry lookup — flags._[0] may be broken"
fi

echo "== Test 12: spec 016 wave 10 - pr-diff-xprov wiring in the skill text"
SK="$(cd "$(dirname "$0")/../.." && pwd)/skills"
REV="$SK/a1-pr-review/workflows/02-review.md"
if grep -q "xprov gate --gate pr-diff-xprov" "$REV" && grep -q "2.2b" "$REV"; then
  pass_case "step 2.2b runs the pr-diff-xprov gate next to the Reinhard spawn"
else
  fail_case "02-review.md lacks step 2.2b / the pr-diff-xprov gate call"
fi
if grep -q -- "--merge-check" "$REV"; then
  pass_case "the merge check (--merge-check) is a step of the review workflow"
else
  fail_case "02-review.md lacks the --merge-check step"
fi
if grep -q '`source` field' "$REV" && grep -q '"codex"' "$REV" && grep -q '"reinhard"' "$REV"; then
  pass_case "findings are tagged by source (reinhard / codex)"
else
  fail_case "02-review.md does not describe the findings source tag"
fi
if grep -q "Cross-provider review" "$SK/a1-pr-review/workflows/03-draft.md"; then
  pass_case "the PR body carries a Cross-provider review section"
else
  fail_case "03-draft.md lacks the Cross-provider review section"
fi
if grep -q "Merge only on exit 0" "$REV" && grep -q "exit 77" "$REV"; then
  pass_case "step 2.7 says: merge only on exit 0, exits 1/2/77 named"
else
  fail_case "02-review.md 2.7 lacks the merge-only-on-exit-0 rule"
fi
if grep -q '"matcher": "Bash"' "$SK/../hooks/hooks.json"; then
  pass_case "the plugin hooks.json carries the Bash matcher of the merge hook"
else
  fail_case "hooks/hooks.json has no Bash matcher: the merge check is not enforced"
fi
if grep -q 'gh pr merge <n> --squash --delete-branch' "$SK/a1-pr-review/SKILL.md" && grep -q 'exactly ONE command' "$REV"; then
  pass_case "the merge step uses the canonical form the hook allows"
else
  fail_case "the a1-pr-review merge step does not name the canonical gh pr merge form"
fi
leak=0
for f in "$SK/a1-new-feature/workflows/05-implement.md" "$SK/a1-fix/SKILL.md"; do
  if grep -q "xprov gate" "$f"; then leak=1; fail_case "$f calls the cross-provider gate; it is reached only through a1-pr-review 2.2b"; fi
done
[ "$leak" -eq 0 ] && pass_case "a1-new-feature 05-implement and a1-fix call no cross-provider gate (static)"

# `consent waive` takes no --kind (and needs --phase or --work-path): the shorthand `ensure|waive --kind waiver` exits 2 (Reinhard 2026-10-19)
bad_waive="$(grep -rnE 'consent (ensure\|)?waive --kind|ensure\|waive' "$SK" 2>/dev/null | head -3)"
if [ -z "$bad_waive" ]; then pass_case "no skill text shows 'consent waive --kind' or the 'ensure|waive' shorthand (static)"
else fail_case "a skill text shows a waive call that exits 2: $bad_waive"; fi

# ---------- spec 017 wave 10 (FR-038): workflows/05-merge.md ----------
# Measured red 2026-10-21 (git-archive snapshot, one line of 05-merge.md changed, suite run):
#   merge block gets an extra flag (`--admin`)                       : canonical-form case
#   `exit "$RC"` removed from the merge-check block                  : explicit-exit-code case
#   `--require-vault` removed from the coherence call                : block-order case (DCMG -> D?MG)
#   `--phase pr-<n>` removed from the merge-check call               : --phase case
#   Wave 13: `--phase pr-<n>` put back on the disposition review call   : --phase case (flag now must be absent there)
MRG="$SK/a1-pr-review/workflows/05-merge.md"
blocks_json() { # fenced bash blocks of 05-merge.md as a JSON array of strings
  node -e '
    const t=require("fs").readFileSync(process.argv[1],"utf8"); const out=[]; const re=/^```bash\n([\s\S]*?)^```/gm; let m;
    while((m=re.exec(t))) out.push(m[1]); process.stdout.write(JSON.stringify(out));' "$1"
}
BJ="$(blocks_json "$MRG")"
bj() { printf '%s' "$BJ" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
HAND="$(awk '/^## Hand-offs/{f=1} f' "$SK/a1-pr-review/SKILL.md")"
if [ "$(bj 'b.length')" = "4" ]; then pass_case "05-merge.md has exactly 4 fenced bash blocks (count)"; else fail_case "05-merge.md fenced bash blocks: $(bj 'b.length') (want 4)"; fi
order="$(bj 'b.map(x=>/disposition review/.test(x)?"D":/product validate --spec-status --require-vault/.test(x)?"C":/pr merge-check/.test(x)?"M":/^gh pr merge /m.test(x)?"G":"?").join("")')"
if [ "$order" = "DCMG" ]; then pass_case "block order: disposition review, coherence (--require-vault), merge-check, gh pr merge"; else fail_case "05-merge.md block order is '$order' (want DCMG)"; fi
if [ "$(bj 'b.filter(x=>/gh pr merge/.test(x)).length')" = "1" ] && [ "$(bj 'b.findIndex(x=>/gh pr merge/.test(x))')" = "3" ]; then
  pass_case "no gh pr merge before the three checks: exactly one merge command, in the last block"
else fail_case "gh pr merge appears outside the last fenced block"; fi
if [ "$(bj 'b[3].trim()')" = "gh pr merge <n> --squash --delete-branch" ]; then pass_case "the merge block is exactly the canonical form the hook allows (only command, no extra flags)"
else fail_case "merge block is not the byte-exact canonical form: $(bj 'JSON.stringify(b[3])')"; fi
if [ "$(bj 'b.slice(0,3).filter(x=>/RC=\$\?/.test(x)&&/-ne 0/.test(x)&&/exit "\$RC"/.test(x)).length')" = "3" ]; then pass_case "each check block tests its exit code explicitly and stops on non-zero (count 3)"
else fail_case "a check block does not test \$? and exit"; fi
# Wave 13: `disposition review` (block 0) is not a registry gate and exits 2 on --phase; the two registry gates (blocks 1, 2) carry it.
if [ "$(bj 'b.slice(1,3).filter(x=>/--phase pr-<n>/.test(x)).length')" = "2" ] && [ "$(bj 'b.slice(0,1).filter(x=>/disposition review /.test(x)&&!/--phase/.test(x)).length')" = "1" ]; then pass_case "coherence and merge-check calls pass --phase pr-<n> (count 2); disposition review passes none (the command rejects it)"; else fail_case "05-merge.md: a registry call lacks --phase pr-<n> or disposition review passes --phase"; fi
if printf '%s' "$HAND" | grep -q 'workflows/05-merge.md'; then pass_case "SKILL.md Hand-offs points to workflows/05-merge.md"
else fail_case "SKILL.md Hand-offs does not point to 05-merge.md"; fi
if [ "$(printf '%s' "$HAND" | grep -c 'gh pr merge')" = "1" ]; then pass_case "the Hand-offs prose carries no second merge sequence (one gh pr merge mention, the pointer; count)"
else fail_case "Hand-offs still holds merge prose beyond the pointer"; fi
if grep -q 'Step 2.7' "$MRG" && grep -q -- '--merge-check' "$MRG" && grep -q -- '--body-file' "$MRG"; then
  pass_case "05-merge.md keeps the spec 016 precondition (step 2.7 merge check) and the --body-file rule"
else fail_case "05-merge.md lost the spec 016 precondition or the --body-file rule"; fi
if grep -q '2.2b' "$REV" && grep -q 'pr-diff-xprov' "$REV"; then pass_case "the Codex PR diff review step (2.2b) is still in 02-review.md"
else fail_case "02-review.md lost the Codex review step"; fi

# ---------- spec 017 wave 12 (FR-025): disposition review in 02-review.md + Reinhard ----------
# Measured red 2026-10-21 (git-archive snapshot, one line changed, suite run):
#   02-review.md: `disposition review` renamed to `disposition view`  : real-flags case
#   02-review.md: `--phase pr-<n>` added to the disposition call      : no --phase case (the CLI exits 2 on it)
#   agents/a1-reinhard-reviewer.md: heading "Disposition Review" cut   : agent-duty case
AGT="$SK/../agents/a1-reinhard-reviewer.md"
rb="$(node -e '
  const t=require("fs").readFileSync(process.argv[1],"utf8"); const out=[]; const re=/^```bash\n([\s\S]*?)^```/gm; let m;
  while((m=re.exec(t))) out.push(m[1]); process.stdout.write(JSON.stringify(out));' "$REV")"
rbj() { printf '%s' "$rb" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
if [ "$(rbj 'b.filter(x=>/disposition review /.test(x)).length')" = "1" ]; then pass_case "02-review.md has exactly one disposition review call (count)"; else fail_case "02-review.md disposition review call count != 1"; fi
if [ "$(rbj 'b.filter(x=>/disposition review <fingerprint> --verdict <upheld\|overturned> --reason /.test(x)&&/--by a1-reinhard-reviewer/.test(x)).length')" = "1" ]; then pass_case "the call uses the real flags (--verdict upheld|overturned, --reason, --by)"; else fail_case "disposition review call lacks --verdict/--reason/--by"; fi
if [ "$(rbj 'b.filter(x=>/disposition review /.test(x)&&/--phase/.test(x)).length')" = "0" ]; then pass_case "disposition review passes no --phase (the command rejects it with exit 2)"; else fail_case "disposition review call passes --phase"; fi
if [ "$(rbj 'b.filter(x=>/disposition review /.test(x)&&/RC=\$\?/.test(x)&&/-ne 0/.test(x)&&/exit "\$RC"/.test(x)).length')" = "1" ]; then pass_case "the disposition review block tests its exit code explicitly"; else fail_case "disposition review block does not test \$?"; fi
if [ "$(rbj 'b.findIndex(x=>/disposition review /.test(x))>b.findIndex(x=>/xprov gate --gate pr-diff-xprov --work-path/.test(x))')" = "true" ] && grep -q '^### 2.3b' "$REV" && [ "$(grep -n '^### 2.3b' "$REV" | cut -d: -f1)" -lt "$(grep -n '^### 2.4 ' "$REV" | cut -d: -f1)" ]; then pass_case "the disposition step sits between 2.3 and 2.4, after the Codex step"; else fail_case "disposition step 2.3b is missing or misplaced"; fi
if grep -q 'Dispositions changed between base and head' "$REV"; then pass_case "the Reinhard brief carries the changed dispositions"; else fail_case "Reinhard brief lacks the changed-dispositions line"; fi
if grep -q 'overturned' "$AGT" && grep -q 'upheld' "$AGT" && grep -q 'Disposition Review' "$AGT"; then pass_case "Reinhard agent file states the disposition review duty with upheld/overturned"; else fail_case "agents/a1-reinhard-reviewer.md lacks the disposition review duty"; fi
if [ "$(wc -l < "$AGT")" -le 260 ]; then pass_case "Reinhard agent file stays short (<= 260 lines)"; else fail_case "Reinhard agent file grew past 260 lines"; fi

echo ""
echo "a1-pr-review: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
