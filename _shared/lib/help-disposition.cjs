'use strict';

// Help text of `disposition add | disposition review` (spec 017 FR-025). Kept out of help.cjs (size).
const DISPOSITION_HELP = `  a1-tools disposition add --kind <fidelity|skip_increase|class_sweep|config_change>
                  (--fingerprint <fp> | --rule <id> --file <path> [--line <n> | --text <t>])
                  --reason <text> --by <who> [--project <dir>]
                  Spec 017-enforced-self-checks FR-025. Records an entry in .a1/dispositions.json
                  with review: pending. The fingerprint is <rule>:<file>:<16 hex of the
                  whitespace-normalised line>; it clears exactly one rule in one file for one line
                  content. --line reads the line from the file. Rules per kind: fidelity =
                  mock-of-subject | skipped-test | early-return-guard | test-not-in-ci (file-level,
                  no --line); skip_increase = skip-increase (file = verify command id, text =
                  "<base>-><head>" skipped counts); class_sweep = class-sweep; config_change =
                  fidelity-config (file = .a1/fidelity.json) | verify-config (file = .a1/verify.json); the
                  fingerprint is printed by \`pr merge-check\` (fidelity_config_changed, suites.config_changed).
                  Exit 0 recorded / 1 duplicate fingerprint / 2 usage or invalid store (empty
                  reason, unknown kind, rule of another kind, glob or ".." in the path).
                  No --skip or --ignore option exists on any check.
  a1-tools disposition review <fingerprint> --verdict <upheld|overturned> --reason <text> [--by <who>]
                  Records the reviewer's verdict (a1-pr-review, Reinhard). An overturned entry clears
                  nothing. Give --by: merge-check refuses a verdict without reviewed_by/reviewed_at and one whose
                  reviewer is the entry's own author (disposition_self_reviewed). Commit and push the file after
                  the verdict: merge-check reads HEAD. Exit 0 / 1 unknown fingerprint (exact match only) / 2 usage.`;

module.exports = { DISPOSITION_HELP };
