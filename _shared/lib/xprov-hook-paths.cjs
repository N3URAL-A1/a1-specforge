'use strict';

// ---------------------------------------------------------------------------
// xprov-hook-paths — what the plugin hook denies for Edit, Write, NotebookEdit and MultiEdit (spec 016 FR-004; wave 4).
//
// EVERY place a Claude Code hook can be defined, or all hooks disabled (measured 2026-10-15 from the official docs; a hook in any of them
// that matches AskUserQuestion on PreToolUse/PermissionRequest can answer the consent question with `updatedInput.answers`, and a disable
// switches this plugin hook off). Column "here" says what this module does for it.
//
//  #  location (doc)                                                              here
//  1  ~/.claude/settings.json                  (hooks#hook-locations, settings)    guarded: JSON class
//  2  <project>/.claude/settings.json          (hooks#hook-locations, settings)    guarded: JSON class
//  3  <project>/.claude/settings.local.json    (hooks#hook-locations, settings)    guarded: JSON class
//  4  managed-settings.json / managed-settings.d (system dirs; settings, hooks)    guarded by file name (JSON class); MDM and server-managed
//                                                                                  settings are not files an agent edits: RESIDUAL
//  5  `--settings <file|json>` launch flag    (settings#settings-per-session)     RESIDUAL (any path, chosen at launch)
//  6  plugin hooks/hooks.json                  (hooks, plugins-reference)          guarded: JSON class (own checkout hooks/hooks.json excepted)
//  7  plugin.json inline `hooks` or `hooks` path to any .json (plugins-reference#component-path-forms)
//                                                                                  guarded: plugin manifest class (a `hooks` key added or changed);
//                                                                                  a hooks .json outside ~/.claude/plugins and not named
//                                                                                  hooks.json: RESIDUAL
//  8  marketplace.json entry `hooks` (inline object form) (plugins-reference#marketplace-entries-and-the-manifest, plugin-marketplaces)
//                                                                                  guarded: plugin manifest class
//  9  any .json under ~/.claude/plugins/**  (installed plugins, plugin cache)      guarded: JSON class; the a1-specforge cache: every file denied
// 10  skill frontmatter `hooks:` (SKILL.md in .claude/skills, ~/.claude/skills, plugin skills/, nested .claude/skills, --add-dir)
//                                              (hooks#hooks-in-skills-and-agents, skills)   guarded: frontmatter class
// 11  subagent frontmatter `hooks:` (.claude/agents and ~/.claude/agents and plugin agents/, scanned RECURSIVELY)
//                                              (sub-agents#hooks-in-subagent-frontmatter)    guarded: frontmatter class (any .md below a dir named agents)
// 12  command frontmatter (.claude/commands, plugin commands/; "custom commands have been merged into skills", skills)
//                                                                                  guarded: frontmatter class (any .md below a dir named commands)
// 13  disableAllHooks (any settings level; hooks#disable-or-remove-hooks)           guarded: JSON class
// 14  allowManagedHooksOnly (managed settings; blocks user/project/plugin hooks)    guarded: JSON class (the file; the managed tier itself: RESIDUAL)
// 15  enabledPlugins { a1-specforge: false } (settings)                             guarded: JSON class; `claude plugin disable` / the /plugin UI: RESIDUAL (Bash)
// 16  scripts that an existing hook runs                                            RESIDUAL (tier 0: an edit of the script of a hook that already exists)
// 17  CLI-only definitions: `--agents <json>`, `--plugin-dir <dir>`                 RESIDUAL (launch flags)
// 18  cloud / self-hosted sessions (operator-seeded ~/.claude, runner-image managed settings)  RESIDUAL
//
// One monotone rule for the class (no old-vs-new comparison, no parsing of matchers, quotes or flow style): an edit that CHANGES a file of the
// class is denied when the OLD or the NEW whole content (.json and .md alike) holds, case-insensitively, `pretooluse` or `permissionrequest`,
// an escape marker (`\uXXXX`, `\xXX`, backslash-newline: the ways to spell a key without the substring; in an .md only inside the possible
// frontmatter region, from the opening `---` to the first line that is exactly `---`, because bash line continuations fill the bodies), `disableAllHooks` or
// `allowManagedHooksOnly`, or (settings .json) an `enabledPlugins` entry naming a1-specforge; for plugin.json / marketplace.json also when the
// old or new content has a `hooks` key (BOM or broken JSON: a plain "hooks" in the text). A settings file that already holds a hook is owner
// territory: an agent edits it only through Bash. A NotebookEdit of a class file is always denied. A Write to a new path counts the old
// content as empty. The class is matched on the lexical path and on the realpath, and `$CLAUDE_CONFIG_DIR` counts as `~/.claude`.
// A file that is the same device + inode as a settings*.json of ~/.claude, <cwd>/.claude or $CLAUDE_CONFIG_DIR (dotfiles symlinks) is in the class.
//
// guardedPath(file, cwd)   -> { guarded: true, why } | { guarded: false }
//       The owner stores: everything under <owner home>/.a1-xprov/, and `.a1/xprov.json` in any checkout. The path is judged as a string
//       (two forms: `..` collapsed, and as the operating system walks it; realpath through the deepest existing ancestor; `~` and `$HOME`
//       expanded; NFC + lower case) AND by device + inode of every existing ancestor (a macOS firmlink such as
//       /System/Volumes/Data/Users/<u>/.a1-xprov is no symlink). When the store directory does not exist yet, an ancestor named `.a1-xprov`
//       (case-insensitive) whose parent is the home directory (inode) is guarded too.
// settingsForgery(file, cwd, tool, input) -> { forged: true, why } | { forged: false }       the class rule above.
//
// Tier 0 stays: a Bash command that writes any of these is outside this hook (the same OS user can always do it).
// Request-scoped: no module state.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const X = require('./xprov.cjs');

const STORE_DIR_NAME = '.a1-xprov';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const OWN_REPO_ROOT = realish(path.resolve(__dirname, '..', '..')); // the checkout this module lives in (not a name field of an editable file)

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

function safeHome() {
  try { return os.homedir(); } catch (_e) { return ''; }
}

/** The forms of `file` to judge: lexical (`..` collapsed) and OS-walked, each realpath-resolved. */
function forms(file, cwd) {
  const raw = expandHome(String(file), safeHome());
  const abs = path.isAbsolute(raw) ? raw : `${cwd}/${raw}`;
  return [...new Set([realish(path.resolve(abs)), realish(abs.replace(/\/{2,}/g, '/'))])];
}

/** Store roots: the owner store dir by the resolver, and the one under the process home (equal in production). */
function rootCandidates() {
  const roots = [X.xprovHome()];
  const h = safeHome();
  if (h !== '') roots.push(path.join(h, STORE_DIR_NAME));
  return roots.map((r) => path.resolve(r));
}

const storeRoots = () => [...new Set(rootCandidates().flatMap((r) => [r, realish(r)]))].map(fold);
const isUnder = (p, root) => p === root || p.startsWith(`${root}/`);
const idOf = (p) => { try { const st = fs.statSync(p); return `${st.dev}:${st.ino}`; } catch (_e) { return null; } };
const idsOf = (list) => new Set(list.map(idOf).filter((id) => id !== null));

/** True when `p` or an existing ancestor is the same directory (device + inode) as a store root, or is a `.a1-xprov` entry of a home directory. */
function sameInodeUnder(p, storeIds, homeIds) {
  for (let cur = p; ; cur = path.dirname(cur)) {
    const id = idOf(cur);
    if (id !== null && storeIds.has(id)) return true;
    const parent = path.dirname(cur);
    if (fold(path.basename(cur)) === STORE_DIR_NAME && idOf(parent) !== null && homeIds.has(idOf(parent))) return true; // the store dir is not created yet
    if (parent === cur) return false;
  }
}

/** { guarded, why } for one file path (see header). */
function guardedPath(file, cwd) {
  if (typeof file !== 'string' || file === '') return { guarded: false };
  const roots = storeRoots();
  const storeIds = idsOf(rootCandidates());
  const homeIds = idsOf(rootCandidates().map((r) => path.dirname(r)));
  for (const raw of forms(file, cwd)) {
    if (sameInodeUnder(raw, storeIds, homeIds)) return { guarded: true, why: 'the owner store directory (~/.a1-xprov, same device and inode)' };
  }
  for (const f of forms(file, cwd).map(fold)) {
    if (roots.some((r) => isUnder(f, r))) return { guarded: true, why: 'the owner store directory (~/.a1-xprov)' };
    if (path.basename(f) === 'xprov.json' && path.basename(path.dirname(f)) === '.a1') return { guarded: true, why: '.a1/xprov.json (the repository permit file)' };
  }
  return { guarded: false };
}

// ---- the hook-source class ----
const PLUGIN_CACHE_RE = /\/\.claude\/plugins\/cache\/(?:.*\/)?a1-specforge(?:\/|$)/;
const EVENT_RE = /pretooluse|permissionrequest/i;
const ESCAPE_RE = /\\u[0-9a-f]{4}|\\x[0-9a-f]{2}|\\\r?\n/i;
const DISABLE_RE = /disableAllHooks|allowManagedHooksOnly/i;
const PLUGIN_ENTRY_RE = /a1-specforge[^"'\n,}]*["']?\s*:/i;

/** The class forms of `file`: realpath forms and lexical (unresolved) forms; a path below $CLAUDE_CONFIG_DIR also in its `~/.claude` spelling. */
function classForms(file, cwd) {
  const raw = expandHome(String(file), safeHome());
  const abs = path.isAbsolute(raw) ? raw : `${cwd}/${raw}`;
  const base = [...forms(file, cwd), path.resolve(abs), abs.replace(/\/{2,}/g, '/')];
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  if (typeof cfg !== 'string' || cfg === '') return [...new Set(base)];
  const roots = [path.resolve(expandHome(cfg, safeHome()))];
  roots.push(realish(roots[0]));
  const mapped = base.flatMap((f) => roots.filter((r) => isUnder(fold(f), fold(r))).map((r) => `/__config__/.claude${f.slice(r.length)}`));
  return [...new Set([...base, ...mapped])];
}

/** The file kind: 'cache' | 'json' | 'manifest' | 'md' | null. */
/** True when `file` is the same file (device + inode, symlinks followed) as a settings*.json of ~/.claude, <cwd>/.claude or $CLAUDE_CONFIG_DIR. */
function isKnownSettingsFile(file, cwd) {
  const id = idOf(forms(file, cwd)[0]);
  if (id === null) return false;
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  const dirs = [path.join(safeHome(), '.claude'), path.join(String(cwd || ''), '.claude'), ...(typeof cfg === 'string' && cfg !== '' ? [expandHome(cfg, safeHome())] : [])];
  return dirs.some((d) => {
    let names = [];
    try { names = fs.readdirSync(d).filter((n) => /^settings[^/]*\.json$/i.test(n)); } catch (_e) { /* no such directory */ }
    return names.some((n) => idOf(path.join(d, n)) === id);
  });
}

function fileClass(file, cwd) {
  const fs_ = classForms(file, cwd);
  const low = fs_.map(fold);
  if (low.some((f) => PLUGIN_CACHE_RE.test(f))) return 'cache';
  const named = (f) => path.basename(f);
  const parent = (f) => path.basename(path.dirname(f));
  const segs = (f) => f.split('/').slice(0, -1);
  if (low.some((f) => named(f) === 'hooks.json' && parent(f) === 'hooks')) {
    return fs_.some((f) => f === path.join(OWN_REPO_ROOT, 'hooks', 'hooks.json')) ? null : 'json';
  }
  if (low.some((f) => (named(f) === 'plugin.json' || named(f) === 'marketplace.json') && parent(f) === '.claude-plugin')) return 'manifest';
  if (low.some((f) => /^settings[^/]*\.json$/.test(named(f)) && parent(f) === '.claude') || isKnownSettingsFile(file, cwd)) return 'json';
  if (low.some((f) => /^managed-settings[^/]*\.json$/.test(named(f)) || (named(f).endsWith('.json') && segs(f).includes('managed-settings.d')))) return 'json';
  if (low.some((f) => named(f).endsWith('.json') && f.includes('/.claude/plugins/'))) return 'json';
  if (low.some((f) => named(f) === 'skill.md' || (named(f).endsWith('.md') && (segs(f).includes('agents') || segs(f).includes('commands'))))) return 'md';
  return null;
}

function readOld(file, cwd) {
  try {
    const abs = forms(file, cwd)[0];
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
  for (const e of edits) text = text === null ? null : replaceOnce(text, e && e.old_string, e && e.new_string, Boolean(e && e.replace_all));
  return { text, fragment };
}

const view = (text) => String(text);

/** The part of a .md where a YAML escape could spell a key: from the opening `---` (leading BOM and whitespace, blank lines included, stripped) to the first line that is exactly `---` (else the whole text); '' when the file does not open with `---`. */
function frontmatterRegion(text) {
  const t = String(text).replace(/^[\uFEFF\s]+/, '');
  if (!t.startsWith('---')) return '';
  const lines = t.split('\n');
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  return end === -1 ? t : lines.slice(0, end + 1).join('\n');
}

/** True when the manifest text carries a hooks entry (plugin.json: `hooks`; marketplace.json: a `hooks` on a plugin entry). Unparseable text (BOM, broken JSON): a plain "hooks". */
function hasHooksKey(text, isMarketplace) {
  try {
    const d = JSON.parse(text);
    const list = isMarketplace ? (d && Array.isArray(d.plugins) ? d.plugins.map((p) => p && p.hooks) : []) : [d && d.hooks];
    return list.some((h) => h !== undefined && h !== null);
  } catch (_e) { return /"hooks"/i.test(String(text)); }
}

/** The reason a class file's change is refused, or null. `old` and `neu` are the whole texts (the monotone rule, see the header). */
function refusal(kind, file, old, neu) {
  if (old === neu) return null;
  const texts = [view(old), view(neu)];
  const escTexts = kind === 'md' ? texts.map(frontmatterRegion) : texts; // bash line continuations in the body of an .md are no keys
  if (texts.some((t) => EVENT_RE.test(t))) return 'the file holds a PreToolUse or PermissionRequest entry before or after the edit (such a hook can answer the consent question with updatedInput.answers)';
  if (escTexts.some((t) => ESCAPE_RE.test(t))) return 'the file holds escape sequences that can spell a hook event without the plain name';
  if (texts.some((t) => DISABLE_RE.test(t))) return 'the file holds disableAllHooks / allowManagedHooksOnly, which would disable the consent hook';
  if (kind === 'json' && texts.some((t) => /enabledplugins/i.test(t) && PLUGIN_ENTRY_RE.test(t))) return 'the file has an enabledPlugins entry for a1-specforge, which would switch the consent hook off';
  if (kind === 'manifest') {
    const mk = path.basename(forms(file, '/')[0]).toLowerCase() === 'marketplace.json';
    if (String(old).trim() !== '' && hasHooksKey(old, mk)) return 'the plugin manifest has a hooks entry (inline hooks or a path to a hooks file)';
    if (hasHooksKey(neu, mk)) return 'the plugin manifest would get a hooks entry (inline hooks or a path to a hooks file)';
  }
  return null;
}

/** { forged, why }: the files from which a hook could answer the consent question or switch this hook off. See the header. */
function settingsForgery(file, cwd, tool, input) {
  if (typeof file !== 'string' || file === '') return { forged: false };
  const kind = fileClass(file, cwd);
  if (kind === null) return { forged: false };
  if (kind === 'cache') return { forged: true, why: 'a file of the installed a1-specforge plugin (the plugin cache is read-only for agents)' };
  if (tool === 'NotebookEdit') return { forged: true, why: 'a notebook edit cannot be checked as a settings, hooks, manifest or frontmatter change' };
  const old = readOld(file, cwd);
  const next = newContent(tool, input && typeof input === 'object' ? input : {}, old);
  // An edit that cannot be applied (the old text is not found, the file is too large): the old content and the added text are both judged.
  const why = refusal(kind, file, old || '', next.text === null ? next.fragment : next.text);
  return why === null ? { forged: false } : { forged: true, why };
}

module.exports = { STORE_DIR_NAME, guardedPath, settingsForgery, fileClass, forms, storeRoots };
