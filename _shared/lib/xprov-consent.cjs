'use strict';

// ---------------------------------------------------------------------------
// xprov consent — `a1-tools xprov consent <question|ensure|record|revoke>` (spec 016 FR-002, FR-003, FR-005, FR-007, FR-008; wave 2).
//
//   question --kind consent|classification [--repo <toplevel>]
//       stdout: the canonical AskUserQuestion input ({ header, question, labels [No, Yes], options, hash }); exit 0.
//   ensure   --kind consent|classification [--repo <toplevel>]
//       stdout: the state of the repository's marker (none|pending|answered|expired|used) and whether to ask; exit 0 only when an answer
//       is ready to record. A second asker polls this instead of putting a second question.
//   record   --kind consent|classification [--repo <toplevel>] [--ludwig-record <vault path>]
//       writes the stores from a matching, unexpired, unused, bound owner answer; without one: nothing written, exit 1.
//   revoke   [--repo <toplevel>]
//       removes the repository's permit, denial, evidence and unused markers whatever channel wrote them.
// `waive` and `allowlist` arrive in wave 3. Exit contract: 0 ok · 1 refused (stdout JSON names `reason`) · 2 usage error.
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

const ECHO_MAX = 80;
const WAVE3 = Object.freeze(['waive', 'allowlist']);
const RECORD_KINDS = Object.freeze(['consent', 'classification']);
const usage = (msg) => C.usageExit('consent', msg);
const shown = (v) => JSON.stringify(String(v).slice(0, ECHO_MAX));

const FLAGS = Object.freeze({
  question: { kind: 'string', repo: 'string' },
  ensure: { kind: 'string', repo: 'string' },
  record: { kind: 'string', repo: 'string', 'ludwig-record': 'string' },
  revoke: { repo: 'string' },
});

/** { flags, root } or null after a usage error (already printed). */
function parse(sub, args) {
  const flags = io.parseFlags(args, FLAGS[sub]);
  if (flags._.length) return usage(`${sub}: unexpected argument ${shown(flags._[0])}`);
  for (const name of Object.keys(FLAGS[sub])) {
    if (name in flags && (typeof flags[name] !== 'string' || flags[name] === '')) return usage(`${sub}: --${name} needs a value`);
  }
  if (sub !== 'revoke') {
    if (flags.kind === undefined) return usage(`${sub}: --kind <${Q.kindNames().join('|')}> is required`);
    if (Q.kindDef(flags.kind) === null || (sub !== 'question' && !RECORD_KINDS.includes(flags.kind))) return usage(`${sub}: unknown --kind ${shown(flags.kind)} (one of ${(sub === 'question' ? Q.kindNames() : RECORD_KINDS).join(', ')})`);
  }
  let root;
  try { root = C.resolveRepoFlag(flags.repo); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usage(`${sub}: ${e.message}`);
    throw e;
  }
  return { flags, root };
}

function facts(root) {
  const key = C.commonDirOf(root);
  if (key === null) throw C.inputError(`${root} is not a git repository`, 'not_a_repository');
  const origin = RI.readOrigin(root);
  return { key, origin, ctx: Q.repoContext(root, origin) };
}

function cmdQuestion(args) {
  const a = parse('question', args);
  if (a === null) return null;
  let f;
  try { f = facts(a.root); } catch (e) {
    if (e && e.code === 'A1_INPUT') return usage(`question: ${e.message}`);
    throw e;
  }
  const q = Q.buildQuestion(a.flags.kind, f.ctx);
  process.stderr.write(`consent question: put exactly this question with AskUserQuestion (header ${q.header}, labels ${q.labels.map((l) => JSON.stringify(l)).join(' / ')}); the hash is ${q.hash.slice(0, 12)}…\n`);
  return C.emitJson({ ok: true, repo: f.key, kind: q.kind, header: q.header, question: q.question, labels: q.labels, options: q.options, multiSelect: q.multiSelect, hash: q.hash, classification: q.classification }, xprov.EXIT_PASS, false);
}

function cmdEnsure(args) {
  const a = parse('ensure', args);
  if (a === null) return null;
  let f;
  try { f = facts(a.root); } catch (e) {
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
  process.stderr.write(ready ? `consent ensure: the owner answered (${p.marker.answer.decision}); run \`xprov consent record --kind ${kind}\`\n`
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
  if (WAVE3.includes(sub)) {
    process.stderr.write(`xprov consent ${sub}: not implemented yet (planned wave 3)\n`);
    process.exitCode = xprov.EXIT_USAGE;
    return null;
  }
  return usage(sub === undefined ? '<question|ensure|record|revoke> is required' : `unknown subcommand ${shown(sub)} (question, ensure, record, revoke)`);
}

module.exports = { cmdXprovConsent };
