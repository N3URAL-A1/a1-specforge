# Spec 027 slice 4 (FR-019), plan D3: the recorder exception of `gates lint`.
# Sourced by run-tests.sh (uses ok, bad, check, check_rc, run_lint, plant, tree, WORK, REPO_ROOT).
# The row is the real `pr-reinhard` row of the real registry; the tree is the corpus tree with the REAL a1-pr-review
# workflow files copied over it. Planted defects are string edits of those copies.
#
# Measured red 2026-11-20 (each on its own snapshot, only the named cases fail):
#   gates-lint.cjs gradeRow(): PROMPT_RECORDERS check removed        -> PR1, PR3 (and G3, W11f, PR5)
#   gates-lint.cjs gradeRow(): exception keyed on the id only        -> PR2

PR_ROW="$WORK/pr-reinhard-row.md"
node -e '
  const fs=require("fs");
  const lines=fs.readFileSync(process.argv[1],"utf8").split("\n");
  const keep=lines.filter(l=>l.startsWith("| id |")||l.startsWith("|---|")||l.startsWith("| `pr-reinhard` |"));
  fs.writeFileSync(process.argv[2], keep.join("\n")+"\n");' "$REPO_ROOT/_shared/gates-registry.md" "$PR_ROW"

pr_tree() { # pr_tree <name>: the corpus tree with the real a1-pr-review workflows over it
  tree "$1"
  cp "$REPO_ROOT"/skills/a1-pr-review/workflows/*.md "$WORK/$1/skills/a1-pr-review/workflows/"
  cp "$REPO_ROOT/skills/a1-pr-review/SKILL.md" "$WORK/$1/skills/a1-pr-review/SKILL.md"
}
REAL_REVIEW="$REPO_ROOT/skills/a1-pr-review/workflows/02-review.md"

pr_tree prbase
run_lint --root "$WORK/prbase" --registry "$PR_ROW"
check "PR1 the real pr-reinhard row (invoke pr review-record @ a1-pr-review) with the call in 02-review.md: no prompt_names_command" 0 \
  'j.findings.filter(f=>f.rule==="prompt_names_command").length+"/"+j.findings.length' "0/0"

plant "$PR_ROW" "$WORK/pr2.md" 's = s.replace("`pr review-record` @ a1-pr-review", "`check reservations` @ a1-pr-review");'
run_lint --root "$WORK/prbase" --registry "$WORK/pr2.md"
check "PR2 the same row naming another subcommand (check reservations): prompt_names_command" 1 \
  'j.findings.filter(f=>f.rule==="prompt_names_command"&&f.gate==="pr-reinhard").length' "1"

run_lint
check "PR3 the real tree: exit 0, no findings, pr-reinhard@a1-pr-review wired" 0 \
  'j.findings.length+"/"+j.wired.some(w=>w.gate+"@"+w.skill==="pr-reinhard@a1-pr-review")' "0/true"

pr_tree prno4
plant "$REAL_REVIEW" "$WORK/prno4/skills/a1-pr-review/workflows/02-review.md" 's = s.split("\n").filter(l=>!l.includes("pr review-record")).join("\n");'
run_lint --root "$WORK/prno4" --registry "$PR_ROW"
check "PR4 the 2.3a call line removed from a copy: unwired naming pr-reinhard" 1 \
  'j.findings.filter(f=>f.rule==="unwired"&&f.gate==="pr-reinhard").length' "1"

pr_tree prno5
plant "$REAL_REVIEW" "$WORK/prno5/skills/a1-pr-review/workflows/02-review.md" 's = s.replace(/(pr review-record [^\n]*?) --phase pr-<n>/, "$1");'
run_lint --root "$WORK/prno5" --registry "$PR_ROW"
# Measured 2026-11-20: a1-pr-review names `retro validate --gate-log` only in prose (05-merge.md line 103), no fenced call,
# so call_without_phase cannot fire for it and the finding must be absent.
check "PR5 --phase removed from the record call: a1-pr-review wires no fenced retro validate --gate-log, so call_without_phase is absent" 0 \
  'j.findings.filter(f=>f.rule==="call_without_phase").length' "0"
