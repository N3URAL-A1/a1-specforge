#!/usr/bin/env bash
# Part 05 — Wave 5: `xprov snapshot` and `xprov run` (tripwire, runner-only
# argv). Sourced by run-tests.sh. Cases R11, R15, R16, R17, R22 (argv arm),
# R24 from the wave plan's Wave 5 fixture table, R18d moved here from part 03,
# the repo-local `.codex/`/AGENTS.md case (RC), and the arms from Samuel's W5
# review (S1 run-dir guard + pin, S2 env allowlist, S3 .git/ tripwire, S4 home
# tripwire, S5 scan completeness, S6 shallow depth, S7 spawn bounds) and
# Reinhard's W6 review (--no-log). Every case names the single production
# change that turns it red.
#
# The runner is the fake from make_tree; its knobs travel through
# fake-runner.env.json in the copy's vendor dir (see fake_runner_env in the
# harness) because production passes the runner an allowlisted environment.
# Real Codex is never reached: A1_XPROV_CODEX_HOME points at a throwaway
# compliant home and HOME at a throwaway dir.

TMP05="$(mktemp -d)"
SAVED_HOME_05="$HOME"
export HOME="$(mktemp -d)"
ARGV_DIR="$TMP05/argv"; mkdir -p "$ARGV_DIR"; ARGV_N=0

# prep5 [plan] — fresh tree, phase repo, permit record, compliant home. Sets
# TREE*, PHASE_*, XHOME; exports A1_XPROV_CODEX_HOME.
prep5() {
  make_tree; make_phase p5 "${1:-$CASES/approved.PLAN.md}"
  ( cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit --by fixture --record record/2026-09-24-fixture.md >/dev/null 2>&1 ) || echo "WARN prep5: permit failed" >&2
  make_home; export A1_XPROV_CODEX_HOME="$XHOME"
}

# commit5 <msg> — stage everything in $PHASE_REPO and commit; updates PHASE_HEAD.
commit5() { ( cd "$PHASE_REPO" && git add -A && git commit -qm "$1" ); PHASE_HEAD="$(cd "$PHASE_REPO" && git rev-parse HEAD)"; }

# snap5 [commit] [base] — snapshot of $PHASE_REPO. Sets S_OUT, S_ERR, S_RC, SNAP.
snap5() {
  local commit="${1:-$PHASE_HEAD}"; local base="${2:-}"
  # bash 3.2 + set -u: an empty array expands as "unbound variable" — use the ${a[@]+"${a[@]}"} idiom
  local extra=(); [[ -n "$base" ]] && extra=(--base "$base")
  S_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --repo "$PHASE_REPO" --commit "$commit" ${extra[@]+"${extra[@]}"} 2>"$TMP05/snap-err.txt")"; S_RC=$?
  S_ERR="$(cat "$TMP05/snap-err.txt")"
  SNAP="$(node -e "try { process.stdout.write(JSON.parse(process.argv[1]).snapshot || ''); } catch (e) {}" "$S_OUT")"
}

# run5 <mode> [more flags] — `xprov run` from inside $PHASE_REPO. Knobs come
# from the caller's FAKE_RUNNER_* environment, written to the env file first.
# Sets U_OUT, U_ERR, U_RC, ARGV_FILE, ENV_FILE.
run5() {
  local mode="$1"; shift
  ARGV_N=$((ARGV_N + 1)); ARGV_FILE="$ARGV_DIR/argv-$ARGV_N.json"; ENV_FILE="$ARGV_DIR/env-$ARGV_N.json"
  FAKE_RUNNER_ARGV_FILE="$ARGV_FILE" FAKE_RUNNER_ENV_FILE="$ENV_FILE" FAKE_RUNNER_CASE="${FAKE_RUNNER_CASE:-approved}" fake_runner_env
  U_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov run --mode "$mode" --snapshot "$SNAP" --plan "$PHASE_PLAN" --phase p5 --gate "$GATE_PLAN" --timeout 7 "$@" 2>"$TMP05/run-err.txt")"; U_RC=$?
  U_ERR="$(cat "$TMP05/run-err.txt")"
}

porcelain() { ( cd "$1" && git status --porcelain --untracked-files=all ); }
# a1's OWN writes into .a1/phases/<name>/ (XREVIEW.md, PLAN-REVIEW-LOG.md) are by
# design; "checkout untouched by a1" means nothing else changes.
porcelain_without_phase() { porcelain "$1" | grep -v ' .a1/phases/' || true; }
snapshots_count() { ls "$HOME/.a1-xprov/snapshots" 2>/dev/null | wc -l | tr -d ' '; }
rundirs_count() { ls "$HOME/.a1-xprov/artifacts/$(basename "$PHASE_REPO")" 2>/dev/null | grep -c '^claudex-' || true; }
jget() { node -e "try { const j = JSON.parse(process.argv[1]); const v = ($2); process.stdout.write(v === undefined ? 'undefined' : String(v)); } catch (e) { process.stdout.write('UNPARSEABLE'); }" "$1"; }

# ---------- R11: exact runner argv, no --log, absolute plan, log entry ----------
# Red-making change: passing `--plan PLAN.md` (relative), or adding any argv token.
caseR11() {
  prep5; snap5
  assert_rc "R11a snapshot exits 0" 0 "$S_RC" "$S_ERR"
  local art="$HOME/.a1-xprov/artifacts/$(basename "$PHASE_REPO")"
  local runner_real; runner_real="$(cd "$TREE_VENDOR" && pwd -P)/runner.py"   # Node realpaths __dirname (macOS /private/var)
  run5 review
  assert_rc "R11b run --mode review with the fake runner exits 0" 0 "$U_RC" "$U_ERR"
  assert_json "R11c recorded runner argv is exactly review --host claude --repo <snapshot> --plan <abs> --artifacts <dir> --timeout 7" "$(cat "$ARGV_FILE" 2>/dev/null || echo null)" \
    "JSON.stringify(j)" "$(node -e "process.stdout.write(JSON.stringify([process.argv[1], 'review', '--host', 'claude', '--repo', process.argv[2], '--plan', process.argv[3], '--artifacts', process.argv[4], '--timeout', '7']))" "$runner_real" "$SNAP" "$PHASE_PLAN" "$art")"
  assert_json "R11d stdout argv[0..1] is python3 + the copy's vendored runner (R22 argv arm)" "$U_OUT" "j.argv[0] + ' ' + j.argv[1]" "python3 $runner_real"
  assert_json "R11e the child received CODEX_HOME = the dedicated home" "$(cat "$ENV_FILE" 2>/dev/null || echo null)" "j.CODEX_HOME" "$XHOME"
  assert_json "R11f stdout names result_path, artifacts_run_dir under the artifacts dir, snapshot, empty baseline_delta" "$U_OUT" \
    "[j.result_path.endsWith('/result.json'), j.artifacts_run_dir.startsWith(require('fs').realpathSync(process.env.HOME) + '/.a1-xprov/artifacts/'), j.snapshot === '$SNAP', j.baseline_delta.length].join('/')" "true/true/true/0"
  local mode; mode="$(stat -f '%Lp' "$art" 2>/dev/null || stat -c '%a' "$art")"
  assert_eq "R11g artifacts root was pre-created 0700 by a1" "$mode" "700"
  run5 inspect --base "$PHASE_HEAD"
  assert_rc "R11h run --mode inspect --base <sha> exits 0" 0 "$U_RC" "$U_ERR"
  assert_json "R11i inspect argv appends --base <sha> and carries no --resume/--log" "$(cat "$ARGV_FILE")" \
    "j[1] + '/' + j.slice(-2).join(' ') + '/' + j.includes('--resume') + '/' + j.includes('--log')" "inspect/--base $PHASE_HEAD/false/false"
  local log="$PHASE_DIR/PLAN-REVIEW-LOG.md"
  [[ -f "$log" ]] && assert_eq "R11j PLAN-REVIEW-LOG.md gained one entry per run (verdict: pending)" "$(grep -c 'verdict: pending' "$log")" "2" || bad "R11j PLAN-REVIEW-LOG.md missing"
  grep -q "model_requested: CLI default (unresolved)" "$log" && grep -q "gate: $GATE_PLAN" "$log" && grep -q "result: " "$log" \
    && ok "R11k log entry carries gate, model_requested and the result path" || bad "R11k log entry incomplete"
  printf 'accepted: R1\n' > "$TMP05/dispositions.md"
  local prev; prev="$(jget "$U_OUT" 'j.result_path')"
  run5 review --resume "$prev" --feedback "$TMP05/dispositions.md"
  assert_json "R11l review resume appends --resume <result.json> --feedback <file>" "$(cat "$ARGV_FILE")" \
    "j.includes('--resume') + '/' + j[j.indexOf('--resume') + 1] + '/' + j[j.indexOf('--feedback') + 1]" "true/$prev/$TMP05/dispositions.md"
  # Reinhard W6: --no-log leaves the log untouched (the gate driver writes exactly one entry per call)
  local lines_before; lines_before="$(wc -l < "$log" | tr -d ' ')"
  run5 review --no-log
  assert_rc "R11m run --no-log exits 0" 0 "$U_RC" "$U_ERR"
  assert_eq "R11n run --no-log leaves PLAN-REVIEW-LOG.md unchanged" "$(wc -l < "$log" | tr -d ' ')" "$lines_before"
  local hdr; hdr="$(node -e "const r = require(process.argv[1]); process.stdout.write(r.LOG_HEADER.split('\n')[0] + '|' + r.NO_LOG_FLAG)" "$TREE/_shared/lib/xprov-run.cjs" 2>&1)"
  assert_eq "R11o run exports LOG_HEADER (first line) and NO_LOG_FLAG for the gate driver" "$hdr" "# PLAN-REVIEW-LOG — cross-provider runner calls|no-log"
}

# ---------- R15: the tripwire ----------
# Red-making changes, one per arm: R15b-d dropping the snapshot porcelain;
# R15k dropping --untracked-files=all (only a write into an ALREADY untracked
# directory tells the flag apart); S3 dropping the .git/ metadata hash; S4
# hashing only config.toml of the home.
caseR15() {
  prep5; snap5
  local before; before="$(porcelain_without_phase "$PHASE_REPO")"
  local n0; n0="$(rundirs_count)"
  FAKE_RUNNER_SIDE_EFFECT=write-into-repo run5 review
  assert_rc "R15a a runner that writes into the snapshot → exit 1" 1 "$U_RC" "$U_ERR"
  assert_json "R15b reason tripwire, delta names the written file, result discarded" "$U_OUT" \
    "j.reason + '/' + j.baseline_delta.join(',').includes('FAKE_RUNNER_WROTE_THIS.txt') + '/' + j.result_path" "tripwire/true/null"
  grep -q '^## BLOCKER' "$PHASE_DIR/XREVIEW.md" && grep -q 'FAKE_RUNNER_WROTE_THIS.txt' "$PHASE_DIR/XREVIEW.md" \
    && ok "R15c XREVIEW.md has a BLOCKER note naming the path" || bad "R15c XREVIEW note missing"
  assert_eq "R15d snapshot delta reverted (porcelain empty)" "$(porcelain "$SNAP")" ""
  assert_eq "R15e primary checkout porcelain unchanged by a1 (outside its own .a1/phases/ files)" "$(porcelain_without_phase "$PHASE_REPO")" "$before"
  assert_eq "R15e2 the only new entries under .a1/phases/ are XREVIEW.md and PLAN-REVIEW-LOG.md" \
    "$(porcelain "$PHASE_REPO" | grep ' .a1/phases/' | sed 's/.* //' | sort | tr '\n' ',')" ".a1/phases/p5/PLAN-REVIEW-LOG.md,.a1/phases/p5/XREVIEW.md,"
  assert_eq "R15f no findings file (normalize never ran on a discarded result)" "$(ls "$PHASE_DIR/xreview/"*.findings.json 2>/dev/null | wc -l | tr -d ' ')" "0"
  local bp1; bp1="$(jget "$U_OUT" 'j.baseline_path')"
  [[ "$bp1" == "$(node -e "process.stdout.write(require('os').tmpdir())")"* || "$bp1" == /private/var/* || "$bp1" == /tmp/* ]] && ok "R15g baseline file is a mktemp path under the temp dir" || bad "R15g baseline path: $bp1"
  assert_eq "R15h run dir of a tripwire run was removed (claudex-* count unchanged)" "$(rundirs_count)" "$n0"
  # baseline_path is reported on a tripwire only (the file is gone in finally); a
  # second tripwire run proves the path is fresh every time
  FAKE_RUNNER_SIDE_EFFECT=write-into-repo run5 review
  local bp2; bp2="$(jget "$U_OUT" 'j.baseline_path')"
  [[ "$bp1" != "$bp2" && "$bp2" != "undefined" && "$bp2" != "null" ]] && ok "R15i two tripwire runs report two different baseline paths (never a fixed /tmp file)" || bad "R15i baseline path reused or missing: $bp1 / $bp2"
  run5 review
  assert_json "R15i2 a successful run reports ok:true, baseline_delta [] and no baseline_path" "$U_OUT" "j.ok + '/' + j.baseline_delta.length + '/' + ('baseline_path' in j)" "true/0/false"
  grep -q 'FAKE_RUNNER_WROTE_THIS' "$U_OUT" && bad "R15j the follow-up run still sees the tripwire file" || ok "R15j follow-up run on the reverted snapshot is clean"
  # --untracked-files=all: scratch/ is already untracked; a NEW file inside it is
  # invisible to plain `git status --porcelain` (which prints `?? scratch/` before and after).
  mkdir -p "$PHASE_REPO/scratch"; printf 'a\n' > "$PHASE_REPO/scratch/a.txt"
  FAKE_RUNNER_WRITE_PATH="$PHASE_REPO/scratch/b.txt" run5 review
  assert_json "R15k a write into an already-untracked dir of the CHECKOUT → tripwire naming scratch/b.txt" "$U_OUT" \
    "j.reason + '/' + j.baseline_delta.some(d => d.includes('scratch/b.txt'))" "tripwire/true"
  rm -f "$PHASE_REPO/scratch/b.txt"
  # S3 — .git/ metadata of the checkout is part of the baseline
  FAKE_RUNNER_WRITE_PATH="$PHASE_REPO/.git/hooks/post-checkout" run5 review
  assert_json "S3a a new .git/hooks/post-checkout in the checkout → tripwire naming the hook" "$U_OUT" \
    "j.reason + '/' + j.baseline_delta.some(d => d.includes('.git/hooks/post-checkout'))" "tripwire/true"
  rm -f "$PHASE_REPO/.git/hooks/post-checkout"
  FAKE_RUNNER_WRITE_PATH="$PHASE_REPO/.git/info/exclude" run5 review
  assert_json "S3b a changed .git/info/exclude → tripwire" "$U_OUT" "j.reason + '/' + j.baseline_delta.some(d => d.includes('.git/info/exclude'))" "tripwire/true"
  # S4 — the WHOLE dedicated home is hashed (minus Codex runtime dirs)
  FAKE_RUNNER_WRITE_PATH="$XHOME/AGENTS.md" run5 review
  assert_json "S4a a new AGENTS.md in the dedicated home → tripwire naming AGENTS.md" "$U_OUT" "j.reason + '/' + j.baseline_delta.some(d => d.includes('AGENTS.md'))" "tripwire/true"
  rm -f "$XHOME/AGENTS.md"
  FAKE_RUNNER_WRITE_PATH="$XHOME/config.toml" run5 review
  assert_json "S4b an overwritten config.toml in the home → tripwire naming config.toml" "$U_OUT" "j.reason + '/' + j.baseline_delta.some(d => d.includes('config.toml'))" "tripwire/true"
  printf '%s\n' "$COMPLIANT_CONFIG" > "$XHOME/config.toml"
  mkdir -p "$XHOME/sessions"; FAKE_RUNNER_WRITE_PATH="$XHOME/sessions/rollout.jsonl" run5 review
  assert_rc "S4c a write into the home's sessions/ (Codex runtime dir) is NOT a tripwire" 0 "$U_RC" "$U_ERR"
  # S4d — Codex writes runtime FILES into the home ROOT on every real run (measured
  # 2026-09-25 after five live runs: .sandbox_migration, installation_id,
  # models_cache.json, *.sqlite(-shm|-wal), history.jsonl, version.json). They
  # are not configuration and must not trip. Red-making change: emptying
  # CODEX_RUNTIME_FILES (AGENTS.md stays a tripwire — S4a).
  FAKE_RUNNER_WRITE_PATH="$XHOME/history.jsonl" run5 review
  assert_rc "S4d1 a new history.jsonl in the home root is NOT a tripwire" 0 "$U_RC" "$U_ERR"
  FAKE_RUNNER_WRITE_PATH="$XHOME/state_5.sqlite-wal" run5 review
  assert_rc "S4d2 a new state_5.sqlite-wal in the home root is NOT a tripwire" 0 "$U_RC" "$U_ERR"
  FAKE_RUNNER_WRITE_PATH="$XHOME/hooks.json" run5 review
  assert_json "S4d3 a new hooks.json in the home root IS a tripwire (not a runtime file)" "$U_OUT" "j.reason + '/' + j.baseline_delta.some(d => d.includes('hooks.json'))" "tripwire/true"
  rm -f "$XHOME/hooks.json"
  # S3c — $WORK_PATH as a LINKED worktree: its --git-dir is .git/worktrees/<n> (no
  # hooks/), hooks live in the --git-common-dir. Red-making change: reading hooks
  # from --git-dir. The work repo is a separate clone so the checkout's own .git
  # cannot see the planted hook.
  local wmain="$TMP05/work-main-$RANDOM" wlinked; wlinked="$TMP05/work-linked-$RANDOM"
  git clone -q "$PHASE_REPO" "$wmain" && ( cd "$wmain" && git -c user.name=f -c user.email=f@example.invalid worktree add -q "$wlinked" -b lane-x )
  FAKE_RUNNER_WRITE_PATH="$wmain/.git/hooks/post-merge" run5 review --work-path "$wlinked"
  assert_json "S3d a hook planted in the common dir of a linked-worktree WORK_PATH → tripwire naming .git/hooks/post-merge" "$U_OUT" \
    "j.reason + '/' + j.baseline_delta.some(d => d.startsWith('work:') && d.includes('.git/hooks/post-merge'))" "tripwire/true"
}

# ---------- R16: the snapshot is a fresh, depth-limited fetch, never a copy ----------
# Red-making changes: R16b `cp -R` instead of a git fetch; S6b/c fetching the full
# history (a parent's secret becomes readable); S6d/f depth one short for inspect.
# `--no-hardlinks`/alternates (R16c/d) stay as regression guards but are
# untested by design: no fake reproduces a shared-object clone.
caseR16() {
  prep5
  printf 'node_modules/\n' > "$PHASE_REPO/.gitignore"; mkdir -p "$PHASE_REPO/node_modules"; printf 'ignored\n' > "$PHASE_REPO/node_modules/x"
  printf 'SECRET_LOOKING_BUT_UNTRACKED=1\n' > "$PHASE_REPO/.env"
  ( cd "$PHASE_REPO" && git add .gitignore && git commit -qm "ignore node_modules" ); PHASE_HEAD="$(cd "$PHASE_REPO" && git rev-parse HEAD)"
  snap5
  assert_rc "R16a snapshot exits 0 with an untracked .env and an ignored node_modules/x present" 0 "$S_RC" "$S_ERR"
  [[ -n "$SNAP" && -d "$SNAP" ]] || { bad "R16 no snapshot dir"; return; }
  [[ ! -e "$SNAP/.env" && ! -e "$SNAP/node_modules" && -f "$SNAP/.gitignore" && -f "$SNAP/src/add.js" ]] && ok "R16b untracked and ignored files absent, tracked files present" || bad "R16b snapshot contents wrong: $(ls -a "$SNAP" | tr '\n' ' ')"
  [[ -d "$SNAP/.git" && ! -f "$SNAP/.git" ]] && ok "R16c .git is a directory (not a worktree gitdir file)" || bad "R16c .git shape wrong"
  [[ ! -e "$SNAP/.git/objects/info/alternates" ]] && ok "R16d no objects/info/alternates (no shared-object clone)" || bad "R16d alternates present"
  assert_eq "R16e snapshot HEAD is the requested commit" "$(cd "$SNAP" && git rev-parse HEAD)" "$PHASE_HEAD"
  [[ "$SNAP" == "$HOME/.a1-xprov/snapshots/"* ]] && ok "R16f snapshot lives under \$HOME/.a1-xprov/snapshots/" || bad "R16f snapshot path: $SNAP"
  assert_json "R16g stdout JSON carries snapshot, commit, files_scanned" "$S_OUT" "j.commit + '/' + (j.files_scanned >= 2)" "$PHASE_HEAD/true"
  local mode; mode="$(stat -f '%Lp' "$HOME/.a1-xprov/snapshots" 2>/dev/null || stat -c '%a' "$HOME/.a1-xprov/snapshots")"
  assert_eq "R16h snapshots parent is 0700" "$mode" "700"
  ( cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --remove "$SNAP" >/dev/null 2>&1 ); local rc=$?
  [[ $rc -eq 0 && ! -e "$SNAP" ]] && ok "R16i snapshot --remove deletes the clone" || bad "R16i remove (rc=$rc exists=$([[ -e "$SNAP" ]] && echo yes || echo no))"
  ( cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --remove "$PHASE_REPO" >/dev/null 2>&1 ); rc=$?
  [[ $rc -eq 2 && -d "$PHASE_REPO/.git" ]] && ok "R16j snapshot --remove refuses a path outside snapshots/ (exit 2, checkout intact)" || bad "R16j remove outside (rc=$rc)"
  local n_before; n_before="$(snapshots_count)"
  snap5 0000000000000000000000000000000000000000
  assert_json "R16k unknown commit → snapshot_failed, exit 1" "$S_OUT" "j.reason + '/' + String($S_RC)" "snapshot_failed/1"
  assert_eq "R16l no snapshot dir left behind after a failed fetch" "$(snapshots_count)" "$n_before"
  snap5 --force
  [[ $S_RC -eq 2 && -z "$S_OUT" ]] && ok "R16m --commit --force (leading dash) → exit 2, no git call with an option-shaped revision" || bad "R16m dash commit (rc=$S_RC out=$S_OUT)"

  # S6 — depth. Three commits: c1 carries a secret that c2 removes, c3 is HEAD.
  prep5
  printf 'const key = "AKIA%s";\n' "$(head -c 16 /dev/zero | tr '\0' 'H')" > "$PHASE_REPO/src/leak.js"; commit5 "c1 with secret"
  rm "$PHASE_REPO/src/leak.js"; printf 'clean\n' > "$PHASE_REPO/src/c2.js"; commit5 "c2 removes it"
  printf 'more\n' >> "$PHASE_REPO/src/c2.js"; commit5 "c3"
  local base2; base2="$(cd "$PHASE_REPO" && git rev-parse HEAD~2)"
  snap5
  assert_rc "S6a review snapshot of a 3-commit repo exits 0 (working tree is clean)" 0 "$S_RC" "$S_ERR"
  assert_eq "S6b review snapshot holds exactly one commit" "$(cd "$SNAP" && git rev-list --count HEAD)" "1"
  assert_eq "S6c the parent commit's secret is not readable from the snapshot history" "$(cd "$SNAP" && git log -p --all 2>/dev/null | grep -c 'AKIAHHHH')" "0"
  FAKE_RUNNER_CASE=approved run5 inspect --base "$base2"
  assert_json "S6d inspect against a review-depth snapshot → runner_failed (base unreachable), never a crash" "$U_OUT" "j.reason + '/' + String($U_RC)" "runner_failed/1"
  snap5 "$PHASE_HEAD" "$base2"
  assert_rc "S6e inspect snapshot with --base HEAD~2 exits 0" 0 "$S_RC" "$S_ERR"
  assert_eq "S6f inspect snapshot depth = rev-list --count base..commit + 1 = 3 commits" "$(cd "$SNAP" && git rev-list --count HEAD)" "3"
  ( cd "$SNAP" && git diff --quiet "$base2" HEAD ); rc=$?
  [[ $rc -eq 0 || $rc -eq 1 ]] && ok "S6g git diff <base> HEAD works inside the inspect snapshot (rc=$rc)" || bad "S6g base not resolvable in the inspect snapshot (rc=$rc)"
  FAKE_RUNNER_CASE=approved run5 inspect --base "$base2"
  assert_rc "S6h run --mode inspect on the depth-correct snapshot exits 0" 0 "$U_RC" "$U_ERR"
}

# ---------- R17: no snapshot with a secret ever reaches the runner ----------
# Red-making changes: R17a scanning after dispatch (or not at all); S5a-c skipping
# UTF-16, NUL-prefixed or > 5 MB files; R17e/f ignoring gitleaks / loading the
# reviewed repo's own .gitleaks.toml.
caseR17() {
  prep5
  printf 'const key = "AKIA%s";\n' "$(head -c 16 /dev/zero | tr '\0' 'Q')" > "$PHASE_REPO/src/config.js"; commit5 "leak"
  local argv_before; argv_before="$(ls "$ARGV_DIR" | wc -l | tr -d ' ')"
  local n_before; n_before="$(snapshots_count)"
  snap5
  assert_json "R17a tracked AKIA… → secret_in_snapshot with the pattern NAME" "$S_OUT" "j.reason + '/' + j.secret_pattern + '/' + String($S_RC)" "secret_in_snapshot/aws_access_key_id/1"
  [[ "$S_OUT$S_ERR" != *"AKIAQQQQ"* ]] && ok "R17b the matched text is not in stdout or stderr" || bad "R17b secret text leaked"
  assert_eq "R17c snapshot dir gone (count unchanged)" "$(snapshots_count)" "$n_before"
  if [[ -n "$SNAP" && -d "$SNAP" ]]; then run5 review; fi
  assert_eq "R17d the runner was never invoked (no new argv file)" "$(ls "$ARGV_DIR" | wc -l | tr -d ' ')" "$argv_before"
  # S5 — nothing is skipped: UTF-16LE, NUL-prefixed and oversized tracked files are scanned
  prep5
  node -e "require('fs').writeFileSync(process.argv[1], Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('KEY=AKIA' + 'U'.repeat(16) + '\n', 'utf16le')]))" "$PHASE_REPO/.env.utf16"; commit5 "utf16"
  snap5; assert_json "S5a UTF-16LE tracked file with AKIA → secret_in_snapshot" "$S_OUT" "j.reason + '/' + j.secret_pattern" "secret_in_snapshot/aws_access_key_id"
  prep5
  node -e "require('fs').writeFileSync(process.argv[1], Buffer.concat([Buffer.alloc(16), Buffer.from('ghp_' + 'N'.repeat(36))]))" "$PHASE_REPO/blob.bin"; commit5 "nul-prefixed"
  snap5; assert_json "S5b NUL-prefixed file (would sniff as binary) with a ghp_ token → secret_in_snapshot" "$S_OUT" "j.reason + '/' + j.secret_pattern" "secret_in_snapshot/github_pat_classic"
  prep5
  node -e "const fs = require('fs'); const fd = fs.openSync(process.argv[1], 'w'); fs.writeSync(fd, Buffer.alloc(5 * 1024 * 1024 + 4096, 0x61)); fs.writeSync(fd, 'tail AKIA' + 'B'.repeat(16) + '\n'); fs.closeSync(fd);" "$PHASE_REPO/big.txt"; commit5 "big"
  snap5; assert_json "S5c 5 MB + 4 KiB tracked file with the secret at the END → secret_in_snapshot (windowed scan)" "$S_OUT" "j.reason + '/' + j.secret_pattern" "secret_in_snapshot/aws_access_key_id"
  prep5; snap5
  assert_json "S5d a clean repo reports files_skipped 0 (nothing is ever skipped)" "$S_OUT" "String(j.files_skipped)" "0"
  # gitleaks on PATH saying "leak" is a hit too, and it never loads the reviewed repo's config
  prep5; printf '[allowlist]\npaths = [".*"]\n' > "$PHASE_REPO/.gitleaks.toml"; commit5 "hostile gitleaks config"
  n_before="$(snapshots_count)"
  FAKE_GITLEAKS_EXIT=1 FAKE_GITLEAKS_ARGV_FILE="$TMP05/gitleaks-argv.txt" snap5
  assert_json "R17e fake gitleaks exit 1 → secret_in_snapshot (pattern gitleaks)" "$S_OUT" "j.reason + '/' + j.secret_pattern" "secret_in_snapshot/gitleaks"
  local gl; gl="$(cat "$TMP05/gitleaks-argv.txt" 2>/dev/null)"
  [[ "$gl" == detect\ --no-git\ --source\ *\ --no-banner\ --redact\ --config\ */_shared/lib/xprov-gitleaks.toml ]] \
    && ok "R17f gitleaks argv: detect --no-git --source <dir> --no-banner --redact --config <a1's own toml>" || bad "R17f gitleaks argv: $gl"
  assert_eq "R17g snapshot dir gone after the gitleaks hit (count unchanged)" "$(snapshots_count)" "$n_before"
}

# ---------- R24: runner-only use, usage errors, permission before spawn ----------
# Red-making changes: allowing --mode build (both guards), skipping permitCheck;
# S1 accepting any header path as run dir / not checking the pin; S2 passing
# the parent environment wholesale.
caseR24() {
  prep5; snap5
  local before; before="$(ls "$ARGV_DIR" | wc -l | tr -d ' ')"
  run5 build
  [[ $U_RC -eq 2 && -z "$U_OUT" ]] && ok "R24a --mode build → exit 2, no stdout JSON" || bad "R24a build (rc=$U_RC out=$U_OUT)"
  assert_eq "R24b --mode build spawned nothing (no argv file)" "$(ls "$ARGV_DIR" | wc -l | tr -d ' ')" "$before"
  run5 inspect
  [[ $U_RC -eq 2 ]] && ok "R24c inspect without --base → exit 2" || bad "R24c inspect without base (rc=$U_RC)"
  run5 inspect --base "$PHASE_HEAD" --resume "$TMP05/x.json"
  [[ $U_RC -eq 2 ]] && ok "R24d inspect with --resume → exit 2 (always a fresh session)" || bad "R24d inspect resume (rc=$U_RC)"
  local bad_tokens=0 f
  for f in "$ARGV_DIR"/argv-*.json; do
    node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.exit(j.some(a => a === 'build' || a === '--unreviewed-spec' || a === '--proof') ? 1 : 0)" "$f" || bad_tokens=$((bad_tokens + 1))
  done
  assert_eq "R24e no recorded argv in this part contains build / --unreviewed-spec / --proof" "$bad_tokens" "0"
  U_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov run --mode review --snapshot "$SNAP" --plan "$PHASE_PLAN" --phase ../../etc --gate "$GATE_PLAN" 2>"$TMP05/h.txt")"; U_RC=$?
  [[ $U_RC -eq 2 && -z "$U_OUT" && "$(cat "$TMP05/h.txt")" == *"../../etc"* ]] && ok "R24f --phase ../../etc → exit 2 naming the segment" || bad "R24f hostile phase (rc=$U_RC)"
  U_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov run --mode review --snapshot "$TMP05/does-not-exist" --plan "$PHASE_PLAN" --phase p5 --gate "$GATE_PLAN" 2>/dev/null)"; U_RC=$?
  [[ $U_RC -eq 2 ]] && ok "R24g missing --snapshot dir → exit 2" || bad "R24g missing snapshot (rc=$U_RC)"
  U_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov run --mode review --snapshot "$SNAP" --plan ".a1/phases/p5/PLAN.md" --phase p5 --gate "$GATE_PLAN" 2>/dev/null)"; U_RC=$?
  [[ $U_RC -eq 2 ]] && ok "R24h relative --plan → exit 2" || bad "R24h relative plan (rc=$U_RC)"
  run5 review --lane 'a;b'
  [[ $U_RC -eq 2 ]] && ok "R24k --lane with shell metacharacters → exit 2" || bad "R24k lane (rc=$U_RC)"
  rm -f "$PHASE_REPO/.a1/xprov.json"; before="$(ls "$ARGV_DIR" | wc -l | tr -d ' ')"
  run5 review
  assert_json "R24i without .a1/xprov.json → exit 1 external_review_not_permitted" "$U_OUT" "j.reason + '/' + String($U_RC)" "external_review_not_permitted/1"
  assert_eq "R24j permission failure spawned nothing" "$(ls "$ARGV_DIR" | wc -l | tr -d ' ')" "$before"

  # S1 — the run dir comes from the runner header: only under the artifacts dir and claudex-*
  prep5; snap5
  FAKE_RUNNER_HEADER_ARTIFACTS="$PHASE_REPO" FAKE_RUNNER_EXIT=1 run5 review
  assert_json "S1a header artifacts=<checkout> + exit 1 → runner_failed" "$U_OUT" "j.reason + '/' + String($U_RC)" "runner_failed/1"
  [[ -d "$PHASE_REPO/.git" && -f "$PHASE_REPO/src/add.js" && -f "$PHASE_PLAN" ]] && ok "S1b the checkout survived a hostile artifacts header (.git, src, PLAN.md intact)" || bad "S1b CHECKOUT DAMAGED"
  FAKE_RUNNER_HEADER_ARTIFACTS="$HOME/.a1-xprov/artifacts/$(basename "$PHASE_REPO")" FAKE_RUNNER_EXIT=1 run5 review
  [[ -d "$HOME/.a1-xprov/artifacts/$(basename "$PHASE_REPO")" ]] && ok "S1c header pointing at the artifacts ROOT (not a claudex-* dir) is not removed either" || bad "S1c artifacts root deleted"
  # S1d — runner pin checked before the spawn. The PIN is corrupted, not the
  # runner: a flipped runner byte would die with a SyntaxError and look like
  # runner_failed even without the check (that was the surviving mutation MW2),
  # while a wrong SHA256SUMS leaves a perfectly runnable fake — only the pin
  # check can stop it. Red-making change: skipping checkRunnerPin() in run.
  before="$(ls "$ARGV_DIR" | wc -l | tr -d ' ')"
  cp "$TREE_VENDOR/SHA256SUMS" "$TMP05/sums.bak"
  printf '%s  runner.py\n' "$(head -c 64 /dev/zero | tr '\0' 'f')" > "$TREE_VENDOR/SHA256SUMS"
  run5 review
  assert_json "S1d SHA256SUMS ≠ vendored runner → runner_failed with reason_detail naming 'runner pin'" "$U_OUT" \
    "j.reason + '/' + j.reason_detail.includes('runner pin') + '/' + String($U_RC)" "runner_failed/true/1"
  assert_eq "S1e pin mismatch spawned nothing (no new argv file)" "$(ls "$ARGV_DIR" | wc -l | tr -d ' ')" "$before"
  cp "$TMP05/sums.bak" "$TREE_VENDOR/SHA256SUMS"

  # S2 — env allowlist
  prep5; snap5
  # (GIT_DIR is asserted absent below but not planted: it would also break a1's OWN git calls in this process)
  OPENAI_BASE_URL=https://evil.example PYTHONPATH=/tmp/evil A1_XPROV_SOMETHING=x HTTPS_PROXY=http://p NODE_OPTIONS=--max-old-space-size=64 run5 review
  assert_rc "S2a run with hostile parent env still exits 0" 0 "$U_RC" "$U_ERR"
  assert_json "S2b OPENAI_BASE_URL / PYTHONPATH / A1_XPROV_* / HTTPS_PROXY / GIT_DIR do not reach the runner; PATH, HOME, CODEX_HOME do" "$(cat "$ENV_FILE")" \
    "['OPENAI_BASE_URL', 'PYTHONPATH', 'A1_XPROV_SOMETHING', 'HTTPS_PROXY', 'NODE_OPTIONS', 'GIT_DIR', 'A1_XPROV_CODEX_HOME'].filter(k => k in j).join(',') + '|' + ['PATH', 'HOME', 'CODEX_HOME'].every(k => k in j)" "|true"
}

# ---------- R18d (moved from part 03): run dir retention and bounds ----------
# Red-making changes: removing the run dir on secret_in_output; keeping it on
# runner_failed; reading result.json/reply.txt without a size bound.
caseR18d() {
  prep5; snap5
  local token; token="ghp_$(head -c 36 /dev/zero | tr '\0' 'W')"
  FAKE_RUNNER_REPLY="leaked $token" run5 review
  assert_json "R18d1 secret in reply.txt → run exits 1 secret_in_output with the pattern name only" "$U_OUT" "j.reason + '/' + j.secret_pattern + '/' + String($U_RC)" "secret_in_output/github_pat_classic/1"
  local rd; rd="$(jget "$U_OUT" 'j.artifacts_run_dir')"
  [[ -d "$rd" && -f "$rd/reply.txt" ]] && ok "R18d2 run dir and reply.txt kept for the user on secret_in_output" || bad "R18d2 run dir missing: $rd"
  [[ "$U_OUT$U_ERR" != *"$token"* ]] && ok "R18d3 token text absent from stdout/stderr" || bad "R18d3 token leaked"
  head -c 5242881 /dev/zero | tr '\0' 'r' > "$TMP05/bigreply.txt"
  FAKE_RUNNER_REPLY="$TMP05/bigreply.txt" run5 review
  assert_json "R18d3b reply.txt > 5 MB → malformed naming reply.txt, run dir kept" "$U_OUT" \
    "j.reason + '/' + /reply\.txt/.test(j.reason_detail) + '/' + require('fs').existsSync(String(j.artifacts_run_dir) + '/reply.txt') + '/' + String($U_RC)" "malformed/true/true/1"
  rm -rf "$(jget "$U_OUT" 'j.artifacts_run_dir')"
  node -e "const fs = require('fs'); const s = fs.readFileSync(process.argv[1], 'utf8').trimEnd(); fs.writeFileSync(process.argv[2], s + ' '.repeat(5242881 - Buffer.byteLength(s)));" "$CASES/approved.result.json" "$TMP05/bigresult.json"
  FAKE_RUNNER_CASE="$TMP05/bigresult.json" run5 review
  assert_json "R18d3c result.json > 5 MB → malformed naming result.json, run dir kept" "$U_OUT" \
    "j.reason + '/' + /result\.json/.test(j.reason_detail) + '/' + require('fs').existsSync(String(j.artifacts_run_dir) + '/result.json')" "malformed/true/true"
  rm -rf "$(jget "$U_OUT" 'j.artifacts_run_dir')"
  local dirs_before; dirs_before="$(rundirs_count)"
  FAKE_RUNNER_EXIT=1 FAKE_RUNNER_CASE=failed run5 review
  assert_json "R18d4 runner exit 1 → runner_failed, exit 1" "$U_OUT" "j.reason + '/' + String($U_RC)" "runner_failed/1"
  assert_eq "R18d5 run dir removed on runner_failed (claudex-* count unchanged)" "$(rundirs_count)" "$dirs_before"
  FAKE_RUNNER_REFUSE=1 run5 review
  assert_json "R18d6 pre-run_dir refusal (stderr line, no JSON) → runner_failed with the stderr tail as reason_detail" "$U_OUT" \
    "j.reason + '/' + /claudex-loop: Keep run artifacts/.test(j.reason_detail) + '/' + j.result_path" "runner_failed/true/null"
  assert_eq "R18d7 exactly one run dir remains in the artifacts dir (the secret_in_output one)" "$(rundirs_count)" "1"
  # S7 — spawn options: timeout with grace and SIGKILL (measured on the exported builder; a live
  # 60 s+ grace period is too slow for the suite)
  local so; so="$(node -e "const r = require(process.argv[1]); const o = r.spawnOptions({ timeout: 7, snapshot: '/x' }); process.stdout.write(o.timeout + '/' + o.killSignal + '/' + (o.env.CODEX_HOME !== undefined))" "$TREE/_shared/lib/xprov-run.cjs" 2>&1)"
  assert_eq "S7a spawn options: timeout = (7 + 60) s, killSignal SIGKILL, CODEX_HOME set" "$so" "67000/SIGKILL/true"
}

# ---------- RC: repo-local .codex/, AGENTS.md, AGENTS.override.md are removed from the snapshot working tree and logged ----------
# Decision (team lead, Samuel W5 MAJOR 7): the measured `features list` identity only
# proves [features] is not read; the files are stripped from the WORKING TREE after
# the checkout (rm, not git rm — both baselines see the same state) and their
# presence in the reviewed commit is logged. Red-making change: keeping the files.
caseRC() {
  prep5
  mkdir -p "$PHASE_REPO/.codex/hooks"; printf '[features]\nplugins = true\n' > "$PHASE_REPO/.codex/config.toml"; printf 'x\n' > "$PHASE_REPO/.codex/hooks/pre.sh"
  printf '# agents\n' > "$PHASE_REPO/AGENTS.md"; printf '# override\n' > "$PHASE_REPO/AGENTS.override.md"; commit5 "repo-local codex files"
  snap5
  assert_rc "RC1 snapshot exits 0" 0 "$S_RC" "$S_ERR"
  [[ ! -e "$SNAP/.codex" && ! -e "$SNAP/AGENTS.md" && ! -e "$SNAP/AGENTS.override.md" && -f "$SNAP/src/add.js" ]] && ok "RC2 .codex/, AGENTS.md, AGENTS.override.md are absent from the snapshot working tree; other files stay" || bad "RC2 snapshot tree: $(ls -a "$SNAP" | tr '\n' ' ')"
  assert_json "RC3 snapshot stdout lists what it removed" "$S_OUT" "j.repo_local_removed.sort().join(',')" ".codex,AGENTS.md,AGENTS.override.md"
  run5 review
  assert_rc "RC4 run exits 0 on such a snapshot" 0 "$U_RC" "$U_ERR"
  assert_json "RC5 stdout snapshot_notes flag the tracked repo-local files (via git ls-files)" "$U_OUT" "j.snapshot_notes.repo_local_codex_config + '/' + j.snapshot_notes.agents_md" "true/true"
  grep -q 'repo_local_codex_config: true' "$PHASE_DIR/PLAN-REVIEW-LOG.md" && grep -q 'agents_md: true' "$PHASE_DIR/PLAN-REVIEW-LOG.md" && ok "RC6 PLAN-REVIEW-LOG.md entry carries both flags" || bad "RC6 log lacks the flags"
  grep -q 'repo-local' "$PHASE_DIR/XREVIEW.md" && ok "RC7 XREVIEW.md carries a note about the removed repo-local files" || bad "RC7 no XREVIEW note"
  [[ "$U_ERR" == *".codex/config.toml"* ]] && ok "RC8 stderr note names the repo-local config" || bad "RC8 no stderr note"
  # RC9 — order: permit before ANY a1 write. A repo without .a1/xprov.json must not
  # even receive the repo-local XREVIEW note. Red-making change: snapshotNotes +
  # appendXreviewNote before permitCheck.
  prep5; printf '# agents\n' > "$PHASE_REPO/AGENTS.md"; commit5 "agents only"; snap5
  rm -f "$PHASE_REPO/.a1/xprov.json"
  run5 review
  assert_json "RC9a without .a1/xprov.json → external_review_not_permitted" "$U_OUT" "j.reason + '/' + String($U_RC)" "external_review_not_permitted/1"
  [[ ! -e "$PHASE_DIR/XREVIEW.md" && ! -e "$PHASE_DIR/PLAN-REVIEW-LOG.md" ]] && ok "RC9b no XREVIEW.md and no PLAN-REVIEW-LOG.md written before the permit check" \
    || bad "RC9b a1 wrote into the phase dir of a non-permitted repo: $(ls "$PHASE_DIR" | tr '\n' ' ')"
}

caseR11; caseR15; caseR16; caseR17; caseR24; caseR18d; caseRC
unset A1_XPROV_CODEX_HOME
export HOME="$SAVED_HOME_05"
