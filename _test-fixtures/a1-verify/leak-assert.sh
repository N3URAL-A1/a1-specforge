# Sourced by the new case files of a1-verify and a1-pr-merge-check (spec 027 slice 3, audit m13). Not named run*.sh on purpose.
# Real-lock leak assert: a fixture run must never leave a REAL lock behind (the per-uid verify lock or the runner lock).
#   lk_leak_start            record whether each real lock is present now
#   lk_leak_end <label>      red only when the lock is present and its owner PID is this suite's shell or a descendant of it,
#                            or when it was absent at start and is now present with a dead owner PID.
# A lock held by any other live process (another session's real run) is not red.
[[ -n "${LK_LEAK_LOADED:-}" ]] && return 0
LK_LEAK_LOADED=1
LK_REAL_VERIFY="$(node -p 'require("os").tmpdir()')/a1-verify-lock-$(id -u)"
LK_REAL_RUNNER="/tmp/a1-suite-runner-$(id -u)"
declare -a LK_START_PRESENT=()
# An outer `verify run` (the gate) exports A1_VERIFY_LOCK_TOKEN and holds the real lock. A case must never drop that token in the suite shell
# (a later case without its own lock dir would then wait on the outer holder: gate stall 2026-11-19, LZ7). lk_token_reset restores it.
LK_TOKEN_OUTER_SET="${A1_VERIFY_LOCK_TOKEN+x}"; LK_TOKEN_OUTER="${A1_VERIFY_LOCK_TOKEN-}"
LK_TOKEN_SENTINEL=""
lk_token_reset() {
  if [[ -n "$LK_TOKEN_OUTER_SET" ]]; then export A1_VERIFY_LOCK_TOKEN="$LK_TOKEN_OUTER"; else unset A1_VERIFY_LOCK_TOKEN; fi
}

# lk_owner_pid <dir> <kind>: verify lock keeps owner.json, runner lock a `pid` file.
lk_owner_pid() {
  if [[ "$2" == verify ]]; then node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1]+"/owner.json","utf8")).pid))}catch(e){}' "$1"
  else head -n 1 "$1/pid" 2>/dev/null; fi
}
# lk_is_mine <pid>: the pid is this suite's shell or a descendant of it.
lk_is_mine() {
  local p="$1" n=0
  while [[ "$p" =~ ^[0-9]+$ && "$p" -gt 1 && $n -lt 64 ]]; do
    [[ "$p" == "$$" ]] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"; n=$((n + 1))
  done
  return 1
}
lk_leak_start() {
  # with no outer token, a sentinel stands in for it so the end assert can tell whether a case dropped the token
  if [[ -z "$LK_TOKEN_OUTER_SET" ]]; then LK_TOKEN_SENTINEL=1; LK_TOKEN_OUTER_SET=x; LK_TOKEN_OUTER=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; export A1_VERIFY_LOCK_TOKEN="$LK_TOKEN_OUTER"; fi
  LK_START_PRESENT[0]=0; LK_START_PRESENT[1]=0
  [[ -e "$LK_REAL_VERIFY" || -L "$LK_REAL_VERIFY" ]] && LK_START_PRESENT[0]=1
  [[ -e "$LK_REAL_RUNNER" || -L "$LK_REAL_RUNNER" ]] && LK_START_PRESENT[1]=1
  return 0
}
lk_leak_one() { # <label> <dir> <kind> <start-present>
  local pid; [[ -e "$2" ]] || { ok "$1 no real lock left behind"; return 0; }
  pid="$(lk_owner_pid "$2" "$3")"
  if lk_is_mine "$pid"; then bad "$1 real lock $2 is held by this suite (pid $pid)"
  elif [[ "$4" == 0 ]] && ! kill -0 "$pid" 2>/dev/null; then bad "$1 real lock $2 appeared with a dead owner (pid ${pid:-none})"
  else ok "$1 real lock $2 not leaked by this suite"; fi
}
lk_leak_end() {
  [[ "${A1_VERIFY_LOCK_TOKEN-}" == "$LK_TOKEN_OUTER" ]] && ok "$1 outer A1_VERIFY_LOCK_TOKEN kept in the suite shell (no wait on an outer lock)" || bad "$1 a case dropped or changed the outer A1_VERIFY_LOCK_TOKEN"
  if [[ -n "$LK_TOKEN_SENTINEL" ]]; then unset A1_VERIFY_LOCK_TOKEN; LK_TOKEN_OUTER_SET=""; LK_TOKEN_OUTER=""; LK_TOKEN_SENTINEL=""; fi
  lk_leak_one "$1 verify-lock" "$LK_REAL_VERIFY" verify "${LK_START_PRESENT[0]}"
  lk_leak_one "$1 runner-lock" "$LK_REAL_RUNNER" runner "${LK_START_PRESENT[1]}"
}
