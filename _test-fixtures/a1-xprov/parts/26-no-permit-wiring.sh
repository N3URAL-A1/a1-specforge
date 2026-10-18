#!/usr/bin/env bash
# Part 26 — spec 016 Wave 5: no permit is not a block (FR-012) and "ask once per phase" is enforced in code (FR-002).
# Sourced by run-tests.sh. Part-local helpers only (no helper of another part is used).
#
# NP  A repo without permit (never asked / asked and unanswered / owner No / headless): `xprov gate` for the plan and the wave gate returns
#     `not_applicable` (exit 1, the existing contract), reason `external_review_not_permitted` (a No: `external_review_denied`), with ZERO
#     runner calls, no snapshot, no a1 write (no log, no xreview/, no observation, no owner-store byte); `load-check` and `wave-status` exit 0.
#     A store mismatch (denial next to a permit, permit without file, bad file, changed origin) and an `applies_to: all` row stay a fail.
#   NP1  never asked / headless          Red if permitFor() stops counting state `absent` as not applicable           [mutant M1]
#   NP2  the absent branch writes nothing Red if the absent result is logged like a denial (recordNotApplicable)        [mutant M2]
#   NP3  load-check / wave-status        Red if the loaders keep accepting only state `denied`                          [mutant M3]
#   NP4  `invalid` file stays a fail     Red if the predicate widens from `absent` to every not-permitted state         [mutant M4]
# AQ  "Ask once per phase": `consent question --kind consent|classification` needs --phase <name> (an existing .a1/phases/<name>) or
#     --run <id>; the first call records the ask in the owner store consent-asked.json (audit line `consent-asked`); a second question for the
#     same repo + kind + phase/run is refused (reason already_asked_this_scope) after an owner No, an unanswered question, and after
#     `consent revoke`; the record survives revoke. The same question is re-shown only while its marker is still open.
#   AQ2  a second ask is refused          Red if claimAsk() drops the prior-entry refusal                                [mutant M5]
#   AQ3  revoke does not reset the ask    Red if revokeConsent() also resets the asked store                              [mutant M6]
#   AQ3c another repo may ask in a phase of the same name   Red if the entry id omits the repository key               [mutant M9]
#   AQ3b the sibling kind may still ask   Red if the entry id omits the kind                                             [mutant M7]
#   AQ8  classification needs the consent yes of the phase   Red if claimAsk() drops the consent-yes check            [W5-6]
#   AQ4  re-show only while the marker is open   Red if the re-show exception ignores the marker state                    [mutant M8]
# Mutants run on tree copies only (rule 4b); the real owner store stays untouched (the harness compares it at the end).

TMP26="$(mktemp -d "${TMPDIR:-/tmp}/a1x26.XXXXXX")"
[[ -n "$TMP26" && -d "$TMP26" ]] || { echo "FAIL  part 26: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_26="$HOME"
export HOME="$TMP26/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
ORG26=https://github.com/N3URAL-A1/fixture.git
LUD26=record/2026-10-14-ludwig-fixture.md
# A temp vault for the classification question (it names a legal record that must exist); the real A1_VAULT_ROOT is restored at the end.
SAVED_VAULT_26="${A1_VAULT_ROOT-__unset__}"
export A1_VAULT_ROOT="$TMP26/vault"; mkdir -p "$A1_VAULT_ROOT/record"; printf 'fixture legal record\n' > "$A1_VAULT_ROOT/$LUD26"
SIM26="$FAKE/consent-sim.cjs"
TPL26="$CASES/consent"
ARGV26_DIR="$TMP26/argv"; mkdir -p "$ARGV26_DIR"; ARGV26_N=0
STORE26="$HOME/.a1-xprov"
ASKED26="$STORE26/consent-asked.json"
SNAPS26="$STORE26/snapshots"


# pin26 <value> — both xprov rows of the TREE copy's registry to `blocking` (the strictest enforcement: not_applicable must still continue)
pin26() {
  node -e '
    const fs = require("fs"); const file = process.argv[1]; const ids = ["plan-review-xprov", "wave-inspect-xprov"];
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").split("\n").map((l) => (ids.some((id) => l.startsWith("| `" + id + "` |")) ? l.replace(/\| (warning|blocking) \|/, "| blocking |") : l)).join("\n"));
  ' "$TREE/_shared/gates-registry.md" || bad "pin26: could not pin the registry copy"
}
# fresh26 — a new tree copy with the registry pinned to blocking; it is the tree every case and every RED proof starts from
fresh26() { make_tree; pin26; T26="$TREE"; T26_TOOLS="$TREE_TOOLS"; }
# prep26 [origin] — phase repo p26 with STATUS (wave 1 complete), empty owner store, compliant home (the tree is the current one: a mutant stays in place)
prep26() {
  local o="${1-$ORG26}"
  make_phase p26
  [[ -n "$o" ]] && git -C "$PHASE_REPO" remote add origin "$o"
  PHASE_HEAD="$(cd "$PHASE_REPO" && git rev-parse HEAD)"
  printf '## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"
  rm -rf "$STORE26"
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"; export A1_XPROV_CODEX_HOME="$XHOME"
}
key26() { (cd "$PHASE_REPO" && cd "$(git rev-parse --git-common-dir)" && pwd -P); }
gate26() {
  ARGV26_N=$((ARGV26_N + 1)); ARGV26_FILE="$ARGV26_DIR/argv-$ARGV26_N.json"
  FAKE_RUNNER_ARGV_FILE="$ARGV26_FILE" FAKE_RUNNER_CASE="${FAKE_RUNNER_CASE:-approved}" fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p26 --timeout 7 "$@" 2>"$TMP26/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP26/err.txt")"
}
sub26() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov "$@" 2>"$TMP26/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP26/err.txt")"; }
cli26() { sub26 consent "$@"; }
sim26() { SIM_OUT="$(node "$SIM26" "$1" 2>"$TMP26/sim.err")"; SIM_RC=$?; }
ask26() { sim26 "{\"cmd\":\"ask\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"${1:-consent}\",\"tool_use\":\"toolu_${1:-consent}\",\"session\":\"sess_26\",\"ludwig\":\"x\"}"; }
ans26() { sim26 "{\"cmd\":\"answer\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"${1:-consent}\",\"mode\":\"$2\",\"text\":\"vielleicht\",\"tool_use\":\"toolu_${1:-consent}\",\"session\":\"sess_26\",\"ludwig\":\"x\",\"template\":\"$TPL26/post-tool-use.answers.template.json\"}"; }
age26() { sim26 "{\"cmd\":\"age\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"${1:-consent}\",\"ms\":660000}"; }
runner_calls26() { [[ -f "$ARGV26_FILE" ]] && echo yes || echo no; }
snaps26() { ls -d "$SNAPS26"/snap-* 2>/dev/null | wc -l | tr -d ' '; }
# nothing26 — no a1 write into the phase and no byte in the owner store
nothing26() { [[ ! -e "$PHASE_DIR/PLAN-REVIEW-LOG.md" && ! -e "$PHASE_DIR/xreview" && ! -e "$PHASE_DIR/observations.jsonl" && ! -e "$PHASE_DIR/XREVIEW.md" && ! -e "$STORE26" ]]; }
sha26() { if [[ -e "$1" ]]; then (shasum -a 256 "$1" 2>/dev/null || sha256sum "$1") | cut -d' ' -f1; else echo absent; fi; }
mtree26() { # <lib-file> <from> <to> — TREE becomes a copy with ONE production change (refuses unless <from> occurs exactly once)
  make_tree; pin26
  node -e '
    const fs = require("fs"); const [tree, name, from, to] = process.argv.slice(1);
    const f = tree + "/_shared/lib/" + name; const s = fs.readFileSync(f, "utf8"); const n = s.split(from).length - 1;
    if (n !== 1) { console.error("mutation needle count " + n + " in " + name + ": " + from.slice(0, 60)); process.exit(3); }
    fs.writeFileSync(f, s.replace(from, () => to));
  ' "$TREE" "$1" "$2" "$3" || bad "NP harness: mutation failed in $1"
}
fresh26
unmtree26() { TREE="$T26"; TREE_TOOLS="$T26_TOOLS"; }
redproof26() { # <name> <scenario fn> <expected on the real tree> <lib-file> <from> <to>
  local name="$1" fn="$2" want="$3" file="$4" from="$5" to="$6" got mut
  got="$($fn)"
  [[ "$got" == "$want" ]] || { bad "$name: real tree gave '$got', wanted '$want'"; return 0; }
  mtree26 "$file" "$from" "$to"; mut="$($fn)"; unmtree26
  [[ "$mut" != "$want" ]] && ok "$name RED [mutant]: with the production change the outcome flips ('$want' -> '$mut')" || bad "$name RED [mutant]: the guard is dead, the mutant still gives '$mut'"
}

# redproof26b — like redproof26 but the mutant carries TWO production changes in one lib file (the two independent lookups of one guard)
redproof26b() { # <name> <scenario fn> <expected> <lib-file> <from1> <to1> <from2> <to2>
  local name="$1" fn="$2" want="$3" file="$4" got mut
  got="$($fn)"
  [[ "$got" == "$want" ]] || { bad "$name: real tree gave '$got', wanted '$want'"; return 0; }
  mtree26 "$file" "$5" "$6"
  node -e '
    const fs = require("fs"); const [tree, name, from, to] = process.argv.slice(1);
    const f = tree + "/_shared/lib/" + name; const s = fs.readFileSync(f, "utf8"); const n = s.split(from).length - 1;
    if (n !== 1) { console.error("mutation needle count " + n + ": " + from.slice(0, 60)); process.exit(3); }
    fs.writeFileSync(f, s.replace(from, () => to));
  ' "$TREE" "$file" "$7" "$8" || bad "NP harness: second mutation failed in $file"
  mut="$($fn)"; unmtree26
  [[ "$mut" != "$want" ]] && ok "$name RED [mutant, both lookups]: with both production changes the outcome flips ('$want' -> '$mut')" || bad "$name RED [mutant]: the guard is dead, the mutant still gives '$mut'"
}

# ---------- NP1: never asked / headless (FR-012) ----------
caseNP1() {
  prep26
  gate26 --gate "$GATE_PLAN"
  assert_rc "NP1 plan gate, no permit: exit 1 (the not_applicable contract)" 1 "$G_RC" "$G_ERR"
  assert_json "NP1 plan gate verdict not_applicable, reason external_review_not_permitted, step permit-check" "$G_OUT" "[j.verdict, j.reason, j.step, j.enforcement].join('/')" "not_applicable/external_review_not_permitted/permit-check/blocking"
  assert_eq "NP1 the runner was never called" "$(runner_calls26)" "no"
  assert_eq "NP1 no snapshot" "$(snaps26)" "0"
  nothing26 && ok "NP1 zero bytes: no log, no xreview/, no observation, no owner-store file" || bad "NP1 something was written: $(ls "$PHASE_DIR") / $(ls -A "$STORE26" 2>/dev/null)"
  [[ "$G_ERR" == *"no external review permit"* ]] && ok "NP1 stderr carries the one-line no-permit notice" || bad "NP1 notice missing: $G_ERR"
  gate26 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD"
  assert_json "NP1 wave gate: not_applicable / external_review_not_permitted" "$G_OUT" "[j.verdict, j.reason, j.wave].join('/')" "not_applicable/external_review_not_permitted/1"
  assert_eq "NP1 wave gate: the runner was never called" "$(runner_calls26)" "no"
  nothing26 && ok "NP1 wave gate wrote nothing either" || bad "NP1 wave gate wrote: $(ls "$PHASE_DIR")"
  sub26 load-check --phase p26
  assert_rc "NP1 load-check exit 0 for a repo without permit" 0 "$G_RC" "$G_ERR"
  assert_json "NP1 load-check ok, accepted not_applicable, permit_state absent" "$G_OUT" "[j.ok, j.accepted, j.permit_state, j.reason].join('/')" "true/not_applicable/absent/"
  sub26 wave-status --phase p26
  assert_rc "NP1 wave-status exit 0 for a repo without permit" 0 "$G_RC" "$G_ERR"
  assert_json "NP1 wave-status ok, wave 1 listed under not_applicable, none lacking" "$G_OUT" "[j.ok, JSON.stringify(j.not_applicable), j.lacking.length, j.permit_state].join('/')" "true/[1]/0/absent"
  sub26 load-check --phase p26 --expect-sha "$(printf '0%.0s' {1..64})"
  assert_rc "NP1 --expect-sha still guards the plan (a different sha: exit 1)" 1 "$G_RC"
  assert_json "NP1 …reason plan_changed" "$G_OUT" "j.reason" "plan_changed"
  nothing26 && ok "NP1 the loaders wrote nothing" || bad "NP1 a loader wrote"
  # positive control: with a permit the same call reaches the runner (the canary is live)
  write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  gate26 --gate "$GATE_PLAN"
  assert_eq "NP1 control: with a permit the runner IS called" "$(runner_calls26)" "yes"
}
scen_np1() { prep26; gate26 --gate "$GATE_PLAN"; echo "$G_RC/$(json_get "$G_OUT" "j.verdict + '/' + j.reason")/$(runner_calls26)"; }

# ---------- NP2: unanswered, owner No ----------
caseNP2() {
  prep26
  cli26 question --kind consent --phase p26; assert_rc "NP2 the consent question is issued" 0 "$G_RC" "$G_ERR"
  ask26 consent
  assert_json "NP2 the plugin hook opened the marker (question put, no answer yet)" "$SIM_OUT" "j.ok" "true"
  gate26 --gate "$GATE_PLAN"
  assert_json "NP2 unanswered question: not_applicable / external_review_not_permitted" "$G_OUT" "[j.verdict, j.reason].join('/')" "not_applicable/external_review_not_permitted"
  assert_eq "NP2 unanswered: the runner was never called" "$(runner_calls26)" "no"
  cli26 record --kind consent; assert_rc "NP2 record without an answer writes nothing (exit 1)" 1 "$G_RC"
  sub26 load-check --phase p26; assert_rc "NP2 unanswered: load-check exit 0" 0 "$G_RC" "$G_ERR"
  # the owner answers No: an owner-chat denial, the existing not_applicable / external_review_denied
  ans26 consent no; assert_json "NP2 the owner's No reaches the marker" "$SIM_OUT" "j.ok + '/' + j.decision" "true/no"
  cli26 record --kind consent; assert_rc "NP2 record turns the No into a denial" 0 "$G_RC" "$G_ERR"
  gate26 --gate "$GATE_PLAN"
  assert_json "NP2 after the No: not_applicable / external_review_denied" "$G_OUT" "[j.verdict, j.reason].join('/')" "not_applicable/external_review_denied"
  assert_eq "NP2 after the No: the runner was never called" "$(runner_calls26)" "no"
  gate26 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD"
  assert_json "NP2 after the No: the wave gate is not_applicable too" "$G_OUT" "j.verdict + '/' + j.reason" "not_applicable/external_review_denied"
  sub26 wave-status --phase p26; assert_rc "NP2 after the No: wave-status exit 0" 0 "$G_RC" "$G_ERR"
}

# ---------- NP3: mismatch and unusable states stay fail-closed ----------
caseNP3() {
  local key
  prep26; write_permit_file_only "$PHASE_REPO" mallory record/2026-09-24-fixture.md
  gate26 --gate "$GATE_PLAN"
  assert_json "NP3 an allowed file without the owner's permit entry: fail / external_review_permit_mismatch" "$G_OUT" "[j.verdict, j.reason].join('/')" "fail/external_review_permit_mismatch"
  assert_eq "NP3 …no runner call" "$(runner_calls26)" "no"
  sub26 load-check --phase p26; assert_rc "NP3 …load-check stays red (exit 1)" 1 "$G_RC"
  sub26 wave-status --phase p26; assert_rc "NP3 …wave-status stays red (exit 1)" 1 "$G_RC"
  prep26; key="$(key26)"
  write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  node -e 'const fs=require("fs"); const [dir,key]=process.argv.slice(1); fs.writeFileSync(dir+"/permit-denials.json", JSON.stringify({version:1,denials:{[key]:{decided_by:"robert",decided_on:"2026-10-05",ts:"2026-10-05T00:00:00.000Z"}}},null,2)+"\n",{mode:0o600});' "$STORE26" "$key"
  gate26 --gate "$GATE_PLAN"
  assert_json "NP3 a denial next to a permit: fail (mismatch), never not_applicable" "$G_OUT" "j.verdict" "fail"
  assert_eq "NP3 …no runner call" "$(runner_calls26)" "no"
  sub26 load-check --phase p26; assert_rc "NP3 denial next to permit: load-check exit 1" 1 "$G_RC"
  prep26; mkdir -p "$PHASE_REPO/.a1"; printf '{not json\n' > "$PHASE_REPO/.a1/xprov.json"
  gate26 --gate "$GATE_PLAN"
  assert_json "NP3 a corrupt .a1/xprov.json stays a fail (external_review_not_permitted)" "$G_OUT" "[j.verdict, j.reason].join('/')" "fail/external_review_not_permitted"
  sub26 load-check --phase p26; assert_rc "NP3 corrupt file: load-check exit 1" 1 "$G_RC"
  prep26; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  git -C "$PHASE_REPO" remote set-url origin https://github.com/N3URAL-A1/other.git
  gate26 --gate "$GATE_PLAN"
  assert_json "NP3 a permit voided by an origin change is no permit: not_applicable / external_review_not_permitted (FR-006)" "$G_OUT" "[j.verdict, j.reason, j.permit_state].join('/')" "not_applicable/external_review_not_permitted/origin_changed"
  assert_eq "NP3 …no runner call" "$(runner_calls26)" "no"
  sub26 load-check --phase p26; assert_rc "NP3 …load-check exit 0" 0 "$G_RC" "$G_ERR"
  # an entry without evidence (the terminal permits of 2026-10-12) is no permit either
  prep26; write_permit_file_only "$PHASE_REPO" robert record/2026-09-24-fixture.md
  node -e 'const fs=require("fs"); const [dir,key]=process.argv.slice(1); fs.mkdirSync(dir,{mode:0o700,recursive:true}); fs.writeFileSync(dir+"/permits.json", JSON.stringify({version:1,permits:{[key]:{decided_by:"robert",decided_on:"2026-10-12",record:"record/2026-09-24-fixture.md",ts:"2026-10-12T00:00:00.000Z"}}},null,2)+"\n",{mode:0o600});' "$STORE26" "$(key26)"
  gate26 --gate "$GATE_PLAN"
  assert_json "NP3 an unbound legacy permit entry is no permit: not_applicable / external_review_not_permitted" "$G_OUT" "[j.verdict, j.reason, j.permit_state].join('/')" "not_applicable/external_review_not_permitted/unbound_legacy"
  assert_eq "NP3 …no runner call" "$(runner_calls26)" "no"
  # an applies_to: all row is never not applicable, permit or not
  prep26
  node -e '
    const fs = require("fs"); const f = process.argv[1]; const id = "plan-review-xprov";
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").map((l) => (l.startsWith("| `" + id + "` |") ? l.replace(/\|\s*[a-z-]*\s*\|\s*$/, "| all |") : l)).join("\n"));
  ' "$TREE/_shared/gates-registry.md"
  gate26 --gate "$GATE_PLAN"
  assert_json "NP3 no permit on an applies_to: all row: fail / external_review_not_permitted" "$G_OUT" "[j.verdict, j.reason].join('/')" "fail/external_review_not_permitted"
  sub26 load-check --phase p26; assert_rc "NP3 …load-check exit 1" 1 "$G_RC"
  fresh26
}

# ---------- NP4: hostile --phase ----------
caseNP4() {
  prep26
  local big; big="$(printf 'p%.0s' $(seq 1 10100))"
  for ph in '../../etc' '$(touch '"$TMP26"'/pwned26)' '; rm -rf /' '`id`' "$big" '' 'a/b'; do
    sub26 gate --phase "$ph" --gate "$GATE_PLAN"; assert_rc "NP4 gate --phase '${ph:0:24}' is a usage error" 2 "$G_RC"
    [[ -z "$G_OUT" ]] && ok "NP4 …no stdout JSON" || bad "NP4 stdout for hostile phase: ${G_OUT:0:80}"
    sub26 load-check --phase "$ph"; assert_rc "NP4 load-check --phase '${ph:0:24}' is a usage error" 2 "$G_RC"
    sub26 wave-status --phase "$ph"; assert_rc "NP4 wave-status --phase '${ph:0:24}' is a usage error" 2 "$G_RC"
  done
  (( ${#G_ERR} < 800 )) && ok "NP4 the message for a 10 000-char name is clipped (${#G_ERR} chars)" || bad "NP4 stderr ${#G_ERR} chars"
  [[ ! -e "$TMP26/pwned26" ]] && ok "NP4 the injection-shaped phase name is inert" || bad "NP4 a command in the phase name ran"
  nothing26 && ok "NP4 hostile names wrote nothing" || bad "NP4 wrote: $(ls "$PHASE_DIR")"
}

caseNP5() {
  assert_eq "NP1 RED proof setup: the real tree gives not_applicable and no runner call" "$(scen_np1)" "1/not_applicable/external_review_not_permitted/no"
  redproof26 "NP1" scen_np1 "1/not_applicable/external_review_not_permitted/no" xprov-gate.cjs "permit.state === PERMIT_STATES.DENIED || NP.isNoPermit(permit);" "permit.state === PERMIT_STATES.DENIED;"
  redproof26 "NP2" scen_np2 "yes" xprov-gate.cjs "NP.isNoPermit(permit) ? NP.result(base, permit) :" "false ? NP.result(base, permit) :"
  redproof26 "NP3" scen_np3 "0/0" xprov-gate.cjs "if (np.notApplicable) {" "if (np.notApplicable && np.permit.state === PERMIT_STATES.DENIED) {"
  redproof26 "NP4" scen_np4 "fail" xprov-gate-nopermit.cjs "permit.ok === false && NO_PERMIT_STATES.includes(permit.state)" "permit.ok === false && permit.reason === 'external_review_not_permitted'"
}
scen_np2() { prep26; gate26 --gate "$GATE_PLAN"; nothing26 && echo yes || echo no; }
scen_np3() { prep26; sub26 load-check --phase p26; local a="$G_RC"; sub26 wave-status --phase p26; echo "$a/$G_RC"; }
scen_np4() { prep26; mkdir -p "$PHASE_REPO/.a1"; printf '{not json\n' > "$PHASE_REPO/.a1/xprov.json"; gate26 --gate "$GATE_PLAN"; json_get "$G_OUT" "j.verdict"; }

# ---------- AQ: ask once per phase, enforced in code ----------
asked_count26() { node -e 'try { const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(String(Object.keys(j.asked).length)); } catch (_e) { process.stdout.write("none"); }' "$ASKED26"; }
audit_actions26() { node -e 'try { process.stdout.write(require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).action).join(",")); } catch (_e) { process.stdout.write("none"); }' "$STORE26/consent-audit.jsonl"; }

caseAQ1() {
  prep26; cli26 question --kind consent --phase p26
  assert_rc "AQ1 the first question of the phase is issued" 0 "$G_RC" "$G_ERR"
  assert_json "AQ1 canonical question: header xprov-Freigabe, two labels" "$G_OUT" "[j.ok, j.header, j.labels.length].join('|')" "true|xprov-Freigabe|2"
  local hash; hash="$(json_get "$G_OUT" "j.hash")"
  assert_eq "AQ1 one asked entry written" "$(asked_count26)" "1"
  assert_json "AQ1 the entry: repo key, kind, scope phase p26, question hash, audit sha, time" "$(cat "$ASKED26")" "(() => { const e = Object.values(j.asked)[0]; return [e.repo === '$(key26)', e.kind, e.scope_type, e.scope, e.hash === '$hash', /^[0-9a-f]{64}\$/.test(e.audit), typeof e.at].join('|'); })()" "true|consent|phase|p26|true|true|string"
  assert_eq "AQ1 one audit line: consent-asked" "$(audit_actions26)" "consent-asked"
  assert_eq "AQ1 store mode 0600" "$(mode_of "$ASKED26")" "600"
  assert_json "AQ1 the entry holds the phase directory's device + inode and no opened marker yet (W5-1, W5-2)" "$(cat "$ASKED26")" "(() => { const e = Object.values(j.asked)[0]; return [Number.isSafeInteger(e.dev), e.ino === $(node -p "require('fs').statSync('$PHASE_DIR').ino"), e.opened === null].join('|'); })()" "true|true|true"
  # wave 10: --run <worktree> scopes the one ask of a PR review run (a name that is no absolute worktree path is still refused, nothing recorded)
  prep26; cli26 question --kind consent --run pr-12
  assert_rc "AQ1 --run pr-12 (no absolute worktree path) is refused (exit 2)" 2 "$G_RC"
  [[ "$G_ERR" == *"--work-path must be an absolute path"* && ! -e "$ASKED26" ]] && ok "AQ1 …names the reason and wrote nothing" || bad "AQ1 --run: $G_ERR"
  prep26; cli26 question --kind consent --run "$PHASE_REPO"
  assert_rc "AQ1 --run <worktree>: the first call asks (exit 0)" 0 "$G_RC"
  assert_json "AQ1 …the entry is scoped by the run (worktree)" "$(cat "$ASKED26")" "(() => { const e = Object.values(j.asked)[0]; return [e.scope_type, e.scope === '$(node -p "require('fs').realpathSync('$PHASE_REPO')")'].join('|'); })()" "run|true"
  cli26 question --kind consent --run "$PHASE_REPO"
  assert_rc "AQ1 …a second call for the same run is refused (exit 1)" 1 "$G_RC"
  assert_eq "AQ1 …with already_asked_this_scope" "$(json_get "$G_OUT" "j.reason")" "already_asked_this_scope"
}

# W5-2: the phase key is the directory as the listing spells it, plus its device + inode
scen_aq7_rename() { prep26; cli26 question --kind consent --phase p26 >/dev/null; mv "$PHASE_DIR" "$PHASE_REPO/.a1/phases/p26-moved"; cli26 question --kind consent --phase p26-moved; echo "$G_RC/$(json_get "$G_OUT" "j.reason")"; }
scen_aq7_case() {
  prep26; cli26 question --kind consent --phase p26 >/dev/null; cli26 question --kind consent --phase P26
  if [[ -d "$PHASE_REPO/.a1/phases/P26" ]]; then echo "$G_RC/$(json_get "$G_OUT" "j.reason")"; else echo "$G_RC/case-sensitive"; fi
}
caseAQ7() {
  assert_eq "AQ7 the same phase directory renamed keeps its ask (device + inode): refused" "$(scen_aq7_rename)" "1/already_asked_this_scope"
  redproof26 "AQ7" scen_aq7_rename "1/already_asked_this_scope" xprov-consent-asked.cjs "|| Object.values(store.asked).find(sameDir);" "|| undefined;"
  local got; got="$(scen_aq7_case)"
  if [[ "$got" == *case-sensitive ]]; then assert_eq "AQ7b P26 on a case-sensitive disk is no directory: usage error" "$got" "2/case-sensitive"
  else
    assert_eq "AQ7b P26 and p26 are one directory (case-insensitive disk): the second question is refused" "$got" "1/already_asked_this_scope"
    redproof26b "AQ7b" scen_aq7_case "1/already_asked_this_scope" xprov-consent-asked.cjs "const canon = names.includes(ph.phase) ? ph.phase : (like.length === 1 ? like[0] : null);" "const canon = ph.phase;" "|| Object.values(store.asked).find(sameDir);" "|| undefined;"
  fi
}

# W5-4: a void or legacy permit is named in the output, not only in the exit code
caseNP6() {
  prep26; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  git -C "$PHASE_REPO" remote set-url origin https://github.com/N3URAL-A1/other.git
  gate26 --gate "$GATE_PLAN"
  assert_json "NP6 gate stdout names the void permit state" "$G_OUT" "j.permit_state" "origin_changed"
  [[ "$G_ERR" == *"permit void (origin_changed)"* && "$G_ERR" == *"re-consent"* ]] && ok "NP6 the gate notice says: Codex review skipped, permit void (origin_changed), re-consent" || bad "NP6 notice: $G_ERR"
  sub26 load-check --phase p26
  [[ "$G_ERR" == *"permit void (origin_changed)"* ]] && ok "NP6 the load-check notice names the state" || bad "NP6 load-check notice: $G_ERR"
  sub26 wave-status --phase p26
  [[ "$G_ERR" == *"permit void (origin_changed)"* ]] && ok "NP6 the wave-status notice names the state" || bad "NP6 wave-status notice: $G_ERR"
  prep26; gate26 --gate "$GATE_PLAN"
  [[ "$G_ERR" != *"permit void"* ]] && ok "NP6 state absent: the plain no-permit notice (not a void permit)" || bad "NP6 absent notice: $G_ERR"
}
scen_np6() { prep26; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md; git -C "$PHASE_REPO" remote set-url origin https://github.com/N3URAL-A1/other.git; gate26 --gate "$GATE_PLAN"; [[ "$G_ERR" == *"permit void (origin_changed)"* ]] && echo named || echo silent; }

# scen_aq2: unanswered, then a second ask after the marker expired -> refused
scen_aq2() { prep26; cli26 question --kind consent --phase p26 >/dev/null; ask26 consent; age26 consent; cli26 question --kind consent --phase p26; echo "$G_RC/$(json_get "$G_OUT" "j.reason")"; }
# scen_aq3: owner No, agent revokes, agent asks again in the same phase
scen_aq3() {
  prep26; cli26 question --kind consent --phase p26 >/dev/null; ask26 consent; ans26 consent no; cli26 record --kind consent >/dev/null
  cli26 revoke >/dev/null; local state; sub26 permit-check; state="$(json_get "$G_OUT" "j.state")"
  cli26 question --kind consent --phase p26; echo "$state/$G_RC/$(json_get "$G_OUT" "j.reason")"
}
scen_aq3b() { prep26; cli26 question --kind consent --phase p26 >/dev/null; ask26 consent; ans26 consent yes; cli26 question --kind classification --phase p26 --ludwig-record "$LUD26" >/dev/null; echo "$G_RC"; }
# W5-6: classification needs the consent yes of the phase; an owner No (or no answer) refuses it
scen_aq8() { prep26; cli26 question --kind consent --phase p26 >/dev/null; ask26 consent; ans26 consent "${1:-no}"; cli26 question --kind classification --phase p26 --ludwig-record "$LUD26"; echo "$G_RC/$(json_get "$G_OUT" "j.reason")"; }
scen_aq8_noconsent() { prep26; cli26 question --kind classification --phase p26 --ludwig-record "$LUD26"; echo "$G_RC/$(json_get "$G_OUT" "j.reason")"; }
caseAQ8() {
  assert_eq "AQ8 consent No: the classification question of the phase is refused, no question text" "$(scen_aq8 no)" "1/classification_needs_consent_yes"
  assert_eq "AQ8 consent never asked: refused too" "$(scen_aq8_noconsent)" "1/classification_needs_consent_yes"
  assert_eq "AQ8 consent yes: the classification question is allowed" "$(scen_aq8 yes)" "0/undefined"
  redproof26 "AQ8" scen_aq8 "1/classification_needs_consent_yes" xprov-consent-asked.cjs "if (o.kind === 'classification' && !consentYes(store, o.key, o.scope.dev, o.scope.ino, o.now)) return NEEDS_CONSENT_YES();" ""
}
scen_aq3c() { prep26; cli26 question --kind consent --phase p26 >/dev/null; make_phase p26; git -C "$PHASE_REPO" remote add origin "$ORG26"; cli26 question --kind consent --phase p26; echo "$G_RC"; }
scen_aq4() { prep26; cli26 question --kind consent --phase p26 >/dev/null; local first="$G_OUT"; ask26 consent; cli26 question --kind consent --phase p26; [[ "$G_OUT" == "$first" ]] && echo "$G_RC/same" || echo "$G_RC/other"; }

caseAQ2() {
  assert_eq "AQ2 unanswered, marker expired, same phase: refused (exit 1, already_asked_this_scope)" "$(scen_aq2)" "1/already_asked_this_scope"
  scen_aq2 >/dev/null
  [[ -z "$(json_get "$G_OUT" "j.question")" || "$(json_get "$G_OUT" "j.question")" == undefined ]] && ok "AQ2 the refusal carries no question text" || bad "AQ2 the refusal still printed a question"
  assert_eq "AQ2 …and nothing new was recorded" "$(asked_count26)" "1"
  assert_eq "AQ2 …no second audit line" "$(audit_actions26)" "consent-asked"
  prep26; cli26 question --kind consent --phase p26 >/dev/null; cli26 question --kind consent --phase p26
  assert_eq "AQ2 asked, no marker ever opened (hook denied or nothing put), same phase: refused" "$G_RC/$(json_get "$G_OUT" "j.reason")" "1/already_asked_this_scope"
  [[ "$G_ERR" == *"Reinhard"* ]] && ok "AQ2 the refusal tells the agent to go on Reinhard-only" || bad "AQ2 stderr: $G_ERR"
  mkdir -p "$PHASE_REPO/.a1/phases/p26b"; cli26 question --kind consent --phase p26b
  assert_rc "AQ2 a NEW phase may ask once" 0 "$G_RC" "$G_ERR"
  assert_eq "AQ2 …now two entries" "$(asked_count26)" "2"
  redproof26 "AQ2" scen_aq2 "1/already_asked_this_scope" xprov-consent-asked.cjs "if (prior !== undefined) return" "if (false) return"
}

caseAQ3() {
  assert_eq "AQ3 owner No, agent revokes the denial (state absent again), asks again in the same phase: refused" "$(scen_aq3)" "absent/1/already_asked_this_scope"
  scen_aq3 >/dev/null
  local before; before="$(sha26 "$ASKED26")"
  cli26 revoke; assert_rc "AQ3 revoke runs" 0 "$G_RC" "$G_ERR"
  assert_eq "AQ3 revoke leaves consent-asked.json byte for byte as it was" "$(sha26 "$ASKED26")" "$before"
  mkdir -p "$PHASE_REPO/.a1/phases/p26c"; cli26 question --kind consent --phase p26c
  assert_rc "AQ3 after revoke a new phase may ask again" 0 "$G_RC" "$G_ERR"
  assert_eq "AQ3b the sibling kind (classification) of the same phase may still ask" "$(scen_aq3b)" "0"
  redproof26 "AQ3" scen_aq3 "absent/1/already_asked_this_scope" xprov-consent-record.cjs "const file = removableRepoFile(o.root);" "const file = removableRepoFile(o.root); require('./xprov-approve.cjs').writeGuardedStore('consent-asked.json', { version: 1, asked: {} });"
  assert_eq "AQ3c another repository may ask in a phase of the same name" "$(scen_aq3c)" "0"
  redproof26 "AQ3c" scen_aq3c "0" xprov-consent-asked.cjs "[key, kind, scope.type, scope.id].join('\\0')" "[kind, scope.type, scope.id].join('\\0')"
  redproof26 "AQ3b" scen_aq3b "0" xprov-consent-asked.cjs "[key, kind, scope.type, scope.id].join('\\0')" "[key, scope.type, scope.id].join('\\0')"
}

caseAQ4() {
  assert_eq "AQ4 while the marker is open the same question is shown again (same bytes)" "$(scen_aq4)" "0/same"
  scen_aq4 >/dev/null
  assert_eq "AQ4 …and no second entry" "$(asked_count26)" "1"
  redproof26 "AQ4" scen_aq2 "1/already_asked_this_scope" xprov-consent-asked.cjs "open.state === M.STATE.PENDING || open.state === M.STATE.ANSWERED" "open.state !== M.STATE.NONE"
}

caseAQ5() {
  local big; big="$(printf 'p%.0s' $(seq 1 10100))"
  prep26
  cli26 question --kind consent; assert_rc "AQ5 no --phase and no --run: usage error" 2 "$G_RC"
  cli26 question --kind consent --phase p26 --run pr-1; assert_rc "AQ5 --phase and --run together: usage error" 2 "$G_RC"
  cli26 question --kind classification --ludwig-record "$LUD26"; assert_rc "AQ5 classification needs a scope too" 2 "$G_RC"
  cli26 question --kind consent --phase nope; assert_rc "AQ5 a phase that has no .a1/phases dir: usage error" 2 "$G_RC"
  for ph in '../../etc' '$(touch '"$TMP26"'/pwned26b)' '; rm -rf /' '`id`' "$big" 'a/b'; do
    cli26 question --kind consent --phase "$ph"; assert_rc "AQ5 --phase '${ph:0:24}' is a usage error" 2 "$G_RC"
    cli26 question --kind consent --run "$ph"; assert_rc "AQ5 --run '${ph:0:24}' is a usage error" 2 "$G_RC"
  done
  (( ${#G_ERR} < 800 )) && ok "AQ5 the message for a 10 000-char run id is clipped (${#G_ERR} chars)" || bad "AQ5 stderr ${#G_ERR} chars"
  [[ ! -e "$TMP26/pwned26b" ]] && ok "AQ5 the injection-shaped name is inert" || bad "AQ5 a command in the name ran"
  [[ ! -e "$STORE26" ]] && ok "AQ5 no refusal wrote an owner-store byte" || bad "AQ5 wrote: $(ls -A "$STORE26")"
  cli26 ensure --kind consent --phase p26; assert_rc "AQ5 --phase belongs to question only (ensure: usage error)" 2 "$G_RC"
  cli26 record --kind consent --run pr-1; assert_rc "AQ5 --run belongs to question only (record: usage error)" 2 "$G_RC"
  cli26 question --kind waiver --phase p26 --run pr-1; assert_rc "AQ5 --run on a waiver question: usage error" 2 "$G_RC"
}

caseAQ6() {
  prep26; mkdir -p "$STORE26"; chmod 700 "$STORE26"; printf '{"version":1,"asked":{"x":1}}\n' > "$ASKED26"; chmod 600 "$ASKED26"
  local before; before="$(sha26 "$ASKED26")"
  cli26 question --kind consent --phase p26
  assert_eq "AQ6 an unusable asked store refuses (exit 1, asked_store_unusable)" "$G_RC/$(json_get "$G_OUT" "j.reason")" "1/asked_store_unusable"
  assert_eq "AQ6 …and is never overwritten" "$(sha26 "$ASKED26")" "$before"
  chmod 644 "$ASKED26"; printf '{"version":1,"asked":{}}\n' > "$ASKED26"
  cli26 question --kind consent --phase p26
  assert_eq "AQ6 a 0644 store is unusable too" "$G_RC/$(json_get "$G_OUT" "j.reason")" "1/asked_store_unusable"
}

caseNP1; caseNP2; caseNP3; caseNP4; caseNP5
caseNP6; redproof26 "NP6" scen_np6 "named" xprov-gate-nopermit.cjs "(state === STATES.ABSENT ? NOTICE :" "(true ? NOTICE :"
caseAQ1; caseAQ2; caseAQ3; caseAQ4; caseAQ5; caseAQ6; caseAQ7; caseAQ8
export HOME="$SAVED_HOME_26"
if [[ "$SAVED_VAULT_26" == "__unset__" ]]; then unset A1_VAULT_ROOT; else export A1_VAULT_ROOT="$SAVED_VAULT_26"; fi
rm -rf "$TMP26"
