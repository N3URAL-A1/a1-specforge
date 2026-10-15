'use strict';

// Plugin hook entry (spec 016 FR-004): stdin = hook JSON, stdout/exit = the decision of _shared/lib/xprov-hook-rules.cjs.
// Anything unexpected throws and ends the process non-zero; xprov-consent-hook.sh turns that into exit 2 (fail closed).
const fs = require('fs');
const path = require('path');

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const rules = require(path.join(__dirname, '..', '_shared', 'lib', 'xprov-hook-rules.cjs'));

const raw = fs.readFileSync(0);
if (raw.length > MAX_INPUT_BYTES) throw new Error('hook input too large');
let payload;
try { payload = JSON.parse(raw.toString('utf8')); } catch (_e) { payload = null; }
const decision = rules.decide(payload);
const out = rules.hookOutput(decision, payload && payload.hook_event_name);
if (out.stdout) process.stdout.write(out.stdout);
if (out.stderr) process.stderr.write(out.stderr);
process.exitCode = out.exit;
