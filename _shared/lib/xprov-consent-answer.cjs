'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-answer — what the owner answered, read from a PostToolUse payload (spec 016 FR-003, FR-004; wave 2).
//
// Evidence (plan R-1 pre-check, 2026-10-14): a real owner-answered AskUserQuestion call has
//   toolUseResult = { questions, answers, annotations }   answers = { "<question text>": "<chosen label>" }
//   tool_result content = 'Your questions have been answered: "<question>"="<label>". You can now continue with these answers in mind.'
// What a PostToolUse hook receives under `tool_response` is undocumented; wave 4 captures one live payload pair first
// (R-1). This reader therefore accepts BOTH shapes, and is strict in the safe direction only:
//   - an `answers` object (tool_response.answers, or the same object inside a JSON string response);
//   - the text form, anchored at both ends: it must start with the prefix + '"<question>"="' and end with the tail,
//     so a free-text label that merely CONTAINS a quoted pair cannot pose as another answer.
// Anything else is "no answer found" (null): the caller records nothing. Reading never throws.
//
// A model-supplied `answers` field in the PreToolUse INPUT is not read here: wave 4's hook rejects it before the call.
// Pure functions.
// ---------------------------------------------------------------------------

const C = require('./xprov-common.cjs');

const TEXT_PREFIX = 'Your questions have been answered: ';
const TEXT_TAIL = '". You can now continue with these answers in mind.';
const MAX_RESPONSE_CHARS = 200000;

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The response as text, or null: a string, `{ content: string }` or `{ content: [{ text }] }` / `[{ text }]`. */
function responseText(tr) {
  if (typeof tr === 'string') return tr;
  const parts = Array.isArray(tr) ? tr : (tr && (typeof tr.content === 'string' ? [{ text: tr.content }] : Array.isArray(tr.content) ? tr.content : null));
  if (!Array.isArray(parts)) return null;
  const texts = parts.map((p) => (typeof p === 'string' ? p : p && typeof p.text === 'string' ? p.text : null));
  return texts.every((t) => t !== null) && texts.length > 0 ? texts.join('\n') : null;
}

function answersFrom(tr) {
  if (C.isPlainObject(tr) && C.isPlainObject(tr.answers)) return tr.answers;
  if (typeof tr === 'string' && tr.length <= MAX_RESPONSE_CHARS && tr.trimStart().startsWith('{')) {
    try { const o = JSON.parse(tr); if (C.isPlainObject(o) && C.isPlainObject(o.answers)) return o.answers; } catch (_e) { /* not JSON: the text form is tried next */ }
  }
  return null;
}

function labelFromText(text, question) {
  if (typeof text !== 'string' || text.length > MAX_RESPONSE_CHARS) return null;
  const head = `${TEXT_PREFIX}"${question}"="`;
  if (!text.startsWith(head) || !text.endsWith(TEXT_TAIL) || text.length < head.length + TEXT_TAIL.length) return null;
  return text.slice(head.length, text.length - TEXT_TAIL.length);
}

/**
 * The raw answer label to `question` in a PostToolUse payload: { found: true, label } or { found: false }.
 * `label` is the chosen label verbatim (free text for "Other"); the caller maps it to a decision.
 */
function answerFromPayload(payload, question) {
  if (!C.isPlainObject(payload) || typeof question !== 'string' || question === '') return { found: false };
  const tr = payload.tool_response;
  const map = answersFrom(tr);
  if (map !== null) return hasOwn(map, question) && typeof map[question] === 'string' ? { found: true, label: map[question] } : { found: false };
  const label = labelFromText(responseText(tr), question);
  return label === null ? { found: false } : { found: true, label };
}

module.exports = { TEXT_PREFIX, TEXT_TAIL, answerFromPayload, responseText };
