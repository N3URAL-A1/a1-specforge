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
#       Red if the prediction is taken from the LOCAL store instead of the file
#       (verified by mutation: only this arm catches that change — H1 runs with an
#       empty store, where file-sourced and store-sourced predictions coincide).
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
  # permitHint() reads `absent` as "the owner still has to decide" — true for permit-check, wrong
  # here, where absent IS the success case. A hint next to ok:true would contradict it (code review).
  assert_json "H3 no hint either, so nothing contradicts ok:true" "$G_OUT" "JSON.stringify(j.hint)" "null"
  assert_json "H3 ok is true" "$G_OUT" "JSON.stringify(j.ok)" "true"
  # control: a state that IS a problem still carries its hint
  file33 denied robert 2026-10-19 record/x.md; hc33
  assert_json "H3 control: a blocking state still carries a hint" "$G_OUT" "j.hint === null ? 'null' : 'present'" "present"
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

# H8 — SEC: the printed line is pasted into a terminal by a human, and .a1/xprov.json is a
# working-tree file any contributor can edit in a PR. Found by running the real command against a
# crafted record on 2026-10-28: before the fix it printed
#   … --by robert; rm -rf /tmp/pwned --record record/x.md\n echo INJECTED --repo …
# Red if ownerCommand() stops applying validateBy/validateRecord, or stops refusing an unsafe
# --target-repo: then one of these arms prints a command instead of null.
caseH8() {
  prep33
  # a) shell metacharacters in decided_by, and a newline + payload in record
  file33 denied 'robert; rm -rf /tmp/pwned' 2026-10-19 'record/x.md
 echo INJECTED'
  hc33
  assert_json "H8a a crafted decided_by/record yields NO command (null), not a pasteable line" "$G_OUT" "JSON.stringify(j.owner_command)" "null"
  assert_json "H8a the state is still reported truthfully" "$G_OUT" "j.target_state" "denial_mismatch"
  [[ "$G_ERR" == *"No owner command can be printed"* ]] && ok "H8a stderr says why no command is printed" || bad "H8a stderr: $G_ERR"
  [[ "$G_ERR" != *"rm -rf"* && "$G_ERR" != *"INJECTED"* ]] && ok "H8a the crafted payload never reaches stderr either" || bad "H8a payload leaked to stderr: $G_ERR"
  # b) a record that escapes the vault with .. is refused by validateRecord
  prep33; file33 denied robert 2026-10-19 'record/../../../etc/passwd.md'
  hc33
  assert_json "H8b a .. record yields no command" "$G_OUT" "JSON.stringify(j.owner_command)" "null"
  # c) an unsafe --target-repo is refused (the path is never quoted, so it must be printable as-is)
  prep33; file33 denied robert 2026-10-19 record/x.md
  for bad_path in '/tmp/x; echo BAD' '/tmp/x$(id)' '/tmp/with space'; do
    hc33 --target-repo "$bad_path"
    assert_json "H8c --target-repo $bad_path yields no command" "$G_OUT" "JSON.stringify(j.owner_command)" "null"
  done
  # d) the legitimate case still prints, so the guard is not simply off
  hc33 --target-repo /home/rob/claude-projects/a1-specforge
  local cmd; cmd="$(json_get "$G_OUT" "j.owner_command")"
  [[ "$cmd" == "a1-tools xprov permit --deny --by robert --record record/x.md --repo /home/rob/claude-projects/a1-specforge" ]] \
    && ok "H8d a clean record on a clean path still prints the full command" || bad "H8d expected the clean command, got: $cmd"
}

# H9 — security review SEC-2/SEC-3 (2026-10-28). Two residual holes of the SEC-1 fix:
#   a) the REFUSAL line echoed the rejected --target-repo verbatim, so a newline in it forged an
#      instruction block at the same indentation the real command uses. Measured before the fix:
#        No owner command can be printed … the owner settles /tmp/ok
#          <attacker line> on the target host with …
#      Red if the refusal interpolates the raw value again, or if target_repo returns it unfiltered.
#   b) --target-repo was never required to be absolute and normalised, so the printed command could
#      carry `--repo relative/path`, which resolves against whatever cwd the owner is in on the
#      target host — the one thing a handover must not leave open.
caseH9() {
  prep33; file33 denied robert 2026-10-19 record/x.md
  hc33 --target-repo '/tmp/ok
  a1-tools xprov permit --by attacker --record record/x.md --repo /tmp/elsewhere'
  assert_json "H9a a newline in --target-repo yields no command" "$G_OUT" "JSON.stringify(j.owner_command)" "null"
  assert_json "H9a the accepted target_repo is null, not the rejected value" "$G_OUT" "JSON.stringify(j.target_repo)" "null"
  assert_json "H9a the rejected value is reported as one line (no line breakers)" "$G_OUT" "String(j.target_repo_rejected).includes('\n')" "false"
  # the refusal prose must not reproduce a pasteable-looking command line
  [[ "$G_ERR" != *"--by attacker"* ]] && ok "H9a the refusal does not echo the forged command line" || bad "H9a forged line in stderr: $G_ERR"
  local refusal_lines; refusal_lines="$(printf '%s' "$G_ERR" | grep -c '^' || true)"
  [[ "$refusal_lines" -le 4 ]] && ok "H9a stderr stays at its three intended lines ($refusal_lines)" || bad "H9a stderr grew to $refusal_lines lines: $G_ERR"
  # b) absolute + normalised is required; a clean absolute path still prints
  # A leading dash is argument injection, not a path: `--repo --deny` would turn the pasted line into
  # a different decision. Caught by the absolute-path requirement (code review MAJOR).
  for bad_path in 'relative/not/absolute' '/a/../b' '/tmp/x/../y' '--deny' '-X'; do
    hc33 --target-repo "$bad_path"
    assert_json "H9b --target-repo '$bad_path' yields no command" "$G_OUT" "JSON.stringify(j.owner_command)" "null"
  done
  # An EMPTY --target-repo is not an attack: it falls back to the checked repository itself
  # (measured — `(opts && opts.targetRepo) || root`), which is an absolute git toplevel.
  hc33 --target-repo ''
  assert_json "H9b an empty --target-repo falls back to the local repo, so a command is printed" "$G_OUT" "j.owner_command === null ? 'null' : 'printed'" "printed"
  hc33 --target-repo /home/rob/claude-projects/a1-specforge
  assert_json "H9b a clean absolute path is accepted" "$G_OUT" "j.target_repo" "/home/rob/claude-projects/a1-specforge"
  assert_json "H9b ... and nothing is reported as rejected" "$G_OUT" "JSON.stringify(j.target_repo_rejected)" "null"
  # c) the backstop must be STATELESS. C.LINE_BREAKERS_RE carries /g, so `.test()` on the shared
  # regex alternates via lastIndex and would refuse only every SECOND hostile value — measured
  # while hardening this. The guard therefore uses a local non-global regex. Red if it goes back
  # to a /g regex: the second of these three identical calls starts printing a command.
  # A literal newline, not  : `printf '\uXXXX'` is a bash-ism the CI shell may not share
  # (CLAUDE.md "CI runs on GNU/Linux"), while a newline exercises the same code path.
  local leaked=0 i
  for i in 1 2 3; do
    hc33 --target-repo '/tmp/x
y'
    [[ "$(json_get "$G_OUT" "JSON.stringify(j.owner_command)")" == "null" ]] || leaked=$((leaked + 1))
  done
  [[ "$leaked" -eq 0 ]] && ok "H9c the same hostile path is refused on every call (the backstop is stateless)" \
    || bad "H9c $leaked of 3 identical hostile calls printed a command — the backstop is stateful (/g regex?)"
  # d) the length cap and bare `/`, for symmetry with the other validators of the module
  local long; long="/$(node -e 'process.stdout.write("a".repeat(5000))')"
  hc33 --target-repo "$long"
  assert_json "H9d a path past PATH_MAX yields no command" "$G_OUT" "JSON.stringify(j.owner_command)" "null"
  hc33 --target-repo /
  assert_json "H9d bare / yields no command (permit would refuse it as not-a-repository)" "$G_OUT" "JSON.stringify(j.owner_command)" "null"
}

caseH1; caseH2; caseH3; caseH4; caseH5; caseH6; caseH7; caseH8; caseH9
