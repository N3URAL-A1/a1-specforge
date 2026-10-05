#!/usr/bin/env bash
# cases/06b-review.sh — spec 011 Wave 6 part B, review fixes (Samuel FAIL 1
# BLOCKER; Reinhard 2 MAJOR). Sourced after 06a2-review.sh; reuses 05b's
# w5b_* and 06-run.sh's w6_* helpers.
#
#   X37  BLOCKER the intent worktree's .git FILE: deny pair (X7/X12c), the
#        git dirs pinned to the lock (b), the strict anchor (c)
#   X38  M1 every stop between worktree creation and spawn cleans up; m3
#   X39  M2 the Summary of a claude child is its measured JSON `result`
#   X40  minors: already started (Samuel m1), seal without rewrite (m3),
#        host-name charset (m6), stage without git (m7), registry override
#        (Reinhard m4), stop signals (m5)
#
# RED proof: every case below is red against 943cbdc (the part B commits
# before these fixes), except the controls named as such; the single
# production change that turns each case red is in the mutation table
# (scratchpad), measured on snapshot copies.

# x37_child <dir> <args...> — a1-tools in child mode for execute (a write
# action: anchor = the fixture intent worktree), run from <dir>.
x37_child() {
  local dir="$1"
  shift
  W5B_SPEC="$(w5b_lockspec execute real-proj)"
  w5b_run "$dir" "$A1_TOOLS" A1_INTENT_CHILD=1 A1_INTENT_ACTION=execute A1_INTENT_PROJECT=real-proj -- "$@"
  W5B_SPEC=-
}
x37_primary() { printf '%s|%s|%s|%s' "$(git -C "$W5B_PRIMARY" rev-parse HEAD)" "$(git -C "$W5B_PRIMARY" status --porcelain | tr '\n' ';')" \
  "$(sha256_of "$W5B_PRIMARY/.git/index" 2>/dev/null)" "$(git -C "$W5B_PRIMARY" for-each-ref --format='%(refname)=%(objectname)' refs/heads | tr '\n' ';')"; }

# ---------- X37b: git dirs pinned to the lock (BLOCKER fix b) ----------
w5b_project_sandbox w6b-x37
git -C "$CWD" config user.name fixture
git -C "$CWD" config user.email fixture@invalid
printf 'owner wip\n' >"$W5B_PRIMARY/wip.txt"
git -C "$W5B_PRIMARY" add wip.txt # the owner's staged work in progress
mkdir -p "$CWD/sub" "$CWD/sub2"
printf 'x\n' >"$CWD/sub/f.txt"
printf 'x\n' >"$CWD/sub2/f.txt"
x37_before="$(x37_primary)"
# (1) a nested gitfile naming the primary's git dir: from there, wrapper
# git add/commit would land on the owner's branch with the staged WIP.
printf 'gitdir: %s/.git\n' "$W5B_PRIMARY" >"$CWD/sub/.git"
x37_child "$CWD/sub" git add f.txt
expect_refused "X37b1 a gitfile naming <primary>/.git (child cwd below the anchor): node <T> git add -> 77 child_context_invalid [FR-048, review BLOCKER]" child_context_invalid
x37_child "$CWD/sub" git commit -m stolen
expect_refused "X37b2 the same: node <T> git commit -> 77 child_context_invalid [FR-048, review BLOCKER]" child_context_invalid
if [[ "$(x37_primary)" == "$x37_before" ]]; then ok "X37b3 the owner's HEAD, staged index, status and every branch are unchanged [FR-043, review BLOCKER]"
else bad "X37b3 the owner's HEAD, staged index, status and every branch are unchanged [FR-043, review BLOCKER]" "before $x37_before" "after  $(x37_primary)"; fi
# (2) a gitfile naming a planted ./evil git dir (only admitted config keys,
# so the config gate alone would pass it).
git init -q --bare "$CWD/sub2/evil"
printf 'gitdir: ./evil\n' >"$CWD/sub2/.git"
x37_child "$CWD/sub2" git status --porcelain
expect_refused "X37b4 a gitfile naming a planted ./evil repository -> 77 child_context_invalid before git runs [FR-048, review BLOCKER]" child_context_invalid
# (3) control: the real intent worktree, same calls, reach git.
printf 'ctl\n' >"$CWD/ctl.txt" # sub/ holds a planted .git file, so git treats it as a nested repository
x37_child "$CWD" git add ctl.txt
x37c_add="$RC"
x37_child "$CWD" git commit -m own
x37c_commit="$RC"
x37_branch="$(git -C "$W5B_PRIMARY" log --format=%s -1 "intent/3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b" 2>/dev/null)"
if [[ "$x37c_add $x37c_commit $x37_branch" == "0 0 own" && "$(git -C "$W5B_PRIMARY" rev-parse HEAD)" == "${x37_before%%|*}" ]]; then
  ok "X37b5 control: from the anchor the wrapper adds and commits onto intent/<id>, the owner's HEAD stays [FR-048]"
else bad "X37b5 control: from the anchor the wrapper adds and commits onto intent/<id>, the owner's HEAD stays [FR-048]" "add $x37c_add commit $x37c_commit branch '$x37_branch'" "out: ${OUT:0:200} err: ${ERR:0:200}"; fi

# ---------- X37c: the strict anchor (BLOCKER fix c, review m6) ----------
x37_gitfile="$(cat "$CWD/.git")"
printf 'gitdir: %s/.git\n' "$W5B_PRIMARY" >"$CWD/.git"
x37_child "$CWD" lane-split check --plan PLAN.md
expect_refused "X37c1 the worktree's own .git file rewritten to <primary>/.git -> every child command 77 child_context_invalid [FR-041, review BLOCKER]" child_context_invalid
printf '%s\n' "$x37_gitfile" >"$CWD/.git"
w5b_project_sandbox w6b-x37c
x37c_wt="$CWD"
# Under claude-projects/ and with the worktree's own basename, so neither the
# "under claude-projects" check nor the git-dir check of fix (b) (which
# derives the admin dir from the anchor's basename) can refuse it: only the
# link checks of the anchor do (X37c4).
x37c_moved="$FHOME/claude-projects/elsewhere/$(basename "$x37c_wt")"
mkdir -p "$FHOME/claude-projects/elsewhere"
mv "$x37c_wt" "$x37c_moved"
ln -s "$W5B_PRIMARY" "$x37c_wt"
x37_child "$W5B_PRIMARY" lane-split check --plan PLAN.md
expect_refused "X37c2 the intent worktree folder is a link to the project -> 77 child_context_invalid [FR-041, review m6]" child_context_invalid
rm "$x37c_wt"
# X37c4: a link to a REAL worktree with the right .git file (moved away):
# only the lstat/realpath check of the folder refuses it.
ln -s "$x37c_moved" "$x37c_wt"
x37_child "$x37c_moved" lane-split check --plan PLAN.md
expect_refused "X37c4 the intent worktree path is a link to a real worktree elsewhere (its .git file matches) -> 77 child_context_invalid [FR-041, review m6]" child_context_invalid
rm "$x37c_wt"
# X37c5: a plain directory (no .git file) at the intent worktree path: only
# the gitfile check refuses it (no repository, so the git-dir check of fix b
# has nothing to compare).
mkdir "$x37c_wt"
x37_child "$x37c_wt" lane-split check --plan PLAN.md
expect_refused "X37c5 a plain directory without the .git file at the intent worktree path -> 77 child_context_invalid [FR-041, review BLOCKER c]" child_context_invalid
rmdir "$x37c_wt"
mv "$x37c_moved" "$x37c_wt"
x37_child "$x37c_wt" lane-split check --plan PLAN.md
expect_not_refused "X37c3 control: the real intent worktree is a valid anchor [FR-041]"

# ---------- X37d: the git-dir check fails closed (re-verify n1) ----------
# A git whose rev-parse fails, or prints one line instead of two, with the
# lock's expectation set: a problem (77), never a skipped comparison. The
# shim forwards every other call to /usr/bin/git; it is passed through the
# scan's `bin` seam (library call), the scan never resolves git via PATH.
w5b_project_sandbox w6b-x37d
for m in fail one; do
  printf '#!/bin/sh\nif [ "$1" = rev-parse ]; then\n  [ %s = fail ] && exit 128\n  /usr/bin/git "$@" | head -1\n  exit 0\nfi\nexec /usr/bin/git "$@"\n' "$m" >"$SB/git-$m"
  chmod 755 "$SB/git-$m"
done
x37d="$(node - "$INTENT_LIB" "$CWD" "$W5B_PRIMARY" "$FHOME" "$SB" <<'JS' 2>&1
const path = require('path'); const fs = require('fs');
const [lib, cwd, primary, home, sb] = process.argv.slice(2);
const g = require(`${lib}/intent-git.cjs`);
const env = g.runnerEnv(home, {}, path.dirname(fs.realpathSync(cwd)));
const common = path.join(fs.realpathSync(primary), '.git');
const expect = { gitDir: path.join(common, 'worktrees', path.basename(cwd)), common };
const show = (p) => (p === null ? 'ok' : /cannot be determined/.test(p) ? 'undetermined' : `other:${p}`);
console.log([show(g.repoConfigProblemAt(cwd, env, expect, `${sb}/git-fail`)), show(g.repoConfigProblemAt(cwd, env, expect, `${sb}/git-one`)),
  show(g.repoConfigProblemAt(cwd, env, expect)), show(g.repoConfigProblemAt(cwd, env, null, `${sb}/git-fail`))].join(' '));
JS
)"
if [[ "$x37d" == "undetermined undetermined ok ok" ]]; then
  ok "X37d with the lock's expectation set, a rev-parse that fails or prints one line -> problem (77), never a skipped check; control: real git ok, no expectation (executor side) ok [FR-048, re-verify n1]"
else bad "X37d with the lock's expectation set, a rev-parse that fails or prints one line -> problem (77), never a skipped check; control: real git ok, no expectation (executor side) ok [FR-048, re-verify n1]" "$x37d"; fi

# ---------- X38: one cleanup path between worktree creation and spawn (review M1, m3) ----------
w6_sandbox w6b-x38
x38_wt() { printf '%s' "$FHOME/claude-projects/a1-worktrees/real-proj-intent-$1"; }
# x38_clean <id> — nothing of the stopped run is left: run dir, worktree
# folder, branch intent/<id>, registry entry, ledger lock; the intent is
# still in claimed/ with status claimed.
x38_clean() {
  local id="$1" left=""
  [[ -e "$FHOME/.a1-intents/runs/$id" ]] && left="$left run-dir"
  [[ -e "$(x38_wt "$id")" ]] && left="$left folder"
  [[ -n "$(w6_git "$W6_PRIMARY" branch --list "intent/$id")" ]] && left="$left branch"
  [[ "$(w6_reg_entry "$id" '"entry"')" == entry ]] && left="$left registry"
  [[ "$(w6_where "$id")" == claimed && "$(w6_fm "$VAULT/inbox/intents/claimed/$id.md" status)" == claimed ]] || left="$left not-claimed"
  printf '%s' "${left:-clean}"
}
x38_bad=""
for x38_action in progress plan; do
  if [[ "$x38_action" == plan ]]; then w6_claim action=plan target=M2-P1-x; else w6_claim action=progress; fi
  w6_runlib busy
  rm -f "$FHOME/.a1-intents/ledger.lock"
  x38_first="$(w6_js 'o.exitCode + " " + (o.out && o.out.reasons || []).join(",")' "$RL") $W6_SPAWNS $(x38_clean "$W6_ID")"
  w6_run
  x38_retry="$RC $(w6_where "$W6_ID") $W6_SPAWNS $( [[ -e "$FHOME/.a1-intents/runs/$W6_ID" ]] && echo run-dir-left)"
  [[ "$x38_first" == "1 ledger_busy 0 clean" && "$x38_retry" == "0 done 1 " ]] || x38_bad="$x38_bad | $x38_action: first '$x38_first' retry '$x38_retry'"
done
if [[ -z "$x38_bad" ]]; then ok "X38a a ledger_busy between snapshot and running rewrite (progress and plan) -> exit 1, run dir, worktree, branch and registry entry gone, intent still claimed; the retry runs to done and removes its run dir [FR-020, FR-049, review M1]"
else bad "X38a a ledger_busy between snapshot and running rewrite (progress and plan) -> exit 1, run dir, worktree, branch and registry entry gone, intent still claimed; the retry runs to done and removes its run dir [FR-020, FR-049, review M1]" "${x38_bad:0:500}"; fi
w6_claim action=plan target=M2-P1-x
w6_runlib tamperlate
x38b="$(w6_where "$W6_ID") $(w6_fm "$VAULT/inbox/intents/rejected/$W6_ID.md" rejected_reason) $W6_SPAWNS $(w6_js 'o.detail' "$(w6_log_last run)")"
x38b_left="$( [[ -e "$(x38_wt "$W6_ID")" ]] && echo folder) $( [[ -e "$FHOME/.a1-intents/runs/$W6_ID" ]] && echo run-dir) $( [[ "$(w6_reg_entry "$W6_ID" '"entry"')" == entry ]] && echo registry)"
if [[ "$x38b" == "rejected tampered 0 sha_mismatch" && "$x38b_left" == "  " ]]; then
  ok "X38b the claimed file changes between checkClaimed and the running rewrite -> rejected/ tampered (sha_mismatch), 0 spawns, worktree, run dir and registry entry gone [FR-020, security review m2]"
else bad "X38b the claimed file changes between checkClaimed and the running rewrite -> rejected/ tampered (sha_mismatch), 0 spawns, worktree, run dir and registry entry gone [FR-020, security review m2]" "$x38b left: '$x38b_left'"; fi
w6_claim action=plan target=M2-P1-x
mkdir -p "$FHOME/.a1-intents/runs/$W6_ID"
chmod 700 "$FHOME/.a1-intents/runs" "$FHOME/.a1-intents/runs/$W6_ID"
printf 'old\n' >"$FHOME/.a1-intents/runs/$W6_ID/leftover.txt"
w6_run
x38c="$RC $W6_SPAWNS $( [[ -e "$(x38_wt "$W6_ID")" ]] && echo folder) $( [[ "$(w6_reg_entry "$W6_ID" '"entry"')" == entry ]] && echo registry) $(w6_where "$W6_ID")"
rm -rf "$FHOME/.a1-intents/runs/$W6_ID"
w6_run
x38c="$x38c | $RC $(w6_where "$W6_ID")"
if [[ "$x38c" == "2 0   claimed | 0 done" ]]; then
  ok "X38c an unsafe run dir after the worktree was created -> exit 2, the worktree and its entry rolled back, intent claimed; once cleared the retry runs [FR-049, review M1]"
else bad "X38c an unsafe run dir after the worktree was created -> exit 2, the worktree and its entry rolled back, intent claimed; once cleared the retry runs [FR-049, review M1]" "$x38c"; fi
w6_claim action=plan target=M2-P1-x
w6_runlib staletmp
x38d="$(w6_js 'o.exitCode' "$RL") $(w6_where "$W6_ID") $(w6_reg_entry "$W6_ID" 'e.status')"
rm -f "$FHOME"/.a1-worktrees-registry.json.tmp.*
if [[ "$x38d" == "0 done handoff" ]]; then ok "X38d a stale registry temp file named with the run's pid does not block the registry write [FR-043, review m3]"
else bad "X38d a stale registry temp file named with the run's pid does not block the registry write [FR-043, review m3]" "$x38d" "rl: ${RL:0:200}"; fi
w6_claim action=plan target=M2-P1-x
mkdir -p "$W6_PRIMARY/.git/worktrees/real-proj-intent-$W6_ID" # a stale admin dir: git names the new one <slug>1
w6_run
x38e="$RC $(w6_where "$W6_ID") $(w6_js 'o.detail' "$(w6_log_last run)") $( [[ -e "$(x38_wt "$W6_ID")" ]] && echo folder) $( [[ -n "$(w6_git "$W6_PRIMARY" branch --list "intent/$W6_ID")" ]] && echo branch) $(w6_reg_entry "$W6_ID" '"entry"')"
rm -rf "$W6_PRIMARY/.git/worktrees/real-proj-intent-$W6_ID"
if [[ "$x38e" == "1 rejected path_mismatch   <no entry>" ]]; then
  ok "X38e git placed the worktree's admin dir elsewhere -> workspace_not_isolated path_mismatch, the new folder and branch removed, no registry entry [FR-043, review m3]"
else bad "X38e git placed the worktree's admin dir elsewhere -> workspace_not_isolated path_mismatch, the new folder and branch removed, no registry entry [FR-043, review m3]" "$x38e"; fi

# ---------- X39: the Summary of a claude child (review M2, measured shape) ----------
x39_summary() { node -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); const i = t.indexOf("## Summary"); const j = t.indexOf("## Stderr");
  console.log(t.slice(i, j));' "$VAULT/project/real-proj/intents/$W6_ID.md" 2>/dev/null; }
w6_claim action=progress
stub_mode big
w6_run
stub_mode ok
x39a="$(x39_summary)"
x39a_lines="$(printf '%s\n' "$x39a" | grep -c '^Zeile ')"
if [[ "$RC" -eq 0 && "$x39a_lines" -eq 40 && "$x39a" == *"Zeile 230: Die Push-Benachrichtigung ist geplant"* && "$x39a" != *'"subtype"'* && "$x39a" != *'\n'* ]]; then
  ok "X39a a 20 KB result in the measured JSON object -> the Summary is readable text: the last 40 result lines, no JSON, no escaped newlines [FR-030, review M2]"
else bad "X39a a 20 KB result in the measured JSON object -> the Summary is readable text: the last 40 result lines, no JSON, no escaped newlines [FR-030, review M2]" "rc $RC lines $x39a_lines" "${x39a:0:300}"; fi
w6_claim action=progress
stub_mode error
w6_run
stub_mode ok
x39b="$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(x39_summary | grep -c 'Not logged in · Please run /login') $(x39_summary | grep -c '"is_error"')"
if [[ "$x39b" == "nonzero_exit 1 0" ]]; then ok "X39b the measured error shape (is_error true, exit 1) -> failed nonzero_exit, the Summary shows the result text, not the JSON [FR-030, review M2]"
else bad "X39b the measured error shape (is_error true, exit 1) -> failed nonzero_exit, the Summary shows the result text, not the JSON [FR-030, review M2]" "$x39b"; fi
w6_claim action=progress
stub_mode json0
w6_run
stub_mode ok
x39c="$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" status) $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $(w6_fm "$VAULT/project/real-proj/intents/$W6_ID.md" exit_code)"
if [[ "$x39c" == "failed nonzero_exit 0" ]]; then ok "X39c is_error true with exit 0 (not measured, defensive) -> failed nonzero_exit, exit_code 0 kept [FR-030, review M2]"
else bad "X39c is_error true with exit 0 (not measured, defensive) -> failed nonzero_exit, exit_code 0 kept [FR-030, review M2]" "$x39c"; fi
w6_claim action=stage target=003-foo:review
w6_run
if [[ "$RC" -eq 0 && "$(x39_summary)" == *'"feature": "003-foo"'* ]]; then ok "X39d control: stage's a1-tools JSON is no claude result -> the Summary keeps the raw stdout [FR-030]"
else bad "X39d control: stage's a1-tools JSON is no claude result -> the Summary keeps the raw stdout [FR-030]" "rc $RC $(x39_summary | head -c 200)"; fi

# ---------- X40: minors ----------
# X40a Samuel m1 — a run that crashed after its running rewrite never runs
# twice: status running (row started_at set, sha matching) and a row with
# started_at while the file still says claimed are both refused, nothing moves.
w6_claim action=progress
node - "$W6_FILE" "$FHOME/.a1-intents-ledger.json" "$W6_ID" <<'JS'
const fs = require('fs'); const crypto = require('crypto');
const [file, ledger, id] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8').replace(/^status: claimed$/m, 'status: running') + '';
fs.writeFileSync(file, text.replace(/\n---\n$/, '\nstarted_at: 2026-09-28T10:00:00.000Z\n---\n'));
const now = fs.readFileSync(file, 'utf8');
const d = JSON.parse(fs.readFileSync(ledger, 'utf8'));
d.rows = d.rows.map((r) => (r.id === id ? { ...r, started_at: '2026-09-28T10:00:00.000Z', claimed_sha256: crypto.createHash('sha256').update(now, 'utf8').digest('hex') } : r));
fs.writeFileSync(ledger, JSON.stringify(d)); fs.chmodSync(ledger, 0o600);
JS
w6_run
x40a="$RC $(w6_where "$W6_ID") $W6_SPAWNS $(w6_js 'o.reason + " " + o.detail' "$(w6_log_last run)")"
w6_claim action=progress
node -e 'const fs = require("fs"); const [ledger, id] = process.argv.slice(1); const d = JSON.parse(fs.readFileSync(ledger, "utf8"));
  d.rows = d.rows.map((r) => (r.id === id ? { ...r, started_at: "2026-09-28T10:00:00.000Z" } : r)); fs.writeFileSync(ledger, JSON.stringify(d)); fs.chmodSync(ledger, 0o600);' \
  "$FHOME/.a1-intents-ledger.json" "$W6_ID"
w6_run
x40a="$x40a | $RC $(w6_where "$W6_ID") $W6_SPAWNS $(w6_js 'o.reason + " " + o.detail' "$(w6_log_last run)")"
if [[ "$x40a" == "1 claimed 0 already_claimed already_started | 1 claimed 0 already_claimed already_started" ]]; then
  ok "X40a status running, or a ledger row with started_at -> refused already_claimed (already_started), stays in claimed/, 0 spawns [FR-020, security review m1]"
else bad "X40a status running, or a ledger row with started_at -> refused already_claimed (already_started), stays in claimed/, 0 spawns [FR-020, security review m1]" "$x40a"; fi

# X40c Samuel m6 — host names outside INTENT_HOSTNAME_RE are not copied.
w6_claim action=progress
export A1_HOST_ID='mac;touch x' A1_VAULT_WRITER_HOST='mac-writer'
w6_run
unset A1_HOST_ID A1_VAULT_WRITER_HOST
x40c="$(grep -c '^A1_HOST_ID=' "$W6_STUB/env.txt") $(sed -n 's/^A1_VAULT_WRITER_HOST=//p' "$W6_STUB/env.txt")"
if [[ "$RC" -eq 0 && "$x40c" == "0 mac-writer" ]]; then ok "X40c A1_HOST_ID with a ; is not copied into the child env, a valid A1_VAULT_WRITER_HOST is [FR-021, security review m6]"
else bad "X40c A1_HOST_ID with a ; is not copied into the child env, a valid A1_VAULT_WRITER_HOST is [FR-021, security review m6]" "rc $RC: $x40c"; fi

# X40d Samuel m7 — stage needs no git on PATH (only node; claude is not used).
mkdir -p "$SB/nogit"
ln -sf "$W6_NODE" "$SB/nogit/node"
w6_claim action=stage target=003-foo:verify # forward from X39d's review
if [[ "$(ls "$SB/nogit")" == node ]]; then # the reduced PATH holds node only (command -v would answer from bash's hash)
  HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$SB/nogit" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent run "$W6_FILE" >"$SB/.out" 2>"$SB/.err"
  RC=$?
  if [[ "$RC" -eq 0 && "$(w6_where "$W6_ID")" == done && "$(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" status)" == done ]]; then
    ok "X40d stage with no git on the parent PATH runs [FR-023, security review m7]"
  else bad "X40d stage with no git on the parent PATH runs [FR-023, security review m7]" "rc $RC $(head -c 300 "$SB/.out")"; fi
else bad "X40d stage with no git on the parent PATH runs [FR-023, security review m7]" "git reachable on the reduced PATH"; fi

# X40e Reinhard m4 — $A1_WORKTREE_REGISTRY set: refused, nothing created.
w6_claim action=plan target=M2-P1-x
export A1_WORKTREE_REGISTRY="$SB/other-registry.json"
w6_run
unset A1_WORKTREE_REGISTRY
x40e="$RC $(w6_fm "$VAULT/inbox/intents/rejected/$W6_ID.md" rejected_reason) $(w6_js 'o.detail' "$(w6_log_last run)" | cut -d: -f1) $( [[ -e "$SB/other-registry.json" || -e "$(x38_wt "$W6_ID")" ]] && echo created)"
if [[ "$x40e" == "1 workspace_not_isolated registry_override " ]]; then ok "X40e \$A1_WORKTREE_REGISTRY set -> workspace_not_isolated registry_override, no worktree, no foreign registry written [FR-043, review m4]"
else bad "X40e \$A1_WORKTREE_REGISTRY set -> workspace_not_isolated registry_override, no worktree, no foreign registry written [FR-043, review m4]" "$x40e"; fi

# X40f Reinhard m5 — SIGTERM to `run` while the child runs: the child's
# process group ends, both locks are released, exit 143.
w6_claim action=progress
stub_mode slow
HOME="$FHOME" A1_VAULT_ROOT="$VAULT" PATH="$STUB_DIR:$PATH" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent run "$W6_FILE" >"$SB/.out" 2>"$SB/.err" &
x40f_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [[ -f "$W6_STUB/stub.pid" ]] && break; sleep 0.1; done
x40f_stub="$(cat "$W6_STUB/stub.pid" 2>/dev/null)"
kill -TERM "$x40f_pid"
wait "$x40f_pid"
x40f_rc=$?
sleep 0.3
stub_mode ok
x40f="$x40f_rc $( [[ -e "$FHOME/.a1-intents/executor.lock" ]] && echo exec-lock) $( [[ -e "$FHOME/.a1-intents/locks/real-proj.lock" ]] && echo project-lock) $( [[ -n "$x40f_stub" ]] && kill -0 "$x40f_stub" 2>/dev/null && echo child-alive)"
if [[ "$x40f" == "143   " ]]; then ok "X40f SIGTERM to run during the child -> exit 143, the child's process group gone, executor and project lock released [FR-024, FR-025, review m5]"
else bad "X40f SIGTERM to run during the child -> exit 143, the child's process group gone, executor and project lock released [FR-024, FR-025, review m5]" "$x40f (stub pid $x40f_stub)"; fi

# X40b Samuel m3 — a seal without the rewritten skill lists is refused.
w6_sandbox w6b-x40b
chmod -R u+w "$FHOME/.a1-intents-seal"
rm -rf "$FHOME/.a1-intents-seal"
W6_SEAL_JSON="$(node "$STUB_DIR/seal-lib.cjs" "$INTENT_LIB" "$FHOME" "$W5B_HOST" norewrite 2>&1)"
w6_claim action=progress
w6_run
x40b="$RC $(w6_fm "$VAULT/inbox/intents/done/$W6_ID.md" failure_reason) $W6_SPAWNS $(w6_js 'o.detail' "$(w6_log_last run)")"
if [[ "$W6_SEAL_JSON" == *'"skill_rewrite":"none"'* && "$x40b" == "1 sandbox_invalid 0 seal_rewrite_off" ]]; then
  ok "X40b a seal with skill_rewrite none (B1 WIDENS) -> failed: sandbox_invalid seal_rewrite_off, 0 spawns [FR-044, security review m3]"
else bad "X40b a seal with skill_rewrite none (B1 WIDENS) -> failed: sandbox_invalid seal_rewrite_off, 0 spawns [FR-044, security review m3]" "$x40b" "${W6_SEAL_JSON:0:200}"; fi

chmod -R u+w "$WORK"
