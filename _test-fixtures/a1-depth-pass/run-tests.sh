#!/usr/bin/env bash
# Fixture: `plan depth-check` (spec 019-depth-pass-planning, Wave 1 core cases).
#
# Input data: fixtures/complete.md is a verbatim copy of the real `## Depth Pass`
# section of the 019 wave plan (not a hand-written template). Every variant below
# is derived from that real file by a small node transform, so the expectation
# cannot drift away from real plan text. This suite must NOT embed the prompt
# text of _shared/depth-pass.md (FR-003: exactly one markdown hit repo-wide).
#
# RED proof: each guard case header names the single production-code change in
# _shared/lib/depth-pass.cjs that turns it red, and records "Measured red <date>"
# once the mutation was run on a `git archive` snapshot (never the shared worktree).
#
# ## RED proof (case -> named mutation; results are in the case headers)
# | case | mutation in _shared/lib/depth-pass.cjs |
# |------|-----------------------------------------|
# | D2   | findSection(): heading test matches any `##` heading |
# | D2c  | checkSubsections(): delete the missing-sub-heading findings.push |
# | D3   | isPlaceholder(): remove the `<...>` template-token test |
# | D4   | isPlaceholder(): remove the `tbd` test |
# | D5   | isPlaceholder(): remove the empty-body test |
# | D6   | isSelfReferential(): ignore the denylist/stopword set |
# | D9   | tagFences(): never mark lines as fenced |
# | D10  | findSection(): take the last `## Depth Pass` instead of the first |
# | D12  | cmdPlanDepthCheck(): empty text exits 2 |
# | D14  | ORACLE_STOPWORDS: add one word without touching the doc |
# | D16  | readPlan(): delete the `..` segment check |
# | D17  | readPlan(): delete the isFile check (and let read errors fall through) |
# | D18  | readPlan(): raise MAX_PLAN_BYTES to 1 GiB |
# | D19  | cmdPlanDepthCheck(): execSync over the plan text |
# | D20  | cmdPlanDepthCheck(): execSync over the --plan argument |
# | D21  | checkDepthPass(): Atomics.wait(length / 5 ms) |

set -u
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
LIB="$REPO_ROOT/_shared/lib/depth-pass.cjs"
DOC="$REPO_ROOT/_shared/depth-pass.md"
COMPLETE="$REPO_ROOT/_test-fixtures/a1-depth-pass/fixtures/complete.md"

unset A1_VAULT_ROOT

pass=0
fail=0

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

assert_rc() {
  local name="$1" expected="$2" actual="$3" out="$4"
  if [[ "$actual" -ne "$expected" ]]; then
    echo "FAIL  $name: expected exit $expected, got $actual"
    echo "----- output -----"; echo "$out"; echo "------------------"
    fail=$((fail + 1))
  else
    echo "PASS  $name (exit $actual)"
    pass=$((pass + 1))
  fi
}

# assert_json <name> <file-with-json> <js-expression over `r`> — expression must be truthy.
assert_json() {
  local name="$1" file="$2" expr="$3"
  if node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.exit(($expr)?0:1)" "$file" 2>/dev/null; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "FAIL  $name: json assertion false: $expr"
    echo "----- output -----"; cat "$file"; echo "------------------"
    fail=$((fail + 1))
  fi
}

# run_check <plan-file> -> sets RC and writes stdout to $WORK/out.json, stderr to $WORK/err.txt
run_check() {
  RC=0
  node "$TOOLS" plan depth-check --plan "$1" >"$WORK/out.json" 2>"$WORK/err.txt" || RC=$?
}

# rewrite_body <in> <out> <heading-prefix> <new body> — replace the body of one ### sub-heading.
rewrite_body() {
  node -e '
    const fs = require("fs");
    const [inp, outp, prefix, body] = process.argv.slice(1);
    const lines = fs.readFileSync(inp, "utf8").split("\n");
    const out = [];
    let skipping = false;
    for (const l of lines) {
      if (/^#{2,3}\s/.test(l)) {
        skipping = false;
        out.push(l);
        if (l.startsWith(prefix)) { out.push("", body, ""); skipping = true; }
        continue;
      }
      if (!skipping) out.push(l);
    }
    fs.writeFileSync(outp, out.join("\n"));
  ' "$@"
}

H1='### 1 What a top professional would do'
H2='### 2 Rawest material'
H4='### 4 External evidence of correctness'

# ---------------------------------------------------------------- exit 0 cases

# D1 complete real section -> 0.
run_check "$COMPLETE"
assert_rc "D1 complete real section" 0 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
assert_json "D1b report is pass with no offending" "$WORK/out.json" 'r.verdict==="pass" && Array.isArray(r.checks) && r.offending.length===0'

# D7 "Claude plus the test suite" -> `test`, `suite` survive tokenising -> 0 (FR-010 example).
rewrite_body "$COMPLETE" "$WORK/plus.md" "$H4" "Claude plus the test suite"
run_check "$WORK/plus.md"
assert_rc "D7 'Claude plus the test suite' passes" 0 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"

# D8 heading numbering / case variants -> 0 (FR-009).
node -e '
  const fs = require("fs");
  const t = fs.readFileSync(process.argv[1], "utf8");
  const v = {
    dot: t.replace(/^### (\d) /gm, "### $1. "),
    paren: t.replace(/^### (\d) /gm, "### $1) "),
    nonum: t.replace(/^### \d /gm, "### "),
    upper: t.replace(/^## Depth Pass/m, "## DEPTH PASS").replace(/^### 4 External evidence of correctness/m, "### 4 EXTERNAL Evidence Of Correctness"),
    lower: t.replace(/^## Depth Pass/m, "## depth pass").replace(/^### Rewritten brief/m, "### rewritten BRIEF"),
  };
  for (const [k, s] of Object.entries(v)) fs.writeFileSync(process.argv[2] + "/num-" + k + ".md", s);
' "$COMPLETE" "$WORK"
for k in dot paren nonum upper lower; do
  run_check "$WORK/num-$k.md"
  assert_rc "D8 heading variant '$k'" 0 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
done

# D11 CRLF line endings plus a UTF-8 BOM parse like LF -> 0.
node -e '
  const fs = require("fs");
  const t = fs.readFileSync(process.argv[1], "utf8").replace(/\n/g, "\r\n");
  fs.writeFileSync(process.argv[2], "﻿" + t);
' "$COMPLETE" "$WORK/crlf-bom.md"
run_check "$WORK/crlf-bom.md"
assert_rc "D11 CRLF + BOM" 0 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"

# D10b duplicate heading, first section complete, second a placeholder -> first wins -> 0, duplicate reported.
{ cat "$COMPLETE"; echo; echo "## Depth Pass"; echo; echo "### 1 What a top professional would do"; echo "TBD"; } > "$WORK/dup-first-ok.md"
run_check "$WORK/dup-first-ok.md"
assert_rc "D10b duplicate heading uses the first (complete) section" 0 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
assert_json "D10c duplicate is reported" "$WORK/out.json" 'r.duplicate_sections===1'

# ---------------------------------------------------------------- exit 1 cases

# D2 missing section.
# RED: in findSection(), make the heading regex match any `##` heading (or return the whole text), so the section is "found".
# Measured red 2026-10-19: findSection() heading test matches any `##` -> D2 FAIL (also D2b, D19c)
sed 's/^## Depth Pass/## Depth Notes/' "$COMPLETE" > "$WORK/missing.md"
run_check "$WORK/missing.md"
assert_rc "D2 missing section" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
assert_json "D2b report names the missing section" "$WORK/out.json" 'r.verdict==="fail" && r.offending.includes("## Depth Pass")'

# D2c one sub-heading missing (heading 3 renamed).
# RED: in checkSubsections(), delete the `findings.push(finding('subheadings', ...))` line (a missing sub-heading is no longer reported).
# Measured red 2026-10-19: checkSubsections() missing-sub-heading push deleted -> D2c FAIL (also D2d)
sed 's/^### 3 Methods and tools/### 3 Something else/' "$COMPLETE" > "$WORK/missing-sub.md"
run_check "$WORK/missing-sub.md"
assert_rc "D2c missing sub-heading 3" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
assert_json "D2d report names sub-heading 3" "$WORK/out.json" 'r.offending.some(o=>/methods and tools/i.test(o))'

# D3 placeholder <…> (Unicode ellipsis) and <...> (ASCII).
# RED: in isPlaceholder(), remove the `<…>` template-token regex.
# Measured red 2026-10-19: isPlaceholder() `<...>` test returns false -> D3 FAIL (also D3b, D3c)
rewrite_body "$COMPLETE" "$WORK/ph1.md" "$H2" '<…>'
run_check "$WORK/ph1.md"
assert_rc "D3 placeholder <…>" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
assert_json "D3b report names sub-heading 2" "$WORK/out.json" 'r.offending.some(o=>/rawest material/i.test(o))'
rewrite_body "$COMPLETE" "$WORK/ph2.md" "$H1" '<...>'
run_check "$WORK/ph2.md"
assert_rc "D3c placeholder <...>" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"

# D4 TBD, upper and lower case.
# RED: in isPlaceholder(), remove the `tbd` comparison.
# Measured red 2026-10-19: isPlaceholder() `tbd` test removed -> D4 FAIL (also D4b)
rewrite_body "$COMPLETE" "$WORK/tbd.md" "$H1" 'TBD'
run_check "$WORK/tbd.md"
assert_rc "D4 TBD" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
rewrite_body "$COMPLETE" "$WORK/tbd2.md" "$H2" 'tbd'
run_check "$WORK/tbd2.md"
assert_rc "D4b tbd (lower case)" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"

# D5 empty answer body.
# RED: in isPlaceholder(), remove the empty-body test (`body.trim() === ''`).
# Measured red 2026-10-19: isPlaceholder() empty-body test removed -> D5 FAIL
rewrite_body "$COMPLETE" "$WORK/empty-ans.md" "$H2" ''
run_check "$WORK/empty-ans.md"
assert_rc "D5 empty answer" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"

# D6 self-referential oracle.
# RED: in isSelfReferential(), remove the ORACLE_DENYLIST membership test (every token counted as a real noun).
# Measured red 2026-10-19: isSelfReferential() returns false -> D6 FAIL (also D6b)
rewrite_body "$COMPLETE" "$WORK/selfref.md" "$H4" 'Claude and I will check it'
run_check "$WORK/selfref.md"
assert_rc "D6 self-referential answer 4" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
assert_json "D6b report names sub-heading 4 as self-referential" "$WORK/out.json" 'r.offending.some(o=>/external evidence/i.test(o)) && JSON.stringify(r).includes("self-referential")'

# D9 heading only inside a fenced code block does not count (backtick and tilde fences).
# RED: in findSection(), drop the fence tracking (the quoted heading then counts).
# Measured red 2026-10-19: tagFences() never fences -> D9 FAIL (also D9b)
{ echo "Example of the template:"; echo; echo '```markdown'; cat "$COMPLETE"; echo '```'; } > "$WORK/fenced-bt.md"
run_check "$WORK/fenced-bt.md"
assert_rc "D9 fenced (backticks) only" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
{ echo "Example of the template:"; echo; echo '~~~'; cat "$COMPLETE"; echo '~~~'; } > "$WORK/fenced-tl.md"
run_check "$WORK/fenced-tl.md"
assert_rc "D9b fenced (tildes) only" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"

# D10 duplicate heading, first section incomplete, second complete -> the FIRST is used -> 1.
# RED: in findSection(), take the last `## Depth Pass` instead of the first.
# Measured red 2026-10-19: findSection() takes the last heading -> D10 FAIL (also D10b, D10c)
{ echo "## Depth Pass"; echo; echo "### 1 What a top professional would do"; echo "TBD"; echo; cat "$COMPLETE"; } > "$WORK/dup-first-bad.md"
run_check "$WORK/dup-first-bad.md"
assert_rc "D10 duplicate heading uses the first (incomplete) section" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"

# D12 empty file -> missing section.
# RED: in cmdPlanDepthCheck(), treat empty text as "usage error" (exit 2) or as pass.
# Measured red 2026-10-19: empty text exits 2 -> D12 FAIL (got exit 2)
: > "$WORK/empty.md"
run_check "$WORK/empty.md"
assert_rc "D12 empty file" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"

# ---------------------------------------------------------------- exit 2 cases

# D13 usage errors: missing flag, flag without value, unknown flag, unknown subcommand, missing file.
rc=0; out="$(node "$TOOLS" plan depth-check 2>&1)" || rc=$?
assert_rc "D13 no --plan flag" 2 "$rc" "$out"
rc=0; out="$(node "$TOOLS" plan depth-check --plan 2>&1)" || rc=$?
assert_rc "D13b --plan without a value" 2 "$rc" "$out"
rc=0; out="$(node "$TOOLS" plan depth-check --plan "$COMPLETE" --bogus 2>&1)" || rc=$?
assert_rc "D13c unknown flag" 2 "$rc" "$out"
rc=0; out="$(node "$TOOLS" plan bogus --plan "$COMPLETE" 2>&1)" || rc=$?
assert_rc "D13d unknown subcommand" 2 "$rc" "$out"
rc=0; out="$(node "$TOOLS" plan 2>&1)" || rc=$?
assert_rc "D13e no subcommand" 2 "$rc" "$out"
rc=0; out="$(node "$TOOLS" plan depth-check --plan "$WORK/does-not-exist.md" 2>&1)" || rc=$?
assert_rc "D13f unreadable (missing) file" 2 "$rc" "$out"
case "$out" in *usage*|*"not found"*|*"cannot read"*) echo "PASS  D13g stderr says what is wrong"; pass=$((pass + 1));; *) echo "FAIL  D13g stderr message: $out"; fail=$((fail + 1));; esac

# D16 path traversal: a `..` segment is rejected before any file access (exit 2, stderr names the rule).
# RED: in readPlan(), delete the `planArg.split(...).includes('..')` check.
# Measured red 2026-10-19: one extra word in ORACLE_STOPWORDS -> D14 FAIL
# The file behind the path EXISTS and is complete, so only the guard can produce exit 2.
mkdir -p "$WORK/sub"
cp "$COMPLETE" "$WORK/sub/p.md"
rc=0; out="$(node "$TOOLS" plan depth-check --plan "$WORK/sub/../sub/p.md" 2>&1)" || rc=$?
assert_rc "D16 traversal through an existing file" 2 "$rc" "$out"
case "$out" in *'".." segment'*) echo "PASS  D16b stderr names the rule"; pass=$((pass + 1));; *) echo "FAIL  D16b stderr: $out"; fail=$((fail + 1));; esac
rc=0; out="$(node "$TOOLS" plan depth-check --plan ../../etc/passwd 2>&1)" || rc=$?
assert_rc "D16c ../../etc/passwd" 2 "$rc" "$out"
rc=0; out="$(node "$TOOLS" plan depth-check --plan '..\..\etc\passwd' 2>&1)" || rc=$?
assert_rc "D16d backslash traversal" 2 "$rc" "$out"

# D17 a directory is not a plan (exit 2).
# RED: in readPlan(), delete the `!st.isFile()` check AND make the catch return '' instead of exit 2
#      (readFileSync on a directory throws EISDIR, so the isFile check alone is masked by the catch: two edits, one guard).
# Measured red 2026-10-19: readPlan() `..` check disabled -> D16 FAIL (also D16b)
rc=0; out="$(node "$TOOLS" plan depth-check --plan "$WORK/sub" 2>&1)" || rc=$?
assert_rc "D17 directory path" 2 "$rc" "$out"
case "$out" in *"not a regular file"*) echo "PASS  D17b stderr names the rule"; pass=$((pass + 1));; *) echo "FAIL  D17b stderr: $out"; fail=$((fail + 1));; esac

# D18 size cap: one byte over 5 MiB -> exit 2 with the limit in stderr; exactly at the cap is read.
# RED: in readPlan(), raise MAX_PLAN_BYTES to 1024 * 1024 * 1024 (the 5 MiB + 1 plan is then read -> exit 1).
# Measured red 2026-10-19: readPlan() isFile check removed + catch returns '' -> D17 FAIL (also D17b, D13f, D13g, D20)
node -e '
  const fs = require("fs");
  const cap = 5 * 1024 * 1024;
  fs.writeFileSync(process.argv[1] + "/over-cap.md", "x".repeat(cap + 1));
' "$WORK"
rc=0; out="$(node "$TOOLS" plan depth-check --plan "$WORK/over-cap.md" 2>&1)" || rc=$?
assert_rc "D18 plan over the size cap" 2 "$rc" "$out"
case "$out" in *5242880*) echo "PASS  D18b stderr states the limit"; pass=$((pass + 1));; *) echo "FAIL  D18b stderr lacks the limit: $out"; fail=$((fail + 1));; esac

# D19 injection-shaped input is inert. Part 1: in the PLAN TEXT (answers carry shell/HTML payloads).
# RED: in cmdPlanDepthCheck(), add `require("child_process").execSync('echo ' + c + ' >/dev/null')` for each `$(touch ...)` match in the plan
#      text (only the payload is fed to the shell, never the whole plan; the side-effect file then appears).
# Measured red 2026-10-19: MAX_PLAN_BYTES = 1 GiB -> D18 FAIL (also D18b)
INJ="$WORK/inj"; mkdir -p "$INJ"
node -e '
  const fs = require("fs");
  const [inp, outp, dir] = process.argv.slice(1);
  const payload = "; rm -rf / ; $(touch " + dir + "/pwn-subst) `touch " + dir + "/pwn-tick` <script>alert(1)</script> && touch " + dir + "/pwn-and";
  const t = fs.readFileSync(inp, "utf8").replace(/^(### 4 External evidence of correctness\n+)/m, "$1" + payload + " pytest suite\n\n");
  fs.writeFileSync(outp, t);
' "$COMPLETE" "$WORK/inj-text.md" "$INJ"
run_check "$WORK/inj-text.md"
assert_rc "D19 injection-shaped plan text parsed as text" 0 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
if [[ -z "$(ls -A "$INJ")" ]]; then echo "PASS  D19b no side-effect file from plan text"; pass=$((pass + 1)); else echo "FAIL  D19b side-effect file(s): $(ls "$INJ")"; fail=$((fail + 1)); fi
# Same payload with the section removed: still inert, plain finding (exit 1).
sed 's/^## Depth Pass/## Depth Notes/' "$WORK/inj-text.md" > "$WORK/inj-missing.md"
run_check "$WORK/inj-missing.md"
assert_rc "D19c injection-shaped text without section -> finding" 1 "$RC" "$(cat "$WORK/out.json" "$WORK/err.txt")"
if [[ -z "$(ls -A "$INJ")" ]]; then echo "PASS  D19d no side-effect file"; pass=$((pass + 1)); else echo "FAIL  D19d side-effect file(s): $(ls "$INJ")"; fail=$((fail + 1)); fi

# D20 injection-shaped input in the PATH argument: never reaches a shell (file simply not found -> exit 2).
# RED: in cmdPlanDepthCheck(), add `require("child_process").execSync("cat " + flags.plan + " >/dev/null 2>&1")`
#      (the `; touch` in the path then runs and creates the side-effect file).
# Measured red 2026-10-19: execSync over `$(touch ...)` plan-text payload -> D19b FAIL (also D19d, D20b: side-effect file pwn-subst appeared)
for evil in "x; touch $INJ/pwn-path" "\$(touch $INJ/pwn-path2)" "\`touch $INJ/pwn-path3\`" "<script>.md"; do
  rc=0; out="$(node "$TOOLS" plan depth-check --plan "$evil" 2>&1)" || rc=$?
  assert_rc "D20 hostile path '$evil'" 2 "$rc" "$out"
done
if [[ -z "$(ls -A "$INJ")" ]]; then echo "PASS  D20b no side-effect file from path"; pass=$((pass + 1)); else echo "FAIL  D20b side-effect file(s): $(ls "$INJ")"; fail=$((fail + 1)); fi

# D21 oversized plans finish in time and pass: 10 000 chars < 1 s, 1 MB (one 1 MB line, and many lines) < 2 s.
# RED: in checkDepthPass(), add `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.floor(text.length / 5))`
#      (sleeps length/5 ms: 10 000 chars -> 2 s, 1 MB -> 200 s, killed by the 10 s harness timeout).
# Measured red 2026-10-19: execSync over the --plan argument -> D20b FAIL (side-effect file pwn-path appeared)
# timed_check <plan> -> sets RC, ELAPSED_MS. Portable timer: node hrtime around spawnSync (no `date +%N`), 10 s kill.
timed_check() {
  local res
  res="$(node -e '
    const { spawnSync } = require("child_process");
    const t0 = process.hrtime.bigint();
    const r = spawnSync("node", [process.argv[1], "plan", "depth-check", "--plan", process.argv[2]], { encoding: "utf8", timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
    const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
    process.stdout.write((r.status === null ? 124 : r.status) + " " + ms);
  ' "$TOOLS" "$1")"
  RC="${res%% *}"; ELAPSED_MS="${res##* }"
}
gen_big() { # <out> <chars> <line-width: 0 = one line>
  node -e '
    const fs = require("fs");
    const [inp, outp, n, width] = [process.argv[1], process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
    let body = "pytest suite ".repeat(Math.ceil(n / 13)).slice(0, n);
    if (width > 0) body = body.replace(new RegExp(".{1," + width + "}", "g"), (m) => m + "\n");
    const t = fs.readFileSync(inp, "utf8").replace(/^(### 4 External evidence of correctness\n+)/m, "$1" + body + "\n\n");
    fs.writeFileSync(outp, t);
  ' "$COMPLETE" "$@"
}
gen_big "$WORK/big-10k.md" 10000 0
timed_check "$WORK/big-10k.md"
assert_rc "D21 10 000-char answer" 0 "$RC" "elapsed ${ELAPSED_MS} ms"
if [[ "$ELAPSED_MS" -lt 1000 ]]; then echo "PASS  D21b 10k plan in ${ELAPSED_MS} ms (< 1000)"; pass=$((pass + 1)); else echo "FAIL  D21b 10k plan took ${ELAPSED_MS} ms (limit 1000)"; fail=$((fail + 1)); fi
gen_big "$WORK/big-1m-line.md" 1000000 0
timed_check "$WORK/big-1m-line.md"
assert_rc "D21c 1 MB single-line answer" 0 "$RC" "elapsed ${ELAPSED_MS} ms"
if [[ "$ELAPSED_MS" -lt 2000 ]]; then echo "PASS  D21d 1 MB one-line plan in ${ELAPSED_MS} ms (< 2000)"; pass=$((pass + 1)); else echo "FAIL  D21d 1 MB one-line plan took ${ELAPSED_MS} ms (limit 2000)"; fail=$((fail + 1)); fi
gen_big "$WORK/big-1m-lines.md" 1000000 80
timed_check "$WORK/big-1m-lines.md"
assert_rc "D21e 1 MB many-line answer" 0 "$RC" "elapsed ${ELAPSED_MS} ms"
if [[ "$ELAPSED_MS" -lt 2000 ]]; then echo "PASS  D21f 1 MB multi-line plan in ${ELAPSED_MS} ms (< 2000)"; pass=$((pass + 1)); else echo "FAIL  D21f 1 MB multi-line plan took ${ELAPSED_MS} ms (limit 2000)"; fail=$((fail + 1)); fi

# ---------------------------------------------------------------- doc owns the lists

# D14 the two lists in _shared/depth-pass.md (section "Self-reference rule") equal the exported constants.
# RED: add or drop one word in ORACLE_STOPWORDS (or ORACLE_DENYLIST) without touching the doc.
# Measured red 2026-10-19: Atomics.wait(length / 5 ms) in checkDepthPass() -> D21b FAIL (10k took 3018 ms; 1 MB cases hit the 10 s kill)
rc=0
out="$(DOC="$DOC" LIB="$LIB" node -e '
  const fs = require("fs");
  const text = fs.readFileSync(process.env.DOC, "utf8").replace(/\r\n/g, "\n");
  const m = text.match(/^## Self-reference rule\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!m) { console.log("no Self-reference rule section"); process.exit(1); }
  const list = (key) => {
    const l = m[1].split("\n").find((x) => x.startsWith(key + ":"));
    if (!l) { console.log("no " + key + " line"); process.exit(1); }
    return l.slice(key.length + 1).split(",").map((s) => s.trim()).filter(Boolean);
  };
  const lib = require(process.env.LIB);
  const same = (name, docList, code) => {
    const sd = new Set(docList), sc = new Set(code);
    const ok = docList.length === sd.size && code.length === sc.size && sd.size === sc.size && [...sd].every((w) => sc.has(w));
    if (!ok) { console.log(name + " differs: doc=" + docList.length + " code=" + code.length); process.exit(1); }
  };
  same("denylist", list("Denylist"), lib.ORACLE_DENYLIST);
  same("stopwords", list("Stopwords"), lib.ORACLE_STOPWORDS);
' 2>&1)" || rc=$?
assert_rc "D14 doc lists equal code constants" 0 "$rc" "$out"

# D15 the doc states the a1-quick exemption and carries the five exact sub-headings.
if grep -q 'a1-quick' "$DOC" 2>/dev/null \
  && grep -qF '### 1 What a top professional would do' "$DOC" \
  && grep -qF '### 2 Rawest material' "$DOC" \
  && grep -qF '### 3 Methods and tools' "$DOC" \
  && grep -qF '### 4 External evidence of correctness' "$DOC" \
  && grep -qF '### Rewritten brief' "$DOC"; then
  echo "PASS  D15 doc has exemption and the five exact sub-headings"; pass=$((pass + 1))
else
  echo "FAIL  D15 doc lacks a1-quick exemption or a sub-heading"; fail=$((fail + 1))
fi

echo "a1-depth-pass: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
