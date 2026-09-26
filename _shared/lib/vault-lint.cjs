'use strict';

// ---------------------------------------------------------------------------
// vault-lint — `a1-tools vault lint [<slug>] [--json] [--fix-type [--dry-run]]`
// (spec 010-vault-cockpit-contract, Wave 6 agent A: FR-018, FR-019, FR-014
// for the lint side, SC-004).
//
// Walks the a1 subfolders (ARTIFACT_TYPES) of project/<slug>/ — every slug
// when none is given — and reports frontmatter defects per class:
//   frontmatter_unparseable · type_missing · type_unknown ·
//   type_folder_mismatch · status_missing · status_invalid ·
//   frontmatter_folded · conflict
// Any other subfolder is counted as `ignored`, never reported. Companion
// files (`*-STATUS.md`, `*-VERIFICATION.md`) are never type- or status-
// checked and never stamped: only unparseable/folded/conflict apply to them
// (a strict --fix-type would write a false `type: wave-plan` into them).
//
// --fix-type is the ONE sanctioned backfill for legacy files without `type:`.
// It stamps every file with a `type_missing` finding whose frontmatter parses
// and is not folded, whatever else is reported for it (status outliers —
// review decision M4, 2026-09-26, FR-019/SC-004). Unparseable files and
// type_missing files with a folded scalar are left byte-identical and listed
// under `skipped` for manual repair; companions never carry type_missing. The line is edited as a STRING — never through
// serializeFrontmatter, which would reorder keys and requote titles: an empty
// `type:` line is replaced in place, otherwise `type: <t>` is inserted after
// the opening `---`. The file is byte-identical except for that one line, and
// a second run finds nothing to stamp (review M3).
//
// Exit codes: 0 clean, or skipped because the configured root is missing or
// lacks the needed access (FR-010, one stderr warning) · 1 findings ·
// 2 cannot run (usage, hostile slug, missing project folder, no external
// vault root). The command owns its exit code (vault-cli.cjs contract) and
// never returns to the facade.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const {
  ARTIFACT_TYPES, SPEC_STATUSES, BUG_STATUSES, ANALYSIS_STATUSES, QUICK_RESULTS,
} = require('./status-constants.cjs');
const {
  parseFrontmatter, writeTextAtomic, assertSafeSegment, parseFlags,
} = require('./io.cjs');
const { emitJson, writeStdoutSync } = require('./xprov-common.cjs');
const {
  isConflictCopy, isLink, externalVaultRoot, rootProblem, warnSkipped, notWriterSkip,
} = require('./vault-common.cjs');

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_CANNOT_RUN = 2;

const CLASSES = Object.freeze([
  'frontmatter_unparseable', 'type_missing', 'type_unknown', 'type_folder_mismatch',
  'status_missing', 'status_invalid', 'frontmatter_folded', 'conflict',
]);

// Status field + allowed set per artifact type. `wave-plan` and `postmortem`
// have no status field and are deliberately absent (FR-018).
const STATUS_RULES = Object.freeze({
  spec: { key: 'status', allowed: SPEC_STATUSES },
  'bug-report': { key: 'status', allowed: BUG_STATUSES },
  'project-analysis': { key: 'status', allowed: ANALYSIS_STATUSES },
  'quick-run': { key: 'result', allowed: QUICK_RESULTS },
});

const COMPANION_RE = /-(STATUS|VERIFICATION)\.md$/;
const KEY_LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;
const LIST_ITEM_RE = /^\s*-\s+(.*)$/;
const CONTINUATION_RE = /^\s+\S/;
const OBJECT_ITEM_RE = /^[A-Za-z_][A-Za-z0-9_]*:(\s|$)/;
// A `type:` line the parser reads as missing: empty, "" / '' or null.
const EMPTY_TYPE_LINE_RE = /^type:[ \t]*(?:""|''|null)?[ \t]*$/;
const KNOWN_TYPES = new Set(Object.values(ARTIFACT_TYPES));

const FLAGS = { json: 'bool', 'fix-type': 'bool', 'dry-run': 'bool' };

// ---------- pure checks ----------

/** Raw frontmatter lines (CRLF-normalised) or null when there is no block. */
function rawFrontmatterLines(content) {
  const text = content.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  return end === -1 ? null : text.slice(4, end).split('\n');
}

/** True when a scalar opened on this line is still open (quoted, unclosed)
 * or is a plain/block scalar — i.e. an indented next line continues it. */
function opensScalar(value) {
  if (value === '' || value === '[]' || value.startsWith('[') || value.startsWith('{')) return false;
  const q = value[0];
  if (q === '"' || q === "'") return !(value.length > 1 && value.endsWith(q));
  return true;
}

/** Keys whose scalar continues on an indented line (FR-018 frontmatter_folded).
 * Scans RAW lines: io.cjs parseFrontmatter now joins such lines, so a parse
 * alone can no longer see the defect. A nested map (`key:` + indented
 * `a: b`) and a list of objects (`- a: b` + indented `c: d`) are legitimate
 * YAML and are not reported. */
function foldedKeys(lines) {
  const keys = [];
  let key = null;
  let open = false;
  for (const line of lines) {
    if (line.trim() === '' || line.startsWith('#')) { open = false; continue; }
    const top = line.match(KEY_LINE_RE);
    if (top) { key = top[1]; open = opensScalar(top[2]); continue; }
    const item = line.match(LIST_ITEM_RE);
    if (item) { open = !OBJECT_ITEM_RE.test(item[1]) && opensScalar(item[1]); continue; }
    if (open && CONTINUATION_RE.test(line) && key && !keys.includes(key)) keys.push(key);
    open = open && CONTINUATION_RE.test(line);
  }
  return keys;
}

function statusFinding(fm, expectedType) {
  const rule = STATUS_RULES[expectedType];
  if (!rule) return null;
  const v = fm[rule.key];
  if (v === undefined || v === null || v === '') {
    return { class: 'status_missing', key: rule.key, detail: `no ${rule.key}: for type ${expectedType}` };
  }
  if (typeof v !== 'string' || !rule.allowed.has(v)) {
    return { class: 'status_invalid', key: rule.key, detail: `${rule.key}: ${JSON.stringify(v)} not in the ${expectedType} set` };
  }
  return null;
}

function typeFinding(fm, expectedType) {
  const t = fm.type;
  if (t === undefined || t === null || t === '') {
    return { class: 'type_missing', key: 'type', detail: `expected type: ${expectedType}` };
  }
  if (typeof t !== 'string' || !KNOWN_TYPES.has(t)) {
    return { class: 'type_unknown', key: 'type', detail: `type: ${JSON.stringify(t)} is not an a1 artifact type` };
  }
  if (t !== expectedType) {
    return { class: 'type_folder_mismatch', key: 'type', detail: `type: ${t} in a folder of type ${expectedType}` };
  }
  return null;
}

/** All findings for one a1 file (content given as text). Pure. */
function lintContent(content, expectedType, companion) {
  let fm;
  try {
    ({ fm } = parseFrontmatter(content));
  } catch (e) {
    return [{ class: 'frontmatter_unparseable', key: null, detail: e.message }];
  }
  const lines = rawFrontmatterLines(content) || [];
  const folded = foldedKeys(lines).map((k) => ({
    class: 'frontmatter_folded', key: k, detail: `${k}: continues on an indented line`,
  }));
  if (companion) return folded;
  return [typeFinding(fm, expectedType), statusFinding(fm, expectedType), ...folded]
    .filter(Boolean);
}

/** Offset and length (without EOL) of the empty `type:` line inside the
 * frontmatter block that starts after `start`, or null. */
function emptyTypeLine(content, start) {
  let pos = start;
  while (pos < content.length) {
    const nl = content.indexOf('\n', pos);
    const next = nl === -1 ? content.length : nl + 1;
    const line = content.slice(pos, nl === -1 ? content.length : nl).replace(/\r$/, '');
    if (line === '---') return null;
    if (EMPTY_TYPE_LINE_RE.test(line)) return { at: pos, length: line.length };
    pos = next;
  }
  return null;
}

/** FR-019: the file with `type: <t>` as a frontmatter key. An empty `type:`
 * line is replaced in place (never duplicated — review M3); otherwise the key
 * is inserted as the first line after the opening `---`, reusing that line's
 * EOL. Every other byte stays identical. A file without a frontmatter block
 * gains a minimal block in front of its unchanged content. */
function withTypeStamped(content, type) {
  const crlf = content.startsWith('---\r\n');
  if (!crlf && !content.startsWith('---\n')) return `---\ntype: ${type}\n---\n${content}`;
  const eol = crlf ? '\r\n' : '\n';
  const bodyStart = 3 + eol.length;
  const empty = emptyTypeLine(content, bodyStart);
  if (empty) return `${content.slice(0, empty.at)}type: ${type}${content.slice(empty.at + empty.length)}`;
  return `---${eol}type: ${type}${eol}${content.slice(bodyStart)}`;
}

// ---------- vault walk ----------

function listDir(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.'))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Every conflict copy anywhere under project/<slug>/ (FR-014), vault-relative. */
function conflictCopies(absDir, relDir) {
  return listDir(absDir).flatMap((d) => {
    const abs = path.join(absDir, d.name);
    const rel = `${relDir}/${d.name}`;
    if (d.isDirectory()) return conflictCopies(abs, rel);
    return isConflictCopy(d.name) ? [rel] : [];
  });
}

function lintProject(root, slug) {
  const projectDir = path.join(root, 'project', slug);
  const relBase = `project/${slug}`;
  const findings = conflictCopies(projectDir, relBase)
    .map((p) => ({ path: p, class: 'conflict', key: null, detail: 'Obsidian conflict copy' }));
  const files = [];
  let ignored = 0;
  let companions = 0;
  for (const d of listDir(projectDir).filter((e) => e.isDirectory())) {
    const expectedType = ARTIFACT_TYPES[d.name];
    if (!expectedType) { ignored += 1; continue; }
    const mdFiles = listDir(path.join(projectDir, d.name))
      .filter((f) => f.isFile() && f.name.endsWith('.md') && !isConflictCopy(f.name));
    for (const f of mdFiles) {
      const rel = `${relBase}/${d.name}/${f.name}`;
      const abs = path.join(projectDir, d.name, f.name);
      const companion = COMPANION_RE.test(f.name);
      if (companion) companions += 1;
      const content = fs.readFileSync(abs, 'utf8');
      const own = lintContent(content, expectedType, companion).map((x) => ({ path: rel, ...x }));
      findings.push(...own);
      files.push({ rel, abs, content, expectedType, own });
    }
  }
  return { findings, files, ignored, companions };
}

// A linked project folder is never walked or written (isLink, lstat):
// --fix-type would otherwise stamp files outside the vault.

function warnLinkedProject(slug) {
  process.stderr.write(`[a1-tools] vault lint: skipped project/${slug}/ (symbolic link, refused)\n`);
}

function allSlugs(root) {
  const dir = path.join(root, 'project');
  if (!fs.existsSync(dir)) return [];
  const entries = listDir(dir);
  // a link to a folder is reported (never silently dropped, never walked)
  entries.filter((d) => d.isSymbolicLink() && isDirTarget(path.join(dir, d.name))).forEach((d) => warnLinkedProject(d.name));
  return entries.filter((d) => d.isDirectory()).map((d) => d.name);
}

function isDirTarget(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_e) { return false; }
}

// ---------- fix ----------

/** Rewrites (or, dry-run, only selects) every file with a type_missing
 * finding, whatever else it reports (M4) — except a broken frontmatter:
 * unparseable files and folded type_missing files are listed as skipped and
 * never touched (SC-004). Companions never carry type_missing. */
function applyFixType(files, dryRun) {
  const fixed = [];
  const skipped = [];
  const has = (f, c) => f.own.some((x) => x.class === c);
  for (const f of files) {
    if (has(f, 'frontmatter_unparseable')) { skipped.push(f.rel); continue; }
    if (!has(f, 'type_missing')) continue;
    if (has(f, 'frontmatter_folded')) { skipped.push(f.rel); continue; }
    if (!dryRun) writeTextAtomic(f.abs, withTypeStamped(f.content, f.expectedType));
    fixed.push(f.rel);
  }
  return { fixed, skipped };
}

// ---------- CLI ----------

function usageError(msg) {
  process.stderr.write(`usage error: vault lint ${msg}\n`);
  process.exit(EXIT_CANNOT_RUN);
}

function cannotRun(msg) {
  process.stderr.write(`[a1-tools] vault lint: ${msg}\n`);
  process.exit(EXIT_CANNOT_RUN);
}

/** The <slug> argument checked before any filesystem access (hostile → exit 2). */
function checkedSlug(slugArg) {
  if (slugArg === undefined) return undefined;
  try {
    return assertSafeSegment(slugArg, 'project slug');
  } catch (e) {
    return usageError(e.message);
  }
}

function resolveTargets(root, slug) {
  if (slug === undefined) return allSlugs(root);
  if (!fs.existsSync(path.join(root, 'project', slug))) {
    return cannotRun(`project folder not found: project/${slug}/`);
  }
  if (isLink(path.join(root, 'project', slug))) {
    return cannotRun(`project folder is a symbolic link (refused): project/${slug}/`);
  }
  return [slug];
}

function countByClass(findings) {
  return findings.reduce((acc, f) => ({ ...acc, [f.class]: (acc[f.class] || 0) + 1 }), {});
}

function sortFindings(findings) {
  return [...findings].sort((a, b) => (a.path === b.path
    ? CLASSES.indexOf(a.class) - CLASSES.indexOf(b.class) || String(a.key).localeCompare(String(b.key))
    : a.path < b.path ? -1 : 1));
}

function humanReport(report, dryRun) {
  const lines = report.findings.map((f) => `${f.class}\t${f.path}${f.key ? `\t${f.key}` : ''}\t${f.detail}`);
  const verb = dryRun ? 'would fix' : 'fixed';
  const fixLines = (dryRun ? report.would_fix : report.fixed).map((p) => `${verb}\t${p}`);
  const skipLines = report.skipped.map((p) => `skipped\t${p}`);
  const counts = CLASSES.filter((c) => report.counts[c]).map((c) => `${c}: ${report.counts[c]}`).join(', ');
  const summary = `vault lint: ${report.findings.length} finding(s)${counts ? ` (${counts})` : ''}, ignored: ${report.ignored}, companions: ${report.companions}`;
  return [...fixLines, ...skipLines, ...lines, summary].map((l) => `${l}\n`).join('');
}

/** FR-010: a configured root that is missing (or lacks the access this run
 * needs: write for --fix-type, read otherwise) is one warning and exit 0. */
function exitIfRootUnusable(root, flags) {
  const writes = Boolean(flags['fix-type']) && !flags['dry-run'];
  const problem = rootProblem(root, writes ? fs.constants.W_OK : fs.constants.R_OK);
  if (!problem) return;
  warnSkipped('vault lint', problem);
  if (flags.json) emitJson({ status: 'skipped', reason: problem, vault_root: root }, EXIT_CLEAN);
  process.exit(EXIT_CLEAN);
}

function cmdVaultLint(args) {
  const flags = parseFlags(args, FLAGS);
  const unknown = flags._.filter((a) => a.startsWith('--'));
  if (unknown.length > 0) usageError(`unknown flag: ${unknown[0]}`);
  if (flags._.length > 1) usageError(`takes at most one <slug> (got: ${flags._.join(' ')})`);
  if (flags['dry-run'] && !flags['fix-type']) usageError('--dry-run requires --fix-type');
  const slug = checkedSlug(flags._[0]);

  // FR-001 (review m1): the tier is looked up read-only, so a refusal in a
  // repo creates no .a1/learnings/ and prints no resolver line.
  const ext = externalVaultRoot();
  if (ext.refusal) cannotRun(ext.refusal);
  const { root } = ext;
  exitIfRootUnusable(root, flags);
  const results = resolveTargets(root, slug).map((s) => lintProject(root, s));
  const scanned = results.flatMap((r) => r.findings);
  const dryRun = Boolean(flags['dry-run']);
  // Wave 5 (FR-034, security review MAJOR 2): the backfill writes vault files,
  // so only the writer host runs it; elsewhere the lint still reports and the
  // exit code stays the findings one.
  const notWriter = flags['fix-type'] ? notWriterSkip('vault lint --fix-type') : null;
  const fix = flags['fix-type'] && !notWriter
    ? applyFixType(results.flatMap((r) => r.files), dryRun)
    : { fixed: [], skipped: [] };
  const fixedNow = new Set(dryRun ? [] : fix.fixed);
  const findings = sortFindings(scanned.filter((f) => !(f.class === 'type_missing' && fixedNow.has(f.path))));

  const report = {
    findings,
    counts: countByClass(findings),
    ignored: results.reduce((n, r) => n + r.ignored, 0),
    companions: results.reduce((n, r) => n + r.companions, 0),
    fixed: dryRun ? [] : fix.fixed,
    skipped: fix.skipped,
    ...(dryRun ? { would_fix: fix.fixed } : {}),
    ...(notWriter ? { fix_type: 'skipped-non-writer', fix_type_reason: notWriter } : {}),
  };
  const code = findings.length > 0 ? EXIT_FINDINGS : EXIT_CLEAN;
  if (flags.json) {
    // FR-019: every rewritten path is printed — on stderr when stdout is JSON.
    report.fixed.forEach((p) => process.stderr.write(`fixed\t${p}\n`));
    emitJson(report, code);
  } else {
    writeStdoutSync(humanReport(report, dryRun));
  }
  process.exit(code);
}

module.exports = { cmdVaultLint, lintContent, foldedKeys, withTypeStamped, CLASSES };
