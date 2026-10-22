'use strict';

// `product validate --spec-status --ci` (spec 017 FR-033): the roadmap-internal
// half of the spec/roadmap coherence check. It needs no vault. A feature the
// roadmap calls `done` or `in-flight` must name its spec: `spec_path` in the
// ROADMAP.md entry or in features/<id>/feature.md.

const fs = require('fs');
const path = require('path');
const { parseNestedFrontmatter } = require('./io.cjs');

const CI_STATUSES = new Set(['done', 'in-flight']);

function hasPath(value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== 'null';
}

/** spec_path of features/<id>/feature.md, or null when the file is absent or unreadable. */
function featureFileSpecPath(dir, id) {
  const file = path.join(dir, 'features', id, 'feature.md');
  try {
    const { fm } = parseNestedFrontmatter(fs.readFileSync(file, 'utf8'));
    return fm && hasPath(fm.spec_path) ? fm.spec_path : null;
  } catch (_e) {
    return null;
  }
}

/** Pure apart from reading feature files. Returns a NEW object
 * `{ checked, violations }`; each violation names the feature and its status. */
function checkSpecPaths({ roadmapFm, dir }) {
  const features = roadmapFm && Array.isArray(roadmapFm.features) ? roadmapFm.features : [];
  const gated = features.filter((f) => f && typeof f.id === 'string' && CI_STATUSES.has(f.status));
  const violations = gated
    .filter((f) => !hasPath(f.spec_path) && featureFileSpecPath(dir, f.id) === null)
    .map((f) => ({
      feature: f.id,
      roadmap_status: f.status,
      message: `${f.id}: roadmap status \`${f.status}\` but no spec_path in ROADMAP.md or features/${f.id}/feature.md`,
    }));
  return { checked: gated.length, violations };
}

/** The `ci` section of the validate output. `roadmapFm === null` means the repo
 * has no roadmap: the check does not apply (exit 0). */
function ciSection({ roadmapFm, dir }) {
  if (roadmapFm === null) return { applicable: false, result: 'not_applicable', checked: 0, violations: [] };
  const { checked, violations } = checkSpecPaths({ roadmapFm, dir });
  return { applicable: true, result: violations.length === 0 ? 'ok' : 'violations', checked, violations };
}

module.exports = { CI_STATUSES, checkSpecPaths, ciSection };
