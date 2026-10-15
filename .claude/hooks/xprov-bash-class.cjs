'use strict';

// xprov-bash-class — classifies a Bash command for xprov-deny-allowlist-approve.sh (spec 016 FR-032; wave 4).
// stdin: the hook JSON. stdout: line 1 = the mode, then one JSON line { tool_input: { command } } holding the text the deny patterns must judge.
//   readonly  every segment (split on ; && || | & and newline, quote-aware) starts with a read-only program: the COMMAND-phrase patterns
//             (`xprov permit|waive`, `allowlist approve`, `xprov $`) do not apply — such a command only reads or prints the text. The
//             STORE-name patterns still apply (existing contract of parts 08/11/12: agents do not read the owner stores).
//   heredoc   one `cat`/`tee` writes a quoted-delimiter heredoc and nothing follows the terminator: the body is data, the judged text is
//             the header line only (so a write TO a store is still caught by its target path, and a body that merely mentions a phrase passes).
//   plain     anything else: the patterns judge the whole text, as before.
// Everything that cannot be classified with certainty is `plain` (the old behaviour). Pure; reads stdin only.

const fs = require('fs');

const READONLY = Object.freeze(['grep', 'rg', 'cat', 'head', 'tail', 'wc', 'ls', 'echo']);
const GIT_READ = Object.freeze(['log', 'diff', 'show']);
const SED_SCRIPT_RE = /^(?:\d+|\$|\/[^/]*\/)?(?:,(?:\d+|\$|\/[^/]*\/))?p$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEREDOC_RE = /<<(-?)(['"])([A-Za-z_][A-Za-z0-9_]*)\2/;
const MAX_CHARS = 1000000;

/** Quote-aware split: { segments: [[word...]] } or null when the text has a construct this reader does not judge. */
function split(text) {
  const segments = [];
  let words = [];
  let cur = '';
  let inWord = false;
  const endWord = () => { if (inWord) words.push(cur); cur = ''; inWord = false; };
  const endSeg = () => { endWord(); if (words.length) segments.push(words); words = []; };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'") {
      const j = text.indexOf("'", i + 1);
      if (j < 0) return null;
      cur += text.slice(i + 1, j); inWord = true; i = j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j += 1) { if (text[j] === '\\' && j + 1 < text.length) { j += 1; cur += text[j]; } else cur += text[j]; }
      if (j >= text.length) return null;
      inWord = true; i = j;
    } else if (c === '\\') {
      if (i + 1 >= text.length) return null;
      i += 1; cur += text[i]; inWord = true;
    } else if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '\r') {
      endSeg();
    } else if (c === ' ' || c === '\t') {
      endWord();
    } else if (c === '>' || c === '<' || c === '(' || c === ')' || (c === '#' && !inWord)) {
      return null; // redirect, subshell, comment: not read-only
    } else {
      cur += c; inWord = true;
    }
  }
  endSeg();
  return segments;
}

function readonlySegment(w) {
  const [prog, sub] = w;
  if (prog === 'rg') return !w.some((t) => t === '--pre' || t.startsWith('--pre=') || t.startsWith('--hostname-bin'));
  if (READONLY.includes(prog)) return true;
  if (prog === 'sed') return sub === '-n' && SED_SCRIPT_RE.test(w[2] || '') && w.slice(3).every((t) => !t.startsWith('-'));
  // git can run diff.external, textconv and fsmonitor commands from a config the agent may have written: read-only only with both
  // switches off and no -c (Samuel W4 SEC-6); anything else falls through to the deny patterns.
  if (prog === 'git') return GIT_READ.includes(sub) && w.includes('--no-ext-diff') && w.includes('--no-textconv') && !w.includes('-c') && !w.some((t) => t.startsWith('--output') || t === '--ext-diff');
  return false;
}

function structural(w) {
  if (w[0] === 'for') return w.length >= 3 && NAME_RE.test(w[1]) && w[2] === 'in';
  return w.length === 1 && w[0] === 'done';
}

function isReadonly(text) {
  if (/\$\(|`|\$['"]/.test(text)) return false;
  const segs = split(text.replace(/\\\r?\n/g, ''));
  if (segs === null || segs.length === 0) return false;
  return segs.every((w) => {
    const body = w[0] === 'do' ? w.slice(1) : w;
    return body.length === 0 || structural(body) || readonlySegment(body);
  });
}

/** The header line when the command is ONE cat/tee quoted-delimiter heredoc and nothing but blank lines follows the terminator; else null. */
function heredocHeader(text) {
  if (text.includes('\\\n') || /\$\(|`/.test(text.split('\n')[0])) return null;
  const lines = text.split('\n');
  const header = lines[0];
  const m = HEREDOC_RE.exec(header);
  if (m === null || header.slice(m.index + m[0].length).includes('<<')) return null;
  // The delimiter must end where bash ends the word (Samuel W4 SEC-2): `<<'E'OF` is the delimiter EOF in bash, not E.
  const after = header.charAt(m.index + m[0].length);
  if (after !== '' && after !== ' ' && after !== '\t' && after !== '>') return null;
  const rest = (header.slice(0, m.index) + header.slice(m.index + m[0].length)).replace(/>>?/g, ' ');
  const segs = split(rest);
  if (segs === null || segs.length !== 1 || !['cat', 'tee'].includes(segs[0][0])) return null;
  const isEnd = (l) => (m[1] === '-' ? l.replace(/^\t+/, '') : l) === m[3];
  const end = lines.findIndex((l, i) => i > 0 && isEnd(l));
  if (lines.filter((l, i) => i > 0 && isEnd(l)).length !== 1) return null; // zero or several terminators: ambiguous, full check
  if (end < 0 || lines.slice(end + 1).some((l) => l.trim() !== '')) return null;
  return header;
}

function classify(text) {
  if (text.length > MAX_CHARS) return { mode: 'plain', judge: text };
  const h = text.includes('<<') ? heredocHeader(text) : null;
  if (h !== null) return { mode: 'heredoc', judge: h };
  return { mode: isReadonly(text) ? 'readonly' : 'plain', judge: text };
}

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_e) { raw = ''; }
let command = '';
try { const j = JSON.parse(raw); command = String((j.tool_input && j.tool_input.command) || ''); } catch (_e) { command = null; }
if (command === null) { process.stdout.write('plain\n{}\n'); } else {
  const r = classify(command);
  process.stdout.write(`${r.mode}\n${JSON.stringify({ tool_input: { command: r.judge } })}\n`);
}
