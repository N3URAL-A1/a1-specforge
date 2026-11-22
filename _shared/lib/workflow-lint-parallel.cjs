'use strict';
// workflow-lint rules for parallel groups and background steps (spec 027 slice 4, FR-023/FR-024, plan D14).
//   parallel-group    a group `<!-- a1:parallel group=<id> -->` has fewer than 2 member files, or a member reads
//                     another member's output path in its `<files_to_read>` block.
//   background-start  a `<!-- a1:background id=<id> join=<yes|no> -->` marker whose next fenced bash block holds no line
//                     ending in `&` (or holding `& echo "$!"`); `join=yes` without a later `<!-- a1:join id=<id> -->`
//                     in the same file; a join marker without a background marker of the same id.
// A marker counts only when it is the whole line. Member output = the first `**Output path:** <path>` line of the file;
// member inputs = the `- <path>` lines inside its `<files_to_read>` blocks. No require of workflow-lint.cjs (no cycle).

const fs = require('fs');
const path = require('path');

const PARALLEL_RE = /^\s*<!--\s*a1:parallel\s+group=([a-z0-9-]{1,40})\s*-->\s*$/;
const BACKGROUND_RE = /^\s*<!--\s*a1:background\s+id=([a-z0-9-]{1,40})\s+join=(yes|no)\s*-->\s*$/;
const JOIN_RE = /^\s*<!--\s*a1:join\s+id=([a-z0-9-]{1,40})\s*-->\s*$/;
const OUTPUT_RE = /^\s*\*\*Output path:\*\*\s*(\S+)/;
const FENCE_RE = /^\s*```\s*([A-Za-z0-9_-]*)\s*$/;
const BACKGROUND_LINE_RE = /(?:^|[^&>])&\s*$|&\s+echo\s+"\$!"/;
const MAX_MD_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = Object.freeze(['node_modules', '.git']);

function readOrNull(file) {
  try {
    if (fs.statSync(file).size > MAX_MD_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return null;
  }
}

function walkMd(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !SKIP_DIRS.includes(e.name)) walkMd(full, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
  }
}

function markdownFiles(root) {
  const files = [];
  walkMd(path.join(root, 'skills'), files);
  let agents = [];
  try {
    agents = fs.readdirSync(path.join(root, 'agents')).filter((n) => n.endsWith('.md')).map((n) => path.join(root, 'agents', n));
  } catch (_e) { /* no agents dir */ }
  return files.concat(agents).sort();
}

const normPath = (p) => String(p).trim().replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Inputs: the `- <path>` lines inside every `<files_to_read>` block of the file. */
function filesToRead(lines) {
  const inputs = [];
  let inBlock = false;
  for (const l of lines) {
    if (/<files_to_read>/.test(l)) inBlock = true;
    else if (/<\/files_to_read>/.test(l)) inBlock = false;
    else if (inBlock) {
      const m = /^\s*-\s+(.+?)\s*$/.exec(l);
      if (m) inputs.push(normPath(m[1]));
    }
  }
  return inputs;
}

function outputPath(lines) {
  for (const l of lines) {
    const m = OUTPUT_RE.exec(l);
    if (m) return normPath(m[1]);
  }
  return null;
}

function scanFile(file) {
  const content = readOrNull(file);
  if (content === null) return null;
  const lines = content.split('\n');
  const groups = [];
  lines.forEach((l, i) => { const m = PARALLEL_RE.exec(l); if (m) groups.push({ id: m[1], line: i + 1 }); });
  return { file, lines, groups, output: outputPath(lines), inputs: filesToRead(lines) };
}

/**
 * Rule `parallel-group`.
 * @param {string} root scan root
 * @param {(root: string) => boolean} isSkillsTree scope test (the rule applies to a real skills tree only)
 * @returns {{checked: number, findings: Array<{file: string, rule: string, line: number, reason: string}>}} checked = member markers read
 */
function checkParallelGroups(root, isSkillsTree) {
  if (!isSkillsTree(root)) return { checked: 0, findings: [] };
  const members = new Map();
  for (const file of markdownFiles(root)) {
    const info = scanFile(file);
    if (!info) continue;
    for (const g of info.groups) {
      if (!members.has(g.id)) members.set(g.id, []);
      members.get(g.id).push({ ...info, line: g.line });
    }
  }
  const findings = [];
  let checked = 0;
  for (const [id, list] of members) {
    checked += list.length;
    const files = new Set(list.map((m) => m.file));
    if (files.size < 2) {
      findings.push({ file: list[0].file, rule: 'parallel-group', line: list[0].line, reason: `group ${id} has ${files.size} member file(s), needs at least 2` });
      continue;
    }
    for (const m of list) {
      for (const other of list) {
        if (other.file === m.file || !other.output) continue;
        if (m.inputs.includes(other.output)) {
          findings.push({ file: m.file, rule: 'parallel-group', line: m.line, reason: `group ${id}: member reads ${other.output}, the output of another member (not independent)` });
        }
      }
    }
  }
  return { checked, findings };
}

/** The first fenced block after `from` (0-based line index): {lang, body[]} or null. */
function nextFence(lines, from) {
  for (let i = from; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i]);
    if (!m) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && !FENCE_RE.test(lines[j]); j++) body.push(lines[j]);
    return { lang: m[1], body };
  }
  return null;
}

function backgroundFindings(file, lines) {
  const out = [];
  const add = (line, reason) => out.push({ file, rule: 'background-start', line, reason });
  const starts = new Set();
  let checked = 0;
  lines.forEach((l, i) => {
    const m = BACKGROUND_RE.exec(l);
    if (!m) return;
    checked += 1;
    starts.add(m[1]);
    const fence = nextFence(lines, i + 1);
    if (!fence || !/^(bash|sh)$/.test(fence.lang)) add(i + 1, `background marker ${m[1]}: the next fenced block is not a bash block`);
    else if (!fence.body.some((b) => BACKGROUND_LINE_RE.test(b))) add(i + 1, `background marker ${m[1]}: no line of the next bash block ends in & or holds & echo "$!"`);
    if (m[2] === 'yes' && !lines.slice(i + 1).some((x) => { const j = JOIN_RE.exec(x); return j && j[1] === m[1]; })) {
      add(i + 1, `background marker ${m[1]} has join=yes but no later <!-- a1:join id=${m[1]} --> in this file`);
    }
  });
  lines.forEach((l, i) => {
    const j = JOIN_RE.exec(l);
    if (j && !starts.has(j[1])) add(i + 1, `join marker ${j[1]} has no background marker of that id in this file`);
  });
  return { checked, findings: out };
}

/**
 * Rule `background-start`.
 * @param {string} root scan root
 * @param {(root: string) => boolean} isSkillsTree scope test
 * @returns {{checked: number, findings: Array<{file: string, rule: string, line: number, reason: string}>}} checked = background markers read
 */
function checkBackgroundMarkers(root, isSkillsTree) {
  if (!isSkillsTree(root)) return { checked: 0, findings: [] };
  let checked = 0;
  let findings = [];
  for (const file of markdownFiles(root)) {
    const content = readOrNull(file);
    if (content === null) continue;
    const r = backgroundFindings(file, content.split('\n'));
    checked += r.checked;
    findings = findings.concat(r.findings);
  }
  return { checked, findings };
}

module.exports = { checkParallelGroups, checkBackgroundMarkers };
