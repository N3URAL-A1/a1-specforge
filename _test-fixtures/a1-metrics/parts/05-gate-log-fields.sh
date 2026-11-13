# Part 05 — spec 027 Task 1.1: gate-log started_at, duration_ms, setRecordExtra (FR-001, D1, D2).
# Sourced by run-tests.sh.
#
# RED-proof (apply one mutation on a scratch copy, the named case goes red):
#   duration_ms made required in shapeProblem  : GF2 red (old lines have none)
#   `pendingExtra = null` reset removed        : GF6 red
#   allowlist check bypassed in sanitizeExtra  : GF4 red
#   constant 0 instead of the hrtime duration  : GF7 red

GL_LIB="$SHARED/lib/gate-log.cjs"

# gf_repo <VAR> <label> — temp git repo with two commits, per-repo identity.
gf_repo() {
  local __r
  mk_workdir __r "$2"
  git -C "$__r" init -q
  echo a > "$__r/a.txt"; git -C "$__r" add -A
  git -C "$__r" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm one
  echo b >> "$__r/a.txt"; git -C "$__r" add -A
  git -C "$__r" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm two
  printf -v "$1" '%s' "$__r"
}

# gf_node <repo> <js> — runs JS in cwd=repo with the real registry text; sets OUT/RC (stdout+stderr in ERR file).
gf_node() {
  local repo="$1" js="$2"
  OUT="$(cd "$repo" && A1_VAULT_ROOT="" GL_LIB="$GL_LIB" REG="$REPO_ROOT/_shared/gates-registry.md" node -e '
    const fs=require("fs"); const gl=require(process.env.GL_LIB);
    const lines=fs.readFileSync(process.env.REG,"utf8").split("\n");
    const hi=lines.findIndex(l=>/^\| *Gate/i.test(l)||/^\| *ID/i.test(l)||/^\| *id/i.test(l));
    const row=lines.find(l=>l.startsWith("| `pr-merge-check` |"));
    const registryText=[lines[hi],lines[hi+1],row].join("\n")+"\n";
    '"$js" 2>"$repo/stderr.txt")"; RC=$?
}

gf_last() { # <repo> <scope> <jsexpr over r (last record)>
  node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean); const r=JSON.parse(t[t.length-1]); const a=JSON.parse(t[0]); const n=t.length; process.stdout.write(String(eval(process.argv[2])))' "$1/.a1/phases/$2/gate-log.jsonl" "$3"
}

# GF1
gf_repo GF1R gf1
(cd "$GF1R" && A1_VAULT_ROOT="" node "$TOOLS" realpath-check run --phase w1 --diff-base HEAD~1 --project . >/dev/null 2>&1)
GF1L="$GF1R/.a1/phases/w1/gate-log.jsonl"
GF1V="$(gf_last "$GF1R" w1 '[/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.started_at), Date.parse(r.started_at)<=Date.parse(r.ts), Number.isInteger(r.duration_ms)&&r.duration_ms>=0].join()')"
assert_eq "GF1a started_at ISO Z, <= ts, duration_ms non-negative integer" "$GF1V" "true,true,true"
run_tools "" gates lint --log "$GF1L"
assert_rc "GF1b gates lint --log on the new record" 0 "$RC" "$OUT"

# GF2
gf_repo GF2R gf2
mkdir -p "$GF2R/.a1/phases/w1"
cp "$FIXT/gatelog/old-format.jsonl" "$GF2R/.a1/phases/w1/gate-log.jsonl"
(cd "$GF2R" && A1_VAULT_ROOT="" node "$TOOLS" realpath-check run --phase w1 --diff-base HEAD~1 --project . >/dev/null 2>&1)
GF2L="$GF2R/.a1/phases/w1/gate-log.jsonl"
run_tools "" gates lint --log "$GF2L"
assert_rc "GF2a old-format log plus a new record lints" 0 "$RC" "$OUT"
assert_has "GF2b 4 lines" "$OUT" '"lines":4'
assert_has "GF2c 0 problems" "$OUT" '"problems":[]'
assert_eq "GF2d first 3 lines byte-identical" "$(head -n 3 "$GF2L" | cmp - "$FIXT/gatelog/old-format.jsonl" && echo same)" "same"

# GF3
gf_repo GF3R gf3
H64="$(printf 'a%.0s' $(seq 1 64))"
gf_node "$GF3R" 'gl.installGateLog(["pr","merge-check","--phase","w2"],registryText); gl.setRecordExtra({input_hash:"'"$H64"'",reused:true,ci_evidence_why:"ok"}); process.exitCode=0;'
GF3V="$(gf_last "$GF3R" w2 'r.gate+"|"+r.input_hash+"|"+r.reused+"|"+r.ci_evidence_why')"
assert_eq "GF3 record carries the three extras exactly" "$GF3V" "pr-merge-check|$H64|true|ok"

# GF4
gf_repo GF4R gf4
gf_node "$GF4R" 'gl.installGateLog(["pr","merge-check","--phase","w2"],registryText); gl.setRecordExtra({verdict:"pass",gate:"x",prev:"0".repeat(64),foo:1,input_hash:"XYZ",reused:"yes",ci_evidence_why:"Bad Value!"}); gl.setRecordExtra({["k".repeat(10000)]:1}); process.exitCode=1;'
GF4V="$(gf_last "$GF4R" w2 '[r.verdict,r.exit,r.gate,["foo","input_hash","reused","ci_evidence_why"].some(k=>k in r)].join()')"
assert_eq "GF4a core fields kept, bad extras dropped" "$GF4V" "fail,1,pr-merge-check,false"
assert_eq "GF4b 8 ignored notes (7 + 1 long key)" "$(grep -c 'setRecordExtra ignored' "$GF4R/stderr.txt")" "8"
assert_eq "GF4c every note at most 120 chars" "$(awk 'length($0)>120{n++} END{print n+0}' "$GF4R/stderr.txt")" "0"

# GF5
gf_repo GF5R gf5
gf_node "$GF5R" 'const r=gl.setRecordExtra({input_hash:"'"$H64"'"}); process.stdout.write(String(r.active));'
assert_eq "GF5a inactive without installGateLog" "$OUT" "false"
assert_eq "GF5b no .a1 directory created" "$([[ -e "$GF5R/.a1" ]] && echo yes || echo no)" "no"

# GF6
gf_repo GF6R gf6
gf_node "$GF6R" 'gl.installGateLog(["pr","merge-check","--phase","w2"],registryText); gl.installGateLog(["pr","merge-check","--phase","w2"],registryText); gl.setRecordExtra({input_hash:"'"$H64"'"});'
GF6V="$(gf_last "$GF6R" w2 '[n, "input_hash" in a, "input_hash" in r].join()')"
assert_eq "GF6 first record has input_hash, second does not" "$GF6V" "2,true,false"

# GF7
gf_repo GF7R gf7
gf_node "$GF7R" 'gl.installGateLog(["pr","merge-check","--phase","w2"],registryText); setTimeout(()=>{},300);'
assert_eq "GF7 duration_ms >= 250 after a 300 ms wait" "$(gf_last "$GF7R" w2 'r.duration_ms>=250')" "true"

# GF8
gf_repo GF8R gf8
gf_node "$GF8R" 'gl.installGateLog(["pr","merge-check","--phase","w2"],registryText);'
GF8L="$GF8R/.a1/phases/w2/gate-log.jsonl"
node -e '
  const fs=require("fs"),c=require("crypto"); const f=process.argv[1];
  const first=fs.readFileSync(f,"utf8").split("\n").filter(Boolean)[0];
  const r=JSON.parse(first); r.prev=c.createHash("sha256").update(first).digest("hex"); r.duration_ms=-5;
  fs.appendFileSync(f, JSON.stringify(r)+"\n");' "$GF8L"
run_tools "" gates lint --log "$GF8L"
assert_rc "GF8a negative duration_ms fails lint" 1 "$RC"
assert_has "GF8b rule malformed_line" "$OUT" "malformed_line"
