'use strict';

// Spec ↔ roadmap status coherence (spec 010-vault-cockpit-contract, Wave 7,
// FR-027..FR-031). One owner for three consumers:
//   - `product validate --spec-status`   (product.cjs, one call site)
//   - checklist check #11                (checklist.cjs)
//   - the `spec update-status` hint      (spec.cjs)
//
// Motivation (measured 2026-09-24, spec F-007): spec 005 said `done` while
// docs/product/ROADMAP.md still said `planned` and recommended it as next.
// Two status sources, no check between them.
//
// Classification per roadmap feature (FR-028):
//   violation — terminal disagreement: the spec's roadmap-equivalent status
//               (SPEC_TO_ROADMAP_STATUS) and the roadmap status differ and at
//               least one side is `done|cancelled` (covers "exactly one side
//               terminal" AND "both terminal but different").
//   warning   — non-terminal disagreement (`implementing` vs `planned`), or a
//               spec status outside the vocabulary (Wave 6 lint outliers),
//               or a spec file that cannot be read.
//   unlinked  — no spec resolvable (info, never fails).

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, parseNestedFrontmatter, codeRoots } = require('./io.cjs');
const { SPEC_TO_ROADMAP_STATUS } = require('./status-constants.cjs');

const TERMINAL_STATUSES = new Set(['done', 'cancelled']);
const ROADMAP_REL = ['docs', 'product', 'ROADMAP.md'];
// A glob segment built from roadmap data must stay one plain path segment.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONFLICT_COPY_RE = /\((?:conflict|conflicted copy)|\.sync-conflict-/;
// Same denylist io.codeRoots() applies before it exits the process.
const HAZARDOUS_ROOT_RE = /[$`;|&<>\n\r]/;
const MANUAL_CANCEL_NOTE =
  'no a1-tools verb sets a roadmap feature to cancelled (product stage covers stages up to done)';

function realOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch (_e) {
    return null;
  }
}

function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ---------- reconcile command ----------

/** The command that makes both sides agree. `preferSpec` = the spec is the
 * newer truth (the update-status hint); otherwise a terminal roadmap wins
 * unless the spec itself says `done` (finished work is never un-finished). */
function reconcileCommand({ id, specRel, specStatus, roadmapStatus, preferSpec }) {
  const roadmapWins = !preferSpec && specStatus !== 'done' && TERMINAL_STATUSES.has(roadmapStatus);
  if (roadmapWins) return `spec update-status ${specRel} ${roadmapStatus}`;
  if (specStatus === 'done') return `product stage --by ${id} --set done`;
  return `set features[${id}].status: cancelled in docs/product/ROADMAP.md — ${MANUAL_CANCEL_NOTE}`;
}

// ---------- spec resolution ----------

/** Resolve a roadmap feature's spec: `spec_path` when set (vault-relative or
 * absolute, but always inside the REAL vault root), else the first
 * `project/<slug>/spec/<id>*.md` (exact `<id>.md` preferred, conflict copies
 * ignored). Returns { abs, rel } or { unlinkedReason }. */
function resolveSpecFile(feature, vaultRoot, slug) {
  const realRoot = realOrNull(vaultRoot);
  if (!realRoot) return { unlinkedReason: `vault root not found: ${vaultRoot}` };
  const sp = feature.spec_path;
  if (typeof sp === 'string' && sp.trim() !== '') {
    const abs = path.isAbsolute(sp) ? sp : path.join(vaultRoot, sp);
    const real = realOrNull(abs);
    if (!real) return { unlinkedReason: `spec_path does not exist: ${sp}` };
    if (!isInside(realRoot, real)) return { unlinkedReason: `spec_path resolves outside the vault: ${sp}` };
    return { abs: real, rel: sp };
  }
  const id = feature.id;
  if (!SAFE_SEGMENT_RE.test(String(slug)) || !SAFE_SEGMENT_RE.test(String(id))) {
    return { unlinkedReason: 'project slug or feature id is not a plain path segment' };
  }
  const dir = path.join(vaultRoot, 'project', slug, 'spec');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_e) {
    return { unlinkedReason: `no spec_path and no spec directory project/${slug}/spec/` };
  }
  const candidates = names
    .filter((n) => n.startsWith(id) && n.endsWith('.md') && !CONFLICT_COPY_RE.test(n))
    .sort();
  const hit = candidates.includes(`${id}.md`) ? `${id}.md` : candidates[0];
  if (!hit) return { unlinkedReason: `no spec_path and no project/${slug}/spec/${id}*.md` };
  const abs = path.join(dir, hit);
  const real = realOrNull(abs);
  if (!real || !isInside(realRoot, real)) return { unlinkedReason: `spec resolves outside the vault: ${hit}` };
  return { abs: real, rel: `project/${slug}/spec/${hit}` };
}

function readSpecStatus(abs) {
  try {
    const { fm } = parseFrontmatter(fs.readFileSync(abs, 'utf8'));
    return { status: typeof fm.status === 'string' ? fm.status : null };
  } catch (e) {
    return { error: e.message };
  }
}

// ---------- classification ----------

function classifyFeature(feature, vaultRoot, slug) {
  const id = feature.id;
  const roadmapStatus = feature.status;
  const spec = resolveSpecFile(feature, vaultRoot, slug);
  if (spec.unlinkedReason) {
    return { kind: 'unlinked', entry: { feature: id, roadmap_status: roadmapStatus, reason: spec.unlinkedReason } };
  }
  const read = readSpecStatus(spec.abs);
  const base = { feature: id, spec_path: spec.rel, roadmap_status: roadmapStatus };
  if (read.error) {
    return { kind: 'warning', entry: { ...base, kind: 'spec_unreadable', message: `${id}: spec ${spec.rel} unreadable (${read.error})` } };
  }
  const specStatus = read.status;
  const mapped = Object.prototype.hasOwnProperty.call(SPEC_TO_ROADMAP_STATUS, specStatus)
    ? SPEC_TO_ROADMAP_STATUS[specStatus]
    : null;
  if (mapped === null) {
    return {
      kind: 'warning',
      entry: { ...base, spec_status: specStatus, kind: 'unknown_spec_status',
        message: `${id}: spec status \`${specStatus}\` is outside the spec vocabulary — cannot compare with roadmap \`${roadmapStatus}\`` },
    };
  }
  if (mapped === roadmapStatus) return { kind: 'ok' };
  const entry = { ...base, spec_status: specStatus, mapped_status: mapped };
  if (TERMINAL_STATUSES.has(mapped) || TERMINAL_STATUSES.has(roadmapStatus)) {
    const reconcile = reconcileCommand({ id, specRel: spec.rel, specStatus, roadmapStatus, preferSpec: false });
    return {
      kind: 'violation',
      entry: { ...entry, reconcile,
        message: `${id}: spec status \`${specStatus}\` (roadmap equivalent \`${mapped}\`) disagrees terminally with roadmap status \`${roadmapStatus}\` — reconcile: ${reconcile}` },
    };
  }
  return {
    kind: 'warning',
    entry: { ...entry, kind: 'status_drift',
      message: `${id}: spec status \`${specStatus}\` (roadmap equivalent \`${mapped}\`) differs from roadmap status \`${roadmapStatus}\` (non-terminal)` },
  };
}

/** FR-028 core. Pure apart from reading spec files. Returns a NEW object
 * `{ violations, warnings, unlinked }`. */
function checkSpecRoadmapCoherence({ roadmapFm, vaultRoot, slug }) {
  const features = roadmapFm && Array.isArray(roadmapFm.features) ? roadmapFm.features : [];
  const buckets = { violation: [], warning: [], unlinked: [] };
  for (const feature of features) {
    if (!feature || typeof feature.id !== 'string') continue;
    const { kind, entry } = classifyFeature(feature, vaultRoot, slug);
    if (kind !== 'ok') buckets[kind].push(entry);
  }
  return { violations: buckets.violation, warnings: buckets.warning, unlinked: buckets.unlinked };
}

/** The `product validate --spec-status` section: the three lists for the
 * roadmap already parsed by `validate`, plus the vault it was resolved in. */
function specStatusSection(roadmapFm) {
  const { vaultRoot } = require('./io.cjs');
  const root = vaultRoot();
  return { vault_root: root, ...checkSpecRoadmapCoherence({ roadmapFm, vaultRoot: root, slug: roadmapFm.project }) };
}

// ---------- roadmap lookup (checklist #11, update-status hint) ----------

function readRoadmapAt(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return null;
  }
  try {
    return { file, fm: parseNestedFrontmatter(text).fm };
  } catch (_e) {
    return null;
  }
}

/** codeRoots() exits the process on a malformed A1_CODE_ROOTS. A hint or a
 * checklist lookup must never do that, so the env tier is filtered here with
 * the same rules instead of being handed to codeRoots(). */
function lookupCodeRoots({ quiet = false } = {}) {
  const env = process.env.A1_CODE_ROOTS;
  if (!env) return codeRoots({ quiet });
  return env.split(':')
    .map((d) => d.trim())
    .filter((d) => d && path.isAbsolute(d) && !HAZARDOUS_ROOT_RE.test(d))
    .filter((d) => realOrNull(d) !== null && fs.statSync(d).isDirectory());
}

function childDirs(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(root, d.name));
  } catch (_e) {
    return [];
  }
}

/** Find the roadmap whose `project:` is `slug`: the current directory first
 * (the repo being worked in is the truth), then every checkout under the code
 * roots, then — only with `vaultRoot` — the vault mirror
 * `project/<slug>/product/ROADMAP.md`. Returns { file, fm, source } or null. */
function findProjectRoadmap(slug, { vaultRoot: mirrorRoot = null, quiet = false } = {}) {
  const tiers = [
    ['cwd', [path.join(process.cwd(), ...ROADMAP_REL)]],
    ['code-root', lookupCodeRoots({ quiet }).flatMap(childDirs).map((d) => path.join(d, ...ROADMAP_REL))],
  ];
  if (mirrorRoot && SAFE_SEGMENT_RE.test(String(slug))) {
    tiers.push(['vault-mirror', [path.join(mirrorRoot, 'project', slug, 'product', 'ROADMAP.md')]]);
  }
  for (const [source, files] of tiers) {
    for (const file of files) {
      const rm = readRoadmapAt(file);
      if (rm && rm.fm.project === slug) return { ...rm, source };
    }
  }
  return null;
}

/** FR-031: the stderr hint after `spec update-status <path> done|cancelled`,
 * or null. Never writes; the caller prints. */
function roadmapHint({ specAbs, fm, newStatus, vaultRoot }) {
  if (!TERMINAL_STATUSES.has(newStatus)) return null;
  const specRel = vaultRoot ? path.relative(vaultRoot, specAbs) : specAbs;
  const relParts = vaultRoot ? specRel.split(path.sep) : [];
  const slug = typeof fm.project === 'string' && fm.project !== ''
    ? fm.project
    : relParts[0] === 'project' ? relParts[1] : null;
  if (!slug) return null;
  const id = typeof fm.id === 'string' && fm.id !== '' ? fm.id : path.basename(specAbs, '.md');
  const rm = findProjectRoadmap(slug, { quiet: true });
  const feature = rm && Array.isArray(rm.fm.features) ? rm.fm.features.find((f) => f && f.id === id) : null;
  if (!feature || feature.status === SPEC_TO_ROADMAP_STATUS[newStatus]) return null;
  const cmd = reconcileCommand({ id, specRel, specStatus: newStatus,
    roadmapStatus: feature.status, preferSpec: true });
  return `hint: ${rm.file} lists ${id} as \`${feature.status}\`, the spec is now \`${newStatus}\`. ` +
    `Reconcile in that repo: ${cmd.startsWith('product ') ? `a1-tools ${cmd}` : cmd}`;
}

module.exports = {
  TERMINAL_STATUSES,
  checkSpecRoadmapCoherence,
  specStatusSection,
  findProjectRoadmap,
  roadmapHint,
  reconcileCommand,
};
