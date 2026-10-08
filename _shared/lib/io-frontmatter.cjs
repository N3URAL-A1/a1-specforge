'use strict';

// The flat frontmatter parser/serializer (specs, bugs, analyses, …) and its
// markdown read/write helpers. Split out of io.cjs, which re-exports it.

const fs = require('fs');
const { joinFoldedScalar, splitInlineArray, serializeScalar, parseScalarToken } = require('./io-scalar.cjs');
const { assertVaultWriteContained, writeViaTmp } = require('./fs-safe.cjs');

// ---------- frontmatter parser (line-based, minimal) ----------
// Supports: scalars (quoted/unquoted), null, [], block lists with "- ".
// Does NOT support nested objects.

function parseFrontmatter(content) {
  // Normalize CRLF first. Without this, a file saved on Windows starts with
  // '---\r\n', fails the startsWith check, and is reported as HAVING NO
  // FRONTMATTER — every field silently undefined, which reads downstream as
  // "undated entry" rather than as a parse error. Found 2026-09-11 while
  // testing the postmortem type filter; no CRLF file exists in the current
  // corpus, so this closes a latent blind spot rather than a live defect.
  // Normalizing the WHOLE document (body included) is deliberate, not a side
  // effect: writeMdAtomic and serializeFrontmatter hardcode '\n' and have never
  // been able to emit CRLF, so a CRLF file was already rewritten with LF on any
  // round-trip — before this fix it was rewritten WITH A SECOND, EMPTY
  // frontmatter wrapped around the original (measured in review 2026-09-11).
  // Nothing in the repo depends on byte-preserving round-trips through here:
  // `.raw` has no consumer outside this parser, and the two places that do need
  // exact bytes (fix.cjs's agents.lock hashing, constitution.cjs's archive copy)
  // read with fs.readFileSync and bypass this parser entirely.
  if (content.indexOf('\r\n') !== -1) content = content.replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) {
    return { fm: {}, body: content, raw: '' };
  }
  const end = content.indexOf('\n---', 4);
  if (end === -1) {
    throw new Error('frontmatter has no closing "---"');
  }
  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, '');
  const fm = {};
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.startsWith('#')) {
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const valueRaw = m[2];
    if (valueRaw === '' || valueRaw === undefined) {
      const list = [];
      let j = i + 1;
      while (
        j < lines.length &&
        (lines[j].startsWith('  - ') || lines[j].startsWith('- '))
      ) {
        let item = lines[j].replace(/^\s*-\s*/, '');
        ({ value: item, index: j } = joinFoldedScalar(lines, j, item));
        if (
          (item.startsWith('"') && item.endsWith('"')) ||
          (item.startsWith("'") && item.endsWith("'"))
        ) {
          try {
            if (item.startsWith('"')) item = JSON.parse(item);
            else item = item.slice(1, -1);
          } catch (_e) {
            item = item.slice(1, -1);
          }
        }
        list.push(item);
        j++;
      }
      if (list.length > 0) {
        fm[key] = list;
        i = j;
        continue;
      }
      fm[key] = null;
      i++;
      continue;
    }
    if (valueRaw === '[]') {
      fm[key] = [];
      i++;
      continue;
    }
    // Non-empty inline array. This parser has its own value handling (it does
    // not route through parseScalarToken), so the `[]`-only gap existed here
    // too and had to be closed in both places — see the note in
    // parseScalarToken for the two measured consequences.
    if (valueRaw.startsWith('[') && valueRaw.endsWith(']')
        && valueRaw.indexOf('[', 1) === -1) {
      const inner = valueRaw.slice(1, -1).trim();
      fm[key] = inner === ''
        ? []
        : splitInlineArray(inner).map((x) => parseScalarToken(x));
      i++;
      continue;
    }
    if (valueRaw === 'null') {
      fm[key] = null;
      i++;
      continue;
    }
    let v = valueRaw;
    ({ value: v, index: i } = joinFoldedScalar(lines, i, v));
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    fm[key] = v;
    i++;
  }
  return { fm, body, raw };
}

// Stable key order for spec and bug frontmatter — known keys first, rest alphabetic.
const SPEC_KEY_ORDER = [
  'id',
  'project',
  'feature_slug',
  'title',
  'status',
  'created',
  'phase_history',
  'wave_plan_path',
  'verify_failures',
];

const BUG_KEY_ORDER = [
  'type',
  'project',
  'bug_slug',
  'title',
  'status',
  'severity',
  'reported_at',
  'reporter',
  'affected_repos',
  'related_deploy',
  'duplicate_of',
  'phase_history',
  'recommended_code_agent',
  'fix_commit',
  'verify_result',
  'tags',
];

const ANALYSIS_KEY_ORDER = [
  'type',
  'project',
  'focus',
  'title',
  'status',
  'created_at',
  'analyzed_path',
  'phase_history',
  'discover',
  'agents_dispatched',
  'findings',
  'findings_count',
  'suggested_next',
  'tags',
];

const CONSTITUTION_KEY_ORDER = [
  'type',
  'project',
  'title',
  'status',
  'version',
  'created_at',
  'last_written_at',
  'phase_history',
  'tags',
];

const RECONCILE_KEY_ORDER = [
  'type',
  'project',
  'title',
  'status',
  'scope_mode',
  'created_at',
  'date',
  'phase_history',
  'scope_targets',
  'parsed_targets',
  'stale_candidates',
  'parse_warnings',
  'agents_dispatched',
  'probe_notes',
  'drifts',
  'drifts_count',
  'in_sync_count',
  'skipped_projects',
  'suggested_next',
  'tags',
];

function detectKeyOrder(fm) {
  if (fm.type === 'bug-report') return BUG_KEY_ORDER;
  if (fm.type === 'project-analysis') return ANALYSIS_KEY_ORDER;
  if (fm.type === 'constitution') return CONSTITUTION_KEY_ORDER;
  if (fm.type === 'drift-report') return RECONCILE_KEY_ORDER;
  return SPEC_KEY_ORDER;
}

function serializeFrontmatter(fm) {
  const knownOrder = detectKeyOrder(fm);
  const keys = Object.keys(fm);
  const ordered = [];
  for (const k of knownOrder) if (keys.includes(k)) ordered.push(k);
  for (const k of keys.sort()) if (!ordered.includes(k)) ordered.push(k);

  const lines = [];
  for (const k of ordered) {
    const v = fm[k];
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) {
          lines.push(`  - ${serializeScalar(item)}`);
        }
      }
    } else {
      lines.push(`${k}: ${serializeScalar(v)}`);
    }
  }
  return lines.join('\n');
}

function readMd(p) {
  const content = fs.readFileSync(p, 'utf8');
  const parsed = parseFrontmatter(content);
  return { content, ...parsed };
}

function writeMdAtomic(p, fm, body) {
  const fmStr = serializeFrontmatter(fm);
  const out = `---\n${fmStr}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
  assertVaultWriteContained(p);
  writeViaTmp(p, out);
}

module.exports = { parseFrontmatter, detectKeyOrder, serializeFrontmatter, readMd, writeMdAtomic };
