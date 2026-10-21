'use strict';
// Wave 11 (spec 017) call-site check: usage `node check-wave11-callsites.cjs <root>`.
// Reads the real wired files under <root>, extracts fenced-bash calls of the five
// gate commands and prints one line per problem plus "calls=<n>". Exit 1 on any
// problem. Allowed flags are copied from the CLI sources (verify-cli.cjs KNOWN_FLAGS,
// test-fidelity.cjs parseArgs, realpath-check.cjs, schema-check.cjs) plus the global --phase.
const fs = require('fs');
const path = require('path');
const { extractBashFenceLines, joinContinuations } = require(path.join(__dirname, '..', '..', '_shared', 'lib', 'workflow-lint.cjs'));

const root = process.argv[2];
const FLAGS = {
  'verify run': ['project', 'base', 'out', 'timeout-ms', 'phase'],
  'verify check': ['phase'],
  'test-fidelity': ['diff-base', 'project', 'phase'],
  'realpath-check run': ['diff-base', 'project', 'evidence', 'real-markers', 'json', 'phase'],
  'schema-check run': ['migrations', 'tables', 'trigger-pattern', 'json', 'phase'],
  'lane-split check': ['plan', 'imports', 'phase'],
};
// file -> [command, expected --phase placeholder, expected call count]
const FILES = {
  'skills/a1-execute/workflows/02-execute.md': ['<phase_name>', { 'realpath-check run': 1, 'schema-check run': 1, 'test-fidelity': 1, 'verify run': 1 }],
  'skills/a1-execute/workflows/03-verify.md': ['<phase_name>', { 'verify run': 1, 'verify check': 1 }],
  'skills/a1-execute/SKILL.md': ['<phase_name>', { 'lane-split check': 1 }],
  'skills/a1-new-feature/workflows/05-implement.md': ['<spec-id>', { 'schema-check run': 1, 'realpath-check run': 1, 'test-fidelity': 1, 'verify run': 1 }],
  'skills/a1-new-feature/workflows/06-verify.md': ['<spec-id>', { 'verify run': 1, 'verify check': 1 }],
  'agents/a1-victor-verifier.md': ['<phase>', { 'verify run': 1, 'verify check': 1 }],
};
const CMD_RE = /(?:a1-tools\.cjs|\$A1_TOOLS"?)\s+(verify\s+run|verify\s+check|test-fidelity|realpath-check\s+run|schema-check\s+run|lane-split\s+check)(?=\s|$)/;

const problems = [];
let calls = 0;
for (const [rel, [phase, want]] of Object.entries(FILES)) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const got = {};
  for (const l of joinContinuations(extractBashFenceLines(text))) {
    const m = CMD_RE.exec(l.text);
    if (!m || /^\s*(#|echo|printf)\b/.test(l.text)) continue;
    const cmd = m[1].replace(/\s+/g, ' ');
    got[cmd] = (got[cmd] || 0) + 1;
    calls += 1;
    const flags = [...l.text.matchAll(/\s--([a-z][a-z-]*)/g)].map((x) => x[1]);
    for (const f of flags) if (!FLAGS[cmd].includes(f)) problems.push(`${rel}:${l.lineNo} ${cmd}: unknown flag --${f}`);
    if (!l.text.includes(`--phase ${phase}`)) problems.push(`${rel}:${l.lineNo} ${cmd}: missing --phase ${phase}`);
    if (cmd !== 'lane-split check' && !/RC=\$\?/.test(l.text)) problems.push(`${rel}:${l.lineNo} ${cmd}: exit code not captured`);
  }
  for (const [cmd, n] of Object.entries(want)) {
    if ((got[cmd] || 0) !== n) problems.push(`${rel}: ${cmd} expected ${n} call(s), found ${got[cmd] || 0}`);
  }
}
for (const p of problems) console.log(p);
console.log(`calls=${calls}`);
process.exit(problems.length ? 1 : 0);
