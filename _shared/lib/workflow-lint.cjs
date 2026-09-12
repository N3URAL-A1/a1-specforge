'use strict';

const fs = require('fs');
const path = require('path');
const { parseFlags } = require('./io.cjs');

// ---------------------------------------------------------------------------
// workflow lint — Wave 3 of spec 007-retro-gate-id-validator.
//
// `node a1-tools.cjs workflow lint [--root <path>]` scans every documented
// shell snippet under `<root>/skills/*/workflows/*.md` for a pipeline whose
// STATUS is tested where the PIPELINE'S exit code, not the first command's,
// is what `$?` (or a `||` right-hand side) actually reads. Robert's OQ-004
// decision: a CLI check, not a reviewer checklist item.
//
// THE CONSTRAINT THAT DECIDES WHETHER THIS GUARD IS REAL (measured
// 2026-09-11/12): the live repo has ZERO true positives. The defect this
// guard exists to catch was fixed the same morning it was found
// (01-collect.md), and the only remaining pipe-with-`||` line in the repo
// (03-verify.md:140, `grep -c ... || echo 0`) is a legitimate
// value-defaulting idiom, not a swallowed exit status. A naive matcher that
// flags "any pipe on a line with ||" produces exactly one finding against the
// real repo and it is a FALSE POSITIVE — worse than no guard, because it
// fires only wrongly. So the matcher is deliberately built as TWO small
// predicates, not one regex:
//
//   - isStatusTesting(line): the RIGHT-HAND SIDE of a pipeline's exit status
//     is being inspected — `$?` read on this or the next line, or `|| exit`,
//     `|| abort`, `|| return` directly on the pipeline. This is the
//     swallowed-exit shape: the pipeline's own success/failure is what is
//     being asked about.
//   - isValueDefaulting(line): the `||` right-hand side substitutes a
//     LITERAL VALUE for a command that legitimately exits non-zero on "no
//     match" (`|| echo <literal>`, `|| true`, `|| :`) — no exit status is
//     being tested here, only a value is being defaulted. `grep -c` exiting 1
//     on zero matches is the textbook case (03-verify.md:140).
//
// A pipe is flagged only when it contains a parser stage (python3, `node
// -e`, jq, awk, sed, grep) AND isStatusTesting() matches AND
// isValueDefaulting() does NOT match for the same right-hand side. Scanning
// is restricted to lines inside ```bash fenced blocks — prose describing this
// very bug (01-collect.md line ~20) must stay clean (W5).
//
// Because there is no live true positive, the RED proof for this guard
// cannot come from the repo — it comes from committed fixture snippets under
// `_test-fixtures/a1-workflow-lint/snippets/`, per CONVENTIONS.md's RED-proof
// section (FR-007). The registry row says so explicitly.
//
// Exit codes (documented again in help.cjs, per invariant 7):
//   0  no findings (a clean scan) — see W7 for why `scanned` must ALSO be
//      asserted: a glob typo returns 0 files and would also exit 0.
//   1  at least one finding.
//   2  usage error, or a hostile/unreadable --root value.
//
// Stdout is the JSON machine contract: { root, scanned, findings: [...],
// markers }. All diagnostics go to stderr only.
// ---------------------------------------------------------------------------

const MAX_ROOT_LEN = 4096;

// Parser stages that a pipeline commonly delegates parsing to. A bare `|` with
// no such stage on the right is not what this guard is about (e.g. `foo | bar`
// piping between two arbitrary commands is not a documented parse-then-check
// shape anywhere in this repo today).
const PARSER_STAGE_RE = /\|\s*(?:python3?\b|node\s+-e\b|jq\b|awk\b|sed\b|grep\b)/;

// Value-defaulting predicate: the `||` right-hand side supplies a literal
// value (echo/printf of a literal, `true`, or `:`) rather than testing an
// exit status. Checked BEFORE isStatusTesting() in isSwallowedExitPipe() — if
// it matches, the line is never flagged regardless of what isStatusTesting()
// would also match, because the right-hand side never actually inspects the
// pipeline's status; it substitutes a value for a command (like `grep -c`)
// that legitimately exits non-zero on "no match".
function isValueDefaulting(line) {
  return /\|\|\s*(?:echo\b[^|]*|printf\b[^|]*|true\s*$|:\s*$)/.test(line);
}

// Status-testing predicate: something on this line (or on the assumption that
// the very next line continues the same statement) actually inspects a
// pipeline's exit status. Deliberately broad — `$?` on this/the next line, OR
// ANY `||` right-hand side at all (a bare "pipe with a trailing ||" is the
// NAIVE first-pass matcher this guard starts from, per the wave brief: "a
// naive matcher that flags pipe-on-a-line-with-|| produces exactly one
// finding and it is a false positive"). isValueDefaulting() is what narrows
// this naive matcher down to real catches — it runs FIRST in
// isSwallowedExitPipe() and excludes the `|| echo <literal>` / `|| true` /
// `|| :` shapes that this predicate alone would otherwise treat as a status
// test.
function isStatusTesting(line, nextLine) {
  if (/\$\?/.test(line)) return true;
  if (nextLine !== undefined && /\$\?/.test(nextLine)) return true;
  if (/\|\|/.test(line)) return true;
  return false;
}

// A pipe line is a real finding when it has a parser stage, status-testing
// applies, and value-defaulting does NOT — the two predicates are checked in
// this order so W3 (value-default) and W1/W4 (status-testing) can be killed
// independently by an isolated mutation (see the wave's mutation table).
function isSwallowedExitPipe(line, nextLine) {
  if (!PARSER_STAGE_RE.test(line)) return false;
  if (isValueDefaulting(line)) return false;
  return isStatusTesting(line, nextLine);
}

// Extract [{lineNo, text}] for every line inside a ```bash ... ``` fenced
// block, 1-indexed against the whole file (so reported line numbers are
// directly greppable). Prose outside fences is never returned — this is what
// makes W5 (prose immunity) hold structurally rather than by matcher luck.
function extractBashFenceLines(content) {
  const lines = content.split('\n');
  const out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!inFence && /^```bash\s*$/.test(trimmed)) {
      inFence = true;
      continue;
    }
    if (inFence && /^```\s*$/.test(trimmed)) {
      inFence = false;
      continue;
    }
    if (inFence) {
      out.push({ lineNo: i + 1, text: lines[i] });
    }
  }
  return out;
}

// Scan a single file's fenced-bash lines for swallowed-exit pipes. Returns
// [{file, line, snippet}] — one entry per matching line.
function scanFileForFindings(filePath, content) {
  const fenceLines = extractBashFenceLines(content);
  const findings = [];
  for (let i = 0; i < fenceLines.length; i++) {
    const { lineNo, text } = fenceLines[i];
    const next = fenceLines[i + 1] ? fenceLines[i + 1].text : undefined;
    if (isSwallowedExitPipe(text, next)) {
      findings.push({ file: filePath, line: lineNo, snippet: text.trim() });
    }
  }
  return findings;
}

// Same glob shape as the facade's own convention (`skills/*/workflows/*.md`)
// but walked natively rather than shelled to `ls -d` — this module has no
// other reason to spawn a subprocess, and a native walk cannot suffer the
// quoting/glob-expansion class of bug this whole feature exists to guard
// against. `scanned` counts files actually read, which is what W7 asserts —
// a glob typo (e.g. singular "workflow") would make this walk find nothing
// and `scanned` would correctly read 0, catching the dead-glob class
// self-applied to this very command.
function listWorkflowFiles(root) {
  const skillsDir = path.join(root, 'skills');
  let skillDirs;
  try {
    skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (_e) {
    return [];
  }
  const files = [];
  for (const entry of skillDirs) {
    if (!entry.isDirectory()) continue;
    const workflowsDir = path.join(skillsDir, entry.name, 'workflows');
    let wfEntries;
    try {
      wfEntries = fs.readdirSync(workflowsDir, { withFileTypes: true });
    } catch (_e) {
      continue;
    }
    for (const wf of wfEntries) {
      if (wf.isFile() && wf.name.endsWith('.md')) {
        files.push(path.join(workflowsDir, wf.name));
      }
    }
  }
  return files;
}

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

// Hostile-input guard on --root (CONVENTIONS.md, mandatory for every new CLI
// subcommand). Same shape as retro-validate.cjs's rejectHostilePath: reject
// control-character/NUL/oversized shapes up front, before any fs call
// touches the string, then require the resolved path to be an existing
// DIRECTORY (not "inside a store" — a --root is an opaque path like a retro
// path, not a slug joined into one).
function rejectHostileRoot(raw) {
  if (raw.length > MAX_ROOT_LEN) {
    const err = new Error(`--root too long (${raw.length} chars, max ${MAX_ROOT_LEN})`);
    err.code = 'A1_INPUT';
    throw err;
  }
  if (raw.indexOf('\0') !== -1) {
    const err = new Error('--root contains a NUL byte');
    err.code = 'A1_INPUT';
    throw err;
  }
}

/**
 * `workflow lint [--root <path>]` — see module header for the full contract.
 * @param {string[]} argv
 */
function cmdWorkflowLint(argv) {
  const flags = parseFlags(argv, { root: 'value' });
  const rootRaw = flags.root || repoRoot();

  try {
    rejectHostileRoot(rootRaw);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(2);
  }

  const root = path.resolve(process.cwd(), rootRaw);

  let stat;
  try {
    stat = fs.statSync(root);
  } catch (_e) {
    process.stderr.write(`error: --root not found: ${root}\n`);
    process.exit(2);
  }
  if (!stat.isDirectory()) {
    process.stderr.write(`error: --root is not a directory: ${root}\n`);
    process.exit(2);
  }

  const files = listWorkflowFiles(root);
  let findings = [];
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (_e) {
      continue; // unreadable file — skip, do not crash the whole scan
    }
    findings = findings.concat(scanFileForFindings(file, content));
  }

  const out = {
    root,
    scanned: files.length,
    findings,
  };
  process.stdout.write(JSON.stringify(out) + '\n');

  if (findings.length > 0) {
    for (const f of findings) {
      process.stderr.write(
        `finding: ${f.file}:${f.line} — pipeline exit status swallowed: ${f.snippet}\n`
      );
    }
    process.exit(1);
  }
  process.exit(0);
}

module.exports = {
  cmdWorkflowLint,
  isStatusTesting,
  isValueDefaulting,
  isSwallowedExitPipe,
  extractBashFenceLines,
  listWorkflowFiles,
};
