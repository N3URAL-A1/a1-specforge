'use strict';

// Reporter support of `verify run` (spec 017 FR-012): pick the runner kind of a
// command, inject the machine-readable reporter flags only where the runner
// supports them, and parse the report into counts. A runner without a parsable
// reporter yields `null` (the verdict then rests on the exit code alone).
//
//   vitest / jest  JSON file  (numPassedTests, numFailedTests, ...)
//   pytest         junit XML file
//   node:test      TAP on stdout (summary lines `# pass N`)

const path = require('path');

const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_FAILED_IDS = 100;
const REPORTER_KINDS = Object.freeze(['vitest', 'jest', 'pytest', 'node-test', 'none']);

/** Runner kind of an argv array, by its tokens. Never throws. */
function detectKind(argv) {
  const names = argv.map((t) => path.basename(String(t)).replace(/\.(c|m)?js$/, ''));
  if (names.includes('vitest')) return 'vitest';
  if (names.includes('jest')) return 'jest';
  if (names.includes('pytest')) return 'pytest';
  const py = names[0] && /^python3?(\.\d+)?$/.test(names[0]) && names[1] === '-m' && names[2] === 'pytest';
  if (py) return 'pytest';
  if (names[0] === 'node' && argv.includes('--test')) return 'node-test';
  return 'none';
}

/** Runner kind of an npm-style script text (`vitest run`, `jest --ci`, ...). */
function detectScriptKind(script) {
  if (/\bvitest\b/.test(script)) return 'vitest';
  if (/\bjest\b/.test(script)) return 'jest';
  if (/\bpytest\b/.test(script)) return 'pytest';
  if (/\bnode\b[^&|;]*--test\b/.test(script)) return 'node-test';
  return 'none';
}

function flagsFor(kind, outFile) {
  if (kind === 'vitest') return ['--reporter=json', `--outputFile=${outFile}`];
  if (kind === 'jest') return ['--json', `--outputFile=${outFile}`];
  if (kind === 'pytest') return [`--junitxml=${outFile}`];
  return [];
}

/**
 * New argv with the reporter flags added. `viaScript` (npm/pnpm/yarn run <name>)
 * passes them after `--` (yarn: directly); node:test is only injectable on a
 * direct `node --test` argv, a script relies on the TAP default of non-TTY runs.
 */
function injectFlags(kind, argv, outFile, viaScript) {
  if (kind === 'node-test') {
    if (viaScript) return argv.slice();
    const at = argv.indexOf('--test');
    return [...argv.slice(0, at + 1), '--test-reporter=tap', ...argv.slice(at + 1)];
  }
  const flags = flagsFor(kind, outFile);
  if (flags.length === 0) return argv.slice();
  if (viaScript) return [...argv, ...(argv[0] === 'yarn' ? [] : ['--']), ...flags];
  return [...argv, ...flags];
}

function relId(name, root) {
  const n = String(name);
  const rel = root && n.startsWith(`${root}${path.sep}`) ? n.slice(root.length + 1) : n;
  return rel.length > 300 ? rel.slice(0, 300) : rel;
}

function num(v) {
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

function parseJestJson(text, root) {
  let j;
  try { j = JSON.parse(text); } catch (_e) { return null; }
  if (!j || typeof j !== 'object' || !Number.isInteger(j.numPassedTests) || !Number.isInteger(j.numFailedTests)) return null;
  const ids = [];
  for (const file of Array.isArray(j.testResults) ? j.testResults : []) {
    const failedCases = (Array.isArray(file.assertionResults) ? file.assertionResults : []).filter((a) => a && a.status === 'failed');
    for (const a of failedCases) ids.push(relId(`${relId(file.name || '', root)} > ${a.fullName || a.title || '?'}`, root));
    if (failedCases.length === 0 && file.status === 'failed') ids.push(relId(file.name || '?', root));
  }
  const failed = j.numFailedTests > 0 ? j.numFailedTests : num(j.numFailedTestSuites);
  return { passed: j.numPassedTests, failed, skipped: num(j.numPendingTests) + num(j.numTodoTests), failedIds: ids.slice(0, MAX_FAILED_IDS) };
}

function xmlAttr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null;
}

function parseJunit(text) {
  const suites = [...text.matchAll(/<testsuite\s([^>]*)>/g)];
  if (suites.length === 0) return null;
  let tests = 0; let failed = 0; let skipped = 0;
  for (const s of suites) {
    tests += num(parseInt(xmlAttr(s[1], 'tests'), 10));
    failed += num(parseInt(xmlAttr(s[1], 'failures'), 10)) + num(parseInt(xmlAttr(s[1], 'errors'), 10));
    skipped += num(parseInt(xmlAttr(s[1], 'skipped'), 10));
  }
  const ids = [];
  for (const c of text.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    if (c[2] && /<(failure|error)\b/.test(c[2])) ids.push(`${xmlAttr(c[1], 'classname') || ''}::${xmlAttr(c[1], 'name') || '?'}`);
  }
  return { passed: Math.max(0, tests - failed - skipped), failed, skipped, failedIds: ids.slice(0, MAX_FAILED_IDS) };
}

function parseTap(text) {
  const sum = (key) => {
    const m = new RegExp(`^# ${key} (\\d+)\\s*$`, 'm').exec(text);
    return m ? parseInt(m[1], 10) : null;
  };
  const tests = sum('tests');
  if (tests === null) return null;
  const ids = [];
  for (const m of text.matchAll(/^\s*not ok \d+ - (.+?)\s*$/gm)) {
    if (!/#\s*(SKIP|TODO)\b/i.test(m[1]) && !ids.includes(m[1])) ids.push(m[1].slice(0, 300));
  }
  return { passed: sum('pass') || 0, failed: sum('fail') || 0, skipped: (sum('skipped') || 0) + (sum('todo') || 0), failedIds: ids.slice(0, MAX_FAILED_IDS) };
}

/** Counts of a finished run, or null. `reportText`/`stdoutText` may be null. */
function parseReport(kind, reportText, stdoutText, root) {
  if (kind === 'vitest' || kind === 'jest') return reportText ? parseJestJson(reportText, root) : null;
  if (kind === 'pytest') return reportText ? parseJunit(reportText) : null;
  if (kind === 'node-test') return stdoutText ? parseTap(stdoutText) : null;
  return null;
}

module.exports = {
  MAX_REPORT_BYTES, MAX_FAILED_IDS, REPORTER_KINDS,
  detectKind, detectScriptKind, injectFlags, parseReport, parseJestJson, parseJunit, parseTap,
};
