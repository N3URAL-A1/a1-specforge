# Part 07 — spec 027 Task 3.2: `a1-tools run record` (FR-035, D4, D5, D10).
# Sourced by run-tests.sh. Planted repos from mk_workdir; A1_VAULT_ROOT is set per call;
# records are appended in-process through the real appendGateLine.
#
# RED-proof (apply one mutation on a scratch copy, the named case goes red):
#   idempotence check (alreadyRecorded) removed        : RR2 red
#   storeDir() creates the store (vaultRoot-style)     : RR4 red (dirs created)
#   mainCheckoutDir() returns the worktree itself      : RR9 red

RR_GL="$SHARED/lib/gate-log.cjs"
RR_SHA="$(printf 'c%.0s' $(seq 1 40))"

# rr_repo <VAR> <label> [roadmap-project] — temp repo with a base commit.
rr_repo() {
  local __r
  mk_workdir __r "$2"
  git -C "$__r" init -q -b main
  if [[ -n "${3:-}" ]]; then
    mkdir -p "$__r/docs/product"; printf -- '---\nproject: %s\n---\n# Roadmap\n' "$3" > "$__r/docs/product/ROADMAP.md"
  fi
  echo a > "$__r/a.txt"; git -C "$__r" add -A
  git -C "$__r" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm one
  printf -v "$1" '%s' "$__r"
}

# rr_store <VAR> <label> — vault with an existing learning store.
rr_store() { local __v; mk_workdir __v "$2"; mkdir -p "$__v/pattern/a1-learnings"; printf -v "$1" '%s' "$__v"; }

# rr_plant <repo> <scope> <json-array of {gate,exit,dur?,why?}> — appends through appendGateLine.
rr_plant() {
  GL="$RR_GL" SHA="$RR_SHA" node -e '
    const gl=require(process.env.GL); const [repo,scope,spec]=process.argv.slice(1);
    for (const s of JSON.parse(spec)) {
      const extra = s.why ? { ci_evidence_why: s.why } : undefined;
      gl.appendGateLine({ root: repo, scope, gateId: s.gate, verdict: gl.verdictForExit(s.exit), exitCode: s.exit, headSha: process.env.SHA,
        startedAt: s.dur === undefined ? undefined : new Date().toISOString(), durationMs: s.dur, extra });
    }' "$1" "$2" "$3"
}

# rr_json <file> <expr over l = parsed lines>
rr_json() { node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse); process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }

rr_run() { # <vault> <args...> — sets OUT (stdout+stderr), RC, cwd = a non-repo dir
  local v="$1"; shift
  OUT="$(cd "$RR_CWD" && A1_VAULT_ROOT="$v" node "$TOOLS" run record "$@" 2>&1)"; RC=$?
}
mk_workdir RR_CWD rr-cwd

# RR1
rr_repo RR1P rr1 fx-proj; rr_store RR1V rr1v
rr_plant "$RR1P" pr-7 '[{"gate":"realpath-check","exit":1,"dur":10},{"gate":"realpath-check","exit":0,"dur":20},{"gate":"verify-run","exit":0,"dur":5},{"gate":"pr-merge-check","exit":0,"dur":7,"why":"ok"},{"gate":"pr-merge-check","exit":0,"dur":9,"why":"ok"},{"gate":"pr-merge-check","exit":0}]'
rr_run "$RR1V" --repo "$RR1P" --scope pr-7 --pr 7
assert_rc "RR1a run record exits 0" 0 "$RC" "$OUT"
RR1F="$RR1V/pattern/a1-learnings/_runs/fx-proj.jsonl"
assert_eq "RR1b one line" "$(rr_json "$RR1F" 'l.length')" "1"
assert_eq "RR1c gate objects exact" "$(rr_json "$RR1F" 'JSON.stringify(l[0].gates)')" '[{"id":"realpath-check","verdict":"pass","caught":true,"runs":2,"duration_ms_sum":30,"no_duration":0},{"id":"verify-run","verdict":"pass","caught":false,"runs":1,"duration_ms_sum":5,"no_duration":0},{"id":"pr-merge-check","verdict":"pass","caught":false,"runs":3,"duration_ms_sum":16,"no_duration":1,"ci_evidence_why":{"ok":2,"unknown":1}}]'
assert_eq "RR1d scope, pr, head_sha, project, schema" "$(rr_json "$RR1F" '[l[0].scope,l[0].pr,l[0].head_sha,l[0].project,l[0].schema].join()')" "pr-7,7,$RR_SHA,fx-proj,1"

# RR2
RR2H="$(sha256sum "$RR1F" | cut -d' ' -f1)"
rr_run "$RR1V" --repo "$RR1P" --scope pr-7 --pr 7
assert_rc "RR2a second call exits 0" 0 "$RC" "$OUT"
assert_has "RR2b already_recorded" "$OUT" "already_recorded"
assert_eq "RR2c file unchanged" "$(sha256sum "$RR1F" | cut -d' ' -f1)" "$RR2H"

# RR3
rr_repo RR3P rr3 fx-proj; rr_store RR3V rr3v
rr_plant "$RR3P" pr-9 '[{"gate":"verify-run","exit":0,"dur":3}]'
rr_run "$RR3V" --repo "$RR3P" --scope pr-9; rr_run "$RR3V" --repo "$RR3P" --scope pr-9 --pr 8; rr_run "$RR3V" --repo "$RR3P" --scope pr-9 --pr 8
RR3F="$RR3V/pattern/a1-learnings/_runs/fx-proj.jsonl"
assert_eq "RR3 no pr, pr 8, repeat of pr 8 -> 2 lines" "$(rr_json "$RR3F" 'l.length+":"+JSON.stringify(l.map(x=>x.pr))')" "2:[null,8]"
rr_run "$RR3V" --repo "$RR1P" --scope pr-7 --pr 7
assert_eq "RR3b a different repo with the same project appends (3 lines)" "$(rr_json "$RR3F" 'l.length')" "3"

# RR4
mk_workdir RR4E rr4-empty
rr_run "$RR4E" --repo "$RR1P" --scope pr-7 --pr 7
assert_rc "RR4a empty vault: exit 1" 1 "$RC" "$OUT"
assert_has "RR4a reason no_learning_store" "$OUT" "no_learning_store"
assert_eq "RR4a nothing created" "$(find "$RR4E" -mindepth 1 | wc -l | tr -d ' ')" "0"
mk_workdir RR4H rr4-home; mk_workdir RR4N rr4-nogit
OUT="$(cd "$RR4N" && env -u A1_VAULT_ROOT HOME="$RR4H" node "$TOOLS" run record --repo "$RR1P" --scope pr-7 --pr 7 2>&1)"; RC=$?
assert_rc "RR4b no vault, no repo, empty HOME: exit 1" 1 "$RC" "$OUT"
assert_eq "RR4b nothing created in HOME" "$(find "$RR4H" -mindepth 1 | wc -l | tr -d ' ')" "0"

# RR5
rr_repo RR5P rr5 fx-proj; rr_store RR5V rr5v
rr_run "$RR5V" --repo "$RR5P" --scope pr-3 --pr 3
assert_rc "RR5a missing log: exit 1" 1 "$RC" "$OUT"; assert_has "RR5a reason" "$OUT" "no_gate_log"
rr_plant "$RR5P" pr-3 '[{"gate":"verify-run","exit":0,"dur":3},{"gate":"verify-run","exit":0,"dur":4}]'
node -e 'const fs=require("fs");const f=process.argv[1];const a=fs.readFileSync(f,"utf8").split("\n").filter(Boolean);const r=JSON.parse(a[a.length-1]);r.prev="1".repeat(64);a[a.length-1]=JSON.stringify(r);fs.writeFileSync(f,a.join("\n")+"\n")' "$RR5P/.a1/phases/pr-3/gate-log.jsonl"
rr_run "$RR5V" --repo "$RR5P" --scope pr-3 --pr 3
assert_rc "RR5b tampered chain: exit 1" 1 "$RC" "$OUT"; assert_has "RR5b reason" "$OUT" "gate_log_untrusted"
assert_eq "RR5c store file not created" "$([[ -e "$RR5V/pattern/a1-learnings/_runs/fx-proj.jsonl" ]] && echo yes || echo no)" "no"

# RR6
rr_repo RR6P rr6 fx-proj; rr_store RR6V rr6v
mkdir -p "$RR6P/.a1/phases/pr-1"; cp "$FIXT/gatelog/old-format.jsonl" "$RR6P/.a1/phases/pr-1/gate-log.jsonl"
rr_run "$RR6V" --repo "$RR6P" --scope pr-1 --pr 1
assert_rc "RR6a old-format log records" 0 "$RC" "$OUT"
assert_eq "RR6b old lines: duration_ms_sum null, no_duration 3 (summed over the gates)" "$(rr_json "$RR6V/pattern/a1-learnings/_runs/fx-proj.jsonl" 'l[0].gates.every(g=>g.duration_ms_sum===null)+":"+l[0].gates.reduce((a,g)=>a+g.no_duration,0)')" "true:3"

# RR7
rr_repo RR7P rr7 fx-proj; rr_plant "$RR7P" pr-2 '[{"gate":"verify-run","exit":0,"dur":3}]'
mk_workdir RR7V rr7v; mkdir -p "$RR7V/pattern/a1-learnings"; mk_workdir RR7O rr7-out
ln -s "$RR7O" "$RR7V/pattern/a1-learnings/_runs"
rr_run "$RR7V" --repo "$RR7P" --scope pr-2 --pr 2
assert_rc "RR7a _runs symlink: exit 2" 2 "$RC" "$OUT"
assert_eq "RR7a outside dir stays empty" "$(find "$RR7O" -mindepth 1 | wc -l | tr -d ' ')" "0"
rm "$RR7V/pattern/a1-learnings/_runs"; mkdir "$RR7V/pattern/a1-learnings/_runs"; echo '{}' > "$RR7O/target.jsonl"
ln -s "$RR7O/target.jsonl" "$RR7V/pattern/a1-learnings/_runs/fx-proj.jsonl"
rr_run "$RR7V" --repo "$RR7P" --scope pr-2 --pr 2
assert_rc "RR7b runs file symlink: exit 2" 2 "$RC" "$OUT"
assert_eq "RR7b link target unchanged" "$(cat "$RR7O/target.jsonl")" "{}"

# RR8
rr_run "$RR1V" --repo "$RR1P" --scope ../../x;                      assert_rc "RR8a scope traversal" 2 "$RC"
rr_run "$RR1V" --repo "$RR1P" --scope pr-7 --pr abc;                assert_rc "RR8b bad pr" 2 "$RC"
rr_run "$RR1V" --repo "$(printf 'x%.0s' $(seq 1 10000))" --scope pr-7; assert_rc "RR8c 10000-char repo" 2 "$RC"
rr_run "$RR1V" --repo "$RR1P" --scope pr-7 --bogus;                 assert_rc "RR8d unknown flag" 2 "$RC"
OUT="$(cd "$RR_CWD" && A1_VAULT_ROOT="$RR1V" node "$TOOLS" run 2>&1)"; RC=$?; assert_rc "RR8e run without sub" 2 "$RC" "$OUT"
rr_run "$RR1V" --repo "$RR1P" --scope 'pr-7$(touch PWNED)';        assert_rc "RR8f command substitution in scope" 2 "$RC"
assert_eq "RR8f no PWNED file" "$(find "$RR_CWD" "$RR1P" "$RR1V" -name PWNED | wc -l | tr -d ' ')" "0"
rr_run "$RR1V" --repo "$RR1P" --scope pr-7 stray;                   assert_rc "RR8g stray positional" 2 "$RC"

# RR9
mk_workdir RR9B rr9-base; RR9M="$RR9B/mainrepo-x"; mkdir -p "$RR9M"
git -C "$RR9M" init -q -b main; echo a > "$RR9M/a.txt"; git -C "$RR9M" add -A
git -C "$RR9M" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm one
git -C "$RR9M" worktree add -q "$RR9B/wt-feature" -b feat
rr_plant "$RR9B/wt-feature" pr-4 '[{"gate":"verify-run","exit":0,"dur":3}]'
rr_store RR9V rr9v
rr_run "$RR9V" --repo "$RR9B/wt-feature" --scope pr-4 --pr 4
assert_eq "RR9 worktree: the file is named after the main checkout" "$(ls "$RR9V/pattern/a1-learnings/_runs" 2>/dev/null | tr '\n' ',')" "mainrepo-x.jsonl,"

# RR10
RR10="$(GL="$SHARED/lib/retro-gatelog.cjs" node -e '
  const r=require(process.env.GL);
  const recs=[{gate:"a",verdict:"fail"},{gate:"a",verdict:"pass"},{gate:"b",verdict:"error"},{gate:"c",verdict:"pass"}];
  const items=r.gatesFired(recs).map(g=>`  - {id: ${g.id}, verdict: ${g.verdict}, caught: ${g.caught}}`);
  console.log(r.firedYaml(recs)===`gates_fired:\n${items.join("\n")}\n`, r.gatesFired(recs).map(g=>g.id+g.caught).join())')"
assert_eq "RR10 gatesFired equals the firedYaml items" "$RR10" "true atrue,btrue,cfalse"
