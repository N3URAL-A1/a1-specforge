'use strict';

// ---------------------------------------------------------------------------
// xprov consent — `a1-tools xprov consent <question|ensure|record|revoke>` (spec 016 FR-002, FR-003, FR-005, FR-007, FR-008; wave 2).
//
//   question --kind consent|classification [--repo <toplevel>] [--ludwig-record <vault path>]
//       stdout: the canonical AskUserQuestion input ({ header, question, labels [No, Yes], options, hash }); exit 0.
//       kind classification needs --ludwig-record (ensure and record too): the path is part of the question text the owner reads.
//   ensure   --kind consent|classification [--repo <toplevel>] [--ludwig-record <vault path>]
//       stdout: the state of the repository's marker (none|pending|answered|expired|used) and whether to ask; exit 0 only when an answer
//       is ready to record. A second asker polls this instead of putting a second question.
//   record   --kind consent|classification [--repo <toplevel>] [--ludwig-record <vault path>]
//       writes the stores from a matching, unexpired, unused, bound owner answer; without one: nothing written, exit 1.
//   revoke   [--repo <toplevel>]
//       removes the repository's permit, denial, evidence and unused markers whatever channel wrote them; an unusable consent or
//       denial store is reported and left alone (exit 1, `reason: revoke_partial`), the permit goes anyway.
//   question|ensure --kind waiver (--phase <name> | --work-path <worktree>)   the xprov-Waiver question for the gate targets that are failed now
//   question|ensure --kind allowlist --scan <snap-basename>                    the xprov-Allowlist question for one scan's hits (masked)
//   waive (--phase <name> | --work-path <worktree>)    one waiver record per LISTED target (by owner-chat), against a matching owner yes
//   allowlist --scan <snap-basename>                    one hit approval per listed hit (hit-approvals.json, never the blob-approval store), against a matching owner yes
// Exit contract: 0 ok · 1 refused (stdout JSON names `reason`) · 2 usage error.
// The answer is NEVER an argument: it comes from the marker the plugin hook wrote from the real tool result.
// Tier 0 wording lives in help-xprov-consent.cjs. This module only parses arguments and prints.
// ---------------------------------------------------------------------------

const io = require('./io.cjs');
const xprov = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const RI = require('./xprov-repo-identity.cjs');
const Q = require('./xprov-consent-question.cjs');
const M = require('./xprov-consent-marker.cjs');
const R = require('./xprov-consent-record.cjs');
const L = require('./xprov-consent-ludwig.cjs');
const W = require('./xprov-consent-waive.cjs');
const A = require('./xprov-consent-allowlist.cjs');

const ECHO_MAX = 80;
const SCOPED = Object.freeze({ waiver: W, allowlist: A }); // kinds whose question is built from the phase / scan state (wave 3)
const RECORD_KINDS = Object.freeze(['consent', 'classification']);
const usage = (msg) => C.usageExit('consent', msg);
const shown = (v) => JSON.stringify(String(v).slice(0, ECHO_MAX));

const SCOPE_FLAGS = { phase: 'string', 'work-path': 'string', scan: 'string' };
const FLAGS = Object.freeze({
  question: { kind: 'string', repo: 'string', 'ludwig-record': 'string', ...SCOPE_FLAGS },
  ensure: { kind: 'string', repo: 'string', 'ludwig-record': 'string', ...SCOPE_FLAGS },
  record: { kind: 'string', repo: 'string', 'ludwig-record': 'string' },
  revoke: { repo: 'string' },
  waive: { repo: 'string', phase: 'string', 'work-path': 'string' },
  allowlist: { repo: 'string', scan: 'string' },
});

/** The text of a wrong phase / work-path / scan flag combination, or null. */
function scopeFlagProblem(sub, flags) {
  const kind = sub === 'waive' ? 'waiver' : (sub === 'allowlist' ? 'allowlist' : flags.kind);
  const has = (n) => flags[n] !== undefined;
  if (kind === 'waiver') return has('phase') === has('work-path') ? 'give exactly one of --phase <name> or --work-path <worktree>' : (has('scan') ? '--scan belongs to --kind allowlist' : null);
  if (kind === 'allowlist') return !has('scan') ? '--scan <snap-basename> is required' : (has('phase') || has('work-path') ? '--phase and --work-path belong to --kind waiver' : null);
  return has('phase') || has('work-path') || has('scan') ? '--phase, --work-path and --scan belong to --kind waiver|allowlist' : null;
}

/** { flags, root } or null after a usage error (already printed). */
function parse(sub, args) {
  const flags = io.parseFlags(args, FLAGS[sub]);
  if (flags._.length) return usage(`${sub}: unexpected argument ${shown(flags._[0])}`);
  for (const name of Object.keys(FLAGS[sub])) {
    if (name in flags && (typeof flags[name] !== 'string' || flags[name] === '')) return usage(`${sub}: --${name} needs a value`);
  }
  if (sub !== 'revoke' && sub !== 'waive' && sub !== 'allowlist') {
    if (flags.kind === undefined) return usage(`${sub}: --kind <${Q.kindNames().join('|')}> is required`);
    const allowed = sub === 'question' ? Q.kindNames() : (sub === 'ensure' ? [...RECORD_KINDS, ...Object.keys(SCOPED)] : RECORD_KINDS);
    if (Q.kindDef(flags.kind) === null || !allowed.includes(flags.kind)) return usage(`${sub}: unknown --kind ${shown(flags.kind)} (one of ${allowed.join(', ')})`);
  }
  let root;
  try {
    root = C.resolveRepoFlag(flags.repo);
    if (flags['ludwig-record'] !== undefined) L.validateArg(flags['ludwig-record']);
  } catch (e) {
    if (e && e.code === 'A1_INPUT') return usage(`${sub}: ${e.message}`);
    throw e;
  }
  const scopeProblem = scopeFlagProblem(sub, flags);
  if (scopeProblem) return usage(`${sub}: ${scopeProblem}`);
  if (sub !== 'revoke' && sub !== 'record' && sub !== 'waive' && sub !== 'allowlist' && flags.kind !== 'classification' && flags['ludwig-record'] !== undefined) return usage(`${sub}: --ludwig-record belongs to --kind classification (the question names the record the owner sees)`);
  if (sub !== 'revoke' && sub !== 'waive' && sub !== 'allowlist' && flags.kind === 'classification' && flags['ludwig-record'] === undefined) return usage(`${sub}: --kind classification needs --ludwig-record <vault path> (the a1-ludwig-legal record the question shows)`);
  return { flags, root };
}

function facts(root, ludwigRecord) {
  const key = C.commonDirOf(root);
  if (key === null) throw C.inputError(`${root} is not a git repository`, 'not_a_repository');
  const origin = RI.readOrigin(root);
  return { key, origin, ctx: Q.repoContext(root, origin, { ludwigRecord }) };
}

/** The built question of a waiver / allowlist kind ({ ok: true, key, question, ... }), or null after a refusal printed as JSON (exit 1). Throws typed input errors (exit 2). */
function scopedBuild(kind, a, sub) {
  const base = { root: a.root };
  const r = kind === 'waiver' ? W.buildFor({ ...base, phase: a.flags.phase, workPath: a.flags['work-path'] }) : A.buildFor({ ...base, scan: a.flags.scan });
  if (r.ok) return r;
  process.stderr.write(`consent ${sub}: ${r.detail}\n`);
  return C.emitJson({ ok: false, reason: r.reason, detail: r.detail }, xprov.EXIT_FAIL, false);
}

function cmdQuestion(args) {
  const a = parse('question', args);
  if (a === null) return null;
  if (SCOPED[a.flags.kind]) return questionScoped(a);
  let f;
  try { f = facts(a.root, a.flags['ludwig-record']); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usage(`question: ${e.message}`);
    throw e;
  }
  const missing = a.flags.kind === 'classification' ? L.verifyInVault(a.flags['ludwig-record']) : null; // never show the owner a path that does not exist
  if (missing) { process.stderr.write(`consent: ${missing.detail}\n`); return C.emitJson({ ok: false, reason: missing.reason, detail: missing.detail }, xprov.EXIT_FAIL, false); }
  const q = Q.buildQuestion(a.flags.kind, f.ctx);
  process.stderr.write(`consent question: put exactly this question with AskUserQuestion (header ${q.header}, labels ${q.labels.map((l) => JSON.stringify(l)).join(' / ')}); the hash is ${q.hash.slice(0, 12)}…\n`);
  return C.emitJson({ ok: true, repo: f.key, kind: q.kind, header: q.header, question: q.question, labels: q.labels, options: q.options, multiSelect: q.multiSelect, hash: q.hash, classification: q.classification }, xprov.EXIT_PASS, false);
}

function questionScoped(a) {
  const r = scopedBuild(a.flags.kind, a, 'question');
  if (r === null) return null; // a refusal, already printed
  const q = r.question;
  process.stderr.write(`consent question: put exactly this question with AskUserQuestion (header ${q.header}, labels ${q.labels.map((l) => JSON.stringify(l)).join(' / ')}); the hash is ${q.hash.slice(0, 12)}…\n`);
  const listed = r.targets ? r.targets.length : r.hits.length;
  return C.emitJson({ ok: true, repo: r.key, kind: q.kind, header: q.header, question: q.question, labels: q.labels, options: q.options, multiSelect: q.multiSelect, hash: q.hash, listed }, xprov.EXIT_PASS, false);
}

function ensureReport(key, kind, hash) {
  const p = M.peekMarker(key, kind);
  const answered = p.state === M.STATE.ANSWERED;
  const stale = answered && p.marker.hash !== hash;
  const ready = answered && !stale;
  const ask = stale || p.state === M.STATE.NONE || p.state === M.STATE.EXPIRED || p.state === M.STATE.USED;
  const report = { ok: ready, repo: key, kind, state: p.state, ask, ...(stale ? { reason: 'question_changed' } : {}), ...(ready ? { decision: p.marker.answer.decision } : {}) };
  const verb = kind === 'waiver' ? 'waive' : 'allowlist';
  process.stderr.write(ready ? `consent ensure: the owner answered (${p.marker.answer.decision}); run \`xprov consent ${verb}\` with the same flags\n`
    : (ask ? `consent ensure: no open question (${p.state}); ask it (consent question, then AskUserQuestion)\n` : 'consent ensure: the question is open; poll again, do not ask a second time\n'));
  return C.emitJson(report, ready ? xprov.EXIT_PASS : xprov.EXIT_FAIL, false);
}

function cmdEnsure(args) {
  const a = parse('ensure', args);
  if (a === null) return null;
  if (SCOPED[a.flags.kind]) {
    const r = scopedBuild(a.flags.kind, a, 'ensure');
    return r === null ? null : ensureReport(r.key, a.flags.kind, r.question.hash);
  }
  let f;
  try { f = facts(a.root, a.flags['ludwig-record']); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usage(`ensure: ${e.message}`);
    throw e;
  }
  const kind = a.flags.kind;
  const p = M.peekMarker(f.key, kind);
  const answered = p.state === M.STATE.ANSWERED;
  const stale = answered && p.marker.hash !== Q.buildQuestion(kind, f.ctx).hash; // the repository changed since the owner answered
  const ready = answered && !stale;
  const ask = stale || p.state === M.STATE.NONE || p.state === M.STATE.EXPIRED || p.state === M.STATE.USED;
  const report = { ok: ready, repo: f.key, kind, state: p.state, ask, ...(stale ? { reason: 'question_changed' } : {}), ...(ready ? { decision: p.marker.answer.decision } : {}) };
  process.stderr.write(ready ? `consent ensure: the owner answered (${p.marker.answer.decision}); run \`xprov consent record --kind ${kind}${kind === 'classification' ? ' --ludwig-record <path>' : ''}\`\n`
    : (ask ? `consent ensure: no open question (${p.state}); ask it (consent question, then AskUserQuestion)\n` : 'consent ensure: the question is open; poll again, do not ask a second time\n'));
  return C.emitJson(report, ready ? xprov.EXIT_PASS : xprov.EXIT_FAIL, false);
}

function reportResult(r, okText) {
  if (!r.ok) process.stderr.write(`consent: ${r.detail}\n`);
  else process.stderr.write(`consent: ${okText(r)}\n`);
  return C.emitJson(r, r.ok ? xprov.EXIT_PASS : xprov.EXIT_FAIL, false);
}

function cmdRecord(args) {
  const a = parse('record', args);
  if (a === null) return null;
  const ludwig = a.flags['ludwig-record'];
  let r;
  try { r = R.recordConsent({ root: a.root, kind: a.flags.kind, ludwigRecord: ludwig }); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usage(`record: ${e.message}`);
    throw e;
  }
  return reportResult(r, (x) => (x.kind === 'classification' ? 'the classification is stored'
    : (x.decision === 'yes' ? `permit recorded for ${x.repo}; the owner typed nothing in a terminal` : `denial recorded for ${x.repo}; Codex stays off until \`xprov consent revoke\``)));
}

function cmdScopedWrite(sub, args) {
  const a = parse(sub, args);
  if (a === null) return null;
  let r;
  try {
    r = sub === 'waive' ? W.waive({ root: a.root, phase: a.flags.phase, workPath: a.flags['work-path'] }) : A.approve({ root: a.root, scan: a.flags.scan });
  } catch (e) {
    if (e && e.code === 'A1_INPUT') return usage(`${sub}: ${e.message}`);
    throw e;
  }
  return reportResult(r, (x) => (sub === 'waive' ? `${x.waived.length} waiver record(s) written for phase ${x.phase}; the owner typed nothing in a terminal; a waiver is not a pass`
    : `${x.approved.length} blob approval(s) written; the owner typed nothing in a terminal`));
}

function cmdRevoke(args) {
  const a = parse('revoke', args);
  if (a === null) return null;
  const r = R.revokeConsent({ root: a.root });
  return reportResult(r, (x) => (x.changed ? `revoked (${x.removed.join(', ') || 'markers only'}); the next send asks again` : 'nothing to revoke'));
}

function cmdXprovConsent(args) {
  const list = Array.isArray(args) ? args : [];
  const sub = list[0];
  const rest = list.slice(1);
  if (sub === 'question') return cmdQuestion(rest);
  if (sub === 'ensure') return cmdEnsure(rest);
  if (sub === 'record') return cmdRecord(rest);
  if (sub === 'revoke') return cmdRevoke(rest);
  if (sub === 'waive' || sub === 'allowlist') return cmdScopedWrite(sub, rest);
  return usage(sub === undefined ? '<question|ensure|record|revoke|waive|allowlist> is required' : `unknown subcommand ${shown(sub)} (question, ensure, record, revoke, waive, allowlist)`);
}

module.exports = { cmdXprovConsent };
