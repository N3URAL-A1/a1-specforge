'use strict';

// ---------------------------------------------------------------------------
// xprov-hook-paths — what the plugin hook denies for Edit, Write, NotebookEdit and MultiEdit (spec 016 FR-004; wave 4).
//
//   guardedPath(file, cwd)   -> { guarded: true, why } | { guarded: false }
//       The owner stores: everything under <owner home>/.a1-xprov/ (consent.json, consent-markers/, permits.json, permit-denials.json,
//       waivers.json, allowlist-approvals.json, hit-approvals.json, scan-records/, artifacts/, consent-audit.jsonl and its lock/tmp/stale
//       forms, .owner-store.lock and its forms, every .tmp file), and `.a1/xprov.json` in any checkout. The path is judged in two forms,
//       the lexical one (`..` removed first) and the one the operating system walks (a symlink followed by `..`), each resolved through
//       the deepest existing ancestor (realpath: a symlink to a store file is the store file), `~` and `$HOME` expanded, relative paths
//       taken against the payload cwd, compared after NFC + lower-casing (APFS is case-insensitive).
//   settingsForgery(file, cwd, tool, input) -> { forged: true, why } | { forged: false }
//       R-1 prefill path: a `.claude/settings*.json` (project, local or `~/.claude/`) whose NEW content adds a hook that matches
//       AskUserQuestion on PreToolUse or PermissionRequest (such a hook may answer the consent question with `updatedInput.answers`),
//       or switches `disableAllHooks` on (it would switch this plugin hook off). The new content is computed (Write: the content; Edit,
//       MultiEdit: the file with the replacement applied); an unparseable result is judged as text.
//
// Tier 0 stays: a Bash command that writes a settings file or a store is outside this hook (the same OS user can always do it).
// Request-scoped: no module state.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const X = require('./xprov.cjs');

const STORE_DIR_NAME = '.a1-xprov';
const SETTINGS_FILE_RE = /^settings[^/]*\.json$/;
const PRE_EVENTS = Object.freeze(['pretooluse', 'permissionrequest']);
const ASK_TOOL = 'AskUserQuestion';
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const fold = (p) => String(p).normalize('NFC').toLowerCase();

/** `~`, `~/x`, `$HOME/x`, `${HOME}/x` expanded against `home`; anything else unchanged. */
function expandHome(p, home) {
  const m = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)(.*)$/.exec(p);
  return m ? `${home}${m[1]}` : p;
}

/** Resolves `abs` through its deepest existing ancestor; the missing tail is appended as it is. */
function realish(abs) {
  let head = abs;
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(head), ...tail); } catch (_e) { /* the ancestor is missing or a loop: go up */ }
    const parent = path.dirname(head);
    if (parent === head) return abs;
    tail.unshift(path.basename(head));
    head = parent;
  }
}

/** The forms of `file` to judge: lexical (`..` collapsed) and OS-walked, each realpath-resolved. */
function forms(file, cwd) {
  const home = safeHome();
  const raw = expandHome(String(file), home);
  const abs = path.isAbsolute(raw) ? raw : `${cwd}/${raw}`;
  return [...new Set([realish(path.resolve(abs)), realish(abs.replace(/\/{2,}/g, '/'))])];
}

function safeHome() {
  try { return os.homedir(); } catch (_e) { return ''; }
}

/** Store roots: the owner store dir by the resolver, and the one under the process home (equal in production). Realpath-resolved. */
function storeRoots() {
  const roots = [X.xprovHome()];
  const h = safeHome();
  if (h !== '') roots.push(path.join(h, STORE_DIR_NAME));
  return [...new Set(roots.flatMap((r) => [path.resolve(r), realish(path.resolve(r))]))].map(fold);
}

const isUnder = (p, root) => p === root || p.startsWith(`${root}/`);

/** { guarded, why } for one file path (see header). */
function guardedPath(file, cwd) {
  if (typeof file !== 'string' || file === '') return { guarded: false };
  const roots = storeRoots();
  for (const f of forms(file, cwd).map(fold)) {
    if (roots.some((r) => isUnder(f, r))) return { guarded: true, why: 'the owner store directory (~/.a1-xprov)' };
    if (path.basename(f) === 'xprov.json' && path.basename(path.dirname(f)) === '.a1') return { guarded: true, why: '.a1/xprov.json (the repository permit file)' };
  }
  return { guarded: false };
}

const isSettingsFile = (file, cwd) => forms(file, cwd).map(fold).some((f) => SETTINGS_FILE_RE.test(path.basename(f)) && path.basename(path.dirname(f)) === '.claude');

function matcherHitsAsk(matcher) {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*') return true;
  if (typeof matcher !== 'string') return true;
  try { return new RegExp(matcher, 'i').test(ASK_TOOL); } catch (_e) { return true; } // an invalid pattern is judged as a hit
}

/** The JSON texts of the hook entries that match AskUserQuestion on a Pre event (so a hook that may prefill answers). */
function askHooksOf(doc) {
  const hooks = doc && typeof doc === 'object' && doc.hooks && typeof doc.hooks === 'object' ? doc.hooks : {};
  return Object.entries(hooks).filter(([event]) => PRE_EVENTS.includes(fold(event)))
    .flatMap(([event, entries]) => (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e === 'object' && matcherHitsAsk(e.matcher)).map((e) => `${fold(event)}|${JSON.stringify(e)}`));
}

function parseJson(text) {
  if (typeof text !== 'string') return null;
  try { const d = JSON.parse(text); return d && typeof d === 'object' && !Array.isArray(d) ? d : null; } catch (_e) { return null; }
}

function readOld(file, cwd) {
  const abs = forms(file, cwd)[0];
  try {
    const st = fs.lstatSync(abs);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch (_e) { return ''; } // absent file: empty
}

function replaceOnce(text, from, to, all) {
  if (typeof from !== 'string' || typeof to !== 'string' || from === '' || !text.includes(from)) return null;
  return all ? text.split(from).join(to) : text.replace(from, () => to);
}

/** { text (the file after the change, or null), fragment (the added text) } for the tool input. */
function newContent(tool, input, old) {
  if (tool === 'Write') return { text: typeof input.content === 'string' ? input.content : null, fragment: String(input.content || '') };
  const edits = tool === 'MultiEdit' && Array.isArray(input.edits) ? input.edits : [input];
  const fragment = edits.map((e) => String((e && e.new_string) || '')).join('\n');
  if (old === null) return { text: null, fragment };
  let text = old;
  for (const e of edits) {
    text = text === null ? null : replaceOnce(text, e && e.old_string, e && e.new_string, Boolean(e && e.replace_all));
  }
  return { text, fragment };
}

const TEXT_ASK_RE = /ask\s*user\s*question/i;
const TEXT_DISABLE_RE = /disableAllHooks/i;

/** { forged, why } for a settings file edit (see header). Non-settings files are never forged here. */
function settingsForgery(file, cwd, tool, input) {
  if (typeof file !== 'string' || !isSettingsFile(file, cwd)) return { forged: false };
  const old = readOld(file, cwd);
  const next = newContent(tool, input && typeof input === 'object' ? input : {}, old);
  const newDoc = parseJson(next.text);
  if (newDoc === null) {
    // Cannot be judged as a document (a fragment of a hook, or broken JSON): the fragment decides.
    const hit = TEXT_ASK_RE.test(next.fragment) || TEXT_DISABLE_RE.test(next.fragment) || /"matcher"/i.test(next.fragment);
    return hit ? { forged: true, why: 'the change to this settings file cannot be read as a whole document and its new text names a hook matcher, AskUserQuestion or disableAllHooks' } : { forged: false };
  }
  const oldDoc = parseJson(old) || {};
  const seen = new Set(askHooksOf(oldDoc));
  if (askHooksOf(newDoc).some((h) => !seen.has(h))) return { forged: true, why: 'the new content adds a hook that matches AskUserQuestion (a PreToolUse hook can answer the consent question with updatedInput.answers)' };
  if (newDoc.disableAllHooks === true && oldDoc.disableAllHooks !== true) return { forged: true, why: 'the new content sets disableAllHooks, which would switch the consent hook off' };
  return { forged: false };
}

module.exports = { STORE_DIR_NAME, guardedPath, settingsForgery, isSettingsFile, askHooksOf, forms, storeRoots };
