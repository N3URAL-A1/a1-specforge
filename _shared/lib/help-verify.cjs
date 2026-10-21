'use strict';

// Help text of `verify run | verify check` (spec 017). Kept out of help.cjs (size).
const VERIFY_HELP = `  a1-tools verify run [--project <dir>] [--base <ref>] [--out <VERIFICATION.md>] [--timeout-ms <n>]
                  Spec 017-enforced-self-checks FR-011..FR-014. Runs the project's commands (.a1/verify.json, else package.json typecheck/build/test, else pytest) as argv arrays with a timeout and records exit code, signal, timeout flag and passed/failed/skipped per command. stdout: JSON with verdict pass|fail and reason (implausible_crash, zero_tests, timeout, ...); --out writes it as verify_run into that file's frontmatter.
                  With --base the command set is the merge-base's .a1/verify.json and the base side runs in a git-archive snapshot; a head file that differs from the base file in anything but a shorter flaky_base fails with reason verify_config_changed (a committed config_change disposition for exactly that content clears it). A timeout, a crash or a command that cannot start is never recorded as pre_existing_red. Cached results are keyed by sha, command set, lockfiles and node version.
                  Exit 0 pass / 1 fail / 2 usage, no_test_command (unless .a1/verify.json declares no_tests_reason), env_missing, bad config, spawn_failed (a command or runner that cannot start).
  a1-tools verify check <VERIFICATION.md>
                  FR-018. Exit 1 when the file claims verdict PASS but verify_run is missing or failed, head_sha is unknown, or a path outside .a1/ changed between head_sha and HEAD. Exit 0 ok, 2 usage.`;

module.exports = { VERIFY_HELP };
