'use strict';
// ux-studio handoff check (spec 024, FR-013, FR-014). Pure evaluation of a run folder: returns the
// list of blockers (one reason each); an empty list means handoff is allowed. It never writes.
//
// Fail closed. The ONLY status source is gate-record.json (never run.md). Every finding and every
// font failure is judged on its own, because `accept` does not recompute `status`.

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const RECORD_FILE = 'gate-record.json';
const WIDTHS = [1280, 390];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RESULT_REL = path.join('result', 'result.html');
const MAX_NAME = 120;

function safe(value, max = MAX_NAME) {
  return String(value ?? '').replace(/[\x00-\x1f]+/g, ' ').slice(0, max);
}

function readRecord(runDir) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(path.join(runDir, RECORD_FILE), 'utf8')); } catch (_) { return { blockers: [`no readable ${RECORD_FILE}: run the gate first`] }; }
  const shaped = rec && rec.gate_id === 'ux-studio-gate' && Array.isArray(rec.findings)
    && rec.font_check && Array.isArray(rec.font_check.failures);
  return shaped ? { rec } : { blockers: [`${RECORD_FILE} is not a ux-studio-gate record`] };
}

function inside(base, file) {
  const rel = path.relative(base, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Target must be the exported result inside realpath(run-dir), unchanged and not newer than the record. */
function checkTarget(runDir, rec, recFile) {
  if (typeof rec.target !== 'string' || rec.target === '') return ['gate record names no target'];
  let real;
  try { real = fs.realpathSync(rec.target); } catch (_) { return [`gate target is missing: ${safe(path.basename(rec.target))}`]; }
  if (!inside(runDir, real)) return ['gate target lies outside the run folder'];
  if (real !== path.join(runDir, RESULT_REL)) return [`gate target is not ${RESULT_REL.replace(path.sep, '/')}`];
  const out = [];
  const tStat = fs.statSync(real);
  const created = Date.parse(rec.created);
  if (!Number.isFinite(created)) out.push('gate record has no valid created time');
  if (fs.statSync(recFile).mtimeMs < tStat.mtimeMs || (Number.isFinite(created) && created < tStat.mtimeMs)) out.push('gate record is older than the result file: run the gate again');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex');
  if (typeof rec.target_sha256 !== 'string' || rec.target_sha256 !== sha) out.push('result file differs from the gated version (target_sha256 mismatch): run the gate again');
  return out;
}

function checkItem(label, state, reason) {
  if (state === 'accepted') return reason && String(reason).trim() ? [] : [`${label} is accepted without a reason`];
  if (state === 'open') return [`open: ${label}`];
  return [`${label} has unknown state "${safe(state, 30)}"`];
}

function checkFindings(rec) {
  return rec.findings.flatMap((f) => (f && f.severity === 'advisory' ? [] : checkItem(
    `finding ${safe(f && f.id)} (${safe(f && f.rule)} @ ${safe(f && f.location)})`, f && f.state, f && f.reason)));
}

function checkFonts(rec) {
  const fc = rec.font_check;
  const out = rec.font_check.failures.flatMap((x) => checkItem(`font failure ${safe(x && x.font)} (${safe(x && x.reason)})`, x && x.state, x && x.reason_text));
  if (fc.status === 'fail' && fc.failures.length === 0) out.push('font check failed without a listed failure');
  if (fc.status !== 'pass' && fc.status !== 'fail') out.push('font check has no valid status');
  return out;
}

function checkStatus(rec) {
  if (rec.status === 'error') return [`gate status is error${rec.cause ? `: ${safe(rec.cause, 200)}` : ''}`];
  return rec.status === 'pass' || rec.status === 'findings' ? [] : [`gate status "${safe(rec.status, 30)}" is not valid`];
}

function boardNames(runDir) {
  let names;
  try { names = fs.readdirSync(path.join(runDir, 'boards')); } catch (_) { return []; }
  return names.filter((n) => /^[A-Za-z0-9._-]+\.html$/.test(n)).map((n) => n.slice(0, -5)).sort();
}

function isPng(file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size <= PNG_MAGIC.length) return false;
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(PNG_MAGIC.length); fs.readSync(fd, buf, 0, buf.length, 0); return buf.equals(PNG_MAGIC); } finally { fs.closeSync(fd); }
  } catch (_) { return false; }
}

/** Evidence is file presence only: it holds (and blocks) whether or not playwright-cli is installed. */
function checkScreenshots(runDir) {
  const subjects = [...boardNames(runDir).map((n) => `boards/${n}.html`), RESULT_REL.replace(path.sep, '/')];
  return subjects.flatMap((rel) => {
    const base = path.basename(rel, '.html');
    return WIDTHS.filter((w) => !isPng(path.join(runDir, 'screenshots', `${base}-${w}.png`)))
      .map((w) => `missing screenshot screenshots/${base}-${w}.png (evidence for ${rel})`);
  });
}

function advisoryNotes(rec) {
  return rec.findings.filter((f) => f && f.severity === 'advisory').map((f) => `advisory (informational): ${safe(f.id)} ${safe(f.rule)}`);
}

/** @returns {{blockers: string[], notes: string[]}} */
function checkHandoff(runDir) {
  const shots = checkScreenshots(runDir);
  const { rec, blockers } = readRecord(runDir);
  if (!rec) return { blockers: [...blockers, ...shots], notes: [] };
  const recFile = path.join(runDir, RECORD_FILE);
  return {
    blockers: [...checkStatus(rec), ...checkTarget(runDir, rec, recFile), ...checkFindings(rec), ...checkFonts(rec), ...shots],
    notes: advisoryNotes(rec),
  };
}

module.exports = { checkHandoff };
