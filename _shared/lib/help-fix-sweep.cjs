'use strict';

// Help text of `fix class-sweep` (spec 017 FR-027..FR-031). Kept out of help.cjs (size).
const FIX_SWEEP_HELP = `  a1-tools fix class-sweep (--record | --verify) <bug-path> [--project <dir>]
                  [--guard <fingerprint>=<test-file>]... [--diff-base <ref>]
                  Spec 017-enforced-self-checks. Runs the bug report's class_query (argv, no shell, timeout)
                  and stores the matches in the bug file. --record (at diagnosis): refuses a query that misses
                  root_site (root_site_not_matched) or yields more than 50 matches (query_too_broad).
                  --verify (after the fix): recomputes class_sweep_after_fix; exit 1 class_sweep_open while a
                  match is neither guarded (--guard names a test file that exists and is in the fix diff) nor
                  accepted (disposition --kind class_sweep). "fix update-status <bug> fixed" repeats the check.
                  Exit 0 ok / 1 refusal (JSON reason) / 2 usage, missing engine, timeout.`;

module.exports = { FIX_SWEEP_HELP };
