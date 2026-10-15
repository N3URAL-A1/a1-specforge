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
const {
  normalizeScopePath,
  scopePathsOverlap,
  validateScopePath,
} = require('./segment-glob.cjs');

// Path normalization, glob matching and overlap math live in segment-glob.cjs
// (shared with quick.cjs). `scopePathsOverlap` is re-exported below for
// lane-split.cjs.

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
  for (const sp of paths) {
    const limitErr = validateScopePath(sp);
    if (limitErr) {
      process.stdout.write(
        JSON.stringify({ status: 'INVALID_SCOPE', file, claim: { by, paths }, error: limitErr }, null, 2) + '\n'
      );
      process.stderr.write(`invalid scope (fail closed): ${limitErr}\n`);
      process.exit(1);
    }
  }

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
  // Reused by lib/lane-split.cjs — a lane's `owns:` globs need exactly the same
  // overlap semantics as scope reservations. One owner for this math.
  scopePathsOverlap,
};
