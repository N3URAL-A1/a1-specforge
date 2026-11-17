'use strict';

// Generator and checker of the `affected` map in `.a1/verify.json` (spec 027 slice 2, FR-006, D5/D6).
//   verify affected-map --traces <dir> [--allow-red <id,...>]   map from `bin/affected-trace.sh` output (prints, writes nothing)
//   verify affected-map --check                                 dead keys and unknown selectors (D6)
//   verify affected-map --list-ids                              the plan command ids, one per line
// Also the strace line parser that `bin/affected-trace.sh` pipes into (`node verify-affected-map.cjs --parse-trace <root>`).
// Exit 0 ok / 1 trace_missing, trace_red, findings / 2 usage, bad config.

const fs = require('fs');
const path = require('path');
const { parseFlags } = require('./io.cjs');
const { emitExit } = require('./emit-exit.cjs');
const { gitRaw } = require('./verify-check.cjs');
const { VerifyError, resolveCommands } = require('./verify-run.cjs');
const { validateAffectedConfig, selectorMatches } = require('./verify-affected.cjs');

const KNOWN_FLAGS = { traces: 'string', check: 'bool', 'list-ids': 'bool', 'allow-red': 'string', project: 'string' };
const MAX_ARG_LENGTH = 4096;
const MAX_TRACE_BYTES = 32 * 1024 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_DISK_FILES = 500000;
const PX = 'pending:';

// ---------- strace line parser ----------

function unescapeStrace(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const n = s[++i];
    const simple = { n: 10, t: 9, r: 13, v: 11, f: 12, a: 7, b: 8, '\\': 92, '"': 34 };
    if (n in simple) bytes.push(simple[n]);
    else if (n === 'x') { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else if (/[0-7]/.test(n)) { const m = /^[0-7]{1,3}/.exec(s.slice(i)); bytes.push(parseInt(m[0], 8)); i += m[0].length - 1; }
    else bytes.push(...Buffer.from(n, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

function toRel(abs, root) {
  const rel = path.posix.relative(root, path.posix.normalize(abs));
  if (rel === '') return '.';
  return rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel) ? null : rel;
}

/** Joins the pending half of an `<unfinished ...>` line with its `<... resumed>` line; null when there is nothing to parse yet. */
function joinSplit(pid, rest, state) {
  const un = /^(.*?)\s*<unfinished \.\.\.>\s*$/.exec(rest);
  if (un) { state.set(PX + pid, un[1]); return null; }
  const rs = /^<\.\.\. [a-z_0-9]+ resumed>(.*)$/.exec(rest);
  if (!rs) return rest;
  const head = state.get(PX + pid);
  state.delete(PX + pid);
  return head === undefined ? null : head + rs[1];
}

/**
 * Parses one `strace -f -y -e trace=%file,fchdir` line (D5, Depth Pass answer 3). Pure apart from `state`.
 * @param {string} line one strace line
 * @param {Map<string,string>} state pid -> cwd (and pending split lines); updated in place
 * @param {string} root absolute repo root
 * @returns {{rel: string, kind: 'F'|'D'}|{unresolved: string}|null} a repo-relative path read (`.` is the root itself), an
 *   unresolvable relative path (names the syscall), or null (not a path event, or outside `root`)
 */
function parseTraceLine(line, state, root) {
  const pm = /^(\d+)\s+(.*)$/.exec(line);
  const pid = pm ? pm[1] : '0';
  const rest = joinSplit(pid, pm ? pm[2] : line, state);
  if (rest === null || rest.startsWith('---') || rest.startsWith('+++')) return null;
  const cm = /^([a-z_0-9]+)\((.*)$/s.exec(rest);
  if (!cm) return null;
  const [, name, tail] = cm;
  const at = tail.lastIndexOf(') = ');
  const args = at < 0 ? tail : tail.slice(0, at);
  const ret = at < 0 ? null : /^(-?\d+)(?:<(.*?)>)?(?:\s|$)/.exec(tail.slice(at + 4));
  const okRet = ret !== null && !ret[1].startsWith('-');
  if (name === 'fchdir') {
    const fm = /^\d+<(.*)>$/.exec(args);
    if (fm && okRet && fm[1].startsWith('/')) state.set(pid, fm[1]);
    return null;
  }
  const dm = /^(AT_FDCWD|\d+)(?:<([^>]*)>)?, /.exec(args);
  const body = dm ? args.slice(dm[0].length) : args;
  if (dm && dm[1] === 'AT_FDCWD' && dm[2] && dm[2].startsWith('/')) state.set(pid, dm[2]);
  const sm = /^"((?:[^"\\]|\\.)*)"(\.\.\.)?/s.exec(body);
  if (!sm || sm[2]) return null;
  const str = unescapeStrace(sm[1]);
  let abs = null;
  const isOpen = name.startsWith('open') && okRet;
  if (isOpen && ret[2] && ret[2].startsWith('/')) abs = ret[2];
  else if (str.startsWith('/')) abs = str;
  else {
    const base = dm && dm[1] !== 'AT_FDCWD' ? dm[2] : (dm && dm[2]) || state.get(pid);
    if (base && base.startsWith('/')) abs = str === '' ? base : path.posix.join(base, str);
  }
  if (abs === null) return { unresolved: name };
  if (name === 'chdir' && okRet) state.set(pid, path.posix.normalize(abs));
  const rel = toRel(abs, root);
  if (rel === null) return null;
  return { rel, kind: isOpen && /O_DIRECTORY/.test(args) ? 'D' : 'F' };
}

function parseTraceMain(root) {
  const norm = path.posix.normalize(root).replace(/\/+$/, '') || '/';
  const state = new Map();
  const seen = new Set();
  const rl = require('readline').createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const r = parseTraceLine(line, state, norm);
    if (r === null) return;
    seen.add('unresolved' in r ? `?\t${r.unresolved}` : `${r.rel}\t${r.kind}`);
  });
  rl.on('close', () => {
    const text = Array.from(seen).sort().map((l) => `${l}\n`).join('');
    emitExit(0, text, '');
  });
}

// ---------- map building ----------

function topFileKey(parts, file) {
  const [a, b, c] = parts;
  if (a === '_test-fixtures' && parts.length > 2) return `_test-fixtures/${b}/`;
  if (a === '_shared' && file === '_shared/a1-tools.cjs') return null;
  if (a === '_shared' && b === 'lib' && parts.length === 3) { const i = c.indexOf('-'); return i < 0 ? file : `_shared/lib/${c.slice(0, i + 1)}`; }
  if (a === '_shared' && parts.length === 2) return file;
  if (a === '_shared' && b === 'lib') return `_shared/lib/${c}/`;
  if (a === '_shared') return `_shared/${b}/`;
  if (a === 'skills' && parts.length > 2) return `skills/${b}/`;
  if (a === 'agents' && parts.length > 1) return file;
  if (a === 'docs' && parts.length > 1) return parts.length === 2 ? file : `docs/${b}/`;
  if (a === '.a1' && b === 'phases' && parts.length > 2) return '.a1/phases/';
  if (parts.length === 1) return file;
  return `${a}/`;
}

/**
 * Candidate map keys (D5), built from the tracked files. `_shared/a1-tools.cjs` gets none (it is a hard full path).
 * @param {string[]} trackedFiles repo-relative paths
 * @returns {string[]} sorted, unique keys
 */
function candidateKeys(trackedFiles) {
  const keys = new Set();
  for (const f of trackedFiles) {
    const k = topFileKey(f.split('/'), f);
    if (k !== null) keys.add(k);
  }
  return Array.from(keys).sort();
}

function listedJoins(dir, key) {
  const k = key.endsWith('/') ? key.slice(0, -1) : key;
  const parent = path.posix.dirname(k);
  if (dir === parent) return true;
  return key.endsWith('/') && (dir === k || dir.startsWith(key));
}

function suiteInKey(rs, key) {
  return rs.touched.some((p) => p.startsWith(key)) || rs.listed.some((d) => listedJoins(d, key));
}

function compress(ids, planIds) {
  const inSet = new Set(ids);
  const out = new Set();
  const dirs = new Set(ids.map((i) => (i.includes('/') ? `${path.posix.dirname(i)}/` : null)).filter(Boolean));
  const covered = new Set();
  for (const d of dirs) {
    const under = planIds.filter((p) => p.startsWith(d));
    if (under.every((p) => inSet.has(p))) { out.add(d); under.forEach((p) => covered.add(p)); }
  }
  for (const i of ids) if (!covered.has(i)) out.add(i);
  return Array.from(out).sort();
}

/**
 * The `affected` map from measured read sets (D5). A key is kept only when its suite set is not the full set (and not
 * empty: an empty selector list is invalid, so such a key is omitted and means "full").
 * @param {{readSets: Object<string, {touched: string[], listed: string[], unresolved: number}>, planIds: string[], trackedFiles: string[], alwaysIds?: string[]}} a
 * @returns {{affected: Object<string,string[]>, stats: {suites: number, keys_total: number, keys_kept: number, always_selected: string[]}}}
 */
function buildMap({ readSets, planIds, trackedFiles, alwaysIds = [] }) {
  const keys = candidateKeys(trackedFiles);
  const always = new Set(alwaysIds.filter((i) => planIds.includes(i)));
  for (const id of planIds) if (!readSets[id] || readSets[id].unresolved > 0) always.add(id);
  const affected = {};
  for (const key of keys) {
    const set = planIds.filter((id) => always.has(id) || suiteInKey(readSets[id], key));
    if (set.length === 0 || set.length === planIds.length) continue;
    affected[key] = compress(set, planIds);
  }
  return { affected, stats: { suites: planIds.length, keys_total: keys.length, keys_kept: Object.keys(affected).length, always_selected: Array.from(always).sort() } };
}

/**
 * Staleness findings (D6): a key with no tracked file under it, a selector that matches no plan command.
 * @param {string} project repo root (unused for IO; the config and files are passed in)
 * @param {object} cfg parsed .a1/verify.json
 * @param {string[]} planIds
 * @param {string[]} trackedFiles
 * @returns {{findings: Array<{rule: 'dead_key'|'unknown_selector', key?: string, selector?: string}>}}
 * @throws {VerifyError} bad_config when `affected`/`smoke` violate D4
 */
function checkMap(project, cfg, planIds, trackedFiles) {
  const v = validateAffectedConfig(cfg);
  if (v === null) return { findings: [] };
  const findings = [];
  for (const [key, sels] of v.keys) {
    if (!trackedFiles.some((f) => f.startsWith(key))) findings.push({ rule: 'dead_key', key });
    for (const s of sels) if (!planIds.some((id) => selectorMatches(s, id))) findings.push({ rule: 'unknown_selector', key, selector: s });
  }
  for (const s of v.smoke) if (!planIds.some((id) => selectorMatches(s, id))) findings.push({ rule: 'unknown_selector', key: 'smoke', selector: s });
  return { findings };
}

// ---------- IO ----------

function walkDisk(project) {
  const out = [];
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    for (const e of fs.readdirSync(path.join(project, rel), { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) stack.push(r);
      else out.push(r);
      if (out.length > MAX_DISK_FILES) throw new VerifyError('usage', `more than ${MAX_DISK_FILES} files under the project`);
    }
  }
  return out.sort();
}

/** @returns {{files: string[], source: 'git'|'disk'}} git ls-files inside a work tree, else a disk walk that skips `.git` and follows no symlink */
function trackedFiles(project) {
  if ((gitRaw(project, ['rev-parse', '--is-inside-work-tree']) || '').trim() === 'true') {
    const out = gitRaw(project, ['ls-files', '-z']);
    if (out !== null) return { files: out.split('\0').filter(Boolean), source: 'git' };
  }
  return { files: walkDisk(project), source: 'disk' };
}

function readConfig(project) {
  const file = path.join(project, '.a1', 'verify.json');
  let text;
  try {
    if (fs.statSync(file).size > MAX_CONFIG_BYTES) throw new VerifyError('bad_config', '.a1/verify.json is larger than 1 MiB');
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e instanceof VerifyError) throw e;
    throw new VerifyError('bad_config', `.a1/verify.json unreadable: ${e.code || e.message}`);
  }
  try { return JSON.parse(text); } catch (e) { throw new VerifyError('bad_config', `.a1/verify.json is not valid JSON: ${e.message}`); }
}

function fail(code, reason, message) {
  return emitExit(code, `${JSON.stringify({ ok: false, error: reason, message })}\n`, `verify: ${reason}: ${message}\n`);
}

function plainValue(k, v) {
  if (typeof v !== 'string' || v === '' || v.length > MAX_ARG_LENGTH || v.includes('\0')) throw new VerifyError('usage', `--${k} needs a plain value`);
  if (k === 'traces' && v.split('/').includes('..')) throw new VerifyError('usage', '--traces must not contain a .. segment');
}

function parseArgs(args) {
  const flags = parseFlags(args, KNOWN_FLAGS);
  if (flags._.length > 0) throw new VerifyError('usage', `unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  for (const [k, v] of Object.entries(flags)) if (k !== '_' && KNOWN_FLAGS[k] === 'string') plainValue(k, v);
  const modes = ['traces', 'check', 'list-ids'].filter((m) => flags[m] !== undefined);
  if (modes.length !== 1) throw new VerifyError('usage', 'exactly one of --traces <dir>, --check, --list-ids is required');
  if (flags['allow-red'] !== undefined && flags.traces === undefined) throw new VerifyError('usage', '--allow-red needs --traces');
  const allowRed = flags['allow-red'] === undefined ? [] : flags['allow-red'].split(',').map((s) => s.trim()).filter(Boolean);
  return { mode: modes[0], traces: flags.traces, allowRed, project: path.resolve(process.cwd(), flags.project || '.') };
}

function readTrace(dir, id) {
  const file = path.join(dir, `${id.split('/').join('__')}.paths`);
  let text;
  try {
    if (fs.statSync(file).size > MAX_TRACE_BYTES) return null;
    text = fs.readFileSync(file, 'utf8');
  } catch (_e) { return null; }
  const rs = { touched: [], listed: [], unresolved: 0 };
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const [p, kind] = line.split('\t');
    if (p === '?') rs.unresolved++;
    else { rs.touched.push(p); if (kind === 'D') rs.listed.push(p); }
  }
  return rs;
}

function readStatus(dir) {
  const status = new Map();
  let text = '';
  try { text = fs.readFileSync(path.join(dir, '_status.tsv'), 'utf8'); } catch (_e) { return status; }
  for (const line of text.split('\n')) {
    const i = line.lastIndexOf('\t');
    if (i > 0) status.set(line.slice(0, i), line.slice(i + 1).trim());
  }
  return status;
}

function runTraces(o, planIds, tracked) {
  const dir = path.resolve(process.cwd(), o.traces);
  const status = readStatus(dir);
  const readSets = {};
  const red = [];
  for (const id of planIds) {
    const rs = readTrace(dir, id);
    if (rs === null || !status.has(id)) return fail(1, 'trace_missing', id);
    readSets[id] = rs;
    if (status.get(id) !== '0') red.push(id);
  }
  const bad = red.filter((id) => !o.allowRed.includes(id));
  if (bad.length > 0) return fail(1, 'trace_red', bad[0]);
  const map = buildMap({ readSets, planIds, trackedFiles: tracked.files, alwaysIds: red });
  return emitExit(0, `${JSON.stringify({ ok: true, ...map })}\n`, '');
}

/** @param {string[]} args `verify affected-map` arguments */
function cmdAffectedMap(args) {
  try {
    const o = parseArgs(args);
    if (!fs.statSync(o.project, { throwIfNoEntry: false })?.isDirectory()) return fail(2, 'usage', `--project is not a directory: ${o.project}`);
    const planIds = resolveCommands(o.project).commands.map((c) => c.id);
    if (o.mode === 'list-ids') return emitExit(0, planIds.map((i) => `${i}\n`).join(''), '');
    const tracked = trackedFiles(o.project);
    if (o.mode === 'traces') return runTraces(o, planIds, tracked);
    const { findings } = checkMap(o.project, readConfig(o.project), planIds, tracked.files);
    return emitExit(findings.length === 0 ? 0 : 1, `${JSON.stringify({ ok: findings.length === 0, findings, tracked_source: tracked.source })}\n`, '');
  } catch (e) {
    if (e instanceof VerifyError) return fail(2, e.reason, e.message);
    return fail(2, 'internal', e.message);
  }
}

if (require.main === module) {
  if (process.argv[2] === '--parse-trace' && process.argv[3]) parseTraceMain(process.argv[3]);
  else emitExit(2, '', 'usage: node verify-affected-map.cjs --parse-trace <root>\n');
}

module.exports = { parseTraceLine, candidateKeys, buildMap, checkMap, cmdAffectedMap };
