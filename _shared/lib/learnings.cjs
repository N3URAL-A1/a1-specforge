'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { usage } = require('./help.cjs');

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
function countPostmortems(root, watermark) {
  let count = 0;
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
      if (m && m[1] > watermark) count++;
    }
  }
  return count;
}

function cmdLearningsCountSinceWatermark(argv) {
  const flags = parseLearningsFlags(argv);
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
  const postmortems = countPostmortems(root, watermark);
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
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

module.exports = { cmdLearningsCountSinceWatermark };
