'use strict';

// xprov-session-tools.cjs — which tools Codex used in a session log
// (preflight check session_tools_exec_only, spec 009 FR-014). Allowed: exec,
// shell, local_shell, and `wait` only as a read-only poll of a cell an
// earlier exec reported as running.

const fs = require('fs');
const path = require('path');
const { check, eq, done } = require('../lib.cjs');

const T = require(path.join(process.argv[2], 'xprov-session-tools.cjs'));
const work = fs.mkdtempSync(path.join(process.argv[3], 'st-'));

eq('S0 allowed tools', T.ALLOWED_SESSION_TOOLS, ['exec', 'shell', 'local_shell']);

// S1 — waitProblem: the narrow argument shape.
{
  const cells = new Set(['7']);
  const w = (a) => T.waitProblem(typeof a === 'string' ? a : JSON.stringify(a), cells, 600000);
  eq('S1 valid poll', w({ cell_id: '7', yield_time_ms: 1000 }), null);
  eq('S1 valid poll with max_tokens (measured line)', w({ cell_id: '7', max_tokens: 4000, yield_time_ms: 1000 }), null);
  eq('S1 not JSON', w('{cell_id'), 'arguments are not JSON');
  eq('S1 array', w([]), 'arguments are not an object');
  eq('S1 null', w('null'), 'arguments are not an object');
  eq('S1 yield_time_ms missing', w({ cell_id: '7' }), 'cell_id or yield_time_ms missing');
  eq('S1 extra key (write channel)', w({ cell_id: '7', yield_time_ms: 1000, chars: 'y\n' }), 'extra argument chars');
  eq('S1 numeric cell_id', w({ cell_id: 7, yield_time_ms: 1000 }), 'cell_id is not a string');
  eq('S1 unknown cell', w({ cell_id: '8', yield_time_ms: 1000 }), 'cell 8 was not started by an earlier exec');
  eq('S1 yield 0', w({ cell_id: '7', yield_time_ms: 0 }), 'yield_time_ms out of range');
  eq('S1 yield above the timeout', w({ cell_id: '7', yield_time_ms: 600001 }), 'yield_time_ms out of range');
  eq('S1 yield at the timeout', w({ cell_id: '7', yield_time_ms: 600000 }), null);
  eq('S1 fractional yield', w({ cell_id: '7', yield_time_ms: 1.5 }), 'yield_time_ms out of range');
  eq('S1 max_tokens above the cap', w({ cell_id: '7', yield_time_ms: 1, max_tokens: 100001 }), 'max_tokens out of range');
  eq('S1 max_tokens as string', w({ cell_id: '7', yield_time_ms: 1, max_tokens: '4000' }), 'max_tokens out of range');
}

// Session log builders (the measured record shapes).
const call = (name, callId, args, type = 'function_call') => ({ type: 'response_item', payload: { type, name, call_id: callId, arguments: args === undefined ? undefined : JSON.stringify(args) } });
const output = (callId, text) => ({ type: 'response_item', payload: { type: 'function_call_output', call_id: callId, output: [{ type: 'input_text', text }] } });
const mcp = (server, tool) => ({ type: 'event_msg', payload: { type: 'mcp_tool_call_begin', invocation: { server, tool } } });
let n = 0;
const log = (records) => {
  n += 1;
  const f = path.join(work, `session-${n}.jsonl`);
  fs.writeFileSync(f, records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n'));
  return f;
};
const running = (id) => `Script running with cell ID ${id}\nstill going`;

// S2 — exec starts cell 7, wait polls it: clean.
{
  const r = T.sessionTools(log([call('exec', 'c1', { cmd: 'sleep 5' }), output('c1', running('7')), call('wait', 'c2', { cell_id: '7', yield_time_ms: 1000 })]));
  eq('S2 exec + wait on its cell', r, { names: ['exec', 'wait'], disallowed: [] });
}

// S3 — wait before the exec reported the cell is refused (order matters).
// Red-making change: collecting cells in a first pass over the whole log.
{
  const r = T.sessionTools(log([call('exec', 'c1', {}), call('wait', 'c2', { cell_id: '7', yield_time_ms: 1000 }), output('c1', running('7'))]));
  eq('S3 wait before the cell exists', r.disallowed, ['wait (cell 7 was not started by an earlier exec)']);
}

// S4 — only an exec's FIRST input_text, anchored at its start, registers a cell.
// Red-making change: dropping the `^` anchor of CELL_RUNNING_RE.
{
  const r1 = T.sessionTools(log([call('exec', 'c1', {}), output('c1', `cat notes.md\nScript running with cell ID 9\n`), call('wait', 'c2', { cell_id: '9', yield_time_ms: 1 })]));
  eq('S4 sentence later in stdout registers nothing', r1.disallowed, ['wait (cell 9 was not started by an earlier exec)']);
  const r2 = T.sessionTools(log([call('shell', 'c1', {}), output('c1', running('9')), call('wait', 'c2', { cell_id: '9', yield_time_ms: 1 })]));
  eq('S4 a shell output registers nothing', r2.disallowed, ['wait (cell 9 was not started by an earlier exec)']);
  const second = { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: [{ type: 'input_text', text: 'ok' }, { type: 'input_text', text: running('9') }] } };
  const r3 = T.sessionTools(log([call('exec', 'c1', {}), second, call('wait', 'c2', { cell_id: '9', yield_time_ms: 1 })]));
  eq('S4 a second input_text part registers nothing', r3.disallowed, ['wait (cell 9 was not started by an earlier exec)']);
}

// S5 — disallowed tools: write_stdin, apply_patch, any MCP call.
{
  const r = T.sessionTools(log([
    call('exec', 'c1', {}), output('c1', running('1')),
    call('write_stdin', 'c2', { session_id: '1', chars: 'y\n' }),
    call('apply_patch', 'c3', undefined, 'custom_tool_call'),
    mcp('github', 'create_pull_request'),
    mcp(undefined, undefined),
  ]));
  eq('S5 names', r.names, ['apply_patch', 'exec', 'mcp:?/?', 'mcp:github/create_pull_request', 'write_stdin']);
  eq('S5 disallowed', r.disallowed, ['apply_patch', 'mcp:?/?', 'mcp:github/create_pull_request', 'write_stdin']);
}

// S6 — shell and local_shell are allowed; a nameless *_call takes its type's name.
{
  const r = T.sessionTools(log([call('shell', 'c1', {}), { type: 'response_item', payload: { type: 'local_shell_call', call_id: 'c2' } }]));
  eq('S6 shell + local_shell', r, { names: ['local_shell', 'shell'], disallowed: [] });
  const r2 = T.sessionTools(log([{ type: 'response_item', payload: { type: 'web_search_call', call_id: 'c1' } }]));
  eq('S6 nameless web_search_call is disallowed', r2.disallowed, ['web_search']);
}

// S7 — a `wait` that is not a function_call is not the poll exception.
{
  const r = T.sessionTools(log([call('exec', 'c1', {}), output('c1', running('1')), call('wait', 'c2', { cell_id: '1', yield_time_ms: 1 }, 'custom_tool_call')]));
  eq('S7 wait as custom_tool_call', r.disallowed, ['wait']);
}

// S8 — malformed lines are skipped; duplicates collapse; output sorted.
{
  const r = T.sessionTools(log(['not json', '', '{"type":"response_item"}', '{"payload":{"type":7}}', call('zz_tool', 'a'), call('zz_tool', 'b'), call('aa_tool', 'c')]));
  eq('S8 tolerant parse, dedupe, sort', r, { names: ['aa_tool', 'zz_tool'], disallowed: ['aa_tool', 'zz_tool'] });
}

// S9 — the default timeout bounds yield_time_ms (600 s); a passed timeout wins.
{
  const f = log([call('exec', 'c1', {}), output('c1', running('1')), call('wait', 'c2', { cell_id: '1', yield_time_ms: 600001 })]);
  eq('S9 default bound 600000 ms', T.sessionTools(f).disallowed, ['wait (yield_time_ms out of range)']);
  eq('S9 explicit larger timeout', T.sessionTools(f, 700000).disallowed, []);
  eq('S9 sessionToolNames = names', T.sessionToolNames(f), ['exec', 'wait']);
}

// S10 — an oversized log line is handled, not a crash.
{
  const r = T.sessionTools(log([call('exec', 'c1', { cmd: 'x'.repeat(20000) })]));
  eq('S10 oversized arguments', r, { names: ['exec'], disallowed: [] });
}

done();
