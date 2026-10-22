'use strict';

// Help text of `test-fidelity` (spec 017 FR-019). Kept out of help.cjs (size).
const FIDELITY_HELP = `  a1-tools test-fidelity --diff-base <ref> [--project <dir>]
                  Spec 017-enforced-self-checks. Scans test files added or modified between <ref> and HEAD.
                  Rules: mock-of-subject (a test mocks the changed module or a DB wrapper), skipped-test
                  (.skip, xit, skipIf, pytest skip), early-return-guard (a test body starts with
                  "if (!db) return"). Strings and comments are ignored. Repo-level CI rules: test-not-in-ci
                  (a touched test file no workflow run: line reaches), no_ci_config (no .github/workflows and no
                  ci: none with a reason), ci_glob_not_in_workflow (a ci_globs entry in no run: line).
                  Optional .a1/fidelity.json: db_wrappers, test_globs, ci_globs, ci. A finding is cleared only by a
                  reviewed entry in .a1/dispositions.json (disposition add). Prints JSON findings (rule, file, line,
                  fingerprint). Call sites pass --phase <scope> (gate log scope).
                  Exit 0 no findings, 1 findings, 2 usage, git failure or bad config.`;

module.exports = { FIDELITY_HELP };
