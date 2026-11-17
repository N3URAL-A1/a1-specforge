# Sourced by run-tests.sh (spec 027 slice 2, FR-006, wave 4). Uses the suite helpers newproj/cfg/seal/check/check_rc/g/ok/bad.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# The tracer's line parser, the map generator (`verify affected-map --traces`), the staleness check (`--check`, with and
# without a .git) and `bin/affected-trace.sh` (D5, D6).
# RED-proof (wave 4 report): cwd tracking dropped -> AM1c; listing rule widened to every path under the listed dir -> AM3, AM3b, AM3e, AM3f;
# --traces accepts a red trace -> AM4b; checkMap skips selectors -> AM5; --check without the disk fallback -> AM5b.

AMMOD="$REPO_ROOT/_shared/lib/verify-affected-map.cjs"
AMROOT=/tmp/claude-1000/sc/r
# Real strace 6.19 lines (strace -f -qq -y -e trace=%file,fchdir -s 4096, recorded 2026-11-17 in /tmp/claude-1000/sc/r), "<name> <line>".
cat > "$WORK/am-lines.txt" <<'AMLINES'
open 1040469 openat(AT_FDCWD</tmp/claude-1000/sc/r/sub>, "f", O_RDONLY|O_CLOEXEC) = 3</tmp/claude-1000/sc/r/sub/f>
enoent 1040470 statx(AT_FDCWD</tmp/claude-1000/sc/r/sub>, "nope", AT_STATX_SYNC_AS_STAT, STATX_ALL, 0x7ffdc03109d0) = -1 ENOENT (No such file or directory)
fix 1040472 statx(AT_FDCWD</tmp/claude-1000/sc/r/sub>, "z", AT_STATX_SYNC_AS_STAT, STATX_ALL, 0x7ffd57355ce0) = -1 ENOENT (No such file or directory)
mkdir 1040472 mkdir("z", 0777)                = 0
mkdir_other 1040999 mkdir("z", 0777)                = 0
dir 1040473 openat(AT_FDCWD</tmp/claude-1000/sc/r/sub>, "/tmp/claude-1000/sc/r", O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_DIRECTORY) = 3</tmp/claude-1000/sc/r>
outside 1040468 newfstatat(AT_FDCWD</tmp/claude-1000/sc/r>, "/tmp", {st_mode=S_IFDIR|S_ISVTX|0777, st_size=36360, ...}, 0) = 0
chdir 1040468 chdir("/tmp/claude-1000/sc/r/sub") = 0
sigchld 1040468 --- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=1040469, si_uid=1000, si_status=0, si_utime=0, si_stime=0} ---
unfin 1040468 openat(AT_FDCWD</tmp/claude-1000/sc/r>, "t.sh", O_RDONLY <unfinished ...>
resumed 1040468 <... openat resumed>) = 3</tmp/claude-1000/sc/r/t.sh>
AMLINES
export AM_LINES="$WORK/am-lines.txt"

# amjs <js body; m = module, L(name) = fixture line, s = pid->cwd state, r = root, p(line) = parseTraceLine> -> JSON of the return value
amjs() {
  A1_AM_BODY="$1" node -e '
    const fs = require("fs"); const m = require(process.argv[1]);
    const lines = new Map(fs.readFileSync(process.env.AM_LINES, "utf8").split("\n").filter(Boolean).map((l) => { const i = l.indexOf(" "); return [l.slice(0, i), l.slice(i + 1)]; }));
    const L = (n) => lines.get(n); const s = new Map(); const r = process.argv[2]; const p = (l) => m.parseTraceLine(l, s, r);
    process.stdout.write(JSON.stringify(new Function("m", "L", "s", "r", "p", process.env.A1_AM_BODY)(m, L, s, r, p)));' "$AMMOD" "$AMROOT" 2>&1
}
amcase() { # amcase <label> <js body> <want json>
  local got; got="$(amjs "$2")"
  if [[ "$got" == "$3" ]]; then ok "$1"; else bad "$1 (got=$got want=$3)"; fi
}
# amrun <proj> [args...] -> OUT, RC, ERR (cwd = project)
amrun() {
  local p="$1"; shift
  OUT="$(cd "$p" && node "$TOOLS" verify affected-map --project "$p" "$@" 2>"$WORK/err")"; RC=$?
  ERR="$(cat "$WORK/err")"
}

# AM1: parseTraceLine
amcase "AM1 successful openat: the path comes from the = N<path> annotation, kind F" 'return p(L("open"))' '{"rel":"sub/f","kind":"F"}'
amcase "AM1b ENOENT statx: dirfd annotation joined with the relative argument (a probe is a read)" 'return p(L("enoent"))' '{"rel":"sub/nope","kind":"F"}'
amcase "AM1c non-at mkdir after an annotation that fixes the pid cwd: resolved against that cwd" 'p(L("fix")); return p(L("mkdir"))' '{"rel":"sub/z","kind":"F"}'
amcase "AM1d the same mkdir for an unknown pid: unresolved, names the syscall" 'p(L("fix")); return p(L("mkdir_other"))' '{"unresolved":"mkdir"}'
amcase "AM1e O_DIRECTORY open of the root: kind D, rel ." 'return p(L("dir"))' '{"rel":".","kind":"D"}'
amcase "AM1f a path outside root: null" 'return p(L("outside"))' 'null'
amcase "AM1g a numbered dirfd without annotation cannot be resolved" 'return p("1040468 openat(3, \"g\", O_RDONLY) = -1 ENOENT (No such file or directory)")' '{"unresolved":"openat"}'
amcase "AM1h non-at relative after a successful chdir resolves against the chdir target" 'p(L("chdir")); return p("1040468 unlink(\"g\") = -1 ENOENT (No such file or directory)")' '{"rel":"sub/g","kind":"F"}'
amcase "AM1i an unfinished line plus its resumed line parse as one call" 'p(L("unfin")); return p(L("resumed"))' '{"rel":"t.sh","kind":"F"}'
amcase "AM1j signal lines, exits and empty lines are not path events" 'return [p(L("sigchld")), p("1040468 +++ exited with 0 +++"), p("")]' '[null,null,null]'
PT_OUT="$(sed -n 's/^\(open\|mkdir_other\|dir\) //p' "$AM_LINES" | sed -n '1p;1p;2p;3p' | node "$AMMOD" --parse-trace "$AMROOT")"
[[ "$PT_OUT" == $'.\tD\n?\tmkdir\nsub/f\tF' ]] && ok "AM1k --parse-trace prints sorted, de-duplicated <rel>\t<kind> and ?\t<syscall> lines" || bad "AM1k --parse-trace output: $(printf '%s' "$PT_OUT" | tr '\n\t' '|~')"

# AM2: candidateKeys
amcase "AM2 candidate keys per D5; none for _shared/a1-tools.cjs" 'return m.candidateKeys(["_shared/lib/xprov-scope.cjs","_shared/lib/xprov-hook-rules.cjs","_shared/lib/io.cjs","skills/a1-fix/SKILL.md","skills/a1-fix/workflows/x.md","agents/a1-x.md",".a1/phases/p/PLAN.md","_shared/a1-tools.cjs","_shared/gates-registry.md","docs/adr/0001.md","docs/VISION.md","README.md","bin/run-suites.sh","_test-fixtures/a1-x/run-tests.sh","_test-fixtures/suite-groups.json"])' \
  '[".a1/phases/","README.md","_shared/gates-registry.md","_shared/lib/io.cjs","_shared/lib/xprov-","_test-fixtures/","_test-fixtures/a1-x/","agents/a1-x.md","bin/","docs/VISION.md","docs/adr/","skills/a1-fix/"]'

# AM3: buildMap
AM3PRE='const S1="_test-fixtures/s1/run-tests.sh", S2="_test-fixtures/s2/run-tests.sh", S3="_test-fixtures/s3/run-tests.sh";
  const common=["README.md","docs/x.md"];
  const rs=(own,listed,un)=>({touched:[own].concat(common),listed:listed,unresolved:un||0});
  const input=(o)=>Object.assign({planIds:[S1,S2,S3],trackedFiles:["_test-fixtures/s1/a","_test-fixtures/s2/a","_test-fixtures/s3/a","skills/a1-fix/x.md","README.md","docs/x.md","package.json"]},o);'
amcase "AM3 a key read by all suites is omitted; a key read by s1 only is [s1 dir]; listing skills/a1-fix joins its key; listing only . joins top-level file keys but not skills/a1-fix/" "$AM3PRE"'
  const a=m.buildMap(input({readSets:{[S1]:rs("_test-fixtures/s1/a",[]),[S2]:rs("_test-fixtures/s2/a",["skills/a1-fix"]),[S3]:rs("_test-fixtures/s3/a",["."])}}));
  return a.affected' \
  '{"_test-fixtures/s1/":["_test-fixtures/s1/"],"_test-fixtures/s2/":["_test-fixtures/s2/"],"_test-fixtures/s3/":["_test-fixtures/s3/"],"package.json":["_test-fixtures/s3/"],"skills/a1-fix/":["_test-fixtures/s2/"]}'
amcase "AM3b stats: suites, keys_total, keys_kept, always_selected" "$AM3PRE"'
  const a=m.buildMap(input({readSets:{[S1]:rs("_test-fixtures/s1/a",[]),[S2]:rs("_test-fixtures/s2/a",["skills/a1-fix"]),[S3]:rs("_test-fixtures/s3/a",["."])}}));
  return a.stats' '{"suites":3,"keys_total":7,"keys_kept":5,"always_selected":[]}'
amcase "AM3e a suite with an unresolved path joins every key" "$AM3PRE"'
  const a=m.buildMap(input({readSets:{[S1]:rs("_test-fixtures/s1/a",[]),[S2]:rs("_test-fixtures/s2/a",["skills/a1-fix"]),[S3]:rs("_test-fixtures/s3/a",[],1)}}));
  return [a.affected["skills/a1-fix/"],a.affected["package.json"],a.stats.always_selected]' \
  '[["_test-fixtures/s2/","_test-fixtures/s3/"],["_test-fixtures/s3/"],["_test-fixtures/s3/run-tests.sh"]]'
amcase "AM3f alwaysIds join every key" "$AM3PRE"'
  const a=m.buildMap(input({alwaysIds:[S1],readSets:{[S1]:rs("_test-fixtures/s1/a",[]),[S2]:rs("_test-fixtures/s2/a",["skills/a1-fix"]),[S3]:rs("_test-fixtures/s3/a",[])}}));
  return [a.affected["skills/a1-fix/"],a.affected["package.json"],a.affected["_test-fixtures/s3/"]]' \
  '[["_test-fixtures/s1/","_test-fixtures/s2/"],["_test-fixtures/s1/"],["_test-fixtures/s1/","_test-fixtures/s3/"]]'
amcase "AM3g a runner list that is a whole directory prefix is compressed, a partial directory keeps ids" 'const P=["d/a/run-1.sh","d/a/run-2.sh","d/b/run-1.sh"];
  const a=m.buildMap({planIds:P,trackedFiles:["k/x","j/y"],readSets:{"d/a/run-1.sh":{touched:["k/x"],listed:[],unresolved:0},"d/a/run-2.sh":{touched:["j/y"],listed:[],unresolved:0},"d/b/run-1.sh":{touched:["j/y"],listed:[],unresolved:0}}});
  return a.affected' '{"j/":["d/a/run-2.sh","d/b/"],"k/":["d/a/run-1.sh"]}'

# ampproj <label>: git project with 2 suites (s1 reads docs/a.md), docs/a.md, README.md; committed on main
ampproj() {
  newproj "$1"; rm -rf "$P/src"
  mkdir -p "$P/_test-fixtures/s1" "$P/_test-fixtures/s2" "$P/docs"
  printf 'cat docs/a.md >/dev/null\nexit 0\n' > "$P/_test-fixtures/s1/run-tests.sh"; printf 'exit 0\n' > "$P/_test-fixtures/s2/run-tests.sh"
  printf 'a\n' > "$P/docs/a.md"
  cfg '{"each":"_test-fixtures/*/run*.sh","argv_prefix":["bash"]}'; g "$P" add -A; g "$P" commit -q -m base
}
AMS1="_test-fixtures/s1/run-tests.sh"; AMS2="_test-fixtures/s2/run-tests.sh"
# amtraces <dir> <s1 paths> <s2 paths>: planted trace dir; rc of s1 / s2 from AMRC1 / AMRC2
amtraces() {
  local d="$1"; rm -rf "${d:?}"; mkdir -p "$d"
  printf '%b' "$2" > "$d/_test-fixtures__s1__run-tests.sh.paths"; printf '%b' "$3" > "$d/_test-fixtures__s2__run-tests.sh.paths"
  printf '%s\t%s\n%s\t%s\n' "$AMS1" "${AMRC1:-0}" "$AMS2" "${AMRC2:-0}" > "$d/_status.tsv"
}
S1PATHS='_test-fixtures/s1/run-tests.sh\tF\ndocs/a.md\tF\n'; S2PATHS='_test-fixtures/s2/run-tests.sh\tF\n'

# AM4: --traces
ampproj am4; AMT="$WORK/am4-traces"; AMRC1=0; AMRC2=0
amtraces "$AMT" "$S1PATHS" "$S2PATHS"
amrun "$P" --traces "$AMT"
check "AM4 two clean traces: exit 0, the planted map, nothing written" 0 'JSON.stringify(j.affected)+"/"+j.stats.keys_kept' '{"_test-fixtures/s1/":["_test-fixtures/s1/"],"_test-fixtures/s2/":["_test-fixtures/s2/"],"docs/a.md":["_test-fixtures/s1/"]}/3'
[[ -z "$(g "$P" status --porcelain)" ]] && ok "AM4a --traces writes nothing into the project" || bad "AM4a project changed"
rm "$AMT/_test-fixtures__s2__run-tests.sh.paths"
amrun "$P" --traces "$AMT"
check "AM4c a missing .paths file: exit 1 trace_missing" 1 'j.error+"/"+j.message' "trace_missing/$AMS2"
amtraces "$AMT" "$S1PATHS" "$S2PATHS"; AMRC2=1; amtraces "$AMT" "$S1PATHS" "$S2PATHS"
amrun "$P" --traces "$AMT"
check "AM4b a red status without --allow-red: exit 1 trace_red" 1 'j.error+"/"+j.message' "trace_red/$AMS2"
amrun "$P" --traces "$AMT" --allow-red "$AMS2"
check "AM4d the same with --allow-red <id>: exit 0, the id is always selected, the planted map" 0 'JSON.stringify(j.affected)+"/"+j.stats.always_selected.join()' "{\".a1/\":[\"_test-fixtures/s2/\"],\"README.md\":[\"_test-fixtures/s2/\"],\"_test-fixtures/s2/\":[\"_test-fixtures/s2/\"]}/$AMS2"
AMRC2=0

# AM5 / AM5b: --check
AMBAD='{"each":"_test-fixtures/*/run*.sh","argv_prefix":["bash"],"affected":{"docs/a.md":["_test-fixtures/s1/"],"nothing/here/":["_test-fixtures/s2/"],".a1/":["_test-fixtures/gone/"]},"smoke":["_test-fixtures/s1/"]}'
AMGOOD='{"each":"_test-fixtures/*/run*.sh","argv_prefix":["bash"],"affected":{"docs/a.md":["_test-fixtures/s1/"],".a1/":["_test-fixtures/s2/run-tests.sh"]},"smoke":["_test-fixtures/s1/"]}'
ampproj am5; cfg "$AMBAD"; g "$P" add -A; g "$P" commit -q -m cfg
amrun "$P" --check
check "AM5 a key without a tracked file and a selector without a command: exit 1, both findings, tracked_source git" 1 'j.findings.map(f=>f.rule+":"+(f.selector||f.key)).sort().join()+"/"+j.tracked_source' "dead_key:nothing/here/,unknown_selector:_test-fixtures/gone//git"
cfg "$AMGOOD"
amrun "$P" --check
check "AM5a the clean config: exit 0, no findings" 0 'j.ok+"/"+j.findings.length+"/"+j.tracked_source' "true/0/git"
ampproj am5b; cfg "$AMBAD"; g "$P" add -A; g "$P" commit -q -m cfg
AMCOPY="$WORK/am5b-copy"; rm -rf "${AMCOPY:?}"; mkdir -p "$AMCOPY"; git -C "$P" archive HEAD | tar -x -C "$AMCOPY"
mkdir -p "$AMCOPY/.git/hooks"; printf 'x\n' > "$AMCOPY/.git/hooks/zz"
node -e 'const fs=require("fs"); const f=process.argv[1]+"/.a1/verify.json"; const c=JSON.parse(fs.readFileSync(f,"utf8")); c.affected[".git/hooks/"]=["_test-fixtures/s2/"]; fs.writeFileSync(f, JSON.stringify(c));' "$AMCOPY"
amrun "$AMCOPY" --check
check "AM5b no .git (git archive copy): same exit and findings, tracked_source disk; a file under a planted .git/ keeps no key alive" 1 'j.findings.map(f=>f.rule+":"+(f.selector||f.key)).sort().join()+"/"+j.tracked_source' "dead_key:.git/hooks/,dead_key:nothing/here/,unknown_selector:_test-fixtures/gone//disk"
printf '%s\n' "$AMGOOD" > "$AMCOPY/.a1/verify.json"
amrun "$AMCOPY" --check
check "AM5c the clean config in the copy: exit 0, tracked_source disk" 0 'j.ok+"/"+j.tracked_source' "true/disk"

# AM6: hostile input
ampproj am6
amrun "$P" --traces ../../etc;                                  check_rc "AM6 --traces with a .. segment: exit 2" 2
amrun "$P" --traces "$(printf 'a%.0s' $(seq 1 10000))";         check_rc "AM6b a 10000-character --traces: exit 2" 2
amrun "$P" --check --list-ids;                                  check_rc "AM6c two mode flags: exit 2" 2
amrun "$P";                                                     check_rc "AM6d no mode flag: exit 2" 2
amrun "$P" --check --allow-red x;                               check_rc "AM6e --allow-red without --traces: exit 2" 2
amrun "$P" --list-ids stray;                                    check_rc "AM6f a stray argument: exit 2" 2
amrun "$P" --list-ids
[[ "$RC" -eq 0 && "$OUT" == "$AMS1"$'\n'"$AMS2" ]] && ok "AM6g --list-ids prints the plan ids, one per line" || bad "AM6g --list-ids (rc=$RC out=$OUT)"

# AM7: bin/affected-trace.sh on a planted 2-suite project
if [[ "$(uname -s)" != "Linux" ]]; then ok "AM7 skipped: host is not Linux"
elif ! command -v strace >/dev/null 2>&1; then ok "AM7 skipped: no strace on PATH"
elif [[ "$(sed -n 's/^TracerPid:[[:space:]]*//p' /proc/self/status)" != "0" ]]; then ok "AM7 skipped: this suite is itself traced (strace cannot nest)"
else
  ampproj am7; AM7OUT="$WORK/am7-out"; rm -rf "${AM7OUT:?}"
  AM7MSG="$(bash "$REPO_ROOT/bin/affected-trace.sh" --root "$P" --out "$AM7OUT" --jobs 2 2>&1)"; AM7RC=$?
  N7="$(ls "$AM7OUT"/*.paths 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$AM7RC" -eq 0 && "$N7" -eq 2 && -s "$AM7OUT/_status.tsv" && "$AM7MSG" == "traced 2 suites, red: none" ]] && ok "AM7 2 .paths files, _status.tsv, summary line" || bad "AM7 (rc=$AM7RC n=$N7 msg=$AM7MSG)"
  grep -q $'^docs/a.md\tF$' "$AM7OUT/_test-fixtures__s1__run-tests.sh.paths" && ! grep -q 'docs/a.md' "$AM7OUT/_test-fixtures__s2__run-tests.sh.paths" && ok "AM7b the suite that reads docs/a.md has it in its .paths, the other has not" || bad "AM7b docs/a.md placement"
  amrun "$P" --traces "$AM7OUT"
  check "AM7c the generator accepts the measured traces" 0 'j.ok+"/"+JSON.stringify(j.affected["docs/a.md"])' 'true/["_test-fixtures/s1/"]'
fi
# ambounded <seconds> <cmd...>: runs the command, kills only its own PID ($!) after the limit, rc 124 then (portable: no GNU timeout)
ambounded() {
  local lim="$1" pid i=0; shift
  "$@" & pid=$!
  while kill -0 "$pid" 2>/dev/null && [[ "$i" -lt "$lim" ]]; do sleep 1; i=$((i + 1)); done
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; return 124; fi
  wait "$pid"
}
# AM9: a leaked background descendant must not block a trace; a suite over the limit is reported, never mapped
if [[ "$(uname -s)" != "Linux" ]] || ! command -v strace >/dev/null 2>&1; then ok "AM9 skipped: needs Linux and strace"
elif [[ "$(sed -n 's/^TracerPid:[[:space:]]*//p' /proc/self/status)" != "0" ]]; then ok "AM9 skipped: this suite is itself traced (strace cannot nest)"
else
  ampproj am9; AM9OUT="$WORK/am9-out"; AM9PID="$WORK/am9.pid"; rm -rf "${AM9OUT:?}" "$AM9PID"
  printf 'sleep 300 &\necho $! > %q\nexit 0\n' "$AM9PID" > "$P/_test-fixtures/s2/run-tests.sh"
  AM9T0=$SECONDS
  AM9MSG="$(ambounded 120 bash "$REPO_ROOT/bin/affected-trace.sh" --root "$P" --out "$AM9OUT" --jobs 2 2>&1)"; AM9RC=$?
  AM9DT=$((SECONDS - AM9T0))
  [[ "$AM9RC" -eq 0 && "$AM9DT" -lt 60 && "$AM9MSG" == "traced 2 suites, red: none" && -s "$AM9OUT/_test-fixtures__s2__run-tests.sh.paths" ]] && ok "AM9 a suite that leaves a background sleep behind still finishes the trace in bounded time" || bad "AM9 (rc=$AM9RC dt=${AM9DT}s msg=$AM9MSG)"
  AM9LP="$(cat "$AM9PID" 2>/dev/null)"
  if [[ -n "$AM9LP" ]] && kill -0 "$AM9LP" 2>/dev/null; then kill "$AM9LP" 2>/dev/null; bad "AM9b the leaked sleep $AM9LP outlived the tracer"; else ok "AM9b the leaked tracee does not outlive the tracer"; fi
  printf 'sleep 300\n' > "$P/_test-fixtures/s2/run-tests.sh"; rm -rf "${AM9OUT:?}"
  AM9T0=$SECONDS
  AM9MSG="$(ambounded 120 bash "$REPO_ROOT/bin/affected-trace.sh" --root "$P" --out "$AM9OUT" --jobs 2 --suite-timeout 3 2>&1)"; AM9RC=$?
  AM9DT=$((SECONDS - AM9T0))
  [[ "$AM9RC" -eq 1 && "$AM9DT" -lt 60 && "$AM9MSG" == *"timeout: $AMS2 "* ]] && grep -q "^$AMS2"$'\t124$' "$AM9OUT/_status.tsv" && ok "AM9c a suite over --suite-timeout: exit 1, listed as timeout, status 124" || bad "AM9c (rc=$AM9RC dt=${AM9DT}s msg=$AM9MSG)"
  amrun "$P" --traces "$AM9OUT"
  check "AM9d the generator refuses the timed-out suite (trace_red)" 1 'j.error' "trace_red"
fi
if [[ "$(uname -s)" == "Linux" ]] && command -v strace >/dev/null 2>&1 && [[ "$(sed -n 's/^TracerPid:[[:space:]]*//p' /proc/self/status)" == "0" ]]; then
  ampproj am7o; AM7O="$WORK/am7o-out"; rm -rf "${AM7O:?}"
  AM7OMSG="$(bash "$REPO_ROOT/bin/affected-trace.sh" --root "$P" --out "$AM7O" --jobs 2 --only "$AMS2" 2>&1)"; AM7ORC=$?
  [[ "$AM7ORC" -eq 0 && -s "$AM7O/_test-fixtures__s2__run-tests.sh.paths" && ! -e "$AM7O/_test-fixtures__s1__run-tests.sh.paths" && "$AM7OMSG" == "traced 1 suites, red: none" ]] && ok "AM7d --only traces just the named suite" || bad "AM7d (rc=$AM7ORC msg=$AM7OMSG)"
  bash "$REPO_ROOT/bin/affected-trace.sh" --root "$P" --out "$AM7O" --only nope/x >/dev/null 2>&1; RC=$?; OUT=""; ERR=""; check_rc "AM7e --only with an unknown id: exit 2" 2
fi
bash -n "$REPO_ROOT/bin/affected-trace.sh" && ok "AM8 bin/affected-trace.sh parses (bash -n)" || bad "AM8 bash -n"
