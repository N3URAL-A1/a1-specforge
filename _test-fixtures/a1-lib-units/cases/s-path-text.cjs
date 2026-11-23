'use strict';

// s-path-text.cjs (spec 027 FR-025, plan Task 9.1 / audit round 2 M2): the S branches of the four phase workflows agree
// with `feature plan-steps`: one Rene spawn on S, no second Rene spawn in Phases 2-3, no Vincente spawn in Phase 4.
// The workflow files are the REAL files of the repo; the step list is read from the real CLI on a planted spec.
// A paragraph is the run of non-blank lines that starts at the named line.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, done } = require('../lib.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const WF = path.join(ROOT, 'skills/a1-new-feature/workflows');
const WORK = fs.mkdtempSync(path.join(process.argv[3] || os.tmpdir(), 'sp-'));
const TOOLS = path.join(ROOT, '_shared/a1-tools.cjs');
const read = (f) => fs.readFileSync(path.join(WF, f), 'utf8');
const lines = (f) => read(f).split('\n');
function paragraph(file, startsWith) {
  const L = lines(file);
  const at = L.findIndex((l) => l.startsWith(startsWith));
  if (at < 0) return '';
  const out = [];
  for (let i = at; i < L.length && L[i].trim() !== ''; i += 1) out.push(L[i]);
  return out.join('\n');
}
const has = (text, words) => words.filter((w) => !text.includes(w));

// SP1 04-plan.md
const plan = read('04-plan.md');
const fast = paragraph('04-plan.md', '**Size-S fast path');
const step2 = plan.slice(plan.indexOf('## Step 2'), plan.indexOf('## Step 3'));
check('SP1 04-plan.md: the Size-S fast-path paragraph exists', fast !== '', 'paragraph missing');
check('SP1 04-plan.md: the paragraph names no Vincente agent and no `instruct`', !fast.includes('a1-vincente-vibe-optimizer') && !fast.includes('instruct'), fast);
check('SP1 04-plan.md: the paragraph names SendMessage, code_scope, ## Wave 1, ### Suggested agent(s), ## Depth Pass',
  has(fast, ['SendMessage', 'code_scope', '## Wave 1', '### Suggested agent(s)', '## Depth Pass']).length === 0,
  has(fast, ['SendMessage', 'code_scope', '## Wave 1', '### Suggested agent(s)', '## Depth Pass']).join(','));
check('SP1 04-plan.md: the Step 2 section holds `Size M/L only`', step2.includes('Size M/L only'), 'Step 2 section');

// SP2 01-discover.md
const disc = paragraph('01-discover.md', '**Size-S path');
check('SP2 01-discover.md: the Size-S path paragraph exists', disc !== '', 'paragraph missing');
check('SP2 01-discover.md: the paragraph names model "opus", 02-specify.md, 03-clarify.md, SendMessage, Gate C',
  has(disc, ['model: "opus"', '02-specify.md', '03-clarify.md', 'SendMessage', 'Gate C']).length === 0,
  has(disc, ['model: "opus"', '02-specify.md', '03-clarify.md', 'SendMessage', 'Gate C']).join(','));
check('SP2 01-discover.md: the old combined-pass wording is gone', !read('01-discover.md').includes('may be combined'));

// SP3 03-clarify.md
const clar = lines('03-clarify.md');
const skipAt = clar.map((l, i) => (l.includes('skip Step 2') && l.includes('SendMessage') ? i : -1)).filter((i) => i >= 0);
check('SP3 03-clarify.md: exactly one line holds `skip Step 2` and `SendMessage`', skipAt.length === 1, String(skipAt.length));
check('SP3 03-clarify.md: that line directly follows `regardless of size.`', skipAt.length === 1 && clar[skipAt[0] - 1] === 'regardless of size.');
check('SP3 03-clarify.md: that line covers the jumps back to Step 2 (3.5-1, 3.5-2, marker loop, kritis jumps)',
  skipAt.length === 1 && has(clar[skipAt[0]], ['3.5-1', '3.5-2', 'Step 3 marker loop', 'kritis jumps']).length === 0, skipAt.length === 1 ? clar[skipAt[0]] : '');

// SP4 02-specify.md
const spec = lines('02-specify.md');
const stepAt = spec.map((l, i) => (l.includes('Step 1 below is skipped') ? i : -1)).filter((i) => i >= 0);
check('SP4 02-specify.md: exactly one line holds `Step 1 below is skipped`', stepAt.length === 1, String(stepAt.length));
check('SP4 02-specify.md: that line directly follows `formality is never dropped.`', stepAt.length === 1 && spec[stepAt[0] - 1] === 'formality is never dropped.');

// SP5 CLI and text agree
const specFile = path.join(WORK, 's.md');
fs.writeFileSync(specFile, '---\ntype: spec\nstatus: draft\nsize: S\n---\n\n# Spec s\n');
const r = spawnSync(process.execPath, [TOOLS, 'feature', 'plan-steps', specFile], { cwd: WORK, env: { PATH: process.env.PATH, HOME: path.join(WORK, 'home'), TMPDIR: os.tmpdir() }, encoding: 'utf8', timeout: 60000 });
let steps = [];
try { steps = JSON.parse(r.stdout).steps; } catch (_e) { /* reported below */ }
const rene = steps.filter((s) => s.agent === 'a1-rene-requirement-engineer');
check('SP5 plan-steps on size S lists exactly one Rene step', r.status === 0 && rene.length === 1, `${r.status} ${r.stderr}`);
check('SP5 its resume list is gate-c-ac-dryrun, wave-plan', rene.length === 1 && JSON.stringify(rene[0].resume) === '["gate-c-ac-dryrun","wave-plan"]', JSON.stringify(rene[0]));
check('SP5 no Vincente step on size S', !steps.some((s) => s.agent === 'a1-vincente-vibe-optimizer'));
check('SP5 the wave-plan resume target holds in 04-plan.md (SP1) and the Gate C target in 03-clarify.md (SP3)',
  fast.includes('SendMessage') && !fast.includes('a1-vincente-vibe-optimizer') && skipAt.length === 1 && clar[skipAt[0]].includes('3.5-1'));
fs.rmSync(WORK, { recursive: true, force: true });
done();
