'use strict';

// ---------------------------------------------------------------------------
// quick — deterministic (non-LLM) XS eligibility gate for the a1-quick lane.
//
// Spec: 004-xs-quick-lane, Wave 1 (FR-001, FR-002, FR-003, FR-016). Decides
// whether a stated intent + expected file/diff scope qualifies for the
// zero-spawn "quick" lane instead of the full a1-new-feature/a1-fix
// pipeline. Grep/parse + git-status + reservation-registry checks only — no
// LLM call, no network. Follows the same house style as
// `check-reservations.cjs`: parseFlags from io.cjs, own process.exit(),
// JSON stdout `{status, reasons}`.
//
// Fail-closed (FR-003): any missing/unparseable required flag, or an intent
// the sentence heuristic cannot confidently classify, is NOT_ELIGIBLE. The
// gate never guesses permissively.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseFlags, vaultRoot, readMd } = require('./io.cjs');
const {
  reservationsFile,
  loadReservations,
} = require('./locks.cjs');
const { gitSafe } = require('./git-safe.cjs');

// ---------- eligibility thresholds (FR-002) ----------

const MAX_FILES = 2;
const MAX_DIFF_LINES = 50;
const MAX_INTENT_SENTENCES = 2;
// Defense-in-depth against the oversized-input hostile case (CONVENTIONS.md
// "Hostile inputs" (c)): reject absurdly large --intent values up front,
// before any regex/scan work touches the string, so a pathological input
// can never cause slow backtracking or unbounded memory use.
const MAX_INTENT_CHARS = 20000;

// Forbidden-surface globs (FR-002, FR-016). The wave plan for spec
// 004-xs-quick-lane calls for reusing "the literal glob list" from
// `skills/a1-new-feature/SKILL.md`'s "Size triage & fast path" S-criteria
// section verbatim. That section (as of this wave) states the criteria as
// prose, not as path globs ("No auth / payment / tenant-boundary surface
// touched", "No new data model, no migration", "No new route/screen" —
// see SKILL.md "## Size triage & fast path (S/M/L)"). There is no existing
// literal glob list to copy. The globs below are this wave's deterministic
// encoding of that same prose intent (auth, payment, tenant-boundary,
// security/config surfaces), namespaced under this module so a future
// change to the S-criteria wording only needs a review here, not a rewrite
// of the gate. Segment matching (`*`/`**`) reuses the same semantics as
// `code-scope.cjs`'s scope-glob matcher.
const FORBIDDEN_SURFACE_GLOBS = [
  '**/auth/**',
  '**/authentication/**',
  '**/authorization/**',
  '**/payment/**',
  '**/payments/**',
  '**/billing/**',
  '**/tenant/**',
  '**/tenants/**',
  '**/multi-tenant/**',
  '**/security/**',
  '**/rls/**',
  '**/migrations/**',
  '**/*.env',
  '**/.env.*',
];

// ---------- glob matching (mirrors code-scope.cjs semantics) ----------

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

function isGlobSegment(seg) {
  return seg === '*' || seg === '**';
}

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

/** True if the given scope path matches any forbidden-surface glob. No
 * filesystem resolution happens anywhere in this check — pure string/segment
 * comparison, consistent with code-scope.cjs's overlap matcher. */
function matchesForbiddenSurface(scopePath) {
  const norm = normalizeScopePath(scopePath);
  const segs = scopeSegments(norm);
  return FORBIDDEN_SURFACE_GLOBS.some((glob) => {
    const globSegs = scopeSegments(glob);
    return segmentsMatchGlob(globSegs, segs);
  });
}

/** True if the scope path is a path-traversal attempt ("..") or an absolute
 * path — a declared change scope must be a plain relative path inside the
 * repo. This is deliberately NOT folded into matchesForbiddenSurface: a
 * traversal/absolute-path value isn't matched against the forbidden-surface
 * globs at all (it may not even land in the repo tree), it's an ambiguous/
 * unverifiable scope declaration in its own right — FR-003 fail-closed. */
function isSuspiciousScopePath(rawScopePath) {
  const v = String(rawScopePath == null ? '' : rawScopePath).trim();
  if (v === '') return true;
  if (path.isAbsolute(v)) return true;
  if (v.includes('\0')) return true;
  const segs = v.replace(/\\/g, '/').split('/').filter(Boolean);
  return segs.some((seg) => seg === '..');
}

// ---------- intent sentence heuristic (FR-002, FR-003) ----------

/** Count sentence-terminating punctuation ('.', '!', '?') as the sentence
 * heuristic named in the spec. Returns null (cannot confidently classify)
 * for empty/whitespace-only input — callers must fail closed on null. */
function countIntentSentences(intent) {
  if (typeof intent !== 'string' || intent.trim() === '') return null;
  const matches = intent.match(/[.!?]/g);
  return matches ? matches.length : 0;
}

// ---------- flag parsing helpers ----------

function parseNonNegativeInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (!/^[0-9]+$/.test(String(raw).trim())) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

function parseScopeList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- working-tree check (FR-002) ----------

/** True if `repoRoot`'s git working tree is clean (no uncommitted changes).
 * Any error running `git status` (not a repo, git missing, etc.) is treated
 * as "not clean" — fail closed rather than assume a clean tree. */
function isWorkingTreeClean(repoRoot) {
  try {
    const out = gitSafe(repoRoot, ['status', '--porcelain']);
    return out.trim() === '';
  } catch (_e) {
    return false;
  }
}

// ---------- reservation-conflict check (FR-002) ----------
// Reuses the same overlap semantics as code-scope.cjs's findScopeOverlaps,
// applied directly in-process against the reservations registry loaded via
// locks.cjs — no subprocess spawn of `check reservations`/`code-scope
// check`, per the wave-plan brief.

function nonGlobPrefix(segs) {
  const idx = segs.findIndex(isGlobSegment);
  return idx === -1 ? segs : segs.slice(0, idx);
}

function isSegmentPrefix(segsA, segsB) {
  if (segsA.length > segsB.length) return false;
  for (let i = 0; i < segsA.length; i++) {
    if (segsA[i] !== segsB[i]) return false;
  }
  return true;
}

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
    const prefixA = nonGlobPrefix(segsA);
    const prefixB = nonGlobPrefix(segsB);
    if (prefixA.length > 0 && isSegmentPrefix(prefixA, segsB)) return true;
    if (prefixB.length > 0 && isSegmentPrefix(prefixB, segsA)) return true;
    if (prefixB.length > 0 && isSegmentPrefix(segsA, prefixB)) return true;
    if (prefixA.length > 0 && isSegmentPrefix(segsB, prefixA)) return true;
  }
  return false;
}

function findConflictingReservations(reservations, candidatePaths, excludeBy) {
  const conflicts = [];
  for (const r of reservations) {
    if (r.type !== 'code_scope') continue;
    if (excludeBy && r.by === excludeBy) continue;
    const otherPaths = Array.isArray(r.paths) ? r.paths : [];
    for (const cand of candidatePaths) {
      for (const other of otherPaths) {
        if (scopePathsOverlap(cand, other)) {
          conflicts.push({ feature: r.by, path: cand, with: other });
        }
      }
    }
  }
  return conflicts;
}

// ---------- main command ----------

function cmdQuickEligibility(args) {
  const flags = parseFlags(args, {
    intent: 'value',
    files: 'value',
    'diff-lines': 'value',
    scope: 'value',
    'no-migration': 'bool',
    'no-new-route': 'bool',
    'no-new-dep': 'bool',
    by: 'value',
    'repo-root': 'value',
    file: 'value',
  });

  const reasons = [];

  // --- fail-closed input validation (FR-003) ---
  // Every required flag is checked independently so ALL problems are
  // reported at once (never short-circuit on the first bad flag) — matches
  // the "always list every failing criterion" contract for NOT_ELIGIBLE.

  let intentSentenceCount = null;
  if (flags.intent === undefined || flags.intent === null) {
    reasons.push('missing required flag --intent');
  } else if (String(flags.intent).length > MAX_INTENT_CHARS) {
    // Oversized input (hostile case (c)): reject immediately without
    // running the sentence-count regex against the full string, so an
    // arbitrarily large payload can never cause slow processing.
    reasons.push(
      `--intent exceeds maximum length of ${MAX_INTENT_CHARS} characters (fail-closed on oversized input)`
    );
  } else {
    intentSentenceCount = countIntentSentences(flags.intent);
    if (intentSentenceCount === null) {
      reasons.push('--intent is empty — cannot confidently classify (fail closed)');
    } else if (intentSentenceCount > MAX_INTENT_SENTENCES) {
      reasons.push(
        `--intent has ${intentSentenceCount} sentences, exceeds the ${MAX_INTENT_SENTENCES}-sentence cap`
      );
    } else if (intentSentenceCount === 0) {
      reasons.push('--intent has no sentence-terminating punctuation — cannot confidently classify (fail closed)');
    }
  }

  const filesCount = parseNonNegativeInt(flags.files);
  if (flags.files === undefined) {
    reasons.push('missing required flag --files');
  } else if (filesCount === null) {
    reasons.push(`--files is not a valid non-negative integer (got: ${JSON.stringify(flags.files)})`);
  } else if (filesCount > MAX_FILES) {
    reasons.push(`--files is ${filesCount}, exceeds the ${MAX_FILES}-file cap`);
  } else if (filesCount === 0) {
    reasons.push('--files is 0 — no declared change scope (fail closed)');
  }

  const diffLines = parseNonNegativeInt(flags['diff-lines']);
  if (flags['diff-lines'] === undefined) {
    reasons.push('missing required flag --diff-lines');
  } else if (diffLines === null) {
    reasons.push(`--diff-lines is not a valid non-negative integer (got: ${JSON.stringify(flags['diff-lines'])})`);
  } else if (diffLines > MAX_DIFF_LINES) {
    reasons.push(`--diff-lines is ${diffLines}, exceeds the ${MAX_DIFF_LINES}-line cap`);
  }

  const scopePaths = parseScopeList(flags.scope);
  if (flags.scope === undefined || flags.scope === null || String(flags.scope).trim() === '') {
    reasons.push('missing required flag --scope');
  } else {
    const suspiciousHits = scopePaths.filter(isSuspiciousScopePath);
    if (suspiciousHits.length > 0) {
      reasons.push(
        `--scope contains a path-traversal or absolute-path value, cannot verify (fail closed): ${suspiciousHits.join(', ')}`
      );
    }
    const forbiddenHits = scopePaths.filter(matchesForbiddenSurface);
    if (forbiddenHits.length > 0) {
      reasons.push(
        `--scope matches a forbidden-surface path (auth/payment/tenant-boundary/security/migration): ${forbiddenHits.join(', ')}`
      );
    }
  }

  if (!flags['no-migration']) {
    reasons.push('--no-migration must be asserted (data-model change or migration is never XS-eligible)');
  }
  if (!flags['no-new-route']) {
    reasons.push('--no-new-route must be asserted (new route/screen is never XS-eligible)');
  }
  if (!flags['no-new-dep']) {
    reasons.push('--no-new-dep must be asserted (new dependency is never XS-eligible)');
  }

  // --- working tree check (FR-002) ---
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : process.cwd();
  if (!isWorkingTreeClean(repoRoot)) {
    reasons.push('working tree is not clean (git status --porcelain is non-empty)');
  }

  // --- reservation-conflict check (FR-002) ---
  // Only run once --scope parsed to at least one path; an empty scope is
  // already reported above and would trivially "not conflict".
  if (scopePaths.length > 0) {
    const file = reservationsFile(flags);
    const data = loadReservations(file);
    const conflicts = findConflictingReservations(data.reservations, scopePaths, flags.by);
    if (conflicts.length > 0) {
      const holders = [...new Set(conflicts.map((c) => c.feature))];
      reasons.push(`conflicting code-scope reservation held by: ${holders.join(', ')}`);
    }
  }

  if (reasons.length > 0) {
    const out = { status: 'NOT_ELIGIBLE', reasons };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(1);
  }

  const out = { status: 'ELIGIBLE', reasons: [] };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// quick stats — a1-evolve telemetry report (FR-018, spec 004-xs-quick-lane
// Wave 5). Reads every `projects/*/quick/*.md` run-record under the resolved
// learnings root and reports `escalation_rate` (escalated / total) plus a
// BEST-EFFORT `regression_rate` heuristic: any `projects/*/fixes/*.md` bug
// report filed within 14 days of a quick run whose prose mentions one of
// that run's `files:` is counted as a possible regression. This is a
// file-path + date-window match, NOT a precise causal attribution — a fix
// report matching by coincidence (same file touched for an unrelated reason)
// is still counted. Same JSON-report shape convention as `cost run`/
// `checklist list`: an object with per-record detail, a `totals` block, and
// a one-line `summary` string. No `--json` toggle (unlike `cost run`) —
// this command's stdout is always the JSON report, matching `quick
// eligibility`'s always-JSON contract in this same module.
// ---------------------------------------------------------------------------

const REGRESSION_WINDOW_DAYS = 14;
const REGRESSION_WINDOW_MS = REGRESSION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** List every `projects/<slug>/quick/*.md` run-record under the resolved
 * learnings root, across every project — mirrors the glob convention used
 * elsewhere in this codebase for per-project directories (e.g.
 * `checklistPaths`/`projectsPath` in io.cjs), except this walks ALL project
 * slugs rather than one, since a1-evolve aggregates across the whole store. */
function listQuickRunFiles(root) {
  const projectsDir = path.join(root, 'projects');
  if (!fs.existsSync(projectsDir)) return [];
  const slugs = fs
    .readdirSync(projectsDir)
    .filter((s) => fs.statSync(path.join(projectsDir, s)).isDirectory());
  const files = [];
  for (const slug of slugs) {
    const quickDir = path.join(projectsDir, slug, 'quick');
    if (!fs.existsSync(quickDir)) continue;
    for (const f of fs.readdirSync(quickDir)) {
      if (f.endsWith('.md')) {
        files.push({ slug, abs: path.join(quickDir, f), rel: `projects/${slug}/quick/${f}` });
      }
    }
  }
  return files;
}

/** List every `projects/<slug>/fixes/*.md` bug report under the resolved
 * learnings root, across every project — same per-project glob shape as
 * listQuickRunFiles, used only for the regression_rate cross-reference. */
function listFixReportFiles(root) {
  const projectsDir = path.join(root, 'projects');
  if (!fs.existsSync(projectsDir)) return [];
  const slugs = fs
    .readdirSync(projectsDir)
    .filter((s) => fs.statSync(path.join(projectsDir, s)).isDirectory());
  const files = [];
  for (const slug of slugs) {
    const fixesDir = path.join(projectsDir, slug, 'fixes');
    if (!fs.existsSync(fixesDir)) continue;
    for (const f of fs.readdirSync(fixesDir)) {
      if (f.endsWith('.md')) {
        files.push({ slug, abs: path.join(fixesDir, f), rel: `projects/${slug}/fixes/${f}` });
      }
    }
  }
  return files;
}

/** Parse one quick-run record's frontmatter into the fields this report
 * needs. Tolerant of records the flat frontmatter parser can't fully round-
 * trip (e.g. Wave 3's `handoff_seed:` nested block) — only the fields this
 * report reads are required; anything else is ignored. */
function parseQuickRunRecord(entry) {
  const { fm } = readMd(entry.abs);
  const filesRaw = fm.files;
  const files = Array.isArray(filesRaw) ? filesRaw : [];
  return {
    file: entry.rel,
    slug: entry.slug,
    kind: fm.kind || null,
    result: fm.result || null,
    escalated: String(fm.escalated) === 'true',
    files,
    created: fm.created || null,
  };
}

/** Best-effort: does this fix report's prose (frontmatter title/body) mention
 * `filePath`? Plain substring match on the basename — deliberately loose,
 * documented as a heuristic in the CLI's own report output (see
 * cmdQuickStats below), not a precise causal link. */
function fixReportMentionsFile(content, filePath) {
  const base = path.basename(filePath);
  return content.includes(filePath) || content.includes(base);
}

function parseDateOnly(v) {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** Best-effort regression check for one quick run: true if any fix report is
 * dated within REGRESSION_WINDOW_DAYS after the run AND its prose mentions
 * one of the run's declared files. */
function quickRunHasRegressionMatch(run, fixReports) {
  const runMs = parseDateOnly(run.created);
  if (runMs === null || run.files.length === 0) return false;
  for (const fr of fixReports) {
    const frMs = parseDateOnly(fr.reportedAt);
    if (frMs === null) continue;
    const delta = frMs - runMs;
    if (delta < 0 || delta > REGRESSION_WINDOW_MS) continue;
    if (run.files.some((f) => fixReportMentionsFile(fr.content, f))) return true;
  }
  return false;
}

function cmdQuickStats(args) {
  parseFlags(args, {});

  const root = vaultRoot();
  const runFiles = listQuickRunFiles(root);
  const runs = runFiles.map(parseQuickRunRecord);

  const fixFiles = listFixReportFiles(root);
  const fixReports = fixFiles.map((entry) => {
    const { fm, content } = readMd(entry.abs);
    return { reportedAt: fm.reported_at || null, content };
  });

  const total = runs.length;
  const escalatedCount = runs.filter((r) => r.escalated).length;
  const escalationRate = total === 0 ? null : escalatedCount / total;

  const regressionMatches = runs.filter((r) => quickRunHasRegressionMatch(r, fixReports));
  const regressionRate = total === 0 ? null : regressionMatches.length / total;

  // Weighted learning count (FR-019): each quick-run entry contributes 0.2
  // toward a1-evolve's "N new learnings since last synthesis" count. This
  // report exposes the number so a1-evolve's collect step (01-collect.md)
  // can read it rather than recomputing the glob itself.
  const weightedLearningCount = total * 0.2;

  const summary =
    total === 0
      ? 'quick stats: 0 runs (escalation_rate: null, regression_rate: null)'
      : `quick stats: ${total} runs, escalation_rate ${(escalationRate * 100).toFixed(1)}%, regression_rate ${(regressionRate * 100).toFixed(1)}% (best-effort heuristic)`;

  const out = {
    total,
    escalated: escalatedCount,
    escalation_rate: escalationRate,
    regression_matches: regressionMatches.length,
    regression_rate: regressionRate,
    regression_rate_note:
      'best-effort heuristic: file-path + 14-day window match against projects/*/fixes/*.md prose, not precise causal attribution',
    weighted_learning_count: weightedLearningCount,
    runs: runs.map((r) => ({
      file: r.file,
      slug: r.slug,
      kind: r.kind,
      result: r.result,
      escalated: r.escalated,
      files: r.files,
    })),
    summary,
  };

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

module.exports = {
  cmdQuickEligibility,
  cmdQuickStats,
  matchesForbiddenSurface,
  isSuspiciousScopePath,
  countIntentSentences,
  FORBIDDEN_SURFACE_GLOBS,
  MAX_FILES,
  MAX_DIFF_LINES,
  MAX_INTENT_SENTENCES,
  MAX_INTENT_CHARS,
  REGRESSION_WINDOW_DAYS,
};
