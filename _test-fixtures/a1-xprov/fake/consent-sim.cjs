'use strict';

// Test-only stand-in for the plugin hook of spec 016 wave 4 (it does not exist yet). It requires ONLY the tree COPY
// named in its argument (the suite swaps xprov-owner-home.cjs there), never the live _shared/lib.
//   node consent-sim.cjs '<json>'      json: { cmd, tree, root, kind, ... }   prints one JSON line
//   ask     { tool_use, session, ludwig?, now? }              PreToolUse: opens the marker of the canonical question
//                                                             (ludwig: the vault path the classification question shows)
//   answer  { mode: yes|no|free|big|none, form: answers|text, text?, tool_use, session, template, now? }   PostToolUse
//   answer-raw { qkind, label, tool_use, session }            PostToolUse with a RAW label and the question text of kind qkind
//                                                             (a hook that mixes questions up); prints the library result
//   slow-record / slow-permit { ms, deny? } / revoke          the owner-store writers, paused inside their lock window
//   age     { ms }                                            makes the marker `ms` older (an expired marker)
//   edit    { path: 'answer.tool_use_id', value }             hand-edits a marker field (a forged marker)
//   copy    { toRoot }                                        copies root's marker file over the marker file of toRoot
//   marker  {}                                                prints the marker file as it is

const fs = require('fs');
const path = require('path');

const a = JSON.parse(process.argv[2]);
const lib = (n) => require(path.join(a.tree, '_shared', 'lib', n));
const Q = lib('xprov-consent-question.cjs');
const M = lib('xprov-consent-marker.cjs');
const A = lib('xprov-consent-answer.cjs');
const C = lib('xprov-common.cjs');
const RI = lib('xprov-repo-identity.cjs');

const key = (root) => C.commonDirOf(root);
// Wave 3 kinds are built by their own modules from the phase / scan state, exactly as the plugin hook will (in-process require).
const question = (root, kind) => {
  if (kind === 'waiver') return lib('xprov-consent-waive.cjs').buildFor({ root, phase: a.phase }).question;
  if (kind === 'allowlist') return lib('xprov-consent-allowlist.cjs').buildFor({ root, scan: a.scan }).question;
  return Q.buildQuestion(kind, Q.repoContext(root, RI.readOrigin(root), { ludwigRecord: kind === 'classification' && a.ludwig ? a.ludwig : undefined }));
};
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

function fill(node, map) {
  if (typeof node === 'string') return Object.entries(map).reduce((s, [k, v]) => s.split(k).join(v), node);
  if (Array.isArray(node)) return node.map((n) => fill(n, map));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [fill(k, map), fill(v, map)]));
  return node;
}

function payload(q, kind) {
  const def = Q.kindDef(kind);
  const label = { yes: def.labels.yes, no: def.labels.no, free: a.text, big: 'x'.repeat(10000), none: '' }[a.mode];
  const map = {
    __SESSION__: a.session, __TOOL_USE__: a.tool_use, __QUESTION__: q.question, __HEADER__: q.header,
    __LABEL_NO__: def.labels.no, __LABEL_YES__: def.labels.yes, __DESC__: 'd', __LABEL__: label === undefined ? '' : label,
  };
  return fill(JSON.parse(fs.readFileSync(a.template, 'utf8')), map);
}

function markerPath(root, kind) { return M.markerFile(key(root), kind); }

if (a.cmd === 'ask') {
  const q = question(a.root, a.kind);
  const r = M.openMarker({ repo: key(a.root), kind: a.kind, hash: q.hash, originSha: q.originSha, toolUseId: a.tool_use, sessionId: a.session, now: a.now });
  out({ ok: r.ok, reason: r.reason || null, state: r.state || null, hint: r.hint || null, hash: q.hash });
} else if (a.cmd === 'answer') {
  const q = question(a.root, a.kind);
  const found = A.answerFromPayload(payload(q, a.kind), q.question);
  if (!found.found) { out({ found: false }); } else {
    // The hook hands the raw label and the answered question text over; the library derives the decision (security review MINOR-1).
    const r = M.answerMarker({ toolUseId: a.tool_use, sessionId: a.session, label: found.label, question: q.question, permissionMode: 'default', now: a.now });
    out({ found: true, decision: r.ok ? r.decision : Q.decisionOf(a.kind, found.label), ok: r.ok, reason: r.reason || null });
  }
} else if (a.cmd === 'answer-raw') {
  const q = question(a.root, a.qkind || a.kind);
  const r = M.answerMarker({ toolUseId: a.tool_use, sessionId: a.session, label: a.label, question: q.question, permissionMode: 'default', now: a.now });
  out({ ok: r.ok, reason: r.reason || null, decision: r.decision || null });
} else if (a.cmd === 'slow-record') {
  // consent record with a pause between its read of the stores and its writes (the window a lost update needs); the lock must close it
  const R = lib('xprov-consent-record.cjs');
  const orig = M.claimMarker;
  M.claimMarker = (want) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, a.ms); return orig(want); };
  const r = R.recordConsent({ root: a.root, kind: a.kind, ludwigRecord: a.ludwig });
  out({ ok: r.ok, reason: r.reason || null });
} else if (a.cmd === 'slow-permit') {
  // terminal `permit` (library call) with a pause after its reads of the stores, before the audit line
  const AU = lib('xprov-audit.cjs'); const P = lib('xprov-permit.cjs');
  const orig = AU.appendAudit;
  AU.appendAudit = (o) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, a.ms); return orig(o); };
  const call = { repoRoot: a.root, by: 'robert', record: 'record/2026-10-14-fixture.md', today: '2026-10-14' };
  const r = a.deny ? P.permitDeny(call) : P.permit(call);
  out({ ok: r.ok, reason: r.reason || null });
} else if (a.cmd === 'revoke') {
  const R = lib('xprov-consent-record.cjs');
  const r = R.revokeConsent({ root: a.root });
  out({ ok: r.ok, reason: r.reason || null });
} else if (a.cmd === 'age') {
  const f = markerPath(a.root, a.kind); const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  m.created = new Date(Date.parse(m.created) - a.ms).toISOString(); fs.writeFileSync(f, `${JSON.stringify(m, null, 2)}\n`); out({ ok: true });
} else if (a.cmd === 'edit') {
  const f = markerPath(a.root, a.kind); const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  const parts = a.path.split('.'); const last = parts.pop(); const holder = parts.reduce((o, k) => o[k], m); holder[last] = a.value;
  fs.writeFileSync(f, `${JSON.stringify(m, null, 2)}\n`); out({ ok: true });
} else if (a.cmd === 'copy') {
  fs.copyFileSync(markerPath(a.root, a.kind), markerPath(a.toRoot, a.kind)); fs.chmodSync(markerPath(a.toRoot, a.kind), 0o600); out({ ok: true });
} else if (a.cmd === 'marker') {
  out(JSON.parse(fs.readFileSync(markerPath(a.root, a.kind), 'utf8')));
} else if (a.cmd === 'hits') {
  // writes the scan hits record of the masked REAL gitleaks report (only path, rule, line, column survive fromGitleaksReport)
  const H = lib('xprov-consent-hits.cjs');
  const report = JSON.parse(fs.readFileSync(a.report, 'utf8'));
  const commit = a.commit || C.gitOut(['-C', a.root, 'rev-parse', 'HEAD']).trim();
  const hits = [...H.fromGitleaksReport(report), ...(a.extra || [])];
  H.writeHits(a.name, { version: 1, snapshot: a.name, repo_key: a.repo_key || key(a.root), commit, hits, ts: '2026-10-14T00:00:00.000Z' });
  out({ ok: true, hits: hits.length, commit });
} else if (a.cmd === 'chat-waive-slow') {
  // consent waive with a pause between its read of the waiver store and its write (the window a lost update needs); the store lock must close it
  const AP = lib('xprov-approve.cjs');
  const orig = AP.writeGuardedStore;
  AP.writeGuardedStore = (name, doc) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, a.ms); return orig(name, doc); };
  const r = lib('xprov-consent-waive.cjs').waive({ root: a.root, phase: a.phase });
  out({ ok: r.ok, reason: r.reason || null });
} else if (a.cmd === 'term-waive') {
  // the TERMINAL waive (library call; its TTY guards are stubbed BEFORE the gate module loads), run from the repository (cwd)
  const AP = lib('xprov-approve.cjs');
  AP.guardRefusal = () => null; AP.readTypedLine = () => a.gate;
  const G = lib('xprov-gate.cjs');
  const r = G.waive({ phase: a.phase, gate: a.gate, reason: 'terminal waiver', by: 'robert' });
  out({ ok: r.code === 0, code: r.code });
} else if (a.cmd === 'chat-allowlist-slow') {
  const AP = lib('xprov-approve.cjs');
  const orig = AP.writeStore;
  AP.writeStore = (repos) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, a.ms); return orig(repos); };
  const r = lib('xprov-consent-allowlist.cjs').approve({ root: a.root, scan: a.scan });
  out({ ok: r.ok, reason: r.reason || null });
} else if (a.cmd === 'term-revoke') {
  // the body of the TERMINAL allowlist revoke (library call; the TTY guard lives in its CLI wrapper)
  const r = lib('xprov-approve.cjs').revoke(a.root, a.sha);
  out({ ok: r.code === 0, code: r.code });
} else {
  process.stderr.write(`consent-sim: unknown cmd ${String(a.cmd).slice(0, 40)}\n`); process.exit(2);
}
