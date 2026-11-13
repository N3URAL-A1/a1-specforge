'use strict';

// Help text of the `run` group (spec 027 FR-035). Kept out of help.cjs (size).
const RUN_HELP = `  a1-tools run record --repo <path> --scope <spec-id> [--pr <n>]
                  Spec 027. Writes one line per (scope, pr) to <store>/pattern/a1-learnings/_runs/<project>.jsonl:
                  per gate the last verdict, caught, runs, duration_ms_sum and no_duration (ci_evidence_why counts
                  for pr-merge-check), read from <repo>/.a1/phases/<scope>/gate-log.jsonl. The project is the
                  ROADMAP project, else the folder name of the main checkout (also from a worktree). A second call
                  for the same (scope, pr) writes nothing. Nothing is created when the learning store is absent.
                  Exit 0 recorded or already recorded / 1 no store, no or untrusted or empty gate log (nothing
                  changes) / 2 usage error, hostile value, I/O error or refused write path.`;

module.exports = { RUN_HELP };
