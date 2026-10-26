'use strict';

// dashboard-render — pure render(sections, meta) -> string (spec 021). Headings and `- ` bullets only
// (FR-021); per-section and total line caps with `and N more` (FR-013).
//   meta: { slug, generated (ISO string), sourceHead (short hash or null) }

const GENERATED_BY = 'a1-tools dashboard';
const BANNER = '> Generated, do not edit; overwritten on every build.';
/** Total line budget of the note, frontmatter included (FR-013). */
const MAX_LINES = 400;
/** Line budget of one section body, including its `and N more` line. */
const SECTION_MAX = 40;

function frontmatter(meta) {
  const lines = ['---', 'type: dashboard', `project: "[[project/${meta.slug}]]"`, `generated_by: ${GENERATED_BY}`, `generated: ${meta.generated}`];
  if (meta.sourceHead) lines.push(`source_head: ${meta.sourceHead}`);
  lines.push('---');
  return lines;
}

/** One source value as one safe line: no table pipe, no HTML tag start, no image embed, no line break. */
function safe(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/<(?=[A-Za-z/!?])/g, '&lt;')
    .replace(/!(?=\[)/g, '')
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

/** Split the remaining budget over the sections (equal shares, unused share is handed on). */
function shares(lists, budget) {
  const limits = lists.map(() => 0);
  let left = budget;
  let open = lists.map((_l, i) => i).sort((a, b) => lists[a].length - lists[b].length);
  while (open.length > 0) {
    const fair = Math.floor(left / open.length);
    const i = open.shift();
    limits[i] = Math.min(lists[i].length, SECTION_MAX, Math.max(fair, 1));
    left -= limits[i];
  }
  return limits;
}

function render(sections, meta) {
  const head = [...frontmatter(meta), '', BANNER, ''];
  const lists = sections.map((s) => stateLines(s));
  const trailer = sections.length * 2; // heading + blank per section
  const limits = shares(lists, Math.max(MAX_LINES - head.length - trailer, sections.length));
  const lines = [...head];
  sections.forEach((s, i) => {
    const shown = capped(lists[i], limits[i]);
    lines.push(`## ${safe(s.name)}`, ...shown.map((l) => `- ${l}`), '');
  });
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

module.exports = { render, GENERATED_BY, BANNER, MAX_LINES, SECTION_MAX };
