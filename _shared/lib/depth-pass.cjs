'use strict';

/**
 * depth-pass — deterministic check of the `## Depth Pass` section of a plan.
 *
 * Every a1 planner must answer four questions and rewrite its brief before it
 * decomposes work (rules and format: `_shared/depth-pass.md`, the single owner
 * of the prompt and of the two word lists below). This module is the gate: it
 * checks that the section exists, carries the five sub-headings, that no answer
 * is a placeholder, and that answer 4 names an oracle outside planner and user.
 * Content quality beyond that is a1-adam-auditor's judgement.
 *
 * Checks (all blocking):
 *   1. section              a `## Depth Pass` heading exists outside fenced code
 *   2. subheadings          all five sub-headings exist inside the section
 *   3. placeholders         no answer is empty, `TBD` or a lone `<...>` token
 *   4. oracle               answer 4 holds at least one token outside the lists
 *
 * Exit codes: 0 = PASS, 1 = finding, 2 = usage/read error.
 */

const fs = require('fs');
const { parseFlags } = require('./io.cjs');

const USAGE = 'usage: a1-tools plan depth-check --plan <path/to/PLAN.md>\n';
const SECTION_NAME = 'depth pass';
const ORACLE_KEY = 'external evidence of correctness';

/** Required sub-headings, in order. Matching is case-insensitive, after the
 * leading number and its `.`/`)` are stripped. */
const SUBHEADINGS = Object.freeze([
  'What a top professional would do',
  'Rawest material',
  'Methods and tools',
  'External evidence of correctness',
  'Rewritten brief',
]);

/** Mirrors the "Self-reference rule" lists of `_shared/depth-pass.md`; the
 * fixture suite proves the equality (the doc is the owner). */
const ORACLE_DENYLIST = Object.freeze([
  'user', 'me', 'you', 'robert', 'claude', 'planner', 'agent', 'i', 'we',
]);

const ORACLE_STOPWORDS = Object.freeze([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'it',
  'its', 'this', 'that', 'these', 'those', 'will', 'would', 'can', 'could', 'should', 'shall',
  'may', 'might', 'must', 'be', 'is', 'are', 'was', 'were', 'been', 'being', 'do', 'does', 'did',
  'have', 'has', 'had', 'not', 'no', 'then', 'also', 'just', 'only', 'check', 'checks', 'checked',
  'checking', 'verify', 'verifies', 'verified', 'verifying', 'review', 'reviews', 'reviewed',
  'reviewing', 'confirm', 'confirms', 'confirmed', 'look', 'looks', 'looked', 'see', 'sees',
  'make', 'makes', 'sure', 'ok', 'fine', 'correct', 'right', 'plus', 'together', 'both', 'myself',
  'ourselves', 'yourself', 'him', 'her', 'them', 'us', 'our', 'my', 'your', 'their', 'own',
  'manually', 'hand', 'later', 'afterwards', 'again', 'carefully', 'result', 'results', 'works',
  'work',
]);

const SELF_REFERENTIAL = new Set([...ORACLE_DENYLIST, ...ORACLE_STOPWORDS]);

/** Strip a UTF-8 BOM and normalise CRLF/CR so the rest sees plain LF text. */
function normalise(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/**
 * Split text into lines tagged with whether each sits inside a fenced code
 * block (``` or ~~~, CommonMark rules: the closing fence uses the same
 * character and is at least as long). Fence lines themselves count as fenced.
 */
function tagFences(text) {
  const tagged = [];
  let open = null; // { ch, len } while inside a fence
  for (const line of text.split('\n')) {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (open === null) {
      if (m) {
        open = { ch: m[1][0], len: m[1].length };
        tagged.push({ line, fenced: true });
      } else {
        tagged.push({ line, fenced: false });
      }
    } else {
      const closes = m && m[1][0] === open.ch && m[1].length >= open.len && line.trim() === m[1];
      tagged.push({ line, fenced: true });
      if (closes) open = null;
    }
  }
  return tagged;
}

/** Lowercase heading text with the leading number (`1`, `1.`, `1)`) removed. */
function headingKey(rawText) {
  return rawText
    .trim()
    .replace(/^\d+\s*[.)]?\s+/, '')
    .replace(/\s+#*\s*$/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Find the first `## Depth Pass` heading outside fences and return its body
 * lines (up to the next `#` or `##` heading outside fences) plus how many
 * further `## Depth Pass` headings were seen.
 */
function findSection(tagged) {
  let start = -1;
  let duplicates = 0;
  tagged.forEach(({ line, fenced }, i) => {
    const m = !fenced && line.match(/^##\s+(.+?)\s*$/);
    if (m && headingKey(m[1]) === SECTION_NAME) {
      if (start === -1) start = i;
      else duplicates += 1;
    }
  });
  if (start === -1) return { found: false, lines: [], duplicates: 0 };
  let end = tagged.length;
  for (let i = start + 1; i < tagged.length; i++) {
    if (!tagged[i].fenced && /^#{1,2}\s/.test(tagged[i].line)) {
      end = i;
      break;
    }
  }
  return { found: true, lines: tagged.slice(start + 1, end), duplicates };
}

/** Collect `###` sub-sections: first occurrence of each name wins. */
function collectSubsections(sectionLines) {
  const subs = new Map();
  let current = null;
  for (const { line, fenced } of sectionLines) {
    const m = !fenced && line.match(/^###\s+(.+?)\s*$/);
    if (m) {
      const key = headingKey(m[1]);
      current = subs.has(key) ? null : key;
      if (current !== null) subs.set(current, []);
      continue;
    }
    if (current !== null) subs.get(current).push(line);
  }
  return new Map([...subs].map(([k, v]) => [k, v.join('\n').trim()]));
}

/** Empty, `TBD`, or solely a `<...>` template token (a leading bullet is ignored). */
function isPlaceholder(body) {
  const b = body.trim().replace(/^[-*+]\s+/, '').trim();
  if (b === '') return true;
  if (/^tbd\.?$/i.test(b)) return true;
  return /^<[^<>]*>$/.test(b);
}

/** Lowercase, split on every non-letter/digit, drop tokens of length 1. */
function tokenise(body) {
  return body
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => [...t].length > 1);
}

/** True when every token is a denylist or stopword entry (nothing real left). */
function isSelfReferential(body) {
  return tokenise(body).every((t) => SELF_REFERENTIAL.has(t));
}

const finding = (check, heading, msg) => ({ check, heading, msg });

function checkSubsections(subs) {
  const findings = [];
  for (const name of SUBHEADINGS) {
    const key = name.toLowerCase();
    if (!subs.has(key)) {
      findings.push(finding('subheadings', name, `missing sub-heading: ${name}`));
    } else if (isPlaceholder(subs.get(key))) {
      findings.push(finding('placeholders', name, `empty or placeholder answer under: ${name}`));
    } else if (key === ORACLE_KEY && isSelfReferential(subs.get(key))) {
      findings.push(
        finding('oracle', name, `self-referential: answer names only the user, the planner or filler words: ${name}`)
      );
    }
  }
  return findings;
}

const CHECK_NAMES = ['section', 'subheadings', 'placeholders', 'oracle'];

function buildReport(findings, duplicates) {
  const checks = CHECK_NAMES.map((name) => {
    const hits = findings.filter((f) => f.check === name);
    return { check: name, status: hits.length === 0 ? 'pass' : 'fail', findings: hits.map((f) => f.msg) };
  });
  const offending = [...new Set(findings.map((f) => f.heading))];
  const notes = duplicates > 0 ? [`duplicate ## Depth Pass headings: ${duplicates}; the first section was checked`] : [];
  return {
    verdict: findings.length === 0 ? 'pass' : 'fail',
    checks,
    offending,
    duplicate_sections: duplicates,
    notes,
  };
}

/**
 * Pure check of plan text. Returns `{verdict, checks, offending, duplicate_sections, notes}`;
 * `verdict` is 'pass' or 'fail'. Never throws on text content.
 */
function checkDepthPass(text) {
  const section = findSection(tagFences(normalise(String(text))));
  if (!section.found) {
    return buildReport([finding('section', '## Depth Pass', 'missing section: no "## Depth Pass" heading outside fenced code')], 0);
  }
  const findings = checkSubsections(collectSubsections(section.lines));
  return buildReport(findings, section.duplicates);
}

function usageError(msg) {
  process.stderr.write(`${msg ? `plan depth-check: ${msg}\n` : ''}${USAGE}`);
  process.exit(2);
}

function readPlan(planArg) {
  try {
    return fs.readFileSync(planArg, 'utf8');
  } catch (e) {
    return usageError(`cannot read plan ${planArg}: ${e.code || e.message}`);
  }
}

/** CLI entry: `plan depth-check --plan <path>`. Owns stdout and the exit code. */
function cmdPlanDepthCheck(args) {
  const flags = parseFlags(args, { plan: 'value' });
  if (flags._.length > 0) usageError(`unexpected argument: ${flags._[0]}`);
  if (!flags.plan) usageError('missing --plan');
  const report = { plan: flags.plan, ...checkDepthPass(readPlan(flags.plan)) };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.verdict === 'pass' ? 0 : 1);
}

module.exports = { ORACLE_DENYLIST, ORACLE_STOPWORDS, checkDepthPass, tokenise, cmdPlanDepthCheck };
