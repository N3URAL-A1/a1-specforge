'use strict';
// Test harness for _shared/lib/probe-net.cjs (spec 020 wave 2). Not shipped; loopback only.
// usage: node harness.cjs <mode> <json> [<json2>]   modes: http | http-rawlookup | tcp | preflight | classify
// Prints one JSON line. http-rawlookup replaces the guarded lookup with one that always answers 127.0.0.1,
// so only the connected-address check can still block (rebinding case).
const path = require('path');
const net = require(path.join(__dirname, '..', '..', '..', '..', '_shared', 'lib', 'probe-net.cjs'));
const [mode, a] = process.argv.slice(2);
const arg = JSON.parse(a || 'null');
const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
const ctx = { env: process.env };
(async () => {
  if (mode === 'http') out(await net.runHttp(arg, ctx));
  else if (mode === 'http-rawlookup') {
    out(await net.runHttp(arg, { ...ctx, lookup: (h, o, cb) => (o && o.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) }));
  } else if (mode === 'tcp') out(await net.runTcp(arg, ctx));
  else if (mode === 'preflight') out(await net.preflight(arg, process.env));
  else if (mode === 'classify') out(arg.map((x) => net.classifyAddress(x)));
  else process.exit(2);
})().catch((e) => { process.stderr.write(`harness error: ${e && e.message}\n`); process.exit(2); });
