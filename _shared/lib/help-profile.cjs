'use strict';

// Help text of the `profile` group (spec 006-specforge-kritis-profile).
// Final text for all eight subcommands across Waves 2-7; kept out of
// help.cjs (size). All eight are still stubs in Wave 1, in six modules (exit 2,
// `profile <sub>: not_implemented`) — the text below documents the
// contract each wave implements, not current behaviour.
const PROFILE_HELP = `  a1-tools profile resolve [--profile <name>] [--spec <path>] --repo-root <dir> [--json]
                  Spec 006-specforge-kritis-profile. Fail-closed precedence: --profile flag >
                  spec frontmatter (profile:) > docs/product/index.json (project.profile) >
                  constitution marker (a1-profile: <name> in <repo>/constitution.md). The only
                  known profile is "kritis". Prints {profile, source, isolation, sources_checked};
                  no source found -> {profile: null, ...}, exit 0, repo tree unchanged.
                  isolation is "blank_slate" whenever profile is "kritis": a kritis run does not
                  read .claude/agent-memory/, the learning store, or any _learning.md file.
                  Exit 0 resolved (incl. profile: null) / 1 unknown --profile value / 2 unknown
                  value in a file source (named), unreadable path, or internal error.
  a1-tools profile set --spec <path> <name>
                  Persists the decision: writes profile: <name> into the spec's frontmatter.
                  A second run on an already-set spec leaves the file byte-identical.
                  Exit 0 written or already set / 1 unknown profile name / 2 unreadable or
                  unsafe --spec path.
  a1-tools profile ears-check --spec <path> [--phase <spec-id>] [--json]
                  Checks every FR inside a spec's "## Functional Requirements" (and the profile's
                  NFR) section against the five canonical EARS patterns (Ubiquitous, Event-driven,
                  State-driven, Optional, Unwanted; see _shared/profiles/kritis/ears.md). Reports
                  findings: no_tag, unknown_pattern, structure_mismatch, missing_shall,
                  multiple_shall, no_frs. Vague terms ("should", "as appropriate", "etc.") are
                  warnings only and never change the exit code.
                  Exit 0 every FR matches its tagged pattern / 1 one or more findings / 2 unreadable
                  or unsafe --spec path, oversized file, or internal error.
  a1-tools profile nfr-inject --spec <path>
                  Appends every uncovered item of the NIS2/KRITIS NFR catalogue
                  (_shared/profiles/kritis/nfr-catalogue.md, 41 items) into the spec as an
                  EARS-form FR-NFR-### entry, numbered after the highest existing FR-NFR. An item
                  already covered (an existing FR tagged "(covers kritis-nfr:<ID>)", or an
                  existing FR-NFR line whose source names <ID>) is skipped. A second run adds 0
                  and leaves the file byte-identical (idempotent, tag-based dedup only).
                  Exit 0 written (incl. 0 added) / 2 catalogue_invalid, unreadable catalogue, or
                  unreadable/unsafe --spec path.
  a1-tools profile threat-model-check --id <###-slug> --repo-root <dir> [--phase <spec-id>] [--json]
                  Proves docs/product/features/<id>/threat-model.md
                  (_shared/profiles/kritis/threat-model-template.md shape) covers all six STRIDE
                  categories (S/T/R/I/D/E) and leaves no "high" risk "open" without a matching
                  entry under "## Accepted risks".
                  Exit 0 complete and no unmitigated high risk / 1 category_missing, bad_risk,
                  bad_status, unmitigated, or not_applicable_without_reason / 2 missing file,
                  symlinked file, id outside ^[0-9]{3}-[a-z0-9-]+$, or internal error.
  a1-tools profile simulate-roles --roles <csv>
                  Renders one role card (id, focus, method, the mandatory "name one assumption
                  the author treats as given" question) per role id in
                  _shared/profiles/kritis/stakeholder-roles.md, 1-5 roles, no duplicates.
                  Exit 0 rendered / 1 unknown id, duplicate, more than 5 roles, or an
                  injection-shaped id.
  a1-tools profile simulate-check --spec <path> --roles <csv>
                  Verifies the spec's "## Stakeholder Simulation" section has one "### <role-id>"
                  block per requested role, each with an "Assumption challenged:" line.
                  Exit 0 every role has its block / 1 one or more roles missing a block (named) /
                  2 unreadable or unsafe --spec path.
  a1-tools profile trigger-check --skills-dir <dir> [--skills-dir <dir> ...] --phrase <text>
                  [--phrase <text> ...] --expect <skill-name>
                  Reads the description frontmatter of every */SKILL.md under each --skills-dir
                  (symlinked skill dirs followed with realpath) and reports, per phrase, how many
                  installed skills claim it (case-insensitive, whitespace-normalised match).
                  Never added to the intent allowlist (spec 006 Wave 8 decision).
                  Exit 0 every phrase has exactly one claimant and it is --expect / 1 a phrase has
                  zero or more than one claimant, or the sole claimant is not --expect / 2 unreadable
                  skills dir, oversized file (> 256 KiB), or internal error.

                  All eight subcommands: internal errors exit 2 with one stderr line, no stack
                  trace. None of them reads .claude/agent-memory/, pattern/a1-learnings/, or
                  .a1/learnings/ (blank-slate rule, applies once a run resolves to "kritis").`;

module.exports = { PROFILE_HELP };
