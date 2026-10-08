'use strict';

// Where things live: the learning-store root, the code roots, the repo root,
// and the guarded joins below them. Split out of io.cjs (which re-exports
// every name). Owns the once-per-process stderr announcements.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { guardChildPath } = require('./intent-child.cjs');

// ---------- vault root resolution ----------

// Module-level once-flag: the status line is printed on the FIRST vaultRoot()
// call per process only. vaultRoot() is the single choke point for all ~32
// call sites (spec, fix, analyze, constitution, checklist, reconcile,
// modernize AND every wiki/-writing subcommand: postmortem, promote,
// write-suggestion). No per-subcommand status emission.
let _vaultRootAnnounced = false;

/**
 * Resolve the learning-store root via a 3-tier fallback chain. No silent
 * degradation: the chosen tier is always announced once per process to stderr.
 *
 * Precedence (env wins over repo-local, repo-local wins over legacy):
 *   Tier 1  A1_VAULT_ROOT env var      → used as-is (dir created on first write).
 *           Rob's machine keeps writing to ~/N3URAL-Vault ONLY via this env var.
 *   Tier 2  inside a git repo          → <repo>/.a1/learnings/ (auto-created).
 *           Always succeeds inside a repo — this is the OSS default.
 *   Tier 3  legacy ~/N3URAL-Vault      → ONLY if it already exists AND we are
 *           NOT inside a git repo. Emits a deprecation warning.
 *   none    not in a repo, no env, no legacy → hard-fail exit 2 (NO Tier 4).
 *
 * All stderr; never stdout (stdout is the JSON contract of the CLI).
 */
function vaultRoot() {
  return resolveVaultRoot().root;
}

/**
 * Same resolution, same one-time announcement, but the caller also learns the
 * TIER: `{ root, source }` with source ∈ env | repo-local | legacy. Spec 010
 * (vault mirror) needs it — the mirror is active only for tier `env`. Fresh
 * object per call; vaultRoot() is a thin wrapper, so the tier is announced
 * exactly once per process whichever of the two is called first.
 */
function vaultRootInfo() {
  const { root, source } = resolveVaultRoot();
  return { root, source };
}

/**
 * Read-only twin of vaultRoot() for lookups that must not change anything
 * (spec 010 SC-002): same tier order, but it never creates `.a1/learnings/`,
 * never announces on stderr and never exits. Returns { root, source } or null
 * when nothing resolves. The repo-local path is returned even if it does not
 * exist yet — a lookup there simply finds nothing.
 */
function peekVaultRoot() {
  if (process.env.A1_VAULT_ROOT) return { root: process.env.A1_VAULT_ROOT, source: 'env' };
  try {
    const { execSync } = require('child_process');
    const top = execSync('git rev-parse --show-toplevel', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (top) return { root: path.join(top, '.a1', 'learnings'), source: 'repo-local' };
  } catch (_e) {
    /* not in a repo — fall through to legacy */
  }
  const legacy = path.join(os.homedir(), 'N3URAL-Vault');
  return fs.existsSync(legacy) ? { root: legacy, source: 'legacy' } : null;
}

function resolveVaultRoot() {
  let root;
  let source;

  // Tier 1 — explicit env var.
  if (process.env.A1_VAULT_ROOT) {
    root = process.env.A1_VAULT_ROOT;
    source = 'env';
  } else {
    // Tier 2 — repo-local, if inside a git repo (CWD-based).
    let repoTop = null;
    try {
      const { execSync } = require('child_process');
      repoTop = execSync('git rev-parse --show-toplevel', {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
    } catch (_e) {
      repoTop = null;
    }

    if (repoTop) {
      root = path.join(repoTop, '.a1', 'learnings');
      source = 'repo-local';
      if (!fs.existsSync(root)) {
        fs.mkdirSync(root, { recursive: true });
        process.stderr.write('[a1-tools] created .a1/learnings/\n');
      }
    } else {
      // Tier 3 — legacy vault, ONLY if it already exists and we are not in a repo.
      const legacy = path.join(os.homedir(), 'N3URAL-Vault');
      if (fs.existsSync(legacy)) {
        root = legacy;
        source = 'legacy';
        process.stderr.write(
          '[a1-tools] Using legacy vault ~/N3URAL-Vault — set A1_VAULT_ROOT or run inside a git repo for repo-local .a1/learnings/\n'
        );
      } else {
        // Nothing resolves — hard fail, no silent fallback.
        process.stderr.write(
          '[a1-tools] error: cannot resolve a learning-store root.\n' +
            '  Set A1_VAULT_ROOT to an explicit path, or run inside a git repo\n' +
            '  (repo-local .a1/learnings/ is used automatically there).\n'
        );
        process.exit(2);
      }
    }
  }

  if (!_vaultRootAnnounced) {
    _vaultRootAnnounced = true;
    process.stderr.write(
      `[a1-tools] learnings root: ${root} (source: ${source})\n`
    );
  }

  return { root, source };
}

// ---------- code roots resolution ----------

// Same choke-point idea as vaultRoot(), for a different question. vaultRoot()
// answers "where do learning artifacts get WRITTEN"; codeRoots() answers "where
// do the project CHECKOUTS live" — the directories a1-evolve's collect phase
// globs for `*/.a1/learnings/`, `*/.a1/phases/*/observations.jsonl` and
// `*/.a1/packs/`. They are unrelated paths: on Rob's machine the store is
// ~/N3URAL-Vault (via A1_VAULT_ROOT) while the checkouts are ~/claude-projects.
let _codeRootsAnnounced = false;

/**
 * Resolve the directories that hold project checkouts, as an array of absolute
 * paths (most specific first). No silent degradation: the chosen tier is
 * announced once per process to stderr, like vaultRoot().
 *
 * Precedence:
 *   Tier 1  A1_CODE_ROOTS env var  → colon-separated list, used as-is.
 *           Only existing directories are kept; if none exist, that is an
 *           error, not a silent fall-through to autodetect.
 *   Tier 2  autodetect             → the first of ~/claude-projects, ~/code,
 *           ~/projects, ~/src, ~/repos, ~/dev that exists. All matches are
 *           returned, not just the first, so a split setup still works.
 *   Tier 3  the current git repo's parent directory — a sibling layout is the
 *           common case for a single-checkout machine.
 *   none    nothing resolves → empty array plus a loud stderr warning. The
 *           caller decides whether that is fatal; a collect phase that finds
 *           no roots must say so rather than report "0 learnings".
 *
 * Why this exists (2026-09-11): a1-evolve's collect globs were hardcoded to
 * ~/code, which does not exist on this machine — taken literally the 6th
 * synthesis run would have collected nothing while reporting success. Third
 * collect-scope defect in six runs, so the path got an owner instead of a
 * fourth hardcode.
 */
function codeRoots({ quiet = false } = {}) {
  let roots = [];
  let source;

  if (process.env.A1_CODE_ROOTS) {
    // Absolute only. A relative entry passes statSync (resolved against the
    // CURRENT cwd) and then poisons every emitted glob, because a1-evolve's
    // collect phase changes directory between steps — the glob would silently
    // mean something different per step. The JSDoc promises absolute paths, so
    // deliver them: resolve first, and reject anything that was not absolute.
    const declared = process.env.A1_CODE_ROOTS.split(':')
      .map((d) => d.trim())
      .filter(Boolean);
    // Shell-hazardous characters. A DENYLIST, deliberately, not an allowlist:
    // no real project root contains `$`, a backtick, `;`, `|`, `&`, `<`, `>` or
    // a newline, while an allowlist would reject paths that are perfectly
    // legitimate on this machine (`Müller-Projekte`, `c++tools`, `foo@bar`) and
    // would then be disabled by whoever hits it. Defence in depth after SEC-1:
    // the primary control is that `glob-liveness.cjs` passes patterns as argv
    // rather than shell source, so nothing here is load-bearing for safety —
    // this is a legibility guard that says "your root looks like a command,
    // that is a config error" instead of letting it travel silently.
    // (a1-samuel-security SEC-5, 2026-09-12: "exists as a directory" was not a
    // sufficient boundary check for a value flowing into globs and mkdirSync.)
    const hazardous = declared.filter((d) => /[$`;|&<>\n\r]/.test(d));
    if (hazardous.length > 0) {
      process.stderr.write(
        `[a1-tools] error: A1_CODE_ROOTS entries must not contain shell metacharacters: ${hazardous.join(', ')}\n`
      );
      process.exit(2);
    }
    const relative = declared.filter((d) => !path.isAbsolute(d));
    if (relative.length > 0) {
      process.stderr.write(
        `[a1-tools] error: A1_CODE_ROOTS entries must be absolute paths: ${relative.join(', ')}\n`
      );
      process.exit(2);
    }
    roots = declared.filter((d) => {
      try {
        return fs.statSync(d).isDirectory();
      } catch (_e) {
        return false;
      }
    });
    source = 'env';
    if (roots.length === 0) {
      process.stderr.write(
        `[a1-tools] error: A1_CODE_ROOTS is set but none of its paths exist: ${declared.join(', ')}\n`
      );
      process.exit(2);
    }
  } else {
    const candidates = ['claude-projects', 'code', 'projects', 'src', 'repos', 'dev'];
    roots = candidates
      .map((c) => path.join(os.homedir(), c))
      .filter((d) => {
        try {
          return fs.statSync(d).isDirectory();
        } catch (_e) {
          return false;
        }
      });
    source = 'autodetect';

    if (roots.length === 0) {
      // Tier 3 — sibling layout relative to the current repo.
      try {
        const { execSync } = require('child_process');
        const top = execSync('git rev-parse --show-toplevel', {
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .toString()
          .trim();
        if (top) {
          roots = [path.dirname(top)];
          source = 'repo-parent';
        }
      } catch (_e) {
        /* not in a repo — fall through to the empty case */
      }
    }
  }

  // quiet: a read-only lookup (spec update-status hint, SC-002) must not
  // change stderr; it neither announces nor consumes the one-time announcement.
  if (!quiet && !_codeRootsAnnounced) {
    _codeRootsAnnounced = true;
    if (roots.length === 0) {
      process.stderr.write(
        '[a1-tools] warning: no project roots resolved. Set A1_CODE_ROOTS\n' +
          '  (colon-separated) so cross-project collection can find checkouts.\n'
      );
    } else {
      process.stderr.write(
        `[a1-tools] code roots: ${roots.join(', ')} (source: ${source})\n`
      );
    }
  }

  return roots;
}

/**
 * Absolute path of the repository root.
 *
 * Hoisted here 2026-09-12 (a1-reinhard-reviewer NIT): spec 007 added a
 * byte-identical copy to both `retro-validate.cjs` and `workflow-lint.cjs`,
 * and the facade had its own. One owner per fact (invariant 1) applies to
 * helpers too — three copies of "where is the repo root" is three places to
 * drift.
 *
 * `git rev-parse` first (correct inside a worktree, which is where feature
 * work happens), falling back to two levels up from this file
 * (`_shared/lib/` → root), matching the fixture suites' own REPO_ROOT.
 * @returns {string}
 */
function repoRoot() {
  const { execSync } = require('child_process');
  try {
    return execSync('git rev-parse --show-toplevel', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch (_e) {
    return path.resolve(__dirname, '..', '..');
  }
}

// Both resolvers pass their result through the intent child-mode scope check
// (spec 011 FR-041; a no-op outside child mode).
function resolveVaultPath(input) {
  return guardChildPath(path.isAbsolute(input) ? input : path.join(vaultRoot(), input));
}

// ---------- path-traversal guard ----------

// User-supplied identifiers (project slugs, feature/analysis ids) become path
// segments under <vault>/project/. A hostile value like `../../etc` or an
// absolute path must fail loud instead of resolving outside the vault.
function assertSafeSegment(value, label) {
  const v = String(value == null ? '' : value);
  if (
    v === '' ||
    v === '.' ||
    v === '..' ||
    v.includes('/') ||
    v.includes('\\') ||
    v.includes('\0')
  ) {
    const err = new Error(
      `${label || 'path segment'} must be a plain identifier without path separators (got: ${JSON.stringify(v)})`
    );
    err.code = 'A1_INPUT'; // facade prints these as user errors, not internal
    throw err;
  }
  return v;
}

// Central join for everything under <vault>/project/. Every segment is
// validated — literals ('spec', 'fixes') pass trivially, user input cannot
// escape. Multi-segment literals ('a/b') are rejected by design: pass
// segments individually.
function projectsPath(...segments) {
  const safe = segments.map((s) => assertSafeSegment(s, 'projects path segment'));
  return guardChildPath(path.join(vaultRoot(), 'project', ...safe));
}

module.exports = { vaultRoot, vaultRootInfo, peekVaultRoot, codeRoots, repoRoot, resolveVaultPath, assertSafeSegment, projectsPath };
