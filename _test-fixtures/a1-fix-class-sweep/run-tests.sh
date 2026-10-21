#!/usr/bin/env bash
# Fixture: `a1-tools fix class-sweep --record | --verify` and the class_query gate of `fix update-status`
# (spec 017-enforced-self-checks, Wave 9, FR-027..FR-031, SC-007, US-017-4).
#
# Inputs are byte copies of real a1-office files (real/, origin in real/ORIGIN.md): the four write sites of the
# defect class of the postmortem `foreign-customer-id-invoices-tasks` and the frontmatter of that bug report.
# The bug files live in a TEMP vault (A1_VAULT_ROOT is unset, then pointed at a temp dir for the CLI calls only);
# the real vault is never touched. Engine is `grep -E` (always present); the `rg` cases need no rg binary.
#
# Measured red 2026-10-21 (git-archive snapshot of the wave commits, one production line reverted, both a1-fix suites run;
# cases that fail). A `timeout:` option itself cannot be reverted safely (the backtracking grep would never end), so E3 is
# proven through the line that turns the timeout into exit 2.
#   fix-class-sweep.cjs runEngine(): spawn with shell:true                  : A1-A13, C1-C3, E1-E6 (every call; E1 is the point)
#   fix-class-sweep.cjs MAX_MATCHES 50 -> 51                                : B2, B3
#   fix-class-sweep.cjs recompute(): `>` -> `>=`                            : B1, B4
#   fix-class-sweep.cjs doRecord(): root_site check removed                 : C1, C2, E1
#   fix-class-sweep.cjs runEngine(): timeout error swallowed                : E3
#   fix-class-sweep.cjs runEngine(): ENOENT branch removed                  : E5
#   fix-class-sweep.cjs guardOk(): `changed.has(test)` removed              : A7 (test file not in the fix diff)
#   fix-class-sweep.cjs guardOk(): `isPlainFile` removed                    : A7 (file deleted in the diff)
#   fix-class-sweep.cjs classify(): stored guards ignored                   : A8, A10
#   fix-class-sweep.cjs classify(): any match counts as accepted            : A3-A6, A8, A9, A11, A12
#   fix-class-sweep.cjs checkGuard(): unknown-match check removed           : A7
#   fix-class-sweep.cjs doVerify(): after_fix / guards not written          : A5, A8, A10
#   fix-class-sweep.cjs doRecord(): class_sweep_base not stored             : A8, A10
#   fix-class-sweep.cjs doVerify(): class_sweep_base not read               : A8, A10
#   fix-class-sweep.cjs doVerify(): not-recorded check removed              : E9
#   fix-class-sweep.cjs checkFixed(): not-recorded check removed            : E9
#   fix-class-sweep.cjs statusGate(): `fixed` recompute removed             : A4, A6, A9, E9
#   fix-class-sweep.cjs statusGate(): requireQuery -> readQuery (no refusal): D1, D4, D5b-d, D6
#   fix-class-sweep.cjs statusGate(): legacy skip removed                   : D3, D5a, a1-fix legacy case
#   fix-class-sweep.cjs statusGate(): undated file treated as legacy        : D4
#   fix-class-sweep.cjs statusGate(): override may move the date later      : D5c
#   fix-class-sweep.cjs listFiles(): glob filter removed                    : B4, C2
#   fix-class-sweep.cjs fingerprintFor(): unsafe-path form removed          : E4
#   fix-class-sweep.cjs readQuery(): pattern length / newline / engine / glob `..` / `**` cap / root_site path : D6 (one each)
#   fix-class-sweep.cjs classify(): dispositions-file error swallowed       : E6
#   fix-class-sweep.cjs sweep(): one sibling site dropped                   : A1, A2, A3
#   fix.cjs cmdFixUpdateStatus(): gate call disabled                        : A4, A6, A9, D1, D4-D6, a1-fix class_query cases
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="${A1_FX_TOOLS:-$REPO_ROOT/_shared/a1-tools.cjs}"
LIB="$(dirname "$TOOLS")/lib"
REAL="$REPO_ROOT/_test-fixtures/a1-fix-class-sweep/real"

W="$(mktemp -d "${TMPDIR:-/tmp}/a1-fx-class-sweep.XXXXXX")" || exit 1
[[ -n "$W" && -d "$W" ]] || exit 1
trap 'rm -rf "${W:?}"' EXIT
export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0
VAULT="$W/vault"; mkdir -p "$VAULT/project/demo/fixes" || exit 1
SINCE=2026-01-01

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }
expect() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi; }

N=0; R=""; BUG=""
G() { git -C "$R" -c user.name=fx -c user.email=fx@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"; }
js() { printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
fmv() { node -e 'const {readMd}=require(process.argv[1]);const {fm}=readMd(process.argv[2]);console.log(eval(process.argv[3]))' "$LIB/io.cjs" "$BUG" "$1"; }
# run the CLI under a 60 s watchdog (a regression in the timeout must fail the suite, not hang it)
cli() { node -e '
const r=require("child_process").spawnSync(process.execPath,[process.argv[1],...process.argv.slice(2)],{cwd:process.env.FX_CWD,timeout:60000,killSignal:"SIGKILL",encoding:"utf8"});
process.stdout.write(r.stdout||"");process.stderr.write(r.stderr||"");process.exit(r.status===null?124:r.status)' "$TOOLS" "$@"; }
sw() { OUT="$(FX_CWD="$R" A1_VAULT_ROOT="$VAULT" cli fix class-sweep --phase fx-w9 "$@" 2>"$W/err")"; RC=$?; ERR="$(cat "$W/err")"; }
us() { OUT="$(FX_CWD="$R" A1_VAULT_ROOT="$VAULT" cli fix update-status "$BUG" "$1" --project "$R" "${@:2}" 2>"$W/err")"; RC=$?; ERR="$(cat "$W/err")"; }
dis() { OUT="$(FX_CWD="$R" cli disposition "$@" --project "$R" 2>"$W/err")"; RC=$?; ERR="$(cat "$W/err")"; }

mkrepo() { # a repo with the real write sites + one committed test file (outside every later fix diff)
  N=$((N + 1)); R="$W/r$N"; mkdir -p "$R" "$R/tests" || return 1
  (cd "$REAL" && tar cf - --exclude=ORIGIN.md --exclude=bug-frontmatter.txt .) | (cd "$R" && tar xf -) || return 1
  printf 'test("old", () => {});\n' > "$R/tests/old.test.ts"
  git -C "$R" -c init.defaultBranch=main init -q && G add -A && G commit -q -m base
}
mkbug() { # mkbug <file> <extra frontmatter line>... : the real report frontmatter, status reset, temp vault
  BUG="$VAULT/project/demo/fixes/$1"; shift
  { grep -v '^status:' "$REAL/bug-frontmatter.txt"; echo 'status: reported'; for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n# Bug\n\nSymptom.\n'; } > "$BUG"
}
STD_PAT='INSERT INTO api\.(invoices|workspace_tasks)'
std() { # std <pattern> <glob> <engine> <root_site>
  mkbug "${5:-2026-10-03-fk-class.md}" "class_query:" "  - pattern: $1" "  - glob: $2" "  - engine: $3" "root_site: $4"
}
ROOT=lib/crm/invoice-write-service.ts:224
unfix() { # rewrite the INSERT lines of the named files so the pattern no longer matches
  for f in "$@"; do node -e 'const fs=require("fs"),p=process.argv[1];fs.writeFileSync(p,fs.readFileSync(p,"utf8").split("INSERT INTO api.").join("SELECT api.insert_"))' "$R/$f"; done
}
SITES="app/api/crm/invoices/[id]/convert/route.ts lib/crm/invoice-write-service.ts lib/workspace-tasks/task-write-service.ts packages/office-core/src/adapters/task-sql.ts"

# ============================================================================
# A. SC-007 / US-017-4: the FK class of foreign-customer-id-invoices-tasks
# ============================================================================
mkrepo; std "$STD_PAT" '**/*.ts' 'grep -E' "$ROOT"
sw --record "$BUG"
expect "A1 record finds the write sites: exit 0" "0" "$RC"
expect "A1 record count is 4 (count assert)" "4" "$(js 'j.count')"
expect "A2 bug file holds class_sweep_at_diagnosis: 4 items" "4" "$(fmv 'fm.class_sweep_at_diagnosis.length')"
expect "A2 the four sites are exactly the real files (sorted)" "$SITES" "$(fmv 'fm.class_sweep_at_diagnosis.map(x=>JSON.parse(x).file).join(" ")')"
expect "A2 fingerprints follow the class-sweep grammar (4 of 4)" "4" "$(fmv 'fm.class_sweep_at_diagnosis.filter(x=>/^class-sweep:[^:]+:[0-9a-f]{16}$/.test(JSON.parse(x).fingerprint)).length')"
expect "A2 base is the commit sha" "$(G rev-parse HEAD)" "$(js 'j.base')"
sw --verify "$BUG"
expect "A3 verify with nothing fixed: exit 1" "1" "$RC"
expect "A3 reason class_sweep_open, 4 open" "class_sweep_open/4" "$(js 'j.reason+"/"+j.counts.open')"
us fixed --enforced-since "$SINCE"
expect "A4 update-status fixed refused: exit 1 class_sweep_open" "1/class_sweep_open" "$RC/$(js 'j.reason')"
expect "A4 the file is still status: reported" "reported" "$(fmv 'fm.status')"

unfix lib/crm/invoice-write-service.ts lib/workspace-tasks/task-write-service.ts packages/office-core/src/adapters/task-sql.ts
sw --verify "$BUG"
expect "A5 three sites fixed, one left: verify exit 1" "1" "$RC"
expect "A5 exactly one open match (count)" "1" "$(js 'j.open.length')"
expect "A5 the open match is the unguarded convert route" "app/api/crm/invoices/[id]/convert/route.ts" "$(js 'j.open[0].file')"
expect "A5 after_fix holds that one match" "1" "$(fmv 'fm.class_sweep_after_fix.length')"
FP="$(js 'j.open[0].fingerprint')"
us fixed --enforced-since "$SINCE"
expect "A6 update-status fixed still refused: exit 1 class_sweep_open" "1/class_sweep_open" "$RC/$(js 'j.reason')"

# guards: each invalid guard leaves the match open
printf 'test("convert is tenant-checked", () => {});\n' > "$R/tests/convert-tenant.test.ts"
sw --verify "$BUG" --guard "$FP=tests/old.test.ts"
expect "A7 guard naming a test file NOT in the fix diff: exit 1 guard_invalid" "1/guard_invalid" "$RC/$(js 'j.reason')"
sw --verify "$BUG" --guard "$FP=tests/missing.test.ts"
expect "A7 guard naming a missing file: exit 1 guard_invalid" "1/guard_invalid" "$RC/$(js 'j.reason')"
sw --verify "$BUG" --guard "$FP=../escape.test.ts"
expect "A7 guard path with ..: exit 1 guard_invalid" "1/guard_invalid" "$RC/$(js 'j.reason')"
rm "$R/tests/old.test.ts"
sw --verify "$BUG" --guard "$FP=tests/old.test.ts"
expect "A7 guard naming a file deleted in the fix diff (in the diff, absent on disk): exit 1 guard_invalid" "1/guard_invalid" "$RC/$(js 'j.reason')"
G checkout -- tests/old.test.ts
sw --verify "$BUG" --guard "class-sweep:other.ts:0123456789abcdef=tests/convert-tenant.test.ts"
expect "A7 guard for a fingerprint that is not a current match: exit 1 guard_unknown_match" "1/guard_unknown_match" "$RC/$(js 'j.reason')"
sw --verify "$BUG" --guard "$FP=tests/convert-tenant.test.ts"
expect "A8 guard with a new test file in the diff: exit 0" "0" "$RC"
expect "A8 counts total/guarded/open" "1/1/0" "$(js 'j.counts.total+"/"+j.counts.guarded+"/"+j.counts.open')"
expect "A8 the guard is stored in the bug file" "1" "$(fmv 'fm.class_sweep_guards.length')"
mv "$R/tests/convert-tenant.test.ts" "$W/stash.test.ts"
us fixed --enforced-since "$SINCE"
expect "A9 the stored guard is re-checked: its test file removed -> fixed refused (exit 1)" "1/class_sweep_open" "$RC/$(js 'j.reason')"
mv "$W/stash.test.ts" "$R/tests/convert-tenant.test.ts"
us fixed --enforced-since "$SINCE"
expect "A10 guarded and verified: update-status fixed exit 0" "0" "$RC"
expect "A10 the file reached status: fixed" "fixed" "$(fmv 'fm.status')"

# accepted via disposition (FR-025); an overturned disposition clears nothing
mkrepo; std "$STD_PAT" '**/*.ts' 'grep -E' "$ROOT" 2026-10-03-accepted.md
sw --record "$BUG"; unfix lib/crm/invoice-write-service.ts lib/workspace-tasks/task-write-service.ts packages/office-core/src/adapters/task-sql.ts
sw --verify "$BUG"; FP="$(js 'j.open[0].fingerprint')"
dis add --kind class_sweep --fingerprint "$FP" --reason "fixture: convert route re-checks the tenant elsewhere" --by fx
expect "A11 disposition add class_sweep: exit 0" "0" "$RC"
sw --verify "$BUG"
expect "A11 accepted match: verify exit 0, accepted=1 open=0" "0/1/0" "$RC/$(js 'j.counts.accepted')/$(js 'j.counts.open')"
dis review "$FP" --verdict overturned --reason "fixture: reviewer disagrees"
sw --verify "$BUG"
expect "A12 overturned disposition clears nothing: verify exit 1" "1/class_sweep_open" "$RC/$(js 'j.reason')"
dis add --kind fidelity --rule mock-of-subject --file tests/old.test.ts --line 1 --reason "fixture: other kind" --by fx
FPF="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).filter(e=>e.kind==="fidelity")[0].fingerprint)' "$R/.a1/dispositions.json")"
expect "A13 a fidelity entry exists beside the class_sweep one (count)" "2" "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "$R/.a1/dispositions.json")"
sw --verify "$BUG"
expect "A13 a fidelity disposition does not clear a class-sweep match: exit 1" "1" "$RC"

# ============================================================================
# B. FR-031: the cap is 50 matches per glob scope
# ============================================================================
many() { # many <n> : file src/many.ts with n matching lines + the root file
  mkrepo; mkdir -p "$R/src" "$R/other"
  node -e 'const n=+process.argv[1];let s="";for(let i=1;i<=n;i++)s+="ROW_INSERT "+i+"\n";require("fs").writeFileSync(process.argv[2],s)' "$1" "$R/src/many.ts"
  G add -A; G commit -q -m many
}
many 50; std 'ROW_INSERT' '**/*.ts' 'grep -E' src/many.ts:1 2026-10-03-cap50.md
sw --record "$BUG"
expect "B1 50 matches pass: exit 0, count 50" "0/50" "$RC/$(js 'j.count')"
many 51; std 'ROW_INSERT' '**/*.ts' 'grep -E' src/many.ts:1 2026-10-03-cap51.md
sw --record "$BUG"
expect "B2 51 matches refused: exit 1 query_too_broad" "1/query_too_broad" "$RC/$(js 'j.reason')"
expect "B2 nothing was written to the bug file" "undefined" "$(fmv 'fm.class_sweep_at_diagnosis')"
printf 'ROW_INSERT other\n' > "$R/other/extra.ts"; G add -A; G commit -q -m extra
std 'ROW_INSERT' 'src/**/*.ts' 'grep -E' src/many.ts:1 2026-10-03-cap-glob.md
sw --record "$BUG"
expect "B3 the cap counts inside the glob scope: 51 total, 51 in src -> still refused" "1" "$RC"
mkrepo; mkdir -p "$R/src" "$R/other"
node -e 'let s="";for(let i=1;i<=50;i++)s+="ROW_INSERT "+i+"\n";require("fs").writeFileSync(process.argv[1],s);require("fs").writeFileSync(process.argv[2],"ROW_INSERT x\nROW_INSERT y\n")' "$R/src/many.ts" "$R/other/extra.ts"; G add -A; G commit -q -m scope
std 'ROW_INSERT' 'src/**/*.ts' 'grep -E' src/many.ts:1 2026-10-03-cap-scope.md
sw --record "$BUG"
expect "B4 52 matches in the repo but 50 in the glob scope: exit 0, count 50" "0/50" "$RC/$(js 'j.count')"

# ============================================================================
# C. FR-028: the query must hit the root site
# ============================================================================
mkrepo; std "$STD_PAT" '**/*.ts' 'grep -E' lib/crm/invoice-write-service.ts:225 2026-10-03-root-miss.md
sw --record "$BUG"
expect "C1 query misses root_site (off by one line): exit 1 root_site_not_matched" "1/root_site_not_matched" "$RC/$(js 'j.reason')"
expect "C1 nothing recorded" "undefined" "$(fmv 'fm.class_sweep_at_diagnosis')"
std "$STD_PAT" 'lib/**/*.ts' 'grep -E' packages/office-core/src/adapters/task-sql.ts:48 2026-10-03-root-glob.md
sw --record "$BUG"
expect "C2 root_site outside the glob scope: exit 1 root_site_not_matched" "1/root_site_not_matched" "$RC/$(js 'j.reason')"
std "$STD_PAT" '**/*.ts' 'grep -E' lib/crm/invoice-write-service.ts:224 2026-10-03-root-hit.md
sw --record "$BUG"
expect "C3 degenerate query matching only the root site is valid (glob = that file)" "0" "$RC"
std 'api\.invoices' 'lib/crm/invoice-write-service.ts' 'grep -E' lib/crm/invoice-write-service.ts:224 2026-10-03-root-one.md
sw --record "$BUG"
expect "C3b single-file glob: exit 0 and the match list is non-empty" "0/true" "$RC/$(js 'j.count>0')"

# ============================================================================
# D. FR-027: class_query_missing at diagnosed | fixing | fixed; legacy files skipped
# ============================================================================
mkrepo
mkbug 2026-10-03-noquery.md
for st in diagnosed fixing fixed; do
  us "$st" --enforced-since "$SINCE"
  expect "D1 no class_query -> update-status $st: exit 1 class_query_missing" "1/class_query_missing" "$RC/$(js 'j.reason')"
done
expect "D1 the file stayed status: reported" "reported" "$(fmv 'fm.status')"
us cancelled --enforced-since "$SINCE"
expect "D2 update-status cancelled needs no class_query: exit 0" "0" "$RC"
us diagnosed
expect "D3 bug file dated before ENFORCED_SINCE (constant): skipped, exit 0" "0" "$RC"
mkbug 2026-10-03-noquery2.md "reported_at: 2026-10-03T10:15"
mkbug nodate.md; grep -v '^reported_at:' "$BUG" > "$W/nodate.md" && cp "$W/nodate.md" "$BUG"
us diagnosed
expect "D4 no date at all: fail closed, enforced -> exit 1 class_query_missing" "1/class_query_missing" "$RC/$(js 'j.reason')"
# D5: the constant is a far-future placeholder until wave 14, so these cases run against a copy of _shared/ whose
# ENFORCED_SINCE is 2026-10-01 (the real file is never edited): the boundary day is enforced, the day before is legacy,
# and --enforced-since can only move enforcement earlier, never later.
cp -R "$REPO_ROOT/_shared" "$W/shared-copy" && node -e 'const fs=require("fs"),p=process.argv[1];fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace("2999-12-31","2026-10-01"))' "$W/shared-copy/lib/enforced-since.cjs"
usc() { OUT="$(A1_VAULT_ROOT="$VAULT" node "$W/shared-copy/a1-tools.cjs" fix update-status "$BUG" diagnosed "$@" 2>"$W/err")"; RC=$?; }
mkbug 2026-09-30-before.md "reported_at: 2026-09-30T09:00"; usc
expect "D5a copy with ENFORCED_SINCE 2026-10-01: a report from 2026-09-30 is legacy, exit 0" "0" "$RC"
mkbug 2026-10-01-onday.md "reported_at: 2026-10-01T09:00"; usc
expect "D5b a report from the enforcement day is enforced: exit 1 class_query_missing" "1/class_query_missing" "$RC/$(js 'j.reason')"
mkbug 2026-10-03-later.md; usc --enforced-since 3000-01-01
expect "D5c --enforced-since 3000-01-01 does not loosen the constant: exit 1" "1" "$RC"
mkbug 2026-09-30-earlier.md "reported_at: 2026-09-30T09:00"; usc --enforced-since 2026-09-01
expect "D5d --enforced-since 2026-09-01 tightens it: the 2026-09-30 report is enforced, exit 1" "1" "$RC"
bad_q() { # bad_q <label> <lines...> : a malformed class_query is refused at diagnosed
  local label="$1"; shift; mkbug 2026-10-03-bad.md "$@"; us diagnosed --enforced-since "$SINCE"
  expect "D6 $label: exit 1 class_query_missing" "1/class_query_missing" "$RC/$(js 'j.reason')"
}
bad_q "engine other than rg / grep -E" "class_query:" "  - pattern: x" "  - glob: **/*.ts" "  - engine: perl" "root_site: a.ts:1"
bad_q "root_site without a line" "class_query:" "  - pattern: x" "  - glob: **/*.ts" "  - engine: rg" "root_site: a.ts"
bad_q "root_site line 0" "class_query:" "  - pattern: x" "  - glob: **/*.ts" "  - engine: rg" "root_site: a.ts:0"
bad_q "root_site path with .." "class_query:" "  - pattern: x" "  - glob: **/*.ts" "  - engine: rg" "root_site: ../a.ts:1"
bad_q "glob with .." "class_query:" "  - pattern: x" "  - glob: ../**/*.ts" "  - engine: rg" "root_site: a.ts:1"
bad_q "absolute glob" "class_query:" "  - pattern: x" "  - glob: /etc/*" "  - engine: rg" "root_site: a.ts:1"
bad_q "pattern missing" "class_query:" "  - glob: **/*.ts" "  - engine: rg" "root_site: a.ts:1"
bad_q "pattern with an embedded newline (JSON-quoted)" "class_query:" '  - "pattern: a\nb"' "  - glob: **/*.ts" "  - engine: rg" "root_site: a.ts:1"
bad_q "pattern longer than 500 characters" "class_query:" "  - pattern: $(node -e 'process.stdout.write("a".repeat(501))')" "  - glob: **/*.ts" "  - engine: rg" "root_site: a.ts:1"
bad_q "nested-object form (the flat parser cannot hold it)" "class_query:" "  pattern: x" "  glob: **/*.ts" "  engine: rg" "root_site: a.ts:1"
bad_q "no root_site" "class_query:" "  - pattern: x" "  - glob: **/*.ts" "  - engine: rg"
bad_q "glob with 4 double-stars (regex blow-up guard)" "class_query:" "  - pattern: x" "  - glob: **/**/**/**/x" "  - engine: rg" "root_site: a.ts:1"
mkbug 2026-10-03-good.md "class_query:" "  - pattern: x" "  - glob: **/*.ts" "  - engine: rg" "root_site: a.ts:1"
us diagnosed --enforced-since "$SINCE"
expect "D7 a valid class_query passes diagnosed: exit 0" "0" "$RC"
us fixing --enforced-since "$SINCE"
expect "D7 and fixing: exit 0" "0" "$RC"
expect "D7 class_query survives the status rewrite (round trip, 3 list items)" "3" "$(fmv 'fm.class_query.length')"
mkbug 2026-10-03-roundtrip.md "class_query:" '  - pattern: INSERT INTO api\.(a|b) "q" \d+' "  - glob: **/*.ts" "  - engine: grep -E" "root_site: a.ts:1"
us diagnosed --enforced-since "$SINCE"; us fixing --enforced-since "$SINCE"
expect "D8 a pattern with backslashes and quotes survives two status rewrites unchanged" 'pattern: INSERT INTO api\.(a|b) "q" \d+' "$(fmv 'fm.class_query[0]')"

# ============================================================================
# E. Hostile input
# ============================================================================
mkrepo; printf 'x = "$(touch PWNED)"\ny = 1\n' > "$R/src.ts"; G add -A; G commit -q -m meta
for pat in '$(touch PWNED)' '`touch PWNED`' 'zzz; touch PWNED' 'zzz | touch PWNED' "zzz' ; touch PWNED ; '"; do
  std "$pat" '**/*.ts' 'grep -E' src.ts:1 2026-10-03-meta.md
  sw --record "$BUG"
  expect "E1 shell metacharacters in the pattern are data, not code ($pat): exit 1" "1" "$RC"
done
n=0; for d in "$R" "$W" "$PWD"; do [[ -e "$d/PWNED" ]] && n=$((n + 1)); done
expect "E1 no PWNED file was created anywhere (count of locations)" "0" "$n"
std 'x = .*touch PWNED' '**/*.ts' 'grep -E' src.ts:1 2026-10-03-meta2.md
sw --record "$BUG"
expect "E2 a metacharacter-free pattern for the same line records it: exit 0, count 1" "0/1" "$RC/$(js 'j.count')"

mkrepo; node -e 'require("fs").writeFileSync(process.argv[1],"a".repeat(60)+"X\n")' "$R/slow.ts"; G add -A; G commit -q -m slow
std '(a*)*\1c' '**/*.ts' 'grep -E' slow.ts:1 2026-10-03-slow.md
OUT="$(FX_CWD="$R" A1_VAULT_ROOT="$VAULT" A1_CLASS_SWEEP_TIMEOUT_MS=500 cli fix class-sweep --phase fx-w9 --record "$BUG" 2>"$W/err")"; RC=$?; ERR="$(cat "$W/err")"
expect "E3 catastrophic regex: exit 2 (timeout), no stdout" "2/" "$RC/$OUT"
expect "E3 stderr names the timeout" "yes" "$([[ "$ERR" == *"timed out"* ]] && echo yes || echo no)"
expect "E3 nothing recorded" "undefined" "$(fmv 'fm.class_sweep_at_diagnosis')"

mkrepo; printf 'ROW hit\n' > "$R/$(printf 'we\nird name.ts')"; printf 'ROW root\n' > "$R/root.ts"; G add -A; G commit -q -m names
std 'ROW' '**/*.ts' 'grep -E' root.ts:1 2026-10-03-names.md
sw --record "$BUG"
expect "E4 file name with a newline and a space: recorded, exit 0, count 2" "0/2" "$RC/$(js 'j.count')"
expect "E4 the exact file name round-trips" "we\\nird name.ts" "$(fmv 'JSON.stringify(JSON.parse(fm.class_sweep_at_diagnosis.find(x=>JSON.parse(x).file.includes("ird"))).file).slice(1,-1)')"
expect "E4 its fingerprint uses the safe unsafe-path- form" "1" "$(fmv 'fm.class_sweep_at_diagnosis.filter(x=>/^class-sweep:unsafe-path-[0-9a-f]{8}:[0-9a-f]{16}$/.test(JSON.parse(x).fingerprint)).length')"

NODE_DIR="$W/pathonly"; mkdir -p "$NODE_DIR" && ln -s "$(command -v node)" "$NODE_DIR/node" && ln -s "$(command -v git)" "$NODE_DIR/git"
mkrepo; std "$STD_PAT" '**/*.ts' rg "$ROOT" 2026-10-03-rg.md
OUT="$(cd "$R" && PATH="$NODE_DIR" A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix class-sweep --phase fx-w9 --record "$BUG" 2>"$W/err")"; RC=$?; ERR="$(cat "$W/err")"
expect "E5 engine rg not on PATH: exit 2, no stdout" "2/" "$RC/$OUT"
expect "E5 stderr names the engine" "yes" "$([[ "$ERR" == *'engine "rg" not found'* ]] && echo yes || echo no)"

mkrepo; std "$STD_PAT" '**/*.ts' 'grep -E' "$ROOT" 2026-10-03-bad-disp.md
sw --record "$BUG"; unfix $SITES
mkdir -p "$R/.a1"; printf 'not json' > "$R/.a1/dispositions.json"
sw --verify "$BUG"
expect "E6 unreadable dispositions file: exit 2, no stdout (fail closed)" "2/" "$RC/$OUT"
rm -f "$R/.a1/dispositions.json"
sw --verify "$BUG"
expect "E6b without the broken file and all sites fixed: verify exit 0, 0 matches" "0/0" "$RC/$(js 'j.counts.total')"
sw --verify "$W/vault/project/demo/fixes/no-such.md"
expect "E7 missing bug file: exit 2" "2" "$RC"
sw "$BUG"
expect "E7 no mode flag: exit 2" "2" "$RC"
sw --record --verify "$BUG"
expect "E7 both modes: exit 2" "2" "$RC"
sw --record "$BUG" --skip
expect "E7 unknown flag (no --skip / --ignore exists): exit 2" "2" "$RC"
mkbug 2026-10-03-noq-sweep.md
sw --record "$BUG"
expect "E8 --record without class_query: exit 1 class_query_missing" "1/class_query_missing" "$RC/$(js 'j.reason')"
std "$STD_PAT" '**/*.ts' 'grep -E' "$ROOT" 2026-10-03-norec.md
sw --verify "$BUG"
expect "E9 --verify before --record: exit 1 class_sweep_not_recorded" "1/class_sweep_not_recorded" "$RC/$(js 'j.reason')"
us fixed --enforced-since "$SINCE"
expect "E9 update-status fixed without a recorded sweep: exit 1 class_sweep_open" "1/class_sweep_open" "$RC/$(js 'j.reason')"

echo
echo "a1-fix-class-sweep: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
