'use strict';
// In-process probe for the dashboard read seam (suite a1-dashboard, part 03).
//   probe.cjs read  <file> <cwd> [<vaultRoot> <slug>]  -> {"ok":bool,"code","reason","len","trace":[...]}
//   probe.cjs walk  <repo> <vaultRoot> <slug>          -> {"read":[files],"refused":N,"text":"<all returned text>"}
//   probe.cjs clean <string>                           -> the cleanText result, raw
//   probe.cjs writer <slug> <vaultRoot>                -> JSON of writerCheck (env from the caller)
// A1_FX_SHARED points at the _shared dir under test (mutation snapshots).
const fs = require('fs');
const path = require('path');
const lib = path.join(process.env.A1_FX_SHARED, 'lib', 'dashboard-read.cjs');
const { readSource, cleanText, writerCheck } = require(lib);

function ctxFor(cwd, root, slug) {
  return { cwd, env: process.env, trace: [], ...(root ? { root, slug } : {}) };
}
function listFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out); else out.push(p);
  }
  return out;
}
const [cmd, a, b, c, d] = process.argv.slice(2);
if (cmd === 'read') {
  const ctx = ctxFor(b, c, d);
  let res;
  try { const t = readSource(a, ctx); res = { ok: true, len: t.length, text: t.slice(0, 200) }; } catch (e) { res = { ok: false, code: e.code, reason: e.reason }; }
  process.stdout.write(JSON.stringify({ ...res, trace: ctx.trace }) + '\n');
} else if (cmd === 'walk') {
  const ctx = ctxFor(a, b, c);
  const read = []; const refusedList = []; let refused = 0; let text = '';
  for (const f of [...listFiles(a, []), ...listFiles(path.join(b, 'project'), [])]) {
    try { text += readSource(f, ctx) + '\n'; read.push(f); } catch (_e) { refused += 1; refusedList.push(f); }
  }
  process.stdout.write(JSON.stringify({ read, refused, refusedList, text, trace: ctx.trace }) + '\n');
} else if (cmd === 'clean') {
  process.stdout.write(cleanText(a));
} else if (cmd === 'writer') {
  process.stdout.write(JSON.stringify(writerCheck(a, b, process.env)) + '\n');
} else { throw new Error('probe: unknown command'); }
