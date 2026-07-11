#!/usr/bin/env node
/**
 * a1-tools.cjs — shared deterministic file-ops helper for a1-* skills.
 *
 * Subcommand hierarchy:
 *
 *   a1-tools spec next-number <project-slug>
 *       → JSON { project, next, padded, dir }
 *
 *   a1-tools spec update-status <spec-path> <new-status> [flags]
 *       Flags:
 *         --wave-plan-path <path>         set frontmatter wave_plan_path
 *         --verify-failures-file <path>   replace verify_failures with JSON array from file
 *         --clear-verify-failures         set verify_failures to []
 *       → JSON { spec_path, status, phase_history, wave_plan_path, verify_failures }
 *
 *   a1-tools spec list <project-slug> [--status=<s>]
 *       → JSON { project, count, specs: [...] }
 *
 *   a1-tools fix next-suffix <project-slug> <YYYY-MM-DD>
 *       → JSON { project, date, suffix, padded, dir }
 *         suffix is "" for first bug of day, "-2" / "-3" for follow-ups.
 *
 *   a1-tools fix update-status <bug-path> <new-status> [flags]
 *       Flags:
 *         --recommended-code-agent <name>  set frontmatter recommended_code_agent
 *         --fix-commit <hash>              set frontmatter fix_commit
 *         --verify-result <text>           set frontmatter verify_result (string)
 *         --duplicate-of <path>            set frontmatter duplicate_of
 *       → JSON { bug_path, status, phase_history, ...changed }
 *
 *   a1-tools fix list <project-slug> [--status=<s>] [--severity=<s>]
 *       → JSON { project, count, bugs: [...] }
 *
 *   a1-tools fix find-duplicates <project-slug> <symptom-keywords...>
 *       → JSON { project, window_days: 30, matches: [...] }
 *         grep over projects/<slug>/fixes/*.md within 30 days, case-insensitive.
 *
 *   a1-tools fix integrity-check [--agents-dir <abs>] [--skills-dir <abs>]
 *       → JSON { status: "ok"|"mismatch"|"bootstrapped", mismatches: [], files_checked }
 *         On first run: bootstraps wiki/_canonical/agents.lock.json from current state.
 *         On subsequent runs: compares SHA256 hashes. status="mismatch" means skill STOPS.
 *
 *   a1-tools fix init-postmortem <bug-slug> <project-slug> [flags]
 *       Flags: --date --severity --root-cause-class --terminal-status --one-line-learning
 *              --fix-wave-count --diagnosis-rounds --phase-friction --quak-regression
 *              --fix-required-test-first
 *       → JSON { path, project, bug_slug, date, filename }
 *         Creates wiki/postmortems/<project>/<date>-<bug-slug>.md with YAML frontmatter.
 *
 *   a1-tools fix count-postmortems-since --since <ISO-timestamp>
 *       → JSON { count, since, files: [...] }
 *         Counts postmortem files in wiki/postmortems/ modified after the given timestamp.
 *
 *   a1-tools fix update-promote-state [--at <ISO-timestamp>]
 *       → JSON { last_promote_at, path }
 *         Writes wiki/_state/last_promote.json with promote timestamp.
 *
 *   a1-tools fix write-suggestion <agent-name> [--title <t>] [--body-file <path>|--body <text>]
 *                                              [--source-postmortem <path>] [--skill <name>]
 *       → JSON { path, agent, title, date, filename }
 *         Creates wiki/lessons/<agent>/_suggestions/<date>-<slug>.md. NEVER writes _active.md.
 *
 *   a1-tools analyze next-slot <project-slug> <focus> [--date YYYY-MM-DD]
 *       → JSON { project, focus, date, suffix, filename, path, dir }
 *
 *   a1-tools analyze init <project-slug> <focus> [flags]
 *       Flags: --project-path <abs> --date <YYYY-MM-DD> --title <text>
 *       → JSON { path, project, focus, status }
 *         Creates analyses/<date>-<focus>[-N].md with status=scoped.
 *
 *   a1-tools analyze update-status <analysis-path> <new-status> [--phase-data <json>]
 *       phase-data is merged into frontmatter based on target status:
 *         discovered → fills `discover` from object
 *         analyzed   → fills `agents_dispatched` from .agents_dispatched[]
 *         synthesized → fills `findings_count` from .findings_count
 *         reported   → fills `suggested_next` from .suggested_next[]
 *       → JSON { analysis_path, status, phase_history, ... }
 *
 *   a1-tools analyze discover <project-path>
 *       → JSON { tech_stack[], loc, file_count, last_commit, branch, commit_count_30d }
 *
 *   a1-tools analyze add-finding <analysis-path> <severity> <category> <location> <description> [--recommendation <text>]
 *       severity: BLOCKER | MAJOR | MINOR
 *       → JSON { analysis_path, finding_id, total_findings }
 *
 *   a1-tools analyze add-findings <analysis-path> --json <file|->
 *       batch mode: JSON array of {severity, category, location, description, recommendation?}
 *       '-' reads from stdin. Single atomic write, no shell-quoting pitfalls.
 *       → JSON { analysis_path, finding_ids[], added, total_findings }
 *
 *   a1-tools analyze list <project-slug> [--status=<s>] [--focus=<s>]
 *       → JSON { project, count, analyses: [...] }
 *
 *   a1-tools constitution init <project-slug> [--title <text>]
 *       → JSON { path, project, status, version }
 *
 *   a1-tools constitution discover <project-slug> [--project-path <abs>]
 *       → JSON { project, project_path, claudemd_present, claudemd_excerpt,
 *                repo_constitution_present, global_rules: [...],
 *                has_link_to_constitution }
 *
 *   a1-tools constitution update-status <constitution-path> <new-status>
 *       → JSON { constitution_path, status, version, phase_history, last_written_at }
 *
 *   a1-tools constitution set-body <constitution-path> --body-file <path>
 *       → JSON { constitution_path, body_bytes }
 *
 *   a1-tools constitution next-version <project-slug>
 *       → JSON { project, next, history_dir }
 *
 *   a1-tools constitution archive-current <project-slug> [--date YYYY-MM-DD]
 *       → JSON { project, snapshot, new_version }
 *         Copies current constitution.md to history/YYYY-MM-DD-vN.md,
 *         increments version in live file.
 *
 *   a1-tools constitution write-mirror <project-slug> --repo-root <abs>
 *       → JSON { project, mirror_path, bytes, version }
 *         Writes stripped-down mirror to <repo-root>/constitution.md atomically.
 *
 *   a1-tools constitution link-claudemd <project-slug> --repo-root <abs>
 *       → JSON { project, claudemd_path, action: 'appended' | 'updated' }
 *         Idempotent: managed block delimited by HTML comment markers.
 *
 *   a1-tools constitution list [--status=<s>]
 *       → JSON { count, constitutions: [...] }
 *
 *   a1-tools schema-check run --migrations <dir> [--tables t1,t2]
 *                             [--trigger-pattern 'audit|log'] [--json]
 *       Deterministic schema pre-gate (audit trigger, RLS, FK type match).
 *       Owns exit code: 0 pass, 1 findings, 2 error.
 *
 *   a1-tools schema-check parse --migrations <dir> [--json]
 *       → JSON schema model { files, tables, triggers, rls, skippedStatements }
 *         Debug mode for the bounded SQL parser (see supported subset in HELP).
 *
 *   a1-tools cost run --project <claude-projects-dir> [--since ISO] [--until ISO] [--json]
 *       Token spend aggregation per session (+ sub-agent logs), dedup by
 *       message.id. Contract: _shared/cost-format-notes.md.
 *       Owns exit code: 0 ok, 2 error.
 *
 *   a1-tools realpath-check run --diff-base <git-ref> [--project <dir>]
 *                               [--evidence <file>] [--real-markers <pattern>] [--json]
 *       Gate 0.7 — kills the mock-test blind spot. Greps the wave diff for
 *       real-backend surfaces (SQL / RLS / external HTTP) and, if any are
 *       present, requires a test-evidence file proving each category ran
 *       against the real backend (non-mock output + real-execution marker).
 *       Owns exit code: 0 pass (no surfaces or all proven), 1 lacking proof,
 *       2 bad args / no git.
 *
 *   a1-tools check reservations --claim <type>:<value> --by <spec-id> [--file <path>]
 *   a1-tools check reservations --list [--file <path>]
 *       P7 cross-run coordination registry (.a1/reservations.json). Claim a
 *       migration number / route / etc. for a spec. Claiming a value already
 *       held by ANOTHER spec → exit 1 (holder info). Same spec re-claim → exit 0
 *       (idempotent). Atomic tmp+rename write.
 *
 * Vault root: env A1_VAULT_ROOT, default "~/N3URAL-Vault".
 * All writes are atomic: read → modify → write to <path>.tmp.<pid> → rename.
 *
 * Exit codes: 0 success, 1 user/usage error, 2 internal error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- valid status sets ----------

const SPEC_STATUSES = new Set([
  'discovering',
  'draft',
  'clarified',
  'planned',
  'awaiting-consistency-fix',
  'implementing',
  'done',
  'cancelled',
]);

const BUG_STATUSES = new Set([
  'reported',
  'diagnosed',
  'fixing',
  'fixed',
  'cant-reproduce',
  'wont-fix',
  'duplicate',
  'cancelled',
]);

const BUG_SEVERITIES = new Set(['blocker', 'major', 'minor', 'nit']);

const ANALYSIS_STATUSES = new Set([
  'scoped',
  'discovered',
  'analyzed',
  'synthesized',
  'reported',
  'cancelled',
]);

const ANALYSIS_FOCUSES = new Set([
  'general',
  'security',
  'architecture',
  'quality',
  'onboarding',
]);

const ANALYSIS_SEVERITIES = new Set(['BLOCKER', 'MAJOR', 'MINOR']);

const CONSTITUTION_STATUSES = new Set([
  'discovering',
  'drafted',
  'reviewed',
  'written',
  'cancelled',
]);

const RECONCILE_STATUSES = new Set([
  'scoped',
  'parsed',
  'probed',
  'reported',
  'cancelled',
]);

const RECONCILE_SCOPE_MODES = new Set(['single', 'project', 'vault-sync']);

const RECONCILE_DRIFT_CLASSES = new Set([
  'MISSING',
  'EXTRA',
  'DIVERGED',
  'STALE',
]);

const MODERNIZE_STATUSES = new Set([
  'scoped',
  'spec-drafted',
  'gap-analyzed',
  'proposals-pending',
  'planned',
  'executing',
  'executed',
  'published',
  'cancelled',
]);

const MODERNIZE_MODES = new Set(['full', 'spec-only']);

const MODERNIZE_PROPOSAL_DECISIONS = new Set([
  'approved',
  'rejected',
  'deferred',
]);

const MODERNIZE_WAVE_STATUSES = new Set([
  'planned',
  'snapshotted',
  'implementing',
  'testing',
  'verifying',
  'done',
  'blocked',
]);

// ---------- core I/O, frontmatter parsing, flag parsing (lib/io.cjs) ----------
const {
  vaultRoot,
  resolveVaultPath,
  parseFrontmatter,
  serializeScalar,
  detectKeyOrder,
  serializeFrontmatter,
  readMd,
  writeMdAtomic,
  nowIso,
  writeTextAtomic,
  parseScalarToken,
  parseNestedFrontmatter,
  serializeNestedFrontmatter,
  writeNestedMdAtomic,
  parseFlags,
  fail,
} = require(path.join(__dirname, 'lib', 'io.cjs'));

const PRODUCT_ROADMAP_KEY_ORDER = [
  'schema_version', 'type', 'project', 'title', 'status', 'updated', 'source',
  'milestones', 'features', 'next',
];

const PRODUCT_FEATURE_KEY_ORDER = [
  'id', 'project', 'milestone', 'title', 'status', 'stage', 'depends_on',
  'started', 'finished', 'spec_path', 'plan_path', 'schema_version',
];

function readProductRoadmap(dir) {
  const file = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf8');
  const parsed = parseNestedFrontmatter(content);
  return { file, content, ...parsed };
}

function readProductFeature(dir, id) {
  const file = path.join(dir, 'features', id, 'feature.md');
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf8');
  const parsed = parseNestedFrontmatter(content);
  return { file, content, ...parsed };
}

/** Pure/side-effect-free: compute regenerated index.json and NEXT.md content
 * strings from the ROADMAP frontmatter (source of truth) and productDir (only
 * read to fill spec_path/plan_path from feature.md when present — never
 * written to). Returns { indexJson, nextMd }. */
function regenerateDerived(productDir, roadmapFm) {
  const milestones = Array.isArray(roadmapFm.milestones) ? roadmapFm.milestones : [];
  const featuresIn = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];

  const features = featuresIn.map((f) => {
    let spec_path = f.spec_path !== undefined ? f.spec_path : null;
    let plan_path = f.plan_path !== undefined ? f.plan_path : null;
    const featureMd = readProductFeature(productDir, f.id);
    if (featureMd) {
      if ((spec_path === null || spec_path === undefined) && featureMd.fm.spec_path) {
        spec_path = featureMd.fm.spec_path;
      }
      if ((plan_path === null || plan_path === undefined) && featureMd.fm.plan_path) {
        plan_path = featureMd.fm.plan_path;
      }
    }
    return {
      id: f.id,
      milestone: f.milestone,
      title: f.title,
      status: f.status,
      stage: f.stage !== undefined ? f.stage : null,
      depends_on: Array.isArray(f.depends_on) ? f.depends_on : [],
      started: f.started !== undefined ? f.started : null,
      finished: f.finished !== undefined ? f.finished : null,
      spec_path: spec_path !== undefined ? spec_path : null,
      plan_path: plan_path !== undefined ? plan_path : null,
    };
  });

  // cursor: first not-yet-done/cancelled feature (array order) whose
  // depends_on are all 'done' among sibling features; null if none qualify.
  const statusById = new Map(features.map((f) => [f.id, f.status]));
  let cursor = null;
  for (const f of features) {
    if (f.status === 'done' || f.status === 'cancelled') continue;
    const depsOk = (f.depends_on || []).every((dep) => statusById.get(dep) === 'done');
    if (depsOk) {
      cursor = f.id;
      break;
    }
  }

  const indexJson = {
    schema_version: 1,
    generated: nowIso(),
    project: {
      id: roadmapFm.project,
      title: roadmapFm.title,
      status: roadmapFm.status,
    },
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      target: m.target !== undefined ? m.target : null,
    })),
    features,
    next: roadmapFm.next !== undefined ? roadmapFm.next : null,
    cursor,
  };

  const inFlight = features.filter((f) => f.status === 'in-flight');
  const milestonesInProgress = milestones.filter((m) => m.status === 'in-progress');
  const today = nowIso().slice(0, 10);

  const nextMdLines = [
    '# NEXT.md',
    '',
    '<!-- generated file — do not hand-edit. Regenerated by `a1-tools product ...` -->',
    '',
    `# ${roadmapFm.title || roadmapFm.project || 'Project'}`,
    '',
    `updated: ${today}`,
    '',
    '## You are here',
    '',
  ];
  if (milestonesInProgress.length === 0) {
    nextMdLines.push('No milestone currently in progress.');
  } else {
    for (const m of milestonesInProgress) {
      nextMdLines.push(`- **${m.id}** — ${m.title} (target: ${m.target || 'unset'})`);
    }
  }
  nextMdLines.push('', '## In-flight features', '');
  if (inFlight.length === 0) {
    nextMdLines.push('None.');
  } else {
    for (const f of inFlight) {
      const scopeHint = f.spec_path || f.plan_path
        ? ` — scope: ${[f.spec_path, f.plan_path].filter(Boolean).join(', ')}`
        : '';
      nextMdLines.push(`- **${f.id}** — ${f.title} (milestone: ${f.milestone}, stage: ${f.stage || 'none'})${scopeHint}`);
    }
  }
  nextMdLines.push('', '## Next cursor', '');
  if (cursor === null) {
    nextMdLines.push('None — no eligible feature (all done/cancelled, or blocked by unmet dependencies).');
  } else {
    const cursorFeature = features.find((f) => f.id === cursor);
    const rationale = cursorFeature && (cursorFeature.depends_on || []).length > 0
      ? `all dependencies (${cursorFeature.depends_on.join(', ')}) are done`
      : 'no unmet dependencies, first eligible feature in roadmap order';
    nextMdLines.push(`**${cursor}** — recommended next feature (${rationale}).`);
  }
  nextMdLines.push('', '## How to continue', '');
  nextMdLines.push(
    cursor === null
      ? 'Run `a1-progress` to review overall project state and decide the next milestone.'
      : 'Run `a1-plan` to create an executable plan for the next-cursor feature, or `a1-execute` if a plan already exists.'
  );
  nextMdLines.push('');
  const nextMd = nextMdLines.join('\n');

  return { indexJson, nextMd };
}

const CHANGELOG_ROTATION_LIMIT = 100;

/** Append a changelog line to ROADMAP.md body's `## Changelog` section
 * in-memory (pure — caller is responsible for persisting via the same
 * atomic write set as every other product mutation). Returns
 * { body, archiveAppend } where archiveAppend is a string to append to
 * CHANGELOG-archive.md (or null if no rotation happened this call). */
function appendChangelogEntry(body, what, why) {
  const today = nowIso().slice(0, 10);
  const line = `- **${today}** — ${what} — ${why}`;

  const headingRe = /^## Changelog\s*$/m;
  const match = headingRe.exec(body);
  if (!match) {
    // No Changelog section yet — append one at the end of the body.
    const sep = body.endsWith('\n') ? '' : '\n';
    return { body: `${body}${sep}\n## Changelog\n\n${line}\n`, archiveAppend: null };
  }

  const startIdx = match.index + match[0].length;
  // Find the next "## " heading after Changelog to bound the section.
  const rest = body.slice(startIdx);
  const nextHeadingMatch = /^## /m.exec(rest);
  const sectionEnd = nextHeadingMatch ? startIdx + nextHeadingMatch.index : body.length;

  const before = body.slice(0, startIdx);
  const section = body.slice(startIdx, sectionEnd);
  const after = body.slice(sectionEnd);

  const entryLines = section.split('\n').filter((l) => /^- \*\*\d{4}-\d{2}-\d{2}\*\* —/.test(l));
  const nonEntryPrefix = section.slice(0, section.indexOf(entryLines[0] || '') === -1 ? section.length : section.indexOf(entryLines[0]));

  const updatedEntries = [...entryLines, line];

  let archiveAppend = null;
  let keptEntries = updatedEntries;
  if (updatedEntries.length > CHANGELOG_ROTATION_LIMIT) {
    const overflowCount = updatedEntries.length - CHANGELOG_ROTATION_LIMIT;
    const overflow = updatedEntries.slice(0, overflowCount);
    keptEntries = updatedEntries.slice(overflowCount);
    archiveAppend = overflow.join('\n') + '\n';
  }

  const newSection = `${nonEntryPrefix.trimEnd() ? nonEntryPrefix.trimEnd() + '\n\n' : '\n'}${keptEntries.join('\n')}\n\n`;
  const newBody = `${before}${newSection}${after}`;

  return { body: newBody, archiveAppend };
}

// Slug/id shapes accepted anywhere a user-controlled value is joined into a
// filesystem path for the `product` subcommands. Defined here (ahead of
// their first use in the write-path command handlers below) so every entry
// point can enforce them via assertSlug() before any path.join()/lock
// acquisition happens — see SEC findings on path traversal via unvalidated
// --id/--milestone/--project.
const PRODUCT_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FEATURE_ID_RE = /^[0-9]{3}-[a-z0-9]+(-[a-z0-9]+)*$/;

/** Reject any value that isn't a bare kebab-case slug (or, for kind
 * 'feature-id', a `###-kebab-slug`) BEFORE it is used to build a filesystem
 * path. Throws via fail()/failWithLock() semantics — callers pass an
 * optional lockPath so an already-acquired lock is released on rejection.
 * Must be called at every product-command entry point that joins a
 * user-supplied id/milestone/project into a path, prior to the path.join()
 * and prior to acquireReservationsLock() wherever possible. */
function assertSlug(value, kind, lockPath) {
  const re = kind === 'feature-id' ? FEATURE_ID_RE : PRODUCT_SLUG_RE;
  const label = kind === 'feature-id' ? 'a ###-kebab-slug (e.g. 001-my-feature)' : 'a kebab-case slug (e.g. my-slug)';
  const ok = typeof value === 'string' && re.test(value);
  if (!ok) {
    const msg = `invalid ${kind}: ${JSON.stringify(value)} — must be ${label}, no path separators, dots, or traversal sequences`;
    if (lockPath) failWithLock(lockPath, msg);
    else fail(msg);
  }
}

function productDirFromFlags(flags) {
  return flags.dir ? path.resolve(flags.dir) : path.join(process.cwd(), 'docs', 'product');
}

/** Stage every {target, content} write as a .tmp file first; only rename
 * into place once ALL tmp writes succeeded. The rename phase itself is made
 * all-or-nothing too (FR-009): before renaming, each pre-existing target's
 * original content is backed up in memory (or noted as "did not exist"). If
 * ANY rename in the loop throws (e.g. EXDEV, disk-full, permission change,
 * concurrent external deletion), every rename that already succeeded is
 * reverted — targets that pre-existed are restored to their exact prior
 * content, targets that did not pre-exist are removed — before
 * failWithLock(lockPath, msg) is called. Leftover .tmp files (both the ones
 * never renamed and the one that failed mid-rename) are best-effort
 * unlinked. Mirrors cmdProductStage's proven all-or-nothing pattern so every
 * product-mutating command shares one transaction implementation. */
function writeAllOrNothing(lockPath, writes, errPrefix) {
  const staged = [];
  const renamed = [];
  try {
    for (const w of writes) {
      const tmp = `${w.target}.tmp.${process.pid}`;
      const wdir = path.dirname(w.target);
      if (!fs.existsSync(wdir)) fs.mkdirSync(wdir, { recursive: true });
      fs.writeFileSync(tmp, w.content, 'utf8');
      const existed = fs.existsSync(w.target);
      const original = existed ? fs.readFileSync(w.target, 'utf8') : null;
      staged.push({ tmp, target: w.target, existed, original });
    }
    // Test-only fault injection seam (FR-009 rename-phase coverage): when
    // A1_TEST_FAIL_RENAME_AT_INDEX is set to a rename-loop index, throw
    // AFTER the real rename at that index has already completed on disk,
    // simulating fs.renameSync failing partway through a multi-file write
    // set (the exact shape of the original atomicity bug). No-op unless the
    // env var is explicitly set, so production behavior is unchanged.
    const failAtIdx = process.env.A1_TEST_FAIL_RENAME_AT_INDEX;
    const failAtIdxNum = failAtIdx !== undefined ? Number(failAtIdx) : -1;
    for (let idx = 0; idx < staged.length; idx++) {
      const s = staged[idx];
      fs.renameSync(s.tmp, s.target);
      renamed.push(s);
      if (idx === failAtIdxNum) {
        throw new Error(`A1_TEST_FAIL_RENAME_AT_INDEX injected failure at index ${idx}`);
      }
    }
  } catch (e) {
    // Revert every rename that already succeeded, in reverse order, before
    // reporting failure — this is what makes the rename phase itself
    // transactional rather than just the tmp-write phase. Revert failures
    // are collected (not swallowed): if the rollback itself can't fully
    // complete, the repo is left in a partially-reverted state and the
    // operator needs to know exactly which files still need a manual check,
    // rather than seeing only the original write error and assuming the
    // rollback silently succeeded.
    const revertFailures = [];
    for (let i = renamed.length - 1; i >= 0; i--) {
      const s = renamed[i];
      try {
        if (s.existed) {
          fs.writeFileSync(s.target, s.original, 'utf8');
        } else {
          fs.unlinkSync(s.target);
        }
      } catch (e2) {
        // best-effort revert — if this also fails there is nothing more we
        // can safely do automatically, but the failure is surfaced below
        // instead of discarded so the operator knows this file was NOT
        // restored to its pre-write state.
        revertFailures.push({ file: s.target, error: e2.message });
      }
    }
    for (const s of staged) {
      try {
        fs.unlinkSync(s.tmp);
      } catch (_e2) {
        // ignore ENOENT etc — best-effort cleanup (covers both tmp files
        // never renamed and the one tmp file consumed by a failed rename)
      }
    }
    let msg = `${errPrefix}: write failed, all changes rolled back: ${e.message}`;
    if (revertFailures.length > 0) {
      const detail = revertFailures.map((f) => `${f.file} (${f.error})`).join(', ');
      msg = `${errPrefix}: write failed AND rollback incomplete — PARTIAL ROLLBACK, manual check needed: ${detail}. Original error: ${e.message}`;
    }
    failWithLock(lockPath, msg);
  }
}

/** Build the writes[] entries for ROADMAP.md (with an appended changelog
 * line) + regenerated index.json/NEXT.md, given the ALREADY-updated
 * roadmap frontmatter + body. Handles the >100-entry archive rotation
 * (FR-010) by adding a 4th write when rotation occurs. Returns
 * { writes, roadmapContent } for the caller to push onto its own writes[]
 * (e.g. feature.md, reservations.json) before calling writeAllOrNothing. */
function buildRoadmapWritesWithChangelog(dir, updatedRoadmapFm, roadmapBody, what, why) {
  const { body: bodyWithEntry, archiveAppend } = appendChangelogEntry(roadmapBody, what, why);
  const { indexJson, nextMd } = regenerateDerived(dir, updatedRoadmapFm);

  const roadmapFmStr = serializeNestedFrontmatter(updatedRoadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
  const roadmapContent = `---\n${roadmapFmStr}\n---\n${bodyWithEntry.startsWith('\n') ? '' : '\n'}${bodyWithEntry}`;

  const writes = [
    { target: path.join(dir, 'ROADMAP.md'), content: roadmapContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  if (archiveAppend !== null) {
    const archiveFile = path.join(dir, 'CHANGELOG-archive.md');
    let archiveExisting = '';
    if (fs.existsSync(archiveFile)) {
      archiveExisting = fs.readFileSync(archiveFile, 'utf8');
    } else {
      archiveExisting = '# Changelog Archive\n\nRotated entries beyond the 100-entry ROADMAP.md ' +
        'Changelog window (append-only, oldest first).\n\n';
    }
    const sep = archiveExisting.endsWith('\n') ? '' : '\n';
    writes.push({ target: archiveFile, content: `${archiveExisting}${sep}${archiveAppend}` });
  }
  return { writes, roadmapContent };
}

function cmdProductStatus(args) {
  const flags = parseFlags(args, { dir: 'value' });
  const dir = productDirFromFlags(flags);
  const roadmap = readProductRoadmap(dir);
  if (!roadmap) {
    fail(`product status: ${path.join(dir, 'ROADMAP.md')} not found`);
  }
  const fm = roadmap.fm;
  const features = (Array.isArray(fm.features) ? fm.features : []).map((f) => {
    const featureMd = readProductFeature(dir, f.id);
    if (!featureMd) return { ...f };
    return { ...f, feature_md_path: featureMd.file };
  });
  const out = {
    project: { id: fm.project, title: fm.title, status: fm.status },
    milestones: Array.isArray(fm.milestones) ? fm.milestones : [],
    features,
    next: fm.next !== undefined ? fm.next : null,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

function cmdProductStage(args) {
  const flags = parseFlags(args, { by: 'value', set: 'value', dir: 'value' });
  if (!flags.by || !flags.set) {
    usage('product stage requires --by <feature-id> --set <stage>');
  }
  const dir = productDirFromFlags(flags);
  const targetStage = flags.set;
  if (targetStage !== null && !CODE_SCOPE_STAGES.includes(targetStage)) {
    usage(`product stage --set must be one of: ${CODE_SCOPE_STAGES.join('|')} (got: ${targetStage})`);
  }
  const id = flags.by;

  // Lock file anchor: co-located with the reservations lock convention but
  // scoped to this product dir specifically (docs/product/.product-stage.lock)
  // so a product-stage transaction never contends with unrelated
  // .a1/reservations.json activity, while reusing the exact same
  // acquire/release/exit/fail primitives (no new lock code needed).
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product stage: ${roadmapFile} not found`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);

  const featuresList = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];
  const featureIdx = featuresList.findIndex((f) => f.id === id);
  if (featureIdx === -1) {
    failWithLock(lockPath, `product stage: feature '${id}' not found in ${roadmapFile}`);
  }
  const existing = featuresList[featureIdx];
  const currentStage = existing.stage !== undefined ? existing.stage : null;

  const currentIdx = currentStage === null ? -1 : CODE_SCOPE_STAGES.indexOf(currentStage);
  const nextIdx = CODE_SCOPE_STAGES.indexOf(targetStage);
  if (currentIdx !== -1 && nextIdx < currentIdx) {
    failWithLock(
      lockPath,
      `product stage: backward transition rejected for '${id}' ` +
        `(current stage '${currentStage}' is ahead of requested '${targetStage}'). ` +
        `Stage transitions must be forward-only: ${CODE_SCOPE_STAGES.join(' -> ')}.`
    );
  }
  const skipped =
    currentIdx !== -1 && nextIdx - currentIdx > 1
      ? CODE_SCOPE_STAGES.slice(currentIdx + 1, nextIdx)
      : [];

  const today = nowIso().slice(0, 10);
  const derivedStatus = targetStage === 'done' ? 'done' : 'in-flight';
  const updatedFeature = { ...existing, stage: targetStage, status: derivedStatus };
  if (currentStage === null && targetStage !== null) {
    if (!updatedFeature.started) updatedFeature.started = today;
  }
  if (targetStage === 'done') {
    if (!updatedFeature.finished) updatedFeature.finished = today;
  }

  const updatedFeaturesList = featuresList.map((f, idx2) => (idx2 === featureIdx ? updatedFeature : f));
  const updatedRoadmapFm = {
    ...roadmapFm,
    updated: today,
    features: updatedFeaturesList,
  };

  // feature.md mirror (only if the directory/file exists already — creation
  // of new feature.md files is out of scope for Wave 2 per FR-015/FR-017).
  const featureMd = readProductFeature(dir, id);
  let updatedFeatureMdContent = null;
  let featureMdFile = null;
  if (featureMd) {
    featureMdFile = featureMd.file;
    const updatedFeatureFm = {
      ...featureMd.fm,
      stage: targetStage,
      status: derivedStatus,
      started: updatedFeature.started !== undefined ? updatedFeature.started : featureMd.fm.started,
      finished: updatedFeature.finished !== undefined ? updatedFeature.finished : featureMd.fm.finished,
    };
    const fmStr = serializeNestedFrontmatter(updatedFeatureFm, PRODUCT_FEATURE_KEY_ORDER);
    updatedFeatureMdContent = `---\n${fmStr}\n---\n${featureMd.body.startsWith('\n') ? '' : '\n'}${featureMd.body}`;
  }

  // reservations.json mirror (best-effort, silently skipped if no matching
  // code_scope reservation exists for this feature id).
  const reservationsFilePath = path.join(process.cwd(), '.a1', 'reservations.json');
  let updatedReservationsData = null;
  if (fs.existsSync(reservationsFilePath)) {
    const resData = loadReservations(reservationsFilePath);
    const resIdx = resData.reservations.findIndex((r) => r.type === 'code_scope' && r.by === id);
    if (resIdx !== -1) {
      const resExisting = resData.reservations[resIdx];
      const resCurrentIdx = CODE_SCOPE_STAGES.indexOf(resExisting.stage);
      const resNextIdx = CODE_SCOPE_STAGES.indexOf(targetStage);
      // Mirror the SAME stage value ROADMAP just decided — do not re-derive
      // a divergent forward-only decision here, just skip mirroring if this
      // reservation is somehow already ahead (defensive; should not happen
      // in practice since ROADMAP is the source of truth for this command).
      if (resCurrentIdx === -1 || resNextIdx >= resCurrentIdx) {
        const updatedRes = { ...resExisting, stage: targetStage };
        updatedReservationsData = {
          reservations: resData.reservations.map((r, i3) => (i3 === resIdx ? updatedRes : r)),
        };
      }
    }
  }

  // Changelog auto-append (FR-010, Wave 3): only on an ACTUAL stage change,
  // never on an idempotent same-stage re-set (keeps the changelog honest and
  // matches the idempotent-dates-unchanged contract already tested in Wave 2).
  const stageActuallyChanged = currentStage !== targetStage;
  const { writes, roadmapContent: updatedRoadmapContent } = stageActuallyChanged
    ? buildRoadmapWritesWithChangelog(
        dir,
        updatedRoadmapFm,
        roadmapBody,
        `${id} -> ${targetStage}`,
        'stage transition via `product stage`'
      )
    : (() => {
        const { indexJson, nextMd } = regenerateDerived(dir, updatedRoadmapFm);
        const roadmapFmStr = serializeNestedFrontmatter(updatedRoadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
        const content = `---\n${roadmapFmStr}\n---\n${roadmapBody.startsWith('\n') ? '' : '\n'}${roadmapBody}`;
        return {
          writes: [
            { target: roadmapFile, content },
            { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
            { target: path.join(dir, 'NEXT.md'), content: nextMd },
          ],
          roadmapContent: content,
        };
      })();

  if (updatedFeatureMdContent !== null) {
    writes.push({ target: featureMdFile, content: updatedFeatureMdContent });
  }
  if (updatedReservationsData !== null) {
    writes.push({
      target: reservationsFilePath,
      content: JSON.stringify(updatedReservationsData, null, 2) + '\n',
    });
  }

  writeAllOrNothing(lockPath, writes, 'product stage');
  void updatedRoadmapContent;

  const out = {
    status: 'OK',
    feature: id,
    stage: targetStage,
    derived_status: derivedStatus,
    skipped,
    files_written: writes.map((w) => w.target),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

const MILESTONE_STATUS_VALUES = ['planned', 'in-progress', 'done'];
const PROJECT_STATUS_VALUES = ['active', 'paused', 'done'];

/** product markers --level <project|milestone|feature> [--id <id>] [--set <marker>]
 * (FR-007). With no --set: read-only report of the 3 marker levels — roadmap
 * `next` cursor / project `status`, per-milestone `status`, per-feature
 * `stage` — as JSON, plus warnings[] for detected inconsistencies (e.g.
 * `next` pointing at a done/cancelled feature; an in-flight feature with no
 * matching code_scope reservation). Never mutates any file in this mode.
 * With --set: writes the marker at the given level under the same
 * lock+tmp/rename transaction as `product stage`/`product changelog`, then
 * calls regenerateDerived (index.json + NEXT.md) — matching the Wave 3
 * brief's explicit contract ("writing under the same lock and calling
 * regenerateDerived after"). --level and --set require --id except at
 * project level (there is only one project). Feature-level --set only
 * updates the feature-stage marker directly (bypassing product stage's
 * forward-only stage-transition guard and reservations.json/feature.md
 * mirroring) — use `product stage` instead when those guarantees matter. */
function cmdProductMarkers(args) {
  const flags = parseFlags(args, { dir: 'value', level: 'value', id: 'value', set: 'value' });
  if (flags.set !== undefined) {
    return cmdProductMarkersSet(flags);
  }
  const dir = productDirFromFlags(flags);
  const roadmap = readProductRoadmap(dir);
  if (!roadmap) {
    fail(`product markers: ${path.join(dir, 'ROADMAP.md')} not found`);
  }
  const fm = roadmap.fm;
  const milestones = Array.isArray(fm.milestones) ? fm.milestones : [];
  const features = Array.isArray(fm.features) ? fm.features : [];

  const warnings = [];

  const nextId = fm.next !== undefined ? fm.next : null;
  if (nextId !== null) {
    const nextFeature = features.find((f) => f.id === nextId);
    if (!nextFeature) {
      warnings.push(`next cursor '${nextId}' does not match any feature id in ROADMAP.md`);
    } else if (nextFeature.status === 'done' || nextFeature.status === 'cancelled') {
      warnings.push(`next cursor '${nextId}' points at a feature with status '${nextFeature.status}' (should point at a not-yet-done feature)`);
    }
  }

  const reservationsFilePath = path.join(process.cwd(), '.a1', 'reservations.json');
  let reservationsById = new Map();
  if (fs.existsSync(reservationsFilePath)) {
    const resData = loadReservations(reservationsFilePath);
    reservationsById = new Map(
      resData.reservations.filter((r) => r.type === 'code_scope').map((r) => [r.by, r])
    );
  }

  for (const f of features) {
    if (f.status === 'in-flight' && !reservationsById.has(f.id)) {
      warnings.push(`feature '${f.id}' has status 'in-flight' but no matching code_scope reservation in .a1/reservations.json`);
    }
    if (f.status === 'in-flight' && (f.stage === null || f.stage === undefined)) {
      warnings.push(`feature '${f.id}' has status 'in-flight' but stage is null`);
    }
  }

  const out = {
    project: { id: fm.project, title: fm.title, status: fm.status, marker: 'project-status', value: fm.status },
    next_cursor: { level: 'project', value: nextId },
    milestones: milestones.map((m) => ({ id: m.id, marker: 'milestone-status', value: m.status })),
    features: features.map((f) => ({ id: f.id, marker: 'feature-stage', value: f.stage !== undefined ? f.stage : null, status: f.status })),
    warnings,
  };

  if (flags.level) {
    if (!['project', 'milestone', 'feature'].includes(flags.level)) {
      usage(`product markers --level must be one of: project|milestone|feature (got: ${flags.level})`);
    }
    if (flags.level === 'milestone' && flags.id) {
      out.filtered = out.milestones.filter((m) => m.id === flags.id);
    } else if (flags.level === 'feature' && flags.id) {
      out.filtered = out.features.filter((f) => f.id === flags.id);
    }
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

/** Write path for `product markers --set` (FR-007). Split out of
 * cmdProductMarkers to keep the read-only report path unchanged. Validates
 * --level/--id/--set, updates the target marker under the same
 * lock+tmp/rename transaction as `product stage`/`product changelog`
 * (including a changelog line + regenerateDerived), then exits. */
function cmdProductMarkersSet(flags) {
  if (!flags.level) {
    usage('product markers --set requires --level <project|milestone|feature>');
  }
  if (!['project', 'milestone', 'feature'].includes(flags.level)) {
    usage(`product markers --level must be one of: project|milestone|feature (got: ${flags.level})`);
  }
  if (flags.level !== 'project' && !flags.id) {
    usage(`product markers --level ${flags.level} --set requires --id <id>`);
  }

  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product markers: ${roadmapFile} not found`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);

  const today = nowIso().slice(0, 10);
  let updatedRoadmapFm;
  let changelogWhat;

  if (flags.level === 'project') {
    if (!PROJECT_STATUS_VALUES.includes(flags.set)) {
      failWithLock(
        lockPath,
        `product markers --level project --set must be one of: ${PROJECT_STATUS_VALUES.join('|')} (got: ${flags.set})`
      );
    }
    updatedRoadmapFm = { ...roadmapFm, status: flags.set, updated: today };
    changelogWhat = `project status -> ${flags.set}`;
  } else if (flags.level === 'milestone') {
    const milestones = Array.isArray(roadmapFm.milestones) ? roadmapFm.milestones : [];
    const idx = milestones.findIndex((m) => m.id === flags.id);
    if (idx === -1) {
      failWithLock(lockPath, `product markers: milestone '${flags.id}' not found in ${roadmapFile}`);
    }
    if (!MILESTONE_STATUS_VALUES.includes(flags.set)) {
      failWithLock(
        lockPath,
        `product markers --level milestone --set must be one of: ${MILESTONE_STATUS_VALUES.join('|')} (got: ${flags.set})`
      );
    }
    const updatedMilestones = milestones.map((m, i) => (i === idx ? { ...m, status: flags.set } : m));
    updatedRoadmapFm = { ...roadmapFm, milestones: updatedMilestones, updated: today };
    changelogWhat = `milestone ${flags.id} status -> ${flags.set}`;
  } else {
    // feature level: sets the feature-stage marker directly. Unlike
    // `product stage`, this does not enforce forward-only transitions and
    // does not mirror reservations.json/feature.md — it is the lightweight
    // marker writer the Wave 3 brief specifies; use `product stage` when
    // those additional guarantees are required.
    const features = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];
    const idx = features.findIndex((f) => f.id === flags.id);
    if (idx === -1) {
      failWithLock(lockPath, `product markers: feature '${flags.id}' not found in ${roadmapFile}`);
    }
    if (!CODE_SCOPE_STAGES.includes(flags.set)) {
      failWithLock(
        lockPath,
        `product markers --level feature --set must be one of: ${CODE_SCOPE_STAGES.join('|')} (got: ${flags.set})`
      );
    }
    const updatedFeatures = features.map((f, i) => (i === idx ? { ...f, stage: flags.set } : f));
    updatedRoadmapFm = { ...roadmapFm, features: updatedFeatures, updated: today };
    changelogWhat = `feature ${flags.id} stage marker -> ${flags.set}`;
  }

  const { writes } = buildRoadmapWritesWithChangelog(
    dir,
    updatedRoadmapFm,
    roadmapBody,
    changelogWhat,
    'marker set via `product markers --set`'
  );
  writeAllOrNothing(lockPath, writes, 'product markers');

  const out = {
    status: 'OK',
    level: flags.level,
    id: flags.id || null,
    set: flags.set,
    files_written: writes.map((w) => w.target),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product changelog --entry "<what>" --why "<why>" [--dir]: appends a
 * changelog line to ROADMAP.md, rotating overflow beyond 100 entries to
 * CHANGELOG-archive.md, and regenerates index.json/NEXT.md — all under the
 * same lock + tmp/rename transaction as `product stage` (FR-010). */
function cmdProductChangelog(args) {
  const flags = parseFlags(args, { entry: 'value', why: 'value', dir: 'value' });
  if (!flags.entry || !flags.why) {
    usage('product changelog requires --entry "<what>" --why "<why>"');
  }
  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product changelog: ${roadmapFile} not found`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);

  const today = nowIso().slice(0, 10);
  const updatedRoadmapFm = { ...roadmapFm, updated: today };

  const { writes } = buildRoadmapWritesWithChangelog(dir, updatedRoadmapFm, roadmapBody, flags.entry, flags.why);
  writeAllOrNothing(lockPath, writes, 'product changelog');

  const out = { status: 'OK', entry: flags.entry, why: flags.why, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product init --project <slug> --title <t> [--dir]: scaffold a brand-new
 * docs/product/ROADMAP.md skeleton (schema v1, empty milestones/features) +
 * NEXT.md + index.json. Refuses if ROADMAP.md already exists (FR-017: new =
 * scaffold once, never re-scaffold over an existing contract). */
function cmdProductInit(args) {
  const flags = parseFlags(args, { project: 'value', title: 'value', dir: 'value' });
  if (!flags.project || !flags.title) {
    usage('product init requires --project <slug> --title <title>');
  }
  assertSlug(flags.project, 'project');
  const dir = productDirFromFlags(flags);
  const roadmapFile = path.join(dir, 'ROADMAP.md');

  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  // Overwrite guard MUST run inside the locked section (TOCTOU fix, same
  // pattern as `product import`): otherwise two concurrent `product init`
  // runs could both pass this check before either held the lock.
  if (fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product init: ${roadmapFile} already exists — refusing to overwrite (use add-milestone/add-feature to extend, or product stage to progress it)`);
  }

  const today = nowIso().slice(0, 10);
  const roadmapFm = {
    schema_version: 1,
    type: 'roadmap',
    project: flags.project,
    title: flags.title,
    status: 'active',
    updated: today,
    source: 'scaffolded by a1-tools product init',
    milestones: [],
    features: [],
    next: null,
  };
  const body = `\n# ${flags.title}\n\n## Milestones\n\n(none yet — use \`product add-milestone\`)\n\n## In-flight features\n\nNone.\n\n## Changelog\n\n- **${today}** — project initialized — scaffolded by \`product init\`\n\n## Appendix — migrated details\n\n(none)\n`;

  const roadmapFmStr = serializeNestedFrontmatter(roadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
  const roadmapContent = `---\n${roadmapFmStr}\n---\n${body}`;
  const { indexJson, nextMd } = regenerateDerived(dir, roadmapFm);

  const writes = [
    { target: roadmapFile, content: roadmapContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  writeAllOrNothing(lockPath, writes, 'product init');

  const out = { status: 'OK', project: flags.project, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product add-milestone --id <slug> --title <t> [--target YYYY-MM] [--goal <s>]:
 * append a new milestone entry to an existing ROADMAP.md's milestones[] list. */
function cmdProductAddMilestone(args) {
  const flags = parseFlags(args, { id: 'value', title: 'value', target: 'value', goal: 'value', status: 'value', dir: 'value' });
  if (!flags.id || !flags.title) {
    usage('product add-milestone requires --id <slug> --title <title>');
  }
  assertSlug(flags.id, 'milestone');
  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product add-milestone: ${roadmapFile} not found (run \`product init\` first)`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);
  const milestones = Array.isArray(roadmapFm.milestones) ? roadmapFm.milestones : [];
  if (milestones.some((m) => m.id === flags.id)) {
    failWithLock(lockPath, `product add-milestone: milestone '${flags.id}' already exists`);
  }

  const newMilestone = {
    id: flags.id,
    title: flags.title,
    status: flags.status || 'planned',
    target: flags.target || null,
  };
  const updatedRoadmapFm = {
    ...roadmapFm,
    updated: nowIso().slice(0, 10),
    milestones: [...milestones, newMilestone],
  };

  const { writes } = buildRoadmapWritesWithChangelog(
    dir,
    updatedRoadmapFm,
    roadmapBody,
    `milestone '${flags.id}' added`,
    flags.goal || 'new milestone via `product add-milestone`'
  );
  writeAllOrNothing(lockPath, writes, 'product add-milestone');

  const out = { status: 'OK', milestone: flags.id, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product add-feature --id <###-slug> --milestone <m> --title <t>
 * [--goal <s>] [--depends-on a,b]: append a new feature entry to an existing
 * ROADMAP.md's features[] list (schema-v1 shape, all fields present). */
function cmdProductAddFeature(args) {
  const flags = parseFlags(args, {
    id: 'value', milestone: 'value', title: 'value', goal: 'value',
    'depends-on': 'value', status: 'value', dir: 'value',
  });
  if (!flags.id || !flags.milestone || !flags.title) {
    usage('product add-feature requires --id <###-slug> --milestone <m-slug> --title <title>');
  }
  assertSlug(flags.id, 'feature-id');
  assertSlug(flags.milestone, 'milestone');
  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product add-feature: ${roadmapFile} not found (run \`product init\` first)`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);
  const milestones = Array.isArray(roadmapFm.milestones) ? roadmapFm.milestones : [];
  const features = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];

  if (!milestones.some((m) => m.id === flags.milestone)) {
    failWithLock(lockPath, `product add-feature: milestone '${flags.milestone}' does not exist — add it first via \`product add-milestone\``);
  }
  if (features.some((f) => f.id === flags.id)) {
    failWithLock(lockPath, `product add-feature: feature '${flags.id}' already exists`);
  }

  const dependsOn = flags['depends-on']
    ? flags['depends-on'].split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const newFeature = {
    id: flags.id,
    milestone: flags.milestone,
    title: flags.title,
    status: flags.status || 'planned',
    stage: null,
    depends_on: dependsOn,
    started: null,
    finished: null,
    spec_path: null,
    plan_path: null,
  };
  const updatedRoadmapFm = {
    ...roadmapFm,
    updated: nowIso().slice(0, 10),
    features: [...features, newFeature],
  };

  const { writes } = buildRoadmapWritesWithChangelog(
    dir,
    updatedRoadmapFm,
    roadmapBody,
    `feature '${flags.id}' added`,
    flags.goal || 'new feature via `product add-feature`'
  );
  writeAllOrNothing(lockPath, writes, 'product add-feature');

  const out = { status: 'OK', feature: flags.id, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

/** product feature-init --id <###-slug> [--spec-path <p>] [--plan-path <p>]:
 * creates docs/product/features/<id>/feature.md (schema-v1 frontmatter),
 * mirroring the ROADMAP.md features[] entry for <id> (FR-015/FR-017 —
 * on-touch creation, never big-bang). The feature must already be present
 * in ROADMAP.md features[] (via add-feature or init). */
function cmdProductFeatureInit(args) {
  const flags = parseFlags(args, { id: 'value', 'spec-path': 'value', 'plan-path': 'value', dir: 'value' });
  if (!flags.id) {
    usage('product feature-init requires --id <###-feature-slug>');
  }
  assertSlug(flags.id, 'feature-id');
  const dir = productDirFromFlags(flags);
  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product feature-init: ${roadmapFile} not found`);
  }
  const roadmapContent = fs.readFileSync(roadmapFile, 'utf8');
  const { fm: roadmapFm, body: roadmapBody } = parseNestedFrontmatter(roadmapContent);
  const features = Array.isArray(roadmapFm.features) ? roadmapFm.features : [];
  const feature = features.find((f) => f.id === flags.id);
  if (!feature) {
    failWithLock(lockPath, `product feature-init: feature '${flags.id}' not found in ${roadmapFile} — add it first via \`product add-feature\``);
  }

  const featureDir = path.join(dir, 'features', flags.id);
  const featureFile = path.join(featureDir, 'feature.md');
  if (fs.existsSync(featureFile)) {
    failWithLock(lockPath, `product feature-init: ${featureFile} already exists`);
  }

  const specPath = flags['spec-path'] || null;
  const planPath = flags['plan-path'] || null;

  const featureFm = {
    id: feature.id,
    project: roadmapFm.project,
    milestone: feature.milestone,
    title: feature.title,
    status: feature.status,
    stage: feature.stage !== undefined ? feature.stage : null,
    depends_on: Array.isArray(feature.depends_on) ? feature.depends_on : [],
    started: feature.started !== undefined ? feature.started : null,
    finished: feature.finished !== undefined ? feature.finished : null,
    spec_path: specPath,
    plan_path: planPath,
    schema_version: 1,
  };
  const featureFmStr = serializeNestedFrontmatter(featureFm, PRODUCT_FEATURE_KEY_ORDER);
  const featureContent = `---\n${featureFmStr}\n---\n\n${feature.title} — feature summary (fill in).\n`;

  // Mirror spec_path/plan_path onto the ROADMAP.md features[] entry too, so
  // index.json regeneration (which reads feature.md OR the frontmatter
  // fallback) is consistent even before the next `product stage` call.
  const updatedFeature = { ...feature, spec_path: specPath !== null ? specPath : feature.spec_path, plan_path: planPath !== null ? planPath : feature.plan_path };
  const updatedFeatures = features.map((f) => (f.id === flags.id ? updatedFeature : f));
  const updatedRoadmapFm = { ...roadmapFm, updated: nowIso().slice(0, 10), features: updatedFeatures };

  const { writes } = buildRoadmapWritesWithChangelog(
    dir,
    updatedRoadmapFm,
    roadmapBody,
    `feature.md created for '${flags.id}'`,
    'formal spec/plan attached via `product feature-init`'
  );
  writes.push({ target: featureFile, content: featureContent });
  writeAllOrNothing(lockPath, writes, 'product feature-init');

  const out = { status: 'OK', feature: flags.id, files_written: writes.map((w) => w.target) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

// ---------------------------------------------------------------------------
// product validate — schema-v1 frontmatter validation (FR-021 round-trip
// oracle; also usable standalone). Hand-rolled against the contract in
// docs/product/SCHEMA.md section 1 / docs/product/index.schema.json — this
// file has zero npm dependencies (see require() list at the top), so this is
// a purpose-built checker rather than a generic JSON-Schema engine. Field
// names/rules are kept in lockstep with index.schema.json by design; if that
// file's contract changes, update both.
// ---------------------------------------------------------------------------

// PRODUCT_SLUG_RE / FEATURE_ID_RE are defined earlier (near
// productDirFromFlags/assertSlug) so the write-path command handlers can
// use them ahead of this validate section.
const YYYY_MM_RE = /^[0-9]{4}-[0-9]{2}$/;
const YYYY_MM_DD_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const PROJECT_STATUSES = new Set(['active', 'paused', 'done']);
const MILESTONE_STATUSES = new Set(['done', 'in-progress', 'planned']);
const FEATURE_STATUSES = new Set(['done', 'in-flight', 'planned', 'cancelled']);
const FEATURE_STAGES = new Set([null, 'started', 'complete', 'review', 'verify', 'merge', 'origin-cleanup', 'done']);

/** Validate a parsed ROADMAP.md frontmatter object against the schema-v1
 * contract (docs/product/SCHEMA.md section 1). Pure — no I/O. Returns
 * { valid, errors } where errors is a flat array of human-readable strings
 * (empty when valid). Used by both `product validate` and `product import`
 * (import validates its own output before writing — see FR-021 AC "round-
 * trips through schema validation"). */
function validateRoadmapFm(fm) {
  const errors = [];
  const req = (key, ok, msg) => {
    if (!ok) errors.push(`${key}: ${msg}`);
  };

  if (fm.schema_version !== 1) errors.push(`schema_version: must be integer 1, got ${JSON.stringify(fm.schema_version)}`);
  if (fm.type !== 'roadmap') errors.push(`type: must be "roadmap", got ${JSON.stringify(fm.type)}`);
  req('project', typeof fm.project === 'string' && PRODUCT_SLUG_RE.test(fm.project), `must be kebab-case slug, got ${JSON.stringify(fm.project)}`);
  req('title', typeof fm.title === 'string' && fm.title.length > 0, 'must be a non-empty string');
  req('status', PROJECT_STATUSES.has(fm.status), `must be one of ${[...PROJECT_STATUSES].join('|')}, got ${JSON.stringify(fm.status)}`);
  req('updated', typeof fm.updated === 'string' && YYYY_MM_DD_RE.test(fm.updated), `must be YYYY-MM-DD, got ${JSON.stringify(fm.updated)}`);
  req('source', typeof fm.source === 'string' && fm.source.length > 0, 'must be a non-empty provenance string');

  const milestones = Array.isArray(fm.milestones) ? fm.milestones : null;
  req('milestones', milestones !== null, 'must be an array');
  const milestoneIds = new Set();
  if (milestones) {
    milestones.forEach((m, i) => {
      const p = `milestones[${i}]`;
      req(`${p}.id`, typeof m.id === 'string' && PRODUCT_SLUG_RE.test(m.id), `must be kebab-case slug, got ${JSON.stringify(m.id)}`);
      req(`${p}.title`, typeof m.title === 'string' && m.title.length > 0, 'must be a non-empty string');
      req(`${p}.status`, MILESTONE_STATUSES.has(m.status), `must be one of ${[...MILESTONE_STATUSES].join('|')}, got ${JSON.stringify(m.status)}`);
      req(`${p}.target`, m.target === null || (typeof m.target === 'string' && YYYY_MM_RE.test(m.target)), `must be YYYY-MM or null, got ${JSON.stringify(m.target)}`);
      if (typeof m.id === 'string') milestoneIds.add(m.id);
    });
  }

  const features = Array.isArray(fm.features) ? fm.features : null;
  req('features', features !== null, 'must be an array');
  const featureIds = new Set();
  if (features) {
    features.forEach((f, i) => {
      const p = `features[${i}]`;
      req(`${p}.id`, typeof f.id === 'string' && FEATURE_ID_RE.test(f.id), `must be ###-kebab-slug, got ${JSON.stringify(f.id)}`);
      req(`${p}.milestone`, typeof f.milestone === 'string' && milestoneIds.has(f.milestone), `must reference an existing milestones[].id, got ${JSON.stringify(f.milestone)}`);
      req(`${p}.title`, typeof f.title === 'string' && f.title.length > 0, 'must be a non-empty string');
      req(`${p}.status`, FEATURE_STATUSES.has(f.status), `must be one of ${[...FEATURE_STATUSES].join('|')}, got ${JSON.stringify(f.status)}`);
      req(`${p}.stage`, FEATURE_STAGES.has(f.stage === undefined ? null : f.stage), `must be one of ${[...FEATURE_STAGES].map(String).join('|')}, got ${JSON.stringify(f.stage)}`);
      req(`${p}.depends_on`, Array.isArray(f.depends_on), 'must be an array');
      req(`${p}.started`, f.started === null || (typeof f.started === 'string' && YYYY_MM_DD_RE.test(f.started)), `must be YYYY-MM-DD or null, got ${JSON.stringify(f.started)}`);
      req(`${p}.finished`, f.finished === null || (typeof f.finished === 'string' && YYYY_MM_DD_RE.test(f.finished)), `must be YYYY-MM-DD or null, got ${JSON.stringify(f.finished)}`);
      if (typeof f.id === 'string') featureIds.add(f.id);
    });
    // depends_on referential check (second pass — needs full featureIds set).
    features.forEach((f, i) => {
      const p = `features[${i}]`;
      if (Array.isArray(f.depends_on)) {
        f.depends_on.forEach((dep) => {
          if (!featureIds.has(dep)) errors.push(`${p}.depends_on: references unknown feature id ${JSON.stringify(dep)}`);
        });
      }
    });
  }

  req('next', fm.next === null || (typeof fm.next === 'string' && featureIds.has(fm.next)), `must be null or an existing features[].id, got ${JSON.stringify(fm.next)}`);

  return { valid: errors.length === 0, errors };
}

// German-marker heuristic (FR-016 English-only lint) — reuses the exact
// proven pattern from the M8 OSS-Ready German->English sweep gate (see
// .a1/phases/M8-launch-community/PLAN.md Wave 2 Task 2.1): umlauts/ß plus a
// short list of common German function words surrounded by spaces. That
// sweep's own retro (skills/a1-execute/_learning.md, M8 entry) notes this
// grep has false-negative risk (umlaut-free German sentences without any of
// the listed function words can slip through) — acceptable here because this
// is an explicitly best-effort lint (flag, never hard-block), not a proof of
// absence. False positives on English text that happens to contain a listed
// substring as part of a foreign proper noun are likewise accepted per
// FR-016's intent (catch accidental full-German writes, not every borrowed
// word).
const GERMAN_MARKER_RE = /[äöüßÄÖÜ]| (der|die|das|und|nicht|wird|noch|schon|dann|wenn|für|über) /;

/** Best-effort English-only lint (FR-016): scan `content` (a docs/product/
 * file's full text — frontmatter + body) for strong German-language markers.
 * Returns a warning string, or null when no marker was found. Pure — no I/O.
 * Not a hard gate: callers surface this as a warning, never as a validation
 * error, since prose bodies can't be perfectly language-detected and
 * FR-016's intent is to catch accidental full-German writes, not to police
 * every line. */
function detectGermanMarkers(content, label) {
  if (!GERMAN_MARKER_RE.test(content)) return null;
  return `${label}: contains German-language markers (umlauts/ß or common German function words) — docs/product/ artifacts must be authored in English (FR-016). Best-effort lint; review for accidental German prose.`;
}

/** product validate [--dir docs/product]: read-only schema-v1 check of
 * <dir>/ROADMAP.md frontmatter against docs/product/SCHEMA.md section 1 /
 * index.schema.json, plus a best-effort FR-016 English-only lint (warning
 * only, never affects `valid`/exit code). The FR-016 lint covers ALL
 * docs/product/ artifact types named by the FR — ROADMAP.md, NEXT.md,
 * index.json (scanned as raw text; a German string value still trips the
 * marker regex), and every features/<###>-<slug>/feature.md — not just
 * ROADMAP.md. Never writes any file. Exit: 0 valid, 1 invalid or
 * ROADMAP.md missing. */
function cmdProductValidate(args) {
  const flags = parseFlags(args, { dir: 'value' });
  const dir = productDirFromFlags(flags);
  const roadmapFile = path.join(dir, 'ROADMAP.md');
  if (!fs.existsSync(roadmapFile)) {
    process.stdout.write(JSON.stringify({ valid: false, errors: [`ROADMAP.md not found at ${roadmapFile}`] }, null, 2) + '\n');
    process.exit(1);
  }
  const content = fs.readFileSync(roadmapFile, 'utf8');
  const { fm } = parseNestedFrontmatter(content);
  const { valid, errors } = validateRoadmapFm(fm);
  const warnings = [];
  const germanWarning = detectGermanMarkers(content, path.basename(roadmapFile));
  if (germanWarning) warnings.push(germanWarning);

  // FR-016 scan sweep — the remaining docs/product/ artifact types.
  const nextFile = path.join(dir, 'NEXT.md');
  if (fs.existsSync(nextFile)) {
    const w = detectGermanMarkers(fs.readFileSync(nextFile, 'utf8'), 'NEXT.md');
    if (w) warnings.push(w);
  }
  const indexFile = path.join(dir, 'index.json');
  if (fs.existsSync(indexFile)) {
    const w = detectGermanMarkers(fs.readFileSync(indexFile, 'utf8'), 'index.json');
    if (w) warnings.push(w);
  }
  const featuresDir = path.join(dir, 'features');
  if (fs.existsSync(featuresDir)) {
    for (const entry of fs.readdirSync(featuresDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const featureFile = path.join(featuresDir, entry.name, 'feature.md');
      if (!fs.existsSync(featureFile)) continue;
      const w = detectGermanMarkers(fs.readFileSync(featureFile, 'utf8'), `features/${entry.name}/feature.md`);
      if (w) warnings.push(w);
    }
  }

  process.stdout.write(JSON.stringify({ valid, errors, warnings, file: roadmapFile }, null, 2) + '\n');
  process.exit(valid ? 0 : 1);
}

// ---------------------------------------------------------------------------
// product import — migrate a legacy hand-rolled roadmap (either of the two
// observed shapes) into a valid schema-v1 docs/product/ROADMAP.md (FR-021,
// FR-022, SC-006, Wave 6).
//
// ONE code path handles both shapes (FR-021 AC: "via one code path, not one
// per consumer"): parseLegacyRoadmap() sniffs the shape, extracts a common
// intermediate representation (milestones + features + un-mappable notes),
// and a single normalizer turns that IR into schema-v1 frontmatter + body.
// Only the shape-specific EXTRACTION step branches; normalization, Appendix
// handling, and the write path are shared.
//
// Shape A — hand-written HTML (Niimo-style): a Frappe-Gantt page with a
//   `const tasks = [...]` JS array literal. Each task becomes one feature;
//   there is no milestone/status vocabulary in the source, so all tasks land
//   under one synthesized milestone and status is inferred from `progress`
//   (100 -> done, else planned) and `custom_class` (gate/active hints go to
//   the Appendix as free-text, since schema-v1 has no gate/blocker concept).
//
// Shape B — data.json + generator (A1/office-style): a JSON document with
//   `S4_phases.phases[].epics[].stories[]`. Each PHASE becomes one milestone;
//   each STORY becomes one feature (status mapped planned/doing/done ->
//   planned/in-flight/done). Story-point badges, epic groupings, and every
//   other S1/S2/S3/S5-S10 section (vision, live-status cards, SVG diagrams,
//   comparison tables, dispatch matrix, changelog) have no schema-v1 home and
//   are preserved verbatim in the Appendix (FR-022).
// ---------------------------------------------------------------------------

/** Detect which legacy shape `content` (already-read file text) matches.
 * Returns 'html-tasks' | 'data-json' | null (unrecognized). Pure. */
function detectLegacyRoadmapShape(content, filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.json') {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && parsed.S4_phases && Array.isArray(parsed.S4_phases.phases)) {
        return 'data-json';
      }
    } catch (_e) {
      // not valid JSON — fall through to null
    }
    return null;
  }
  if (/const\s+tasks\s*=\s*\[/.test(content)) {
    return 'html-tasks';
  }
  return null;
}

/** Extract a slug-safe id fragment from arbitrary source text (task id,
 * story text, …). Lowercases, strips non-alphanumerics to hyphens, trims
 * repeats/edges, and truncates so generated feature ids stay readable. */
function slugifyFragment(s, maxLen) {
  const slug = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLen || 40)
    // Truncation above can re-expose a trailing hyphen (or leave a
    // hyphen run) that the earlier trim already removed — trim again so
    // the result always satisfies FEATURE_ID_RE (###-kebab-slug, no
    // leading/trailing/doubled hyphens).
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

/** Best-effort, non-executing normalization of a JS object/array literal
 * into strict JSON text: quotes bare identifier keys (`id:` -> `"id":`) and
 * drops trailing commas before `]`/`}`. Pure text transformation — no
 * code execution, no eval/Function/vm. Deliberately conservative: it does
 * NOT attempt to handle single-quoted strings, comments, or nested
 * template literals; inputs using those shapes are expected to fail the
 * subsequent JSON.parse and be rejected by the caller rather than silently
 * mis-normalized. */
function normalizeJsLiteralToJson(literal) {
  return literal
    // Bare/unquoted object keys: {id: "x"} / , key: -> "key":. Only matches
    // keys that are plain identifiers directly after `{` or `,` (optionally
    // across whitespace/newlines), so it never touches string contents.
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3')
    // Trailing commas before a closing bracket/brace.
    .replace(/,(\s*[\]}])/g, '$1');
}

/** Extract the `const tasks = [ {...}, {...} ]` JS array literal from a
 * Frappe-Gantt-style HTML page as plain objects, without a JS parser
 * dependency and WITHOUT executing any code: isolates the bracketed
 * literal text via brace-matching, then parses it as JSON (falling back to
 * a whitelisted, regex-only normalization pass for the common non-JSON JS
 * literal shapes — unquoted keys, trailing commas — before re-attempting
 * JSON.parse). If the literal still can't be parsed as JSON after
 * normalization, this fails hard rather than falling back to eval/
 * Function/vm — arbitrary code execution on attacker-controlled HTML input
 * is not an acceptable fallback (see security review finding: `new
 * Function` previously allowed RCE via a crafted `data.json`/HTML import
 * file, e.g. an IIFE with `process.mainModule.require(...)` embedded in a
 * task name). */
function extractTasksArrayLiteral(html) {
  const startMatch = /const\s+tasks\s*=\s*(\[)/.exec(html);
  if (!startMatch) return [];
  let depth = 0;
  let i = startMatch.index + startMatch[0].length - 1; // position of the '['
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const literal = html.slice(start, i);

  try {
    return JSON.parse(literal);
  } catch (_e) {
    // Fall through to the whitelisted normalization pass below.
  }

  try {
    return JSON.parse(normalizeJsLiteralToJson(literal));
  } catch (_e) {
    fail(
      'product import: could not parse tasks array as JSON — unsupported HTML shape '
      + '(only JSON-compatible object/array literals are supported: double-quoted or '
      + 'bare-identifier keys, double-quoted string values, no comments, no computed '
      + 'values, no function calls)'
    );
  }
  return []; // unreachable — fail() exits the process
}

/** Shape A extraction: hand-written HTML (Niimo-style, Frappe-Gantt). Returns
 * the common IR: { milestones, features, appendixNotes }. */
function extractFromHtmlTasks(content, sourceLabel) {
  const tasks = extractTasksArrayLiteral(content);
  const titleMatch = /<title>([^<]*)<\/title>/.exec(content);
  const pageTitle = titleMatch ? titleMatch[1].trim() : 'Imported Roadmap';

  const milestoneId = 'migrated';
  const milestones = [{
    id: milestoneId,
    title: 'Migrated tasks',
    status: 'in-progress',
    target: null,
  }];

  const usedIds = new Set();
  const features = [];
  const appendixNotes = [];
  appendixNotes.push(`Source page title: ${pageTitle}`);

  tasks.forEach((t, idx) => {
    const baseSlug = slugifyFragment(t.id || t.name || `task-${idx + 1}`, 30);
    let slug = baseSlug;
    let n = 2;
    while (usedIds.has(slug)) { slug = `${baseSlug}-${n++}`; }
    usedIds.add(slug);
    const id = `${String(idx + 1).padStart(3, '0')}-${slug}`;

    const progress = typeof t.progress === 'number' ? t.progress : 0;
    const status = progress >= 100 ? 'done' : 'planned';
    const dependsOn = typeof t.dependencies === 'string' && t.dependencies.trim()
      ? t.dependencies.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    features.push({
      id,
      milestone: milestoneId,
      title: t.name || t.id || `Task ${idx + 1}`,
      status,
      stage: null,
      depends_on: [], // resolved to real feature ids in a second pass below
      started: typeof t.start === 'string' && YYYY_MM_DD_RE.test(t.start) ? t.start : null,
      finished: status === 'done' && typeof t.end === 'string' && YYYY_MM_DD_RE.test(t.end) ? t.end : null,
      spec_path: null,
      plan_path: null,
      _legacyTaskId: t.id || null,
      _legacyDependsOnRaw: dependsOn,
    });

    const extras = [];
    if (t.start || t.end) extras.push(`dates ${t.start || '?'} → ${t.end || '?'}`);
    if (t.custom_class) extras.push(`class=${t.custom_class}`);
    if (typeof t.progress === 'number' && t.progress !== 0 && t.progress !== 100) extras.push(`progress=${t.progress}%`);
    if (extras.length > 0) {
      appendixNotes.push(`**${id}** (${t.name || t.id}): ${extras.join(', ')}`);
    }
  });

  // Resolve legacy string dependency ids -> generated feature ids.
  const byLegacyId = new Map(features.map((f) => [f._legacyTaskId, f.id]));
  for (const f of features) {
    f.depends_on = f._legacyDependsOnRaw
      .map((legacyId) => byLegacyId.get(legacyId))
      .filter(Boolean);
    delete f._legacyTaskId;
    delete f._legacyDependsOnRaw;
  }

  // Legend/footer text has no schema home — preserve verbatim.
  const legendMatch = /<div class="legend">([\s\S]*?)<\/div>/.exec(content);
  if (legendMatch) {
    const legendText = legendMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (legendText) appendixNotes.push(`Legend: ${legendText}`);
  }
  const footerMatch = /<footer>([\s\S]*?)<\/footer>/.exec(content);
  if (footerMatch) {
    const footerText = footerMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (footerText) appendixNotes.push(`Footer note: ${footerText}`);
  }

  return {
    title: pageTitle,
    milestones,
    features,
    appendixNotes,
    source: `migrated from ${sourceLabel} (hand-written HTML, Frappe-Gantt)`,
  };
}

const DATAJSON_STORY_STATUS_MAP = { planned: 'planned', doing: 'in-flight', done: 'done' };

/** Shape B extraction: data.json + generator (A1/office-style). Returns the
 * common IR: { milestones, features, appendixNotes }. */
function extractFromDataJson(content, sourceLabel) {
  const data = JSON.parse(content);
  const pageTitle = (data.meta && data.meta.title) || 'Imported Roadmap';
  const phases = (data.S4_phases && data.S4_phases.phases) || [];

  const milestones = phases.map((p) => ({
    id: slugifyFragment(p.key || p.name, 20),
    title: p.name || p.key,
    status: 'planned',
    target: null,
  }));
  // If every story in a phase is done, the phase (milestone) is done; if any
  // story is doing/done, it's in-progress; otherwise it stays planned.
  phases.forEach((p, i) => {
    const stories = (p.epics || []).flatMap((e) => e.stories || []);
    const statuses = stories.map((s) => s.status);
    if (stories.length > 0 && statuses.every((s) => s === 'done')) milestones[i].status = 'done';
    else if (statuses.some((s) => s === 'done' || s === 'doing')) milestones[i].status = 'in-progress';
  });

  const usedIds = new Set();
  const features = [];
  const appendixNotes = [];
  appendixNotes.push(`Source document title: ${pageTitle} (${(data.meta && data.meta.version) || 'unversioned'})`);
  if (data.meta && data.meta.totalSP) appendixNotes.push(`Total story points (source): ${data.meta.totalSP} SP`);

  let featureSeq = 0;
  phases.forEach((p, pi) => {
    const milestoneId = milestones[pi].id;
    (p.epics || []).forEach((epic) => {
      const epicSpTotal = (epic.stories || []).reduce((a, s) => a + (s.sp || 0), 0);
      (epic.stories || []).forEach((story) => {
        featureSeq += 1;
        const baseSlug = slugifyFragment(story.text, 30);
        let slug = baseSlug;
        let n = 2;
        while (usedIds.has(slug)) { slug = `${baseSlug}-${n++}`; }
        usedIds.add(slug);
        const id = `${String(featureSeq).padStart(3, '0')}-${slug}`;
        const status = DATAJSON_STORY_STATUS_MAP[story.status] || 'planned';

        features.push({
          id,
          milestone: milestoneId,
          title: story.text,
          status,
          stage: null,
          depends_on: [],
          started: null,
          finished: null,
          spec_path: null,
          plan_path: null,
        });

        const extras = [`epic: ${epic.name}`, `agent: ${epic.agent || 'unassigned'}`, `${story.sp || 0} SP`];
        appendixNotes.push(`**${id}** (${story.text}): ${extras.join(', ')}`);
      });
      appendixNotes.push(`Epic "${epic.name}" total: ${epicSpTotal} SP, agent: ${epic.agent || 'unassigned'}`);
    });
  });

  // Whole sections with no schema-v1 home (vision, live-status, architecture
  // diagrams, EU-cloud comparison, repo-structure decisions, dispatch
  // matrix, next-steps, changelog) — preserve verbatim per-section (FR-022).
  const noHomeSections = [
    ['S1_vision', 'Vision'], ['S2_live', 'Was ist live'], ['S3_timeline', 'Timeline (SVG-rendered)'],
    ['S5_architecture', 'Architecture diagrams'], ['S6_eucloud', 'EU-Cloud comparison'],
    ['S7_repos', 'Repo-structure decisions'], ['S8_dispatch', 'Dispatch matrix'],
    ['S9_nextsteps', 'Next steps & open decisions'], ['S10_changelog', 'Source changelog'],
  ];
  for (const [key, label] of noHomeSections) {
    if (data[key]) {
      appendixNotes.push(`### ${label} (section \`${key}\`, verbatim JSON)\n\n\`\`\`json\n${JSON.stringify(data[key], null, 2)}\n\`\`\``);
    }
  }

  return {
    title: pageTitle,
    milestones,
    features,
    appendixNotes,
    source: `migrated from ${sourceLabel} (data.json + generator)`,
  };
}

/** ONE code path (FR-021): detect the legacy shape, extract via the
 * shape-specific extractor into a common IR, then normalize into schema-v1
 * roadmap frontmatter + body (with an Appendix section for un-mappable
 * content, FR-022). `project` is the target project slug (schema-v1
 * `project` field — distinct from any id/slug found in the source). Pure —
 * no I/O; caller handles file reads and the atomic write. Throws on an
 * unrecognized shape. */
function parseLegacyRoadmap(content, filePath, project) {
  const shape = detectLegacyRoadmapShape(content, filePath);
  if (!shape) {
    throw new Error(
      `unrecognized legacy roadmap shape in ${filePath} — expected either a hand-written HTML page ` +
      `with a Frappe-Gantt "const tasks = [...]" array, or a data.json with an "S4_phases.phases[]" array`
    );
  }

  const ir = shape === 'html-tasks'
    ? extractFromHtmlTasks(content, filePath)
    : extractFromDataJson(content, filePath);

  const today = nowIso().slice(0, 10);
  const roadmapFm = {
    schema_version: 1,
    type: 'roadmap',
    project,
    title: ir.title,
    status: 'active',
    updated: today,
    source: `${ir.source} (${today})`,
    milestones: ir.milestones,
    features: ir.features.map((f) => ({
      id: f.id, milestone: f.milestone, title: f.title, status: f.status, stage: f.stage,
      depends_on: f.depends_on, started: f.started, finished: f.finished,
      spec_path: f.spec_path, plan_path: f.plan_path,
    })),
    next: (() => {
      const firstEligible = ir.features.find((f) => f.status !== 'done' && f.status !== 'cancelled');
      return firstEligible ? firstEligible.id : null;
    })(),
  };

  const milestoneSections = ir.milestones.map((m) => {
    const feats = ir.features.filter((f) => f.milestone === m.id);
    const featLines = feats.map((f) => {
      const mark = f.status === 'done' ? 'x' : f.status === 'in-flight' ? '~' : ' ';
      const deps = f.depends_on.length > 0 ? ` (depends on: ${f.depends_on.join(', ')})` : '';
      return `- [${mark}] **${f.id}** — ${f.title}: migrated from legacy roadmap${deps}`;
    }).join('\n');
    return `### ${m.title} <!-- entry: ${m.id} -->\nStatus: ${m.status} · Target: ${m.target || 'unset'}\nGoal: migrated from legacy roadmap; goals were not explicit in the source.\n\n**Features:**\n${featLines || '(none)'}`;
  }).join('\n\n');

  const appendixBody = ir.appendixNotes.length > 0
    ? ir.appendixNotes.join('\n\n')
    : '(none)';

  const body = `\n# ${ir.title}\n\n> Migrated from a legacy roadmap format by \`a1-tools product import\`. Review milestone/feature titles and statuses for accuracy.\n\n## Milestones\n\n${milestoneSections}\n\n## In-flight features\n\nNone.\n\n## Changelog\n\n- **${today}** — roadmap migrated — ${ir.source}\n\n## Appendix — migrated details\n\n${appendixBody}\n`;

  return { roadmapFm, body, shape };
}

/** product import --file <path> --project <slug> [--title <t>] [--dir docs/product]:
 * migrate a legacy roadmap (hand-written HTML or data.json+generator shape,
 * auto-detected — FR-021) into a fresh schema-v1 docs/product/ROADMAP.md.
 * Un-mappable source content is preserved under '## Appendix — migrated
 * details' (FR-022). Validates its own output (SC-006 round-trip) before
 * writing — refuses (exit 1) if the generated frontmatter would fail
 * `product validate`. Writes through the same regenerateDerived +
 * writeAllOrNothing path as every other product-mutating command, so
 * index.json/NEXT.md regenerate correctly. Refuses to overwrite an existing
 * ROADMAP.md (same guard as `product init`) — mirrors its "not an update
 * command" contract. */
function cmdProductImport(args) {
  const flags = parseFlags(args, { file: 'value', project: 'value', title: 'value', dir: 'value' });
  if (!flags.file || !flags.project) {
    usage('product import requires --file <path-to-legacy-roadmap> --project <slug>');
  }
  const dir = productDirFromFlags(flags);
  const roadmapFile = path.join(dir, 'ROADMAP.md');
  // Source-file existence is not an overwrite guard on the locked target —
  // it's a precondition on the (unlocked, read-only) input path — so it can
  // stay ahead of the lock.
  if (!fs.existsSync(flags.file)) {
    fail(`product import: source file not found: ${flags.file}`);
  }

  const content = fs.readFileSync(flags.file, 'utf8');
  let parsed;
  try {
    parsed = parseLegacyRoadmap(content, flags.file, flags.project);
  } catch (e) {
    fail(`product import: ${e.message}`);
  }
  if (flags.title) parsed.roadmapFm.title = flags.title;

  const { valid, errors } = validateRoadmapFm(parsed.roadmapFm);
  if (!valid) {
    fail(`product import: generated ROADMAP.md would fail schema-v1 validation (internal bug — please report):\n${errors.join('\n')}`);
  }

  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  // Overwrite guard on the locked target MUST run inside the locked section
  // (TOCTOU fix): two concurrent `product import` runs could otherwise both
  // pass an existsSync check taken before either held the lock, and the
  // second to reach writeAllOrNothing would clobber the first's ROADMAP.md.
  if (fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product import: ${roadmapFile} already exists — refusing to overwrite (use add-milestone/add-feature to extend, or start from an empty --dir)`);
  }

  const roadmapFmStr = serializeNestedFrontmatter(parsed.roadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
  const roadmapContent = `---\n${roadmapFmStr}\n---\n${parsed.body}`;
  const { indexJson, nextMd } = regenerateDerived(dir, parsed.roadmapFm);

  const writes = [
    { target: roadmapFile, content: roadmapContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  writeAllOrNothing(lockPath, writes, 'product import');

  const out = {
    status: 'OK',
    shape_detected: parsed.shape,
    project: flags.project,
    milestones: parsed.roadmapFm.milestones.length,
    features: parsed.roadmapFm.features.length,
    files_written: writes.map((w) => w.target),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

function appendPhaseHistory(fm, phaseName) {
  if (!Array.isArray(fm.phase_history)) fm.phase_history = [];
  const entry = `phase=${phaseName} completed=${nowIso()}`;
  fm.phase_history = fm.phase_history.filter(
    (e) => !(typeof e === 'string' && e.startsWith(`phase=${phaseName} `))
  );
  fm.phase_history.push(entry);
}

// ---------- spec subcommands ----------

function cmdSpecNextNumber(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('spec next-number requires <project-slug>');
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'spec');
  let max = 0;
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(/^(\d{3})-/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  const next = max + 1;
  return {
    project: projectSlug,
    next,
    padded: String(next).padStart(3, '0'),
    dir,
  };
}

const SPEC_STATUS_TO_PHASE = {
  draft: 'discover',
  clarified: 'specify+clarify',
  planned: 'plan',
  'awaiting-consistency-fix': 'consistency-gate-fail',
  implementing: null,
  done: 'implement+verify',
  cancelled: 'cancelled',
};

function cmdSpecUpdateStatus(args) {
  const specPathInput = args[0];
  const newStatus = args[1];
  if (!specPathInput || !newStatus) {
    usage('spec update-status requires <spec-path> <new-status>');
  }
  if (!SPEC_STATUSES.has(newStatus)) {
    usage(
      `invalid spec status "${newStatus}". valid: ${[...SPEC_STATUSES].join(', ')}`
    );
  }
  const flags = parseFlags(args.slice(2), {
    'wave-plan-path': 'value',
    'verify-failures-file': 'value',
    'clear-verify-failures': 'bool',
  });
  const specPath = resolveVaultPath(specPathInput);
  if (!fs.existsSync(specPath)) fail(`spec file not found: ${specPath}`);
  const { fm, body } = readMd(specPath);
  fm.status = newStatus;

  const completedPhase = SPEC_STATUS_TO_PHASE[newStatus];
  if (completedPhase) {
    for (const ph of completedPhase.split('+')) appendPhaseHistory(fm, ph);
  }

  if (flags['wave-plan-path'] !== undefined) {
    fm.wave_plan_path = flags['wave-plan-path'];
  }
  if (flags['clear-verify-failures'] || newStatus === 'done') {
    fm.verify_failures = [];
  }
  if (flags['verify-failures-file']) {
    const raw = fs.readFileSync(flags['verify-failures-file'], 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      fail(`verify-failures-file is not valid JSON: ${e.message}`);
    }
    if (!Array.isArray(parsed)) {
      fail('verify-failures-file must contain a JSON array');
    }
    fm.verify_failures = parsed.map((f) => JSON.stringify(f));
  }

  writeMdAtomic(specPath, fm, body);
  return {
    spec_path: specPath,
    status: fm.status,
    phase_history: fm.phase_history,
    wave_plan_path: fm.wave_plan_path ?? null,
    verify_failures: fm.verify_failures ?? [],
  };
}

function cmdSpecList(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('spec list requires <project-slug>');
  const flags = parseFlags(args.slice(1), { status: 'value' });
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'spec');
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, count: 0, specs: [] };
  }
  const specs = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.match(/^\d{3}-.+\.md$/)) continue;
    const full = path.join(dir, entry);
    let status = 'unknown';
    let title = entry;
    try {
      const { fm } = readMd(full);
      status = fm.status || 'unknown';
      title = fm.title || entry;
    } catch (_e) {
      // ignore
    }
    if (flags.status && status !== flags.status) continue;
    specs.push({ file: entry, path: full, status, title });
  }
  return { project: projectSlug, count: specs.length, specs };
}

// ---------- fix subcommands ----------

function cmdFixNextSuffix(args) {
  const projectSlug = args[0];
  const date = args[1];
  if (!projectSlug || !date) {
    usage('fix next-suffix requires <project-slug> <YYYY-MM-DD>');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage(`invalid date "${date}", expected YYYY-MM-DD`);
  }
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'fixes');
  let used = new Set(); // suffixes used today, "" + "-2" + "-3" ...
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^${date}-.+?(-(\\d+))?\\.md$`);
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(re);
      if (m) {
        used.add(m[2] ? parseInt(m[2], 10) : 1);
      }
    }
  }
  // first bug of day → no suffix; second → -2; third → -3 ...
  let n = 1;
  while (used.has(n)) n++;
  const suffix = n === 1 ? '' : `-${n}`;
  return {
    project: projectSlug,
    date,
    suffix,
    padded: suffix,
    dir,
  };
}

function cmdFixUpdateStatus(args) {
  const bugPathInput = args[0];
  const newStatus = args[1];
  if (!bugPathInput || !newStatus) {
    usage('fix update-status requires <bug-path> <new-status>');
  }
  if (!BUG_STATUSES.has(newStatus)) {
    usage(
      `invalid bug status "${newStatus}". valid: ${[...BUG_STATUSES].join(', ')}`
    );
  }
  const flags = parseFlags(args.slice(2), {
    'recommended-code-agent': 'value',
    'fix-commit': 'value',
    'verify-result': 'value',
    'duplicate-of': 'value',
  });
  const bugPath = resolveVaultPath(bugPathInput);
  if (!fs.existsSync(bugPath)) fail(`bug file not found: ${bugPath}`);
  const { fm, body } = readMd(bugPath);
  fm.status = newStatus;

  // Phase mapping for bug lifecycle.
  const PHASE_MAP = {
    reported: 'report',
    diagnosed: 'diagnose',
    fixing: 'fix-start',
    fixed: 'verify',
    'cant-reproduce': 'cant-reproduce',
    'wont-fix': 'wont-fix',
    duplicate: 'duplicate',
    cancelled: 'cancelled',
  };
  const phase = PHASE_MAP[newStatus];
  if (phase) appendPhaseHistory(fm, phase);

  if (flags['recommended-code-agent'] !== undefined) {
    fm.recommended_code_agent = flags['recommended-code-agent'];
  }
  if (flags['fix-commit'] !== undefined) {
    fm.fix_commit = flags['fix-commit'];
  }
  if (flags['verify-result'] !== undefined) {
    fm.verify_result = flags['verify-result'];
  }
  if (flags['duplicate-of'] !== undefined) {
    fm.duplicate_of = flags['duplicate-of'];
  }

  writeMdAtomic(bugPath, fm, body);
  return {
    bug_path: bugPath,
    status: fm.status,
    phase_history: fm.phase_history,
    recommended_code_agent: fm.recommended_code_agent ?? null,
    fix_commit: fm.fix_commit ?? null,
    verify_result: fm.verify_result ?? null,
    duplicate_of: fm.duplicate_of ?? null,
  };
}

function cmdFixList(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('fix list requires <project-slug>');
  const flags = parseFlags(args.slice(1), {
    status: 'value',
    severity: 'value',
  });
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'fixes');
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, count: 0, bugs: [] };
  }
  const bugs = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.match(/^\d{4}-\d{2}-\d{2}-.+\.md$/)) continue;
    const full = path.join(dir, entry);
    let status = 'unknown';
    let severity = 'unknown';
    let title = entry;
    try {
      const { fm } = readMd(full);
      status = fm.status || 'unknown';
      severity = fm.severity || 'unknown';
      title = fm.title || entry;
    } catch (_e) {
      // ignore
    }
    if (flags.status && status !== flags.status) continue;
    if (flags.severity && severity !== flags.severity) continue;
    bugs.push({ file: entry, path: full, status, severity, title });
  }
  return { project: projectSlug, count: bugs.length, bugs };
}

function cmdFixFindDuplicates(args) {
  const projectSlug = args[0];
  if (!projectSlug) {
    usage('fix find-duplicates requires <project-slug> <symptom-keywords...>');
  }
  const keywords = args.slice(1).filter((s) => s && s.length >= 3);
  if (keywords.length === 0) {
    usage('fix find-duplicates requires at least one keyword (>=3 chars)');
  }
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'fixes');
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, window_days: 30, matches: [] };
  }
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const matches = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.match(/^\d{4}-\d{2}-\d{2}-.+\.md$/)) continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.mtimeMs < cutoff) continue;
    let content = '';
    try {
      content = fs.readFileSync(full, 'utf8').toLowerCase();
    } catch (_e) {
      continue;
    }
    const hits = keywords.filter((k) => content.includes(k.toLowerCase()));
    if (hits.length > 0) {
      let title = entry;
      let status = 'unknown';
      try {
        const { fm } = readMd(full);
        title = fm.title || entry;
        status = fm.status || 'unknown';
      } catch (_e) {}
      matches.push({
        file: entry,
        path: full,
        title,
        status,
        keyword_hits: hits,
        hit_count: hits.length,
      });
    }
  }
  matches.sort((a, b) => b.hit_count - a.hit_count);
  return { project: projectSlug, window_days: 30, matches };
}

// ---------- fix learning-loop subcommands ----------

function postmortemsDir(projectSlug) {
  if (projectSlug) {
    return path.join(vaultRoot(), 'wiki', 'postmortems', projectSlug);
  }
  return path.join(vaultRoot(), 'wiki', 'postmortems');
}

function agentsLockPath() {
  return path.join(vaultRoot(), 'wiki', '_canonical', 'agents.lock.json');
}

function lastPromotePath() {
  return path.join(vaultRoot(), 'wiki', '_state', 'last_promote.json');
}

function cmdFixIntegrityCheck(args) {
  const flags = parseFlags(args, {
    'agents-dir': 'value',
    'skills-dir': 'value',
  });
  const agentsDir = flags['agents-dir'] || path.join(os.homedir(), '.claude', 'agents');
  const skillsDir = flags['skills-dir'] || path.join(os.homedir(), '.claude', 'skills');
  const lockPath = agentsLockPath();

  if (!fs.existsSync(lockPath)) {
    // Bootstrap: write the lock file from current state
    const crypto = require('crypto');
    const hashes = {};
    for (const dir of [agentsDir, skillsDir]) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.md')) continue;
        const full = path.join(dir, entry);
        try {
          const content = fs.readFileSync(full, 'utf8');
          hashes[entry] = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
        } catch (_e) {}
      }
    }
    const lockDir = path.dirname(lockPath);
    if (!fs.existsSync(lockDir)) fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ generated_at: nowIso(), hashes }, null, 2), 'utf8');
    return { status: 'bootstrapped', lock_path: lockPath, file_count: Object.keys(hashes).length };
  }

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const crypto = require('crypto');
  const mismatches = [];
  const current = {};
  for (const dir of [agentsDir, skillsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.md')) continue;
      const full = path.join(dir, entry);
      try {
        const content = fs.readFileSync(full, 'utf8');
        const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
        current[entry] = hash;
        if (lock.hashes[entry] && lock.hashes[entry] !== hash) {
          mismatches.push({ file: entry, expected: lock.hashes[entry], actual: hash });
        }
      } catch (_e) {}
    }
  }
  return {
    status: mismatches.length === 0 ? 'ok' : 'mismatch',
    mismatches,
    files_checked: Object.keys(current).length,
    lock_generated_at: lock.generated_at,
  };
}

function cmdFixInitPostmortem(args) {
  const flags = parseFlags(args, {
    'date': 'value',
    'severity': 'value',
    'root-cause-class': 'value',
    'terminal-status': 'value',
    'one-line-learning': 'value',
    'fix-wave-count': 'value',
    'diagnosis-rounds': 'value',
    'phase-friction': 'value',
    'quak-regression': 'value',
    'fix-required-test-first': 'value',
  });
  const bugSlug = flags._[0];
  const projectSlug = flags._[1];
  if (!bugSlug || !projectSlug) {
    usage('fix init-postmortem <bug-slug> <project-slug> [flags]');
  }
  const date = flags['date'] || new Date().toISOString().slice(0, 10);
  const dir = postmortemsDir(projectSlug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `${date}-${bugSlug}.md`;
  const filePath = path.join(dir, filename);

  const severity = flags['severity'] || 'major';
  const terminalStatus = flags['terminal-status'] || 'fixed';
  const rootCauseClass = flags['root-cause-class'] || 'unknown';
  const oneLineLearning = flags['one-line-learning'] || '';
  const fixWaveCount = flags['fix-wave-count'] || '1';
  const diagnosisRounds = flags['diagnosis-rounds'] || '1';
  const phaseFriction = flags['phase-friction'] || 'diagnose';
  const quakRegression = flags['quak-regression'] || 'skipped';
  const fixRequiredTestFirst = flags['fix-required-test-first'] || 'false';

  const body = `---
type: postmortem
bug_slug: ${bugSlug}
project: ${projectSlug}
date: ${date}
severity: ${severity}
terminal_status: ${terminalStatus}
root_cause_class: [${rootCauseClass}]
fix_wave_count: ${fixWaveCount}
diagnosis_rounds: ${diagnosisRounds}
phase_that_produced_most_friction: ${phaseFriction}
quak_regression: ${quakRegression}
fix_required_test_first: ${fixRequiredTestFirst}
one_line_learning: "${oneLineLearning}"
created_at: ${nowIso()}
---

# Postmortem: ${bugSlug} (${date})

## Bug Summary

<!-- Short description of what was broken -->

## Timeline

| Time | Event |
|------|-------|
| | Reported |
| | Diagnosed |
| | Fixed (commit ) |
| | Verified |

## Root Cause

<!-- One paragraph: what was the technical cause? -->

## Contributing Factors

<!-- What conditions allowed this bug to exist/survive? -->

## What Went Well

<!-- Diagnosis speed, tooling, team response -->

## What Didn't Go Well

<!-- Where did friction come from? -->

## One-Line Learning

${oneLineLearning}

## Suggested Lesson (for promote-lessons to evaluate)

<!-- One concrete, actionable rule that would prevent recurrence -->
`;

  fs.writeFileSync(filePath, body, 'utf8');
  return {
    path: filePath,
    project: projectSlug,
    bug_slug: bugSlug,
    date,
    filename,
  };
}

function cmdFixCountPostmortemsSince(args) {
  const flags = parseFlags(args, { 'since': 'value' });
  const sinceStr = flags['since'] || flags._[0];
  if (!sinceStr) {
    usage('fix count-postmortems-since --since <ISO-timestamp>');
  }
  const sinceMs = new Date(sinceStr).getTime();
  if (isNaN(sinceMs)) usage(`invalid timestamp: ${sinceStr}`);

  const root = path.join(vaultRoot(), 'wiki', 'postmortems');
  if (!fs.existsSync(root)) return { count: 0, since: sinceStr };

  let count = 0;
  const found = [];
  for (const projectDir of fs.readdirSync(root)) {
    const pDir = path.join(root, projectDir);
    if (!fs.statSync(pDir).isDirectory()) continue;
    for (const entry of fs.readdirSync(pDir)) {
      if (!entry.endsWith('.md')) continue;
      const full = path.join(pDir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs >= sinceMs) {
          count++;
          found.push(path.join(projectDir, entry));
        }
      } catch (_e) {}
    }
  }
  return { count, since: sinceStr, files: found };
}

function cmdFixUpdatePromoteState(args) {
  const flags = parseFlags(args, { 'at': 'value' });
  const at = flags['at'] || nowIso();
  const stateDir = path.join(vaultRoot(), 'wiki', '_state');
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  const p = lastPromotePath();
  const data = { last_promote_at: at, updated_at: nowIso() };
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return { last_promote_at: at, path: p };
}

function cmdFixWriteSuggestion(args) {
  const flags = parseFlags(args, {
    'title': 'value',
    'body-file': 'value',
    'body': 'value',
    'source-postmortem': 'value',
    'skill': 'value',
  });
  const agentName = flags._[0];
  if (!agentName) usage('fix write-suggestion <agent-name> [--title <t>] [--body-file <path>|--body <text>] [--source-postmortem <path>] [--skill <name>]');
  const title = flags['title'] || 'Untitled suggestion';
  let body = '';
  if (flags['body-file']) {
    body = fs.readFileSync(flags['body-file'], 'utf8');
  } else if (flags['body']) {
    body = flags['body'];
  }
  const date = new Date().toISOString().slice(0, 10);
  const slugTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const filename = `${date}-${slugTitle}.md`;
  const dir = path.join(vaultRoot(), 'wiki', 'lessons', agentName, '_suggestions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  const content = `---
type: lesson-suggestion
agent: ${agentName}
title: "${title}"
status: pending
date: ${date}
source_postmortem: "${flags['source-postmortem'] || ''}"
skill: "${flags['skill'] || ''}"
created_at: ${nowIso()}
---

# ${title}

${body}
`;
  fs.writeFileSync(filePath, content, 'utf8');
  return { path: filePath, agent: agentName, title, date, filename };
}

// ---------- analyze subcommands ----------

function cmdAnalyzeNextSlot(args) {
  const flags = parseFlags(args, { date: 'value' });
  const projectSlug = flags._[0];
  const focus = flags._[1];
  if (!projectSlug || !focus) {
    usage('analyze next-slot requires <project-slug> <focus> [--date YYYY-MM-DD]');
  }
  if (!ANALYSIS_FOCUSES.has(focus)) {
    usage(
      `invalid focus "${focus}". valid: ${[...ANALYSIS_FOCUSES].join(', ')}`
    );
  }
  const date = flags.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage(`invalid date "${date}", expected YYYY-MM-DD`);
  }
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'analyses');
  let used = new Set();
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^${date}-${focus}(-(\\d+))?\\.md$`);
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(re);
      if (m) used.add(m[2] ? parseInt(m[2], 10) : 1);
    }
  }
  let n = 1;
  while (used.has(n)) n++;
  const suffix = n === 1 ? '' : `-${n}`;
  const filename = `${date}-${focus}${suffix}.md`;
  return {
    project: projectSlug,
    focus,
    date,
    suffix,
    filename,
    path: path.join(dir, filename),
    dir,
  };
}

function cmdAnalyzeInit(args) {
  const flags = parseFlags(args, {
    'project-path': 'value',
    'date': 'value',
    'title': 'value',
  });
  const projectSlug = flags._[0];
  const focus = flags._[1];
  if (!projectSlug || !focus) {
    usage('analyze init requires <project-slug> <focus> [--project-path /abs] [--date YYYY-MM-DD] [--title <text>]');
  }
  if (!ANALYSIS_FOCUSES.has(focus)) {
    usage(
      `invalid focus "${focus}". valid: ${[...ANALYSIS_FOCUSES].join(', ')}`
    );
  }
  // Compute slot.
  const slot = cmdAnalyzeNextSlot([projectSlug, focus, ...(flags.date ? ['--date', flags.date] : [])]);
  const filePath = slot.path;
  if (!fs.existsSync(slot.dir)) fs.mkdirSync(slot.dir, { recursive: true });

  const title = flags.title || `${focus} analysis of ${projectSlug}`;
  const analyzedPath = flags['project-path'] || '';

  const fm = {
    type: 'project-analysis',
    project: projectSlug,
    focus,
    title,
    status: 'scoped',
    created_at: nowIso(),
    analyzed_path: analyzedPath,
    phase_history: [`phase=scope completed=${nowIso()}`],
    discover: [],
    agents_dispatched: [],
    findings: [],
    findings_count: ['blocker=0', 'major=0', 'minor=0'],
    suggested_next: [],
    tags: ['analysis', `project/${projectSlug}`, `focus/${focus}`],
  };

  // Body — sectioned report skeleton. Phase 5 will overwrite sections.
  const body = `# Analysis: ${title}

## Scope

- Project: ${projectSlug}
- Focus: ${focus}
- Analyzed path: ${analyzedPath || '<not set>'}

## Discover (Phase 2 — filled by CLI)

<filled by 'analyze update-status ... discovered --phase-data ...'>

## Findings (Phase 3 — appended by sub-agents)

<filled incrementally by 'analyze add-finding'>

## Synthesis (Phase 4 — LLM)

<filled by skill in synthesize phase>

## Recommendations (Phase 5 — LLM)

<filled by skill in report phase>

## Notes

<anything else>
`;

  writeMdAtomic(filePath, fm, body);
  return {
    path: filePath,
    project: projectSlug,
    focus,
    status: 'scoped',
  };
}

const ANALYSIS_STATUS_TO_PHASE = {
  scoped: 'scope',
  discovered: 'discover',
  analyzed: 'analyze',
  synthesized: 'synthesize',
  reported: 'report',
  cancelled: 'cancelled',
};

function cmdAnalyzeUpdateStatus(args) {
  const analysisPathInput = args[0];
  const newStatus = args[1];
  if (!analysisPathInput || !newStatus) {
    usage('analyze update-status requires <analysis-path> <new-status> [--phase-data <json>]');
  }
  if (!ANALYSIS_STATUSES.has(newStatus)) {
    usage(
      `invalid analysis status "${newStatus}". valid: ${[...ANALYSIS_STATUSES].join(', ')}`
    );
  }
  const flags = parseFlags(args.slice(2), {
    'phase-data': 'value',
  });
  const analysisPath = resolveVaultPath(analysisPathInput);
  if (!fs.existsSync(analysisPath)) fail(`analysis file not found: ${analysisPath}`);
  const { fm, body } = readMd(analysisPath);
  fm.status = newStatus;

  const phase = ANALYSIS_STATUS_TO_PHASE[newStatus];
  if (phase) appendPhaseHistory(fm, phase);

  if (flags['phase-data']) {
    let parsed;
    try {
      parsed = JSON.parse(flags['phase-data']);
    } catch (e) {
      fail(`--phase-data is not valid JSON: ${e.message}`);
    }
    // Map known phase-data targets.
    if (newStatus === 'discovered' && parsed && typeof parsed === 'object') {
      const entries = [];
      for (const k of Object.keys(parsed)) {
        const v = parsed[k];
        const flatVal = Array.isArray(v) ? v.join(',') : String(v ?? '');
        entries.push(`${k}=${flatVal}`);
      }
      fm.discover = entries;
    }
    if (newStatus === 'analyzed' && parsed && Array.isArray(parsed.agents_dispatched)) {
      fm.agents_dispatched = parsed.agents_dispatched.map((a) => {
        if (typeof a === 'string') return a;
        const parts = [];
        if (a.name) parts.push(`name=${a.name}`);
        if (a.focus) parts.push(`focus=${a.focus}`);
        if (a.completed_at) parts.push(`completed_at=${a.completed_at}`);
        return parts.join('; ');
      });
    }
    if (newStatus === 'synthesized' && parsed && parsed.findings_count) {
      const fc = parsed.findings_count;
      fm.findings_count = [
        `blocker=${fc.blocker ?? 0}`,
        `major=${fc.major ?? 0}`,
        `minor=${fc.minor ?? 0}`,
      ];
    }
    if (newStatus === 'reported' && parsed && Array.isArray(parsed.suggested_next)) {
      fm.suggested_next = parsed.suggested_next.map((s) => {
        if (typeof s === 'string') return s;
        const parts = [];
        if (s.skill) parts.push(`skill=${s.skill}`);
        if (s.reason) parts.push(`reason=${s.reason}`);
        if (s.target_findings)
          parts.push(`target_findings=${(s.target_findings || []).join(',')}`);
        return parts.join('; ');
      });
    }
  }

  writeMdAtomic(analysisPath, fm, body);
  return {
    analysis_path: analysisPath,
    status: fm.status,
    phase_history: fm.phase_history,
    discover: fm.discover ?? [],
    agents_dispatched: fm.agents_dispatched ?? [],
    findings_count: fm.findings_count ?? [],
    suggested_next: fm.suggested_next ?? [],
  };
}

function cmdAnalyzeDiscover(args) {
  const projectPath = args[0];
  if (!projectPath) usage('analyze discover requires <project-path>');
  if (!fs.existsSync(projectPath)) fail(`project path not found: ${projectPath}`);

  const stack = new Set();
  const STACK_MARKERS = [
    ['package.json', 'node'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['tsconfig.json', 'typescript'],
    ['next.config.js', 'next.js'],
    ['next.config.mjs', 'next.js'],
    ['next.config.ts', 'next.js'],
    ['vite.config.ts', 'vite'],
    ['vite.config.js', 'vite'],
    ['astro.config.mjs', 'astro'],
    ['svelte.config.js', 'svelte'],
    ['nuxt.config.ts', 'nuxt'],
    ['remix.config.js', 'remix'],
    ['requirements.txt', 'python'],
    ['pyproject.toml', 'python'],
    ['Pipfile', 'python'],
    ['Cargo.toml', 'rust'],
    ['go.mod', 'go'],
    ['pubspec.yaml', 'flutter'],
    ['composer.json', 'php'],
    ['Gemfile', 'ruby'],
    ['build.gradle', 'java'],
    ['build.gradle.kts', 'kotlin'],
    ['pom.xml', 'java-maven'],
    ['Dockerfile', 'docker'],
    ['docker-compose.yml', 'docker-compose'],
    ['docker-compose.yaml', 'docker-compose'],
    ['vercel.json', 'vercel'],
    ['netlify.toml', 'netlify'],
    ['supabase/config.toml', 'supabase'],
    ['prisma/schema.prisma', 'prisma'],
    ['drizzle.config.ts', 'drizzle'],
    ['turbo.json', 'turborepo'],
    ['nx.json', 'nx'],
    ['.github/workflows', 'github-actions'],
  ];
  for (const [marker, label] of STACK_MARKERS) {
    if (fs.existsSync(path.join(projectPath, marker))) stack.add(label);
  }

  // LOC + file count: walk, skip noise dirs.
  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.next', 'dist', 'build', 'out',
    '.turbo', '.cache', 'coverage', '.venv', 'venv', '__pycache__',
    'target', '.gradle', '.idea', '.vscode',
  ]);
  const CODE_EXT = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py', '.rs', '.go', '.dart', '.java', '.kt', '.rb', '.php',
    '.css', '.scss', '.html', '.vue', '.svelte', '.astro',
    '.sql', '.sh', '.yml', '.yaml', '.toml', '.json', '.md',
  ]);
  let loc = 0;
  let fileCount = 0;
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!CODE_EXT.has(ext)) continue;
        fileCount++;
        try {
          const content = fs.readFileSync(full, 'utf8');
          loc += content.split('\n').length;
        } catch (_e) {
          // skip unreadable
        }
      }
    }
  }
  walk(projectPath);

  // Git stats (best effort).
  let lastCommit = null;
  let branch = null;
  let commitCount30d = 0;
  const gitDir = path.join(projectPath, '.git');
  if (fs.existsSync(gitDir)) {
    try {
      const { execSync } = require('child_process');
      lastCommit = execSync('git log -1 --format=%cI', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const count = execSync('git log --since="30 days ago" --oneline', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      commitCount30d = count.trim() ? count.trim().split('\n').length : 0;
    } catch (_e) {
      // git not available or other issue — leave as null
    }
  }

  return {
    project_path: projectPath,
    tech_stack: [...stack].sort(),
    loc,
    file_count: fileCount,
    last_commit: lastCommit,
    branch,
    commit_count_30d: commitCount30d,
  };
}

function cmdAnalyzeAddFinding(args) {
  const flags = parseFlags(args, {
    recommendation: 'value',
  });
  const [analysisPathInput, severity, category, location, description] = flags._;
  if (!analysisPathInput || !severity || !category || !location || !description) {
    usage('analyze add-finding requires <analysis-path> <severity> <category> <location> <description> [--recommendation <text>]');
  }
  if (!ANALYSIS_SEVERITIES.has(severity)) {
    usage(
      `invalid severity "${severity}". valid: ${[...ANALYSIS_SEVERITIES].join(', ')}`
    );
  }
  const analysisPath = resolveVaultPath(analysisPathInput);
  if (!fs.existsSync(analysisPath)) fail(`analysis file not found: ${analysisPath}`);
  const { fm, body } = readMd(analysisPath);
  const findingId = appendFinding(fm, {
    severity,
    category,
    location,
    description,
    recommendation: flags.recommendation,
  });
  writeMdAtomic(analysisPath, fm, body);
  return {
    analysis_path: analysisPath,
    finding_id: findingId,
    total_findings: fm.findings.length,
  };
}

function appendFinding(fm, { severity, category, location, description, recommendation }) {
  if (!severity || !category || !location || !description) {
    fail('finding requires severity, category, location, description');
  }
  if (!ANALYSIS_SEVERITIES.has(severity)) {
    fail(`invalid severity "${severity}". valid: ${[...ANALYSIS_SEVERITIES].join(', ')}`);
  }
  if (!Array.isArray(fm.findings)) fm.findings = [];
  let maxN = 0;
  for (const f of fm.findings) {
    if (typeof f === 'string') {
      const m = f.match(/^id=F-(\d+)/);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
  }
  const findingId = `F-${String(maxN + 1).padStart(3, '0')}`;
  const clean = (s) => String(s).replace(/;/g, ',').replace(/\n/g, ' ');
  const parts = [
    `id=${findingId}`,
    `severity=${severity}`,
    `category=${clean(category)}`,
    `location=${clean(location)}`,
    `description=${clean(description)}`,
  ];
  if (recommendation) parts.push(`recommendation=${clean(recommendation)}`);
  fm.findings.push(parts.join('; '));
  return findingId;
}

function cmdAnalyzeAddFindings(args) {
  const flags = parseFlags(args, { json: 'value' });
  const analysisPathInput = flags._[0];
  if (!analysisPathInput || !flags.json) {
    usage('analyze add-findings requires <analysis-path> --json <file|-> (JSON array of {severity, category, location, description, recommendation?})');
  }
  const raw = flags.json === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(flags.json, 'utf8');
  let items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    fail(`invalid JSON input: ${e.message}`);
  }
  if (!Array.isArray(items) || items.length === 0) {
    fail('JSON input must be a non-empty array of finding objects');
  }
  const analysisPath = resolveVaultPath(analysisPathInput);
  if (!fs.existsSync(analysisPath)) fail(`analysis file not found: ${analysisPath}`);
  const { fm, body } = readMd(analysisPath);
  const ids = items.map((item) => appendFinding(fm, item || {}));
  writeMdAtomic(analysisPath, fm, body);
  return {
    analysis_path: analysisPath,
    finding_ids: ids,
    added: ids.length,
    total_findings: fm.findings.length,
  };
}

function cmdAnalyzeList(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('analyze list requires <project-slug>');
  const flags = parseFlags(args.slice(1), {
    status: 'value',
    focus: 'value',
  });
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'analyses');
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, count: 0, analyses: [] };
  }
  const analyses = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.match(/^\d{4}-\d{2}-\d{2}-.+\.md$/)) continue;
    const full = path.join(dir, entry);
    let status = 'unknown';
    let focus = 'unknown';
    let title = entry;
    try {
      const { fm } = readMd(full);
      status = fm.status || 'unknown';
      focus = fm.focus || 'unknown';
      title = fm.title || entry;
    } catch (_e) {
      // ignore
    }
    if (flags.status && status !== flags.status) continue;
    if (flags.focus && focus !== flags.focus) continue;
    analyses.push({ file: entry, path: full, status, focus, title });
  }
  // Sort by filename desc (most recent date first).
  analyses.sort((a, b) => b.file.localeCompare(a.file));
  return { project: projectSlug, count: analyses.length, analyses };
}

// ---------- constitution subcommands ----------
//
// Singleton-per-project + history. Vault is the source of truth; the repo
// constitution.md is a stripped-down mirror derived from the vault file.
//
// Vault layout:
//   projects/<slug>/constitution/constitution.md         (canonical)
//   projects/<slug>/constitution/history/YYYY-MM-DD-vN.md (snapshots)
//
// Repo mirror: <repo-root>/constitution.md

const CONSTITUTION_STATUS_TO_PHASE = {
  discovering: 'discover',
  drafted: 'draft',
  reviewed: 'review',
  written: 'write',
  cancelled: 'cancelled',
};

function constitutionVaultPath(projectSlug) {
  return path.join(
    vaultRoot(),
    'projects',
    projectSlug,
    'constitution',
    'constitution.md'
  );
}

function constitutionHistoryDir(projectSlug) {
  return path.join(
    vaultRoot(),
    'projects',
    projectSlug,
    'constitution',
    'history'
  );
}

function cmdConstitutionInit(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('constitution init requires <project-slug>');
  const flags = parseFlags(args.slice(1), {
    title: 'value',
  });
  const filePath = constitutionVaultPath(projectSlug);
  const dir = path.dirname(filePath);
  if (fs.existsSync(filePath)) {
    fail(
      `constitution already exists: ${filePath}. ` +
        `Use 'archive-current' before re-initializing, or update status directly.`
    );
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const title = flags.title || `Constitution for ${projectSlug}`;
  const fm = {
    type: 'constitution',
    project: projectSlug,
    title,
    status: 'discovering',
    version: 1,
    created_at: nowIso(),
    last_written_at: null,
    phase_history: [],
    tags: ['constitution', `project/${projectSlug}`],
  };

  const body = `# ${title}

<!-- Body filled by Phase 2 (Draft) via 'constitution set-body'. -->
<!-- Until then this skeleton remains and the file is in 'discovering' status. -->

## Override Precedence (4 Layers)

<filled by Finn in Phase 2>

## Project Behavioral Rules

<filled by Finn in Phase 2>

## Notes

<optional, filled in Phase 3 Review>
`;

  writeMdAtomic(filePath, fm, body);
  return {
    path: filePath,
    project: projectSlug,
    status: 'discovering',
    version: 1,
  };
}

function cmdConstitutionDiscover(args) {
  const flags = parseFlags(args, {
    'project-path': 'value',
  });
  const projectSlug = flags._[0];
  if (!projectSlug) {
    usage(
      'constitution discover requires <project-slug> [--project-path <abs>]'
    );
  }
  const projectPath = flags['project-path'] || null;
  const result = {
    project: projectSlug,
    project_path: projectPath,
    claudemd_present: false,
    claudemd_path: null,
    claudemd_excerpt: null,
    repo_constitution_present: false,
    repo_constitution_path: null,
    global_rules: [],
    has_link_to_constitution: false,
  };

  // CLAUDE.md inspection.
  if (projectPath) {
    const claudemdPath = path.join(projectPath, 'CLAUDE.md');
    if (fs.existsSync(claudemdPath)) {
      result.claudemd_present = true;
      result.claudemd_path = claudemdPath;
      try {
        const content = fs.readFileSync(claudemdPath, 'utf8');
        // First 4000 chars is enough for the LLM to grasp scope.
        result.claudemd_excerpt = content.slice(0, 4000);
        // Detect existing cross-link to constitution.md.
        result.has_link_to_constitution = /constitution\.md/i.test(content);
      } catch (_e) {
        // unreadable — leave excerpt null
      }
    }
    const repoConstPath = path.join(projectPath, 'constitution.md');
    if (fs.existsSync(repoConstPath)) {
      result.repo_constitution_present = true;
      result.repo_constitution_path = repoConstPath;
    }
  }

  // Global rules under ~/.claude/rules/
  const rulesDir = path.join(os.homedir(), '.claude', 'rules');
  if (fs.existsSync(rulesDir)) {
    function walkRules(dir, prefix = '') {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_e) {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) {
          walkRules(full, rel);
        } else if (e.isFile() && e.name.endsWith('.md')) {
          result.global_rules.push(rel);
        }
      }
    }
    walkRules(rulesDir);
    result.global_rules.sort();
  }

  return result;
}

function cmdConstitutionUpdateStatus(args) {
  const constPathInput = args[0];
  const newStatus = args[1];
  if (!constPathInput || !newStatus) {
    usage('constitution update-status requires <constitution-path> <new-status>');
  }
  if (!CONSTITUTION_STATUSES.has(newStatus)) {
    usage(
      `invalid constitution status "${newStatus}". valid: ${[...CONSTITUTION_STATUSES].join(', ')}`
    );
  }
  const constPath = resolveVaultPath(constPathInput);
  if (!fs.existsSync(constPath)) fail(`constitution file not found: ${constPath}`);
  const { fm, body } = readMd(constPath);
  fm.status = newStatus;
  const phase = CONSTITUTION_STATUS_TO_PHASE[newStatus];
  if (phase) appendPhaseHistory(fm, phase);
  if (newStatus === 'written') {
    fm.last_written_at = nowIso();
  }
  writeMdAtomic(constPath, fm, body);
  return {
    constitution_path: constPath,
    status: fm.status,
    version: typeof fm.version === 'number' ? fm.version : parseInt(fm.version, 10) || 1,
    phase_history: fm.phase_history,
    last_written_at: fm.last_written_at ?? null,
  };
}

function cmdConstitutionSetBody(args) {
  const flags = parseFlags(args, {
    'body-file': 'value',
  });
  const constPathInput = flags._[0];
  if (!constPathInput) {
    usage('constitution set-body requires <constitution-path> --body-file <path>');
  }
  if (!flags['body-file']) {
    usage('constitution set-body requires --body-file <path>');
  }
  const constPath = resolveVaultPath(constPathInput);
  if (!fs.existsSync(constPath)) fail(`constitution file not found: ${constPath}`);
  if (!fs.existsSync(flags['body-file'])) {
    fail(`body file not found: ${flags['body-file']}`);
  }
  const newBody = fs.readFileSync(flags['body-file'], 'utf8');
  const { fm } = readMd(constPath);
  writeMdAtomic(constPath, fm, newBody);
  return {
    constitution_path: constPath,
    body_bytes: Buffer.byteLength(newBody, 'utf8'),
  };
}

function cmdConstitutionNextVersion(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('constitution next-version requires <project-slug>');
  const histDir = constitutionHistoryDir(projectSlug);
  let max = 0;
  if (fs.existsSync(histDir)) {
    for (const entry of fs.readdirSync(histDir)) {
      const m = entry.match(/-v(\d+)\.md$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  return {
    project: projectSlug,
    next: max + 1,
    history_dir: histDir,
  };
}

function cmdConstitutionArchiveCurrent(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('constitution archive-current requires <project-slug>');
  const flags = parseFlags(args.slice(1), { date: 'value' });
  const constPath = constitutionVaultPath(projectSlug);
  if (!fs.existsSync(constPath)) {
    fail(`no current constitution to archive: ${constPath}`);
  }
  const histDir = constitutionHistoryDir(projectSlug);
  if (!fs.existsSync(histDir)) fs.mkdirSync(histDir, { recursive: true });
  const date = flags.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage(`invalid date "${date}", expected YYYY-MM-DD`);
  }
  // Determine next version number.
  const nv = cmdConstitutionNextVersion([projectSlug]);
  const snapshotName = `${date}-v${nv.next}.md`;
  const snapshotPath = path.join(histDir, snapshotName);
  // Copy via read-then-write-atomic (preserves content faithfully).
  const content = fs.readFileSync(constPath, 'utf8');
  const tmp = `${snapshotPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, snapshotPath);
  // Bump version in the live file.
  const { fm, body } = readMd(constPath);
  fm.version = (typeof fm.version === 'number' ? fm.version : parseInt(fm.version, 10) || 1) + 1;
  writeMdAtomic(constPath, fm, body);
  return {
    project: projectSlug,
    snapshot: snapshotPath,
    new_version: fm.version,
  };
}

function cmdConstitutionWriteMirror(args) {
  const flags = parseFlags(args, { 'repo-root': 'value' });
  const projectSlug = flags._[0];
  if (!projectSlug) {
    usage('constitution write-mirror requires <project-slug> --repo-root <abs>');
  }
  if (!flags['repo-root']) {
    usage('constitution write-mirror requires --repo-root <abs>');
  }
  const repoRoot = flags['repo-root'];
  if (!path.isAbsolute(repoRoot)) {
    fail(`--repo-root must be absolute path, got: ${repoRoot}`);
  }
  if (!fs.existsSync(repoRoot)) {
    fail(`repo root does not exist: ${repoRoot}`);
  }
  const constPath = constitutionVaultPath(projectSlug);
  if (!fs.existsSync(constPath)) {
    fail(`no vault constitution found for ${projectSlug}: ${constPath}`);
  }
  const { fm, body } = readMd(constPath);
  // Stripped-down mirror: tiny generation header + body. No vault frontmatter.
  const header =
    `<!-- Generated mirror — source of truth: Obsidian Vault\n` +
    `     ${path.relative(vaultRoot(), constPath)}\n` +
    `     project: ${projectSlug} | version: ${fm.version} | last_written_at: ${fm.last_written_at ?? nowIso()}\n` +
    `     Do not edit this file directly. Edit the vault version and re-run a1-constitution. -->\n\n`;
  const mirrorPath = path.join(repoRoot, 'constitution.md');
  const out = header + body;
  const tmp = `${mirrorPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, out, 'utf8');
  fs.renameSync(tmp, mirrorPath);
  return {
    project: projectSlug,
    mirror_path: mirrorPath,
    bytes: Buffer.byteLength(out, 'utf8'),
    version: typeof fm.version === 'number' ? fm.version : parseInt(fm.version, 10) || 1,
  };
}

const CLAUDEMD_LINK_MARKER_START = '<!-- a1-constitution:link -->';
const CLAUDEMD_LINK_MARKER_END = '<!-- /a1-constitution:link -->';

function cmdConstitutionLinkClaudemd(args) {
  const flags = parseFlags(args, { 'repo-root': 'value' });
  const projectSlug = flags._[0];
  if (!projectSlug) {
    usage('constitution link-claudemd requires <project-slug> --repo-root <abs>');
  }
  if (!flags['repo-root']) {
    usage('constitution link-claudemd requires --repo-root <abs>');
  }
  const repoRoot = flags['repo-root'];
  if (!path.isAbsolute(repoRoot)) {
    fail(`--repo-root must be absolute path, got: ${repoRoot}`);
  }
  const claudemdPath = path.join(repoRoot, 'CLAUDE.md');
  if (!fs.existsSync(claudemdPath)) {
    fail(
      `CLAUDE.md not found at ${claudemdPath}. ` +
        `Create it first (template: ~/.claude/templates/CLAUDE.md.template).`
    );
  }
  const content = fs.readFileSync(claudemdPath, 'utf8');
  const block =
    `${CLAUDEMD_LINK_MARKER_START}\n` +
    `## Behavioral Rules\n\n` +
    `This project's behavioral rules and override-precedence are defined in\n` +
    `[\`constitution.md\`](./constitution.md). CLAUDE.md = data + context;\n` +
    `constitution.md = rules + override order. If they conflict, constitution.md wins\n` +
    `for behavior; CLAUDE.md wins for project facts.\n` +
    `${CLAUDEMD_LINK_MARKER_END}\n`;

  let updated;
  let action;
  if (content.includes(CLAUDEMD_LINK_MARKER_START)) {
    // Replace existing managed block (idempotent update).
    const startIdx = content.indexOf(CLAUDEMD_LINK_MARKER_START);
    const endIdx = content.indexOf(CLAUDEMD_LINK_MARKER_END);
    if (endIdx === -1) {
      fail(
        `CLAUDE.md has a start-marker but no end-marker. ` +
          `Please clean up the file manually around ${CLAUDEMD_LINK_MARKER_START}.`
      );
    }
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + CLAUDEMD_LINK_MARKER_END.length);
    updated = before + block + after;
    action = 'updated';
  } else {
    // Append at end.
    const sep = content.endsWith('\n') ? '\n' : '\n\n';
    updated = content + sep + block;
    action = 'appended';
  }
  const tmp = `${claudemdPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, updated, 'utf8');
  fs.renameSync(tmp, claudemdPath);
  return {
    project: projectSlug,
    claudemd_path: claudemdPath,
    action,
  };
}

function cmdConstitutionList(args) {
  const flags = parseFlags(args, { status: 'value' });
  const projectsRoot = path.join(vaultRoot(), 'projects');
  const constitutions = [];
  if (!fs.existsSync(projectsRoot)) {
    return { count: 0, constitutions };
  }
  for (const slug of fs.readdirSync(projectsRoot).sort()) {
    const constPath = path.join(
      projectsRoot,
      slug,
      'constitution',
      'constitution.md'
    );
    if (!fs.existsSync(constPath)) continue;
    let status = 'unknown';
    let version = null;
    let title = slug;
    let lastWrittenAt = null;
    try {
      const { fm } = readMd(constPath);
      status = fm.status || 'unknown';
      version = fm.version ?? null;
      title = fm.title || slug;
      lastWrittenAt = fm.last_written_at ?? null;
    } catch (_e) {
      // skip unreadable
    }
    if (flags.status && status !== flags.status) continue;
    constitutions.push({
      project: slug,
      path: constPath,
      status,
      version: typeof version === 'number' ? version : parseInt(version, 10) || null,
      title,
      last_written_at: lastWrittenAt,
    });
  }
  return { count: constitutions.length, constitutions };
}

// ---------- check subcommand (consistency gate) ----------
//
// Verifies structural consistency between a feature's spec and its wave-plan.
// Three checks (all deterministic, regex-based — no LLM):
//   1. frontmatter_link — plan.frontmatter.spec_path resolves to the expected spec
//   2. fr_coverage      — every FR-### from the spec appears in exactly one Wave
//   3. fr_phantoms      — no FR-### in the plan that is absent from the spec
//
// Exit codes (the check command sets its own — bypasses the generic main() path):
//   0 PASS, 1 FAIL (content inconsistency), 2 ERROR (setup: missing file, bad frontmatter)
//
// Output formats: --format json (default, for programmatic callers) or --format human (DE).

const FR_PATTERN = /\bFR-\d{3,}\b/g;
const WAVE_HEADING_PATTERN = /^##\s+Wave\s+(\d+)\b[^\n]*$/gim;

function extractSpecFRs(specBody) {
  // Spec FR-IDs can appear anywhere in the body. Collect unique set.
  const set = new Set();
  const matches = specBody.match(FR_PATTERN) || [];
  for (const m of matches) set.add(m);
  return set;
}

function extractWaveFRs(planBody) {
  // Split plan body into wave sections by "## Wave N" headings.
  // For each wave, collect every FR-### occurrence in that section.
  // Returns: Map<waveLabel, Set<FR>>.
  const waves = new Map();
  const lines = planBody.split('\n');
  let currentLabel = null;
  let currentBuf = [];
  const flush = () => {
    if (currentLabel === null) return;
    const text = currentBuf.join('\n');
    const found = new Set();
    const m = text.match(FR_PATTERN) || [];
    for (const fr of m) found.add(fr);
    waves.set(currentLabel, found);
  };
  const headingRe = /^##\s+Wave\s+(\d+)\b(.*)$/i;
  for (const line of lines) {
    const h = line.match(headingRe);
    if (h) {
      flush();
      currentLabel = `Wave ${h[1]}`;
      currentBuf = [];
    } else if (currentLabel !== null) {
      currentBuf.push(line);
    }
  }
  flush();
  return waves;
}

function diffFRCoverage(specFRs, waveMap) {
  // Build the inverse map: FR -> [waveLabels...] (to detect duplicates).
  const frToWaves = new Map();
  for (const [waveLabel, frs] of waveMap.entries()) {
    for (const fr of frs) {
      if (!frToWaves.has(fr)) frToWaves.set(fr, []);
      frToWaves.get(fr).push(waveLabel);
    }
  }
  const planFRs = new Set(frToWaves.keys());
  const missingInPlan = [...specFRs].filter((fr) => !planFRs.has(fr)).sort();
  const phantomInPlan = [...planFRs].filter((fr) => !specFRs.has(fr)).sort();
  const duplicatedInPlan = [];
  for (const [fr, labels] of frToWaves.entries()) {
    if (labels.length > 1) duplicatedInPlan.push({ fr, waves: labels });
  }
  duplicatedInPlan.sort((a, b) => a.fr.localeCompare(b.fr));
  return { missingInPlan, phantomInPlan, duplicatedInPlan, planFRs };
}

function buildExpectedPaths(projectSlug, feature) {
  // feature = "<###>-<feature-slug>" (e.g. "001-login")
  const specAbs = path.join(vaultRoot(), 'projects', projectSlug, 'spec', `${feature}.md`);
  const planAbs = path.join(
    vaultRoot(),
    'projects',
    projectSlug,
    'plans',
    `${feature}-wave-plan.md`
  );
  const specRel = `projects/${projectSlug}/spec/${feature}.md`;
  const planRel = `projects/${projectSlug}/plans/${feature}-wave-plan.md`;
  return { specAbs, planAbs, specRel, planRel };
}

function formatHumanReport(report) {
  const lines = [];
  const statusLabel =
    report.status === 'PASS'
      ? 'PASS'
      : report.status === 'FAIL'
      ? 'FAIL'
      : 'ERROR';
  lines.push(`Konsistenz-Check: ${statusLabel}`);
  lines.push('');
  lines.push(`Feature: ${report.feature} (Projekt: ${report.project})`);
  lines.push('');

  if (report.status === 'ERROR') {
    lines.push('Setup-Fehler:');
    for (const err of report.errors || []) lines.push(`  - ${err}`);
    lines.push('');
    lines.push('Empfehlung:');
    lines.push('  Artifacts pruefen — fehlende Datei anlegen oder Frontmatter reparieren.');
    return lines.join('\n');
  }

  const tick = (s) => (s === 'PASS' ? '[ok]' : '[x]');
  lines.push('Pruefungen:');
  lines.push(`  Frontmatter-Link    ${tick(report.checks.frontmatter_link)} ${report.checks.frontmatter_link}`);
  lines.push(`  FR-Coverage         ${tick(report.checks.fr_coverage)} ${report.checks.fr_coverage}`);
  lines.push(`  FR-Phantome         ${tick(report.checks.fr_phantoms)} ${report.checks.fr_phantoms}`);
  lines.push('');

  if (report.status === 'PASS') {
    lines.push(`Befund: Spec und Wave-Plan sind synchron (${report.counts.spec_frs} FRs ueber ${report.counts.waves} Waves verteilt).`);
    return lines.join('\n');
  }

  lines.push('Befund:');
  const d = report.diffs;
  if (report.checks.frontmatter_link === 'FAIL') {
    lines.push(`  Plan-Frontmatter zeigt auf falsche Spec:`);
    lines.push(`    spec_path im Plan: ${d.frontmatter_link.actual || '(fehlt)'}`);
    lines.push(`    erwartet:          ${d.frontmatter_link.expected}`);
  }
  if (d.missing_in_plan.length > 0) {
    lines.push(`  FRs aus der Spec, die in keiner Wave vorkommen:`);
    for (const fr of d.missing_in_plan) lines.push(`    - ${fr}`);
  }
  if (d.duplicated_in_plan.length > 0) {
    lines.push(`  FRs, die in mehreren Waves vorkommen:`);
    for (const dup of d.duplicated_in_plan) {
      lines.push(`    - ${dup.fr} in ${dup.waves.join(', ')}`);
    }
  }
  if (d.phantom_in_plan.length > 0) {
    lines.push(`  Phantom-FRs im Plan (nicht in der Spec definiert):`);
    for (const fr of d.phantom_in_plan) lines.push(`    - ${fr}`);
  }
  lines.push('');
  lines.push('Empfehlung:');
  lines.push(`  ${report.summary}`);
  return lines.join('\n');
}

function cmdCheckRun(args) {
  // Parse: <project-slug> --feature <###-slug> [--format json|human] [--vault <path>]
  const projectSlug = args[0];
  if (!projectSlug || projectSlug.startsWith('--')) {
    usage('check requires <project-slug> --feature <###-feature-slug>');
  }
  const flags = parseFlags(args.slice(1), {
    feature: 'value',
    format: 'value',
    vault: 'value',
  });
  if (!flags.feature) {
    usage('check requires --feature <###-feature-slug>');
  }
  const format = flags.format || 'json';
  if (format !== 'json' && format !== 'human') {
    usage(`check --format must be "json" or "human" (got: ${format})`);
  }
  if (flags.vault) process.env.A1_VAULT_ROOT = flags.vault;

  const feature = flags.feature;
  const paths = buildExpectedPaths(projectSlug, feature);

  const report = {
    status: 'PASS',
    exit_code: 0,
    project: projectSlug,
    feature,
    paths: { spec: paths.specRel, plan: paths.planRel },
    checks: { frontmatter_link: 'PASS', fr_coverage: 'PASS', fr_phantoms: 'PASS' },
    counts: { spec_frs: 0, plan_frs: 0, waves: 0 },
    diffs: {
      frontmatter_link: { expected: paths.specRel, actual: null },
      missing_in_plan: [],
      duplicated_in_plan: [],
      phantom_in_plan: [],
    },
    errors: [],
    summary: '',
  };

  // --- Load phase ---
  const errors = [];
  if (!fs.existsSync(paths.specAbs)) {
    errors.push(`spec not found: ${paths.specRel}`);
  }
  if (!fs.existsSync(paths.planAbs)) {
    errors.push(`wave-plan not found: ${paths.planRel}`);
  }
  if (errors.length > 0) {
    report.status = 'ERROR';
    report.exit_code = 2;
    report.errors = errors;
    return emitCheckReport(report, format);
  }

  let spec, plan;
  try {
    spec = readMd(paths.specAbs);
  } catch (e) {
    report.status = 'ERROR';
    report.exit_code = 2;
    report.errors = [`spec frontmatter parse error: ${e.message}`];
    return emitCheckReport(report, format);
  }
  try {
    plan = readMd(paths.planAbs);
  } catch (e) {
    report.status = 'ERROR';
    report.exit_code = 2;
    report.errors = [`wave-plan frontmatter parse error: ${e.message}`];
    return emitCheckReport(report, format);
  }

  // --- Compare phase ---
  // Check 1: frontmatter_link
  const planSpecPath = plan.fm.spec_path || null;
  report.diffs.frontmatter_link.actual = planSpecPath;
  // Accept either the relative form or the absolute form of the expected spec path.
  const linkOk =
    planSpecPath === paths.specRel ||
    planSpecPath === paths.specAbs ||
    (typeof planSpecPath === 'string' &&
      planSpecPath.endsWith(`spec/${feature}.md`));
  if (!linkOk) {
    report.checks.frontmatter_link = 'FAIL';
  }

  // Check 2 + 3: FR coverage + phantoms
  const specFRs = extractSpecFRs(spec.body);
  const waveMap = extractWaveFRs(plan.body);
  const diff = diffFRCoverage(specFRs, waveMap);

  report.counts.spec_frs = specFRs.size;
  report.counts.plan_frs = diff.planFRs.size;
  report.counts.waves = waveMap.size;
  report.diffs.missing_in_plan = diff.missingInPlan;
  report.diffs.duplicated_in_plan = diff.duplicatedInPlan;
  report.diffs.phantom_in_plan = diff.phantomInPlan;

  if (diff.missingInPlan.length > 0 || diff.duplicatedInPlan.length > 0) {
    report.checks.fr_coverage = 'FAIL';
  }
  if (diff.phantomInPlan.length > 0) {
    report.checks.fr_phantoms = 'FAIL';
  }

  // --- Report phase ---
  const anyFail = Object.values(report.checks).some((v) => v === 'FAIL');
  if (anyFail) {
    report.status = 'FAIL';
    report.exit_code = 1;
    const parts = [];
    if (diff.missingInPlan.length > 0) {
      parts.push(`${diff.missingInPlan.length} FR(s) from spec not covered by any wave`);
    }
    if (diff.duplicatedInPlan.length > 0) {
      parts.push(`${diff.duplicatedInPlan.length} FR(s) duplicated across waves`);
    }
    if (diff.phantomInPlan.length > 0) {
      parts.push(`${diff.phantomInPlan.length} phantom FR(s) in plan (not in spec)`);
    }
    if (report.checks.frontmatter_link === 'FAIL') {
      parts.push('plan frontmatter spec_path mismatches expected spec');
    }
    report.summary = parts.join('; ') + '.';
  } else {
    report.summary = `Spec and wave-plan are consistent (${specFRs.size} FRs across ${waveMap.size} waves).`;
  }

  return emitCheckReport(report, format);
}

function emitCheckReport(report, format) {
  if (format === 'human') {
    process.stdout.write(formatHumanReport(report) + '\n');
  } else {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
  process.exit(report.exit_code);
}

// ---------- checklist subcommands ----------
//
// Pre-flight gate before implementation. Runs 8 structural checks across the
// feature's spec, wave-plan, and project metadata. Severities: BLOCKER stops
// the gate (exit 1), MAJOR/MINOR are reported but do not gate (exit 0 with
// warnings). Setup problems (missing files, parse errors) yield exit 2.

const CHECKLIST_REQUIRED_PLAN_FM_FIELDS = [
  'spec_path',
  'spec_id',
  'project',
  'created',
  'waves',
];

// Resolve a slug-or-slug/feature input into a concrete feature id.
// - "foo/003" or "foo/003-login" → { slug: "foo", feature: "003-login" }
// - "foo"                        → { slug: "foo", feature: <latest by ###> }
function resolveChecklistTarget(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('checklist target must be "<slug>" or "<slug>/<feature-id>"');
  }
  const parts = input.split('/');
  const slug = parts[0];
  if (!slug) throw new Error('checklist target: empty project slug');
  const specDir = path.join(vaultRoot(), 'projects', slug, 'spec');
  if (!fs.existsSync(specDir)) {
    throw new Error(`spec directory not found: projects/${slug}/spec/`);
  }
  const specFiles = fs
    .readdirSync(specDir)
    .filter((f) => /^\d{3,}-.+\.md$/.test(f))
    .sort();
  if (specFiles.length === 0) {
    throw new Error(`no specs found under projects/${slug}/spec/`);
  }

  if (parts.length === 1) {
    const latest = specFiles[specFiles.length - 1];
    return { slug, feature: latest.replace(/\.md$/, '') };
  }

  const ref = parts.slice(1).join('/');
  // Case A: full feature id "003-login"
  const full = specFiles.find((f) => f === `${ref}.md`);
  if (full) return { slug, feature: ref };
  // Case B: just the number "003"
  const numMatch = ref.match(/^(\d{3,})$/);
  if (numMatch) {
    const prefix = `${numMatch[1]}-`;
    const hit = specFiles.find((f) => f.startsWith(prefix));
    if (hit) return { slug, feature: hit.replace(/\.md$/, '') };
    throw new Error(`no spec found under projects/${slug}/spec/ matching prefix "${prefix}"`);
  }
  // Case C: partial slug-style "003-log"
  const partial = specFiles.find((f) => f.startsWith(ref) && f.endsWith('.md'));
  if (partial) return { slug, feature: partial.replace(/\.md$/, '') };
  throw new Error(`no spec found under projects/${slug}/spec/ matching "${ref}"`);
}

function checklistPaths(slug, feature) {
  const root = vaultRoot();
  return {
    specAbs: path.join(root, 'projects', slug, 'spec', `${feature}.md`),
    specRel: `projects/${slug}/spec/${feature}.md`,
    planAbs: path.join(root, 'projects', slug, 'plans', `${feature}-wave-plan.md`),
    planRel: `projects/${slug}/plans/${feature}-wave-plan.md`,
    plansDirAbs: path.join(root, 'projects', slug, 'plans'),
    plansDirRel: `projects/${slug}/plans`,
    claudemdAbs: path.join(root, 'projects', slug, 'CLAUDE.md'),
    claudemdRel: `projects/${slug}/CLAUDE.md`,
    checklistDirAbs: path.join(root, 'projects', slug, 'checklist'),
    checklistDirRel: `projects/${slug}/checklist`,
  };
}

// Extract wave blocks from a plan body. Returns Array<{label, num, lines[]}>.
function extractWaveBlocks(planBody) {
  const blocks = [];
  const headingRe = /^##\s+Wave\s+(\d+)\b(.*)$/i;
  const lines = planBody.split('\n');
  let current = null;
  for (const line of lines) {
    const h = line.match(headingRe);
    if (h) {
      if (current) blocks.push(current);
      current = { label: `Wave ${h[1]}`, num: parseInt(h[1], 10), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

// Find the "Depends on:" reference inside a wave block. Returns array of wave-nums.
// Recognizes patterns like:
//   **Depends on:** Wave 1, Wave 2
//   Depends on: none
//   Dependencies: Wave 1
function extractWaveDependencies(block) {
  const text = block.lines.join('\n');
  const depRe = /\b(?:depends\s+on|dependencies)\s*:\*?\*?\s*([^\n]*)/i;
  const m = text.match(depRe);
  if (!m) return [];
  const rest = m[1].trim();
  if (!rest || /^(none|keine|—|-)$/i.test(rest)) return [];
  const nums = [];
  const numRe = /\bwave\s+(\d+)\b/gi;
  let nm;
  while ((nm = numRe.exec(rest)) !== null) {
    nums.push(parseInt(nm[1], 10));
  }
  return nums;
}

// DAG cycle detection via DFS. Returns null if acyclic, or {cycle: [n1,n2,...,n1]} if cyclic.
function detectWaveCycles(waveNums, depsByNum) {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map(waveNums.map((n) => [n, WHITE]));
  const parent = new Map();
  let cycleFound = null;

  function dfs(u) {
    color.set(u, GRAY);
    const deps = depsByNum.get(u) || [];
    for (const v of deps) {
      if (!color.has(v)) continue; // unknown wave — separate check elsewhere
      if (color.get(v) === GRAY) {
        // back-edge: reconstruct cycle u → ... → v → u
        const cyc = [u];
        let p = parent.get(u);
        while (p !== undefined && p !== v) {
          cyc.unshift(p);
          p = parent.get(p);
        }
        cyc.unshift(v);
        cyc.push(v);
        cycleFound = cyc;
        return true;
      }
      if (color.get(v) === WHITE) {
        parent.set(v, u);
        if (dfs(v)) return true;
      }
    }
    color.set(u, BLACK);
    return false;
  }

  for (const n of waveNums) {
    if (color.get(n) === WHITE) {
      if (dfs(n)) break;
    }
  }
  return cycleFound;
}

function runChecklistChecks(slug, feature, paths) {
  const checks = [];
  const errors = [];

  // --- Load files (with graceful fallback on missing) ---
  let spec = null;
  let plan = null;

  if (!fs.existsSync(paths.specAbs)) {
    errors.push(`spec not found: ${paths.specRel}`);
  } else {
    try {
      spec = readMd(paths.specAbs);
    } catch (e) {
      errors.push(`spec frontmatter parse error: ${e.message}`);
    }
  }

  if (errors.length > 0) {
    return { checks, errors, fatal: true };
  }

  const planExists = fs.existsSync(paths.planAbs);
  if (planExists) {
    try {
      plan = readMd(paths.planAbs);
    } catch (e) {
      errors.push(`wave-plan frontmatter parse error: ${e.message}`);
      return { checks, errors, fatal: true };
    }
  }

  // --- Check 1: spec status = clarified (BLOCKER) ---
  {
    const status = spec.fm.status || null;
    const ok = status === 'clarified';
    checks.push({
      id: 1,
      name: 'spec_status_clarified',
      severity: 'BLOCKER',
      result: ok ? 'PASS' : 'FAIL',
      detail: ok
        ? `Spec status is "clarified".`
        : `Spec status is "${status || '(missing)'}", expected "clarified".`,
    });
  }

  // --- Check 2: wave-plan exists (BLOCKER) ---
  {
    checks.push({
      id: 2,
      name: 'wave_plan_exists',
      severity: 'BLOCKER',
      result: planExists ? 'PASS' : 'FAIL',
      detail: planExists
        ? `Wave-plan present at ${paths.planRel}.`
        : `Wave-plan missing: expected ${paths.planRel}.`,
    });
  }

  // Without a plan, the remaining body-checks cannot run; mark them N/A as FAIL/PASS conservatively.
  if (!planExists) {
    checks.push({
      id: 3,
      name: 'waves_have_suggested_agents',
      severity: 'MAJOR',
      result: 'FAIL',
      detail: 'Skipped: no wave-plan to inspect.',
    });
    checks.push({
      id: 4,
      name: 'wave_dependencies_dag',
      severity: 'BLOCKER',
      result: 'FAIL',
      detail: 'Skipped: no wave-plan to inspect.',
    });
    checks.push({
      id: 5,
      name: 'waves_have_stories_advanced',
      severity: 'MAJOR',
      result: 'FAIL',
      detail: 'Skipped: no wave-plan to inspect.',
    });
    checks.push({
      id: 6,
      name: 'project_claudemd_exists',
      severity: 'MINOR',
      result: fs.existsSync(paths.claudemdAbs) ? 'PASS' : 'FAIL',
      detail: fs.existsSync(paths.claudemdAbs)
        ? `Project CLAUDE.md found at ${paths.claudemdRel}.`
        : `Project CLAUDE.md missing at ${paths.claudemdRel}.`,
    });
    checks.push({
      id: 7,
      name: 'plans_directory_convention',
      severity: 'MINOR',
      result: 'FAIL',
      detail: 'Skipped: no plans/ directory or no wave-plan present.',
    });
    checks.push({
      id: 8,
      name: 'plan_frontmatter_complete',
      severity: 'MAJOR',
      result: 'FAIL',
      detail: 'Skipped: no wave-plan to inspect.',
    });
    return { checks, errors, fatal: false };
  }

  // --- Body-driven checks: parse waves once ---
  const waveBlocks = extractWaveBlocks(plan.body);

  // --- Check 3: every wave has "Suggested agent(s):" (MAJOR) ---
  {
    const agentRe = /\bsuggested\s+agent\(?s\)?\s*:/i;
    const missing = waveBlocks
      .filter((b) => !agentRe.test(b.lines.join('\n')))
      .map((b) => b.label);
    const ok = waveBlocks.length > 0 && missing.length === 0;
    checks.push({
      id: 3,
      name: 'waves_have_suggested_agents',
      severity: 'MAJOR',
      result: ok ? 'PASS' : 'FAIL',
      detail:
        waveBlocks.length === 0
          ? 'No "## Wave N" headings found in plan body.'
          : ok
          ? `All ${waveBlocks.length} waves declare Suggested agent(s).`
          : `Waves missing Suggested agent(s): ${missing.join(', ')}.`,
    });
  }

  // --- Check 4: dependencies form a DAG (BLOCKER) ---
  {
    const nums = waveBlocks.map((b) => b.num);
    const depsByNum = new Map();
    for (const b of waveBlocks) depsByNum.set(b.num, extractWaveDependencies(b));
    const cycle = waveBlocks.length > 0 ? detectWaveCycles(nums, depsByNum) : null;
    checks.push({
      id: 4,
      name: 'wave_dependencies_dag',
      severity: 'BLOCKER',
      result: cycle ? 'FAIL' : 'PASS',
      detail: cycle
        ? `Dependency cycle detected: ${cycle.map((n) => `Wave ${n}`).join(' → ')}.`
        : `No cycles in wave dependencies (${nums.length} waves inspected).`,
    });
  }

  // --- Check 5: every wave has "**Stories advanced:**" (MAJOR) ---
  {
    const storiesRe = /\*\*\s*stories\s+advanced\s*:?\s*\*\*/i;
    const missing = waveBlocks
      .filter((b) => !storiesRe.test(b.lines.join('\n')))
      .map((b) => b.label);
    const ok = waveBlocks.length > 0 && missing.length === 0;
    checks.push({
      id: 5,
      name: 'waves_have_stories_advanced',
      severity: 'MAJOR',
      result: ok ? 'PASS' : 'FAIL',
      detail:
        waveBlocks.length === 0
          ? 'No "## Wave N" headings found in plan body.'
          : ok
          ? `All ${waveBlocks.length} waves reference Stories advanced.`
          : `Waves missing "**Stories advanced:**": ${missing.join(', ')}.`,
    });
  }

  // --- Check 6: project CLAUDE.md exists (MINOR) ---
  {
    const ok = fs.existsSync(paths.claudemdAbs);
    checks.push({
      id: 6,
      name: 'project_claudemd_exists',
      severity: 'MINOR',
      result: ok ? 'PASS' : 'FAIL',
      detail: ok
        ? `Project CLAUDE.md found at ${paths.claudemdRel}.`
        : `Project CLAUDE.md missing at ${paths.claudemdRel}.`,
    });
  }

  // --- Check 7: plans/ directory convention (MINOR) ---
  //
  // The expected wave-plan lives under projects/<slug>/plans/. Stray plan files
  // outside that directory (e.g. under projects/<slug>/ root) are a smell.
  {
    const projectRoot = path.join(vaultRoot(), 'projects', slug);
    const strays = [];
    if (fs.existsSync(projectRoot)) {
      try {
        const entries = fs.readdirSync(projectRoot);
        for (const e of entries) {
          if (/wave-plan\.md$/i.test(e)) {
            strays.push(`projects/${slug}/${e}`);
          }
        }
      } catch (_) {
        // ignore
      }
    }
    const dirOk = fs.existsSync(paths.plansDirAbs);
    const ok = dirOk && strays.length === 0;
    let detail;
    if (!dirOk) {
      detail = `Expected directory missing: ${paths.plansDirRel}/.`;
    } else if (strays.length > 0) {
      detail = `Stray wave-plan(s) outside plans/: ${strays.join(', ')}.`;
    } else {
      detail = `plans/ directory present, no stray wave-plans.`;
    }
    checks.push({
      id: 7,
      name: 'plans_directory_convention',
      severity: 'MINOR',
      result: ok ? 'PASS' : 'FAIL',
      detail,
    });
  }

  // --- Check 8: plan frontmatter has all required fields (MAJOR) ---
  {
    const missing = CHECKLIST_REQUIRED_PLAN_FM_FIELDS.filter((k) => {
      const v = plan.fm[k];
      if (v === undefined || v === null) return true;
      if (typeof v === 'string' && v.trim() === '') return true;
      if (Array.isArray(v) && v.length === 0) return true;
      return false;
    });
    const ok = missing.length === 0;
    checks.push({
      id: 8,
      name: 'plan_frontmatter_complete',
      severity: 'MAJOR',
      result: ok ? 'PASS' : 'FAIL',
      detail: ok
        ? `All required frontmatter fields present: ${CHECKLIST_REQUIRED_PLAN_FM_FIELDS.join(', ')}.`
        : `Plan frontmatter missing/empty fields: ${missing.join(', ')}.`,
    });
  }

  return { checks, errors, fatal: false };
}

function classifyChecklistResult(checks) {
  let blockers = 0,
    majors = 0,
    minors = 0;
  for (const c of checks) {
    if (c.result !== 'FAIL') continue;
    if (c.severity === 'BLOCKER') blockers++;
    else if (c.severity === 'MAJOR') majors++;
    else if (c.severity === 'MINOR') minors++;
  }
  let status, exit_code;
  if (blockers > 0) {
    status = 'FAIL';
    exit_code = 1;
  } else if (majors > 0 || minors > 0) {
    status = 'PASS_WITH_WARNINGS';
    exit_code = 0;
  } else {
    status = 'PASS';
    exit_code = 0;
  }
  return { status, exit_code, summary: { blockers, majors, minors } };
}

function formatChecklistHumanReport(report) {
  const lines = [];
  const label =
    report.status === 'PASS'
      ? 'PASS'
      : report.status === 'PASS_WITH_WARNINGS'
      ? 'PASS (mit Hinweisen)'
      : report.status === 'FAIL'
      ? 'FAIL'
      : 'ERROR';
  lines.push(`Pre-Flight Checkliste: ${label}`);
  lines.push('');
  lines.push(`Feature: ${report.feature} (Projekt: ${report.project})`);
  lines.push('');

  if (report.status === 'ERROR') {
    lines.push('Setup-Fehler:');
    for (const err of report.errors || []) lines.push(`  - ${err}`);
    lines.push('');
    lines.push('Empfehlung:');
    lines.push('  Pfade pruefen, fehlende Dateien anlegen oder Frontmatter reparieren.');
    return lines.join('\n');
  }

  const tick = (r) => (r === 'PASS' ? '[ok]' : '[x]');
  const sevTag = { BLOCKER: '[BLOCKER]', MAJOR: '[MAJOR]', MINOR: '[MINOR]' };
  lines.push('Pruefungen:');
  for (const c of report.checks) {
    lines.push(`  ${tick(c.result)} ${sevTag[c.severity]} ${c.name}`);
    lines.push(`        ${c.detail}`);
  }
  lines.push('');

  const s = report.summary;
  lines.push(
    `Befund: ${s.blockers} BLOCKER, ${s.majors} MAJOR, ${s.minors} MINOR offen.`
  );

  if (report.status === 'PASS') {
    lines.push('');
    lines.push('Empfehlung: Implementation kann starten.');
  } else if (report.status === 'PASS_WITH_WARNINGS') {
    lines.push('');
    lines.push(
      'Empfehlung: Implementation moeglich, aber MAJOR/MINOR Punkte vor Start adressieren.'
    );
  } else {
    lines.push('');
    lines.push('Empfehlung: BLOCKER beheben — Plan ist nicht implementierungsbereit.');
  }
  return lines.join('\n');
}

function cmdChecklistRun(args) {
  // Parse: <target> [--format json|human] [--save] [--vault <path>]
  const target = args[0];
  if (!target || target.startsWith('--')) {
    usage('checklist run requires <project-slug> or <project-slug>/<feature-id>');
  }
  const flags = parseFlags(args.slice(1), {
    format: 'value',
    save: 'bool',
    vault: 'value',
  });
  const format = flags.format || 'json';
  if (format !== 'json' && format !== 'human') {
    usage(`checklist run --format must be "json" or "human" (got: ${format})`);
  }
  if (flags.vault) process.env.A1_VAULT_ROOT = flags.vault;

  let slug, feature;
  try {
    const resolved = resolveChecklistTarget(target);
    slug = resolved.slug;
    feature = resolved.feature;
  } catch (e) {
    const report = {
      status: 'ERROR',
      exit_code: 2,
      project: target.split('/')[0] || null,
      feature: null,
      paths: {},
      checks: [],
      summary: { blockers: 0, majors: 0, minors: 0 },
      errors: [e.message],
    };
    emitChecklistReport(report, format);
    return;
  }

  const paths = checklistPaths(slug, feature);
  const { checks, errors, fatal } = runChecklistChecks(slug, feature, paths);

  if (fatal) {
    const report = {
      status: 'ERROR',
      exit_code: 2,
      project: slug,
      feature,
      paths: {
        spec: paths.specRel,
        plan: paths.planRel,
        claudemd: paths.claudemdRel,
      },
      checks: [],
      summary: { blockers: 0, majors: 0, minors: 0 },
      errors,
    };
    emitChecklistReport(report, format);
    return;
  }

  const classified = classifyChecklistResult(checks);
  const report = {
    status: classified.status,
    exit_code: classified.exit_code,
    project: slug,
    feature,
    paths: {
      spec: paths.specRel,
      plan: paths.planRel,
      claudemd: paths.claudemdRel,
    },
    checks,
    summary: classified.summary,
    errors: [],
  };

  if (flags.save) {
    try {
      if (!fs.existsSync(paths.checklistDirAbs)) {
        fs.mkdirSync(paths.checklistDirAbs, { recursive: true });
      }
      const date = new Date().toISOString().slice(0, 10);
      const num = feature.match(/^(\d{3,})/);
      const numStr = num ? num[1] : '000';
      const out = path.join(paths.checklistDirAbs, `${numStr}-${date}.md`);
      const body = `---\ntype: checklist-report\nproject: ${slug}\nfeature: ${feature}\nstatus: ${report.status}\ncreated: ${date}\n---\n\n${formatChecklistHumanReport(report)}\n\n## JSON\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
      const tmp = `${out}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, out);
      report.saved_to = `projects/${slug}/checklist/${numStr}-${date}.md`;
    } catch (e) {
      report.errors.push(`save failed: ${e.message}`);
    }
  }

  emitChecklistReport(report, format);
}

function emitChecklistReport(report, format) {
  if (format === 'human') {
    process.stdout.write(formatChecklistHumanReport(report) + '\n');
  } else {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
  process.exit(report.exit_code);
}

function cmdChecklistList(args) {
  const slug = args[0];
  if (!slug || slug.startsWith('--')) {
    usage('checklist list requires <project-slug>');
  }
  const flags = parseFlags(args.slice(1), { vault: 'value' });
  if (flags.vault) process.env.A1_VAULT_ROOT = flags.vault;
  const dir = path.join(vaultRoot(), 'projects', slug, 'checklist');
  if (!fs.existsSync(dir)) {
    return { project: slug, reports: [] };
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.md$/.test(f))
    .sort()
    .reverse();
  const reports = files.map((f) => {
    const abs = path.join(dir, f);
    let fm = {};
    try {
      const parsed = readMd(abs);
      fm = parsed.fm || {};
    } catch (_) {}
    return {
      file: `projects/${slug}/checklist/${f}`,
      feature: fm.feature || null,
      status: fm.status || null,
      created: fm.created || null,
    };
  });
  return { project: slug, reports };
}

// ---------- worktree subcommands ----------

const WORKTREE_STATUSES = new Set(['prepared', 'active', 'handoff', 'cleaned']);
const WORKTREE_EXIT_MODES = new Set(['keep', 'discard', 'handoff']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const { execFileSync } = require('child_process');

function worktreeRegistryPath() {
  if (process.env.A1_WORKTREE_REGISTRY) return process.env.A1_WORKTREE_REGISTRY;
  return path.join(os.homedir(), '.a1-worktrees-registry.json');
}

function readRegistry() {
  const p = worktreeRegistryPath();
  if (!fs.existsSync(p)) return { version: 1, worktrees: [] };
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.worktrees)) {
      throw new Error('registry shape invalid');
    }
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch (e) {
    throw new Error(`cannot parse worktree registry ${p}: ${e.message}`);
  }
}

function writeRegistryAtomic(reg) {
  const p = worktreeRegistryPath();
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function nowCompactId(slug) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}`;
  return `${stamp}-${slug}`;
}

function git(repoRoot, args, opts = {}) {
  // Returns trimmed stdout. Throws Error with stderr on non-zero exit unless allowFail.
  try {
    const out = execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch (e) {
    const msg = (e.stderr && e.stderr.toString().trim()) || e.message;
    if (opts.allowFail) return { __error: msg, __code: e.status };
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

function gitIsRepo(repoRoot) {
  if (!fs.existsSync(repoRoot)) return false;
  const res = git(repoRoot, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
  if (typeof res === 'string') return res === 'true';
  return false;
}

function gitWorkingTreeClean(repoRoot) {
  const out = git(repoRoot, ['status', '--porcelain']);
  return out.length === 0;
}

function gitBranchExists(repoRoot, branch) {
  const res = git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
    allowFail: true,
  });
  return typeof res === 'string' && res.length > 0;
}

function gitWorktreeList(repoRoot) {
  // Returns array of { path, branch }
  const out = git(repoRoot, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let cur = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) entries.push(cur);
      cur = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  if (cur.path) entries.push(cur);
  return entries;
}

function gitBranchHasWorktree(repoRoot, branch) {
  return gitWorktreeList(repoRoot).some((w) => w.branch === branch);
}

function findRegistryEntry(reg, id) {
  return reg.worktrees.find((w) => w.id === id);
}

function findActiveBySlug(reg, repoRoot, slug) {
  return reg.worktrees.find(
    (w) => w.repo_root === repoRoot && w.slug === slug && w.status !== 'cleaned'
  );
}

function repoParentWorktreeDir(repoRoot) {
  return path.join(path.dirname(repoRoot), 'a1-worktrees');
}

function cmdWorktreePrepare(args) {
  const flags = parseFlags(args, {
    branch: 'string',
    base: 'string',
    'force-reset': 'bool',
  });
  const [repoRootRaw, slug] = flags._;
  if (!repoRootRaw) usage('worktree prepare requires <repo-root>');
  if (!slug) usage('worktree prepare requires <slug>');
  const repoRoot = path.resolve(repoRootRaw);
  const branch = flags.branch || `feature/${slug}`;
  const baseBranch = flags.base || 'main';

  const checks = [];
  const fail = (name, hint) => checks.push({ name, result: 'FAIL', hint });
  const pass = (name) => checks.push({ name, result: 'PASS' });

  // 1. slug valid
  if (!SLUG_RE.test(slug)) {
    process.stderr.write(`error: invalid slug "${slug}" (must match ${SLUG_RE})\n`);
    process.exit(2);
  }
  pass('slug_valid');

  // 2. repo exists & is git
  if (!gitIsRepo(repoRoot)) {
    process.stderr.write(`error: ${repoRoot} is not a git repository\n`);
    process.exit(2);
  }
  pass('repo_is_git');

  // 3. working tree clean
  if (gitWorkingTreeClean(repoRoot)) pass('working_tree_clean');
  else fail('working_tree_clean', 'Working tree has uncommitted changes');

  // 4. base branch exists
  if (gitBranchExists(repoRoot, baseBranch)) pass('base_branch_exists');
  else fail('base_branch_exists', `Base branch "${baseBranch}" does not exist`);

  // 5. target branch free OR not in worktree
  if (gitBranchExists(repoRoot, branch)) {
    if (gitBranchHasWorktree(repoRoot, branch)) {
      fail('target_branch_free', `Branch "${branch}" already has a worktree`);
    } else {
      // branch exists but no worktree — acceptable, we'll attach to it
      pass('target_branch_free');
    }
  } else {
    pass('target_branch_free');
  }

  // 6. worktree path free
  const worktreePath = path.join(repoParentWorktreeDir(repoRoot), slug);
  if (fs.existsSync(worktreePath)) {
    fail('worktree_path_free', `Path ${worktreePath} already exists`);
  } else {
    pass('worktree_path_free');
  }

  // 7. no active registry entry
  const reg = readRegistry();
  const existing = findActiveBySlug(reg, repoRoot, slug);
  if (existing && !flags['force-reset']) {
    fail(
      'no_active_registry_entry',
      `Registry already has active entry ${existing.id} (status=${existing.status}) for this repo+slug`
    );
  } else {
    pass('no_active_registry_entry');
  }

  const blocker = checks.some((c) => c.result === 'FAIL');
  if (blocker) {
    process.stdout.write(JSON.stringify({ status: 'BLOCKER', checks }, null, 2) + '\n');
    process.exit(1);
  }

  // All green — write registry entry
  const id = nowCompactId(slug);
  const entry = {
    id,
    slug,
    repo_root: repoRoot,
    worktree_path: worktreePath,
    branch,
    base_branch: baseBranch,
    status: 'prepared',
    created_at: nowIso(),
    last_status_change: nowIso(),
    agent_brief: null,
    commit_count: 0,
    exit_mode: null,
    phase_history: [`phase=prepare completed=${nowIso()}`],
  };

  // If force-reset, drop the old active entry
  if (flags['force-reset'] && existing) {
    reg.worktrees = reg.worktrees.filter((w) => w.id !== existing.id);
  }
  reg.worktrees.push(entry);
  writeRegistryAtomic(reg);

  return {
    id,
    repo_root: repoRoot,
    worktree_path: worktreePath,
    branch,
    base_branch: baseBranch,
    status: 'prepared',
    checks,
  };
}

function cmdWorktreeEnter(args) {
  const flags = parseFlags(args, {});
  const id = flags._[0];
  if (!id) usage('worktree enter requires <id>');
  const reg = readRegistry();
  const entry = findRegistryEntry(reg, id);
  if (!entry) {
    process.stderr.write(`error: no registry entry with id "${id}"\n`);
    process.exit(1);
  }
  if (entry.status !== 'prepared') {
    process.stderr.write(`error: entry ${id} has status "${entry.status}", expected "prepared"\n`);
    process.exit(1);
  }
  // race-safety: path still free?
  if (fs.existsSync(entry.worktree_path)) {
    process.stderr.write(`error: worktree path ${entry.worktree_path} appeared since prepare\n`);
    process.exit(1);
  }

  // ensure parent dir exists
  fs.mkdirSync(path.dirname(entry.worktree_path), { recursive: true });

  // git worktree add: -b only if branch does not yet exist
  const branchExists = gitBranchExists(entry.repo_root, entry.branch);
  const gitArgs = branchExists
    ? ['worktree', 'add', entry.worktree_path, entry.branch]
    : ['worktree', 'add', '-b', entry.branch, entry.worktree_path, entry.base_branch];

  const res = git(entry.repo_root, gitArgs, { allowFail: true });
  if (res && typeof res === 'object' && res.__error) {
    process.stderr.write(`error: git worktree add failed: ${res.__error}\n`);
    process.exit(1);
  }

  entry.status = 'active';
  entry.last_status_change = nowIso();
  entry.phase_history.push(`phase=enter completed=${nowIso()}`);
  writeRegistryAtomic(reg);

  return {
    id,
    worktree_path: entry.worktree_path,
    branch: entry.branch,
    status: 'active',
  };
}

function cmdWorktreeStatus(args) {
  const flags = parseFlags(args, {});
  const id = flags._[0];
  if (!id) usage('worktree status requires <id>');
  const reg = readRegistry();
  const entry = findRegistryEntry(reg, id);
  if (!entry) {
    process.stderr.write(`error: no registry entry with id "${id}"\n`);
    process.exit(1);
  }

  const result = {
    id: entry.id,
    slug: entry.slug,
    repo_root: entry.repo_root,
    worktree_path: entry.worktree_path,
    branch: entry.branch,
    base_branch: entry.base_branch,
    status: entry.status,
    worktree_exists_on_disk: fs.existsSync(entry.worktree_path),
    has_uncommitted: null,
    commit_count: null,
    branch_ahead: null,
    branch_behind: null,
  };

  if (result.worktree_exists_on_disk && entry.status === 'active') {
    const status = git(entry.worktree_path, ['status', '--porcelain'], { allowFail: true });
    result.has_uncommitted = typeof status === 'string' ? status.length > 0 : null;

    const range = `${entry.base_branch}..${entry.branch}`;
    const aheadOut = git(entry.repo_root, ['rev-list', '--count', range], { allowFail: true });
    if (typeof aheadOut === 'string') {
      const n = parseInt(aheadOut, 10);
      result.branch_ahead = Number.isNaN(n) ? null : n;
      result.commit_count = result.branch_ahead;
    }
    const behindOut = git(entry.repo_root, ['rev-list', '--count', `${entry.branch}..${entry.base_branch}`], {
      allowFail: true,
    });
    if (typeof behindOut === 'string') {
      const n = parseInt(behindOut, 10);
      result.branch_behind = Number.isNaN(n) ? null : n;
    }
  }

  return result;
}

function cmdWorktreeExit(args) {
  const flags = parseFlags(args, {
    mode: 'string',
    'force-discard': 'bool',
  });
  const id = flags._[0];
  if (!id) usage('worktree exit requires <id>');
  if (!flags.mode) usage('worktree exit requires --mode <keep|discard|handoff>');
  if (!WORKTREE_EXIT_MODES.has(flags.mode)) {
    usage(`invalid --mode "${flags.mode}", expected one of: ${[...WORKTREE_EXIT_MODES].join(', ')}`);
  }
  const mode = flags.mode;

  const reg = readRegistry();
  const entry = findRegistryEntry(reg, id);
  if (!entry) {
    process.stderr.write(`error: no registry entry with id "${id}"\n`);
    process.exit(1);
  }
  if (entry.status === 'cleaned') {
    process.stderr.write(`error: entry ${id} is already cleaned\n`);
    process.exit(1);
  }

  let removed = false;
  let branchKept = true;

  if (mode === 'handoff') {
    entry.status = 'handoff';
    entry.exit_mode = 'handoff';
    entry.last_status_change = nowIso();
    entry.phase_history.push(`phase=exit-handoff completed=${nowIso()}`);
    writeRegistryAtomic(reg);
    return {
      id,
      exit_mode: 'handoff',
      status: 'handoff',
      removed: false,
      branch_kept: true,
    };
  }

  // For keep / discard, we need to remove the worktree.
  // For discard, also check unmerged commits unless --force-discard.
  if (mode === 'discard' && !flags['force-discard']) {
    if (gitBranchExists(entry.repo_root, entry.branch)) {
      const aheadOut = git(entry.repo_root, ['rev-list', '--count', `${entry.base_branch}..${entry.branch}`], {
        allowFail: true,
      });
      const ahead = typeof aheadOut === 'string' ? parseInt(aheadOut, 10) : 0;
      if (ahead > 0) {
        process.stderr.write(
          `error: branch "${entry.branch}" is ${ahead} commit(s) ahead of "${entry.base_branch}". ` +
            `Refusing discard. Re-run with --force-discard, or use --mode handoff.\n`
        );
        process.exit(1);
      }
    }
  }

  // Remove worktree (if it exists on disk)
  if (fs.existsSync(entry.worktree_path)) {
    const removeArgs = ['worktree', 'remove'];
    if (mode === 'discard' && flags['force-discard']) removeArgs.push('--force');
    removeArgs.push(entry.worktree_path);
    const res = git(entry.repo_root, removeArgs, { allowFail: true });
    if (res && typeof res === 'object' && res.__error) {
      process.stderr.write(`error: git worktree remove failed: ${res.__error}\n`);
      process.exit(1);
    }
    removed = true;
  } else {
    // Prune stale registration in git if any
    git(entry.repo_root, ['worktree', 'prune'], { allowFail: true });
    removed = true;
  }

  if (mode === 'discard') {
    if (gitBranchExists(entry.repo_root, entry.branch)) {
      const delArgs = ['branch', flags['force-discard'] ? '-D' : '-d', entry.branch];
      const res = git(entry.repo_root, delArgs, { allowFail: true });
      if (res && typeof res === 'object' && res.__error) {
        process.stderr.write(`error: git branch delete failed: ${res.__error}\n`);
        process.exit(1);
      }
      branchKept = false;
    } else {
      branchKept = false;
    }
  }

  entry.status = 'cleaned';
  entry.exit_mode = mode;
  entry.last_status_change = nowIso();
  entry.phase_history.push(`phase=exit-${mode} completed=${nowIso()}`);
  writeRegistryAtomic(reg);

  return {
    id,
    exit_mode: mode,
    status: 'cleaned',
    removed,
    branch_kept: branchKept,
  };
}

function cmdWorktreeList(args) {
  const flags = parseFlags(args, {
    status: 'string',
    'repo-root': 'string',
  });
  const reg = readRegistry();
  let entries = reg.worktrees.slice();
  if (flags.status) {
    if (!WORKTREE_STATUSES.has(flags.status)) {
      usage(`invalid --status "${flags.status}", expected one of: ${[...WORKTREE_STATUSES].join(', ')}`);
    }
    entries = entries.filter((e) => e.status === flags.status);
  }
  if (flags['repo-root']) {
    const abs = path.resolve(flags['repo-root']);
    entries = entries.filter((e) => e.repo_root === abs);
  }
  entries.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return {
    count: entries.length,
    worktrees: entries.map((e) => ({
      id: e.id,
      slug: e.slug,
      status: e.status,
      branch: e.branch,
      base_branch: e.base_branch,
      repo_root: e.repo_root,
      worktree_path: e.worktree_path,
      created_at: e.created_at,
      exit_mode: e.exit_mode,
    })),
  };
}

function cmdWorktreeGc(args) {
  const flags = parseFlags(args, { 'dry-run': 'bool' });
  const reg = readRegistry();
  const stale = [];
  const removedFromRegistry = [];

  for (const e of reg.worktrees) {
    if (e.status === 'cleaned') continue;
    if (!fs.existsSync(e.worktree_path) && e.status !== 'handoff') {
      stale.push({ id: e.id, reason: 'worktree path missing', path: e.worktree_path });
      if (!flags['dry-run']) {
        e.status = 'cleaned';
        e.exit_mode = e.exit_mode || 'gc';
        e.last_status_change = nowIso();
        e.phase_history.push(`phase=gc completed=${nowIso()}`);
        removedFromRegistry.push(e.id);
      }
    }
  }

  if (!flags['dry-run'] && removedFromRegistry.length > 0) writeRegistryAtomic(reg);

  return {
    count: stale.length,
    stale,
    removed: removedFromRegistry,
    dry_run: !!flags['dry-run'],
  };
}

function resolveRealOrAbs(p) {
  // git worktree list --porcelain prints realpaths (symlinks resolved, e.g.
  // macOS /tmp -> /private/tmp). path.resolve() alone does not resolve
  // symlinks, so comparing a raw CLI arg against git's output can spuriously
  // mismatch. Prefer the realpath when the path exists on disk; fall back to
  // plain resolve otherwise (path may legitimately not exist yet).
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch (_e) {
    return abs;
  }
}

function cmdWorktreeAdopt(args) {
  const flags = parseFlags(args, { 'worktree-path': 'string', branch: 'string', base: 'string' });
  const [repoRootRaw, slug] = flags._;
  if (!repoRootRaw || !slug) usage('worktree adopt requires <repo-root> <slug>');

  if (!SLUG_RE.test(slug)) {
    process.stderr.write(`error: invalid slug "${slug}" (must match ${SLUG_RE})\n`);
    process.exit(2);
  }

  const repoRoot = path.resolve(repoRootRaw);
  if (!gitIsRepo(repoRoot)) {
    process.stderr.write(`error: ${repoRoot} is not a git repository\n`);
    process.exit(2);
  }
  const repoRootReal = resolveRealOrAbs(repoRootRaw);

  const wts = gitWorktreeList(repoRoot).filter((w) => path.resolve(w.path) !== repoRootReal);

  let matches;
  if (flags['worktree-path']) {
    const target = resolveRealOrAbs(flags['worktree-path']);
    matches = wts.filter((w) => path.resolve(w.path) === target);
  } else if (flags.branch) {
    matches = wts.filter((w) => w.branch === flags.branch);
  } else {
    matches = wts.filter((w) => path.basename(w.path) === slug);
  }

  if (matches.length === 0) {
    process.stderr.write('error: no git worktree matches; candidates:\n');
    process.stdout.write(JSON.stringify({ status: 'NOT_FOUND', candidates: wts }, null, 2) + '\n');
    process.exit(1);
  }
  if (matches.length > 1) {
    process.stderr.write('error: multiple git worktrees match — pass --worktree-path to disambiguate\n');
    process.stdout.write(JSON.stringify({ status: 'AMBIGUOUS', candidates: wts }, null, 2) + '\n');
    process.exit(1);
  }
  const match = matches[0];

  const reg = readRegistry();
  const existingActive = findActiveBySlug(reg, repoRoot, slug);
  if (existingActive) {
    process.stderr.write(
      `error: registry already has active entry ${existingActive.id} for this repo+slug — nothing to adopt\n`
    );
    process.exit(1);
  }
  const resolvedMatchPath = path.resolve(match.path);
  const existingPath = reg.worktrees.find(
    (w) =>
      w.status !== 'cleaned' &&
      resolveRealOrAbs(w.worktree_path) === resolveRealOrAbs(resolvedMatchPath)
  );
  if (existingPath) {
    process.stderr.write(`error: worktree path already registered as ${existingPath.id}\n`);
    process.exit(1);
  }

  const branch = match.branch || flags.branch || null;
  const baseBranch = flags.base || 'main';
  const id = nowCompactId(slug);
  const commitCountRaw = branch
    ? git(repoRoot, ['rev-list', '--count', `${baseBranch}..${branch}`], { allowFail: true })
    : null;
  const commitCount =
    typeof commitCountRaw === 'string' && commitCountRaw.length > 0 ? parseInt(commitCountRaw, 10) : 0;

  const entry = {
    id,
    slug,
    repo_root: repoRoot,
    worktree_path: resolvedMatchPath,
    branch,
    base_branch: baseBranch,
    status: 'active',
    created_at: nowIso(),
    last_status_change: nowIso(),
    agent_brief: null,
    commit_count: commitCount,
    exit_mode: null,
    phase_history: [`phase=adopt completed=${nowIso()}`],
  };

  reg.worktrees.push(entry);
  writeRegistryAtomic(reg);

  return {
    id,
    slug,
    repo_root: repoRoot,
    worktree_path: resolvedMatchPath,
    branch,
    base_branch: baseBranch,
    status: 'active',
    commit_count: commitCount,
    adopted: true,
  };
}

function cmdWorktreeReconcile(args) {
  const flags = parseFlags(args, { prune: 'bool' });
  const [repoRootRaw] = flags._;
  if (!repoRootRaw) usage('worktree reconcile requires <repo-root>');

  const repoRoot = path.resolve(repoRootRaw);
  if (!gitIsRepo(repoRoot)) {
    process.stderr.write(`error: ${repoRoot} is not a git repository\n`);
    process.exit(2);
  }
  const repoRootReal = resolveRealOrAbs(repoRootRaw);

  const gitWts = gitWorktreeList(repoRoot).filter((w) => path.resolve(w.path) !== repoRootReal);
  const reg = readRegistry();

  // Direction A (registry -> disk): registry entries with no matching git
  // worktree AND no path on disk are stale (orphaned registrations).
  const stale = [];
  const pruned = [];
  for (const e of reg.worktrees) {
    if (e.repo_root !== repoRoot || e.status === 'cleaned') continue;
    const entryPathReal = resolveRealOrAbs(e.worktree_path);
    const hasGitMatch = gitWts.some((w) => path.resolve(w.path) === entryPathReal);
    if (hasGitMatch || fs.existsSync(e.worktree_path)) continue;
    stale.push({
      id: e.id,
      slug: e.slug,
      path: e.worktree_path,
      reason: 'registry entry has no git worktree and path missing on disk',
    });
    if (flags.prune) {
      e.status = 'cleaned';
      e.exit_mode = e.exit_mode || 'reconcile';
      e.last_status_change = nowIso();
      e.phase_history.push(`phase=reconcile completed=${nowIso()}`);
      pruned.push(e.id);
    }
  }

  // Direction B (disk -> registry): git worktrees with no non-cleaned
  // registry entry are adopt candidates.
  const adoptCandidates = [];
  for (const w of gitWts) {
    const wPathReal = resolveRealOrAbs(w.path);
    const hasRegMatch = reg.worktrees.some(
      (e) => e.status !== 'cleaned' && resolveRealOrAbs(e.worktree_path) === wPathReal
    );
    if (hasRegMatch) continue;
    adoptCandidates.push({
      path: w.path,
      branch: w.branch || null,
      hint: `a1-tools worktree adopt ${repoRoot} <slug> --worktree-path ${w.path}`,
    });
  }

  if (flags.prune && pruned.length > 0) writeRegistryAtomic(reg);

  return {
    repo_root: repoRoot,
    in_sync: stale.length === 0 && adoptCandidates.length === 0,
    stale,
    pruned,
    adopt_candidates: adoptCandidates,
    prune: !!flags.prune,
  };
}

// ---------- entry point ----------

// ---------------------------------------------------------------------------
// pr — a1-pr-review CLI helpers (registry filter, findings summary, status)
// ---------------------------------------------------------------------------

function prReviewDir(worktreePath) {
  return path.join(worktreePath, '.a1-review');
}

function ensurePrReviewDir(worktreePath) {
  const d = prReviewDir(worktreePath);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function readFindings(worktreePath) {
  const p = path.join(prReviewDir(worktreePath), 'findings.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`cannot parse findings.json at ${p}: ${e.message}`);
  }
}

function findEntryBySlugOrId(reg, slugOrId) {
  // Prefer id match (exact, includes timestamp), fall back to unique slug.
  const byId = reg.worktrees.find((w) => w.id === slugOrId);
  if (byId) return byId;
  const bySlug = reg.worktrees.filter(
    (w) => w.slug === slugOrId && w.status !== 'cleaned'
  );
  if (bySlug.length === 1) return bySlug[0];
  if (bySlug.length > 1) {
    throw new Error(
      `slug "${slugOrId}" matches ${bySlug.length} non-cleaned entries; pass id instead`
    );
  }
  return null;
}

const PR_STATUSES = new Set([
  'handoff',
  'in-review',
  'reviewed',
  'pr-open',
]);

function cmdPrListHandoff(args) {
  const flags = parseFlags(args, { 'repo-root': 'string' });
  const reg = readRegistry();
  let entries = reg.worktrees.filter((w) => w.status === 'handoff');
  if (flags['repo-root']) {
    entries = entries.filter((w) => w.repo_root === flags['repo-root']);
  }
  return {
    count: entries.length,
    entries: entries.map((w) => ({
      id: w.id,
      slug: w.slug,
      repo_root: w.repo_root,
      worktree_path: w.worktree_path,
      branch: w.branch,
      created_at: w.created_at,
      base: w.base || 'main',
      last_phase_note:
        Array.isArray(w.phase_history) && w.phase_history.length > 0
          ? w.phase_history[w.phase_history.length - 1]
          : null,
    })),
  };
}

function cmdPrMarkStatus(args) {
  if (args.length < 2) usage('pr mark-status requires <id-or-slug> <new-status>');
  const [slugOrId, newStatus] = args;
  if (!PR_STATUSES.has(newStatus)) {
    fail(`invalid pr status "${newStatus}". valid: ${[...PR_STATUSES].join(', ')}`);
  }
  const reg = readRegistry();
  const entry = findEntryBySlugOrId(reg, slugOrId);
  if (!entry) fail(`no registry entry for "${slugOrId}"`);
  const prev = entry.status;
  entry.status = newStatus;
  if (!Array.isArray(entry.phase_history)) entry.phase_history = [];
  entry.phase_history.push({
    at: nowIso(),
    from: prev,
    to: newStatus,
    by: 'a1-pr-review',
  });
  writeRegistryAtomic(reg);
  return { id: entry.id, slug: entry.slug, status: newStatus, previous: prev };
}

function cmdPrMarkPrOpen(args) {
  if (args.length < 2) usage('pr mark-pr-open requires <id-or-slug> <pr-url>');
  const [slugOrId, prUrl] = args;
  if (!/^https?:\/\//.test(prUrl)) fail(`pr-url must start with http(s)://: ${prUrl}`);
  const reg = readRegistry();
  const entry = findEntryBySlugOrId(reg, slugOrId);
  if (!entry) fail(`no registry entry for "${slugOrId}"`);
  const prev = entry.status;
  entry.status = 'pr-open';
  entry.pr_url = prUrl;
  if (!Array.isArray(entry.phase_history)) entry.phase_history = [];
  entry.phase_history.push({
    at: nowIso(),
    from: prev,
    to: 'pr-open',
    by: 'a1-pr-review',
    pr_url: prUrl,
  });
  writeRegistryAtomic(reg);
  return { id: entry.id, slug: entry.slug, status: 'pr-open', pr_url: prUrl };
}

function formatFindingMd(f) {
  const loc = f.file ? (f.line ? `${f.file}:${f.line}` : f.file) : '(no location)';
  const title = f.title || '(no title)';
  const detail = f.detail ? `\n  > ${String(f.detail).replace(/\n/g, '\n  > ')}` : '';
  return `- **${title}** — \`${loc}\`${detail}`;
}

function formatInlineMinorMd(f) {
  const loc = f.file ? (f.line ? `${f.file}:${f.line}` : f.file) : '(no location)';
  const title = f.title || '(no title)';
  const detail = f.detail ? `: ${f.detail}` : '';
  return `- \`${loc}\` — ${title}${detail}`;
}

function cmdPrFindingsSummary(args) {
  const flags = parseFlags(args, { 'worktree-path': 'string' });
  if (!flags['worktree-path'] && flags._.length < 1) {
    usage('pr findings-summary requires <id-or-slug> or --worktree-path');
  }
  const [slugOrId] = flags._;

  if (flags['worktree-path']) {
    const wtPath = path.resolve(flags['worktree-path']);
    if (!fs.existsSync(wtPath)) fail(`worktree path does not exist: ${wtPath}`);
    const findings = readFindings(wtPath);
    if (!findings) {
      fail(`no findings.json in ${wtPath}/.a1-review/ — run Phase 2 first`);
    }
    const blocker = Array.isArray(findings.blocker) ? findings.blocker : [];
    const major = Array.isArray(findings.major) ? findings.major : [];
    const minor = Array.isArray(findings.minor) ? findings.minor : [];
    return {
      id: null,
      slug: path.basename(wtPath),
      worktree_path: wtPath,
      source: 'direct-path',
      summary: findings.summary || '',
      counts: {
        blocker: blocker.length,
        major: major.length,
        minor: minor.length,
      },
      blocker_md: blocker.map(formatFindingMd).join('\n'),
      major_md: major.map(formatFindingMd).join('\n'),
      inline_minor_md: minor.map(formatInlineMinorMd).join('\n'),
    };
  }

  const reg = readRegistry();
  const entry = findEntryBySlugOrId(reg, slugOrId);
  if (!entry) fail(`no registry entry for "${slugOrId}"`);
  const findings = readFindings(entry.worktree_path);
  if (!findings) {
    fail(`no findings.json in ${entry.worktree_path}/.a1-review/ — run Phase 2 first`);
  }
  const blocker = Array.isArray(findings.blocker) ? findings.blocker : [];
  const major = Array.isArray(findings.major) ? findings.major : [];
  const minor = Array.isArray(findings.minor) ? findings.minor : [];
  return {
    id: entry.id,
    slug: entry.slug,
    worktree_path: entry.worktree_path,
    summary: findings.summary || '',
    counts: {
      blocker: blocker.length,
      major: major.length,
      minor: minor.length,
    },
    blocker_md: blocker.map(formatFindingMd).join('\n'),
    major_md: major.map(formatFindingMd).join('\n'),
    inline_minor_md: minor.map(formatInlineMinorMd).join('\n'),
  };
}

// ---------- modernize subcommands ----------
//
// Brownfield modernization pipeline. Owns master files in the vault under
// projects/<slug>/modernize/<YYYY-MM-DD>-<mode>[-N].md. The CLI handles
// deterministic operations: slot calculation, frontmatter updates, proposal
// management, wave lifecycle, parity snapshot, listing. Sub-agents do the
// thinking in the skill phases.
//
// FMEA-2 (computed parity): snapshot-behavior --manual-smoke stores a sha256
// snapshot_hash of the smoke artifact in parity_baseline. complete-wave then
// requires --replay-file and byte-diffs it against the baseline manual_smoke_doc
// itself — a self-asserted `--snapshot-replay pass` alone is rejected once a
// snapshot_hash exists. Legacy baselines (no hash) keep claim-based behavior.
// FMEA-5 (approval audit trail): update-status / approve-proposal / start-wave
// accept --approved-by <human|harness:reason>. update-status appends it to the
// phase_history entry; approve-proposal/start-wave set approved_by on the object.

function modernizeDir(projectSlug) {
  return path.join(vaultRoot(), 'projects', projectSlug, 'modernize');
}

function cmdModernizeNextSlot(args) {
  const flags = parseFlags(args, { date: 'value' });
  const projectSlug = flags._[0];
  const focus = flags._[1] || 'full';
  if (!projectSlug) {
    usage('modernize next-slot requires <project-slug> [<focus>] [--date YYYY-MM-DD]');
  }
  const date = flags.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage(`invalid date "${date}", expected YYYY-MM-DD`);
  }
  const dir = modernizeDir(projectSlug);
  let used = new Set();
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^${date}-${focus}(-(\\d+))?\\.md$`);
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(re);
      if (m) used.add(m[2] ? parseInt(m[2], 10) : 1);
    }
  }
  let n = 1;
  while (used.has(n)) n++;
  const suffix = n === 1 ? '' : `-${n}`;
  const filename = `${date}-${focus}${suffix}.md`;
  return {
    project: projectSlug,
    focus,
    date,
    suffix,
    filename,
    path: path.join(dir, filename),
    dir,
  };
}

function cmdModernizeInit(args) {
  const flags = parseFlags(args, {
    'project-path': 'value',
    'date': 'value',
    'title': 'value',
  });
  const projectSlug = flags._[0];
  const mode = flags._[1] || 'full';
  if (!projectSlug) {
    usage('modernize init requires <project-slug> <mode> [--project-path /abs] [--date YYYY-MM-DD]');
  }
  if (!MODERNIZE_MODES.has(mode)) {
    usage(`invalid mode "${mode}". valid: ${[...MODERNIZE_MODES].join(', ')}`);
  }
  const slot = cmdModernizeNextSlot([projectSlug, mode, ...(flags.date ? ['--date', flags.date] : [])]);
  const filePath = slot.path;
  if (!fs.existsSync(slot.dir)) fs.mkdirSync(slot.dir, { recursive: true });

  const title = flags.title || `${mode} modernization of ${projectSlug}`;
  const analyzedPath = flags['project-path'] || '';

  const fm = {
    type: 'modernize-uplift',
    project_slug: projectSlug,
    focus: mode,
    mode,
    title,
    status: 'scoped',
    created_at: nowIso(),
    analyzed_path: analyzedPath,
    parity_baseline: ['snapshot_taken_at=null', 'test_count=0', 'manual_smoke_doc=null'],
    phase_history: [`phase=scope completed=${nowIso()}`],
    discover: ['tech_stack=[]', 'loc=0', 'file_count=0', 'test_coverage_pre=null'],
    open_questions: [],
    proposals: [],
    waves: [],
    notion_export: ['page_id=null', 'exported_at=null', 'fallback_path=null'],
    suggested_next: [],
  };

  const body = `# Modernize: ${title}

## Scope

- Project: ${projectSlug}
- Mode: ${mode}
- Analyzed path: ${analyzedPath || '<not set>'}

## Reverse-Spec (Phase 2)

<filled by a1-rafael-reverse-spec>

## Gap Findings (Phase 3)

<filled by reinhard + alex + reconcile>

## Tech Proposals (Phase 4)

<filled by stack-conditional agents>

## Plan (Phase 5)

<filled by a1-pablo-planner>

## Wave Execution (Phase 6)

<filled per wave by a1-erik-executor>

## Report (Phase 7)

<filled on publish>
`;

  writeMdAtomic(filePath, fm, body);
  return {
    path: filePath,
    project: projectSlug,
    mode,
    status: 'scoped',
  };
}

const MODERNIZE_STATUS_TO_PHASE = {
  'scoped': 'scope',
  'spec-drafted': 'reverse-spec',
  'gap-analyzed': 'gap-analysis',
  'proposals-pending': 'tech-proposals',
  'planned': 'plan',
  'executing': 'execute',
  'executed': 'execute-complete',
  'published': 'publish',
  'cancelled': 'cancelled',
};

function cmdModernizeUpdateStatus(args) {
  const masterPathInput = args[0];
  const newStatus = args[1];
  if (!masterPathInput || !newStatus) {
    usage('modernize update-status requires <master-path> <new-status> [--phase-data <json>] [--approved-by <human|harness:reason>]');
  }
  if (!MODERNIZE_STATUSES.has(newStatus)) {
    usage(`invalid modernize status "${newStatus}". valid: ${[...MODERNIZE_STATUSES].join(', ')}`);
  }
  const flags = parseFlags(args.slice(2), { 'phase-data': 'value', 'approved-by': 'value' });
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  fm.status = newStatus;
  const phase = MODERNIZE_STATUS_TO_PHASE[newStatus];
  if (phase) {
    appendPhaseHistory(fm, phase);
    // FMEA-5: audit trail. Auto-approval stays possible but leaves a record —
    // append approved_by=<value> onto the just-written phase_history entry.
    if (flags['approved-by']) {
      const last = fm.phase_history.length - 1;
      fm.phase_history[last] = `${fm.phase_history[last]} approved_by=${flags['approved-by']}`;
    }
  }
  if (flags['phase-data']) {
    let extra;
    try { extra = JSON.parse(flags['phase-data']); } catch (e) {
      fail(`--phase-data is not valid JSON: ${e.message}`);
    }
    Object.assign(fm, extra);
  }
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, status: newStatus };
}

function cmdModernizeDiscoverStack(args) {
  const projectPath = args[0];
  if (!projectPath) usage('modernize discover-stack requires <project-path>');
  if (!fs.existsSync(projectPath)) fail(`project path not found: ${projectPath}`);

  const techStack = [];
  const root = projectPath;

  // Node/JS ecosystem
  if (fs.existsSync(path.join(root, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['next']) techStack.push('next.js');
      else if (deps['react']) techStack.push('react');
      if (deps['vue']) techStack.push('vue');
      if (deps['@angular/core']) techStack.push('angular');
      if (deps['svelte']) techStack.push('svelte');
      if (deps['express']) techStack.push('express');
      if (deps['fastify']) techStack.push('fastify');
      if (deps['vitest']) techStack.push('vitest');
      if (deps['jest']) techStack.push('jest');
      if (deps['playwright'] || deps['@playwright/test']) techStack.push('playwright');
    } catch (_e) {}
    if (!techStack.length) techStack.push('node.js');
  }

  // Flutter / Dart
  if (fs.existsSync(path.join(root, 'pubspec.yaml'))) techStack.push('flutter');

  // Python
  if (fs.existsSync(path.join(root, 'requirements.txt')) ||
      fs.existsSync(path.join(root, 'pyproject.toml'))) techStack.push('python');

  // Docker / Infra
  if (fs.existsSync(path.join(root, 'Dockerfile')) ||
      fs.existsSync(path.join(root, 'docker-compose.yml')) ||
      fs.existsSync(path.join(root, 'docker-compose.yaml'))) techStack.push('docker');
  if (fs.existsSync(path.join(root, '.github', 'workflows'))) techStack.push('github-actions');

  // AI signals
  try {
    const lockfile = path.join(root, 'package-lock.json');
    if (fs.existsSync(lockfile)) {
      const content = fs.readFileSync(lockfile, 'utf8');
      if (content.includes('"@anthropic-ai/sdk"') || content.includes('"openai"') ||
          content.includes('"langchain"')) techStack.push('ai-llm');
    }
  } catch (_e) {}

  // LOC and file count (non-blocking, best-effort)
  let loc = 0;
  let fileCount = 0;
  try {
    const find = require('child_process').execSync(
      `find "${root}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.dart" -o -name "*.py" \\) | grep -v node_modules | grep -v ".git"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    const files = find.split('\n').filter(Boolean);
    fileCount = files.length;
    for (const f of files.slice(0, 200)) {
      try {
        const lines = fs.readFileSync(f, 'utf8').split('\n').length;
        loc += lines;
      } catch (_e) {}
    }
  } catch (_e) {}

  return {
    tech_stack: techStack,
    loc,
    file_count: fileCount,
    test_coverage_pre: null,
  };
}

function cmdModernizeAddProposal(args) {
  const masterPathInput = args[0];
  if (!masterPathInput) usage('modernize add-proposal requires <master-path> --title <t> --rationale <r> --risk low|medium|high --effort <e> --rollback <rb>');
  const flags = parseFlags(args.slice(1), {
    'title': 'value', 'rationale': 'value', 'risk': 'value',
    'effort': 'value', 'rollback': 'value',
  });
  if (!flags.title || !flags.rationale || !flags.risk || !flags.effort || !flags.rollback) {
    usage('modernize add-proposal requires --title --rationale --risk --effort --rollback');
  }
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  if (!Array.isArray(fm.proposals)) fm.proposals = [];
  const id = `P-${String(fm.proposals.length + 1).padStart(3, '0')}`;
  fm.proposals.push({
    id,
    title: flags.title,
    rationale: flags.rationale,
    risk: flags.risk,
    effort_estimate: flags.effort,
    rollback_path: flags.rollback,
    approved_by_robert: 'pending',
    rejection_reason: null,
    deferred_to: null,
  });
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, proposal_id: id };
}

function cmdModernizeApproveProposal(args) {
  const masterPathInput = args[0];
  const proposalId = args[1];
  const decision = args[2];
  if (!masterPathInput || !proposalId || !decision) {
    usage('modernize approve-proposal requires <master-path> <proposal-id> approved|rejected|deferred [--reason <text>] [--approved-by <human|harness:reason>]');
  }
  if (!MODERNIZE_PROPOSAL_DECISIONS.has(decision)) {
    usage(`invalid decision "${decision}". valid: ${[...MODERNIZE_PROPOSAL_DECISIONS].join(', ')}`);
  }
  const flags = parseFlags(args.slice(3), { 'reason': 'value', 'approved-by': 'value' });
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  if (!Array.isArray(fm.proposals)) fail('no proposals found in master file');
  normalizeJsonEntries(fm, 'proposals');
  const p = fm.proposals.find((x) => x.id === proposalId);
  if (!p) fail(`proposal ${proposalId} not found`);
  p.approved_by_robert = decision;
  if (flags.reason) p.rejection_reason = flags.reason;
  // FMEA-5: audit trail — who approved (human vs harness:<reason>).
  if (flags['approved-by']) p.approved_by = flags['approved-by'];
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, proposal_id: proposalId, decision };
}

// Frontmatter round-trip fix: writeMdAtomic serializes array-of-object entries
// as JSON strings; on re-read they stay strings, so id-lookups (x.id) miss.
// Normalize in place: parse string entries back into objects before use.
// parity_baseline convention: array of "key=val" strings (see modernize init).
// Tolerates legacy object/string shapes; "null" strings become real nulls.
function parityBaselineToMap(pb) {
  const map = {};
  if (Array.isArray(pb)) {
    for (const entry of pb) {
      if (typeof entry !== 'string') continue;
      const i = entry.indexOf('=');
      if (i === -1) continue;
      const k = entry.slice(0, i);
      const v = entry.slice(i + 1);
      map[k] = v === 'null' ? null : v;
    }
  } else if (pb && typeof pb === 'object') {
    Object.assign(map, pb);
  }
  return map;
}

function normalizeJsonEntries(fm, key) {
  if (!Array.isArray(fm[key])) return;
  fm[key] = fm[key].map((entry) => {
    if (typeof entry !== 'string') return entry;
    try {
      const parsed = JSON.parse(entry);
      return parsed && typeof parsed === 'object' ? parsed : entry;
    } catch (_e) {
      return entry;
    }
  });
}

function cmdModernizeAddWave(args) {
  const masterPathInput = args[0];
  if (!masterPathInput) usage('modernize add-wave requires <master-path> --title <t> [--depends-on W-01,W-02]');
  const flags = parseFlags(args.slice(1), {
    'title': 'value', 'depends-on': 'value',
  });
  if (!flags.title) usage('modernize add-wave requires --title');
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  if (!Array.isArray(fm.waves)) fm.waves = [];
  const id = `W-${String(fm.waves.length + 1).padStart(2, '0')}`;
  const dependsOn = flags['depends-on'] ? flags['depends-on'].split(',').map((s) => s.trim()) : [];
  fm.waves.push({
    id,
    title: flags.title,
    depends_on: dependsOn,
    frs: [],
    status: 'planned',
    approved_by_robert: 'pending',
  });
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, wave_id: id };
}

function cmdModernizeSnapshotBehavior(args) {
  const masterPathInput = args[0];
  if (!masterPathInput) usage('modernize snapshot-behavior requires <master-path> [--baseline-tests <path>] [--manual-smoke <path>]');
  const flags = parseFlags(args.slice(1), {
    'baseline-tests': 'value', 'manual-smoke': 'value',
  });
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  // parity_baseline follows the repo's flat "key=val" string-array convention
  // (seeded by modernize init) — read into a map, update, write back as k=v.
  const baseline = parityBaselineToMap(fm.parity_baseline);
  baseline.snapshot_taken_at = nowIso();
  if (flags['baseline-tests']) baseline.baseline_tests = flags['baseline-tests'];
  if (flags['manual-smoke']) {
    baseline.manual_smoke_doc = flags['manual-smoke'];
    // FMEA-2: compute a content hash of the smoke artifact so complete-wave can
    // recompute + diff it later — turns a claimed parity gate into a computed one.
    const smokePath = resolveVaultPath(flags['manual-smoke']);
    if (!fs.existsSync(smokePath)) fail(`--manual-smoke file not found: ${smokePath}`);
    const crypto = require('crypto');
    const content = fs.readFileSync(smokePath);
    baseline.snapshot_hash = crypto.createHash('sha256').update(content).digest('hex');
  }
  fm.parity_baseline = Object.entries(baseline).map(([k, v]) => `${k}=${v === null || v === undefined ? 'null' : v}`);
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, snapshot_taken_at: baseline.snapshot_taken_at, snapshot_hash: baseline.snapshot_hash || null };
}

function cmdModernizeStartWave(args) {
  const masterPathInput = args[0];
  const waveId = args[1];
  if (!masterPathInput || !waveId) usage('modernize start-wave requires <master-path> <wave-id> [--approved-by <human|harness:reason>]');
  const flags = parseFlags(args.slice(2), { 'approved-by': 'value' });
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  if (!Array.isArray(fm.waves)) fail('no waves found in master file');
  normalizeJsonEntries(fm, 'waves');
  const w = fm.waves.find((x) => x.id === waveId);
  if (!w) fail(`wave ${waveId} not found`);
  w.status = 'implementing';
  w.approved_by_robert = 'approved';
  // FMEA-5: audit trail — who approved the wave start (human vs harness:<reason>).
  if (flags['approved-by']) w.approved_by = flags['approved-by'];
  fm.status = 'executing';
  appendPhaseHistory(fm, `wave-${waveId}-start`);
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, wave_id: waveId, status: 'implementing' };
}

function cmdModernizeCompleteWave(args) {
  const masterPathInput = args[0];
  const waveId = args[1];
  if (!masterPathInput || !waveId) {
    usage('modernize complete-wave requires <master-path> <wave-id> --snapshot-replay pass|fail [--replay-file <path>] --fr-ac-checks <json>');
  }
  const flags = parseFlags(args.slice(2), {
    'snapshot-replay': 'value', 'fr-ac-checks': 'value', 'replay-file': 'value',
  });
  if (!flags['snapshot-replay']) usage('modernize complete-wave requires --snapshot-replay pass|fail');
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  if (!Array.isArray(fm.waves)) fail('no waves found in master file');
  normalizeJsonEntries(fm, 'waves');
  const w = fm.waves.find((x) => x.id === waveId);
  if (!w) fail(`wave ${waveId} not found`);

  // FMEA-2: computed parity. If snapshot-behavior stored a snapshot_hash, the
  // self-asserted `--snapshot-replay pass` claim alone is no longer trusted:
  //  - --replay-file given → diff its byte-content against the baseline
  //    manual_smoke_doc file. Identical ⇒ replay pass (regardless of the claim);
  //    different ⇒ fail. (Diff by content, not by hash-equality of paths.)
  //  - no --replay-file → reject the claim outright.
  // Legacy baselines (no snapshot_hash) keep old claim-based behavior.
  const baseline = parityBaselineToMap(fm.parity_baseline);
  const hasComputedParity = baseline.snapshot_hash != null && baseline.snapshot_hash !== 'null';
  if (hasComputedParity) {
    if (!flags['replay-file']) {
      fail('computed parity required: pass --replay-file');
    }
    const replayPath = resolveVaultPath(flags['replay-file']);
    if (!fs.existsSync(replayPath)) fail(`--replay-file not found: ${replayPath}`);
    const baselinePathRaw = baseline.manual_smoke_doc;
    if (!baselinePathRaw || baselinePathRaw === 'null') {
      fail('parity drift (computed): baseline manual_smoke_doc missing');
    }
    const baselinePath = resolveVaultPath(baselinePathRaw);
    if (!fs.existsSync(baselinePath)) fail(`parity drift (computed): baseline manual_smoke_doc not found: ${baselinePath}`);
    const replayContent = fs.readFileSync(replayPath);
    const baselineContent = fs.readFileSync(baselinePath);
    if (!replayContent.equals(baselineContent)) {
      fail('parity drift (computed)');
    }
    // computed replay pass — the claim is superseded by the byte-diff verdict.
  } else if (flags['snapshot-replay'] !== 'pass') {
    fail(`parity check failed (snapshot-replay=${flags['snapshot-replay']}). Fix regression before completing wave.`);
  }
  w.status = 'done';
  appendPhaseHistory(fm, `wave-${waveId}-done`);
  // Check if all waves are done
  const allDone = fm.waves.every((wv) => wv.status === 'done');
  if (allDone) fm.status = 'executed';
  writeMdAtomic(masterPath, fm, body);
  return { path: masterPath, wave_id: waveId, status: 'done', all_waves_done: allDone };
}

function cmdModernizeVerifyParity(args) {
  const masterPathInput = args[0];
  if (!masterPathInput) usage('modernize verify-parity requires <master-path>');
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm } = readMd(masterPath);
  if (!fm.parity_baseline) {
    process.stderr.write('no parity baseline found — run snapshot-behavior first\n');
    process.exit(1);
  }
  const baseline = parityBaselineToMap(fm.parity_baseline);
  normalizeJsonEntries(fm, 'waves');
  // Report baseline info; actual test execution is done by the skill
  return {
    path: masterPath,
    baseline_snapshot_taken_at: baseline.snapshot_taken_at || null,
    baseline_tests: baseline.baseline_tests || null,
    manual_smoke_doc: baseline.manual_smoke_doc || null,
    waves_done: Array.isArray(fm.waves) ? fm.waves.filter((w) => w.status === 'done').length : 0,
  };
}

function cmdModernizePublishNotion(args) {
  const masterPathInput = args[0];
  if (!masterPathInput) usage('modernize publish-notion requires <master-path> [--notion-parent <page-id>]');
  const flags = parseFlags(args.slice(1), { 'notion-parent': 'value' });
  const masterPath = resolveVaultPath(masterPathInput);
  if (!fs.existsSync(masterPath)) fail(`master file not found: ${masterPath}`);
  const { fm, body } = readMd(masterPath);
  // Prepare fallback export path
  const masterDir = path.dirname(masterPath);
  const fallbackDir = path.join(masterDir, 'modernize-export');
  const fallbackPath = path.join(fallbackDir, 'report.md');
  return {
    path: masterPath,
    notion_parent: flags['notion-parent'] || null,
    fallback_path: fallbackPath,
    status: fm.status,
    project_slug: fm.project_slug,
  };
}

function cmdModernizeList(args) {
  const flags = parseFlags(args, { status: 'value', slug: 'value' });
  const projectSlug = flags.slug || flags._[0];
  const results = [];
  const projectsRoot = path.join(vaultRoot(), 'projects');
  if (!fs.existsSync(projectsRoot)) return { count: 0, runs: [] };
  const slugs = projectSlug
    ? [projectSlug]
    : fs.readdirSync(projectsRoot).filter((e) => !e.startsWith('_'));
  for (const slug of slugs) {
    const dir = path.join(projectsRoot, slug, 'modernize');
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).sort().reverse()) {
      if (!entry.match(/^\d{4}-\d{2}-\d{2}-.+\.md$/)) continue;
      const full = path.join(dir, entry);
      let status = 'unknown';
      let mode = 'unknown';
      let title = entry;
      try {
        const { fm } = readMd(full);
        status = fm.status || 'unknown';
        mode = fm.mode || 'unknown';
        title = fm.title || entry;
      } catch (_e) {}
      if (flags.status && status !== flags.status) continue;
      results.push({ project: slug, file: entry, path: full, status, mode, title });
    }
  }
  return { count: results.length, runs: results };
}

// ---------- reconcile subcommands ----------
//
// Spec-vs-code drift detection. Owns drift reports in the vault under
// projects/<slug>/drift-<YYYY-MM-DD>[-N].md (or projects/_vault-sync/... for
// vault-sync mode). The CLI handles deterministic operations: slot
// calculation, spec parsing (Acceptance-Criteria anchor extraction),
// frontmatter updates, drift append, listing. Sub-agent probing happens in
// the skill (Phase 3).

function reconcileDir(projectSlug) {
  // For vault-sync we use a synthetic slug "_vault-sync".
  return path.join(vaultRoot(), 'projects', projectSlug);
}

function cmdReconcileNextSlot(args) {
  const flags = parseFlags(args, { date: 'value' });
  const projectSlug = flags._[0];
  if (!projectSlug) {
    usage('reconcile next-slot requires <project-slug> [--date YYYY-MM-DD]');
  }
  const date = flags.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    usage(`invalid date "${date}", expected YYYY-MM-DD`);
  }
  const dir = reconcileDir(projectSlug);
  let used = new Set();
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^drift-${date}(-(\\d+))?\\.md$`);
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(re);
      if (m) used.add(m[2] ? parseInt(m[2], 10) : 1);
    }
  }
  let n = 1;
  while (used.has(n)) n++;
  const suffix = n === 1 ? '' : `-${n}`;
  const filename = `drift-${date}${suffix}.md`;
  return {
    project: projectSlug,
    date,
    suffix,
    filename,
    path: path.join(dir, filename),
    dir,
  };
}

function listProjectSpecs(projectSlug) {
  // Returns array of { feature_id, abs, rel, fm } for every spec under
  // projects/<slug>/spec/. feature_id is the filename without .md.
  const dir = path.join(vaultRoot(), 'projects', projectSlug, 'spec');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith('.md')) continue;
    const featureId = entry.slice(0, -3);
    const abs = path.join(dir, entry);
    const rel = `projects/${projectSlug}/spec/${entry}`;
    let fm = {};
    try {
      const parsed = readMd(abs);
      fm = parsed.fm || {};
    } catch (_e) {
      // include even if frontmatter parse fails; consumer can filter
    }
    out.push({ feature_id: featureId, abs, rel, fm });
  }
  return out;
}

function cmdReconcileInit(args) {
  const flags = parseFlags(args, {
    'scope': 'value',
    'spec': 'value',
    'project-path': 'value',
    'date': 'value',
    'title': 'value',
  });
  const projectSlug = flags._[0];
  if (!projectSlug) {
    usage(
      'reconcile init requires <project-slug> --scope <single|project|vault-sync> [--spec <###-slug>] [--project-path /abs] [--date YYYY-MM-DD] [--title <text>]'
    );
  }
  const scope = flags.scope;
  if (!scope || !RECONCILE_SCOPE_MODES.has(scope)) {
    usage(
      `reconcile init requires --scope, one of: ${[...RECONCILE_SCOPE_MODES].join(', ')}`
    );
  }
  if (scope === 'single' && !flags.spec) {
    usage('reconcile init --scope single requires --spec <###-feature-slug>');
  }

  // Compute slot (re-use logic, no recursion: build args).
  const slotArgs = [projectSlug];
  if (flags.date) slotArgs.push('--date', flags.date);
  const slot = cmdReconcileNextSlot(slotArgs);
  const filePath = slot.path;
  if (!fs.existsSync(slot.dir)) fs.mkdirSync(slot.dir, { recursive: true });

  // Resolve scope_targets.
  const scopeTargets = [];
  if (scope === 'single') {
    const specRel = `projects/${projectSlug}/spec/${flags.spec}.md`;
    const specAbs = path.join(vaultRoot(), specRel);
    scopeTargets.push(
      `project=${projectSlug}; spec=${flags.spec}; spec_path=${specRel}; repo_path=${flags['project-path'] || ''}`
    );
    if (!fs.existsSync(specAbs)) {
      // We still create the report, but record a parse_warning later.
      // For init we just note it via stderr (non-fatal).
      process.stderr.write(`warning: spec not found at init: ${specRel}\n`);
    }
  } else if (scope === 'project') {
    const specs = listProjectSpecs(projectSlug);
    for (const s of specs) {
      scopeTargets.push(
        `project=${projectSlug}; spec=${s.feature_id}; spec_path=${s.rel}; repo_path=${flags['project-path'] || ''}`
      );
    }
  } else {
    // vault-sync: list every projects/<slug>/spec/ in the vault.
    const projectsRoot = path.join(vaultRoot(), 'projects');
    if (fs.existsSync(projectsRoot)) {
      for (const entry of fs.readdirSync(projectsRoot).sort()) {
        if (entry.startsWith('_')) continue;
        const specs = listProjectSpecs(entry);
        for (const s of specs) {
          scopeTargets.push(
            `project=${entry}; spec=${s.feature_id}; spec_path=${s.rel}; repo_path=`
          );
        }
      }
    }
  }

  const title =
    flags.title ||
    (scope === 'single'
      ? `Drift Check — ${projectSlug}/${flags.spec}`
      : scope === 'project'
        ? `Drift Check — ${projectSlug} (project sweep)`
        : `Drift Check — vault-sync ${slot.date}`);

  const fm = {
    type: 'drift-report',
    project: projectSlug,
    title,
    status: 'scoped',
    scope_mode: scope,
    created_at: nowIso(),
    date: slot.date,
    phase_history: [`phase=scope completed=${nowIso()}`],
    scope_targets: scopeTargets,
    parsed_targets: [],
    stale_candidates: [],
    parse_warnings: [],
    agents_dispatched: [],
    probe_notes: [],
    drifts: [],
    drifts_count: ['missing=0', 'extra=0', 'diverged=0', 'stale=0'],
    in_sync_count: '0',
    skipped_projects: [],
    suggested_next: [],
    tags: ['drift-report', `project/${projectSlug}`, `scope/${scope}`],
  };

  const body = `# ${title}

## Summary

<filled by Phase 4 (Report)>

## Drifts

<filled by Phase 4 (Report) from frontmatter drifts[]>

## Phase History

<filled by Phase 4 (Report) from frontmatter phase_history[]>

## Suggested Next

<filled by Phase 4 (Report)>
`;

  writeMdAtomic(filePath, fm, body);
  return {
    path: filePath,
    project: projectSlug,
    scope_mode: scope,
    target_count: scopeTargets.length,
    status: 'scoped',
  };
}

// Parses "key=val; key=val" entries (used in scope_targets[]).
function parseKvEntry(s) {
  const out = {};
  if (typeof s !== 'string') return out;
  for (const part of s.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

// Inline-code span extractor: matches text inside backticks.
const INLINE_CODE_RE = /`([^`\n]+)`/g;

// File-path heuristic: contains a slash AND ends with a known extension.
const FILE_EXT_RE = /\.(js|jsx|ts|tsx|mjs|cjs|py|rs|go|dart|java|kt|rb|php|html|css|scss|vue|svelte|astro|sql|sh|yml|yaml|toml|json|md)$/i;

// HTTP endpoint heuristic.
const ENDPOINT_RE = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)$/i;

// Function call heuristic: identifier followed by ().
const FUNC_CALL_RE = /^[A-Za-z_][A-Za-z0-9_]*\(\)$/;

function classifyAnchor(text) {
  const t = text.trim();
  if (ENDPOINT_RE.test(t)) return { kind: 'endpoint', ref: t };
  if (FUNC_CALL_RE.test(t)) return { kind: 'function', ref: t.replace(/\(\)$/, '') };
  if (t.includes('/') && FILE_EXT_RE.test(t)) return { kind: 'file', ref: t };
  return null;
}

function extractAnchorsFromSpec(specBody) {
  // Walk bullet/numbered lines that contain an FR-### id and harvest every
  // inline-code span on that line as a potential anchor. Returns an array of
  // { fr, kind, ref, context }.
  const out = [];
  const lines = specBody.split('\n');
  const frRe = /\b(FR-\d{3,})\b/;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const frMatch = line.match(frRe);
    if (!frMatch) continue;
    const fr = frMatch[1];
    const ctx = line.replace(/^[-*\d.\s]+/, '').trim().slice(0, 200);
    let found = false;
    let m;
    INLINE_CODE_RE.lastIndex = 0;
    while ((m = INLINE_CODE_RE.exec(line)) !== null) {
      const classified = classifyAnchor(m[1]);
      if (classified) {
        out.push({
          fr,
          kind: classified.kind,
          ref: classified.ref,
          context: ctx,
        });
        found = true;
      }
    }
    if (!found) {
      // Record an FR-only anchor (no concrete artifact reference).
      out.push({ fr, kind: 'other', ref: '', context: ctx });
    }
  }
  return out;
}

function gitLastTouchIso(repoPath, relRefs) {
  if (!repoPath || !fs.existsSync(path.join(repoPath, '.git'))) return null;
  try {
    const { execSync } = require('child_process');
    const filtered = relRefs.filter(Boolean);
    if (filtered.length === 0) return null;
    // git log -1 --format=%cI -- <paths...> ; missing paths are tolerated.
    const args = ['log', '-1', '--format=%cI', '--'].concat(filtered);
    const out = execSync(`git ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch (_e) {
    return null;
  }
}

function cmdReconcileParseSpec(args) {
  const driftPathInput = args[0];
  if (!driftPathInput) usage('reconcile parse-spec requires <drift-path>');
  const driftPath = resolveVaultPath(driftPathInput);
  if (!fs.existsSync(driftPath)) fail(`drift report not found: ${driftPath}`);
  const { fm, body } = readMd(driftPath);

  if (!Array.isArray(fm.scope_targets) || fm.scope_targets.length === 0) {
    fail('drift report has no scope_targets[] — nothing to parse');
  }

  const parsedTargets = [];
  const staleCandidates = [];
  const warnings = [];

  for (const entry of fm.scope_targets) {
    const t = parseKvEntry(entry);
    const specPathRel = t.spec_path;
    const specAbs = specPathRel ? resolveVaultPath(specPathRel) : null;
    if (!specAbs || !fs.existsSync(specAbs)) {
      warnings.push(`spec missing for target ${t.project}/${t.spec}: ${specPathRel || '(no path)'}`);
      continue;
    }
    let spec;
    try {
      spec = readMd(specAbs);
    } catch (e) {
      warnings.push(`spec parse error for ${specPathRel}: ${e.message}`);
      continue;
    }
    const anchors = extractAnchorsFromSpec(spec.body);
    // Dedup per (spec, kind, ref).
    const seen = new Set();
    for (const a of anchors) {
      const key = `${t.spec}|${a.kind}|${a.ref}|${a.fr}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parsedTargets.push(
        `spec=${t.spec}; fr=${a.fr}; kind=${a.kind}; ref=${a.ref}; context=${a.context.replace(/;/g, ',')}`
      );
    }

    // STALE pre-filter: spec.updated vs git log on referenced file anchors.
    const specUpdated = spec.fm && (spec.fm.updated || spec.fm.created);
    if (
      spec.fm &&
      spec.fm.status === 'shipped' &&
      specUpdated &&
      t.repo_path &&
      fs.existsSync(t.repo_path)
    ) {
      const fileRefs = anchors
        .filter((a) => a.kind === 'file' && a.ref)
        .map((a) => a.ref);
      const lastTouch = gitLastTouchIso(t.repo_path, fileRefs);
      if (lastTouch && lastTouch < specUpdated) {
        staleCandidates.push(
          `spec=${t.spec}; spec_updated=${specUpdated}; last_code_touch=${lastTouch}`
        );
      } else if (!lastTouch && fileRefs.length > 0) {
        warnings.push(`git log failed for ${t.spec} repo=${t.repo_path}`);
      }
    }
  }

  fm.parsed_targets = parsedTargets;
  fm.stale_candidates = staleCandidates;
  fm.parse_warnings = warnings;

  writeMdAtomic(driftPath, fm, body);
  return {
    drift_path: driftPath,
    target_count: parsedTargets.length,
    stale_candidates: staleCandidates.length,
    parse_warnings: warnings.length,
  };
}

const RECONCILE_STATUS_TO_PHASE = {
  scoped: 'scope',
  parsed: 'parse',
  probed: 'probe',
  reported: 'report',
  cancelled: 'cancelled',
};

function cmdReconcileUpdateStatus(args) {
  const driftPathInput = args[0];
  const newStatus = args[1];
  if (!driftPathInput || !newStatus) {
    usage('reconcile update-status requires <drift-path> <new-status> [--phase-data <json>]');
  }
  if (!RECONCILE_STATUSES.has(newStatus)) {
    usage(
      `invalid reconcile status "${newStatus}". valid: ${[...RECONCILE_STATUSES].join(', ')}`
    );
  }
  const flags = parseFlags(args.slice(2), { 'phase-data': 'value' });
  const driftPath = resolveVaultPath(driftPathInput);
  if (!fs.existsSync(driftPath)) fail(`drift report not found: ${driftPath}`);
  const { fm, body } = readMd(driftPath);
  fm.status = newStatus;

  const phase = RECONCILE_STATUS_TO_PHASE[newStatus];
  if (phase) appendPhaseHistory(fm, phase);

  if (flags['phase-data']) {
    let parsed;
    try {
      parsed = JSON.parse(flags['phase-data']);
    } catch (e) {
      fail(`--phase-data is not valid JSON: ${e.message}`);
    }

    if (newStatus === 'probed' && parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.agents_dispatched)) {
        fm.agents_dispatched = parsed.agents_dispatched.map((a) => {
          if (typeof a === 'string') return a;
          const parts = [];
          if (a.name) parts.push(`name=${a.name}`);
          if (a.completed_at) parts.push(`completed_at=${a.completed_at}`);
          if (a.drift_count !== undefined) parts.push(`drift_count=${a.drift_count}`);
          return parts.join('; ');
        });
      }
      if (parsed.in_sync_count !== undefined) {
        fm.in_sync_count = String(parsed.in_sync_count);
      }
      if (Array.isArray(parsed.probe_notes)) {
        fm.probe_notes = parsed.probe_notes.map((n) => String(n));
      }
    }

    if (newStatus === 'reported' && parsed && Array.isArray(parsed.suggested_next)) {
      fm.suggested_next = parsed.suggested_next.map((s) => {
        if (typeof s === 'string') return s;
        const parts = [];
        if (s.skill) parts.push(`skill=${s.skill}`);
        if (s.reason) parts.push(`reason=${s.reason}`);
        if (Array.isArray(s.targets) && s.targets.length)
          parts.push(`targets=${s.targets.join(',')}`);
        return parts.join('; ');
      });
    }
  }

  writeMdAtomic(driftPath, fm, body);
  return {
    drift_path: driftPath,
    status: fm.status,
    phase_history: fm.phase_history,
    agents_dispatched: fm.agents_dispatched ?? [],
    drifts_count: fm.drifts_count ?? [],
    in_sync_count: fm.in_sync_count ?? '0',
    suggested_next: fm.suggested_next ?? [],
  };
}

function cmdReconcileAddDrift(args) {
  const flags = parseFlags(args, {
    'recommendation': 'value',
    'spec-ref': 'value',
    'code-ref': 'value',
  });
  const [driftPathInput, klass, artifact, description] = flags._;
  if (!driftPathInput || !klass || !artifact || !description) {
    usage('reconcile add-drift requires <drift-path> <class> <artifact> <description> [--recommendation <text>] [--spec-ref <FR-###>] [--code-ref <path:line>]');
  }
  if (!RECONCILE_DRIFT_CLASSES.has(klass)) {
    usage(
      `invalid drift class "${klass}". valid: ${[...RECONCILE_DRIFT_CLASSES].join(', ')}`
    );
  }
  const driftPath = resolveVaultPath(driftPathInput);
  if (!fs.existsSync(driftPath)) fail(`drift report not found: ${driftPath}`);
  const { fm, body } = readMd(driftPath);

  if (!Array.isArray(fm.drifts)) fm.drifts = [];
  let maxN = 0;
  for (const d of fm.drifts) {
    if (typeof d === 'string') {
      const m = d.match(/^id=D-(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    }
  }
  const driftId = `D-${String(maxN + 1).padStart(3, '0')}`;
  function clean(s) {
    return String(s).replace(/;/g, ',').replace(/\n/g, ' ');
  }
  const parts = [
    `id=${driftId}`,
    `class=${klass}`,
    `artifact=${clean(artifact)}`,
    `description=${clean(description)}`,
  ];
  if (flags['spec-ref']) parts.push(`spec_ref=${clean(flags['spec-ref'])}`);
  if (flags['code-ref']) parts.push(`code_ref=${clean(flags['code-ref'])}`);
  if (flags.recommendation) parts.push(`recommendation=${clean(flags.recommendation)}`);
  fm.drifts.push(parts.join('; '));

  // Recompute counts.
  const counts = { MISSING: 0, EXTRA: 0, DIVERGED: 0, STALE: 0 };
  for (const d of fm.drifts) {
    if (typeof d !== 'string') continue;
    const m = d.match(/class=([A-Z]+)/);
    if (m && counts[m[1]] !== undefined) counts[m[1]]++;
  }
  fm.drifts_count = [
    `missing=${counts.MISSING}`,
    `extra=${counts.EXTRA}`,
    `diverged=${counts.DIVERGED}`,
    `stale=${counts.STALE}`,
  ];

  writeMdAtomic(driftPath, fm, body);
  return {
    drift_path: driftPath,
    drift_id: driftId,
    total_drifts: fm.drifts.length,
    counts: fm.drifts_count,
  };
}

function cmdReconcileList(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('reconcile list requires <project-slug>');
  const flags = parseFlags(args.slice(1), { status: 'value' });
  const dir = reconcileDir(projectSlug);
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, count: 0, reports: [] };
  }
  const reports = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.match(/^drift-\d{4}-\d{2}-\d{2}(-\d+)?\.md$/)) continue;
    const full = path.join(dir, entry);
    let status = 'unknown';
    let scopeMode = 'unknown';
    let title = entry;
    try {
      const { fm } = readMd(full);
      status = fm.status || 'unknown';
      scopeMode = fm.scope_mode || 'unknown';
      title = fm.title || entry;
    } catch (_e) {
      // ignore
    }
    if (flags.status && status !== flags.status) continue;
    reports.push({ file: entry, path: full, status, scope_mode: scopeMode, title });
  }
  reports.sort((a, b) => b.file.localeCompare(a.file));
  return { project: projectSlug, count: reports.length, reports };
}

// ---------------------------------------------------------------------------
// schema-check — SQL parsing (M6 Task 2.1a)
//
// Bounded parser for the deterministic subset of schema_flaw checks.
// Pure functions, no I/O beyond reading .sql files from a directory.
//
// SUPPORTED SQL SUBSET (also documented in HELP):
//   - Top-level semicolon-terminated statements only.
//   - Single-quoted strings and $$-dollar-quoted regions are treated as opaque
//     (semicolons inside them do not split statements).
//   - No quoted identifiers ("My Table") — plain / schema-qualified names only.
//   - CREATE TABLE: column defs with declared types, inline PRIMARY KEY,
//     table-level PRIMARY KEY (...), inline REFERENCES other(col),
//     table-level FOREIGN KEY (col) REFERENCES other(col).
//   - ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY (col) REFERENCES other(col).
//   - ALTER TABLE ... ENABLE ROW LEVEL SECURITY (+ FORCE ROW LEVEL SECURITY).
//   - CREATE TRIGGER <name> ... ON <table> — header only; $$ function bodies
//     are NOT parsed beyond the trigger header.
//   - Unsupported constructs are skipped and counted, never crash.
// ---------------------------------------------------------------------------

function sqlStripComments(sql) {
  // Remove -- line comments and /* */ block comments (naive, no nesting;
  // does not protect comments inside string literals — acceptable for subset).
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
}

function sqlSplitStatements(sql) {
  const statements = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      // opaque single-quoted string ('' escapes)
      cur += ch;
      i++;
      while (i < sql.length) {
        cur += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            cur += sql[++i];
          } else {
            i++;
            break;
          }
        }
        i++;
      }
      continue;
    }
    if (ch === '$' && sql[i + 1] === '$') {
      // opaque $$-quoted region
      const end = sql.indexOf('$$', i + 2);
      if (end === -1) {
        cur += sql.slice(i);
        i = sql.length;
      } else {
        cur += sql.slice(i, end + 2);
        i = end + 2;
      }
      continue;
    }
    if (ch === ';') {
      if (cur.trim()) statements.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) statements.push(cur.trim());
  return statements;
}

// serial family → integer family; common aliases; strip length/precision.
const SQL_TYPE_ALIASES = {
  serial: 'integer',
  serial4: 'integer',
  bigserial: 'bigint',
  serial8: 'bigint',
  smallserial: 'smallint',
  serial2: 'smallint',
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  bool: 'boolean',
  varchar: 'character varying',
  timestamptz: 'timestamp with time zone',
};

function normalizeSqlType(raw) {
  let t = String(raw || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '') // strip length/precision suffix
    .replace(/\s+/g, ' ')
    .trim();
  if (SQL_TYPE_ALIASES[t]) t = SQL_TYPE_ALIASES[t];
  return t;
}

function sqlIdent(raw) {
  // strip optional schema qualifier and quotes; lowercase
  const s = String(raw || '').replace(/"/g, '').trim().toLowerCase();
  const parts = s.split('.');
  return parts[parts.length - 1];
}

// Split a CREATE TABLE body at top-level commas (parens-aware).
function splitTopLevelCommas(body) {
  const items = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      if (cur.trim()) items.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

// Keywords that terminate a column's type token sequence.
const SQL_COLDEF_STOPWORDS = new Set([
  'not', 'null', 'default', 'primary', 'references', 'unique', 'check',
  'constraint', 'generated', 'collate',
]);

function parseColumnDef(item) {
  const tokens = item.replace(/\s+/g, ' ').trim().split(' ');
  const name = sqlIdent(tokens[0]);
  const typeTokens = [];
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i].toLowerCase().replace(/,$/, '');
    if (SQL_COLDEF_STOPWORDS.has(t)) break;
    typeTokens.push(tokens[i]);
    i++;
  }
  const rest = tokens.slice(i).join(' ');
  const col = { name, type: typeTokens.join(' ') };
  const restLc = ` ${rest.toLowerCase()} `;
  col.primaryKey = restLc.includes(' primary key');
  const refM = rest.match(/references\s+([A-Za-z0-9_."]+)\s*(?:\(\s*([A-Za-z0-9_"]+)\s*\))?/i);
  if (refM) {
    col.references = { table: sqlIdent(refM[1]), column: refM[2] ? sqlIdent(refM[2]) : null };
  }
  return col;
}

function parseCreateTable(stmt) {
  const m = stmt.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_."]+)\s*\(([\s\S]*)\)\s*[^)]*$/i);
  if (!m) return null;
  const table = { name: sqlIdent(m[1]), columns: [], pk: [], fks: [] };
  for (const item of splitTopLevelCommas(m[2])) {
    const lc = item.toLowerCase();
    if (/^(constraint\s+[A-Za-z0-9_"]+\s+)?primary\s+key\s*\(/.test(lc)) {
      const pkM = item.match(/primary\s+key\s*\(([^)]*)\)/i);
      if (pkM) table.pk = pkM[1].split(',').map(sqlIdent);
      continue;
    }
    if (/^(constraint\s+[A-Za-z0-9_"]+\s+)?foreign\s+key\s*\(/.test(lc)) {
      const fkM = item.match(/foreign\s+key\s*\(\s*([A-Za-z0-9_"]+)\s*\)\s*references\s+([A-Za-z0-9_."]+)\s*(?:\(\s*([A-Za-z0-9_"]+)\s*\))?/i);
      if (fkM) {
        table.fks.push({
          column: sqlIdent(fkM[1]),
          refTable: sqlIdent(fkM[2]),
          refColumn: fkM[3] ? sqlIdent(fkM[3]) : null,
          source: 'table-constraint',
        });
      }
      continue;
    }
    if (/^(unique|check|exclude|like)\b/.test(lc)) continue; // other table constraints — skipped
    const col = parseColumnDef(item);
    if (!col.name || !col.type) continue; // unparseable — skip, never crash
    table.columns.push({ name: col.name, type: col.type });
    if (col.primaryKey) table.pk.push(col.name);
    if (col.references) {
      table.fks.push({
        column: col.name,
        refTable: col.references.table,
        refColumn: col.references.column,
        source: 'inline',
      });
    }
  }
  return table;
}

function parseAlterTable(stmt) {
  const m = stmt.match(/^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([A-Za-z0-9_."]+)\s+([\s\S]*)$/i);
  if (!m) return null;
  const table = sqlIdent(m[1]);
  const body = m[2];
  const out = { table };
  if (/enable\s+row\s+level\s+security/i.test(body)) out.rlsEnable = true;
  if (/force\s+row\s+level\s+security/i.test(body)) out.rlsForce = true;
  const fkM = body.match(/add\s+constraint\s+[A-Za-z0-9_"]+\s+foreign\s+key\s*\(\s*([A-Za-z0-9_"]+)\s*\)\s*references\s+([A-Za-z0-9_."]+)\s*(?:\(\s*([A-Za-z0-9_"]+)\s*\))?/i);
  if (fkM) {
    out.fk = {
      column: sqlIdent(fkM[1]),
      refTable: sqlIdent(fkM[2]),
      refColumn: fkM[3] ? sqlIdent(fkM[3]) : null,
      source: 'alter-table',
    };
  }
  return out;
}

function parseCreateTrigger(stmt) {
  const m = stmt.match(/^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+([A-Za-z0-9_"]+)[\s\S]*?\son\s+([A-Za-z0-9_."]+)/i);
  if (!m) return null;
  return { name: sqlIdent(m[1]), table: sqlIdent(m[2]) };
}

// Read all .sql files in dir (sorted), parse into a schema model.
// Returns { files, tables: {name → {name, columns, pk, fks, file}},
//           triggers: [{name, table, file}], rls: {table → {enabled, force}},
//           skippedStatements }
function parseSqlFiles(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const model = { files, tables: {}, triggers: [], rls: {}, skippedStatements: 0 };
  for (const file of files) {
    const sql = sqlStripComments(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const stmt of sqlSplitStatements(sql)) {
      const lc = stmt.toLowerCase();
      if (/^create\s+table\b/.test(lc)) {
        const t = parseCreateTable(stmt);
        if (t) {
          t.file = file;
          model.tables[t.name] = t;
        } else {
          model.skippedStatements++;
        }
      } else if (/^alter\s+table\b/.test(lc)) {
        const a = parseAlterTable(stmt);
        if (!a) {
          model.skippedStatements++;
          continue;
        }
        if (a.rlsEnable || a.rlsForce) {
          const cur = model.rls[a.table] || { enabled: false, force: false };
          model.rls[a.table] = {
            enabled: cur.enabled || !!a.rlsEnable,
            force: cur.force || !!a.rlsForce,
          };
        }
        if (a.fk && model.tables[a.table]) model.tables[a.table].fks.push(a.fk);
        else if (a.fk) {
          model.tables[a.table] = { name: a.table, columns: [], pk: [], fks: [a.fk], file };
        }
        if (!a.rlsEnable && !a.rlsForce && !a.fk) model.skippedStatements++;
      } else if (/^create\s+(or\s+replace\s+)?(constraint\s+)?trigger\b/.test(lc)) {
        const tr = parseCreateTrigger(stmt);
        if (tr) {
          tr.file = file;
          model.triggers.push(tr);
        } else {
          model.skippedStatements++;
        }
      } else {
        // any other statement type: outside the supported subset — skip silently
      }
    }
  }
  return model;
}

// schema-check parse — hidden debug mode: dump the parsed schema model as JSON.
function cmdSchemaCheckParse(args) {
  const flags = parseFlags(args, { migrations: 'value', json: 'bool' });
  const dir = flags.migrations;
  if (!dir) usage('schema-check parse requires --migrations <dir>');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`migrations dir not found: ${dir}`);
  }
  return parseSqlFiles(dir);
}

// ---------------------------------------------------------------------------
// schema-check run — the 3 deterministic checks (M6 Task 2.1b)
//
// Check A (audit trigger): every created table has a CREATE TRIGGER matching
//   --trigger-pattern (default: audit|log). Projects can override the pattern
//   via the flag (a constitution may document a project default — no
//   constitution code integration in M6).
// Check B (RLS): every created table has ALTER TABLE … ENABLE ROW LEVEL
//   SECURITY (warn if no FORCE).
// Check C (FK types): each FK column's normalized type equals the referenced
//   PK column's normalized type (serial→integer etc.).
//
// Owns stdout + exit code: 0 = pass, 1 = findings, 2 = error.
// ---------------------------------------------------------------------------

function cmdSchemaCheckRun(args) {
  const flags = parseFlags(args, {
    migrations: 'value',
    tables: 'value',
    'trigger-pattern': 'value',
    json: 'bool',
  });
  const dir = flags.migrations;
  if (!dir) usage('schema-check run requires --migrations <dir>');

  let model;
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`migrations dir not found: ${dir}`);
    }
    model = parseSqlFiles(dir);
    if (model.files.length === 0) throw new Error(`no .sql files in: ${dir}`);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(2);
  }

  let triggerPattern;
  try {
    triggerPattern = new RegExp(flags['trigger-pattern'] || 'audit|log', 'i');
  } catch (e) {
    process.stderr.write(`error: invalid --trigger-pattern: ${e.message}\n`);
    process.exit(2);
  }

  const only = flags.tables ? new Set(flags.tables.split(',').map((t) => sqlIdent(t))) : null;
  const tableNames = Object.keys(model.tables).filter((t) => !only || only.has(t));
  if (tableNames.length === 0) {
    process.stderr.write(`error: no matching tables found in migrations\n`);
    process.exit(2);
  }

  const findings = [];
  const warnings = [];
  const lines = [];

  for (const name of tableNames) {
    const table = model.tables[name];
    const tableFindings = [];

    // Check A — audit trigger
    const hasTrigger = model.triggers.some((tr) => tr.table === name && triggerPattern.test(tr.name));
    if (!hasTrigger) {
      tableFindings.push({
        check: 'audit_trigger',
        table: name,
        message: `no CREATE TRIGGER matching /${triggerPattern.source}/i on table "${name}"`,
      });
    }

    // Check B — RLS enabled
    const rls = model.rls[name];
    if (!rls || !rls.enabled) {
      tableFindings.push({
        check: 'rls',
        table: name,
        message: `no ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY found`,
      });
    } else if (!rls.force) {
      warnings.push({
        check: 'rls_force',
        table: name,
        message: `RLS enabled but not FORCEd on "${name}" (table owner bypasses RLS)`,
      });
    }

    // Check C — FK type match
    for (const fk of table.fks) {
      const refTable = model.tables[fk.refTable];
      if (!refTable) {
        warnings.push({
          check: 'fk_type',
          table: name,
          message: `FK ${name}.${fk.column} references unknown table "${fk.refTable}" — skipped`,
        });
        continue;
      }
      const refColName = fk.refColumn || refTable.pk[0];
      const localCol = table.columns.find((c) => c.name === fk.column);
      const refCol = refTable.columns.find((c) => c.name === refColName);
      if (!localCol || !refCol) {
        warnings.push({
          check: 'fk_type',
          table: name,
          message: `FK ${name}.${fk.column} → ${fk.refTable}.${refColName}: column not found — skipped`,
        });
        continue;
      }
      const localType = normalizeSqlType(localCol.type);
      const refType = normalizeSqlType(refCol.type);
      if (localType !== refType) {
        tableFindings.push({
          check: 'fk_type',
          table: name,
          message: `FK type mismatch: ${name}.${fk.column} is ${localType}, but ${fk.refTable}.${refColName} is ${refType}`,
        });
      }
    }

    if (tableFindings.length === 0) {
      lines.push(`PASS  ${name}`);
    } else {
      lines.push(`FAIL  ${name}`);
      for (const f of tableFindings) lines.push(`      - [${f.check}] ${f.message}`);
      findings.push(...tableFindings);
    }
  }

  const status = findings.length === 0 ? 'PASS' : 'FAIL';
  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          status,
          migrations: dir,
          tables_checked: tableNames,
          findings,
          warnings,
          skipped_statements: model.skippedStatements,
        },
        null,
        2
      ) + '\n'
    );
  } else {
    for (const l of lines) process.stdout.write(`${l}\n`);
    for (const w of warnings) process.stdout.write(`WARN  [${w.check}] ${w.message}\n`);
    process.stdout.write(
      `schema-check: ${status} — ${tableNames.length} table(s), ${findings.length} finding(s), ${warnings.length} warning(s)\n`
    );
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// cost — token spend aggregation from Claude Code session JSONL (M6 Task 2.2)
//
// Implementation contract: _shared/cost-format-notes.md (M6 Task 1.3 spike).
// Key rules:
//   - Only lines with type === "assistant" AND message.usage carry token data.
//   - Streamed messages duplicate usage per message.id (up to 4 lines) —
//     aggregate ONCE per unique message.id (last line wins, per file).
//   - Sub-agent usage lives in <sessionId>/subagents/agent-*.jsonl and is NOT
//     in the main session totals — it must be ADDED to the owning session.
//   - Malformed lines are skipped with a warning counter, never crash.
//
// Owns stdout + exit code: 0 = ok, 2 = error (dir missing / no JSONL files).
// ---------------------------------------------------------------------------

function costEmptyTotals() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

function costAddUsage(t, usage) {
  t.input += usage.input_tokens || 0;
  t.output += usage.output_tokens || 0;
  t.cacheRead += usage.cache_read_input_tokens || 0;
  t.cacheCreation += usage.cache_creation_input_tokens || 0;
}

// Parse one JSONL file: dedup by message.id (last wins), apply time window.
// Returns { events: [{id, model, timestamp, usage}], skippedLines }.
function costParseJsonlFile(filePath, sinceMs, untilMs) {
  const byId = new Map(); // message.id → event (last wins)
  let skippedLines = 0;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      skippedLines++;
      continue;
    }
    if (!obj || obj.type !== 'assistant') continue;
    const msg = obj.message;
    if (!msg || !msg.usage || !msg.id) continue;
    byId.set(msg.id, {
      id: msg.id,
      model: msg.model || 'unknown',
      timestamp: obj.timestamp || null,
      usage: msg.usage,
    });
  }
  const events = [];
  for (const ev of byId.values()) {
    if (sinceMs !== null || untilMs !== null) {
      const ts = ev.timestamp ? Date.parse(ev.timestamp) : NaN;
      if (Number.isNaN(ts)) continue; // no timestamp → cannot window-match
      if (sinceMs !== null && ts < sinceMs) continue;
      if (untilMs !== null && ts > untilMs) continue;
    }
    events.push(ev);
  }
  return { events, skippedLines };
}

function cmdCostRun(args) {
  const flags = parseFlags(args, {
    project: 'value',
    since: 'value',
    until: 'value',
    json: 'bool',
  });
  const dir = flags.project;
  if (!dir) usage('cost run requires --project <claude-projects-dir>');

  let sinceMs = null;
  let untilMs = null;
  if (flags.since) {
    sinceMs = Date.parse(flags.since);
    if (Number.isNaN(sinceMs)) {
      process.stderr.write(`error: invalid --since timestamp: ${flags.since}\n`);
      process.exit(2);
    }
  }
  if (flags.until) {
    untilMs = Date.parse(flags.until);
    if (Number.isNaN(untilMs)) {
      process.stderr.write(`error: invalid --until timestamp: ${flags.until}\n`);
      process.exit(2);
    }
  }

  let mainLogs;
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`project dir not found: ${dir}`);
    }
    mainLogs = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl') && fs.statSync(path.join(dir, f)).isFile())
      .sort();
    if (mainLogs.length === 0) throw new Error(`no .jsonl session logs in: ${dir}`);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(2);
  }

  const sessions = [];
  const grand = costEmptyTotals();
  const perModel = {}; // model → totals
  let skippedLines = 0;

  for (const file of mainLogs) {
    const sessionId = file.replace(/\.jsonl$/, '');
    const files = [path.join(dir, file)];
    // sub-agent logs: <dir>/<sessionId>/subagents/agent-*.jsonl (ADDED, not duplicated)
    const subDir = path.join(dir, sessionId, 'subagents');
    if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      for (const sf of fs.readdirSync(subDir).sort()) {
        if (sf.endsWith('.jsonl')) files.push(path.join(subDir, sf));
      }
    }

    const totals = costEmptyTotals();
    const models = new Set();
    let eventCount = 0;
    for (const fp of files) {
      const { events, skippedLines: skipped } = costParseJsonlFile(fp, sinceMs, untilMs);
      skippedLines += skipped;
      for (const ev of events) {
        costAddUsage(totals, ev.usage);
        if (!perModel[ev.model]) perModel[ev.model] = costEmptyTotals();
        costAddUsage(perModel[ev.model], ev.usage);
        models.add(ev.model);
        eventCount++;
      }
    }
    costAddUsage(grand, {
      input_tokens: totals.input,
      output_tokens: totals.output,
      cache_read_input_tokens: totals.cacheRead,
      cache_creation_input_tokens: totals.cacheCreation,
    });
    if (eventCount > 0) {
      sessions.push({
        session: sessionId,
        models: [...models].sort(),
        events: eventCount,
        input: totals.input,
        output: totals.output,
        cacheRead: totals.cacheRead,
        cacheCreation: totals.cacheCreation,
        total: totals.input + totals.output + totals.cacheRead + totals.cacheCreation,
      });
    }
  }

  const total = grand.input + grand.output + grand.cacheRead + grand.cacheCreation;
  const summaryLine = `Cost: ${total} tokens (in ${grand.input}, out ${grand.output}, cache ${grand.cacheRead + grand.cacheCreation})`;

  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          project: dir,
          since: flags.since || null,
          until: flags.until || null,
          sessions,
          perModel,
          totals: {
            input: grand.input,
            output: grand.output,
            cacheRead: grand.cacheRead,
            cacheCreation: grand.cacheCreation,
            total,
          },
          skippedLines,
          summary: summaryLine,
        },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write('SESSION                               MODELS                          IN        OUT       CACHE\n');
    for (const s of sessions) {
      process.stdout.write(
        `${s.session.padEnd(38)}${s.models.join(',').padEnd(32)}${String(s.input).padEnd(10)}${String(s.output).padEnd(10)}${s.cacheRead + s.cacheCreation}\n`
      );
    }
    if (skippedLines > 0) process.stdout.write(`WARN: ${skippedLines} malformed line(s) skipped\n`);
    process.stdout.write(`${summaryLine}\n`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// realpath-check — Gate 0.7: deterministic real-backend evidence check.
//
// Kills the mock-test blind spot (`mock_tests_hide_sql_bugs`, 3× recurring in
// the learning corpus): any wave that adds a real-backend surface (SQL query,
// RLS policy, external HTTP call) must ship a test-execution transcript proving
// the code ran against the REAL backend — not a mock.
//
// How it works:
//   1. `git diff <base>..HEAD --unified=0` in the project dir.
//   2. Scan ADDED lines (lines starting with '+', not '+++') for surface
//      signatures grouped into 3 categories:
//        - sql : SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE
//                (case-insensitive) in code files. Diff hunks touching *.md or
//                *.sql migration COMMENT lines (-- …) are excluded.
//        - rls : ROW LEVEL SECURITY | \brls\b
//        - http: external HTTP calls — fetch( | axios | http.request — that
//                carry a non-localhost literal URL (http(s)://<host>) on the
//                same added line. localhost / 127.0.0.1 / 0.0.0.0 excluded.
//   3. No surfaces found → exit 0 ("no real-path surfaces in diff").
//   4. Surfaces found → require an evidence file (default
//      .a1/realpath-evidence.md). For EACH detected category the file must have
//      a `## <category>` section containing:
//        - at least one command line (a line starting with `$ ` or `> ` or
//          inside a fenced block that looks like a shell command), AND
//        - an output block that does NOT contain any mock marker
//          (jest.mock|vi.mock|createMock|MockAdapter|sqlite::memory:), AND
//        - at least one real-execution marker (default:
//          postgres|postgresql://|HTTP/|rows|Connected ; override --real-markers).
//      A category whose section is missing, only shows mock markers, or lacks a
//      real marker => that category "lacks proof".
//   5. Any category lacking proof => exit 1 (lists them). All proven => exit 0.
//   Bad args / no git repo / git failure => exit 2.
//
// KNOWN LIMITS (deliberately simple, line-based, no SQL/JS parsing):
//   - Signature scan is per-added-line; multi-line statements only trigger on
//     the line carrying the keyword. String literals containing keywords can
//     false-positive (conservative: a spurious evidence requirement, never a
//     silent miss). SQL inside comments on non-.md files is NOT stripped.
//   - Category<->section matching is by heading text only; it does not verify
//     the command actually exercises that category's surface.
//   - "command line" / "output block" detection is heuristic (markers, not a
//     shell parser). Evidence is a human+CLI contract, not a sandbox.
// ---------------------------------------------------------------------------

const REALPATH_SIGNATURES = {
  sql: /\b(SELECT|INSERT\s+INTO|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE)\b/i,
  rls: /(ROW\s+LEVEL\s+SECURITY|\brls\b)/i,
  http: /(fetch\s*\(|axios|http\.request)/i,
};

const REALPATH_MOCK_MARKERS = /(jest\.mock|vi\.mock|createMock|MockAdapter|sqlite::memory:)/i;
const REALPATH_DEFAULT_REAL_MARKERS = 'postgres|postgresql://|HTTP/|rows|Connected';
// Non-localhost literal URL on an HTTP-call line.
const REALPATH_URL = /https?:\/\/([^\s"'`)]+)/i;
const REALPATH_LOCALHOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

function runGit(args, cwd) {
  const { spawnSync } = require('child_process');
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error,
  };
}

// Scan a unified-diff for real-backend surfaces. Returns Set of category names.
function scanDiffForSurfaces(diff) {
  const found = new Set();
  const lines = diff.split('\n');
  let currentFile = null;
  let fileIsMd = false;
  for (const line of lines) {
    // Track the file the following added lines belong to.
    const fm = line.match(/^\+\+\+ b\/(.+)$/);
    if (fm) {
      currentFile = fm[1];
      fileIsMd = /\.md$/i.test(currentFile);
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (!line.startsWith('+')) continue; // only ADDED lines
    const added = line.slice(1);
    if (fileIsMd) continue; // exclude markdown docs entirely
    // Exclude SQL-migration comment lines (-- …) for the sql category.
    const isSqlComment = /^\s*--/.test(added);

    if (!isSqlComment && REALPATH_SIGNATURES.sql.test(added)) found.add('sql');
    if (REALPATH_SIGNATURES.rls.test(added)) found.add('rls');
    if (REALPATH_SIGNATURES.http.test(added)) {
      const urlMatch = added.match(REALPATH_URL);
      if (urlMatch && !REALPATH_LOCALHOST.test(urlMatch[1])) {
        found.add('http');
      }
    }
  }
  return found;
}

// Extract per-category sections from the evidence markdown. A section starts at
// a `## <category>` heading and runs until the next `## ` heading or EOF.
function extractEvidenceSections(evidenceText) {
  const sections = {};
  const lines = evidenceText.split('\n');
  let cur = null;
  let buf = [];
  const flush = () => {
    if (cur) sections[cur] = buf.join('\n');
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      flush();
      cur = h[1].trim().toLowerCase();
      continue;
    }
    if (cur) buf.push(line);
  }
  flush();
  return sections;
}

function sectionHasCommand(text) {
  // A command line: `$ `, `> `, or a fenced block whose first non-empty line
  // looks like a shell invocation.
  const lines = text.split('\n');
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (/^\s*[$>]\s+\S/.test(line)) return true;
    if (inFence && /\S/.test(line) && /^[\w./-]+(\s|$)/.test(line.trim())) return true;
  }
  return false;
}

function cmdRealpathCheckRun(args) {
  const flags = parseFlags(args, {
    'diff-base': 'value',
    project: 'value',
    evidence: 'value',
    'real-markers': 'value',
    json: 'bool',
  });
  const base = flags['diff-base'];
  if (!base) {
    process.stderr.write('error: realpath-check run requires --diff-base <git-ref>\n');
    process.exit(2);
  }
  const projectDir = flags.project ? path.resolve(flags.project) : process.cwd();
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    process.stderr.write(`error: project dir not found: ${projectDir}\n`);
    process.exit(2);
  }

  // Confirm this is a git repo.
  const inside = runGit(['rev-parse', '--is-inside-work-tree'], projectDir);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    process.stderr.write(`error: not a git repository: ${projectDir}\n`);
    process.exit(2);
  }

  const diffRes = runGit(['diff', `${base}..HEAD`, '--unified=0'], projectDir);
  if (!diffRes.ok) {
    process.stderr.write(`error: git diff failed: ${diffRes.stderr.trim() || 'unknown'}\n`);
    process.exit(2);
  }

  const surfaces = scanDiffForSurfaces(diffRes.stdout);

  if (surfaces.size === 0) {
    const out = { status: 'PASS', surfaces: [], message: 'no real-path surfaces in diff' };
    if (flags.json) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    else process.stdout.write('realpath-check: PASS — no real-path surfaces in diff\n');
    process.exit(0);
  }

  const evidencePath = flags.evidence
    ? path.resolve(flags.evidence)
    : path.join(projectDir, '.a1', 'realpath-evidence.md');

  let realMarkers;
  try {
    realMarkers = new RegExp(flags['real-markers'] || REALPATH_DEFAULT_REAL_MARKERS, 'i');
  } catch (e) {
    process.stderr.write(`error: invalid --real-markers: ${e.message}\n`);
    process.exit(2);
  }

  const detected = [...surfaces].sort();

  if (!fs.existsSync(evidencePath)) {
    const out = {
      status: 'FAIL',
      surfaces: detected,
      lacking: detected,
      evidence_path: evidencePath,
      message: `evidence file missing: ${evidencePath}`,
    };
    if (flags.json) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    else {
      process.stdout.write(`realpath-check: FAIL — evidence file missing: ${evidencePath}\n`);
      process.stdout.write(`  detected surfaces needing proof: ${detected.join(', ')}\n`);
    }
    process.exit(1);
  }

  const evidenceText = fs.readFileSync(evidencePath, 'utf8');
  const sections = extractEvidenceSections(evidenceText);

  const lacking = [];
  const reasons = {};
  for (const cat of detected) {
    const sec = sections[cat];
    if (sec === undefined) {
      lacking.push(cat);
      reasons[cat] = 'no `## ' + cat + '` section';
      continue;
    }
    if (!sectionHasCommand(sec)) {
      lacking.push(cat);
      reasons[cat] = 'section has no command line';
      continue;
    }
    if (REALPATH_MOCK_MARKERS.test(sec)) {
      lacking.push(cat);
      reasons[cat] = 'output contains mock marker(s)';
      continue;
    }
    if (!realMarkers.test(sec)) {
      lacking.push(cat);
      reasons[cat] = 'no real-execution marker found';
      continue;
    }
  }

  const status = lacking.length === 0 ? 'PASS' : 'FAIL';
  const out = {
    status,
    surfaces: detected,
    lacking,
    reasons,
    evidence_path: evidencePath,
  };
  if (flags.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else if (status === 'PASS') {
    process.stdout.write(
      `realpath-check: PASS — real-backend evidence found for: ${detected.join(', ')}\n`
    );
  } else {
    process.stdout.write(
      `realpath-check: FAIL — ${lacking.length} surface category(ies) lack proof\n`
    );
    for (const cat of lacking) {
      process.stdout.write(`  - ${cat}: ${reasons[cat]}\n`);
    }
  }
  process.exit(status === 'PASS' ? 0 : 1);
}

// ---------------------------------------------------------------------------
// check reservations — P7 cross-run coordination registry.
//
// A shared claim registry (.a1/reservations.json) so parallel runs don't
// collide on migration numbers, route paths, etc. (`parallel_collision`, 3× in
// corpus). Deterministic, atomic (tmp+rename). A claim is <type>:<value> held
// `by` a spec-id. Re-claiming a value already held by a DIFFERENT spec => exit 1
// with holder info. Same spec re-claiming => exit 0 (idempotent).
// ---------------------------------------------------------------------------

function reservationsFile(flags) {
  return flags.file ? path.resolve(flags.file) : path.join(process.cwd(), '.a1', 'reservations.json');
}

function loadReservations(file) {
  if (!fs.existsSync(file)) return { reservations: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.reservations)) return { reservations: [] };
    return parsed;
  } catch (_e) {
    return { reservations: [] };
  }
}

function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

const RESERVATIONS_LOCK_RETRIES = 20;
const RESERVATIONS_LOCK_RETRY_DELAY_MS = 50;
// A lock whose owning process is dead is reclaimed immediately (see
// isLockStale). A lock whose owning process is still alive but has held the
// lock longer than this is also treated as stale — this is the crash-without-
// cleanup safety net (SIGKILL/OOM between openSync and release leaves a lock
// file with no process to detect as dead via process.kill(pid, 0) IF the pid
// got reused, however unlikely; the timeout bounds that edge case too). Five
// minutes is generously above any real product-command runtime.
const RESERVATIONS_LOCK_STALE_MS = 5 * 60 * 1000;

/** Best-effort synchronous sleep (busy-wait via Atomics) — no external deps,
 * bounded by the caller's retry count so it can never hang. */
function sleepSyncMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

/** Returns true if the process identified by `pid` is no longer running.
 * process.kill(pid, 0) sends no signal but still performs the existence
 * check; it throws ESRCH if the pid is dead, EPERM if it's alive but owned
 * by another user (still "alive" for our purposes). */
function isPidDead(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === 'ESRCH';
  }
}

/** Decide whether an existing `<file>.lock` is stale (safe to reclaim)
 * rather than actively held. Reads the {pid, createdAt} JSON payload written
 * by acquireReservationsLock. A lock is stale if: the file can't be parsed
 * (pre-fix lock format, or corrupted — never block forever on either), the
 * owning pid is no longer running, or the lock is older than
 * RESERVATIONS_LOCK_STALE_MS. Never throws — any error while inspecting the
 * lock is treated as "stale" so a broken lock file can never wedge the
 * product-command family permanently. */
function isLockStale(lockPath) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (_e) {
    // Lock disappeared between EEXIST and this read (another process beat
    // us to reclaiming it, or released it normally) — not our lock to
    // reclaim, but also not something to error out on; caller will just
    // retry the openSync.
    return false;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_e) {
    // Unreadable/legacy lock content — can't prove it's live, so treat as
    // stale rather than blocking every future command on a corrupt file.
    return true;
  }
  const { pid, createdAt } = payload || {};
  if (isPidDead(pid)) return true;
  const createdMs = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(createdMs)) return true;
  return Date.now() - createdMs > RESERVATIONS_LOCK_STALE_MS;
}

/** Acquire an exclusive lock for read-check-write sequences on `file` by
 * creating `<file>.lock` with the 'wx' flag (fails if it already exists).
 * The lock file content is `{pid, createdAt}` JSON so a stale lock left
 * behind by a crashed process (SIGKILL, OOM — anything that skips
 * try/finally) can be detected and reclaimed instead of wedging every future
 * product-command invocation until a human runs `rm`. On EEXIST, inspects
 * the existing lock via isLockStale(): if stale, reclaims it atomically by
 * writing our payload to a unique tmp file and renameSync-ing it over the
 * stale lock, then reads the lock back to verify our pid actually won (if
 * another reclaimer renamed after us, we lost the race and retry instead of
 * proceeding) — this closes the unlink+open gap where two processes could
 * both believe they hold the lock; if live, falls back to the existing
 * bounded retry/backoff. Returns the lock path on success; calls fail()
 * (exit 1) on timeout so callers never proceed without the lock. */
function acquireReservationsLock(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lockPath = `${file}.lock`;
  for (let attempt = 0; attempt < RESERVATIONS_LOCK_RETRIES; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: nowIso() }));
      fs.closeSync(fd);
      return lockPath;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (isLockStale(lockPath)) {
        // Atomic reclaim: write our payload to a unique tmp file, then
        // renameSync over the stale lock (atomic replace on POSIX — same
        // pattern as writeJsonAtomic). Then read back and verify our pid
        // actually won: if another reclaimer renamed after us, their payload
        // is in place and we lost — retry instead of proceeding.
        const tmpLock = `${lockPath}.reclaim.${process.pid}.${attempt}`;
        try {
          fs.writeFileSync(tmpLock, JSON.stringify({ pid: process.pid, createdAt: nowIso() }));
          fs.renameSync(tmpLock, lockPath);
        } catch (_e2) {
          try { fs.unlinkSync(tmpLock); } catch (_e3) { /* best effort */ }
          continue;
        }
        let winner = null;
        try { winner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_e4) { /* raced */ }
        if (winner && winner.pid === process.pid) return lockPath;
        continue; // lost the reclaim race — another live holder now owns the lock
      }
      if (attempt < RESERVATIONS_LOCK_RETRIES - 1) {
        sleepSyncMs(RESERVATIONS_LOCK_RETRY_DELAY_MS);
      }
    }
  }
  fail(
    `could not acquire lock on ${lockPath} after ${RESERVATIONS_LOCK_RETRIES} attempts ` +
      `(another process holds it) — retry, or remove the stale lock file if no process is running`
  );
}

/** Release a lock acquired via acquireReservationsLock. Safe to call even if
 * the lock file is already gone. */
function releaseReservationsLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (_e) {
    // already removed — nothing to do
  }
}

/** process.exit() does NOT run try/finally blocks in Node, so every exit
 * inside a locked read-check-write section must release the lock explicitly
 * first. Use this instead of a bare process.exit(code) anywhere inside an
 * acquireReservationsLock(...) section. */
function exitWithLock(lockPath, code) {
  releaseReservationsLock(lockPath);
  process.exit(code);
}

/** Same idea as exitWithLock, but for the fail()/usage() error paths inside a
 * locked section: release the lock first, then print the error and exit 1. */
function failWithLock(lockPath, msg) {
  releaseReservationsLock(lockPath);
  fail(msg);
}

function cmdCheckReservations(args) {
  const flags = parseFlags(args, {
    claim: 'value',
    by: 'value',
    file: 'value',
    list: 'bool',
    release: 'bool',
  });
  const file = reservationsFile(flags);

  if (flags.list) {
    const data = loadReservations(file);
    const out = { file, count: data.reservations.length, reservations: data.reservations };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(0);
  }

  if (flags.release) {
    if (!flags.by) {
      usage('check reservations --release requires --by <spec-id> (optionally --claim <type>:<value>)');
    }
    const by = flags.by;
    let type = null;
    let value = null;
    if (flags.claim) {
      const relIdx = flags.claim.indexOf(':');
      if (relIdx <= 0 || relIdx === flags.claim.length - 1) {
        usage(`check reservations --claim must be <type>:<value> (got: ${flags.claim})`);
      }
      type = flags.claim.slice(0, relIdx);
      value = flags.claim.slice(relIdx + 1);
    }
    const lockPath = acquireReservationsLock(file);
    const data = loadReservations(file);

    if (flags.claim) {
      const existing = data.reservations.find((r) => r.type === type && r.value === value);
      if (existing && existing.by !== by) {
        const out = {
          status: 'FORBIDDEN',
          file,
          claim: { type, value, by },
          held_by: existing.by,
        };
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        process.stderr.write(
          `cannot release: ${type}:${value} is held by ${existing.by}, not ${by}\n`
        );
        exitWithLock(lockPath, 1);
      }
    }

    const matches = flags.claim
      ? data.reservations.filter((r) => r.type === type && r.value === value)
      : data.reservations.filter((r) => r.by === by);

    if (matches.length === 0) {
      const out = { status: 'OK', file, released: [], idempotent: true, note: 'nothing to release' };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      exitWithLock(lockPath, 0);
    }

    const removed = matches.filter((r) => r.by === by);
    const remaining = data.reservations.filter(
      (r) => !removed.some((m) => m === r)
    );
    writeJsonAtomic(file, { ...data, reservations: remaining });
    const out = { status: 'OK', file, released: removed, idempotent: false };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    exitWithLock(lockPath, 0);
  }

  if (!flags.claim || !flags.by) {
    usage('check reservations requires --claim <type>:<value> --by <spec-id> (or --list)');
  }
  const idx = flags.claim.indexOf(':');
  if (idx <= 0 || idx === flags.claim.length - 1) {
    usage(`check reservations --claim must be <type>:<value> (got: ${flags.claim})`);
  }
  const type = flags.claim.slice(0, idx);
  const value = flags.claim.slice(idx + 1);
  const by = flags.by;

  const data = loadReservations(file);
  const existing = data.reservations.find((r) => r.type === type && r.value === value);

  if (existing) {
    if (existing.by === by) {
      const out = { status: 'OK', idempotent: true, file, reservation: existing };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      process.exit(0);
    }
    const out = {
      status: 'CONFLICT',
      file,
      claim: { type, value, by },
      held_by: existing.by,
      holder: existing,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.stderr.write(
      `conflict: ${type}:${value} already reserved by ${existing.by} (at ${existing.at})\n`
    );
    process.exit(1);
  }

  const reservation = { type, value, by, at: nowIso() };
  const next = { reservations: [...data.reservations, reservation] };
  writeJsonAtomic(file, next);
  const out = { status: 'OK', idempotent: false, file, reservation };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

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

function usage(msg) {
  process.stderr.write(`usage error: ${msg}\n`);
  process.stderr.write(`\n${HELP}\n`);
  process.exit(1);
}

const HELP = `a1-tools — file-ops helper for a1-* skills

Usage:
  a1-tools spec next-number <project-slug>
  a1-tools spec update-status <spec-path> <new-status> [flags]
  a1-tools spec list <project-slug> [--status=<s>]

  a1-tools fix next-suffix <project-slug> <YYYY-MM-DD>
  a1-tools fix update-status <bug-path> <new-status> [flags]
  a1-tools fix list <project-slug> [--status=<s>] [--severity=<s>]
  a1-tools fix find-duplicates <project-slug> <keyword> [<keyword>...]

  a1-tools analyze next-slot <project-slug> <focus> [--date YYYY-MM-DD]
  a1-tools analyze init <project-slug> <focus> [--project-path /abs] [--date YYYY-MM-DD] [--title <text>]
  a1-tools analyze update-status <analysis-path> <new-status> [--phase-data <json>]
  a1-tools analyze discover <project-path>
  a1-tools analyze add-finding <analysis-path> <severity> <category> <location> <description> [--recommendation <text>]
  a1-tools analyze add-findings <analysis-path> --json <file|->   (batch: JSON array of finding objects)
  a1-tools analyze list <project-slug> [--status=<s>] [--focus=<s>]

  a1-tools check <project-slug> --feature <###-feature-slug> [--format json|human] [--vault <path>]
                  Consistency gate between spec and wave-plan.
                  Exit: 0 PASS, 1 FAIL (content), 2 ERROR (setup).
  a1-tools check reservations --claim <type>:<value> --by <spec-id> [--file <path>]
  a1-tools check reservations --list [--file <path>]
                  Cross-run claim registry (.a1/reservations.json) for migration
                  numbers, route paths, etc. Conflicting claim (held by another
                  spec) exits 1; same-spec re-claim is idempotent (exit 0).
  a1-tools check reservations --release --by <spec-id> [--claim <type>:<value>] [--file <path>]
                  release own claims; foreign claim -> exit 1; missing claim -> idempotent exit 0
  a1-tools code-scope claim --by <feature-id> --scope <path>[,<path>...] [--file <path>]
                  Path-list scope claim (same .a1/reservations.json registry).
                  Deterministic prefix/glob overlap check against every other
                  in-flight feature's code_scope. Overlap -> exit 1, JSON
                  {status:"CONFLICT", overlaps:[...]}, stderr names holder(s).
                  No overlap -> atomic write, exit 0. Same-feature identical
                  re-claim is idempotent (exit 0).
  a1-tools code-scope check --by <feature-id> --scope <path>[,<path>...] [--file <path>]
                  Dry-run variant of claim: same overlap comparison, never writes.
  a1-tools code-scope stage --by <feature-id> --set <stage> [--file <path>]
                  Advances the lifecycle stage on a feature's code_scope entry.
                  <stage> one of: started|complete|review|verify|merge|
                  origin-cleanup|done. Unknown feature-id -> exit 1. Invalid
                  stage -> exit 1. Rebuilds the reservation immutably, atomic
                  write, exit 0.
                  Forward-only monotonic transitions: the new stage's index in
                  the list above must be >= the current stage's index. Moving
                  BACKWARD (e.g. verify -> review) -> exit 1 with a clear
                  message. Skipping AHEAD (e.g. started -> merge) is allowed;
                  the JSON output then includes a "skipped": [...] warning
                  array listing the stage names that were bypassed.
  a1-tools code-scope release --by <feature-id> [--file <path>]
                  Removes a feature's code_scope reservation entirely, freeing
                  its scope for other features to claim (auto-unblock).
                  Idempotent: no matching entry -> exit 0, {released:false}.
  a1-tools code-scope list [--file <path>] [--stale-days <n>]
                  Lists all code_scope reservations (feature, stage, paths).
                  With --stale-days <n>: adds stale:true/false per entry based
                  on deterministic date math against <n> days ago (no
                  auto-release). Stale entries also get a hint field:
                  "release via a1-tools code-scope release --by <id>".

  a1-tools checklist run <project-slug>[/<feature-id>] [--format json|human] [--save] [--vault <path>]
                  Pre-flight checklist: 8 structural checks before implementation.
                  Severities: BLOCKER (exit 1), MAJOR/MINOR (exit 0, warnings).
                  Exit: 0 PASS or PASS_WITH_WARNINGS, 1 FAIL (blocker), 2 ERROR (setup).
                  With --save: writes report to projects/<slug>/checklist/<###>-<date>.md.
  a1-tools checklist list <project-slug> [--vault <path>]
                  List recent saved checklist reports for a project.

  a1-tools constitution init <project-slug> [--title <text>]
  a1-tools constitution discover <project-slug> [--project-path <abs>]
  a1-tools constitution update-status <constitution-path> <new-status>
  a1-tools constitution set-body <constitution-path> --body-file <path>
  a1-tools constitution next-version <project-slug>
  a1-tools constitution archive-current <project-slug> [--date YYYY-MM-DD]
  a1-tools constitution write-mirror <project-slug> --repo-root <abs>
  a1-tools constitution link-claudemd <project-slug> --repo-root <abs>
  a1-tools constitution list [--status=<s>]

  a1-tools worktree prepare <repo-root> <slug> [--branch <name>] [--base <branch>] [--force-reset]
                  Pre-Flight validation + registry entry. Exit: 0 PASS, 1 BLOCKER, 2 ERROR.
  a1-tools worktree enter <id>
                  Runs 'git worktree add'. Registry: prepared -> active.
  a1-tools worktree status <id>
                  Reports commit_count, has_uncommitted, branch_ahead/behind.
  a1-tools worktree exit <id> --mode <keep|discard|handoff> [--force-discard]
                  keep: remove worktree, keep branch. discard: remove both (refuses on unmerged commits without --force-discard). handoff: keep both for a1-pr-review.
  a1-tools worktree list [--status=<s>] [--repo-root=<abs>]
  a1-tools worktree gc [--dry-run]
                  Reconcile registry with on-disk state. Mark missing worktrees as cleaned.
  a1-tools worktree adopt <repo-root> <slug> [--worktree-path <abs>] [--branch <name>] [--base <branch>]
                  Register an EXISTING git worktree (created outside a1) as status=active, fields from git truth.
  a1-tools worktree reconcile <repo-root> [--prune]
                  Diff registry vs 'git worktree list' both ways. Read-only by default; --prune marks orphaned registry entries cleaned. Unregistered worktrees are listed as adopt candidates.

  a1-tools pr list-handoff [--repo-root=<abs>]
                  List registry entries with status=handoff (ready for review).
  a1-tools pr mark-status <id-or-slug> <handoff|in-review|reviewed|pr-open>
                  Update worktree status during the review lifecycle.
  a1-tools pr mark-pr-open <id-or-slug> <pr-url>
                  Mark a worktree as having an open PR (terminal status).
  a1-tools pr findings-summary <id-or-slug> | --worktree-path <abs>
                  Read <worktree>/.a1-review/findings.json and return counts + markdown
                  snippets for blocker_md, major_md, inline_minor_md.

  a1-tools phantom check <plan-path> [--repo-path <abs>] [--since <git-ref>]
                          [--format json|human]
                  Detect [X]-tasks in PLAN.md that have no corresponding code-change
                  in git diff. Warning-level: always exits 0. Tasks tagged with
                  "# no-code" are skipped. Default --since is the commit before the
                  one that last modified the PLAN file.
  a1-tools phantom list-tasks <plan-path>
                  Debug helper: parse PLAN.md and list all checkbox tasks with line
                  numbers, completed flag and no-code flag.

  a1-tools reconcile next-slot <project-slug> [--date YYYY-MM-DD]
                  Compute next free drift-<date>[-N].md slot for the project.
  a1-tools reconcile init <project-slug> --scope <single|project|vault-sync>
                          [--spec <###-feature-slug>] [--project-path /abs]
                          [--date YYYY-MM-DD] [--title <text>]
                  Create a drift report with frontmatter and empty body skeleton.
                  For --scope single, --spec is required.
  a1-tools reconcile parse-spec <drift-path>
                  Extract FR-### + inline-code anchors (file/function/endpoint)
                  from each scope target's spec. Computes STALE pre-filter via git.
                  Writes parsed_targets[] and stale_candidates[].
  a1-tools reconcile update-status <drift-path> <new-status> [--phase-data <json>]
                  Atomic frontmatter status transition. Appends phase_history.
  a1-tools reconcile add-drift <drift-path> <MISSING|EXTRA|DIVERGED|STALE>
                              <artifact> <description>
                              [--recommendation <text>] [--spec-ref <FR-###>]
                              [--code-ref <path:line>]
                  Append one drift to drifts[]. Auto-IDs (D-001, …). Recomputes
                  drifts_count.
  a1-tools reconcile list <project-slug> [--status=<s>]
                  List drift reports for a project. Use slug "_vault-sync" for
                  the cross-project sweep folder.

  a1-tools schema-check run --migrations <dir> [--tables t1,t2]
                            [--trigger-pattern 'audit|log'] [--json]
                  Deterministic schema pre-gate: (A) audit trigger exists per
                  table, (B) RLS enabled (warn if no FORCE), (C) FK column type
                  matches referenced PK type. Per-table PASS/FAIL + summary;
                  --json emits structured findings.
                  Exit: 0 pass, 1 findings, 2 error (dir/pattern/setup).
  a1-tools schema-check parse --migrations <dir> [--json]
                  Debug: dump the parsed SQL schema model (tables, columns, PKs,
                  FKs, triggers, RLS) as JSON.
                  Supported SQL subset: top-level semicolon-terminated statements;
                  '…' strings and $$…$$ bodies are opaque; no quoted identifiers;
                  CREATE TABLE (inline + table-level PK/FK), ALTER TABLE ADD
                  CONSTRAINT … FOREIGN KEY, ALTER TABLE … ENABLE/FORCE ROW LEVEL
                  SECURITY, CREATE TRIGGER … ON <table> (header only). Unsupported
                  constructs are skipped, never crash.

  a1-tools cost run --project <claude-projects-dir> [--since ISO] [--until ISO] [--json]
                  Aggregate token spend from Claude Code session JSONL logs
                  (~/.claude/projects/<flattened-cwd>/). Dedups streamed
                  assistant events by message.id, includes sub-agent logs
                  (<sessionId>/subagents/*.jsonl), skips malformed lines with a
                  warning counter. Per-session table + summary line
                  "Cost: N tokens (in X, out Y, cache Z)"; --json for machines.
                  Exit: 0 ok, 2 error (dir missing / no JSONL files).

  a1-tools realpath-check run --diff-base <git-ref> [--project <dir>]
                              [--evidence <file>] [--real-markers <pattern>] [--json]
                  Gate 0.7: scan the diff <base>..HEAD for real-backend surfaces
                  (SQL / RLS / external non-localhost HTTP). If found, require a
                  test-evidence file (default .a1/realpath-evidence.md) with a
                  '## <category>' section per detected surface, containing a
                  command + non-mock output + a real-execution marker (default
                  /postgres|postgresql://|HTTP/|rows|Connected/i).
                  Exit: 0 pass (no surfaces or all proven), 1 lacking proof,
                  2 bad args / no git.

  a1-tools pack validate <dir>
                  Validate a Gate-Pack (ADR 2026-07-05): pack.yaml required
                  fields (name, semver version, stacks[], provenance{occurrences,
                  severity,date_range,source}, anonymization A1|A2|A3, patterns[],
                  requires_cli), every listed pattern file exists with required
                  fields (id, class, trigger_signature, target{kind∈brief-line|
                  gate-step|cli-check, skill, anchor}, diff, evidence_schema), and
                  checks/ contains ONLY .json/.args.json (no executable payloads).
                  Exit: 0 valid, 1 invalid, 2 error (dir/manifest missing).
  a1-tools pack import <dir> [--dest <repo>]
                  validate → copy to <repo>/.a1/packs/<name>/ → stops. NEVER
                  applies (application happens only via a1-evolve, provenance
                  capped at 2). Re-import same version: idempotent (0). Different
                  version: replaces. Exit: 0 staged, 1 invalid, 2 error.
  a1-tools pack export --patterns <id,..> --anonymize A2|A3 --out <dir>
                       [--source <label>]
                  Build a pack skeleton from Vault patterns.md entries. Enforces
                  the anonymization deny-regex (/Users/, vault paths, e-mails,
                  tenant names) — a hit in generated output → exit 1 listing the
                  leak (nothing written). A3 additionally strips code blocks from
                  diffs. Exit: 0 exported, 1 leak/usage, 2 error (Vault missing).

  a1-tools product status [--dir docs/product]
                  Read-only. Prints { project, milestones, features, next }
                  parsed from <dir>/ROADMAP.md frontmatter, merging in
                  <dir>/features/<id>/feature.md (feature_md_path) when
                  present. Never writes any file. Exit: 0 ok, 1 ROADMAP.md
                  missing.
  a1-tools product stage --by <feature-id> --set <stage> [--dir docs/product]
                  Transactional stage transition (schema v1, see
                  docs/product/SCHEMA.md). <stage> reuses CODE_SCOPE_STAGES:
                  started|complete|review|verify|merge|origin-cleanup|done.
                  Forward-only (backward -> exit 1, nothing written).
                  Same-stage re-set is idempotent (exit 0, dates untouched,
                  no changelog line appended). On an actual stage change,
                  auto-appends a "<feature-id> -> <stage>" changelog line
                  (see 'product changelog'). Under one lock
                  (docs/product/.product-stage.lock.json): updates
                  ROADMAP.md frontmatter, mirrors features/<id>/feature.md
                  if it exists, mirrors a matching code_scope reservation's
                  .stage in .a1/reservations.json if one exists, regenerates
                  index.json + NEXT.md. All writes are staged as .tmp files
                  first and renamed only after every tmp write succeeds —
                  any failure rolls back with none of the originals
                  touched. Exit: 0 ok, 1 usage/validation/write error.
  a1-tools product markers [--dir docs/product] [--level project|milestone|feature --id <id>]
                  Read-only report (no --set) of the 3 marker levels:
                  project-level 'next' cursor + 'status', per-milestone
                  'status', per-feature 'stage'. Flags inconsistencies as
                  warnings[] (e.g. 'next' pointing at a done/cancelled
                  feature, or an in-flight feature missing a code_scope
                  reservation / with a null stage). Never writes any file in
                  this mode. Exit: 0 ok, 1 ROADMAP.md missing.
  a1-tools product markers --level <project|milestone|feature> [--id <id>] --set <value> [--dir docs/product]
                  Writer mode: updates the marker at the given level under
                  the same lock + tmp/rename transaction as 'product stage'
                  / 'product changelog', appends a changelog line, and
                  regenerates index.json + NEXT.md. --id required except at
                  project level. --set values: project ->
                  active|paused|done; milestone -> planned|in-progress|done;
                  feature -> reuses CODE_SCOPE_STAGES (same set as 'product
                  stage'), but does NOT enforce forward-only transitions or
                  mirror reservations.json/feature.md — use 'product stage'
                  for those guarantees. Exit: 0 ok, 1 usage/validation/write
                  error.
  a1-tools product changelog --entry "<what>" --why "<why>" [--dir docs/product]
                  Appends "- **YYYY-MM-DD** — <what> — <why>" under
                  ROADMAP.md's '## Changelog' section and regenerates
                  index.json + NEXT.md, under the same lock + tmp/rename
                  transaction as 'product stage'. When the Changelog holds
                  more than 100 entries, the oldest overflow is rotated
                  (append-only) into docs/product/CHANGELOG-archive.md in
                  the same transaction. Exit: 0 ok, 1 usage/write error.
  a1-tools product init --project <slug> --title <title> [--dir docs/product]
                  Scaffold a brand-new docs/product/ROADMAP.md (schema v1,
                  empty milestones[]/features[]) + NEXT.md + index.json.
                  Refuses (exit 1) if ROADMAP.md already exists — use
                  add-milestone/add-feature to extend an existing roadmap
                  instead. Exit: 0 ok, 1 usage/already-exists/write error.
  a1-tools product add-milestone --id <slug> --title <title>
                  [--target YYYY-MM] [--goal <text>] [--status <status>]
                  [--dir docs/product]
                  Append a new milestone to an existing ROADMAP.md
                  milestones[] list; auto-appends a changelog line and
                  regenerates index.json/NEXT.md. Exit: 0 ok, 1 usage/
                  duplicate-id/write error.
  a1-tools product add-feature --id <###-slug> --milestone <m-slug>
                  --title <title> [--goal <text>] [--depends-on a,b]
                  [--status <status>] [--dir docs/product]
                  Append a new feature to an existing ROADMAP.md features[]
                  list (schema-v1 shape); requires the milestone to already
                  exist. Auto-appends a changelog line and regenerates
                  index.json/NEXT.md. Exit: 0 ok, 1 usage/missing-
                  milestone/duplicate-id/write error.
  a1-tools product feature-init --id <###-slug> [--spec-path <path>]
                  [--plan-path <path>] [--dir docs/product]
                  Creates docs/product/features/<id>/feature.md (schema-v1
                  frontmatter: id/project/milestone/title/status/stage/
                  depends_on/spec_path/plan_path), mirrored from the
                  feature's existing ROADMAP.md features[] entry (which
                  must already exist — add it first via 'product
                  add-feature'). Refuses if feature.md already exists.
                  Auto-appends a changelog line and regenerates
                  index.json/NEXT.md. Exit: 0 ok, 1 usage/missing-feature/
                  already-exists/write error.
  a1-tools product validate [--dir docs/product]
                  Read-only. Validates <dir>/ROADMAP.md frontmatter against
                  the schema-v1 contract (docs/product/SCHEMA.md section 1 /
                  index.schema.json): required fields, enums, id/date
                  patterns, milestone/feature cross-references. Also runs a
                  best-effort FR-016 English-only lint (German-marker
                  heuristic: umlauts/ß or common German function words)
                  over the file content, surfaced as warnings[] — never
                  affects valid/exit code (flag, not a hard block). Prints
                  { valid, errors[], warnings[], file }. Never writes any
                  file. Exit: 0 valid, 1 invalid or ROADMAP.md missing.
  a1-tools product import --file <path> --project <slug>
                  [--title <text>] [--dir docs/product]
                  Migrate a legacy hand-rolled roadmap into a fresh
                  schema-v1 ROADMAP.md (FR-021/FR-022, Wave 6). ONE code
                  path auto-detects and handles both observed legacy
                  shapes — no per-consumer parser:
                    - hand-written HTML (Niimo-style): a Frappe-Gantt page
                      with a "const tasks = [...]" array; each task becomes
                      one feature under a single synthesized milestone.
                    - data.json + generator (A1/office-style): a JSON doc
                      with S4_phases.phases[].epics[].stories[]; each phase
                      becomes a milestone, each story a feature.
                  Content with no schema-v1 field (story points, epic/agent
                  groupings, vision/architecture/dispatch sections, gate/
                  blocker hints, legend text, …) is preserved verbatim under
                  '## Appendix — migrated details' — never dropped (FR-022).
                  Validates its own output against "product validate" before
                  writing (SC-006 round-trip); refuses to write on a
                  validation failure. Refuses to overwrite an existing
                  ROADMAP.md (same guard as "product init"). Writes through
                  regenerateDerived + the same lock/tmp/rename transaction
                  as every other product-mutating command, so index.json/
                  NEXT.md regenerate correctly. Exit: 0 ok, 1 usage/
                  unrecognized-shape/already-exists/validation/write error.

Spec statuses: ${[...SPEC_STATUSES].join(', ')}
Bug statuses:  ${[...BUG_STATUSES].join(', ')}
Bug severities: ${[...BUG_SEVERITIES].join(', ')}
Analysis statuses: ${[...ANALYSIS_STATUSES].join(', ')}
Analysis focuses:  ${[...ANALYSIS_FOCUSES].join(', ')}
Analysis severities: ${[...ANALYSIS_SEVERITIES].join(', ')}
Constitution statuses: ${[...CONSTITUTION_STATUSES].join(', ')}
Reconcile statuses: ${[...RECONCILE_STATUSES].join(', ')}
Reconcile scope modes: ${[...RECONCILE_SCOPE_MODES].join(', ')}
Reconcile drift classes: ${[...RECONCILE_DRIFT_CLASSES].join(', ')}

Vault root: env A1_VAULT_ROOT, default "~/N3URAL-Vault".
Exit codes: 0 success, 1 user/usage error, 2 internal error.`;

// ---------------------------------------------------------------------------
// phantom — Phantom-Task detection for GSD-style PLAN.md files.
//
// Detects [X]-tasks (completed checkboxes) that have no corresponding
// code-change in git. Warning-level: never exits non-zero on phantoms,
// the caller decides what to do with the report.
//
//   a1-tools phantom check <plan-path> [--repo-path <abs>] [--since <git-ref>]
//                          [--format json|human]
//     → JSON { plan, repo_path, since, total_completed, docs_only_skipped,
//              phantoms, status }
//
//   a1-tools phantom list-tasks <plan-path>
//     → JSON { plan, tasks: [{ line, completed, no_code, text }] }
// ---------------------------------------------------------------------------

const PHANTOM_STOP_WORDS = new Set([
  'the','and','for','with','from','into','this','that','these','those',
  'when','where','what','which','while','about','after','before','during',
  'task','tasks','step','steps','phase','update','updates','create','creates',
  'created','add','adds','added','make','makes','made','use','uses','used',
  'should','must','will','would','could','have','has','had','been','being',
  'such','also','then','than','their','there','here','some','many','more',
  'less','only','just','very','really','again','also','still','already',
  'plan','plans','docs','doc','code','file','files','line','lines','run',
  'runs','test','tests','tested','check','checks','checked','fix','fixes',
  'fixed','impl','implementation','implementations',
]);

function parsePhantomTasks(planText) {
  const lines = planText.split(/\r?\n/);
  const tasks = [];
  // Match list-item checkboxes: "- [ ] ...", "- [x] ...", "* [X] ...",
  // "1. [ ] ...". Capture state and text.
  const re = /^\s*(?:[-*+]|\d+[.)])\s*\[([ xX])\]\s+(.+?)\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const text = m[2];
    const completed = m[1] !== ' ';
    const no_code = /#\s*no-code\b/i.test(text);
    tasks.push({ line: i + 1, completed, no_code, text });
  }
  return tasks;
}

function extractPhantomKeywords(text) {
  // Strip the `# no-code` tag itself so we don't search for it.
  const cleaned = text.replace(/#\s*no-code\b/gi, '');
  const backtickTokens = [];
  const btRe = /`([^`]+)`/g;
  let m;
  while ((m = btRe.exec(cleaned)) !== null) {
    const tok = m[1].trim();
    if (tok.length >= 2) backtickTokens.push(tok);
  }
  // After removing backtick spans, scan the rest for code-shaped identifiers
  // and meaningful words.
  const noBackticks = cleaned.replace(/`[^`]+`/g, ' ');
  const codeIdent = [];
  const idRe = /\b([A-Za-z][A-Za-z0-9]*(?:[-_/.][A-Za-z0-9]+)+|[a-z]+[A-Z][A-Za-z0-9]+)\b/g;
  while ((m = idRe.exec(noBackticks)) !== null) {
    if (m[1].length >= 4) codeIdent.push(m[1]);
  }
  const words = [];
  const wRe = /\b([A-Za-z]{5,})\b/g;
  while ((m = wRe.exec(noBackticks)) !== null) {
    const w = m[1].toLowerCase();
    if (!PHANTOM_STOP_WORDS.has(w)) words.push(w);
  }
  return {
    strong: Array.from(new Set([...backtickTokens, ...codeIdent])),
    weak: Array.from(new Set(words)),
  };
}

function phantomDefaultSince(repoPath, planPath) {
  // Last commit that modified the PLAN.md itself — its parent is the
  // "before plan was checked off" baseline.
  try {
    const rel = path.relative(repoPath, planPath);
    const last = require('child_process')
      .execSync(`git -C "${repoPath}" log -1 --format=%H -- "${rel}"`, {
        encoding: 'utf8',
      })
      .trim();
    if (!last) return 'HEAD~20';
    // Use the PLAN commit's parent so the diff includes the implementation
    // that landed alongside the checkbox flip. Fall back to the commit
    // itself if it is the repo's initial commit.
    try {
      const parent = require('child_process')
        .execSync(`git -C "${repoPath}" rev-parse "${last}^"`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        })
        .trim();
      return parent;
    } catch {
      return last;
    }
  } catch {
    return 'HEAD~20';
  }
}

function phantomCollectDiff(repoPath, since) {
  const cp = require('child_process');
  let changedFiles = [];
  let diffBody = '';
  try {
    const names = cp
      .execSync(`git -C "${repoPath}" diff --name-only ${since}..HEAD`, {
        encoding: 'utf8',
      })
      .trim();
    changedFiles = names ? names.split(/\n/) : [];
  } catch (e) {
    // git may fail (bad ref, not a repo) — caller surfaces this.
    throw new Error(`git diff --name-only failed: ${e.message}`);
  }
  try {
    diffBody = cp.execSync(
      `git -C "${repoPath}" diff ${since}..HEAD`,
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    throw new Error(`git diff failed: ${e.message}`);
  }
  return { changedFiles, diffBody };
}

function phantomMatch(keywords, changedFiles, diffBody) {
  const filesLower = changedFiles.join('\n').toLowerCase();
  const diffLower = diffBody.toLowerCase();
  // Strong tokens: backtick + code-shaped identifiers. ONE strong match
  // in either filenames or diff body is enough.
  for (const tok of keywords.strong) {
    const t = tok.toLowerCase();
    if (filesLower.includes(t) || diffLower.includes(t)) return true;
  }
  // Weak tokens (plain words): need at least two distinct hits in diff body.
  let weakHits = 0;
  for (const w of keywords.weak) {
    if (diffLower.includes(w)) {
      weakHits++;
      if (weakHits >= 2) return true;
    }
  }
  return false;
}

function cmdPhantomCheck(rest) {
  const positional = [];
  let repoPath = null;
  let since = null;
  let format = 'json';
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--repo-path') repoPath = rest[++i];
    else if (a === '--since') since = rest[++i];
    else if (a === '--format') format = rest[++i];
    else if (a.startsWith('--')) usage(`unknown phantom check flag: ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) {
    usage('usage: phantom check <plan-path> [--repo-path <abs>] [--since <git-ref>] [--format json|human]');
  }
  const planPath = path.resolve(positional[0]);
  if (!fs.existsSync(planPath)) {
    process.stderr.write(`plan not found: ${planPath}\n`);
    process.exit(1);
  }
  if (!repoPath) {
    // Walk up from plan-path to find a .git directory.
    let dir = path.dirname(planPath);
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.git'))) {
        repoPath = dir;
        break;
      }
      dir = path.dirname(dir);
    }
    if (!repoPath) {
      process.stderr.write(
        `--repo-path not given and no .git ancestor found from ${planPath}\n`,
      );
      process.exit(1);
    }
  }
  repoPath = path.resolve(repoPath);
  if (!since) since = phantomDefaultSince(repoPath, planPath);

  const planText = fs.readFileSync(planPath, 'utf8');
  const tasks = parsePhantomTasks(planText);
  const completed = tasks.filter((t) => t.completed);

  const { changedFiles, diffBody } = phantomCollectDiff(repoPath, since);

  const docsOnlySkipped = [];
  const phantoms = [];
  for (const t of completed) {
    if (t.no_code) {
      docsOnlySkipped.push({ task: t.text, line: t.line });
      continue;
    }
    const kw = extractPhantomKeywords(t.text);
    if (kw.strong.length === 0 && kw.weak.length === 0) {
      phantoms.push({
        task: t.text,
        line: t.line,
        keywords: [],
        reason: 'no extractable keywords (consider rewording task or adding # no-code)',
      });
      continue;
    }
    const matched = phantomMatch(kw, changedFiles, diffBody);
    if (!matched) {
      phantoms.push({
        task: t.text,
        line: t.line,
        keywords: [...kw.strong, ...kw.weak].slice(0, 8),
        reason: 'no match in changed files or diff body',
      });
    }
  }

  const result = {
    plan: planPath,
    repo_path: repoPath,
    since,
    total_completed: completed.length,
    docs_only_skipped: docsOnlySkipped,
    phantoms,
    status: phantoms.length === 0 ? 'clean' : 'phantoms_found',
  };

  if (format === 'human') {
    const lines = [];
    lines.push(`Phantom-Check: ${planPath}`);
    lines.push(`Repo: ${repoPath}  Since: ${since}`);
    lines.push(`Erledigte Tasks: ${completed.length}`);
    lines.push(`Docs-only (skip):  ${docsOnlySkipped.length}`);
    lines.push(`Phantoms:          ${phantoms.length}`);
    if (phantoms.length === 0) {
      lines.push('');
      lines.push('Status: clean — alle erledigten Tasks haben Code-Spuren.');
    } else {
      lines.push('');
      lines.push('Status: phantoms_found');
      for (const p of phantoms) {
        lines.push(`  - Zeile ${p.line}: ${p.task}`);
        lines.push(`      Grund: ${p.reason}`);
        if (p.keywords.length)
          lines.push(`      Gesucht: ${p.keywords.join(', ')}`);
      }
    }
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(0);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

function cmdPhantomListTasks(rest) {
  if (rest.length !== 1) usage('usage: phantom list-tasks <plan-path>');
  const planPath = path.resolve(rest[0]);
  if (!fs.existsSync(planPath)) {
    process.stderr.write(`plan not found: ${planPath}\n`);
    process.exit(1);
  }
  const tasks = parsePhantomTasks(fs.readFileSync(planPath, 'utf8'));
  return { plan: planPath, tasks };
}

// ---------------------------------------------------------------------------
// pack — Gate-Pack system (ADR 2026-07-05-gate-pack-format).
//
// A pack is a versioned directory bundling battle-tested gate patterns so users
// import proven gates instead of collecting their own bugs. Trust model v1:
// curation over cryptography — no executable payloads (checks/ carries only
// parameter files for already-shipped CLI subcommands).
//
//   a1-tools pack validate <dir>
//       Validates pack.yaml manifest + every pattern file + checks/ safety.
//       Exit: 0 valid, 1 invalid (schema/field/unsafe-payload), 2 error (setup).
//
//   a1-tools pack import <dir> [--dest <repo>]
//       validate → copy to <repo>/.a1/packs/<name>/ → stops (never applies).
//       Re-import same version: idempotent (exit 0). Different version: replaces.
//
//   a1-tools pack export --patterns <id,..> --anonymize A2|A3 --out <dir>
//                        [--source <label>]
//       Builds a pack skeleton from Vault patterns.md entries. Enforces the
//       anonymization deny-regex — a hit in generated output → exit 1 (leak).
//       A3 additionally strips code blocks from diffs.
//
// pack.yaml (flat parser, reuses the frontmatter grammar — no YAML dependency).
// ---------------------------------------------------------------------------

const PACK_ANON_LEVELS = new Set(['A1', 'A2', 'A3']);
const PACK_TARGET_KINDS = new Set(['brief-line', 'gate-step', 'cli-check']);
// Deny-regex per ADR §3: project slugs, file paths, personal names, e-mails,
// vault paths, tenant names. A hit in exported output blocks the export.
const PACK_DENY_REGEX = /\/Users\/|N3URAL-Vault|@|n3ural|niimo/i;

// Parse a flat pack.yaml. Reuses parseFrontmatter's grammar by wrapping the
// body in "---" fences, then post-processes the two nested blocks the manifest
// needs (provenance{}, and the top-level scalar/list fields). No dependency.
function parsePackYaml(content) {
  // Nested objects (provenance) aren't handled by parseFrontmatter — parse the
  // manifest line-by-line with a one-level-deep indent model.
  const lines = content.split(/\r?\n/);
  const obj = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const valueRaw = m[2].trim();
    if (valueRaw === '') {
      // Could be a nested object (indented "key: val") or a block list ("- ").
      let j = i + 1;
      const nestedObj = {};
      const list = [];
      while (j < lines.length && /^\s+\S/.test(lines[j])) {
        const child = lines[j];
        const listM = child.match(/^\s*-\s*(.*)$/);
        const kvM = child.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
        if (listM) {
          list.push(unquotePackScalar(listM[1].trim()));
        } else if (kvM) {
          nestedObj[kvM[1]] = unquotePackScalar(kvM[2].trim());
        }
        j++;
      }
      if (list.length > 0) obj[key] = list;
      else if (Object.keys(nestedObj).length > 0) obj[key] = nestedObj;
      else obj[key] = null;
      i = j;
      continue;
    }
    obj[key] = parsePackInlineValue(valueRaw);
    i++;
  }
  return obj;
}

function unquotePackScalar(v) {
  if ((v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parsePackInlineValue(v) {
  if (v === '[]') return [];
  // Inline flow list: [a, b, c]
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => unquotePackScalar(s.trim()));
  }
  return unquotePackScalar(v);
}

// A pattern file is a YAML-ish document (frontmatter grammar) with a `diff` and
// `evidence_schema`. Parse the whole file as a manifest-style flat doc, but keep
// the raw text so multi-line block scalars (diff: |) can be recovered.
function parsePatternFile(content) {
  const obj = parsePackYaml(content);
  // Recover block scalar for `diff: |` — parsePackYaml gives it as null.
  const diffMatch = content.match(/^diff:\s*\|\s*\n([\s\S]*?)(?=^\S|\Z)/m);
  if (diffMatch) {
    obj.diff = diffMatch[1].replace(/\n+$/, '\n');
  }
  return obj;
}

function packValidateDir(dir) {
  const errors = [];
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return { ok: false, fatal: true, errors: [`pack dir not found: ${abs}`] };
  }
  const manifestPath = path.join(abs, 'pack.yaml');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, fatal: true, errors: [`missing pack.yaml in ${abs}`] };
  }

  let manifest;
  try {
    manifest = parsePackYaml(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { ok: false, fatal: true, errors: [`pack.yaml parse error: ${e.message}`] };
  }

  // Required manifest fields (ADR §2).
  const reqScalars = ['name', 'version', 'anonymization', 'requires_cli'];
  for (const k of reqScalars) {
    if (manifest[k] === undefined || manifest[k] === null || manifest[k] === '') {
      errors.push(`pack.yaml missing required field: ${k}`);
    }
  }
  if (manifest.version && !/^\d+\.\d+\.\d+$/.test(String(manifest.version))) {
    errors.push(`pack.yaml version "${manifest.version}" is not semver (MAJOR.MINOR.PATCH)`);
  }
  if (!Array.isArray(manifest.stacks) || manifest.stacks.length === 0) {
    errors.push('pack.yaml stacks[] must be a non-empty list');
  }
  if (manifest.anonymization && !PACK_ANON_LEVELS.has(String(manifest.anonymization))) {
    errors.push(`pack.yaml anonymization "${manifest.anonymization}" must be A1|A2|A3`);
  }
  const prov = manifest.provenance;
  if (!prov || typeof prov !== 'object' || Array.isArray(prov)) {
    errors.push('pack.yaml provenance{} missing or malformed');
  } else {
    for (const k of ['occurrences', 'severity', 'date_range', 'source']) {
      if (prov[k] === undefined || prov[k] === null || prov[k] === '') {
        errors.push(`pack.yaml provenance.${k} missing`);
      }
    }
  }
  if (!Array.isArray(manifest.patterns) || manifest.patterns.length === 0) {
    errors.push('pack.yaml patterns[] must be a non-empty list');
  }

  // Each listed pattern → file must exist with required fields.
  const listed = Array.isArray(manifest.patterns) ? manifest.patterns : [];
  for (const pid of listed) {
    const pf = path.join(abs, 'patterns', `${pid}.md`);
    if (!fs.existsSync(pf)) {
      errors.push(`pattern "${pid}" listed in manifest but patterns/${pid}.md missing`);
      continue;
    }
    let pat;
    try {
      pat = parsePatternFile(fs.readFileSync(pf, 'utf8'));
    } catch (e) {
      errors.push(`patterns/${pid}.md parse error: ${e.message}`);
      continue;
    }
    for (const k of ['id', 'class', 'trigger_signature', 'diff', 'evidence_schema']) {
      if (pat[k] === undefined || pat[k] === null || pat[k] === '') {
        errors.push(`patterns/${pid}.md missing required field: ${k}`);
      }
    }
    if (pat.id && String(pat.id) !== String(pid)) {
      errors.push(`patterns/${pid}.md id "${pat.id}" does not match filename "${pid}"`);
    }
    const tgt = pat.target;
    if (!tgt || typeof tgt !== 'object' || Array.isArray(tgt)) {
      errors.push(`patterns/${pid}.md target{} missing or malformed`);
    } else {
      if (!tgt.kind || !PACK_TARGET_KINDS.has(String(tgt.kind))) {
        errors.push(`patterns/${pid}.md target.kind "${tgt.kind}" must be brief-line|gate-step|cli-check`);
      }
      for (const k of ['skill', 'anchor']) {
        if (tgt[k] === undefined || tgt[k] === null || tgt[k] === '') {
          errors.push(`patterns/${pid}.md target.${k} missing`);
        }
      }
    }
  }

  // Also flag orphan pattern files not listed in the manifest.
  const patternsDir = path.join(abs, 'patterns');
  if (fs.existsSync(patternsDir)) {
    for (const entry of fs.readdirSync(patternsDir)) {
      if (!entry.endsWith('.md')) continue;
      const pid = entry.slice(0, -3);
      if (!listed.includes(pid)) {
        errors.push(`patterns/${entry} present but not listed in manifest patterns[]`);
      }
    }
  }

  // checks/ may ONLY contain parameter files — no executable payloads (ADR §5).
  const checksDir = path.join(abs, 'checks');
  if (fs.existsSync(checksDir)) {
    for (const entry of fs.readdirSync(checksDir)) {
      const full = path.join(checksDir, entry);
      if (fs.statSync(full).isDirectory()) {
        errors.push(`checks/${entry}/ — subdirectories not allowed in checks/`);
        continue;
      }
      const isParam = entry.endsWith('.json') || entry.endsWith('.args.json');
      if (!isParam) {
        errors.push(`checks/${entry} — only .json/.args.json parameter files allowed (no executable payloads)`);
      }
    }
  }

  return { ok: errors.length === 0, fatal: false, errors, manifest };
}

function cmdPackValidate(rest) {
  const dir = rest[0];
  if (!dir) {
    process.stderr.write('usage: pack validate <dir>\n');
    process.exit(1);
  }
  const res = packValidateDir(dir);
  if (res.fatal) {
    for (const e of res.errors) process.stderr.write(`error: ${e}\n`);
    process.exit(2);
  }
  if (res.ok) {
    process.stdout.write(`pack: VALID — ${res.manifest.name}@${res.manifest.version} (${(res.manifest.patterns || []).length} patterns)\n`);
    process.exit(0);
  }
  process.stderr.write(`pack: INVALID — ${res.errors.length} problem(s):\n`);
  for (const e of res.errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.statSync(s).isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rmDirRecursive(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function cmdPackImport(rest) {
  const flags = parseFlags(rest, { dest: 'value' });
  const dir = flags._[0];
  if (!dir) {
    process.stderr.write('usage: pack import <dir> [--dest <repo>]\n');
    process.exit(1);
  }
  const res = packValidateDir(dir);
  if (res.fatal) {
    for (const e of res.errors) process.stderr.write(`error: ${e}\n`);
    process.exit(2);
  }
  if (!res.ok) {
    process.stderr.write(`pack: INVALID — refusing import (${res.errors.length} problem(s)):\n`);
    for (const e of res.errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  const name = String(res.manifest.name);
  const version = String(res.manifest.version);
  const destRepo = path.resolve(flags.dest || process.cwd());
  const stagedDir = path.join(destRepo, '.a1', 'packs', name);

  let note = 'staged';
  if (fs.existsSync(stagedDir)) {
    const existingManifest = path.join(stagedDir, 'pack.yaml');
    let existingVersion = null;
    if (fs.existsSync(existingManifest)) {
      try {
        existingVersion = String(parsePackYaml(fs.readFileSync(existingManifest, 'utf8')).version);
      } catch (_e) {}
    }
    if (existingVersion === version) {
      // Idempotent re-import of same version.
      process.stdout.write(`pack ${name}@${version} already staged at ${stagedDir} — idempotent, apply via a1-evolve\n`);
      process.exit(0);
    }
    note = `replaced ${existingVersion || 'unknown'} → ${version}`;
    rmDirRecursive(stagedDir);
  }
  copyDirRecursive(path.resolve(dir), stagedDir);
  process.stdout.write(`pack ${name}@${version} staged at ${stagedDir} (${note}), apply via a1-evolve\n`);
  process.exit(0);
}

// Parse the Vault patterns.md "Applied" + "Monitoring" tables into records so
// export can build a pack skeleton from real corpus entries.
function parseVaultPatternsTable(content) {
  const records = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    // Applied table rows: | pattern | × | target | synthese |
    const row = line.match(/^\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (row) {
      let id = row[1].replace(/\*\*/g, '').trim();
      if (id === 'Pattern' || id.startsWith('---')) continue;
      const occ = parseInt(row[2].replace(/\*\*/g, ''), 10);
      const target = row[3].replace(/\*\*/g, '').trim();
      if (!id || isNaN(occ)) continue;
      records[id] = { id, occurrences: occ, target_file: target };
    }
    // Monitoring/watch rows: "- pattern_name (N) — description"
    const watch = line.match(/^-\s+([a-z_][a-z0-9_]*)\s*\((\d+)\)\s*(?:—\s*(.*))?$/);
    if (watch) {
      const id = watch[1];
      const occ = parseInt(watch[2], 10);
      if (!records[id]) {
        records[id] = { id, occurrences: occ, target_file: '', note: (watch[3] || '').trim() };
      }
    }
  }
  return records;
}

function cmdPackExport(rest) {
  const flags = parseFlags(rest, {
    patterns: 'value',
    anonymize: 'value',
    out: 'value',
    source: 'value',
  });
  if (!flags.patterns || !flags.anonymize || !flags.out) {
    process.stderr.write('usage: pack export --patterns <id,..> --anonymize A2|A3 --out <dir> [--source <label>]\n');
    process.exit(1);
  }
  if (!PACK_ANON_LEVELS.has(flags.anonymize)) {
    process.stderr.write(`error: --anonymize "${flags.anonymize}" must be A1|A2|A3 (export requires A2 or A3)\n`);
    process.exit(1);
  }
  const anon = flags.anonymize;
  const ids = flags.patterns.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    process.stderr.write('error: --patterns produced no ids\n');
    process.exit(1);
  }

  const patternsMd = path.join(vaultRoot(), 'pattern', 'a1-learnings', 'patterns.md');
  if (!fs.existsSync(patternsMd)) {
    process.stderr.write(`error: Vault patterns.md not found: ${patternsMd}\n`);
    process.exit(2);
  }
  const corpus = parseVaultPatternsTable(fs.readFileSync(patternsMd, 'utf8'));

  const missing = ids.filter((id) => !corpus[id]);
  if (missing.length > 0) {
    process.stderr.write(`error: pattern id(s) not found in Vault patterns.md: ${missing.join(', ')}\n`);
    process.exit(1);
  }

  const outDir = path.resolve(flags.out);
  const packName = path.basename(outDir);
  const source = flags.source || 'a1-office (anonymized)';

  // Build pattern files + manifest in memory, then run the deny-regex over the
  // FULL generated output. A hit → exit 1 listing the leak (before any write).
  const patternFiles = {};
  let totalOcc = 0;
  const stacks = new Set();
  for (const id of ids) {
    const rec = corpus[id];
    totalOcc += rec.occurrences;
    let diffText = rec.note || rec.target_file || `Gate derived from pattern ${id} (${rec.occurrences}×).`;
    if (anon === 'A3') {
      // A3: mechanism-only — strip fenced code blocks from diffs.
      diffText = diffText.replace(/```[\s\S]*?```/g, '[code stripped: A3]');
    }
    const pf = [
      `id: ${id}`,
      `class: ${id}`,
      `trigger_signature: "corpus pattern ${id}"`,
      'target:',
      '  kind: gate-step',
      '  skill: a1-new-feature',
      `  anchor: "${rec.target_file || 'Gate'}"`,
      'diff: |',
      `  ${diffText.replace(/\n/g, '\n  ')}`,
      'evidence_schema: "grep + CLI check output"',
      '',
    ].join('\n');
    patternFiles[id] = pf;
  }
  stacks.add('generic');

  const manifest = [
    `name: ${packName}`,
    'version: 0.1.0',
    `stacks: [${[...stacks].join(', ')}]`,
    'provenance:',
    `  occurrences: ${totalOcc}`,
    '  severity: unknown',
    '  date_range: unknown',
    `  source: ${source}`,
    `anonymization: ${anon}`,
    `patterns: [${ids.join(', ')}]`,
    'requires_cli: ">=1.4"',
    '',
  ].join('\n');

  // Deny-regex scan across all generated content.
  const scanTargets = [{ file: 'pack.yaml', text: manifest }];
  for (const id of ids) scanTargets.push({ file: `patterns/${id}.md`, text: patternFiles[id] });
  const leaks = [];
  for (const t of scanTargets) {
    for (const line of t.text.split('\n')) {
      const m = line.match(PACK_DENY_REGEX);
      if (m) leaks.push(`${t.file}: "${line.trim()}" (matched /${m[0]}/)`);
    }
  }
  if (leaks.length > 0) {
    process.stderr.write(`pack export: ANONYMIZATION FAILURE — ${leaks.length} leak(s), refusing to write:\n`);
    for (const l of leaks) process.stderr.write(`  - ${l}\n`);
    process.exit(1);
  }

  // Clean; write.
  fs.mkdirSync(path.join(outDir, 'patterns'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'pack.yaml'), manifest, 'utf8');
  for (const id of ids) {
    fs.writeFileSync(path.join(outDir, 'patterns', `${id}.md`), patternFiles[id], 'utf8');
  }
  process.stdout.write(`pack exported: ${packName} (${ids.length} patterns, ${anon}) → ${outDir}\n`);
  process.exit(0);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${HELP}\n`);
    process.exit(0);
  }
  const [group, sub, ...rest] = argv;
  let result;
  try {
    if (group === 'spec') {
      if (sub === 'next-number') result = cmdSpecNextNumber(rest);
      else if (sub === 'update-status') result = cmdSpecUpdateStatus(rest);
      else if (sub === 'list') result = cmdSpecList(rest);
      else usage(`unknown spec subcommand: ${sub}`);
    } else if (group === 'fix') {
      if (sub === 'next-suffix') result = cmdFixNextSuffix(rest);
      else if (sub === 'update-status') result = cmdFixUpdateStatus(rest);
      else if (sub === 'list') result = cmdFixList(rest);
      else if (sub === 'find-duplicates') result = cmdFixFindDuplicates(rest);
      else if (sub === 'integrity-check') result = cmdFixIntegrityCheck(rest);
      else if (sub === 'init-postmortem') result = cmdFixInitPostmortem(rest);
      else if (sub === 'count-postmortems-since') result = cmdFixCountPostmortemsSince(rest);
      else if (sub === 'update-promote-state') result = cmdFixUpdatePromoteState(rest);
      else if (sub === 'write-suggestion') result = cmdFixWriteSuggestion(rest);
      else usage(`unknown fix subcommand: ${sub}`);
    } else if (group === 'analyze') {
      if (sub === 'next-slot') result = cmdAnalyzeNextSlot(rest);
      else if (sub === 'init') result = cmdAnalyzeInit(rest);
      else if (sub === 'update-status') result = cmdAnalyzeUpdateStatus(rest);
      else if (sub === 'discover') result = cmdAnalyzeDiscover(rest);
      else if (sub === 'add-finding') result = cmdAnalyzeAddFinding(rest);
      else if (sub === 'add-findings') result = cmdAnalyzeAddFindings(rest);
      else if (sub === 'list') result = cmdAnalyzeList(rest);
      else usage(`unknown analyze subcommand: ${sub}`);
    } else if (group === 'check') {
      // `check reservations` is an independent subcommand (owns exit 0/1).
      if (sub === 'reservations') {
        cmdCheckReservations(rest);
        return; // unreachable — cmdCheckReservations calls process.exit()
      }
      // The default check command is special: it owns its own exit code (0/1/2)
      // and prints its own report (json or human). It does NOT fall through to
      // the generic JSON.stringify(result) path below.
      cmdCheckRun([sub, ...rest].filter((x) => x !== undefined));
      return; // unreachable — cmdCheckRun calls process.exit()
    } else if (group === 'code-scope') {
      // code-scope claim/check own their exit code (0/1) and JSON output.
      if (sub === 'claim') {
        cmdCodeScopeClaim(rest);
        return; // unreachable — cmdCodeScopeClaim calls process.exit()
      } else if (sub === 'check') {
        cmdCodeScopeCheck(rest);
        return; // unreachable — cmdCodeScopeCheck calls process.exit()
      } else if (sub === 'stage') {
        cmdCodeScopeStage(rest);
        return; // unreachable — cmdCodeScopeStage calls process.exit()
      } else if (sub === 'release') {
        cmdCodeScopeRelease(rest);
        return; // unreachable — cmdCodeScopeRelease calls process.exit()
      } else if (sub === 'list') {
        cmdCodeScopeList(rest);
        return; // unreachable — cmdCodeScopeList calls process.exit()
      } else {
        usage(`unknown code-scope subcommand: ${sub}`);
      }
    } else if (group === 'realpath-check') {
      if (sub === 'run') {
        // owns its own exit code (0 pass / 1 findings / 2 error) and stdout
        cmdRealpathCheckRun(rest);
        return; // unreachable — cmdRealpathCheckRun calls process.exit()
      } else usage(`unknown realpath-check subcommand: ${sub}`);
    } else if (group === 'checklist') {
      if (sub === 'run') {
        // checklist run owns its own exit code (0/1/2) and report format.
        cmdChecklistRun(rest);
        return; // unreachable — cmdChecklistRun calls process.exit()
      } else if (sub === 'list') {
        result = cmdChecklistList(rest);
      } else {
        usage(`unknown checklist subcommand: ${sub}`);
      }
    } else if (group === 'constitution') {
      if (sub === 'init') result = cmdConstitutionInit(rest);
      else if (sub === 'discover') result = cmdConstitutionDiscover(rest);
      else if (sub === 'update-status') result = cmdConstitutionUpdateStatus(rest);
      else if (sub === 'set-body') result = cmdConstitutionSetBody(rest);
      else if (sub === 'next-version') result = cmdConstitutionNextVersion(rest);
      else if (sub === 'archive-current') result = cmdConstitutionArchiveCurrent(rest);
      else if (sub === 'write-mirror') result = cmdConstitutionWriteMirror(rest);
      else if (sub === 'link-claudemd') result = cmdConstitutionLinkClaudemd(rest);
      else if (sub === 'list') result = cmdConstitutionList(rest);
      else usage(`unknown constitution subcommand: ${sub}`);
    } else if (group === 'worktree') {
      if (sub === 'prepare') result = cmdWorktreePrepare(rest);
      else if (sub === 'enter') result = cmdWorktreeEnter(rest);
      else if (sub === 'status') result = cmdWorktreeStatus(rest);
      else if (sub === 'exit') result = cmdWorktreeExit(rest);
      else if (sub === 'list') result = cmdWorktreeList(rest);
      else if (sub === 'gc') result = cmdWorktreeGc(rest);
      else if (sub === 'adopt') result = cmdWorktreeAdopt(rest);
      else if (sub === 'reconcile') result = cmdWorktreeReconcile(rest);
      else usage(`unknown worktree subcommand: ${sub}`);
    } else if (group === 'pr') {
      if (sub === 'list-handoff') result = cmdPrListHandoff(rest);
      else if (sub === 'mark-status') result = cmdPrMarkStatus(rest);
      else if (sub === 'mark-pr-open') result = cmdPrMarkPrOpen(rest);
      else if (sub === 'findings-summary') result = cmdPrFindingsSummary(rest);
      else usage(`unknown pr subcommand: ${sub}`);
    } else if (group === 'phantom') {
      if (sub === 'check') {
        // owns its own exit code and stdout (json or human)
        cmdPhantomCheck(rest);
        return; // unreachable
      } else if (sub === 'list-tasks') {
        result = cmdPhantomListTasks(rest);
      } else {
        usage(`unknown phantom subcommand: ${sub}`);
      }
    } else if (group === 'reconcile') {
      if (sub === 'next-slot') result = cmdReconcileNextSlot(rest);
      else if (sub === 'init') result = cmdReconcileInit(rest);
      else if (sub === 'parse-spec') result = cmdReconcileParseSpec(rest);
      else if (sub === 'update-status') result = cmdReconcileUpdateStatus(rest);
      else if (sub === 'add-drift') result = cmdReconcileAddDrift(rest);
      else if (sub === 'list') result = cmdReconcileList(rest);
      else usage(`unknown reconcile subcommand: ${sub}`);
    } else if (group === 'modernize') {
      if (sub === 'next-slot') result = cmdModernizeNextSlot(rest);
      else if (sub === 'init') result = cmdModernizeInit(rest);
      else if (sub === 'update-status') result = cmdModernizeUpdateStatus(rest);
      else if (sub === 'discover-stack') result = cmdModernizeDiscoverStack(rest);
      else if (sub === 'add-proposal') result = cmdModernizeAddProposal(rest);
      else if (sub === 'approve-proposal') result = cmdModernizeApproveProposal(rest);
      else if (sub === 'add-wave') result = cmdModernizeAddWave(rest);
      else if (sub === 'snapshot-behavior') result = cmdModernizeSnapshotBehavior(rest);
      else if (sub === 'start-wave') result = cmdModernizeStartWave(rest);
      else if (sub === 'complete-wave') result = cmdModernizeCompleteWave(rest);
      else if (sub === 'verify-parity') result = cmdModernizeVerifyParity(rest);
      else if (sub === 'publish-notion') result = cmdModernizePublishNotion(rest);
      else if (sub === 'list') result = cmdModernizeList(rest);
      else usage(`unknown modernize subcommand: ${sub}`);
    } else if (group === 'schema-check') {
      if (sub === 'parse') result = cmdSchemaCheckParse(rest);
      else if (sub === 'run') {
        // owns its own exit code (0 pass / 1 findings / 2 error) and stdout
        cmdSchemaCheckRun(rest);
        return; // unreachable — cmdSchemaCheckRun calls process.exit()
      } else usage(`unknown schema-check subcommand: ${sub}`);
    } else if (group === 'cost') {
      if (sub === 'run') {
        // owns its own exit code (0 ok / 2 error) and stdout (table or json)
        cmdCostRun(rest);
        return; // unreachable — cmdCostRun calls process.exit()
      } else usage(`unknown cost subcommand: ${sub}`);
    } else if (group === 'product') {
      // product status/stage own their exit code (0/1) and JSON output.
      if (sub === 'status') {
        cmdProductStatus(rest);
        return; // unreachable — cmdProductStatus calls process.exit()
      } else if (sub === 'stage') {
        cmdProductStage(rest);
        return; // unreachable — cmdProductStage calls process.exit()
      } else if (sub === 'markers') {
        cmdProductMarkers(rest);
        return; // unreachable — cmdProductMarkers calls process.exit()
      } else if (sub === 'changelog') {
        cmdProductChangelog(rest);
        return; // unreachable — cmdProductChangelog calls process.exit()
      } else if (sub === 'init') {
        cmdProductInit(rest);
        return; // unreachable — cmdProductInit calls process.exit()
      } else if (sub === 'add-milestone') {
        cmdProductAddMilestone(rest);
        return; // unreachable — cmdProductAddMilestone calls process.exit()
      } else if (sub === 'add-feature') {
        cmdProductAddFeature(rest);
        return; // unreachable — cmdProductAddFeature calls process.exit()
      } else if (sub === 'feature-init') {
        cmdProductFeatureInit(rest);
        return; // unreachable — cmdProductFeatureInit calls process.exit()
      } else if (sub === 'import') {
        cmdProductImport(rest);
        return; // unreachable — cmdProductImport calls process.exit()
      } else if (sub === 'validate') {
        cmdProductValidate(rest);
        return; // unreachable — cmdProductValidate calls process.exit()
      } else {
        usage(`unknown product subcommand: ${sub}`);
      }
    } else if (group === 'pack') {
      // pack subcommands own their exit codes (0/1/2) and stdout.
      if (sub === 'validate') {
        cmdPackValidate(rest);
        return; // unreachable — cmdPackValidate calls process.exit()
      } else if (sub === 'import') {
        cmdPackImport(rest);
        return; // unreachable — cmdPackImport calls process.exit()
      } else if (sub === 'export') {
        cmdPackExport(rest);
        return; // unreachable — cmdPackExport calls process.exit()
      } else usage(`unknown pack subcommand: ${sub}`);
    } else {
      usage(`unknown command group: ${group} (expected "spec", "fix", "analyze", "check", "checklist", "constitution", "worktree", "pr", "phantom", "reconcile", "modernize", "schema-check", "cost", "pack", "product", or "realpath-check"). fix supports: next-suffix, update-status, list, find-duplicates, integrity-check, init-postmortem, count-postmortems-since, update-promote-state, write-suggestion`);
    }
  } catch (e) {
    process.stderr.write(`internal error: ${e.message}\n`);
    if (process.env.A1_DEBUG) process.stderr.write(`${e.stack}\n`);
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

main();
