'use strict';
// Source guard for fix 2026-11-05-stdout-pipe-truncation.
// Usage: node exit-after-write-guard.cjs <repo-root>
// Exit 0 = clean, 1 = violations, 2 = usage.
//
// Rule (function scoped, whole _shared/**/*.cjs): inside one function body, a stdout write
// (or a stderr write inside a loop) that is followed LATER in the same body by an exit is a
// violation. An exit is `process.exit(`, `exitWithLock(`, or a call to an exiting helper.
// Exiting helpers are discovered, not hand-listed: every function in _shared whose body
// exits or calls an exiting helper (fixpoint), minus emitExit / emitExitWithLock, which drain
// first and are the sanctioned way out. Output emitted before a later exit is cut at one pipe
// buffer on macOS, whatever sits between the write and the exit (a stderr loop, a branch).
// Platform neutral: reads source text, so it works on Linux where the truncation cannot happen.
//
// Limits (honest): top-level bodies only, closing `}` / `};` at column 0: `function name(`
// declarations plus `const|let|var name = [async] function (...) {`, `= (...) => {` and
// `= x => {` (parameters on one line; a trailing `// comment` after the `{` is allowed).
// Known false negatives (the function is not seen at all, so a write-then-exit in it passes):
//   - parentheses inside default parameters: `= (a = f()) => {`
//   - `exports.x = function (...) {` / `module.exports.x = ...` (not a const|let|var binding)
//   - parameters spread over several lines
//   - a body written on one line: `const f = () => { write(); process.exit(0); };`
// Nested closures count as part of the enclosing function, and are never collected on their own
// (a local `finish` in one file must not become a repo-wide exiting helper). emit-exit.cjs is
// scanned like every other file. Helpers are matched by name, not by resolved require.
// Cross-function gap: a print helper that only writes (the caller exits) is NOT followed; ticket
// idea/a1-specforge-guard-cross-function-write-exit.md (vault). An exit on a branch exclusive to
// the write is a false positive and needs an EXCEPTIONS entry. Exits BEFORE the first write are
// not flagged (nothing queued).
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) { console.error('usage: exit-after-write-guard.cjs <repo-root>'); process.exit(2); }

// "file:function" -> reason. Keep explicit; one reason per entry.
const EXCEPTIONS = {};
const DRAINING = new Set(['emitExit', 'emitExitWithLock']);

function listCjs(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') listCjs(full, out); }
    else if (e.name.endsWith('.cjs')) out.push(full);
  }
  return out;
}
const DECL_RE = /^(?:async )?function (\w+)\(/;
// const|let|var name = [async] function [id](...) {   |   = [async] (...) => {   |   = [async] x => {
const EXPR_RE = /^(?:const|let|var) (\w+) = (?:async )?(?:function\b[^(]*\(.*\{|(?:\([^)]*\)|\w+) => \{)\s*(?:\/\/.*)?$/;
const isCode = (l) => !/^\s*(\/\/|\*|\/\*)/.test(l);

const fns = [];
for (const f of listCjs(path.join(root, '_shared'), [])) {
  const rel = path.relative(root, f).split(path.sep).join('/');
  const L = fs.readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < L.length; i++) {
    const m = DECL_RE.exec(L[i]) || EXPR_RE.exec(L[i]);
    if (!m) continue;
    let j = i;
    while (j < L.length && !/^}/.test(L[j])) j++;
    fns.push({ rel, name: m[1], start: i + 1, body: L.slice(i, j + 1) });
  }
}
if (!fns.some((f) => f.name === 'emitExit')) { console.error('emit-exit.cjs missing'); process.exit(1); }

const reCache = new Map();
const callRe = (n) => { if (!reCache.has(n)) reCache.set(n, new RegExp(`(^|[^.\\w])${n}\\(`)); return reCache.get(n); };
// A name resolves to the helper defined in the SAME file when there is one (so two files that
// each define their own `fail2` do not collide); otherwise to the repo-wide set (imported helpers).
const localNames = new Map();
for (const fn of fns) { if (!localNames.has(fn.rel)) localNames.set(fn.rel, new Set()); localNames.get(fn.rel).add(fn.name); }
const exitingLocal = new Map(); // rel -> Set(name)
const exitingGlobal = new Set(); // names
const markExiting = (fn) => {
  if (!exitingLocal.has(fn.rel)) exitingLocal.set(fn.rel, new Set());
  exitingLocal.get(fn.rel).add(fn.name); exitingGlobal.add(fn.name);
};
const callsExit = (fn, l) => {
  if (!/\w\(/.test(l)) return false;
  const loc = localNames.get(fn.rel); const ex = exitingLocal.get(fn.rel);
  for (const n of exitingGlobal) {
    const hit = loc.has(n) ? ex && ex.has(n) : true;
    if (hit && l.includes(n) && callRe(n).test(l)) return true;
  }
  return false;
};
for (const fn of fns) {
  if (DRAINING.has(fn.name)) continue;
  if (fn.body.some((l) => isCode(l) && /process\.exit\(/.test(l))) markExiting(fn);
}
for (let changed = true; changed;) {
  changed = false;
  for (const fn of fns) {
    const ex = exitingLocal.get(fn.rel);
    if ((ex && ex.has(fn.name)) || DRAINING.has(fn.name)) continue;
    if (fn.body.slice(1).some((l) => isCode(l) && callsExit(fn, l))) { markExiting(fn); changed = true; }
  }
}
const isExit = (fn, l) => isCode(l) && (/process\.exit\(/.test(l) || callsExit(fn, l));

function firstWrite(body) {
  for (let i = 0; i < body.length; i++) {
    const l = body[i];
    if (!isCode(l)) continue;
    if (/process\.stdout\.write\(/.test(l)) return i;
    if (!/process\.stderr\.write\(/.test(l)) continue;
    if (/^\s*(for|while)\b.*process\.stderr\.write\(|\.forEach\(.*process\.stderr\.write\(/.test(l)) return i; // one-line loop
    // stderr counts only inside a loop: the nearest less-indented line is the loop head
    const ind = l.match(/^\s*/)[0].length;
    for (let k = i - 1; k >= 0; k--) {
      const kl = body[k];
      if (kl.trim() === '' || kl.match(/^\s*/)[0].length >= ind) continue;
      if (/^\s*(for|while)\b|\.forEach\(/.test(kl)) return i;
      break;
    }
  }
  return -1;
}

const violations = [];
for (const fn of fns) {
  if (DRAINING.has(fn.name)) continue;
  const w = firstWrite(fn.body);
  if (w < 0) continue;
  const hit = fn.body.findIndex((l, i) => i > w && isExit(fn, l));
  if (hit < 0) continue;
  if (EXCEPTIONS[`${fn.rel}:${fn.name}`]) continue;
  violations.push(`${fn.rel}:${fn.start + w}: ${fn.name}() writes output, then exits at line ${fn.start + hit}: ${fn.body[hit].trim().slice(0, 70)}`);
}

// A file that calls emitExit / emitExitWithLock must import it (a missing import is a ReferenceError
// that only shows when the path runs; workflow-lint shipped that way once in this fix).
for (const f of listCjs(path.join(root, '_shared'), [])) {
  const rel = path.relative(root, f).split(path.sep).join('/');
  const src = fs.readFileSync(f, 'utf8').split('\n').filter(isCode).join('\n');
  for (const name of DRAINING) {
    if (!new RegExp(`(^|[^.\\w])${name}\\(`).test(src)) continue;
    const defined = new RegExp(`function ${name}\\(`).test(src);
    const imported = new RegExp(`\\b${name}\\b[^;]*require\\(|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*require\\(`).test(src);
    if (!defined && !imported) violations.push(`${rel}: calls ${name}() without importing it`);
  }
}

if (violations.length) {
  console.error(violations.join('\n'));
  console.error(`exit-after-write guard: ${violations.length} violation(s)`);
  process.exit(1);
}
console.log('exit-after-write guard: clean');
