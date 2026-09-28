'use strict';

// help-vault — the help text of the spec 010 commands (spec init, schema
// export, vault sync|status|lint|link-hub|writer), split out of help.cjs to keep it
// under the 800-line cap. help.cjs interpolates both strings in place; the
// rendered --help output is byte-identical to the unsplit text.

const SPEC_INIT_HELP = `  a1-tools spec init <project-slug> <feature-slug> --title <t> [--size S|M|L]
                  Spec 010 Wave 6 (FR-017/FR-025). Writes the spec template at
                  the next number with type: spec as the FIRST key, id,
                  project, feature_slug, title, status: discovering, size,
                  created filled; then links it from project/<slug>.md (JSON
                  hub: linked|unchanged|missing|refused-link — a missing hub
                  is never created, a linked hub or project folder is
                  refused). Refuses an existing file, a non-kebab-case slug
                  and a title > 200 chars (exit 1). The spec file is written
                  on every host; on a host that may not write <project-slug>
                  (its per-project writer, see vault writer) the hub link is
                  left out (hub: skipped-non-writer, one stderr line "spec
                  init hub link skipped: ...", exit unchanged).`;

const VAULT_HELP = `  a1-tools schema export --json
                  Spec 010-vault-cockpit-contract, Wave 1 (FR-020/FR-021). Prints
                  the versioned read contract for the vault cockpit
                  (obsidian-lumen): one JSON document with sorted top-level keys
                  contract_version, schema_version (alias, same integer),
                  artifact_types, spec_statuses, size_values, bug_statuses,
                  analysis_statuses, quick_results, roadmap_feature_statuses,
                  roadmap_stages, milestone_statuses, project_statuses,
                  spec_to_roadmap_status, mirror {product, phases, excluded},
                  hub_relation_line. Built only from lib/status-constants.cjs
                  and lib/vault-contract.cjs — no timestamps, paths or env, so
                  two runs are byte-identical and the fixture golden
                  (_test-fixtures/a1-vault-cockpit/golden/schema-export.v<N>.json)
                  pins it. Any value or shape change bumps
                  VAULT_CONTRACT_VERSION in the same commit. --json is
                  mandatory; any other argument -> exit 1.
  a1-tools vault <sub> [flags]
                  Spec 010-vault-cockpit-contract. Vault mirror and frontmatter
                  guards for the external vault (A1_VAULT_ROOT). Subcommands
                  ship per wave and register in lib/vault-cli.cjs:
                  sync, status (wave 3) · lint, link-hub (wave 6) · writer
                  (wave 10). Unknown subcommand -> exit 1.
                  Per-project writer (FR-034, FR-038..FR-040): the mirror,
                  hub-link writes and lint --fix-type for <slug> run only on
                  the host its hub note project/<slug>.md declares
                  (a1_writer_host: <id>). This host's id is A1_HOST_ID (set in
                  a host-local file), else the lowercased os.hostname().
                  Precedence: hub key -> A1_VAULT_WRITER_HOST (rollout aid for
                  hubs without the key) -> undeclared (every host writes). An
                  unreadable declaration (duplicate key, near-miss spelling,
                  folded or invalid value, unterminated frontmatter, empty or
                  linked hub, folder without hub, read error) blocks every
                  host. Spec authoring is never gated.
  a1-tools vault sync [<slug>] [--product] [--phases] [--dry-run] [--prune]
                  [--slug <s>] [--json]
                  Spec 010 Wave 3 (FR-011/FR-012). Rebuilds the one-way mirror
                  docs/product/ -> project/<slug>/product/ and .a1/phases/ ->
                  project/<slug>/phases/ (default both sets). The slug is the
                  docs/product/ROADMAP.md frontmatter project:; a different
                  <slug> -> exit 1 naming both; without a roadmap --slug is
                  required and only phases are mirrored. Another checkout
                  under the code roots claiming the same project (git
                  worktrees of this repo excepted) -> exit 1 naming both
                  paths. JSON: added, updated, unchanged, extra, pruned,
                  skipped, planned[{action, path}]. --dry-run writes nothing
                  and lists add|update|delete|extra. Vault files without a
                  repo source are reported as extra and kept; --prune deletes
                  them, only inside product/ and phases/, never a conflict
                  copy. Vault root missing or read-only (FR-010) -> one
                  stderr line "vault mirror skipped: <reason naming the
                  root>", status: skipped, exit 0. This host may not write
                  <slug> -> the same (FR-034): "this host is not the vault
                  writer of <slug> (<host> ≠ <writer>)" or "writer
                  declaration of <slug> unreadable (<class>) — create or
                  repair project/<slug>.md", nothing written, exit 0. Unsafe slug or unknown flag ->
                  exit 1. No A1_VAULT_ROOT (tier repo-local) -> exit 2.
  a1-tools vault status [<slug>] [--slug <s>] [--json]
                  Spec 010 Wave 3 (FR-013/FR-014). Read-only drift report,
                  one line per finding "<class>  <path>": missing (in repo,
                  not in vault), stale (bytes differ), extra (in the vault
                  mirror folders only), conflict (sync-conflict copies
                  "* (conflict …)", "* (conflicted copy …)" in any case, or
                  "*.sync-conflict-*", anywhere under project/<slug>/ — the
                  one predicate lint and link-hub use too). --json prints {findings, counts, in_sync,
                  drift, skipped, host, host_source (env|os|invalid),
                  writer_host (id|undeclared|unreadable), writer_source
                  (hub|env|none), may_write, hub_conflict} for <slug>
                  (FR-035; an invalid host id shows as "<invalid>"), also as
                  one stderr line "vault writer: ...". No --all: the
                  cross-project overview is vault writer. Exit 0 no drift, 1 drift, 2 cannot run
                  (no external vault root, unsafe slug, slug mismatch,
                  unknown flag). A configured root that is missing or
                  unreadable (FR-010) -> one stderr line "vault status
                  skipped: <reason naming the root>", {status: skipped} with
                  --json, exit 0.
  a1-tools vault lint [<slug>] [--json] [--fix-type [--dry-run]]
                  Spec 010 Wave 6 (FR-018/FR-019, FR-014). Walks the a1
                  subfolders of project/<slug>/ (every slug when omitted):
                  spec/ plans/ fixes/ postmortems/ analyses/ quick/, expected
                  type from ARTIFACT_TYPES. Classes: frontmatter_unparseable,
                  type_missing, type_unknown, type_folder_mismatch,
                  status_missing, status_invalid (spec/bug-report/
                  project-analysis on status:, quick-run on result:;
                  wave-plan and postmortem are never status-checked),
                  frontmatter_folded (a scalar continued on an indented line,
                  found by scanning raw lines), conflict (Obsidian conflict
                  copies anywhere under project/<slug>/). Other subfolders
                  count as ignored. *-STATUS.md / *-VERIFICATION.md companions
                  are only checked for unparseable/folded/conflict and counted.
                  JSON: {findings[{path,class,key,detail}], counts, ignored,
                  companions, fixed[], skipped[]}. --fix-type stamps
                  "type: <folder type>" into every file with a type_missing
                  finding whose frontmatter parses and is not folded,
                  whatever else it reports (status outliers stay findings):
                  an empty type: line is replaced in place, otherwise the key
                  is inserted as the first line — a line edit, every other
                  byte unchanged, atomic write, and a second run stamps
                  nothing. Each rewritten path is printed; unparseable files
                  and folded type_missing files are left byte-identical and
                  listed as skipped for manual repair; companions are never
                  stamped. --dry-run
                  (with --fix-type) writes nothing and lists would_fix. Exit
                  0 clean, 1 findings, 2 cannot run (usage, hostile slug,
                  project folder not found under the root, no external vault
                  root). A configured root that is missing, or not writable
                  for --fix-type (FR-010): one stderr line "vault lint
                  skipped: <reason naming the root>", {status: skipped} with
                  --json, exit 0. --fix-type (also with --dry-run) stamps
                  only projects this host may write: with <slug> one "vault
                  lint --fix-type skipped" line and fix_type:
                  skipped-non-writer; without <slug> one "vault lint
                  --fix-type skipped for <slug>: <reason>" line per refused
                  project and skipped_projects[{slug, reason: not-writer|
                  writer-unreadable, writer_host}], ignored_names (count of
                  names that are no project slug). Findings of every project
                  are reported; the exit code stays the findings one.
  a1-tools vault link-hub <slug> (<artifact-path> | --spec <id>) [--dry-run]
  a1-tools vault link-hub [<slug>] --all-specs [--dry-run]
                  Spec 010 Wave 6 (FR-024/FR-025/FR-026). Appends the line
                  "- references [[project/<slug>/<subfolder>/<name>]]" as the
                  last bullet of the ## Relations block of project/<slug>.md
                  (block appended at the end when missing). Text-only edit:
                  the byte diff is the inserted line(s), nothing else;
                  idempotent (exact line present -> no write, hub: unchanged).
                  <artifact-path> is project/<slug>/<subfolder>/<name>.md and
                  must exist; --spec <id> is shorthand for spec/<id>.md.
                  A CRLF hub gains CRLF lines.
                  --all-specs links every project/<slug>/spec/###-*.md (minus
                  *-VERIFICATION.md, conflict copies, tmp files) with one write
                  per hub; without <slug> every project folder with spec/
                  (Wave 9 backfill). JSON: {linked, unchanged, missing_hub,
                  projects[]}. --dry-run writes nothing and lists the lines it
                  would add (JSON + stderr). Missing hub: single slug -> exit 1,
                  never created; --all-specs without slug -> listed under
                  missing_hub, exit 0. No external vault root -> exit 2.
                  Arguments are checked first, on every host (usage error ->
                  exit 1). Then a configured root that is missing or not
                  writable (FR-010): one stderr line "vault link-hub skipped:
                  <reason naming the root>", {status: skipped}, exit 0. On a
                  host that may not write <slug> (also --dry-run): one "vault
                  link-hub skipped" stderr line, hub not written, {status:
                  skipped}, exit 0; --all-specs without <slug> skips per
                  project ("skipped for <slug>: <reason>", skipped_projects,
                  ignored_names), exit 0. A linked or missing hub is reported
                  before the writer check.
  a1-tools vault writer [--json]
  a1-tools vault writer <slug> (--set <host id> | --clear) [--dry-run] [--json]
                  Spec 010 Wave 10 (FR-041/FR-043). Without <slug>: read-only
                  list of every hub project/<slug>.md and every project folder
                  without hub, sorted: {slug, writer_host, writer_source,
                  class (unreadable only), may_write, hub_conflict}, plus
                  host, host_source and ignored_names once; exit 0. With
                  <slug>: the hand-over. A hub that already declares <host
                  id> (or nothing, for --clear) -> exit 0, nothing written.
                  Otherwise only the a1_writer_host: line changes (inserted
                  after the opening ---, replaced, or removed), every other
                  byte stays, atomic write; the hub is re-read before the
                  rename and a change since the first read -> exit 1, nothing
                  written. Runs only where this host may write <slug>; a
                  non-writer, unreadable or linked hub, a missing hub or one
                  without frontmatter -> exit 1 naming the manual path (edit
                  a1_writer_host: in Obsidian — only when the old writer host
                  is gone; stop a1 work there until the edit has synced). An
                  id declared nowhere else, not A1_VAULT_WRITER_HOST and not
                  this host -> stderr "warning: <id> is not a known writer
                  id", still written. Invalid slug or id, unknown flag -> exit
                  2. No external vault root -> exit 2; a configured root that
                  is missing (or not writable for --set/--clear) -> one
                  "vault writer skipped" line, exit 0. Never touches the
                  mirror.`;

module.exports = { SPEC_INIT_HELP, VAULT_HELP };
