'use strict';

// io-nested-frontmatter.cjs — the ROADMAP.md / feature.md / audit parser.
// Audit F-017: lines outside the two-space list grammar were skipped, so a
// valid-YAML list at indent 0 parsed as `features: null` and the next
// `product add-feature` wrote the emptied list back. The parser now fails
// closed on every line it does not consume.

const path = require('path');
const { eq, throws, done } = require('../lib.cjs');

const { parseNestedFrontmatter: parse, serializeNestedFrontmatter: serialize } =
  require(path.join(process.argv[2], 'io-nested-frontmatter.cjs'));
const fm = (lines) => parse(`---\n${lines.join('\n')}\n---\nbody\n`).fm;

// N1 — the shapes the serializer writes still parse.
// Red-making change: tightening the item regex so `    key: value` no longer continues an item.
{
  const doc = [
    'project: demo',
    'next: null',
    '# a comment line',
    'milestones:',
    '  - id: m1',
    '    title: First',
    'features:',
    '  - id: 001-a',
    '    milestone: m1',
    '    depends_on: []',
    '  - id: 002-b',
    '    milestone: m1',
    '    depends_on:',
    '      - 001-a',
    'tags:',
    '  - one',
    '  - two',
    'empty:',
  ];
  const got = fm(doc);
  eq('N1 scalars', [got.project, got.next], ['demo', null]);
  eq('N1 milestones', got.milestones, [{ id: 'm1', title: 'First' }]);
  eq('N1 features', got.features, [
    { id: '001-a', milestone: 'm1', depends_on: [] },
    { id: '002-b', milestone: 'm1', depends_on: ['001-a'] },
  ]);
  eq('N1 string list', got.tags, ['one', 'two']);
  eq('N1 empty key is null', got.empty, null);
  eq('N1 round trip', fm(serialize(got).split('\n')), got);
}

// N2 — F-017 probe: a list at indent 0 throws instead of returning null.
// Red-making change: restoring `if (!topMatch) { i++; continue; }`.
throws('N2 indent-0 list item', () => fm(['features:', '- id: a', '  title: x']), /line 3: .*"- id: a"/);
throws('N2 indent-0 after a good item', () => fm(['features:', '  - id: a', '- id: b']), /line 4: .*"- id: b"/);

// N3 — F-017 probe: `-   id: z` became `{}`.
// Red-making change: dropping the `^  - \s` marker check.
throws('N3 extra spaces after the marker', () => fm(['features:', '  -   id: z']), /line 3: list marker/);

// N4 — fields at an indent the grammar does not know are not dropped.
throws('N4 field at five spaces', () => fm(['features:', '  - id: a', '     title: x']), /line 4: .*"     title: x"/);
throws('N4 field at three spaces', () => fm(['features:', '  - id: a', '   title: x']), /line 4: /);
throws('N4 stray indented line after a scalar key', () => fm(['project: demo', '  oops: 1']), /line 3: /);

// N5 — an object item line that is not `key: value` throws (was skipped).
// Red-making change: restoring `if (!m) continue;` in the object builder.
throws('N5 bare word inside an object item', () => fm(['features:', '  - id: a', '    stray']), /item 1 of `features:`/);

// N6 — the errors are user-input errors (facade prints `error:`, exit 2).
{
  let code = null;
  try { fm(['features:', '- id: a']); } catch (e) { code = e.code; }
  eq('N6 error code', code, 'A1_INPUT');
}

done();
