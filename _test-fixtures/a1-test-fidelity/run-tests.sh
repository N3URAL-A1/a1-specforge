#!/usr/bin/env bash
# Fixture: `a1-tools test-fidelity` (spec 017-enforced-self-checks, Wave 4, FR-019/020/022/023/024).
#
# Inputs are byte copies of real a1-office files (real/, origin in real/ORIGIN.md): the historical
# tests of claudia-caps-audit-insert-500 and quote-deal-id-not-persisted, their corrected versions,
# the real tsconfig.json and the real `lib/crm/api.ts` barrel. Planted defects are string edits of
# those copies (plant()), never parser output. Python plants are synthetic: the postmortem repos
# hold no Python test. Every equality assert has a count assert beside it.
#
# Each case names the single production change that turns it red. See the "Measured red" lines
# at the end of this header (git-archive snapshot, one line reverted, suite run).
#
# Measured red 2026-10-21 (each on its own git-archive snapshot, one edit, suite run; cases that fail):
#   fidelity-rules.cjs mockOfSubject(): db-wrapper key compare -> undefined   -> H1, H2, H4, R7, R8a, R8b
#   fidelity-resolve.cjs subjectFiles(): one-hop re-export targets dropped    -> H2 (barrel api.ts -> invoices.ts)
#   fidelity-rules.cjs skippedTest(): loop over SKIP_PATTERNS emptied         -> H4, M1b, S1-S3b, X5
#   fidelity-rules.cjs SKIP_PATTERNS: xit/xdescribe/xtest entry removed       -> S1
#   fidelity-rules.cjs SKIP_PATTERNS: `skipIf` alternation removed             -> S2
#   fidelity-rules.cjs SKIP_PATTERNS: pytest.mark.skip entry removed           -> S3
#   fidelity-rules.cjs skippedTest(): per-line dedupe removed                  -> S3, S3b
#   fidelity-rules.cjs jsLeadingGuard(): returns -1                            -> E1, E2, E3
#   fidelity-rules.cjs jsLeadingGuard(): `{ return }` branch removed           -> E2
#   fidelity-rules.cjs eachCallOpen(): `.each` handling removed                -> E3
#   fidelity-rules.cjs jsLeadingGuard(): `!` condition check removed           -> E4
#   fidelity-rules.cjs pyEarlyReturn(): one-line `if not x: return` removed    -> E5
#   fidelity-tokenizer.cjs maskJs(): `//` comment branch disabled              -> C1
#   fidelity-tokenizer.cjs maskJs(): `/* */` comment branch disabled           -> C1
#   fidelity-tokenizer.cjs scanQuoted(): string content not blanked            -> C2, E5
#   fidelity-tokenizer.cjs maskJs(): template text not blanked                 -> C2
#   fidelity-tokenizer.cjs maskJs(): `${` expressions treated as template text -> C4, X3
#   fidelity-tokenizer.cjs maskJs(): regex literal branch disabled              -> X6
#   fidelity-tokenizer.cjs maskJs(): MAX_NESTING checks removed                 -> X3
#   fidelity-tokenizer.cjs lineOf(): `lo + 1` -> `lo`                           -> H1, H2, M1b, E1, X6
#   fidelity-resolve.cjs candidateFile(): index files not tried                -> R1
#   fidelity-resolve.cjs loadAliases(): paths ignored                          -> R2, R5, H2
#   fidelity-resolve.cjs loadAliases(): `extends` not followed                  -> R5, U2d
#   fidelity-resolve.cjs resolveSpecifier(): package specifiers tried as paths  -> R3
#   fidelity-resolve.cjs readJsonc(): parse error swallowed                     -> U2c
#   fidelity-rules.cjs mockOfSubject(): any resolved target counts as changed   -> H2, R4
#   fidelity-rules.cjs mockCallInfo(): spyOn import-binding lookup removed      -> R6
#   fidelity-rules.cjs mockCallInfo(): spyOn method name dropped                -> R7
#   fidelity-rules.cjs readKey(): quoted keys not read                          -> R8a
#   fidelity-rules.cjs objectKeys(): `depth === 1` -> `depth >= 1`             -> R9
#   test-fidelity.cjs loadConfig(): db_wrappers from config ignored             -> R8b, U2b
#   test-fidelity.cjs loadConfig(): malformed config swallowed                  -> U2a
#   test-fidelity.cjs scan(): test_globs ignored                                -> T1b
#   test-fidelity.cjs scanFile(): langOf() returns 'js' for every extension    -> T1b, T5a (bash heredoc lexed as JS)
#   test-fidelity.cjs changedFiles(): `split('\0')` -> `split('\n')`           -> T2 (and every case whose names are plain: all pass-through cases)
#   test-fidelity.cjs readSource(): symlink check removed                       -> T3
#   test-fidelity.cjs readSource(): size cap removed                            -> X4
#   test-fidelity.cjs parseArgs(): missing --diff-base defaults to a ref        -> U1a
#   test-fidelity.cjs parseArgs(): leading "-" in the ref accepted              -> U1e
#   test-fidelity.cjs parseArgs(): --project ignored                            -> U3
#   test-fidelity.cjs changedFiles(): git run through a shell                   -> X1a, X1b
#   test-fidelity.cjs changedFiles(): diff against the empty tree               -> every green case + S4
#   test-fidelity.cjs cmdTestFidelity(): exit code always 0                     -> every exit-1 case
#
# Wave 7 (`test-not-in-ci`), measured red 2026-10-21 on git-archive snapshots, one edit each (cases that fail):
#   fidelity-ci.cjs fileFinding(): ci_globs match removed                         -> CI1a, CI1b
#   fidelity-ci.cjs testNotInCi(): literal run:-line check of ci_globs removed    -> CI2a, CI2b
#   fidelity-ci.cjs testNotInCi(): no-workflows branch disabled                   -> CI3a, CI3b, CI3c
#   fidelity-ci-runners.cjs nodeMatcher(): config `exclude` ignored               -> CI4
#   fidelity-ci-runners.cjs judge(): literal positional filters ignored           -> CI5a, CI5b, CI7
#   fidelity-ci.cjs fileFinding(): unresolved reasons ignored                     -> CI6a, CI6b, CI6c
#   fidelity-ci.cjs followScript(): script body not followed                      -> CI4, CI7 and every Wave 4 green case
#   fidelity-ci-runners.cjs pytestMatcher(): testpaths ignored                    -> CI8
#   fidelity-ci.cjs startState(): working-directory dropped                       -> CI9
#   fidelity-ci-runners.cjs walkUp(): package.json "jest" key ignored             -> CI10
#   fidelity-ci.cjs readValue(): block scalars (`>-`) not read                    -> CI9, CI11b
#   fidelity-ci-runners.cjs readText(): size cap removed                          -> CI12c
#   fidelity-ci.cjs findPackage(): malformed package.json swallowed               -> CI12a
#   fidelity-ci.cjs readCiConfig(): ci_globs shape check removed                  -> CI12b
#   fidelity-ci.cjs walkCommand(): command after a dynamic `cd` still resolved    -> CI12e
#   fidelity-ci.cjs scalar(): quoted value with trailing comment not unquoted     -> CI11c
#   fidelity-ci-runners.cjs globToRegex(): extglob `?(...)` not translated        -> CI4, CI5a, CI5b, CI7, CI11b, CI11c, Wave 4 green cases
#   fidelity-ci-runners.cjs pytestMatcher(): default python_files replaced        -> CI8, CI8b
#
# Wave 8 (Q21), measured red 2026-10-21 the same way:
#   test-fidelity.cjs scan(): dispositions not applied                            -> H4b (corrected claudia test stays flagged)
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
REAL="$REPO_ROOT/_test-fixtures/a1-test-fidelity/real"

. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2
mk_workdir WORK test-fidelity

pass=0
fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

# expect <name> <expected> <actual>
expect() {
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi
}

REPO_N=0
R=""
G() { git -C "$R" -c user.name=fx -c user.email=fx@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"; }

# new_repo: fresh git repo with a base commit (real tsconfig + real api barrel + stubs + a minimal CI
# so `test-not-in-ci` stays quiet for the Wave 4 cases: workflow `npm test` / `python -m pytest`), tag `base`.
new_repo() {
  REPO_N=$((REPO_N + 1))
  R="$WORK/r$REPO_N"
  mkdir -p "$R/lib/crm" "$R/lib/audit-dir" "$R/tests" || return 1
  git -C "$R" -c init.defaultBranch=main init -q || return 1
  cp "$REAL/tsconfig.json" "$R/tsconfig.json"
  cp "$REAL/api.ts" "$R/lib/crm/api.ts"
  printf 'export async function createInvoice() { return null; }\n' > "$R/lib/crm/invoices.ts"
  printf 'export const write = () => 1;\n' > "$R/lib/audit.ts"
  printf 'export const x = 1;\n' > "$R/lib/audit-dir/index.ts"
  printf '# fixture\n' > "$R/README.md"
  mkdir -p "$R/.github/workflows"
  printf 'name: t\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n      - run: python -m pytest\n' > "$R/.github/workflows/ci.yml"
  printf '{"scripts":{"test":"vitest run"}}\n' > "$R/package.json"
  G add -A && G commit -q -m base && G tag base
}

# change_src <rel...>: append a line so the file counts as changed in the head commit.
change_src() { local f; for f in "$@"; do mkdir -p "$R/$(dirname "$f")"; printf '// changed\n' >> "$R/$f"; done; }
head_commit() { G add -A && G commit -q -m head >/dev/null; }

# run_tf [extra args]: runs in $R -> OUT (stdout), ERR (stderr), RC
run_tf() {
  OUT="$(cd "$R" && node "$TOOLS" test-fidelity --phase fx-w4 --diff-base base "$@" 2>"$WORK/err")"; RC=$?
  ERR="$(cat "$WORK/err")"
}

# js <expr over j>: evaluates the expression on the parsed OUT
js() { printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
fcount() { js "j.findings.filter(f=>f.rule==='$1').length"; }

# plant <src> <dst> <mode>: string edit of a real copy
plant() {
  node -e '
    const fs = require("fs");
    const [src, dst, mode] = process.argv.slice(1);
    let s = fs.readFileSync(src, "utf8");
    const at = s.indexOf("it(\"A1");
    const body = s.indexOf("=> {\n", at) + 5;
    const edits = {
      skip: () => s.replace("  it(\"A1", "  it.skip(\"A1"),
      xit: () => s.replace("  it(\"A1", "  xit(\"A1"),
      skipif: () => s.replace("  it(\"A1", "  it.skipIf(true)(\"A1"),
      guard: () => s.slice(0, body) + "    if (!db) return;\n" + s.slice(body),
      guardbrace: () => s.slice(0, body) + "    if (!db) { return }\n" + s.slice(body),
      commentmock: () => s + "\n// vi.mock(\"../lib/audit\", () => ({}));\n/**\n * vi.mock(\"../lib/audit\", () => ({ withTenantContext: 1 }))\n */\n",
      stringmock: () => s + "\nconst note = \x27vi.mock(\"../lib/audit\", () => ({ withTenantContext: 1 }))\x27;\nconst tpl = `jest.mock(\"x\", () => ({ withTenantContext: 1 }))`;\n",
      codemock: () => s + "\nvi.mock(\"../lib/audit\", () => ({ write: vi.fn() }));\n",
    };
    fs.writeFileSync(dst, edits[mode]());
  ' "$1" "$2" "$3"
}

QUOTE_AFTER="$REAL/quote-after.quote-deal-link.test.ts"

# --------------------------------------------------------------------------------------------
# Historical defects (SC-005, FR-020)
# --------------------------------------------------------------------------------------------

# H1  RED: mockOfSubject() db-wrapper branch removed (info.keys never compared).
new_repo; cp "$REAL/claudia-before.mail-rules-rejected-audit.test.ts" "$R/tests/mail-rules.test.ts"
change_src lib/claudia/mail-rules-audit.ts; head_commit; run_tf
expect "H1 historical claudia test (mocks withTenantContext): exit 1" 1 "$RC"
expect "H1 one mock-of-subject finding (count)" 1 "$(fcount mock-of-subject)"
WANT_LINE="$(grep -n 'vi.mock("@/lib/db/tenant-pool"' "$REAL/claudia-before.mail-rules-rejected-audit.test.ts" | head -1 | cut -d: -f1)"
expect "H1 finding at file + line of the vi.mock call" "tests/mail-rules.test.ts:$WANT_LINE:db-wrapper:withTenantContext" \
  "$(js "(f=>f.file+':'+f.line+':'+f.reasons[0].reason+':'+f.reasons[0].wrapper)(j.findings.find(f=>f.rule==='mock-of-subject'))")"
expect "H1 report counts agree (count = findings.length)" "$(js 'j.findings.length')" "$(js 'j.count')"

# H2  RED: subjectFiles() returns [hit] without the one-hop re-export targets (barrel api.ts -> invoices.ts).
new_repo; cp "$REAL/quote-before.pipeline-flow-quote-billing.test.ts" "$R/tests/pipeline.test.ts"
change_src lib/crm/invoices.ts; head_commit; run_tf
expect "H2 historical quote test (mocks createInvoice via barrel): exit 1" 1 "$RC"
expect "H2 two mock-of-subject findings (tenant-pool wrapper + api barrel)" 2 "$(fcount mock-of-subject)"
expect "H2 the barrel mock resolves to the changed invoices.ts" "lib/crm/invoices.ts" \
  "$(js "j.findings.find(f=>f.specifier==='@/lib/crm/api').reasons[0].subject")"
WANT_LINE="$(grep -n 'vi.mock("@/lib/crm/api"' "$REAL/quote-before.pipeline-flow-quote-billing.test.ts" | head -1 | cut -d: -f1)"
expect "H2 barrel finding line" "$WANT_LINE" "$(js "j.findings.find(f=>f.specifier==='@/lib/crm/api').line")"

# H3  Corrected real-DB test: exit 0 (the same diff, the same changed invoices.ts).
new_repo; cp "$QUOTE_AFTER" "$R/tests/quote-deal-link.test.ts"
change_src lib/crm/invoices.ts; head_commit; run_tf
expect "H3 corrected quote test (real DB): exit 0" 0 "$RC"
expect "H3 zero findings (count)" 0 "$(js 'j.count')"
expect "H3 the test file was scanned (count)" 1 "$(js 'j.scanned')"

# H4  The corrected claudia test still wraps withTenantContext with a pass-through mock: flagged.
#     Measured, not argued: that is the rule as specified (key equals a db_wrappers entry).
new_repo; cp "$REAL/claudia-after.http-caps-audit.test.ts" "$R/tests/http-caps.test.ts"
change_src lib/claudia/http-cap-audit.ts; head_commit; run_tf
expect "H4 corrected claudia test keeps a withTenantContext mock: exit 1" 1 "$RC"
expect "H4 mock-of-subject count" 1 "$(fcount mock-of-subject)"
expect "H4 ctx.skip() lines are skipped-test findings (count)" "$(grep -c 'ctx.skip()' "$REAL/claudia-after.http-caps-audit.test.ts")" "$(fcount skipped-test)"

# H4b Q21 / SC-005 (Wave 8): flagged until a reviewed disposition records the reason, then exit 0. H4 above is the flagged
#     state; here the same repo gets one disposition per flagged line content (the identical ctx.skip() lines share one).
CL="$REAL/claudia-after.http-caps-audit.test.ts"
MOCKL="$(grep -n 'vi.mock("@/lib/db/tenant-pool"' "$CL" | head -1 | cut -d: -f1)"; SKIPL="$(grep -n 'ctx.skip()' "$CL" | head -1 | cut -d: -f1)"
(cd "$R" && node "$TOOLS" disposition add --kind fidelity --rule mock-of-subject --file tests/http-caps.test.ts --line "$MOCKL" --reason "fixture: pass-through wrapper mock, reproduced from a1-office" --by fx >/dev/null)
run_tf
NSKIP="$(grep -c 'ctx.skip()' "$CL")"
expect "H4b mock disposition alone: the skipped-test findings keep exit 1 (count)" "1|$NSKIP" "$RC|$(fcount skipped-test)"
(cd "$R" && node "$TOOLS" disposition add --kind fidelity --rule skipped-test --file tests/http-caps.test.ts --line "$SKIPL" --reason "fixture: ctx.skip() without a database, reproduced from a1-office" --by fx >/dev/null)
run_tf
expect "H4b both dispositions recorded: corrected claudia test exits 0" 0 "$RC"
expect "H4b zero findings left (count) and all dispositioned (1 mock + every identical skip line)" "0|$((NSKIP + 1))" "$(js 'j.count')|$(js 'j.dispositioned')"

# --------------------------------------------------------------------------------------------
# Mutation proof: planted defect turns the green case red, revert turns it green again (M1)
# --------------------------------------------------------------------------------------------

# M1  RED: skippedTest() body returns [].
new_repo; cp "$QUOTE_AFTER" "$R/tests/q.test.ts"; head_commit; run_tf
expect "M1a clean real test: exit 0" 0 "$RC"
plant "$QUOTE_AFTER" "$R/tests/q.test.ts" skip; head_commit; run_tf
expect "M1b planted it.skip: exit 1" 1 "$RC"
expect "M1b one skipped-test finding (count)" 1 "$(fcount skipped-test)"
WANT_LINE="$(grep -n 'it("A1' "$QUOTE_AFTER" | head -1 | cut -d: -f1)"
expect "M1b finding line = line of the planted it.skip" "tests/q.test.ts:$WANT_LINE" "$(js "j.findings[0].file+':'+j.findings[0].line")"
cp "$QUOTE_AFTER" "$R/tests/q.test.ts"; head_commit; run_tf
expect "M1c revert: exit 0 again" 0 "$RC"

# --------------------------------------------------------------------------------------------
# skipped-test (FR-022)
# --------------------------------------------------------------------------------------------

# S1  RED: SKIP_PATTERNS entry /\b(?:xit|xdescribe|xtest)\b/g removed.
new_repo; plant "$QUOTE_AFTER" "$R/tests/q.test.ts" xit; head_commit; run_tf
expect "S1 xit: exit 1" 1 "$RC"; expect "S1 skipped-test count" 1 "$(fcount skipped-test)"
# S2  RED: the `skip(?:If)?` alternation loses `If`.
new_repo; plant "$QUOTE_AFTER" "$R/tests/q.test.ts" skipif; head_commit; run_tf
expect "S2 it.skipIf: exit 1" 1 "$RC"; expect "S2 skipped-test count" 1 "$(fcount skipped-test)"
# S3  RED: the pytest.mark.skip pattern removed (S3b: the pytest.skip( pattern).
new_repo; mkdir -p "$R/tests"
printf 'import pytest\n\n@pytest.mark.skip(reason="later")\ndef test_a():\n    assert 1 == 1\n\n@pytest.mark.skipif(True, reason="x")\ndef test_b():\n    assert 1 == 1\n' > "$R/tests/test_x.py"
head_commit; run_tf
expect "S3 pytest.mark.skip / skipif: exit 1" 1 "$RC"; expect "S3 skipped-test count" 2 "$(fcount skipped-test)"
new_repo; printf 'import pytest\n\ndef test_a():\n    x = 1\n    if x:\n        pytest.skip("no db")\n' > "$R/tests/test_y.py"; head_commit; run_tf
expect "S3b pytest.skip( call: exit 1" 1 "$RC"; expect "S3b skipped-test count" 1 "$(fcount skipped-test)"
# S4  A skip in an UNTOUCHED test file is not reported (only the diff is scanned). RED: scan all tracked files.
new_repo; printf 'it.skip("old", () => {});\n' > "$R/tests/old.test.ts"; G add -A; G commit -q -m old >/dev/null; G tag -f base >/dev/null
printf 'it("new", () => { expect(1).toBe(1); });\n' > "$R/tests/new.test.ts"; head_commit; run_tf
expect "S4 skip in untouched file ignored: exit 0" 0 "$RC"; expect "S4 scanned count" 1 "$(js 'j.scanned')"

# --------------------------------------------------------------------------------------------
# early-return-guard (FR-023)
# --------------------------------------------------------------------------------------------

# E1  RED: jsLeadingGuard() always returns -1.
new_repo; plant "$QUOTE_AFTER" "$R/tests/q.test.ts" guard; head_commit; run_tf
expect "E1 if (!db) return;: exit 1" 1 "$RC"; expect "E1 early-return-guard count" 1 "$(fcount early-return-guard)"
expect "E1 line is the planted guard (A1 line + 1)" "$((WANT_LINE + 1))" "$(js "j.findings.find(f=>f.rule==='early-return-guard').line")"
# E2  RED: the `{` branch in jsLeadingGuard() removed.
new_repo; plant "$QUOTE_AFTER" "$R/tests/q.test.ts" guardbrace; head_commit; run_tf
expect "E2 if (!db) { return }: exit 1" 1 "$RC"; expect "E2 early-return-guard count" 1 "$(fcount early-return-guard)"
# E3  RED: TEST_CALL_RE loses `each` handling in eachCallOpen().
new_repo; printf 'it.each([1, 2])("n %%i", async (n) => {\n  if (!db) return;\n  expect(n).toBeGreaterThan(0);\n});\n' > "$R/tests/each.test.ts"; head_commit; run_tf
expect "E3 guard inside it.each(...)(name, fn): exit 1" 1 "$RC"; expect "E3 count" 1 "$(fcount early-return-guard)"
# E4  A guard that is not the leading statement, and a positive condition, are not findings.
new_repo; printf 'it("a", () => {\n  const x = setup();\n  if (!x) return;\n  expect(x).toBe(1);\n});\nit("b", () => {\n  if (db) return;\n  expect(1).toBe(1);\n});\nit("c", () => {\n  if (a !== b) return;\n});\n' > "$R/tests/ok.test.ts"
head_commit; run_tf
expect "E4 non-leading / positive guards: exit 0" 0 "$RC"; expect "E4 count" 0 "$(js 'j.count')"
# E5  Python forms (synthetic plants).
new_repo; printf 'def test_a():\n    if not db: return\n    assert 1\n\nasync def test_b(x):\n    """doc"""\n    if not db:\n        return\n    assert 2\n\ndef test_c():\n    pytest.skip("no db")\n' > "$R/tests/test_g.py"
head_commit; run_tf
expect "E5 python guards: exit 1" 1 "$RC"; expect "E5 early-return-guard count (3 forms)" 3 "$(fcount early-return-guard)"

# --------------------------------------------------------------------------------------------
# Strings and comments (FR-024)
# --------------------------------------------------------------------------------------------

# C1  RED: the tokenizer stops blanking comments (maskJs `//` and `/*` branches removed).
new_repo; plant "$QUOTE_AFTER" "$R/tests/q.test.ts" commentmock; change_src lib/audit.ts; head_commit; run_tf
expect "C1 vi.mock only in comments: exit 0" 0 "$RC"; expect "C1 count" 0 "$(js 'j.count')"
# C2  RED: the tokenizer stops blanking string/template content (scanQuoted blank() removed).
new_repo; plant "$QUOTE_AFTER" "$R/tests/q.test.ts" stringmock; change_src lib/audit.ts; head_commit; run_tf
expect "C2 vi.mock only in a string and a template: exit 0" 0 "$RC"; expect "C2 count" 0 "$(js 'j.count')"
# C3  The same text as code yields one finding (relative specifier ../lib/audit -> lib/audit.ts).
new_repo; plant "$QUOTE_AFTER" "$R/tests/q.test.ts" codemock; change_src lib/audit.ts; head_commit; run_tf
expect "C3 same text as code: exit 1" 1 "$RC"; expect "C3 mock-of-subject count" 1 "$(fcount mock-of-subject)"
expect "C3 reason + subject" "changed-subject:lib/audit.ts" "$(js "j.findings[0].reasons[0].reason+':'+j.findings[0].reasons[0].subject")"
# C4  A template expression stays code: vi.mock inside ${...} is found, text around it is not.
new_repo; printf 'const s = `a ${ vi.mock("../lib/audit") } vi.mock("../lib/audit") b`;\n' > "$R/tests/t.test.ts"; change_src lib/audit.ts; head_commit; run_tf
expect "C4 template expression is code: exactly one finding" 1 "$(fcount mock-of-subject)"

# --------------------------------------------------------------------------------------------
# Resolution (FR-020): relative, index, alias, extends, package specifiers, spyOn, db_wrappers
# --------------------------------------------------------------------------------------------

# R1  RED: candidateFile() tries no `index` files.
new_repo; printf 'vi.mock("../lib/audit-dir", () => ({}));\n' > "$R/tests/i.test.ts"; change_src lib/audit-dir/index.ts; head_commit; run_tf
expect "R1 specifier resolves to index.ts: exit 1" 1 "$RC"; expect "R1 count" 1 "$(fcount mock-of-subject)"
# R2  RED: loadAliases() ignores compilerOptions.paths (real tsconfig `@/*`).
new_repo; printf 'vi.mock("@/lib/audit", () => ({}));\n' > "$R/tests/a.test.ts"; change_src lib/audit.ts; head_commit; run_tf
expect "R2 alias @/lib/audit via real tsconfig paths: exit 1" 1 "$RC"; expect "R2 count" 1 "$(fcount mock-of-subject)"
# R3  RED: resolveSpecifier() resolves non-relative specifiers by trying them as paths (package leak).
new_repo; mkdir -p "$R/next"; printf 'export const NextRequest = 1;\n' > "$R/next/server.ts"
printf 'vi.mock("next/server", () => ({ NextResponse: {} }));\nvi.mock("vitest", () => ({}));\n' > "$R/tests/p.test.ts"
change_src next/server.ts; head_commit; run_tf
expect "R3 package specifier next/server never matches a changed file: exit 0" 0 "$RC"; expect "R3 count" 0 "$(js 'j.count')"
# R4  RED: a changed file that is NOT the mocked module triggers a finding (subject test too loose).
new_repo; printf 'vi.mock("../lib/audit", () => ({}));\n' > "$R/tests/u.test.ts"; change_src lib/crm/invoices.ts; head_commit; run_tf
expect "R4 mocked module unchanged in the diff: exit 0" 0 "$RC"; expect "R4 count" 0 "$(js 'j.count')"
# R5  RED: loadAliases() does not follow `extends` one level.
new_repo; rm "$R/tsconfig.json"; printf '{\n  // jsonc\n  "extends": "./tsconfig.base.json",\n}\n' > "$R/tsconfig.json"
printf '{"compilerOptions": {"paths": {"@lib/*": ["./lib/*"],},},}\n' > "$R/tsconfig.base.json"
printf 'vi.mock("@lib/audit", () => ({}));\n' > "$R/tests/e.test.ts"; change_src lib/audit.ts; head_commit; run_tf
expect "R5 alias from an extended tsconfig (JSONC): exit 1" 1 "$RC"; expect "R5 count" 1 "$(fcount mock-of-subject)"
# R6  RED: spyOn target resolution via import bindings removed (importBindings()).
new_repo; printf 'import * as audit from "../lib/audit";\nvi.spyOn(audit, "write");\nvi.spyOn(console, "log");\n' > "$R/tests/s.test.ts"; change_src lib/audit.ts; head_commit; run_tf
expect "R6 spyOn on a changed module namespace: exit 1" 1 "$RC"; expect "R6 count (console spy is clean)" 1 "$(fcount mock-of-subject)"
# R7  RED: the spyOn method name is not compared with db_wrappers.
new_repo; printf 'vi.spyOn(repo, "withTenantContext");\njest.spyOn(repo, "other");\n' > "$R/tests/w.test.ts"; head_commit; run_tf
expect "R7 spyOn of a db wrapper method: exit 1" 1 "$RC"; expect "R7 count" 1 "$(fcount mock-of-subject)"
# R8  RED: DEFAULT_DB_WRAPPERS ignored for a quoted factory key / .a1/fidelity.json db_wrappers not read.
new_repo; printf 'vi.mock("../lib/other", () => ({ "pool": {}, ok: 1 }));\n' > "$R/tests/k.test.ts"; head_commit; run_tf
expect "R8a quoted factory key pool (default list): exit 1" 1 "$RC"
new_repo; mkdir -p "$R/.a1"; printf '{"db_wrappers": ["createInvoice"]}\n' > "$R/.a1/fidelity.json"
printf 'vi.mock("../lib/other", () => ({ createInvoice: vi.fn() }));\nvi.mock("../lib/o2", () => ({ withTenantContext: vi.fn() }));\n' > "$R/tests/k.test.ts"; head_commit; run_tf
expect "R8b custom db_wrappers replaces the default list: one finding" 1 "$(fcount mock-of-subject)"
expect "R8b the finding is createInvoice" "createInvoice" "$(js "j.findings[0].reasons[0].wrapper")"
# R9  Nested keys of a mock factory are not wrapper keys (RED: objectKeys() ignores depth).
new_repo; printf 'vi.mock("../lib/other", () => ({ get: vi.fn(() => ({ query: 1, db: 2 })) }));\n' > "$R/tests/n.test.ts"; head_commit; run_tf
expect "R9 nested query/db keys are not flagged: exit 0" 0 "$RC"

# --------------------------------------------------------------------------------------------
# Test-file detection, test_globs, names (spaces, newline), symlinks
# --------------------------------------------------------------------------------------------

# T1  RED: isTestFile() ignores extraGlobs.
new_repo; mkdir -p "$R/checks"; printf 'it.skip("x", () => {});\n' > "$R/checks/a.sh"; head_commit; run_tf
expect "T1a file outside the default globs is not scanned: exit 0" 0 "$RC"
new_repo; mkdir -p "$R/checks" "$R/.a1"; printf 'it.skip("x", () => {});\n' > "$R/checks/a.sh"; printf '{"test_globs": ["checks/*.sh"]}\n' > "$R/.a1/fidelity.json"; head_commit; run_tf
expect "T1b test_globs picks it up (test-not-in-ci only, a .sh gets no JS rules): exit 1" "test-not-in-ci:checks/a.sh" "$(js "j.findings.map(f=>f.rule+':'+f.file).join('|')")"
# T5  RED: scanFile() lexes every test_globs file as JS. A bash suite with it.skip text in a heredoc gets no skipped-test;
#     the same text in a .test.ts does.
new_repo; mkdir -p "$R/_test-fixtures/x" "$R/.a1"; printf '{"test_globs":["_test-fixtures/*/run*.sh"],"ci_globs":["_test-fixtures/*/run*.sh"]}\n' > "$R/.a1/fidelity.json"
wf_t5='name: t\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: for r in _test-fixtures/*/run*.sh; do bash "$r"; done\n      - run: npm test\n'
printf "$wf_t5" > "$R/.github/workflows/ci.yml"; G add -A; G commit -q -m t5 >/dev/null; G tag -f base >/dev/null
printf '#!/usr/bin/env bash\ncat <<EOT\nit.skip("x", () => {});\nif (!db) return;\nvi.mock("../lib/audit", () => ({ pool: 1 }));\nEOT\n' > "$R/_test-fixtures/x/run-tests.sh"; head_commit; run_tf
expect "T5a bash suite with it.skip text in a heredoc: exit 0" 0 "$RC"; expect "T5a scanned (count)" 1 "$(js 'j.scanned')"; expect "T5a findings (count)" 0 "$(js 'j.count')"
printf 'it.skip("x", () => {});\n' > "$R/tests/h.test.ts"; head_commit; run_tf
expect "T5b the same text in a .test.ts: one skipped-test" 1 "$(fcount skipped-test)"
# T2  RED: changedFiles() parses git output split on newlines instead of NUL.
new_repo; mkdir -p "$R/my tests"
printf 'it.skip("x", () => {});\n' > "$R/my tests/a b.test.ts"
printf 'it.skip("y", () => {});\n' > "$R/tests/nl"$'\n'"name.test.ts"
head_commit; run_tf
expect "T2 names with a space and with a newline: exit 1" 1 "$RC"; expect "T2 two findings (count)" 2 "$(fcount skipped-test)"
expect "T2 file names come back exact" "my tests/a b.test.ts|tests/nl"$'\n'"name.test.ts" "$(js "j.findings.map(f=>f.file).sort().join('|')")"
# T3  RED: readSource() follows symlinks.
new_repo; printf 'it.skip("x", () => {});\n' > "$R/lib/target.txt"; ln -s ../lib/target.txt "$R/tests/link.test.ts"; head_commit; run_tf
expect "T3 symlinked test file is not followed: exit 0" 0 "$RC"
# T4  A deleted test is not scanned and not an error.
new_repo; printf 'it.skip("x", () => {});\n' > "$R/tests/gone.test.ts"; G add -A; G commit -q -m old >/dev/null; G tag -f base >/dev/null
G rm -q tests/gone.test.ts; printf '// c\n' >> "$R/lib/audit.ts"; head_commit; run_tf
expect "T4 deleted test file: exit 0" 0 "$RC"

# --------------------------------------------------------------------------------------------
# Contract: exit 2 on usage, git failure, bad config (FR-019)
# --------------------------------------------------------------------------------------------

# U1  RED: a missing --diff-base is treated as "main".
new_repo; head_commit 2>/dev/null
OUT="$(cd "$R" && node "$TOOLS" test-fidelity --phase fx-w4 2>/dev/null)"; RC=$?
expect "U1a no --diff-base: exit 2" 2 "$RC"; expect "U1a no stdout" "" "$OUT"
OUT="$(cd "$R" && node "$TOOLS" test-fidelity --phase fx-w4 --diff-base base stray 2>/dev/null)"; RC=$?
expect "U1b stray argument: exit 2" 2 "$RC"
OUT="$(cd "$R" && node "$TOOLS" test-fidelity --phase fx-w4 --diff-base nosuchref 2>/dev/null)"; RC=$?
expect "U1c unknown ref (git failure): exit 2" 2 "$RC"
OUT="$(cd "$WORK" && node "$TOOLS" test-fidelity --phase fx-w4 --diff-base base --project "$WORK/not-a-repo" 2>/dev/null)"; RC=$?
expect "U1d project is not a git repo: exit 2" 2 "$RC"
OUT="$(cd "$R" && node "$TOOLS" test-fidelity --phase fx-w4 --diff-base --output=x 2>/dev/null)"; RC=$?
expect "U1e ref starting with '-': exit 2" 2 "$RC"
# U2  RED: loadConfig() swallows a malformed .a1/fidelity.json / readJsonc() swallows a bad tsconfig.
new_repo; mkdir -p "$R/.a1"; printf '{not json' > "$R/.a1/fidelity.json"; head_commit; run_tf
expect "U2a malformed .a1/fidelity.json: exit 2" 2 "$RC"
new_repo; mkdir -p "$R/.a1"; printf '{"db_wrappers": "pool"}\n' > "$R/.a1/fidelity.json"; head_commit; run_tf
expect "U2b db_wrappers not an array: exit 2" 2 "$RC"
new_repo; printf '{ "compilerOptions": { "paths": ' > "$R/tsconfig.json"; head_commit; run_tf
expect "U2c malformed tsconfig.json: exit 2" 2 "$RC"
new_repo; printf '{ "extends": "./missing.json" }\n' > "$R/tsconfig.json"; head_commit; run_tf
expect "U2d tsconfig extends a missing file: exit 2" 2 "$RC"
# U3  --project selects the repo (RED: --project ignored).
new_repo; plant "$QUOTE_AFTER" "$R/tests/q.test.ts" skip; head_commit
OUT="$(cd "$WORK" && node "$TOOLS" test-fidelity --phase fx-w4 --diff-base base --project "$R" 2>/dev/null)"; RC=$?
expect "U3 --project from another cwd: exit 1" 1 "$RC"; expect "U3 count" 1 "$(js 'j.count')"
# U4  Gate-log line carries the real exit code (the facade hook wraps the command).
run_tf
LOGLINE="$(tail -n 1 "$R/.a1/phases/fx-w4/gate-log.jsonl" 2>/dev/null)"
case "$LOGLINE" in *'"gate":"test-fidelity"'*'"exit":1'*) ok "U4 gate log records test-fidelity with exit 1";; *) bad "U4 gate log line: $LOGLINE";; esac

# --------------------------------------------------------------------------------------------
# Hostile input (CONVENTIONS: injection, oversized, catastrophic patterns)
# --------------------------------------------------------------------------------------------

# X1  Injection-shaped ref is inert (RED: the ref goes through a shell).
new_repo; head_commit 2>/dev/null; SENT="$WORK/pwned"
OUT="$(cd "$R" && node "$TOOLS" test-fidelity --phase fx-w4 --diff-base "base; touch $SENT" 2>/dev/null)"; RC=$?
expect "X1a ';' in the ref: exit 2" 2 "$RC"; [[ ! -e "$SENT" ]] && ok "X1a no command ran" || bad "X1a sentinel created"
OUT="$(cd "$R" && node "$TOOLS" test-fidelity --phase fx-w4 --diff-base "\$(touch $SENT)" 2>/dev/null)"; RC=$?
expect "X1b \$(...) in the ref: exit 2" 2 "$RC"; [[ ! -e "$SENT" ]] && ok "X1b no command ran" || bad "X1b sentinel created"
# X2  Oversized / catastrophic inputs finish quickly and give a defined outcome.
new_repo
node -e 'const n=200000; process.stdout.write("vi.mock(" + "(".repeat(n) + "\n" + "a*".repeat(n) + "/".repeat(n) + "\"" + "x".repeat(n) + "\n`${".repeat(10) + "\n")' > "$R/tests/big.test.ts"
head_commit; START=$SECONDS; run_tf; ELAPSED=$((SECONDS - START))
expect "X2a 1 MB of unbalanced parens / slashes / quotes: defined outcome (exit 0)" 0 "$RC"
[[ $ELAPSED -lt 20 ]] && ok "X2a finished in ${ELAPSED}s (< 20s)" || bad "X2a took ${ELAPSED}s"
new_repo
node -e 'process.stdout.write("vi    ".repeat(60000) + "\n" + "it(".repeat(30000) + "\n")' > "$R/tests/ws.test.ts"
head_commit; START=$SECONDS; run_tf; ELAPSED=$((SECONDS - START))
expect "X2b 'vi    ' x 60000 and 'it(' x 30000: exit 0" 0 "$RC"
[[ $ELAPSED -lt 20 ]] && ok "X2b finished in ${ELAPSED}s (< 20s)" || bad "X2b took ${ELAPSED}s"
# X3  RED: MAX_NESTING check removed (stack grows unbounded).
new_repo; node -e 'process.stdout.write("`${".repeat(8000) + "\n")' > "$R/tests/deep.test.ts"; head_commit; run_tf
expect "X3 template nesting beyond the cap: exit 2" 2 "$RC"
case "$ERR" in *"nesting too deep"*) ok "X3 stderr names the cause";; *) bad "X3 stderr: $ERR";; esac
# X4  RED: MAX_FILE_BYTES check removed.
new_repo; node -e 'process.stdout.write("// " + "x".repeat(3 * 1024 * 1024) + "\n")' > "$R/tests/huge.test.ts"; head_commit; run_tf
expect "X4 3 MB test file: exit 2" 2 "$RC"
# X5  Unterminated string / template / comment and NUL bytes do not crash.
new_repo; printf 'const a = "never closed\nconst b = `never closed\n/* never closed' > "$R/tests/u1.test.ts"
printf 'it.skip("a\0b", () => {});\n\0\0\0' > "$R/tests/u2.test.ts"; head_commit; run_tf
expect "X5 unterminated literals + NUL bytes: defined outcome (the skip is found)" 1 "$RC"; expect "X5 count" 1 "$(fcount skipped-test)"
# X6  A regex literal containing quotes and slashes is blanked, not mis-lexed into the rest of the file.
new_repo; printf 'const re = /[`"\x27]vi.mock/g;\nvi.mock("../lib/audit", () => ({}));\n' > "$R/tests/re.test.ts"; change_src lib/audit.ts; head_commit; run_tf
expect "X6 code after a regex literal is still scanned: exit 1" 1 "$RC"; expect "X6 count" 1 "$(fcount mock-of-subject)"
expect "X6 on line 2" 2 "$(js 'j.findings[0].line')"

# --------------------------------------------------------------------------------------------
# test-not-in-ci (FR-021, Wave 7). Inputs: real workflow/config copies in ci/ (ci/ORIGIN.md).
# --------------------------------------------------------------------------------------------
CI="$REPO_ROOT/_test-fixtures/a1-test-fidelity/ci"

# ci_base [workflow-file]: replace the default CI of new_repo; re-tag base.
ci_base() {
  rm -rf "${R:?}/.github"; mkdir -p "$R/.github/workflows"
  [[ -n "${1:-}" ]] && cp "$1" "$R/.github/workflows/ci.yml"
  G add -A; G commit -q -m ci >/dev/null; G tag -f base >/dev/null
}
# wf <yaml lines...>: write a one-job workflow whose steps are the given lines
wf() { { printf 'name: t\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n'; printf '%s\n' "$@"; } > "$R/.github/workflows/ci.yml"; }
put() { mkdir -p "$R/$(dirname "$1")"; printf '%s\n' "${2:-it(\"a\", () => { expect(1).toBe(1); });}" > "$R/$1"; }
rules_of() { js "j.findings.map(f=>f.rule+':'+f.file).sort().join('|')"; }

# CI1  RED: scan() ignores ci_globs (findings for _test-fixtures/x/run-tests.sh), real specforge workflow + config.
new_repo; mkdir -p "$R/.a1"; cp "$CI/specforge-fidelity.json" "$R/.a1/fidelity.json"; ci_base "$CI/specforge-test.yml"
put _test-fixtures/x/run-tests.sh 'echo ok'; head_commit; run_tf
expect "CI1a suite matched by the declared ci_glob (real test.yml): exit 0" 0 "$RC"
expect "CI1a zero findings (count)" 0 "$(js 'j.count')"; expect "CI1a scanned (count)" 1 "$(js 'j.scanned')"
printf '{"test_globs":["_test-fixtures/**/*.sh"],"ci_globs":["_test-fixtures/*/run*.sh"]}\n' > "$R/.a1/fidelity.json"
put _test-fixtures/x/parts/01.sh 'echo part'; head_commit; run_tf
expect "CI1b a declared test glob no ci_glob reaches: exit 1" 1 "$RC"
expect "CI1b exactly test-not-in-ci for that file" "test-not-in-ci:_test-fixtures/x/parts/01.sh" "$(rules_of)"

# CI2  RED: the literal check of ci_globs removed (every declared glob counts as verified).
new_repo; mkdir -p "$R/.a1"; printf '{"test_globs":["_test-fixtures/**/*.sh"],"ci_globs":["_test-fixtures/*/zzz*.sh"]}\n' > "$R/.a1/fidelity.json"; ci_base "$CI/specforge-test.yml"
put _test-fixtures/x/zzz-tests.sh 'echo ok'; head_commit; run_tf
expect "CI2a declared glob absent from the workflow: exit 1" 1 "$RC"
expect "CI2a ci_glob_not_in_workflow once + the unmatched test" "ci_glob_not_in_workflow:.a1/fidelity.json|test-not-in-ci:_test-fixtures/x/zzz-tests.sh" "$(rules_of)"
# CI2b the glob is verified LITERALLY: an equivalent but differently written glob does not count.
new_repo; mkdir -p "$R/.a1"; cp "$CI/specforge-fidelity.json" "$R/.a1/fidelity.json"; ci_base "$CI/specforge-test.yml"
node -e 'const fs=require("fs");const p=process.argv[1];const s=fs.readFileSync(p,"utf8");const t=s.replace("_test-fixtures/*/run*.sh","_test-fixtures/*/run-all.sh");if(t===s)process.exit(3);fs.writeFileSync(p,t)' "$R/.github/workflows/ci.yml"
G add -A; G commit -q -m ci2 >/dev/null; G tag -f base >/dev/null
put _test-fixtures/x/run-tests.sh 'echo ok'; head_commit; run_tf
expect "CI2b workflow no longer holds the glob literally: exit 1" 1 "$RC"
expect "CI2b findings (count)" 2 "$(js 'j.count')"

# CI3  RED: no-workflows branch returns [] (and the ci:none path).
new_repo; ci_base; put tests/a.test.ts; put tests/b.test.ts; head_commit; run_tf
expect "CI3a no .github/workflows: exit 1" 1 "$RC"
expect "CI3a a single no_ci_config, not one per test" "no_ci_config" "$(js "j.findings.map(f=>f.rule).join('|')")"
new_repo; ci_base; mkdir -p "$R/.a1"; printf '{"ci":"none","ci_reason":"library without CI, tests run by the maintainer"}\n' > "$R/.a1/fidelity.json"; put tests/a.test.ts; head_commit; run_tf
expect "CI3b ci: none with a reason: exit 0" 0 "$RC"
new_repo; ci_base; mkdir -p "$R/.a1"; printf '{"ci":"none"}\n' > "$R/.a1/fidelity.json"; put tests/a.test.ts; head_commit; run_tf
expect "CI3c ci: none without a reason: no_ci_config" "no_ci_config" "$(js "j.findings.map(f=>f.rule).join('|')")"
new_repo; ci_base; put README2.md 'x'; head_commit; run_tf
expect "CI3d no CI and no test file in the diff: exit 0" 0 "$RC"

# CI4  RED: exclude of the real a1-office vitest config ignored. Real config + real package.json + `npm test`.
new_repo; ci_base; cp "$CI/office-vitest.config.ts" "$R/vitest.config.ts"; cp "$CI/office-package.json" "$R/package.json"; wf '      - run: npm test'
G add -A; G commit -q -m cfg >/dev/null; G tag -f base >/dev/null
put tests/unit/a.test.ts; put tests/e2e/x.spec.ts; put tests/integration/ok.test.ts; head_commit; run_tf
expect "CI4 e2e spec excluded by the config: exit 1" 1 "$RC"
expect "CI4 only the e2e spec is test-not-in-ci" "test-not-in-ci:tests/e2e/x.spec.ts" "$(rules_of)"

# CI5  RED: positional filters of the vitest call ignored. Real a1-office ci.yml (filters + $(grep ...)).
new_repo; ci_base "$CI/office-ci.yml"; cp "$CI/office-vitest.config.ts" "$R/vitest.config.ts"; cp "$CI/office-package.json" "$R/package.json"
G add -A; G commit -q -m cfg >/dev/null; G tag -f base >/dev/null
put tests/unit/a.test.ts; head_commit; run_tf
expect "CI5a file under a literal filter of the real unit job: exit 0" 0 "$RC"
put tests/billing/z.test.ts; head_commit; run_tf
expect "CI5b file reached only through the dynamic filter list: unresolved" "unresolved_ci_match:tests/billing/z.test.ts" "$(rules_of)"

# CI6  RED: unresolved reasons ignored (an unknown script reports test-not-in-ci instead).
new_repo; ci_base; wf '      - run: npm run nosuch'; put tests/a.test.ts; head_commit; run_tf
expect "CI6a workflow runs a script package.json lacks: unresolved_ci_match" "unresolved_ci_match:tests/a.test.ts" "$(rules_of)"
new_repo; ci_base; wf '      - run: make check'; put tests/a.test.ts; head_commit; run_tf
expect "CI6b workflow runs make: unresolved_ci_match" 1 "$(fcount unresolved_ci_match)"
new_repo; ci_base; wf '      - run: pnpm -r test'; put tests/a.test.ts; head_commit; run_tf
expect "CI6c workspace-wide run: unresolved_ci_match" 1 "$(fcount unresolved_ci_match)"
new_repo; ci_base; wf '      - run: echo hello'; put tests/a.test.ts; head_commit; run_tf
expect "CI6d workflow with no test command at all: test-not-in-ci" "test-not-in-ci:tests/a.test.ts" "$(rules_of)"

# CI7  Script chains: workflow -> npm test -> npm run unit -> vitest with a filter. RED: followScript() does not recurse.
new_repo; ci_base; wf '      - run: npm test'
printf '{"scripts":{"test":"npm run unit && npm run lint","unit":"vitest run src","lint":"eslint ."}}\n' > "$R/package.json"
put src/in.test.ts; put other/out.test.ts; head_commit; run_tf
expect "CI7 test under the chained filter is in CI, the other is not" "test-not-in-ci:other/out.test.ts" "$(rules_of)"
new_repo; ci_base; wf '      - run: npm run loop-a'; printf '{"scripts":{"loop-a":"npm run loop-b","loop-b":"npm run loop-a"}}\n' > "$R/package.json"; put tests/a.test.ts; head_commit; run_tf
expect "CI7b script cycle terminates: test-not-in-ci" "test-not-in-ci:tests/a.test.ts" "$(rules_of)"

# CI8  pytest: real pyproject.toml (testpaths = ["tests"]). RED: pytestMatcher() ignores testpaths.
new_repo; ci_base; cp "$CI/smart-home-pyproject.toml" "$R/pyproject.toml"; wf '      - run: python -m pytest -q'
put tests/test_a.py 'def test_a():
    assert 1'; put other/test_b.py 'def test_b():
    assert 1'; put tests/helper.py 'x = 1'; head_commit; run_tf
expect "CI8 only the test outside testpaths is flagged (helper.py is no test file)" "test-not-in-ci:other/test_b.py" "$(rules_of)"
new_repo; ci_base; wf '      - run: pytest other'; put tests/test_a.py 'def test_a():
    assert 1'; put other/test_b.py 'def test_b():
    assert 1'; head_commit; run_tf
expect "CI8b positional path overrides testpaths" "test-not-in-ci:tests/test_a.py" "$(rules_of)"

# CI9  Monorepo, two packages with their own vitest config: working-directory and `cd`. RED: cwd tracking dropped.
new_repo; ci_base
mkdir -p "$R/packages/a" "$R/packages/b"
printf 'export default { test: { include: ["src/**/*.test.ts"] } };\n' > "$R/packages/a/vitest.config.ts"
printf 'export default { test: { include: ["spec/**/*.test.ts"] } };\n' > "$R/packages/b/vitest.config.ts"
wf '      - run: npx vitest run' '        working-directory: packages/a' '      - run: |' '          cd packages/b' '          npx vitest run'
G add -A; G commit -q -m mono >/dev/null; G tag -f base >/dev/null
put packages/a/src/x.test.ts; put packages/a/spec/y.test.ts; put packages/b/spec/z.test.ts; put packages/b/src/w.test.ts; head_commit; run_tf
expect "CI9 each file is judged by the config of its own package" "test-not-in-ci:packages/a/spec/y.test.ts|test-not-in-ci:packages/b/src/w.test.ts" "$(rules_of)"

# CI10  jest: package.json "jest".testMatch found by walking up from the call dir. RED: package.json jest key ignored.
new_repo; ci_base; wf '      - run: npx jest'; printf '{"jest":{"testMatch":["**/tests/**/*.test.js"]}}\n' > "$R/package.json"
put tests/a.test.js; put src/b.test.js; head_commit; run_tf
expect "CI10 jest testMatch decides" "test-not-in-ci:src/b.test.js" "$(rules_of)"
new_repo; ci_base; wf '      - run: npx jest'; printf 'module.exports = { testRegex: "x" };\n' > "$R/jest.config.js"; put tests/a.test.js; head_commit; run_tf
expect "CI10b testRegex cannot be read statically: unresolved_ci_match" "unresolved_ci_match:tests/a.test.js" "$(rules_of)"

# CI11  YAML reader: comments, other keys' block scalars and quoted values. RED: block scalar skipping removed.
new_repo; ci_base
{ printf 'name: t\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n'
  printf '      # - run: vitest run\n'
  printf '      - name: note\n        env:\n          NOTE: x\n        description: |\n          run: vitest run\n'
  printf '      - run: "echo quoted"\n'; } > "$R/.github/workflows/ci.yml"
put tests/a.test.ts; head_commit; run_tf
expect "CI11a run: inside a comment / another block scalar is no command" "test-not-in-ci:tests/a.test.ts" "$(rules_of)"
new_repo; ci_base; wf '      - run: >-' '          npx vitest' '          run'; put tests/a.test.ts; head_commit; run_tf
expect "CI11b folded block scalar run line is read" 0 "$RC"
new_repo; ci_base; wf "      - run: 'npx vitest run'  # trailing comment"; put tests/a.test.ts; head_commit; run_tf
expect "CI11c quoted run value with trailing comment" 0 "$RC"

# CI12  Hostile / bad input: exit 2 and a defined outcome.
new_repo; ci_base; wf '      - run: npm test'; printf '{not json' > "$R/package.json"; put tests/a.test.ts; head_commit; run_tf
expect "CI12a malformed package.json reached by the workflow: exit 2" 2 "$RC"
new_repo; ci_base; mkdir -p "$R/.a1"; printf '{"ci_globs":"x"}\n' > "$R/.a1/fidelity.json"; put tests/a.test.ts; head_commit; run_tf
expect "CI12b ci_globs not an array: exit 2" 2 "$RC"
new_repo; ci_base; node -e 'process.stdout.write("name: t\n# " + "x".repeat(2 * 1024 * 1024) + "\n")' > "$R/.github/workflows/ci.yml"; put tests/a.test.ts; head_commit; run_tf
expect "CI12c 2 MB workflow file: exit 2" 2 "$RC"
new_repo; ci_base; node -e 'process.stdout.write("steps:\n" + "  - run: |\n".repeat(20000) + "      cd " + "../".repeat(5000) + "\n      vitest " + "$(".repeat(30000) + "\n")' > "$R/.github/workflows/ci.yml"
put tests/a.test.ts; head_commit; START=$SECONDS; run_tf
expect "CI12d hostile workflow (20000 steps, deep ../, unbalanced \$( ): defined outcome (exit 1)" 1 "$RC"
[[ $((SECONDS - START)) -lt 20 ]] && ok "CI12d finished in $((SECONDS - START))s (< 20s)" || bad "CI12d too slow"
new_repo; ci_base; wf '      - run: npx vitest run --config ../../etc/vitest.config.ts' '      - run: cd "$X" && npx vitest run'; put tests/a.test.ts; head_commit; run_tf
expect "CI12e config path outside the repo / dynamic cd: fail closed" "unresolved_ci_match:tests/a.test.ts" "$(rules_of)"

echo "a1-test-fidelity: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
