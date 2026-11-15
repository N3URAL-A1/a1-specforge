# Sourced by run-tests.sh (spec 028 FR-018, FR-019, FR-021, wave 2). Uses the suite helpers: new_repo, change_src, head_commit,
# run_tf, js, expect, G, R, WORK, TOOLS, REAL, QUOTE_AFTER, plant.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# RED-proof (wave report, 2026-11-14): this file was run once against `git archive fa73852`; every case below fails there except the
# explicit controls that pin behaviour already true there (ST6, the L13 controls in a1-retro-validate); the others fail on
# the missing `status`, `ci_jobs`, `test_like`, `scanned` or `looksLikeTest`.
#
# st <expr over j>: evaluates the expression on OUT (alias of js, kept for readability)
st() { js "$1"; }
# base_retag: commit the working tree into the base and move the `base` tag there.
base_retag() { G add -A && G commit -q -m base2 >/dev/null && G tag -f base >/dev/null; }

# ---- FR-018: shell tests matched by the default globs at any depth, checked by test-not-in-ci only ----
new_repo; mkdir -p "$R/skills/x/tests"; printf '#!/usr/bin/env bash\necho ok\n' > "$R/skills/x/tests/test-a.sh"
head_commit; run_tf
expect "ST1a changed skills/x/tests/test-a.sh is scanned (no fidelity.json): scanned 1" 1 "$(st 'j.scanned')"
expect "ST1b only test-not-in-ci applies to a shell test (rule list)" "test-not-in-ci" "$(js "[...new Set(j.findings.map(f=>f.rule))].join(',')")"
expect "ST1c test-not-in-ci finding names the shell test, exit 1, status findings" "skills/x/tests/test-a.sh|1|findings" "$(js 'j.findings[0].file')|$RC|$(st 'j.status')"
new_repo; mkdir -p "$R/a/b/c"; printf 'echo ok\n' > "$R/a/b/c/db_test.sh"; head_commit; run_tf
expect "ST1d *_test.sh at depth 3 is scanned" 1 "$(st 'j.scanned')"
new_repo; mkdir -p "$R/skills/x/tests"; printf 'echo ok\n' > "$R/skills/x/tests/helper.sh"; head_commit; run_tf
expect "ST1e control: skills/x/tests/helper.sh matches no default glob: scanned 0 and no_scan (test-like)" "0|no_scan" "$(st 'j.scanned')|$(st 'j.status')"
new_repo; mkdir -p "$R/skills/x/tests" "$R/.a1"; printf 'echo ok\n' > "$R/skills/x/tests/test-a.sh"
printf '{"ci_globs":["skills/*/tests/test-*.sh"]}\n' > "$R/.a1/fidelity.json"
printf 'name: t\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash skills/*/tests/test-*.sh\n' > "$R/.github/workflows/ci.yml"
head_commit; run_tf
expect "ST1f shell test reached by a ci_globs entry in a run line: clean, exit 0" "clean|0|1" "$(st 'j.status')|$RC|$(st 'j.scanned')"

# ---- FR-019: the four statuses ----
new_repo; cp "$QUOTE_AFTER" "$R/tests/q.test.ts"; head_commit; run_tf
expect "ST2a clean: scanned >= 1, no findings -> status clean, ok true, exit 0" "clean|true|0|1" "$(st 'j.status')|$(st 'j.ok')|$RC|$(st 'j.scanned')"
new_repo; plant "$QUOTE_AFTER" "$R/tests/q.test.ts" skip; head_commit; run_tf
expect "ST2b findings: status findings, ok false, exit 1, no hint/test_like keys" "findings|false|1|false|false" "$(st 'j.status')|$(st 'j.ok')|$RC|$(st '"hint" in j')|$(st '"test_like" in j')"
new_repo; change_src README.md; head_commit; run_tf
expect "ST3a not_applicable: scanned 0, no test-like file -> ok true, exit 0, no hint" "not_applicable|true|0|0|false" "$(st 'j.status')|$(st 'j.ok')|$RC|$(st 'j.scanned')|$(st '"hint" in j')"
new_repo; mkdir -p "$R/tests"; printf '{"a":1}\n' > "$R/tests/data.json"; head_commit; run_tf
expect "ST3b changed tests/data.json (non-code under tests/) is not test-like: not_applicable, exit 0" "not_applicable|0" "$(st 'j.status')|$RC"
# review round M3: helper files and look-alike names are not test-like
new_repo; mkdir -p "$R/tests" "$R/src"; printf 'x = 1\n' > "$R/tests/conftest.py"; printf 'export const t = 1;\n' > "$R/src/testimonial.ts"; head_commit; run_tf
expect "ST3c a diff touching only tests/conftest.py and src/testimonial.ts is not no_scan: not_applicable, exit 0, no test_like" "not_applicable|0|false" "$(st 'j.status')|$RC|$(st '"test_like" in j')"
new_repo; mkdir -p "$R/tests/fixtures" "$R/tests/utils" "$R/tests/helpers"; printf 'x\n' > "$R/tests/fixtures/data.ts"; printf 'x\n' > "$R/tests/utils/io.ts"; printf 'x\n' > "$R/tests/__init__.py"; printf 'x\n' > "$R/tests/setup_env.ts"; printf 'x\n' > "$R/tests/helpers_db.ts"; head_commit; run_tf
expect "ST3d fixtures/ and utils/ segments, __init__.py, setup*.* and helpers*.* are excluded from test-like" "not_applicable|0" "$(st 'j.status')|$RC"
new_repo; mkdir -p "$R/src"; printf 'x\n' > "$R/src/test-util.ts"; head_commit; run_tf
expect "ST3e control: a genuine test-shaped name (test-util.ts) is still test-like: no_scan" "no_scan|1" "$(st 'j.status')|$RC"
new_repo; mkdir -p "$R/spec"; printf 'x\n' > "$R/spec/foo_test.js"; printf 'x\n' > "$R/tests/testutil.ts"; head_commit; run_tf
expect "ST4a no_scan: scanned 0 beside test-like files -> status no_scan, ok false, exit 1" "no_scan|false|1|0" "$(st 'j.status')|$(st 'j.ok')|$RC|$(st 'j.scanned')"
expect "ST4a hint text names the config key and file" "add test_globs to .a1/fidelity.json" "$(st 'j.hint')"
expect "ST4a test_like lists both paths, sorted, with count 0 findings" "spec/foo_test.js,tests/testutil.ts|0" "$(st 'j.test_like.join(",")')|$(st 'j.count')"
expect "ST4a existing keys keep their meaning (base, count, dispositioned, findings array)" "base|0|0|0" "$(st 'j.base')|$(st 'j.count')|$(st 'j.dispositioned')|$(st 'j.findings.length')"
new_repo; mkdir -p "$R/tests" "$R/.a1"; printf 'x\n' > "$R/tests/testutil.ts"; printf '{"test_globs":["tests/testutil.ts"]}\n' > "$R/.a1/fidelity.json"; head_commit; run_tf
expect "ST4b control: the hint's fix works - test_globs covers the file -> scanned 1, status no longer no_scan (the file is now judged: test-not-in-ci)" "1|findings|test-not-in-ci" "$(st 'j.scanned')|$(st 'j.status')|$(st 'j.findings[0].rule')"
new_repo; mkdir -p "$R/tests"; for i in $(seq -w 1 25); do printf 'x\n' > "$R/tests/testutil$i.ts"; done; head_commit; run_tf
expect "ST5a test_like is capped at 20 paths (25 planted)" "20|no_scan" "$(st 'j.test_like.length')|$(st 'j.status')"
expect "ST5a the cap keeps the first 20 in sorted order (first, last)" "tests/testutil01.ts|tests/testutil20.ts" "$(st 'j.test_like[0]')|$(st 'j.test_like[19]')"
new_repo; mkdir -p "$R/tests"; for i in $(seq -w 1 20); do printf 'x\n' > "$R/tests/testutil$i.ts"; done; head_commit; run_tf
expect "ST5b control: exactly 20 test-like files list all 20" 20 "$(st 'j.test_like.length')"
# unknown --diff-base keeps exit 2 and prints no JSON (no new scanned:0 pass)
new_repo; change_src README.md; head_commit
OUT="$(cd "$R" && node "$TOOLS" test-fidelity --phase fx-w4 --diff-base no-such-ref 2>"$WORK/err")"; RC=$?
expect "ST6 unknown --diff-base: exit 2, empty stdout (not not_applicable)" "2|" "$RC|$OUT"

# ---- looksLikeTest table (FR-019), driven through the real exported function ----
LT="$(node -e '
  const { looksLikeTest } = require(process.argv[1]);
  const exts = ["sh","bash","js","cjs","mjs","jsx","ts","tsx","py"];
  const segs = ["test","tests","__tests__","spec"];
  const bad = [];
  for (const e of exts) {
    for (const s of segs) if (!looksLikeTest(`${s}/helper.${e}`)) bad.push(`seg ${s}.${e}`);
    for (const b of [`test-x.${e}`, `x_test.${e}`, `x.test.${e}`, `x.spec.${e}`]) if (!looksLikeTest(`src/${b}`)) bad.push(`base ${b}`);
  }
  if (!looksLikeTest("a/b/tests/c/helper.ts")) bad.push("nested segment");
  process.stdout.write(bad.length ? "MISSED:" + bad.join(";") : "all");
' "$REPO_ROOT/_shared/lib/fidelity-resolve.cjs" 2>&1)"
expect "LT-pos looksLikeTest true for 9 extensions x 4 segments and 4 basename forms" "all" "$LT"
LTN="$(node -e '
  const { looksLikeTest } = require(process.argv[1]);
  const hits = ["tests/data.json","tests/README.md","spec/schema.yaml","src/helper.ts","src/contest.ts","src/attestation.js","lib/protest.py","src/latest.sh","testing/helper.ts","src/x.test","docs/tests.txt"].filter((p) => looksLikeTest(p));
  process.stdout.write(hits.length ? "WRONGLY:" + hits.join(",") : "none");
' "$REPO_ROOT/_shared/lib/fidelity-resolve.cjs" 2>&1)"
expect "LT-neg looksLikeTest false for non-code under tests/, no segment and no basename form, near-miss names" "none" "$LTN"

# ---- FR-021: ci_jobs ----
new_repo
printf 'name: t\non: push\njobs:\n  unit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx vitest run\n  py:\n    runs-on: ubuntu-latest\n    steps:\n      - run: python -m pytest\n' > "$R/.github/workflows/ci.yml"
base_retag
printf 'x\n' > "$R/tests/a.test.ts"; printf 'def test_b():\n    assert 1 == 1\n' > "$R/tests/test_b.py"; head_commit; run_tf
expect "CJ1a ci_jobs maps each scanned test to the jobs that reach it (job ids from the jobs: keys)" '{"tests/a.test.ts":["unit"],"tests/test_b.py":["py"]}' "$(js 'JSON.stringify(j.ci_jobs)')"
expect "CJ1b reached files produce no finding: status clean, exit 0" "clean|0" "$(st 'j.status')|$RC"
new_repo
printf 'name: t\non: push\njobs:\n  unit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx vitest run\n  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx vitest run\n' > "$R/.github/workflows/ci.yml"
base_retag
printf 'x\n' > "$R/tests/a.test.ts"; head_commit; run_tf
expect "CJ2 a file reached by two jobs lists both ids, in workflow order" '{"tests/a.test.ts":["unit","other"]}' "$(js 'JSON.stringify(j.ci_jobs)')"
new_repo; mkdir -p "$R/scripts"; printf 'x\n' > "$R/scripts/test-z.sh"; printf 'x\n' > "$R/tests/a.test.ts"; head_commit; run_tf
expect "CJ3a control: a file no job reaches keeps its test-not-in-ci finding and is absent from ci_jobs" "test-not-in-ci:scripts/test-z.sh|1" "$(js "j.findings.map(f=>f.rule+':'+f.file).join(',')")|$RC"
expect "CJ3b ci_jobs lists only the reached file; ok/status/exit stay findings-driven" '{"tests/a.test.ts":["t"]}|false|findings' "$(js 'JSON.stringify(j.ci_jobs)')|$(st 'j.ok')|$(st 'j.status')"
new_repo; change_src README.md; head_commit; run_tf
expect "CJ4 no test files: ci_jobs is an empty object and the status unchanged" "{}|not_applicable" "$(js 'JSON.stringify(j.ci_jobs)')|$(st 'j.status')"

# ---- FR-017: the gate-log line of test-fidelity carries `scanned` ----
glast() { node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean); const r=JSON.parse(t[t.length-1]); process.stdout.write(String(eval(process.argv[2])))' "$R/.a1/phases/fx-w4/gate-log.jsonl" "$1"; }
new_repo; cp "$QUOTE_AFTER" "$R/tests/q.test.ts"; cp "$QUOTE_AFTER" "$R/tests/r.test.ts"; head_commit; run_tf
expect "SG1 gate-log line of a 2-file scan carries scanned: 2 (integer) beside gate and verdict" "test-fidelity|pass|2|number" "$(glast 'r.gate+"|"+r.verdict+"|"+r.scanned+"|"+typeof r.scanned')"
new_repo; change_src README.md; head_commit; run_tf
expect "SG2 a not_applicable run logs scanned: 0 (0 is a valid value, not dropped)" "0|true" "$(glast 'r.scanned')|$(glast '"scanned" in r')"
new_repo; mkdir -p "$R/tests"; printf 'x\n' > "$R/tests/testutil.ts"; head_commit; run_tf
expect "SG3 a no_scan run logs scanned: 0 with verdict fail" "0|fail" "$(glast 'r.scanned')|$(glast 'r.verdict')"
(cd "$R" && node "$TOOLS" gates lint --log .a1/phases/fx-w4/gate-log.jsonl >"$WORK/lint.out" 2>&1); RC=$?
expect "SG4 gates lint accepts the log lines that carry scanned" 0 "$RC"
