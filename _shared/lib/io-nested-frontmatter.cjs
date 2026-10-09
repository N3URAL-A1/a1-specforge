'use strict';

// The nested-object-list frontmatter parser/serializer for docs/product/
// (ROADMAP.md, feature.md, VISION.md, audits). Split out of io.cjs.

const { serializeScalar, parseScalarToken } = require('./io-scalar.cjs');
const { writeTextAtomic } = require('./fs-safe.cjs');

// ---------------------------------------------------------------------------
// product — nested-object-list frontmatter parser for docs/product/ROADMAP.md
// and docs/product/features/<###>-<slug>/feature.md (see docs/product/SCHEMA.md
// sections 1 and 2, binding contract).
//
// parseFrontmatter/serializeFrontmatter (io-frontmatter.cjs) are FLAT: they only handle
// scalars and simple string-list values ("- item"). ROADMAP.md's `milestones:`
// and `features:` keys are lists of YAML OBJECTS ("- id: foo\n  title: bar\n
// ..."), which the flat parser cannot represent. Rather than force-fit that
// shape into the existing parser, this is a small, purpose-built, tolerant
// parser for exactly this document family.
//
// Approach (line-based, indentation-driven, no external YAML dependency —
// consistent with the flat parser):
//   1. Split the frontmatter block into lines.
//   2. A top-level key is a line matching `^key:` (0 leading spaces).
//   3. If the value after the colon is empty AND the following lines are
//      `  - key: value` (2-space indent, list-item marker), the key holds a
//      LIST OF OBJECTS: each `  - ` line starts a new object; subsequent
//      `    key: value` lines (4-space indent, no dash) are more fields of
//      the SAME object, until the next `  - ` or a dedent back to 0.
//   4. If instead the following lines are `  - value` (2-space indent, dash,
//      but the remainder does NOT look like `key: value`), it's a simple
//      string list (delegates to the same scalar rules as the flat parser).
//   5. Otherwise it's a plain scalar on the same line as the key.
//   6. Fail closed (audit F-017): any line this grammar does not consume — a
//      list at indent 0 (`- id: a`), a marker with extra spaces (`-   id: z`),
//      a field at the wrong indent, a non `key: value` line inside an object
//      item — throws an A1_INPUT error naming the line. Before, such lines
//      were skipped, the key parsed as null or `{}`, and the next writer
//      (`product add-feature`) wrote the emptied list back.
// Scalars reuse the same quoting/null/number rules as serializeScalar so
// round-tripping (parse -> serialize -> parse) is lossless for every machine
// field defined in SCHEMA.md sections 1/2.
// ---------------------------------------------------------------------------

function unexpectedLine(lineNo, line, why) {
  const err = new Error(`frontmatter line ${lineNo}: ${why}: ${JSON.stringify(line)}`);
  err.code = 'A1_INPUT';
  return err;
}

/** Parse a nested-object-list frontmatter block (ROADMAP.md / feature.md
 * shape). Returns { fm, body } where fm is a plain object whose values are
 * scalars, arrays of scalars, or arrays of flat objects. */
function parseNestedFrontmatter(content) {
  // Same CRLF normalization as parseFrontmatter (see the note there). Applied
  // here too so the fix is not half-done: this parser has 10+ call sites in
  // product.cjs (roadmap + phase frontmatter), where a CRLF file would have
  // parsed as {} — silently empty frontmatter, the exact latent class the flat
  // parser's fix closed.
  if (content.indexOf('\r\n') !== -1) content = content.replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) {
    return { fm: {}, body: content };
  }
  const end = content.indexOf('\n---', 4);
  if (end === -1) {
    throw new Error('frontmatter has no closing "---"');
  }
  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, '');
  const lines = raw.split('\n');
  const fm = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) {
      i++;
      continue;
    }
    const topMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!topMatch) {
      throw unexpectedLine(i + 2, line, 'expected a top-level `key:` line or a "  - " list item under one');
    }
    const key = topMatch[1];
    const valueRaw = topMatch[2];

    if (valueRaw !== '') {
      fm[key] = parseScalarToken(valueRaw);
      i++;
      continue;
    }

    // Empty value on the key line: look ahead for a "  - " block.
    let j = i + 1;
    const listLines = [];
    while (j < lines.length && /^  - /.test(lines[j])) {
      // Collect this item: the "  - " line, plus any "    " continuation
      // lines (4-space indent, no dash) that belong to the same object. A
      // continuation line whose value is empty (e.g. "    depends_on:")
      // additionally absorbs a following run of "      - value" lines
      // (6-space indent) as a NESTED SCALAR ARRAY for that field — mirrors
      // serializeNestedFrontmatter's own emission shape for a list-valued
      // field inside an object-list item (see the `      - ` prefix there).
      // Without this, a non-empty depends_on (or any other nested array)
      // inside milestones[]/features[] fails to round-trip: the sub-list
      // lines don't match "    [A-Za-z_]" (they start with two extra spaces
      // then a dash) and were previously silently dropped, leaving the
      // field undefined.
      if (/^  - \s/.test(lines[j])) {
        throw unexpectedLine(j + 2, lines[j], 'list marker must be "  - " followed directly by the item');
      }
      const itemLines = [lines[j].replace(/^  - /, '')];
      let k = j + 1;
      while (k < lines.length && /^    [A-Za-z_]/.test(lines[k])) {
        const contLine = lines[k].replace(/^    /, '');
        k++;
        const contMatch = contLine.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
        if (contMatch && contMatch[2] === '') {
          const subItems = [];
          while (k < lines.length && /^      - /.test(lines[k])) {
            subItems.push(parseScalarToken(lines[k].replace(/^      - /, '')));
            k++;
          }
          if (subItems.length > 0) {
            // Nested scalar array (e.g. "depends_on:\n      - a\n      - b"):
            // store as a pre-parsed marker object rather than a raw
            // "key: value" text line, since the array can't be losslessly
            // re-encoded as one such line for the generic line-regex parser
            // below to re-split.
            itemLines.push({ __nestedKey: contMatch[1], __nestedArray: subItems });
            continue;
          }
        }
        itemLines.push(contLine);
      }
      listLines.push(itemLines);
      j = k;
    }

    if (listLines.length === 0) {
      fm[key] = null;
      i++;
      continue;
    }

    // Decide: object-list (first sub-line looks like "key: value") vs
    // simple string list (first sub-line is a bare scalar).
    const firstItem = listLines[0][0];
    const looksLikeObject = /^[A-Za-z_][A-Za-z0-9_]*:\s?/.test(firstItem);

    if (looksLikeObject) {
      const objects = listLines.map((itemLines, itemIdx) => {
        const obj = {};
        for (const itemLine of itemLines) {
          if (typeof itemLine === 'object' && itemLine !== null && '__nestedKey' in itemLine) {
            // Nested scalar array marker (see the collection loop above) —
            // already fully parsed, just attach it under its key.
            obj[itemLine.__nestedKey] = itemLine.__nestedArray;
            continue;
          }
          const m = itemLine.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
          if (!m) {
            throw unexpectedLine(i + 2, itemLine, `item ${itemIdx + 1} of \`${key}:\` is not a \`key: value\` line`);
          }
          const k2 = m[1];
          let v2raw = m[2];
          if (v2raw === '[]') {
            obj[k2] = [];
          } else if (v2raw === '') {
            obj[k2] = null;
          } else {
            obj[k2] = parseScalarToken(v2raw);
          }
        }
        return obj;
      });
      fm[key] = objects;
    } else {
      fm[key] = listLines.map((itemLines) => parseScalarToken(itemLines[0]));
    }

    i = j;
  }

  return { fm, body };
}

/** Serialize a nested frontmatter object back to the ROADMAP.md/feature.md
 * YAML-subset shape. `keyOrder` is an array of key names controlling
 * emission order (unknown keys fall back to insertion order, appended at the
 * end) — callers pass PRODUCT_ROADMAP_KEY_ORDER / PRODUCT_FEATURE_KEY_ORDER. */
function serializeNestedFrontmatter(fm, keyOrder) {
  const keys = Object.keys(fm);
  const ordered = [];
  for (const k of keyOrder || []) if (keys.includes(k)) ordered.push(k);
  for (const k of keys) if (!ordered.includes(k)) ordered.push(k);

  const lines = [];
  for (const k of ordered) {
    const v = fm[k];
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
        continue;
      }
      const isObjectList = v.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
      if (isObjectList) {
        lines.push(`${k}:`);
        for (const obj of v) {
          const objKeys = Object.keys(obj);
          objKeys.forEach((ok, idx) => {
            const ov = obj[ok];
            const prefix = idx === 0 ? '  - ' : '    ';
            if (Array.isArray(ov)) {
              if (ov.length === 0) {
                lines.push(`${prefix}${ok}: []`);
              } else {
                lines.push(`${prefix}${ok}:`);
                for (const item of ov) lines.push(`      - ${serializeScalar(item)}`);
              }
            } else {
              lines.push(`${prefix}${ok}: ${serializeScalar(ov)}`);
            }
          });
        }
      } else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${serializeScalar(item)}`);
      }
    } else {
      lines.push(`${k}: ${serializeScalar(v)}`);
    }
  }
  return lines.join('\n');
}

function writeNestedMdAtomic(p, fm, body, keyOrder) {
  const fmStr = serializeNestedFrontmatter(fm, keyOrder);
  const out = `---\n${fmStr}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
  writeTextAtomic(p, out);
  return out;
}

module.exports = { parseNestedFrontmatter, serializeNestedFrontmatter, writeNestedMdAtomic };
