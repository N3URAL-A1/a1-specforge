'use strict';

// product audit-publish | audit-set (docs/product/audits/, schema v1.1).

const fs = require('fs');
const path = require('path');
const io = require('./io.cjs');
const { parseNestedFrontmatter, serializeNestedFrontmatter, parseFlags, fail, nowIso } = require('./io.cjs');
const { acquireReservationsLock, exitWithLock, failWithLock, writeAllOrNothing } = require('./locks.cjs');
const { usage } = require('./help.cjs');
const { productMirrorHook } = require('./vault-product-hook.cjs');
const { roadmapFeatureIdSet, regenerateDerived } = require('./product-derived.cjs');
const { productDirFromFlags } = require('./product-txn.cjs');

const PRODUCT_AUDIT_KEY_ORDER = [
  'schema_version', 'type', 'project', 'focus', 'date', 'source', 'verdict',
  'counts', 'findings', 'last_validated',
];

/** Serialize an inline YAML flow-mapping `{ blocker: N, major: N, minor: N }`
 * (the twin of parseInlineFlowObject in product-schema.cjs).
 * Pure. Always emits all three keys as bare (unquoted) integers, matching
 * the exact shape docs/product/SCHEMA.md section 7 and every hand-authored
 * audit fixture use. */
function serializeCountsInline(counts) {
  return `{ blocker: ${counts.blocker}, major: ${counts.major}, minor: ${counts.minor} }`;
}

/** Build the full audits/<date>-<focus>.md text (frontmatter + body) from an
 * already-shaped audit frontmatter object. Pure — no I/O. `serializeNested
 * Frontmatter` has no inline-flow-mapping support (see serializeScalar), so
 * `counts` is serialized separately here and spliced into the `counts:` line
 * via a targeted textual replace of the placeholder line the generic
 * serializer emits — the same "serialize generically, then fix up the one
 * field the shared serializer can't express" approach Wave 3's vision-touch
 * fix established for targeted single-field edits. */
function serializeAuditContent(auditFm, body) {
  const fmStr = serializeNestedFrontmatter(auditFm, PRODUCT_AUDIT_KEY_ORDER);
  const countsLineRe = /^counts:.*$/m;
  const fixedFmStr = fmStr.replace(countsLineRe, `counts: ${serializeCountsInline(auditFm.counts)}`);
  return `---\n${fixedFmStr}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}

/** Parse one a1-analyze finding string of the shape
 * `id=F-001; severity=MAJOR; category=...; location=...; description=...;
 * recommendation=...` (the flat `key=value; key=value` frontmatter-list-item
 * format `lib/io.cjs`'s `parseFrontmatter`/ANALYSIS_KEY_ORDER produces for
 * analysis `findings[]` — see .a1/learnings/projects/&lt;name&gt;/analyses/ .
 * Pure. Returns { id, severity, category } (the three fields the v1.1 audit
 * finding shape needs from the source) or null if `id`/`severity` are
 * missing — a finding lacking those two is not usable as an audit entry.
 * Deliberately tolerant of ';' appearing inside a value (e.g. inside
 * `description`): splits on '; ' then re-joins any trailing fragment whose
 * key doesn't look like a known field back onto the previous field's value,
 * mirroring parsePillarFlag's "cap the split, keep the remainder" approach
 * for a value that itself may contain the separator character. */
function parseAnalysisFindingString(raw) {
  if (typeof raw !== 'string') return null;
  const fields = {};
  let currentKey = null;
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const m = /^([a-z_]+)=([\s\S]*)$/.exec(trimmed);
    if (m && ['id', 'severity', 'category', 'location', 'description', 'recommendation'].includes(m[1])) {
      currentKey = m[1];
      fields[currentKey] = m[2];
    } else if (currentKey) {
      // Continuation of the previous field's value (it contained a ';').
      fields[currentKey] = `${fields[currentKey]};${part}`;
    }
  }
  if (!fields.id || !fields.severity) return null;
  return {
    id: fields.id.trim(),
    severity: fields.severity.trim(),
    category: (fields.category || 'uncategorized').trim(),
  };
}

/** Read an a1-analyze result file's frontmatter (`lib/io.cjs`'s
 * `parseFrontmatter` — the flat/simple parser, NOT `parseNestedFrontmatter`:
 * analysis `findings[]` is a flat list of quoted `key=value; ...` strings,
 * not the nested-object-list shape ROADMAP.md/VISION.md/audits use — see
 * ANALYSIS_KEY_ORDER in lib/io.cjs) and derive everything `audit-publish`
 * needs: `{ project, focus, date, source, verdict, findings }`. Pure — no
 * writes. Throws (via fail()) on a structurally unusable analysis file
 * (missing focus/date, or a findings[] that isn't an array) — the caller is
 * responsible for translating that into the locked failWithLock() path once
 * a lock is held. */
function readAnalysisForPublish(analysisPath) {
  if (!fs.existsSync(analysisPath)) {
    fail(`product audit-publish: --analysis file not found: ${analysisPath}`);
  }
  const content = fs.readFileSync(analysisPath, 'utf8');
  const { fm } = io.parseFrontmatter(content);

  if (typeof fm.focus !== 'string' || fm.focus.length === 0) {
    fail(`product audit-publish: ${analysisPath} has no usable 'focus' in frontmatter`);
  }
  const dateRaw = typeof fm.created_at === 'string' ? fm.created_at.slice(0, 10) : null;
  if (!dateRaw || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateRaw)) {
    fail(`product audit-publish: ${analysisPath} has no usable 'created_at' date in frontmatter`);
  }

  const rawFindings = Array.isArray(fm.findings) ? fm.findings : [];
  const findings = rawFindings
    .map((raw) => parseAnalysisFindingString(raw))
    .filter((f) => f !== null);

  return {
    project: typeof fm.project === 'string' ? fm.project : null,
    focus: fm.focus,
    date: dateRaw,
    source: analysisPath,
    verdict: typeof fm.title === 'string' && fm.title.length > 0 ? fm.title : `${fm.focus} analysis`,
    findings,
  };
}

/** product audit-publish --analysis <path> [--project <slug>] [--dir]:
 * parse an a1-analyze result's frontmatter findings and create exactly one
 * new docs/product/audits/<date>-<focus>.md (FR-007), every finding
 * initialized to status: open / fixed_commit: null / feature: null.
 * Refuses (non-zero exit, no write) if a file for the same date+focus
 * already exists (FR-008) — audits are append-only history, one file per
 * analyze-run, never a rolling per-focus file that gets overwritten.
 * Zero-findings analyses still produce a valid, empty-findings[] audit file
 * (explicit spec edge case) rather than erroring. Regenerates index.json
 * (audits[] gains a matching entry) under the same lock + tmp/rename
 * transaction as every other product writer (FR-019). --project overrides
 * the analysis frontmatter's own `project` field (useful when publishing an
 * externally-authored analysis, e.g. the niimo reference fixture, into a
 * DIFFERENT project's docs/product/ — Wave 5 reuses this). */
function cmdProductAuditPublish(args) {
  const flags = parseFlags(args, { analysis: 'value', project: 'value', dir: 'value' });
  if (!flags.analysis) {
    usage('product audit-publish requires --analysis <path>');
  }
  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product audit-publish: ${roadmapFile} not found (run \`product init\` first)`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm } = parseNestedFrontmatter(roadmapContent);

  let parsed;
  try {
    parsed = readAnalysisForPublish(path.resolve(flags.analysis));
  } catch (e) {
    failWithLock(lockPath, e.message);
  }

  const project = flags.project || parsed.project || roadmapFm.project;
  if (!project) {
    failWithLock(lockPath, 'product audit-publish: could not determine --project (not in analysis frontmatter, no --project flag, no ROADMAP.md project)');
  }

  const auditsDir = path.join(dir, 'audits');
  const fileName = `${parsed.date}-${parsed.focus}.md`;
  const auditFile = path.join(auditsDir, fileName);

  // Duplicate-date+focus refusal (FR-008) — checked INSIDE the locked
  // section (TOCTOU-safe, same pattern as every other product writer's
  // overwrite guard) so two concurrent publishes of the same analysis can
  // never both pass the check before either holds the lock.
  if (fs.existsSync(auditFile)) {
    failWithLock(
      lockPath,
      `product audit-publish: ${auditFile} already exists — refusing to overwrite (audits are append-only ` +
        'history; publish a differently-dated or differently-focused analysis, or use `product audit-set` ' +
        'to update an existing finding)'
    );
  }

  const counts = { blocker: 0, major: 0, minor: 0 };
  const findings = parsed.findings.map((f) => {
    const severityKey = f.severity === 'BLOCKER' ? 'blocker' : f.severity === 'MAJOR' ? 'major' : f.severity === 'MINOR' ? 'minor' : null;
    if (severityKey) counts[severityKey] += 1;
    return {
      id: f.id,
      severity: f.severity,
      category: f.category,
      status: 'open',
      fixed_commit: null,
      feature: null,
    };
  });

  const today = nowIso().slice(0, 10);
  const auditFm = {
    schema_version: 1,
    type: 'audit',
    project,
    focus: parsed.focus,
    date: parsed.date,
    source: parsed.source,
    verdict: parsed.verdict,
    counts,
    findings,
    last_validated: today,
  };
  const auditBody = `\n# Audit — ${parsed.focus} (${parsed.date})\n\n> Published from \`${parsed.source}\` via ` +
    '`product audit-publish`.\n\n## Changelog\n\n' +
    `- **${today}** — audit published — ${findings.length} finding(s) imported from a1-analyze result\n`;
  const auditContent = serializeAuditContent(auditFm, auditBody);

  // auditFmOverride: the new audit file hasn't landed on disk yet (write
  // happens below, via writeAllOrNothing) — pass the in-memory frontmatter
  // so THIS SAME index.json regeneration already reflects it (FR-007's own
  // "index.json's audits[] gains a matching entry" AC), not one call behind.
  const { indexJson, nextMd } = regenerateDerived(dir, roadmapFm, undefined, { name: fileName, fm: auditFm });
  const writes = [
    { target: auditFile, content: auditContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product audit-publish', productMirrorHook(dir));

  const out = {
    status: 'OK',
    audit_file: auditFile,
    focus: parsed.focus,
    date: parsed.date,
    findings_count: findings.length,
    files_written: writes.map((w) => w.target),
    vault_mirror: vaultMirror,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

const AUDIT_SET_STATUS_VALUES = ['open', 'fixed', 'obsolete', 'accepted'];

/** product audit-set --audit <path> --finding F-0NN --status <status>
 * [--commit <sha>] [--feature <id>] [--dir]: mutate EXACTLY the named
 * finding's status/fixed_commit/feature fields, leaving every other finding
 * (and every other frontmatter field, and the prose body) byte-unchanged
 * (FR-009). Appends a one-line changelog entry to the audit body. Fails
 * (non-zero exit, no write) if --finding doesn't match any finding id in the
 * target file (FR-010), if --status is out of the FR-006 enum, or if
 * --feature names an id absent from ROADMAP.md (FR-011, hard validation —
 * reuses roadmapFeatureIdSet(), the same helper `product validate`'s FR-018
 * cross-check uses). A transition FROM 'fixed' back TO 'open' (regression
 * re-open) is explicitly a LEGAL transition — no forward-only guard here,
 * unlike `product stage`'s CODE_SCOPE_STAGES ordering. Regenerates
 * index.json (derived open/fixed counts) under the same lock + tmp/rename
 * transaction as every other product writer (FR-019).
 *
 * Uses a targeted textual replace of ONLY the one finding's 3 fields within
 * the frontmatter block (bounded to the file's `findings:` block, working
 * line-by-line inside the matched finding's `  - id: ...` … next `  - id:`
 * span), NOT a full re-serialize via serializeNestedFrontmatter — the exact
 * same reason Wave 3's vision-touch fix gives: the shared serializer
 * re-quotes every unchanged string value (a category with a comma/colon, a
 * source path with a slash already unquoted by hand, …), which would violate
 * this FR's "other findings are byte-unchanged" contract for any
 * hand-authored or audit-publish-written file that doesn't happen to already
 * match the serializer's exact quoting conventions. */
function cmdProductAuditSet(args) {
  const flags = parseFlags(args, { audit: 'value', finding: 'value', status: 'value', commit: 'value', feature: 'value', dir: 'value' });
  if (!flags.audit || !flags.finding || !flags.status) {
    usage('product audit-set requires --audit <path> --finding F-0NN --status <open|fixed|obsolete|accepted> [--commit <sha>] [--feature <id>]');
  }
  if (!AUDIT_SET_STATUS_VALUES.includes(flags.status)) {
    usage(`product audit-set --status must be one of: ${AUDIT_SET_STATUS_VALUES.join('|')} (got: ${flags.status})`);
  }

  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const auditFile = path.resolve(flags.audit);
  if (!fs.existsSync(auditFile)) {
    failWithLock(lockPath, `product audit-set: ${auditFile} not found`);
  }

  if (flags.feature) {
    const roadmapFile = path.join(dir, 'ROADMAP.md');
    if (!fs.existsSync(roadmapFile)) {
      failWithLock(lockPath, `product audit-set: ${roadmapFile} not found (cannot validate --feature ${flags.feature})`);
    }
    const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
    const { fm: roadmapFm } = parseNestedFrontmatter(roadmapContent);
    const knownFeatureIds = roadmapFeatureIdSet(roadmapFm);
    if (!knownFeatureIds.has(flags.feature)) {
      failWithLock(
        lockPath,
        `product audit-set: --feature '${flags.feature}' does not exist in ${roadmapFile} — ` +
          'no dangling findings[].feature references are allowed (FR-011; add the feature first via `product add-feature`)'
      );
    }
  }

  const auditContentBefore = fs.readFileSync(auditFile, 'utf8');
  const { fm: auditFm } = parseNestedFrontmatter(auditContentBefore);
  const findings = Array.isArray(auditFm.findings) ? auditFm.findings : [];
  const findingIdx = findings.findIndex((f) => f.id === flags.finding);
  if (findingIdx === -1) {
    failWithLock(
      lockPath,
      `product audit-set: finding '${flags.finding}' not found in ${auditFile} ` +
        `(known ids: ${findings.map((f) => f.id).join(', ') || '(none)'})`
    );
  }

  // Targeted textual replace: locate the matched finding's block within the
  // FRONTMATTER ONLY (bounded to the text between the first two '---'
  // markers, same bounding discipline as vision-touch), so a coincidental
  // "- id: F-0NN" string inside the prose body is never touched.
  if (!auditContentBefore.startsWith('---\n')) {
    failWithLock(lockPath, `product audit-set: ${auditFile} does not start with a '---' frontmatter block`);
  }
  const fmEnd = auditContentBefore.indexOf('\n---', 4);
  if (fmEnd === -1) {
    failWithLock(lockPath, `product audit-set: ${auditFile} frontmatter has no closing '---'`);
  }
  const fmBlockBefore = auditContentBefore.slice(0, fmEnd);
  const restAfterFm = auditContentBefore.slice(fmEnd);
  const fmLines = fmBlockBefore.split('\n');

  const findingStartRe = new RegExp(`^  - id:\\s*${flags.finding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const startIdx = fmLines.findIndex((l) => findingStartRe.test(l));
  if (startIdx === -1) {
    failWithLock(lockPath, `product audit-set: could not locate finding '${flags.finding}' block in ${auditFile} frontmatter for a targeted replace`);
  }
  let endIdx = fmLines.length;
  for (let i = startIdx + 1; i < fmLines.length; i++) {
    if (/^  - id:/.test(fmLines[i]) || /^[A-Za-z_][A-Za-z0-9_]*:/.test(fmLines[i])) {
      endIdx = i;
      break;
    }
  }
  const blockLines = fmLines.slice(startIdx, endIdx);

  const commitValue = flags.commit || null;
  const featureValue = flags.feature || null;
  // `fixed_commit` is a commit sha and MUST always round-trip as a STRING
  // (validateAuditFm/FR-005 requires typeof === 'string'), but a git sha can
  // be entirely decimal digits (e.g. an abbreviated sha like '4730838' — hex
  // digits 0-9 are valid, unabbreviated shas are even more likely to look
  // "numeric" over 7-8 hex chars). io.serializeScalar()'s generic
  // alphanumeric-bare-word rule (shared with every other field) would emit
  // such a value UNQUOTED, and the YAML-subset parser then reads it back as
  // a JS `number`, silently violating the schema on the very next
  // `product validate` — force-quote `fixed_commit` specifically so this
  // field's serialization is schema-safe regardless of the sha's shape.
  const replaceField = (lines, field, value) => {
    const re = new RegExp(`^(    ${field}:).*$`);
    const serialized = value === null
      ? 'null'
      : field === 'fixed_commit'
        ? JSON.stringify(value)
        : io.serializeScalar(value);
    let replaced = false;
    const out = lines.map((l) => {
      if (re.test(l)) { replaced = true; return `    ${field}: ${serialized}`; }
      return l;
    });
    if (!replaced) {
      out.push(`    ${field}: ${serialized}`);
    }
    return out;
  };
  let updatedBlockLines = replaceField(blockLines, 'status', flags.status);
  // Only touch fixed_commit/feature when the caller actually supplied them —
  // an audit-set call that only changes --status (e.g. the fixed -> open
  // regression re-open case) must not clobber a previously-recorded
  // fixed_commit/feature with null.
  if (flags.commit !== undefined) {
    updatedBlockLines = replaceField(updatedBlockLines, 'fixed_commit', commitValue);
  }
  if (flags.feature !== undefined) {
    updatedBlockLines = replaceField(updatedBlockLines, 'feature', featureValue);
  }

  const updatedFmLines = [
    ...fmLines.slice(0, startIdx),
    ...updatedBlockLines,
    ...fmLines.slice(endIdx),
  ];
  const fmBlockAfter = updatedFmLines.join('\n');

  const today = nowIso().slice(0, 10);
  const changelogLine = `- **${today}** — ${flags.finding} ${flags.status}` +
    (commitValue ? ` — commit ${commitValue}` : '') +
    (featureValue ? ` — feature ${featureValue}` : '') + '\n';

  // Append the changelog line to the body's "## Changelog" section (create
  // one if absent) — same section-bounding approach appendChangelogEntry()
  // uses for ROADMAP.md, but audit files don't share ROADMAP.md's >100-entry
  // rotation contract (audit history is already bounded by one changelog
  // per audit-set call on a naturally small per-file findings[] set), so
  // this is a simple append rather than a reuse of appendChangelogEntry().
  // `restAfterFm` (from the frontmatter-bounding scan above) starts with the
  // closing '\n---' marker line itself — strip exactly that (and the single
  // blank line the source always has right after it, same convention
  // parseNestedFrontmatter's own `body` extraction uses) to get the pure
  // prose body, so re-composing `---\n${fmBlockAfter}\n---\n${bodyAfter}`
  // below produces exactly ONE frontmatter block, not a duplicated one.
  const bodyBefore = restAfterFm.replace(/^\n---\n?/, '');
  const changelogHeadingRe = /^## Changelog\s*$/m;
  let bodyAfter;
  if (changelogHeadingRe.test(bodyBefore)) {
    const match = changelogHeadingRe.exec(bodyBefore);
    const insertAt = match.index + match[0].length;
    bodyAfter = `${bodyBefore.slice(0, insertAt)}\n\n${changelogLine}${bodyBefore.slice(insertAt).replace(/^\n\n/, '')}`;
  } else {
    const sep = bodyBefore.endsWith('\n') ? '' : '\n';
    bodyAfter = `${bodyBefore}${sep}\n## Changelog\n\n${changelogLine}`;
  }
  // fmBlockAfter already carries the opening '---' as its own first line
  // (fmLines[0], since fmBlockBefore = content.slice(0, fmEnd) starts at
  // offset 0) — do NOT prepend another '---\n' here, or the file ends up
  // with a duplicated marker ('---\n---\n...').
  const auditContentAfter = `${fmBlockAfter}\n---\n${bodyAfter}`;

  // In-memory mirror of the ONE finding's mutation (immutable update — new
  // array, new finding object), used ONLY as regenerateDerived's
  // auditFmOverride below so index.json's derived open/fixed split reflects
  // THIS call's change immediately (the on-disk file is still in its PRIOR
  // state until writeAllOrNothing's tmp/rename phase runs) — the textual
  // auditContentAfter string above remains the actual bytes written to disk.
  const updatedFinding = {
    ...findings[findingIdx],
    status: flags.status,
    fixed_commit: flags.commit !== undefined ? commitValue : findings[findingIdx].fixed_commit,
    feature: flags.feature !== undefined ? featureValue : findings[findingIdx].feature,
  };
  const updatedAuditFm = {
    ...auditFm,
    findings: findings.map((f, idx) => (idx === findingIdx ? updatedFinding : f)),
  };

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm } = parseNestedFrontmatter(roadmapContent);
  const { indexJson, nextMd } = regenerateDerived(
    dir,
    roadmapFm,
    undefined,
    { name: path.basename(auditFile), fm: updatedAuditFm }
  );

  const writes = [
    { target: auditFile, content: auditContentAfter },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  const vaultMirror = writeAllOrNothing(lockPath, writes, 'product audit-set', productMirrorHook(dir));

  const out = {
    status: 'OK',
    audit_file: auditFile,
    finding: flags.finding,
    new_status: flags.status,
    commit: commitValue,
    feature: featureValue,
    files_written: writes.map((w) => w.target),
    vault_mirror: vaultMirror,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

module.exports = {
  cmdProductAuditPublish,
  cmdProductAuditSet,
};
