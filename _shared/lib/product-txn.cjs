'use strict';

// Write-path helpers shared by every product writer: slug guard, product
// dir resolution, changelog append/rotation and the ROADMAP write set.

const fs = require('fs');
const path = require('path');
const { serializeNestedFrontmatter, fail, nowIso } = require('./io.cjs');
const { failWithLock } = require('./locks.cjs');
const { PRODUCT_ROADMAP_KEY_ORDER, PRODUCT_FEATURE_KEY_ORDER, PRODUCT_SLUG_RE, FEATURE_ID_RE } = require('./product-schema.cjs');
const { regenerateDerived, readProductFeature } = require('./product-derived.cjs');

const CHANGELOG_ROTATION_LIMIT = 100;

/** Append a changelog line to ROADMAP.md body's `## Changelog` section
 * in-memory (pure — caller is responsible for persisting via the same
 * atomic write set as every other product mutation). Returns
 * { body, archiveAppend } where archiveAppend is a string to append to
 * CHANGELOG-archive.md (or null if no rotation happened this call). */
function appendChangelogEntry(body, what, why) {
  const today = nowIso().slice(0, 10);
  const line = `- **${today}** — ${what} — ${why}`;

  const headingRe = /^## Changelog[ \t]*$/m; // [ \t]*, not \s*: the match must end on the heading line
  const match = headingRe.exec(body);
  if (!match) {
    // No Changelog section yet — append one at the end of the body.
    const sep = body.endsWith('\n') ? '' : '\n';
    return { body: `${body}${sep}\n## Changelog\n\n${line}\n`, archiveAppend: null, stray: null };
  }

  const startIdx = match.index + match[0].length;
  // Find the next "## " heading after Changelog to bound the section.
  const rest = body.slice(startIdx);
  const nextHeadingMatch = /^## /m.exec(rest);
  const sectionEnd = nextHeadingMatch ? startIdx + nextHeadingMatch.index : body.length;

  const before = body.slice(0, startIdx);
  const section = body.slice(startIdx, sectionEnd);
  const after = body.slice(sectionEnd);

  const ENTRY_RE = /^- \*\*\d{4}-\d{2}-\d{2}\*\* —/;
  const sectionLines = section.split('\n');
  const entryLines = sectionLines.filter((l) => ENTRY_RE.test(l));
  // The rebuild keeps the intro and the entries only: a written line after the first entry would be lost (follow-up F-009).
  const firstEntry = sectionLines.findIndex((l) => ENTRY_RE.test(l));
  const stray = firstEntry === -1 ? null : sectionLines.slice(firstEntry).find((l) => l.trim() !== '' && !ENTRY_RE.test(l)) || null;
  if (stray !== null) return { body, archiveAppend: null, stray };
  const nonEntryPrefix = section.slice(0, section.indexOf(entryLines[0] || '') === -1 ? section.length : section.indexOf(entryLines[0]));

  const updatedEntries = [...entryLines, line];

  let archiveAppend = null;
  let keptEntries = updatedEntries;
  if (updatedEntries.length > CHANGELOG_ROTATION_LIMIT) {
    const overflowCount = updatedEntries.length - CHANGELOG_ROTATION_LIMIT;
    const overflow = updatedEntries.slice(0, overflowCount);
    keptEntries = updatedEntries.slice(overflowCount);
    archiveAppend = overflow.join('\n') + '\n';
  }

  // Exactly one blank line under the heading (extra blank lines heal), then any intro text, then the entries.
  const intro = nonEntryPrefix.replace(/^(?:[ \t]*\n)+/, '').trimEnd(); // leading blank lines go, indentation stays
  const newSection = `\n\n${intro ? `${intro}\n\n` : ''}${keptEntries.join('\n')}\n\n`;
  const newBody = `${before}${newSection}${after}`;

  return { body: newBody, archiveAppend, stray: null };
}


/** Reject any value that isn't a bare kebab-case slug (or, for kind
 * 'feature-id', a `###-kebab-slug`) BEFORE it is used to build a filesystem
 * path. Throws via fail()/failWithLock() semantics — callers pass an
 * optional lockPath so an already-acquired lock is released on rejection.
 * Must be called at every product-command entry point that joins a
 * user-supplied id/milestone/project into a path, prior to the path.join()
 * and prior to acquireReservationsLock() wherever possible. */
function assertSlug(value, kind, lockPath) {
  const re = kind === 'feature-id' ? FEATURE_ID_RE : PRODUCT_SLUG_RE;
  const label = kind === 'feature-id' ? 'a ###-kebab-slug (e.g. 001-my-feature)' : 'a kebab-case slug (e.g. my-slug)';
  const ok = typeof value === 'string' && re.test(value);
  if (!ok) {
    const msg = `invalid ${kind}: ${JSON.stringify(value)} — must be ${label}, no path separators, dots, or traversal sequences`;
    if (lockPath) failWithLock(lockPath, msg);
    else fail(msg);
  }
}

function productDirFromFlags(flags) {
  return flags.dir ? path.resolve(flags.dir) : path.join(process.cwd(), 'docs', 'product');
}

// writeAllOrNothing lives in lib/locks.cjs

/** The derived part of every product write set: index.json, NEXT.md, the
 * module files and the stale-module delete/rmdir entries (spec 023). Every
 * caller of regenerateDerived goes through here so module files share the
 * all-or-nothing transaction. A module error (module in use and `modules/` or a module dir
 * symlinked / unreadable / case-colliding, bad module id) aborts the command: `lockPath` — the lock the
 * CALLER holds — is released, nothing is written. Foreign entries under
 * `modules/` are left alone and reported as one stderr line each. */
function derivedWrites(dir, derived, lockPath) {
  if (derived.moduleError) {
    failWithLock(lockPath, `product: ${derived.moduleError}`);
  }
  for (const w of derived.moduleWarnings || []) process.stderr.write(`[a1-tools] warning: ${w}\n`);
  return [
    { target: path.join(dir, 'index.json'), content: JSON.stringify(derived.indexJson, null, 2) + '\n', within: dir },
    { target: path.join(dir, 'NEXT.md'), content: derived.nextMd, within: dir },
    ...derived.moduleFiles.map((f) => ({ target: path.join(dir, f.rel), content: f.content, within: dir })),
    ...derived.moduleDeletes.map((d) => ({ ...d, within: dir })),
  ];
}

/** Build the writes[] entries for ROADMAP.md (with an appended changelog
 * line) + regenerated index.json/NEXT.md, given the ALREADY-updated
 * roadmap frontmatter + body (`lockPath` = the lock the caller holds). Handles the >100-entry archive rotation
 * (FR-010) by adding a 4th write when rotation occurs. Returns
 * { writes, roadmapContent } for the caller to push onto its own writes[]
 * (e.g. feature.md, reservations.json) before calling writeAllOrNothing. */
function buildRoadmapWritesWithChangelog(dir, updatedRoadmapFm, roadmapBody, what, why, lockPath) {
  const { body: bodyWithEntry, archiveAppend, stray } = appendChangelogEntry(roadmapBody, what, why);
  if (stray !== null) {
    const msg = `product: ROADMAP.md "## Changelog" has a line that is not an entry after the first entry (${JSON.stringify(stray.slice(0, 120))}); ` +
      'the rewrite would drop it. Move it above the first entry or remove it, then run the command again.';
    if (lockPath) failWithLock(lockPath, msg);
    else fail(msg);
  }
  const derived = regenerateDerived(dir, updatedRoadmapFm);

  const roadmapFmStr = serializeNestedFrontmatter(updatedRoadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
  const roadmapContent = `---\n${roadmapFmStr}\n---\n${bodyWithEntry.startsWith('\n') ? '' : '\n'}${bodyWithEntry}`;

  const writes = [
    { target: path.join(dir, 'ROADMAP.md'), content: roadmapContent },
    ...derivedWrites(dir, derived, lockPath),
  ];
  if (archiveAppend !== null) {
    const archiveFile = path.join(dir, 'CHANGELOG-archive.md');
    let archiveExisting = '';
    if (fs.existsSync(archiveFile)) {
      archiveExisting = fs.readFileSync(archiveFile, 'utf8');
    } else {
      archiveExisting = '# Changelog Archive\n\nRotated entries beyond the 100-entry ROADMAP.md ' +
        'Changelog window (append-only, oldest first).\n\n';
    }
    const sep = archiveExisting.endsWith('\n') ? '' : '\n';
    writes.push({ target: archiveFile, content: `${archiveExisting}${sep}${archiveAppend}` });
  }
  return { writes, roadmapContent };
}

/** Write entry for features/<id>/feature.md with `patch` merged over its frontmatter,
 * or null when the file does not exist (cancel/edit never create one). Pure. */
function featureMdWrite(dir, id, patch) {
  const featureMd = readProductFeature(dir, id);
  if (!featureMd) return null;
  const fmStr = serializeNestedFrontmatter({ ...featureMd.fm, ...patch }, PRODUCT_FEATURE_KEY_ORDER);
  const content = `---\n${fmStr}\n---\n${featureMd.body.startsWith('\n') ? '' : '\n'}${featureMd.body}`;
  return { target: featureMd.file, content };
}

/** The ROADMAP.md frontmatter + body of a product dir, or null. */
function parseRoadmapFile(dir) {
  const file = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(file)) return null;
  return { file, ...require('./io.cjs').parseNestedFrontmatter(fs.readFileSync(file, 'utf8')) };
}

module.exports = {
  featureMdWrite,
  parseRoadmapFile,
  assertSlug,
  derivedWrites,
  productDirFromFlags,
  buildRoadmapWritesWithChangelog,
};
