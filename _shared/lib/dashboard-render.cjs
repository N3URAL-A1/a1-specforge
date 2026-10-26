'use strict';

// dashboard-render — pure render(sections, meta) -> string (spec 021). Headings and `- ` bullets only
// (FR-021); per-section and total line caps with `and N more` (FR-013).
//   meta: { slug, generated (ISO string), sourceHead (short hash or null) }

const GENERATED_BY = 'a1-tools dashboard';
const BANNER = '> Generated, do not edit; overwritten on every build.';
/** Total line budget of the note, frontmatter included (FR-013). Held by SECTION_MAX: 7 sections of at most
 *  40 body lines + heading + blank, plus the head, stay far below it (the suite asserts the cap on 103 specs). */
const MAX_LINES = 400;
/** Line budget of one section body, including its `and N more` line. */
const SECTION_MAX = 40;

function frontmatter(meta) {
  const lines = ['---', 'type: dashboard', `project: "[[project/${meta.slug}]]"`, `generated_by: ${GENERATED_BY}`, `generated: ${meta.generated}`];
  if (meta.sourceHead) lines.push(`source_head: ${meta.sourceHead}`);
  lines.push('---');
  return lines;
}

const MARKER_TOKEN = '[REDACTED]';

/** Link and template syntax of a source value made inert: `[`/`]` -> `(`/`)`, backtick -> `'`, `<%` -> `&lt;%`. */
const inert = (t) => t.replace(/\[/g, '(').replace(/\]/g, ')').replace(/`/g, "'").replace(/<%/g, '&lt;%');

/**
 * One source value as one safe line: no table pipe, no HTML tag start, no image embed, no wikilink or link
 * bracket, no code span, no template tag, no line break. The `[REDACTED]` marker of cleanText() is kept.
 */
function safe(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/!(?=\[)/g, '')
    .split(MARKER_TOKEN).map(inert).join(MARKER_TOKEN)
    .replace(/\|/g, '\\|')
    .replace(/<(?=[A-Za-z/!?])/g, '&lt;')
    .trim();
}

function bodyOf(section) {
  if (section.state === 'ok') return section.items.map(safe).filter((i) => i !== '');
  return [];
}

/** At most `limit` lines: the newest entries first, then `and N more` (N = exactly the hidden count). */
function capped(items, limit) {
  if (items.length <= limit) return items;
  const keep = Math.max(limit - 1, 0);
  return [...items.slice(0, keep), `and ${items.length - keep} more`];
}

function stateLines(section) {
  if (section.state === 'none') return ['none'];
  if (section.state !== 'ok') return [`not available (${safe(section.reason || 'unknown')})`];
  const items = bodyOf(section);
  return items.length > 0 ? items : ['none'];
}

function render(sections, meta) {
  const head = [...frontmatter(meta), '', BANNER, ''];
  const lists = sections.map((s) => stateLines(s));
  const lines = [...head];
  sections.forEach((s, i) => {
    const shown = capped(lists[i], SECTION_MAX);
    lines.push(`## ${safe(s.name)}`, ...shown.map((l) => `- ${l}`), '');
  });
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

module.exports = { render, GENERATED_BY, BANNER, MAX_LINES, SECTION_MAX };
