'use strict';

// Test-only stand-in for the plugin hook of spec 016 wave 4 (it does not exist yet). It requires ONLY the tree COPY
// named in its argument (the suite swaps xprov-owner-home.cjs there), never the live _shared/lib.
//   node consent-sim.cjs '<json>'      json: { cmd, tree, root, kind, ... }   prints one JSON line
//   ask     { tool_use, session, now? }                       PreToolUse: opens the marker of the canonical question
//   answer  { mode: yes|no|free|big|none, form: answers|text, text?, tool_use, session, template, now? }   PostToolUse
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
const question = (root, kind) => Q.buildQuestion(kind, Q.repoContext(root, RI.readOrigin(root)));
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
  const r = M.openMarker({ repo: key(a.root), kind: a.kind, hash: q.hash, toolUseId: a.tool_use, sessionId: a.session, now: a.now });
  out({ ok: r.ok, reason: r.reason || null, state: r.state || null, hint: r.hint || null, hash: q.hash });
} else if (a.cmd === 'answer') {
  const q = question(a.root, a.kind);
  const found = A.answerFromPayload(payload(q, a.kind), q.question);
  if (!found.found) { out({ found: false }); } else {
    const decision = Q.decisionOf(a.kind, found.label);
    const r = M.answerMarker({ toolUseId: a.tool_use, sessionId: a.session, decision, permissionMode: 'default', now: a.now });
    out({ found: true, decision, ok: r.ok, reason: r.reason || null });
  }
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
} else {
  process.stderr.write(`consent-sim: unknown cmd ${String(a.cmd).slice(0, 40)}\n`); process.exit(2);
}
