#!/usr/bin/env bash
# Part 08 — Wave 6b: snapshot secret-scan allowlist (spec 009 FR-030 (a)–(j),
# SC-009). Sourced by run-tests.sh. Cases R30a…R30j2 from the spec's fixture
# map; every arm names the single production change that turns it red.
#
# Technique (plan Wave 6b, step 1):
#   - every arm builds its own primary checkout with a local BARE `origin`, so
#     `git ls-remote origin` and `refs/remotes/origin/*` are real and offline;
#   - every arm gets its own temp HOME, so the approval store
#     (~/.a1-xprov/allowlist-approvals.json) is isolated; gate arms that need
#     an approval write the store directly in the documented format
#     {"version":1,"repos":{"<realpath of git-common-dir>":["<sha256 of blob>"]}};
#   - line fingerprints are computed HERE from the spec's definition (sha256
#     over the UTF-8 of the whole line, terminator stripped), never through
#     the code under test (testing.md class 3). Only the arms that test the
#     fingerprint FUNCTION itself take their entries from `propose --json`,
#     and R30c0 proves propose agrees with the fixture's own computation;
#   - every fake secret is ASSEMBLED AT RUNTIME from pieces that match no
#     pattern, so this file adds no match to the repository's own scan
#     (SC-009 clause). `node _shared/a1-tools.cjs xprov allowlist propose
#     --commit HEAD` on a commit holding this file lists nothing from it;
#   - fail arms assert that the fake runner was never invoked (no argv file).
#
# Guards of `allowlist approve` (FR-030 j): the negative arms run everywhere.
# The positive arms (correct typed count → exit 0) need a process tree that
# does not descend from Claude Code. Under Claude Code (CLAUDECODE set or a
# `claude` ancestor) they print `SKIP (claude-code ancestor)` and the suite
# stays green; with CI=true such a SKIP is a FAIL, so CI can never skip them.
# The pseudo-TTY is `script` (macOS `script -q /dev/null cmd`, util-linux
# `script -qec cmd /dev/null`). Measured 2026-09-28: macOS `script` reads a
# redirected FILE to EOF and delivers ^D before the child reads, so the typed
# count is fed through a delayed pipe; both variants propagate the exit code.
#
# Fake parents (measured 2026-09-28, not derived from the code):
#   - macOS Claude Code: `ps -o comm=` → `claude`, executable (lsof txt) under
#     ~/.local/share/claude/versions/<version>, env CLAUDECODE, CLAUDE_PID,
#     CLAUDE_CODE_* set; the `claude` on PATH is a symlink into versions/.
#   - macOS kills a copy of a system shell (exit 137) unless it is re-signed
#     ad hoc, and /bin/sh re-execs /bin/bash (lsof txt = /bin/bash); the fake
#     parent is therefore a re-signed copy of /bin/bash on macOS and a copy of
#     /bin/sh on Linux (node:20: /proc/<pid>/comm = copy name, exe = copy path).
#   - Linux (aiserver) Claude Code form is NOT measured here: open step for
#     Robert (`cat /proc/$CLAUDE_PID/comm; readlink /proc/$CLAUDE_PID/exe`).

TMP08="$(mktemp -d)"
SAVED_HOME_08="$HOME"
AL_FILE=".a1/xprov-secret-allowlist.json"
STORE_NAME="allowlist-approvals.json"
ARGV8_DIR="$TMP08/argv"; mkdir -p "$ARGV8_DIR"; ARGV8_N=0; N8=0
make_tree   # one tree for the part; each arm has its own repo, origin and HOME

# ---------- runtime-assembled fakes (no source line of this file matches) ----------
Q16="QQQQQQQQQQQQQQQQ"; R16="RRRRRRRRRRRRRRRR"; S16="SSSSSSSSSSSSSSSS"; T16="TTTTTTTTTTTTTTTT"
AKI="AKI"
FAKE_AK1="${AKI}A${Q16}"          # aws_access_key_id shape, 20 chars
FAKE_AK2="${AKI}A${R16}"
FAKE_AK3="${AKI}A${S16}"
FAKE_AK4="${AKI}A${T16}"
SKP="sk"
FAKE_SK1="${SKP}-BBBBBBBBBBBBBBBBBBBBBBBB"     # matches sk_prefixed_key AND sk_prefixed_key_ext
FAKE_SK2="${SKP}-CCCCCCCCCCCCCCCCCCCCCCCC"
XO="xo"
FAKE_XOXB="${XO}xb-12345678abcd"               # matches slack_token AND slack_token_family
D5="-----"
PEM_LITERAL_LINE="const re = /${D5}BEGIN/;"
PGP_LINE="${D5}BEGIN PGP PRIVATE KEY BLOCK${D5}"

# fp8 <line> — the spec's line fingerprint, computed independently of the code.
fp8() { printf '%s' "$1" > "$TMP08/fp.txt"; sha256_of "$TMP08/fp.txt"; }

# al_ent <path> <pattern> <max_count> <class> <fp[,fp…]> — one entry, literal JSON.
al_ent() {
  local fps="" f
  for f in ${5//,/ }; do fps="$fps\"$f\","; done
  printf '{"path":"%s","pattern":"%s","max_count":%s,"fingerprints":[%s],"class":"%s","reason":"fixture","reviewed_by":"%s","added_on":"2026-09-28"}' \
    "$1" "$2" "$3" "${fps%,}" "$4" "${REVIEWER8:-robert}"
}
# al_doc <entries-json> [owner]
al_doc() { printf '{"version":1,"owner":"%s","entries":[%s]}\n' "${2:-robert}" "$1"; }

# ---------- repo, origin, HOME ----------

c8() { ( cd "$R8" && git add -A && git commit -qm "$1" ); }
push8() { git -C "$R8" push -q origin HEAD:refs/heads/main && git -C "$R8" fetch -q origin; }
head8() { git -C "$R8" rev-parse "${1:-HEAD}"; }

# new8 — fresh HOME with the auth file, compliant dedicated home, bare origin
# O8 and primary checkout R8 (branch main): permit record (by robert), phase
# p8 with the captured approved PLAN.md, src/add.js; committed, pushed, fetched.
new8() {
  N8=$((N8 + 1)); A8="$TMP08/a$N8"; mkdir -p "$A8"
  export HOME="$A8/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"; export A1_XPROV_CODEX_HOME="$XHOME"
  O8="$A8/origin.git"; R8="$A8/repo"; P8DIR="$R8/.a1/phases/p8"
  git init -q --bare "$O8" && git -C "$O8" symbolic-ref HEAD refs/heads/main
  git init -q "$R8" && git -C "$R8" symbolic-ref HEAD refs/heads/main
  git -C "$R8" config user.name fixture; git -C "$R8" config user.email fixture@example.invalid; git -C "$R8" config commit.gpgsign false
  mkdir -p "$P8DIR" "$R8/src"; cp "$CASES/approved.PLAN.md" "$P8DIR/PLAN.md"
  printf 'export function add(a, b) { return a + b; }\n' > "$R8/src/add.js"
  # the gate's own outputs stay out of the fixture commits (c8 stages everything else)
  printf '.a1/phases/p8/XREVIEW.md\n.a1/phases/p8/PLAN-REVIEW-LOG.md\n.a1/phases/p8/xreview/\n.a1/phases/p8/observations.jsonl\n' > "$R8/.gitignore"
  write_permit "$R8" robert record/2026-09-28-fixture.md
  c8 "base"
  git -C "$R8" remote add origin "$O8"; push8
}

# plant8 <file> <line>… — writes the lines to <file> in R8 (overwrites).
plant8() { local f="$1"; shift; mkdir -p "$(dirname "$R8/$f")"; printf '%s\n' "$@" > "$R8/$f"; }

# al_commit8 <doc> — the allowlist as its own commit (touching no other path).
al_commit8() { printf '%s' "$1" > "$R8/$AL_FILE"; ( cd "$R8" && git add "$AL_FILE" && git commit -qm "allowlist" ); }

# blobsha8 [rev] — sha256 of the allowlist blob at <rev> (default origin/main).
blobsha8() { git -C "$R8" show "${1:-origin/main}:$AL_FILE" > "$TMP08/blob"; sha256_of "$TMP08/blob"; }

# storekey8 — realpath of R8's git-common-dir (the store's repository key).
storekey8() { ( cd "$R8" && cd "$(git rev-parse --git-common-dir)" && pwd -P ); }

# store8 <sha>… — writes the approval store directly (0700 dir, 0600 file).
store8() {
  mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  node -e '
    const [file, key, ...shas] = process.argv.slice(1);
    require("fs").writeFileSync(file, JSON.stringify({ version: 1, repos: { [key]: shas } }, null, 2) + "\n");
  ' "$HOME/.a1-xprov/$STORE_NAME" "$(storekey8)" "$@"
  chmod 600 "$HOME/.a1-xprov/$STORE_NAME"
}

# scen8 — the common pass scenario: main holds f.sh with FAKE_AK1 (commit
# "fake"), then the allowlist alone covering it (approved in the store); a
# feature branch `feat` adds one harmless commit, which is the reviewed commit.
scen8() {
  new8
  L_AK1="id: $FAKE_AK1"
  plant8 f.sh "$L_AK1"; c8 "fake"
  al_commit8 "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")")")"
  push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
}

# gate8 [flags…] — `xprov gate --phase p8` from inside R8. Sets G_OUT G_ERR G_RC ARGV8_FILE.
gate8() {
  ARGV8_N=$((ARGV8_N + 1)); ARGV8_FILE="$ARGV8_DIR/argv-$ARGV8_N.json"
  FAKE_RUNNER_ARGV_FILE="$ARGV8_FILE" FAKE_RUNNER_CASE="${FAKE_RUNNER_CASE:-approved}" fake_runner_env
  G_OUT="$(cd "$R8" && node "$TREE_TOOLS" xprov gate --phase p8 --timeout 7 "$@" 2>"$TMP08/gate-err.txt")"; G_RC=$?
  G_ERR="$(cat "$TMP08/gate-err.txt")"
}
plan8() { gate8 --gate "$GATE_PLAN" "$@"; }

# never_ran8 <name> — the fake runner was not invoked for the last gate8 call.
never_ran8() { [[ ! -f "$ARGV8_FILE" ]] && ok "$1: runner never invoked" || bad "$1: runner WAS invoked"; }

# expect8 <name> <reason/detail> — gate exit 1 at step snapshot with that reason
# (and reason_detail when given as reason/detail), runner never invoked.
expect8() {
  local name="$1" want="$2" got
  if [[ "$want" == */* ]]; then got="$(json_get "$G_OUT" "j.step + ':' + j.reason + '/' + j.reason_detail")"
  else got="$(json_get "$G_OUT" "j.step + ':' + j.reason")"; fi
  [[ "$G_RC" -eq 1 && "$got" == "snapshot:$want" ]] && ok "$name → $want" || bad "$name: want snapshot:$want (exit 1), got $got (exit $G_RC) — $(printf '%s' "$G_ERR" | tail -n 2)"
  never_ran8 "$name"
}

# expect_permit8 <name> — an unusable ~/.a1-xprov now fails closed one step EARLIER than the
# allowlist (spec 012 FR-001: an allowed file next to an unusable store is denial_mismatch).
expect_permit8() {
  local got; got="$(json_get "$G_OUT" "j.step + ':' + j.reason")"
  [[ "$G_RC" -eq 1 && "$got" == "permit-check:external_review_denial_mismatch" ]] && ok "$1 → fails closed at permit-check (denial_mismatch)" || bad "$1: want permit-check:external_review_denial_mismatch (exit 1), got $got (exit $G_RC)"
  never_ran8 "$1"
}

# reader_refuses8 <name> — the approval store READER (the allowlist's own check, R30j5/R30j6) still
# refuses the current ~/.a1-xprov as unusable: ok false and NOT `missing`. expect_permit8 only shows
# that the gate stops earlier now; this keeps the original allowlist assertion alive (Reinhard MINOR).
reader_refuses8() {
  local r; r="$(node -e 'const AL = require(process.argv[1] + "/_shared/lib/xprov-allowlist.cjs"); const a = AL.readApprovals(); process.stdout.write(JSON.stringify({ ok: a.ok, missing: a.missing }));' "$TREE")"
  assert_json "$1 the approval-store reader refuses the home as unusable (not 'missing')" "$r" "j.ok + '/' + j.missing" "false/false"
}

# pass8 <name> — gate exit 0, verdict pass.
pass8() {
  [[ "$G_RC" -eq 0 && "$(json_get "$G_OUT" "j.verdict")" == "pass" ]] && ok "$1 → pass" || bad "$1: want pass, got $(json_get "$G_OUT" "j.step + ':' + j.reason + '/' + j.reason_detail") (exit $G_RC) — $(printf '%s' "$G_ERR" | tail -n 2)"
}

# ---------- R30a: schema, fail-closed parsing ----------
# One mutation per arm: skip the pattern-name lookup (a1); drop the max_count
# upper bound (a2); treat unparsable JSON as "no allowlist" (a3); skip the tree
# check on `path` (a4, a8); skip the glob-character check (a5); accept unknown
# keys (a6); parse with plain JSON.parse — last duplicate wins (a7).
# Every document is approved in the store, so the schema is the only cause.
schema8() { # <name> <doc>
  scen8; git -C "$R8" checkout -q main
  al_commit8 "$2"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat2; printf '// f2\n' >> "$R8/src/add.js"; c8 "feature 2"
  plan8; expect8 "$1" "allowlist_invalid"
}
caseR30a() {
  local fp; fp="$(fp8 "id: $FAKE_AK1")"
  local good; good="$(al_ent f.sh aws_access_key_id 1 fixture_fake "$fp")"
  schema8 "R30a1 unknown pattern name" "$(al_doc "$good,$(al_ent f.sh aws_key_id 1 fixture_fake "$fp")")"
  schema8 "R30a2 max_count 9" "$(al_doc "$(al_ent f.sh aws_access_key_id 9 fixture_fake "$fp")")"
  schema8 "R30a3 invalid JSON" '{"version":1,"owner":"robert","entries":['
  schema8 "R30a4 directory path (a tree at the anchor)" "$(al_doc "$good,$(al_ent src aws_access_key_id 1 fixture_fake "$fp")")"
  schema8 "R30a5 glob path" "$(al_doc "$good,$(al_ent 'f.*' aws_access_key_id 1 fixture_fake "$fp")")"
  schema8 "R30a6 unknown key" "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$fp" | sed 's/}$/,"note":"x"}/')")"
  schema8 "R30a7 duplicate JSON key (last value valid)" "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$fp" | sed 's/"max_count":1/"max_count":9,"max_count":1/')")"
  # a8: `d` is a file at the anchor and a tree at the reviewed commit
  scen8; git -C "$R8" checkout -q main
  plant8 d "plain"; c8 "d file"
  al_commit8 "$(al_doc "$good,$(al_ent d aws_access_key_id 1 fixture_fake "$fp")")"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat2; git -C "$R8" rm -q d; plant8 d/x "plain"; c8 "d becomes a tree"
  plan8; expect8 "R30a8 path that is a tree at the reviewed commit" "allowlist_invalid"
}

# ---------- R30b: the reviewed range is checked from the merge-base ----------
# Mutations: read the allowlist at --base instead of the merge-base (b1); drop
# the first-parent step for plan review on the tip (b2).
caseR30b() {
  scen8
  local a_sha; a_sha="$(blobsha8)"
  # wave 1 commits A plus an entry for a planted fake, wave 2 is inspected with --base = wave-1 HEAD
  L_AK2="id: $FAKE_AK2"; plant8 g.sh "$L_AK2"
  printf '%s' "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")"),$(al_ent g.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK2")")")" > "$R8/$AL_FILE"
  c8 "wave 1"; local w1; w1="$(head8)"
  store8 "$a_sha" "$(blobsha8 HEAD)"   # both blobs approved: under the mutation the arm would PASS
  printf '// wave 2\n' >> "$R8/src/add.js"; c8 "wave 2"
  gate8 --gate "$GATE_WAVE" --wave 2 --base "$w1"
  expect8 "R30b1 wave 2 inspected with --base = wave-1 HEAD, range touches the allowlist" "allowlist_modified"
  # plan review on the default-branch tip whose last commit added the allowlist and the fake together
  new8
  L_AK1="id: $FAKE_AK1"; plant8 f.sh "$L_AK1"
  printf '%s' "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")")")" > "$R8/$AL_FILE"
  c8 "allowlist and fake together"; push8; store8 "$(blobsha8)"
  plan8; expect8 "R30b2' plan review on the tip that added allowlist and fake together" "allowlist_modified"
}

# ---------- R30b2: anchor resolution ----------
# Mutations: resolve via refs/remotes/origin/HEAD (arm 1); fall back to local
# main, and separately read the allowlist from the snapshot (arm 2); skip the
# ls-remote comparison (arm 3); apply the first-parent step to wave-inspect
# (arm 4); skip the git-common-dir comparison (arm 5).
caseR30b2() {
  # arm 1: origin/HEAD points at feature/x, which holds the allowlist commit
  new8
  git -C "$R8" checkout -q -b feature/x
  L_AK1="id: $FAKE_AK1"
  al_commit8 "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")")")"
  plant8 f.sh "$L_AK1"; c8 "fake"
  git -C "$R8" push -q origin feature/x && git -C "$R8" fetch -q origin
  git -C "$R8" remote set-head origin feature/x
  store8 "$(blobsha8 origin/feature/x)"
  printf '// local\n' >> "$R8/src/add.js"; c8 "local commit on feature/x"
  plan8; expect8 "R30b2-1 origin/HEAD → feature/x is never consulted (origin/main is)" "allowlist_modified"
  # arm 2: no refs/remotes/origin/main; local main holds the allowlist; the reviewed commit carries it; the store approves it
  scen8
  git -C "$R8" update-ref -d refs/remotes/origin/main
  plan8; expect8 "R30b2-2 no refs/remotes/origin/main, local main never used, snapshot copy never read" "secret_in_snapshot/allowlist_anchor_unresolved"
  # arm 3: local origin/main forged to a feature sha while the bare origin is unchanged
  new8
  git -C "$R8" checkout -q -b feat
  L_AK1="id: $FAKE_AK1"
  al_commit8 "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")")")"
  git -C "$R8" update-ref refs/remotes/origin/main "$(head8)"; store8 "$(blobsha8)"
  plant8 f.sh "$L_AK1"; c8 "fake"
  plan8; expect8 "R30b2-3 local origin/main ≠ ls-remote → unresolved" "secret_in_snapshot/allowlist_anchor_unresolved"
  # arm 4: wave-inspect of a commit that is an ancestor of (here: equal to) origin/main
  new8
  L_AK1="id: $FAKE_AK1"
  al_commit8 "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")")")"
  local base4; base4="$(head8)"
  plant8 f.sh "$L_AK1"; c8 "fake"; push8; store8 "$(blobsha8)"
  gate8 --gate "$GATE_WAVE" --wave 1 --base "$base4"
  expect8 "R30b2-4 wave-inspect of a default-branch commit → unresolved" "secret_in_snapshot/allowlist_anchor_unresolved"
  # arm 5: --work-path points at a foreign clone (other git-common-dir)
  scen8
  local foreign="$A8/foreign"; git clone -q "$O8" "$foreign"
  gate8 --gate "$GATE_WAVE" --wave 1 --base "$(head8 origin/main)" --work-path "$foreign"
  expect8 "R30b2-5 --work-path in a foreign clone" "snapshot_failed"
}

# ---------- R30b3: ref hygiene ----------
# Mutations: skip check-ref-format on read (arm 1b); skip it on write (arm 2);
# ignore an ls-remote failure (arm 3); drop the ls-remote timeout, or kill only
# the child instead of its process group (arm 4); treat an ls-remote mismatch
# as "use the local ref" (arm 5).
# Arm 1a is the spec's literal `main..x`; `rev-parse` refuses that name too, so
# only arm 1b (`-main`: refused by `check-ref-format --branch`, but a real ref
# that fetch and ls-remote find — measured 2026-09-28) makes the read check the
# single cause.
setbranch8() { node -e '
  const fs = require("fs"); const f = process.argv[1]; const r = JSON.parse(fs.readFileSync(f, "utf8"));
  r.default_branch = process.argv[2]; fs.writeFileSync(f, JSON.stringify(r, null, 2) + "\n");' "$R8/.a1/xprov.json" "$1"
  write_permit_store "$R8" robert record/2026-09-28-fixture.md "$1"; } # spec 014: the owner's entry follows the file, so this arm still isolates the branch check
caseR30b3() {
  scen8; setbranch8 'main..x'
  plan8; expect8 "R30b3-1a default_branch main..x" "secret_in_snapshot/allowlist_anchor_unresolved"
  scen8
  git -C "$R8" push -q origin 'refs/remotes/origin/main:refs/heads/-main' && git -C "$R8" fetch -q origin
  setbranch8 '-main'
  plan8; expect8 "R30b3-1b default_branch -main (a real remote branch, not a valid --branch name)" "secret_in_snapshot/allowlist_anchor_unresolved"
  # arm 2: permit --default-branch 'a b' → exit 1, file unchanged
  local before; before="$(cat "$R8/.a1/xprov.json")"
  # permit's library function (the CLI sits behind the owner guards since spec 012 FR-014)
  local pl; pl="$(permit_lib "$TREE" "P.permit({ repoRoot: '$R8', by: 'robert', record: 'record/2026-09-28-fixture.md', defaultBranch: 'a b' }).reason")"
  assert_eq "R30b3-2 permit --default-branch 'a b' is refused" "$pl" '"invalid_default_branch"'
  assert_eq "R30b3-2 .a1/xprov.json unchanged" "$(cat "$R8/.a1/xprov.json")" "$before"
  permit_lib "$TREE" "P.permit({ repoRoot: '$R8', by: 'robert', record: 'record/2026-09-28-fixture.md', defaultBranch: 'trunk' }).ok" >/dev/null
  assert_json "R30b3-2 permit --default-branch trunk writes default_branch" "$(cat "$R8/.a1/xprov.json")" "j.default_branch + '/' + j.decided_by" "trunk/robert"
  # arms 3/4: origin URL ssh://fixture.invalid/r with a fake ssh first on PATH
  scen8; local sshbin3="$A8/sshbin"; mkdir -p "$sshbin3"; printf '#!/bin/sh\nexit 255\n' > "$sshbin3/ssh"; chmod +x "$sshbin3/ssh"
  git -C "$R8" remote set-url origin ssh://fixture.invalid/r
  PATH="$sshbin3:$PATH" plan8; expect8 "R30b3-3 ls-remote fails (fake ssh exits 255)" "secret_in_snapshot/allowlist_anchor_unresolved"
  scen8; local sshbin4="$A8/sshbin"; mkdir -p "$sshbin4"; printf '#!/bin/sh\nsleep 60\n' > "$sshbin4/ssh"; chmod +x "$sshbin4/ssh"
  git -C "$R8" remote set-url origin ssh://fixture.invalid/r
  local t0 t1; t0=$(date +%s)
  PATH="$sshbin4:$PATH" plan8; t1=$(date +%s)
  expect8 "R30b3-4 ls-remote hangs (fake ssh sleeps 60 s)" "secret_in_snapshot/allowlist_anchor_unresolved"
  [[ $((t1 - t0)) -lt 40 ]] && ok "R30b3-4 unresolved in $((t1 - t0)) s (< 40 s: timeout plus process-group kill)" || bad "R30b3-4 took $((t1 - t0)) s (≥ 40 s)"
  # arm 5: local origin/main behind the bare origin (an unfetched merge)
  scen8
  local other="$A8/other"; git clone -q "$O8" "$other"
  ( cd "$other" && git -c user.name=f -c user.email=f@example.invalid commit -q --allow-empty -m "merged elsewhere" && git push -q origin HEAD:main )
  plan8; expect8 "R30b3-5 local origin/main behind the bare origin" "secret_in_snapshot/allowlist_anchor_unresolved"
  [[ "$G_OUT$G_ERR" == *"git fetch origin"* ]] && ok "R30b3-5 the message says git fetch origin" || bad "R30b3-5 no 'git fetch origin' hint"
}

# ---------- R30c: line fingerprints bind the value ----------
# Mutations: fingerprint the matched text instead of the line (c3 — entries
# come from `propose --json`, so the mutated function writes them too); skip
# the fingerprint comparison (c1); stop counting after the first match per
# file (c2).
propose_doc8() { # <rev> — the draft from propose --json with reasons filled in
  ( cd "$R8" && node "$TREE_TOOLS" xprov allowlist propose --commit "$1" --json 2>/dev/null ) \
    | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); for (const e of d.entries) { e.reason = "fixture"; } process.stdout.write(JSON.stringify(d));'
}
caseR30c() {
  # c0 control: two pairs on one line (sk_prefixed_key + _ext), fixture-computed fingerprints → pass
  new8
  L_SK="k: $FAKE_SK1"; plant8 f.sh "$L_SK"; c8 "fake"
  al_commit8 "$(al_doc "$(al_ent f.sh sk_prefixed_key 1 fixture_fake "$(fp8 "$L_SK")"),$(al_ent f.sh sk_prefixed_key_ext 1 fixture_fake "$(fp8 "$L_SK")")")"
  push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; pass8 "R30c0 control: allowlisted line, unchanged"
  assert_json "R30c0 allowlisted_hits 2 (one line, two patterns)" "$G_OUT" "j.allowlisted_hits" "2"
  local pfp; pfp="$(propose_doc8 HEAD | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(d.entries.filter((e) => e.path === "f.sh").map((e) => e.fingerprints.join(",")).join("|"))')"
  assert_eq "R30c0 propose --json fingerprints equal the fixture's own line fingerprint (spec definition)" "$pfp" "$(fp8 "$L_SK")|$(fp8 "$L_SK")"
  # c1: the key on the allowlisted line replaced by another sk- value
  printf 'k: %s\n' "$FAKE_SK2" > "$R8/f.sh"; c8 "key replaced"
  plan8; expect8 "R30c1 another sk- value on the allowlisted line" "secret_in_snapshot"
  # c2: the allowlisted line twice (max_count 1)
  git -C "$R8" checkout -q -B feat origin/main
  printf '%s\n%s\n' "$L_SK" "$L_SK" > "$R8/f.sh"; c8 "line twice"
  plan8; expect8 "R30c2 the allowlisted line twice with max_count 1" "secret_in_snapshot"
  # c3: entry from propose covers a regex-literal line; head replaces it by a PGP key header
  new8
  plant8 x.cjs "$PEM_LITERAL_LINE"; c8 "pattern literal"
  al_commit8 "$(propose_doc8 HEAD)"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; plant8 x.cjs "$PGP_LINE"; c8 "pgp header"
  plan8; expect8 "R30c3 prefix-only pattern: the line, not the match, is bound" "secret_in_snapshot"
}

# ---------- R30c2: UTF-16 view ----------
# Mutation: skip the UTF-16 view when counting and fingerprinting.
utf16_8() { # <file> <line>… — UTF-16LE with BOM, LF endings
  node -e 'const [f, ...ls] = process.argv.slice(1); require("fs").writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(ls.map((l) => l + "\n").join(""), "utf16le")]));' "$R8/$1" "${@:2}"
}
caseR30c2() {
  new8
  L_SK="k: $FAKE_SK1"
  utf16_8 w.txt "header" "$L_SK"; c8 "utf16"
  al_commit8 "$(al_doc "$(al_ent w.txt sk_prefixed_key 1 fixture_fake "$(fp8 "$L_SK")"),$(al_ent w.txt sk_prefixed_key_ext 1 fixture_fake "$(fp8 "$L_SK")")")"
  push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; pass8 "R30c2a UTF-16LE allowlisted line (fingerprint over the UTF-8 of the decoded line)"
  assert_json "R30c2a count 1 per pattern (allowlisted_hits 2)" "$G_OUT" "j.allowlisted_hits + '/' + j.allowlist_stale.length" "2/0"
  utf16_8 w.txt "header" "$L_SK" "k2: $FAKE_SK2"; c8 "second sk line"
  plan8; expect8 "R30c2b a second, unlisted sk- line in the same UTF-16LE file" "secret_in_snapshot"
}

# ---------- R30c3: windows ----------
# Mutations: count per window without offset deduplication (arm 1);
# fingerprint only the window's part of the line (arm 2).
big8() { # <file> <pad-bytes-before-line> <line> — 'a' padding, LF, line, LF, 'b' padding to > 6 MB
  node -e '
    const [f, pad, line] = process.argv.slice(1); const fs = require("fs");
    const head = Buffer.alloc(Number(pad), 0x61); head[head.length - 1] = 0x0a;
    const tail = Buffer.alloc(6 * 1024 * 1024 - Number(pad), 0x62);
    fs.writeFileSync(f, Buffer.concat([head, Buffer.from(line + "\n", "latin1"), tail]));
  ' "$R8/$1" "$2" "$3"
}
caseR30c3() {
  local W=5242880
  new8
  L_AK1="id: $FAKE_AK1"
  big8 big1.txt $((W + 50)) "$L_AK1"   # match starts at W+54: inside the 512-byte overlap
  c8 "big1"
  al_commit8 "$(al_doc "$(al_ent big1.txt aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")")")"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; pass8 "R30c3a match inside the window overlap counts once (max_count 1)"
  assert_json "R30c3a allowlisted_hits 1" "$G_OUT" "j.allowlisted_hits" "1"
  new8
  local cs; cs="$(printf 'c%.0s' $(seq 1 1000))"
  L_AK2="id: $FAKE_AK2 $cs"          # starts at W-100, ~1 KiB long: crosses W and W+512
  big8 big2.txt $((W - 100)) "$L_AK2"; c8 "big2"
  al_commit8 "$(al_doc "$(al_ent big2.txt aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK2")")")"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; pass8 "R30c3b a line crossing the window end is fingerprinted whole"
}

# ---------- R30d: self-approval stops before dispatch ----------
# Mutations: drop the `git diff --name-only` check (arms 1–2); drop
# `--no-renames` (arm 3); read the allowlist from the working tree (arm 4);
# drop the separate-commit check (arm 5).
caseR30d() {
  scen8
  L_AK2="id: $FAKE_AK2"; plant8 g.sh "$L_AK2"
  printf '%s' "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")"),$(al_ent g.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK2")")")" > "$R8/$AL_FILE"
  c8 "feature adds its own entry"; store8 "$(blobsha8 origin/main)" "$(blobsha8 HEAD)"
  plan8; expect8 "R30d1 feature commit adds its own entry for its planted key" "allowlist_modified"
  scen8; git -C "$R8" rm -q "$AL_FILE"; c8 "delete allowlist"
  plan8; expect8 "R30d2 feature commit deleting the allowlist" "allowlist_modified"
  scen8; git -C "$R8" mv "$AL_FILE" .a1/moved.json; c8 "rename allowlist"
  plan8; expect8 "R30d3 feature commit renaming the allowlist" "allowlist_modified"
  scen8
  L_AK2="id: $FAKE_AK2"; plant8 g.sh "$L_AK2"; c8 "unlisted fake"
  printf '%s' "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")"),$(al_ent g.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK2")")")" > "$R8/$AL_FILE"
  local wt_sha; wt_sha="$(sha256_of "$R8/$AL_FILE")"; store8 "$(blobsha8)" "$wt_sha"
  plan8; expect8 "R30d4 uncommitted allowlist edit in the worktree is never read" "secret_in_snapshot"
  # arm 5: the anchor's last allowlist commit also touched another file
  new8
  L_AK1="id: $FAKE_AK1"; plant8 f.sh "$L_AK1"
  printf '%s' "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")")")" > "$R8/$AL_FILE"
  plant8 notes.md "unrelated"; c8 "allowlist plus another file"
  printf '// later\n' >> "$R8/src/add.js"; c8 "later on main"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; expect8 "R30d5 anchor's allowlist commit touched another path" "allowlist_invalid/allowlist_not_separate_commit"
}

# ---------- R30e: scope ----------
# Mutations: apply the allowlist in the output filter (e1); consult the
# allowlist before honouring the gitleaks exit (e2); drop the self-path check (e3).
caseR30e() {
  scen8
  FAKE_RUNNER_REPLY="the reviewer quotes $L_AK1" plan8
  # the output filter runs in `run` (reply.txt) and in `normalize`; either step may report it
  assert_json "R30e1 reply.txt quoting an allowlisted fake → secret_in_output, exit 1" "$G_OUT" "j.reason + '/' + j.verdict + '/' + String($G_RC)" "secret_in_output/fail/1"
  [[ -f "$ARGV8_FILE" ]] && ok "R30e1 the snapshot passed and the runner ran (the allowlist let the scan through)" || bad "R30e1 the runner never ran — the arm did not reach the output filter"
  scen8
  FAKE_GITLEAKS_EXIT=1 plan8
  assert_json "R30e2 gitleaks exit 1 while every pattern hit is allowlisted → secret_in_snapshot (gitleaks)" "$G_OUT" "j.step + ':' + j.reason + '/' + j.reason_detail" "snapshot:secret_in_snapshot/gitleaks"
  never_ran8 "R30e2"
  schema8 "R30e3 entry whose path is the allowlist file" "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "id: $FAKE_AK1")"),$(al_ent "$AL_FILE" aws_access_key_id 1 fixture_fake "$(fp8 "id: $FAKE_AK1")")")"
}

# ---------- R30f: stale entries warn ----------
# Mutations: drop the stale listing (f1); fail on stale entries (f1 turns red).
caseR30f() {
  new8
  L_AK1="id: $FAKE_AK1"; L_AK2="id: $FAKE_AK2"; L_AK3="id: $FAKE_AK3"
  plant8 f.sh "$L_AK1"; plant8 g.sh "$L_AK2"; plant8 h.sh "clean"; c8 "fakes"
  al_commit8 "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")"),$(al_ent g.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK2")"),$(al_ent h.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK3")")")"
  push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; git -C "$R8" rm -q g.sh; c8 "delete g.sh"
  plan8; pass8 "R30f1 an entry for a deleted path and an entry with 0 matches pass"
  assert_json "R30f1 result lists both under allowlist_stale" "$G_OUT" "j.allowlist_stale.map((s) => s.path + ':' + s.pattern).sort().join(',')" "g.sh:aws_access_key_id,h.sh:aws_access_key_id"
  grep -q "allowlist_stale" "$P8DIR/XREVIEW.md" && grep -q "g.sh" "$P8DIR/XREVIEW.md" && grep -q "h.sh" "$P8DIR/XREVIEW.md" \
    && ok "R30f1 XREVIEW.md lists both stale entries" || bad "R30f1 XREVIEW.md lacks the stale entries"
  plant8 g.sh "id: $FAKE_AK3"; c8 "new file at the deleted path"
  plan8; expect8 "R30f2 a new file at the deleted path with a different matching line" "secret_in_snapshot"
}

# ---------- R30g: no silent pass ----------
# Mutations: omit allowlisted pairs from XREVIEW.md on fail (g2); write the
# matched text into the report (g1); leave allowlist_anchor null (g1).
caseR30g() {
  new8
  L_AK1="id: $FAKE_AK1"; L_AK2="id: $FAKE_AK2"; L_AK3="id: $FAKE_AK3"; L_XO="chan: $FAKE_XOXB"
  plant8 f.sh "$L_AK1" "$L_AK2"; plant8 s.sh "$L_XO"; c8 "fakes"
  al_commit8 "$(al_doc "$(al_ent f.sh aws_access_key_id 2 fixture_fake "$(fp8 "$L_AK1"),$(fp8 "$L_AK2")"),$(al_ent s.sh slack_token 1 doc_example "$(fp8 "$L_XO")")")"
  push8; store8 "$(blobsha8)"; local anchor; anchor="$(head8 origin/main)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; expect8 "R30g0 control: the slack line also matches slack_token_family, which no entry covers" "secret_in_snapshot"
  git -C "$R8" checkout -q main
  al_commit8 "$(al_doc "$(al_ent f.sh aws_access_key_id 2 fixture_fake "$(fp8 "$L_AK1"),$(fp8 "$L_AK2")"),$(al_ent g.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK3")")")"
  git -C "$R8" rm -q s.sh; plant8 g.sh "$L_AK3"; c8 "g.sh instead of s.sh"; push8; store8 "$(blobsha8)"; anchor="$(head8 origin/main)"
  git -C "$R8" checkout -q -B feat; git -C "$R8" reset -q --hard origin/main; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; pass8 "R30g1 two allowlisted pairs with 3 matches"
  assert_json "R30g1 gate result: allowlisted_hits 3, allowlist_anchor = the anchor sha" "$G_OUT" "j.allowlisted_hits + '/' + j.allowlist_anchor" "3/$anchor"
  assert_json "R30g1 index.json entry carries allowlisted_hits and allowlist_anchor" "$(cat "$P8DIR/xreview/index.json")" "j[j.length - 1].allowlisted_hits + '/' + j[j.length - 1].allowlist_anchor" "3/$anchor"
  local x="$P8DIR/XREVIEW.md"
  grep -q "Allowlisted snapshot hits" "$x" && grep -q "f.sh · aws_access_key_id · count 2 · fixture_fake" "$x" && grep -q "g.sh · aws_access_key_id · count 1 · fixture_fake" "$x" \
    && ok "R30g1 XREVIEW.md lists every allowlisted pair with count and class" || bad "R30g1 XREVIEW.md listing incomplete"
  local leak=0 t; for t in "$FAKE_AK1" "$FAKE_AK2" "$FAKE_AK3" "$(fp8 "$L_AK1")" "$(fp8 "$L_AK3")"; do grep -qF "$t" "$x" && leak=1; done
  [[ $leak -eq 0 ]] && ok "R30g1 XREVIEW.md holds neither matched text nor fingerprint" || bad "R30g1 XREVIEW.md leaks matched text or a fingerprint"
  plant8 u.sh "id: $FAKE_AK4"; c8 "uncovered"
  plan8; expect8 "R30g2 one uncovered pair plus the allowlisted ones" "secret_in_snapshot"
  assert_json "R30g2 result names the uncovered pair" "$G_OUT" "j.uncovered.map((u) => u.path + ':' + u.pattern).join(',')" "u.sh:aws_access_key_id"
  local sec; sec="$(awk '/Allowlisted snapshot hits/{s=""} {s=s $0 "\n"} END{printf "%s", s}' "$x")"
  [[ "$sec" == *"f.sh · aws_access_key_id · count 2"* && "$sec" == *"uncovered: u.sh · aws_access_key_id"* ]] \
    && ok "R30g2 the failing run's XREVIEW section lists the allowlisted pairs and names the uncovered one" || bad "R30g2 failing XREVIEW section incomplete"
}

# ---------- R30h: cap, owner, propose ----------
# Mutations: skip the owner comparison (h1–h3); drop the cap comparison (h4);
# print the full matched text in propose (h6).
caseR30h() {
  local fp; fp="$(fp8 "id: $FAKE_AK1")"
  schema_owner8() { # <name> <doc>
    scen8; git -C "$R8" checkout -q main; al_commit8 "$2"; push8; store8 "$(blobsha8)"
    git -C "$R8" checkout -q -b feat2; printf '// f2\n' >> "$R8/src/add.js"; c8 "feature 2"
    plan8; expect8 "$1" "allowlist_invalid/allowlist_owner_mismatch"
  }
  schema_owner8 "R30h1 owner mallory, decided_by robert" "$(al_doc "$(REVIEWER8=mallory al_ent f.sh aws_access_key_id 1 fixture_fake "$fp")" mallory)"
  schema_owner8 "R30h2 one reviewed_by ≠ owner" "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$fp"),$(REVIEWER8=mallory al_ent g.sh aws_access_key_id 1 fixture_fake "$fp")")"
  scen8
  node -e 'const fs = require("fs"); const f = process.argv[1]; const r = JSON.parse(fs.readFileSync(f, "utf8")); r.decided_by = "alice"; fs.writeFileSync(f, JSON.stringify(r, null, 2) + "\n");' "$R8/.a1/xprov.json"
  write_permit_store "$R8" alice record/2026-09-28-fixture.md # spec 014: the owner's entry follows the file, so this arm still isolates the anchor owner check
  plan8; expect8 "R30h3 decided_by at the anchor (robert) ≠ working tree (alice)" "allowlist_invalid/allowlist_owner_mismatch"
  # h4: 33 entries, written with the literal 33 (never computed from ALLOWLIST_MAX_ENTRIES)
  local many="" i; for i in $(seq 1 33); do many="$many$(al_ent "p$i.sh" aws_access_key_id 1 fixture_fake "$fp"),"; done
  schema8 "R30h4 33 entries" "$(al_doc "${many%,}")"
  assert_json "R30h5 ALLOWLIST_MAX_ENTRIES is the literal 32" "$(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).ALLOWLIST_MAX_ENTRIES))' "$TREE/_shared/lib/xprov.cjs")" "j" "32"
  # h6: propose — path:line:column, masked excerpt, high_confidence, no file, never the full text
  new8
  plant8 f.sh "# fixture" "id: $FAKE_AK1"; c8 "fake"
  local before; before="$(git -C "$R8" status --porcelain --untracked-files=all)"
  local out err; out="$(cd "$R8" && node "$TREE_TOOLS" xprov allowlist propose --commit HEAD 2>"$TMP08/prop-err.txt")"; local rc=$?
  err="$(cat "$TMP08/prop-err.txt")"
  assert_rc "R30h6 propose exits 0" 0 "$rc" "$err"
  assert_json "R30h6 propose lists f.sh:2:5 aws_access_key_id, excerpt = first 4 chars + length, high_confidence true" "$out" \
    "j.matches.map((m) => [m.location, m.pattern, m.excerpt, m.high_confidence].join(' ')).join('|')" "f.sh:2:5 aws_access_key_id AKIA… (20 chars) true"
  [[ "$out$err" != *"$FAKE_AK1"* ]] && ok "R30h6 propose never prints the full matched text" || bad "R30h6 propose printed the full matched text"
  local jd; jd="$(cd "$R8" && node "$TREE_TOOLS" xprov allowlist propose --commit HEAD --json 2>/dev/null)"
  assert_json "R30h6 propose --json: draft with empty reasons and the fixture's line fingerprint" "$jd" "[j.version, j.entries.length, JSON.stringify(j.entries[0].reason), j.entries[0].fingerprints[0], j.entries[0].max_count].join('/')" "1/1/\"\"/$(fp8 "id: $FAKE_AK1")/1"
  [[ "$jd" != *"$FAKE_AK1"* ]] && ok "R30h6 propose --json never holds the full matched text" || bad "R30h6 propose --json holds the matched text"
  assert_eq "R30h6 propose writes no file" "$(git -C "$R8" status --porcelain --untracked-files=all)" "$before"
}

# ---------- R30i: an entry covers only the pattern it names ----------
# Mutation: match entries on `path` only, ignoring `pattern`.
caseR30i() {
  new8
  L_XO="chan: $FAKE_XOXB"; plant8 f.sh "$L_XO"; c8 "fake"
  al_commit8 "$(al_doc "$(al_ent f.sh slack_token 1 fixture_fake "$(fp8 "$L_XO")")")"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; expect8 "R30i (f.sh, slack_token) listed; slack_token_family also matches" "secret_in_snapshot"
  assert_json "R30i the failure names slack_token_family" "$G_OUT" "j.uncovered.map((u) => u.pattern).join(',')" "slack_token_family"
}

# ---------- R30j: the approval store ----------
# Mutations: skip the approval lookup (j1, j2); skip the store mode check (j3);
# stat instead of lstat (j4, j5); skip the directory mode check (j6); ignore
# --revoke (j7b); leave allowlist_approved_blob null (j7a).
caseR30j() {
  scen8; rm -f "$HOME/.a1-xprov/$STORE_NAME"
  plan8; expect8 "R30j1 no approval for the anchor blob" "allowlist_invalid/allowlist_unapproved"
  scen8; local old; old="$(blobsha8)"
  git -C "$R8" checkout -q main
  al_commit8 "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")"),$(al_ent g.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")")")"; push8
  store8 "$old"
  git -C "$R8" checkout -q -b feat2; printf '// f2\n' >> "$R8/src/add.js"; c8 "feature 2"
  plan8; expect8 "R30j2 approved blob plus one more entry (a new blob)" "allowlist_invalid/allowlist_unapproved"
  scen8; chmod 644 "$HOME/.a1-xprov/$STORE_NAME"
  plan8; expect8 "R30j3 store with mode 0644" "allowlist_invalid/allowlist_unapproved"
  scen8; mv "$HOME/.a1-xprov/$STORE_NAME" "$A8/real-store.json"; ln -s "$A8/real-store.json" "$HOME/.a1-xprov/$STORE_NAME"
  plan8; expect8 "R30j4 store that is a symlink to a valid store" "allowlist_invalid/allowlist_unapproved"
  scen8; mv "$HOME/.a1-xprov" "$A8/real-xprov"; ln -s "$A8/real-xprov" "$HOME/.a1-xprov"
  plan8; expect_permit8 "R30j5 ~/.a1-xprov that is a symlink"; reader_refuses8 "R30j5"
  scen8; chmod 755 "$HOME/.a1-xprov"
  plan8; expect_permit8 "R30j6 ~/.a1-xprov with mode 0755"; reader_refuses8 "R30j6"
  # j7a: two approved shas; the pass names the one it used
  scen8; local used; used="$(blobsha8)"; local other="0000000000000000000000000000000000000000000000000000000000000001"
  store8 "$other" "$used"
  plan8; pass8 "R30j7a two approved shas"
  assert_json "R30j7a allowlist_approved_blob names the sha used" "$G_OUT" "j.allowlist_approved_blob" "$used"
  # j7b: approve --revoke of the used sha → unapproved (positive approve arm: needs a non-Claude process tree)
  if claude_ancestor8; then skip8 "R30j7b approve --revoke of the used sha"; else
    PTY_TYPED="" pty8 node "$TREE_TOOLS" xprov allowlist approve --repo "$R8" --revoke "$used"; local rc=$?
    assert_rc "R30j7b approve --revoke exits 0" 0 "$rc"
    assert_json "R30j7b the revoked sha is gone, the other stays" "$(cat "$HOME/.a1-xprov/$STORE_NAME")" "Object.values(j.repos)[0].join(',')" "$other"
    plan8; expect8 "R30j7b after the revoke the anchor blob is unapproved" "allowlist_invalid/allowlist_unapproved"
  fi
}

# ---------- R30j2: the approve guards ----------
# Mutations: drop the TTY check (1); drop the env check (2); drop the ancestry
# walk start-name arm (3); drop the claude/versions/ resolved-path check (4);
# drop the argv check (5); drop either string from the hook (6a/6b); accept any
# count (8). The positive arm (7) proves the write goes through a temp file and
# rename: the store's inode changes and a pre-existing repo key survives.

# claude_ancestor8 — true when this suite runs under Claude Code.
claude_ancestor8() {
  [[ -n "${CLAUDECODE:-}" || -n "${CLAUDE_PID:-}" ]] && return 0
  local p=$$ c
  while [[ -n "$p" && "$p" -gt 1 ]]; do
    c="$(ps -o comm= -p "$p" 2>/dev/null)"
    [[ "$(basename -- "${c:-x}")" == claude ]] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
  done
  return 1
}
skip8() {
  if [[ "${CI:-}" == "true" ]]; then bad "$1: SKIP (claude-code ancestor) is not allowed when CI=true"
  else results+=("SKIP (claude-code ancestor)  $1"); fi
}

# NOCLAUDE8 — `env` argv that unsets every CLAUDECODE / CLAUDE_PID / CLAUDE_CODE_*
# variable (an argv, not a function, so it also works as a `script` command).
NOCLAUDE8=(env)
for v8 in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$'); do NOCLAUDE8+=(-u "$v8"); done

# pty8 cmd… — cmd under a pseudo-TTY; $PTY_TYPED is typed after a delay.
pty8() {
  local cmd; cmd="$(printf '%q ' "$@")"
  if [[ "$(uname)" == Darwin ]]; then
    ( sleep 1; [[ -n "${PTY_TYPED:-}" ]] && printf '%s\n' "$PTY_TYPED"; sleep 2 ) | script -q /dev/null "$@" > "$TMP08/pty-out.txt" 2>&1
  else
    ( sleep 1; [[ -n "${PTY_TYPED:-}" ]] && printf '%s\n' "$PTY_TYPED"; sleep 2 ) | script -qec "$cmd" /dev/null > "$TMP08/pty-out.txt" 2>&1
  fi
}

# fakeparent8 <path> — a shell copy that keeps its own name and path
# (measured: macOS needs bash re-signed ad hoc; Linux copies /bin/sh).
fakeparent8() {
  mkdir -p "$(dirname "$1")"
  if [[ "$(uname)" == Darwin ]]; then cp /bin/bash "$1" && codesign -s - -f "$1" >/dev/null 2>&1
  else cp /bin/sh "$1"; fi
  chmod +x "$1"
}
# said8 <name> <file> <text> — the refusal names its reason (rc 2 alone is also the usage exit).
said8() { grep -qF -- "$3" "$2" && ok "$1: output says '$3'" || bad "$1: output lacks '$3': $(tr -d '\r' < "$2" | tail -n 2)"; }
store_absent8() { [[ ! -e "$HOME/.a1-xprov/$STORE_NAME" ]] && ok "$1: no store written" || bad "$1: a store was written"; }

caseR30j2() {
  local tools="$TREE_TOOLS" rc
  # 1: stdin not a TTY (correct count piped in; no CLAUDE* variables)
  scen8; rm -f "$HOME/.a1-xprov/$STORE_NAME"
  printf '1\n' | "${NOCLAUDE8[@]}" node "$tools" xprov allowlist approve --repo "$R8" > "$TMP08/j2.out" 2>&1; rc=$?
  assert_rc "R30j2-1 stdin not a TTY → exit 2" 2 "$rc"; store_absent8 "R30j2-1"
  said8 "R30j2-1" "$TMP08/j2.out" "must both be a terminal"
  # 2: under script with CLAUDECODE=1
  scen8; rm -f "$HOME/.a1-xprov/$STORE_NAME"
  PTY_TYPED=1 pty8 env CLAUDECODE=1 node "$tools" xprov allowlist approve --repo "$R8"; rc=$?
  assert_rc "R30j2-2 CLAUDECODE=1 under a pseudo-TTY → exit 2" 2 "$rc"; store_absent8 "R30j2-2"
  said8 "R30j2-2" "$TMP08/pty-out.txt" "CLAUDECODE"
  # 3: fake parent: a shell copy named `claude`, all CLAUDE* unset
  scen8; rm -f "$HOME/.a1-xprov/$STORE_NAME"
  local fp3="$A8/bin/claude"; fakeparent8 "$fp3"
  PTY_TYPED=1 pty8 "${NOCLAUDE8[@]}" "$fp3" -c 'node "$0" xprov allowlist approve --repo "$1"; exit $?' "$tools" "$R8"; rc=$?
  assert_rc "R30j2-3 launched from a parent whose start name is claude → exit 2" 2 "$rc"; store_absent8 "R30j2-3"
  said8 "R30j2-3" "$TMP08/pty-out.txt" "started as claude"
  # 3b: a Claude Desktop-style start name "Claude" (Samuel): compared case-insensitively; the
  # message names the exact start name, so the real (lower-case) Claude Code ancestor above
  # this suite cannot stand in for it
  scen8; rm -f "$HOME/.a1-xprov/$STORE_NAME"
  local fp3b="$A8/binC/Claude"; fakeparent8 "$fp3b"
  PTY_TYPED=1 pty8 "${NOCLAUDE8[@]}" "$fp3b" -c 'node "$0" xprov allowlist approve --repo "$1"; exit $?' "$tools" "$R8"; rc=$?
  assert_rc "R30j2-3b launched from a parent whose start name is Claude → exit 2" 2 "$rc"; store_absent8 "R30j2-3b"
  said8 "R30j2-3b" "$TMP08/pty-out.txt" "started as Claude"
  # 4: fake parent at <tmp>/claude/versions/9.9.9, launched through a symlink with another name
  scen8; rm -f "$HOME/.a1-xprov/$STORE_NAME"
  local fp4="$A8/share/claude/versions/9.9.9"; fakeparent8 "$fp4"; ln -s "$fp4" "$A8/runner-shell"
  PTY_TYPED=1 pty8 "${NOCLAUDE8[@]}" "$A8/runner-shell" -c 'node "$0" xprov allowlist approve --repo "$1"; exit $?' "$tools" "$R8"; rc=$?
  assert_rc "R30j2-4 parent executable under claude/versions/ (started through another name) → exit 2" 2 "$rc"; store_absent8 "R30j2-4"
  said8 "R30j2-4" "$TMP08/pty-out.txt" "claude/versions/"
  # 5: fake parent whose argv holds the npm package path
  scen8; rm -f "$HOME/.a1-xprov/$STORE_NAME"
  local npm="$A8/node_modules/@anthropic-ai/claude-code/cli.js"; mkdir -p "$(dirname "$npm")"; : > "$npm"
  PTY_TYPED=1 pty8 "${NOCLAUDE8[@]}" /bin/sh -c 'node "$1" xprov allowlist approve --repo "$2"; exit $?' "$npm" "$tools" "$R8"; rc=$?
  assert_rc "R30j2-5 parent argv holds @anthropic-ai/claude-code → exit 2" 2 "$rc"; store_absent8 "R30j2-5"
  said8 "R30j2-5" "$TMP08/pty-out.txt" "@anthropic-ai/claude-code"
  # 6: the project's PreToolUse hook
  local hook="$REPO_ROOT/.claude/hooks/xprov-deny-allowlist-approve.sh" h
  local p1 p2 p3
  p1='{"tool_name":"Bash","tool_input":{"command":"node _shared/a1-tools.cjs xprov allowlist approve --repo ."}}'
  p2='{"tool_name":"Bash","tool_input":{"command":"cat ~/.a1-xprov/allowlist-approvals.json"}}'
  p3='{"tool_name":"Bash","tool_input":{"command":"git status"}}'
  h="$(printf '%s' "$p1" | bash "$hook" 2>/dev/null)"
  assert_json "R30j2-6a hook denies a Bash command containing 'allowlist approve'" "$h" "j.hookSpecificOutput.permissionDecision" "deny"
  h="$(printf '%s' "$p2" | bash "$hook" 2>/dev/null)"
  assert_json "R30j2-6b hook denies a Bash command containing 'allowlist-approvals'" "$h" "j.hookSpecificOutput.permissionDecision" "deny"
  h="$(printf '%s' "$p3" | bash "$hook" 2>/dev/null)"; rc=$?
  [[ "$rc" -eq 0 && "$h" != *deny* ]] && ok "R30j2-6c hook lets an unrelated Bash command through" || bad "R30j2-6c hook denied git status (rc $rc)"
  local p hv; local -a hook_payloads=(
    'allowlist \\\napprove --repo .'
    'allowlist  approve --repo .'
    'allowlist\tapprove --repo .'
    'allowlist \"approve\" --repo .'
    "allowlist 'approve' --repo ."
    'cat allowlist-approval.json')
  for p in "${hook_payloads[@]}"; do
    hv="$(printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$p" | bash "$hook" 2>/dev/null)"
    assert_json "R30j2-6e hook denies the obfuscated command ${p}" "$hv" "j.hookSpecificOutput.permissionDecision" "deny"
  done
  assert_json "R30j2-6d .claude/settings.json wires the hook as a Bash PreToolUse hook and denies Edit/Write on both paths" "$(cat "$REPO_ROOT/.claude/settings.json")" \
    "[j.hooks.PreToolUse.some((m) => m.matcher === 'Bash' && m.hooks.some((h) => /xprov-deny-allowlist-approve\.sh/.test(h.command))), ['Edit', 'Write'].every((t) => ['xprov-secret-allowlist.json', 'allowlist-approvals.json', '.a1/xprov.json'].every((f) => j.permissions.deny.some((r) => r.startsWith(t + '(') && r.includes(f))))].join('/')" "true/true"
  # 8: wrong typed count
  scen8; rm -f "$HOME/.a1-xprov/$STORE_NAME"
  PTY_TYPED=2 pty8 "${NOCLAUDE8[@]}" node "$tools" xprov allowlist approve --repo "$R8"; rc=$?
  assert_rc "R30j2-8 wrong typed count → exit 2" 2 "$rc"; store_absent8 "R30j2-8"
  if claude_ancestor8; then said8 "R30j2-8 (refused earlier under Claude Code)" "$TMP08/pty-out.txt" "Nothing written"
  else said8 "R30j2-8" "$TMP08/pty-out.txt" "expected 1; nothing written"; fi
  # 7: positive arm — correct count, temp file + rename, 0600
  if claude_ancestor8; then skip8 "R30j2-7 approve with the correct typed count writes the store 0600 via temp file + rename"; else
    scen8; local want; want="$(blobsha8)"
    node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ version: 1, repos: { "/elsewhere/.git": ["a".repeat(64)] } }) + "\n")' "$HOME/.a1-xprov/$STORE_NAME"
    chmod 600 "$HOME/.a1-xprov/$STORE_NAME"
    local ino_before; ino_before="$(python3 -c 'import os,sys; print(os.stat(sys.argv[1]).st_ino)' "$HOME/.a1-xprov/$STORE_NAME")"
    PTY_TYPED=1 pty8 "${NOCLAUDE8[@]}" node "$tools" xprov allowlist approve --repo "$R8"; rc=$?
    assert_rc "R30j2-7 correct typed count → exit 0" 0 "$rc" "$(tail -n 3 "$TMP08/pty-out.txt")"
    assert_eq "R30j2-7 store mode 0600" "$(mode_of "$HOME/.a1-xprov/$STORE_NAME")" "600"
    assert_json "R30j2-7 store approves the origin/main blob and keeps the other repository" "$(cat "$HOME/.a1-xprov/$STORE_NAME")" "[j.repos['/elsewhere/.git'].join(','), (j.repos['$(storekey8)'] || []).join(',')].join('/')" "$(printf 'a%.0s' $(seq 1 64))/$want"
    local ino_after; ino_after="$(python3 -c 'import os,sys; print(os.stat(sys.argv[1]).st_ino)' "$HOME/.a1-xprov/$STORE_NAME")"
    [[ "$ino_before" != "$ino_after" ]] && ok "R30j2-7 the store was replaced by rename (new inode)" || bad "R30j2-7 the store was rewritten in place (same inode)"
    assert_eq "R30j2-7 no temp file left in ~/.a1-xprov" "$(ls -A "$HOME/.a1-xprov" | grep -v -e "^$STORE_NAME\$" -e '^snapshots$' -e '^artifacts$' -e '^scan-records$' | wc -l | tr -d ' ')" "0"
    plan8; pass8 "R30j2-7 the gate passes with the approval approve wrote"
  fi
  # 9 (S-m5): an existing store that is not valid is never replaced silently
  if claude_ancestor8; then skip8 "R30j2-9 approve refuses an invalid existing store (exit 1, reason on stderr)"; else
    scen8; chmod 644 "$HOME/.a1-xprov/$STORE_NAME"; local before9; before9="$(cat "$HOME/.a1-xprov/$STORE_NAME")"
    PTY_TYPED=1 pty8 "${NOCLAUDE8[@]}" node "$tools" xprov allowlist approve --repo "$R8"; rc=$?
    assert_rc "R30j2-9 invalid existing store (0644) → exit 1" 1 "$rc" "$(tail -n 3 "$TMP08/pty-out.txt")"
    said8 "R30j2-9" "$TMP08/pty-out.txt" "not a 0600 regular file"
    assert_eq "R30j2-9 the store is unchanged (content and mode 644)" "$(cat "$HOME/.a1-xprov/$STORE_NAME")/$(mode_of "$HOME/.a1-xprov/$STORE_NAME")" "$before9/644"
  fi
  # 10 (R-M4): a git failure inside approve is a one-line [a1-tools] error, exit 1, no stack trace
  if claude_ancestor8; then skip8 "R30j2-10 approve reports an internal failure as [a1-tools] exit 1"; else
    new8; mkdir -p "$R8/$AL_FILE"; printf 'x\n' > "$R8/$AL_FILE/inner"; c8 "allowlist path is a directory"; push8
    PTY_TYPED=1 pty8 "${NOCLAUDE8[@]}" node "$tools" xprov allowlist approve --repo "$R8"; rc=$?
    assert_rc "R30j2-10 blob read failure → exit 1" 1 "$rc" "$(tail -n 3 "$TMP08/pty-out.txt")"
    said8 "R30j2-10" "$TMP08/pty-out.txt" "[a1-tools] xprov allowlist approve"
    grep -qE '^[[:space:]]+at .*\(.*:[0-9]+:[0-9]+\)' "$TMP08/pty-out.txt" && bad "R30j2-10 a stack trace was printed" || ok "R30j2-10 no stack trace"
    store_absent8 "R30j2-10"
  fi
  # 11: approve warns (does not block) when the gate would reject the blob anyway
  if claude_ancestor8; then skip8 "R30j2-11 approve warns about an owner mismatch"; else
    new8; plant8 f.sh "id: $FAKE_AK1"; c8 "fake"
    al_commit8 "$(al_doc "$(REVIEWER8=mallory al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "id: $FAKE_AK1")")" mallory)"; push8
    PTY_TYPED=1 pty8 "${NOCLAUDE8[@]}" node "$tools" xprov allowlist approve --repo "$R8"; rc=$?
    assert_rc "R30j2-11 owner mismatch → approve still exits 0" 0 "$rc" "$(tail -n 3 "$TMP08/pty-out.txt")"
    said8 "R30j2-11" "$TMP08/pty-out.txt" "warning: owner"
  fi
}

# ---------- regression: no allowlist → the scan behaves as before ----------
# Mutation: failing (or allowlisting) when the anchor holds no allowlist file.
caseR30reg() {
  new8
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; pass8 "R30reg a clean repo with an origin and no allowlist passes"
  assert_json "R30reg allowlisted_hits 0, allowlist_anchor null, allowlist_approved_blob null, stale []" "$G_OUT" "[j.allowlisted_hits, String(j.allowlist_anchor), String(j.allowlist_approved_blob), j.allowlist_stale.length].join('/')" "0/null/null/0"
  plant8 f.sh "id: $FAKE_AK1"; c8 "fake without allowlist"
  plan8; expect8 "R30reg a fake without any allowlist" "secret_in_snapshot"
  assert_json "R30reg secret_pattern / uncovered name the pair" "$G_OUT" "j.uncovered.map((u) => u.path + ':' + u.pattern).join(',')" "f.sh:aws_access_key_id"
}


# ---------- review fixes (Samuel S-m1/S-m2/S-m3/S-m7, Reinhard R-M1, NITs) ----------

# fpctx8 <line> <match-index> <match-length> — spec (c) fingerprint for a line
# longer than 4096 characters: match plus 256 characters on each side, clipped.
fpctx8() { node -e '
  const [l, i, n] = [process.argv[1], Number(process.argv[2]), Number(process.argv[3])];
  const t = l.length <= 4096 ? l : l.slice(Math.max(0, i - 256), Math.min(l.length, i + n + 256));
  process.stdout.write(require("crypto").createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex"));' "$1" "$2" "$3"; }

# R30c4 (S-m1): line > 4096 chars, allowlisted pem_begin; an edit within 256
# characters after the match changes the fingerprint.
# Mutation: LINE_CONTEXT_CHARS 256 → 0 (R30c4a turns red).
# R30c5 (S-m7): line > 4096 chars in a > 5 MB file whose match crosses the end of
# the first window buffer; the context uses the TRUE match length.
# Mutation: fingerprint with the window-truncated match length (R30c5 turns red).
# R30c3c (R-M1): a url_credentials match starting at W-3 is also seen by the
# second window as a match starting at W (`ps://…`); it counts once.
# Mutation: drop the overlapping-hit merge (R30c3c turns red).
caseR30c4() {
  new8
  local xs ys; xs="$(printf 'x%.0s' $(seq 1 4200))"; ys="$(printf 'y%.0s' $(seq 1 300))"
  local LL="${xs}${D5}BEGIN${ys}"
  plant8 long.txt "$LL"; c8 "long line"
  al_commit8 "$(al_doc "$(al_ent long.txt pem_begin 1 code_pattern "$(fpctx8 "$LL" 4200 10)")")"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; pass8 "R30c4a long line: fingerprint = match + 256 characters each side"
  local yz; yz="$(printf 'y%.0s' $(seq 1 100))z$(printf 'y%.0s' $(seq 1 199))"
  plant8 long.txt "${xs}${D5}BEGIN${yz}"; c8 "edit 101 chars after the match"
  plan8; expect8 "R30c4b long line edited within 256 characters after the match" "secret_in_snapshot"

  local W=5242880
  new8
  local ps ks qs; ps="$(printf 'p%.0s' $(seq 1 1900))"; ks="$(printf 'K%.0s' $(seq 1 997))"; qs="$(printf 'q%.0s' $(seq 1 2000))"
  local L5="${ps}${SKP}-${ks} ${qs}"     # key of 1000 chars at W-100 (space ends it), crosses W+512
  big8 big5.txt $((W - 2000)) "$L5"; c8 "big5"
  local f5; f5="$(fpctx8 "$L5" 1900 1000)"
  al_commit8 "$(al_doc "$(al_ent big5.txt sk_prefixed_key 1 fixture_fake "$f5"),$(al_ent big5.txt sk_prefixed_key_ext 1 fixture_fake "$f5")")"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; pass8 "R30c5 window-truncated match on a long line uses its true length for the context"

  new8
  local SCH="https:" SL="//"; local LU="${SCH}${SL}fixture:pw123456@host.example"
  big8 big3.txt $((W - 3)) "$LU"; c8 "url at W-3"
  al_commit8 "$(al_doc "$(al_ent big3.txt url_credentials 1 fixture_fake "$(fp8 "$LU")")")"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat; printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  plan8; pass8 "R30c3c a match straddling the window start counts once (max_count 1)"
  assert_json "R30c3c allowlisted_hits 1" "$G_OUT" "j.allowlisted_hits" "1"
}

# R30j8 (S-m2): the store approves the blob only under ANOTHER repository key.
# Mutation: look the sha up across all repositories.
caseR30j8() {
  scen8; local sha; sha="$(blobsha8)"
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ version: 1, repos: { "/some/other/repo/.git": [process.argv[2]] } }) + "\n")' "$HOME/.a1-xprov/$STORE_NAME" "$sha"
  chmod 600 "$HOME/.a1-xprov/$STORE_NAME"
  plan8; expect8 "R30j8 blob approved only for another repository" "allowlist_invalid/allowlist_unapproved"
}

# R30b3-6 (S-m3): ls-remote over a fake ssh transport that serves the bare
# origin ONLY when called with `-o BatchMode=yes` and GIT_TERMINAL_PROMPT=0,
# and hangs otherwise. Mutations: drop BatchMode from GIT_SSH_COMMAND; drop
# GIT_TERMINAL_PROMPT=0 (each turns the pass into a 30 s unresolved fail).
caseR30b3ssh() {
  scen8
  local bin="$A8/sshserve"; mkdir -p "$bin"
  cat > "$bin/ssh" <<'SSH'
#!/bin/sh
[ "$1" = "-G" ] && exit 0
batch=0; last=""
for a in "$@"; do [ "$a" = "BatchMode=yes" ] && batch=1; last="$a"; done
if [ "$batch" = 1 ] && [ "${GIT_TERMINAL_PROMPT:-}" = "0" ]; then exec sh -c "$last"; fi
sleep 60
SSH
  chmod +x "$bin/ssh"
  git -C "$R8" remote set-url origin "ssh://fixture.invalid$O8"
  PATH="$bin:$PATH" plan8; pass8 "R30b3-6 ls-remote runs non-interactively (BatchMode=yes, GIT_TERMINAL_PROMPT=0)"
}

# R30h7: HIGH_CONFIDENCE_PATTERNS names only existing SECRET_PATTERNS.
# R30h8: an unparsable .a1/xprov.json at the anchor has its own detail, not owner_mismatch.
# Mutation (h8): read an unparsable permit record as "no decided_by".
caseR30h78() {
  assert_json "R30h7 every HIGH_CONFIDENCE_PATTERNS name is a SECRET_PATTERNS name" \
    "$(node -e 'const x = require(process.argv[1]); const n = new Set(x.SECRET_PATTERNS.map((p) => p.name)); process.stdout.write(JSON.stringify(x.HIGH_CONFIDENCE_PATTERNS.filter((h) => !n.has(h))))' "$TREE/_shared/lib/xprov.cjs")" "j.length" "0"
  new8
  L_AK1="id: $FAKE_AK1"; plant8 f.sh "$L_AK1"; printf '{broken\n' > "$R8/.a1/xprov.json"; c8 "fake, broken permit record"
  al_commit8 "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$L_AK1")")")"; push8; store8 "$(blobsha8)"
  git -C "$R8" checkout -q -b feat
  write_permit "$R8" robert record/2026-09-28-fixture.md; c8 "valid permit record"
  plan8; expect8 "R30h8 unparsable .a1/xprov.json at the anchor" "allowlist_invalid"
  assert_json "R30h8 the detail names the unreadable permit record, not owner_mismatch" "$G_OUT" "/xprov\.json at the anchor is not valid JSON/.test(j.reason_detail) && j.reason_detail !== 'allowlist_owner_mismatch'" "true"
}


# ---------- R-M5: normalize writes the allowlist fields; one index write per gate call ----------
# R30m1 mutation: the gate re-adds a second read-modify-write of index.json
# (the removed annotateIndexEntry). R30m2 mutation: normalize writes the three
# keys although no flag was given. R30m3 mutation: accept any value.
NORM_KEYS_PRE_6B="gate,wave,lane,round,verdict,reason,plan_sha256,result_path,ts,model_requested,model_observed,cli_version"  # measured 2026-09-28 at 297090d
caseR30m() {
  scen8
  local wl="$A8/index-writes.log"; : > "$wl"
  NODE_OPTIONS="--require $FAKE/count-index-writes.cjs" XPROV_INDEX_WRITES_LOG="$wl" plan8
  pass8 "R30m1 gate with an applied allowlist"
  assert_eq "R30m1 index.json is written exactly once per gate call (normalize's write)" "$(wc -l < "$wl" | tr -d ' ')" "1"
  assert_json "R30m1 that single entry carries allowlisted_hits, allowlist_anchor, allowlist_approved_blob" "$(cat "$P8DIR/xreview/index.json")" \
    "[j.length, j[0].allowlisted_hits, j[0].allowlist_anchor === '$(head8 origin/main)', j[0].allowlist_approved_blob === '$(blobsha8)'].join('/')" "1/1/true/true"
  # R30m2/m3: normalize directly (no gate), on a copy of the approved case
  make_phase pm8
  local res="$A8/approved.result.json"; cp "$CASES/approved.result.json" "$res"
  local out; out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov normalize "$res" --phase pm8 --gate "$GATE_PLAN" 2>/dev/null)"
  assert_json "R30m2 without the new flags the index entry has exactly the pre-6b keys" "$out" "Object.keys(j.index_entry).join(',')" "$NORM_KEYS_PRE_6B"
  assert_json "R30m2 …and the written entry matches stdout" "$(cat "$PHASE_REPO/.a1/phases/pm8/xreview/index.json")" "Object.keys(j[0]).join(',')" "$NORM_KEYS_PRE_6B"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov normalize "$res" --phase pm8 --gate "$GATE_PLAN" --round 2 --allowlisted-hits 3 --allowlist-anchor "$PHASE_HEAD" --allowlist-approved-blob "$(printf 'b%.0s' $(seq 1 64))" 2>/dev/null)"
  assert_json "R30m3 with the flags the entry ends with the three allowlist fields" "$out" "Object.keys(j.index_entry).slice(-3).join(',') + '/' + j.index_entry.allowlisted_hits + '/' + (j.index_entry.allowlist_anchor === '$PHASE_HEAD')" "allowlisted_hits,allowlist_anchor,allowlist_approved_blob/3/true"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov normalize "$res" --phase pm8 --gate "$GATE_PLAN" --round 3 --allowlisted-hits 0 2>/dev/null)"
  assert_json "R30m3 --allowlisted-hits alone writes null anchor and blob" "$out" "[j.index_entry.allowlisted_hits, String(j.index_entry.allowlist_anchor), String(j.index_entry.allowlist_approved_blob)].join('/')" "0/null/null"
  local bad8 rc
  for bad8 in "--allowlisted-hits -1" "--allowlisted-hits x" "--allowlist-anchor HEAD" "--allowlist-approved-blob abc"; do
    ( cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov normalize "$res" --phase pm8 --gate "$GATE_PLAN" --round 4 $bad8 >/dev/null 2>&1 ); rc=$?
    assert_rc "R30m3 normalize refuses $bad8 (usage, nothing written)" 2 "$rc"
  done
  assert_json "R30m3 the refused calls wrote no entry" "$(cat "$PHASE_REPO/.a1/phases/pm8/xreview/index.json")" "j.length" "3"
}

for c in ${XPROV08_CASES:-caseR30reg caseR30a caseR30b caseR30b2 caseR30b3 caseR30c caseR30c2 caseR30c3 caseR30d caseR30e caseR30f caseR30g caseR30h caseR30i caseR30j caseR30j2 caseR30c4 caseR30j8 caseR30b3ssh caseR30h78 caseR30m}; do "$c"; done
export HOME="$SAVED_HOME_08"; unset A1_XPROV_CODEX_HOME
