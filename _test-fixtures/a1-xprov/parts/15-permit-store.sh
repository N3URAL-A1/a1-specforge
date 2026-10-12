#!/usr/bin/env bash
# Part 15 — spec 014 Wave 1 (FR-001..FR-004): the owner permit store
# ~/.a1-xprov/permits.json, `permitCheck` = file AND store entry, the new state
# `permit_mismatch`, the write order of the owner command, and the migration hint.
# Sourced by run-tests.sh. Expectations are literals from the spec, never imported
# from the module under test (testing.md class 4); store keys are computed here.
#
#   PS1a-f  parsePermitsDoc rejections (extra top key, missing key, foreign key, empty, non-string, version)
#   PS2     owner write: 0600 file, 0700 dir, one entry keyed by the realpath git-common-dir
#   PS3     forged file, no store -> permit-check and gate exit 1, nothing written
#   PS4a-j  one arm per row of the state table (plus sub-arms)
#   PS5     store sha256 unchanged around permit-check / gate / run / load-check
#   PS6     pipe stdin and CLAUDECODE=1 pty -> exit 2, three files byte-identical
#   PS7     typed `denied` for an allow request -> exit 2, nothing written
#   PS8     permit --deny removes the store entry -> state denied
#   PS9     writer call-site scan (with a planted violation as discriminator)
#   PS10    0644 store -> permit_store_unusable, sha unchanged
#   PS11    library write order and half-write messages (no guard involved)
#   PS12    migration: file-only repo -> hint, owner re-run, diff shows only decided_on
#   PS13    ADR addendum line
# Owner-path arms run through a pseudo-TTY. Outside a Claude Code process tree they
# call the real a1-tools entry; inside one (the ancestry guard would refuse) they call
# cmdXprovPermit with guardRefusal replaced, so the store logic is still measured.
# Under Claude Code the real guard path stays covered by PS6 (pipe, CLAUDECODE=1).

TMP15="$(mktemp -d "${TMPDIR:-/tmp}/a1x15.XXXXXX")"
[[ -n "$TMP15" && -d "$TMP15" ]] || { echo "FAIL  part 15: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_15="$HOME"
export HOME="$TMP15/home"; mkdir -p "$HOME"
PERMITS15="$HOME/.a1-xprov/permits.json"
DENIALS15="$HOME/.a1-xprov/permit-denials.json"
PERMITS_MOD15="$REPO_ROOT/_shared/lib/xprov-permits.cjs"

claude_ancestor15() {
  [[ -n "${CLAUDECODE:-}" || -n "${CLAUDE_PID:-}" ]] && return 0
  local p=$$ c
  while [[ -n "$p" && "$p" -gt 1 ]]; do
    c="$(ps -o comm= -p "$p" 2>/dev/null)"
    [[ "$(basename -- "${c:-x}")" == claude ]] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
  done
  return 1
}
NOCLAUDE15=(env)
for v15 in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$'); do NOCLAUDE15+=(-u "$v15"); done
pty15() {
  local cmd; cmd="$(printf '%q ' "$@")"
  if [[ "$(uname)" == Darwin ]]; then
    ( sleep 1; [[ -n "${PTY_TYPED:-}" ]] && printf '%s\n' "$PTY_TYPED"; sleep 2 ) | script -q /dev/null "$@" > "$TMP15/pty-out.txt" 2>&1
  else
    ( sleep 1; [[ -n "${PTY_TYPED:-}" ]] && printf '%s\n' "$PTY_TYPED"; sleep 2 ) | script -qec "$cmd" /dev/null > "$TMP15/pty-out.txt" 2>&1
  fi
}

repokey15() { (cd "$PHASE_REPO" && cd "$(git rev-parse --git-common-dir)" && pwd -P); }
sum15() { if [[ -e "$1" ]]; then (shasum -a 256 "$1" 2>/dev/null || sha256sum "$1") | cut -d' ' -f1; else echo absent; fi; }
mode15() { node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$1"; }
prep15() { make_tree; make_phase p15; rm -rf "$HOME/.a1-xprov"; }
today15() { date -u +%F; }
# file15 <status> <by> <on> [record] [branch] — the working-tree record, key order as the owner command writes it
file15() {
  node -e '
    const fs = require("fs"); const path = require("path");
    const [repo, st, by, on, rec, branch] = process.argv.slice(1);
    const o = { external_review: st, decided_by: by, decided_on: on }; if (rec) o.record = rec; if (branch) o.default_branch = branch;
    fs.mkdirSync(path.join(repo, ".a1"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".a1", "xprov.json"), JSON.stringify(o, null, 2) + "\n");
  ' "$PHASE_REPO" "$1" "$2" "$3" "${4:-}" "${5:-}"
}
# permit15 <by> <on> <record> [branch] — store entry for THIS repo (harness helper, key from git)
permit15() { write_permit_store "$PHASE_REPO" "$1" "$3" "${4:-}" "$2"; }
# den15 <by> <on> — denial store entry in the documented format (spec 012 FR-007)
den15() {
  mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  node -e '
    const fs = require("fs"); const [file, key, by, on] = process.argv.slice(1);
    fs.writeFileSync(file, JSON.stringify({ version: 1, denials: { [key]: { decided_by: by, decided_on: on, ts: "2026-10-05T00:00:00.000Z" } } }, null, 2) + "\n");
  ' "$DENIALS15" "$(repokey15)" "$1" "$2"
  chmod 600 "$DENIALS15"
}
sub15() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov "$@" 2>"$TMP15/err.txt")"; G_RC=$?; G_ERR="$(cat "$TMP15/err.txt")"; }
gate15() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p15 "$@" 2>"$TMP15/err.txt")"; G_RC=$?; G_ERR="$(cat "$TMP15/err.txt")"; }
snaps15() { ls "$HOME/.a1-xprov/snapshots" 2>/dev/null | wc -l | tr -d ' '; }
runs15() { find "$HOME/.a1-xprov/artifacts" -mindepth 1 2>/dev/null | wc -l | tr -d ' '; }
nothing15() { [[ ! -e "$PHASE_DIR/PLAN-REVIEW-LOG.md" && ! -e "$PHASE_DIR/xreview" && ! -e "$PHASE_DIR/XREVIEW.md" && "$(snaps15)" == 0 && "$(runs15)" == 0 ]]; }
three15() { echo "$(sum15 "$PHASE_REPO/.a1/xprov.json")/$(sum15 "$PERMITS15")/$(sum15 "$DENIALS15")"; }

# owner15 <typed-word> <permit args...> — `xprov permit <args>` in a pseudo-TTY, sets OWN_RC; output in pty-out.txt
OWNER_JS15='const A = require(process.argv[1] + "/xprov-approve.cjs"); A.guardRefusal = () => null; require(process.argv[1] + "/xprov-permit.cjs").cmdXprovPermit(process.argv.slice(2));'
owner15() {
  local typed="$1"; shift
  if claude_ancestor15; then
    PTY_TYPED="$typed" pty15 "${NOCLAUDE15[@]}" sh -c 'cd "$1" && js="$2" && lib="$3" && shift 3 && node -e "$js" -- "$lib" "$@"' sh "$PHASE_REPO" "$OWNER_JS15" "$TREE/_shared/lib" "$@"
  else
    PTY_TYPED="$typed" pty15 "${NOCLAUDE15[@]}" sh -c 'cd "$1" && tools="$2" && shift 2 && node "$tools" xprov permit "$@"' sh "$PHASE_REPO" "$TREE_TOOLS" "$@"
  fi
  OWN_RC=$?
}

# ---------- PS1: parsePermitsDoc ----------
parse15() { # <json-doc> -> "null" | "ok"
  node -e '
    let r; try { const M = require(process.argv[1]); const p = M.parsePermitsDoc(JSON.parse(process.argv[2])); r = p === null ? "null" : "ok"; } catch (e) { r = "THROW " + e.message.slice(0, 60); }
    process.stdout.write(r);
  ' "$PERMITS_MOD15" "$1"
}
casePS1() {
  local E='{"decided_by":"r","decided_on":"2026-10-08","record":"record/x.md","ts":"2026-10-08T00:00:00.000Z"}'
  assert_eq "PS1 control: a valid document parses" "$(parse15 "{\"version\":1,\"permits\":{\"/k\":$E}}")" "ok"
  assert_eq "PS1 control: default_branch is an allowed optional key" "$(parse15 '{"version":1,"permits":{"/k":{"decided_by":"r","decided_on":"d","record":"x","ts":"t","default_branch":"trunk"}}}')" "ok"
  assert_eq "PS1 control: an empty permits map parses" "$(parse15 '{"version":1,"permits":{}}')" "ok"
  assert_eq "PS1a an extra top-level key → null" "$(parse15 "{\"version\":1,\"permits\":{\"/k\":$E},\"extra\":1}")" "null"
  local k
  for k in decided_by decided_on record ts; do
    assert_eq "PS1b an entry without $k → null" "$(parse15 "{\"version\":1,\"permits\":{\"/k\":$(node -e 'const e=JSON.parse(process.argv[1]); delete e[process.argv[2]]; process.stdout.write(JSON.stringify(e))' "$E" "$k")}}")" "null"
  done
  assert_eq "PS1c a foreign entry key → null" "$(parse15 '{"version":1,"permits":{"/k":{"decided_by":"r","decided_on":"d","record":"x","ts":"t","foreign":"y"}}}')" "null"
  assert_eq "PS1d an empty value → null" "$(parse15 '{"version":1,"permits":{"/k":{"decided_by":"","decided_on":"d","record":"x","ts":"t"}}}')" "null"
  assert_eq "PS1e a non-string value → null" "$(parse15 '{"version":1,"permits":{"/k":{"decided_by":"r","decided_on":5,"record":"x","ts":"t"}}}')" "null"
  assert_eq "PS1f version 2 → null" "$(parse15 "{\"version\":2,\"permits\":{\"/k\":$E}}")" "null"
  assert_eq "PS1f permits not an object → null" "$(parse15 '{"version":1,"permits":[]}')" "null"
}

# ---------- PS2: owner write ----------
casePS2() {
  prep15
  owner15 allowed --by robert --record record/2026-10-08-x.md
  assert_rc "PS2 owner permit, 'allowed' typed back → exit 0" 0 "$OWN_RC" "$(tr -d '\r' < "$TMP15/pty-out.txt" | tail -n 3)"
  assert_eq "PS2 permits.json mode 0600" "$(mode15 "$PERMITS15" 2>/dev/null)" "600"
  assert_eq "PS2 ~/.a1-xprov mode 0700" "$(mode15 "$HOME/.a1-xprov" 2>/dev/null)" "700"
  local doc; doc="$(cat "$PERMITS15" 2>/dev/null || echo '{}')"
  assert_json "PS2 version 1 and exactly one entry keyed by the realpath git-common-dir" "$doc" "j.version + '/' + Object.keys(j.permits).join(',')" "1/$(repokey15)"
  assert_json "PS2 the entry: decided_by, record, today, a ts, exactly four keys" "$doc" \
    "(() => { const e = Object.values(j.permits)[0] || {}; return [e.decided_by, e.record, e.decided_on, typeof e.ts, Object.keys(e).length].join('/'); })()" "robert/record/2026-10-08-x.md/$(today15)/string/4"
  assert_json "PS2 the file says allowed" "$(cat "$PHASE_REPO/.a1/xprov.json" 2>/dev/null || echo '{}')" "j.external_review + '/' + j.decided_by" "allowed/robert"
  sub15 permit-check
  assert_json "PS2 permit-check after the owner write: allowed, exit 0" "$G_OUT" "j.state + '/' + j.ok" "allowed/true"
  # a repeated permit changes decided_on/ts only (FR-004 step 4): same key count, still one entry
  owner15 allowed --by robert --record record/2026-10-08-x.md
  assert_json "PS2 a second permit keeps exactly one entry" "$(cat "$PERMITS15")" "Object.keys(j.permits).length" "1"
  # default_branch travels into the store entry
  prep15
  owner15 allowed --by robert --record record/2026-10-08-x.md --default-branch trunk
  assert_json "PS2 --default-branch is recorded in the store entry" "$(cat "$PERMITS15" 2>/dev/null || echo '{}')" "(Object.values(j.permits)[0] || {}).default_branch" "trunk"
}

# ---------- PS3: forged file ----------
casePS3() {
  prep15; write_permit_file_only "$PHASE_REPO" robert record/2026-10-08-x.md
  printf '## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"
  sub15 permit-check
  assert_rc "PS3 forged file, no store → permit-check exit 1" 1 "$G_RC"
  assert_json "PS3 reason external_review_permit_mismatch, state permit_mismatch, ok false" "$G_OUT" "[j.reason, j.state, j.ok].join('/')" "external_review_permit_mismatch/permit_mismatch/false"
  gate15 --gate "$GATE_PLAN"
  assert_rc "PS3 gate exit 1" 1 "$G_RC" "$G_ERR"
  assert_json "PS3 gate: step permit-check, same reason, permit_state permit_mismatch" "$G_OUT" "[j.step, j.reason, j.permit_state].join('/')" "permit-check/external_review_permit_mismatch/permit_mismatch"
  assert_json "PS3 the gate's reason_detail carries the migration hint" "$G_OUT" "String(j.reason_detail).includes('permit store holds no matching entry')" "true"
  nothing15 && ok "PS3 no snapshot, no run dir, no log entry" || bad "PS3 the gate wrote: snaps=$(snaps15) runs=$(runs15) $(ls "$PHASE_DIR")"
  [[ "$(sum15 "$PERMITS15")" == absent ]] && ok "PS3 the gate created no permit store" || bad "PS3 a permit store appeared"
  # the same forgery with a store entry of ANOTHER repository still does not count
  write_permit_store "$TMP15/not-this-repo" robert record/2026-10-08-x.md
  sub15 permit-check
  assert_json "PS3 a store without this repo's key → permit_mismatch" "$G_OUT" "j.state" "permit_mismatch"
}

# ---------- PS4: the state table ----------
st15() { sub15 permit-check; echo "$G_RC/$(json_get "$G_OUT" "j.state")/$(json_get "$G_OUT" "j.reason")"; }
casePS4() {
  local R=record/2026-10-08-x.md D=2026-10-08
  prep15; file15 allowed robert $D $R; permit15 robert $D $R
  assert_eq "PS4a allowed / equal / none → allowed, exit 0" "$(st15)" "0/allowed/undefined"
  prep15; file15 allowed robert $D $R
  assert_eq "PS4b allowed / none / none → permit_mismatch" "$(st15)" "1/permit_mismatch/external_review_permit_mismatch"
  local variant
  for variant in "alice $D $R" "robert 2026-10-07 $R" "robert $D record/other.md"; do
    prep15; file15 allowed robert $D $R; permit15 $variant
    assert_eq "PS4c allowed / differs ($variant) / none → permit_mismatch" "$(st15)" "1/permit_mismatch/external_review_permit_mismatch"
  done
  prep15; file15 allowed robert $D $R; write_permit_store "$PHASE_REPO" robert $R trunk $D
  assert_eq "PS4c2 the store has default_branch, the file has none → permit_mismatch" "$(st15)" "1/permit_mismatch/external_review_permit_mismatch"
  prep15; file15 allowed robert $D $R trunk; permit15 robert $D $R
  assert_eq "PS4c3 the file has default_branch, the store has none → permit_mismatch" "$(st15)" "1/permit_mismatch/external_review_permit_mismatch"
  prep15; file15 allowed robert $D $R trunk; write_permit_store "$PHASE_REPO" robert $R main $D
  assert_eq "PS4c4 default_branch differs → permit_mismatch" "$(st15)" "1/permit_mismatch/external_review_permit_mismatch"
  prep15; file15 allowed robert $D $R trunk; write_permit_store "$PHASE_REPO" robert $R trunk $D
  assert_eq "PS4c5 control: default_branch equal on both sides → allowed" "$(st15)" "0/allowed/undefined"
  prep15; file15 allowed robert $D $R; permit15 robert $D $R; den15 robert $D
  assert_eq "PS4d allowed / equal / denial present → denial_mismatch" "$(st15)" "1/denial_mismatch/external_review_denial_mismatch"
  prep15; file15 allowed robert $D $R; den15 robert $D
  assert_eq "PS4d2 allowed / none / denial present → denial_mismatch (denial checks first)" "$(st15)" "1/denial_mismatch/external_review_denial_mismatch"
  prep15; file15 denied robert $D; den15 robert $D
  assert_eq "PS4e denied / none / equal denial → denied" "$(st15)" "1/denied/external_review_denied"
  prep15; file15 denied robert $D; den15 robert $D; permit15 robert $D $R
  assert_eq "PS4f denied / permit present / equal denial → denial_mismatch" "$(st15)" "1/denial_mismatch/external_review_denial_mismatch"
  prep15; file15 denied robert $D; permit15 robert $D $R
  assert_eq "PS4f2 denied / permit present / no denial → denial_mismatch" "$(st15)" "1/denial_mismatch/external_review_denial_mismatch"
  prep15; permit15 robert $D $R
  assert_eq "PS4g absent file / permit present / none → permit_mismatch" "$(st15)" "1/permit_mismatch/external_review_permit_mismatch"
  prep15; mkdir -p "$PHASE_REPO/.a1"; printf '{not json\n' > "$PHASE_REPO/.a1/xprov.json"; permit15 robert $D $R
  assert_eq "PS4g2 invalid file / permit present / none → permit_mismatch" "$(st15)" "1/permit_mismatch/external_review_permit_mismatch"
  prep15
  assert_eq "PS4h absent file / none / none → absent (external_review_not_permitted)" "$(st15)" "1/absent/external_review_not_permitted"
  prep15; mkdir -p "$PHASE_REPO/.a1"; printf '{not json\n' > "$PHASE_REPO/.a1/xprov.json"
  assert_eq "PS4h2 invalid file / none / none → invalid (external_review_not_permitted)" "$(st15)" "1/invalid/external_review_not_permitted"
  prep15; file15 allowed robert $D $R; permit15 robert $D $R; chmod 644 "$PERMITS15"
  assert_eq "PS4i allowed / permit store mode 0644 / none → permit_mismatch" "$(st15)" "1/permit_mismatch/external_review_permit_mismatch"
  prep15; file15 allowed robert $D $R; permit15 robert $D $R; printf '{"version":2,"nope":true}\n' > "$PERMITS15"; chmod 600 "$PERMITS15"
  assert_eq "PS4i2 allowed / permit store of an unknown format / none → permit_mismatch" "$(st15)" "1/permit_mismatch/external_review_permit_mismatch"
  prep15; file15 allowed robert $D $R; permit15 robert $D $R; chmod 755 "$HOME/.a1-xprov"
  assert_eq "PS4i3 allowed / ~/.a1-xprov mode 0755 → denial_mismatch (the denial store is read first and is unusable too)" "$(st15)" "1/denial_mismatch/external_review_denial_mismatch"
  prep15; file15 allowed robert $D $R; permit15 robert $D $R; printf '{"broken":1}\n' > "$DENIALS15"; chmod 600 "$DENIALS15"
  assert_eq "PS4j decided / any / denial store unusable → denial_mismatch" "$(st15)" "1/denial_mismatch/external_review_denial_mismatch"
  prep15; file15 denied robert $D; permit15 robert $D $R; printf '{"broken":1}\n' > "$DENIALS15"; chmod 600 "$DENIALS15"
  assert_eq "PS4j2 denied file / denial store unusable → denial_mismatch" "$(st15)" "1/denial_mismatch/external_review_denial_mismatch"
  prep15; file15 denied robert $D; den15 robert $D; chmod 644 "$DENIALS15"
  assert_eq "PS4j3 control: denial row unchanged — unusable denial store, denied file → denial_mismatch" "$(st15)" "1/denial_mismatch/external_review_denial_mismatch"
  prep15; file15 denied robert $D; den15 robert $D; printf '{"version":2,"nope":true}\n' > "$PERMITS15"; chmod 600 "$PERMITS15"
  assert_eq "PS4k denied / equal denial / permit store unusable → denied (spec names no row; silence stays owner-attested)" "$(st15)" "1/denied/external_review_denied"
}

# ---------- PS5: no read path writes ----------
casePS5() {
  prep15; file15 allowed robert 2026-10-08 record/2026-10-08-x.md; permit15 alice 2026-10-08 record/2026-10-08-x.md
  printf '## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"
  mkdir -p "$TMP15/snap-fake/.git"
  # a denial for ANOTHER key keeps the denial store present without touching this repo's state
  mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ version: 1, denials: { "/elsewhere/.git": { decided_by: "r", decided_on: "2026-10-05", ts: "2026-10-05T00:00:00.000Z" } } }, null, 2) + "\n", { mode: 0o600 })' "$DENIALS15"
  local before_p before_d; before_p="$(sum15 "$PERMITS15")"; before_d="$(sum15 "$DENIALS15")"
  sub15 permit-check;  assert_json "PS5 permit-check refuses with permit_mismatch" "$G_OUT" "j.reason" "external_review_permit_mismatch"
  gate15 --gate "$GATE_PLAN"; assert_json "PS5 gate refuses with permit_mismatch" "$G_OUT" "j.reason + '/' + j.step" "external_review_permit_mismatch/permit-check"
  sub15 load-check --phase p15; assert_rc "PS5 load-check stays red (exit 1)" 1 "$G_RC"
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov run --mode review --snapshot "$TMP15/snap-fake" --plan "$PHASE_PLAN" --phase p15 --gate "$GATE_PLAN" 2>"$TMP15/err.txt")"; G_RC=$?
  assert_rc "PS5 run refuses (exit 1)" 1 "$G_RC" "$(cat "$TMP15/err.txt")"
  assert_json "PS5 run reason external_review_permit_mismatch" "$G_OUT" "j.reason" "external_review_permit_mismatch"
  assert_eq "PS5 permits.json sha256 unchanged around permit-check, gate, load-check, run" "$(sum15 "$PERMITS15")" "$before_p"
  assert_eq "PS5 permit-denials.json sha256 unchanged around the same calls" "$(sum15 "$DENIALS15")" "$before_d"
  # allowed state: the readers still do not write
  permit15 robert 2026-10-08 record/2026-10-08-x.md; before_p="$(sum15 "$PERMITS15")"
  sub15 permit-check; assert_json "PS5 control: equal entry → allowed" "$G_OUT" "j.state" "allowed"
  sub15 load-check --phase p15
  assert_eq "PS5 permits.json unchanged around permit-check and load-check in the allowed state" "$(sum15 "$PERMITS15")" "$before_p"
}

# ---------- PS6 / PS7: guards and the typed word ----------
casePS6() {
  prep15; file15 allowed robert 2026-10-08 record/2026-10-08-x.md; permit15 robert 2026-10-08 record/2026-10-08-x.md
  local before rc; before="$(three15)"
  ( cd "$PHASE_REPO" && "${NOCLAUDE15[@]}" node "$TREE_TOOLS" xprov permit --by mallory --record record/y.md < /dev/null > "$TMP15/x1.out" 2>&1 ); rc=$?
  assert_rc "PS6 permit with piped stdin → exit 2" 2 "$rc"
  grep -q "must both be a terminal" "$TMP15/x1.out" && ok "PS6 the refusal names the terminal rule" || bad "PS6 refusal text: $(tail -n 2 "$TMP15/x1.out")"
  assert_eq "PS6 xprov.json, permits.json, permit-denials.json byte-identical after the pipe" "$(three15)" "$before"
  PTY_TYPED="allowed" pty15 env CLAUDECODE=1 sh -c 'cd "$1" && node "$2" xprov permit --by mallory --record record/y.md' sh "$PHASE_REPO" "$TREE_TOOLS"; rc=$?
  assert_rc "PS6 CLAUDECODE=1 under a pseudo-TTY → exit 2" 2 "$rc"
  grep -qF "CLAUDECODE" "$TMP15/pty-out.txt" && ok "PS6 the refusal names CLAUDECODE" || bad "PS6 output: $(tr -d '\r' < "$TMP15/pty-out.txt" | tail -n 2)"
  assert_eq "PS6 the three files are byte-identical after CLAUDECODE=1" "$(three15)" "$before"
  prep15
  ( cd "$PHASE_REPO" && "${NOCLAUDE15[@]}" node "$TREE_TOOLS" xprov permit --by robert --record record/y.md < /dev/null > /dev/null 2>&1 ); rc=$?
  assert_rc "PS6 from a clean state: pipe → exit 2" 2 "$rc"
  assert_eq "PS6 and the three files are still absent" "$(three15)" "absent/absent/absent"
}
casePS7() {
  prep15; file15 allowed robert 2026-10-08 record/2026-10-08-x.md; permit15 robert 2026-10-08 record/2026-10-08-x.md
  local before; before="$(three15)"
  owner15 denied --by mallory --record record/y.md
  assert_rc "PS7 typed 'denied' for an allow request → exit 2" 2 "$OWN_RC"
  grep -qF 'typed "denied", expected allowed; nothing written' "$TMP15/pty-out.txt" && ok "PS7 the message says: typed \"denied\", expected allowed; nothing written" || bad "PS7 output: $(tr -d '\r' < "$TMP15/pty-out.txt" | tail -n 3)"
  assert_eq "PS7 the three files are byte-identical" "$(three15)" "$before"
}

# ---------- PS8: permit --deny ----------
casePS8() {
  prep15; file15 allowed robert 2026-10-08 record/2026-10-08-x.md; permit15 robert 2026-10-08 record/2026-10-08-x.md
  owner15 denied --deny --by robert
  assert_rc "PS8 owner permit --deny, 'denied' typed back → exit 0" 0 "$OWN_RC" "$(tr -d '\r' < "$TMP15/pty-out.txt" | tail -n 3)"
  assert_json "PS8 permits.json holds no entry for the repo any more" "$(cat "$PERMITS15" 2>/dev/null || echo '{"permits":{"gone":1}}')" "Object.keys(j.permits).length" "0"
  sub15 permit-check
  assert_json "PS8 permit-check reports denied" "$G_OUT" "j.state + '/' + j.reason" "denied/external_review_denied"
  assert_json "PS8 the denial store holds this repo" "$(cat "$DENIALS15" 2>/dev/null || echo '{}')" "Object.keys(j.denials || {}).join(',')" "$(repokey15)"
  # an entry of ANOTHER repository survives a deny
  prep15; file15 allowed robert 2026-10-08 record/2026-10-08-x.md; permit15 robert 2026-10-08 record/2026-10-08-x.md
  write_permit_store "$TMP15/not-this-repo" other record/2026-10-08-o.md
  node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); d.permits["/other/.git"]=d.permits[Object.keys(d.permits)[0]]; fs.writeFileSync(process.argv[1], JSON.stringify(d,null,2)+"\n",{mode:0o600})' "$PERMITS15"
  owner15 denied --deny --by robert
  assert_json "PS8 an entry of another repository is kept" "$(cat "$PERMITS15" 2>/dev/null || echo '{}')" "Object.keys(j.permits).join(',')" "/other/.git"
}

# ---------- PS9: writer call-site scan ----------
SCAN15='
const fs = require("fs"); const path = require("path");
const root = process.argv[1]; const lib = path.join(root, "_shared", "lib");
const files = []; (function walk(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); const s = fs.lstatSync(p); if (s.isDirectory()) walk(p); else if (n.endsWith(".cjs")) files.push(p); } })(path.join(root, "_shared"));
const WRITER = /\b(writePermits|withPermit)\b/; const bad = []; let inPermit = 0; const requirers = [];
for (const f of files) {
  const rel = path.relative(root, f); const lines = fs.readFileSync(f, "utf8").split("\n");
  if (/require\(.[^)]*xprov-permits(\.cjs)?.\)/.test(lines.join("\n"))) requirers.push(path.basename(f));
  if (path.basename(f) === "xprov-permits.cjs") continue;
  let fn = null;
  lines.forEach((l, i) => {
    const m = /^(?:async\s+)?function\s+(\w+)/.exec(l); if (m) fn = m[1]; else if (/^\S/.test(l) && !/^[}\])]/.test(l)) fn = null;
    if (/^\s*(\/\/|\*|\/\*)/.test(l) || !WRITER.test(l)) return;
    if (path.basename(f) === "xprov-permit.cjs" && (fn === "permit" || fn === "permitDeny")) { inPermit++; return; }
    bad.push(rel + ":" + (i + 1) + " in " + (fn || "top level"));
  });
}
process.stdout.write(JSON.stringify({ bad, inPermit, requirers }));
'
casePS9() {
  local j; j="$(node -e "$SCAN15" "$REPO_ROOT" 2>&1)"
  assert_json "PS9 no file outside xprov-permit.cjs permit/permitDeny references writePermits/withPermit" "$j" "JSON.stringify(j.bad)" "[]"
  assert_json "PS9 xprov-permit.cjs references them inside permit and permitDeny (a scan that sees nothing is no proof)" "$j" "j.inPermit >= 2" "true"
  assert_json "PS9 the module is required by xprov-permit.cjs only" "$j" "j.requirers.join(',')" "xprov-permit.cjs"
  # discriminator: plant a writer call in another module and in permitCheck of a tree copy → the scan must flag both
  local cp="$TMP15/scan-tree"; rm -rf "$cp"; mkdir -p "$cp"; cp -R "$REPO_ROOT/_shared" "$cp/_shared"
  printf 'const P = require("./xprov-permits.cjs");\nfunction leak() { return P.writePermits({}); }\nmodule.exports = { leak };\n' >> "$cp/_shared/lib/xprov-gate.cjs"
  node -e 'const fs=require("fs"); const f=process.argv[1]; const s=fs.readFileSync(f,"utf8"); fs.writeFileSync(f, s.replace("function permitHint(state) {", "function permitHint(state) {\n  require(\"./xprov-permits.cjs\").withPermit({}, \"k\", null);"))' "$cp/_shared/lib/xprov-permit.cjs"
  j="$(node -e "$SCAN15" "$cp" 2>&1)"
  assert_json "PS9 discriminator: a writer call planted in xprov-gate.cjs is flagged" "$j" "j.bad.some((b) => b.startsWith('_shared/lib/xprov-gate.cjs'))" "true"
  assert_json "PS9 discriminator: a writer call planted in permitHint is flagged" "$j" "j.bad.some((b) => b.includes('xprov-permit.cjs') && b.includes('permitHint'))" "true"
  rm -rf "$cp"
}

# ---------- PS10: unusable store never overwritten ----------
casePS10() {
  prep15; file15 allowed robert 2026-10-08 record/2026-10-08-x.md; permit15 robert 2026-10-08 record/2026-10-08-x.md; chmod 644 "$PERMITS15"
  local before; before="$(three15)"
  owner15 allowed --by robert --record record/2026-10-08-x.md
  assert_rc "PS10 permit with a 0644 store → exit 1" 1 "$OWN_RC" "$(tr -d '\r' < "$TMP15/pty-out.txt" | tail -n 3)"
  grep -q "permit_store_unusable" "$TMP15/pty-out.txt" && ok "PS10 the output names permit_store_unusable" || bad "PS10 output: $(tr -d '\r' < "$TMP15/pty-out.txt" | tail -n 3)"
  assert_eq "PS10 the three files are byte-identical (the store is not overwritten)" "$(three15)" "$before"
  assert_eq "PS10 the store still has mode 0644" "$(mode15 "$PERMITS15")" "644"
  prep15; mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"; printf '{"broken":1}\n' > "$PERMITS15"; chmod 600 "$PERMITS15"
  before="$(three15)"
  owner15 allowed --by robert --record record/2026-10-08-x.md
  assert_rc "PS10 permit with a store of an unknown format → exit 1" 1 "$OWN_RC"
  assert_eq "PS10 that store and the file stay as they were (file absent)" "$(three15)" "$before"
}

# ---------- PS11: library write order and half writes ----------
# permit_lib2 <js> — like permit_lib, `P` = the TREE's xprov-permit module, `A` = its approve module (writer hook)
permit_lib2() {
  node -e '
    const P = require(process.argv[1] + "/_shared/lib/xprov-permit.cjs");
    const A = require(process.argv[1] + "/_shared/lib/xprov-approve.cjs");
    const failOn = (name) => { const orig = A.writeGuardedStore; A.writeGuardedStore = (n, d) => { if (n === name) throw Object.assign(new Error("injected"), { code: "EIO" }); return orig(n, d); }; };
    const out = (function () { return eval(process.argv[2]); })();
    process.stdout.write(JSON.stringify(out));
  ' "$1" "$2"
}
casePS11() {
  local r R=record/2026-10-08-x.md
  # happy path: all three written
  prep15
  r="$(permit_lib "$TREE" "P.permit({ repoRoot: '$PHASE_REPO', by: 'robert', record: '$R', today: '2026-10-08' })")"
  assert_json "PS11 permit succeeds" "$r" "j.ok" "true"
  assert_json "PS11 the store entry equals the file (decided_by/decided_on/record)" "$(cat "$PERMITS15" 2>/dev/null || echo '{}')" "(() => { const e = Object.values(j.permits)[0] || {}; return [e.decided_by, e.decided_on, e.record].join('/'); })()" "robert/2026-10-08/$R"
  # step 2 fails (permit store write), no denial before: permit_write_failed, nothing written
  prep15
  r="$(permit_lib2 "$TREE" "(failOn('permits.json'), P.permit({ repoRoot: '$PHASE_REPO', by: 'robert', record: '$R', today: '2026-10-08' }))")"
  assert_json "PS11a step 2 fails → ok:false, permit_write_failed" "$r" "[j.ok, j.reason].join('/')" "false/permit_write_failed"
  [[ ! -e "$PHASE_REPO/.a1/xprov.json" && "$(sum15 "$PERMITS15")" == absent ]] && ok "PS11a neither the file nor the store was written" || bad "PS11a something was written"
  # step 2 fails after step 1 removed a denial: denial_mismatch, message says the denial was removed
  prep15
  permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-05' })" >/dev/null
  r="$(permit_lib2 "$TREE" "(failOn('permits.json'), P.permit({ repoRoot: '$PHASE_REPO', by: 'robert', record: '$R', today: '2026-10-08' }))")"
  assert_json "PS11b step 2 fails after the denial was removed → denial_mismatch" "$r" "[j.ok, j.reason].join('/')" "false/external_review_denial_mismatch"
  assert_json "PS11b the detail says the denial was removed and the permit entry not written" "$r" "/denial.*removed/i.test(j.detail || '') && /permit/i.test(j.detail || '')" "true"
  sub15 permit-check
  assert_json "PS11b permit-check: denial_mismatch (file still denied, denial store empty)" "$G_OUT" "j.state" "denial_mismatch"
  # step 3 fails (file): the entry exists, the state is permit_mismatch, the message says so
  prep15; mkdir -p "$PHASE_REPO/.a1/xprov.json"
  r="$(permit_lib "$TREE" "P.permit({ repoRoot: '$PHASE_REPO', by: 'robert', record: '$R', today: '2026-10-08' })")"
  assert_json "PS11c step 3 fails → ok:false, external_review_permit_mismatch" "$r" "[j.ok, j.reason].join('/')" "false/external_review_permit_mismatch"
  assert_json "PS11c the detail says the permit entry was written and the file was not" "$r" "/permit_mismatch/.test(j.detail || '') && /could not be/.test(j.detail || '')" "true"
  assert_json "PS11c the store holds the entry (step 2 happened before step 3)" "$(cat "$PERMITS15" 2>/dev/null || echo '{}')" "Object.keys(j.permits || {}).length" "1"
  sub15 permit-check
  assert_json "PS11c permit-check: permit_mismatch (fail closed)" "$G_OUT" "j.state" "permit_mismatch"
  # permit --deny order: permit store first, denial store second, file third
  prep15; file15 allowed robert 2026-10-08 $R; permit15 robert 2026-10-08 $R
  r="$(permit_lib2 "$TREE" "(failOn('permit-denials.json'), P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-08' }))")"
  assert_json "PS11d deny: the denial-store step fails → ok:false, denial_store_unusable" "$r" "[j.ok, j.reason].join('/')" "false/denial_store_unusable"
  assert_json "PS11d the permit entry was already removed (permit store comes first)" "$(cat "$PERMITS15" 2>/dev/null || echo '{}')" "Object.keys(j.permits || {}).length" "0"
  sub15 permit-check
  assert_json "PS11d permit-check: permit_mismatch (file still allowed, no entry) — fail closed" "$G_OUT" "j.state" "permit_mismatch"
  prep15; file15 allowed robert 2026-10-08 $R; permit15 robert 2026-10-08 $R
  local before; before="$(three15)"
  r="$(permit_lib2 "$TREE" "(failOn('permits.json'), P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-08' }))")"
  assert_json "PS11e deny: the permit-store step fails → ok:false, nothing written" "$r" "j.ok" "false"
  assert_eq "PS11e the three files are byte-identical" "$(three15)" "$before"
  prep15; file15 allowed robert 2026-10-08 $R; permit15 robert 2026-10-08 $R; printf '{"broken":1}\n' > "$PERMITS15"; chmod 600 "$PERMITS15"
  before="$(three15)"
  r="$(permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-08' })")"
  assert_json "PS11f deny with an unusable permit store → permit_store_unusable" "$r" "[j.ok, j.reason].join('/')" "false/permit_store_unusable"
  assert_eq "PS11f the three files are byte-identical" "$(three15)" "$before"
  prep15; mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"; printf '{"broken":1}\n' > "$PERMITS15"; chmod 600 "$PERMITS15"
  r="$(permit_lib "$TREE" "P.permit({ repoRoot: '$PHASE_REPO', by: 'robert', record: '$R', today: '2026-10-08' })")"
  assert_json "PS11g permit with an unusable permit store → permit_store_unusable, no file" "$r" "[j.ok, j.reason].join('/')" "false/permit_store_unusable"
  [[ ! -e "$PHASE_REPO/.a1/xprov.json" ]] && ok "PS11g no file was written" || bad "PS11g a file was written"
}

# ---------- PS12: migration ----------
casePS12() {
  local HINT='.a1/xprov.json says allowed but the owner'"'"'s permit store holds no matching entry — the owner re-runs `xprov permit --by <name> --record <note>` in a real terminal'
  local R=record/2026-10-08-x.md
  prep15; file15 allowed robert 2026-09-01 $R
  ( cd "$PHASE_REPO" && git add .a1/xprov.json && git commit -qm "fixture: preexisting permit (file only)" )
  sub15 permit-check
  assert_rc "PS12 file-only repo → permit-check exit 1" 1 "$G_RC"
  assert_json "PS12 reason external_review_permit_mismatch" "$G_OUT" "j.reason" "external_review_permit_mismatch"
  [[ "$G_ERR" == *"$HINT"* ]] && ok "PS12 stderr carries HINT_PERMIT_MISMATCH" || bad "PS12 hint missing: $G_ERR"
  owner15 allowed --by robert --record $R
  assert_rc "PS12 the owner re-runs permit → exit 0" 0 "$OWN_RC" "$(tr -d '\r' < "$TMP15/pty-out.txt" | tail -n 3)"
  sub15 permit-check
  assert_rc "PS12 permit-check exit 0 afterwards" 0 "$G_RC" "$G_ERR"
  assert_json "PS12 state allowed" "$G_OUT" "j.state" "allowed"
  local changed; changed="$(cd "$PHASE_REPO" && git diff -U0 -- .a1/xprov.json | grep -E '^[-+][^-+]' | sed -E 's/^([-+]) *"([a-z_]+)".*/\1\2/' | tr '\n' ' ')"
  assert_eq "PS12 git diff shows only decided_on (one removed, one added line)" "$changed" "-decided_on +decided_on "
}

# ---------- PS13: ADR ----------
casePS13() {
  local line; line="$(grep -E 'permits\.json' "$ADR" | grep -E 're-run' | grep -E '2026-10-08' | head -n 1)"
  [[ -n "$line" ]] && ok "PS13 the ADR has an addendum line naming permits.json, the owner re-run and 2026-10-08" || bad "PS13 no such ADR line"
}

casePS1; casePS2; casePS3; casePS4; casePS5; casePS6; casePS7; casePS8; casePS9; casePS10; casePS11; casePS12; casePS13
export HOME="$SAVED_HOME_15"
rm -rf "$TMP15"
