'use strict';

// ---------------------------------------------------------------------------
// xprov-hook-rules — the decisions of the plugin consent hook, payload in, decision out (spec 016 FR-004, FR-005; wave 4).
//
//   decide(payload, o?) -> { action, reason?, detail?, ... }       o: { now? }
//     PreToolUse  AskUserQuestion    -> 'allow' (not a consent question: nothing recorded) | 'opened' (canonical consent question, marker
//                                       written) | 'deny' (reason: consent_non_canonical | consent_multiple_questions | consent_answers |
//                                       consent_unresolvable | marker_pending | bad_payload)
//     PostToolUse AskUserQuestion    -> 'ignored' (no open marker for this tool_use_id: any other question) | 'recorded' (decision yes|no, the
//                                       marker now holds the owner's answer) | 'refused' (reason)
//     PreToolUse  Edit|Write|NotebookEdit|MultiEdit -> 'allow' | 'deny' (reason: store_path | settings_forgery | bad_payload)
//     anything else                  -> 'deny' (reason: unguarded_event): a call that cannot be classified counts as guarded (plan D-5).
//   hookOutput(decision, event) -> { exit, stdout, stderr }          the Claude Code wire form (deny = permissionDecision JSON, exit 0).
//
// A consent question is any AskUserQuestion with a header in the reserved xprov namespace (the four consent headers, folded for case,
// spacing and Unicode form, and anything else that starts with `xprov-`). It passes only when it is byte-equal to the question the Wave 2/3
// generators build for the repository its own `Pfad:` line names (recomputed in-process, no subprocess), has exactly one question, one
// shape of options, and no `answers`/`annotations` anywhere in the input. The PreToolUse call then opens the marker bound to this
// tool_use_id and session_id. The pending yes comes ONLY from the PostToolUse `tool_response` of a call whose tool_use_id has such a
// marker; a PostToolUse `tool_input` is never read for the answer (it carries `answers` for every answered call, plan R-1 fact 3).
// A marker exists only for a PreToolUse input that carried no `answers`: that is the whole of the "Pre input already carried answers" check.
// NOT detectable here: a foreign PreToolUse hook that fills `updatedInput.answers` after this hook ran (invisible to both events). The
// control is the settings-forgery deny (xprov-hook-paths.cjs); a Bash write of a settings file stays tier 0.
// Request-scoped: no module state; the only side effects are the marker writes of xprov-consent-marker.cjs.
// ---------------------------------------------------------------------------

const fs = require('fs');
const C = require('./xprov-common.cjs');
const RI = require('./xprov-repo-identity.cjs');
const Q = require('./xprov-consent-question.cjs');
const M = require('./xprov-consent-marker.cjs');
const A = require('./xprov-consent-answer.cjs');
const L = require('./xprov-consent-ludwig.cjs');
const W = require('./xprov-consent-waive.cjs');
const AL = require('./xprov-consent-allowlist.cjs');
const P = require('./xprov-hook-paths.cjs');

const ASK = 'AskUserQuestion';
const EDIT_TOOLS = Object.freeze(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const NAMESPACE_PREFIX = 'xprov-';
const QUESTION_KEYS = Object.freeze(['question', 'header', 'options', 'multiSelect']);
const OPTION_KEYS = Object.freeze(['label', 'description']);
const PFAD_RE = /^Pfad: (.*)$/m;
const LUDWIG_RE = /^Legal-Entscheidung \(Vault-Pfad\): (.*)$/m;
const NO_LUDWIG = 'keine angegeben';

const deny = (reason, detail) => Object.freeze({ action: 'deny', reason, detail });
const foldHeader = (h) => String(h).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const kindOfHeader = (h) => Q.kindNames().find((k) => foldHeader(Q.kindDef(k).header) === foldHeader(h)) || null;
const inNamespace = (h) => foldHeader(h).startsWith(NAMESPACE_PREFIX);
const plain = (v) => typeof v === 'string' && v !== '' && v.length <= 200;
const sameKeys = (o, keys) => C.isPlainObject(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));

/** The canonical question the generators build for the repository the question text names: { kind, key, q } or a deny decision. */
function rebuild(kind, text) {
  const m = PFAD_RE.exec(text);
  const root = m ? m[1] : '';
  if (root === '' || !root.startsWith('/')) return deny('consent_unresolvable', 'the question names no absolute repository path on a "Pfad:" line');
  let st = null;
  try { st = fs.statSync(root); } catch (_e) { st = null; }
  const key = st !== null && st.isDirectory() ? C.commonDirOf(root) : null;
  if (key === null) return deny('consent_unresolvable', 'the "Pfad:" line does not name a git repository on this machine');
  try {
    if (kind === 'waiver') {
      const s = W.scopeFromText(text);
      const b = s ? W.buildFor({ root, phase: s.phase }) : null;
      return b && b.ok ? { kind, key: b.key, q: b.question } : deny('consent_unresolvable', 'no waivable target for the phase this question names');
    }
    if (kind === 'allowlist') {
      const s = AL.scopeFromText(text);
      const b = s ? AL.buildFor({ root, scan: s.scan }) : null;
      return b && b.ok ? { kind, key: b.key, q: b.question } : deny('consent_unresolvable', 'no usable scan record for the scan this question names');
    }
    let ludwig;
    if (kind === 'classification') {
      const l = LUDWIG_RE.exec(text);
      if (!l || l[1] === NO_LUDWIG) return deny('consent_unresolvable', 'a classification question names its a1-ludwig-legal record');
      L.validateArg(l[1]);
      ludwig = l[1];
    }
    return { kind, key, q: Q.buildQuestion(kind, Q.repoContext(root, RI.readOrigin(root), { ludwigRecord: ludwig })) };
  } catch (e) {
    return deny('consent_unresolvable', `the canonical question cannot be built (${C.clip(String((e && e.reason) || (e && e.message) || 'error'), 120)})`);
  }
}

/** True when `q` (the question object of the input) equals the canonical question field by field and nothing else is in it. */
function isCanonical(q, canon) {
  if (!sameKeys(q, QUESTION_KEYS) || q.question !== canon.question || q.header !== canon.header || q.multiSelect !== false) return false;
  const want = canon.options;
  return Array.isArray(q.options) && q.options.length === want.length
    && q.options.every((o, i) => sameKeys(o, OPTION_KEYS) && o.label === want[i].label && o.description === want[i].description);
}

function preAsk(payload, o) {
  const input = payload.tool_input;
  const qs = C.isPlainObject(input) ? input.questions : null;
  if (!Array.isArray(qs)) return deny('bad_payload', 'AskUserQuestion input has no questions array');
  const consent = qs.filter((q) => C.isPlainObject(q) && typeof q.header === 'string' && (kindOfHeader(q.header) !== null || inNamespace(q.header)));
  if (consent.length === 0) return Object.freeze({ action: 'allow' });
  if ('answers' in input || 'annotations' in input || 'updatedInput' in input) return deny('consent_answers', 'a consent question carries an answers field; only the owner answers it, in the chat');
  if (qs.length !== 1) return deny('consent_multiple_questions', 'a consent question is put alone, as the only question of the call');
  const q = qs[0];
  const kind = kindOfHeader(q.header);
  if (kind === null || q.header !== Q.kindDef(kind).header) return deny('consent_non_canonical', 'the header is in the reserved xprov namespace but is not one of the consent headers, byte for byte');
  if (!plain(payload.tool_use_id) || !plain(payload.session_id)) return deny('bad_payload', 'the payload has no usable tool_use_id and session_id');
  const built = rebuild(kind, String(q.question));
  if (built.action === 'deny') return built;
  if (!isCanonical(q, built.q)) return deny('consent_non_canonical', `the question is not byte-equal to the one \`a1-tools xprov consent question --kind ${kind}\` prints; ask it exactly as printed`);
  const r = M.openMarker({ repo: built.key, kind, hash: built.q.hash, originSha: built.q.originSha, toolUseId: payload.tool_use_id, sessionId: payload.session_id, now: o && o.now });
  if (!r.ok) return deny(r.reason, r.hint);
  return Object.freeze({ action: 'opened', kind, hash: built.q.hash });
}

/** The question text the answered call carried: tool_response.questions[0].question, else the Post input's first question (text only, never the answer). */
function answeredQuestion(payload) {
  const tr = payload.tool_response;
  const from = (qs) => (Array.isArray(qs) && qs.length === 1 && C.isPlainObject(qs[0]) && typeof qs[0].question === 'string' ? qs[0].question : null);
  const own = C.isPlainObject(tr) ? from(tr.questions) : null;
  return own !== null ? own : from(C.isPlainObject(payload.tool_input) ? payload.tool_input.questions : null);
}

function postAsk(payload, o) {
  if (!plain(payload.tool_use_id) || !plain(payload.session_id)) return Object.freeze({ action: 'ignored' });
  const question = answeredQuestion(payload);
  if (question === null) return Object.freeze({ action: 'ignored', note: 'no single answered question' });
  const found = A.answerFromPayload(payload, question); // reads tool_response only
  if (!found.found) return Object.freeze({ action: 'ignored', note: 'no answer in the tool response (dismissed or unreadable)' }); // nothing is recorded, not even a No
  const r = M.answerMarker({
    toolUseId: payload.tool_use_id, sessionId: payload.session_id, label: found.label, question,
    permissionMode: payload.permission_mode, now: o && o.now,
  });
  if (r.ok) return Object.freeze({ action: 'recorded', decision: r.decision });
  return r.reason === 'no_marker' ? Object.freeze({ action: 'ignored' }) : Object.freeze({ action: 'refused', reason: r.reason });
}

function preEdit(payload) {
  const tool = payload.tool_name;
  const input = payload.tool_input;
  if (!C.isPlainObject(input)) return deny('bad_payload', 'the tool input is not an object');
  const file = tool === 'NotebookEdit' ? input.notebook_path : input.file_path;
  if (typeof file !== 'string' || file === '') return deny('bad_payload', 'the tool input names no file');
  const cwd = typeof payload.cwd === 'string' && payload.cwd.startsWith('/') ? payload.cwd : process.cwd();
  const g = P.guardedPath(file, cwd);
  if (g.guarded) return deny('store_path', `${g.why} is the owner's: agents never edit it; use \`a1-tools xprov consent ...\` or ask the owner`);
  const f = P.settingsForgery(file, cwd, tool, input);
  if (f.forged) return deny('settings_forgery', f.why);
  return Object.freeze({ action: 'allow' });
}

/** The decision for a hook payload; never throws for a payload shape (a throw means the hook itself failed: fail closed). */
function decide(payload, o) {
  if (!C.isPlainObject(payload)) return deny('bad_payload', 'the hook input is not a JSON object');
  const event = payload.hook_event_name;
  const tool = payload.tool_name;
  if (event === 'PreToolUse' && tool === ASK) return preAsk(payload, o);
  if (event === 'PostToolUse' && tool === ASK) return postAsk(payload, o);
  if (event === 'PreToolUse' && EDIT_TOOLS.includes(tool)) return preEdit(payload);
  return deny('unguarded_event', `the hook does not handle ${C.clip(String(event), 40)} for ${C.clip(String(tool), 40)}`);
}

/** The wire form: { exit, stdout, stderr }. A PreToolUse deny is JSON with exit 0; a Post refusal is a stderr note (exit 2 shows it to the model). */
function hookOutput(d, event) {
  if (d.action === 'deny') {
    const reason = `xprov consent hook (${d.reason}): ${d.detail}`;
    if (event === 'PreToolUse') return { exit: 0, stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`, stderr: '' };
    return { exit: 2, stdout: '', stderr: `${reason}\n` };
  }
  if (d.action === 'refused') return { exit: 2, stdout: '', stderr: `xprov consent hook: the answer was not recorded (${d.reason}); ask the question again\n` };
  return { exit: 0, stdout: '', stderr: '' };
}

module.exports = { ASK, EDIT_TOOLS, decide, hookOutput, kindOfHeader, inNamespace, rebuild, isCanonical };
