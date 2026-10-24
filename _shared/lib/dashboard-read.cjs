'use strict';

// dashboard-read — the one seam every dashboard source read passes through (spec 021). Wave 1 ships the
// contract with plain behaviour; Wave 3 owns the file: denylist, size cap, link refusal, redaction, the
// vault-writer verdict. Callers depend only on these three functions.
//
//   readSource(path, ctx)   utf8 text of one source file; pushes the path on ctx.trace when present.
//   cleanText(value)        a source value made safe for the note (Wave 3: redact + control-char strip).
//   writerCheck(slug, root, env)  { allow: true } | { allow: false, reason } — the vault-writer verdict.

const fs = require('fs');

function readSource(file, ctx) {
  if (ctx && Array.isArray(ctx.trace)) ctx.trace.push(file);
  return fs.readFileSync(file, 'utf8');
}

function cleanText(value) {
  return String(value);
}

function writerCheck(_slug, _root, _env) {
  return Object.freeze({ allow: true });
}

module.exports = { readSource, cleanText, writerCheck };
