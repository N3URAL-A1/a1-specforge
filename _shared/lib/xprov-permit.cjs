'use strict';

// ---------------------------------------------------------------------------
// xprov permit-check / permit — spec 009-cross-provider-review-gate, Wave 4
// (FR-021). Sole writer: this wave.
//
// The permission record `.a1/xprov.json` says whether this repository's code
// may be sent to an external reviewer. Default is DENY: a missing file, an
// unparseable file, a missing field or any `external_review` value other than
// the string `allowed` is `external_review_not_permitted`. `permit` is the
// only writer of the file; the human runs it once per repository with the
// vault note that records the decision (customer repositories need an
// a1-ludwig-legal decision as that record).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const io = require('./io.cjs');
const xprov = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
// Shared helpers — one definition each, in xprov-common.cjs.
const { inputError } = C;
const usageExit = (msg) => C.usageExit('', msg);
const finish = (report, code) => C.emitJson(report, code, false);
const resolveRoot = (flags) => C.resolveRepoFlag(flags.repo);

const PERMIT_FILE = path.join('.a1', 'xprov.json');
const ALLOWED = 'allowed';
const REQUIRED_FIELDS = Object.freeze(['external_review', 'decided_by', 'decided_on', 'record']);
// Vault-relative note: `record/…` or `project/…`, markdown, no `..` segment.
const RECORD_RE = /^(record|project)\/[A-Za-z0-9][A-Za-z0-9._\/-]*\.md$/;
const BY_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const DENY_MESSAGE = 'External review not permitted for this repository. '
  + 'N3URAL-owned repo: `a1-tools xprov permit --by robert --record <vault-note>`. '
  + 'Customer repo: needs an a1-ludwig-legal decision as `--record`.';

function permitPath(repoRoot) {
  return path.join(repoRoot, PERMIT_FILE);
}

/** Reads the record; never throws. `ok` is true only for a complete record
 * whose `external_review` is exactly `allowed`. */
function permitCheck(opts) {
  const root = (opts && opts.repoRoot) || io.repoRoot();
  const file = permitPath(root);
  const deny = (detail) => Object.freeze({ ok: false, reason: xprov.REASONS.external_review_not_permitted, file, detail });
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_e) { return deny('missing .a1/xprov.json'); }
  let rec;
  try { rec = JSON.parse(raw); } catch (_e) { return deny('unparseable .a1/xprov.json'); }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return deny('malformed .a1/xprov.json (not an object)');
  const missing = REQUIRED_FIELDS.filter((f) => typeof rec[f] !== 'string' || rec[f] === '');
  if (missing.length) return deny(`missing field: ${missing.join(', ')}`);
  if (rec.external_review !== ALLOWED) return deny(`external_review: ${rec.external_review}`);
  return Object.freeze({ ok: true, file, external_review: ALLOWED, decided_by: rec.decided_by, decided_on: rec.decided_on, record: rec.record });
}

function validateBy(by) {
  if (typeof by !== 'string' || !BY_RE.test(by)) throw inputError(`--by must be a plain name (letters, digits, . _ -), got ${JSON.stringify(String(by).slice(0, 80))}`);
  return by;
}

function validateRecord(record) {
  const r = typeof record === 'string' ? record : '';
  if (!RECORD_RE.test(r) || r.split('/').includes('..') || /[\0-\x1f\x7f]/.test(r)) {
    throw inputError(`--record must be a vault-relative note under record/ or project/ (e.g. project/<slug>/record/<date>-xprov.md), got ${JSON.stringify(r.slice(0, 80))}`);
  }
  return r;
}

/** Writes the record atomically. Returns a fresh {ok, file, record}. */
function permit(opts) {
  const o = opts || {};
  const root = o.repoRoot || io.repoRoot();
  const record = Object.freeze({
    external_review: ALLOWED,
    decided_by: validateBy(o.by),
    decided_on: (o.today || io.nowIso()).slice(0, 10),
    record: validateRecord(o.record),
  });
  const file = permitPath(root);
  io.writeTextAtomic(file, `${JSON.stringify(record, null, 2)}\n`);
  return Object.freeze({ ok: true, file, record });
}

// ---------- CLI ----------

// stdout/exitCode plumbing and --repo resolution come from xprov-common.cjs.

function cmdXprovPermitCheck(args) {
  const flags = io.parseFlags(args || [], { repo: 'string' });
  if (flags._.length) return usageExit(`permit-check: unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  let root;
  try { root = resolveRoot(flags); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usageExit(`permit-check: ${e.message}`);
    throw e;
  }
  const r = permitCheck({ repoRoot: root });
  if (!r.ok) process.stderr.write(`${DENY_MESSAGE} (${r.detail})\n`);
  else process.stderr.write(`permit-check: allowed by ${r.decided_by} on ${r.decided_on} (${r.record})\n`);
  return finish(r, r.ok ? xprov.EXIT_PASS : xprov.EXIT_FAIL);
}

function cmdXprovPermit(args) {
  const flags = io.parseFlags(args || [], { by: 'string', record: 'string', repo: 'string' });
  if (flags._.length) return usageExit(`permit: unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  if (!flags.by || !flags.record) return usageExit('permit requires --by <name> --record <vault-path>');
  let r;
  try { r = permit({ repoRoot: resolveRoot(flags), by: flags.by, record: flags.record }); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usageExit(`permit: ${e.message}`);
    throw e;
  }
  process.stderr.write(`permit: wrote ${r.file}\n`);
  return finish(r, xprov.EXIT_PASS);
}

module.exports = { PERMIT_FILE, DENY_MESSAGE, permitPath, permitCheck, permit, cmdXprovPermitCheck, cmdXprovPermit };
