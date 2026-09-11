'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { usage } = require('./help.cjs');
const { codeRoots } = require('./io.cjs');

// ---------- learnings subcommands ----------
//
// `learnings count-since-watermark` — deterministic counter for the a1
// learning loop (M11-P4). Counts new learning entries since the watermark
// recorded in patterns.md's frontmatter, across all three entry formats:
//   1. retro `date:` blocks (repeatable per file — retro-template format)
//   2. a1-fix.md `## YYYY-MM-DD` H2 headers
//   3. postmortem `date:` frontmatter fields
//
// Watermark comparison is DATE-ONLY (YYYY-MM-DD string compare), strict `>`
// (exclusive). This is a deliberate trade-off, not an oversight: it matches
// a1-evolve's own collector logic (avoiding a double-count race where
// a1-evolve updates the watermark and a same-day new entry would otherwise
// be seen twice across runs), and same-day promptness is not goal-critical
// for a weekly/session-fallback cadence. Consequence: a learning entry dated
// today is invisible to this counter until the calendar date advances past
// today — a guaranteed one-day lag for same-day entries, not an occasional
// one. See help.cjs for the user-facing statement of this trade-off.
//
// Directory walking is native Node (fs.readdirSync recursion) — no
// execSync/shell-out to find/grep with interpolated paths. This mirrors the
// project's own documented "Sicherheits-Lesson 2026-07-13" command-injection
// avoidance pattern.

/** Minimal flag parser for this subcommand: --projects-root <path>, --json. */
function parseLearningsFlags(argv) {
  const flags = { projectsRoot: path.join(os.homedir(), 'code'), json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--projects-root') {
      flags.projectsRoot = argv[++i];
    } else if (a.startsWith('--projects-root=')) {
      flags.projectsRoot = a.slice('--projects-root='.length);
    } else if (a === '--json') {
      flags.json = true;
    }
  }
  return flags;
}

/** Recursively list all files under `dir` matching `filterFn(fullPath, entryName)`,
 * skipping unreadable subdirectories rather than throwing. Never shells out. */
function walkFiles(dir, filterFn, results) {
  results = results || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return results; // unreadable/missing dir — treat as empty, not an error
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, filterFn, results);
    } else if (entry.isFile()) {
      if (!filterFn || filterFn(full, entry.name)) {
        results.push(full);
      }
    }
  }
  return results;
}

/** List immediate subdirectories of `dir` (one level), or [] if unreadable/missing. */
function listSubdirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_e) {
    return null;
  }
}

/** Count `^date: (\S+)` matches (frontmatter blocks) in a1-learnings pattern
 * files (excluding patterns.md/index.md), strictly after `watermark`. */
function countDateBlocks(root, watermark) {
  let count = 0;
  const projectDirs = listSubdirs(root);
  for (const projName of projectDirs) {
    const patternDir = path.join(
      root, projName, '.a1', 'learnings', 'pattern', 'a1-learnings'
    );
    const files = walkFiles(patternDir, (full, name) => {
      if (name === 'patterns.md' || name === 'index.md') return false;
      return name.endsWith('.md');
    });
    for (const f of files) {
      const content = readFileSafe(f);
      if (!content) continue;
      const re = /^date:\s*(\S+)/gm;
      let m;
      while ((m = re.exec(content)) !== null) {
        if (m[1] > watermark) count++;
      }
    }
  }
  return count;
}

/** Count `^## (\d{4}-\d{2}-\d{2})` H2 headers in a1-fix.md files, strictly
 * after `watermark`. */
function countH2Blocks(root, watermark) {
  let count = 0;
  const projectDirs = listSubdirs(root);
  for (const projName of projectDirs) {
    const f = path.join(
      root, projName, '.a1', 'learnings', 'pattern', 'a1-learnings', 'a1-fix.md'
    );
    const content = readFileSafe(f);
    if (!content) continue;
    const re = /^## (\d{4}-\d{2}-\d{2})/gm;
    let m;
    while ((m = re.exec(content)) !== null) {
      if (m[1] > watermark) count++;
    }
  }
  return count;
}

/** Count postmortem files (frontmatter `date:`) under
 * <project>/.a1/learnings/project/<slug>/postmortems/**, strictly after `watermark`. */
// A postmortems/ directory is not homogeneous: some projects file
// `type: feature-note` (shipped features, no defect) or `type: record`
// (decision records) alongside real postmortems. Counting files instead of
// reading their type inflates bug clusters — on 2026-08-02 this turned 7 real
// niimo bugs into a reported 19, and on 2026-09-11 it reported 6 postmortems
// where only 4 were defects. The rule ("read `type:` before counting") had
// lived in a1-evolve's collect workflow since 08-02 but never reached this
// code, so every automated count repeated the error the workflow warned about.
// Counted: `type:` absent (legacy postmortem) or postmortem/bugfix. Excluded
// and reported separately: anything else.
function isCountablePostmortem(fmBlock) {
  const t = fmBlock.match(/^type:\s*(\S+)/m);
  if (!t) return true; // legacy entry, predates the type: field
  const v = t[1].toLowerCase();
  return v === 'postmortem' || v === 'bugfix';
}

function countPostmortems(root, watermark) {
  let count = 0;
  let excluded = 0;
  const projectDirs = listSubdirs(root);
  for (const projName of projectDirs) {
    const postmortemsDir = path.join(
      root, projName, '.a1', 'learnings', 'project'
    );
    const files = walkFiles(postmortemsDir, (full, name) => name.endsWith('.md') && full.includes(path.sep + 'postmortems' + path.sep));
    for (const f of files) {
      const content = readFileSafe(f);
      if (!content) continue;
      // Only the frontmatter block's date: field — match the first
      // "date:" line inside a leading "---\n ... \n---" block.
      const fmEnd = content.indexOf('\n---', 4);
      const fmBlock = content.startsWith('---\n') && fmEnd !== -1
        ? content.slice(0, fmEnd)
        : content;
      const m = fmBlock.match(/^date:\s*(\S+)/m);
      if (!m || !(m[1] > watermark)) continue;
      if (isCountablePostmortem(fmBlock)) count++;
      else excluded++;
    }
  }
  return { count, excluded };
}


// ---------- Vault mode (A1_VAULT_ROOT set, seit 2026-09-07) ----------
// Learning store = <vault>/pattern/a1-learnings/ (retros, patterns.md as
// watermark source) + <vault>/project/<slug>/postmortems/. Only top-level
// retro files count — lessons/, _state/, _canonical/ are machinery.

function readWatermark(watermarkPath) {
  let watermarkContent;
  try {
    if (!fs.existsSync(watermarkPath)) {
      process.stderr.write(
        `error: watermark source missing: ${watermarkPath} (has a1-evolve ever run? see M11-P1)\n`
      );
      process.exit(3);
    }
    watermarkContent = fs.readFileSync(watermarkPath, 'utf8');
  } catch (e) {
    process.stderr.write(`error: watermark source unreadable: ${watermarkPath}: ${e.message}\n`);
    process.exit(3);
  }
  const wmMatch = watermarkContent.match(/^updated:\s*(\S+)/m);
  if (!wmMatch) {
    process.stderr.write(
      `error: watermark field missing in ${watermarkPath} (expected 'updated: YYYY-MM-DD' in frontmatter)\n`
    );
    process.exit(2);
  }
  return wmMatch[1];
}

function countVaultRetros(patternDir, watermark) {
  let dateBlocks = 0;
  let h2Blocks = 0;
  let names = [];
  try { names = fs.readdirSync(patternDir); } catch (_e) { return { dateBlocks, h2Blocks }; }
  for (const name of names) {
    if (!name.endsWith('.md') || name === 'patterns.md' || name === 'index.md') continue;
    const content = readFileSafe(path.join(patternDir, name));
    if (!content) continue;
    let m;
    const reDate = /^date:\s*(\S+)/gm;
    while ((m = reDate.exec(content)) !== null) if (m[1] > watermark) dateBlocks++;
    if (name === 'a1-fix.md') {
      const reH2 = /^## (\d{4}-\d{2}-\d{2})/gm;
      while ((m = reH2.exec(content)) !== null) if (m[1] > watermark) h2Blocks++;
    }
  }
  return { dateBlocks, h2Blocks };
}

function countVaultPostmortems(vault, watermark) {
  let count = 0;
  let excluded = 0;
  const projectRoot = path.join(vault, 'project');
  for (const slug of listSubdirs(projectRoot)) {
    const dir = path.join(projectRoot, slug, 'postmortems');
    const files = walkFiles(dir, (full, name) => name.endsWith('.md'));
    for (const f of files) {
      const content = readFileSafe(f);
      if (!content) continue;
      const fmEnd = content.indexOf('\n---', 4);
      const fmBlock = content.startsWith('---\n') && fmEnd !== -1 ? content.slice(0, fmEnd) : content;
      const m = fmBlock.match(/^date:\s*(\S+)/m);
      if (!m || !(m[1] > watermark)) continue;
      if (isCountablePostmortem(fmBlock)) count++;
      else excluded++;
    }
  }
  return { count, excluded };
}

function cmdLearningsCountSinceWatermarkVault(vault, json) {
  const patternDir = path.join(vault, 'pattern', 'a1-learnings');
  const watermark = readWatermark(path.join(patternDir, 'patterns.md'));
  const { dateBlocks, h2Blocks } = countVaultRetros(patternDir, watermark);
  const { count: postmortems, excluded: nonDefects } = countVaultPostmortems(vault, watermark);
  const output = {
    count: dateBlocks + h2Blocks + postmortems,
    new_since_date: watermark,
    watermark,
    source: 'vault',
    root: vault,
    sources: { date_blocks: dateBlocks, h2_blocks: h2Blocks, postmortems },
    // Files under postmortems/ whose type: is neither postmortem nor bugfix
    // (feature-note, record). Reported, never silently dropped.
    excluded_non_defect_entries: nonDefects,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

function cmdLearningsCountSinceWatermark(argv) {
  const flags = parseLearningsFlags(argv);
  const explicitRoot = argv.some((a) => a === '--projects-root' || a.startsWith('--projects-root='));
  if (process.env.A1_VAULT_ROOT && !explicitRoot) {
    return cmdLearningsCountSinceWatermarkVault(process.env.A1_VAULT_ROOT, flags.json);
  }
  const root = flags.projectsRoot;

  const watermarkPath = path.join(
    root, 'a1-skills', '.a1', 'learnings', 'pattern', 'a1-learnings', 'patterns.md'
  );

  let watermarkContent;
  try {
    // Distinguish "missing" from "unreadable" explicitly (resolves AUDIT M3).
    if (!fs.existsSync(watermarkPath)) {
      process.stderr.write(
        `error: watermark source missing: ${watermarkPath} (has a1-evolve ever run? see M11-P1)\n`
      );
      process.exit(3);
    }
    watermarkContent = fs.readFileSync(watermarkPath, 'utf8');
  } catch (e) {
    process.stderr.write(
      `error: watermark source unreadable: ${watermarkPath}: ${e.message}\n`
    );
    process.exit(3);
  }

  const wmMatch = watermarkContent.match(/^updated:\s*(\S+)/m);
  if (!wmMatch) {
    process.stderr.write(
      `error: watermark field missing in ${watermarkPath} (expected 'updated: YYYY-MM-DD' in frontmatter)\n`
    );
    process.exit(2);
  }
  const watermark = wmMatch[1];

  const dateBlocks = countDateBlocks(root, watermark);
  const h2Blocks = countH2Blocks(root, watermark);
  const { count: postmortems, excluded: nonDefects } = countPostmortems(root, watermark);
  const count = dateBlocks + h2Blocks + postmortems;

  const output = {
    count,
    new_since_date: watermark,
    watermark,
    sources: {
      date_blocks: dateBlocks,
      h2_blocks: h2Blocks,
      postmortems,
    },
    // See countVaultPostmortems: non-defect entries filed under postmortems/.
    excluded_non_defect_entries: nonDefects,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

/**
 * `learnings roots` — print the resolved project-checkout roots and the store
 * globs derived from them, as JSON. Exists so a1-evolve's collect phase can ASK
 * where the checkouts are instead of hardcoding a path: the workflow had
 * `~/code/*` baked in, which does not exist on every machine, and a glob that
 * matches nothing reports "no learnings" rather than an error (2026-09-11, 3rd
 * collect-scope defect in six synthesis runs).
 *
 * Exit 0 with roots, exit 3 when nothing resolves — a collect phase must fail
 * loudly rather than synthesize from an empty corpus.
 */
function cmdLearningsRoots(argv) {
  const flags = parseLearningsFlags(argv);
  const roots = codeRoots();

  const output = {
    roots,
    vault_root: process.env.A1_VAULT_ROOT || null,
    globs: {
      stores: roots.map((r) => path.join(r, '*', '.a1', 'learnings', 'pattern', 'a1-learnings')),
      observations: roots.map((r) => path.join(r, '*', '.a1', 'phases', '*', 'observations.jsonl')),
      packs: roots.map((r) => path.join(r, '*', '.a1', 'packs', '*', 'pack.yaml')),
      quick: roots.map((r) => path.join(r, '*', '.a1', 'learnings', 'projects', '*', 'quick')),
    },
  };

  if (roots.length === 0) {
    process.stdout.write(JSON.stringify({ ...output, error: 'no project roots resolved' }, null, 2) + '\n');
    process.exit(3);
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

module.exports = { cmdLearningsCountSinceWatermark, cmdLearningsRoots };
