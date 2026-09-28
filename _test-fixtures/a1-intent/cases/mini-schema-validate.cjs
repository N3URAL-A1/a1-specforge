'use strict';

// ---------------------------------------------------------------------------
// mini-schema-validate — the INDEPENDENT validator of cases/09-schema.sh
// (spec 011 SC-009, Lumen-side parity). CI has no ajv, so this is a small
// draft-2020-12 SUBSET, written for the fixture and sharing no code with
// _shared/lib/ (no require of a production module, testing.md class 3).
//
// Supported keywords (exactly what `a1-tools intent schema --json` uses):
//   type (incl. type arrays, "integer"), const, enum, pattern, format
//   ("date-time", asserted), required, properties, additionalProperties
//   (false only), dependentRequired, items, allOf, anyOf, not, if/then/else,
//   $ref (local "#/$defs/<name>" only).
// Everything else is refused loudly (unsupportedKeyword), so a schema that
// grows a keyword this file does not understand fails the fixture instead of
// passing unchecked. `x-*` annotations and $schema/$id/title/description are
// ignored, as JSON Schema says.
//
// NOT expressible in JSON Schema, and therefore NOT checked by the keywords:
//   - the executor-device condition of the approval group (FR-045: the group
//     is valid only under created_by == executor device) — needs executor.json;
//   - the realpath half of project_invalid, target_not_found, and every
//     authenticity rule (device, signature, freshness).
// The FILE-level rules the schema publishes under `x-file-rules` (byte cap,
// empty body, file name = <id>.md, payload byte cap) are applied by
// checkIntentFile below, from the published numbers, before and after the
// keyword check — the way a Lumen writer would apply them.
//
// The frontmatter reader is our own too: the flat YAML subset the intent
// contract allows (plain / "double" / 'single' scalars, `|` and `|-` block
// scalars, null, integers, booleans). A form it does not know is a reject,
// like the executor's strict parser.
// ---------------------------------------------------------------------------

const IGNORED = new Set(['$schema', '$id', 'title', 'description', '$defs', '$comment']);
const KNOWN = new Set([
  'type', 'const', 'enum', 'pattern', 'format', 'required', 'properties', 'additionalProperties',
  'dependentRequired', 'items', 'allOf', 'anyOf', 'not', 'if', 'then', 'else', '$ref',
]);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(want, v) {
  const t = typeOf(v);
  return want === t || (want === 'number' && t === 'integer');
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// RFC 3339 date-time with a real calendar day (no leap second), our own
// reading of the "date-time" format.
function isDateTime(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d)(\.\d+)?([Zz]|[+-]\d\d:\d\d)$/.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1] && h <= 23 && mi <= 59 && se <= 59;
}

function unsupportedKeyword(k) {
  throw new Error(`mini-schema-validate: unsupported keyword ${JSON.stringify(k)}`);
}

function resolveRef(root, ref) {
  const m = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref);
  if (!m || !root.$defs || !root.$defs[m[1]]) throw new Error(`mini-schema-validate: cannot resolve ${ref}`);
  return root.$defs[m[1]];
}

// -> list of error strings (empty = valid).
function check(schema, v, root, at) {
  const errs = [];
  for (const k of Object.keys(schema)) {
    if (!KNOWN.has(k) && !IGNORED.has(k) && !k.startsWith('x-')) unsupportedKeyword(k);
  }
  const isObj = typeOf(v) === 'object';
  if (schema.$ref) errs.push(...check(resolveRef(root, schema.$ref), v, root, at));
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, v))) errs.push(`${at}: type ${typeOf(v)} not in ${types.join('|')}`);
  }
  if ('const' in schema && !deepEqual(schema.const, v)) errs.push(`${at}: not const ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, v))) errs.push(`${at}: not in enum`);
  if (typeof v === 'string' && schema.pattern && !new RegExp(schema.pattern, 'u').test(v)) errs.push(`${at}: pattern`);
  if (typeof v === 'string' && schema.format === 'date-time' && !isDateTime(v)) errs.push(`${at}: format date-time`);
  if (schema.format !== undefined && schema.format !== 'date-time') unsupportedKeyword(`format:${schema.format}`);
  if (isObj) errs.push(...checkObject(schema, v, root, at));
  if (Array.isArray(v) && schema.items) v.forEach((x, i) => errs.push(...check(schema.items, x, root, `${at}[${i}]`)));
  for (const sub of schema.allOf || []) errs.push(...check(sub, v, root, at));
  if (schema.anyOf && !schema.anyOf.some((sub) => check(sub, v, root, at).length === 0)) errs.push(`${at}: anyOf`);
  if (schema.not && check(schema.not, v, root, at).length === 0) errs.push(`${at}: not`);
  if (schema.if) {
    const branch = check(schema.if, v, root, at).length === 0 ? schema.then : schema.else;
    if (branch) errs.push(...check(branch, v, root, at));
  }
  return errs;
}

function checkObject(schema, v, root, at) {
  const errs = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(v, k);
  for (const k of schema.required || []) if (!has(k)) errs.push(`${at}: missing ${k}`);
  const props = schema.properties || {};
  for (const k of Object.keys(v)) {
    if (Object.prototype.hasOwnProperty.call(props, k)) errs.push(...check(props[k], v[k], root, `${at}.${k}`));
    else if (schema.additionalProperties === false) errs.push(`${at}: additional ${k}`);
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) unsupportedKeyword('additionalProperties:<schema>');
  for (const [k, deps] of Object.entries(schema.dependentRequired || {})) {
    if (has(k)) for (const dep of deps) if (!has(dep)) errs.push(`${at}: ${k} requires ${dep}`);
  }
  return errs;
}

function validate(schema, instance) {
  return check(schema, instance, schema, '$');
}

// ---------- our own flat-YAML frontmatter reader ----------
function scalar(text) {
  const s = text.trim();
  if (s === '' || s === '~' || s === 'null') return { value: null };
  if (s[0] === '"') {
    if (s.length < 2 || s[s.length - 1] !== '"') return null;
    try { return { value: JSON.parse(s) }; } catch (_e) { return null; }
  }
  if (s[0] === "'") {
    if (s.length < 2 || s[s.length - 1] !== "'") return null;
    const inner = s.slice(1, -1);
    if (/'(?!')/.test(inner.replace(/''/g, ''))) return null;
    return { value: inner.split("''").join("'") };
  }
  if (/^(?:0|[1-9]\d*)$/.test(s)) return { value: parseInt(s, 10) };
  if (s === 'true') return { value: true };
  if (s === 'false') return { value: false };
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || / #/.test(s) || /: /.test(s) || s.endsWith(':')) return null;
  return { value: s };
}

// -> { fm, body } or null for anything outside the subset.
function readFrontmatter(text) {
  const lines = text.split('\r\n').join('\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = Object.create(null);
  for (let i = 1; i < end;) {
    const line = lines[i];
    if (line.trim() === '') { i += 1; continue; }
    const m = /^([a-z_][a-z0-9_]*):(?: (.*))?$/.exec(line);
    if (!m || m[1] in fm) return null;
    const rest = m[2] || '';
    if (rest.trim() === '|' || rest.trim() === '|-') {
      const block = [];
      i += 1;
      while (i < end && (lines[i] === '' || lines[i][0] === ' ')) { block.push(lines[i]); i += 1; }
      while (block.length && block[block.length - 1].trim() === '') block.pop();
      const first = block.find((l) => l.trim() !== '');
      const ind = first ? first.length - first.trimStart().length : 0;
      if (block.some((l) => l.trim() !== '' && l.length - l.trimStart().length < ind)) return null;
      const joined = block.map((l) => l.slice(ind)).join('\n');
      fm[m[1]] = rest.trim() === '|' && joined !== '' ? `${joined}\n` : joined;
      continue;
    }
    const sc = scalar(rest);
    if (!sc) return null;
    fm[m[1]] = sc.value;
    i += 1;
  }
  return { fm, body: lines.slice(end + 1).join('\n') };
}

// File-level rules from schema["x-file-rules"], then the keywords. `folder`
// picks the schema: queued/ -> the root, every other lifecycle folder ->
// $defs[rules.processed_schema]. -> { accept, errors }.
function checkIntentFile(schema, fileName, text, folder) {
  const rules = schema['x-file-rules'];
  const errs = [];
  if (Buffer.byteLength(text, 'utf8') > rules.max_bytes) return { accept: false, errors: ['file: max_bytes'] };
  const parsed = readFrontmatter(text);
  if (!parsed) return { accept: false, errors: ['file: frontmatter outside the subset'] };
  const { fm, body } = parsed;
  if (rules.body === 'empty' && body.trim() !== '') errs.push('file: body not empty');
  if (typeof fm.id === 'string' && fileName !== `${fm.id}.md`) errs.push('file: name is not <id>.md');
  if (typeof fm.payload === 'string' && Buffer.byteLength(fm.payload, 'utf8') > rules.payload_max_bytes) errs.push('file: payload_max_bytes');
  const target = folder === 'queued' ? schema : { ...schema.$defs[rules.processed_schema], $defs: schema.$defs };
  errs.push(...validate(target, { ...fm }));
  return { accept: errs.length === 0, errors: errs };
}

module.exports = { validate, readFrontmatter, checkIntentFile, isDateTime };

// CLI: node mini-schema-validate.cjs <schema.json> <folder> <file> -> prints
// "accept" or "reject <first error>", exit 0 either way (2 on a harness error).
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  try {
    const [schemaFile, folder, file] = process.argv.slice(2);
    const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
    const r = checkIntentFile(schema, path.basename(file), fs.readFileSync(file, 'utf8'), folder);
    process.stdout.write(r.accept ? 'accept\n' : `reject ${r.errors[0]}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 2;
  }
}
