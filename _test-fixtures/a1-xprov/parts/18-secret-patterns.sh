#!/usr/bin/env bash
# Part 18 — spec 014 Wave 4: seven new secret patterns (FR-009; SC-008, SC-009).
# Sourced by run-tests.sh. Expectations are literals from the spec (pattern names,
# quantifier minima), never imported from the module under test. Every hit value
# is assembled from parts at run time, so the repository holds no literal hit
# (the LITERAL_REF_RE practice of xprov-approve.cjs). Provider formats and sample
# lengths (A-3, measured in Wave 0): stripe 8-char prefix + 16 body, gitlab
# `glpat-` + 20, npm `npm_` + 36, hugging face `hf_` + 30, sendgrid `SG.` + 16 + `.` + 16,
# azure `AccountKey=` + 20, env value 12.
#
#   SP1a..g  one committed hit line per pattern -> `xprov snapshot --repo . --commit HEAD`
#            exits 1, reason secret_in_snapshot, secret_pattern == the name; stdout and
#            stderr hold no part of the value.   Red while the pattern is absent.
#   SP1a2..  more hit shapes: `export NAME=value`, `name: value` (env); `rk_live_` (stripe);
#            `SharedAccessKey=` (azure).
#   SP2a..g  near misses per pattern (one char below the minimum, word-internal prefix,
#            env reference, code assignment, low-entropy value) -> exit 0, no secret_pattern.
#            Red if a quantifier or the boundary is too loose.
#   SP3      through the gate (gate8): the same hit lines -> secret_in_snapshot/<name>, runner
#            never invoked, the value in none of stdout, stderr, XREVIEW.md, PLAN-REVIEW-LOG.md.
#   SP4      `normalize` on a result whose error holds a `glpat-` value -> secret_in_output with
#            secret_pattern gitlab_pat; the value is not written to XREVIEW.md.
#   SP5      the module lists: seven new names at the END in spec order, the five prefix
#            patterns in PATH_NAME_BOUNDARY_PATTERNS, env_assignment_unquoted and
#            azure_connection_string not; HIGH_CONFIDENCE_PATTERNS unchanged (16 -> still no new name).
#   SP6      each hit matches exactly one pattern name (first-match order) and ReDoS: the new
#            patterns on adversarial 100 000-char inputs stay under 1 s (min of 3).

TMP18="$(mktemp -d "${TMPDIR:-/tmp}/a1x18.XXXXXX")"
[[ -n "$TMP18" && -d "$TMP18" ]] || { echo "FAIL  part 18: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
make_tree

rep18() { local out; out="$(printf '%*s' "$2" '')"; printf '%s' "${out// /$1}"; }   # rep18 <char> <n>
QQ16="$(rep18 Q 16)"; QQ19="$(rep18 Q 19)"; QQ20="$(rep18 Q 20)"; QQ29="$(rep18 Q 29)"; QQ30="$(rep18 Q 30)"
QQ35="$(rep18 Q 35)"; QQ36="$(rep18 Q 36)"; QQ15="$(rep18 Q 15)"
ZV12="$(rep18 Z 11)7"; ZV11="$(rep18 Z 10)7"; ZV12L="$(rep18 Z 12)"   # 12 chars with a digit / 11 chars / 12 letters only

# hit18 <id> — the hit lines of one pattern, one per output line
hit18() {
  case "$1" in
    env_assignment_unquoted)
      printf '%s\n' "$(printf 'API_%s=%s' KEY "$ZV12")" \
        "$(printf 'export SERVICE_%s=%s' TOKEN "$ZV12")" \
        "$(printf '  client_%s: %s' secret "$ZV12")" ;;
    stripe_live_key)
      printf '%s\n' "pay=$(printf 's%s_%s_%s' k live "$QQ16")" "pay=$(printf 'r%s_%s_%s' k live "$QQ16")" ;;
    gitlab_pat) printf '%s\n' "ci $(printf 'glp%s-%s' at "$QQ20")" ;;
    npm_token) printf '%s\n' "reg $(printf 'np%s_%s' m "$QQ36")" ;;
    huggingface_token) printf '%s\n' "hub $(printf 'h%s_%s' f "$QQ30")" ;;
    sendgrid_key) printf '%s\n' "mail $(printf 'S%s.%s.%s' G "$QQ16" "$QQ16")" ;;
    azure_connection_string)
      printf '%s\n' "$(printf 'Account%s=%s' Key "$QQ20")" "$(printf 'SharedAccess%s=%s' Key "$QQ20")==" ;;
  esac
}

# near18 <id> — lines that must NOT hit anything
near18() {
  case "$1" in
    env_assignment_unquoted)
      printf '%s\n' "$(printf 'API_%s=%s' KEY "$ZV11")" \
        "$(printf 'API_%s=%s' KEY "$ZV12L")" \
        'NAME=$SECRET_FROM_CI_RUN_1' \
        'SERVICE_TOKEN=${SECRET_FROM_CI_RUN_1}' \
        'const token = fooBarBazQux123;' \
        'token = readSecretFromVault(configKey1)' \
        'x.token = abcdefghijkl123' \
        'for token in tokens_of_the_day_1' ;;
    stripe_live_key)
      printf '%s\n' "pay=$(printf 's%s_%s_%s' k live "$QQ15")" "pay=x$(printf 's%s_%s_%s' k live "$QQ16")" "pay=$(printf 's%s_%s_%s' k test "$QQ16")" ;;
    gitlab_pat) printf '%s\n' "ci $(printf 'glp%s-%s' at "$QQ19")" "ci x$(printf 'glp%s-%s' at "$QQ20")" ;;
    npm_token) printf '%s\n' "reg $(printf 'np%s_%s' m "$QQ35")" "reg x$(printf 'np%s_%s' m "$QQ36")" ;;
    huggingface_token) printf '%s\n' "hub $(printf 'h%s_%s' f "$QQ29")" "hub x$(printf 'h%s_%s' f "$QQ30")" 'shelf_items_list_of_things' ;;
    sendgrid_key) printf '%s\n' "mail $(printf 'S%s.%s.%s' G "$QQ16" "$QQ15")" "mail x$(printf 'S%s.%s.%s' G "$QQ16" "$QQ16")" ;;
    azure_connection_string)
      printf '%s\n' "$(printf 'Account%s=%s' Key "$QQ19")" 'AccountKey=$STORAGE_KEY_FROM_CI_RUN_01' ;;
  esac
}

NEW18=(env_assignment_unquoted stripe_live_key gitlab_pat npm_token huggingface_token sendgrid_key azure_connection_string)

# sp_snap <repo> — plan-mode snapshot of the repo (HOME = a fresh dir). Sets SP_OUT, SP_ERR, SP_RC and removes a passing snapshot.
sp_snap() {
  local home; home="$(mktemp -d "$TMP18/home.XXXXXX")"; mkdir -p "$home/.codex"
  SP_OUT="$(cd "$1" && HOME="$home" node "$TREE_TOOLS" xprov snapshot --repo "$1" --commit HEAD --plan "$PHASE_PLAN" 2>"$TMP18/err.txt")"; SP_RC=$?
  SP_ERR="$(cat "$TMP18/err.txt")"
  local dir; dir="$(json_get "$SP_OUT" "j.snapshot || ''")"
  if [[ -n "$dir" && "$dir" != "UNPARSEABLE" ]]; then HOME="$home" node "$TREE_TOOLS" xprov snapshot --remove "$dir" >/dev/null 2>&1; fi
}

# sp_commit <file> <line> — fresh phase repo with one extra tracked file holding the line
sp_commit() {
  make_phase sp18
  printf '%s\n' "$2" > "$PHASE_REPO/src/$1"
  ( cd "$PHASE_REPO" && git add -A && git commit -qm "fixture: $1" )
}

# value18 <line> — the secret part of a line (what must never be echoed): the run of filler characters (Q / Z) plus a trailing digit
value18() { printf '%s' "$1" | grep -oE '[QZ]{10,}[0-9]?' | head -n 1; }

caseSP1() {
  local id line n=0 v
  for id in "${NEW18[@]}"; do
    while IFS= read -r line; do
      n=$((n + 1)); sp_commit "hit$n.txt" "$line"; sp_snap "$PHASE_REPO"
      assert_rc "SP1 [$id] #$n hit line exits 1" 1 "$SP_RC"
      assert_json "SP1 [$id] #$n reason secret_in_snapshot, secret_pattern $id" "$SP_OUT" "j.reason + '/' + j.secret_pattern" "secret_in_snapshot/$id"
      v="$(value18 "$line")"
      if [[ -z "$v" || "$SP_OUT$SP_ERR" == *"$v"* ]]; then bad "SP1 [$id] #$n stdout/stderr echo the value"; else ok "SP1 [$id] #$n stdout/stderr hold no value"; fi
    done < <(hit18 "$id")
  done
}

caseSP2() {
  local id line n=0
  for id in "${NEW18[@]}"; do
    while IFS= read -r line; do
      n=$((n + 1)); sp_commit "near$n.txt" "$line"; sp_snap "$PHASE_REPO"
      assert_rc "SP2 [$id] near miss #$n exits 0" 0 "$SP_RC" "$(json_get "$SP_OUT" "j.reason + '/' + j.secret_pattern")"
    done < <(near18 "$id")
  done
}

caseSP3() {
  if ! declare -F new8 >/dev/null; then bad "SP3: part 08 helpers (new8 …) are not loaded"; return 0; fi
  local id line v n=0 f
  for id in "${NEW18[@]}"; do
    line="$(hit18 "$id" | head -n 1)"; v="$(value18 "$line")"; n=$((n + 1))
    new8; plant8 "leak$n.txt" "$line"; c8 "hit $id"
    gate8 --gate "$GATE_PLAN"; expect8 "SP3 [$id] gate" "secret_in_snapshot/$id"
    local blob="$G_OUT$G_ERR"
    for f in "$P8DIR/XREVIEW.md" "$P8DIR/PLAN-REVIEW-LOG.md"; do [[ -f "$f" ]] && blob+="$(cat "$f")"; done
    if [[ -z "$v" || "$blob" == *"$v"* ]]; then bad "SP3 [$id] the value appears in stdout/stderr/XREVIEW/log"; else ok "SP3 [$id] value absent from stdout, stderr, XREVIEW, log"; fi
  done
}

caseSP4() {
  local tok; tok="$(printf 'glp%s-%s' at "$QQ20")"
  make_tree
  TOKEN="$tok" node -e '
    const fs = require("fs"); const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    r.error = "runner died: " + process.env.TOKEN;
    fs.writeFileSync(process.argv[2], JSON.stringify(r, null, 2) + "\n");
  ' "$CASES/failed.result.json" "$TMP18/sp4.result.json"
  make_phase sp4 "$CASES/approved.PLAN.md"
  local out rc
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov normalize "$TMP18/sp4.result.json" --phase sp4 --gate "$GATE_PLAN" 2>"$TMP18/err4.txt")"; rc=$?
  assert_rc "SP4 normalize on a glpat- result exits 1" 1 "$rc"
  assert_json "SP4 secret_in_output / gitlab_pat" "$out" "j.reason + '/' + j.secret_pattern" "secret_in_output/gitlab_pat"
  if grep -qF "$tok" "$PHASE_DIR/XREVIEW.md" "$TMP18/err4.txt" 2>/dev/null || [[ "$out" == *"$tok"* ]]; then bad "SP4 the value is echoed"; else ok "SP4 the value is not echoed in stdout, stderr or XREVIEW.md"; fi
}

caseSP5() {
  local out
  out="$(node -e '
    const x = require(process.argv[1] + "/xprov.cjs");
    const names = x.SECRET_PATTERNS.map((p) => p.name);
    const frozen = Object.isFrozen(x.SECRET_PATTERNS) && x.SECRET_PATTERNS.every((p) => Object.isFrozen(p));
    const prefix = ["stripe_live_key", "gitlab_pat", "npm_token", "huggingface_token", "sendgrid_key"];
    process.stdout.write(JSON.stringify({
      count: names.length, tail: names.slice(16).join(","), frozen,
      prefixInPath: prefix.every((n) => x.PATH_NAME_BOUNDARY_PATTERNS.includes(n)),
      envOut: !x.PATH_NAME_BOUNDARY_PATTERNS.includes("env_assignment_unquoted"),
      azureOut: !x.PATH_NAME_BOUNDARY_PATTERNS.includes("azure_connection_string"),
      hc: x.HIGH_CONFIDENCE_PATTERNS.slice(),
    }));
  ' "$TREE/_shared/lib" 2>&1)"
  assert_json "SP5 23 patterns" "$out" "j.count" "23"
  assert_json "SP5 the seven new names are appended at the end, in spec order" "$out" "j.tail" "env_assignment_unquoted,stripe_live_key,gitlab_pat,npm_token,huggingface_token,sendgrid_key,azure_connection_string"
  assert_json "SP5 list and entries are frozen" "$out" "j.frozen" "true"
  assert_json "SP5 the five prefix patterns are in PATH_NAME_BOUNDARY_PATTERNS" "$out" "j.prefixInPath" "true"
  assert_json "SP5 env_assignment_unquoted stays out of PATH_NAME_BOUNDARY_PATTERNS" "$out" "j.envOut" "true"
  assert_json "SP5 azure_connection_string stays out of PATH_NAME_BOUNDARY_PATTERNS" "$out" "j.azureOut" "true"
  assert_json "SP5 HIGH_CONFIDENCE_PATTERNS holds no new name" "$out" "j.hc.some((n) => /env_assignment|stripe|gitlab|npm_token|huggingface|sendgrid|azure/.test(n))" "false"
}

caseSP6() {
  local out
  out="$(node -e '
    const x = require(process.argv[1] + "/xprov.cjs");
    const NEW = ["env_assignment_unquoted", "stripe_live_key", "gitlab_pat", "npm_token", "huggingface_token", "sendgrid_key", "azure_connection_string"];
    const pats = x.SECRET_PATTERNS.filter((p) => NEW.includes(p.name));
    const r = (c, n) => c.repeat(n);
    const inputs = [
      "API_KEY=" + r("a", 100000), "API_KEY=" + r("a", 100000) + "(", r("_token", 20000), r("token=1", 20000),
      "export " + r(" ", 100000) + "TOKEN=", r(" ", 100000) + "x", "SG." + r("a", 100000), r("SG.aaaaaaaaaaaaaaaa", 5000),
      "SG." + r("a", 20) + "." + r("a", 100000), r("sk_live_", 10000), r("glpat-", 10000), r("npm_", 20000), r("hf_", 30000),
      "AccountKey=" + r("A", 100000), r("AccountKey=", 10000), r("a", 100000), "\n".repeat(100000), (r("x", 200) + "\n").repeat(500),
    ];
    const once = (re, s) => { const t0 = process.hrtime.bigint(); re.test(s); return Number(process.hrtime.bigint() - t0) / 1e6; };
    let worst = 0, name = "";
    for (const p of pats) for (const s of inputs) {
      let ms = once(p.re, s);
      if (ms <= 1000) ms = Math.min(ms, once(p.re, s), once(p.re, s));
      if (ms > worst) { worst = ms; name = p.name; }
    }
    process.stdout.write(JSON.stringify({ n: pats.length, ok: worst < 1000, worst: Math.round(worst), name }));
  ' "$TREE/_shared/lib" 2>&1)"
  assert_json "SP6 the seven new patterns stay under 1 s on adversarial inputs ($out)" "$out" "j.n + '/' + j.ok" "7/true"
  # first-match name: each hit line carries exactly one new name and no earlier pattern name
  local id line first
  for id in "${NEW18[@]}"; do
    while IFS= read -r line; do
      first="$(LINE="$line" node -e '
        const x = require(process.argv[1] + "/xprov.cjs");
        const names = x.SECRET_PATTERNS.filter((p) => p.re.test(process.env.LINE)).map((p) => p.name);
        process.stdout.write(names.join(","));
      ' "$TREE/_shared/lib" 2>&1)"
      assert_eq "SP6 [$id] a hit line matches only its own pattern" "$first" "$id"
    done < <(hit18 "$id")
  done
}

caseSP1; caseSP2; caseSP3; caseSP4; caseSP5; caseSP6
rm -rf "$TMP18"
