'use strict';

// ---------------------------------------------------------------------------
// postmortem-fields — validator for the postmortem keys `found_by` and
// `should_have_caught` (spec 018-pipeline-metrics, FR-001..FR-004).
//
// A value passes four checks in this order, the first miss rejects it:
//   1. charset  ^[A-Za-z0-9:._-]+$   (no line break, space, quote, slash: the value
//      lands on one YAML frontmatter line, so this closes injection at the source)
//   2. length   <= MAX_VALUE_LEN
//   3. fixed set (found_by: user, post-merge-ci, production, unknown;
//                 should_have_caught: none, unknown)
//   4. registered gate ID (gates-registry.md) or `reviewer:<agent>` where <agent> is a
//      file name in <repo>/agents/*.md. The agent is compared by SET MEMBERSHIP against
//      readdir; the value is never joined into a path.
//
// Old files keep whatever they hold: classifyPostmortem() validates only what a file
// carries, and a file with neither key is `legacy`, not an error. No module-global
// cache: the registry and the agent list are read once per call.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./io-frontmatter.cjs');
const { parseRegistryIds, expandRangeIds, isRegisteredId } = require('./gate-ids.cjs');

const FIELD_FOUND_BY = 'found_by';
const FIELD_SHOULD = 'should_have_caught';
const FOUND_BY_FIXED = Object.freeze(['user', 'post-merge-ci', 'production', 'unknown']);
const SHOULD_FIXED = Object.freeze(['none', 'unknown']);
const CHARSET_RE = /^[A-Za-z0-9:._-]+$/;
const REVIEWER_PREFIX = 'reviewer:';
const MAX_VALUE_LEN = 100;
const DEFAULT_REGISTRY = path.join(__dirname, '..', 'gates-registry.md');
const DEFAULT_AGENTS_DIR = path.join(__dirname, '..', '..', 'agents');

const FIXED_BY_FIELD = Object.freeze({
  [FIELD_FOUND_BY]: FOUND_BY_FIXED,
  [FIELD_SHOULD]: SHOULD_FIXED,
});

function agentNames(agentsDir) {
  try {
    return new Set(fs.readdirSync(agentsDir).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)));
  } catch (_e) {
    return new Set();
  }
}

function registryIds(registryPath) {
  try {
    return expandRangeIds(parseRegistryIds(fs.readFileSync(registryPath, 'utf8')));
  } catch (_e) {
    return expandRangeIds([]);
  }
}

function reject(field, value, why) {
  return { ok: false, reason: `${field} ${JSON.stringify(String(value).slice(0, 60))}: ${why}` };
}

/**
 * @param {string} field - 'found_by' | 'should_have_caught'
 * @param {string} value
 * @param {{registryPath?: string, agentsDir?: string}} [ctx]
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function validateFieldValue(field, value, ctx) {
  const fixed = FIXED_BY_FIELD[field];
  if (!fixed) return reject(field, '', 'not a postmortem field');
  if (typeof value !== 'string' || !CHARSET_RE.test(value)) {
    return reject(field, value, 'only letters, digits and ":._-" are allowed');
  }
  if (value.length > MAX_VALUE_LEN) return reject(field, value, `longer than ${MAX_VALUE_LEN} characters`);
  if (fixed.includes(value)) return { ok: true };
  const c = ctx || {};
  if (value.startsWith(REVIEWER_PREFIX)) {
    const agent = value.slice(REVIEWER_PREFIX.length);
    if (agentNames(c.agentsDir || DEFAULT_AGENTS_DIR).has(agent)) return { ok: true };
    return reject(field, value, 'no agents/<agent>.md with that name');
  }
  if (isRegisteredId(value, registryIds(c.registryPath || DEFAULT_REGISTRY))) return { ok: true };
  return reject(field, value, `not in {${fixed.join(', ')}}, not a registered gate ID, not reviewer:<agent>`);
}

function scalarOf(v) {
  return Array.isArray(v) ? v.join(',') : v;
}

/**
 * @param {object} fm - parsed frontmatter
 * @param {{registryPath?: string, agentsDir?: string}} [ctx]
 * @returns {{kind: 'legacy'|'valid'|'invalid', reason?: string}}
 */
function classifyPostmortem(fm, ctx) {
  const has = (k) => fm && Object.prototype.hasOwnProperty.call(fm, k);
  const present = [FIELD_FOUND_BY, FIELD_SHOULD].filter(has);
  if (present.length === 0) return { kind: 'legacy' };
  if (present.length === 1) {
    const missing = present[0] === FIELD_FOUND_BY ? FIELD_SHOULD : FIELD_FOUND_BY;
    return { kind: 'invalid', reason: `${missing} is missing (a file carries both fields or neither)` };
  }
  for (const field of present) {
    const verdict = validateFieldValue(field, scalarOf(fm[field]), ctx);
    if (!verdict.ok) return { kind: 'invalid', reason: verdict.reason };
  }
  return { kind: 'valid' };
}

/** Reads and classifies one file. Throws on an unreadable file or broken frontmatter. */
function classifyPostmortemFile(file, ctx) {
  const { fm } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  return classifyPostmortem(fm, ctx);
}

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_UNREADABLE = 2;

/**
 * CLI body of `fix validate-postmortem`: one line per file, worst exit code wins
 * (2 unreadable > 1 invalid > 0 legacy/valid).
 * @param {string[]} files
 * @returns {{lines: string[], code: number}}
 */
function validateFiles(files, ctx) {
  const results = files.map((file) => {
    try {
      const v = classifyPostmortemFile(file, ctx);
      const code = v.kind === 'invalid' ? EXIT_INVALID : EXIT_OK;
      return { code, line: `${file}: ${v.kind}${v.reason ? ` ${v.reason}` : ''}` };
    } catch (e) {
      return { code: EXIT_UNREADABLE, line: `${file}: unreadable ${String(e.message).split('\n')[0]}` };
    }
  });
  return { lines: results.map((r) => r.line), code: Math.max(EXIT_OK, ...results.map((r) => r.code)) };
}

module.exports = {
  validateFiles,
  FOUND_BY_FIXED,
  SHOULD_FIXED,
  validateFieldValue,
  classifyPostmortem,
  classifyPostmortemFile,
};
