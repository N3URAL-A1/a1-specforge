#!/usr/bin/env bash
# Part 33 — `xprov handover-check`: what state a FRESH host would reach for this
# repository, reported before a handover instead of hours later at the merge.
#
# Why this exists (bug 2026-10-28-handover-xprov-owner-store, aiserver, PR #61):
# `.a1/xprov.json` is committed and therefore present in every clone; the owner
# store `~/.a1-xprov/` is host-local and keyed by the realpath of the git-common-dir
# (`xprov-denials.cjs` header, `xprov-common.cjs:331 commonDirOf`), so it can never
# be copied to another host — the key would not match. A clone on a fresh host
# therefore lands in `denial_mismatch` (file says denied, store empty,
# `xprov-permit.cjs:141`), and `xprov-hook-merge.cjs:105-108` lets only `absent`
# and `denied` through, so every merge there is denied with `merge_blocked`.
#
# handover-check answers one question deterministically and WITHOUT ssh: given
# this repository's committed `.a1/xprov.json`, which state does a host with no
# store reach, and what must the owner run there? The target-host prediction is
# pure: it reads the committed file only.
#
#   H1  file `denied` (the real a1-specforge case) → exit 1, target_state
#       denial_mismatch, blocks_merge true, the owner command is printed with
#       --deny and carries the record from the file.
#       Red if the prediction is taken from the LOCAL store instead of the file.
#   H2  file `allowed` → exit 1, target_state permit_mismatch, the command has
#       no --deny but keeps --record (a permit needs the record).
#   H3  no file at all → exit 0, target_state absent, blocks_merge false,
#       no owner command (an unpermitted repo runs Reinhard-only everywhere).
#   H4  invalid file → exit 1, target_state invalid, blocks_merge TRUE. Measured in
#       xprov-hook-merge.cjs (reinhardOnly): only `absent` and `denied` pass, so an
#       unparseable record blocks merges on the target host exactly like a mismatch.
#   H5  the local host is reported next to the target: a Mac with a matching
#       store reads local_state denied while the target still predicts the
#       mismatch — the two fields never collapse into one.
#   H6  `--repo` works from outside the repository, and the predicted command
#       names the TARGET path when `--target-repo` is given (the clone usually
#       sits at another absolute path than the Mac checkout).
#   H7  the command never leaks a secret-shaped record and is a single line
#       (the handover note and tmux must be able to carry it verbatim).
#
# Class 3 of testing.md: the expected state names are written out here, never
# computed by requiring the module under test.

STORE33=""
TMP33=""

prep33() { make_tree; make_phase p33; rm -rf "$HOME/.a1-xprov"; mk_workdir TMP33 h33; STORE33="$HOME/.a1-xprov/permit-denials.json"; }

# file33 <state> <by> <on> [record] — the committed working-tree record.
file33() {
  node -e '
    const fs = require("fs"); const path = require("path");
    const [repo, st, by, on, rec] = process.argv.slice(1);
    const o = { external_review: st, decided_by: by, decided_on: on }; if (rec) o.record = rec;
    fs.mkdirSync(path.join(repo, ".a1"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".a1", "xprov.json"), JSON.stringify(o, null, 2) + "\n");
  ' "$PHASE_REPO" "$1" "$2" "$3" "${4:-}"
}

repokey33() { node -e 'process.stdout.write(require(process.argv[1] + "/_shared/lib/xprov-common.cjs").commonDirOf(process.argv[2]) || "")' "$REPO_ROOT" "$PHASE_REPO"; }

# store33 <by> <on> — a denial for THIS repo, key computed here (not by the code under test).
store33() {
  mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  node -e '
    const fs = require("fs"); const [file, key, by, on] = process.argv.slice(1);
    fs.writeFileSync(file, JSON.stringify({ version: 1, denials: { [key]: { decided_by: by, decided_on: on, ts: "2026-10-05T00:00:00.000Z" } } }, null, 2) + "\n");
  ' "$STORE33" "$(repokey33)" "$1" "$2"
  chmod 600 "$STORE33"
}

hc33() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov handover-check "$@" 2>"$TMP33/err.txt")"; G_RC=$?; G_ERR="$(cat "$TMP33/err.txt")"; }

caseH1() {
  prep33; file33 denied robert 2026-10-19 record/2026-10-19-xprov-codex-ausgesetzt-a1-specforge.md
  hc33
  assert_rc "H1 file denied, fresh host → exit 1 (the handover must not pass silently)" 1 "$G_RC"
  assert_json "H1 target_state is denial_mismatch" "$G_OUT" "j.target_state" "denial_mismatch"
  assert_json "H1 it blocks the merge on the target host" "$G_OUT" "JSON.stringify(j.blocks_merge)" "true"
  assert_json "H1 the file decision is reported verbatim" "$G_OUT" "j.file_decision" "denied"
  local cmd; cmd="$(json_get "$G_OUT" "j.owner_command")"
  [[ "$cmd" == *"xprov permit --deny"* ]] && ok "H1 the owner command denies (not permits)" || bad "H1 owner_command: $cmd"
  [[ "$cmd" == *"--by robert"* ]] && ok "H1 the command carries --by from the file" || bad "H1 --by missing: $cmd"
  [[ "$cmd" == *"record/2026-10-19-xprov-codex-ausgesetzt-a1-specforge.md"* ]] && ok "H1 the command carries the record from the file" || bad "H1 record missing: $cmd"
  [[ "$G_ERR" == *"real terminal"* ]] && ok "H1 stderr says the owner runs it in a real terminal" || bad "H1 stderr: $G_ERR"
}

caseH2() {
  prep33; file33 allowed robert 2026-10-05 record/x.md
  hc33
  assert_rc "H2 file allowed, fresh host → exit 1" 1 "$G_RC"
  assert_json "H2 target_state is permit_mismatch" "$G_OUT" "j.target_state" "permit_mismatch"
  assert_json "H2 it blocks the merge" "$G_OUT" "JSON.stringify(j.blocks_merge)" "true"
  local cmd; cmd="$(json_get "$G_OUT" "j.owner_command")"
  [[ "$cmd" == *"xprov permit "* && "$cmd" != *"--deny"* ]] && ok "H2 the command permits, without --deny" || bad "H2 owner_command: $cmd"
  [[ "$cmd" == *"--record record/x.md"* ]] && ok "H2 a permit keeps --record (it is mandatory there)" || bad "H2 record missing: $cmd"
}

caseH3() {
  prep33
  hc33
  assert_rc "H3 no .a1/xprov.json → exit 0 (an unpermitted repo is Reinhard-only on every host)" 0 "$G_RC"
  assert_json "H3 target_state absent" "$G_OUT" "j.target_state" "absent"
  assert_json "H3 nothing is blocked" "$G_OUT" "JSON.stringify(j.blocks_merge)" "false"
  assert_json "H3 no owner command is needed" "$G_OUT" "JSON.stringify(j.owner_command)" "null"
}

caseH4() {
  prep33; mkdir -p "$PHASE_REPO/.a1"; printf '{not json\n' > "$PHASE_REPO/.a1/xprov.json"
  hc33
  assert_rc "H4 invalid file → exit 1 (the handover is told)" 1 "$G_RC"
  assert_json "H4 target_state invalid" "$G_OUT" "j.target_state" "invalid"
  assert_json "H4 invalid does NOT pass the merge hook, so it blocks (only absent/denied pass)" "$G_OUT" "JSON.stringify(j.blocks_merge)" "true"
}

caseH5() {
  prep33; file33 denied robert 2026-10-19 record/x.md; store33 robert 2026-10-19
  hc33
  assert_json "H5 the local host reads denied (its store agrees)" "$G_OUT" "j.local_state" "denied"
  assert_json "H5 the target host still predicts the mismatch" "$G_OUT" "j.target_state" "denial_mismatch"
  assert_rc "H5 a healthy local host does not make the handover safe → still exit 1" 1 "$G_RC"
}

caseH6() {
  prep33; file33 denied robert 2026-10-19 record/x.md
  G_OUT="$(cd "$TMP33" && node "$TREE_TOOLS" xprov handover-check --repo "$PHASE_REPO" --target-repo /home/rob/claude-projects/a1-specforge 2>"$TMP33/err.txt")"; G_RC=$?
  assert_json "H6 --repo reads the repository from outside it" "$G_OUT" "j.target_state" "denial_mismatch"
  local cmd; cmd="$(json_get "$G_OUT" "j.owner_command")"
  [[ "$cmd" == *"--repo /home/rob/claude-projects/a1-specforge"* ]] && ok "H6 the command names the TARGET path, not the local one" || bad "H6 owner_command: $cmd"
  [[ "$cmd" != *"$PHASE_REPO"* ]] && ok "H6 the local fixture path does not leak into the command" || bad "H6 local path leaked: $cmd"
}

caseH7() {
  prep33; file33 denied robert 2026-10-19 record/x.md
  hc33
  local cmd; cmd="$(json_get "$G_OUT" "j.owner_command")"
  [[ "$cmd" != *$'\n'* ]] && ok "H7 the owner command is a single line (it travels in the handover note)" || bad "H7 multi-line command: $cmd"
  [[ "$cmd" != *"ghp_"* && "$cmd" != *"sk-"* ]] && ok "H7 the command carries no secret-shaped text" || bad "H7 secret-shaped: $cmd"
  assert_json "H7 the store path is named for the human, not guessed by them" "$G_OUT" "j.store_path.endsWith('.a1-xprov') || j.store_path.includes('.a1-xprov')" "true"
}

caseH1; caseH2; caseH3; caseH4; caseH5; caseH6; caseH7
