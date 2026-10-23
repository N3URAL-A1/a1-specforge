# parts/02-net.sh — spec 020 Wave 2: http/tcp executors, address guard, limits (FR-005, FR-006, FR-010, FR-011).
# Drives _shared/lib/probe-net.cjs through fixtures/net/harness.cjs (probe.cjs still stubs the runner until Wave 4,
# so the preflight exit-2 cases use the harness `preflight` mode: it exits 0 clean, 3 never; blocked_host is reported
# in the JSON and Wave 4 maps it to exit 2). Loopback only: no non-loopback address is ever contacted; the
# address-guard cases are pure classification or hit the guard before any connect.
NETH="$SUITE_DIR/fixtures/net/harness.cjs"
jf() { node -e 'const o=JSON.parse(process.argv[1]);const v=o[process.argv[2]];process.stdout.write(v===undefined?"<undef>":String(v))' "$1" "$2"; }
nh() { # nh <mode> <json> [ALLOW=1]
  local allow="${3:-0}"
  if [[ "$allow" == 1 ]]; then A1_PROBE_ALLOW_LOOPBACK=1 node "$NETH" "$1" "$2" 2>"$WORK/nh.err"; else node "$NETH" "$1" "$2" 2>"$WORK/nh.err"; fi
}
hp() { # hp <path> <expect-json> [extra-json-members]  -> normalized http probe on the loopback server
  printf '{"kind":"http","url":"http://127.0.0.1:%s%s","host":"127.0.0.1","host_class":"staging","method":"GET","headers":{},"query":{},"expect":%s,"timeout_ms":%s%s}' \
    "$HTTP_PORT" "$1" "$2" "${TMO:-3000}" "${3:-}"
}

# --- FR-005 http executor ---
R="$(nh http "$(hp /ok '{"status":[200],"json":{"path":"ok","equals":true}}')" 1)"
expect "N1 200 + json ok=true passes" "true" "$(jf "$R" pass)"
expect "N1 status reported" "200" "$(jf "$R" status)"
expect_lacks "N1 result carries no body" "$R" '"ok":true'
R="$(nh http "$(hp /boom '{"status":[200]}')" 1)"
expect "N2 500 fails" "false" "$(jf "$R" pass)"
expect "N2 reason status_mismatch" "status_mismatch" "$(jf "$R" reason)"
R="$(nh http "$(hp /ok '{"status":[200],"body_contains":"nope"}')" 1)"
expect "N3 body_contains mismatch" "body_mismatch" "$(jf "$R" reason)"
R="$(nh http "$(hp /ok '{"status":[200],"body_contains":"ok"}')" 1)"
expect "N3 body_contains hit passes" "true" "$(jf "$R" pass)"
R="$(nh http "$(hp /ok '{"status":[200],"header":{"name":"x-probe","matches":"no"}}')" 1)"
expect "N4 header.matches mismatch" "header_mismatch" "$(jf "$R" reason)"
R="$(nh http "$(hp /ok '{"status":[200],"header":{"name":"x-probe","matches":"yes"}}')" 1)"
expect "N4 header.matches hit passes" "true" "$(jf "$R" pass)"
R="$(nh http "$(hp /ok '{"status":[200],"json":{"path":"ok","equals":false}}')" 1)"
expect "N5 json equals mismatch" "json_mismatch" "$(jf "$R" reason)"
R="$(nh http "$(hp /deny '{"status":[200],"json":{"path":"ok","equals":true}}')" 1)"
expect "N5b status checked before json" "status_mismatch" "$(jf "$R" reason)"
R="$(nh http "$(hp /redirect '{"status":[302],"json":{"path":"ok","equals":true}}')" 1)"
expect "N6 invalid json body" "json_invalid" "$(jf "$R" reason)"
for seg in __proto__ constructor prototype; do
  EXP="{\"status\":[200],\"json\":{\"path\":\"$seg.x\",\"equals\":true}}"
  R="$(nh http "$(hp /ok "$EXP")" 1)"
  expect "N7 json path segment $seg refused" "json_path_invalid" "$(jf "$R" reason)"
done
R="$(nh http "$(hp /ok '{"status":[200],"json":{"path":"ok.missing","equals":true}}')" 1)"
expect "N7b missing path is a mismatch, not a crash" "json_mismatch" "$(jf "$R" reason)"

# --- FR-010 redirects, address guard ---
before="$(srv_total)"
R="$(nh http "$(hp /redirect '{"status":[302]}')" 1)"
expect "N8 302 reported as status" "302" "$(jf "$R" status)"
expect "N8 302 passes when expected" "true" "$(jf "$R" pass)"
expect "N8 exactly one request, redirect not followed" "$((before + 1))" "$(srv_total)"
R="$(nh http "$(hp /redirect '{"status":[200]}')" 1)"
expect "N8b 302 vs 200 is status_mismatch" "status_mismatch" "$(jf "$R" reason)"

CL="$(node "$NETH" classify '["169.254.169.254","::ffff:169.254.169.254","::ffff:a9fe:a9fe","10.0.0.1","100.64.0.1","172.16.0.1","172.31.255.255","192.168.1.1","192.0.0.1","198.18.0.1","224.0.0.1","240.0.0.1","255.255.255.255","0.0.0.0","::","fc00::1","fd00:ec2::254","fe80::1","ff02::1","64:ff9b::a00:1","64:ff9b::7f00:1","::10.0.0.1","2002:a00:1::1","127.0.0.1","::1","::ffff:127.0.0.1","93.184.216.34","172.32.0.1","2001:4860:4860::8888"]')"
expect "N9 classifier on 29 addresses" "29" "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).length))' "$CL")"
cls() { node -e 'const a=JSON.parse(process.argv[1]);process.stdout.write(String(a[+process.argv[2]]))' "$CL" "$1"; }
i=0
for want in blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked loopback loopback loopback ok ok ok; do
  expect "N9 classify #$i" "$want" "$(cls $i)"; i=$((i + 1))
done

# --- SEC-5 (review round): more special-purpose ranges ---
SEC5_ADDRS=(fec0::1 2001:0:4136:e378:8000:63bf:3fff:fdd2 64:ff9b:1::a00:1 64:ff9b:1:a00:0:100:: ::ffff:0:a00:1 ::ffff:0:7f00:1 100::1 192.0.2.1 198.51.100.7 203.0.113.9
  ::ffff:0:5db8:d822 100:0:0:1::1 2001:1::1 192.0.3.1 198.51.101.1 203.0.114.1 64:ff9b::5db8:d822)
SEC5_WANT=(blocked blocked blocked blocked blocked blocked blocked blocked blocked blocked
  ok ok ok ok ok ok ok)
SEC5_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${SEC5_ADDRS[@]}")"
SEC5_CL="$(node "$NETH" classify "$SEC5_JSON")"
expect "N9b classifier on ${#SEC5_ADDRS[@]} added addresses" "${#SEC5_ADDRS[@]}" "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).length))' "$SEC5_CL")"
i=0
for want in "${SEC5_WANT[@]}"; do
  expect "N9b classify ${SEC5_ADDRS[$i]}" "$want" "$(node -e 'const a=JSON.parse(process.argv[1]);process.stdout.write(String(a[+process.argv[2]]))' "$SEC5_CL" "$i")"; i=$((i + 1))
done

PF() { A1_PROBE_ALLOW_LOOPBACK="${2:-}" node "$NETH" preflight "$1" 2>/dev/null; }
for h in 169.254.169.254 ::ffff:169.254.169.254 10.0.0.1 localhost 127.0.0.1; do
  R="$(env -u A1_PROBE_ALLOW_LOOPBACK node "$NETH" preflight "[\"$h\"]" 2>/dev/null)"
  expect "N10 preflight blocks $h" "blocked_host" "$(jf "$R" reason)"
  expect "N10 preflight $h not ok" "false" "$(jf "$R" ok)"
done
R="$(PF '["127.0.0.1"]' 1)"
expect "N11 allow-loopback unblocks 127.0.0.1" "true" "$(jf "$R" ok)"
R="$(PF '["localhost"]' 1)"
expect "N11 allow-loopback unblocks localhost" "true" "$(jf "$R" ok)"
R="$(PF '["10.0.0.1"]' 1)"
expect "N11 allow-loopback does not unblock 10/8" "blocked_host" "$(jf "$R" reason)"
R="$(PF '["169.254.169.254"]' 1)"
expect "N11 allow-loopback does not unblock metadata" "blocked_host" "$(jf "$R" reason)"

# guard without ALLOW: the executor sends nothing
before="$(srv_total)"
R="$(env -u A1_PROBE_ALLOW_LOOPBACK node "$NETH" http "$(hp /ok '{"status":[200]}')" 2>/dev/null)"
expect "N12 loopback without allow is blocked" "true" "$(jf "$R" blocked)"
expect "N12 reason blocked_host" "blocked_host" "$(jf "$R" reason)"
expect "N12 no request reached the server" "$before" "$(srv_total)"
before="$(srv_total)"
R="$(env -u A1_PROBE_ALLOW_LOOPBACK node "$NETH" tcp "{\"kind\":\"tcp\",\"host\":\"127.0.0.1\",\"port\":$TCP_PORT,\"expect\":\"open\",\"timeout_ms\":2000}" 2>/dev/null)"
expect "N12b tcp loopback without allow is blocked" "blocked_host" "$(jf "$R" reason)"
expect "N12b lookup guard stopped it before any TCP connect (server counts connections)" "$before" "$(srv_total)"

# lookup layer (a name, not an IP literal): "localhost" resolves to loopback; the guard must stop it before connect
before="$(srv_total)"
R="$(env -u A1_PROBE_ALLOW_LOOPBACK node "$NETH" tcp "{\"kind\":\"tcp\",\"host\":\"localhost\",\"port\":$TCP_PORT,\"expect\":\"open\",\"timeout_ms\":2000}" 2>/dev/null)"
expect "N12c localhost name blocked by the lookup guard" "blocked_host" "$(jf "$R" reason)"
expect "N12c no TCP connection was made" "$before" "$(srv_total)"

# rebinding: lookup says "fine", the connection lands on 127.0.0.1 (blocked without allow) -> socket destroyed
before="$(srv_total)"
RB="$(hp /ok '{"status":[200]}')"; RB="${RB//http:\/\/127.0.0.1:/http://rebind.invalid:}"
R="$(env -u A1_PROBE_ALLOW_LOOPBACK node "$NETH" http-rawlookup "$RB" 2>/dev/null)"
expect "N13 connected-address check blocks" "blocked_host" "$(jf "$R" reason)"
expect "N13 flagged blocked" "true" "$(jf "$R" blocked)"
expect "N13 server saw no request" "$before" "$(srv_total)"

# --- FR-011 timeouts and caps ---
t0=$(date +%s)
R="$(nh http "$(TMO=1000 hp /hang '{"status":[200]}')" 1)"
t1=$(date +%s)
expect "N14 hang -> timeout" "timeout" "$(jf "$R" reason)"
[[ $((t1 - t0)) -le 2 ]] && ok "N14 within 2 s" || bad "N14 within 2 s (took $((t1 - t0)) s)"
R="$(nh http "$(TMO=1000 hp /slow '{"status":[200],"body_contains":"zzz"}')" 1)"
expect "N15 slow-loris -> timeout" "timeout" "$(jf "$R" reason)"
R="$(nh http "$(TMO=8000 hp /big '{"status":[200],"body_contains":"zzz"}')" 1)"
expect "N16 5 MiB body -> body_too_large" "body_too_large" "$(jf "$R" reason)"
BR="$(jf "$R" bytes_read)"
[[ "$BR" =~ ^[0-9]+$ && "$BR" -le $((1024 * 1024 + 65536)) && "$BR" -ge $((1024 * 1024)) ]] && ok "N16 read stopped at the 1 MiB cap ($BR)" || bad "N16 read stopped at the 1 MiB cap ($BR)"
R="$(nh http "$(TMO=8000 hp /big '{"status":[200]}')" 1)"
expect "N16b status-only probe on big body passes" "true" "$(jf "$R" pass)"

# --- env values ---
before="$(srv_total)"
P='{"kind":"http","url":"http://127.0.0.1:'"$HTTP_PORT"'/echo-secret","host":"127.0.0.1","host_class":"staging","method":"GET","headers":{"X-Api":{"env":"PROBE_TOK"}},"query":{},"expect":{"status":[200]},"timeout_ms":2000}'
R="$(env -u PROBE_TOK A1_PROBE_ALLOW_LOOPBACK=1 node "$NETH" http "$P" 2>/dev/null)"
expect "N17 unset env -> env_missing" "env_missing" "$(jf "$R" reason)"
expect "N17 not_measured" "true" "$(jf "$R" not_measured)"
expect "N17 no socket opened" "$before" "$(srv_total)"
R="$(PROBE_TOK=s3cr3t-value A1_PROBE_ALLOW_LOOPBACK=1 node "$NETH" http "$P" 2>/dev/null)"
expect "N18 set env -> request goes out" "true" "$(jf "$R" pass)"
expect_lacks "N18 secret absent from result" "$R" "s3cr3t-value"
P='{"kind":"http","url":"http://127.0.0.1:'"$HTTP_PORT"'/ok","host":"127.0.0.1","host_class":"staging","method":"GET","headers":{"X-Api":{"env":"PROBE_TOK"}},"query":{},"expect":{"status":[200]},"timeout_ms":2000}'
R="$(PROBE_TOK=$'a\r\nInjected: 1' A1_PROBE_ALLOW_LOOPBACK=1 node "$NETH" http "$P" 2>/dev/null)"
expect "N19 header injection value refused" "false" "$(jf "$R" pass)"
expect "N19 reason bad_request" "bad_request" "$(jf "$R" reason)"

# --- FR-006 tcp ---
tp() { printf '{"kind":"tcp","host":"127.0.0.1","port":%s,"expect":"%s","timeout_ms":2000}' "$1" "$2"; }
R="$(nh tcp "$(tp "$TCP_PORT" open)" 1)"
expect "T1 listening port, expect open" "true" "$(jf "$R" pass)"
R="$(nh tcp "$(tp "$TCP_PORT" closed)" 1)"
expect "T2 listening port, expect closed fails" "false" "$(jf "$R" pass)"
expect "T2 reason unexpected_open" "unexpected_open" "$(jf "$R" reason)"
DEAD="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>process.stdout.write(String(p)))})')"
R="$(nh tcp "$(tp "$DEAD" closed)" 1)"
expect "T3 closed port, expect closed passes" "true" "$(jf "$R" pass)"
R="$(nh tcp "$(tp "$DEAD" open)" 1)"
expect "T4 closed port, expect open fails" "false" "$(jf "$R" pass)"
expect "T4 reason unexpected_closed" "unexpected_closed" "$(jf "$R" reason)"
expect "T4 duration present" "number" "$(node -e 'process.stdout.write(typeof JSON.parse(process.argv[1]).duration_ms)' "$R")"

# --- SEC-6 (review round): a plaintext server behind https:// is a tls_error, not "unreachable" ---
PT_OUT="$WORK/plain-tls.out"
node -e 'const s=require("net").createServer(c=>{c.on("error",()=>{});c.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")}).listen(0,"127.0.0.1",()=>process.stdout.write(String(s.address().port)))' > "$PT_OUT" 2>&1 &
PT_PID=$!
for _ in $(seq 1 50); do [[ -s "$PT_OUT" ]] && break; sleep 0.1; done
PT_PORT="$(cat "$PT_OUT")"
R="$(nh http "{\"kind\":\"http\",\"url\":\"https://127.0.0.1:$PT_PORT/\",\"host\":\"127.0.0.1\",\"host_class\":\"staging\",\"method\":\"GET\",\"headers\":{},\"query\":{},\"expect\":{\"status\":[200]},\"timeout_ms\":3000}" 1)"
kill "$PT_PID" 2>/dev/null; wait "$PT_PID" 2>/dev/null
expect "TLS1 plaintext server behind https:// is not a pass" "false" "$(jf "$R" pass)"
expect "TLS1 reason tls_error" "tls_error" "$(jf "$R" reason)"
