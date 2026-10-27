'use strict';

// Help text of the `dashboard` group (spec 021-dashboard). Final text for all waves; kept out of help.cjs (size).
const DASHBOARD_HELP = `  a1-tools dashboard build [<slug> | --slug <slug>] [--json]
                  Spec 021-dashboard. Writes ONE read-only overview note, <vault>/project/<slug>/dashboard.md,
                  for the project of the cwd git repo: what is in flight, what is next, specs, phases with the
                  verification verdict, learnings, open clarification markers and cost. Deterministic: no LLM,
                  no network, no server, no child process. Slug rule as vault sync: the project: key of
                  docs/product/ROADMAP.md; an explicit <slug> (or --slug <slug>, same meaning) must agree with it; without a ROADMAP it is required.
                  Needs A1_VAULT_ROOT (the CI fallback is never written). Prints the note path; --json prints
                  one object {ok, path, status, degraded}; status is written or skipped-non-writer, degraded
                  lists the sections shown as "not available (<reason>)" (missing source); a section shown
                  as "none" (empty source) is not listed.
                  Sections in order: Now, Next, Specs, Phases, Learnings, Open points, Cost. Headings and bullet
                  lists only (phone-readable), at most 400 lines, longer lists end with "and N more".
                  Written atomically (<note>.tmp.<12 hex> + rename); frontmatter type: dashboard, project,
                  generated_by: a1-tools dashboard, generated, source_head. A dashboard.md without that
                  generated_by key is never overwritten (exit 2, foreign_note). A symbolic link at
                  project/<slug>/ or at the note exits 2.
                  Read-only: writes only the note. Never opens .a1/reservations.json, .a1/xprov.json,
                  .a1/xprov-secret-allowlist.json, .a1/dispositions.json, a lock file, a .env* file or a file
                  the vault mirror excludes; every text value passes redact().
                  Single writer: on a host that is not the project's vault writer it writes nothing, prints
                  "[a1-tools] dashboard skipped: this host is not the vault writer (<host> ≠ <writer>)" on stderr
                  and exits 0. Refused for intent children (exit 77).
                  Exit 0 written or skipped / 1 usage error / 2 unsafe path, slug mismatch, vault root missing or
                  not writable, foreign_note, write failure, internal error (one stderr line, no stack trace).`;

module.exports = { DASHBOARD_HELP };
