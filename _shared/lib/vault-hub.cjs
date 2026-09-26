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
//
// CLI order (review n5, FR-001, FR-010, FR-034): external-root refusal
// (exit 2) → argument checks (exit 1) → configured root missing or not
// writable (one warning, exit 0) → non-writer host (one warning, exit 0) →
// the write.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { HUB_RELATION_LINE } = require('./vault-contract.cjs');
const {
  vaultRoot, projectsPath, writeTextAtomic, parseFlags, assertSafeSegment, fail,
} = require('./io.cjs');
const { usage } = require('./help.cjs');
const {
  isConflictCopy, isLink, externalVaultRoot, rootProblem, warnSkipped, notWriterSkip,
} = require('./vault-common.cjs');

const RELATIONS_HEADING = '## Relations';
const RELATIONS_HEADING_RE = /^## Relations\r?$/;
const ANY_HEADING_RE = /^#{1,6}\s/;
const BULLET_RE = /^- /;
const CONTINUATION_RE = /^\s+\S/;
// `--all-specs` links what `spec list` counts as a spec, minus verification
// reports, sync-conflict copies (vault-common isConflictCopy) and
// half-written tmp files.
const SPEC_FILE_RE = /^\d{3}-.+\.md$/;
const SPEC_EXCLUDE_RE = /-VERIFICATION\.md$|\.tmp\./i;

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
 * exact line is already present. A CRLF hub gets CRLF on every line it
 * gains (review n7). Pure: the input string is never changed. */
function insertRelationLine(text, line) {
  const lines = text.split('\n');
  if (lines.some((l) => stripCr(l).trimEnd() === line)) return null;
  const cr = text.includes('\r\n') ? '\r' : '';
  const headingIdx = lines.findIndex((l) => RELATIONS_HEADING_RE.test(l));
  if (headingIdx === -1) {
    const nl = text === '' || text.endsWith('\n') ? '' : `${cr}\n`;
    return `${text}${nl}${cr}\n${RELATIONS_HEADING}${cr}\n${cr}\n${line}${cr}\n`;
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
  // Inserting at the end of a text without a final newline: the previous last
  // line needs its CR before it stops being the last line.
  const before = lines.slice(0, insertAt);
  const atEnd = insertAt === lines.length;
  const fixedBefore = atEnd && cr && before.length > 0 && !before[before.length - 1].endsWith('\r')
    ? [...before.slice(0, -1), `${before[before.length - 1]}\r`]
    : before;
  return [...fixedBefore, `${line}${atEnd ? '' : cr}`, ...lines.slice(insertAt)].join('\n');
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

// Wave 5 (security review MINOR 1c): a hub note or project folder that is a
// symlink is refused with one stderr line — the hub is read and rewritten,
// so a link would pull outside content into the vault (or write outside it).

/** null, or the refusal reason for a linked hub note / project folder. */
function linkRefusal(slug) {
  if (isLink(hubPathFor(slug))) return `hub note is a symbolic link: project/${slug}.md`;
  if (isLink(path.join(vaultRoot(), 'project', slug))) return `project folder is a symbolic link: project/${slug}/`;
  return null;
}

function refuseLinked(slug) {
  const reason = linkRefusal(slug);
  if (reason) process.stderr.write(`[a1-tools] vault link-hub: refused (${reason})\n`);
  return reason;
}

/** Link ONE artifact into the hub. Library entry point used by `spec init`;
 * never exits, never creates the hub. Result `hub` is one of
 * linked | unchanged | would-link (dry run) | missing. */
function linkHub(slug, subfolder, basename, opts = {}) {
  const hubPath = hubPathFor(slug);
  const line = relationLine(slug, subfolder, basename);
  const base = { hub_path: hubPath, line };
  if (refuseLinked(slug)) return { ...base, hub: 'refused-link' };
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
  if (refuseLinked(slug)) return { slug, hub: 'refused-link', hub_path: hubPath, added: [], unchanged: 0 };
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
    .filter((f) => SPEC_FILE_RE.test(f) && !SPEC_EXCLUDE_RE.test(f) && !isConflictCopy(f))
    .map((f) => f.slice(0, -3));
}

function allSlugsWithSpecs() {
  const projectDir = path.join(vaultRoot(), 'project');
  if (!fs.existsSync(projectDir)) return [];
  const entries = fs.readdirSync(projectDir, { withFileTypes: true });
  entries.filter((d) => d.isSymbolicLink() && fs.existsSync(path.join(projectDir, d.name, 'spec')))
    .forEach((d) => process.stderr.write(`[a1-tools] vault link-hub: refused (project folder is a symbolic link: project/${d.name}/)\n`));
  return entries
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(projectDir, d.name, 'spec')))
    .map((d) => d.name)
    .sort();
}

// FR-001: `vault *` refuses a missing external root (exit 2) with the shared
// read-only lookup — nothing is created, nothing announced.
function requireExternalVaultRoot(cmd) {
  const ext = externalVaultRoot();
  if (!ext.refusal) return ext.root;
  process.stderr.write(`[a1-tools] vault ${cmd}: ${ext.refusal}\n`);
  return process.exit(2);
}

// ---------- CLI ----------

function ensureArtifactExists(slug, subfolder, basename) {
  const file = projectsPath(slug, subfolder, `${basename}.md`);
  if (!fs.existsSync(file)) fail(`artifact not found: ${file}`);
  return { subfolder, basename };
}

/** `<artifact-path>` (project/<slug>/<subfolder>/<name>.md, vault-relative or
 * absolute inside the vault) or `--spec <id>` → {subfolder, basename}.
 * Argument shape only — no filesystem access (see ensureArtifactExists). */
function parseArtifactRef(slug, positional, specId, root) {
  if (specId !== undefined) {
    if (positional !== undefined) usage('vault link-hub takes either <artifact-path> or --spec <id>, not both');
    return { subfolder: 'spec', basename: safeSegmentOrFail(String(specId).replace(/\.md$/, ''), 'spec id') };
  }
  if (!positional) usage('vault link-hub requires <artifact-path> or --spec <id>');
  const rel = path.isAbsolute(positional) ? path.relative(root, positional) : positional;
  const parts = rel.split(/[\\/]/).filter((p) => p !== '' && p !== '.');
  if (parts.length !== 4 || parts[0] !== 'project' || parts[1] !== slug || !parts[3].endsWith('.md')) {
    fail(`artifact path must be project/${slug}/<subfolder>/<name>.md (got: ${positional})`);
  }
  const subfolder = safeSegmentOrFail(parts[2], 'subfolder');
  const basename = safeSegmentOrFail(parts[3].slice(0, -3), 'artifact name');
  return { subfolder, basename };
}

function linkAllSpecs(slugArg, dryRun) {
  const slugs = slugArg ? [safeSegmentOrFail(slugArg, 'project slug')] : allSlugsWithSpecs();
  const projects = slugs.map((s) => (linkRefusal(s)
    ? linkSpecsIntoHub(s, [], dryRun) // prints the refusal; lists nothing through the link
    : linkSpecsIntoHub(s, listSpecBasenames(s), dryRun)));
  const linked = projects.reduce((n, p) => n + p.added.length, 0);
  const unchanged = projects.reduce((n, p) => n + p.unchanged, 0);
  const missingHub = projects.filter((p) => p.hub === 'missing').map((p) => p.slug);
  const refusedLink = projects.filter((p) => p.hub === 'refused-link').map((p) => p.slug);
  if (dryRun) {
    const lines = projects.flatMap((p) => p.added.map((l) => `  ${p.hub_path}: ${l}`));
    process.stderr.write(`[a1-tools] vault link-hub --dry-run: would add ${linked} line(s)\n${lines.map((l) => `${l}\n`).join('')}`);
  }
  if (slugArg && missingHub.length > 0) {
    fail(`hub note missing: ${projects[0].hub_path} — link-hub never creates hubs (create it first)`);
  }
  if (slugArg && refusedLink.length > 0) process.exit(1); // the refusal line is already on stderr
  return { mode: 'all-specs', dry_run: dryRun, linked, unchanged, missing_hub: missingHub, refused_link: refusedLink, projects };
}

/** The FR-010 / FR-034 skip: one warning line, `{status: skipped}`, exit 0. */
function skipped(reason, dryRun, mode) {
  return { status: 'skipped', reason, dry_run: dryRun, mode };
}

/** `vault link-hub <slug> <artifact-path> | --spec <id> [--dry-run]`
 *  `vault link-hub [<slug>] --all-specs [--dry-run]` */
function cmdVaultLinkHub(args) {
  const root = requireExternalVaultRoot('link-hub');
  const flags = parseFlags(args, { spec: 'value', 'all-specs': 'bool', 'dry-run': 'bool' });
  const dryRun = Boolean(flags['dry-run']);
  const allSpecs = Boolean(flags['all-specs']);
  const mode = allSpecs ? 'all-specs' : 'single';
  const slug = flags._[0];
  if (slug !== undefined) safeSegmentOrFail(slug, 'project slug');
  if (!allSpecs && !slug) usage('vault link-hub requires <slug> (<artifact-path> | --spec <id>) or --all-specs');
  const ref = allSpecs ? null : parseArtifactRef(slug, flags._[1], flags.spec, root);
  // FR-010: an unmounted or read-only vault is transient — never exit 1/2.
  const problem = rootProblem(root, dryRun ? fs.constants.R_OK : fs.constants.W_OK);
  if (problem) {
    warnSkipped('vault link-hub', problem);
    return skipped(problem, dryRun, mode);
  }
  // Wave 5 (FR-034, security review MAJOR 2): the hub note is a vault write —
  // a non-writer host skips (one stderr line, exit 0), dry run included.
  const notWriter = notWriterSkip('vault link-hub');
  if (notWriter) return skipped(notWriter, dryRun, mode);
  if (allSpecs) return linkAllSpecs(slug, dryRun);
  ensureArtifactExists(slug, ref.subfolder, ref.basename);
  const result = linkHub(slug, ref.subfolder, ref.basename, { dryRun });
  if (result.hub === 'refused-link') process.exit(1); // the refusal line is already on stderr
  if (result.hub === 'missing') {
    fail(`hub note missing: ${result.hub_path} — link-hub never creates hubs (create it first)`);
  }
  return { slug, dry_run: dryRun, ...result };
}

module.exports = { relationLine, insertRelationLine, linkHub, cmdVaultLinkHub };
