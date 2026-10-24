'use strict';

// dashboard-render — pure render(sections, meta) -> string (spec 021). Wave 1 ships the frontmatter, the
// banner and a plain heading + bullet body; Wave 2 owns truncation, plain-language escaping and the size cap.
//   meta: { slug, generated (ISO string), sourceHead (short hash or null) }

const GENERATED_BY = 'a1-tools dashboard';
const BANNER = '> Generated, do not edit; overwritten on every build.';

function frontmatter(meta) {
  const lines = ['---', 'type: dashboard', `project: "[[project/${meta.slug}]]"`, `generated_by: ${GENERATED_BY}`, `generated: ${meta.generated}`];
  if (meta.sourceHead) lines.push(`source_head: ${meta.sourceHead}`);
  lines.push('---');
  return lines;
}

function sectionLines(section) {
  const body = section.state === 'ok' ? section.items.map((i) => `- ${i}`)
    : section.state === 'none' ? ['- none']
      : [`- not available (${section.reason})`];
  return [`## ${section.name}`, ...body, ''];
}

function render(sections, meta) {
  const lines = [...frontmatter(meta), '', BANNER, ''];
  for (const s of sections) lines.push(...sectionLines(s));
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

module.exports = { render, GENERATED_BY, BANNER };
