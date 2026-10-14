'use strict';

// stub/post-update-lib.cjs — fixture-only driver for cases/15-post-update.sh:
// calls cmdIntentPostUpdate through its library seam (deps.seal for the seal
// step, deps.agent for the install step). Production has no seam an
// environment variable could reach. Everything comes from one JSON spec:
//   { home, hostname, platform, uid, env: {..}, args: [..], launchctl: <abs stub>,
//     sealTty, agentTty, sealAnswer, agentAnswer: bool,
//     sealContext, agentContext: "none"|"real", child: bool }
// context "none": no Claude-Code refusal (the suite itself may run under it);
// "real": the shipped refusal runs. For the seal step it reads process.env
// (the case starts this driver with CLAUDECODE set); for the install step it
// reads spec.env.
//
//   node post-update-lib.cjs <lib-dir> <spec-json>

const path = require('path');

const [lib, specText] = process.argv.slice(2);
const spec = JSON.parse(specText);
const { cmdIntentPostUpdate } = require(path.join(lib, 'intent-post-update.cjs'));
const doctor = require(path.join(lib, 'intent-doctor.cjs'));

doctor.injectDoctorDeps({ exec: () => ({ status: 0, stdout: '', error: null }) }); // a clean doctor

const none = () => null;
const home = () => spec.home;
const deps = {
  seal: {
    homedir: home,
    hostname: spec.hostname,
    isTty: () => spec.sealTty,
    confirm: () => spec.sealAnswer,
    ...(spec.sealContext === 'none' ? { contextRefusal: none } : {}),
  },
  agent: {
    homedir: home,
    passwdHome: home,
    hostname: spec.hostname,
    platform: spec.platform,
    uid: spec.uid,
    env: spec.env,
    isTty: () => spec.agentTty,
    confirm: () => spec.agentAnswer,
    isChild: () => spec.child === true,
    ...(spec.agentContext === 'none' ? { contextRefusal: none } : {}),
    ...(spec.launchctl ? { launchctl: spec.launchctl } : {}),
  },
};
cmdIntentPostUpdate(spec.args, deps);
