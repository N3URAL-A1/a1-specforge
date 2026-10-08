'use strict';

// Write-path helpers shared by every product writer: slug guard, product
// dir resolution, changelog append/rotation and the ROADMAP write set.

const fs = require('fs');
const path = require('path');
const { serializeNestedFrontmatter, fail, nowIso } = require('./io.cjs');
const { failWithLock } = require('./locks.cjs');
const { PRODUCT_ROADMAP_KEY_ORDER, PRODUCT_SLUG_RE, FEATURE_ID_RE } = require('./product-schema.cjs');
const { regenerateDerived } = require('./product-derived.cjs');

const CHANGELOG_ROTATION_LIMIT = 100;

/** Append a changelog line to ROADMAP.md body's `## Changelog` section
 * in-memory (pure — caller is responsible for persisting via the same
 * atomic write set as every other product mutation). Returns
 * { body, archiveAppend } where archiveAppend is a string to append to
 * CHANGELOG-archive.md (or null if no rotation happened this call). */
function appendChangelogEntry(body, what, why) {
  const today = nowIso().slice(0, 10);
  const line = `- **${today}** — ${what} — ${why}`;

  const headingRe = /^## Changelog\s*$/m;
  const match = headingRe.exec(body);
  if (!match) {
    // No Changelog section yet — append one at the end of the body.
    const sep = body.endsWith('\n') ? '' : '\n';
    return { body: `${body}${sep}\n## Changelog\n\n${line}\n`, archiveAppend: null };
  }

  const startIdx = match.index + match[0].length;
  // Find the next "## " heading after Changelog to bound the section.
  const rest = body.slice(startIdx);
  const nextHeadingMatch = /^## /m.exec(rest);
  const sectionEnd = nextHeadingMatch ? startIdx + nextHeadingMatch.index : body.length;

  const before = body.slice(0, startIdx);
  const section = body.slice(startIdx, sectionEnd);
  const after = body.slice(sectionEnd);

  const entryLines = section.split('\n').filter((l) => /^- \*\*\d{4}-\d{2}-\d{2}\*\* —/.test(l));
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

  const newSection = `${nonEntryPrefix.trimEnd() ? nonEntryPrefix.trimEnd() + '\n\n' : '\n'}${keptEntries.join('\n')}\n\n`;
  const newBody = `${before}${newSection}${after}`;

  return { body: newBody, archiveAppend };
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

/** Build the writes[] entries for ROADMAP.md (with an appended changelog
 * line) + regenerated index.json/NEXT.md, given the ALREADY-updated
 * roadmap frontmatter + body. Handles the >100-entry archive rotation
 * (FR-010) by adding a 4th write when rotation occurs. Returns
 * { writes, roadmapContent } for the caller to push onto its own writes[]
 * (e.g. feature.md, reservations.json) before calling writeAllOrNothing. */
function buildRoadmapWritesWithChangelog(dir, updatedRoadmapFm, roadmapBody, what, why) {
  const { body: bodyWithEntry, archiveAppend } = appendChangelogEntry(roadmapBody, what, why);
  const { indexJson, nextMd } = regenerateDerived(dir, updatedRoadmapFm);

  const roadmapFmStr = serializeNestedFrontmatter(updatedRoadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
  const roadmapContent = `---\n${roadmapFmStr}\n---\n${bodyWithEntry.startsWith('\n') ? '' : '\n'}${bodyWithEntry}`;

  const writes = [
    { target: path.join(dir, 'ROADMAP.md'), content: roadmapContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
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

module.exports = {
  assertSlug,
  productDirFromFlags,
  buildRoadmapWritesWithChangelog,
};
