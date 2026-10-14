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

/** True if the segment is a multi-segment `**` or has an in-segment wildcard. */
function isGlobSegment(seg) {
  return seg.includes('*') || seg.includes('?');
}

const regexCache = new Map();

/** Compile one non-`**` pattern segment to an anchored case-insensitive RegExp. */
function segmentRegExp(seg) {
  let re = regexCache.get(seg);
  if (re) return re;
  let src = '';
  for (const ch of seg) {
    if (ch === '*') src += '[^/]*';
    else if (ch === '?') src += '[^/]';
    else src += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  re = new RegExp('^' + src + '$', 'i');
  regexCache.set(seg, re);
  return re;
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
        result = si < pathSegs.length && segmentRegExp(seg).test(pathSegs[si]) && walk(pi + 1, si + 1);
      }
    }
    memo.set(key, result);
    return result;
  }
  return walk(0, 0);
}

/** True if segsA is a prefix of segsB at a segment boundary (or equal). */
function isSegmentPrefix(segsA, segsB) {
  if (segsA.length > segsB.length) return false;
  for (let i = 0; i < segsA.length; i++) {
    if (segsA[i] !== segsB[i]) return false;
  }
  return true;
}

/** Segments before the first glob segment: the fixed directory anchor. */
function nonGlobPrefix(segs) {
  const idx = segs.findIndex(isGlobSegment);
  return idx === -1 ? segs : segs.slice(0, idx);
}

/** True if the (normalized) path string matches the glob string. */
function matchesGlob(glob, rawPath) {
  return segmentsMatchGlob(scopeSegments(glob), scopeSegments(normalizeScopePath(rawPath)));
}

/** Deterministic overlap between two declared scope paths. Overlap if one is a
 * segment-boundary prefix of the other, either glob matches the other, or a
 * glob's fixed prefix contains (or is contained by) the other side. */
function scopePathsOverlap(rawA, rawB) {
  const a = normalizeScopePath(rawA);
  const b = normalizeScopePath(rawB);
  if (a === b) return true;
  const segsA = scopeSegments(a);
  const segsB = scopeSegments(b);
  const hasGlobA = segsA.some(isGlobSegment);
  const hasGlobB = segsB.some(isGlobSegment);
  if (hasGlobA && segmentsMatchGlob(segsA, segsB)) return true;
  if (hasGlobB && segmentsMatchGlob(segsB, segsA)) return true;
  if (!hasGlobA && !hasGlobB) {
    return isSegmentPrefix(segsA, segsB) || isSegmentPrefix(segsB, segsA);
  }
  const prefixA = nonGlobPrefix(segsA);
  const prefixB = nonGlobPrefix(segsB);
  if (prefixA.length > 0 && isSegmentPrefix(prefixA, segsB)) return true;
  if (prefixB.length > 0 && isSegmentPrefix(prefixB, segsA)) return true;
  if (prefixB.length > 0 && isSegmentPrefix(segsA, prefixB)) return true;
  if (prefixA.length > 0 && isSegmentPrefix(segsB, prefixA)) return true;
  return false;
}

module.exports = {
  normalizeScopePath,
  scopeSegments,
  isGlobSegment,
  segmentsMatchGlob,
  isSegmentPrefix,
  nonGlobPrefix,
  matchesGlob,
  scopePathsOverlap,
};
