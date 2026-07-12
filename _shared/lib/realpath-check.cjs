'use strict';

const fs = require('fs');
const path = require('path');
const { parseFlags } = require('./io.cjs');

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

module.exports = { cmdRealpathCheckRun };
