'use strict';

// dashboard-read — the one seam every dashboard source read passes through (spec 021, Wave 3: the input
// boundary). Security surface: nothing else in the dashboard modules opens a source file.
//
//   readSource(path, ctx)   utf8 text of one source file. Refuses (throws an Error with `.code` and `.reason`):
//                           EXCLUDED     basename is on the denylist (checked BEFORE any fs access, never traced)
//                           UNSAFE_PATH  outside the repo root and project/<slug>/, or a link at/below a root
//                           NOT_FILE     not a regular file (FIFO, device, directory)
//                           TOO_LARGE    more than 256 KiB
//                           NOT_UTF8     not valid UTF-8
//                           ENOENT       passed through, callers degrade on it
//                           Every opened path is pushed on ctx.trace when present.
//   cleanText(value)        a source value made safe for the note: redact(), controls and line breaks to a space.
//   writerCheck(slug, root, env)  { allow: true } | { allow: false, reason } — the vault-writer verdict.
//
// ctx = { cwd, repoRoot?, root?, slug?, trace? }. The repo root is ctx.repoRoot, else the nearest `.git` above
// ctx.cwd. The vault root is ctx.root with a valid ctx.slug. Request-scoped: no module-level mutable state.

const fs = require('fs');
const path = require('path');
const { redact } = require('./intent-redact.cjs');
const { MIRROR_EXCLUDES } = require('./vault-contract.cjs');
const { writerGateFor, notWriterReason } = require('./vault-writer.cjs');

const MAX_BYTES = 256 * 1024;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const O_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
const REDACTED = '[REDACTED]';

// Credential-bearing names. Shell-style globs, matched case-insensitively against the basename.
const DENY_GLOBS = Object.freeze([
  'reservations.json', 'xprov.json', 'xprov-secret-allowlist.json', 'dispositions.json',
  '*.lock', '.env*', '*.pem', '*.key', ...MIRROR_EXCLUDES,
]);

function globRe(glob) {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}$`, 'i');
}
const DENY_RES = Object.freeze(DENY_GLOBS.map(globRe));
const DENYLIST = Object.freeze({ globs: DENY_GLOBS, a1JsonDir: '.a1' });

/** True when a path is a credential-bearing file by name (any `*.json` directly in `.a1/` included). */
function isDenied(file) {
  const base = path.basename(file);
  if (DENY_RES.some((re) => re.test(base))) return true;
  return path.basename(path.dirname(file)).toLowerCase() === DENYLIST.a1JsonDir && /\.json$/i.test(base);
}

function fail(code, reason) {
  const err = new Error(`${code}: ${reason}`);
  err.code = code;
  err.reason = reason;
  return err;
}

function repoRootOf(ctx) {
  if (ctx && ctx.repoRoot) return path.resolve(ctx.repoRoot);
  let dir = path.resolve((ctx && ctx.cwd) || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve((ctx && ctx.cwd) || process.cwd());
    dir = up;
  }
}

const LEARN_REL = ['pattern', 'a1-learnings'];
const POSTMORTEM_RE = /^project\/([a-z0-9][a-z0-9-]*)\/postmortems(?:\/|$)/;

const realOr = (r) => { try { return fs.realpathSync(r); } catch (_e) { return r; } };

/**
 * The roots a source may live under, as { root, base, mdOnly }. `base` is where the link walk starts: the repo
 * root for repo files, the VAULT root for vault files (a link at or above project/, pattern/ or a project folder
 * is refused, SEC-1). The roots: the repo; project/<slug>/ of the vault; and, read-only and `*.md` only, for
 * the Learnings count (Wave 2 contract), <vault>/pattern/a1-learnings and the postmortems/ folder of any project.
 * Each root also appears in its resolved form when that form stays inside the resolved base.
 */
function allowedRoots(ctx, abs) {
  const entries = [{ root: repoRootOf(ctx), base: repoRootOf(ctx), mdOnly: false }];
  if (ctx && ctx.root) {
    const vault = path.resolve(ctx.root);
    if (typeof ctx.slug === 'string' && SLUG_RE.test(ctx.slug)) {
      entries.push({ root: path.join(vault, 'project', ctx.slug), base: vault, mdOnly: false });
    }
    entries.push({ root: path.join(vault, ...LEARN_REL), base: vault, mdOnly: true });
    for (const v of new Set([vault, realOr(vault)])) {
      const m = POSTMORTEM_RE.exec(path.relative(v, abs).split(path.sep).join('/'));
      if (m) entries.push({ root: path.join(v, 'project', m[1], 'postmortems'), base: v, mdOnly: true });
    }
  }
  const resolved = entries.map((e) => ({ ...e, root: realOr(e.root), base: realOr(e.base) }))
    .filter((e) => inside(e.base, e.root));
  return [...entries, ...resolved];
}

const inside = (root, file) => file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** Walk base -> file with lstat: a link anywhere below the base is refused; the last stat is returned. */
function lstatWalk(base, file) {
  let cur = base;
  let st = null;
  for (const part of path.relative(base, file).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    st = fs.lstatSync(cur); // ENOENT passes through with its own code
    if (st.isSymbolicLink()) throw fail('UNSAFE_PATH', 'a link inside the source root');
  }
  return st;
}

function readBounded(fd) {
  const buf = Buffer.alloc(MAX_BYTES + 1);
  let n = 0;
  for (;;) {
    const got = fs.readSync(fd, buf, n, buf.length - n, null);
    if (got === 0) break;
    n += got;
    if (n > MAX_BYTES) throw fail('TOO_LARGE', `larger than ${MAX_BYTES} bytes`);
  }
  return buf.subarray(0, n);
}

function decode(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_e) {
    throw fail('NOT_UTF8', 'not valid UTF-8');
  }
}

function readSource(file, ctx) {
  const abs = path.resolve(String(file));
  if (isDenied(abs)) throw fail('EXCLUDED', 'credential-bearing file name');
  const hit = allowedRoots(ctx, abs).find((e) => inside(e.root, abs));
  if (!hit) throw fail('UNSAFE_PATH', 'outside the repo and project folder');
  if (hit.mdOnly && !/\.md$/i.test(abs)) throw fail('UNSAFE_PATH', 'only .md files are read from this folder');
  const st = lstatWalk(hit.base, abs);
  if (!st || !st.isFile()) throw fail('NOT_FILE', 'not a regular file');
  if (st.nlink > 1) throw fail('UNSAFE_PATH', 'a file with more than one hard link');
  let fd;
  try {
    fd = fs.openSync(abs, O_FLAGS);
    if (ctx && Array.isArray(ctx.trace)) ctx.trace.push(abs);
    const after = fs.fstatSync(fd);
    if (!after.isFile() || after.nlink > 1 || after.dev !== st.dev || after.ino !== st.ino) throw fail('UNSAFE_PATH', 'file changed while opening');
    return decode(readBounded(fd));
  } catch (e) {
    if (e && e.code === 'ELOOP') throw fail('UNSAFE_PATH', 'a link inside the source root');
    throw e;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ---------- cleanText ----------

const INVISIBLE_RE = /[­​-‍⁠﻿]/g; //            zero width: dropped, so they cannot split a token
const BIDI_RE = /[‎‏‪-‮⁦-⁩]/g; //          direction marks: become a space
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g;

const countRedacted = (t) => t.split(REDACTED).length - 1;
const tidy = (t) => t.replace(/ {2,}/g, ' ').trim();

/** A source value made safe for the note. A token split by a line break is caught by a second pass on the joined text. */
function cleanText(value) {
  const base = String(value).replace(INVISIBLE_RE, '').replace(BIDI_RE, ' ');
  const spaced = tidy(redact(base).replace(CONTROL_RE, ' '));
  const joined = tidy(redact(base.replace(CONTROL_RE, '')).replace(CONTROL_RE, ' '));
  return countRedacted(joined) > countRedacted(spaced) ? joined : spaced;
}

// ---------- the existing dashboard note (SEC-4) ----------

/**
 * Text of the note at `file` for the foreign-note check, read like a source: lstat first (a link, FIFO, device or
 * directory is refused and never opened), size limit, O_NONBLOCK | O_NOFOLLOW, same inode after the open.
 * ENOENT passes through. Throws the same coded errors as readSource.
 */
function readNote(file) {
  const abs = path.resolve(String(file));
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) throw fail('UNSAFE_PATH', 'a link at the note');
  if (!st.isFile()) throw fail('NOT_FILE', 'not a regular file');
  if (st.nlink > 1) throw fail('UNSAFE_PATH', 'a file with more than one hard link');
  if (st.size > MAX_BYTES) throw fail('TOO_LARGE', `larger than ${MAX_BYTES} bytes`);
  let fd;
  try {
    fd = fs.openSync(abs, O_FLAGS);
    const after = fs.fstatSync(fd);
    if (!after.isFile() || after.dev !== st.dev || after.ino !== st.ino) throw fail('UNSAFE_PATH', 'file changed while opening');
    return decode(readBounded(fd));
  } catch (e) {
    if (e && e.code === 'ELOOP') throw fail('UNSAFE_PATH', 'a link at the note');
    throw e;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ---------- writer verdict ----------

/**
 * The vault-writer verdict. The FR-011 line is exact for a plain non-writer host; an unreadable declaration
 * takes the reason (and the right remedy, hub or fallback env) from notWriterReason() of vault-writer.cjs.
 */
function writerCheck(slug, root, env) {
  const gate = writerGateFor(slug, root, env);
  if (gate.mayWrite) return Object.freeze({ allow: true });
  const reason = gate.cls
    ? notWriterReason(gate)
    : `this host is not the vault writer (${gate.host} ≠ ${gate.writerHost})`;
  return Object.freeze({ allow: false, reason });
}

module.exports = { readSource, readNote, cleanText, writerCheck, DENYLIST, isDenied };
