#!/usr/bin/env bash
# Part 01 — Wave 1: supply chain, registry rows, fixture corpus, ADR, facade.
# Sourced by run-tests.sh (never run on its own): uses its helpers, counters
# and frozen expectations. Cases from the wave plan's Wave 1 fixture table
# (R1, R22 static arm, R23, R27, R29) plus two Wave-1-only additions: F1
# (facade dispatch, with the mandatory hostile input for the new command
# group) and H1 (harness self-check, so a broken helper is found now, not in
# Wave 2). Every case names the single production change that turns it red.

# ---------- R22 (static arm): the runner a1 executes is the vendored, pinned one ----------
# Red-making change: resolving the runner from the plugin cache (the grep
# finds the path literal, and vendoredRunnerPath() no longer resolves under
# _shared/vendor/). Companion arms: the REAL tree's pin verifies, VENDORED.md
# names version / commit / sha, the LICENSE is MIT.
caseR22_static() {
  if sums_check "$VENDOR"; then ok "R22a shasum -c SHA256SUMS passes in the real tree"
  else bad "R22a shasum -c SHA256SUMS fails in the real tree"; fi

  local actual; actual="$(sha256_of "$VENDOR/runner.py")"
  assert_eq "R22b vendored runner.py sha256 is the audited value" "$actual" "$EXPECTED_RUNNER_SHA256"

  local v; v="$VENDOR/VENDORED.md"
  if [[ -f "$v" ]] && grep -q "$EXPECTED_RUNNER_VERSION" "$v" && grep -q "$EXPECTED_UPSTREAM_COMMIT" "$v" \
     && grep -q "$EXPECTED_RUNNER_SHA256" "$v" && grep -qi "stdlib\|standard library" "$v" \
     && grep -qi "no network" "$v" && grep -qi "argv" "$v" && grep -qi "stdin" "$v"; then
    ok "R22c VENDORED.md names version, commit, sha256 and the F-052 audit points"
  else bad "R22c VENDORED.md is missing version/commit/sha/audit summary"; fi

  if [[ -f "$VENDOR/LICENSE" ]] && grep -q "MIT License" "$VENDOR/LICENSE" \
     && grep -q "Permission is hereby granted, free of charge" "$VENDOR/LICENSE"; then
    ok "R22d LICENSE is the upstream MIT text"
  else bad "R22d LICENSE missing or not MIT"; fi

  local hits; hits="$(grep -rn "plugins/cache/claudex" "$REPO_ROOT/_shared/lib" "$REPO_ROOT/skills" 2>/dev/null || true)"
  if [[ -z "$hits" ]]; then ok "R22e no plugin-cache path literal under _shared/lib or skills/"
  else bad "R22e plugin-cache path literal found: $hits"; fi

  local resolved; resolved="$(node -e "
    const x = require(process.argv[1]); const fs = require('fs');
    process.stdout.write(fs.realpathSync(x.vendoredRunnerPath()));
  " "$XPROV_LIB" 2>&1)"
  local want; want="$(cd "$VENDOR" && pwd -P)/runner.py"
  assert_eq "R22f vendoredRunnerPath() resolves to _shared/vendor/claudex-loop/runner.py" "$resolved" "$want"
}

# ---------- R23: a one-byte change to the vendored runner is refused ----------
# Red-making change: making checkRunnerPin() tolerate a mismatch, or skipping
# the check when SHA256SUMS is unreadable (an absent pin must be a FAIL).
caseR23() {
  local t; t="$(mktemp -d)"
  cp -R "$REPO_ROOT/_shared" "$t/_shared"
  local vend="$t/_shared/vendor/claudex-loop"
  # flip byte 0 ('#' of the shebang) to '%'
  printf '%%' | dd of="$vend/runner.py" bs=1 seek=0 count=1 conv=notrunc 2>/dev/null

  if sums_check "$vend"; then bad "R23a shasum -c still passes after a one-byte flip"
  else ok "R23a shasum -c fails after a one-byte flip of the copy"; fi

  local out
  out="$(node -e "
    const x = require(process.argv[1]);
    const r = x.checkRunnerPin({ runnerPath: process.argv[2] + '/runner.py', sumsPath: process.argv[2] + '/SHA256SUMS' });
    process.stdout.write(JSON.stringify({ ok: r.ok, reason: r.reason, expected: r.expected }));
  " "$t/_shared/lib/xprov.cjs" "$vend" 2>&1)"
  assert_json "R23b checkRunnerPin on the flipped copy → ok:false, reason:mismatch" "$out" \
    "j.ok + '/' + j.reason + '/' + j.expected" "false/mismatch/$EXPECTED_RUNNER_SHA256"

  rm -f "$vend/SHA256SUMS"
  out="$(node -e "
    const x = require(process.argv[1]);
    const r = x.checkRunnerPin({ runnerPath: process.argv[2] + '/runner.py', sumsPath: process.argv[2] + '/SHA256SUMS' });
    process.stdout.write(JSON.stringify({ ok: r.ok, reason: r.reason }));
  " "$t/_shared/lib/xprov.cjs" "$vend" 2>&1)"
  assert_json "R23c checkRunnerPin without SHA256SUMS → ok:false, reason:sums_unreadable (never a skip)" \
    "$out" "j.ok + '/' + j.reason" "false/sums_unreadable"

  out="$(node -e "
    const x = require(process.argv[1]);
    const r = x.checkRunnerPin();
    process.stdout.write(JSON.stringify({ ok: r.ok, reason: r.reason, actual: r.actual }));
  " "$XPROV_LIB" 2>&1)"
  assert_json "R23d checkRunnerPin() on the real tree → ok:true with the audited sha" "$out" \
    "j.ok + '/' + j.reason + '/' + j.actual" "true/null/$EXPECTED_RUNNER_SHA256"
}

# ---------- R27: every case file has a provenance sibling; the corpus is honest ----------
# Red-making change: dropping a .meta file or its origin field. Companion
# arms keep the corpus consistent with what produced it: the plan sha in a
# captured record equals the sha256 of the PLAN.md next to it, the schema is
# the runner's own contract, empty is 0 bytes, malformed does not parse.
caseR27() {
  local required="approved revise blocked failed empty malformed"
  local name meta origin missing=""
  for name in $required; do
    [[ -f "$CASES/$name.result.json" ]] || missing="$missing $name.result.json"
    meta="$CASES/$name.meta"
    if [[ ! -f "$meta" ]]; then missing="$missing $name.meta"; continue; fi
    origin="$(grep -E '^origin:' "$meta" | awk '{print $2}')"
    [[ "$origin" == "captured" || "$origin" == "synthetic" ]] || missing="$missing $name.meta:origin=$origin"
    grep -qE '^captured_on: [0-9]{4}-[0-9]{2}-[0-9]{2}$' "$meta" || missing="$missing $name.meta:captured_on"
    grep -qE '^cli_version: ' "$meta" || missing="$missing $name.meta:cli_version"
    grep -qE "^runner_sha256: [0-9a-f]{64}$" "$meta" || missing="$missing $name.meta:runner_sha256"
  done
  if [[ -z "$missing" ]]; then ok "R27a six case files, each with a .meta naming origin, date, CLI version, runner sha"
  else bad "R27a corpus incomplete:$missing"; fi

  # every *.result.json (not only the six required) has a .meta
  local extra=""
  for f in "$CASES"/*.result.json; do
    name="$(basename "$f" .result.json)"
    [[ -f "$CASES/$name.meta" ]] || extra="$extra $name"
  done
  [[ -z "$extra" ]] && ok "R27b no result file without a .meta sibling" || bad "R27b result file(s) without .meta:$extra"

  assert_eq "R27c approved.meta says captured (the real probe output)" \
    "$(grep -E '^origin:' "$CASES/approved.meta" | awk '{print $2}')" "captured"
  assert_eq "R27d blocked.meta records its attempts" \
    "$(grep -cE '^attempts: [0-9]+$' "$CASES/blocked.meta")" "1"

  # a captured record's plan_sha256 equals the sha256 of the PLAN.md beside it
  local rec plan_sha
  for name in approved revise blocked; do
    rec="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).plan_sha256)" "$CASES/$name.result.json" 2>&1)"
    plan_sha="$(sha256_of "$CASES/$name.PLAN.md")"
    assert_eq "R27e $name.result.json plan_sha256 equals sha256($name.PLAN.md)" "$rec" "$plan_sha"
  done

  # captured records carry the measured CLI version and the runner sha in .meta
  for name in approved revise blocked failed; do
    assert_json "R27f $name.result.json cli_version is the measured one" \
      "$(cat "$CASES/$name.result.json")" "j.cli_version" "$EXPECTED_CLI_VERSION"
    assert_eq "R27g $name.meta runner_sha256 is the audited pin" \
      "$(grep -E '^runner_sha256:' "$CASES/$name.meta" | awk '{print $2}')" "$EXPECTED_RUNNER_SHA256"
  done

  # the four captured verdict/status shapes are what their names claim
  assert_json "R27h approved is status:completed / APPROVED / no findings" "$(cat "$CASES/approved.result.json")" \
    "j.status + '/' + j.mode + '/' + j.response.verdict + '/' + j.response.findings.length" "completed/review/APPROVED/0"
  assert_json "R27i revise is REVISE with one high finding at path:line" "$(cat "$CASES/revise.result.json")" \
    "j.response.verdict + '/' + j.response.findings[0].severity + '/' + j.response.findings[0].path" "REVISE/high/test/add.test.js:3"
  assert_json "R27j blocked is BLOCKED with limitations and no findings" "$(cat "$CASES/blocked.result.json")" \
    "j.response.verdict + '/' + j.response.findings.length + '/' + (j.response.limitations.length > 0)" "BLOCKED/0/true"
  assert_json "R27k failed is status:failed with the runner's timeout error and no response" "$(cat "$CASES/failed.result.json")" \
    "j.status + '/' + ('response' in j) + '/' + /timed out/.test(j.error)" "failed/false/true"
  assert_json "R27l observed_models is [] in every captured completed record (FR-013 basis)" \
    "[$(cat "$CASES/approved.result.json"),$(cat "$CASES/revise.result.json"),$(cat "$CASES/blocked.result.json")]" \
    "j.every(r => Array.isArray(r.observed_models) && r.observed_models.length === 0 && r.requested_model === null)" "true"

  # schema = the runner's own contract
  assert_json "R27m response.schema.json verdict enum and finding fields" "$(cat "$CASES/response.schema.json")" \
    "j.properties.verdict.enum.join('|') + ' ' + j.properties.findings.items.required.join(',') + ' ' + j.properties.findings.items.additionalProperties" \
    "APPROVED|REVISE|BLOCKED id,severity,path,evidence,fix false"

  assert_eq "R27n empty.result.json is 0 bytes" "$(wc -c < "$CASES/empty.result.json" | tr -d ' ')" "0"
  local parses; parses="$(node -e "try { JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write('parses'); } catch (e) { process.stdout.write('rejects'); }" "$CASES/malformed.result.json")"
  assert_eq "R27o malformed.result.json does not parse" "$parses" "rejects"
}

# ---------- R1: both gate ids are registered; a misspelling is not ----------
# Red-making change: deleting either registry row (Diana's file). The second
# arm proves the validator is not accepting anything xprov-shaped.
caseR1() {
  local t rc_ok rc_bad; t="$(mktemp -d)"
  cat > "$t/retro-both.md" <<MD
---
date: 2026-09-24
task: R1 fixture — both xprov gate ids
project: a1-specforge
result: pass
issues: []
evidence: fixture
gates_fired:
  - {id: $GATE_PLAN, verdict: pass, caught: false}
  - {id: $GATE_WAVE, verdict: fail, caught: true}
one_line_learning: n/a — fixture.
---
MD
  cat > "$t/retro-drift.md" <<'MD'
---
date: 2026-09-24
task: R1 fixture — misspelled xprov id
project: a1-specforge
result: pass
issues: []
evidence: fixture
gates_fired:
  - {id: xprov-review, verdict: pass, caught: false}
one_line_learning: n/a — fixture.
---
MD
  ( cd "$REPO_ROOT" && node "$TOOLS" retro validate "$t/retro-both.md" >/dev/null 2>&1 ); rc_ok=$?
  ( cd "$REPO_ROOT" && node "$TOOLS" retro validate "$t/retro-drift.md" >/dev/null 2>&1 ); rc_bad=$?
  assert_rc "R1a retro validate with $GATE_PLAN + $GATE_WAVE" 0 "$rc_ok" "both rows must exist in gates-registry.md"
  assert_rc "R1b retro validate with xprov-review (not a registered id)" 1 "$rc_bad"

  local rows; rows="$(node -e "
    const gi = require(process.argv[1]); const fs = require('fs');
    const ids = gi.parseRegistryIds(fs.readFileSync(process.argv[2], 'utf8'));
    process.stdout.write(String(ids.includes(process.argv[3]) && ids.includes(process.argv[4])));
  " "$REPO_ROOT/_shared/lib/gate-ids.cjs" "$REGISTRY" "$GATE_PLAN" "$GATE_WAVE" 2>&1)"
  assert_eq "R1c both ids sit inside the registry's anchored id table (not an alias)" "$rows" "true"

  local enf; enf="$(grep -E "^\| \`($GATE_PLAN|$GATE_WAVE)\` " "$REGISTRY" | awk -F'|' '{gsub(/ /,"",$7); print $7}' | sort -u | tr '\n' ',')"
  assert_eq "R1d both rows carry enforcement warning until the Wave 7 flip" "$enf" "warning,"
}

# ---------- R29: the ADR exists with the six decision headings ----------
# Red-making change: deleting one heading (Alex's file).
caseR29() {
  if [[ ! -f "$ADR" ]]; then bad "R29 ADR missing: $ADR"; return; fi
  # House ADR format numbers the sub-decisions (`### 1. Runner-only use`); the
  # number is optional here, the heading text is verbatim from the plan.
  local n; n="$(grep -cE '^#{2,3} ([0-9]+\. )?(Runner-only use|Dedicated CODEX_HOME|Snapshot, not checkout|Fail-closed mapping|Vendoring decision|Live smoke)$' "$ADR")"
  assert_eq "R29a ADR has the six decision headings" "$n" "6"
  if grep -qiE 'pending Wave 7' "$ADR"; then ok "R29b Live smoke section is the placeholder (no live claim before Wave 7)"
  else bad "R29b Live smoke section does not say 'pending Wave 7'"; fi
  # The repo has no .env.example, so the ADR is where the ENV var is documented
  # (wave plan, deployment chain).
  if grep -q "A1_XPROV_CODEX_HOME" "$ADR"; then ok "R29c ADR documents the A1_XPROV_CODEX_HOME env var"
  else bad "R29c ADR does not mention A1_XPROV_CODEX_HOME"; fi
}

# ---------- F1: facade dispatch (Wave 1 addition) ----------
# Red-making change: exiting 1 instead of 2 for a not-yet-shipped module, or
# dropping a subcommand from the table. Hostile input (CONVENTIONS): a
# 10 000-char subcommand name must exit 2 fast without being echoed whole.
caseF1() {
  local out err rc
  # Own the tree: a copy of _shared/ with the Wave 6 module removed stays a
  # valid "not shipped yet" probe no matter how many waves have landed.
  make_tree; rm -f "$TREE/_shared/lib/xprov-gate.cjs"
  out="$(node "$TREE_TOOLS" xprov gate --phase p --gate g 2>"$TMPDIR_F1/err.txt")"; rc=$?
  err="$(cat "$TMPDIR_F1/err.txt")"
  if [[ $rc -eq 2 && -z "$out" && "$err" == *"xprov gate: not implemented yet (planned wave 6)"* ]]; then
    ok "F1a not-yet-shipped subcommand → exit 2, no stdout JSON, names the planned wave"
  else bad "F1a not-yet-shipped subcommand (rc=$rc out=$out err=$err)"; fi

  out="$(node "$TOOLS" xprov nope 2>/dev/null)"; rc=$?
  [[ $rc -eq 2 && -z "$out" ]] && ok "F1b unknown subcommand → exit 2, empty stdout" || bad "F1b unknown subcommand (rc=$rc out=$out)"

  node "$TOOLS" xprov >/dev/null 2>&1; rc=$?
  assert_rc "F1c missing subcommand → exit 2" 2 "$rc"

  local big; big="$(head -c 10000 /dev/zero | tr '\0' 'a')"
  local t0 t1; t0=$(date +%s)
  node "$TOOLS" xprov "$big" >"$TMPDIR_F1/big.out" 2>"$TMPDIR_F1/big.err"; rc=$?
  t1=$(date +%s)
  local errlen; errlen="$(wc -c < "$TMPDIR_F1/big.err" | tr -d ' ')"
  if [[ $rc -eq 2 && ! -s "$TMPDIR_F1/big.out" && $((t1 - t0)) -le 5 && $errlen -lt 1000 ]]; then
    ok "F1d hostile 10 000-char subcommand → exit 2 in ≤5 s, stderr < 1000 bytes"
  else bad "F1d hostile subcommand (rc=$rc secs=$((t1 - t0)) errbytes=$errlen)"; fi

  local help; help="$(node "$TOOLS" --help 2>/dev/null)"
  local sub missing_help=""
  for sub in normalize gc preflight init-home permit-check permit observe snapshot run gate load-check wave-status waive; do
    grep -qE "^    $sub( |$)" <<<"$help" || missing_help="$missing_help $sub"
  done
  grep -q "A1_XPROV_CODEX_HOME" <<<"$help" || missing_help="$missing_help A1_XPROV_CODEX_HOME"
  grep -q "a1-tools xprov <sub>" <<<"$help" || missing_help="$missing_help header"
  [[ -z "$missing_help" ]] && ok "F1e --help names all 13 xprov subcommands and A1_XPROV_CODEX_HOME" \
                            || bad "F1e --help is missing:$missing_help"

  out="$(node -e "
    const x = require(process.argv[1]);
    const subs = Object.keys(x.SUBCOMMANDS).length;
    const reasons = x.REASON_LIST.join(',');
    const ghp = x.SECRET_PATTERNS.some(p => p.re.test('ghp_' + 'A'.repeat(36)));
    const akia = x.SECRET_PATTERNS.some(p => p.re.test('AKIA' + 'B'.repeat(16)));
    const assign = x.SECRET_PATTERNS.some(p => p.re.test('API_KEY = \"abcdefghijklmnop\"'));
    const clean = x.SECRET_PATTERNS.some(p => p.re.test('hello world, nothing here'));
    const markers = x.INSTRUCTION_MARKERS.includes('git push') && x.INSTRUCTION_MARKERS.includes('ignore previous');
    const gates = x.GATE_ID_LIST.join(',');
    const home = x.codexHome({ A1_XPROV_CODEX_HOME: '/x/override' }) + ' ' + require('path').basename(x.codexHome({}));
    process.stdout.write(JSON.stringify({ subs, reasons, ghp, akia, assign, clean, markers, gates, home }));
  " "$XPROV_LIB" 2>&1)"
  assert_json "F1f dispatch table has 13 entries" "$out" "j.subs" "13"
  assert_json "F1g REASON_LIST is the spec's thirteen reason codes plus the three documented freeze exceptions (preflight_failed W4, plan_review_missing + wave_inspect_missing W6)" "$out" "j.reasons" \
    "runner_failed,malformed,wrong_mode,blocked,plan_changed,tripwire,secret_in_snapshot,secret_in_output,quarantined,round_cap,external_review_not_permitted,snapshot_failed,not_logged_in,preflight_failed,plan_review_missing,wave_inspect_missing"
  assert_json "F1h SECRET_PATTERNS hit ghp_/AKIA/assignment shapes and not plain text" "$out" \
    "[j.ghp, j.akia, j.assign, j.clean].join('/')" "true/true/true/false"

  # Samuel W3 review: eight additional shapes (spec FR-018 amended 2026-09-24),
  # one positive per pattern, named by the FIRST pattern that matches, plus a
  # ReDoS probe: every pattern over three 10 000-char adversarial inputs.
  # Red-making change: dropping any one of the eight patterns, or a pattern
  # whose worst case is super-linear.
  local out2; out2="$(node -e "
    const x = require(process.argv[1]);
    const first = (s) => { const p = x.SECRET_PATTERNS.find(p => p.re.test(s)); return p ? p.name : 'none'; };
    const names = {
      sk_ext: first('key sk-proj-' + 'a1B2'.repeat(6) + ' end'),
      gho: first('gho_' + 'A'.repeat(36)),
      fine: first('github_pat_' + 'A1_'.repeat(10)),
      xoxa: first('xoxa-1234567890-abc'),
      url: first('see https://deploy:s3cretPW@host.example/x'),
      pwd: first('password = hunter2xyz9'),
      bearer: first('Authorization: Bearer ' + 'abcDEF123'.repeat(4)),
      gkey: first('AIza' + 'a'.repeat(35)),
      ghp_still_classic: first('ghp_' + 'A'.repeat(36)),
      xoxb_still_slack: first('xoxb-1'),
      // Samuel re-check (noise): the working-directory idiom and a too-short Slack prefix are NOT secrets
      pwd_cwd: first('pwd = os.getcwd()'),
      xoxa_short: first('xoxa-1-2-3'),
    };
    // Samuel re-check: the 300 000-char abc:// repetition took 21.6 s with the unbounded url pattern
    const inputs = ['a'.repeat(10000), 'https://' + 'u'.repeat(10000), 'password = ' + 'x'.repeat(10000), 'sk-' + '-'.repeat(10000), 'Bearer ' + ' '.repeat(10000), 'abc://'.repeat(50000)];
    let worst = 0, worstName = '';
    for (const p of x.SECRET_PATTERNS) for (const s of inputs) { const t0 = process.hrtime.bigint(); p.re.test(s); const ms = Number(process.hrtime.bigint() - t0) / 1e6; if (ms > worst) { worst = ms; worstName = p.name; } }
    process.stdout.write(JSON.stringify({ names, count: x.SECRET_PATTERNS.length, worst: Math.round(worst * 100) / 100, worstName }));
  " "$XPROV_LIB" 2>&1)"
  assert_json "F1h2 the eight Samuel shapes each hit their own pattern; ghp_/xoxb keep their original names" "$out2" \
    "Object.entries(j.names).map(([k, v]) => k + '=' + v).join(' ')" \
    "sk_ext=sk_prefixed_key_ext gho=github_token_family fine=github_pat_fine_grained xoxa=slack_token_family url=url_credentials pwd=password_assignment bearer=bearer_token gkey=google_api_key ghp_still_classic=github_pat_classic xoxb_still_slack=slack_token pwd_cwd=none xoxa_short=none"
  assert_json "F1h3 pattern list has 16 entries (8 spec + 8 amended)" "$out2" "j.count" "16"
  assert_json "F1h4 ReDoS probe: worst single test over the adversarial inputs (incl. 300 000-char abc://) stays under 100 ms" "$out2" "j.worst < 100 ? 'ok' : 'slow ' + j.worstName + ' ' + j.worst + 'ms'" "ok"
  assert_json "F1i INSTRUCTION_MARKERS carry the multi-word markers" "$out" "j.markers" "true"
  assert_json "F1j GATE_ID_LIST is the two registered ids" "$out" "j.gates" "$GATE_PLAN,$GATE_WAVE"
  assert_json "F1k codexHome() honours A1_XPROV_CODEX_HOME and defaults to .codex-a1-review" "$out" "j.home" "/x/override .codex-a1-review"

  # Samuel's Wave 1 review (MINOR 1): the override must be absolute, is
  # path.resolve()d so `…/.codex-a1-review/../.codex` is visibly the global
  # home (Wave 4 then compares by realpath), `~` is NOT expanded, control
  # characters are refused with a typed reason. Red-making change: returning
  # the raw env value.
  out="$(node -e "
    const x = require(process.argv[1]);
    const probe = (v) => { try { return x.codexHome({ A1_XPROV_CODEX_HOME: v }); } catch (e) { return 'ERR:' + (e.reason || 'untyped'); } };
    process.stdout.write(JSON.stringify({
      traversal: probe('/x/.codex-a1-review/../.codex'),
      tilde: probe('~/.codex-a1-review'),
      relative: probe('.codex-a1-review'),
      control: probe('/x/.codex\u0000-a1-review'),
      newline: probe('/x/.codex-a1-review\n'),
    }));
  " "$XPROV_LIB" 2>&1)"
  assert_json "F1l codexHome() resolves a traversal override to its real target" "$out" "j.traversal" "/x/.codex"
  assert_json "F1m codexHome() refuses ~, relative and control-character overrides with typed reasons" "$out" \
    "[j.tilde, j.relative, j.control, j.newline].join(' ')" \
    "ERR:codex_home_not_absolute ERR:codex_home_not_absolute ERR:codex_home_invalid ERR:codex_home_invalid"
}

# ---------- H1: harness self-check (not a RED proof — proves the helpers) ----------
caseH1() {
  make_tree
  local fake_sha; fake_sha="$(sha256_of "$TREE_VENDOR/runner.py")"
  [[ "$fake_sha" != "$EXPECTED_RUNNER_SHA256" ]] && ok "H1a make_tree swapped the fake runner in" || bad "H1a copy still holds the real runner"
  sums_check "$TREE_VENDOR" && ok "H1b copy's regenerated SHA256SUMS verifies" || bad "H1b copy's SHA256SUMS does not verify"
  assert_eq "H1c fake codex on PATH answers --version like the measured CLI" "$(codex --version 2>&1)" "$EXPECTED_CLI_VERSION"
  assert_eq "H1d fake gitleaks exit code follows FAKE_GITLEAKS_EXIT" "$(FAKE_GITLEAKS_EXIT=1 gitleaks detect >/dev/null 2>&1; echo $?)" "1"

  make_phase h1-phase
  [[ -f "$PHASE_PLAN" && -d "$PHASE_REPO/.git" && -n "$PHASE_HEAD" ]] && ok "H1e make_phase builds a committed checkout with PLAN.md" || bad "H1e make_phase"

  local art argv rc; art="$(mktemp -d)"
  FAKE_RUNNER_ARGV_FILE="$art/argv.json" FAKE_RUNNER_CASE=approved \
    python3 "$TREE_VENDOR/runner.py" review --host claude --repo "$PHASE_REPO" --plan "$PHASE_PLAN" --artifacts "$art" --timeout 5 >/dev/null 2>&1; rc=$?
  local run_dir; run_dir="$(ls -d "$art"/claudex-* 2>/dev/null | head -1)"
  if [[ $rc -eq 0 && -f "$art/argv.json" && -n "$run_dir" ]] && cmp -s "$run_dir/result.json" "$CASES/approved.result.json"; then
    ok "H1f fake runner records argv and copies the named case into <artifacts>/claudex-*/result.json"
  else bad "H1f fake runner (rc=$rc run_dir=$run_dir)"; fi
  argv="$(cat "$art/argv.json" 2>/dev/null)"
  assert_json "H1g recorded argv[1] is the copy's vendored runner path" "$argv" "j[0]" "$TREE_VENDOR/runner.py"

  FAKE_RUNNER_EXIT=3 python3 "$TREE_VENDOR/runner.py" review --host claude --repo "$PHASE_REPO" --plan "$PHASE_PLAN" --artifacts "$art" >/dev/null 2>&1; rc=$?
  assert_rc "H1h fake runner honours FAKE_RUNNER_EXIT" 3 "$rc"

  python3 "$TREE_VENDOR/runner.py" review --host claude --repo "$PHASE_REPO" --plan "$PHASE_PLAN" --artifacts "$PHASE_REPO/art" >/dev/null 2>&1; rc=$?
  assert_rc "H1i fake runner refuses --artifacts inside --repo (measured runner behaviour)" 1 "$rc"

  FAKE_RUNNER_SIDE_EFFECT=write-into-repo python3 "$TREE_VENDOR/runner.py" review --host claude --repo "$PHASE_REPO" --plan "$PHASE_PLAN" --artifacts "$art" >/dev/null 2>&1
  [[ -f "$PHASE_REPO/FAKE_RUNNER_WROTE_THIS.txt" ]] && ok "H1j write-into-repo side effect lands in --repo" || bad "H1j side effect missing"

  make_home
  local mode; mode="$(stat -f '%Lp' "$XHOME" 2>/dev/null || stat -c '%a' "$XHOME")"
  [[ "$mode" == "700" ]] && grep -q 'sandbox_mode = "read-only"' "$XHOME/config.toml" && ! grep -q 'mcp_servers' "$XHOME/config.toml" \
    && ok "H1k make_home builds a 0700 home with the compliant config" || bad "H1k make_home (mode=$mode)"
}

TMPDIR_F1="$(mktemp -d)"
caseR22_static; caseR23; caseR27; caseR1; caseR29; caseF1; caseH1
