#!/usr/bin/env bash
# Test-Mode für a1-pr-review CLI-Subcommands.
# Verwendet einen Dummy-Registry via A1_WORKTREE_REGISTRY und einen
# temporären Worktree-Pfad. Mutiert nichts Echtes.

set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

CLI="node $(cd "$(dirname "${BASH_SOURCE[0]}")/../../_shared" && pwd)/a1-tools.cjs"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mk_workdir TMP tmp

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

echo "== Test 12: spec 025 wave 1 - Claude-only review (Reinhard always, Samuel on security surface), no Codex step"
SK="$(cd "$(dirname "$0")/../.." && pwd)/skills"
REV="$SK/a1-pr-review/workflows/02-review.md"
MRG="$SK/a1-pr-review/workflows/05-merge.md"
sec() { # sec <file> <heading prefix>: text of one "### " section, up to the next "### " or "## "
  node -e '
    const t=require("fs").readFileSync(process.argv[1],"utf8").split("\n"); const out=[]; let on=false;
    for (const l of t) { if (l.startsWith(process.argv[2])) { on=true; out.push(l); continue; } if (on && /^##+ /.test(l)) break; if (on) out.push(l); }
    process.stdout.write(out.join("\n"));' "$1" "$2"
}
gate_hits="$(grep -n 'xprov gate\|pr-diff-xprov\|merge-check' "$REV" "$MRG" | grep -v 'pr merge-check\|pr-merge-check' || true)"
if [ -z "$gate_hits" ]; then
  pass_case "02-review.md and 05-merge.md name no xprov gate, no pr-diff-xprov, no gate --merge-check (only pr merge-check remains)"
else fail_case "02-review.md / 05-merge.md still name an xprov gate or merge-check: $(printf '%s' "$gate_hits" | head -3)"; fi
if grep -q 'pr merge-check' "$MRG" && ! grep -q 'merge-check' "$REV"; then pass_case "05-merge keeps pr merge-check (5.3); 02-review has no merge-check step (2.7 gone)"
else fail_case "pr merge-check missing in 05-merge or a merge-check step survives in 02-review"; fi
if ! grep -q '^### 2.2c' "$REV" && ! grep -q '^### 2.7' "$REV" && ! grep -q 'Cross-provider' "$REV"; then pass_case "steps 2.2c and 2.7 and the Cross-provider step are gone from 02-review"
else fail_case "02-review.md still holds step 2.2c, 2.7 or a Cross-provider step"; fi
S22="$(sec "$REV" '### 2.2 ')"
if printf '%s' "$S22" | grep -q 'subagent_type: "a1-reinhard-reviewer"' && ! printf '%s' "$S22" | grep -q -i -E '^\s*(if|when|only)\b|security_surface|xprov'; then
  pass_case "step 2.2 spawns a1-reinhard-reviewer unconditionally (no if/when/surface condition in the step)"
else fail_case "step 2.2 spawn of Reinhard is missing or sits behind a condition"; fi
S22B="$(sec "$REV" '### 2.2b')"
if printf '%s' "$S22B" | grep -q 'xprov scope --repo' && printf '%s' "$S22B" | grep -q -e '--base' && printf '%s' "$S22B" | grep -q -e '--head HEAD' && printf '%s' "$S22B" | grep -q 'baseRefOid'; then
  pass_case "2.2b runs xprov scope --repo/--base/--head against the remote base sha (baseRefOid)"
else fail_case "2.2b lacks the xprov scope call with --repo/--base/--head or the baseRefOid source"; fi
if printf '%s' "$S22B" | grep -q 'subagent_type: "a1-specforge:a1-samuel-security"' && printf '%s' "$S22B" | grep -q 'security_surface' && printf '%s' "$S22B" | grep -q -i 'no `name`'; then
  pass_case "2.2b spawns a1-specforge:a1-samuel-security (no name) keyed on security_surface"
else fail_case "2.2b lacks the conditional Samuel spawn (subagent_type a1-specforge:a1-samuel-security, no name, security_surface)"; fi
if printf '%s' "$S22B" | grep -q 'no Samuel spawn'; then pass_case "2.2b says: surface false means no Samuel spawn"
else fail_case "2.2b does not state that no surface means no Samuel spawn"; fi
si="$(printf '%s' "$S22B" | grep -n 'subagent_type: "a1-specforge:a1-samuel-security"' | head -1 | cut -d: -f1)"
st="$(printf '%s' "$S22B" | grep -n 'STOP' | tail -1 | cut -d: -f1)"
if [ -n "$si" ] && [ -n "$st" ] && [ "$st" -gt "$si" ] && printf '%s' "$S22B" | grep -q -i 'spawn fail\|no JSON'; then pass_case "2.2b ends with STOP when the Samuel spawn fails or returns no JSON block (no silent merge)"
else fail_case "2.2b has no STOP line after the Samuel spawn (failed spawn / missing JSON)"; fi
if printf '%s' "$S22B" | grep -q 'RC=\$?' && printf '%s' "$S22B" | grep -q 'xprov scope exit=\$RC'; then pass_case "2.2b tests the exit code of xprov scope and stops on non-zero"
else fail_case "2.2b does not stop on a non-zero xprov scope exit"; fi
S24="$(sec "$REV" '### 2.4 ')"
if printf '%s' "$S24" | grep -q '"reinhard"' && printf '%s' "$S24" | grep -q '"samuel"' && printf '%s' "$S24" | grep -q '"reinhard+samuel"' && ! printf '%s' "$S24" | grep -q 'codex'; then
  pass_case "findings are tagged by source reinhard / samuel / reinhard+samuel; no codex source"
else fail_case "2.4 does not describe the source tags reinhard/samuel/reinhard+samuel or still names codex"; fi
if grep -q 'Security review (Samuel)' "$SK/a1-pr-review/workflows/03-draft.md" && ! grep -q 'Cross-provider' "$SK/a1-pr-review/workflows/03-draft.md"; then
  pass_case "the PR body carries a Security review (Samuel) section, no Cross-provider section"
else fail_case "03-draft.md lacks the Security review (Samuel) section or still has Cross-provider review"; fi
codex_hits="$(grep -n -i 'codex\|pr-diff-xprov\|xprov gate' "$SK/a1-pr-review/SKILL.md" "$SK/a1-pr-review/workflows/"*.md || true)"
if [ -z "$codex_hits" ]; then pass_case "no Codex / xprov gate mention in the a1-pr-review skill text (static)"
else fail_case "a1-pr-review text still mentions Codex or an xprov gate: $(printf '%s' "$codex_hits" | head -3)"; fi
if grep -q 'Samuel reviewed the diff when step 2.2b reported' "$MRG" && grep -q 'every BLOCKER and MAJOR of both reviewers is fixed' "$MRG"; then
  pass_case "05-merge precondition: Samuel reviewed when 2.2b reported surface; every BLOCKER and MAJOR of both reviewers fixed"
else fail_case "05-merge lacks the Samuel precondition or the both-reviewers fix rule"; fi
HJ="$SK/../hooks/hooks.json"
# spec 025 W3: the plugin carries NO Bash hook. Parsed, not grepped: a Bash entry in any spelling, any command naming the removed hook script,
# and the consent matchers that must survive (AskUserQuestion pre+post, the four edit tools).
hk="$(node -e '
  const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const pre = j.hooks.PreToolUse || [], post = j.hooks.PostToolUse || [];
  const all = [...pre, ...post];
  const cmds = all.flatMap((e) => (e.hooks || []).map((h) => String(h.command)));
  const bash = all.filter((e) => String(e.matcher).split("|").includes("Bash")).length;
  const mergeScript = cmds.filter((c) => /merge-hook/.test(c)).length;
  const consent = pre.some((e) => e.matcher === "AskUserQuestion") && post.some((e) => e.matcher === "AskUserQuestion") && pre.some((e) => e.matcher === "Edit|Write|NotebookEdit|MultiEdit");
  process.stdout.write([bash, mergeScript, consent, all.length].join("/"));' "$HJ")"
if [ "$hk" = "0/0/true/3" ]; then
  pass_case "hooks.json has no Bash matcher and no merge-hook command; the three consent entries remain (bash/merge/consent/total = $hk)"
else
  fail_case "hooks.json shape wrong (bash/merge/consent/total = $hk, want 0/0/true/3)"
fi
if [ ! -e "$SK/../hooks/xprov-merge-hook.sh" ] && [ ! -e "$SK/../_shared/lib/xprov-hook-merge.cjs" ]; then
  pass_case "the removed merge hook script and its decision module are gone from the tree"
else
  fail_case "hooks/xprov-merge-hook.sh or _shared/lib/xprov-hook-merge.cjs still exists"
fi
if grep -q 'gh pr merge <n> --squash` (no `--delete-branch`' "$SK/a1-pr-review/SKILL.md"; then
  pass_case "the a1-pr-review SKILL names the squash merge form without --delete-branch"
else
  fail_case "the a1-pr-review SKILL does not name the gh pr merge squash form"
fi
leak=0
for f in "$SK/a1-new-feature/workflows/05-implement.md" "$SK/a1-fix/SKILL.md" "$SK/a1-new-feature/workflows/06-verify.md"; do
  if grep -q "xprov gate\|pr-diff-xprov" "$f"; then leak=1; fail_case "$f names a cross-provider gate for code"; fi
done
[ "$leak" -eq 0 ] && pass_case "a1-new-feature 05/06 and a1-fix name no cross-provider gate for code (static)"

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
# Spec 020 wave 6: 5.5 adds the fifth block (probe run, after the merge); the first four are unchanged.
# spec 027 FR-035: run record block after the merge, before probes
if [ "$(bj 'b.length')" = "6" ]; then pass_case "05-merge.md has exactly 6 fenced bash blocks (count)"; else fail_case "05-merge.md fenced bash blocks: $(bj 'b.length') (want 6)"; fi
order="$(bj 'b.map(x=>/disposition review/.test(x)?"D":/product validate --spec-status --require-vault/.test(x)?"C":/pr merge-check/.test(x)?"M":/^gh pr merge /m.test(x)?"G":/run record/.test(x)?"R":/probe run/.test(x)?"P":"?").join("")')"
if [ "$order" = "DCMGRP" ]; then pass_case "block order: disposition review, coherence (--require-vault), merge-check, gh pr merge, run record, live probes"; else fail_case "05-merge.md block order is '$order' (want DCMGRP)"; fi
if [ "$(bj 'b.filter(x=>/gh pr merge/.test(x)).length')" = "1" ] && [ "$(bj 'b.findIndex(x=>/gh pr merge/.test(x))')" = "3" ]; then
  pass_case "no gh pr merge before the three checks: exactly one merge command, in the fourth block (the probe block follows it)"
else fail_case "gh pr merge appears outside the fourth fenced block"; fi
if [ "$(bj 'b[3].trim()')" = "gh pr merge <n> --squash --match-head-commit <head_sha>" ]; then pass_case "the merge block is exactly the canonical form the hook allows, with the head pin (only command, no other flags)"
else fail_case "merge block is not the byte-exact canonical form: $(bj 'JSON.stringify(b[3])')"; fi
if [ "$(bj 'b.slice(0,3).filter(x=>/RC=\$\?/.test(x)&&/-ne 0/.test(x)&&/exit "\$RC"/.test(x)).length')" = "3" ]; then pass_case "each check block tests its exit code explicitly and stops on non-zero (count 3)"
else fail_case "a check block does not test \$? and exit"; fi
# Wave 13: `disposition review` (block 0) is not a registry gate and exits 2 on --phase; the two registry gates (blocks 1, 2) carry it.
if [ "$(bj 'b.slice(1,3).filter(x=>/--phase pr-<n>/.test(x)).length')" = "2" ] && [ "$(bj 'b.slice(0,1).filter(x=>/disposition review /.test(x)&&!/--phase/.test(x)).length')" = "1" ]; then pass_case "coherence and merge-check calls pass --phase pr-<n> (count 2); disposition review passes none (the command rejects it)"; else fail_case "05-merge.md: a registry call lacks --phase pr-<n> or disposition review passes --phase"; fi
if printf '%s' "$HAND" | grep -q 'workflows/05-merge.md'; then pass_case "SKILL.md Hand-offs points to workflows/05-merge.md"
else fail_case "SKILL.md Hand-offs does not point to 05-merge.md"; fi
if [ "$(printf '%s' "$HAND" | grep -c 'gh pr merge')" = "1" ]; then pass_case "the Hand-offs prose carries no second merge sequence (one gh pr merge mention, the pointer; count)"
else fail_case "Hand-offs still holds merge prose beyond the pointer"; fi
if grep -q -- '--body-file' "$MRG" && ! grep -q 'Step 2.7' "$MRG"; then
  pass_case "05-merge.md keeps the --body-file rule and names no step 2.7 (spec 025: the Codex merge check is gone)"
else fail_case "05-merge.md lost the --body-file rule or still names step 2.7"; fi

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
if [ "$(rbj 'b.findIndex(x=>/disposition review /.test(x))>b.findIndex(x=>/xprov scope --repo/.test(x))&&b.findIndex(x=>/xprov scope --repo/.test(x))>=0')" = "true" ] && grep -q '^### 2.3b' "$REV" && [ "$(grep -n '^### 2.3b' "$REV" | cut -d: -f1)" -lt "$(grep -n '^### 2.4 ' "$REV" | cut -d: -f1)" ]; then pass_case "the disposition step sits between 2.2b (security surface) and 2.4"; else fail_case "disposition step 2.3b is missing or misplaced"; fi
if grep -q 'Dispositions changed between base and head' "$REV"; then pass_case "the Reinhard brief carries the changed dispositions"; else fail_case "Reinhard brief lacks the changed-dispositions line"; fi
if grep -q 'overturned' "$AGT" && grep -q 'upheld' "$AGT" && grep -q 'Disposition Review' "$AGT"; then pass_case "Reinhard agent file states the disposition review duty with upheld/overturned"; else fail_case "agents/a1-reinhard-reviewer.md lacks the disposition review duty"; fi
if [ "$(wc -l < "$AGT")" -le 260 ]; then pass_case "Reinhard agent file stays short (<= 260 lines)"; else fail_case "Reinhard agent file grew past 260 lines"; fi

# ---------- spec 017 review round A (M1, M2): head pin and committed dispositions ----------
# Measured red 2026-10-21 (git-archive snapshot, one line changed, suite run):
#   05-merge.md: `--match-head-commit <head_sha>` removed from the merge block   : head-pin case (and the byte-exact canonical case)
#   05-merge.md: `git push` removed from the disposition block                    : commit+push case
#   02-review.md: the commit+push block removed from 2.3b                         : 2.3b commit+push case
if [ "$(bj 'b[0].includes("git commit -m") && b[0].includes("-- .a1/dispositions.json") && b[0].includes("git push") && b[0].indexOf("disposition review") < b[0].indexOf("git commit") && b[0].indexOf("git commit") < b[0].indexOf("git push")')" = "true" ]; then pass_case "05-merge 5.1 commits .a1/dispositions.json (explicit path) and pushes, after the review call"
else fail_case "05-merge 5.1 block lacks the ordered review, commit (-- .a1/dispositions.json), push sequence"; fi
if [ "$(bj 'b[3].includes("--match-head-commit <head_sha>")')" = "true" ] && grep -q 'head_sha' "$MRG"; then pass_case "05-merge 5.4 pins the merge to the head_sha that merge-check reported"
else fail_case "05-merge 5.4 does not pass --match-head-commit <head_sha>"; fi
if [ "$(rbj 'b.filter(x=>/git commit -m/.test(x)&&/-- \.a1\/dispositions\.json/.test(x)&&/git push/.test(x)).length')" = "1" ]; then pass_case "02-review 2.3b has one commit+push block for .a1/dispositions.json (count)"
else fail_case "02-review 2.3b lacks the commit+push block for the dispositions file"; fi
if grep -q 'dispositions_uncommitted' "$MRG" && grep -q 'dispositions_uncommitted' "$REV"; then pass_case "both workflows name dispositions_uncommitted as the reason for the commit step"
else fail_case "a workflow does not explain dispositions_uncommitted"; fi

# ---------- spec 017 review round C (MINOR-1/2/B): config-change reasons documented, no self-authorizing flag ----------
# Measured red 2026-10-21 (before the 05-merge.md edit): verify_config_changed and the add-command line absent, --accept-config-change present.
if grep -q 'verify_config_changed' "$MRG" && grep -q 'fidelity_config_changed' "$MRG" && grep -q 'disposition add --kind config_change --fingerprint' "$MRG" && grep -q 'suites.config_changed.fingerprint' "$MRG"; then pass_case "05-merge 5.3 documents verify_config_changed and fidelity_config_changed and how a second reviewer clears them"
else fail_case "05-merge 5.3 does not document verify_config_changed / fidelity_config_changed and the config_change disposition route"; fi
if ! grep -q 'accept-config-change' "$MRG"; then pass_case "05-merge names no --accept-config-change flag (no self-authorizing way around the config check)"
else fail_case "05-merge still mentions --accept-config-change"; fi
if grep -q 'disposition review' "$MRG" && grep -q -e '--by a1-reinhard-reviewer' "$MRG"; then pass_case "05-merge disposition review lines carry --by (required since round C)"
else fail_case "05-merge disposition review line lacks --by"; fi

# Review round (evolve run 9): advisory snippets in 05-merge live in non-bash fences (sh): they print WAIT/HOST lines and
# must neither run the merge command nor exit, else they would become a hidden gate or a second merge path.
nb="$(node -e '
  const t=require("fs").readFileSync(process.argv[1],"utf8"); let bad=0, n=0; const re=/^```([a-z]*)\n([\s\S]*?)^```/gm; let m;
  while((m=re.exec(t))){ if(m[1]==="bash") continue; n++; if(/gh pr merge/.test(m[2])||/\bexit\b/.test(m[2])) bad++; }
  console.log(n+":"+bad);' "$MRG")"
if [ "${nb#*:}" = "0" ] && [ "${nb%%:*}" -ge 1 ]; then pass_case "05-merge non-bash fences (${nb%%:*}) contain neither the merge command nor exit"
else fail_case "05-merge non-bash fences: count:bad = $nb (want >=1 fence, 0 bad)"; fi
# No stale squash command with --delete-branch in skills/ or _shared/*.md. Excluded on purpose:
#   skills/a1-new-feature/SKILL.md - held by the 006-specforge-kritis-profile code-scope claim; follow-up: change it to
#   the form without --delete-branch once 006 releases the claim, then drop this exclusion.
#   _test-fixtures/a1-gates-lint/corpus/ is not scanned (static corpus copies).
stale="$(grep -rIl -e '--squash --delete-branch' "$SK" "$(dirname "$SK")"/_shared/*.md 2>/dev/null | grep -v 'skills/a1-new-feature/SKILL.md$' || true)"
if [ -z "$stale" ]; then pass_case "no stale squash merge command with --delete-branch in skills/ and _shared/*.md (a1-new-feature/SKILL.md excluded: 006 claim)"
else fail_case "stale squash merge command with --delete-branch in: $stale"; fi

# ---------- spec 027 FR-035: run record guard (RR-guard) ----------
RRB="$(bj 'b.find(x=>/run record/.test(x))')"
mk_workdir RRT rr-guard; mkdir -p "$RRT/repo/_shared" "$RRT/wt"
cat > "$RRT/repo/_shared/a1-tools.cjs" <<'STUB'
require("fs").appendFileSync(process.env.RR_LOG, process.argv.slice(2).join(" ") + "\n");
STUB
rr_run() { # $1 = phase value
  printf '%s' "$RRB" | sed -e "s#<repo>#$RRT/repo#g" -e "s#<worktree_path>#$RRT/wt#g" -e "s#<n>#7#g" ${1:+-e "s#<phase_name>#$1#g"} > "$RRT/blk.sh"
  : > "$RRT/log"; RR_LOG="$RRT/log" bash "$RRT/blk.sh" > "$RRT/out" 2>&1; echo $?
}
rc="$(rr_run "")"
if [ "$rc" = "0" ] && grep -q 'SKIP: run record' "$RRT/out" && [ "$(wc -l < "$RRT/log")" = "1" ] && grep -q -- '--scope pr-7' "$RRT/log"; then pass_case "RR-guard: unreplaced <phase_name> skips the second call (stub ran once, --scope pr-7)"; else fail_case "RR-guard: placeholder case rc=$rc log=$(cat "$RRT/log")"; fi
rc="$(rr_run fx-phase)"
if [ "$rc" = "0" ] && [ "$(wc -l < "$RRT/log")" = "2" ] && sed -n 2p "$RRT/log" | grep -q -- '--scope fx-phase'; then pass_case "RR-guard: a real phase name runs the second call with --scope fx-phase"; else fail_case "RR-guard: phase case rc=$rc log=$(cat "$RRT/log")"; fi

echo ""
echo "a1-pr-review: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
