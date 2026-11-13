# Part 07 — spec 027 Task 3.2: `a1-tools run record` (FR-035, D4, D5, D10).
# Sourced by run-tests.sh. Planted repos from mk_workdir; A1_VAULT_ROOT is set per call;
# records are appended in-process through the real appendGateLine.
#
# RED-proof (apply one mutation on a scratch copy, the named case goes red):
#   idempotence check (alreadyRecorded) removed        : RR2 red
#   storeDir() creates the store (vaultRoot-style)     : RR4 red (dirs created)
#   mainCheckoutDir() returns the worktree itself      : RR9 red
#   no lock around read+write (lockRuns removed)       : RR12 red (lost lines)
#   runs-file cap / unsafe name throw exit 2           : RR13a, RR14 red
#   gate log lstat/isFile/size check removed           : RR13b, RR15 red (FIFO hangs, caught by timeout 20)
#   why counts in a plain {}                           : RR16 red

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

# RR11 — a relative --repo resolves against the cwd (verification gap 1)
rr_repo RR11P rr11; rr_store RR11V rr11v
rr_plant "$RR11P" pr-3 '[{"gate":"verify-run","exit":0,"dur":3}]'
OUT="$(cd "$RR11P" && A1_VAULT_ROOT="$RR11V" node "$TOOLS" run record --repo . --scope pr-3 2>&1)"; RC=$?
assert_rc "RR11a --repo . from inside the repo" 0 "$RC" "$OUT"
assert_eq "RR11b the runs file is named after the folder" "$(ls "$RR11V/pattern/a1-learnings/_runs" 2>/dev/null | tr '\n' ',')" "$(basename "$RR11P").jsonl,"

# RR12 — concurrent run record calls lose no line (review R1: lost update)
rr_repo RR12P rr12 fx-proj; rr_store RR12V rr12v
RR12PIDS=()
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do rr_plant "$RR12P" "pr-$i" '[{"gate":"verify-run","exit":0,"dur":3}]'; done
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  (cd "$RR_CWD" && A1_VAULT_ROOT="$RR12V" node "$TOOLS" run record --repo "$RR12P" --scope "pr-$i" --pr "$i" >/dev/null 2>&1) &
  RR12PIDS+=("$!")
done
for pid in "${RR12PIDS[@]}"; do wait "$pid"; done
RR12F="$RR12V/pattern/a1-learnings/_runs/fx-proj.jsonl"
assert_eq "RR12a 12 parallel calls leave 12 distinct lines" "$(rr_json "$RR12F" 'l.length+":"+new Set(l.map(x=>x.pr)).size')" "12:12"
assert_eq "RR12b no lock directory is left behind" "$(ls "$RR12V/pattern/a1-learnings/_runs" | tr '\n' ',')" "fx-proj.jsonl,"

# RR13 — a runs file or gate log over 20 MB is a report (exit 1), not a permanent STOP (exit 2)
rr_repo RR13P rr13 fx-proj; rr_store RR13V rr13v
rr_plant "$RR13P" pr-2 '[{"gate":"verify-run","exit":0,"dur":3}]'
mkdir -p "$RR13V/pattern/a1-learnings/_runs"
node -e 'require("fs").writeFileSync(process.argv[1], "");require("fs").truncateSync(process.argv[1], 21*1024*1024)' "$RR13V/pattern/a1-learnings/_runs/fx-proj.jsonl"
rr_run "$RR13V" --repo "$RR13P" --scope pr-2 --pr 2
assert_rc "RR13a runs file over 20 MB: exit 1" 1 "$RC" "$OUT"; assert_has "RR13a reason" "$OUT" "runs_file_too_large"
rr_repo RR13Q rr13q; rr_store RR13W rr13w
rr_plant "$RR13Q" pr-2 '[{"gate":"verify-run","exit":0,"dur":3}]'
node -e 'require("fs").truncateSync(process.argv[1], 21*1024*1024)' "$RR13Q/.a1/phases/pr-2/gate-log.jsonl"
rr_run "$RR13W" --repo "$RR13Q" --scope pr-2 --pr 2
assert_rc "RR13b gate log over 20 MB: exit 1" 1 "$RC" "$OUT"; assert_has "RR13b reason" "$OUT" "gate_log_untrusted"

# RR14 — a project folder name that is no safe file name: exit 1, nothing written
mk_workdir RR14B rr14; RR14P="$RR14B/we ird"; mkdir -p "$RR14P"; rr_store RR14V rr14v
git -C "$RR14P" init -q -b main; echo a > "$RR14P/a.txt"; git -C "$RR14P" add -A
git -C "$RR14P" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm one
rr_plant "$RR14P" pr-2 '[{"gate":"verify-run","exit":0,"dur":3}]'
rr_run "$RR14V" --repo "$RR14P" --scope pr-2 --pr 2
assert_rc "RR14a unsafe project name: exit 1" 1 "$RC" "$OUT"; assert_has "RR14a reason" "$OUT" "unsafe_project_name"
assert_eq "RR14b no _runs directory created" "$([[ -e "$RR14V/pattern/a1-learnings/_runs" ]] && echo yes || echo no)" "no"

# RR15 — a FIFO as gate log does not hang run record
rr_repo RR15P rr15; rr_store RR15V rr15v
mkdir -p "$RR15P/.a1/phases/pr-2"; mkfifo "$RR15P/.a1/phases/pr-2/gate-log.jsonl"
OUT="$(cd "$RR_CWD" && A1_VAULT_ROOT="$RR15V" timeout 20 node "$TOOLS" run record --repo "$RR15P" --scope pr-2 --pr 2 2>&1)"; RC=$?
assert_rc "RR15 FIFO gate log: exit 1 (124 = hung)" 1 "$RC" "$OUT"; assert_has "RR15 reason" "$OUT" "gate_log_untrusted"

# RR16 — the why-code "constructor" is a plain key, not a prototype member
rr_repo RR16P rr16 fx-proj; rr_store RR16V rr16v
rr_plant "$RR16P" pr-2 '[{"gate":"pr-merge-check","exit":0,"dur":1,"why":"constructor"},{"gate":"pr-merge-check","exit":0,"dur":1,"why":"constructor"}]'
rr_run "$RR16V" --repo "$RR16P" --scope pr-2 --pr 2
assert_eq "RR16 ci_evidence_why is {constructor:2}" "$(rr_json "$RR16V/pattern/a1-learnings/_runs/fx-proj.jsonl" 'JSON.stringify(l[0].gates[0].ci_evidence_why)')" '{"constructor":2}'
