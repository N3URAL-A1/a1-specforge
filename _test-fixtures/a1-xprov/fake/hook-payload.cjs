'use strict';

// Test-only payload builder for part 25 (spec 016 wave 4). Every payload is DERIVED from the real owner-session capture
// (cases/hook-capture/pre.jsonl and post.jsonl, PROVENANCE.meta): the envelope (all keys, the key order, prompt_id, scratchpad_dir, effort,
// transcript_path ...) stays as measured; only the fields a case needs are rewritten. It never requires the code under test.
//
//   node hook-payload.cjs '<json>'      prints one payload (JSON, one line)
//   json: { capture, event: 'pre'|'post', session, tool_use, cwd?,
//           qfile?  (a JSON file holding the canonical question of `consent question`: { header, question, options }),
//           mutate? (none | byte | desc | label | multi | extrakey | two | answers | annotations | header:<text> | text:<question> | nooptions),
//           mode?   (post only: yes | no | free:<text> | dismissed | other:<text>)   the answer shape of the capture,
//           tool?   (Edit | Write | NotebookEdit | MultiEdit | Bash), input? (tool_input for the tool) }
//   Without qfile the captured question is used unchanged (a non-consent question, header "Test").

const fs = require('fs');
const path = require('path');

const a = JSON.parse(process.argv[2]);
const raw = fs.readFileSync(path.join(a.capture, a.event === 'post' ? 'post.jsonl' : 'pre.jsonl'), 'utf8').trim();
const base = JSON.parse(raw);
const captured = base.tool_input.questions[0];
const clone = (v) => JSON.parse(JSON.stringify(v));

function questionOf() {
  if (!a.qfile) return clone(captured);
  const c = JSON.parse(fs.readFileSync(a.qfile, 'utf8'));
  // the key order of the captured question object: question, header, options, multiSelect
  return { question: c.question, header: c.header, options: clone(c.options), multiSelect: false };
}

const q = questionOf();
const m = a.mutate || 'none';
let questions = [q];
if (m === 'byte') q.question += '.';
else if (m === 'desc') q.options[1].description += ' ';
else if (m === 'label') q.options[1].label += '!';
else if (m === 'multi') q.multiSelect = true;
else if (m === 'extrakey') q.preview = 'x';
else if (m === 'two') questions = [q, clone(captured)];
else if (m === 'nooptions') q.options = [];
else if (m.startsWith('header:')) q.header = m.slice('header:'.length);
else if (m.startsWith('text:')) q.question = m.slice('text:'.length);

const yes = q.options && q.options[1] ? q.options[1].label : 'Ja';
const no = q.options && q.options[0] ? q.options[0].label : 'Nein';

const out = { ...base, session_id: a.session, tool_use_id: a.tool_use };
if (a.cwd) out.cwd = a.cwd;
if (a.tool) {
  out.tool_name = a.tool;
  out.tool_input = a.input;
  delete out.tool_response;
  delete out.duration_ms;
} else if (a.event === 'pre') {
  out.tool_input = { ...base.tool_input, questions };
  if (m === 'answers') out.tool_input.answers = { [q.question]: yes };
  if (m === 'annotations') out.tool_input.annotations = {};
} else {
  const mode = a.mode || 'yes';
  const answered = mode === 'yes' ? yes : mode === 'no' ? no : mode.startsWith('free:') ? mode.slice(5) : mode.startsWith('other:') ? mode.slice(6) : null;
  const askedText = mode.startsWith('other:') ? 'A different question than the one asked?' : q.question;
  const answers = answered === null ? {} : { [askedText]: answered };
  // The capture's Post shape: tool_input holds the answered input (answers + annotations), tool_response = { questions, answers, annotations }.
  out.tool_input = { questions, answers, annotations: {} };
  out.tool_response = { questions, answers, annotations: {} };
}
process.stdout.write(`${JSON.stringify(out)}\n`);
