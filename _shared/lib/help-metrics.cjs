'use strict';

// Help text of the `metrics` group and `fix validate-postmortem` (spec 018). Kept out of help.cjs (size).
const METRICS_HELP = `  a1-tools fix validate-postmortem <file> [<file>...]
                  Spec 018-pipeline-metrics. Checks the postmortem keys found_by and should_have_caught.
                  Prints "<file>: legacy|valid|invalid <reason>" per file. legacy = neither key (old files
                  are fine). Allowed values: found_by in {user, post-merge-ci, production, unknown,
                  registered gate ID, reviewer:<agent>}; should_have_caught in {none, unknown, registered
                  gate ID, reviewer:<agent>}; only [A-Za-z0-9:._-]. fix init-postmortem takes the same
                  values as --found-by / --should-have-caught (default unknown) and writes nothing on a bad one.
                  Exit 0 legacy or valid / 1 invalid / 2 unreadable file.
  a1-tools metrics escaped --project <slug> [--last <N>] [--json] [--group-by should-have-caught]
                  [--fail-above <n>]
                  Spec 018. Counts escaped BLOCKER postmortems (severity blocker, found_by user /
                  post-merge-ci / production, should_have_caught a gate or reviewer) dated inside the span
                  of the last N finished runs (N default 10; done specs + fixed fix reports). Prints
                  runs, escaped, the evidence list and the unknown/legacy count. Vault from A1_VAULT_ROOT.
                  Exit 0 (a report) / 1 --fail-above breach (escaped > n) or usage error / 2 vault absent or I/O error.
  a1-tools metrics cost [--project <slug>] [--last <N>] [--json]
                  Spec 018. Sums the "Cost: N tokens" line of each project/<slug>/phases/*/VERIFICATION.md
                  and of each fixed fix report. Prints one row per run, the total, coverage r/t (p%) and
                  the unreported runs. Without --project: every project in the vault.
                  --last N keeps the newest N phases AND the newest N fixes (up to 2N runs), by date.
                  Exit 0 / 1 usage error / 2 vault absent or I/O error.`;

module.exports = { METRICS_HELP };
