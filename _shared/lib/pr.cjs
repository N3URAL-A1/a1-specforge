'use strict';

const fs = require('fs');
const path = require('path');

const { usage } = require('./help.cjs');
const { parseFlags, fail, nowIso } = require('./io.cjs');

// registry read/write + entry lookup + findings read live in lib/worktree-registry.cjs
const {
  readRegistry,
  writeRegistryAtomic,
  findEntryBySlugOrId,
  readFindings,
} = require('./worktree-registry.cjs');

// PR_STATUSES is local to this group only (its single consumer, cmdPrMarkStatus,
// lives in this same file) — it does NOT belong in status-constants.cjs.
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

module.exports = {
  cmdPrListHandoff,
  cmdPrMarkStatus,
  cmdPrMarkPrOpen,
  cmdPrFindingsSummary,
};
