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
 * duplicate slashes, strip one trailing slash. */
function normalizeScopePath(p) {
  let out = String(p).trim().replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  out = out.replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function scopeSegments(p) {
  return p.split('/').filter(Boolean);
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

/** True if segsA is a prefix of segsB at a segment boundary (or equal),
 * compared case-insensitively like the glob matcher. */
function isSegmentPrefix(segsA, segsB) {
  if (segsA.length > segsB.length) return false;
  for (let i = 0; i < segsA.length; i++) {
    if (segsA[i].toLowerCase() !== segsB[i].toLowerCase()) return false;
  }
  return true;
}

/** Segments before the first glob segment: the fixed directory anchor. */
function nonGlobPrefix(segs) {
  const idx = segs.findIndex(isGlobSegment);
  return idx === -1 ? segs : segs.slice(0, idx);
}

/** True if the path string matches the glob string (both normalized). */
function matchesGlob(glob, rawPath) {
  return segmentsMatchGlob(
    scopeSegments(normalizeScopePath(glob)),
    scopeSegments(normalizeScopePath(rawPath))
  );
}

/** A scope is anchored when it starts with a literal directory name. Only
 * anchored scopes act as a directory that contains the other side's paths; a
 * leading-glob scope (`*`, `**\/x.js`) overlaps only where it truly matches. */
function isAnchored(segs) {
  return segs.length > 0 && !isGlobSegment(segs[0]);
}

/**
 * Can two segment lists claim a common path? Walks both lists together:
 * `**` matches zero or more segments, any other segment pair must be able to
 * match a common name (segmentPatternsIntersect, so `dir/x-*.ts` and
 * `dir/y-*.ts` are disjoint). If an anchored side runs out first, it is a
 * directory above the rest of the other side: overlap. A trailing `**` matches
 * everything below. A `**` swallows the other side's final segment (treating
 * it as a directory) only when its own scope is anchored, so `**\/*.md` and
 * `docs/x.txt` stay disjoint while `src/**\/util.js` and `src/foo` overlap.
 */
function segmentListsOverlap(A, B) {
  const memo = new Map();
  const anchoredA = isAnchored(A);
  const anchoredB = isAnchored(B);
  function go(i, j) {
    if (i === A.length && j === B.length) return true;
    if (i === A.length) return anchoredA;
    if (j === B.length) return anchoredB;
    const key = i + ':' + j;
    if (memo.has(key)) return memo.get(key);
    const a = A[i];
    const b = B[j];
    let r;
    if ((a === '**' && i === A.length - 1) || (b === '**' && j === B.length - 1)) r = true;
    else if (a === '**' && b === '**') r = go(i + 1, j) || go(i, j + 1);
    else if (a === '**') r = go(i + 1, j) || ((j + 1 < B.length || anchoredA) && go(i, j + 1));
    else if (b === '**') r = go(i, j + 1) || ((i + 1 < A.length || anchoredB) && go(i + 1, j));
    else r = segmentPatternsIntersect(a, b) && go(i + 1, j + 1);
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
  return segmentListsOverlap(scopeSegments(a), scopeSegments(b));
}

module.exports = {
  wildcardMatch,
  segmentPatternsIntersect,
  normalizeScopePath,
  scopeSegments,
  isGlobSegment,
  segmentsMatchGlob,
  isSegmentPrefix,
  nonGlobPrefix,
  matchesGlob,
  scopePathsOverlap,
};
