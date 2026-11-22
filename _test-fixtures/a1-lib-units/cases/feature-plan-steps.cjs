'use strict';

// feature-plan-steps.cjs (spec 027 FR-025, plan D15): `feature plan-steps` lists the steps of a feature run per spec size.
// The size comes from planted spec frontmatter; the output is read from the real CLI. Gate ids are checked against the
// REAL _shared/gates-registry.md. Literals only (testing.md class 4).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'ps-'));
const TOOLS = path.join(LIB, '..', 'a1-tools.cjs');
const { parseRegistryIds } = require(path.join(LIB, 'gate-ids.cjs'));
const REGISTRY = fs.readFileSync(path.join(LIB, '..', 'gates-registry.md'), 'utf8');
const ENV = { PATH: process.env.PATH, HOME: path.join(WORK, 'home'), TMPDIR: os.tmpdir() };

function spec(name, size) {
  const file = path.join(WORK, `${name}.md`);
  const fm = size === null ? 'type: spec\nstatus: draft' : `type: spec\nstatus: draft\nsize: ${size}`;
  fs.writeFileSync(file, `---\n${fm}\n---\n\n# Spec ${name}\n`);
  return file;
}
function run(args) {
  const r = spawnSync(process.execPath, [TOOLS, 'feature', 'plan-steps', ...args], { cwd: WORK, env: ENV, encoding: 'utf8', timeout: 60000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (_e) { /* no JSON on usage errors */ }
  return { rc: r.status, json, out: r.stdout, err: r.stderr };
}
const S = run([spec('s', 'S')]);
const M = run([spec('m', 'M')]);
const L = run([spec('l', 'L')]);
const steps = (r) => (r.json ? r.json.steps : []);
const ids = (r) => steps(r).map((s) => s.id);
const agents = (r) => steps(r).map((s) => s.agent);
const gates = (r) => steps(r).filter((s) => s.kind === 'gate').map((s) => s.id);

check('PS0 all three sizes exit 0', S.rc === 0 && M.rc === 0 && L.rc === 0, `${S.rc}/${M.rc}/${L.rc} ${S.err}`);
check('PS1 S has fewer unconditional spawns than M', S.json.spawns < M.json.spawns, `${S.json.spawns} vs ${M.json.spawns}`);
eq('PS1 counts: S 3 (merged Rene, code agents, Reinhard), M 7', [S.json.spawns, M.json.spawns], [3, 7]);
check('PS2 S has no Vincente, Diana or Tobi step', !agents(S).some((a) => ['a1-vincente-vibe-optimizer', 'a1-diana-docs', 'a1-tobi-tester'].includes(a)), agents(S).join(','));
check('PS2 every Reinhard step of S is at pr-review', steps(S).filter((s) => s.agent === 'a1-reinhard-reviewer').every((s) => s.phase === 'pr-review'));
const rene = steps(S).filter((s) => s.agent === 'a1-rene-requirement-engineer');
check('PS3 S has exactly one Rene spawn', rene.length === 1, String(rene.length));
eq('PS3 the S Rene spawn: phase, model, resume', [rene[0].phase, rene[0].model, rene[0].resume], ['1-4', 'opus', ['gate-c-ac-dryrun', 'wave-plan']]);
check('PS4 every M gate is in S', gates(M).every((g) => gates(S).includes(g)), `${gates(M)} / ${gates(S)}`);
check('PS4 the gate lists have 8 entries', gates(S).length === 8 && S.json.gates === 8, String(gates(S).length));
check('PS5 every S step except the merged Rene is in M', ids(S).filter((i) => i !== 'rene-discover-specify-clarify').every((i) => ids(M).includes(i)), ids(S).join(','));
eq('PS6 M list equals L list', M.json.steps, L.json.steps);
const registry = new Set(parseRegistryIds(REGISTRY));
const badGates = steps(M).concat(steps(S)).filter((s) => s.gate !== undefined && !registry.has(s.gate)).map((s) => s.gate);
check('PS7 every gate value is a row id of the real registry', badGates.length === 0 && registry.size > 20, badGates.join(','));
const NO = run([spec('none', null)]);
check('PS8 a spec without size: exit 1 no_size', NO.rc === 1 && NO.json && NO.json.reason === 'no_size', `${NO.rc} ${NO.out}`);
const BAD = run([spec('bad', 'XL')]);
check('PS8 an invalid size also exits 1 no_size', BAD.rc === 1 && BAD.json && BAD.json.reason === 'no_size');
check('PS9 no argument: exit 2', run([]).rc === 2);
check('PS9 a missing file: exit 2', run([path.join(WORK, 'absent.md')]).rc === 2);
check('PS10 pr-review-reinhard is in S and M', ids(S).includes('pr-review-reinhard') && ids(M).includes('pr-review-reinhard'));
check('PS11 every step with when carries a string', steps(S).concat(steps(M)).filter((s) => 'when' in s).every((s) => typeof s.when === 'string'));
const when = (r, id) => (steps(r).find((s) => s.id === id) || {}).when;
eq('PS11 uwe-ux: S on_request, M ui_surface', [when(S, 'uwe-ux'), when(M, 'uwe-ux')], ['on_request', 'ui_surface']);
check('PS11 both Samuel steps are in S', ids(S).includes('samuel-threat-model') && ids(S).includes('samuel-security-wave'));
eq('PS12 tobi-audit: in M with on_request, not in S', [ids(M).includes('tobi-audit'), when(M, 'tobi-audit'), ids(S).includes('tobi-audit')], [true, 'on_request', false]);
eq('PS13 the four conditional spawns carry when', ['uwe-ux', 'samuel-threat-model', 'samuel-security-wave', 'tobi-audit'].map((i) => when(M, i)), ['ui_surface', 'kritis_profile', 'security_surface', 'on_request']);

done();
