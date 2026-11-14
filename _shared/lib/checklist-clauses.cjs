'use strict';

// ---------------------------------------------------------------------------
// checklist-clauses (spec 028, FR-013 / FR-014). Check 9 proves every FR id sits in exactly one wave;
// it cannot see that a clause of the FR text ("... and notify the owner") never reaches the plan.
// These helpers split spec FR / SC lines into clauses, test their content tokens against the plan text
// and count the spec's edge-case bullets. Pure string work on text check 9 already holds: no I/O.
// Warnings never change a check's result, severity, report status or exit code.
// ---------------------------------------------------------------------------

const { stripFences } = require('./check.cjs');

const MIN_CLAUSE_WORDS = 3;
const MIN_TOKEN_CHARS = 5;
const FR_LINE_RE = /^\s*[-*]\s+\*\*(FR-\d{3,}(?:-\d+)?)\*\*\s*[—–-]+\s*(.+?)\s*$/;
const SC_LINE_RE = /^\s*[-*]\s+\*\*(SC-\d{3,}(?:-\d+)?)\*\*\s*[—–-]+\s*(.+?)\s*$/;
const EDGE_HEADING_RE = /^##\s+edge cases\s*$/i;
const ANY_HEADING_RE = /^#{1,6}\s/;
const BULLET_RE = /^[-*]\s+\S/;
const CLAUSE_HINT = 'name the clause in the wave acceptance text or move it out of scope';
const EDGE_HINT = 'add an edge-case task or acceptance line to the plan';

/** @param {string} text @returns {string[]} the clauses of an FR text, split at ";" and the word " and " */
function splitClauses(text) {
  return String(text)
    .split(/;|\s+and\s+/i)
    .map((c) => c.trim().replace(/[.\s]+$/, ''))
    .filter((c) => c.length > 0);
}

/** @param {string} clause @returns {string[]} lower-case words of 5 or more characters, without duplicates */
function contentTokens(clause) {
  const words = clause.toLowerCase().match(/[a-z0-9À-ɏ_-]+/g) || [];
  return [...new Set(words.filter((w) => w.length >= MIN_TOKEN_CHARS))];
}

/** @returns {boolean} true when the clause is long enough, has a content token and carries none of them in haystack */
function clauseMissing(clause, haystackLower) {
  if (clause.split(/\s+/).length < MIN_CLAUSE_WORDS) return false;
  const tokens = contentTokens(clause);
  if (tokens.length === 0) return false;
  return tokens.every((t) => !haystackLower.includes(t));
}

/** @returns {{id: string, text: string}[]} spec lines `- **<prefix>-###** — text` in document order */
function specLines(specBody, lineRe) {
  const lines = [];
  for (const line of stripFences(specBody).split('\n')) {
    const m = line.match(lineRe);
    if (m) lines.push({ id: m[1], text: m[2] });
  }
  return lines;
}

/**
 * @param {string} specBody
 * @param {string} planBody
 * @param {{lines: string[]}[]} waveSections - from scanWaveSections(planBody).sections
 * @returns {Object[]} clause_not_carried warnings; an FR that sits in no wave yields none (check 9 fails it)
 */
function clauseWarnings(specBody, planBody, waveSections) {
  const warnings = [];
  const planLower = planBody.toLowerCase();
  for (const { id, text } of specLines(specBody, FR_LINE_RE)) {
    const idRe = new RegExp(`\\b${id}\\b`);
    const carrying = waveSections.filter((sec) => idRe.test(sec.lines.join('\n')));
    if (carrying.length === 0) continue;
    const waveLower = carrying.map((sec) => sec.lines.join('\n')).join('\n').toLowerCase();
    for (const clause of splitClauses(text)) {
      if (clauseMissing(clause, waveLower)) warnings.push({ reason: 'clause_not_carried', id, clause, hint: CLAUSE_HINT });
    }
  }
  for (const { id, text } of specLines(specBody, SC_LINE_RE)) {
    for (const clause of splitClauses(text)) {
      if (clauseMissing(clause, planLower)) warnings.push({ reason: 'clause_not_carried', id, clause, hint: CLAUSE_HINT });
    }
  }
  return warnings;
}

/** @param {string} specBody @returns {number} bullets directly under `## Edge Cases` (until the next heading) */
function edgeCaseCount(specBody) {
  let inSection = false;
  let n = 0;
  for (const line of stripFences(specBody).split('\n')) {
    if (EDGE_HEADING_RE.test(line)) { inSection = true; continue; }
    if (ANY_HEADING_RE.test(line)) { inSection = false; continue; }
    if (inSection && BULLET_RE.test(line)) n += 1;
  }
  return n;
}

/**
 * @returns {{warnings: Object[], edge_cases?: number}} the keys check 9 adds; `warnings` only when
 *   non-empty and `edge_cases` only when at least one bullet exists (Default D-2: the kritis golden pins
 *   the check-9 object byte for byte)
 */
function check9Extras(specBody, planBody, waveSections) {
  const warnings = clauseWarnings(specBody, planBody, waveSections);
  const edges = edgeCaseCount(specBody);
  if (edges >= 1 && !/edge/i.test(planBody)) warnings.push({ reason: 'edge_cases_unplanned', hint: EDGE_HINT });
  return {
    ...(edges >= 1 ? { edge_cases: edges } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

module.exports = { splitClauses, contentTokens, clauseWarnings, edgeCaseCount, check9Extras };
