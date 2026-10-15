'use strict';

/**
 * segment-glob.cjs — path-segment glob matching and scope-overlap math.
 *
 * One owner for the matcher that quick.cjs (forbidden-surface gate) and
 * code-scope.cjs (scope reservations, lane `owns:`) both need. Must not require
 * quick.cjs or code-scope.cjs (they require this module).
 *
 * Semantics (pure string/segment comparison, no fs):
 *   - a pattern segment `**` matches zero or more path segments
 *   - inside any other segment `*` matches any run of non-`/` characters and
 *     `?` exactly one non-`/` character (so `*.env`, `.env.*`, `adr-*.md` work)
 *   - no other regex syntax: everything else is a literal
 *   - case-insensitive (APFS/NTFS fail-safe: a forbidden surface must not be
 *     escapable by changing case)
 *
 * Origin: bug 2026-10-14-quick-gate-env-sentences — the old matcher treated a
 * segment as wildcard only when it was exactly `*`/`**`, so `**\/*.env` never
 * matched a real path.
 */

/** Normalize a scope path: backslashes to `/`, strip leading "./", collapse
 * duplicate slashes. A trailing slash is kept: it is the explicit signal that
 * the last segment is a directory (`docs/v1.2/`), see hasDirSignal. */
function normalizeScopePath(p) {
  let out = String(p).trim().replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  out = out.replace(/\/+/g, '/');
  return out;
}

/** True if a normalized scope ends in `/` or in `/.` (any number of `/./`
 * pairs): both name a directory, and scopeSegments drops the `.` anyway. */
function hasDirSignal(norm) {
  if (norm.length <= 1) return false;
  // Linear right-to-left scan: strip trailing "/." pairs, then a trailing "/".
  let e = norm.length;
  while (e >= 2 && norm[e - 1] === '.' && norm[e - 2] === '/') e -= 2;
  // `./.` special case: raw input only; normalized callers never reach it.
  if (e < norm.length) return !(e === 1 && norm[0] === '.');
  return norm[e - 1] === '/';
}

/** Canonical identity of a scope for equality checks: segments only, without
 * the directory signal (`src/` and `src` are the same claim). */
function scopeKey(raw) {
  const norm = normalizeScopePath(raw);
  try {
    return scopeSegments(norm).join('/');
  } catch (e) {
    if (e instanceof ScopeLimitError) return norm;
    throw e;
  }
}

/** Input bounds: scopes are user-supplied; reject absurd shapes instead of
 * letting the O(n*m) matchers or the recursion blow up (RangeError). */
const MAX_SEGMENT_CHARS = 1024;
const MAX_SEGMENTS = 256;
/** Cap on the whole normalized path: `.` segments are dropped before the
 * segment count, so without it they could grow the input unbounded. */
const MAX_PATH_CHARS = 4096;

class ScopeLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScopeLimitError';
    this.code = 'SCOPE_LIMIT';
  }
}

/** Split a normalized scope into segments. Empty and `.` segments are dropped,
 * exactly as xprov-scope's segmentsOf does, so `.env/.` and `.env` are one
 * path for every gate. Throws ScopeLimitError when a
 * segment is longer than MAX_SEGMENT_CHARS or there are more than
 * MAX_SEGMENTS segments. */
function scopeSegments(p) {
  if (p.length > MAX_PATH_CHARS) {
    throw new ScopeLimitError(`scope has ${p.length} characters, exceeds the limit of ${MAX_PATH_CHARS}`);
  }
  const segs = p.split('/').filter((s) => s !== '' && s !== '.');
  if (segs.length > MAX_SEGMENTS) {
    throw new ScopeLimitError(`scope has ${segs.length} segments, exceeds the limit of ${MAX_SEGMENTS}`);
  }
  const tooLong = segs.find((seg) => seg.length > MAX_SEGMENT_CHARS);
  if (tooLong !== undefined) {
    throw new ScopeLimitError(
      `scope segment has ${tooLong.length} characters, exceeds the limit of ${MAX_SEGMENT_CHARS}`
    );
  }
  return segs;
}

/** Returns an error message if the raw scope path violates the input bounds,
 * else null. Callers use it to fail closed with a clear message. */
function validateScopePath(raw) {
  try {
    scopeSegments(normalizeScopePath(raw));
    return null;
  } catch (e) {
    if (e instanceof ScopeLimitError) return e.message;
    throw e;
  }
}

/** True if the segment has an in-segment wildcard. */
function isGlobSegment(seg) {
  return seg.includes('*') || seg.includes('?');
}

function sameChar(a, b) {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/** Linear-ish wildcard match of one segment (`*` any run, `?` one char),
 * case-insensitive. Two pointers with backtrack to the last `*`: O(n*m) worst
 * case, no regex, so user-supplied patterns cannot trigger ReDoS. */
function wildcardMatch(pattern, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p;
      mark = t;
      p++;
    } else if (p < pattern.length && (pattern[p] === '?' || sameChar(pattern[p], text[t]))) {
      p++;
      t++;
    } else if (star !== -1) {
      p = star + 1;
      mark++;
      t = mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/** True if two single-segment patterns can match at least one common name.
 * DP over (i, j) with memo: O(n*m). */
function segmentPatternsIntersect(a, b) {
  const memo = new Map();
  function go(i, j) {
    const key = i * (b.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let r;
    if (i === a.length && j === b.length) r = true;
    else if (i < a.length && a[i] === '*') r = go(i + 1, j) || (j < b.length && go(i, j + 1));
    else if (j < b.length && b[j] === '*') r = go(i, j + 1) || (i < a.length && go(i + 1, j));
    else if (i < a.length && j < b.length && (a[i] === '?' || b[j] === '?' || sameChar(a[i], b[j]))) {
      r = go(i + 1, j + 1);
    } else r = false;
    memo.set(key, r);
    return r;
  }
  return go(0, 0);
}

/** Match a path's segments against a pattern's segments. */
function segmentsMatchGlob(patternSegs, pathSegs) {
  const memo = new Map();
  function walk(pi, si) {
    const key = pi + ':' + si;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (pi === patternSegs.length) {
      result = si === pathSegs.length;
    } else {
      const seg = patternSegs[pi];
      if (seg === '**') {
        result = walk(pi + 1, si) || (si < pathSegs.length && walk(pi, si + 1));
      } else {
        result = si < pathSegs.length && wildcardMatch(seg, pathSegs[si]) && walk(pi + 1, si + 1);
      }
    }
    memo.set(key, result);
    return result;
  }
  return walk(0, 0);
}

/** True if the path string matches the glob string (both normalized). */
function matchesGlob(glob, rawPath) {
  return segmentsMatchGlob(
    scopeSegments(normalizeScopePath(glob)),
    scopeSegments(normalizeScopePath(rawPath))
  );
}

/** A scope is anchored when it starts with a literal directory name. */
function isAnchored(segs) {
  return segs.length > 0 && !isGlobSegment(segs[0]);
}

/** A scope can act as a directory containing the other side's paths when it is
 * anchored (`src/**`) or ends in a literal name (`**\/fixtures`, `*\/a`): that
 * literal may be a directory on the other side. A scope that ends in a glob
 * segment and starts with one (`*`, `**\/*.md`) names files by pattern and
 * overlaps only where it truly matches. */
function isDirectoryCapable(segs) {
  return isAnchored(segs) || (segs.length > 0 && !isGlobSegment(segs[segs.length - 1]));
}

/**
 * Can two segment lists claim a common path? Walks both lists together:
 * `**` matches zero or more segments, any other segment pair must be able to
 * match a common name (segmentPatternsIntersect, so `dir/x-*.ts` and
 * `dir/y-*.ts` are disjoint). An empty list is the repo root and overlaps
 * everything. If a directory-capable side runs out first, it is a directory
 * above the rest of the other side: overlap; a side that is not
 * directory-capable still overlaps when the other side's remainder is all
 * `**` (zero segments). A trailing `**` matches everything below. A `**`
 * swallows the other side's final segment (treating it as a directory) when
 * its own scope is anchored (`src/**\/util.js` / `src/foo`) or when the other
 * side is directory-capable and its last segment is not file-like
 * (`**\/util.js` / `src/billing/`, `**\/*.tsx` / `apps/web`), so
 * `**\/util.js` and `docs/readme.md` stay disjoint. A directory-capable
 * side whose last literal matched in the middle of the other side overlaps
 * (`**\/fixtures` / `src/fixtures/a.json`).
 */
function segmentListsOverlap(A, B, trailingDirA = false, trailingDirB = false) {
  if (A.length === 0 || B.length === 0) return true;
  const memo = new Map();
  const dirA = trailingDirA || isDirectoryCapable(A);
  const dirB = trailingDirB || isDirectoryCapable(B);
  // A literal last segment with an extension (`util.js`, `v1.2`) is taken for a
  // file unless the scope ends in `/`. Known limit: a directory named like a
  // file (`docs.md`, no trailing slash) is not swallowed by the other `**`.
  const fileLike = (segs, k, trailing) =>
    !(trailing && k === segs.length - 1) && /.\.[^./]+$/.test(segs[k]);
  const anchoredA = isAnchored(A);
  const anchoredB = isAnchored(B);
  const onlyGlobstars = (segs, from) => segs.slice(from).every((s) => s === '**');
  function go(i, j) {
    if (i === A.length && j === B.length) return true;
    if (i === A.length) return dirA || onlyGlobstars(B, j);
    if (j === B.length) return dirB || onlyGlobstars(A, i);
    const key = i + ':' + j;
    if (memo.has(key)) return memo.get(key);
    const a = A[i];
    const b = B[j];
    let r;
    if ((a === '**' && i === A.length - 1) || (b === '**' && j === B.length - 1)) r = true;
    else if (a === '**' && b === '**') r = go(i + 1, j) || go(i, j + 1);
    else if (a === '**') {
      const swallow = j + 1 < B.length || anchoredA || (dirB && !fileLike(B, j, trailingDirB));
      r = go(i + 1, j) || (swallow && go(i, j + 1));
    } else if (b === '**') {
      const swallow = i + 1 < A.length || anchoredB || (dirA && !fileLike(A, i, trailingDirA));
      r = go(i, j + 1) || (swallow && go(i + 1, j));
    } else r = segmentPatternsIntersect(a, b) && go(i + 1, j + 1);
    memo.set(key, r);
    return r;
  }
  return go(0, 0);
}

/** Deterministic overlap between two declared scope paths (see
 * segmentListsOverlap). Pure string comparison, case-insensitive. */
function scopePathsOverlap(rawA, rawB) {
  const a = normalizeScopePath(rawA);
  const b = normalizeScopePath(rawB);
  if (a === b) return true;
  return segmentListsOverlap(scopeSegments(a), scopeSegments(b), hasDirSignal(a), hasDirSignal(b));
}

module.exports = {
  wildcardMatch,
  segmentPatternsIntersect,
  normalizeScopePath,
  hasDirSignal,
  scopeKey,
  scopeSegments,
  isGlobSegment,
  segmentsMatchGlob,
  validateScopePath,
  ScopeLimitError,
  MAX_SEGMENT_CHARS,
  MAX_SEGMENTS,
  MAX_PATH_CHARS,
  matchesGlob,
  scopePathsOverlap,
};
