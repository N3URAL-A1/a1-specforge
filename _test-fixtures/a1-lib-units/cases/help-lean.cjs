'use strict';

// help-lean.cjs: the help text of spec 027 slice 4 (PR A: pr review-record, pr review-evidence, wave next-check and the
// FR-020 reuse paragraph; PR B: wave checks, feature plan-steps, feature close). The call-site sweep (W13c/W14e) reads these blocks, so a missing block or a
// missing empty line before the reuse paragraph turns a fenced call red. Literals only (testing.md class 4).

const path = require('path');
const { spawnSync } = require('child_process');
const { check, done } = require('../lib.cjs');

const LIB = process.argv[2];
const { LEAN_HELP } = require(path.join(LIB, 'help-lean.cjs'));
const { HELP } = require(path.join(LIB, 'help.cjs'));
const TOOLS = path.join(LIB, '..', 'a1-tools.cjs');

const USAGE = [
  '  a1-tools pr review-record --head <sha> --verdict <pass|fail> --phase <scope>',
  '  a1-tools pr review-evidence --head <sha> --phase <scope>',
  '  a1-tools wave next-check <slug> <wave> --since <iso> [--project <dir>] [--plan <file>] [--checkpoint-each-wave]',
  '  a1-tools wave checks <slug> <wave> --diff-base <ref> [--project <dir>] [--migrations <dir>] [--phase <slug>]',
  '  a1-tools feature plan-steps <spec-path>',
  '  a1-tools feature close --by <spec-id> --pr <n> [--repo <dir>] [--spec <path>] [--worktree <id>]',
  '  a1-tools feature close --cleanup-only [--repo <dir>]',
];

// H1 LEAN_HELP reaches `a1-tools --help` (red: `${LEAN_HELP}` removed from HELP in help.cjs).
check('H1 HELP includes LEAN_HELP', HELP.includes(LEAN_HELP));
// H2 each usage line is a line of its own.
const lines = LEAN_HELP.split('\n');
for (const u of USAGE) check(`H2 usage line present: ${u.slice(0, 40)}`, lines.includes(u));
// H3 the real CLI prints them.
const r = spawnSync(process.execPath, [TOOLS, '--help'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
check('H3 --help exits 0', r.status === 0, String(r.status));
check('H3 --help names wave next-check', r.stdout.includes('wave next-check'));
check('H3 --help names wave checks, feature plan-steps and feature close', ['wave checks <slug>', 'feature plan-steps <spec-path>', 'feature close --by <spec-id>', 'feature close --cleanup-only'].every((t) => r.stdout.includes(t)));
check('H3 --help names pr review-evidence with --phase', r.stdout.includes('pr review-evidence --head <sha> --phase <scope>'));
// H4 the line before the reuse paragraph is empty (red: the empty line removed).
const at = lines.indexOf('  Input-hash reuse (spec 027 FR-020): `checklist run <slug>/<feature> --only 9,10,11`, `lane-split check` and');
check('H4 reuse paragraph present', at > 0, String(at));
check('H4 an empty line precedes the reuse paragraph', at > 0 && lines[at - 1] === '');
// H5 the paragraph has no `a1-tools` prefix, so the sweep parses no block from it.
check('H5 reuse paragraph carries no usage prefix', lines.slice(at).every((l) => !l.startsWith('  a1-tools')));

done();
