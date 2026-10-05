# a1-intent fixture suite

The fixture suite for spec 011 (the intent queue consumer). Run it with:

```bash
env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST -u A1_HOST_ID bash _test-fixtures/a1-intent/run-tests.sh
```

There is one runner. The case files in `cases/NN-*.sh` are sourced in name order, and `cases/99-suite-meta.sh` runs last. Every result line names its requirement: `PASS  <case> … [FR-nnn]`. The meta cases check that rule (FR-038, SC-001).

## Isolation

Every `a1-tools intent` call runs with `HOME` and `A1_VAULT_ROOT` pointed at a per-case sandbox. All sandboxes sit under one `mktemp -d` work directory, so the real vault and the real `~/.a1-intents` are never touched. The passwd home, which intent commands read in place of `$HOME`, is injected through `stub/a1-tools-as.cjs`, a library seam. No environment variable reaches it (FR-047).

`claude` is replaced by `stub/claude`, which comes first on `PATH`. Case X0 checks that. The suite never starts the real `claude`.

## Stub processes read their mode from HOME, not from the environment

`stub/claude` reads its mode from the file `$HOME/.a1-intents/tmp/stub-mode`. The helper `stub_mode <mode>` in `lib.sh` writes that file. The mode never comes from an environment variable.

The reason: `run` builds the child's environment from nothing, using a fixed list of names (FR-021). Any fixture variable, such as `STUB_MODE=hang`, would be stripped before the stub starts. The stub would then run in its default mode, and every case meant to exercise another mode would pass without testing anything (testing.md, class 1).

The same rule applies to any helper that runs inside the child's process tree. Library-level drivers (`stub/run-steps.cjs`, `stub/tick-lib.cjs`) take their seams as arguments for the same reason.

## `A1_INTENT_*` limit overrides (FR-046)

Every numeric limit in `_shared/lib/intent-constants.cjs` is read once, when the module loads. Each can be overridden with `A1_<NAME>`, for fixtures only. Rules:

- Not a non-negative decimal integer (for example `abc`, `2000ms`, `-5`, `1e3`, or an empty value): ignored with one `warning:` line on stderr. The default stays in force.
- One of the 11 guarded limits (the frozen set `TIGHTEN_ONLY`, exported as `INTENT_TIGHTEN_ONLY`): only tightening applies. A value at or below the default is taken. A value above it is ignored with one warning.
- `INTENT_TICK_INTERVAL_S` is not guarded. A larger value only delays work.
- `INTENT_CLAIMED_MAX_BYTES` has no override of its own; it follows `INTENT_MAX_BYTES`.
- No override variable ever reaches a child (FR-021).

| Variable | Default | Guarded | What a lower value does in a case |
|---|---|---|---|
| `A1_INTENT_FRESHNESS_MS` | 900000 (15 min) | yes | narrows the replay window |
| `A1_INTENT_CLOCK_SKEW_MS` | 120000 (2 min) | yes | narrows the allowed future skew |
| `A1_INTENT_MAX_BYTES` | 8192 | yes | smaller intent files |
| `A1_INTENT_PAYLOAD_MAX_BYTES` | 6144 | yes | smaller payloads |
| `A1_INTENT_MAX_RUNS_PER_HOUR` | 6 | yes | an earlier hourly cap |
| `A1_INTENT_TIMEOUT_MS` | 1800000 (30 min) | yes | short timeouts, e.g. 1500 in B4 and B26 |
| `A1_INTENT_CLAIMED_MAX_AGE_MS` | 21600000 (6 h) | yes | earlier expiry |
| `A1_INTENT_RESULT_MAX_BYTES` | 16384 | yes | smaller result notes |
| `A1_INTENT_KILL_GRACE_MS` | 10000 | yes | a short grace before SIGKILL, e.g. 500 |
| `A1_INTENT_CANCEL_POLL_MS` | 5000 | yes | a faster cancel poll, e.g. 500 in T10, T13, T17 |
| `A1_INTENT_MAX_OPEN_WORKTREES` | 3 | yes | fewer open intent worktrees per project |
| `A1_INTENT_TICK_INTERVAL_S` | 30 | no | — |

The defaults above are copied from the constants. The fixture checks keep their own literal copies and never import them (testing.md, class 4): H6a–H6j in `cases/03b-hardening.sh` check the override rules, and H6i pins the guarded set against a frozen list of 11 names.

In production an override is always an operator mistake. `a1-tools intent doctor` fails its `overrides` check when an `A1_INTENT_*` variable is set in its environment, or appears in the `EnvironmentVariables` of `~/Library/LaunchAgents/ai.n3ural.a1-intent-tick.plist` (cases D6 and D10).

## The launchd installer is tested through a library seam, with a stub launchctl (`cases/13-agent.sh`)

`a1-tools intent install-agent` calls `/bin/launchctl` by absolute path, so a `PATH` stub cannot stand in for it, and the suite never runs the real one. `stub/agent-lib.cjs` calls `cmdIntentInstallAgent` with injected dependencies (sandbox home, hostname, platform, uid 4242, the answer to the confirmation, the launchctl path) taken from one JSON argument, never from the environment. Its launchctl is a per-sandbox copy of `stub/launchctl`, which appends its exact argv to `argv.log` and reads its mode (`ok`, `fail`, `notloaded`) and its `print` text from files next to itself, for the reason in the section above: the agent starts it with a fixed environment. The `print` text and the `fail`/`notloaded` exit codes are UNMEASURED.

Only A6b, A7a and A7c (the last two on a real pty), A8 (from an intent child) and A31 (`intent seal` on a pty) call the real CLI. A6b, A7a, A7c and A8 are refused before the first write, in sandboxes that hold no valid seal, so none of them can reach launchctl; A31 never calls it. `stub/launchctl` has modes `ok`, `fail`, `notloaded`, `bootoutfail`, `bootstrapfail`, `printfail` and `unknown`; the modes and the not-loaded classification (status 113 or "Could not find service") are UNMEASURED. A28 runs the driver in a new session (`setsid`) so `/dev/tty` cannot be opened. The seal-skew cases (A30) call `tick` and `verifySeal` with the injected `codeRoot`, the root of the running code. A8 runs the child-mode refusal (exit 77) with `--yes`, so even a future allowlist row would stop at argument parsing. The shipped guard of `contextRefusal` walks the real process tree; the suite itself may run under Claude Code, so success paths inject `contextRefusal: () => null` and the guard cases use the environment check, which answers before the walk.

## Measured fakes

Where a stub or a fixture stands in for an outside program (`ps`, `lsof`, `plutil`, the `claude --output-format json` object, `/proc/<pid>/stat`), its shape is copied from a measurement on the owner's Mac or in `node:20`. The case header names the date of that measurement. Anything not measured is marked UNMEASURED; for example, the hang stub as a model of the real `claude` process tree.
