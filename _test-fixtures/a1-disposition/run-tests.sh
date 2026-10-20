#!/usr/bin/env bash
# Fixture: `a1-tools disposition add | review` (spec 017-enforced-self-checks, Wave 8, FR-025; FR-017 is in a1-verify, S1-S9).
#
# Inputs are byte copies of real a1-office files (_test-fixtures/a1-test-fidelity/real/, origin in real/ORIGIN.md): the
# historical claudia test (mocks withTenantContext) and the corrected claudia test (ctx.skip() x12). Hostile
# fingerprints, globs and bad stores are string inputs written by this suite. Every equality assert has a count assert beside it.
#
# Measured red 2026-10-21 (git-archive snapshot, one production line reverted, suite run; cases that fail):
# (pending)
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="${A1_FX_TOOLS:-$REPO_ROOT/_shared/a1-tools.cjs}"
LIB="$(dirname "$TOOLS")/lib"
REAL="$REPO_ROOT/_test-fixtures/a1-test-fidelity/real"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-fx-disposition.XXXXXX")" || exit 1
[[ -n "$WORK" && -d "$WORK" ]] || exit 1
trap 'rm -rf "${WORK:?}"' EXIT
export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }
expect() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi; }

REPO_N=0; R=""
G() { git -C "$R" -c user.name=fx -c user.email=fx@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"; }
js() { printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
store() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(eval(process.argv[2]))' "$R/.a1/dispositions.json" "$1"; }

# new_repo: base commit with the real tsconfig + barrel and a CI that runs `npm test`, tag base; then the historical
# claudia test, a changed source and a head commit. The test file is tests/mail-rules.test.ts.
new_repo() {
  REPO_N=$((REPO_N + 1)); R="$WORK/r$REPO_N"
  mkdir -p "$R/lib/crm" "$R/tests" "$R/.github/workflows" || return 1
  git -C "$R" -c init.defaultBranch=main init -q || return 1
  cp "$REAL/tsconfig.json" "$R/tsconfig.json"; cp "$REAL/api.ts" "$R/lib/crm/api.ts"
  printf 'export async function createInvoice() { return null; }\n' > "$R/lib/crm/invoices.ts"
  printf 'name: t\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n' > "$R/.github/workflows/ci.yml"
  printf '{"scripts":{"test":"vitest run"}}\n' > "$R/package.json"
  G add -A && G commit -q -m base && G tag base
  cp "$REAL/claudia-before.mail-rules-rejected-audit.test.ts" "$R/tests/mail-rules.test.ts"
  printf '// changed\n' >> "$R/lib/crm/invoices.ts"
  G add -A && G commit -q -m head
}
tf()  { OUT="$(cd "$R" && node "$TOOLS" test-fidelity --phase fx-w8 --diff-base base 2>"$WORK/err")"; RC=$?; ERR="$(cat "$WORK/err")"; }
dis() { OUT="$(cd "$R" && node "$TOOLS" disposition "$@" 2>"$WORK/err")"; RC=$?; ERR="$(cat "$WORK/err")"; }
MOCK_LINE="$(grep -n 'vi.mock("@/lib/db/tenant-pool"' "$REAL/claudia-before.mail-rules-rejected-audit.test.ts" | head -1 | cut -d: -f1)"
add_mock() { dis add --kind fidelity --rule mock-of-subject --file tests/mail-rules.test.ts --line "$MOCK_LINE" --reason "fixture: reviewed pass-through" --by fx "$@"; }

# ---------- A: add / review round trip against a real finding ----------
new_repo; tf
expect "A0 historical claudia test: exit 1 before any disposition" 1 "$RC"
expect "A0 one mock-of-subject finding (count)" 1 "$(js "j.findings.filter(f=>f.rule==='mock-of-subject').length")"
FP="$(js "j.findings.find(f=>f.rule==='mock-of-subject').fingerprint")"
add_mock
expect "A1 add: exit 0" 0 "$RC"
expect "A1 store holds exactly one entry (count)" 1 "$(store 'j.length')"
expect "A1 entry fields: kind, fingerprint equals the finding's, review pending" "fidelity|$FP|pending" "$(store 'j[0].kind+"|"+j[0].fingerprint+"|"+j[0].review')"
expect "A1 entry has reason, by, ISO date (count of the 6 spec keys present)" 6 "$(store '["kind","fingerprint","reason","date","by","review"].filter(k=>typeof j[0][k]==="string"&&j[0][k]!=="").length')"
expect "A1 date is YYYY-MM-DD" 1 "$(store '/^\d{4}-\d{2}-\d{2}$/.test(j[0].date)?1:0')"
G add -A; G commit -q -m disp
tf
expect "A2 test-fidelity with the pending disposition: exit 0 (cleared by the matching fingerprint)" 0 "$RC"
expect "A2 zero findings (count)" 0 "$(js 'j.count')"
expect "A2 one dispositioned finding (count)" 1 "$(js 'j.dispositioned')"
# whitespace-only change keeps the fingerprint (normalised line), a real change returns the finding
sed -i.bak "${MOCK_LINE}s/\", () =>/\",   () =>/" "$R/tests/mail-rules.test.ts" && rm -f "$R/tests/mail-rules.test.ts.bak"; G commit -q -am ws; tf
expect "A3 whitespace-only edit of the line: still cleared, exit 0" 0 "$RC"
sed -i.bak "${MOCK_LINE}s#tenant-pool#tenant-pool2#" "$R/tests/mail-rules.test.ts" && rm -f "$R/tests/mail-rules.test.ts.bak"; G commit -q -am mut; tf
expect "A4 line text changed: the finding returns, exit 1" 1 "$RC"
expect "A4 one finding back (count)" 1 "$(js 'j.count')"
new_repo; add_mock >/dev/null; cp "$R/tests/mail-rules.test.ts" "$R/tests/other.test.ts"; G add -A; G commit -q -m copy; tf
expect "A5 same line in ANOTHER file is not cleared (file is part of the fingerprint): exit 1" 1 "$RC"
expect "A5 exactly the copy is flagged (count + file)" "1|tests/other.test.ts" "$(js "j.findings.filter(f=>f.rule==='mock-of-subject').length+'|'+j.findings.find(f=>f.rule==='mock-of-subject').file")"
new_repo; add_mock >/dev/null; G add -A; G commit -q -m d
dis review "$FP" --verdict overturned --reason "fixture: reviewer says the mock hides the wrapper" --by reviewer
expect "A6 review overturned: exit 0" 0 "$RC"
expect "A6 entry now overturned with reason, reviewer and timestamp (count of 3 fields)" "overturned|3" "$(store 'j[0].review+"|"+["review_reason","reviewed_by","reviewed_at"].filter(k=>j[0][k]).length')"
tf
expect "A7 an overturned disposition clears nothing: exit 1" 1 "$RC"
dis review "$FP" --verdict upheld --reason "fixture: re-reviewed, pass-through is intended"
expect "A8 review upheld: exit 0, entry upheld" "0|upheld" "$RC|$(store 'j[0].review')"
tf
expect "A8 upheld disposition clears the finding: exit 0" 0 "$RC"

# ---------- B: changed between base and head, exported check ----------
chk() { node -e '
  const d = require(process.argv[1] + "/disposition.cjs");
  const r = d.pendingOrOverturned(process.argv[2], process.argv[3], process.argv[4]);
  process.stdout.write(JSON.stringify(r.map((x) => x.reason)));' "$LIB" "$R" "$1" "${2:-HEAD}"; }
new_repo; G tag base2; add_mock >/dev/null; G add -A; G commit -q -m pending
expect "B1 entry added after base, still pending: disposition_unreviewed" '["disposition_unreviewed"]' "$(chk base2)"
dis review "$FP" --verdict upheld --reason "fixture: reviewed"; G commit -q -am upheld
expect "B2 upheld: no reason reported" '[]' "$(chk base2)"
dis review "$FP" --verdict overturned --reason "fixture: overturned later"; G commit -q -am over
expect "B3 overturned: disposition_overturned (and only that)" '["disposition_overturned"]' "$(chk base2)"
expect "B4 base = head: nothing changed; the overturned entry is still reported" '["disposition_overturned"]' "$(chk HEAD)"
new_repo; add_mock >/dev/null; G add -A; G commit -q -m pend; G tag base3; printf '// x\n' >> "$R/lib/crm/invoices.ts"; G commit -q -am unrelated
expect "B5 pending entry that is unchanged between base and head is not reported" '[]' "$(chk base3)"
expect "B6 unresolvable ref: the check throws (count of error lines = 1)" 1 "$(node -e 'try{require(process.argv[1]+"/disposition.cjs").pendingOrOverturned(process.argv[2],"nope-ref","HEAD")}catch(e){console.log(e.message.includes("does not resolve")?1:0)}' "$LIB" "$R")"

# ---------- C: refusals (hostile inputs); nothing is written ----------
new_repo
refuse() { # refuse <label> <want-rc> <dis args...>
  local label="$1" want="$2"; shift 2; dis "$@"
  expect "$label: exit $want" "$want" "$RC"
  expect "$label: store untouched (no file, count 0)" 0 "$([[ -f "$R/.a1/dispositions.json" ]] && store 'j.length' || echo 0)"
}
GOODHASH="0123456789abcdef"
refuse "C1 empty reason" 2 add --kind fidelity --rule skipped-test --file tests/a.test.ts --text "x" --reason "" --by fx
refuse "C2 blank reason" 2 add --kind fidelity --rule skipped-test --file tests/a.test.ts --text "x" --reason "   " --by fx
refuse "C3 missing reason" 2 add --kind fidelity --rule skipped-test --file tests/a.test.ts --text "x" --by fx
refuse "C4 missing by" 2 add --kind fidelity --rule skipped-test --file tests/a.test.ts --text "x" --reason "r"
refuse "C5 unknown kind" 2 add --kind everything --rule skipped-test --file tests/a.test.ts --text "x" --reason "r" --by fx
refuse "C6 rule of another kind (class-sweep under fidelity)" 2 add --kind fidelity --rule class-sweep --file tests/a.test.ts --text "x" --reason "r" --by fx
refuse "C7 unknown rule id" 2 add --kind fidelity --rule all-rules --file tests/a.test.ts --text "x" --reason "r" --by fx
refuse "C8 glob in file (*)" 2 add --kind fidelity --rule skipped-test --file 'tests/*.test.ts' --text "x" --reason "r" --by fx
refuse "C9 glob fingerprint (*)" 2 add --kind fidelity --fingerprint "skipped-test:*:$GOODHASH" --reason "r" --by fx
refuse "C10 parent segment in file" 2 add --kind fidelity --rule skipped-test --file '../x.test.ts' --text "x" --reason "r" --by fx
refuse "C11 absolute file" 2 add --kind fidelity --rule skipped-test --file '/etc/passwd' --text "x" --reason "r" --by fx
refuse "C12 newline in fingerprint" 2 add --kind fidelity --fingerprint "skipped-test:tests/a.ts
:$GOODHASH" --reason "r" --by fx
refuse "C13 pipe in fingerprint file" 2 add --kind fidelity --fingerprint "skipped-test:tests/a|b.ts:$GOODHASH" --reason "r" --by fx
refuse "C14 hash not 16 hex" 2 add --kind fidelity --fingerprint "skipped-test:tests/a.ts:xyz" --reason "r" --by fx
refuse "C15 fingerprint combined with --rule" 2 add --kind fidelity --fingerprint "skipped-test:tests/a.ts:$GOODHASH" --rule skipped-test --reason "r" --by fx
refuse "C16 rule needing a line without --line/--text" 2 add --kind fidelity --rule skipped-test --file tests/a.test.ts --reason "r" --by fx
refuse "C17 file-level rule with a line" 2 add --kind fidelity --rule test-not-in-ci --file tests/a.test.ts --text "x" --reason "r" --by fx
refuse "C18 --line past the end of the file" 2 add --kind fidelity --rule mock-of-subject --file tests/mail-rules.test.ts --line 99999 --reason "r" --by fx
refuse "C19 --skip is not an option" 2 add --kind fidelity --rule test-not-in-ci --file tests/mail-rules.test.ts --reason "r" --by fx --skip
refuse "C20 --ignore is not an option" 2 add --kind fidelity --rule test-not-in-ci --file tests/mail-rules.test.ts --reason "r" --by fx --ignore
refuse "C21 unknown subcommand" 2 remove
refuse "C22 no subcommand" 2
add_mock >/dev/null
dis add --kind fidelity --rule mock-of-subject --file tests/mail-rules.test.ts --line "$MOCK_LINE" --reason "again" --by fx
expect "C23 duplicate fingerprint: exit 1 (refused, not overwritten)" 1 "$RC"
expect "C23 still one entry with the first reason (count + reason)" "1|fixture: reviewed pass-through" "$(store 'j.length+"|"+j[0].reason')"
dis review 'mock-of-subject:*:*' --verdict upheld --reason "wildcard"
expect "C24 review with a wildcard fingerprint: exit 2" 2 "$RC"
dis review "mock-of-subject:tests/mail-rules.test.ts:$GOODHASH" --verdict upheld --reason "unknown hash"
expect "C25 review of an unknown fingerprint: exit 1" 1 "$RC"
dis review "$FP" --verdict maybe --reason "r"
expect "C26 review with an invalid verdict: exit 2" 2 "$RC"
dis review "$FP" --verdict upheld --reason ""
expect "C27 review with an empty reason: exit 2" 2 "$RC"
expect "C28 after every refusal the entry is still pending (count of reviewed = 0)" 0 "$(store 'j.filter(e=>e.review!=="pending").length')"
dis add --kind skip_increase --rule skip-increase --file unit --text $'1->2\n|x\n' --reason "newline and pipe in the TEXT are hashed, not stored" --by fx
expect "C29 hostile --text (newline, pipe) is hashed: exit 0, store still valid JSON with 2 entries" "0|2" "$RC|$(store 'j.length')"
expect "C29 its fingerprint carries neither newline nor pipe (count 0)" 0 "$(store 'j.filter(e=>/[\n|]/.test(e.fingerprint)).length')"

# ---------- D: a hand-edited store is validated, never trusted ----------
badstore() { # badstore <label> <file content>
  new_repo; mkdir -p "$R/.a1"; printf '%s\n' "$2" > "$R/.a1/dispositions.json"; tf
  expect "$1: test-fidelity exit 2 (fail closed)" 2 "$RC"
  expect "$1: no findings JSON on stdout (count 0)" 0 "$(printf '%s' "$OUT" | wc -c | tr -d ' ')"
}
E='"reason":"r","date":"2026-10-21","by":"fx","review":"pending"'
badstore "D1 not an array" '{}'
badstore "D2 glob fingerprint written by hand" "[{\"kind\":\"fidelity\",\"fingerprint\":\"mock-of-subject:tests/*:$GOODHASH\",$E}]"
badstore "D3 empty reason written by hand" "[{\"kind\":\"fidelity\",\"fingerprint\":\"skipped-test:tests/a.ts:$GOODHASH\",\"reason\":\"\",\"date\":\"2026-10-21\",\"by\":\"fx\",\"review\":\"pending\"}]"
badstore "D4 unknown key (a smuggled 'match: *')" "[{\"kind\":\"fidelity\",\"fingerprint\":\"skipped-test:tests/a.ts:$GOODHASH\",\"match\":\"*\",$E}]"
badstore "D5 rule of another kind" "[{\"kind\":\"fidelity\",\"fingerprint\":\"class-sweep:tests/a.ts:$GOODHASH\",$E}]"
badstore "D6 duplicate fingerprint" "[{\"kind\":\"fidelity\",\"fingerprint\":\"skipped-test:tests/a.ts:$GOODHASH\",$E},{\"kind\":\"fidelity\",\"fingerprint\":\"skipped-test:tests/a.ts:$GOODHASH\",$E}]"
badstore "D7 reviewed entry without review_reason" "[{\"kind\":\"fidelity\",\"fingerprint\":\"skipped-test:tests/a.ts:$GOODHASH\",\"reason\":\"r\",\"date\":\"2026-10-21\",\"by\":\"fx\",\"review\":\"upheld\"}]"
badstore "D8 malformed JSON" '[{'
dis add --kind fidelity --rule test-not-in-ci --file tests/mail-rules.test.ts --reason "r" --by fx
expect "D9 add onto a malformed store: exit 2, file content unchanged (count of lines 1)" "2|1" "$RC|$(wc -l < "$R/.a1/dispositions.json" | tr -d ' ')"

# ---------- E: concurrent add ----------
new_repo; pids=()
for i in 1 2 3 4 5 6 7 8; do
  (cd "$R" && node "$TOOLS" disposition add --kind class_sweep --rule class-sweep --file "src/f$i.ts" --text "match $i" --reason "fixture: concurrent $i" --by fx >/dev/null 2>&1) &
  pids+=("$!")
done
rc_all=0; for p in "${pids[@]}"; do wait "$p" || rc_all=1; done
expect "E1 eight parallel adds: every process exit 0" 0 "$rc_all"
expect "E1 store valid with all 8 entries (count)" 8 "$(store 'j.length')"
expect "E1 eight distinct fingerprints (count)" 8 "$(store 'new Set(j.map(e=>e.fingerprint)).size')"
expect "E1 no lock directory and no temp file left (count 0)" 0 "$(find "$R/.a1" -name '*.lock.d' -o -name '*.tmp.*' | wc -l | tr -d ' ')"

# ---------- F: no check CLI has a skip or ignore flag ----------
CHECK_MODULES=("$LIB"/test-fidelity.cjs "$LIB"/fidelity-*.cjs "$LIB"/verify-cli.cjs "$LIB"/verify-check.cjs "$LIB"/verify-run.cjs "$LIB"/verify-base.cjs "$LIB"/verify-reporters.cjs "$LIB"/disposition.cjs "$LIB"/disposition-store.cjs)
expect "F1 check modules scanned (count)" 13 "${#CHECK_MODULES[@]}"
expect "F1 no flag table or argv literal names --skip/--ignore or a skip/ignore flag key (count 0)" 0 \
  "$(grep -hE "(['\"]--?(skip|ignore)[a-z-]*['\"=])|((^|[ {,])['\"]?(skip|ignore)['\"]?: *'(string|bool)')" "${CHECK_MODULES[@]}" | grep -v '^ *//' | wc -l | tr -d ' ')"
new_repo
for cmd in "test-fidelity --diff-base base" "verify run" "verify check $R/none.md" "disposition add"; do
  for flag in --skip --ignore "--skip=1"; do
    # shellcheck disable=SC2086
    (cd "$R" && node "$TOOLS" $cmd $flag >/dev/null 2>&1); rc=$?
    expect "F2 '$cmd $flag' is refused: exit 2" 2 "$rc"
  done
done

# ---------- G: the committed store of this repo ----------
OUT="$(node -e 'const d=require(process.argv[1]+"/disposition.cjs");const e=d.loadEntries(process.argv[2]);console.log(JSON.stringify({n:e.length,files:[...new Set(e.filter(x=>x.kind==="fidelity").map(x=>x.fingerprint.split(":")[1]))].sort(),bad:e.filter(x=>!/fixture data/.test(x.reason)||!/a1-office/.test(x.reason)||x.review==="overturned").length}))' "$LIB" "$REPO_ROOT")"; RC=$?
expect "G1 the repo store loads and validates (exit 0)" 0 "$RC"
expect "G2 each of the 4 real/*.test.ts fixture files has a disposition (count of distinct files)" 4 "$(js 'j.files.filter(f=>/^_test-fixtures\/a1-test-fidelity\/real\/.*\.test\.ts$/.test(f)).length')"
expect "G3 every committed disposition says fixture data from a1-office and none is overturned (count 0)" 0 "$(js 'j.bad')"

echo "a1-disposition: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
