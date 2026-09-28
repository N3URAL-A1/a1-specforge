'use strict';

// ---------------------------------------------------------------------------
// intent-redact — the secret filter and fence escaping of `intent complete`
// (spec 011, FR-031; extracted from intent-result after the security review
// of waves 4–5). Pure functions, no file access.
//
// Order, over ALL text read (before any tail or cut):
//   1. exact values: every known secret (all device secrets of devices.json,
//      revoked ones included) is replaced — MAJOR-C: no pattern matches a
//      bare 64-hex device secret, and a child can print devices.json. Hex in
//      any letter case, with up to 4 whitespace/`:._-` characters between
//      any two digits (pairs, line breaks); base64 and base64url with or
//      without `=`, with up to 4 whitespace characters between any two
//      (re-review MINOR-2). Encoded dumps (a hex dump of devices.json) are
//      beyond a filter: the sandbox's read-deny on ~/.a1-intents covers them.
//   2. a PEM BEGIN marker after the last END marker has no END: everything
//      from the first such BEGIN to the end of the text goes (MINOR-C). This
//      also keeps pattern 9 linear: afterwards every BEGIN has an END ahead,
//      and a BEGIN whose label is longer than 40 characters is no marker for
//      step 2 or pattern 9 alike (both bound the label the same way).
//   3. the REDACTION_PATTERNS, in order.
//   4. a PEM END marker with no BEGIN before it: everything from the start of
//      the text to the last such END goes (MINOR-C), whether or not the read
//      was cut.
// A read that skipped the head of a huge output also drops its partial first
// line. Steps 2 and 4 look only at markers the patterns left behind, so a
// complete BEGIN…END block is pattern 9's job alone.
//
// The note body (tails, capped backtick runs, fitSections) lives here too,
// so intent-result stays within the module size limit.
//
// Fences (MAJOR-B): a run of more than MAX_BACKTICK_RUN backticks in the
// output is shortened to MAX_BACKTICK_RUN, so a fence is at most
// MAX_BACKTICK_RUN + 1 long and the fixed part of the note stays far below
// the note budget whatever the child printed.
// ---------------------------------------------------------------------------

const { REDACTION_PATTERNS } = require('./intent-constants.cjs');

const REDACTED = '[REDACTED]';
const PEM_BEGIN_RE = /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/g;
const PEM_END_RE = /-----END [A-Z ]{0,40}PRIVATE KEY-----/g;
const SECRET_HEX_RE = /^[0-9a-f]{64}$/;
const HEX_GAP = '[\\s:._-]{0,4}'; //  between two hex digits: pairs, dumps, line breaks
const B64_GAP = '\\s{0,4}'; //         base64 holds - and _ itself: whitespace only
const escapeRe = (c) => c.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
const MAX_BACKTICK_RUN = 15;
const LONG_BACKTICK_RUN_RE = new RegExp(`\`{${MAX_BACKTICK_RUN + 1},}`, 'g');

const hexSource = (h) => h.split('').join(HEX_GAP);
const b64Source = (s) => `${s.replace(/=+$/, '').split('').map(escapeRe).join(B64_GAP)}(?:${B64_GAP}=){0,2}`;

// Every spelling of the device secrets that could appear in output, as
// RegExps (sources; redact clones them per call). Each is linear: a gap
// class never holds the next literal digit, so no position backtracks.
// `values` (FR-049): spawn-env values beyond the fixed names of FR-021
// (intent-run spawnEnvSecrets), redacted as exact literals.
function knownSecrets(devices, values = []) {
  const hex = Object.values(devices || {}).map((e) => e && e.secret_hex).filter((h) => typeof h === 'string' && SECRET_HEX_RE.test(h));
  const spellings = hex.flatMap((h) => {
    const bytes = Buffer.from(h, 'hex');
    return [[hexSource(h), 'gi'], [b64Source(bytes.toString('base64')), 'g'], [b64Source(bytes.toString('base64url')), 'g']];
  }).concat(values.filter((v) => typeof v === 'string' && v.length > 0).map((v) => [v.split('').map(escapeRe).join(''), 'g']));
  const unique = [...new Map(spellings.map(([src, flags]) => [`${flags}/${src}`, [src, flags]])).values()];
  return Object.freeze(unique.map(([src, flags]) => new RegExp(src, flags)));
}

const replaceExact = (text, secrets) => secrets.reduce((t, re) => t.replace(new RegExp(re.source, re.flags), REDACTED), text);

const matchIndexes = (text, re) => [...text.matchAll(new RegExp(re.source, re.flags))];

// Step 2: BEGIN markers after the last END marker.
function redactOpenPem(text) {
  const ends = matchIndexes(text, PEM_END_RE);
  const from = ends.length === 0 ? 0 : ends[ends.length - 1].index;
  const begin = text.slice(from).search(new RegExp(PEM_BEGIN_RE.source));
  return begin === -1 ? text : text.slice(0, from + begin) + REDACTED;
}

// Step 4: END markers before the first remaining BEGIN marker.
function redactOrphanPemEnd(text) {
  const begin = text.search(new RegExp(PEM_BEGIN_RE.source));
  const orphans = matchIndexes(begin === -1 ? text : text.slice(0, begin), PEM_END_RE);
  if (orphans.length === 0) return text;
  const last = orphans[orphans.length - 1];
  return REDACTED + text.slice(last.index + last[0].length);
}

// Each pattern is cloned per call: the exported instances are shared state.
function redact(text, secrets = []) {
  const opened = redactOpenPem(replaceExact(String(text), secrets));
  const patterned = REDACTION_PATTERNS.reduce((t, p) => t.replace(new RegExp(p.source, p.flags), REDACTED), opened);
  return redactOrphanPemEnd(patterned);
}

// { text, cut } from readOutput -> filtered text, before any tail is taken.
function filterOutput({ text, cut }, secrets = []) {
  const t = String(text).replace(/\r\n/g, '\n');
  const nl = t.indexOf('\n');
  return redact(cut ? (nl === -1 ? '' : t.slice(nl + 1)) : t, secrets);
}

const capBackticks = (line) => line.replace(LONG_BACKTICK_RUN_RE, '`'.repeat(MAX_BACKTICK_RUN));

// A fence longer than every backtick run in the (capped) section.
function fenceFor(lines) {
  const runs = lines.join('\n').match(/`{3,}/g) || [];
  return '`'.repeat(runs.reduce((n, r) => Math.max(n, r.length + 1), 3));
}

// ---------- note body: tails and the byte budget ----------
const byteLen = (s) => Buffer.byteLength(s, 'utf8');

function tailLines(text, n) {
  const lines = text === '' ? [] : text.split('\n');
  return (lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines).slice(-n);
}

const sectionBytes = (lines) => (lines.length === 0 ? 0 : byteLen(lines.join('\n')) + 1);

// Keeps the tail of a line within maxBytes (a split UTF-8 char is dropped).
function cutHead(line, maxBytes) {
  const b = Buffer.from(line, 'utf8');
  return b.length <= maxBytes ? line : b.subarray(b.length - maxBytes).toString('utf8').replace(/^\uFFFD+/, '');
}

// The larger section loses its oldest line first; a last line still too long
// loses its head. Every step shrinks a section, and the loop stops when both
// are empty (MAJOR-B), so it ends for every budget, even a negative one.
function fitSections(sections, budget) {
  let [summary, stderr] = sections;
  let cut = false;
  const over = () => sectionBytes(summary) + sectionBytes(stderr) - budget;
  while (over() > 0 && summary.length + stderr.length > 0) {
    cut = true;
    const pickSummary = sectionBytes(summary) >= sectionBytes(stderr);
    const lines = pickSummary ? summary : stderr;
    const room = sectionBytes(lines) - over() - 1;
    const next = lines.length > 1 ? lines.slice(1) : room > 0 ? [cutHead(lines[0], room)] : [];
    if (pickSummary) summary = next;
    else stderr = next;
  }
  return Object.freeze({ summary, stderr, cut });
}

// { text, cut } -> { lines, cut }: filtered, tail taken, backtick runs capped
// (a capped run counts as a cut: the note is then marked truncated).
function prepareOutput(read, secrets, n) {
  const tail = tailLines(filterOutput(read, secrets), n);
  const lines = tail.map(capBackticks);
  return Object.freeze({ lines, cut: read.cut || lines.some((l, i) => l !== tail[i]) });
}

module.exports = {
  REDACTED, MAX_BACKTICK_RUN, knownSecrets, redact, filterOutput, capBackticks, fenceFor, tailLines, prepareOutput, fitSections,
};
