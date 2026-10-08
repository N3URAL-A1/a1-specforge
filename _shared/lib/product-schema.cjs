'use strict';

// Shared product schema facts: frontmatter key orders, id/slug and date
// shapes, and the inline flow-mapping parser. A leaf module: it requires
// nothing from this repo, so the vault-* modules can load it at the top.


const PRODUCT_ROADMAP_KEY_ORDER = [
  'schema_version', 'type', 'project', 'title', 'status', 'updated', 'source',
  'milestones', 'features', 'next',
];

const PRODUCT_FEATURE_KEY_ORDER = [
  'id', 'project', 'milestone', 'title', 'status', 'stage', 'depends_on',
  'started', 'finished', 'spec_path', 'plan_path', 'schema_version',
];


// Slug/id shapes accepted anywhere a user-controlled value is joined into a
// filesystem path for the `product` subcommands. Every entry point enforces
// them via assertSlug() (product-txn.cjs) before any path.join()/lock
// acquisition happens — see SEC findings on path traversal via unvalidated
// --id/--milestone/--project.
const PRODUCT_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FEATURE_ID_RE = /^[0-9]{3}-[a-z0-9]+(-[a-z0-9]+)*$/;

const YYYY_MM_RE = /^[0-9]{4}-[0-9]{2}$/;
const YYYY_MM_DD_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** Parse a single-line inline YAML flow-mapping like
 * `{ blocker: 5, major: 11, minor: 15 }` into a plain object of scalars.
 * `parseNestedFrontmatter` (lib/io.cjs) has no general nested-object
 * support — it only handles scalars, scalar arrays, and arrays of flat
 * objects — so a top-level flow-mapping value comes back as the raw
 * un-parsed string. This is a small, deliberately narrow helper (only the
 * `counts` field in an audit file uses this shape) rather than a rewrite
 * of the shared parser, which is out of this wave's scope. Returns null if
 * `raw` is not a string or does not look like `{ ... }`. Pure. */
function parseInlineFlowObject(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return {};
  const obj = {};
  for (const pair of inner.split(',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const valueRaw = pair.slice(idx + 1).trim();
    if (/^-?[0-9]+$/.test(valueRaw)) {
      obj[key] = parseInt(valueRaw, 10);
    } else if (valueRaw === 'true') {
      obj[key] = true;
    } else if (valueRaw === 'false') {
      obj[key] = false;
    } else if (valueRaw === 'null') {
      obj[key] = null;
    } else {
      obj[key] = valueRaw.replace(/^["']|["']$/g, '');
    }
  }
  return obj;
}

module.exports = {
  PRODUCT_ROADMAP_KEY_ORDER,
  PRODUCT_FEATURE_KEY_ORDER,
  PRODUCT_SLUG_RE,
  FEATURE_ID_RE,
  YYYY_MM_RE,
  YYYY_MM_DD_RE,
  parseInlineFlowObject,
};
