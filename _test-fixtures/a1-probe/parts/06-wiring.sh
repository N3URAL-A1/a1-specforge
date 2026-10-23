# parts/06-wiring.sh — spec 020 Wave 6: registry row, call sites, intent-child refusal, help, suite inventory
# (FR-016, FR-017, FR-018, FR-020; carry-over: the gate-log half of the FR-009 leak proof; SC-005, SC-006).
# Doc edits are checked by count, never by a bare presence grep. Loopback only; the gate-log case runs in a
# git repo of its own (the log hangs off the project dir). Mutation proofs run on a git-archive snapshot.

stop_server; start_server
H="127.0.0.1"
REG="$REPO_ROOT/_shared/gates-registry.md"
NF="$REPO_ROOT/skills/a1-new-feature/workflows/06-verify.md"
MG="$REPO_ROOT/skills/a1-pr-review/workflows/05-merge.md"
FX="$REPO_ROOT/skills/a1-fix/workflows/04-verify.md"
VIC="$REPO_ROOT/agents/a1-victor-verifier.md"
cnt() { grep -cE -- "$1" "$2" 2>/dev/null || true; }  # cnt <ERE> <file> — number of matching lines

# --- FR-016: registry row + gates lint ---------------------------------------------------------------------
expect "G1 registry holds exactly one live-probes row" "1" "$(cnt '^\| `live-probes` \|' "$REG")"
expect "G1 row is deterministic and blocking" "1" "$(cnt '^\| `live-probes` \| [^|]+\| deterministic \| [^|]+\| [^|]+\| blocking \|' "$REG")"
expect "G1 invoke cell is exactly the probe run call for both skills" "1" "$(cnt '^\| `live-probes` .*\| `probe run` @ a1-new-feature,a1-pr-review \|$' "$REG")"
LINT="$(node "$TOOLS" gates lint 2>&1)"; LRC=$?
expect "G2 gates lint exits 0" "0" "$LRC"
expect "G2 lint reports no finding at all" "1" "$(grep -c '"findings":\[\]' <<<"$LINT")"
expect_has "G2 lint sees live-probes wired in a1-new-feature" "$LINT" '"gate":"live-probes","subcommand":"probe run","skill":"a1-new-feature","calls":1'
expect_has "G2 lint sees live-probes wired in a1-pr-review" "$LINT" '"gate":"live-probes","subcommand":"probe run","skill":"a1-pr-review","calls":1'
expect_lacks "G2 no unwired finding" "$LINT" 'unwired'
expect_lacks "G2 no call_without_phase finding" "$LINT" 'call_without_phase'

# gate log: one line per run with --phase, gate live-probes, exit code; secret and body marker absent (FR-009)
GP="$WORK/gatelog"; : "${GP:?}"
mkdir -p "$GP/.a1"; git -C "$GP" init -q . 2>/dev/null
SEC6="zq6-$RANDOM$RANDOM-$$"
cat > "$GP/.a1/live-probes.yaml" <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: gl-pass
    kind: http
    url: http://$H:$HTTP_PORT/ok
    expect:
      status: 200
  - id: gl-body
    kind: http
    url: http://$H:$HTTP_PORT/marker
    expect:
      status: 500
YML
gp_commit() { git -C "$GP" add -A -f >/dev/null 2>&1; git -C "$GP" -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q --allow-empty -m fx >/dev/null 2>&1; git -C "$GP" update-ref refs/remotes/origin/main HEAD; }
gp_commit
GLOG="$GP/.a1/phases/020-live-probes/gate-log.jsonl"
SRV_B="$(srv_total)"
A1_PROBE_ALLOW_LOOPBACK=1 node "$TOOLS" probe run --project "$GP" --phase 020-live-probes >"$WORK/g.out" 2>"$WORK/g.err"; GRC=$?
expect "G3 run with --phase exits 0 (both probes pass)" "0" "$GRC"
expect "G3 the run reached the server (count assert beside the log assert)" "2" "$(( $(srv_total) - SRV_B ))"
expect "G3 gate log has exactly one line" "1" "$(wc -l < "$GLOG" 2>/dev/null | tr -d ' ')"
GL="$(cat "$GLOG" 2>/dev/null)"
expect_count "G3 the line names gate live-probes" "1" "$GL" '"gate":"live-probes"'
expect_count "G3 the line carries the exit code 0" "1" "$GL" '"exit":0'
expect_count "G3 the line carries the scope" "1" "$GL" '"scope":"020-live-probes"'
expect_lacks "G3 --phase did not reach the probe parser (no usage error)" "$(cat "$WORK/g.err")" "unknown argument"
# a failing run logs its exit code too
cat > "$GP/.a1/live-probes.yaml" <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: gl-fail
    kind: http
    url: http://$H:$HTTP_PORT/marker
    expect:
      status: 200
  - id: gl-tls
    kind: http
    url: https://$H:$HTTP_PORT/echo-secret
    headers:
      X-Api-Key: {env: A1_FX_SECRET6}
    expect:
      status: 200
YML
gp_commit; A1_FX_SECRET6="$SEC6" A1_PROBE_ALLOW_LOOPBACK=1 node "$TOOLS" probe run --project "$GP" --phase 020-live-probes >"$WORK/g2.out" 2>"$WORK/g2.err"; GRC2=$?
expect "G3b failing run exits 1" "1" "$GRC2"
expect "G3b gate log now has two lines" "2" "$(wc -l < "$GLOG" | tr -d ' ')"
expect_count "G3b the second line carries exit 1" "1" "$(cat "$GLOG")" '"exit":1'
GFILES="$(cat "$GLOG"; cat "$WORK/g.out" "$WORK/g.err" "$WORK/g2.out" "$WORK/g2.err")"
expect_has "G4 the failing run did carry the secret-bearing probe (haystack not vacuous)" "$(cat "$WORK/g2.out")" "gl-tls http"
expect "G4 leak search covers a non-empty haystack" "1" "$([[ -n "$GFILES" ]] && echo 1 || echo 0)"
expect "G4 secret absent from the gate log (count 0)" "0" "$(grep -cF -- "$SEC6" "$GLOG")"
expect "G4 body marker absent from the gate log (count 0)" "0" "$(grep -cF -- "BODYMARK-7f3a91" "$GLOG")"
expect "G4 secret absent from the run output (count 0)" "0" "$(grep -cF -- "$SEC6" <<<"$GFILES")"
# without --phase the line goes to the _unscoped scope; the named scope keeps its two lines
gp_commit; A1_PROBE_ALLOW_LOOPBACK=1 node "$TOOLS" probe run --project "$GP" >/dev/null 2>&1
expect "G5 a run without --phase writes nothing under phases/020-live-probes" "2" "$(wc -l < "$GLOG" | tr -d ' ')"
# hostile scope: refused before anything runs
probe run --project "$GP" --phase ../x
expect "G5b traversal scope exits 2" "2" "$RC"

# --- FR-017: call sites ------------------------------------------------------------------------------------
expect "D1 06-verify.md has one fenced probe run call with --phase <spec-id>" "1" "$(cnt '^ *node <repo>/_shared/a1-tools\.cjs probe run --project <dir> --phase <spec-id> --wait 120; RC=\$\?' "$NF")"
expect "D1 06-verify.md stops on a non-zero exit (STOP line for probe run)" "1" "$(cnt 'STOP: probe run exit=' "$NF")"
expect "D1 06-verify.md has the Live probes section for VERIFICATION.md" "1" "$(cnt '^## Live probes|`## Live probes`' "$NF")"
expect "D1 06-verify.md names the no_probes wording" "1" "$(cnt 'not verified live \(no_probes\)' "$NF")"
expect "D1b 06-verify.md says a probe-file change goes through a new PR (probes_config_changed)" "1" "$(cnt 'A probe-file change goes through a new PR' "$NF")"
expect "D1b 06-verify.md names the deploy condition" "1" "$(cnt 'the deploy of the merged `main` is$' "$NF")"
expect "D1b 06-verify.md drops the old wording" "0" "$(cnt 'fix the cause or the probe file' "$NF")"
expect "D5 the offline case is skipped, not counted as a pass (no ok() on the skip path)" "0" "$(cnt 'ok "L4 offline case skipped' "$REPO_ROOT/_test-fixtures/a1-probe/parts/05-leak.sh")"
expect "D5 probe.cjs has no process.exit after the report (only die() exits)" "1" "$(cnt 'process\.exit\(' "$SHARED/lib/probe.cjs")"
LC="$(grep -n 'probe run --project' "$NF" | head -1 | cut -d: -f1)"; M3="$(grep -n '^3\. \*\*Merge\*\*' "$NF" | head -1 | cut -d: -f1)"
M4="$(grep -n '^4\. \*\*Origin cleanup\*\*' "$NF" | head -1 | cut -d: -f1)"
if [[ -n "$LC" && -n "$M3" && -n "$M4" && "$LC" -gt "$M3" && "$LC" -lt "$M4" ]]; then ok "D1 the probe block sits right after Lifecycle step 3 (before step 4)"; else bad "D1 probe block position (call=$LC step3=$M3 step4=$M4)"; fi
expect "D2 05-merge.md has the 5.5 heading" "1" "$(cnt '^## 5\.5 Live probes' "$MG")"
expect "D2 05-merge.md calls probe run with --phase pr-<n>" "1" "$(cnt '^node <repo>/_shared/a1-tools\.cjs probe run --project <dir> --phase pr-<n> --wait 120; RC=\$\?' "$MG")"
expect "D2 05-merge.md 5.3 lists probes_config_changed as a blocking finding" "1" "$(cnt '^- `probes_config_changed`' "$MG")"
expect "D2 05-merge.md 5.3 says four findings" "1" "$(cnt '^Four findings block' "$MG")"
S53="$(grep -n '^## 5\.3 ' "$MG" | cut -d: -f1)"; S54="$(grep -n '^## 5\.4 ' "$MG" | cut -d: -f1)"; S55="$(grep -n '^## 5\.5 ' "$MG" | cut -d: -f1)"
if [[ -n "$S53" && -n "$S54" && -n "$S55" && "$S53" -lt "$S54" && "$S54" -lt "$S55" ]]; then ok "D2 5.5 comes after 5.4"; else bad "D2 section order (5.3=$S53 5.4=$S54 5.5=$S55)"; fi
expect "D3 a1-fix 04-verify.md Step 3 has the prose pointer to a1-pr-review 5.5" "1" "$(cnt 'Live verification of a fix runs in a1-pr-review 5\.5' "$FX")"
expect "D3 a1-fix has no probe run call form (not a call site)" "0" "$(cnt 'a1-tools(\.cjs)? probe run' "$FX")"
expect "D4 Victor holds the verified-live rule" "1" "$(cnt 'verified live.*(probe result line|no_probes)' "$VIC")"

# --- FR-018: intent child refused --------------------------------------------------------------------------
cat > "$WORK/ic.yml" <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: ic
    kind: http
    url: http://$H:$HTTP_PORT/ok
    expect:
      status: 200
YML
put ichild < "$WORK/ic.yml"
SRV_C="$(srv_total)"
commit_all; IC_OUT="$(A1_INTENT_CHILD=1 A1_PROBE_ALLOW_LOOPBACK=1 node "$TOOLS" probe run --project "$D" 2>/dev/null)"; ICRC=$?
expect "I1 child run exits 77" "77" "$ICRC"
expect_has "I1 stdout names intent_child_refused" "$IC_OUT" "intent_child_refused"
expect "I1 the loopback server counted 0 requests" "0" "$(( $(srv_total) - SRV_C ))"
commit_all; IC2="$(A1_INTENT_CHILD=1 A1_INTENT_ID=fx-intent A1_PROBE_ALLOW_LOOPBACK=1 node "$TOOLS" probe run --project "$D" --json 2>/dev/null)"; IC2RC=$?
expect "I2 child run with an intent id exits 77 as well" "77" "$IC2RC"
expect "I2 still 0 requests" "0" "$(( $(srv_total) - SRV_C ))"
commit_all; expect "I3 control: the same call outside child mode exits 0 and does reach the server" "0" "$(A1_PROBE_ALLOW_LOOPBACK=1 node "$TOOLS" probe run --project "$D" >/dev/null 2>&1; echo $?)"
expect "I3 control reached the server once (count)" "1" "$(( $(srv_total) - SRV_C ))"
SBX="$REPO_ROOT/_shared/lib/intent-sandbox.cjs"
expect "I4 intent-sandbox records probe run as a deliberate exclusion with a reason" "1" "$(cnt "'probe run': NETWORK" "$SBX")"
expect "I4 NETWORK reason cites spec 020 FR-018" "1" "$(cnt "^const NETWORK = .*spec 020 FR-018" "$SBX")"
expect "I4 probe run is on no allowlist (count over the allowlist literal)" "0" "$(node -e 'const C=require(process.argv[1]+"/lib/intent-constants.cjs");process.stdout.write(String(Object.values(C.INTENT_CHILD_ALLOWLIST).flat().filter(s=>/^probe /.test(s)).length))' "$SHARED")"

# --- FR-020: help, header, usage, group without subcommand --------------------------------------------------
HELP="$(node "$TOOLS" --help 2>&1)"
expect_has "H1 help lists probe run" "$HELP" "a1-tools probe run --project <dir>"
expect "H1 the CLI header lists probe run once" "1" "$(grep -c '^ \*   a1-tools probe run' "$TOOLS")"
probe frobnicate
expect "H2 unknown probe subcommand exits 2" "2" "$RC"
probe
expect "H2 'probe' alone exits 2" "2" "$RC"
expect_has "H2 'probe' alone names the subcommand" "$ERR" 'requires the subcommand "run"'
USAGE="$(node "$TOOLS" zzz-group 2>&1)"
expect_has "H3 unknown-group usage lists probe" "$USAGE" '"probe"'
expect_has "H3 usage text names probe run" "$USAGE" "probe run"
HP="$(node "$TOOLS" --help 2>&1 | sed -n '/a1-tools probe run/,/Not available to intent children/p')"
for tok in --phase env_header_over_http env_query_over_http too_many_probes config_name_variant config_case_variant a1_dir_symlink a1_dir_submodule probes_file_uncommitted probes_no_reviewed_ref probes_file_unreviewed body_mismatch json_mismatch header_mismatch unexpected_open unexpected_closed bad_request timeout_budget A1_PROBE_ALLOW_LOOPBACK; do
  expect_has "H4 help documents $tok" "$HP" "$tok"
done
expect_has "H6 help names the one-clock run budget" "$HP" "5 min plus the --wait window"
expect_lacks "H6 the old per-run wording is gone" "$HP" "5 min per run"
expect_has "H7 merge-check help documents the unchanged special .a1 state" "$(node "$TOOLS" --help 2>&1)" "even when it is unchanged between base and head"
SIZE="$(wc -l < "$SHARED/lib/help-probe.cjs" | tr -d ' ')"
if [[ "$SIZE" -lt 400 ]]; then ok "H5 help-probe.cjs stays under 400 lines ($SIZE)"; else bad "H5 help-probe.cjs is $SIZE lines"; fi

# --- install-sync + docs ------------------------------------------------------------------------------------
IS="$(bash "$REPO_ROOT/bin/verify-install-sync.sh" 2>&1)"; ISRC=$?
expect "S1 install-sync exits 0" "0" "$ISRC"
expect "S2 CONTRIBUTING lists the a1-probe suite once" "1" "$(cnt '`a1-probe`' "$REPO_ROOT/CONTRIBUTING.md")"
expect "S2 README CLI section lists probe run once" "1" "$(cnt 'probe run --project' "$REPO_ROOT/README.md")"
expect "S2 README points to help probe / the yaml format" "1" "$(cnt 'live-probes\.yaml' "$REPO_ROOT/README.md")"

# --- per-FR case inventory over all parts (>= 19 requirements) ---------------------------------------------
INV=""
for n in $(seq 1 20); do
  id="$(printf 'FR-%03d' "$n")"
  hits="$(cat "$SUITE_DIR"/parts/[0-9][0-9]-*.sh | grep -c -- "$id")"
  [[ "$hits" -ge 1 ]] && INV="$INV $id"
done
INVN="$(wc -w <<<"$INV" | tr -d ' ')"
if [[ "$INVN" -ge 19 ]]; then ok "V1 per-FR case inventory covers $INVN requirements (>= 19)"; else bad "V1 inventory covers only $INVN requirements:$INV"; fi
for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  id="$(printf 'FR-%03d' "$n")"
  [[ "$INV" == *"$id"* ]] || bad "V1 no case names $id"
done
PARTS_N="$(ls "$SUITE_DIR"/parts/[0-9][0-9]-*.sh | wc -l | tr -d ' ')"
expect "V2 the suite has 6 parts" "6" "$PARTS_N"
stop_server
