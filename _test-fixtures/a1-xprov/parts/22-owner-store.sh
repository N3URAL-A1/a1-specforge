#!/usr/bin/env bash
# Part 22 — spec 016 Wave 1: owner-store foundation. Sourced by run-tests.sh.
# FR-001 zero bytes without a permit · FR-006 origin-bound identity · FR-009 OS-user home + HOME
# tripwire · FR-010 hash-chained audit, `enforcement`/`audit` in permit-check · FR-011 `owner-chat`
# reserved. Expectations are literals from the spec; store keys are computed here, never by the code
# under test. Each guard names the ONE production change that turns its arm red (RED proof):
#   OS2a-e  Red if assertWritable() is dropped from permitCheck's home check / writeGuardedStore /
#           writeScanRecord / appendAudit (one arm per call site).
#   OS1a    Red if ownerHome() returns os.homedir() instead of os.userInfo().homedir.
#   OS4*    Red if bindingProblem() ignores entry.origin / entry.repo.
#   OS5*    Red if readChain() skips the `prev` comparison; OS5f red if appendAudit extends a broken chain.
#   OS6*    Red if rejectReservedBy() is dropped from validateBy / waive / allowlist approve.
#   OS7     Red if the origin binding is dropped (the void permit would reach the runner).
#   OS9-OS16 are the wave-1 security-review fixes SEC-1..SEC-8; each block names its RED proof above its case function.
# Owner commands run on a tree COPY whose guardRefusal is stubbed to null (the guard itself is
# measured in parts 08, 11 and 15, the TTY refusal again in OS5k) — never against a real store.

mk_workdir TMP22 "a1x22"
[[ -n "$TMP22" && -d "$TMP22" ]] || { echo "FAIL  part 22: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_22="$HOME"
export HOME="$TMP22/home"; mkdir -p "$HOME"
REC22=record/2026-10-14-fixture.md
NOW22=2026-10-14T00:00:00.000Z
ORG22=https://github.com/N3URAL-A1/fixture.git

prep22() { make_tree; make_phase p22; rm -rf "$HOME/.a1-xprov"; }
key22() { (cd "${1:-$PHASE_REPO}" && cd "$(git rev-parse --git-common-dir)" && pwd -P); }
origin22() { git -C "$PHASE_REPO" remote remove origin 2>/dev/null; [[ -n "${1:-}" ]] && git -C "$PHASE_REPO" remote add origin "$1"; return 0; }
sub22() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov "$@" 2>"$TMP22/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP22/err.txt")"; }
# piped22 <typed> <args…> — stdin carries the typed word (tree with the stubbed guard only)
piped22() { local typed="$1"; shift; G_OUT="$(cd "$PHASE_REPO" && printf '%s\n' "$typed" | node "$TREE_TOOLS" xprov "$@" 2>"$TMP22/err.txt")"; G_RC=$?; G_ERR="$(cat "$TMP22/err.txt")"; }
# lib22 <js> — evaluates <js> in the TREE with P permit, AU audit, RI identity, AP approve, SR scan records
lib22() {
  node -e '
    const L = process.argv[1] + "/_shared/lib/"; const P = require(L + "xprov-permit.cjs"), AU = require(L + "xprov-audit.cjs"), RI = require(L + "xprov-repo-identity.cjs");
    const AP = require(L + "xprov-approve.cjs"), SR = require(L + "xprov-scan-records.cjs");
    let out; try { out = (function () { return eval(process.argv[2]); })(); } catch (e) { out = { threw: true, code: e.code || null, reason: e.reason || null, message: String(e.message).slice(0, 300) }; }
    process.stdout.write(JSON.stringify(out === undefined ? null : out));
  ' "$TREE" "$1"
}
permit22() { lib22 "P.permit({ repoRoot: '$PHASE_REPO', by: 'robert', record: '$REC22', today: '2026-10-14', now: '$NOW22' })"; }
deny22() { lib22 "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-14', now: '$NOW22' })"; }
# passwd_tree22 <dir> — make_tree, then the REAL owner-home module with its OS-user lookup pointed at <dir>
passwd_tree22() {
  make_tree
  node -e '
    const fs = require("fs"); const [src, dst, pd] = process.argv.slice(1);
    const s = fs.readFileSync(src, "utf8"); const needle = "return os.userInfo().homedir;";
    if (s.split(needle).length !== 2) { console.error("owner-home: needle count != 1"); process.exit(3); }
    fs.writeFileSync(dst, s.replace(needle, () => "return " + JSON.stringify(pd) + ";"));
  ' "$REPO_ROOT/_shared/lib/xprov-owner-home.cjs" "$TREE/_shared/lib/xprov-owner-home.cjs" "$1" || bad "OS harness: owner-home module could not be pointed at $1"
}
# stubguard22 — the tree's guardRefusal returns null (the owner guard is measured elsewhere)
stubguard22() {
  node -e '
    const fs = require("fs"); const f = process.argv[1]; const s = fs.readFileSync(f, "utf8"); const needle = "function guardRefusal() {\n";
    if (s.split(needle).length !== 2) { console.error("approve: needle count != 1"); process.exit(3); }
    fs.writeFileSync(f, s.replace(needle, () => needle + "  return null; // fixture stub\n"));
  ' "$TREE/_shared/lib/xprov-approve.cjs" || bad "OS harness: guardRefusal stub failed"
}
auditf22() { echo "$HOME/.a1-xprov/consent-audit.jsonl"; }
audit_lines22() { [[ -e "$(auditf22)" ]] && wc -l < "$(auditf22)" | tr -d ' ' || echo 0; }
audit_state22() { sub22 permit-check; json_get "$G_OUT" "j.audit"; }
nothing22() { [[ ! -e "$HOME/.a1-xprov/permits.json" && ! -e "$HOME/.a1-xprov/permit-denials.json" && ! -e "$HOME/.a1-xprov/consent-audit.jsonl" && ! -e "$PHASE_REPO/.a1/xprov.json" ]]; }

# ---------- OS1: the owner root is the passwd home (FR-009) ----------
caseOS1() {
  local oh="$REPO_ROOT/_shared/lib/xprov-owner-home.cjs" got
  got="$(node -p 'require(process.argv[1]).ownerHome()' "$oh")"
  assert_eq "OS1a ownerHome() is the home of the OS user record" "$got" "$REAL_PASSWD_HOME"
  [[ "$got" != "$HOME" ]] && ok "OS1a the suite \$HOME differs from it (the redirect is real)" || bad "OS1a suite HOME equals the passwd home"
  got="$(node -p 'String(require(process.argv[1]).homeMismatch())' "$oh")"
  [[ "$got" == *"differs from the home directory of the OS user"* ]] && ok "OS1b a redirected \$HOME is reported" || bad "OS1b got: $got"
  assert_eq "OS1c \$HOME = passwd home → no mismatch" "$(HOME="$REAL_PASSWD_HOME" node -p 'String(require(process.argv[1]).homeMismatch())' "$oh")" "null"
  assert_eq "OS1d xprovHome() resolves under the passwd home although \$HOME is redirected" "$(node -p 'require(process.argv[1]).xprovHome()' "$XPROV_LIB")" "$REAL_PASSWD_HOME/.a1-xprov"
}

# ---------- OS2: HOME tripwire (FR-009) ----------
caseOS2() {
  local PD="$TMP22/passwd"; rm -rf "$PD"; mkdir -p "$PD"
  passwd_tree22 "$PD"; make_phase p22
  sub22 permit-check
  assert_rc "OS2a permit-check under a redirected HOME exits 1" 1 "$G_RC" "$G_ERR"
  assert_json "OS2a state home_mismatch, reason owner_home_mismatch, not ok" "$G_OUT" "[j.state, j.reason, j.ok].join('/')" "home_mismatch/owner_home_mismatch/false"
  assert_json "OS2a enforcement unenforced is reported" "$G_OUT" "j.enforcement" "unenforced"
  assert_json "OS2b permit() refuses" "$(permit22)" "[j.threw, j.reason].join('/')" "true/owner_home_mismatch"
  assert_json "OS2c writeGuardedStore refuses" "$(lib22 "AP.writeGuardedStore('x.json', { a: 1 })")" "j.reason" "owner_home_mismatch"
  assert_json "OS2d writeScanRecord refuses before it parses" "$(lib22 "SR.writeScanRecord('snap-x', {})")" "j.reason" "owner_home_mismatch"
  js22="AU.appendAudit({ repo: '/x/.git', action: 'permit' })"   # (a variable: macOS bash 3.2 brace-expands the comma inside a nested \$(…"…")
  assert_json "OS2e appendAudit refuses" "$(lib22 "$js22")" "j.reason" "owner_home_mismatch"
  [[ ! -e "$PD/.a1-xprov" && ! -e "$HOME/.a1-xprov" && ! -e "$PHASE_REPO/.a1/xprov.json" ]] && ok "OS2 zero bytes: neither home, nor the repo file" || bad "OS2 a byte was written: $(ls -A "$PD" "$HOME" 2>&1 | tr '\n' ' ')"
  assert_json "OS2f control: HOME = passwd home → permit() writes" "$(HOME="$PD" permit22)" "j.ok" "true"
  [[ -f "$PD/.a1-xprov/permits.json" ]] && ok "OS2f the store lives under the passwd home" || bad "OS2f no store under $PD"
  HOME="$PD" sub22 permit-check
  assert_json "OS2f permit-check allowed when HOME = passwd home" "$G_OUT" "j.state" "allowed"
  ln -s "$PD" "$TMP22/homelink"
  HOME="$TMP22/homelink" sub22 permit-check
  assert_json "OS2g a symlinked HOME naming the same directory is no mismatch" "$G_OUT" "j.state" "allowed"
}

# ---------- OS3: classification of an origin (FR-007 input) ----------
caseOS3() {
  make_tree
  local r; r="$(node -e '
    const RI = require(process.argv[1] + "/_shared/lib/xprov-repo-identity.cjs");
    const org = ["git@github.com:N3URAL-A1/a1-specforge.git", "https://github.com/N3URAL-A1/a1-specforge", "https://github.com/n3ural-a1/x.git", "ssh://git@github.com/N3URAL-A1/x.git", "https://user:tok@github.com/N3URAL-A1/x.git", "https://github.com:443/N3URAL-A1/x/"];
    const cust = [null, "", "https://github.com/other/x.git", "https://github.com.evil.com/N3URAL-A1/x", "https://github.com/N3URAL-A1-evil/x", "https://evil.com/github.com/N3URAL-A1/x", "git@evil.com:N3URAL-A1/x.git",
      "https://github.com/evil/N3URAL-A1/x", "https://github.com/N3URAL-A1/x/../../evil", "/local/path/N3URAL-A1/x", "file:///N3URAL-A1/x", "https://github.com/N3URAL-A1/$(touch p)", "https://github.com/N3URAL-A1/x;rm -rf /",
      "https://github.com/N3URAL-A1/" + "a".repeat(10001), "git@github.com:N3URAL-A1", "https://github.com/N3URAL-A1"];
    const bad = [...org.filter((o) => RI.classifyOrigin(o) !== "org").map((o) => "org:" + o), ...cust.filter((o) => RI.classifyOrigin(o) !== "customer").map((o) => "cust:" + String(o).slice(0, 60))];
    process.stdout.write(JSON.stringify({ bad, n: org.length + cust.length }));
  ' "$TREE")"
  assert_json "OS3 every origin classifies as expected (org vs customer), none misclassified" "$r" "j.bad.length + '/' + j.n" "0/22"
}

# ---------- OS4: origin-bound identity (FR-006) ----------
caseOS4() {
  prep22; origin22 "$ORG22"
  assert_json "OS4a permit() ok" "$(permit22)" "j.ok" "true"
  local store; store="$(cat "$HOME/.a1-xprov/permits.json")"
  assert_json "OS4a the entry records repo key and raw origin" "$store" "(() => { const e = Object.values(j.permits)[0]; return [Object.keys(j.permits)[0] === '$(key22)', e.repo === '$(key22)', e.origin === '$ORG22'].join('/'); })()" "true/true/true"
  sub22 permit-check
  assert_rc "OS4a permit-check exit 0" 0 "$G_RC" "$G_ERR"
  assert_json "OS4a allowed, enforcement unenforced, audit ok" "$G_OUT" "[j.state, j.enforcement, j.audit].join('/')" "allowed/unenforced/ok"
  [[ "$G_ERR" == *"enforcement unenforced"* && "$G_ERR" != *nforgeable* ]] && ok "OS4a stderr states the tier-0 limit" || bad "OS4a stderr: $G_ERR"
  origin22 https://github.com/other/fixture.git; sub22 permit-check
  assert_rc "OS4b origin changed → exit 1" 1 "$G_RC"
  assert_json "OS4b state origin_changed, reason external_review_not_permitted, not ok" "$G_OUT" "[j.state, j.reason, j.ok].join('/')" "origin_changed/external_review_not_permitted/false"
  origin22 ""; sub22 permit-check
  assert_json "OS4c origin disappears → void" "$G_OUT" "j.state + '/' + j.ok" "origin_changed/false"
  origin22 "$ORG22"; sub22 permit-check
  assert_json "OS4d the recorded origin again → allowed" "$G_OUT" "j.state" "allowed"
  prep22; permit22 >/dev/null
  assert_json "OS4e a permit without origin records explicit null" "$(cat "$HOME/.a1-xprov/permits.json")" "Object.values(j.permits)[0].origin === null" "true"
  sub22 permit-check; assert_json "OS4e allowed while no origin exists" "$G_OUT" "j.state" "allowed"
  origin22 "$ORG22"; sub22 permit-check
  assert_json "OS4e origin appears → void" "$G_OUT" "j.state" "origin_changed"
  # unbound entry (no repo, no origin, no audit key): no permit of any date (re-review MAJOR-1, spec 016 Clarifications); see OS10
  prep22; origin22 "$ORG22"; write_permit "$PHASE_REPO" robert "$REC22" "" 2026-10-14
  editstore22 "delete e.repo; delete e.origin; delete e.audit"
  sub22 permit-check; assert_json "OS4f an unbound entry is unbound_legacy, audit missing" "$G_OUT" "j.state + '/' + j.audit + '/' + j.ok" "unbound_legacy/missing/false"
  # record copied from repo A to repo B (same origin, so only the repo key differs)
  prep22; origin22 "$ORG22"; local A="$PHASE_REPO"; permit22 >/dev/null; make_phase p22; origin22 "$ORG22"
  mkdir -p "$PHASE_REPO/.a1"; cp "$A/.a1/xprov.json" "$PHASE_REPO/.a1/xprov.json"
  node -e '
    const fs = require("fs"); const [keyA, keyB, store] = process.argv.slice(1); const d = JSON.parse(fs.readFileSync(store, "utf8"));
    d.permits[keyB] = d.permits[keyA]; fs.writeFileSync(store, JSON.stringify(d, null, 2) + "\n", { mode: 0o600 });
  ' "$(key22 "$A")" "$(key22)" "$HOME/.a1-xprov/permits.json"
  sub22 permit-check
  assert_rc "OS4g a record copied from repo A to repo B → exit 1" 1 "$G_RC"
  assert_json "OS4g state permit_mismatch" "$G_OUT" "j.state" "permit_mismatch"
  # hostile origins stay inert strings
  local u
  for u in 'https://x.example/$(touch PWNED22)' 'https://x.example/;rm -rf /' 'https://x.example/`touch PWNED22`' 'https://x.example/a b|c&d'; do
    prep22; origin22 "$u"
    assert_json "OS4h hostile origin $u is stored verbatim" "$(permit22)" "j.ok + '/' + j.record.external_review" "true/allowed"
    sub22 permit-check
    assert_json "OS4h permit-check allowed, origin compared as a plain string" "$G_OUT" "j.state" "allowed"
    [[ ! -e "$PHASE_REPO/PWNED22" && ! -e "$PWD/PWNED22" && ! -e "$TMP22/PWNED22" ]] && ok "OS4h nothing was executed for $u" || bad "OS4h $u was executed"
  done
  prep22; origin22 "$(node -e 'process.stdout.write("https://example.com/" + "a".repeat(10001))')"
  assert_json "OS4i a 10 001-char origin: permit() refuses (origin_too_long)" "$(permit22)" "j.reason" "origin_too_long"
  nothing22 && ok "OS4i nothing written" || bad "OS4i something was written"
  sub22 permit-check --repo "$PHASE_REPO/../.."
  assert_rc "OS4j --repo traversal → exit 2" 2 "$G_RC" "$G_ERR"
}

# ---------- OS5: audit chain (FR-010) ----------
caseOS5() {
  prep22; origin22 "$ORG22"; permit22 >/dev/null
  local f; f="$(auditf22)"
  assert_eq "OS5a one audit line after permit" "$(audit_lines22)" "1"
  assert_json "OS5a line fields: action permit, repo key, prev null, ids null" "$(head -n 1 "$f" | node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(JSON.stringify(j))')" "JSON.stringify([j.action, j.repo === '$(key22)', j.prev, j.tool_use_id, j.session_id, j.permission_mode, j.ts])" "[\"permit\",true,null,null,null,null,\"$NOW22\"]"
  deny22 >/dev/null
  assert_eq "OS5b a second line after the denial" "$(audit_lines22)" "2"
  head -n 1 "$f" > "$TMP22/l1.txt"; local want; want="$(printf '%s' "$(cat "$TMP22/l1.txt")" > "$TMP22/l1.raw"; sha256_of "$TMP22/l1.raw")"
  assert_json "OS5b line 2 chains to the sha256 of line 1's exact text" "$(sed -n 2p "$f")" "[j.action, j.prev === '$want'].join('/')" "permit-deny/true"
  assert_eq "OS5b audit file mode 0600" "$(mode_of "$f")" "600"
  [[ ! -e "$HOME/.a1-xprov/.consent-audit.lock" ]] && ok "OS5b no lock file left" || bad "OS5b lock file left"
  assert_eq "OS5c audit ok for a denial" "$(audit_state22)" "ok"
  cp "$f" "$TMP22/good.jsonl"
  tamper22() { cp "$TMP22/good.jsonl" "$f"; "$@"; assert_eq "OS5d tampered ($TAMPER22) → audit broken" "$(audit_state22)" "broken"; }
  TAMPER22=edit-ts-of-line-1; tamper22 node -e 'const fs=require("fs");const f=process.argv[1];const l=fs.readFileSync(f,"utf8").split("\n");l[0]=l[0].replace("2026-10-14","2026-10-15");fs.writeFileSync(f,l.join("\n"))' "$f"
  TAMPER22=drop-line-1; tamper22 bash -c 'tail -n +2 "$1" > "$1.new" && mv "$1.new" "$1"' _ "$f"
  TAMPER22=append-garbage; tamper22 bash -c 'printf "garbage\n" >> "$1"' _ "$f"
  TAMPER22=no-final-newline; tamper22 bash -c 'printf "%s" "$(cat "$1")" > "$1"' _ "$f"
  TAMPER22=append-empty-object; tamper22 bash -c 'printf "{}\n" >> "$1"' _ "$f"
  cp "$TMP22/good.jsonl" "$f"; local before; before="$(sha256_of "$HOME/.a1-xprov/permits.json")"
  printf 'garbage\n' >> "$f"
  assert_json "OS5f a broken chain is never extended: permit() refuses" "$(permit22)" "j.reason" "audit_broken"
  assert_eq "OS5f the permit store is unchanged" "$(sha256_of "$HOME/.a1-xprov/permits.json")" "$before"
  mv "$f" "$TMP22/real.jsonl"; ln -s "$TMP22/real.jsonl" "$f"
  assert_eq "OS5g a symlinked audit log → broken" "$(audit_state22)" "broken"
  rm -f "$f"; assert_eq "OS5h no audit log next to a bound entry → broken (SEC-1; an unbound entry stays missing, OS4f)" "$(audit_state22)" "broken"
  : > "$f"; assert_eq "OS5h empty audit log next to a bound entry → broken" "$(audit_state22)" "broken"
  # a hand-written permit of another repo (no audit line for it): visible as missing
  rm -f "$f"; permit22 >/dev/null; make_phase p22; write_permit_file_only "$PHASE_REPO" robert "$REC22" "" 2026-10-14; write_permit_store "$PHASE_REPO" robert "$REC22" "" 2026-10-14
  assert_eq "OS5i a forged entry next to an audited one → audit missing for it" "$(audit_state22)" "missing"
  # parallel appenders keep the chain intact
  prep22; local pids=() i
  for i in 1 2 3 4 5 6 7 8; do lib22 "AU.appendAudit({ repo: '/r$i/.git', action: 'permit' })" >/dev/null & pids+=($!); done
  wait "${pids[@]}"
  assert_eq "OS5j eight parallel appends give eight lines" "$(audit_lines22)" "8"
  assert_json "OS5j the chain verifies" "$(lib22 "AU.readChain('$(auditf22)')")" "j.state + '/' + j.lines.length" "ok/8"
  # hostile fields
  js22="AU.appendAudit({ repo: '/x/.git', action: 'x; rm -rf /' })"
  assert_json "OS5k injection-shaped action is refused" "$(lib22 "$js22")" "j.reason" "audit_input"
  js22="(() => { const l = AU.appendAudit({ repo: '/x/.git', action: 'permit', tool_use_id: 'a'.repeat(10000) }); return [l.tool_use_id.length, AU.readChain('$(auditf22)').state].join('/'); })()"
  assert_eq "OS5k a 10 000-char tool_use_id is cut to 200 and the chain still verifies" "$(lib22 "$js22" | tr -d '"')" "200/ok"
  js22="AU.appendAudit({ repo: '/x/.git', action: 'permit', session_id: 'a\\nb' })"
  assert_json "OS5k a newline in session_id is refused (one line per entry)" "$(lib22 "$js22")" "j.reason" "audit_input"
  # the TTY guard still refuses, before any audit line
  prep22; origin22 "$ORG22"
  sub22 permit --by robert --record "$REC22"
  assert_rc "OS5l piped stdin → permit exits 2 (TTY guard intact)" 2 "$G_RC"
  nothing22 && ok "OS5l refused before the audit line, the stores and the file" || bad "OS5l a byte was written"
}

# ---------- OS5m: the terminal writers append audit lines (FR-010, FR-011) ----------
caseOS5m() {
  prep22; stubguard22; origin22 "$ORG22"
  piped22 allowed permit --by robert --record "$REC22" --repo "$PHASE_REPO"
  assert_rc "OS5m permit (guard stubbed, typed word) exit 0" 0 "$G_RC" "$G_ERR"
  assert_json "OS5m last audit line: permit" "$(tail -n 1 "$(auditf22)")" "j.action + '/' + (j.repo === '$(key22)')" "permit/true"
  piped22 denied permit --deny --by robert --repo "$PHASE_REPO"
  assert_rc "OS5m permit --deny exit 0" 0 "$G_RC" "$G_ERR"
  assert_json "OS5m last audit line: permit-deny" "$(tail -n 1 "$(auditf22)")" "j.action" "permit-deny"
  piped22 plan-review-xprov waive --phase p22 --gate plan-review-xprov --reason "fixture" --by robert
  assert_rc "OS5m waive exit 0" 0 "$G_RC" "$G_ERR"
  assert_json "OS5m last audit line: waive, repo key" "$(tail -n 1 "$(auditf22)")" "j.action + '/' + (j.repo === '$(key22)')" "waive/true"
  local sha; sha="$(printf 'a%.0s' $(seq 1 64))"
  node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ version: 1, repos: { [process.argv[2]]: [process.argv[3]] } }) + "\n", { mode: 0o600 });' "$HOME/.a1-xprov/allowlist-approvals.json" "$(key22)" "$sha"
  piped22 "" allowlist approve --repo "$PHASE_REPO" --revoke "$sha" --by robert
  assert_rc "OS5m allowlist approve --revoke (guard stubbed) exit 0" 0 "$G_RC" "$G_ERR"
  assert_json "OS5m last audit line: allowlist-revoke" "$(tail -n 1 "$(auditf22)")" "j.action" "allowlist-revoke"
  assert_eq "OS5m four lines, one per owner write" "$(audit_lines22)" "4"
  assert_json "OS5m the chain verifies" "$(lib22 "AU.readChain('$(auditf22)').state")" "j" "ok"
}

# ---------- OS6: owner-chat is reserved (FR-011) ----------
caseOS6() {
  prep22; stubguard22   # guard stubbed: the rejection must come from the reserved-value check, not from the TTY guard
  local v n=0
  for v in 'owner-chat' 'Owner-Chat' 'OWNER_CHAT' $'owner\xe2\x80\x91chat' $'\xef\xbd\x8f\xef\xbd\x97\xef\xbd\x8e\xef\xbd\x85\xef\xbd\x92-chat'; do
    n=$((n + 1))
    piped22 allowed permit --by "$v" --record "$REC22"
    assert_rc "OS6a permit --by variant $n → exit 2" 2 "$G_RC"; [[ "$G_ERR" == *reserved* || "$G_ERR" == *ASCII* ]] && ok "OS6a variant $n says reserved" || bad "OS6a variant $n: $G_ERR"
    piped22 denied permit --deny --by "$v"
    assert_rc "OS6b permit --deny --by variant $n → exit 2" 2 "$G_RC"; [[ "$G_ERR" == *reserved* || "$G_ERR" == *ASCII* ]] && ok "OS6b variant $n says reserved" || bad "OS6b variant $n: $G_ERR"
    piped22 plan-review-xprov waive --phase p22 --gate plan-review-xprov --reason r --by "$v"
    assert_rc "OS6c waive --by variant $n → exit 2" 2 "$G_RC"; [[ "$G_ERR" == *reserved* || "$G_ERR" == *ASCII* ]] && ok "OS6c variant $n says reserved" || bad "OS6c variant $n: $G_ERR"
    piped22 "" allowlist approve --repo "$PHASE_REPO" --by "$v"
    assert_rc "OS6d allowlist approve --by variant $n → exit 2" 2 "$G_RC"; [[ "$G_ERR" == *reserved* || "$G_ERR" == *ASCII* ]] && ok "OS6d variant $n says reserved" || bad "OS6d variant $n: $G_ERR"
  done
  nothing22 && ok "OS6 nothing written by any rejected call" || bad "OS6 a rejected call wrote"
  local big; big="$(printf 'a%.0s' $(seq 1 10000))"
  piped22 allowed permit --by "$big" --record "$REC22"; assert_rc "OS6e 10 000-char --by (permit) → exit 2" 2 "$G_RC"
  piped22 plan-review-xprov waive --phase p22 --gate plan-review-xprov --reason r --by "$big"; assert_rc "OS6e 10 000-char --by (waive) → exit 2" 2 "$G_RC"
  piped22 "" allowlist approve --repo "$PHASE_REPO" --by "$big"; assert_rc "OS6e 10 000-char --by (approve) → exit 2" 2 "$G_RC"
  piped22 allowed permit --by '; rm -rf /' --record "$REC22"; assert_rc "OS6f injection-shaped --by → exit 2" 2 "$G_RC"
  nothing22 && ok "OS6e/f nothing written" || bad "OS6e/f a rejected call wrote"
}

# ---------- OS7: zero bytes without a valid permit (FR-001) ----------
caseOS7() {
  local argv="$TMP22/argv.json" v
  for v in none origin copied; do
    prep22; origin22 "$ORG22"; rm -f "$argv"
    case "$v" in
      origin) permit22 >/dev/null; origin22 https://github.com/other/fixture.git ;;
      copied) write_permit_file_only "$PHASE_REPO" robert "$REC22" "" 2026-10-14 ;;
    esac
    FAKE_RUNNER_ARGV_FILE="$argv" fake_runner_env
    G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p22 --gate "$GATE_PLAN" 2>"$TMP22/err.txt")"; G_RC=$?
    assert_rc "OS7 [$v] plan gate exits 1 (no valid permit)" 1 "$G_RC"
    G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p22 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD" 2>"$TMP22/err.txt")"
    [[ ! -e "$argv" ]] && ok "OS7 [$v] the fake runner recorded zero calls" || bad "OS7 [$v] the runner was invoked"
    [[ -z "$(ls -A "$HOME/.a1-xprov/snapshots" 2>/dev/null)" ]] && ok "OS7 [$v] no snapshot was built" || bad "OS7 [$v] a snapshot exists"
  done
  FAKE_RUNNER_ARGV_FILE="" fake_runner_env
}

# ---------- OS8: dispatch table, reasons, wording (FR-010) ----------
caseOS8() {
  make_tree
  local sub wave out
  for sub in consent:2 scope:6 dispose:9; do
    rm -f "$TREE/_shared/lib/xprov-${sub%%:*}.cjs"; wave="${sub##*:}"
    out="$(node "$TREE_TOOLS" xprov "${sub%%:*}" 2>&1 >/dev/null </dev/null)"; local rc=$?
    assert_rc "OS8a xprov ${sub%%:*} without its module fails closed (exit 2)" 2 "$rc"
    [[ "$out" == *"not implemented yet (planned wave $wave)"* ]] && ok "OS8a ${sub%%:*}: 'not implemented yet (planned wave $wave)'" || bad "OS8a ${sub%%:*}: $out"
  done
  out="$(node -e 'const x = require(process.argv[1]); process.stdout.write(JSON.stringify({ s: x.SUBCOMMAND_NAMES.slice(-3), r: x.REASON_LIST.slice(-4) }));' "$XPROV_LIB")"
  assert_json "OS8b dispatch entries consent, scope, dispose" "$out" "j.s.join(',')" "consent,scope,dispose"
  assert_json "OS8b new reason codes" "$out" "j.r.join(',')" "secret_declined,pr_anchor_unavailable,pr_base_mismatch,pr_merge_blocked"
  local help; help="$(node "$TOOLS" xprov --help 2>&1; node "$TOOLS" --help 2>&1)"
  grep -qiE 'unforgeable|tamper[- ]?proof' <<<"$help" && bad "OS8c a help text claims unforgeable/tamper-proof" || ok "OS8c no help text claims unforgeable or tamper-proof"
  grep -q 'enforcement: unenforced' <<<"$help" && ok "OS8c help states enforcement: unenforced" || bad "OS8c help lacks the tier-0 statement"
}

# ---------- security-review fixes SEC-1..SEC-8 (wave 1 review) ----------
# editstore22 <js> — runs <js> over the first permit entry `e` (and the document `d`) of the suite permit store.
editstore22() {
  node -e '
    const fs = require("fs"); const f = process.argv[1]; const d = JSON.parse(fs.readFileSync(f, "utf8")); const e = Object.values(d.permits)[0];
    eval(process.argv[2]); fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n", { mode: 0o600 });
  ' "$HOME/.a1-xprov/permits.json" "$1"
}
# linesha22 <n> — sha256 of the exact text of audit line n (computed here, never by the code under test)
linesha22() { sed -n "${1}p" "$(auditf22)" | tr -d '\n' > "$TMP22/line.raw"; sha256_of "$TMP22/line.raw"; }
# check22 <name> <state/reason/audit/ok> — permit-check result in one literal
check22() { sub22 permit-check; assert_json "$1" "$G_OUT" "[j.state, j.reason || '-', j.audit, j.ok].join('/')" "$2"; }
FAILCLOSED22=audit_broken/external_review_not_permitted/broken/false

# ---------- OS9: the audit line is bound to the store entry (SEC-1, FR-010) ----------
# Red proofs (one production change each, all in xprov-audit.cjs verifyAudit unless named):
#   OS9a  red if appendAudit's line sha is not stored (xprov-permit.cjs permit(): `audit:` dropped)
#   OS9b/f red if the `later` (last permit/denial line) check is dropped
#   OS9c  red if the sha-in-chain check (idx < 0) is dropped; OS9g likewise
#   OS9d  red if the KIND_ACTIONS (permit vs permit-deny) check is dropped
#   OS9e  red if the `line.repo !== repoKey` check is dropped
#   OS9h  red if a bound entry next to a missing log is reported `missing` instead of `broken`
#   OS9i  red if permitCheck stops mapping audit broken → audit_broken (the permit would stay allowed)
caseOS9() {
  prep22; origin22 "$ORG22"; permit22 >/dev/null
  assert_json "OS9a the permit entry stores the sha of its audit line" "$(cat "$HOME/.a1-xprov/permits.json")" "Object.values(j.permits)[0].audit === '$(linesha22 1)'" "true"
  check22 "OS9a baseline: allowed, audit ok" "allowed/-/ok/true"
  # b: a later permit-deny line for the repository (a denial that never reached the store) supersedes the permit
  js22="AU.appendAudit({ repo: '$(key22)', action: 'permit-deny', now: '$NOW22' })"; lib22 "$js22" >/dev/null
  check22 "OS9b a later permit-deny line → fail closed (audit_broken)" "$FAILCLOSED22"
  assert_rc "OS9b permit-check exits 1" 1 "$G_RC"
  [[ "$G_ERR" == *supersedes* ]] && ok "OS9b the detail names the superseding line" || bad "OS9b stderr: $G_ERR"
  # d: the entry points at the permit-deny line (last grant line, right repo, wrong action)
  editstore22 "e.audit = '$(linesha22 2)'"
  check22 "OS9d the entry names a permit-deny line → audit_broken" "$FAILCLOSED22"
  # c: truncation of the permit line
  prep22; origin22 "$ORG22"; permit22 >/dev/null; deny22 >/dev/null; permit22 >/dev/null
  check22 "OS9c control: permit, deny, permit → allowed, audit ok" "allowed/-/ok/true"
  cp "$(auditf22)" "$TMP22/three.jsonl"; head -n 1 "$TMP22/three.jsonl" > "$(auditf22)"
  check22 "OS9c the log truncated to line 1 (entry names line 3) → audit_broken" "$FAILCLOSED22"
  # e: the entry points at a line of another repository
  prep22; origin22 "$ORG22"; permit22 >/dev/null
  js22="AU.appendAudit({ repo: '/other/repo/.git', action: 'permit', now: '$NOW22' })"; lib22 "$js22" >/dev/null
  editstore22 "e.audit = '$(linesha22 2)'"
  check22 "OS9e the entry names a line of another repository → audit_broken" "$FAILCLOSED22"
  # f: a failed permit — the audit line is written, the store write fails; the old entry no longer matches the last line
  prep22; origin22 "$ORG22"; permit22 >/dev/null
  js22="(() => { require(L + 'xprov-permits.cjs').writePermits = () => { const e = new Error('disk full'); e.code = 'EIO'; throw e; }; return P.permit({ repoRoot: '$PHASE_REPO', by: 'robert', record: '$REC22', today: '2026-10-14', now: '2026-10-14T01:00:00.000Z' }); })()"
  assert_json "OS9f a permit whose store write fails reports permit_write_failed" "$(lib22 "$js22")" "j.reason" "permit_write_failed"
  assert_eq "OS9f the failed permit left its audit line" "$(audit_lines22)" "2"
  check22 "OS9f the old entry is not vouched for by the chain → audit_broken" "$FAILCLOSED22"
  # g: a hand-written bound entry with an invented audit sha
  prep22; origin22 "$ORG22"; permit22 >/dev/null
  editstore22 "e.audit = '$(printf 'a%.0s' $(seq 1 64))'"
  check22 "OS9g a bound entry naming an unknown audit line → audit_broken" "$FAILCLOSED22"
  # h: a bound entry without any audit log
  prep22; origin22 "$ORG22"; permit22 >/dev/null; rm -f "$(auditf22)"
  check22 "OS9h a bound entry and no audit log → audit_broken (not missing)" "$FAILCLOSED22"
  : > "$(auditf22)"
  check22 "OS9h a bound entry and an empty audit log → audit_broken" "$FAILCLOSED22"
  # i: the same state through the plan gate — no runner call, exit 1
  local argv="$TMP22/argv9.json"; rm -f "$argv"; FAKE_RUNNER_ARGV_FILE="$argv" fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p22 --gate "$GATE_PLAN" 2>"$TMP22/err.txt")"; G_RC=$?
  assert_rc "OS9i the plan gate refuses on audit_broken" 1 "$G_RC"
  [[ ! -e "$argv" ]] && ok "OS9i the fake runner recorded zero calls" || bad "OS9i the runner was invoked"
  FAKE_RUNNER_ARGV_FILE="" fake_runner_env
  # j: the denial entry is bound too
  prep22; origin22 "$ORG22"; permit22 >/dev/null; deny22 >/dev/null
  assert_json "OS9j the denial entry stores the sha of its audit line" "$(cat "$HOME/.a1-xprov/permit-denials.json")" "Object.values(j.denials)[0].audit === '$(linesha22 2)'" "true"
  check22 "OS9j denied, audit ok" "denied/external_review_denied/ok/false"
  head -n 1 "$(auditf22)" > "$TMP22/one.jsonl"; cp "$TMP22/one.jsonl" "$(auditf22)"
  check22 "OS9j a truncated log is visible on a denial too" "denied/external_review_denied/broken/false"
  # k: re-permit after the denial binds the new line
  prep22; origin22 "$ORG22"; permit22 >/dev/null; deny22 >/dev/null; permit22 >/dev/null
  check22 "OS9k permit after deny → allowed, audit ok" "allowed/-/ok/true"
}

# ---------- OS10: an unbound entry is no permit of any date (re-review MAJOR-1, FR-006) ----------
# Red proofs (one production change each, xprov-permit.cjs):
#   OS10a-c red if classify() lets an entry without repo/origin/audit through again (the ts-based LEGACY_CUTOFF_MS check back in bindingProblem)
#   OS10d   red if a partial binding (audit sha, no repo/origin) is also reported unbound_legacy instead of permit_mismatch
#   OS10e   red if the unbound check moves behind permitAgrees() (the copied entry is then a mismatch, not unbound_legacy)
#   OS10f   red if REASON_OF_STATE drops unbound_legacy (no reason, the gate does not refuse by reason)
#   OS10g   red if permit() refuses to replace an unbound entry
caseOS10() {
  local U=unbound_legacy/external_review_not_permitted/missing/false ts
  for ts in 2026-10-13T23:59:59.000Z 2026-10-14T00:00:00.000Z 2026-01-01T00:00:00.000Z not-a-date; do
    prep22; origin22 "$ORG22"; permit22 >/dev/null
    editstore22 "delete e.repo; delete e.origin; delete e.audit; e.ts = '$ts'"
    check22 "OS10a an unbound entry (ts $ts) → unbound_legacy, not ok, audit missing" "$U"
  done
  sub22 permit-check
  assert_json "OS10b the file says allowed, yet the state is not a store mismatch" "$G_OUT" "[j.state, j.reason].join('/')" "unbound_legacy/external_review_not_permitted"
  [[ "$G_ERR" == *"no repository binding"* && "$G_ERR" != *"permit_mismatch"* ]] && ok "OS10c stderr explains the missing binding" || bad "OS10c stderr: $G_ERR"
  prep22; origin22 "$ORG22"; permit22 >/dev/null
  editstore22 "delete e.repo; delete e.origin"
  sub22 permit-check; assert_json "OS10d an entry with an audit sha but no repo/origin binding → permit_mismatch" "$G_OUT" "j.state" "permit_mismatch"
  # e: an unbound entry copied to another repository key (t1 case d) with a backdated ts
  prep22; origin22 "$ORG22"; permit22 >/dev/null; local A="$PHASE_REPO"; make_phase p22; origin22 "$ORG22"
  mkdir -p "$PHASE_REPO/.a1"; cp "$A/.a1/xprov.json" "$PHASE_REPO/.a1/xprov.json"
  node -e '
    const fs = require("fs"); const [keyA, keyB, store] = process.argv.slice(1); const d = JSON.parse(fs.readFileSync(store, "utf8"));
    const { repo, origin, audit, ...bare } = d.permits[keyA]; d.permits[keyB] = { ...bare, ts: "2026-01-01T00:00:00.000Z" }; fs.writeFileSync(store, JSON.stringify(d, null, 2) + "\n", { mode: 0o600 });
  ' "$(key22 "$A")" "$(key22)" "$HOME/.a1-xprov/permits.json"
  check22 "OS10e a backdated unbound copy on another repo key → unbound_legacy" "$U"
  # f: the gate sends nothing
  local argv="$TMP22/argv10.json"; rm -f "$argv"; FAKE_RUNNER_ARGV_FILE="$argv" fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p22 --gate "$GATE_PLAN" 2>"$TMP22/err.txt")"; G_RC=$?
  assert_rc "OS10f the plan gate refuses on an unbound entry" 1 "$G_RC"
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p22 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD" 2>"$TMP22/err.txt")"
  [[ ! -e "$argv" ]] && ok "OS10f the fake runner recorded zero calls" || bad "OS10f the runner was invoked"
  [[ -z "$(ls -A "$HOME/.a1-xprov/snapshots" 2>/dev/null)" ]] && ok "OS10f no snapshot was built" || bad "OS10f a snapshot exists"
  FAKE_RUNNER_ARGV_FILE="" fake_runner_env
  # g: a later bound permit replaces the unbound entry cleanly
  assert_json "OS10g re-permit over the unbound entry succeeds" "$(permit22)" "j.ok" "true"
  check22 "OS10g after the re-permit: allowed, audit ok" "allowed/-/ok/true"
  assert_json "OS10g the entry is bound now" "$(cat "$HOME/.a1-xprov/permits.json")" "Object.values(j.permits).filter((e) => e.repo && e.audit && 'origin' in e).length" "2"
}

# ---------- OS11: multi-valued and rewritten origins (SEC-2, FR-006/FR-007) ----------
# OS11a red if readOrigin reads one value (`--get`) instead of `--get-all`; OS11b red if the `remote get-url --all` read is dropped
# (insteadOf); OS11c red if the `--push` read is dropped; OS11d red if classifyOrigin accepts `.` / `..` as a repository name.
caseOS11() {
  prep22
  git -C "$PHASE_REPO" remote add origin "$ORG22"; git -C "$PHASE_REPO" config --add remote.origin.url https://evil.example/x.git
  js22="[RI.readOrigin('$PHASE_REPO'), RI.classifyOrigin(RI.readOrigin('$PHASE_REPO'))]"
  assert_json "OS11a two remote.origin.url values: the list, classified customer" "$(lib22 "$js22")" "j[0].length + '/' + j[1]" "2/customer"
  git -C "$PHASE_REPO" config --unset-all remote.origin.url; git -C "$PHASE_REPO" config --add remote.origin.url "$ORG22"; git -C "$PHASE_REPO" config --add remote.origin.url "$ORG22"
  assert_json "OS11a the same value twice is one value (org)" "$(lib22 "RI.classifyOrigin(RI.readOrigin('$PHASE_REPO'))")" "j" "org"
  origin22 "$ORG22"; git -C "$PHASE_REPO" config url.https://evil.example/.insteadOf https://github.com/
  js22="[RI.readOrigin('$PHASE_REPO'), RI.classifyOrigin(RI.readOrigin('$PHASE_REPO'))]"
  assert_json "OS11b an insteadOf rewrite disagrees with the raw url → customer" "$(lib22 "$js22")" "j[0].length + '/' + j[1]" "2/customer"
  git -C "$PHASE_REPO" config --unset url.https://evil.example/.insteadOf; origin22 "$ORG22"
  git -C "$PHASE_REPO" config remote.origin.pushurl https://evil.example/x.git
  js22="[RI.readOrigin('$PHASE_REPO'), RI.classifyOrigin(RI.readOrigin('$PHASE_REPO'))]"
  assert_json "OS11c a pushurl that differs → customer" "$(lib22 "$js22")" "j[0].length + '/' + j[1]" "2/customer"
  assert_json "OS11d '.' and '..' are no organisation repository names" "$(lib22 "['https://github.com/N3URAL-A1/..', 'https://github.com/N3URAL-A1/.', 'git@github.com:N3URAL-A1/..'].map((o) => RI.classifyOrigin(o))")" "j.join(',')" "customer,customer,customer"
  # the full list is the binding: a permit on a two-valued origin is void when one value goes
  prep22; origin22 "$ORG22"; git -C "$PHASE_REPO" config --add remote.origin.url https://evil.example/x.git
  assert_json "OS11e permit() on a two-valued origin stores the list" "$(permit22)" "j.ok" "true"
  assert_json "OS11e the entry holds both values" "$(cat "$HOME/.a1-xprov/permits.json")" "JSON.stringify(Object.values(j.permits)[0].origin.slice().sort()) === JSON.stringify(['$ORG22', 'https://evil.example/x.git'].sort())" "true"
  sub22 permit-check; assert_json "OS11e unchanged list → allowed" "$G_OUT" "j.state" "allowed"
  git -C "$PHASE_REPO" config --unset-all remote.origin.url https://evil.example/x.git
  sub22 permit-check; assert_json "OS11e one value dropped → origin_changed" "$G_OUT" "j.state" "origin_changed"
}

# ---------- OS12: git env redirection (SEC-3) ----------
# Red if commonDirOf / readOrigin stop running under ownerGitEnv() (GIT_ENV_DROP removed) or use the PATH `git`.
caseOS12() {
  prep22; origin22 "$ORG22"; permit22 >/dev/null
  local A="$PHASE_REPO"; make_phase p22; origin22 "$ORG22"
  mkdir -p "$PHASE_REPO/.a1"; cp "$A/.a1/xprov.json" "$PHASE_REPO/.a1/xprov.json"
  js22="P.permitCheck({ repoRoot: '$PHASE_REPO' })"
  assert_json "OS12a control: repo B with A's record and no entry of its own → permit_mismatch" "$(lib22 "$js22")" "j.state" "permit_mismatch"
  assert_json "OS12b GIT_DIR naming repo A while checking B does not make B repo A" "$(GIT_DIR="$A/.git" lib22 "$js22")" "j.state + '/' + j.ok" "permit_mismatch/false"
  assert_json "OS12c GIT_COMMON_DIR + GIT_WORK_TREE naming A: same" "$(GIT_COMMON_DIR="$A/.git" GIT_WORK_TREE="$A" lib22 "$js22")" "j.state" "permit_mismatch"
  js22="require(L + 'xprov-common.cjs').commonDirOf('$PHASE_REPO')"
  assert_eq "OS12d commonDirOf(B) is B's git dir under GIT_DIR=A" "$(GIT_DIR="$A/.git" lib22 "$js22")" "\"$(key22)\""
  # an empty PATH entry (= the current directory) must not select a planted `git`: the binary is resolved from absolute PATH entries only
  mkdir -p "$TMP22/cwdgit"; printf '#!/bin/sh\ntouch "%s/EVIL-GIT-RAN"\nexit 1\n' "$TMP22" > "$TMP22/cwdgit/git"; chmod +x "$TMP22/cwdgit/git"
  js22="require(L + 'xprov-repo-identity.cjs').readOrigin('$PHASE_REPO')"
  assert_eq "OS12e readOrigin does not run a git from the current directory" "$(cd "$TMP22/cwdgit" && PATH=":$PATH" lib22 "$js22")" "\"$ORG22\""
  [[ ! -e "$TMP22/EVIL-GIT-RAN" ]] && ok "OS12e the planted git did not run" || bad "OS12e the planted git ran"
}

# ---------- OS13: --by hardening (SEC-4, FR-011) ----------
# OS13a red if isReservedBy() strips only the old separator set; OS13b red if the non-ASCII refusal is dropped from rejectReservedBy();
# OS13c red if waive's --by is not checked with the permit name pattern (validatePlainBy).
caseOS13() {
  make_tree
  local v ok1
  for v in $'owner\xe2\x80\x8bchat' $'owner\xc2\xadchat' 'owner.chat' $'owner\xe2\x88\x92chat' 'owner chat' 'OWNER.CHAT'; do
    ok1="$(node -e 'const C = require(process.argv[1] + "/_shared/lib/xprov-common.cjs"); process.stdout.write(String(C.isReservedBy(process.argv[2])))' "$TREE" "$v")"
    assert_eq "OS13a isReservedBy($(printf '%s' "$v" | od -An -c | tr -s ' ' | head -c 40)) is true" "$ok1" "true"
  done
  ok1="$(node -e 'const C = require(process.argv[1] + "/_shared/lib/xprov-common.cjs"); try { C.rejectReservedBy("own\u0435r-chat"); process.stdout.write("accepted"); } catch (e) { process.stdout.write(e.reason); }' "$TREE")"
  assert_eq "OS13b a Cyrillic look-alike --by is refused (by_non_ascii)" "$ok1" "by_non_ascii"
  ok1="$(node -e 'const C = require(process.argv[1] + "/_shared/lib/xprov-common.cjs"); try { C.rejectReservedBy("caf\u00e9"); process.stdout.write("accepted"); } catch (e) { process.stdout.write(e.reason); }' "$TREE")"
  assert_eq "OS13b any non-ASCII --by is refused" "$ok1" "by_non_ascii"
  prep22; stubguard22
  for v in $'owner\xe2\x80\x8bchat' $'owner\xc2\xadchat' 'owner.chat' $'owner\xe2\x88\x92chat' $'own\xd0\xb5r-chat' 'ro bert' 'rob;x'; do
    piped22 allowed permit --by "$v" --record "$REC22"; assert_rc "OS13c permit --by $(printf '%s' "$v" | od -An -c | tr -s ' ' | head -c 30) → exit 2" 2 "$G_RC"
    piped22 denied permit --deny --by "$v"; assert_rc "OS13c permit --deny: exit 2" 2 "$G_RC"
    piped22 plan-review-xprov waive --phase p22 --gate plan-review-xprov --reason r --by "$v"; assert_rc "OS13c waive: exit 2" 2 "$G_RC"
    piped22 "" allowlist approve --repo "$PHASE_REPO" --by "$v"; assert_rc "OS13c allowlist approve: exit 2" 2 "$G_RC"
  done
  piped22 plan-review-xprov waive --phase p22 --gate plan-review-xprov --reason r --by 'robert.k-1'
  assert_rc "OS13d control: a plain name is still accepted by waive" 0 "$G_RC" "$G_ERR"
}

# ---------- OS14: audit lock (SEC-5) ----------
# OS14a/b red if a stale lock is not taken over; OS14c red if takeoverStale() removes a lock that is not the inode it observed stale;
# OS14d red if the lock is removed in `finally` without the inode/nonce check; OS14e red if a fresh lock is taken over.
caseOS14() {
  prep22; local H="$HOME/.a1-xprov" lock
  lock="$H/.consent-audit.lock"; mkdir -p "$H"; chmod 700 "$H"
  touch -t 202001010000 "$lock"; printf 'dead' > "$lock"; touch -t 202001010000 "$lock"
  js22="AU.appendAudit({ repo: '/s/.git', action: 'permit' }).repo"
  assert_json "OS14a a stale lock is taken over" "$(lib22 "$js22")" "j" "/s/.git"
  if ls -A "$H" | grep -q 'consent-audit.lock'; then bad "OS14a lock leftovers: $(ls -A "$H" | tr '\n' ' ')"; else ok "OS14a no lock, nonce, takeover or stale leftovers"; fi
  rm -rf "$H"; mkdir -p "$H"; chmod 700 "$H"; touch -t 202001010000 "$lock"; printf 'dead' > "$lock"; touch -t 202001010000 "$lock"
  local pids=() i
  for i in 1 2 3 4 5 6 7 8; do lib22 "AU.appendAudit({ repo: '/r$i/.git', action: 'permit' })" >/dev/null & pids+=($!); done
  wait "${pids[@]}"
  assert_json "OS14b eight appenders racing for one stale lock: eight lines, chain intact" "$(lib22 "AU.readChain('$(auditf22)')")" "j.state + '/' + j.lines.length" "ok/8"
  rm -rf "$H"; mkdir -p "$H"; chmod 700 "$H"
  js22="(() => { const fs = require('fs'); const lock = '$lock'; fs.writeFileSync(lock, 'old'); const observed = fs.lstatSync(lock); fs.writeFileSync(lock + '.next', 'fresh'); fs.renameSync(lock + '.next', lock); const r = AU.takeoverStale(lock, observed); return [r, fs.existsSync(lock) ? fs.readFileSync(lock, 'utf8') : 'GONE'].join('/'); })()"
  assert_json "OS14c a lock that replaced the observed stale one is not taken over" "$(lib22 "$js22")" "j" "false/fresh"
  rm -rf "$H"; mkdir -p "$H"; chmod 700 "$H"
  js22="(() => { const fs = require('fs'); AU.withLock('$H', () => { fs.rmSync('$lock', { force: true }); fs.writeFileSync('$lock', 'someone else'); }); return fs.existsSync('$lock') ? fs.readFileSync('$lock', 'utf8') : 'GONE'; })()"
  assert_json "OS14d the lock is removed only by its owner: a replaced lock survives" "$(lib22 "$js22")" "j" "someone else"
  rm -rf "$H"; mkdir -p "$H"; chmod 700 "$H"; printf 'live' > "$lock"
  js22="AU.appendAudit({ repo: '/s/.git', action: 'permit' })"
  assert_json "OS14e append against a live lock refuses" "$(lib22 "$js22")" "j.reason" "audit_locked"
  assert_eq "OS14e the live lock is untouched" "$(cat "$lock")" "live"
  [[ ! -e "$(auditf22)" ]] && ok "OS14e no audit line written" || bad "OS14e an audit line was written"
}

# ---------- OS15: scan-record remove and sweep are writes (SEC-6, FR-009) ----------
# Red if removeScanRecord() / sweepScanRecords() drop their assertWritable() call (one arm each).
caseOS15() {
  local PD="$TMP22/passwd15"; rm -rf "$PD"; mkdir -p "$PD/.a1-xprov/scan-records"; chmod 700 "$PD/.a1-xprov"
  printf '{}' > "$PD/.a1-xprov/scan-records/snap-x.json"
  passwd_tree22 "$PD"
  assert_json "OS15a removeScanRecord refuses under a redirected HOME" "$(lib22 "SR.removeScanRecord('snap-x')")" "j.reason" "owner_home_mismatch"
  assert_json "OS15b sweepScanRecords refuses under a redirected HOME" "$(lib22 "SR.sweepScanRecords(0, () => false, Date.now() + 1e9)")" "j.reason" "owner_home_mismatch"
  [[ -f "$PD/.a1-xprov/scan-records/snap-x.json" ]] && ok "OS15 the record is still there" || bad "OS15 the record was removed"
}

# ---------- OS16: audit free-text fields (SEC-8) ----------
# Red if nullableString() goes back to the ASCII-control-only pattern (C.LINE_BREAKERS_RE not used).
caseOS16() {
  prep22
  local v
  for v in '\u2028' '\u2029' '\u202e' '\u2066' '\u0085' '\u009f'; do
    js22="AU.appendAudit({ repo: '/x/.git', action: 'permit', tool_use_id: 'a${v}b' })"
    assert_json "OS16a tool_use_id with $v is refused (audit_input)" "$(lib22 "$js22")" "j.reason" "audit_input"
  done
  [[ ! -e "$(auditf22)" ]] && ok "OS16a nothing written" || bad "OS16a a line was written"
  js22="(() => { AU.appendAudit({ repo: '/x/.git', action: 'permit' }); const fs = require('fs'); const f = '$(auditf22)'; const l = JSON.parse(fs.readFileSync(f, 'utf8').trim()); fs.writeFileSync(f, JSON.stringify({ ...l, session_id: 's' + String.fromCharCode(0x202e) + 'x' }) + String.fromCharCode(10)); return AU.readChain(f).state; })()"
  assert_json "OS16b a hand-written line with a bidi control is off-format (broken)" "$(lib22 "$js22")" "j" "broken"
}

# ---------- OS17: re-review MINORs 2..5 ----------
# Red proofs (one production change each):
#   OS17a  red if takeoverStale() goes back to `rmdirSync(guard)` only (a stale non-empty .takeover blocks every append until the lock wait ends)
#   OS17b  red if a non-directory .takeover is silently skipped instead of refused (audit_lock_blocked)
#   OS17c  red if acquire() leaves its nonce file behind on a normal exit or on the audit_locked refusal
#   OS17d  red if the audit field check drops the \p{Cf} format-character class (xprov-audit.cjs nullableString)
#   OS17e  red if readOrigin() reads the raw origin without --local (a global/XDG origin then counts)
#   OS17f  red if HINT_AUDIT again advises removing the audit log
caseOS17() {
  prep22; local H="$HOME/.a1-xprov" lock guard
  lock="$H/.consent-audit.lock"; guard="$lock.takeover"
  rm -rf "$H"; mkdir -p "$H"; chmod 700 "$H"
  printf 'dead' > "$lock"; mkdir "$guard"; printf 'junk' > "$guard/junk"
  touch -t 202001010000 "$lock" "$guard/junk" "$guard"
  js22="AU.appendAudit({ repo: '/s/.git', action: 'permit' }).repo"
  assert_json "OS17a a stale non-empty .takeover does not block the append" "$(lib22 "$js22")" "j" "/s/.git"
  local aside; aside="$(ls -d "$guard".* 2>/dev/null | head -n 1)"
  [[ -n "$aside" && -f "$aside/junk" && "$(cat "$aside/junk")" == "junk" ]] && ok "OS17a the stale directory was renamed aside with its content, not deleted" || bad "OS17a aside: '$aside'"
  [[ ! -e "$guard" ]] && ok "OS17a the .takeover slot is free again" || bad "OS17a .takeover still there"
  rm -rf "$H"; mkdir -p "$H"; chmod 700 "$H"
  printf 'dead' > "$lock"; printf 'file' > "$guard"; touch -t 202001010000 "$lock" "$guard"
  assert_json "OS17b a .takeover that is a file → audit_lock_blocked" "$(lib22 "$js22")" "j.reason" "audit_lock_blocked"
  assert_json "OS17b the message names the path" "$(lib22 "$js22")" "String(j.message).includes('.consent-audit.lock.takeover')" "true"
  [[ "$(cat "$guard")" == "file" ]] && ok "OS17b the file was left untouched" || bad "OS17b the file changed"
  [[ ! -e "$(auditf22)" ]] && ok "OS17b no audit line written" || bad "OS17b an audit line was written"
  rm -rf "$H"; mkdir -p "$H"; chmod 700 "$H"
  lib22 "AU.appendAudit({ repo: '/s/.git', action: 'permit' })" >/dev/null
  printf 'live' > "$lock"; lib22 "AU.appendAudit({ repo: '/s/.git', action: 'permit' })" >/dev/null
  if ls -A "$H" | grep -E 'consent-audit\.lock\.[0-9a-f]{32}' >/dev/null; then bad "OS17c nonce leftovers: $(ls -A "$H" | tr '\n' ' ')"; else ok "OS17c no nonce file after a normal exit and after a refusal"; fi
  # d: invisible format characters in audit free-text fields
  rm -rf "$H"; mkdir -p "$H"; chmod 700 "$H"
  js22="[0x200e, 0x200f, 0x061c, 0x200b, 0xfeff, 0x2060, 0x00ad].map((cp) => { try { AU.appendAudit({ repo: '/x/.git', action: 'permit', session_id: 'a' + String.fromCharCode(cp) + 'b' }); return 'written'; } catch (e) { return e.reason || e.message; } }).join(',')"
  assert_json "OS17d U+200E U+200F U+061C U+200B U+FEFF U+2060 U+00AD in a field are each refused (audit_input)" "$(lib22 "$js22")" "j" "audit_input,audit_input,audit_input,audit_input,audit_input,audit_input,audit_input"
  [[ ! -e "$(auditf22)" ]] && ok "OS17d nothing written" || bad "OS17d a line was written"
  js22="(() => { AU.appendAudit({ repo: '/x/.git', action: 'permit' }); const fs = require('fs'); const f = '$(auditf22)'; const l = JSON.parse(fs.readFileSync(f, 'utf8').trim()); fs.writeFileSync(f, JSON.stringify({ ...l, permission_mode: 'p' + String.fromCharCode(0x200e) + 'x' }) + String.fromCharCode(10)); return AU.readChain(f).state; })()"
  assert_json "OS17d a hand-written line with U+200E is off-format (broken)" "$(lib22 "$js22")" "j" "broken"
  # e: an origin that exists only in global / XDG config is no origin
  prep22; local XD="$TMP22/xdg17"; rm -rf "$XD"; mkdir -p "$XD/git"
  printf '[remote "origin"]\n\turl = %s\n' "$ORG22" > "$XD/git/config"
  git -C "$PHASE_REPO" remote remove origin 2>/dev/null
  js22="[RI.readOrigin('$PHASE_REPO'), RI.classifyOrigin(RI.readOrigin('$PHASE_REPO'))]"
  assert_json "OS17e control: no XDG config → no origin, customer" "$(lib22 "$js22")" "JSON.stringify(j)" '[null,"customer"]'
  assert_json "OS17e an XDG-only origin counts as no origin → customer" "$(XDG_CONFIG_HOME="$XD" lib22 "$js22")" "JSON.stringify(j)" '[null,"customer"]'
  printf '[remote "origin"]\n\turl = %s\n' "$ORG22" > "$HOME/.gitconfig"
  assert_json "OS17e a ~/.gitconfig-only origin counts as no origin" "$(lib22 "$js22")" "JSON.stringify(j)" '[null,"customer"]'
  rm -f "$HOME/.gitconfig"
  origin22 "$ORG22"
  assert_json "OS17e a local origin is still read" "$(XDG_CONFIG_HOME="$XD" lib22 "$js22")" "JSON.stringify(j)" "[\"$ORG22\",\"org\"]"
  git -C "$PHASE_REPO" remote remove origin
  permit22 >/dev/null
  assert_json "OS17e a permit made next to an XDG-only origin records origin null" "$(cat "$HOME/.a1-xprov/permits.json")" "Object.values(j.permits)[0].origin === null" "true"
  # f: the audit hint does not advise deleting the log
  local hint; hint="$(lib22 "P.permitHint('audit_broken')")"
  [[ "$hint" != *"remove"* && "$hint" != *"delete"* && "$hint" == *"Reinhard"* && "$hint" == *"report"* ]] && ok "OS17f HINT_AUDIT: no delete advice, says Reinhard review still runs and to report" || bad "OS17f hint: $hint"
}

caseOS1; caseOS2; caseOS3; caseOS4; caseOS5; caseOS5m; caseOS6; caseOS7; caseOS8
caseOS9; caseOS10; caseOS11; caseOS12; caseOS13; caseOS14; caseOS15; caseOS16; caseOS17
export HOME="$SAVED_HOME_22"
rm -rf "$TMP22"
