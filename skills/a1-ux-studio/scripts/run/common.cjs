'use strict';
// Shared helpers for the a1-ux-studio run scripts (spec 024). Node core only.
// Exit codes used by every command: 0 ok, 1 refusal, 2 usage/hostile input, 3 internal error.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ARG_CHARS = 4096;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g;

class Refusal extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Refusal(2, `unexpected argument: ${a.slice(0, 80)}`);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Refusal(2, `missing value for ${a.slice(0, 40)}`);
    out[a.slice(2)] = val;
    i += 1;
  }
  return out;
}

function requireSlug(name, value) {
  if (typeof value !== 'string' || !SLUG_RE.test(value)) {
    throw new Refusal(2, `invalid ${name}: must match ${SLUG_RE.source}`);
  }
  return value;
}

/** A path-like argument: a non-empty string without control characters, at most MAX_ARG_CHARS long. */
function requireText(name, value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ARG_CHARS || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Refusal(2, `invalid ${name}: want 1-${MAX_ARG_CHARS} printable characters`);
  }
  return value;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function resolveDate(raw) {
  if (raw === undefined) return today();
  if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) throw new Refusal(2, 'invalid --date: want YYYY-MM-DD');
  return raw;
}

// One line, no control characters (stderr echo, log-injection safe).
function clean(v) { return String(v).replace(CTRL_RE, '').replace(/\s+/g, ' ').trim(); }

module.exports = Object.freeze({
  SLUG_RE, DATE_RE, CTRL_RE, Refusal, parseArgs, requireSlug, requireText, today, resolveDate, clean,
});
