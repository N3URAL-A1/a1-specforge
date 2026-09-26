'use strict';

// ---------------------------------------------------------------------------
// vault-hub — `vault link-hub` (spec 010-vault-cockpit-contract, Wave 6
// agent B: FR-024/FR-025, plus the FR-026 `--all-specs` backfill) and the
// linkHub() function `spec init` calls.
//
// The hub note project/<slug>.md is human/Otto-owned. This module touches it
// in exactly one way: it inserts ONE line per artifact into the `## Relations`
// block, or appends the block at the end when the heading is missing. The hub
// is handled as TEXT — never parsed or serialised as frontmatter — so the byte
// diff of a write is the inserted line(s) and nothing else. It never creates a
// hub: a missing hub is reported (`hub: 'missing'`), and the CLI turns that
// into exit 1 for a single-slug call.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { HUB_RELATION_LINE } = require('./vault-contract.cjs');
const {
  vaultRoot, projectsPath, writeTextAtomic, parseFlags, assertSafeSegment, fail,
} = require('./io.cjs');
const { usage } = require('./help.cjs');

const RELATIONS_HEADING = '## Relations';
const RELATIONS_HEADING_RE = /^## Relations\r?$/;
const ANY_HEADING_RE = /^#{1,6}\s/;
const BULLET_RE = /^- /;
const CONTINUATION_RE = /^\s+\S/;
// `--all-specs` links what `spec list` counts as a spec, minus verification
// reports, Obsidian conflict copies and half-written tmp files.
const SPEC_FILE_RE = /^\d{3}-.+\.md$/;
const SPEC_EXCLUDE_RE = /-VERIFICATION\.md$|\.sync-conflict-|conflicted copy|\.tmp\./i;

// ---------- pure text helpers ----------

function stripCr(s) {
  return s.endsWith('\r') ? s.slice(0, -1) : s;
}

/** The FR-024 line for one artifact, built from the one template constant. */
function relationLine(slug, subfolder, basename) {
  return HUB_RELATION_LINE
    .replace('<slug>', slug)
    .replace('<subfolder>', subfolder)
    .replace('<basename>', basename);
}

/** Returns the hub text with `line` inserted as the last bullet of the
 * `## Relations` block, the block appended when missing, or null when the
 * exact line is already present. Pure: the input string is never changed. */
function insertRelationLine(text, line) {
  const lines = text.split('\n');
  if (lines.some((l) => stripCr(l).trimEnd() === line)) return null;
  const headingIdx = lines.findIndex((l) => RELATIONS_HEADING_RE.test(l));
  if (headingIdx === -1) {
    const nl = text === '' || text.endsWith('\n') ? '' : '\n';
    return `${text}${nl}\n${RELATIONS_HEADING}\n\n${line}\n`;
  }
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (ANY_HEADING_RE.test(lines[i])) { end = i; break; }
  }
  let insertAt = headingIdx + 1;
  for (let i = headingIdx + 1; i < end; i++) {
    if (BULLET_RE.test(lines[i])) insertAt = i + 1;
  }
  if (insertAt === headingIdx + 1) {
    if (insertAt < end && lines[insertAt].trim() === '') insertAt += 1;
  } else {
    while (insertAt < end && CONTINUATION_RE.test(lines[insertAt])) insertAt += 1;
  }
  return [...lines.slice(0, insertAt), line, ...lines.slice(insertAt)].join('\n');
}

// ---------- vault access ----------

function safeSegmentOrFail(value, label) {
  try {
    return assertSafeSegment(value, label);
  } catch (e) {
    return fail(e.message);
  }
}

function hubPathFor(slug) {
  return projectsPath(`${safeSegmentOrFail(slug, 'project slug')}.md`);
}

/** Link ONE artifact into the hub. Library entry point used by `spec init`;
 * never exits, never creates the hub. Result `hub` is one of
 * linked | unchanged | would-link (dry run) | missing. */
function linkHub(slug, subfolder, basename, opts = {}) {
  const hubPath = hubPathFor(slug);
  const line = relationLine(slug, subfolder, basename);
  const base = { hub_path: hubPath, line };
  if (!fs.existsSync(hubPath)) return { ...base, hub: 'missing' };
  const next = insertRelationLine(fs.readFileSync(hubPath, 'utf8'), line);
  if (next === null) return { ...base, hub: 'unchanged' };
  if (opts.dryRun) return { ...base, hub: 'would-link' };
  writeTextAtomic(hubPath, next);
  return { ...base, hub: 'linked' };
}

/** Link every spec basename of one slug in a single read/write of its hub. */
function linkSpecsIntoHub(slug, basenames, dryRun) {
  const hubPath = hubPathFor(slug);
  if (!fs.existsSync(hubPath)) {
    return { slug, hub: 'missing', hub_path: hubPath, added: [], unchanged: 0 };
  }
  const start = { text: fs.readFileSync(hubPath, 'utf8'), added: [], unchanged: 0 };
  const acc = basenames.reduce((state, b) => {
    const line = relationLine(slug, 'spec', b);
    const next = insertRelationLine(state.text, line);
    if (next === null) return { ...state, unchanged: state.unchanged + 1 };
    return { text: next, added: [...state.added, line], unchanged: state.unchanged };
  }, start);
  if (acc.added.length > 0 && !dryRun) writeTextAtomic(hubPath, acc.text);
  const hub = acc.added.length === 0 ? 'unchanged' : dryRun ? 'would-link' : 'linked';
  return { slug, hub, hub_path: hubPath, added: acc.added, unchanged: acc.unchanged };
}

function listSpecBasenames(slug) {
  const dir = projectsPath(slug, 'spec');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort()
    .filter((f) => SPEC_FILE_RE.test(f) && !SPEC_EXCLUDE_RE.test(f))
    .map((f) => f.slice(0, -3));
}

function allSlugsWithSpecs() {
  const projectDir = path.join(vaultRoot(), 'project');
  if (!fs.existsSync(projectDir)) return [];
  return fs.readdirSync(projectDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(projectDir, d.name, 'spec')))
    .map((d) => d.name)
    .sort();
}

// FR-001: `vault *` refuses the repo-local tier. Local stand-in until Wave 2's
// vaultRootInfo() lands in io.cjs — same tier rules as vaultRoot(): env wins,
// a git repo without the env var is repo-local, everything else is decided
// (and announced) by vaultRoot() itself.
function requireExternalVaultRoot(cmd) {
  if (process.env.A1_VAULT_ROOT) return;
  let inRepo = false;
  try {
    execSync('git rev-parse --show-toplevel', { stdio: ['ignore', 'pipe', 'ignore'] });
    inRepo = true;
  } catch (_e) {
    inRepo = false;
  }
  if (!inRepo) return;
  process.stderr.write(
    `[a1-tools] vault ${cmd}: no external vault root (tier repo-local); set A1_VAULT_ROOT\n`
  );
  process.exit(2);
}

// ---------- CLI ----------

function ensureArtifactExists(slug, subfolder, basename) {
  const file = projectsPath(slug, subfolder, `${basename}.md`);
  if (!fs.existsSync(file)) fail(`artifact not found: ${file}`);
  return { subfolder, basename };
}

/** `<artifact-path>` (project/<slug>/<subfolder>/<name>.md, vault-relative or
 * absolute inside the vault) or `--spec <id>` → {subfolder, basename}. */
function resolveArtifactRef(slug, positional, specId) {
  if (specId !== undefined) {
    if (positional !== undefined) usage('vault link-hub takes either <artifact-path> or --spec <id>, not both');
    const basename = safeSegmentOrFail(String(specId).replace(/\.md$/, ''), 'spec id');
    return ensureArtifactExists(slug, 'spec', basename);
  }
  if (!positional) usage('vault link-hub requires <artifact-path> or --spec <id>');
  const rel = path.isAbsolute(positional) ? path.relative(vaultRoot(), positional) : positional;
  const parts = rel.split(/[\\/]/).filter((p) => p !== '' && p !== '.');
  if (parts.length !== 4 || parts[0] !== 'project' || parts[1] !== slug || !parts[3].endsWith('.md')) {
    fail(`artifact path must be project/${slug}/<subfolder>/<name>.md (got: ${positional})`);
  }
  const subfolder = safeSegmentOrFail(parts[2], 'subfolder');
  const basename = safeSegmentOrFail(parts[3].slice(0, -3), 'artifact name');
  return ensureArtifactExists(slug, subfolder, basename);
}

function linkAllSpecs(slugArg, dryRun) {
  const slugs = slugArg ? [safeSegmentOrFail(slugArg, 'project slug')] : allSlugsWithSpecs();
  const projects = slugs.map((s) => linkSpecsIntoHub(s, listSpecBasenames(s), dryRun));
  const linked = projects.reduce((n, p) => n + p.added.length, 0);
  const unchanged = projects.reduce((n, p) => n + p.unchanged, 0);
  const missingHub = projects.filter((p) => p.hub === 'missing').map((p) => p.slug);
  if (dryRun) {
    const lines = projects.flatMap((p) => p.added.map((l) => `  ${p.hub_path}: ${l}`));
    process.stderr.write(`[a1-tools] vault link-hub --dry-run: would add ${linked} line(s)\n${lines.map((l) => `${l}\n`).join('')}`);
  }
  if (slugArg && missingHub.length > 0) {
    fail(`hub note missing: ${projects[0].hub_path} — link-hub never creates hubs (create it first)`);
  }
  return { mode: 'all-specs', dry_run: dryRun, linked, unchanged, missing_hub: missingHub, projects };
}

/** `vault link-hub <slug> <artifact-path> | --spec <id> [--dry-run]`
 *  `vault link-hub [<slug>] --all-specs [--dry-run]` */
function cmdVaultLinkHub(args) {
  requireExternalVaultRoot('link-hub');
  const flags = parseFlags(args, { spec: 'value', 'all-specs': 'bool', 'dry-run': 'bool' });
  const dryRun = Boolean(flags['dry-run']);
  if (flags['all-specs']) return linkAllSpecs(flags._[0], dryRun);
  const slug = flags._[0];
  if (!slug) usage('vault link-hub requires <slug> (<artifact-path> | --spec <id>) or --all-specs');
  safeSegmentOrFail(slug, 'project slug');
  const ref = resolveArtifactRef(slug, flags._[1], flags.spec);
  const result = linkHub(slug, ref.subfolder, ref.basename, { dryRun });
  if (result.hub === 'missing') {
    fail(`hub note missing: ${result.hub_path} — link-hub never creates hubs (create it first)`);
  }
  return { slug, dry_run: dryRun, ...result };
}

module.exports = { relationLine, insertRelationLine, linkHub, cmdVaultLinkHub };
