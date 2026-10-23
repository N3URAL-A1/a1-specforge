# parts/01-config.sh — spec 020 Wave 1: closed-grammar reader + static policy (FR-003, FR-004, FR-008, FR-012).
# Sourced by run-tests.sh. Probe files are hand-written inputs (not parser output). Every rejection case
# asserts exit 2, the offending key in stderr, no stub message, and zero requests at the loopback server.
# Route and role facts model the a1-office postmortems 2026-09-26-claudia-caps-audit-insert-500 and
# 2026-10-15-postgrest-anon-inherited-crud (Vault project/a1-office/postmortems/).

H="127.0.0.1"
P="$HTTP_PORT"

# --- control: a valid file reaches the stub (proves the rejections below are policy, not usage slips) ---
put c-valid <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: root
    kind: http
    url: http://$H:$P/ok
    expect:
      status: 200
  - id: port
    kind: tcp
    host: $H
    port: $TCP_PORT
    expect: open
YML
probe run --project "$D"; accept "C1 valid file (http + tcp)"
probe run --project "$D" --json --wait 5; accept "C2 valid file with --json --wait"

# --- FR-003: hostile / malformed files -------------------------------------------------------------
put h-unknown-top <<YML
version: 1
bogus: 1
hosts: []
probes: []
YML
probe run --project "$D"; reject "H1 unknown top-level key" "bogus"

put h-unknown-probe <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    comand: ls
    expect:
      status: 200
YML
probe run --project "$D"; reject "H2 unknown probe key" "probes[0].comand"

put h-dup <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: same
    kind: http
    url: http://$H:$P/ok
    expect:
      status: 200
  - id: same
    kind: http
    url: http://$H:$P/boom
    expect:
      status: 200
YML
probe run --project "$D"; reject "H3 duplicate probe id" "duplicate_id"

put h-anchor <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: &u http://$H:$P/ok
    expect:
      status: 200
YML
probe run --project "$D"; reject "H4 anchor" "anchor_refused"

put h-alias <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: *u
    expect:
      status: 200
YML
probe run --project "$D"; reject "H5 alias" "alias_refused"

put h-tag <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: !!str http
    url: http://$H:$P/ok
    expect:
      status: 200
YML
probe run --project "$D"; reject "H6 tag" "tag_refused"

put h-merge <<YML
version: 1
hosts: []
probes:
  - <<: *base
YML
probe run --project "$D"; reject "H7 merge key" "bad_line"

put h-tab <<YML
version: 1
hosts: []
probes: []
YML
printf 'extra:\tx\n' >> "$D/.a1/live-probes.yaml"
probe run --project "$D"; reject "H8 tab control character" "control_character"

put h-cr <<YML
version: 1
hosts: []
probes: []
YML
printf 'x: y\r\n' >> "$D/.a1/live-probes.yaml"
probe run --project "$D"; reject "H9 carriage return" "control_character"

put h-esc <<YML
version: 1
hosts: []
probes: []
YML
printf 'x: a\033[31mb\n' >> "$D/.a1/live-probes.yaml"
probe run --project "$D"; reject "H10 escape control character" "control_character"

mkdir -p "$WORK/h-empty/.a1"; : > "$WORK/h-empty/.a1/live-probes.yaml"
probe run --project "$WORK/h-empty"; reject "H11 0-byte file" "empty_file"

put h-comments <<YML
# only a comment

YML
probe run --project "$D"; reject "H12 comment-only file" "empty_file"

put h-nover <<YML
hosts: []
probes: []
YML
probe run --project "$D"; reject "H13 no version" "version"

put h-ver2 <<YML
version: 2
hosts: []
probes: []
YML
probe run --project "$D"; reject "H14 version 2" "version"

put h-noclass <<YML
version: 1
hosts:
  - name: $H
    allow_http: true
probes: []
YML
probe run --project "$D"; reject "H15 host without class" "hosts[0].class"

put h-badclass <<YML
version: 1
hosts:
  - name: $H
    class: dev
probes: []
YML
probe run --project "$D"; reject "H16 host class outside the set" "hosts[0].class"

put h-flow <<YML
version: 1
hosts: []
probes:
  - {id: a, kind: http}
YML
probe run --project "$D"; reject "H17 flow-style map" "bad_line"

put h-flowval <<YML
version: 1
hosts: []
probes: []
x: {a: 1}
YML
probe run --project "$D"; reject "H18 flow-style value" "flow_style_refused"

put h-expand <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/\${HOME}
    expect:
      status: 200
YML
probe run --project "$D"; reject "H19 \${} expansion attempt" "expansion_refused"

put h-block <<YML
version: 1
hosts: []
probes: []
x: |
YML
probe run --project "$D"; reject "H20 block scalar" "block_scalar_refused"

# oversized file (> 256 KiB) — conventions: oversized input must fail fast
put h-big <<YML
version: 1
hosts: []
probes: []
YML
node -e 'process.stdout.write("# "+"x".repeat(300000)+"\n")' >> "$D/.a1/live-probes.yaml"
probe run --project "$D"; reject "H21 file over 256 KiB" "file_too_large"

# a directory / symlink in place of the file (exit2-audit style)
mkdir -p "$WORK/h-dir/.a1/live-probes.yaml"
probe run --project "$WORK/h-dir"; reject "H22 directory in place of the file" "not_a_regular_file"
mkdir -p "$WORK/h-link/.a1"; printf 'version: 1\n' > "$WORK/h-link/real.yaml"
ln -s "$WORK/h-link/real.yaml" "$WORK/h-link/.a1/live-probes.yaml"
probe run --project "$WORK/h-link"; reject "H23 symlink in place of the file" "not_a_regular_file"

# --- path traversal / injection / oversized values (CONVENTIONS) ------------------------------------
probe run --project "../../../../etc/does-not-exist"; expect "T1 traversal-shaped missing project exits 2" "2" "$RC"
expect_lacks "T1b ... and is no stub run" "$ERR" "not implemented"
probe run --project "$WORK/no-such-dir"; expect "T2 missing project dir exits 2" "2" "$RC"
INJ="$WORK/inj-marker"
put t-inject <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    headers:
      X-Note: "\$(touch $INJ); rm -rf /"
    expect:
      status: 200
YML
probe run --project "$D"; accept "T3 injection-shaped header value is inert text"
expect "T3b the command substitution was not evaluated" "no" "$([[ -e $INJ ]] && echo yes || echo no)"
put t-long <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    headers:
      X-Note: "$(node -e 'process.stdout.write("a".repeat(2001))')"
    expect:
      status: 200
YML
probe run --project "$D"; reject "T4 2001-char header value (over MAX_VALUE, under the line cap)" "value_too_long"
put t-badid <<YML
version: 1
hosts: []
probes:
  - id: "a; rm -rf /"
    kind: tcp
    host: $H
    port: 1
    expect: open
YML
probe run --project "$D"; reject "T5 injection-shaped probe id" "probes[0].id"

# --- FR-004: closed kind set ------------------------------------------------------------------------
put k-command <<YML
version: 1
hosts: []
probes:
  - id: a
    kind: command
    command: ls
YML
probe run --project "$D"; reject "K1 kind: command" "unknown_kind"
put k-shell <<YML
version: 1
hosts: []
probes:
  - id: a
    kind: shell
YML
probe run --project "$D"; reject "K2 kind: shell" "unknown_kind"
put k-nest <<YML
version: 1
hosts:
  - name: $H
    class: staging
probes:
  - id: a
    kind: pair
    allow:
      kind: command
    deny:
      kind: tcp
      host: $H
      port: 1
      expect: closed
YML
probe run --project "$D"; reject "K3 kind: command inside a pair half" "unknown_kind"
lines="$(grep -cE 'child_process|eval\(|new Function|require\(.vm.\)' "$SHARED"/lib/probe*.cjs | awk -F: '{n+=$NF} END{print n+0}')"
files="$(ls "$SHARED"/lib/probe*.cjs 2>/dev/null | wc -l | tr -d ' ')"
expect "K4 no child_process / eval / new Function / vm in probe*.cjs (0 hits)" "0" "$lines"
[[ "$files" -ge 2 ]] && ok "K4b count assert: probe*.cjs files scanned ($files)" || bad "K4b scanned too few probe*.cjs files ($files)"

# --- FR-008: secrets only as {env: NAME} ------------------------------------------------------------
put s-auth <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    headers:
      Authorization: Bearer x
    expect:
      status: 200
YML
probe run --project "$D"; reject "S1 literal Authorization header" "probes[0].headers.Authorization"
expect_lacks "S1b the literal value is not echoed" "$ERR" "Bearer"
for spec in "headers|X-Api-Key|abc" "headers|Cookie|sid=1" "query|token|abc" "query|api_key|abc" "query|password|abc" "query|client_secret|abc"; do
  IFS='|' read -r sect name val <<<"$spec"
  put "s-lit-$name" <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    $sect:
      $name: $val
    expect:
      status: 200
YML
  probe run --project "$D"; reject "S2 literal under secret-named $sect key '$name'" "probes[0].$sect.$name"
done
put s-ok-literal <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    query:
      page: 2
    headers:
      Accept: application/json
    expect:
      status: 200
YML
probe run --project "$D"; accept "S3 literal under a non-secret key passes parsing"

mk_env_case() { # <case> <env-ref-text>
  put "$1" <<YML
version: 1
hosts:
  - name: localhost
    class: staging
probes:
  - id: a
    kind: http
    url: https://localhost/ok
    headers:
      Authorization: $2
    expect:
      status: 200
YML
}
mk_env_case s-env-ok '{env: API_TOKEN}'
probe run --project "$D"; accept "S4 {env: API_TOKEN} passes parsing"
mk_env_case s-env-lower '{env: lower_case}'
probe run --project "$D"; reject "S5 lower-case env name" "bad_env_name"
mk_env_case s-env-long "{env: A$(node -e 'process.stdout.write("B".repeat(64))')}"
probe run --project "$D"; reject "S6 65-char env name" "bad_env_name"
mk_env_case s-env-64 "{env: A$(node -e 'process.stdout.write("B".repeat(63))')}"
probe run --project "$D"; accept "S7 64-char env name is the allowed maximum"
mk_env_case s-env-extra '{env: A_B, x: y}'
probe run --project "$D"; reject "S8 env reference with extra flow content" "flow_style_refused"

# --- FR-012: method x host class --------------------------------------------------------------------
mk_method_case() { # <case> <class> <method-line or empty>
  put "$1" <<YML
version: 1
hosts:
  - name: $H
    class: $2
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
$3
    expect:
      status: 200
YML
}
mk_method_case m-post-prod production '    method: POST'
probe run --project "$D"; reject "M1 POST on a production host" "mutating_method_on_production"
mk_method_case m-post-stg staging '    method: POST'
probe run --project "$D"; accept "M2 POST on a staging host passes the policy check"
mk_method_case m-post-prev preview '    method: POST'
probe run --project "$D"; accept "M3 POST on a preview host passes the policy check"
mk_method_case m-del-prod production '    method: DELETE'
probe run --project "$D"; reject "M4 DELETE on a production host" "mutating_method_on_production"
mk_method_case m-put-prod production '    method: PUT'
probe run --project "$D"; reject "M5 PUT on a production host" "mutating_method_on_production"
for cls in production preview staging; do
  mk_method_case "m-patch-$cls" "$cls" '    method: PATCH'
  probe run --project "$D"; reject "M6 PATCH on a $cls host" "method_refused"
done
for m in CONNECT TRACE get; do
  mk_method_case "m-other-$m" staging "    method: $m"
  probe run --project "$D"; reject "M7 method $m" "method_refused"
done
for m in GET HEAD OPTIONS; do
  mk_method_case "m-ro-$m" production "    method: $m"
  probe run --project "$D"; accept "M8 $m on a production host"
done
mk_method_case m-default production ''
probe run --project "$D"; accept "M9 missing method on a production host"
got="$(node -e 'const c=require(process.argv[1]).loadProbeConfig(process.argv[2]);process.stdout.write(c.probes[0].method+"/"+c.probes.length)' "$SHARED/lib/probe-config.cjs" "$D" 2>&1)"
expect "M10 a missing method parses as GET (1 probe)" "GET/1" "$got"

# --- hosts, URLs, pair rules, bounds ---------------------------------------------------------------
put u-unlisted <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://other.example.test/ok
    expect:
      status: 200
YML
probe run --project "$D"; reject "U1 URL host not in hosts" "host_not_listed"
put u-http <<YML
version: 1
hosts:
  - name: $H
    class: staging
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    expect:
      status: 200
YML
probe run --project "$D"; reject "U2 http without allow_http" "scheme_refused"
put u-userinfo <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://user:pw@$H:$P/ok
    expect:
      status: 200
YML
probe run --project "$D"; reject "U3 userinfo in URL" "url_userinfo_refused"
put u-ftp <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: ftp://$H/x
    expect:
      status: 200
YML
probe run --project "$D"; reject "U4 ftp scheme" "scheme_refused"
put u-tcphost <<YML
version: 1
hosts:
  - name: $H
    class: staging
probes:
  - id: a
    kind: tcp
    host: elsewhere.example.test
    port: 80
    expect: open
YML
probe run --project "$D"; reject "U5 tcp host not in hosts" "host_not_listed"
put u-port0 <<YML
version: 1
hosts:
  - name: $H
    class: staging
probes:
  - id: a
    kind: tcp
    host: $H
    port: 0
    expect: open
YML
probe run --project "$D"; reject "U6 tcp port 0" "probes[0].port"
put u-timeout <<YML
version: 1
hosts:
  - name: $H
    class: staging
probes:
  - id: a
    kind: tcp
    host: $H
    port: 1
    timeout_ms: 60001
    expect: open
YML
probe run --project "$D"; reject "U7 timeout_ms 60001" "probes[0].timeout_ms"
put u-timeout-max <<YML
version: 1
hosts:
  - name: $H
    class: staging
probes:
  - id: a
    kind: tcp
    host: $H
    port: 1
    timeout_ms: 60000
    expect: open
YML
probe run --project "$D"; accept "U8 timeout_ms 60000 is the maximum"
put u-dupname <<YML
version: 1
hosts:
  - name: $H
    class: staging
  - name: $H
    class: production
probes: []
YML
probe run --project "$D"; reject "U9 duplicate host name" "duplicate_host"

mk_pair() { # <case> <deny-status-line>
  put "$1" <<YML
version: 1
hosts:
  - name: $H
    class: production
    allow_http: true
probes:
  - id: p
    kind: pair
    allow:
      kind: http
      url: http://$H:$P/anon
      expect:
        status: 200
    deny:
      kind: http
      url: http://$H:$P/anon
      expect:
        status: $2
YML
}
mk_pair p-ok '[401, 403]'
probe run --project "$D"; accept "P1 pair with a refusal deny half (401/403)"
mk_pair p-redirect 302
probe run --project "$D"; accept "P2 deny half expecting a 3xx"
mk_pair p-2xx 200
probe run --project "$D"; reject "P3 deny half expecting 200" "deny_not_refusal"
mk_pair p-list-2xx '[403, 204]'
probe run --project "$D"; reject "P4 deny list holding a 2xx" "deny_not_refusal"
mk_pair p-500 500
probe run --project "$D"; reject "P5 deny half expecting 500 is no refusal" "deny_not_refusal"
put p-noallow <<YML
version: 1
hosts:
  - name: $H
    class: production
    allow_http: true
probes:
  - id: p
    kind: pair
    deny:
      kind: tcp
      host: $H
      port: 1
      expect: closed
YML
probe run --project "$D"; reject "P6 pair without allow" "probes[0].allow"
put p-tcp <<YML
version: 1
hosts:
  - name: $H
    class: production
probes:
  - id: p
    kind: pair
    allow:
      kind: tcp
      host: $H
      port: $TCP_PORT
      expect: open
    deny:
      kind: tcp
      host: $H
      port: 1
      expect: closed
YML
probe run --project "$D"; accept "P7 tcp pair (open / closed)"
put p-tcp-open-deny <<YML
version: 1
hosts:
  - name: $H
    class: production
probes:
  - id: p
    kind: pair
    allow:
      kind: tcp
      host: $H
      port: 1
      expect: open
    deny:
      kind: tcp
      host: $H
      port: 1
      expect: open
YML
probe run --project "$D"; reject "P8 tcp deny half expecting open" "deny_not_refusal"
put p-nested-pair <<YML
version: 1
hosts:
  - name: $H
    class: production
probes:
  - id: p
    kind: pair
    allow:
      kind: pair
    deny:
      kind: tcp
      host: $H
      port: 1
      expect: closed
YML
probe run --project "$D"; reject "P9 pair nested in a pair" "nested_pair"
put p-half-id <<YML
version: 1
hosts:
  - name: $H
    class: production
probes:
  - id: p
    kind: pair
    allow:
      id: x
      kind: tcp
      host: $H
      port: 1
      expect: open
    deny:
      kind: tcp
      host: $H
      port: 1
      expect: closed
YML
probe run --project "$D"; reject "P10 id inside a pair half" "probes[0].allow.id"

# --- CLI scaffold -----------------------------------------------------------------------------------
probe; expect "L1 probe without subcommand exits 2" "2" "$RC"
expect_has "L1b usage names 'probe run'" "$ERR" "probe run"
probe bogus; expect "L2 probe bogus exits 2" "2" "$RC"
probe run; expect "L3 probe run without --project exits 2" "2" "$RC"
expect_has "L3b names --project" "$ERR" "--project"
probe run --project "$D" --wait 601; expect "L4 --wait 601 exits 2" "2" "$RC"
expect_lacks "L4b not the stub" "$ERR" "not implemented"
probe run --project "$D" --wait -1; expect "L5 --wait -1 exits 2" "2" "$RC"
probe run --project "$D" --bogus; expect "L6 unknown flag exits 2" "2" "$RC"
expect_lacks "L6b not the stub" "$ERR" "not implemented"
mkdir -p "$WORK/l-absent"
probe run --project "$WORK/l-absent"; expect "L7 absent file is no_probes (exit 0)" "0" "$RC"
help="$(node "$TOOLS" --help 2>&1)"
expect_has "L8 help lists 'a1-tools probe run'" "$help" "a1-tools probe run"
expect_has "L8b help names A1_PROBE_ALLOW_LOOPBACK" "$help" "A1_PROBE_ALLOW_LOOPBACK"
bogus_out="$(node "$TOOLS" no-such-group 2>&1)"
expect_has "L9 unknown-group usage lists \"probe\"" "$bogus_out" '"probe"'
expect_has "L10 facade header lists probe run" "$(sed -n 1,80p "$TOOLS")" "a1-tools probe run"

# --- SEC-1/SEC-2 (review round): the loader reads only the exact-name file in a real `.a1` directory ------------------
VALID_PROBES="version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: root
    kind: http
    url: http://$H:$P/ok
    expect:
      status: 200"
rm -rf "$WORK/s-link"; mkdir -p "$WORK/s-link/cfg"
printf '%s\n' "$VALID_PROBES" > "$WORK/s-link/cfg/live-probes.yaml"
ln -s cfg "$WORK/s-link/.a1"
probe run --project "$WORK/s-link"; reject "S1 .a1 is a symlink to a dir holding a valid file" "a1_dir_symlink"
rm -rf "$WORK/s-dlink"; mkdir -p "$WORK/s-dlink/real"
ln -s real "$WORK/s-dlink/.a1"
probe run --project "$WORK/s-dlink"; reject "S2 .a1 is a symlink even when the target holds no probe file" "a1_dir_symlink"
rm -rf "$WORK/s-case"; mkdir -p "$WORK/s-case/.a1"
printf '%s\n' "$VALID_PROBES" > "$WORK/s-case/.a1/LIVE-PROBES.yaml"
probe run --project "$WORK/s-case"; reject "S3 only a case variant of the file name exists" "config_case_variant"
put s-case2 <<YML
$VALID_PROBES
YML
printf '%s\n' "$VALID_PROBES" > "$D/.a1/Live-Probes.yaml"
# only a case-sensitive filesystem can hold both names; on APFS the second write is the same file (S3 covers that FS)
if [[ -e "$D/.a1/live-probes.yaml" && "$(ls "$D/.a1" | wc -l | tr -d ' ')" == "2" ]]; then
  probe run --project "$D"; reject "S4 exact name plus a case variant side by side" "config_case_variant"
fi
rm -rf "$WORK/s-real"; mkdir -p "$WORK/s-real-parent"
ln -s s-real-parent "$WORK/s-real-link"
mkdir -p "$WORK/s-real-parent/.a1"; printf '%s\n' "$VALID_PROBES" > "$WORK/s-real-parent/.a1/live-probes.yaml"
probe run --project "$WORK/s-real-link"; accept "S5 control: a symlinked PROJECT dir with a real .a1 still loads"

# --- SEC-3 (review round): no quadratic regex on hostile lines; per-line cap 4096 bytes -> bad_line ---------------------
rm -rf "$WORK/r-long"; mkdir -p "$WORK/r-long/.a1"
node -e 'const sp=" ".repeat(250000);process.stdout.write("version: 1\nhosts: []\nprobes: []\nx"+sp+"y\n")' > "$WORK/r-long/.a1/live-probes.yaml"
R_T0="$(node -p 'Date.now()')"
probe run --project "$WORK/r-long"; R_T1="$(node -p 'Date.now()')"
reject "R1 250k-character line" "bad_line"
expect "R1 rejected in under 1 s (no quadratic regex)" "1" "$([[ $((R_T1 - R_T0)) -lt 1000 ]] && echo 1 || echo 0)"
rm -rf "$WORK/r-long2"; mkdir -p "$WORK/r-long2/.a1"
node -e 'process.stdout.write("version: 1\nhosts: []\nprobes: []\n#"+"a".repeat(4096)+"\n")' > "$WORK/r-long2/.a1/live-probes.yaml"
probe run --project "$WORK/r-long2"; reject "R2 a comment line over the 4096-byte cap" "bad_line"
rm -rf "$WORK/r-ok"; mkdir -p "$WORK/r-ok/.a1"
node -e 'process.stdout.write("version: 1\nhosts: []\nprobes: []\n#"+"a".repeat(4094)+"\n")' > "$WORK/r-ok/.a1/live-probes.yaml"
probe run --project "$WORK/r-ok"; expect "R3 a line of exactly 4096 bytes is accepted (no probes: exit 0)" "0" "$RC"
put r-trail <<YML
version: 1   
hosts: []   
probes: []   
YML
probe run --project "$D"; expect "R4 trailing spaces are still trimmed (no probes: exit 0)" "0" "$RC"

# --- SEC-4: header/query names cannot be __proto__ / constructor / prototype --------------------------------------------
for nm in __proto__ constructor prototype; do
  put "q-$nm" <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    query:
      $nm: x
    expect:
      status: 200
YML
  probe run --project "$D"; reject "Q1 query name $nm" "probes[0].query.$nm"
done
put q-hdr <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    headers:
      constructor: x
    expect:
      status: 200
YML
probe run --project "$D"; reject "Q2 header name constructor" "probes[0].headers.constructor"
expect_has "Q2 code is bad_name" "$ERR" "bad_name"

# --- SEC-7 (owner decision): {env: NAME} header over plain http is refused; at most 50 probes per file --------------------
put e-http <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    headers:
      X-Probe-Id: {env: PROBE_VALUE}
    expect:
      status: 200
YML
probe run --project "$D"; reject "E1 env header on an http: probe (allow_http host)" "probes[0].headers.X-Probe-Id"
expect_has "E1 code env_header_over_http" "$ERR" "env_header_over_http"
put e-pair <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: pair
    allow:
      kind: http
      url: http://$H:$P/ok
      headers:
        X-Probe-Id: {env: PROBE_VALUE}
      expect:
        status: 200
    deny:
      kind: http
      url: http://$H:$P/deny
      expect:
        status: 403
YML
probe run --project "$D"; reject "E2 env header inside a pair half over http:" "env_header_over_http"
put e-query <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    query:
      v: {env: PROBE_VALUE}
    expect:
      status: 200
YML
probe run --project "$D"; reject "E5 env query value on an http: probe" "probes[0].query.v"
expect_has "E5 code env_query_over_http" "$ERR" "env_query_over_http"
put e-query-pair <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: pair
    allow:
      kind: http
      url: http://$H:$P/ok
      expect:
        status: 200
    deny:
      kind: http
      url: http://$H:$P/deny
      query:
        v: {env: PROBE_VALUE}
      expect:
        status: 403
YML
probe run --project "$D"; reject "E6 env query value inside a pair half over http:" "env_query_over_http"

put e-https <<YML
version: 1
hosts:
  - name: localhost
    class: staging
probes:
  - id: a
    kind: http
    url: https://localhost/ok
    headers:
      X-Probe-Id: {env: PROBE_VALUE}
    query:
      v: {env: PROBE_VALUE}
    expect:
      status: 200
YML
probe run --project "$D"; accept "E3 control: env header over https: is accepted"
put e-http-lit <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: http://$H:$P/ok
    headers:
      X-Probe-Id: literal
    expect:
      status: 200
YML
probe run --project "$D"; accept "E4 control: a literal header over http: is accepted"

mk_many() { # mk_many <dir> <n> <kind: tcp|pair> -> a file with n probes
  rm -rf "$1"; mkdir -p "$1/.a1"
  node -e 'const [n,kind,h,p]=process.argv.slice(1);let o="version: 1\nhosts:\n  - name: "+h+"\n    class: staging\nprobes:\n";
    for(let i=0;i<+n;i++){ if(kind==="tcp") o+=`  - id: p${i}\n    kind: tcp\n    host: ${h}\n    port: ${p}\n    expect: open\n`;
      else o+=`  - id: p${i}\n    kind: pair\n    allow:\n      kind: tcp\n      host: ${h}\n      port: ${p}\n      expect: open\n    deny:\n      kind: tcp\n      host: ${h}\n      port: ${p}\n      expect: closed\n`; }
    process.stdout.write(o)' "$2" "$3" "$H" "$TCP_PORT" > "$1/.a1/live-probes.yaml"
}
mk_many "$WORK/m-50" 50 tcp; probe run --project "$WORK/m-50"; accept "M1 50 probes are accepted"
mk_many "$WORK/m-51" 51 tcp; probe run --project "$WORK/m-51"; reject "M2 51 probes" "too_many_probes"
mk_many "$WORK/m-50p" 50 pair; probe run --project "$WORK/m-50p"; accept "M3 50 pairs count as 50 (a pair is one probe)"
mk_many "$WORK/m-51p" 51 pair; probe run --project "$WORK/m-51p"; reject "M4 51 pairs" "too_many_probes"

# --- SEC-8 / SEC-9 (review round 2): a name the filesystem folds onto the guarded one, and a submodule .a1 ---------------------
# A hard link with a different (non-ASCII) name shares ino+dev with the opened file: refused on every filesystem.
rm -rf "$WORK/n-link"; mkdir -p "$WORK/n-link/.a1"
printf '%s\n' "$VALID_PROBES" > "$WORK/n-link/.a1/live-probes.yaml"
ln "$WORK/n-link/.a1/live-probes.yaml" "$WORK/n-link/.a1/l"$'\xc3\xaf'"ve-probes.yaml"
probe run --project "$WORK/n-link"; reject "N1 another entry in .a1 shares ino+dev with the file" "config_name_variant"
# A name the filesystem folds (U+017F LATIN SMALL LETTER LONG S -> s on APFS) must not be opened as live-probes.yaml.
rm -rf "$WORK/n-fold"; mkdir -p "$WORK/n-fold/.a1"
printf '%s\n' "$VALID_PROBES" > "$WORK/n-fold/.a1/live-probe"$'\xc5\xbf'".yaml"
if [[ -e "$WORK/n-fold/.a1/live-probes.yaml" ]]; then
  probe run --project "$WORK/n-fold"; reject "N2 live-probe(U+017F).yaml opened as live-probes.yaml by a folding FS" "config_name_variant"
else
  echo "SKIP  N2 this filesystem does not fold U+017F onto s (N1 covers the ino+dev rule everywhere)"
fi
# Same for the directory: a project whose real directory is spelled .A1 (a folding FS resolves .a1 to it).
rm -rf "$WORK/n-dir"; mkdir -p "$WORK/n-dir/.A1"
printf '%s\n' "$VALID_PROBES" > "$WORK/n-dir/.A1/live-probes.yaml"
if [[ -d "$WORK/n-dir/.a1" ]]; then
  probe run --project "$WORK/n-dir"; reject "N3 directory spelled .A1 opened as .a1 by a folding FS" "config_name_variant"
else
  echo "SKIP  N3 this filesystem is case-sensitive (no .a1 alias of .A1 to refuse)"
fi
rm -rf "$WORK/n-sub"; mkdir -p "$WORK/n-sub/.a1"
printf '%s\n' "$VALID_PROBES" > "$WORK/n-sub/.a1/live-probes.yaml"
printf 'gitdir: ../.git/modules/a1\n' > "$WORK/n-sub/.a1/.git"
probe run --project "$WORK/n-sub"; reject ".a1 is a submodule checkout (.a1/.git file)" "a1_dir_submodule"
rm -rf "$WORK/n-sub2"; mkdir -p "$WORK/n-sub2/.a1/.git"
printf '%s\n' "$VALID_PROBES" > "$WORK/n-sub2/.a1/live-probes.yaml"
probe run --project "$WORK/n-sub2"; reject ".a1/.git directory" "a1_dir_submodule"

# --- SEC-7a (review fix): a scheme spelled in upper case must not slip past the env-over-http refusal ----------------------
for sch in HTTP Http hTTp; do
  put "u-hdr-$sch" <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: $sch://$H:$P/ok
    headers:
      X-Probe-Id: {env: PROBE_VALUE}
    expect:
      status: 200
YML
  PROBE_VALUE=secretvalue probe run --project "$D"; reject "U1 $sch:// scheme with an env header is refused" "bad_url"
  put "u-qry-$sch" <<YML
version: 1
hosts:
  - name: $H
    class: staging
    allow_http: true
probes:
  - id: a
    kind: http
    url: $sch://$H:$P/ok
    query:
      v: {env: PROBE_VALUE}
    expect:
      status: 200
YML
  PROBE_VALUE=secretvalue probe run --project "$D"; reject "U2 $sch:// scheme with an env query value is refused" "bad_url"
done
put u-https-upper <<YML
version: 1
hosts:
  - name: $H
    class: staging
probes:
  - id: a
    kind: http
    url: HTTPS://$H:$P/ok
    expect:
      status: 200
YML
probe run --project "$D"; reject "U3 an upper-case https scheme is refused too (the scheme must be written in lower case)" "bad_url"

expect "Z1 the server counted zero requests over the whole part" "0" "$(srv_total)"
