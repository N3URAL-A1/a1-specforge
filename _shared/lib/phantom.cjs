'use strict';

const fs = require('fs');
const path = require('path');
const { gitSafe, assertNoShellMetachar } = require('./git-safe.cjs');
const { usage } = require('./help.cjs');

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
    const last = gitSafe(repoPath, ['log', '-1', '--format=%H', '--', rel]);
    if (!last) return 'HEAD~20';
    // Use the PLAN commit's parent so the diff includes the implementation
    // that landed alongside the checkbox flip. Fall back to the commit
    // itself if it is the repo's initial commit.
    try {
      const parent = gitSafe(repoPath, ['rev-parse', `${last}^`], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return parent;
    } catch {
      return last;
    }
  } catch {
    return 'HEAD~20';
  }
}

function phantomCollectDiff(repoPath, since) {
  let changedFiles = [];
  let diffBody = '';
  try {
    const names = gitSafe(repoPath, ['diff', '--name-only', `${since}..HEAD`]);
    changedFiles = names ? names.split(/\n/) : [];
  } catch (e) {
    // git may fail (bad ref, not a repo) — caller surfaces this.
    throw new Error(`git diff --name-only failed: ${e.message}`);
  }
  try {
    diffBody = gitSafe(repoPath, ['diff', `${since}..HEAD`], {
      maxBuffer: 64 * 1024 * 1024,
    });
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
  // Defense-in-depth: reject shell metacharacters at the parsing boundary so
  // a future exec site added elsewhere (not going through gitSafe) fails
  // safe too — these values eventually reach git invocations.
  try {
    if (repoPath) assertNoShellMetachar(repoPath, '--repo-path');
    if (since) assertNoShellMetachar(since, '--since');
  } catch (e) {
    usage(e.message);
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

module.exports = { cmdPhantomCheck, cmdPhantomListTasks };
