'use strict';

// ---------------------------------------------------------------------------
// xprov-delta — delta plan review (spec 016 FR-030, wave 9).
//
// After a PASSED plan review, a PLAN.md that changed again is not reviewed in full. The gate sends the frontmatter and title, the Goal,
// the Success Criteria and the sections that changed; the sections that did not change are named, not sent. A change that only touches
// whitespace at line edges sends nothing (heading text, words and fenced or frontmatter lines are compared byte-exact; Samuel W9-1): load-check and the gate carry the earlier pass to the new sha.
//
// The earlier text is a1's own copy `a1-plan.md` in the run dir of the pass (written by normalize with the pass marker, bound by its
// sha256 to the pass). No copy, or a copy that does not hash to the pass sha: no delta, a full review.
//
//   analyze(oldText, newText)               -> { cosmetic, changed: [heading], removed: [heading], delta: string|null }
//   cosmeticCarry(index, gate, text, sha, root) -> the pass entry that covers a cosmetic change, or null
//   deltaBase(index, gate, text, sha, root)     -> { text, sha256, baseSha, changed, removed } for a substantive change, or null
//   DELTA_MARKER_FILE   a1-delta.json: the gate's note that THIS run saw the delta (sent_plan_sha256 -> plan_sha256)
//   PLAN_COPY_FILE      a1-plan.md
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const RR = require('./xprov-runrecord.cjs');

const { PLAN_COPY_FILE, DELTA_MARKER_FILE } = RR;
const CONTEXT_HEADINGS = Object.freeze([/^goal\b/i, /^success criteria\b/i]);
const HEADING_RE = /^## +(.*)$/;
const FENCE_RE = /^ {0,3}(```|~~~)/;
const MAX_PLAN_BYTES = 2 * 1024 * 1024;

/** { preamble: string, sections: [{ heading, body }] } — level-2 headings outside code fences start a section. */
function split(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  const pre = [];
  let cur = null;
  let fenced = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) fenced = !fenced;
    const m = !fenced && HEADING_RE.exec(line);
    if (m) { cur = { heading: m[1].trim(), lines: [] }; sections.push(cur); continue; }
    (cur === null ? pre : cur.lines).push(line);
  }
  return { preamble: pre.join('\n'), sections: sections.map((s) => ({ heading: s.heading, body: s.lines.join('\n') })) };
}

/**
 * Lines of `text` in comparison form (Samuel W9-1): outside code fences and the YAML frontmatter only leading and trailing whitespace of a line
 * is normalised and blank lines are dropped; inside a fence or the frontmatter every line is kept byte-exact (indentation can change meaning).
 * Words inside a line are never touched, so a renamed or swapped heading, a changed word or changed indentation inside a fence all differ.
 */
function normLines(text, frontmatter) {
  const lines = String(text).split('\n');
  const out = [];
  let fenced = false;
  let front = frontmatter && lines[0] !== undefined && lines[0].trimEnd() === '---';
  lines.forEach((line, i) => {
    if (front) { out.push(line); if (i > 0 && line.trimEnd() === '---') front = false; return; }
    if (FENCE_RE.test(line)) { fenced = !fenced; out.push(line.trim()); return; }
    if (fenced) { out.push(line); return; }
    const t = line.trim();
    if (t !== '') out.push(t);
  });
  return out.join('\n');
}
const squash = (t) => normLines(t, false);

const isContext = (heading) => CONTEXT_HEADINGS.some((re) => re.test(heading));

/** The whole document in comparison form, heading text included: equal only for documents that differ in line-edge whitespace and blank lines. */
function canonical(text) {
  const s = split(text);
  return [normLines(s.preamble, true), ...s.sections.map((x) => `## ${x.heading.trim()}\n${normLines(x.body, false)}`)].join('\n');
}

const deltaText = (heading, body) => `## ${heading}\n${body.replace(/^\n+|\n+$/g, '')}\n`;

function build(next, changed, removed, kept) {
  const intro = [
    '<!-- DELTA REVIEW: the sections below changed since the last approved review of this plan; the other sections were approved before and are not repeated. -->',
    kept.length ? `<!-- Not repeated (approved unchanged): ${kept.map((h) => C.oneLine(C.clip(h, 80))).join(' | ')} -->` : '<!-- Not repeated: none -->',
    removed.length ? `<!-- Removed since the approved review: ${removed.map((h) => C.oneLine(C.clip(h, 80))).join(' | ')} -->` : '<!-- Removed: none -->',
  ].join('\n');
  const ctx = next.sections.filter((s) => isContext(s.heading) && !changed.includes(s.heading));
  const parts = [next.preamble.replace(/^\n+|\n+$/g, ''), intro, ...ctx.map((s) => deltaText(s.heading, s.body)), ...next.sections.filter((s) => changed.includes(s.heading)).map((s) => deltaText(s.heading, s.body))];
  return `${parts.filter((p) => p !== '').join('\n\n')}\n`;
}

function analyze(oldText, newText) {
  if (canonical(oldText) === canonical(newText)) return Object.freeze({ cosmetic: true, changed: [], removed: [], delta: null });
  const a = split(oldText);
  const b = split(newText);
  const oldBy = new Map(a.sections.map((s) => [s.heading, squash(s.body)]));
  const newHeads = new Set(b.sections.map((s) => s.heading));
  const pre = normLines(a.preamble, true) !== normLines(b.preamble, true);
  const changed = b.sections.filter((s) => !oldBy.has(s.heading) || oldBy.get(s.heading) !== squash(s.body)).map((s) => s.heading);
  const removed = a.sections.filter((s) => !newHeads.has(s.heading)).map((s) => s.heading);
  const kept = b.sections.filter((s) => !changed.includes(s.heading) && !isContext(s.heading)).map((s) => s.heading);
  // no unchanged section to leave out: nothing to save, the plan goes in full
  const delta = kept.length === 0 ? null : build(b, changed, removed, kept);
  return Object.freeze({ cosmetic: false, changed, removed, delta, preambleChanged: pre });
}

/** A pass entry's stored plan text, verified to be the text the pass approved, or null. */
function passCopy(entry, root) {
  if (!entry || entry.verdict !== X.VERDICTS.PASS || entry.waived === true || typeof entry.result_path !== 'string' || typeof entry.plan_sha256 !== 'string') return null;
  if (!RR.planPassValid(entry.result_path, entry.plan_sha256, root)) return null;
  const buf = C.readNoFollow(path.join(path.dirname(path.resolve(entry.result_path)), PLAN_COPY_FILE), MAX_PLAN_BYTES);
  return buf && C.sha256(buf) === entry.plan_sha256 ? buf.toString('utf8') : null;
}

function newestFirst(index, gate) {
  return index.filter((e) => e.gate === gate && e.verdict === X.VERDICTS.PASS).sort((x, y) => String(y.ts || '').localeCompare(String(x.ts || '')));
}

function cosmeticCarry(index, gate, text, planSha, root) {
  for (const e of newestFirst(index, gate)) {
    if (e.plan_sha256 === planSha) continue;
    const old = passCopy(e, root);
    if (old !== null && analyze(old, text).cosmetic) return e;
  }
  return null;
}

function deltaBase(index, gate, text, planSha, root) {
  for (const e of newestFirst(index, gate)) {
    if (e.plan_sha256 === planSha) continue;
    const old = passCopy(e, root);
    if (old === null) continue;
    const a = analyze(old, text);
    return a.delta === null ? null : Object.freeze({ text: a.delta, sha256: C.sha256(Buffer.from(a.delta, 'utf8')), baseSha: e.plan_sha256, changed: a.changed, removed: a.removed });
  }
  return null;
}

/** The gate's view of a plan review target: { kind: 'cosmetic', entry } | { kind: 'delta', file, dir, text, sha256, baseSha, changed, removed } | null. */
function prepare(ctx) {
  const index = C.readIndex(ctx.indexPath);
  const buf = C.readNoFollow(ctx.planPath, MAX_PLAN_BYTES);
  if (index === null || !buf) return null;
  const text = buf.toString('utf8');
  const planSha = C.sha256(buf);
  const carry = cosmeticCarry(index, X.GATE_IDS.PLAN_REVIEW, text, planSha, ctx.root);
  if (carry) return Object.freeze({ kind: 'cosmetic', entry: carry, planSha });
  const d = deltaBase(index, X.GATE_IDS.PLAN_REVIEW, text, planSha, ctx.root);
  if (!d) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-xprov-delta-'));
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'PLAN.md');
  fs.writeFileSync(file, d.text, { mode: 0o600 });
  return Object.freeze({ kind: 'delta', file, dir, planSha, ...d });
}

const cleanup = (dl) => { if (dl && dl.dir) fs.rmSync(dl.dir, { recursive: true, force: true }); };

/** a1's marker in the run dir: the runner hashed the delta, the pass stands for the full PLAN.md. */
const stamp = (resultPath, dl, root) => RR.writeDeltaMarker(resultPath, { plan_sha256: dl.planSha, sent_plan_sha256: dl.sha256, base_plan_sha256: dl.baseSha, changed: dl.changed, removed: dl.removed }, root);

/** The gate result of a cosmetic change: the earlier pass carries, no run, nothing sent. */
const passResult = (base, dl) => Object.freeze({ ...base, verdict: X.VERDICTS.PASS, step: 'delta', reason: null, reason_detail: 'cosmetic_plan_change', delta: Object.freeze({ kind: 'cosmetic', carried_from: dl.entry.plan_sha256 }), next: null });

module.exports = { prepare, cleanup, stamp, passResult, PLAN_COPY_FILE, DELTA_MARKER_FILE, analyze, canonical, split, cosmeticCarry, deltaBase, passCopy };
