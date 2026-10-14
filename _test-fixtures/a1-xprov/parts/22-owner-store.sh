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
# Owner commands run on a tree COPY whose guardRefusal is stubbed to null (the guard itself is
# measured in parts 08, 11 and 15, the TTY refusal again in OS5k) — never against a real store.

TMP22="$(mktemp -d "${TMPDIR:-/tmp}/a1x22.XXXXXX")"
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
  # legacy entry (no repo, no origin key): stays allowed, audit missing
  prep22; origin22 "$ORG22"; write_permit "$PHASE_REPO" robert "$REC22" "" 2026-10-14
  sub22 permit-check; assert_json "OS4f legacy permit stays allowed with audit missing" "$G_OUT" "j.state + '/' + j.audit" "allowed/missing"
  origin22 https://github.com/other/fixture.git; sub22 permit-check
  assert_json "OS4f a legacy permit is not origin-bound" "$G_OUT" "j.state" "allowed"
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
  rm -f "$f"; assert_eq "OS5h no audit log → missing" "$(audit_state22)" "missing"
  : > "$f"; assert_eq "OS5h empty audit log → missing" "$(audit_state22)" "missing"
  # a hand-written permit of another repo (no audit line for it): visible as missing
  rm -f "$f"; permit22 >/dev/null; make_phase p22; write_permit "$PHASE_REPO" robert "$REC22" "" 2026-10-14
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
    assert_rc "OS6a permit --by variant $n → exit 2" 2 "$G_RC"; [[ "$G_ERR" == *reserved* ]] && ok "OS6a variant $n says reserved" || bad "OS6a variant $n: $G_ERR"
    piped22 denied permit --deny --by "$v"
    assert_rc "OS6b permit --deny --by variant $n → exit 2" 2 "$G_RC"; [[ "$G_ERR" == *reserved* ]] && ok "OS6b variant $n says reserved" || bad "OS6b variant $n: $G_ERR"
    piped22 plan-review-xprov waive --phase p22 --gate plan-review-xprov --reason r --by "$v"
    assert_rc "OS6c waive --by variant $n → exit 2" 2 "$G_RC"; [[ "$G_ERR" == *reserved* ]] && ok "OS6c variant $n says reserved" || bad "OS6c variant $n: $G_ERR"
    piped22 "" allowlist approve --repo "$PHASE_REPO" --by "$v"
    assert_rc "OS6d allowlist approve --by variant $n → exit 2" 2 "$G_RC"; [[ "$G_ERR" == *reserved* ]] && ok "OS6d variant $n says reserved" || bad "OS6d variant $n: $G_ERR"
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
  assert_json "OS8b new reason codes" "$out" "j.r.join(',')" "owner_home_mismatch,scope_exempt,codex_blocked_fallback,secret_declined"
  local help; help="$(node "$TOOLS" xprov --help 2>&1; node "$TOOLS" --help 2>&1)"
  grep -qiE 'unforgeable|tamper[- ]?proof' <<<"$help" && bad "OS8c a help text claims unforgeable/tamper-proof" || ok "OS8c no help text claims unforgeable or tamper-proof"
  grep -q 'enforcement: unenforced' <<<"$help" && ok "OS8c help states enforcement: unenforced" || bad "OS8c help lacks the tier-0 statement"
}

caseOS1; caseOS2; caseOS3; caseOS4; caseOS5; caseOS5m; caseOS6; caseOS7; caseOS8
export HOME="$SAVED_HOME_22"
rm -rf "$TMP22"
