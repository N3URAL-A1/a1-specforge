'use strict';

// ---------------------------------------------------------------------------
// test-fidelity — spec 017 FR-019. `a1-tools test-fidelity --diff-base <ref>
// [--project <dir>]` scans the test files added or modified between <ref> and
// HEAD. Exit 0 no findings / 1 findings (JSON on stdout: rule, file, line) /
// 2 usage, git failure, unreadable config, hostile input or timeout.
// Rules live in fidelity-rules.cjs; the tokenizer masks strings and comments.
// The exit code is set via process.exitCode so a large JSON report is never
// cut off by an early process.exit.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseFlags } = require('./io.cjs');
const { mask, lineIndex, lineOf } = require('./fidelity-tokenizer.cjs');
const { loadAliases, isTestFile, FidelityConfigError } = require('./fidelity-resolve.cjs');
const { FILE_RULES, REPO_RULES, DEFAULT_DB_WRAPPERS } = require('./fidelity-rules.cjs');
const D = require('./disposition-store.cjs');

const MAX_REF_LENGTH = 512;
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const GIT_TIMEOUT_MS = 20000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const SCAN_DEADLINE_MS = 30000;
const CONFIG_REL = path.join('.a1', 'fidelity.json');
const SNIPPET_MAX = 160;

class UsageError extends Error {}

function checkValue(name, value) {
  if (typeof value !== 'string' || value === '') throw new UsageError(`--${name} needs a value`);
  if (value.includes('\0')) throw new UsageError(`--${name} contains a NUL byte`);
  return value;
}

function parseArgs(args) {
  const flags = parseFlags(args, { 'diff-base': 'string', project: 'string' });
  if (flags._.length > 0) throw new UsageError(`unexpected argument: ${JSON.stringify(flags._[0]).slice(0, 80)}`);
  const base = checkValue('diff-base', flags['diff-base']);
  if (base.length > MAX_REF_LENGTH) throw new UsageError('--diff-base is too long');
  if (base.startsWith('-')) throw new UsageError('--diff-base must not start with "-"');
  const project = flags.project === undefined ? process.cwd() : checkValue('project', flags.project);
  return { base, project: path.resolve(process.cwd(), project) };
}

// ---------- config ----------

function stringList(cfg, key) {
  if (cfg[key] === undefined) return null;
  const v = cfg[key];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x !== '' && !x.includes('\0'))) {
    throw new FidelityConfigError(`${CONFIG_REL}: "${key}" must be an array of non-empty strings`);
  }
  return v;
}

function loadConfig(projectRoot) {
  const file = path.join(projectRoot, CONFIG_REL);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { dbWrappers: DEFAULT_DB_WRAPPERS, testGlobs: [] };
    throw new FidelityConfigError(`unreadable ${CONFIG_REL}: ${e.message}`);
  }
  let cfg;
  try { cfg = JSON.parse(text); } catch (e) { throw new FidelityConfigError(`malformed ${CONFIG_REL}: ${e.message}`); }
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) throw new FidelityConfigError(`${CONFIG_REL} must be a JSON object`);
  return { dbWrappers: stringList(cfg, 'db_wrappers') || DEFAULT_DB_WRAPPERS, testGlobs: stringList(cfg, 'test_globs') || [] };
}

// ---------- git ----------

function changedFiles(project, base) {
  let out;
  try {
    out = execFileSync('git', ['-C', project, 'diff', '--relative', '--name-only', '-z', '--diff-filter=ACMR', `${base}...HEAD`, '--'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER,
    });
  } catch (e) {
    const msg = (e.stderr && e.stderr.toString().trim().split('\n')[0]) || e.message;
    throw new UsageError(`git diff failed: ${msg}`.slice(0, 300));
  }
  const files = out.split('\0').filter((f) => f !== '');
  if (files.length > MAX_FILES) throw new UsageError(`too many changed files (${files.length} > ${MAX_FILES})`);
  return files;
}

// ---------- scan ----------

function readSource(projectRoot, rel) {
  const abs = path.join(projectRoot, rel);
  const st = fs.lstatSync(abs);
  if (!st.isFile()) return null; // symlink, directory, submodule: not scanned
  if (st.size > MAX_FILE_BYTES) throw new UsageError(`test file too large to scan: ${JSON.stringify(rel)}`);
  return fs.readFileSync(abs, 'utf8');
}

function snippet(src, starts, line) {
  const from = starts[line - 1];
  const to = line < starts.length ? starts[line] : src.length;
  return src.slice(from, to).trim().slice(0, SNIPPET_MAX);
}

const JS_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Language of the per-file rules by extension, or null when none applies (FR-022..024 are JS/TS and Python only). */
function langOf(rel) {
  if (rel.endsWith('.py')) return 'py';
  return JS_EXT.test(rel) ? 'js' : null;
}

function scanFile(ctx, rel, deadline) {
  if (Date.now() > deadline) throw new UsageError('scan timed out');
  let src;
  try { src = readSource(ctx.projectRoot, rel); } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`cannot read ${JSON.stringify(rel)}: ${e.message}`);
  }
  if (src === null) return [];
  const lang = langOf(rel);
  if (lang === null) return []; // bash and other suites matched by test_globs: only test-not-in-ci applies
  const { code, strings } = mask(src, lang);
  const starts = lineIndex(src);
  const t = { rel, lang, code, strings, starts, lineOf: (off) => lineOf(starts, off) };
  return FILE_RULES.flatMap((rule) => rule(t, ctx)).map((f) => ({ ...f, text: snippet(src, starts, f.line) }));
}

function compareFindings(a, b) {
  return a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule);
}

/** @returns {{findings: object[], scanned: number}} */
function scan(project, base) {
  const cfg = loadConfig(project);
  const files = changedFiles(project, base);
  const tests = files.filter((f) => isTestFile(f, cfg.testGlobs));
  const testSet = new Set(tests);
  const ctx = {
    projectRoot: project,
    aliases: loadAliases(project),
    dbWrappers: cfg.dbWrappers,
    changedSources: new Set(files.filter((f) => !testSet.has(f))),
    maxFileBytes: MAX_FILE_BYTES,
    changedFiles: files,
    testFiles: tests,
  };
  const deadline = Date.now() + SCAN_DEADLINE_MS;
  const perFile = tests.flatMap((rel) => scanFile(ctx, rel, deadline));
  const repo = REPO_RULES.flatMap((rule) => rule(ctx));
  const all = [...perFile, ...repo].sort(compareFindings).map((f) => ({ ...f, fingerprint: D.fingerprintOf(f.rule, f.file, f.text) }));
  // FR-025: only a committed `fidelity` disposition with this exact fingerprint clears a finding (an overturned one clears nothing).
  const cleared = D.clearedFingerprints(D.loadEntries(project), 'fidelity');
  const findings = all.filter((f) => !cleared.has(f.fingerprint));
  return { findings, scanned: tests.length, dispositioned: all.length - findings.length };
}

function fail2(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 2;
}

/** @param {string|undefined} sub @param {string[]} rest */
function cmdTestFidelity(sub, rest) {
  try {
    const { base, project } = parseArgs(sub === undefined ? rest : [sub, ...rest]);
    const { findings, scanned, dispositioned } = scan(project, base);
    process.stdout.write(`${JSON.stringify({ ok: findings.length === 0, base, scanned, count: findings.length, dispositioned, findings })}\n`);
    process.exitCode = findings.length === 0 ? 0 : 1;
  } catch (e) {
    if (e instanceof UsageError || e instanceof FidelityConfigError || e instanceof D.DispositionError) fail2(e.message);
    else fail2(`internal error: ${e && e.message ? e.message : String(e)}`);
  }
}

module.exports = { cmdTestFidelity, scan };
