#!/usr/bin/env bash
# Part 12 — spec 012 Wave B (B.1, B.3): the five permit states, the owner-only
# denial store, `not_applicable`, and the owner guard on `permit`.
# Sourced by run-tests.sh. Every arm names its red-making change; the red
# output recorded before the fix is in the wave report (plan 012 §4 Wave 2).
#
#   P1  file `denied`, store EMPTY (the agent-edit case) → gate fails
#       external_review_denial_mismatch, writes nothing; load-check and
#       wave-status stay red.   Red if a file-only `denied` counts.
#   P2  store denial + file `allowed` → mismatch, nothing leaves.
#   P3  unusable store (mode 0644 / unknown format) → mismatch.
#   P4  half write (store ok, file step fails) → mismatch (fail closed).
#   P5  deny then allow removes the store entry.
#   P6  proper `denied` under `blocking` → not_applicable (today: HALT).
#   P7  `denied` on a row with applies_to `all` (or empty) → still fails.
#   P8  absent / invalid → external_review_not_permitted + hint, no writes.
#   P9  permit-check: state + exit codes + the exposure sentence (FR-016).
#   P10 registry: last column applies_to, both xprov rows permitted-repos.
#   P11 library rules of permit / permit --deny (record optional only for deny,
#       an unusable store is never overwritten, deny refuses without --by).
#   P12 hook: denies `xprov permit`, `permit --deny`, the denial-store path;
#       lets `xprov permit-check` through.
#   R21x permit / permit --deny from a non-TTY or under Claude Code → exit 2,
#       neither file nor store written (isolated HOME, as part 11).
#   R21y (owner path, pseudo-TTY outside Claude Code) typed word → store+file.
#   P13 workflows carry the not_applicable routing row and the retro tag.
# The owner-path arms need a process tree that does not descend from Claude
# Code: under Claude Code they print `SKIP (claude-code ancestor)`; with
# CI=true a SKIP is a FAIL (as part 11).

TMP12="$(mktemp -d "${TMPDIR:-/tmp}/a1x12.XXXXXX")"
[[ -n "$TMP12" && -d "$TMP12" ]] || { echo "FAIL  part 12: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_12="$HOME"
export HOME="$TMP12/home"; mkdir -p "$HOME"
STORE12="$HOME/.a1-xprov/permit-denials.json"

claude_ancestor12() {
  [[ -n "${CLAUDECODE:-}" || -n "${CLAUDE_PID:-}" ]] && return 0
  local p=$$ c
  while [[ -n "$p" && "$p" -gt 1 ]]; do
    c="$(ps -o comm= -p "$p" 2>/dev/null)"
    [[ "$(basename -- "${c:-x}")" == claude ]] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
  done
  return 1
}
skip12() {
  if [[ "${CI:-}" == "true" ]]; then bad "$1: SKIP (claude-code ancestor) is not allowed when CI=true"
  else results+=("SKIP (claude-code ancestor)  $1"); fi
}
NOCLAUDE12=(env)
for v12 in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$'); do NOCLAUDE12+=(-u "$v12"); done
pty12() {
  local cmd; cmd="$(printf '%q ' "$@")"
  if [[ "$(uname)" == Darwin ]]; then
    ( sleep 1; [[ -n "${PTY_TYPED:-}" ]] && printf '%s\n' "$PTY_TYPED"; sleep 2 ) | script -q /dev/null "$@" > "$TMP12/pty-out.txt" 2>&1
  else
    ( sleep 1; [[ -n "${PTY_TYPED:-}" ]] && printf '%s\n' "$PTY_TYPED"; sleep 2 ) | script -qec "$cmd" /dev/null > "$TMP12/pty-out.txt" 2>&1
  fi
}

repokey12() { (cd "$PHASE_REPO" && cd "$(git rev-parse --git-common-dir)" && pwd -P); }
sum12() { if [[ -e "$1" ]]; then (shasum -a 256 "$1" 2>/dev/null || sha256sum "$1") | cut -d' ' -f1; else echo absent; fi; }
mode12() { node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$1"; }
prep12() { make_tree; make_phase p12; rm -rf "$HOME/.a1-xprov"; }

# store12 <by> <on> — one denial for THIS repo in the documented format (spec 012
# FR-007), key = realpath of the git-common-dir computed here, never by the code
# under test (testing.md class 3). Dir 0700, file 0600 as the guarded writer does.
store12() {
  mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  node -e '
    const fs = require("fs"); const [file, key, by, on] = process.argv.slice(1);
    fs.writeFileSync(file, JSON.stringify({ version: 1, denials: { [key]: { decided_by: by, decided_on: on, ts: "2026-10-05T00:00:00.000Z" } } }, null, 2) + "\n");
  ' "$STORE12" "$(repokey12)" "$1" "$2"
  chmod 600 "$STORE12"
}
# file12 <external_review> <by> <on> [record] — the working-tree record
file12() {
  node -e '
    const fs = require("fs"); const path = require("path");
    const [repo, st, by, on, rec] = process.argv.slice(1);
    const o = { external_review: st, decided_by: by, decided_on: on }; if (rec) o.record = rec;
    fs.mkdirSync(path.join(repo, ".a1"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".a1", "xprov.json"), JSON.stringify(o, null, 2) + "\n");
  ' "$PHASE_REPO" "$1" "$2" "$3" "${4:-}"
}
# permit12 <by> <on> <record> — the owner's permit-store entry matching file12 allowed (spec 014 FR-002:
# `allowed` is the file AND this entry; the key is computed by the harness, not by the module under test).
permit12() { write_permit_store "$PHASE_REPO" "$1" "$3" "" "$2"; }
gate12() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p12 "$@" 2>"$TMP12/err.txt")"; G_RC=$?; G_ERR="$(cat "$TMP12/err.txt")"; }
sub12() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov "$@" 2>"$TMP12/err.txt")"; G_RC=$?; G_ERR="$(cat "$TMP12/err.txt")"; }
nothing12() { [[ ! -e "$PHASE_DIR/PLAN-REVIEW-LOG.md" && ! -e "$PHASE_DIR/xreview" && ! -e "$PHASE_DIR/observations.jsonl" && ! -e "$PHASE_DIR/XREVIEW.md" ]]; }
status12() { printf '## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"; }
setapplies12() { # <value> — sets the applies_to cell of both xprov rows in the TREE copy's registry
  node -e '
    const fs = require("fs"); const f = process.argv[1]; const v = process.argv[2];
    const ids = ["plan-review-xprov", "wave-inspect-xprov"];
    const out = fs.readFileSync(f, "utf8").split("\n").map((l) => (ids.some((id) => l.startsWith("| `" + id + "` |")) ? l.replace(/\|\s*[a-z-]*\s*\|\s*$/, "| " + v + " |") : l));
    fs.writeFileSync(f, out.join("\n"));
  ' "$TREE/_shared/gates-registry.md" "$1"
}

caseP1() {
  prep12; file12 denied robert 2026-10-05; status12
  gate12 --gate "$GATE_PLAN"
  assert_rc "P1 file-only denied (store empty) → gate exit 1" 1 "$G_RC" "$G_ERR"
  assert_json "P1 reason external_review_denial_mismatch, step permit-check, verdict fail" "$G_OUT" "[j.reason, j.step, j.verdict].join('/')" "external_review_denial_mismatch/permit-check/fail"
  nothing12 && ok "P1 the gate wrote nothing (no log, no xreview/, no observation)" || bad "P1 the gate wrote into the repo: $(ls "$PHASE_DIR")"
  [[ "$(sum12 "$STORE12")" == absent ]] && ok "P1 no store was created by the gate" || bad "P1 the gate created a store"
  gate12 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD"
  assert_json "P1 the wave gate fails the same way" "$G_OUT" "[j.reason, j.verdict].join('/')" "external_review_denial_mismatch/fail"
  sub12 load-check --phase p12
  assert_rc "P1 load-check stays red (exit 1)" 1 "$G_RC"
  assert_json "P1 load-check reason plan_review_missing, not accepted" "$G_OUT" "[j.reason, String(j.accepted)].join('/')" "plan_review_missing/null"
  sub12 wave-status --phase p12
  assert_rc "P1 wave-status stays red (exit 1)" 1 "$G_RC"
  assert_json "P1 wave-status reason wave_inspect_missing" "$G_OUT" "j.reason" "wave_inspect_missing"
  sub12 permit-check
  assert_rc "P1 permit-check exit 1" 1 "$G_RC"
  assert_json "P1 permit-check state denial_mismatch" "$G_OUT" "j.state + '/' + j.reason" "denial_mismatch/external_review_denial_mismatch"
  [[ "$G_ERR" == *"permit --deny"* ]] && ok "P1 the hint names permit --deny" || bad "P1 hint lacks permit --deny: $G_ERR"
}

caseP2() {
  prep12; file12 allowed robert 2026-10-05 record/x.md; store12 robert 2026-10-05
  sub12 permit-check
  assert_json "P2 store denial next to an allowed file → denial_mismatch" "$G_OUT" "j.state + '/' + j.ok" "denial_mismatch/false"
  gate12 --gate "$GATE_PLAN"
  assert_json "P2 gate fails external_review_denial_mismatch" "$G_OUT" "j.reason + '/' + j.step" "external_review_denial_mismatch/permit-check"
  nothing12 && ok "P2 nothing written" || bad "P2 the gate wrote: $(ls "$PHASE_DIR")"
  # differing values: file denied by someone else than the store says
  file12 denied alice 2026-10-05
  sub12 permit-check; assert_json "P2 denied on both sides but another decided_by → denial_mismatch" "$G_OUT" "j.state" "denial_mismatch"
  file12 denied robert 2026-10-06
  sub12 permit-check; assert_json "P2 denied on both sides but another decided_on → denial_mismatch" "$G_OUT" "j.state" "denial_mismatch"
  # store denial but no file at all
  rm -f "$PHASE_REPO/.a1/xprov.json"
  sub12 permit-check; assert_json "P2 store denial and no file → denial_mismatch" "$G_OUT" "j.state" "denial_mismatch"
}

caseP3() {
  prep12; file12 allowed robert 2026-10-05 record/x.md; store12 robert 2026-10-06; chmod 644 "$STORE12"
  sub12 permit-check
  assert_json "P3a unusable store (mode 0644) + allowed file → denial_mismatch" "$G_OUT" "j.state" "denial_mismatch"
  gate12 --gate "$GATE_PLAN"
  assert_json "P3a gate fails external_review_denial_mismatch" "$G_OUT" "j.reason" "external_review_denial_mismatch"
  prep12; file12 denied robert 2026-10-05; mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  printf '{"version":2,"nope":true}\n' > "$STORE12"; chmod 600 "$STORE12"
  sub12 permit-check
  assert_json "P3b store of an unknown format + denied file → denial_mismatch" "$G_OUT" "j.state" "denial_mismatch"
  prep12; file12 allowed robert 2026-10-05 record/x.md; mkdir -p "$HOME/.a1-xprov"; chmod 755 "$HOME/.a1-xprov"
  sub12 permit-check
  assert_json "P3c store with no file but a 0755 ~/.a1-xprov dir, allowed file → denial_mismatch" "$G_OUT" "j.state" "denial_mismatch"
  chmod 700 "$HOME/.a1-xprov"; permit12 robert 2026-10-05 record/x.md
  sub12 permit-check
  assert_json "P3c control: dir 0700 and no denial store file (permit entry present) → allowed (a missing store is no denial)" "$G_OUT" "j.state + '/' + j.ok" "allowed/true"
}

caseP4() {
  prep12; mkdir -p "$PHASE_REPO/.a1/xprov.json" # the file step cannot write: the path is a directory
  local r; r="$(permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-05' })")"
  assert_json "P4 half write: the call reports ok:false with denial_mismatch" "$r" "[j.ok, j.reason].join('/')" "false/external_review_denial_mismatch"
  assert_json "P4 the store holds the denial (step 1 happened)" "$(cat "$STORE12" 2>/dev/null || echo '{}')" "Object.keys(j.denials || {}).length" "1"
  sub12 permit-check
  assert_json "P4 permit-check reports denial_mismatch (fail closed)" "$G_OUT" "j.state" "denial_mismatch"
  # P4b (Reinhard MINOR): permit (allowed) removes the store denial first; a failing file step must not throw,
  # must say what is half written, and leaves denial_mismatch (file still denied, store empty).
  prep12
  permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-05' })" >/dev/null
  chmod 555 "$PHASE_REPO/.a1"
  r="$(permit_lib "$TREE" "(() => { try { return P.permit({ repoRoot: '$PHASE_REPO', by: 'robert', record: 'record/x.md', today: '2026-10-05' }); } catch (e) { return { threw: e.code || e.message }; } })()")"
  chmod 755 "$PHASE_REPO/.a1"
  assert_json "P4b permit with a failing file step does not throw: ok:false, denial_mismatch" "$r" "[String(j.threw), j.ok, j.reason].join('/')" "undefined/false/external_review_denial_mismatch"
  assert_json "P4b the detail names the half-written state (denial removed, file not written)" "$r" "/denial.*removed/i.test(j.detail || '') && /could not be/.test(j.detail || '')" "true"
  sub12 permit-check
  assert_json "P4b permit-check reports denial_mismatch (file still denied, store empty)" "$G_OUT" "j.state" "denial_mismatch"
}

caseP5() {
  prep12
  local r; r="$(permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-05' })")"
  assert_json "P5 deny writes store and file" "$r" "j.ok" "true"
  sub12 permit-check
  assert_json "P5 after deny: state denied, exit 1" "$G_OUT" "j.state + '/' + j.ok" "denied/false"
  assert_rc "P5 permit-check exit 1 for denied" 1 "$G_RC"
  r="$(permit_lib "$TREE" "P.permit({ repoRoot: '$PHASE_REPO', by: 'robert', record: 'record/2026-10-05-x.md', today: '2026-10-05' })")"
  assert_json "P5 permit (allowed) succeeds" "$r" "j.ok" "true"
  assert_json "P5 allow removed this repo's store denial" "$(cat "$STORE12")" "Object.keys(j.denials).length" "0"
  sub12 permit-check
  assert_json "P5 after allow: state allowed" "$G_OUT" "j.state + '/' + j.ok" "allowed/true"
  assert_eq "P5 store mode stays 0600" "$(mode12 "$STORE12")" "600"
  assert_eq "P5 store dir mode 0700" "$(mode12 "$HOME/.a1-xprov")" "700"
}

caseP6() {
  prep12; status12
  permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-05' })" >/dev/null
  gate12 --gate "$GATE_PLAN"
  assert_rc "P6 denied: gate exits 1 (exit 0 stays reserved for pass)" 1 "$G_RC" "$G_ERR"
  assert_json "P6 verdict not_applicable, reason external_review_denied, step permit-check" "$G_OUT" "[j.verdict, j.reason, j.step].join('/')" "not_applicable/external_review_denied/permit-check"
  assert_json "P6 exactly one observation: xprov-codex, pattern xprov_not_applicable" "$(cat "$PHASE_DIR/observations.jsonl" 2>/dev/null || echo '{}')" "[j.agent, j.pattern, j.skill].join('/')" "xprov-codex/xprov_not_applicable/a1-plan"
  assert_eq "P6 one observation line" "$(wc -l < "$PHASE_DIR/observations.jsonl" 2>/dev/null | tr -d ' ')" "1"
  grep -q "step: permit-check" "$PHASE_DIR/PLAN-REVIEW-LOG.md" 2>/dev/null && grep -q "verdict: not_applicable" "$PHASE_DIR/PLAN-REVIEW-LOG.md" && ok "P6 one log entry names step permit-check and verdict not_applicable" || bad "P6 log entry missing"
  [[ ! -e "$PHASE_DIR/xreview" ]] && ok "P6 no xreview/ (no run happened)" || bad "P6 xreview/ exists"
  [[ "$(ls "$HOME/.a1-xprov/snapshots" 2>/dev/null | wc -l | tr -d ' ')" == 0 ]] && ok "P6 no snapshot, no runner call" || bad "P6 a snapshot exists"
  gate12 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD"
  assert_json "P6 the wave gate is not_applicable too" "$G_OUT" "j.verdict + '/' + j.wave" "not_applicable/1"
  sub12 load-check --phase p12
  assert_rc "P6 load-check exit 0 for a denied repo" 0 "$G_RC" "$G_ERR"
  assert_json "P6 load-check ok true, accepted not_applicable" "$G_OUT" "j.ok + '/' + j.accepted" "true/not_applicable"
  sub12 wave-status --phase p12
  assert_rc "P6 wave-status exit 0 for a denied repo" 0 "$G_RC" "$G_ERR"
  assert_json "P6 wave-status ok true, completed waves listed under not_applicable, none lacking" "$G_OUT" "[j.ok, JSON.stringify(j.not_applicable), j.lacking.length].join('/')" 'true/[1]/0'
  sub12 load-check --phase p12 --expect-sha "$(printf '0%.0s' {1..64})"
  assert_rc "P6 --expect-sha still guards the plan (a different sha → exit 1)" 1 "$G_RC"
  # the same repo, then tampered: the file flipped back to a different decision
  file12 denied robert 2026-10-09
  sub12 load-check --phase p12
  assert_rc "P6 a file edited after the owner's denial → load-check exit 1" 1 "$G_RC"
}

caseP7() {
  prep12; status12
  permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-05' })" >/dev/null
  setapplies12 all
  gate12 --gate "$GATE_PLAN"
  assert_json "P7 denied on an applies_to: all row → external_review_not_permitted" "$G_OUT" "j.verdict + '/' + j.reason" "fail/external_review_not_permitted"
  nothing12 && ok "P7 nothing written" || bad "P7 wrote: $(ls "$PHASE_DIR")"
  sub12 load-check --phase p12
  assert_rc "P7 load-check stays red on an applies_to: all row" 1 "$G_RC"
  setapplies12 ""
  gate12 --gate "$GATE_PLAN"
  assert_json "P7 an empty applies_to cell means all" "$G_OUT" "j.verdict + '/' + j.reason" "fail/external_review_not_permitted"
  setapplies12 permitted-repos
  gate12 --gate "$GATE_PLAN"
  assert_json "P7 control: permitted-repos → not_applicable" "$G_OUT" "j.verdict" "not_applicable"
}

caseP8() {
  prep12
  gate12 --gate "$GATE_PLAN"
  assert_json "P8 absent → external_review_not_permitted (never not_applicable)" "$G_OUT" "j.verdict + '/' + j.reason" "fail/external_review_not_permitted"
  [[ "$G_ERR" == *"permit --deny"* ]] && ok "P8 the hint names permit and permit --deny" || bad "P8 hint: $G_ERR"
  nothing12 && ok "P8 nothing written" || bad "P8 wrote: $(ls "$PHASE_DIR")"
  mkdir -p "$PHASE_REPO/.a1"; printf '{not json\n' > "$PHASE_REPO/.a1/xprov.json"
  sub12 permit-check; assert_json "P8 invalid file → state invalid" "$G_OUT" "j.state + '/' + j.reason" "invalid/external_review_not_permitted"
  gate12 --gate "$GATE_PLAN"
  assert_json "P8 invalid → external_review_not_permitted" "$G_OUT" "j.reason" "external_review_not_permitted"
  file12 maybe robert 2026-10-05 record/x.md
  sub12 permit-check; assert_json "P8 another external_review value → invalid" "$G_OUT" "j.state" "invalid"
  file12 denied robert ""
  sub12 permit-check; assert_json "P8 denied without decided_on → invalid, not denied" "$G_OUT" "j.state" "invalid"
  sub12 permit-check --repo "$PHASE_REPO"; assert_json "P8 --repo works" "$G_OUT" "j.state" "invalid"
}

caseP9() {
  prep12; file12 allowed robert 2026-10-05 record/x.md; permit12 robert 2026-10-05 record/x.md
  sub12 permit-check
  assert_rc "P9 allowed → exit 0" 0 "$G_RC"
  assert_json "P9 state allowed" "$G_OUT" "j.state + '/' + j.ok" "allowed/true"
  [[ "$G_ERR" == *"full tracked tree"* && "$G_ERR" == *"read-only sandbox"* ]] && ok "P9 the allowed line carries the exposure sentence (FR-016)" || bad "P9 exposure sentence missing: $G_ERR"
  # the permit file of plugin 1.10.0 stays valid: no schema change
  assert_json "P9 an existing 1.10.0 record is still allowed" "$G_OUT" "j.record" "record/x.md"
  file12 denied robert 2026-10-05
  rm -f "$HOME/.a1-xprov/permits.json" # spec 014: a denial next to an owner permit entry is denial_mismatch (part 15 PS4f)
  store12 robert 2026-10-05
  sub12 permit-check
  assert_rc "P9 denied → exit 1 (only allowed exits 0)" 1 "$G_RC"
  assert_json "P9 state denied" "$G_OUT" "j.state + '/' + j.reason" "denied/external_review_denied"
}

caseP10() {
  local j; j="$(node -e '
    const fs = require("fs"); const G = require(process.argv[1] + "/_shared/lib/gate-ids.cjs");
    const text = fs.readFileSync(process.argv[1] + "/_shared/gates-registry.md", "utf8");
    const row = (id) => G.parseRegistryRow(text, id);
    const header = text.split("\n").find((l) => /^\|\s*id\s*\|/i.test(l));
    const cols = header.split("|").slice(1, -1).map((c) => c.trim().toLowerCase());
    process.stdout.write(JSON.stringify({ last: cols[cols.length - 1], plan: row("plan-review-xprov").applies_to, wave: row("wave-inspect-xprov").applies_to, audit: row("plan-audit").applies_to }));
  ' "$REPO_ROOT")"
  assert_json "P10 the id table's last column is applies_to" "$j" "j.last" "applies_to"
  assert_json "P10 both xprov rows carry permitted-repos" "$j" "j.plan + '/' + j.wave" "permitted-repos/permitted-repos"
  assert_json "P10 another row leaves the cell empty (= all)" "$j" "JSON.stringify(j.audit)" '""'
  local n; n="$(grep -c 'not_applicable' "$REGISTRY")"
  [[ "$n" -ge 2 ]] && ok "P10 the registry names the not_applicable outcome on both xprov rows ($n)" || bad "P10 registry lacks the not_applicable routing sentence ($n)"
}

caseP11() {
  prep12
  local r
  r="$(permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-05' })")"
  assert_json "P11 deny needs no --record (optional for a denial)" "$r" "j.ok" "true"
  assert_json "P11 the denied record: external_review, decided_by, decided_on, no record" "$(cat "$PHASE_REPO/.a1/xprov.json")" "[j.external_review, j.decided_by, j.decided_on, 'record' in j].join('/')" "denied/robert/2026-10-05/false"
  assert_json "P11 the store entry: same decided_by/decided_on plus ts, keyed by the git-common-dir" "$(cat "$STORE12")" "(() => { const e = j.denials['$(repokey12)']; return e ? [e.decided_by, e.decided_on, typeof e.ts, Object.keys(e).length].join('/') : 'no entry'; })()" "robert/2026-10-05/string/3"
  r="$(permit_lib "$TREE" "(() => { try { P.permit({ repoRoot: '$PHASE_REPO', by: 'robert' }); return 'no throw'; } catch (e) { return e.code; } })()")"
  assert_json "P11 allow without --record is still refused (A1_INPUT)" "$r" "j" "A1_INPUT"
  r="$(permit_lib "$TREE" "(() => { try { P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'a b' }); return 'no throw'; } catch (e) { return e.code; } })()")"
  assert_json "P11 deny with a bad --by is refused (A1_INPUT)" "$r" "j" "A1_INPUT"
  # an unusable store is never overwritten
  prep12; mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"; printf '{"broken":1}\n' > "$STORE12"; chmod 600 "$STORE12"
  local before; before="$(sum12 "$STORE12")"
  r="$(permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-05' })")"
  assert_json "P11 deny with an unusable store → ok:false, nothing written" "$r" "j.ok" "false"
  assert_eq "P11 the unusable store is byte-identical" "$(sum12 "$STORE12")" "$before"
  [[ ! -e "$PHASE_REPO/.a1/xprov.json" ]] && ok "P11 and no file was written" || bad "P11 the file was written after a refused store"
  r="$(permit_lib "$TREE" "P.permit({ repoRoot: '$PHASE_REPO', by: 'robert', record: 'record/x.md', today: '2026-10-05' })")"
  assert_json "P11 permit (allowed) with an unusable store → ok:false" "$r" "j.ok" "false"
  [[ ! -e "$PHASE_REPO/.a1/xprov.json" ]] && ok "P11 permit wrote no file either" || bad "P11 permit wrote a file"
  # --default-branch survives into a denial
  prep12
  permit_lib "$TREE" "P.permitDeny({ repoRoot: '$PHASE_REPO', by: 'robert', today: '2026-10-05', defaultBranch: 'trunk' })" >/dev/null
  assert_json "P11 --default-branch is recorded on a denial" "$(cat "$PHASE_REPO/.a1/xprov.json")" "j.default_branch" "trunk"
}

caseP12() {
  local hook="$REPO_ROOT/.claude/hooks/xprov-deny-allowlist-approve.sh" p hv
  local -a deny=(
    'node _shared/a1-tools.cjs xprov permit --by robert --record record/x.md'
    'xprov permit --deny --by robert'
    'xprov  permit --deny'
    'xprov \"permit\" --by x'
    'xprov \\\npermit --by x'
    'xprov permit-check && xprov permit --by x'
    'cat ~/.a1-xprov/permit-denials.json'
    'ls ~/.a1-xprov/ | grep a1-xprov/permit-denials'
    # Reinhard MAJOR (spec 012 review): obfuscations the normaliser must see through
    'xprov per\\mit --deny'
    "xprov \$'permit' --deny"
    'p=permit; xprov $p --deny'
    'cat ~/.a1-xprov/permit-den*')
  for p in "${deny[@]}"; do
    hv="$(printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$p" | bash "$hook" 2>/dev/null)"
    assert_json "P12 hook denies ${p}" "$hv" "j.hookSpecificOutput.permissionDecision" "deny"
  done
  # The Edit/Write tools bypass the Bash hook: settings.json must deny them on the denial store too.
  local sj="${P12_SETTINGS:-$REPO_ROOT/.claude/settings.json}"
  assert_json "P12 settings.json denies Edit and Write of ~/.a1-xprov/permit-denials.json" "$(cat "$sj")" \
    "['Edit', 'Write'].every((t) => j.permissions.deny.includes(t + '(~/.a1-xprov/permit-denials.json)'))" "true"
  local -a allow=('node _shared/a1-tools.cjs xprov permit-check''xprov permit-check --repo .' 'git status' 'cat ~/.a1-xprov/permit-check.txt')
  for p in "${allow[@]}"; do
    hv="$(printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$p" | bash "$hook" 2>/dev/null)"
    [[ "$hv" != *deny* ]] && ok "P12 hook lets ${p} through" || bad "P12 hook denied ${p}"
  done
  local nonode="$TMP12/nonode-bin"; mkdir -p "$nonode"
  for tool in cat sed tr printf; do [[ -x "/usr/bin/$tool" ]] && ln -sf "/usr/bin/$tool" "$nonode/$tool"; [[ -x "/bin/$tool" ]] && ln -sf "/bin/$tool" "$nonode/$tool"; done
  for p in 'xprov \"permit\" --by x' 'xprov  permit --deny' 'xprov per\\mit --deny' "xprov \$'permit' --deny" 'cat ~/.a1-xprov/permit-den*'; do
    hv="$(printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$p" | PATH="$nonode" /bin/bash "$hook" 2>/dev/null)"
    [[ "$hv" == *'"deny"'* ]] && ok "P12 hook without node denies ${p}" || bad "P12 hook without node let ${p} through"
  done
  hv="$(printf '{"tool_name":"Bash","tool_input":{"command":"xprov permit-check"}}' | PATH="$nonode" /bin/bash "$hook" 2>/dev/null)"
  [[ "$hv" != *deny* ]] && ok "P12 hook without node lets permit-check through" || bad "P12 hook without node denied permit-check"
}

caseR21x() {
  local tools rc before_f before_s
  prep12; tools="$TREE_TOOLS"
  ( cd "$PHASE_REPO" && "${NOCLAUDE12[@]}" node "$tools" xprov permit --by robert --record record/x.md < /dev/null > "$TMP12/x1.out" 2>&1 ); rc=$?
  assert_rc "R21x permit from a non-TTY → exit 2" 2 "$rc"
  [[ ! -e "$PHASE_REPO/.a1/xprov.json" && "$(sum12 "$STORE12")" == absent ]] && ok "R21x permit wrote neither file nor store" || bad "R21x permit wrote from a non-TTY"
  grep -q "must both be a terminal" "$TMP12/x1.out" && ok "R21x the refusal names the terminal rule" || bad "R21x refusal text: $(tail -n 2 "$TMP12/x1.out")"
  ( cd "$PHASE_REPO" && "${NOCLAUDE12[@]}" node "$tools" xprov permit --deny --by robert < /dev/null > "$TMP12/x2.out" 2>&1 ); rc=$?
  assert_rc "R21x permit --deny from a non-TTY → exit 2" 2 "$rc"
  [[ ! -e "$PHASE_REPO/.a1/xprov.json" && "$(sum12 "$STORE12")" == absent ]] && ok "R21x permit --deny wrote neither file nor store" || bad "R21x permit --deny wrote from a non-TTY"
  # existing state stays byte-identical
  file12 allowed robert 2026-10-05 record/x.md; store12 robert 2026-10-05
  before_f="$(sum12 "$PHASE_REPO/.a1/xprov.json")"; before_s="$(sum12 "$STORE12")"
  ( cd "$PHASE_REPO" && "${NOCLAUDE12[@]}" node "$tools" xprov permit --deny --by mallory < /dev/null >/dev/null 2>&1 ); rc=$?
  assert_rc "R21x a second permit --deny from a non-TTY → exit 2" 2 "$rc"
  assert_eq "R21x the file is byte-identical" "$(sum12 "$PHASE_REPO/.a1/xprov.json")" "$before_f"
  assert_eq "R21x the store is byte-identical" "$(sum12 "$STORE12")" "$before_s"
  PTY_TYPED="allowed" pty12 env CLAUDECODE=1 sh -c 'cd "$1" && node "$2" xprov permit --by robert --record record/x.md' sh "$PHASE_REPO" "$tools"; rc=$?
  assert_rc "R21x CLAUDECODE=1 under a pseudo-TTY → exit 2" 2 "$rc"
  assert_eq "R21x the store is still byte-identical" "$(sum12 "$STORE12")" "$before_s"
  assert_eq "R21x the file is still byte-identical" "$(sum12 "$PHASE_REPO/.a1/xprov.json")" "$before_f"
  grep -qF "CLAUDECODE" "$TMP12/pty-out.txt" && ok "R21x the refusal names CLAUDECODE" || bad "R21x output: $(tr -d '\r' < "$TMP12/pty-out.txt" | tail -n 2)"
  # a usage error (bad --by) is still exit 2 and writes nothing
  prep12
  ( cd "$PHASE_REPO" && node "$tools" xprov permit --by 'a b' --record record/x.md < /dev/null >/dev/null 2>&1 ); rc=$?
  assert_rc "R21x a bad --by is exit 2" 2 "$rc"
}

caseR21y() {
  if claude_ancestor12; then skip12 "R21y owner permit (allowed typed back)"; skip12 "R21y owner permit --deny"; skip12 "R21y wrong typed word"; return 0; fi
  local tools rc; prep12; tools="$TREE_TOOLS"
  PTY_TYPED="allowed" pty12 "${NOCLAUDE12[@]}" sh -c 'cd "$1" && node "$2" xprov permit --by robert --record record/x.md' sh "$PHASE_REPO" "$tools"; rc=$?
  assert_rc "R21y owner permit, 'allowed' typed back → exit 0" 0 "$rc"
  assert_json "R21y the file says allowed" "$(cat "$PHASE_REPO/.a1/xprov.json" 2>/dev/null || echo '{}')" "[j.external_review, j.decided_by, j.record].join('/')" "allowed/robert/record/x.md"
  grep -qF "full tracked tree" "$TMP12/pty-out.txt" && ok "R21y the exposure sentence is printed before the prompt" || bad "R21y no exposure sentence: $(tr -d '\r' < "$TMP12/pty-out.txt" | tail -n 4)"
  grep -qF "$(repokey12)" "$TMP12/pty-out.txt" && ok "R21y the repository key is printed" || bad "R21y no key printed"
  PTY_TYPED="denied" pty12 "${NOCLAUDE12[@]}" sh -c 'cd "$1" && node "$2" xprov permit --deny --by robert' sh "$PHASE_REPO" "$tools"; rc=$?
  assert_rc "R21y owner permit --deny, 'denied' typed back → exit 0" 0 "$rc"
  assert_json "R21y the store holds the denial for this repo" "$(cat "$STORE12" 2>/dev/null || echo '{}')" "Object.keys(j.denials || {}).join(',')" "$(repokey12)"
  sub12 permit-check
  assert_json "R21y permit-check says denied" "$G_OUT" "j.state" "denied"
  PTY_TYPED="allowed" pty12 "${NOCLAUDE12[@]}" sh -c 'cd "$1" && node "$2" xprov permit --deny --by mallory' sh "$PHASE_REPO" "$tools"; rc=$?
  assert_rc "R21y a wrong typed word → exit 2" 2 "$rc"
  assert_json "R21y the denial is unchanged" "$(cat "$STORE12")" "Object.values(j.denials)[0].decided_by" "robert"
  PTY_TYPED="allowed" pty12 "${NOCLAUDE12[@]}" sh -c 'cd "$1" && node "$2" xprov permit --by robert --record record/y.md' sh "$PHASE_REPO" "$tools"; rc=$?
  assert_rc "R21y permit after a denial: allowed typed back → exit 0" 0 "$rc"
  assert_json "R21y that removed the store denial" "$(cat "$STORE12")" "Object.keys(j.denials).length" "0"
}

caseP13() {
  local f
  for f in skills/a1-plan/workflows/04b-xprov-review.md skills/a1-execute/workflows/01-load.md skills/a1-execute/workflows/02-execute.md skills/a1-execute/workflows/03-verify.md; do
    grep -q "not_applicable" "$REPO_ROOT/$f" && ok "P13 $f has a not_applicable routing row" || bad "P13 $f lacks not_applicable"
  done
  for f in skills/a1-plan/workflows/04b-xprov-review.md skills/a1-execute/workflows/03-verify.md; do
    grep -q "xprov_not_applicable" "$REPO_ROOT/$f" && ok "P13 $f carries the retro tag xprov_not_applicable" || bad "P13 $f lacks xprov_not_applicable"
  done
  assert_json "P13 observe accepts the pattern xprov_not_applicable" "$(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1] + "/_shared/lib/xprov-observe.cjs").PATTERNS))' "$REPO_ROOT")" "j.includes('xprov_not_applicable')" "true"
  assert_json "P13 REASON_LIST holds the spec 012 reasons and the spec 014 permit_mismatch reason" "$(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1] + "/_shared/lib/xprov.cjs").REASONS))' "$REPO_ROOT")" "['external_review_denied', 'external_review_denial_mismatch', 'external_review_permit_mismatch'].every((r) => j[r] === r)" "true"
  local help; help="$(node "$REPO_ROOT/_shared/a1-tools.cjs" --help 2>&1)"
  local t
  for t in 'permit --deny' 'permit-denials.json' 'denial_mismatch' 'external_review_denied' 'not_applicable' 'xprov_not_applicable' '0..9999'; do
    [[ "$help" == *"$t"* ]] && ok "P13 a1-tools --help documents '$t' (B.4)" || bad "P13 a1-tools --help lacks '$t'"
  done
}

caseP1; caseP2; caseP3; caseP4; caseP5; caseP6; caseP7; caseP8; caseP9; caseP10; caseP11; caseP12; caseR21x; caseR21y; caseP13
export HOME="$SAVED_HOME_12"
rm -rf "$TMP12"
