'use strict';

// `feature plan-steps <spec-path>` (spec 027 FR-025, plan D15): the step list of a feature run as data, per spec size.
// `steps[]` lists every fixed and every conditional step; a step with `when` runs when its phase workflow finds the
// condition true. `spawns` counts the unconditional spawns. S merges Discover + Specify + Clarify into one Rene spawn
// (opus) that the Gate C dispatch and the S single-wave plan resume via SendMessage (`resume`), so no Vincente runs on S.

const fs = require('fs');
const { parseFrontmatter } = require('./io-frontmatter.cjs');
const { SPEC_SIZES } = require('./status-constants.cjs');
const { emitExit } = require('./emit-exit.cjs');

const USAGE = 'a1-tools feature plan-steps <spec-path>';
const ALL = Object.freeze(['S', 'M', 'L']);
const ML = Object.freeze(['M', 'L']);
const RENE = 'a1-rene-requirement-engineer';
const SAMUEL = 'a1-samuel-security';

const spawn = (id, agent, model, phase, sizes, extra) => Object.freeze({ id, kind: 'spawn', agent, model, phase, sizes, ...extra });
const gate = (id, phase) => Object.freeze({ id, kind: 'gate', gate: id, phase, sizes: ALL });

/** Order is the run order. `when` is a string, or one string per size. */
const STEPS = Object.freeze([
  gate('roadmap-gate', '0'),
  spawn('rene-discover', RENE, 'sonnet', '1', ML),
  spawn('rene-specify', RENE, 'sonnet', '2', ML),
  spawn('rene-clarify', RENE, 'opus', '3', ML),
  spawn('rene-discover-specify-clarify', RENE, 'opus', '1-4', ['S'], { resume: Object.freeze(['gate-c-ac-dryrun', 'wave-plan']) }),
  spawn('uwe-ux', 'a1-uwe-ux-expert', 'sonnet', '3', ALL, { when: Object.freeze({ S: 'on_request', M: 'ui_surface', L: 'ui_surface' }) }),
  spawn('samuel-threat-model', SAMUEL, 'opus', '3', ALL, { when: 'kritis_profile' }),
  gate('gate-c-ac-dryrun', '3'),
  spawn('vincente-wave-plan', 'a1-vincente-vibe-optimizer', 'opus', '4', ML),
  spawn('samuel-security-wave', SAMUEL, 'opus', '4-5', ALL, { when: 'security_surface' }),
  gate('gate-4.5-fr-consistency', '4.5'),
  gate('scope-claim', '4.5'),
  gate('isolation-gate', '5'),
  spawn('code-agents', 'per_wave_plan', 'sonnet', '5', ALL),
  gate('test-fidelity', '5'),
  gate('gate-1-build', '5'),
  spawn('diana-docs-drift', 'a1-diana-docs', 'sonnet', '6', ML),
  spawn('tobi-audit', 'a1-tobi-tester', 'sonnet', '6', ML, { when: 'on_request' }),
  spawn('pr-review-reinhard', 'a1-reinhard-reviewer', 'opus', 'pr-review', ALL),
  gate('pr-merge-check', 'pr-review'),
]);

/**
 * @param {string} size one of S, M, L
 * @returns {Array<{id: string, kind: string, agent?: string, gate?: string, model?: string, phase: string, when?: string, resume?: string[]}>}
 */
function stepsFor(size) {
  return STEPS.filter((s) => s.sizes.includes(size)).map(({ sizes, when, resume, ...rest }) => ({
    ...rest,
    ...(when === undefined ? {} : { when: typeof when === 'string' ? when : when[size] }),
    ...(resume === undefined ? {} : { resume: [...resume] }),
  }));
}

/** @param {string[]} rest */
function cmdPlanSteps(rest) {
  if (rest.length !== 1 || rest[0].startsWith('--')) return emitExit(2, '', `feature plan-steps: exactly one <spec-path> is required\nusage: ${USAGE}\n`);
  let text;
  try { text = fs.readFileSync(rest[0], 'utf8'); } catch (e) { return emitExit(2, '', `feature plan-steps: cannot read ${JSON.stringify(rest[0])}: ${e.code || e.message}\nusage: ${USAGE}\n`); }
  let size = null;
  try { size = parseFrontmatter(text).fm.size; } catch (_e) { /* a broken frontmatter has no size */ }
  if (typeof size !== 'string' || !SPEC_SIZES.has(size)) {
    return emitExit(1, `${JSON.stringify({ ok: false, reason: 'no_size', spec: rest[0] })}\n`, 'feature plan-steps: the spec frontmatter has no size S, M or L\n');
  }
  const steps = stepsFor(size);
  const spawns = steps.filter((s) => s.kind === 'spawn' && s.when === undefined).length;
  const gates = steps.filter((s) => s.kind === 'gate').length;
  return emitExit(0, `${JSON.stringify({ spec: rest[0], size, steps, spawns, gates })}\n`, '');
}

module.exports = { STEPS, stepsFor, cmdPlanSteps };
