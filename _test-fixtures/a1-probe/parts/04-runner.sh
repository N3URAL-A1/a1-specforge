# parts/04-runner.sh — spec 020 Wave 4: runner, pair counter-test, --wait, exit contract
# (FR-001, FR-002, FR-007, FR-013, FR-014; SC-001, SC-002).
# Loopback only: every run that must reach the server sets A1_PROBE_ALLOW_LOOPBACK=1 for that one call.
# Route facts model the a1-office postmortems 2026-09-26-claudia-caps-audit-insert-500 (route answering 500)
# and 2026-10-15-postgrest-anon-inherited-crud (anon role allowed), Vault project/a1-office/postmortems/.
# A fresh server per timing-sensitive group keeps /flaky and the counters deterministic.

stop_server; start_server
H="127.0.0.1"
LB() { A1_PROBE_ALLOW_LOOPBACK=1 "$@"; }
now_s() { node -e 'process.stdout.write(String(Math.floor(Date.now()/1000)))'; }
jq1() { node -e 'let v=JSON.parse(process.argv[1]);for(const k of process.argv[2].split("."))v=v==null?v:v[k];process.stdout.write(v===undefined?"<undef>":typeof v==="object"?JSON.stringify(v):String(v))' "$1" "$2"; }
hdr() { printf 'version: 1\nhosts:\n  - name: %s\n    class: %s\n    allow_http: true\nprobes:\n' "$H" "${1:-staging}"; }

# --- stub is gone ---
expect "W4-0 no stub text left in probe.cjs" "0" "$(grep -c 'not implemented\|wave 4' "$REPO_ROOT/_shared/lib/probe.cjs")"

# --- FR-001: 3 probes -> 3 lines + summary ---
{ hdr; cat <<YML
  - id: root
    kind: http
    url: http://$H:$HTTP_PORT/ok
    expect:
      status: 200
  - id: port
    kind: tcp
    host: $H
    port: $TCP_PORT
    expect: open
  - id: denied
    kind: http
    url: http://$H:$HTTP_PORT/deny
    expect:
      status: 403
YML
} > "$WORK/in.yml"; put r-pass < "$WORK/in.yml"
LB probe run --project "$D"
expect "R1 all-pass exits 0" "0" "$RC"
expect "R1 3 result lines + summary = 4 lines" "4" "$(grep -c . <<<"$OUT")"
expect_has "R1 summary" "$OUT" "pass=3 fail=0 not_measured=0"
expect_has "R1 line root" "$OUT" "root http pass ok"
expect_has "R1 line port" "$OUT" "port tcp pass ok"
expect_has "R1 line carries status" "$OUT" "status=200"
expect_has "R1 line carries attempts" "$OUT" "attempts=1"
expect_has "R1 line carries duration" "$OUT" "duration_ms="
LB probe run --project "$D" --json
J="$OUT"
expect "R1j json exits 0" "0" "$RC"
expect "R1j 3 results" "3" "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).results.length))' "$J")"
expect "R1j summary pass" "3" "$(jq1 "$J" summary.pass)"
expect "R1j no_probes false" "false" "$(jq1 "$J" no_probes)"
expect "R1j exit field" "0" "$(jq1 "$J" exit)"
expect "R1j first verdict" "pass" "$(jq1 "$J" results.0.verdict)"

# --- FR-002 + SC-001: one fail -> 1, in < 15 s ---
{ hdr; cat <<YML
  - id: root
    kind: http
    url: http://$H:$HTTP_PORT/ok
    expect:
      status: 200
  - id: caps-insert
    kind: http
    url: http://$H:$HTTP_PORT/boom
    expect:
      status: 200
YML
} > "$WORK/in.yml"; put r-fail < "$WORK/in.yml"
t0="$(now_s)"; LB probe run --project "$D"; t1="$(now_s)"
expect "R2 one-fail exits 1" "1" "$RC"
expect_has "R2 names the failing probe + reason" "$OUT" "caps-insert http fail status_mismatch"
expect_has "R2 summary" "$OUT" "pass=1 fail=1 not_measured=0"
if [[ $((t1 - t0)) -lt 15 ]]; then ok "R2 SC-001 500 route fails in < 15 s"; else bad "R2 SC-001 took $((t1 - t0)) s"; fi

# unknown kind -> 2, unreadable path -> 2 (never 0), nonexistent file target
{ hdr; printf '  - id: x\n    kind: command\n'; } > "$WORK/in.yml"; put r-kind < "$WORK/in.yml"
LB probe run --project "$D"; expect "R3 unknown kind exits 2" "2" "$RC"; expect_has "R3 names unknown_kind" "$ERR" "unknown_kind"
LB probe run --project "$WORK/does-not-exist"; expect "R3 unreadable path exits 2" "2" "$RC"
: > "$WORK/r-afile"; LB probe run --project "$WORK/r-afile"; expect "R3 project is a file exits 2" "2" "$RC"

# blocked host: exit 2 before any request (no ALLOW env)
probe run --project "$WORK/r-pass"
expect "R4 loopback without ALLOW exits 2" "2" "$RC"
expect_has "R4 names blocked_host" "$ERR" "blocked_host"
expect_lacks "R4 prints no result line" "$OUT" "root http"
{ printf 'version: 1\nhosts:\n  - name: 169.254.169.254\n    class: staging\n    allow_http: true\nprobes:\n  - id: meta\n    kind: http\n    url: http://169.254.169.254/latest\n    expect:\n      status: 200\n'; } > "$WORK/in.yml"; put r-meta < "$WORK/in.yml"
LB probe run --project "$D"; expect "R4b metadata host exits 2 even with ALLOW_LOOPBACK" "2" "$RC"
expect_has "R4b names blocked_host" "$ERR" "blocked_host"

# not_measured counts toward exit 1 (env refs are only allowed over https: the missing variable stops the probe before any connect)
{ hdr; cat <<YML
  - id: authed
    kind: http
    url: https://$H:$HTTP_PORT/ok
    headers:
      X-Probe-Id: {env: A1_PROBE_TEST_UNSET_VAR}
    expect:
      status: 200
YML
} > "$WORK/in.yml"; put r-nm < "$WORK/in.yml"
env -u A1_PROBE_TEST_UNSET_VAR A1_PROBE_ALLOW_LOOPBACK=1 node "$TOOLS" probe run --project "$D" > "$WORK/nm.out" 2> "$WORK/nm.err"; RC=$?
OUT="$(cat "$WORK/nm.out")"
expect "R5 unset env exits 1" "1" "$RC"
expect_has "R5 not_measured env_missing" "$OUT" "authed http not_measured env_missing"
expect_has "R5 summary" "$OUT" "pass=0 fail=0 not_measured=1"

# --- FR-007: pair ---
pairfile() { # pairfile <case> <allow-path> <allow-status> <deny-path> <deny-status> [deny-extra]
  { hdr; cat <<YML
  - id: anon-role
    kind: pair
    allow:
      kind: http
      url: http://$H:$HTTP_PORT$2
      expect:
        status: $3
    deny:
      kind: http
      url: http://$H:$HTTP_PORT$4
      expect:
        status: $5
${6:-}
YML
  } > "$WORK/in.yml"; put "$1" < "$WORK/in.yml"
}
pairfile p-ok /ok 200 /deny 403
LB probe run --project "$D"
expect "P1 allow=200 deny=403 passes" "0" "$RC"
expect_has "P1 pair line" "$OUT" "anon-role pair pass ok"
pairfile p-open /ok 200 /ok 403
LB probe run --project "$D"
expect "P2 allow=200 deny=200 exits 1" "1" "$RC"
expect_has "P2 reason deny_half_open" "$OUT" "anon-role pair fail deny_half_open"
pairfile p-allowfail /boom 200 /deny 403
LB probe run --project "$D"
expect "P3 allow fails, deny passes: still exit 1" "1" "$RC"
expect_has "P3 names the allow half" "$OUT" "anon-role pair fail allow_failed"
pairfile p-denyfail /ok 200 /hang 403 "      timeout_ms: 1000"
LB probe run --project "$D"
expect "P4 deny half times out: exit 1" "1" "$RC"
expect_has "P4 reason deny_failed" "$OUT" "anon-role pair fail deny_failed"
{ hdr; cat <<YML
  - id: port-pair
    kind: pair
    allow:
      kind: tcp
      host: $H
      port: $TCP_PORT
      expect: open
    deny:
      kind: tcp
      host: $H
      port: $TCP_PORT
      expect: closed
YML
} > "$WORK/in.yml"; put p-tcp < "$WORK/in.yml"
LB probe run --project "$D"
expect "P5 tcp pair whose deny half is open exits 1" "1" "$RC"
expect_has "P5 deny_half_open for tcp" "$OUT" "port-pair pair fail deny_half_open"

# SC-002: anon route, vulnerable then fixed server
pairfile sc2 /ok 200 /anon 401
LB probe run --project "$D"
expect "S1 SC-002 anon route open: exit 1" "1" "$RC"
expect_has "S1 deny_half_open" "$OUT" "deny_half_open"
stop_server; start_server --fixed
pairfile sc2f /ok 200 /anon 401
LB probe run --project "$D"
expect "S2 SC-002 fixed server (401): exit 0" "0" "$RC"
expect_has "S2 passes" "$OUT" "anon-role pair pass ok"
stop_server; start_server

# --- FR-013: --wait ---
{ hdr; cat <<YML
  - id: warm-up
    kind: http
    url: http://$H:$HTTP_PORT/flaky
    expect:
      status: 200
YML
} > "$WORK/in.yml"; put w-flaky < "$WORK/in.yml"
LB probe run --project "$D"
expect "W1 without --wait the first 503 fails" "1" "$RC"
expect_has "W1 attempts=1" "$OUT" "attempts=1"
stop_server; start_server
{ hdr; cat <<YML
  - id: warm-up
    kind: http
    url: http://$H:$HTTP_PORT/flaky
    expect:
      status: 200
YML
} > "$WORK/in.yml"; put w-flaky2 < "$WORK/in.yml"
LB probe run --project "$D" --wait 30
expect "W2 503,503,200 with --wait 30 passes" "0" "$RC"
expect_has "W2 attempts=3" "$OUT" "attempts=3"
expect "W2 server saw exactly 3 requests" "3" "$(srv_total)"
{ hdr; cat <<YML
  - id: sink
    kind: http
    method: POST
    url: http://$H:$HTTP_PORT/boom
    expect:
      status: 200
YML
} > "$WORK/in.yml"; put w-post < "$WORK/in.yml"
b="$(srv_total)"; t0="$(now_s)"
LB probe run --project "$D" --wait 12
t1="$(now_s)"
expect "W3 mutating probe fails" "1" "$RC"
expect_has "W3 staging POST runs once (attempts=1)" "$OUT" "attempts=1"
expect "W3 exactly one request" "$((b + 1))" "$(srv_total)"
if [[ $((t1 - t0)) -lt 4 ]]; then ok "W3 no waiting for a mutating probe"; else bad "W3 waited $((t1 - t0)) s"; fi
{ hdr; cat <<YML
  - id: stays-down
    kind: http
    url: http://$H:$HTTP_PORT/boom
    expect:
      status: 200
YML
} > "$WORK/in.yml"; put w-cap < "$WORK/in.yml"
b="$(srv_total)"
LB probe run --project "$D" --wait 6
expect "W4 still failing at the cap: exit 1" "1" "$RC"
expect_has "W4 attempts=2 (t=0 and t=5, cap 6)" "$OUT" "attempts=2"
expect "W4 two requests" "$((b + 2))" "$(srv_total)"
LB probe run --project "$D" --wait 601; expect "W5 --wait 601 exits 2" "2" "$RC"

# --- FR-014: no_probes ---
mkdir -p "$WORK/n-empty"
real="$(cd "$WORK/n-empty" && pwd -P)"
LB probe run --project "$WORK/n-empty"
expect "N1 no file exits 0" "0" "$RC"
expect "N1 warning line" "no_probes: $real/.a1/live-probes.yaml not found" "$OUT"
LB probe run --project "$WORK/n-empty" --json
expect "N1j json no_probes true" "true" "$(jq1 "$OUT" no_probes)"
expect "N1j exit 0 in json" "0" "$(jq1 "$OUT" exit)"
put n-list <<<$'version: 1\nprobes: []'
real="$(cd "$D" && pwd -P)"
LB probe run --project "$D"
expect "N2 probes: [] exits 0" "0" "$RC"
expect "N2 warning line" "no_probes: $real/.a1/live-probes.yaml has no probes" "$OUT"
LB probe run --project "$D" --json
expect "N2j json no_probes true" "true" "$(jq1 "$OUT" no_probes)"
put n-list2 <<<"$(printf 'version: 1\nhosts:\n  - name: %s\n    class: staging\nprobes: []' "$H")"
LB probe run --project "$D"; expect "N3 hosts but no probes exits 0" "0" "$RC"
expect_has "N3 still no_probes" "$OUT" "has no probes"

# --- total run budget (FR-011): remaining probes become fail timeout_budget ---
R="$(cd "$SHARED/.." && A1_PROBE_ALLOW_LOOPBACK=1 node -e '
const { execute } = require("./_shared/lib/probe.cjs");
const mk = (id) => ({ id, kind: "http", url: "http://127.0.0.1:" + process.argv[1] + "/hang", host: "127.0.0.1", host_class: "staging", method: "GET", headers: {}, query: {}, expect: { status: [200] }, timeout_ms: 1000 });
execute({ probes: [mk("a"), mk("b"), mk("c")] }, { env: process.env, budgetMs: 1500, waitS: 0 })
  .then((r) => process.stdout.write(JSON.stringify(r.map((x) => x.reason))));' "$HTTP_PORT")"
expect "B1 two timeouts, then timeout_budget" '["timeout","timeout","timeout_budget"]' "$R"
