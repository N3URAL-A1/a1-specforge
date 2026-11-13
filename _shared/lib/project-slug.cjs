'use strict';

// ---------------------------------------------------------------------------
// project-slug — the one rule that turns a repo into a project slug (spec 027 D4).
// Pure fs: no child_process, so a worktree is resolved through .git -> gitdir -> commondir.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseNestedFrontmatter } = require('./io.cjs');

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,100}$/;

/** @param {string} dir @returns {string|null} ROADMAP.md frontmatter `project` when it is a valid slug */
function roadmapProject(dir) {
  try {
    const fm = parseNestedFrontmatter(fs.readFileSync(path.join(dir, 'docs', 'product', 'ROADMAP.md'), 'utf8')).fm;
    if (fm && typeof fm.project === 'string' && SLUG_RE.test(fm.project)) return fm.project;
  } catch (_e) { /* no roadmap */ }
  return null;
}

/** @param {{slug?: string, project: string}} opts @returns {string} */
function projectSlug(opts) {
  return opts.slug || roadmapProject(opts.project) || path.basename(opts.project);
}

/** @param {string} repo @returns {string} the main checkout of a linked worktree, else `repo` itself */
function mainCheckoutDir(repo) {
  try {
    const dotGit = path.join(repo, '.git');
    if (fs.lstatSync(dotGit).isDirectory()) return repo;
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!m) return repo;
    const gitdir = path.resolve(repo, m[1].trim());
    const common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim());
    return path.basename(common) === '.git' ? path.dirname(common) : repo;
  } catch (_e) {
    return repo;
  }
}

/** @param {string} repo @returns {string} roadmap project, else the directory name of the main checkout */
function repoProjectSlug(repo) {
  return roadmapProject(repo) || path.basename(mainCheckoutDir(repo));
}

module.exports = { SLUG_RE, roadmapProject, projectSlug, mainCheckoutDir, repoProjectSlug };
