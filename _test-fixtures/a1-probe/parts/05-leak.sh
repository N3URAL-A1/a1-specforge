# parts/05-leak.sh — spec 020 Wave 5: leak proof and offline behaviour (FR-009, FR-015; SC-003).
# FR-009: a planted credential (A1_FX_SECRET) and the server's body/header markers never reach stdout, stderr,
#   --json output or any file under the project's .a1 tree, on the pass, fail, timeout, tls_error, env_missing
#   and pair paths. The gate-log half of the search (hook needs the registry row) lives in parts/06-wiring.sh.
# FR-015: the offline case runs only where the host has no network (docker --network none); on a host with a
#   network it prints SKIP and counts it, never silently. CI never runs the probe CLI against a network.
# Docker (non-root, snapshot of HEAD, own container name):
#   S="$(mktemp -d)"; git archive HEAD | tar -x -C "$S"
#   docker run --rm --name a1-probe-w5 --network none -u 1000:1000 -v "$S":/w:ro node:20 \
#     bash /w/_test-fixtures/a1-probe/run-tests.sh
# Loopback only. Route facts: /marker answers 500 with BODYMARK-7f3a91 (shape of the 2026-09-26 a1-office postmortem).

stop_server; start_server
H="127.0.0.1"
SECRET="zq-$RANDOM$RANDOM-$$-$(date +%s)"
BODYMARK="BODYMARK-7f3a91"; HDRMARK="HDRMARK-7f3a91"
hdr5() { printf 'version: 1\nhosts:\n  - name: %s\n    class: staging\n    allow_http: true\nprobes:\n' "$H"; }

{ hdr5; cat <<YML
  - id: ok-probe
    kind: http
    url: http://$H:$HTTP_PORT/ok
    expect:
      status: 200
  - id: fail-probe
    kind: http
    url: http://$H:$HTTP_PORT/marker
    expect:
      status: 200
  - id: body-probe
    kind: http
    url: http://$H:$HTTP_PORT/marker
    expect:
      status: 500
      body_contains: NOT-THERE
  - id: hang-probe
    kind: http
    url: http://$H:$HTTP_PORT/hang
    timeout_ms: 700
    expect:
      status: 200
  - id: tls-probe
    kind: http
    url: https://$H:$HTTP_PORT/echo-secret
    headers:
      Authorization: {env: A1_FX_SECRET}
    query:
      token: {env: A1_FX_SECRET}
    expect:
      status: 200
  - id: envmiss-probe
    kind: http
    url: https://$H:$HTTP_PORT/echo-secret
    headers:
      X-Api-Key: {env: A1_FX_UNSET_VAR}
    expect:
      status: 200
  - id: pair-probe
    kind: pair
    allow:
      kind: http
      url: http://$H:$HTTP_PORT/ok
      expect:
        status: 200
    deny:
      kind: http
      url: http://$H:$HTTP_PORT/marker
      expect:
        status: 403
YML
} > "$WORK/in.yml"; put leak < "$WORK/in.yml"
LEAK_D="$D"

leak_run() { # leak_run <label> [extra args] — env carries the secret; sets RC OUT ERR
  local o="$WORK/l.out.$$" e="$WORK/l.err.$$"
  commit_all; env -u A1_FX_UNSET_VAR A1_FX_SECRET="$SECRET" A1_PROBE_ALLOW_LOOPBACK=1 node "$TOOLS" probe run --project "$LEAK_D" "${@:2}" > "$o" 2> "$e"; RC=$?
  OUT="$(cat "$o")"; ERR="$(cat "$e")"
}
nocount() { # nocount <name> <haystack> <needle> — count of lines holding the needle is 0
  local n; n="$(grep -cF -- "$3" <<<"$2")"
  if [[ "$n" == "0" ]]; then ok "$1"; else bad "$1 ($n lines contain '$3')"; fi
}

leak_run text
expect "L1 text run exits 1 (fails present)" "1" "$RC"
# every reason path must be present, else the absence proof proves nothing
expect_has "L1 pass path present" "$OUT" "ok-probe http pass ok"
expect_has "L1 fail path present" "$OUT" "fail-probe http fail status_mismatch"
expect_has "L1 body path present" "$OUT" "body-probe http fail body_mismatch"
expect_has "L1 timeout path present" "$OUT" "hang-probe http fail timeout"
expect_has "L1 tls_error path present" "$OUT" "tls-probe http fail tls_error"
expect_has "L1 env_missing path present" "$OUT" "envmiss-probe http not_measured env_missing"
expect_has "L1 pair path present" "$OUT" "pair-probe pair fail deny_failed"
T_OUT="$OUT"; T_ERR="$ERR"
leak_run json --json
J_OUT="$OUT"; J_ERR="$ERR"
expect "L1j json run exits 1" "1" "$RC"
expect "L1j 7 results" "7" "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).results.length))' "$J_OUT")"
FILES="$(find "$LEAK_D/.a1" -type f -exec cat {} + 2>/dev/null)"
expect_has "L1f search covers the probe file" "$FILES" "ok-probe"
for ch in "text-stdout:$T_OUT" "text-stderr:$T_ERR" "json-stdout:$J_OUT" "json-stderr:$J_ERR" "files:$FILES"; do
  name="${ch%%:*}"; hay="${ch#*:}"
  nocount "L2 secret absent from $name" "$hay" "$SECRET"
  nocount "L2 body marker absent from $name" "$hay" "$BODYMARK"
  nocount "L2 header marker absent from $name" "$hay" "$HDRMARK"
done
nocount "L2 secret absent from the env-var name echo" "$T_OUT$J_OUT" "Authorization"

# resolved-value redaction in diagnostics: a secret inside raw error text is dropped (by value, not pattern)
scrub="$(node -e '
const n=require(process.argv[1]+"/lib/probe-net.cjs");
const t="connect failed for "+process.argv[2]+" at host";
process.stdout.write(n.scrubText(t,[process.argv[2]])+"|"+n.scrubText("plain text",[process.argv[2]])+"|"+n.scrubText("x",[]));
' "$SHARED" "$SECRET" 2>&1)"
expect_lacks "L3 scrubText removes the secret value" "$scrub" "$SECRET"
expect_has "L3 scrubText keeps unrelated text" "$scrub" "|plain text|x"
# an internal error message carrying a secret value is dropped by the facade sink
die_out="$(A1_FX_SECRET="$SECRET" node -e '
const path=require("path");const p=require(path.join(process.argv[1],"lib/probe.cjs"));
process.stdout.write(typeof p.scrubMessage==="function"?p.scrubMessage("boom "+process.env.A1_FX_SECRET,[process.env.A1_FX_SECRET]):"NOFN");
' "$SHARED" 2>&1)"
expect_lacks "L3b scrubMessage removes the secret value" "$die_out" "$SECRET"
expect_lacks "L3b scrubMessage exists" "$die_out" "NOFN"

# --- FR-015: unreachable without a network -> exit 1; no workflow runs the probe CLI ---
expect "L4 no workflow runs 'probe run'" "0" "$(cat "$REPO_ROOT"/.github/workflows/*.yml | grep -c 'probe run')"
OFFLINE=0
# offline = Linux with no interface other than lo in state "up" (docker --network none leaves only down stubs)
if [[ -d /sys/class/net ]]; then
  OFFLINE=1
  for ifc in /sys/class/net/*; do
    [[ "$(basename "$ifc")" == "lo" ]] && continue
    [[ "$(cat "$ifc/operstate" 2>/dev/null)" == "down" ]] || OFFLINE=0
  done
fi
if [[ "$OFFLINE" == "1" ]]; then
  cat > "$WORK/off.yml" <<'YML'
version: 1
hosts:
  - name: example.com
    class: staging
probes:
  - id: public
    kind: http
    url: https://example.com/
    timeout_ms: 3000
    expect:
      status: 200
YML
  put offline < "$WORK/off.yml"
  SRV_BEFORE="$(srv_total)"
  probe run --project "$D"
  expect "L4 offline public name exits 1" "1" "$RC"
  if grep -qE 'public http fail (unreachable|dns_error)' <<<"$OUT"; then ok "L4 offline reason is unreachable/dns_error"; else bad "L4 offline reason (got: ${OUT:0:200})"; fi
  expect "L4 offline run sent nothing to the loopback server" "$SRV_BEFORE" "$(srv_total)"
else
  skip "L4 offline case (network present; runs under docker --network none)"
fi
stop_server
