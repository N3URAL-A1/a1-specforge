'use strict';

// ---------------------------------------------------------------------------
// vault-contract — the versioned read contract between a1 and the vault
// cockpit (spec 010-vault-cockpit-contract, Wave 1; consumer obsidian-lumen
// `002-control-panel` / `008-vault-contract`).
//
// Two things live here and nowhere else:
//   1. the mirror sets as DATA (FR-002/003/004) and the hub relation line
//      template (FR-024) — Wave 2 (mirror engine) and Wave 6 (link-hub)
//      consume them; nothing else defines them;
//   2. `buildSchemaExport()` — the contract document for
//      `a1-tools schema export --json` (FR-020), built ONLY from
//      status-constants.cjs and the sets in (1). No timestamps, no paths, no
//      environment: the output is a pure function of the source, which is why
//      a golden file can pin it (FR-021).
//
// Every value or shape change here or in status-constants.cjs bumps
// VAULT_CONTRACT_VERSION in the same commit (see the golden's header).
// ---------------------------------------------------------------------------

const C = require('./status-constants.cjs');
const { usage } = require('./help.cjs');

// FR-002 — relative to docs/product/; mirrored to <vault>/project/<slug>/product/.
const PRODUCT_MIRROR_SET = Object.freeze([
  'ROADMAP.md', 'VISION.md', 'NEXT.md', 'index.json', 'features/**', 'audits/**',
]);

// FR-003 — relative to .a1/; mirrored to <vault>/project/<slug>/phases/
// (`phases/<phase>/<name>` keeps its phase dir, RESEARCH.md lands at the root).
const PHASES_MIRROR_SET = Object.freeze([
  'phases/*/GOAL.md', 'phases/*/PLAN.md', 'phases/*/STATUS.md', 'phases/*/VERIFICATION.md',
  'RESEARCH.md',
]);

// FR-004 — never copied, whatever set they would otherwise match.
const MIRROR_EXCLUDES = Object.freeze([
  'reservations.json', '.product-stage.lock.json', '*.lock*', '*.tmp*', 'observations.jsonl',
]);

// FR-024 — the one line `vault link-hub` appends under `## Relations`.
const HUB_RELATION_LINE = '- references [[project/<slug>/<subfolder>/<basename>]]';

/** New object with the same entries, keys in sorted order. */
function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

/** The FR-020 document: sorted top-level keys, arrays in declared order,
 * `schema_version` and `contract_version` both written from the ONE constant
 * (obsidian-lumen spec 002 reads `schema_version`). */
function buildSchemaExport() {
  return sortKeys({
    contract_version: C.VAULT_CONTRACT_VERSION,
    schema_version: C.VAULT_CONTRACT_VERSION,
    artifact_types: { ...C.ARTIFACT_TYPES },
    spec_statuses: [...C.SPEC_STATUSES],
    size_values: [...C.SPEC_SIZES],
    bug_statuses: [...C.BUG_STATUSES],
    analysis_statuses: [...C.ANALYSIS_STATUSES],
    quick_results: [...C.QUICK_RESULTS],
    roadmap_feature_statuses: [...C.FEATURE_STATUSES],
    roadmap_stages: [...C.FEATURE_STAGES],
    milestone_statuses: [...C.MILESTONE_STATUSES],
    project_statuses: [...C.PROJECT_STATUSES],
    spec_to_roadmap_status: { ...C.SPEC_TO_ROADMAP_STATUS },
    mirror: {
      product: [...PRODUCT_MIRROR_SET],
      phases: [...PHASES_MIRROR_SET],
      excluded: [...MIRROR_EXCLUDES],
    },
    hub_relation_line: HUB_RELATION_LINE,
  });
}

/** The bytes on stdout: 2-space indent, trailing newline. */
function serializeSchemaExport(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** `schema export --json` — exactly one token, `--json`; anything else is a
 * usage error (exit 1). Returns the document; the facade prints it with the
 * same 2-space/trailing-newline shape serializeSchemaExport() defines. */
function cmdSchemaExport(args) {
  if (args.length !== 1 || args[0] !== '--json') {
    usage('schema export requires --json and accepts no other argument');
  }
  return buildSchemaExport();
}

module.exports = {
  PRODUCT_MIRROR_SET, PHASES_MIRROR_SET, MIRROR_EXCLUDES, HUB_RELATION_LINE,
  buildSchemaExport, serializeSchemaExport, cmdSchemaExport,
};
