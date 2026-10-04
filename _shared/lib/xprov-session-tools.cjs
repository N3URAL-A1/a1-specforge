'use strict';

// ---------------------------------------------------------------------------
// xprov-session-tools — which tools Codex used in a session log of the
// dedicated home (preflight check session_tools_exec_only, spec 009 FR-014).
//
// Allowed: exec, shell, local_shell — and, since Wave 7 (measured live on
// 2026-10-03, review round 2 on 28dc4db; Samuel's narrow ruling), `wait`
// ONLY as a read-only poll of an exec cell that the same session started
// earlier:
//   - a `function_call` named exactly `wait`;
//   - arguments with the keys {cell_id, yield_time_ms} and, as measured, an
//     optional max_tokens — no other key;
//   - cell_id a STRING naming a cell an earlier `exec` call reported as
//     running ("Script running with cell ID <id>" in its output);
//   - yield_time_ms an integer, 0 < x ≤ the runner timeout in ms;
//   - max_tokens, when present, an integer, 0 < x ≤ MAX_TOKENS_CAP.
// Measured line: {"cell_id":"1","max_tokens":4000,"yield_time_ms":1000}.
// `write_stdin` (input into a running exec — an active channel) and every
// other tool stay disallowed.
// ---------------------------------------------------------------------------

const fs = require('fs');
const X = require('./xprov.cjs');

const ALLOWED_SESSION_TOOLS = Object.freeze(['exec', 'shell', 'local_shell']);
const WAIT_TOOL = 'wait';
const WAIT_KEYS_REQUIRED = Object.freeze(['cell_id', 'yield_time_ms']);
const WAIT_KEYS_OPTIONAL = Object.freeze(['max_tokens']);
const MAX_TOKENS_CAP = 100000;
// Anchored as measured (Samuel NIT a): the FIRST input_text part of an exec output
// starts with this line; the same sentence later in the stdout of a reviewed file
// registers nothing.
const CELL_RUNNING_RE = /^Script running with cell ID (\S+)\n/;

const isPosInt = (v, max) => Number.isInteger(v) && v > 0 && v <= max;

/** Why one `wait` call is not the narrow read-only poll, or null. */
function waitProblem(args, cells, timeoutMs) {
  let a;
  try { a = JSON.parse(String(args)); } catch (_e) { return 'arguments are not JSON'; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'arguments are not an object';
  const keys = Object.keys(a);
  if (!WAIT_KEYS_REQUIRED.every((k) => keys.includes(k))) return 'cell_id or yield_time_ms missing';
  if (keys.some((k) => !WAIT_KEYS_REQUIRED.includes(k) && !WAIT_KEYS_OPTIONAL.includes(k))) return `extra argument ${keys.find((k) => !WAIT_KEYS_REQUIRED.includes(k) && !WAIT_KEYS_OPTIONAL.includes(k))}`;
  if (typeof a.cell_id !== 'string') return 'cell_id is not a string';
  if (!cells.has(a.cell_id)) return `cell ${a.cell_id} was not started by an earlier exec`;
  if (!isPosInt(a.yield_time_ms, timeoutMs)) return 'yield_time_ms out of range';
  if ('max_tokens' in a && !isPosInt(a.max_tokens, MAX_TOKENS_CAP)) return 'max_tokens out of range';
  return null;
}

/** The first `input_text` part of a tool output (measured shape), or ''. */
function firstText(out) {
  if (!Array.isArray(out) || !out[0] || out[0].type !== 'input_text' || typeof out[0].text !== 'string') return '';
  return out[0].text;
}

/** { names: sorted tool names, disallowed: [name (reason)] } of one session log. */
function sessionTools(file, timeoutMs) {
  const limit = timeoutMs || X.RUNNER_DEFAULT_TIMEOUT_SECONDS * 1000;
  const names = new Set();
  const disallowed = [];
  const execCalls = new Set();
  const cells = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let rec;
    try { rec = JSON.parse(line); } catch (_e) { continue; }
    const p = rec && rec.payload;
    if (!p || typeof p.type !== 'string') continue;
    if (rec.type === 'response_item' && /_call$/.test(p.type)) {
      const name = p.name ? String(p.name) : p.type.replace(/_call$/, '');
      names.add(name);
      if (name === 'exec') execCalls.add(p.call_id);
      else if (name === WAIT_TOOL && p.type === 'function_call') {
        const why = waitProblem(p.arguments, cells, limit);
        if (why) disallowed.push(`wait (${why})`);
      } else if (!ALLOWED_SESSION_TOOLS.includes(name)) disallowed.push(name);
    } else if (rec.type === 'response_item' && /_call_output$/.test(p.type) && execCalls.has(p.call_id)) {
      const m = CELL_RUNNING_RE.exec(firstText(p.output));
      if (m) cells.add(m[1]);
    } else if (rec.type === 'event_msg' && p.type.startsWith('mcp_tool_call')) {
      const inv = p.invocation || {};
      const name = `mcp:${inv.server || '?'}/${inv.tool || '?'}`;
      names.add(name);
      disallowed.push(name);
    }
  }
  return { names: [...names].sort(), disallowed: [...new Set(disallowed)].sort() };
}

/** Back-compatible: the sorted tool names of a session log. */
function sessionToolNames(file) {
  return sessionTools(file).names;
}

module.exports = { ALLOWED_SESSION_TOOLS, WAIT_TOOL, MAX_TOKENS_CAP, sessionTools, sessionToolNames, waitProblem };
