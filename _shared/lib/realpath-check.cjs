'use strict';

const fs = require('fs');
const path = require('path');
const { parseFlags } = require('./io.cjs');
const { emitExit } = require('./emit-exit.cjs');

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
//        - sql : SQL SHAPES, not English words (see SQL_SHAPES / SQL_CALLS):
//                statements (INSERT INTO x, UPDATE x SET, SELECT … FROM, DDL),
//                strings opening with an uppercase verb, UPPERCASE clause tokens
//                on continuation lines (WHERE col =, VALUES (, RETURNING …) and
//                driver calls (.query(, sql`, $queryRaw, PostgREST .from(..).insert(,
//                .rpc(). Pure comment lines and trailing `// …` comments are
//                stripped in code files; *.md is excluded; every added
//                non-comment line of a .sql/.psql/.pgsql file counts. Shapes are
//                matched over an 8-line window of contiguous added lines (one hunk).
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
//   - A silent miss IS possible. The scan sees only ADDED lines (`--unified=0`).
//     Residual risk: (1) a lowercase continuation line with no clause token
//     (e.g. `  due_at < $1` or `  and x = 1`) added inside an existing query;
//     (2) a hunk that starts mid-literal, so the opening `select`/`sql\`` line
//     is not part of the added lines. Firestore `docRef.update(` is not SQL and
//     is deliberately not flagged.
//   - Regressions against the old keyword gate (62f642c), all lowercase SQL:
//     (a) an interpolated identifier breaks the shape: `insert into ${table}`,
//         f"select {cols} from {table}";
//     (b) concatenation: "update " + t + " set a = 1";
//     (c) a lowercase SELECT whose FROM is more than 8 lines below;
//     (d) fixed here, residual stays: a trailing `// …` is stripped only when no
//         quote precedes it and never in .py/.sh (division). A real comment after
//         a quoted string is therefore kept (conservative: false positive only).
//   - Prose can still false-positive when it mimics a shape, e.g. a string
//     "Select x from the list", "INSERT INTO t" or SQL text inside a test
//     assertion (conservative: a spurious evidence requirement).
//   - Category<->section matching is by heading text only; it does not verify
//     the command actually exercises that category's surface.
//   - "command line" / "output block" detection is heuristic (markers, not a
//     shell parser). Evidence is a human+CLI contract, not a sandbox.
// ---------------------------------------------------------------------------

// SQL shape matching (ported from the measured reference design, bug
// 2026-11-08-realpath-sql-prose-false-positive).
const SQL_FILE = /\.(sql|psql|pgsql)$/i;
// `//` and `#` trailing comments are not recognised in these (division, shell, string-heavy).
const NO_TRAIL_STRIP_FILE = /\.(py|sh|bash|zsh)$/i;
const COMMENT_LINE = /^\s*(\/\/|#(?!!)|\/\*|\*(?!\s*FROM)|\*\/|--)/; // pure comment lines (code files)
const TRAIL_COMMENT_AT = /(^|\s)\/\/\s/; // `code; // prose`
const QUOTE_CHAR = /['"`]/;
// ReDoS rule: every quantifier is bounded or its neighbours are disjoint. The
// scanner runs on added lines of arbitrary diffs (minified bundles, lockfiles).
const SQL_SHAPES = [
  /\bINSERT\s+INTO\s+["\w.]+/i,
  /\bUPDATE\s+["\w.]+\s+SET\b/i,
  /\bDELETE\s+FROM\s+["\w.]+/i,
  /\bSELECT\s+[^;{}]{1,400}?\bFROM\s+["\w.(]/i,
  /\b(CREATE|ALTER|DROP)\s+(OR\s+REPLACE\s+)?(TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|POLICY|INDEX|UNIQUE\s+INDEX|TRIGGER|SCHEMA|TYPE|SEQUENCE)\b/i,
  /\bTRUNCATE\s+(TABLE\s+)?["\w.]+/i,
  /[`'"]\s*(SELECT|WITH|INSERT|UPDATE|DELETE)\s/,                 // string opens with UPPERCASE keyword
  /[`'"]\s*select\s+(\d|\*|[\w.]+\s*\()/i,                           // `select 1`, `select count(`, `select fn(`
];
// UPPERCASE clause tokens, for continuation lines of a multi-line query.
const SQL_CLAUSES = [
  /\b(FROM|JOIN)\s+([\w"]+\.[\w"]+|unnest\s*\(|[\w"]+\s+[a-z]{1,3}\b\s*(WHERE|JOIN|ON|$|`))/,
  /\bWHERE\s+[\w."]+\s*(=|<|>|IN\b|IS\b|\()/,
  /\bDO\s+(UPDATE\s+SET|NOTHING)\b/,
  /\bORDER\s+BY\b/,
  /\bGROUP\s+BY\b/,
  /\b(AND|OR)\s+[\w.]+\s*(=|<>|<|>|IN\b|IS\b)/,
  /\b(AND|OR)\s+\(?\w+\(/,
  /\(\s*(NULL|\$\d+(::\w+)?)\s*,\s*(NULL|\$\d+|')/,
  /\b(VALUES\s*\(|RETURNING\b|ON\s+CONFLICT\b|WHERE\s+[\w."]+\s*(=|IN\b|IS\b))/,
];
const SQL_CALLS = [
  /\b(GRANT|REVOKE)\s+[\w,]+(?:\s+[\w,]+){0,20}?\s+ON\s/i,
  /\b\w+\.(insert|update|delete)\s*\(\s*\w+\s*\)\s*\.\s*(values|set|where|returning|onConflict\w*)\s*\(/,
  /\.select\s*\([^)]*\)\s*\.\s*from\s*\(\s*\w/,
  /\.execute\s*\(\s*[`'"]/,
  /\.query\s*\(/,
  /\bsql\s*`/, /\bsql\.(unsafe|raw)\s*\(/, /\$(queryRaw|executeRaw)(Unsafe)?\b/,
  /\b(knex|db|trx|tx)\.raw\s*\(/,
  /\.from\s*\(\s*[`'"][\w.]+[`'"]\s*\)\s*\.\s*(select|insert|upsert|update|delete)\s*\(/,
  /\.rpc\s*\(\s*[`'"]/,
  /\.(insert|upsert)\s*\(\s*[\[{]/,
  /\.update\s*\(\s*\{[\s\S]{0,400}?\}\s*\)\s*\.\s*(eq|neq|match|in|is|filter|gt|gte|lt|lte|like|ilike|or|select|where)\s*\(/,
  /\.delete\s*\(\s*\)\s*\.\s*(eq|neq|match|in|is|filter|gt|gte|lt|lte|like|ilike|or|where)\s*\(/,
  /\.where(In)?\s*\([^;]{0,300}?\)\s*\.\s*(update|delete|del)\s*\(/,
];
const PATTERNS = [...SQL_SHAPES, ...SQL_CLAUSES, ...SQL_CALLS];
function stripTrailingComment(file, line) {
  if (NO_TRAIL_STRIP_FILE.test(file)) return line;
  const at = line.search(TRAIL_COMMENT_AT);
  if (at < 0) return line;
  // A quote before the `//` means it may sit inside a string literal: keep the line.
  if (QUOTE_CHAR.test(line.slice(0, at))) return line;
  return line.slice(0, at);
}
function cleanLine(file, s) {
  if (/^\s*--/.test(s)) return null;
  if (SQL_FILE.test(file)) return s;
  if (COMMENT_LINE.test(s)) return null;
  return stripTrailingComment(file, s);
}
// hunk = array of added lines (same file, contiguous). True when any window of
// SQL_WINDOW lines starting at a non-comment line holds a SQL shape that starts
// on that line.
function hunkHits(file, lines) {
  const cleaned = lines.map((l) => cleanLine(file, l));
  if (SQL_FILE.test(file)) return cleaned.some((c) => c !== null && c.trim() !== '');
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === null) continue;
    const win = [];
    for (let j = i; j < Math.min(cleaned.length, i + SQL_WINDOW); j++) win.push(cleaned[j] === null ? '' : cleaned[j]);
    const text = win.join('\n');
    for (const p of PATTERNS) {
      const m = text.match(p);
      if (m && m.index < cleaned[i].length + 1) return true;
    }
  }
  return false;
}
const SQL_WINDOW = 8; // lines of one hunk examined together (multi-line literals)

const REALPATH_SIGNATURES = {
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

// Path of a `+++ ` header line: strips the trailing TAB git adds after paths
// with spaces, unquotes a C-quoted path and drops the `b/` prefix. null for /dev/null.
function headerPath(raw) {
  let p = raw.replace(/\t.*$/, '');
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    p = p.slice(1, -1).replace(/\\(?:([0-7]{3})|(.))/g, (m, oct, ch) => {
      if (oct) return String.fromCharCode(parseInt(oct, 8));
      return { t: '\t', n: '\n', r: '\r' }[ch] || ch;
    });
  }
  if (p === '/dev/null') return null;
  return p.replace(/^b\//, '');
}

// Scan a unified-diff for real-backend surfaces. Returns Set of category names.
// File headers count only between a `diff --git` line and the first `@@`; inside
// a hunk every `+` line is content (even `+++ b/x`). Added lines form a hunk
// (contiguous '+' lines of one file) so SQL shapes can span lines.
function scanDiffForSurfaces(diff) {
  const found = new Set();
  let currentFile = null;
  let inHeader = false;
  let hunk = [];
  const flush = () => {
    if (hunk.length && currentFile && !/\.md$/i.test(currentFile) && hunkHits(currentFile, hunk)) {
      found.add('sql');
    }
    hunk = [];
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      currentFile = null;
      inHeader = true;
      continue;
    }
    if (inHeader) {
      if (line.startsWith('+++ ')) currentFile = headerPath(line.slice(4));
      else if (line.startsWith('@@')) inHeader = false;
      continue;
    }
    if (!line.startsWith('+')) {
      flush(); // hunk header, context or removed line ends the contiguous run
      continue;
    }
    if (!currentFile || /\.md$/i.test(currentFile)) continue; // exclude markdown docs entirely
    const added = line.slice(1);
    hunk.push(added);

    if (REALPATH_SIGNATURES.rls.test(added)) found.add('rls');
    if (REALPATH_SIGNATURES.http.test(added)) {
      const urlMatch = added.match(REALPATH_URL);
      if (urlMatch && !REALPATH_LOCALHOST.test(urlMatch[1])) {
        found.add('http');
      }
    }
  }
  flush();
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

  const diffRes = runGit(['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', `${base}..HEAD`, '--unified=0'], projectDir);
  if (!diffRes.ok) {
    process.stderr.write(`error: git diff failed: ${diffRes.stderr.trim() || 'unknown'}\n`);
    process.exit(2);
  }

  const surfaces = scanDiffForSurfaces(diffRes.stdout);

  if (surfaces.size === 0) {
    const out = { status: 'PASS', surfaces: [], message: 'no real-path surfaces in diff' };
    return emitExit(0, flags.json ? JSON.stringify(out, null, 2) + '\n' : 'realpath-check: PASS — no real-path surfaces in diff\n', '');
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
    return emitExit(1, flags.json ? JSON.stringify(out, null, 2) + '\n'
      : `realpath-check: FAIL — evidence file missing: ${evidencePath}\n  detected surfaces needing proof: ${detected.join(', ')}\n`, '');
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
  let text;
  if (flags.json) {
    text = JSON.stringify(out, null, 2) + '\n';
  } else if (status === 'PASS') {
    text = `realpath-check: PASS — real-backend evidence found for: ${detected.join(', ')}\n`;
  } else {
    text = `realpath-check: FAIL — ${lacking.length} surface category(ies) lack proof\n`
      + lacking.map((cat) => `  - ${cat}: ${reasons[cat]}\n`).join('');
  }
  emitExit(status === 'PASS' ? 0 : 1, text, '');
}

module.exports = { cmdRealpathCheckRun, scanDiffForSurfaces, hunkHits, cleanLine, SQL_PATTERNS: PATTERNS };
