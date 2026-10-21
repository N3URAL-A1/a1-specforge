'use strict';
// Spec 017 Wave 13 defect-class sweep: usage `node check-callsite-flags.cjs <root> [<tools-root>]`.
// For EVERY fenced `a1-tools.cjs <group> [<sub>] ...` call in <root>/skills/**/*.md and
// <root>/agents/*.md, each `--flag` must be accepted by the real command. The accepted set is
// derived from the real CLI at run time (no hand-written list):
//   1. `node <tools-root>/_shared/a1-tools.cjs --help` is split into one block per usage line
//      (`  a1-tools <group> <sub>[|<sub>] ...` plus its indented continuation lines); a block's
//      flags are every `--flag` token in it.
//   2. The flag specs in the source of the modules the facade routes the group to (`parseFlags`
//      key objects `{ name: 'value' }`, KNOWN_FLAGS tables, `'--name'` literals), found by reading
//      the group's branch in `_shared/a1-tools.cjs` and following local requires two levels deep.
//      A command whose usage block lists its flags explicitly (and does not say `[flags]`) is
//      checked against that block alone, so a flag another subcommand of the group declares does
//      not pass. Any other command (no block, or a generic one) is checked against the block
//      plus the group's source; a subcommand with no block must still exist in the group's source.
//   3. `--phase` is accepted exactly when the registry `invoke` map names the call
//      (gate-log.cjs matchInvoke strips it there); every other command rejects it.
// A call whose command has no usage block is reported too. Prints one line per problem and
// "calls=<n>"; exit 1 on any problem or when zero calls were found.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const { extractBashFenceLines, joinContinuations } = require(path.join(REPO, '_shared', 'lib', 'workflow-lint.cjs'));
const { matchInvoke } = require(path.join(REPO, '_shared', 'lib', 'gate-log.cjs'));
const { invokeMap } = require(path.join(REPO, '_shared', 'lib', 'gate-ids.cjs'));

const root = process.argv[2];
const toolsRoot = process.argv[3] || REPO;
const CALL_RE = /(?:a1-tools\.cjs|\$\{?A1_TOOLS\}?"?)\s+((?:[a-z][a-z0-9-]*)(?:\s+[a-z][a-z0-9-]*)?)(?=[\s;|&)]|$)(.*)$/;

/** Usage blocks of the real `--help`: Map "<group> <sub>" (or "<group>") -> Set of flags. */
function helpBlocks(help) {
  const blocks = new Map();
  let keys = [];
  for (const line of help.split('\n')) {
    const head = /^ {2}a1-tools\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9|-]*))?/.exec(line);
    if (head) {
      const subs = head[2] ? head[2].split('|') : [''];
      keys = subs.map((s) => (s ? `${head[1]} ${s}` : head[1]));
      for (const k of keys) { if (!blocks.has(k)) blocks.set(k, new Set()); }
    } else if (/^\S/.test(line) || line.trim() === '') { keys = []; }
    for (const k of keys) {
      for (const m of line.matchAll(/--([a-z][a-z0-9-]*)/g)) blocks.get(k).add(m[1]);
      if (/\[flags\]/.test(line)) blocks.get(k).add('[flags]');
    }
  }
  return blocks;
}

/** Map identifier -> lib file from the facade's top-level `const { a, b } = require(path.join(__dirname, 'lib', 'x.cjs'))`. */
function identifierFiles(facade) {
  const map = new Map();
  for (const m of facade.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*require\(path\.join\(__dirname,\s*'lib',\s*'([^']+)'\)\)/g)) {
    for (const id of m[1].split(',')) map.set(id.split(':').pop().trim(), m[2]);
  }
  return map;
}

/** Group name -> Set of lib file names its facade branch uses (`'lib', 'x.cjs'` literals and imported identifiers). */
function groupFiles(facade) {
  const idMap = identifierFiles(facade);
  const parts = facade.split(/(?:\}\s*else\s+)?if \(group === '([a-z-]+)'\)/);
  const out = new Map();
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1];
    const files = new Set([...body.matchAll(/'lib',\s*'([^']+\.cjs)'/g)].map((m) => m[1]));
    for (const id of body.match(/\b[A-Za-z_]\w*/g) || []) if (idMap.has(id)) files.add(idMap.get(id));
    out.set(parts[i], files);
  }
  return out;
}

/** Local requires of a lib file (`./x.cjs` and `path.join(__dirname, 'x.cjs')`). */
function localRequires(file, libDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(libDir, file), 'utf8'); } catch (_e) { return []; }
  return [...text.matchAll(/require\((?:'\.\/([^']+\.cjs)'|path\.join\(__dirname,\s*'([^']+\.cjs)'\))\)/g)].map((m) => m[1] || m[2]);
}

/** Flags declared by the source of `files` plus their local requires (depth 2). */
function sourceFlags(files, libDir) {
  const seen = new Set();
  // sibling modules `<stem>-*.cjs` belong to the group too (dispatch tables load them by computed path)
  const stems = [...files].map((f) => f.replace(/\.cjs$/, '-'));
  const siblings = fs.existsSync(libDir) ? fs.readdirSync(libDir).filter((f) => stems.some((st) => f.startsWith(st))) : [];
  let layer = [...files, ...siblings];
  for (let depth = 0; depth < 3 && layer.length; depth++) {
    const next = [];
    for (const f of layer) {
      if (seen.has(f)) continue;
      seen.add(f);
      next.push(...localRequires(f, libDir));
    }
    layer = next;
  }
  const flags = new Set();
  for (const f of seen) {
    let text = '';
    try { text = fs.readFileSync(path.join(libDir, f), 'utf8'); } catch (_e) { continue; }
    for (const m of text.matchAll(/['"]?([a-z][a-z0-9-]*)['"]?\s*:\s*['"](?:value|string|str|bool|boolean)['"]/g)) flags.add(m[1]);
    for (const m of text.matchAll(/['"`]--([a-z][a-z0-9-]*)(?=[='"`\s])/g)) flags.add(m[1]);
  }
  return flags;
}

/** Group name -> text of its facade branch (for subcommand literals). */
function branchTexts(facade) {
  const parts = facade.split(/(?:\}\s*else\s+)?if \(group === '([a-z-]+)'\)/);
  const out = new Map();
  for (let i = 1; i < parts.length; i += 2) out.set(parts[i], parts[i + 1]);
  return out;
}

function skillFiles(base) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) out.push(p);
    }
  };
  for (const d of ['skills', 'agents']) if (fs.existsSync(path.join(base, d))) walk(path.join(base, d));
  return out.sort();
}

function callsOf(file) {
  const calls = [];
  for (const l of joinContinuations(extractBashFenceLines(fs.readFileSync(file, 'utf8')))) {
    if (/^\s*(#|echo|printf)\b/.test(l.text)) continue;
    const m = CALL_RE.exec(l.text);
    if (!m) continue;
    const words = m[1].split(/\s+/);
    // blank quoted strings and <placeholders>, then cut at the first shell operator
    const rest = m[2].replace(/"[^"]*"|'[^']*'/g, ' ').replace(/<[^<>]*>/g, 'X').split(/\s\d?>>?\s|;|\|\||&&|\|/)[0];
    const flags = [...rest.matchAll(/(?:^|\s)--([a-z][a-z0-9-]*)/g)].map((x) => x[1]);
    // first word after the group is a subcommand only when it is not an argument of a one-word command
    calls.push({ lineNo: l.lineNo, words, flags, rest });
  }
  return calls;
}

function resolve(blocks, words) {
  const two = words.join(' ');
  if (words.length === 2 && blocks.has(two)) return two;
  return blocks.has(words[0]) ? words[0] : null;
}

/** True when the group's source names the subcommand as a quoted literal. */
function subExists(group, sub, groups, libDir, facadeBranch) {
  if (!groups.has(group)) return false;
  if (!sub) return true;
  const lit = new RegExp(`['"]${sub}['"]`);
  if (lit.test(facadeBranch.get(group) || '')) return true;
  return [...groups.get(group)].some((f) => { try { return lit.test(fs.readFileSync(path.join(libDir, f), 'utf8')); } catch (_e) { return false; } });
}

function main() {
  const help = spawnSync('node', [path.join(toolsRoot, '_shared', 'a1-tools.cjs'), '--help'], { encoding: 'utf8', shell: false });
  if (help.status !== 0) { console.log('cannot read the real --help'); console.log('calls=0'); return 2; }
  const blocks = helpBlocks(help.stdout);
  const map = invokeMap(fs.readFileSync(path.join(toolsRoot, '_shared', 'gates-registry.md'), 'utf8'));
  const libDir = path.join(toolsRoot, '_shared', 'lib');
  const facadeText = fs.readFileSync(path.join(toolsRoot, '_shared', 'a1-tools.cjs'), 'utf8');
  const groups = groupFiles(facadeText);
  const facadeBranch = branchTexts(facadeText);
  const srcFlags = new Map();
  const problems = [];
  let calls = 0;
  for (const file of skillFiles(root)) {
    for (const c of callsOf(file)) {
      calls += 1;
      const where = `${path.relative(root, file)}:${c.lineNo}`;
      const key = resolve(blocks, c.words);
      const g = c.words[0];
      if (!key && !subExists(g, c.words[1], groups, libDir, facadeBranch)) { problems.push(`${where} ${c.words.join(' ')}: command does not exist in the real CLI`); continue; }
      const argv = [...c.words, ...c.rest.trim().split(/\s+/).filter(Boolean)];
      const phaseOk = matchInvoke(argv, map) !== null;
      if (!srcFlags.has(g)) srcFlags.set(g, sourceFlags(groups.get(g) || [], libDir));
      for (const f of c.flags) {
        const own = key ? blocks.get(key) : new Set();
        const strict = key && own.size > 0 && !own.has('[flags]') && key.includes(' ');
        if (own.has(f) || (f === 'phase' && phaseOk) || (f !== 'phase' && !strict && srcFlags.get(g).has(f))) continue;
        problems.push(`${where} ${key || c.words.join(' ')}: flag --${f} is not accepted by the real command`);
      }
    }
  }
  for (const p of problems) console.log(p);
  console.log(`calls=${calls}`);
  return problems.length || calls === 0 ? 1 : 0;
}
process.exit(main());
