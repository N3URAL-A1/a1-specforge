# Part 01 — spec 018 Wave 1: postmortem fields (FR-001..FR-004), metrics scaffold (FR-016),
# run listing (metrics-runs.cjs). Sourced by run-tests.sh; helpers come from there.
#
# Each case names the single production change that turns it red:
#   PM1 flags written       : fix.cjs not writing found_by / should_have_caught
#   PM2 unknown gate        : postmortem-fields.cjs skipping the registry lookup
#   PM3 legacy              : classifyPostmortem() treating "both absent" as invalid
#   PM4 charset (mutation)  : validateFieldValue() without its charset check -> the `--- x` case
#   PM5/PM7 usage and stubs : the `metrics` group missing from the facade
#   PM8 runs                : metrics-runs.cjs date rule or status filter changed

PM_BASE="$(cd "$FIXT/postmortems" && ls *.md | wc -l | tr -d ' ')"

mk_vault V1 pm1
PMDIR="$V1/project/a1-specforge/postmortems"

# ---- PM0 fixtures are byte copies and the count matches the file system ----
assert_eq "PM0 fixture postmortems copied (count assert, 9 real files)" "$PM_BASE" "9"
n_same=0
for f in "$FIXT"/postmortems/*.md; do cmp -s "$f" "$PMDIR/$(basename "$f")" && n_same=$((n_same + 1)); done
assert_eq "PM0b every vault copy is byte-equal to its fixture (count)" "$n_same" "$PM_BASE"

# ---- PM1 FR-001: flags written; absent -> unknown ----
run_tools "$V1" fix init-postmortem with-flags a1-specforge --date 2026-10-22 \
  --found-by user --should-have-caught gate-0.6-schema
assert_rc "PM1a init-postmortem with both flags" 0 "$RC" "$OUT"
F1="$PMDIR/2026-10-22-with-flags.md"
assert_eq "PM1b found_by: user written (1 line)" "$(grep -c '^found_by: user$' "$F1" 2>/dev/null)" "1"
assert_eq "PM1c should_have_caught: gate-0.6-schema written (1 line)" "$(grep -c '^should_have_caught: gate-0.6-schema$' "$F1" 2>/dev/null)" "1"
run_tools "$V1" fix init-postmortem no-flags a1-specforge --date 2026-10-22
assert_rc "PM1d init-postmortem without the flags" 0 "$RC" "$OUT"
F2="$PMDIR/2026-10-22-no-flags.md"
assert_eq "PM1e found_by defaults to unknown" "$(grep -c '^found_by: unknown$' "$F2")" "1"
assert_eq "PM1f should_have_caught defaults to unknown" "$(grep -c '^should_have_caught: unknown$' "$F2")" "1"
assert_eq "PM1g the file still holds the old key one_line_learning (1 line)" "$(grep -c '^one_line_learning:' "$F2")" "1"

# ---- PM2 FR-002: accepted and rejected values ----
run_tools "$V1" fix init-postmortem rev-ok a1-specforge --date 2026-10-22 --found-by post-merge-ci \
  --should-have-caught reviewer:a1-reinhard-reviewer
assert_rc "PM2a reviewer:<existing agent> passes" 0 "$RC" "$OUT"
run_tools "$V1" fix init-postmortem none-ok a1-specforge --date 2026-10-22 --found-by production --should-have-caught none
assert_rc "PM2b should_have_caught: none passes" 0 "$RC" "$OUT"

# reject <name> <slug> <found-by|-> <should-have-caught|-> <field-in-message> <value-in-message>
reject() {
  local name="$1" slug="$2" fb="$3" shc="$4" field="$5" val="$6" args=()
  [[ "$fb" != "-" ]] && args+=(--found-by "$fb")
  [[ "$shc" != "-" ]] && args+=(--should-have-caught "$shc")
  run_tools "$V1" fix init-postmortem "$slug" a1-specforge --date 2026-10-22 "${args[@]}"
  assert_rc "$name exits 1" 1 "$RC" "$OUT"
  assert_has "$name names the field" "$OUT" "$field"
  assert_has "$name names the value" "$OUT" "$val"
  assert_eq "$name creates no file" "$(ls "$PMDIR" | grep -c -- "-$slug.md")" "0"
}
reject "PM2c unknown gate gate-9-nope" rej-gate - gate-9-nope should_have_caught gate-9-nope
reject "PM2d unknown reviewer" rej-rev - reviewer:a1-nobody should_have_caught reviewer:a1-nobody
reject "PM2e reviewer path traversal" rej-trav - 'reviewer:../x' should_have_caught 'reviewer:../x'
reject "PM2f reviewer:.. (charset ok, set membership fails)" rej-dots - 'reviewer:..' should_have_caught 'reviewer:..'
reject "PM2g found_by none" rej-none none - found_by none
run_tools "$V1" fix init-postmortem fb-gate a1-specforge --date 2026-10-22 --found-by gate-0.6-schema --should-have-caught unknown
assert_rc "PM2h found_by accepts a registered gate id (FR-002 set)" 0 "$RC" "$OUT"
reject "PM2i found_by with an unregistered gate id" rej-fbnope gate-9-nope - found_by gate-9-nope

# ---- PM3 FR-003: legacy postmortems validate with exit 0 ----
legacy_out=""; legacy_rc=0
for f in "$FIXT"/postmortems/*.md; do
  o="$(A1_VAULT_ROOT="$V1" node "$TOOLS" fix validate-postmortem "$f" 2>&1)"; r=$?
  legacy_out+="$o"$'\n'; [[ $r -ne 0 ]] && legacy_rc=$r
done
assert_eq "PM3a validate-postmortem on every real postmortem exits 0" "$legacy_rc" "0"
assert_eq "PM3b prints legacy once per real postmortem (count assert)" "$(grep -c ': legacy' <<<"$legacy_out")" "$PM_BASE"
assert_eq "PM3c none of them is reported invalid (count)" "$(grep -c 'invalid' <<<"$legacy_out")" "0"
run_tools "$V1" fix validate-postmortem "$FIXT"/postmortems/*.md
assert_rc "PM3d several files in one call" 0 "$RC" "$OUT"
assert_eq "PM3e one line per file (count)" "$(grep -c ': legacy' <<<"$OUT")" "$PM_BASE"
run_tools "$V1" fix validate-postmortem "$F1"
assert_rc "PM3f validate-postmortem on a new file" 0 "$RC" "$OUT"
assert_has "PM3g reports valid" "$OUT" ": valid"
run_tools "$V1" fix validate-postmortem "$F2"
assert_rc "PM3h unknown/unknown is valid" 0 "$RC" "$OUT"

# half-legacy: one key present, the other absent
HALF="$V1/half.md"
grep -v '^should_have_caught:' "$F1" > "$HALF"
run_tools "$V1" fix validate-postmortem "$HALF"
assert_rc "PM3i half-legacy file (found_by only) is invalid" 1 "$RC" "$OUT"
assert_has "PM3j names the missing key" "$OUT" "should_have_caught"
BADV="$V1/badvalue.md"
sed 's/^should_have_caught: .*/should_have_caught: gate-9-nope/' "$F1" > "$BADV"
run_tools "$V1" fix validate-postmortem "$BADV"
assert_rc "PM3k a bad value in an existing file is invalid" 1 "$RC" "$OUT"
assert_has "PM3l names the value" "$OUT" "gate-9-nope"
run_tools "$V1" fix validate-postmortem "$V1/does-not-exist.md"
assert_rc "PM3m missing file exits 2" 2 "$RC" "$OUT"
run_tools "$V1" fix validate-postmortem "$V1"
assert_rc "PM3n directory in place of a file exits 2" 2 "$RC" "$OUT"
run_tools "$V1" fix validate-postmortem
assert_rc "PM3o no file argument is a usage error" 1 "$RC" "$OUT"
INJ="$V1/inject.md"
printf -- '---\ntype: postmortem\nfound_by: user\nshould_have_caught: "x\\n---"\n---\nbody\n' > "$INJ"
run_tools "$V1" fix validate-postmortem "$INJ"
assert_rc "PM3p YAML-injection value in an old file is read as data (invalid, no crash)" 1 "$RC" "$OUT"

# ---- PM4 FR-004: the write path refuses hostile values; no file appears ----
before="$(ls "$PMDIR" | wc -l | tr -d ' ')"
hostile() {
  local name="$1" slug="$2" val="$3"
  run_tools "$V1" fix init-postmortem "$slug" a1-specforge --date 2026-10-22 --should-have-caught "$val"
  [[ $RC -ne 0 && $RC -le 2 ]] && ok "$name exits non-zero (exit $RC)" || bad "$name: exit $RC"
  assert_eq "$name creates no file" "$(ls "$PMDIR" | grep -c -- "-$slug.md")" "0"
  grep -q 'Traceback\|    at ' <<<"$OUT" && bad "$name prints no stack trace" || ok "$name prints no stack trace"
}
hostile "PM4a newline in the value" h-nl "$(printf 'gate-0.6-schema\ntype: injected')"
hostile "PM4b '--- x' value" h-dash '--- x'
hostile "PM4c space in the value" h-space 'gate 0.6'
hostile "PM4d 200-character value" h-200 "$(printf 'a%.0s' $(seq 1 200))"
hostile "PM4e command substitution is inert" h-sub '$(touch /tmp/a1-metrics-pwned)'
hostile "PM4f backticks are inert" h-tick '`id`'
hostile "PM4g semicolon is inert" h-semi 'none; rm -rf /'
hostile "PM4h 10001-character value" h-10k "$(head -c 10001 /dev/zero | tr '\0' 'a')"
hostile "PM4i empty value" h-empty ''
# The closed sets would also reject these values; the charset check is the FIRST line of defence,
# so its message is what proves it ran (mutation: charset check removed -> these three go red).
for pair in "PM4m:--- x" "PM4n:gate 0.6" "PM4o:a/b"; do
  run_tools "$V1" fix init-postmortem h-cs a1-specforge --date 2026-10-22 --should-have-caught "${pair#*:}"
  assert_has "${pair%%:*} charset message for '${pair#*:}'" "$OUT" "only letters, digits"
done
assert_eq "PM4j nothing escaped into /tmp" "$([[ -e /tmp/a1-metrics-pwned ]] && echo yes || echo no)" "no"
run_tools "$V1" fix init-postmortem h-fb a1-specforge --date 2026-10-22 --found-by "$(printf 'user\r')"
assert_rc "PM4k carriage return in found_by" 1 "$RC" "$OUT"
after="$(ls "$PMDIR" | wc -l | tr -d ' ')"
assert_eq "PM4l no hostile case left a file behind (directory entry count unchanged)" "$((after - before))" "0"

# ---- PM5 FR-016: metrics group, usage, help ----
run_tools "$V1" metrics
assert_rc "PM5a metrics without a subcommand exits 1" 1 "$RC" "$OUT"
assert_has "PM5b usage names escaped" "$OUT" "metrics escaped"
assert_has "PM5c usage names cost" "$OUT" "metrics cost"
run_tools "$V1" metrics bogus
assert_rc "PM5d unknown metrics subcommand exits 1" 1 "$RC" "$OUT"
run_tools "$V1" --help
for cmd in 'metrics escaped' 'metrics cost' 'fix validate-postmortem'; do
  assert_eq "PM5e help lists '$cmd' (count)" "$(grep -c "a1-tools $cmd" <<<"$OUT")" "1"
done
for flag in '--last' '--project' '--json' '--group-by' '--fail-above'; do
  assert_has "PM5f help names the flag $flag" "$OUT" "$flag"
done
run_tools "$V1" bogus-group
assert_rc "PM5g unknown group exits 1" 1 "$RC" "$OUT"
HEAD_TXT="$(sed -n 1,200p "$TOOLS")"
for cmd in 'metrics escaped' 'metrics cost' 'fix validate-postmortem'; do
  assert_has "PM5h header comment lists '$cmd'" "$HEAD_TXT" "a1-tools $cmd"
  assert_has "PM5i unknown-group usage string lists '$cmd'" "$(grep -n 'unknown command group' "$TOOLS")" "$cmd"
done

# ---- PM6 the report commands are real (no stub left) ----
run_tools "$V1" metrics escaped --project a1-specforge
assert_rc "PM6a metrics escaped runs and exits 0" 0 "$RC" "$OUT"
assert_has "PM6b metrics escaped prints a report" "$OUT" "escaped"
run_tools "$V1" metrics cost --project a1-specforge
assert_rc "PM6c metrics cost runs and exits 0" 0 "$RC" "$OUT"
assert_has "PM6d metrics cost prints coverage" "$OUT" "coverage:"

# ---- PM7 metrics writes no gate-log line (no registry invoke cell names it) ----
mkdir "$V1/repo" && ( cd "$V1/repo" && git init -q . )
( cd "$V1/repo" && A1_VAULT_ROOT="$V1" node "$TOOLS" metrics escaped --project a1-specforge >/dev/null 2>&1; true )
assert_eq "PM7 no gate-log.jsonl after a metrics call" "$(find "$V1/repo" -name 'gate-log.jsonl' | wc -l | tr -d ' ')" "0"

# ---- PM8 metrics-runs.cjs: listRuns / lastN / vaultOrExit2 ----
RUNS_JS="$SHARED/lib/metrics-runs.cjs"
runs_json() { # <vault> <slug>
  A1_VAULT_ROOT="$1" node -e '
    const r = require(process.argv[1]);
    process.stdout.write(JSON.stringify(r.listRuns(process.env.A1_VAULT_ROOT, process.argv[2])));
  ' "$RUNS_JS" "$2" 2>&1
}
mk_vault V2 runs
RJ="$(runs_json "$V2" a1-specforge)"
jq_node() { node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String(eval(process.argv[1])))' "$1" <<<"$RJ"; }
assert_eq "PM8a 14 runs: 3 done specs + 11 fixed fix reports (count)" "$(jq_node 'j.length')" "14"
assert_eq "PM8b spec runs (count)" "$(jq_node 'j.filter(r=>r.kind==="spec").length')" "3"
assert_eq "PM8c fix runs (count)" "$(jq_node 'j.filter(r=>r.kind==="fix").length')" "11"
assert_eq "PM8d spec date = last phase_history timestamp (015)" "$(jq_node 'j.find(r=>r.id.startsWith("015")).date')" "2026-10-14"
assert_eq "PM8e spec date skips a non-ISO tail (008 -> 2026-09-13)" "$(jq_node 'j.find(r=>r.id.startsWith("008")).date')" "2026-09-13"
assert_eq "PM8f fix date = filename prefix" "$(jq_node 'j.find(r=>r.id.includes("intent-approve-guard")).date')" "2026-10-08"
assert_eq "PM8g status 'reported' fix is not a run (count)" "$(jq_node 'j.filter(r=>r.id.includes("verify-merge-check-review-minors")).length')" "0"
assert_eq "PM8h status 'duplicate' fix is not a run (count)" "$(jq_node 'j.filter(r=>r.id.includes("xprov-preflight-config-allowlist")).length')" "0"
assert_eq "PM8i *.postmortem.md is skipped (count)" "$(jq_node 'j.filter(r=>r.id.includes("postmortem")).length')" "0"
assert_eq "PM8j clarified spec 006 is not a run (count)" "$(jq_node 'j.filter(r=>r.id.startsWith("006")).length')" "0"
assert_eq "PM8k sorted by date then id" "$(jq_node 'j.every((r,i)=>i===0||(j[i-1].date<r.date||(j[i-1].date===r.date&&j[i-1].id<=r.id)))')" "true"
assert_eq "PM8l lastN(3) keeps the 3 newest" "$(A1_VAULT_ROOT="$V2" node -e 'const m=require(process.argv[1]);const r=m.listRuns(process.env.A1_VAULT_ROOT,"a1-specforge");const l=m.lastN(r,3);process.stdout.write(l.length+":"+(l[2]===r[r.length-1]||JSON.stringify(l[2])===JSON.stringify(r[r.length-1])))' "$RUNS_JS")" "3:true"
assert_eq "PM8m lastN(100) on 14 runs returns 14" "$(node -e 'const m=require(process.argv[1]);process.stdout.write(String(m.lastN(new Array(14).fill({}),100).length))' "$RUNS_JS")" "14"
# date fallback to `created` when there is no phase_history timestamp
grep -v '^  - "phase=' "$FIXT/spec/006-specforge-kritis-profile.md" | sed 's/^status: clarified$/status: done/' > "$V2/project/a1-specforge/spec/006-specforge-kritis-profile.md"
RJ="$(runs_json "$V2" a1-specforge)"
assert_eq "PM8n date falls back to created (006 -> 2026-09-03)" "$(jq_node 'j.find(r=>r.id.startsWith("006")).date')" "2026-09-03"
assert_eq "PM8o 15 runs now (count)" "$(jq_node 'j.length')" "15"
# empty and hostile
mkdir -p "$V2/project/empty"
assert_eq "PM8p project without runs lists none" "$(runs_json "$V2" empty)" "[]"
RJ="$(runs_json "$V2" ../../etc)"
assert_has "PM8q traversal slug is refused" "$RJ" "plain identifier"
# vaultOrExit2
vx() { env -u A1_VAULT_ROOT node -e 'require(process.argv[1]).vaultOrExit2()' "$RUNS_JS" 2>&1; }
OUT="$(vx)"; RC=$?
assert_rc "PM8r vault unset exits 2" 2 "$RC" "$OUT"
assert_has "PM8s message names A1_VAULT_ROOT" "$OUT" "A1_VAULT_ROOT"
OUT="$(A1_VAULT_ROOT="$V2/nope" node -e 'require(process.argv[1]).vaultOrExit2()' "$RUNS_JS" 2>&1)"; RC=$?
assert_rc "PM8t vault path absent exits 2" 2 "$RC" "$OUT"
OUT="$(A1_VAULT_ROOT="$V2" node -e 'process.stdout.write(require(process.argv[1]).vaultOrExit2())' "$RUNS_JS" 2>&1)"; RC=$?
assert_rc "PM8u vault present returns the root" 0 "$RC" "$OUT"
assert_eq "PM8v returns the root path" "$OUT" "$V2"
OUT="$(env -u A1_VAULT_ROOT bash -c 'mkdir -p "$1" && cd "$1" && git init -q . && node "$2" metrics escaped --project x' _ "$V2/repo" "$TOOLS" 2>&1)"; RC=$?
assert_rc "PM8w metrics with the vault unset exits 2 (even inside a git repo)" 2 "$RC" "$OUT"
assert_eq "PM8x no .a1/learnings created by the unset case" "$([[ -e "$V2/repo/.a1/learnings" ]] && echo yes || echo no)" "no"
