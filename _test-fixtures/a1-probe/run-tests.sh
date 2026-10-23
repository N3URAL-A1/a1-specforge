#!/usr/bin/env bash
# Fixture suite: a1-probe — live probes (spec 020).
#
# HARNESS ONLY (Wave 1, frozen afterwards): isolation, helpers, loopback server, counters, summary.
# Every case lives in parts/NN-<group>.sh, sourced below in NN order. Later waves add a part, never edit
# this file. The only network the suite touches is server.cjs on 127.0.0.1 (ephemeral ports); the server
# is started with `node server.cjs & SRV_PID=$!` and killed by that PID only (never pkill).
#
# Mutation proofs run this suite against a git-archive snapshot of the repo (A1_FX_TOOLS points at the
# snapshot's a1-tools.cjs); the live tree is never mutated.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SUITE_DIR/../.." && pwd)"
TOOLS="${A1_FX_TOOLS:-$REPO_ROOT/_shared/a1-tools.cjs}"
SHARED="$(dirname "$TOOLS")"
export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0

mk_workdir WORK probe
: "${WORK:?}"

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }
expect() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi; }
# expect_has <name> <haystack> <fixed-string> / expect_lacks (same args)
expect_has()   { if grep -qF -- "$3" <<<"$2"; then ok "$1"; else bad "$1 (missing '$3' in: ${2:0:200})"; fi; }
expect_lacks() { if grep -qF -- "$3" <<<"$2"; then bad "$1 (found '$3')"; else ok "$1"; fi; }
# expect_count <name> <expected> <haystack> <fixed-string>  (count of matching lines)
expect_count() {
  local n; n="$(grep -cF -- "$4" <<<"$3")"
  if [[ "$n" == "$2" ]]; then ok "$1"; else bad "$1 (expected $2 lines with '$4', got $n)"; fi
}

SRV_PID=""; HTTP_PORT=""; TCP_PORT=""
stop_server() {
  if [[ -n "$SRV_PID" ]]; then kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; SRV_PID=""; fi
  return 0
}
suite_exit() { stop_server; a1_fx_cleanup; }
trap suite_exit EXIT

# start_server [server args] — sets SRV_PID, HTTP_PORT, TCP_PORT.
start_server() {
  local out="$WORK/srv.$$.$RANDOM.out" i
  node "$SUITE_DIR/server.cjs" "$@" > "$out" 2>&1 &
  SRV_PID=$!
  for i in $(seq 1 100); do
    [[ -s "$out" ]] && break
    sleep 0.1
  done
  HTTP_PORT="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).http))' "$out" 2>/dev/null)"
  TCP_PORT="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tcp))' "$out" 2>/dev/null)"
  if [[ -z "$HTTP_PORT" || -z "$TCP_PORT" ]]; then echo "FAIL  harness: loopback server did not start"; exit 2; fi
}

# srv_total — requests the loopback server has counted so far (not counting /__count itself).
srv_total() {
  node -e 'require("http").get({host:"127.0.0.1",port:+process.argv[1],path:"/__count"},r=>{let b="";r.on("data",d=>b+=d);r.on("end",()=>process.stdout.write(String(JSON.parse(b).total)))}).on("error",()=>process.stdout.write("ERR"))' "$HTTP_PORT"
}

# put <case> — stdin becomes <WORK>/<case>/.a1/live-probes.yaml; sets D to the project dir.
put() {
  D="$WORK/$1"; : "${D:?}"
  mkdir -p "$D/.a1"
  cat > "$D/.a1/live-probes.yaml"
}

# probe <args...> — sets RC, OUT (stdout), ERR (stderr). Fixed env: no allow-loopback unless the caller sets it.
probe() {
  local o="$WORK/o.$$" e="$WORK/e.$$"
  node "$TOOLS" probe "$@" > "$o" 2> "$e"; RC=$?
  OUT="$(cat "$o")"; ERR="$(cat "$e")"
}

# reject <name> <code-or-key> — last `probe` call must be a parse-time rejection: exit 2, stderr names
# <code-or-key>, no "not implemented" (that would mean the stub, i.e. the file parsed), no request sent.
reject() {
  expect "$1 exits 2" "2" "$RC"
  expect_has "$1 names '$2'" "$ERR" "$2"
  expect_lacks "$1 was rejected, not stubbed" "$ERR" "not implemented"
  expect "$1 sent no request" "0" "$(srv_total)"
}
# accept <name> — the file parsed and policy passed: the run stops at the address guard (exit 2,
# blocked_host) because these calls do not set A1_PROBE_ALLOW_LOOPBACK, so no request is ever sent.
accept() {
  expect "$1 parses (address guard exit 2)" "2" "$RC"
  expect_has "$1 reaches the address guard" "$ERR" "blocked_host"
  expect "$1 sent no request" "0" "$(srv_total)"
}

start_server
for part in "$SUITE_DIR"/parts/[0-9][0-9]-*.sh; do
  # shellcheck disable=SC1090
  . "$part"
done
stop_server

echo "a1-probe: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
