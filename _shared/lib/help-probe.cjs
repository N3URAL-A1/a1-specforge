'use strict';

// Help text of the `probe` group (spec 020-live-probes). Final text for all waves; kept out of help.cjs (size).
const PROBE_HELP = `  a1-tools probe run --project <dir> [--phase <scope>] [--wait <seconds>] [--json]
                  Spec 020-live-probes. Reads <dir>/.a1/live-probes.yaml and measures the real effect from
                  outside: one result line per probe (id, kind, pass|fail|not_measured, reason code) and a
                  summary "pass=N fail=N not_measured=N". Deterministic, no LLM, no shell, no process spawn.
                  File: a closed YAML subset (version: 1, hosts, probes). hosts: [{name, class, allow_http?}],
                  class production|preview|staging (mandatory). Kinds: http (url, method, headers, query,
                  expect.status/body_contains/json/header), tcp (host, port, expect open|closed), pair (one
                  allow + one deny half; the deny half must expect a refusal: 401/403/404/3xx or tcp closed).
                  Secrets only as {env: NAME}; a literal under authorization|token|secret|password|key|cookie
                  exits 2. GET/HEAD/OPTIONS everywhere; POST/PUT/DELETE only on preview/staging hosts; any
                  other method exits 2. A URL or tcp host must be listed in hosts; loopback, link-local,
                  private and metadata addresses are refused (checked on the connected IP); redirects are
                  not followed; TLS is always verified. Limits: 10 s per probe (timeout_ms up to 60000),
                  5 min per run, 1 MiB per response.
                  --wait N (0..600) re-runs failed read-only probes every 5 s until all pass or N is spent.
                  Reason codes: status_mismatch, body_mismatch, header_mismatch, json_mismatch, timeout,
                  unreachable, dns_error, tls_error, env_missing, deny_half_open, allow_failed, deny_failed.
                  No file or "probes: []": exit 0 with the line "no_probes: <path> ..." ("no_probes": true
                  in --json); report "not verified live (no_probes)", never "verified live".
                  Exit 0 all passed or no_probes / 1 a probe failed or was not measured / 2 usage error,
                  invalid or hostile file, blocked host, unreadable path. Env A1_PROBE_ALLOW_LOOPBACK=1
                  unblocks 127/8 and ::1 (tests only). Not available to intent children (exit 77).`;

module.exports = { PROBE_HELP };
