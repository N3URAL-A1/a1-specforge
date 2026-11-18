'use strict';

// stub/seal-lib.cjs — fixture-only: seals the sandbox's fake plugin through
// intent-seal's library call (the owner's TTY confirmation is injected), so
// a run case gets a real seal without a pty. The plugin source is prepared by
// cases/06-run.sh (w6_sandbox). Prints the seal's JSON result.
//
//   node seal-lib.cjs <lib-dir> <home> <hostname> [norewrite]
// norewrite: a seal made as if the B1 constant were false (skill_rewrite
// none), which `run` must refuse (review m3).
// refuse: the confirmation context refuses, so sealPlugin throws a real
// SealRefusal (the fix-suite-strips-root-write-bit regression case).
// A SealRefusal is printed as {ok:false,reason,message} on stdout, exit 1.

const path = require('path');

const [lib, home, hostname, mode] = process.argv.slice(2);
const { sealPlugin } = require(path.join(lib, 'intent-seal.cjs'));
try {
  const r = sealPlugin({
    homedir: () => home, hostname, isTty: () => true,
    contextRefusal: () => (mode === 'refuse' ? 'forced refusal (fixture)' : null),
    confirm: () => true, ...(mode === 'norewrite' ? { rewrite: false } : {}),
  });
  process.stdout.write(JSON.stringify(r));
} catch (e) {
  if (!e || !e.code || e.name === 'TypeError') throw e;
  process.stdout.write(JSON.stringify({ ok: false, reason: e.code, message: e.message }));
  process.exit(1);
}
