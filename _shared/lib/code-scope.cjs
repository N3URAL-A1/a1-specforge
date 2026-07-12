'use strict';

// ---------------------------------------------------------------------------
// code-scope — path-list reservation claims with deterministic overlap gate.
//
// Extends the reservations registry (same .a1/reservations.json file) with a
// new claim shape: { type: "code_scope", paths: [...], by, at, stage }.
// Unlike scalar `check reservations --claim <type>:<value>` (exact-match),
// code-scope compares whole path LISTS for prefix/glob overlap so a new
// feature's declared file scope can be checked against every in-flight
// feature's declared scope before Implementation starts (FR-004..007, 017).
// Deterministic: no filesystem reads beyond the registry file itself, no git.
// ---------------------------------------------------------------------------

const { parseFlags, nowIso } = require('./io.cjs');
const { usage } = require('./help.cjs');
const {
  reservationsFile,
  loadReservations,
  acquireReservationsLock,
  exitWithLock,
  failWithLock,
  writeJsonAtomic,
} = require('./locks.cjs');

/** Normalize a scope path for comparison: strip leading "./", collapse
 * duplicate slashes, strip a single trailing slash (kept conceptually as
 * "directory" via segment comparison, not via string suffix). */
function normalizeScopePath(p) {
  let out = String(p).trim().replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  out = out.replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/** Split a normalized path into non-empty segments. */
function scopeSegments(p) {
  return p.split('/').filter(Boolean);
}

/** True if `pattern` segment is a glob segment ("*" or "**"). */
function isGlobSegment(seg) {
  return seg === '*' || seg === '**';
}

/** Match a single path's segments against a pattern's segments.
 * "*" matches exactly one segment; "**" matches zero or more segments. */
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
      } else if (seg === '*') {
        result = si < pathSegs.length && walk(pi + 1, si + 1);
      } else {
        result = si < pathSegs.length && pathSegs[si] === seg && walk(pi + 1, si + 1);
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

/** Segments up to (excluding) the first glob segment, i.e. the fixed
 * "directory anchor" a glob pattern is rooted under. For a pattern with no
 * glob segment this is just all of its segments (identical to itself). */
function nonGlobPrefix(segs) {
  const idx = segs.findIndex(isGlobSegment);
  return idx === -1 ? segs : segs.slice(0, idx);
}

/** Deterministic overlap check between two declared scope paths.
 * Overlap if:
 *   - one is a segment-boundary prefix of the other (dir containment), or
 *   - either contains a glob ("*"/"**") that matches the other via glob math, or
 *   - either side's glob is rooted under a directory the other side contains
 *     (or vice versa) — e.g. `src/**\/util.js` vs `src/foo`, or `src/*` vs
 *     `src/a/b.js`. Compares each side's fixed (non-glob) prefix against the
 *     other side's full segments via segment-boundary containment.
 * No fs reads, no git — pure string/segment comparison. */
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
    if (isSegmentPrefix(segsA, segsB)) return true;
    if (isSegmentPrefix(segsB, segsA)) return true;
  } else {
    // At least one side has a glob: also test directory containment between
    // each side's fixed (non-glob) prefix and the other side's full path.
    const prefixA = nonGlobPrefix(segsA);
    const prefixB = nonGlobPrefix(segsB);
    if (prefixA.length > 0 && isSegmentPrefix(prefixA, segsB)) return true;
    if (prefixB.length > 0 && isSegmentPrefix(prefixB, segsA)) return true;
    if (prefixB.length > 0 && isSegmentPrefix(segsA, prefixB)) return true;
    if (prefixA.length > 0 && isSegmentPrefix(segsB, prefixA)) return true;
  }
  return false;
}

/** Find all code_scope reservation entries (excluding a given feature id)
 * whose declared paths overlap the candidate paths. Returns a flat list of
 * { feature, path, with } describing each overlapping pair. */
function findScopeOverlaps(reservations, candidatePaths, excludeBy) {
  const overlaps = [];
  for (const r of reservations) {
    if (r.type !== 'code_scope') continue;
    if (r.by === excludeBy) continue;
    const otherPaths = Array.isArray(r.paths) ? r.paths : [];
    for (const cand of candidatePaths) {
      for (const other of otherPaths) {
        if (scopePathsOverlap(cand, other)) {
          overlaps.push({ feature: r.by, path: cand, with: other });
        }
      }
    }
  }
  return overlaps;
}

function parseScopeList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const CODE_SCOPE_STAGES = ['started', 'complete', 'review', 'verify', 'merge', 'origin-cleanup', 'done'];

function cmdCodeScopeClaim(args) {
  const flags = parseFlags(args, { by: 'value', scope: 'value', file: 'value' });
  const file = reservationsFile(flags);
  if (!flags.by || !flags.scope) {
    usage('code-scope claim requires --by <feature-id> --scope <path>[,<path>...]');
  }
  const paths = parseScopeList(flags.scope);
  if (paths.length === 0) {
    usage('code-scope claim requires at least one --scope path');
  }
  const by = flags.by;

  const lockPath = acquireReservationsLock(file);
  const data = loadReservations(file);
  const existingSame = data.reservations.find((r) => r.type === 'code_scope' && r.by === by);

  if (existingSame) {
    const existingNorm = (existingSame.paths || []).map(normalizeScopePath).sort();
    const candidateNorm = paths.map(normalizeScopePath).sort();
    const identical =
      existingNorm.length === candidateNorm.length &&
      existingNorm.every((p, i) => p === candidateNorm[i]);
    if (identical) {
      const out = { status: 'OK', idempotent: true, file, reservation: existingSame };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      exitWithLock(lockPath, 0);
    }
  }

  const overlaps = findScopeOverlaps(data.reservations, paths, by);
  if (overlaps.length > 0) {
    const out = { status: 'CONFLICT', file, claim: { by, paths }, overlaps };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    const featureIds = [...new Set(overlaps.map((o) => o.feature))];
    process.stderr.write(
      `conflict: scope overlaps in-flight feature(s): ${featureIds.join(', ')}\n`
    );
    exitWithLock(lockPath, 1);
  }

  const reservation = { type: 'code_scope', paths, by, at: nowIso(), stage: 'started' };
  const remaining = data.reservations.filter((r) => !(r.type === 'code_scope' && r.by === by));
  const next = { reservations: [...remaining, reservation] };
  writeJsonAtomic(file, next);
  const out = { status: 'OK', idempotent: false, file, reservation };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

function cmdCodeScopeStage(args) {
  const flags = parseFlags(args, { by: 'value', set: 'value', file: 'value' });
  const file = reservationsFile(flags);
  if (!flags.by || !flags.set) {
    usage('code-scope stage requires --by <feature-id> --set <stage>');
  }
  const stage = flags.set;
  if (!CODE_SCOPE_STAGES.includes(stage)) {
    usage(`code-scope stage --set must be one of: ${CODE_SCOPE_STAGES.join('|')} (got: ${stage})`);
  }
  const by = flags.by;
  const lockPath = acquireReservationsLock(file);
  const data = loadReservations(file);
  const existing = data.reservations.find((r) => r.type === 'code_scope' && r.by === by);
  if (!existing) {
    failWithLock(lockPath, `code-scope stage: no in-flight code_scope reservation found for feature '${by}'`);
  }

  const currentIdx = CODE_SCOPE_STAGES.indexOf(existing.stage);
  const nextIdx = CODE_SCOPE_STAGES.indexOf(stage);
  if (currentIdx !== -1 && nextIdx < currentIdx) {
    failWithLock(
      lockPath,
      `code-scope stage: backward transition rejected for '${by}' ` +
        `(current stage '${existing.stage}' is ahead of requested '${stage}'). ` +
        `Stage transitions must be forward-only: ${CODE_SCOPE_STAGES.join(' -> ')}.`
    );
  }
  const skipped =
    currentIdx !== -1 && nextIdx - currentIdx > 1
      ? CODE_SCOPE_STAGES.slice(currentIdx + 1, nextIdx)
      : [];

  const updated = { ...existing, stage };
  const next = {
    reservations: data.reservations.map((r) =>
      r.type === 'code_scope' && r.by === by ? updated : r
    ),
  };
  writeJsonAtomic(file, next);
  const out = { status: 'OK', file, reservation: updated };
  if (skipped.length > 0) out.skipped = skipped;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

function cmdCodeScopeRelease(args) {
  const flags = parseFlags(args, { by: 'value', file: 'value' });
  const file = reservationsFile(flags);
  if (!flags.by) {
    usage('code-scope release requires --by <feature-id>');
  }
  const by = flags.by;
  const lockPath = acquireReservationsLock(file);
  const data = loadReservations(file);
  const existing = data.reservations.find((r) => r.type === 'code_scope' && r.by === by);
  if (!existing) {
    const out = { status: 'OK', file, released: false };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    exitWithLock(lockPath, 0);
  }
  const remaining = data.reservations.filter((r) => !(r.type === 'code_scope' && r.by === by));
  const next = { reservations: remaining };
  writeJsonAtomic(file, next);
  const out = { status: 'OK', file, released: true, reservation: existing };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

function cmdCodeScopeList(args) {
  const flags = parseFlags(args, { file: 'value', 'stale-days': 'value' });
  const file = reservationsFile(flags);
  const data = loadReservations(file);
  const scopes = data.reservations.filter((r) => r.type === 'code_scope');
  const staleDaysRaw = flags['stale-days'];
  let reservations = scopes;
  if (staleDaysRaw !== undefined) {
    const staleDays = Number(staleDaysRaw);
    if (!Number.isFinite(staleDays) || staleDays < 0) {
      usage(`code-scope list --stale-days must be a non-negative number (got: ${staleDaysRaw})`);
    }
    const thresholdMs = staleDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    reservations = scopes.map((r) => {
      const atMs = Date.parse(r.at);
      const stale = Number.isFinite(atMs) ? (now - atMs) > thresholdMs : false;
      const entry = { ...r, stale };
      if (stale) {
        entry.hint = `release via a1-tools code-scope release --by ${r.by}`;
      }
      return entry;
    });
  }
  const out = { file, count: reservations.length, reservations };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

function cmdCodeScopeCheck(args) {
  const flags = parseFlags(args, { by: 'value', scope: 'value', file: 'value' });
  const file = reservationsFile(flags);
  if (!flags.by || !flags.scope) {
    usage('code-scope check requires --by <feature-id> --scope <path>[,<path>...]');
  }
  const paths = parseScopeList(flags.scope);
  if (paths.length === 0) {
    usage('code-scope check requires at least one --scope path');
  }
  const by = flags.by;
  const data = loadReservations(file);
  const overlaps = findScopeOverlaps(data.reservations, paths, by);
  if (overlaps.length > 0) {
    const out = { status: 'CONFLICT', file, claim: { by, paths }, overlaps };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    const featureIds = [...new Set(overlaps.map((o) => o.feature))];
    process.stderr.write(
      `conflict: scope overlaps in-flight feature(s): ${featureIds.join(', ')}\n`
    );
    process.exit(1);
  }
  const out = { status: 'OK', file, claim: { by, paths }, overlaps: [] };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

module.exports = {
  cmdCodeScopeClaim,
  cmdCodeScopeStage,
  cmdCodeScopeRelease,
  cmdCodeScopeList,
  cmdCodeScopeCheck,
  CODE_SCOPE_STAGES,
};
