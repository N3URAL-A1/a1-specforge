# Part 06 — spec 027 Task 3.3: `a1-tools metrics phase-time` and `--baseline` (FR-003, FR-004, FR-005, D6, D7).
# Sourced by run-tests.sh. Planted repos from mk_workdir (the old-format.jsonl copy plus records appended through
# appendGateLine); store files and host-context files are hand-written; the two verify reports come from the
# real `verify run` on a planted two-stub project.
#
# RED-proof (apply one mutation on a scratch copy, the named case goes red):
#   records without duration summed as 0 (no_duration not counted)  : PT1 red
#   dedup against the store removed                                  : PT4 red
#   --force check removed (baselineTarget)                           : PT9 red
#   host-context key check removed (sameKeys)                        : PT10 extra-key case red
#   `host: os.hostname()` written into the baseline                  : PT8 hostname case red

PT_GL="$SHARED/lib/gate-log.cjs"
PT_SHA="$(printf 'd%.0s' $(seq 1 40))"

pt_git() { local d="$1"; shift; git -C "$d" -c user.name=t -c user.email=t@t -c commit.gpgsign=false "$@"; }

# pt_repo <VAR> <label> [roadmap-project] — temp git repo with one commit (per-repo identity).
pt_repo() {
  local __r
  mk_workdir __r "$2"
  git -C "$__r" init -q -b main
  if [[ -n "${3:-}" ]]; then
    mkdir -p "$__r/docs/product"; printf -- '---\nproject: %s\n---\n# Roadmap\n' "$3" > "$__r/docs/product/ROADMAP.md"
  fi
  echo a > "$__r/a.txt"; git -C "$__r" add -A
  pt_git "$__r" commit -qm one
  printf -v "$1" '%s' "$__r"
}

# pt_plant <repo> <scope> <json-array of {gate,exit,dur?,why?}>
pt_plant() {
  GL="$PT_GL" SHA="$PT_SHA" node -e '
    const gl=require(process.env.GL); const [repo,scope,spec]=process.argv.slice(1);
    for (const s of JSON.parse(spec)) {
      gl.appendGateLine({ root: repo, scope, gateId: s.gate, verdict: gl.verdictForExit(s.exit), exitCode: s.exit, headSha: process.env.SHA,
        startedAt: s.dur === undefined ? undefined : new Date().toISOString(), durationMs: s.dur, extra: s.why ? { ci_evidence_why: s.why } : undefined });
    }' "$1" "$2" "$3"
}

# pt_run <vault> <cwd> <args...> — sets OUT (stdout), ERR (stderr), RC.
pt_run() {
  local v="$1" cwd="$2"; shift 2
  OUT="$(cd "$cwd" && A1_VAULT_ROOT="$v" node "$TOOLS" metrics phase-time "$@" 2>"$PT_ERRF")"; RC=$?; ERR="$(cat "$PT_ERRF")"
}
pt_j() { printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
pt_file() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }
mk_workdir PT_W pt-work; PT_ERRF="$PT_W/stderr.txt"
mk_workdir PT_NOSTORE pt-nostore

# ---- PT1 ----
pt_repo PT1P pt1 fx-proj
mkdir -p "$PT1P/.a1/phases/_unscoped"; cp "$FIXT/gatelog/old-format.jsonl" "$PT1P/.a1/phases/_unscoped/gate-log.jsonl"
pt_plant "$PT1P" _unscoped '[{"gate":"depth-pass","exit":0,"dur":100},{"gate":"depth-pass","exit":0,"dur":250}]'
pt_run "$PT_NOSTORE" "$PT1P" --repo "$PT1P" --json
assert_rc "PT1a exit 0" 0 "$RC" "$ERR"
assert_eq "PT1b runs 5, sum 350, no_duration 3, source live" "$(pt_j 'j.rows.reduce((a,r)=>a+r.runs,0)+"|"+j.totals.live.duration_ms_sum+"|"+j.totals.live.no_duration+"|"+[...new Set(j.rows.map(r=>r.source))].join()')" "5|350|3|live"
assert_eq "PT1c the depth-pass row: 3 runs, sum 350, 1 without duration" "$(pt_j 'JSON.stringify(j.rows.filter(r=>r.gate==="depth-pass").map(r=>[r.runs,r.duration_ms_sum,r.no_duration]))')" "[[3,350,1]]"
assert_eq "PT1d a gate with only old records has sum null, not 0" "$(pt_j 'j.rows.find(r=>r.gate==="fix-class-sweep").duration_ms_sum')" "null"
assert_eq "PT1e top-level no_duration 3" "$(pt_j 'j.no_duration')" "3"

# ---- PT2 ----
pt_repo PT2P pt2 fx-proj
pt_plant "$PT2P" pr-7 '[{"gate":"pr-merge-check","exit":0,"dur":1,"why":"ok"},{"gate":"pr-merge-check","exit":0,"dur":1,"why":"ok"},{"gate":"pr-merge-check","exit":0,"dur":1,"why":"disabled_by_flag"},{"gate":"pr-merge-check","exit":1,"dur":1,"why":"protected_path_changed"},{"gate":"pr-merge-check","exit":0,"dur":1}]'
pt_run "$PT_NOSTORE" "$PT2P" --repo "$PT2P" --json
assert_eq "PT2 ci_evidence_why counts" "$(pt_j 'JSON.stringify(j.ci_evidence_why)')" '{"ok":2,"disabled_by_flag":1,"protected_path_changed":1,"unknown":1}'

# ---- PT3 ----
pt_store() { # <VAR> <project> <jsonl line> — vault with one store file
  local __v; mk_workdir __v pt-store; mkdir -p "$__v/pattern/a1-learnings/_runs"; printf '%s\n' "$3" > "$__v/pattern/a1-learnings/_runs/$2.jsonl"; printf -v "$1" '%s' "$__v"
}
ROW5='{"schema":1,"recorded_at":"2026-11-01T10:00:00.000Z","project":"x","scope":"pr-5","pr":5,"head_sha":"'"$PT_SHA"'","gates":[{"id":"verify-run","verdict":"pass","caught":false,"runs":2,"duration_ms_sum":40,"no_duration":0},{"id":"pr-merge-check","verdict":"pass","caught":false,"runs":1,"duration_ms_sum":9,"no_duration":0,"ci_evidence_why":{"ok":1}}]}'
pt_store PT3V fx-proj "$ROW5"
pt_run "$PT3V" "$PT2P" --repo "$PT2P" --json
assert_eq "PT3a ROADMAP project: store rows found, source store" "$(pt_j 'j.project+"|"+j.rows.filter(r=>r.source==="store").length+"|"+j.totals.store.duration_ms_sum')" "fx-proj|2|49"
assert_eq "PT3a2 store why counts reach the report" "$(pt_j 'j.ci_evidence_why.ok')" "3"
pt_repo PT3N pt3-noroadmap
pt_run "$PT_NOSTORE" "$PT3N" --repo "$PT3N" --json
assert_eq "PT3b without ROADMAP: the repo directory name" "$(pt_j 'j.project')" "$(basename "$PT3N")"
git -C "$PT3N" worktree add -q "$PT_W/pt3-wt" -b wt-branch 2>/dev/null
pt_run "$PT_NOSTORE" "$PT_W/pt3-wt" --repo "$PT_W/pt3-wt" --json
assert_eq "PT3c from a worktree: the main checkout directory name" "$(pt_j 'j.project')" "$(basename "$PT3N")"
pt_run "$PT_NOSTORE" "$PT_W/pt3-wt" --json
assert_eq "PT3d default repo found by walking up from cwd" "$(pt_j 'j.repo')" "$PT_W/pt3-wt"

# ---- PT4 ----
pt_store PT4V fx-proj '{"schema":1,"recorded_at":"2026-11-01T10:00:00.000Z","project":"fx-proj","scope":"pr-7","pr":7,"head_sha":"'"$PT_SHA"'","gates":[{"id":"pr-merge-check","verdict":"pass","caught":false,"runs":5,"duration_ms_sum":5,"no_duration":0}]}'
pt_run "$PT4V" "$PT2P" --repo "$PT2P" --json
assert_eq "PT4 live pr-7 rows are also_in_store and left out of totals.live" "$(pt_j 'j.rows.filter(r=>r.source==="live").every(r=>r.also_in_store===true)+"|"+j.totals.live.duration_ms_sum+"|"+j.totals.store.duration_ms_sum')" "true|0|5"

# ---- PT5 ----
pt_repo PT5P pt5 fx-proj
pt_plant "$PT5P" pr-1 '[{"gate":"verify-run","exit":0,"dur":11}]'
pt_plant "$PT5P" pr-2 '[{"gate":"verify-run","exit":0,"dur":1},{"gate":"verify-run","exit":0,"dur":2}]'
node -e 'const fs=require("fs");const f=process.argv[1];const a=fs.readFileSync(f,"utf8").split("\n").filter(Boolean);const r=JSON.parse(a[a.length-1]);r.prev="1".repeat(64);a[a.length-1]=JSON.stringify(r);fs.writeFileSync(f,a.join("\n")+"\n")' "$PT5P/.a1/phases/pr-2/gate-log.jsonl"
pt_run "$PT_NOSTORE" "$PT5P" --repo "$PT5P" --json
assert_eq "PT5a exit 0, broken scope named, other scope summed" "$RC|$(pt_j 'j.broken_logs[0].scope+"|"+j.totals.live.duration_ms_sum')" "0|pr-2|11"

# ---- PT6 ----
pt_repo PT6P pt6 fx-proj
pt_plant "$PT6P" pr-1 '[{"gate":"verify-run","exit":0,"dur":1}]'
sleep 0.05; pt_plant "$PT6P" pr-7 '[{"gate":"verify-run","exit":0,"dur":2}]'
pt_run "$PT_NOSTORE" "$PT6P" --repo "$PT6P" --json --scope pr-7
assert_eq "PT6a --scope pr-7" "$(pt_j '[...new Set(j.rows.map(r=>r.scope))].join()')" "pr-7"
pt_run "$PT_NOSTORE" "$PT6P" --repo "$PT6P" --json --last 1
assert_eq "PT6b --last 1 keeps the newest scope" "$(pt_j '[...new Set(j.rows.map(r=>r.scope))].join()')" "pr-7"
pt_run "$PT_NOSTORE" "$PT6P" --repo "$PT6P"
assert_has "PT6c text output has a live row and the totals" "$OUT" "totals live: duration_ms_sum=3"

# ---- PT7 hostile ----
pt_run "$PT_NOSTORE" "$PT6P" --repo "$PT6P" --scope ../x;  assert_rc "PT7a scope traversal" 1 "$RC"
pt_run "$PT_NOSTORE" "$PT6P" --repo "$PT6P" --last 0;      assert_rc "PT7b --last 0" 1 "$RC"
pt_run "$PT_NOSTORE" "$PT6P" --repo "$(printf 'x%.0s' $(seq 1 10000))"; assert_rc "PT7c 10000-char repo" 1 "$RC"
pt_run "$PT_NOSTORE" "$PT6P" --repo /nonexistent;          assert_rc "PT7d missing repo" 2 "$RC"
pt_run "$PT_NOSTORE" "$PT6P" --repo "$PT6P" --bogus;       assert_rc "PT7e unknown flag" 1 "$RC"

# ---- reports for the baseline: the real verify run on a planted two-stub project ----
PTV="$PT_W/pt-verify"; mkdir -p "$PTV/bin" "$PTV/src" "$PTV/.a1"
git -C "$PTV" init -q -b main
printf 'module.exports = 1;\n' > "$PTV/src/app.js"
printf '#!/usr/bin/env bash\nexit 0\n' > "$PTV/bin/one"; printf '#!/usr/bin/env bash\nexit 0\n' > "$PTV/bin/two"; chmod +x "$PTV/bin/one" "$PTV/bin/two"
printf '{"commands":[{"id":"one","argv":["./bin/one"]},{"id":"two","argv":["./bin/two"]}]}\n' > "$PTV/.a1/verify.json"
git -C "$PTV" add -A; pt_git "$PTV" commit -qm base
PTBASE="$(git -C "$PTV" rev-parse HEAD)"
git -C "$PTV" checkout -q -b feat; printf 'module.exports = 2;\n' > "$PTV/src/app.js"; git -C "$PTV" add -A; pt_git "$PTV" commit -qm head
(cd "$PTV" && A1_VAULT_ROOT="" node "$TOOLS" verify run --project "$PTV" --no-cache --phase pt-verify > "$PT_W/verify-report.json" 2>/dev/null)
(cd "$PTV" && A1_VAULT_ROOT="" node "$TOOLS" verify run --project "$PTV" --base "$PTBASE" --no-cache --phase pt-verify > "$PT_W/merge-report.json" 2>/dev/null)
assert_eq "PT0 the real reports carry the D3 fields" "$(pt_file "$PT_W/verify-report.json" 'j.duration_ms.base')|$(pt_file "$PT_W/merge-report.json" 'Number.isInteger(j.duration_ms.base)')" "null|true"

printf '{"verify_head_only":{"load5_start":0.4,"load5_end":0.5,"cpus":24,"host_busy":false,"checks":2},"merge_check_long_path":{"load5_start":0.6,"load5_end":0.7,"cpus":24,"host_busy":false,"checks":3}}\n' > "$PT_W/ctx-good.json"
pt_bl() { # <repo> <ctx> [extra flags...]
  local repo="$1" ctx="$2"; shift 2
  pt_run "$PT_NOSTORE" "$repo" --repo "$repo" --baseline --verify-report "$PT_W/verify-report.json" --merge-report "$PT_W/merge-report.json" --host-context "$ctx" --host-label fx-host "$@"
}

# ---- PT8 baseline ----
pt_repo PT8P pt8 fx-proj
pt_bl "$PT8P" "$PT_W/ctx-good.json"
BL="$PT8P/.a1/phases/027-lean-pipeline/BASELINE.json"
assert_rc "PT8a baseline exit 0" 0 "$RC" "$ERR"
assert_eq "PT8b schema keys" "$(pt_file "$BL" 'Object.keys(j).join()')" "schema,feature,host_label,platform,node,cpus,date,sha,base_sha,gates,verify_head_only,merge_check_long_path"
HEADSHA="$(pt_file "$PT_W/merge-report.json" 'j.head_sha')"
assert_eq "PT8c0 base_sha is 40 hex" "$(pt_file "$BL" '/^[0-9a-f]{40}$/.test(j.base_sha)')" "true"
assert_eq "PT8c2 sha equals the report head_sha" "$(pt_file "$BL" 'j.sha')" "$HEADSHA"
assert_eq "PT8c3 base_sha equals the merge report base_sha" "$(pt_file "$BL" 'j.base_sha')" "$PTBASE"
assert_eq "PT8d host_label, path serial, integer base_ms" "$(pt_file "$BL" '[j.host_label,j.merge_check_long_path.path,Number.isInteger(j.merge_check_long_path.base_ms)].join()')" "fx-host,serial,true"
assert_eq "PT8e every command duration is an integer or null" "$(pt_file "$BL" '[...j.verify_head_only.commands,...j.merge_check_long_path.commands].every(c=>c.duration_ms===null||Number.isInteger(c.duration_ms))')" "true"
assert_eq "PT8f both host_load objects equal the planted host-context" "$(pt_file "$BL" 'JSON.stringify([j.verify_head_only.host_load,j.merge_check_long_path.host_load])')" "$(pt_file "$PT_W/ctx-good.json" 'JSON.stringify([j.verify_head_only,j.merge_check_long_path])')"
assert_eq "PT8g the file holds no hostname (count 0)" "$(grep -c "$(hostname)" "$BL" | tr -d ' ')" "0"
assert_has "PT8h stdout host_busy false" "$OUT" '"host_busy":false'
printf '{"verify_head_only":{"load5_start":0.4,"load5_end":0.5,"cpus":24,"host_busy":false,"checks":2},"merge_check_long_path":{"load5_start":9.6,"load5_end":9.7,"cpus":24,"host_busy":true,"checks":3}}\n' > "$PT_W/ctx-busy.json"
pt_repo PT8B pt8b fx-proj; pt_bl "$PT8B" "$PT_W/ctx-busy.json"
assert_rc "PT8i busy host: exit stays 0" 0 "$RC" "$ERR"
assert_has "PT8i stdout host_busy true" "$OUT" '"host_busy":true'
assert_eq "PT8i one stderr line naming the run" "$(grep -c 'merge_check_long_path' <<<"$ERR")" "1"

# ---- PT9 ----
H9="$(sha256sum "$BL" | cut -d' ' -f1)"
pt_bl "$PT8P" "$PT_W/ctx-good.json"
assert_rc "PT9a second baseline without --force: exit 1" 1 "$RC" "$ERR"
assert_eq "PT9b file byte-identical" "$(sha256sum "$BL" | cut -d' ' -f1)" "$H9"
pt_bl "$PT8P" "$PT_W/ctx-good.json" --force
assert_rc "PT9c --force rewrites" 0 "$RC" "$ERR"

# ---- PT10 ----
pt_repo PT10P pt10 fx-proj
pt_bl_raw() { pt_run "$PT_NOSTORE" "$PT10P" --repo "$PT10P" --baseline "$@"; }
node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const w=(n,f)=>{const c=JSON.parse(JSON.stringify(b));f(c);fs.writeFileSync(process.argv[2]+"/"+n,JSON.stringify(c))};
 w("ctx-extra.json",c=>{c.verify_head_only.extra=1}); w("ctx-nocpus.json",c=>{delete c.merge_check_long_path.cpus}); w("ctx-cpus0.json",c=>{c.verify_head_only.cpus=0});
 w("ctx-neg.json",c=>{c.verify_head_only.load5_start=-1}); w("ctx-busystr.json",c=>{c.merge_check_long_path.host_busy="no"});' "$PT_W/ctx-good.json" "$PT_W"
for c in extra nocpus cpus0 neg busystr; do
  pt_bl "$PT10P" "$PT_W/ctx-$c.json"
  assert_eq "PT10 host-context case $c: exit 1 host_context_invalid" "$RC|$(grep -c host_context_invalid <<<"$ERR")" "1|1"
done
node -e 'process.stdout.write(JSON.stringify({a:" ".repeat(70000)}))' > "$PT_W/ctx-big.json"
pt_bl "$PT10P" "$PT_W/ctx-big.json"; assert_rc "PT10 70 KB host-context" 1 "$RC"
cp "$PT_W/verify-report.json" "$PT_W/verify-other.json"; node -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,"utf8"));j.head_sha="e".repeat(40);fs.writeFileSync(f,JSON.stringify(j))' "$PT_W/verify-other.json"
pt_run "$PT_NOSTORE" "$PT10P" --repo "$PT10P" --baseline --verify-report "$PT_W/verify-other.json" --merge-report "$PT_W/merge-report.json" --host-context "$PT_W/ctx-good.json" --host-label fx-host
assert_rc "PT10 reports with different head_sha" 1 "$RC"
pt_run "$PT_NOSTORE" "$PT10P" --repo "$PT10P" --baseline --verify-report "$PT_W/verify-report.json" --merge-report "$PT_W/verify-report.json" --host-context "$PT_W/ctx-good.json" --host-label fx-host
assert_rc "PT10 head-only report passed as --merge-report" 1 "$RC"
pt_bl_raw; assert_rc "PT10 --baseline without reports" 1 "$RC"
pt_run "$PT_NOSTORE" "$PT10P" --repo "$PT10P" --baseline --verify-report "$PT_W/verify-report.json" --merge-report "$PT_W/merge-report.json" --host-label fx-host
assert_rc "PT10 --baseline without --host-context" 1 "$RC"
pt_run "$PT_NOSTORE" "$PT10P" --repo "$PT10P" --host-label 'Bad Label' --baseline --verify-report "$PT_W/verify-report.json" --merge-report "$PT_W/merge-report.json" --host-context "$PT_W/ctx-good.json"
assert_rc "PT7f bad --host-label" 1 "$RC"
pt_run "$PT_NOSTORE" "$PT10P" --repo "$PT10P" --host-label fx-host
assert_rc "PT7g a baseline flag without --baseline" 1 "$RC"
assert_eq "PT10 no baseline file after the refused calls" "$([[ -e "$PT10P/.a1/phases/027-lean-pipeline/BASELINE.json" ]] && echo yes || echo no)" "no"

# ---- PT11 ----
pt_repo PT11P pt11; mk_workdir PT11O pt11-out
mkdir -p "$PT11P/.a1/phases"; ln -s "$PT11O" "$PT11P/.a1/phases/027-lean-pipeline"
pt_bl "$PT11P" "$PT_W/ctx-good.json"
assert_rc "PT11a symlinked feature dir: exit 2" 2 "$RC" "$ERR"
assert_eq "PT11b outside dir stays empty" "$(find "$PT11O" -mindepth 1 | wc -l | tr -d ' ')" "0"

# ---- PT12 (SC-001 shape): a scope written only through the real facade hook ----
pt_repo PT12P pt12
echo b >> "$PT12P/a.txt"; git -C "$PT12P" add -A; pt_git "$PT12P" commit -qm two
(cd "$PT12P" && A1_VAULT_ROOT="" node "$TOOLS" realpath-check run --phase w1 --diff-base HEAD~1 --project . >/dev/null 2>&1)
pt_run "$PT_NOSTORE" "$PT12P" --repo "$PT12P" --json --scope w1
assert_eq "PT12 facade-written scope: no_duration 0, one row" "$(pt_j 'j.no_duration+"|"+j.rows.length')" "0|1"
