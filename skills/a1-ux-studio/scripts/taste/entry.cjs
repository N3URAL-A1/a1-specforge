'use strict';
// Taste-vault entry rules (spec 024, FR-024, W8): field validation, PII patterns, file format, parser.
// Node core only. Entries are single-line scalars written as JSON strings, so no input can add a frontmatter key.

const { Refusal, SLUG_RE } = require('../run/common.cjs');

const FIELDS = Object.freeze(['source_url', 'keywords', 'image_prompt', 'copy_brief', 'screenshot']);
const MAX_URL = 2048;
const MAX_PROMPT = 1000;
const MAX_BRIEF = 600;
const MAX_KEYWORDS = 12;
const MAX_KEYWORD = 40;
const MAX_PATH = 300;
const MIN_PHONE_DIGITS = 8;
const SHOT_EXT_RE = /\.(png|jpe?g|webp)$/i;
const KEYWORD_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.+&'-]*$/u;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/;
const PHONE_RE = /\+?\d[\d ()./-]{6,}\d/g;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Name of the first PII kind found in text ('email' | 'phone'), or null. Never returns the value. */
function piiKind(text, { phone = true } = {}) {
  if (EMAIL_RE.test(text) || /mailto:/i.test(text)) return 'email';
  if (!phone) return null;
  const hit = (text.match(PHONE_RE) || []).find((m) => !DATE_ONLY_RE.test(m) && m.replace(/\D/g, '').length >= MIN_PHONE_DIGITS);
  return hit ? 'phone' : null;
}

function text(name, value, max) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Refusal(2, `missing ${name}`);
  if (value.length > max) throw new Refusal(2, `invalid ${name}: longer than ${max} characters`);
  if (CTRL_RE.test(value)) throw new Refusal(2, `invalid ${name}: control characters or line breaks are not allowed`);
  return value.trim();
}

function url(raw) {
  const v = text('--source-url', raw, MAX_URL);
  let u;
  try { u = new URL(v); } catch (e) { throw new Refusal(2, 'invalid --source-url: not a URL'); }
  if (!/^https?:$/.test(u.protocol) || u.username !== '' || u.password !== '' || /\s/.test(v)) {
    throw new Refusal(2, 'invalid --source-url: want a plain http(s) URL without credentials');
  }
  return v;
}

function keywords(raw) {
  const list = text('--keywords', raw, MAX_KEYWORDS * (MAX_KEYWORD + 2)).split(',').map((k) => k.trim());
  if (list.length > MAX_KEYWORDS || list.some((k) => k.length === 0 || k.length > MAX_KEYWORD || !KEYWORD_RE.test(k))) {
    throw new Refusal(2, `invalid --keywords: 1-${MAX_KEYWORDS} comma-separated words of letters, digits, space . _ + & ' - (max ${MAX_KEYWORD} chars each)`);
  }
  return Object.freeze(list);
}

function relPath(raw) {
  const v = text('--screenshot', raw, MAX_PATH);
  if (v.startsWith('/') || v.includes('\\') || v.split('/').some((s) => s === '..' || s === '.' || s === '') || !SHOT_EXT_RE.test(v)) {
    throw new Refusal(2, '--screenshot must be a vault-relative path to a .png/.jpg/.webp file without ".."');
  }
  return v;
}

function slug(name, value) {
  if (typeof value !== 'string' || !SLUG_RE.test(value)) throw new Refusal(2, `invalid ${name}: must match ${SLUG_RE.source}`);
  return value;
}

/** Validates the CLI values; throws Refusal(2) for shape problems and Refusal(1) for personal data. */
function validateEntry(args, familyIds) {
  const family = slug('--family', args.family);
  if (!familyIds.includes(family)) throw new Refusal(2, `invalid --family: want one of ${familyIds.join(', ')}`);
  const entry = Object.freeze({
    id: slug('--id', args.id),
    family,
    source_url: url(args['source-url']),
    keywords: keywords(args.keywords),
    image_prompt: text('--image-prompt', args['image-prompt'], MAX_PROMPT),
    copy_brief: text('--copy-brief', args['copy-brief'], MAX_BRIEF),
    screenshot: relPath(args.screenshot),
  });
  const pii = checkPii(entry);
  if (pii) throw new Refusal(1, `${pii.field} contains an ${pii.kind === 'email' ? 'email address' : 'phone number'}; taste entries hold no personal data`);
  return entry;
}

/** First personal-data hit in an entry-like object: { field, kind } or null. */
function checkPii(entry) {
  const fields = [['source_url', false], ['keywords', true], ['image_prompt', true], ['copy_brief', true], ['screenshot', false]];
  for (const [field, phone] of fields) {
    const v = Array.isArray(entry[field]) ? entry[field].join(' , ') : String(entry[field] === undefined ? '' : entry[field]);
    const kind = piiKind(v, { phone });
    if (kind) return { field, kind };
  }
  return null;
}

function formatEntry(entry, created) {
  const q = JSON.stringify;
  return [
    '---', 'type: reference', `id: ${entry.id}`, `family: ${entry.family}`, `source_url: ${q(entry.source_url)}`,
    `keywords: ${q(entry.keywords)}`, `image_prompt: ${q(entry.image_prompt)}`, 
    `copy_brief: ${q(entry.copy_brief)}`,
    `screenshot: ${q(entry.screenshot)}`, `created: ${created}`, '---', '', `# ${entry.id}`, '',
  ].join('\n');
}

function scalar(raw) {
  const v = raw.trim();
  if (/^["[]/.test(v)) { try { return JSON.parse(v); } catch (e) { return v; } }
  return v;
}

/** Frontmatter of an entry file as a plain object (flat `key: value` lines; JSON or plain scalars). */
function parseEntry(source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv && !Object.prototype.hasOwnProperty.call(out, kv[1])) out[kv[1]] = scalar(kv[2]);
  }
  return out;
}

const isFilled = (v) => (Array.isArray(v) ? v.length > 0 && v.every((x) => typeof x === 'string' && x.trim()) : typeof v === 'string' && v.trim().length > 0);

module.exports = Object.freeze({ FIELDS, validateEntry, checkPii, piiKind, formatEntry, parseEntry, isFilled });
