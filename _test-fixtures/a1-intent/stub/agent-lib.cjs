'use strict';

// stub/agent-lib.cjs — fixture-only driver for cases/13-agent.sh: calls
// cmdIntentInstallAgent through its library seam. Production has no seam an
// environment variable could reach. Everything comes from one JSON spec (argv
// arg 3), never from the environment:
//   { home, hostname, platform, uid, env: {..}, argv: [..], launchctl: <abs stub>,
//     tty: bool, answer: bool, context: "none"|"real", child: bool,
//     doctor: "clean"|"obsidian-open", psFile, lsofFile, capture: <file> }
// context "none": no Claude-Code refusal (the suite itself may run under it);
// "real": the shipped refusal runs (its env check short-circuits before the
// process walk when the spec's env carries CLAUDECODE).
// capture: the exec seam is replaced by a recorder (file + argv), to pin the
// absolute launchctl path without running anything.
//
//   node agent-lib.cjs <lib-dir> <spec-json>

const fs = require('fs');
const path = require('path');

const [lib, specText] = process.argv.slice(2);
const spec = JSON.parse(specText);
const agent = require(path.join(lib, 'intent-agent.cjs'));
const doctor = require(path.join(lib, 'intent-doctor.cjs'));

const readOr = (f) => (f ? fs.readFileSync(f, 'utf8') : '');
const psText = spec.doctor === 'obsidian-open' ? readOr(spec.psFile) : '';
const lsofText = spec.doctor === 'obsidian-open' ? readOr(spec.lsofFile) : '';
doctor.injectDoctorDeps({
  exec: (tool, argv) => {
    if (tool === 'ps') return { status: 0, stdout: psText, error: null };
    const i = argv.indexOf('-p');
    const pids = new Set(i === -1 ? [] : String(argv[i + 1]).split(','));
    const lines = lsofText.split('\n').filter((l) => l.trim() !== '');
    const hits = lines.slice(1).filter((l) => pids.has(l.trim().split(/\s+/)[1]));
    return hits.length === 0 ? { status: 1, stdout: '', error: null } : { status: 0, stdout: `${[lines[0], ...hits].join('\n')}\n`, error: null };
  },
});

const deps = {
  homedir: () => spec.home,
  hostname: spec.hostname,
  platform: spec.platform,
  uid: spec.uid,
  env: spec.env,
  isTty: () => spec.tty,
  confirm: () => spec.answer,
  isChild: () => spec.child === true,
  ...(spec.context === 'none' ? { contextRefusal: () => null } : {}),
  ...(spec.launchctl ? { launchctl: spec.launchctl } : {}),
  ...(spec.capture ? { exec: (file, argv) => { fs.appendFileSync(spec.capture, `${file}\t${argv.join('\t')}\n`); return { status: 0, stdout: '', stderr: '', error: null }; } } : {}),
};
agent.cmdIntentInstallAgent(spec.argv.slice(1), deps); // argv[0] is the subcommand name, as typed on the CLI
