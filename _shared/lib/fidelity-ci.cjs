'use strict';

// ---------------------------------------------------------------------------
// fidelity-ci — spec 017 FR-021, rule `test-not-in-ci` (+ no_ci_config,
// unresolved_ci_match, ci_glob_not_in_workflow). Reads `.github/workflows/*.yml`
// `run:` lines with a minimal YAML reader, follows npm|pnpm|yarn scripts into
// package.json, and matches each changed test file against the include globs of
// the runner a command reaches (vitest, jest, pytest), or a `ci_globs` entry of
// `.a1/fidelity.json` that appears literally in a `run:` line. Nothing is
// executed. What cannot be resolved fails closed (`unresolved_ci_match`).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { globMatch, FidelityConfigError } = require('./fidelity-resolve.cjs');
const { readText, joinDir, parentOf, buildMatcher, judge } = require('./fidelity-ci-runners.cjs');

const WORKFLOW_DIR = '.github/workflows';
const MAX_DEPTH = 6;
const MAX_INVOCATIONS = 500;
const KEY_RE = /^( *)(- +)?([A-Za-z_][\w-]*) *:(?: +(.*))?$/;
const BLOCK_RE = /^[|>][+-]?[0-9]*(?: +#.*)?$/;
const SKIP_WORDS = new Set(['do', 'then', 'else', 'if', '!', 'time', 'sudo', 'exec', 'command', 'nohup']);
const MANAGERS = new Set(['npm', 'pnpm', 'yarn']);
const ALWAYS_OPAQUE = new Set(['make', 'tox', 'nox', 'turbo', 'nx', 'lerna', 'mocha', 'ava', 'playwright', 'cypress', 'bats']);
const OPAQUE_WITH_TEST = new Set(['bun', 'deno', 'go', 'cargo']);

// ---------- files ----------

function workflowFiles(root) {
  let names;
  try { names = fs.readdirSync(path.join(root, WORKFLOW_DIR)); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
    throw new FidelityConfigError(`unreadable ${WORKFLOW_DIR}: ${e.message}`);
  }
  return names.filter((n) => /\.ya?ml$/.test(n)).sort().map((n) => `${WORKFLOW_DIR}/${n}`);
}

function readCiConfig(root) {
  const text = readText(path.join(root, '.a1', 'fidelity.json'));
  if (text === null) return { ciGlobs: [], none: false, reason: '' };
  let cfg;
  try { cfg = JSON.parse(text); } catch (e) { throw new FidelityConfigError(`malformed .a1/fidelity.json: ${e.message}`); }
  const g = cfg.ci_globs;
  if (g !== undefined && !(Array.isArray(g) && g.every((x) => typeof x === 'string' && x !== '' && !x.includes('\0')))) {
    throw new FidelityConfigError('.a1/fidelity.json: "ci_globs" must be an array of non-empty strings');
  }
  if (cfg.ci !== undefined && cfg.ci !== 'none') throw new FidelityConfigError('.a1/fidelity.json: "ci" must be "none" when set');
  return { ciGlobs: g || [], none: cfg.ci === 'none', reason: typeof cfg.ci_reason === 'string' ? cfg.ci_reason.trim() : '' };
}

// ---------- minimal YAML: steps, run lines, block scalars ----------

const indentOf = (s) => s.length - s.trimStart().length;

function readBlock(lines, from, keyIndent) {
  const out = [];
  let i = from;
  while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > keyIndent)) { out.push(lines[i]); i++; }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  const min = out.filter((l) => l.trim() !== '').reduce((a, l) => Math.min(a, indentOf(l)), Infinity);
  return { text: out.map((l) => l.slice(Number.isFinite(min) ? min : 0)).join('\n'), next: i };
}

function scalar(v) {
  const t = v.trim();
  const close = t[0] === '"' || t[0] === "'" ? t.indexOf(t[0], 1) : -1;
  if (close > 0 && /^\s*(#.*)?$/.test(t.slice(close + 1))) return t.slice(1, close);
  return t.replace(/ +#.*$/, '');
}

function readValue(lines, m, i, keyIndent) {
  const first = m[4] === undefined ? '' : m[4];
  if (BLOCK_RE.test(first)) return readBlock(lines, i + 1, keyIndent);
  if (first === '') return { text: '', next: i + 1 };
  const parts = [first];
  let next = i + 1;
  while (next < lines.length && lines[next].trim() !== '' && !lines[next].trim().startsWith('#') && indentOf(lines[next]) > keyIndent) {
    parts.push(lines[next].trim());
    next++;
  }
  return { text: scalar(parts.join(' ')), next };
}

function parseSteps(text) {
  const lines = text.split(/\r?\n/);
  const steps = [];
  const stack = [];
  for (let i = 0; i < lines.length;) {
    const m = /^\s*(#|$)/.test(lines[i]) ? null : KEY_RE.exec(lines[i]);
    if (m === null) { i++; continue; }
    const keyIndent = m[1].length + (m[2] ? m[2].length : 0);
    const v = readValue(lines, m, i, keyIndent);
    if (m[2]) {
      while (stack.length > 0 && stack[stack.length - 1].indent >= keyIndent) stack.pop();
      const step = { indent: keyIndent, entries: [] };
      steps.push(step);
      stack.push(step);
    } else {
      while (stack.length > 0 && stack[stack.length - 1].indent > keyIndent) stack.pop();
    }
    const top = stack[stack.length - 1];
    if (top && top.indent === keyIndent) top.entries.push({ key: m[3], value: v.text, line: i + 1 });
    i = v.next;
  }
  return steps;
}

function collectRuns(root, files) {
  const runs = [];
  for (const workflow of files) {
    const text = readText(path.join(root, workflow));
    if (text === null) continue;
    for (const step of parseSteps(text)) {
      const wd = step.entries.find((e) => e.key === 'working-directory');
      for (const e of step.entries.filter((x) => x.key === 'run')) {
        runs.push({ workflow, line: e.line, text: e.value, wd: wd ? wd.value : '' });
      }
    }
  }
  return runs;
}

// ---------- shell: commands, scripts, runner invocations ----------

function tokenize(seg) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(seg)) !== null) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

function stripPrefix(t) {
  let i = 0;
  while (i < t.length) {
    const w = t[i];
    if (SKIP_WORDS.has(w) || /^[A-Za-z_]\w*=/.test(w)) i++;
    else if (w === 'env') { i++; while (t[i] === '-u') i += 2; } else break;
  }
  return t.slice(i);
}

function unwrap(t) {
  if (t[0] === 'npx' || t[0] === 'bunx') {
    let a = t.slice(1);
    while (a[0] && a[0].startsWith('-')) a = a.slice(1);
    return a;
  }
  if ((t[0] === 'pnpm' || t[0] === 'yarn') && (t[1] === 'exec' || t[1] === 'dlx')) return t.slice(2);
  if (t[0] === 'npm' && t[1] === 'exec') return t[2] === '--' ? t.slice(3) : t.slice(2);
  return t;
}

function managerCmd(mgr, args) {
  let cwd = null;
  let wide = false;
  let i = 0;
  for (; i < args.length && args[i].startsWith('-'); i++) {
    const f = args[i];
    if (['--prefix', '-C', '--dir', '--cwd'].includes(f)) cwd = args[++i];
    else if (['--filter', '-F', '--workspace'].includes(f)) { wide = true; i++; } else if (['-r', '--recursive', '--workspaces'].includes(f)) wide = true;
  }
  if (wide) return { kind: 'opaque', head: `${mgr} (workspace-wide run)` };
  const sub = args[i];
  if (sub === 'run' || sub === 'run-script') return args[i + 1] ? { kind: 'script', script: args[i + 1], cwd, optional: false } : null;
  if (sub === 'test' || sub === 't' || sub === 'tst') return { kind: 'script', script: 'test', cwd, optional: false };
  if (mgr !== 'npm' && sub && !sub.startsWith('-')) return { kind: 'script', script: sub, cwd, optional: true };
  return null;
}

function classify(raw) {
  const t = unwrap(stripPrefix(raw));
  const head = t[0] ? path.posix.basename(t[0]) : '';
  if (head === 'cd') return { kind: 'cd', dir: t[1] };
  if (head === 'vitest' || head === 'jest') return { kind: head, args: t.slice(1) };
  if (head === 'pytest' || head === 'py.test') return { kind: 'pytest', args: t.slice(1) };
  if (/^python3?$/.test(head) && t[1] === '-m' && t[2] === 'pytest') return { kind: 'pytest', args: t.slice(3) };
  if (MANAGERS.has(head)) return managerCmd(head, t.slice(1));
  if (ALWAYS_OPAQUE.has(head) || (OPAQUE_WITH_TEST.has(head) && t[1] === 'test')) return { kind: 'opaque', head };
  return null;
}

function findPackage(state, dir) {
  let d = dir;
  for (;;) {
    const rel = d ? `${d}/package.json` : 'package.json';
    if (!state.cache.has(rel)) {
      const text = readText(path.join(state.root, rel));
      let parsed = null;
      if (text !== null) {
        try { parsed = JSON.parse(text); } catch (e) { throw new FidelityConfigError(`malformed ${rel}: ${e.message}`); }
      }
      state.cache.set(rel, parsed);
    }
    const pkg = state.cache.get(rel);
    if (pkg !== null && typeof pkg === 'object') return { dir: d, pkg };
    if (d === '') return null;
    d = parentOf(d);
  }
}

function followScript(state, cmd, cwd, depth) {
  const dir = cmd.cwd ? joinDir(cwd, cmd.cwd) : cwd;
  if (dir === null) { state.unresolved.push(`package dir "${cmd.cwd}" is dynamic or outside the repo`); return; }
  if (depth >= MAX_DEPTH) { state.unresolved.push(`script nesting deeper than ${MAX_DEPTH}`); return; }
  const found = findPackage(state, dir);
  const scripts = found && found.pkg.scripts && typeof found.pkg.scripts === 'object' ? found.pkg.scripts : {};
  const body = scripts[cmd.script];
  if (typeof body !== 'string') {
    if (!cmd.optional) state.unresolved.push(`script "${cmd.script}" not found from ${dir || '.'}`);
    return;
  }
  const key = `${found.dir}:${cmd.script}`;
  if (state.seen.has(key)) return;
  state.seen.add(key);
  walkCommand(state, body, found.dir, depth + 1);
}

function applyCmd(state, cmd, cwd, depth) {
  if (cmd.kind === 'cd') {
    const d = joinDir(cwd, cmd.dir);
    if (d === null) state.unresolved.push(`cd "${cmd.dir}" is dynamic or outside the repo`);
    return d;
  }
  if (cmd.kind === 'opaque') state.unresolved.push(`unmodelled test command: ${cmd.head}`);
  else if (cmd.kind === 'script') followScript(state, cmd, cwd, depth);
  else if (state.invocations.length < MAX_INVOCATIONS) state.invocations.push({ kind: cmd.kind, cwd, args: cmd.args });
  return cwd;
}

function walkCommand(state, text, cwd, depth) {
  let here = cwd;
  const segments = text.replace(/\\\r?\n/g, ' ').split(/&&|\|\||;|\||\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const cmd = classify(tokenize(seg));
    if (cmd === null) continue;
    if (here === null && cmd.kind !== 'cd') state.unresolved.push('command runs after a cd into an unknown directory');
    else here = applyCmd(state, cmd, here, depth);
  }
}

// ---------- the rule ----------

function startState(root, runs) {
  const state = { root, cache: new Map(), seen: new Set(), invocations: [], unresolved: [] };
  for (const run of runs) {
    const cwd = run.wd ? joinDir('', run.wd) : '';
    if (cwd === null) state.unresolved.push(`working-directory "${run.wd}" is dynamic or outside the repo`);
    else walkCommand(state, run.text, cwd, 0);
  }
  return state;
}

function fileFinding(file, verdicts, state, ciGlobs) {
  if (ciGlobs.some((g) => globMatch(g, file)) || verdicts.includes('yes')) return [];
  if (verdicts.includes('unknown') || state.unresolved.length > 0) {
    const why = verdicts.includes('unknown') ? 'a runner reaches this file only through a dynamic filter or config' : state.unresolved[0];
    return [{ rule: 'unresolved_ci_match', file, line: 1, detail: why }];
  }
  return [{ rule: 'test-not-in-ci', file, line: 1, detail: 'no workflow-reachable runner glob or ci_globs entry matches this test file' }];
}

/** Repo-level rule for fidelity-rules REPO_RULES. @param {object} ctx {projectRoot, testFiles} */
function testNotInCi(ctx) {
  const tests = ctx.testFiles || [];
  const conf = readCiConfig(ctx.projectRoot);
  const files = workflowFiles(ctx.projectRoot);
  if (files.length === 0) {
    if (tests.length === 0 || (conf.none && conf.reason !== '')) return [];
    const detail = conf.none ? 'ci: none needs a non-empty ci_reason' : 'no .github/workflows and no ci: none with a reason in .a1/fidelity.json';
    return [{ rule: 'no_ci_config', file: WORKFLOW_DIR, line: 1, detail }];
  }
  const runs = collectRuns(ctx.projectRoot, files);
  const verified = conf.ciGlobs.filter((g) => runs.some((r) => r.text.includes(g)));
  const missing = conf.ciGlobs.filter((g) => !verified.includes(g))
    .map((g) => ({ rule: 'ci_glob_not_in_workflow', file: '.a1/fidelity.json', line: 1, detail: `ci_globs entry ${JSON.stringify(g)} appears in no workflow run: line` }));
  if (tests.length === 0) return missing;
  const state = startState(ctx.projectRoot, runs);
  const matchers = state.invocations.map((inv) => buildMatcher(state, inv));
  const perFile = tests.flatMap((f) => fileFinding(f, matchers.map((m) => judge(m, f)), state, verified));
  return [...missing, ...perFile];
}

module.exports = { testNotInCi, parseSteps };
