'use strict';

// wave-next-check.cjs (spec 027 FR-021, plan D7): `wave next-check` stop reasons.
// Every case plants a repo (gate log through the real appendGateLine, observations, GOAL.md, PLAN.md) and runs the
// real CLI as a child. Literals only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'nc-'));
const TOOLS = path.join(LIB, '..', 'a1-tools.cjs');
const gateLog = require(path.join(LIB, 'gate-log.cjs'));
const ENV = { PATH: process.env.PATH, HOME: path.join(WORK, 'home'), TMPDIR: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
fs.mkdirSync(ENV.HOME, { recursive: true });

const SINCE = '2026-11-20T10:00:00Z';
const SLUG = 'ph';
const GOAL_OK = '# Goal: x\n\n## Decisions\n';
const PABLO_PLAN = '---\nphase: ph\nlanes: none\n---\n\n## Wave 1 - a\n## Wave 2 - b\n## Wave 3 - c\n';
const LANE_PLAN = '---\nphase: ph\nlanes:\n  - id: x\n    waves: [1]\n    owns:\n      - "src/a"\n    agent: a1-walter-web-developer\n  - id: y\n    waves: [2]\n    owns:\n      - "src/b"\n---\n\n## Wave 1 - a\n## Wave 2 - b\n';
const WAVE_PLAN_OK = '# Wave plan\n\n## Wave 1: a\n\n### Suggested agent(s)\n- **a1-walter-web-developer**\n\n## Wave 2: b\n\n### Suggested agent(s)\n- **a1-walter-web-developer**\n';
const WAVE_PLAN_BARE = '# Wave plan\n\n## Wave 1: a\n\n### Suggested agent(s)\n- **a1-walter-web-developer**\n\n## Wave 2: b\n\nno agent here\n';

let seq = 0;
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}
/** o: {log: [[ts, gate, verdict]] | null, obs: text|null, goal: text|null, plan: text|null} (null omits the file). */
function plant(o) {
  seq += 1;
  const root = path.join(WORK, `repo${seq}`);
  const dir = path.join(root, '.a1', 'phases', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  git(root, '-c', 'init.defaultBranch=main', 'init', '-q');
  const has = (k, dflt) => (k in o ? o[k] : dflt);
  const log = has('log', [['2026-11-20T10:05:00.000Z', 'test-fidelity', 'pass']]);
  for (const [ts, gate, verdict] of log || []) {
    gateLog.appendGateLine({ root, scope: SLUG, gateId: gate, verdict, exitCode: verdict === 'pass' ? 0 : 1, headSha: 'a'.repeat(40), ts });
  }
  const files = { 'observations.jsonl': has('obs', ''), 'GOAL.md': has('goal', GOAL_OK), 'PLAN.md': has('plan', PABLO_PLAN) };
  for (const [name, text] of Object.entries(files)) if (text !== null) fs.writeFileSync(path.join(dir, name), text);
  return root;
}
function nc(root, wave, extra) {
  const r = spawnSync(process.execPath, [TOOLS, 'wave', 'next-check', SLUG, String(wave), '--since', SINCE, '--project', root, ...(extra || [])], { cwd: WORK, env: ENV, encoding: 'utf8', timeout: 60000 });
  return { rc: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
}
function is(name, r, want, rc) {
  check(name, r.out === want && r.rc === rc, `out=${JSON.stringify(r.out)} rc=${r.rc} err=${r.err}`);
}
const stopOf = (reason) => [`stop:${reason}`, 1];
const ok = ['continue', 0];
function expect(name, root, wave, want, extra) {
  const r = nc(root, wave, extra);
  is(name, r, want[0], want[1]);
  return r;
}

expect('NC1 green log after --since, empty stores, lanes none: continue', plant({}), 1, ok);
expect('NC2 last verdict of test-fidelity since --since is fail: stop:gate_red', plant({ log: [['2026-11-20T10:05:00.000Z', 'test-fidelity', 'fail']] }), 1, stopOf('gate_red'));
expect('NC3 a fail before --since, then a pass after: continue', plant({ log: [['2026-11-20T09:00:00.000Z', 'test-fidelity', 'fail'], ['2026-11-20T10:05:00.000Z', 'test-fidelity', 'pass']] }), 1, ok);
expect('NC4 no record at or after --since: stop:gate_red', plant({ log: [['2026-11-20T09:00:00.000Z', 'test-fidelity', 'pass']] }), 1, stopOf('gate_red'));
expect('NC5 no gate log: stop:gate_red', plant({ log: null }), 1, stopOf('gate_red'));
{
  const root = plant({});
  fs.appendFileSync(path.join(root, '.a1', 'phases', SLUG, 'gate-log.jsonl'), 'garbage\n');
  expect('NC6 a broken chain: stop:gate_red', root, 1, stopOf('gate_red'));
}
expect('NC7 a deviation observation of the checked wave: stop:deviation', plant({ obs: '{"type":"deviation","wave":2}\n' }), 2, stopOf('deviation'));
expect('NC8 the same line of wave 1 checked at wave 2: continue', plant({ obs: '{"type":"deviation","wave":1}\n' }), 2, ok);
expect('NC9 a gap observation does not stop: continue', plant({ obs: '{"type":"gap","wave":2}\n' }), 2, ok);
expect('NC10 a non-JSON observations line: stop:deviation', plant({ obs: 'not json\n' }), 1, stopOf('deviation'));
{
  const r = expect('NC11 a date-only Decisions row of the --since day: stop:scope_change', plant({ goal: `${GOAL_OK}- 2026-11-20 — chose x\n` }), 1, stopOf('scope_change'));
  check('NC11b the detail names the same-day repeat', /repeats for every wave of that day/.test(r.err), r.err);
}
expect('NC12 a date-only row of the day before: continue', plant({ goal: `${GOAL_OK}- 2026-11-19 — chose x\n` }), 1, ok);
expect('NC13 a row with the first token soon: stop:scope_change', plant({ goal: `${GOAL_OK}- soon — chose x\n` }), 1, stopOf('scope_change'));
expect('NC14 next wave in lane y without an agent: stop:agent_unnamed', plant({ plan: LANE_PLAN }), 1, stopOf('agent_unnamed'));
{
  const lanePlan3 = LANE_PLAN.replace('## Wave 2 - b', '## Wave 2 - b\n## Wave 3 - c');
  expect('NC15 next wave in lane x: continue', plant({ plan: lanePlan3.replace('waves: [2]', 'waves: [3]').replace('waves: [1]', 'waves: [1, 2]') }), 1, ok);
}
{
  const wp = path.join(WORK, 'wave-plan-bare.md');
  fs.writeFileSync(wp, WAVE_PLAN_BARE);
  expect('NC16 a wave-plan without Suggested agent for wave+1: stop:agent_unnamed', plant({}), 1, stopOf('agent_unnamed'), ['--plan', wp]);
}
expect('NC17 no plan file: stop:agent_unnamed', plant({ plan: null }), 1, stopOf('agent_unnamed'));
expect('NC18 --checkpoint-each-wave on a green setup: stop:owner_requested', plant({}), 1, stopOf('owner_requested'), ['--checkpoint-each-wave']);
{
  const root = plant({});
  const r = spawnSync(process.execPath, [TOOLS, 'wave', 'next-check', SLUG, '1', '--project', root], { cwd: WORK, env: ENV, encoding: 'utf8' });
  check('NC19 a missing --since: exit 2', r.status === 2, `rc=${r.status}`);
  const r2 = spawnSync(process.execPath, [TOOLS, 'wave', 'next-check', '../x', '1', '--since', SINCE, '--project', root], { cwd: WORK, env: ENV, encoding: 'utf8' });
  check('NC20 slug ../x: exit 2', r2.status === 2, `rc=${r2.status}`);
}
{
  const wp = path.join(WORK, 'wave-plan-ok.md');
  fs.writeFileSync(wp, WAVE_PLAN_OK);
  expect('NC21 wave 0 with a wave-plan naming an agent for wave 1 and a green log: continue', plant({}), 0, ok, ['--plan', wp]);
}
expect('NC22 gate red plus deviation: the first stop wins (gate_red)', plant({ log: [['2026-11-20T10:05:00.000Z', 'test-fidelity', 'fail']], obs: '{"type":"deviation","wave":1}\n' }), 1, stopOf('gate_red'));
{
  const r = expect('NC23 observations.jsonl absent: stop:deviation', plant({ obs: null }), 1, stopOf('deviation'));
  check('NC23b the detail says source_missing', /source_missing/.test(r.err), r.err);
}
{
  const r = expect('NC24 GOAL.md absent: stop:scope_change', plant({ goal: null }), 1, stopOf('scope_change'));
  check('NC24b the detail says source_missing', /source_missing/.test(r.err), r.err);
}
expect('NC25 GOAL.md without a Decisions heading: stop:scope_change', plant({ goal: '# Goal: x\n' }), 1, stopOf('scope_change'));
expect('NC26 an ISO row earlier the same day, before --since: continue', plant({ goal: `${GOAL_OK}- 2026-11-20T08:00:00Z — chose x\n` }), 1, ok);
expect('NC27 an ISO row after --since: stop:scope_change', plant({ goal: `${GOAL_OK}- 2026-11-20T10:30:00Z — chose x\n` }), 1, stopOf('scope_change'));
{
  const root = plant({ log: [['2026-11-20T10:00:59.034Z', 'test-fidelity', 'fail'], ['2026-11-20T10:05:00.000Z', 'lane-split', 'pass']] });
  const r = spawnSync(process.execPath, [TOOLS, 'wave', 'next-check', SLUG, '1', '--since', '2026-11-20T10:00:59Z', '--project', root], { cwd: WORK, env: ENV, encoding: 'utf8' });
  check('NC28 a fail record at :59.034Z with --since :59Z counts as since: stop:gate_red', (r.stdout || '').trim() === 'stop:gate_red' && r.status === 1, `out=${r.stdout} rc=${r.status}`);
}
{
  const wp = path.join(WORK, 'wave-plan-ok2.md');
  fs.writeFileSync(wp, WAVE_PLAN_OK);
  expect('NC29 wave 0 with no gate log and no stores, agent named: continue', plant({ log: null, obs: null, goal: null }), 0, ok, ['--plan', wp]);
}
{
  const wp = path.join(WORK, 'wave-plan-ok3.md');
  fs.writeFileSync(wp, WAVE_PLAN_OK);
  expect('NC30 a1-new-feature layout: wave-plan outside the repo, GOAL.md ISO row after --since: stop:scope_change', plant({ goal: `${GOAL_OK}- 2026-11-20T11:00:00Z — chose x\n` }), 1, stopOf('scope_change'), ['--plan', wp]);
}
{
  const root = plant({ plan: '# Plan\n\n## Wave 1 - a\n## Wave 2 - b\n' });
  expect('NC31a the default PLAN.md without a lanes key and without Suggested agent: continue (like lanes none)', root, 1, ok);
  expect('NC31b the same file passed with --plan: stop:agent_unnamed', root, 1, stopOf('agent_unnamed'), ['--plan', path.join(root, '.a1', 'phases', SLUG, 'PLAN.md')]);
}

// ---- review fix round 1 ----
const REAL = path.join(__dirname, '..', 'real');
{
  // NC32 (M2): headings and agent lines as they stand in real vault wave plans (copied, stripped to the needed lines).
  for (const [name, file] of [['ai-harness/008 inline "**Suggested agent(s):** <name>" under a heading without colon', 'wave-plan-inline-agent-ai-harness-008.md'], ['my-smart-home/004 "### Suggested agent(s):" with colon and bold bullets', 'wave-plan-colon-heading-my-smart-home-004.md']]) {
    expect(`NC32 real wave plan ${name}: continue`, plant({}), 1, ok, ['--plan', path.join(REAL, file)]);
  }
  const bare = path.join(WORK, 'colon-empty.md');
  fs.writeFileSync(bare, '# Wave plan\n\n## Wave 1: a\n\n### Suggested agent(s):\n\n- **a1-walter-web-developer**\n\n## Wave 2: b\n\n### Suggested agent(s):\n\nTBD later\n');
  expect('NC33 a colon heading without any name line or inline name: stop:agent_unnamed', plant({}), 1, stopOf('agent_unnamed'), ['--plan', bare]);
  const plain = path.join(WORK, 'plain-bullet.md');
  fs.writeFileSync(plain, '# Wave plan\n\n## Wave 1: a\n\n## Wave 2: b\n\n### Suggested agent(s)\n\n- a1-walter-web-developer (Sonnet) for 2a\n');
  expect('NC34 a non-bold "- <agent-id>" bullet counts: continue', plant({}), 1, ok, ['--plan', plain]);
  const empty = path.join(WORK, 'inline-empty.md');
  fs.writeFileSync(empty, '# Wave plan\n\n## Wave 1: a\n\n## Wave 2: b\n\n**Suggested agent(s):**\n');
  expect('NC35 an inline "**Suggested agent(s):**" with nothing after it: stop:agent_unnamed', plant({}), 1, stopOf('agent_unnamed'), ['--plan', empty]);
}
// NC36 (m4): the wave field of a stop-type observation must be an integer or absent.
expect('NC36a "wave": null on a deviation: stop:deviation', plant({ obs: '{"type":"deviation","wave":null}\n' }), 2, stopOf('deviation'));
expect('NC36b "wave": "x" on a blocker: stop:deviation', plant({ obs: '{"type":"blocker","wave":"x"}\n' }), 2, stopOf('deviation'));
expect('NC36c "wave": 1.5 on a deviation: stop:deviation', plant({ obs: '{"type":"deviation","wave":1.5}\n' }), 2, stopOf('deviation'));
expect('NC36d "wave": "2" (digits as a string) at wave 2: stop:deviation (as before)', plant({ obs: '{"type":"deviation","wave":"2"}\n' }), 2, stopOf('deviation'));
expect('NC36e "wave": "1" at wave 2: continue (as before)', plant({ obs: '{"type":"deviation","wave":"1"}\n' }), 2, ok);
expect('NC36f "wave": null on a gap observation: continue', plant({ obs: '{"type":"gap","wave":null}\n' }), 2, ok);
// NC37 (m5): a non-blank line under ## Decisions that is not a "- <token>" bullet stops.
expect('NC37a a plain-text decision line: stop:scope_change', plant({ goal: `${GOAL_OK}2026-11-20T11:00:00Z chose x\n` }), 1, stopOf('scope_change'));
expect('NC37b a "* " bullet: stop:scope_change', plant({ goal: `${GOAL_OK}* 2026-11-20T11:00:00Z chose x\n` }), 1, stopOf('scope_change'));
expect('NC37c a numbered row: stop:scope_change', plant({ goal: `${GOAL_OK}1. 2026-11-20T11:00:00Z chose x\n` }), 1, stopOf('scope_change'));
expect('NC37d a "-" row without a space: stop:scope_change', plant({ goal: `${GOAL_OK}-2026-11-20T11:00:00Z chose x\n` }), 1, stopOf('scope_change'));
expect('NC37e blank lines between old rows stay fine: continue', plant({ goal: `${GOAL_OK}\n- 2026-11-19 — chose x\n\n- 2026-11-20T08:00:00Z — chose y\n` }), 1, ok);

done();
