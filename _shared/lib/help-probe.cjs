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
                  Secrets only as {env: NAME}, and never on an http: URL (env_header_over_http / env_query_over_http, exit 2); a literal under authorization|token|secret|password|key|cookie
                  exits 2. GET/HEAD/OPTIONS everywhere; POST/PUT/DELETE only on preview/staging hosts; any
                  other method exits 2. A URL or tcp host must be listed in hosts; loopback, link-local,
                  private and metadata addresses are refused (checked on the connected IP); redirects are
                  not followed; TLS is always verified. Limits: 10 s per probe (timeout_ms up to 60000), 1 MiB per
                  response; one clock per run: 5 min plus the --wait window. No probe starts after that, the
                  timeout of a running probe (and of each pair half) is cut to the time left, and the probes
                  not run fail with timeout_budget.
                  --phase <scope> names the gate-log scope (a1-new-feature: the spec id; a1-pr-review: pr-<n>); the
                  facade strips it, writes one gate-log line (gate live-probes, exit code, no result text) and the
                  probe parser never sees it. Without --phase the line goes to the scope _unscoped.
                  Static refusals (exit 2, nothing sent, the code is on stderr): env_header_over_http and
                  env_query_over_http (an {env: NAME} value on an http: URL), too_many_probes (more than 50
                  probes; a pair counts as one), config_case_variant (a case variant of the file name sits
                  beside it), config_name_variant (the name is not byte-exact, or another name on the
                  filesystem is the same file), a1_dir_symlink (.a1/ is a symlink or resolves outside the
                  project), a1_dir_submodule (.a1/ holds its own .git, so it is not the repo's own tree).
                  probes_file_uncommitted (exit 2, nothing sent): the file must be tracked, equal to HEAD (nothing
                  staged or unstaged) and <dir> a git work tree, so an unreviewed edit is never run; a probe-file
                  change goes through a PR (merge-check: probes_config_changed) and <dir> is a checkout of the merged main.
                  --wait N (0..600) re-runs failed read-only probes every 5 s until all pass or N is spent.
                  Reason codes: status_mismatch, body_mismatch, header_mismatch, json_mismatch, timeout,
                  unreachable, dns_error, tls_error, env_missing, deny_half_open, allow_failed, deny_failed,
                  unexpected_open / unexpected_closed (the tcp port state is the opposite of expect), bad_request (the request
                  could not be built, e.g. a malformed header value), timeout_budget (the run budget, 5 min plus --wait,
                  was spent before this probe finished or started).
                  No file or "probes: []": exit 0 with the line "no_probes: <path> ..." ("no_probes": true
                  in --json); report "not verified live (no_probes)", never "verified live".
                  Exit 0 all passed or no_probes / 1 a probe failed or was not measured / 2 usage error,
                  invalid or hostile file, blocked host, unreadable path. Env A1_PROBE_ALLOW_LOOPBACK=1
                  unblocks 127/8 and ::1 (tests only). Not available to intent children (exit 77).`;

module.exports = { PROBE_HELP };
