'use strict';

// ---------------------------------------------------------------------------
// xprov preflight / init-home — spec 009-cross-provider-review-gate, Wave 4
// (FR-014, FR-023, F-049 follow-up). Sole writer: this wave.
//
// `preflight` proves the dedicated Codex home is tool-less BEFORE any runner
// call. It runs every check and reports all of them — a human needs the full
// picture, not the first failure — and exits 1 if any check FAILs. stdout is
// the machine contract (`{ok, checks, failed, summary}`), stderr the human
// lines. `init-home` creates the home idempotently and never overwrites a
// file a human may have edited.
//
// Measured facts this module is built on (2026-09-24, codex-cli 0.155.1):
//   * `codex features list` lists `plugins` and `remote_plugin` as
//     stable+true by default; `codex features disable <f>` writes
//     `[features]\n<f> = false` into config.toml. THAT is the switch that
//     stops the remote/curated plugin auto-install Samuel measured — a
//     `[plugins.*]` table is not involved, which is why the two captured
//     runs installed plugins although config.toml had no such table.
//   * Wave 7 (2026-10-02, after the live smoke): `codex features list` shows
//     apps, browser_use, computer_use, hooks and skill_mcp_dependency_install
//     as true by default; `codex features disable <f>` appends `<f> = false`
//     to [features] in that order and omits the default-off `memories`. a1 pins
//     all eight explicitly (`features_pinned_off`), so a future default flip
//     cannot switch one back on silently. `init-home --pin-features` appends
//     the missing pins to an existing home — additive only, a human's `true`
//     is refused, never overwritten.
//   * Auth store (Wave 7, Samuel): `cli_auth_credentials_store = "file"` keeps
//     the credentials in the auth.json symlink a1 manages, never in a keyring
//     the tripwire cannot see. codex-cli 0.155.1 validates the value itself
//     (unknown variant → config error naming file|keyring|auto|ephemeral);
//     `auth_store_file` asserts it, `init-home --pin-features` pins it.
//   * Skill roots (Wave 7, canaries under a network block): `$CODEX_HOME/skills`
//     is a USER skill root next to the built-in `skills/.system`, so
//     `skills_system_only` requires `skills/` to hold `.system` and nothing
//     else. `/etc/codex/config.toml` and `requirements.toml` would configure
//     every Codex on the machine: `etc_codex_absent` requires both absent and
//     reports a present one with its sha256.
//   * `codex plugin marketplace list` in a fresh home prints "No plugin
//     marketplaces in scope": `openai-curated-remote` is a built-in remote
//     source, not a configured marketplace. `--prune-marketplaces` therefore
//     only tries `codex plugin marketplace remove openai-curated-remote` when
//     that subcommand exists, and reports the CLI's answer; the feature
//     switch is the primary control.
//   * Plugin cache shape: plugins/cache/<marketplace>/<plugin>/<version>/,
//     plus plugins/.remote-plugin-install-staging/.
//   * Session logs (sessions/YYYY/MM/DD/rollout-*.jsonl): a tool call is a
//     `response_item` record whose payload.type ends in `_call` and carries
//     `name` (measured: `custom_tool_call` / `exec`). `CommandExecution`
//     events embed file names in `"name"` position inside `command`, so the
//     check reads records, never greps for `"name"`.
// TOML is read line-based (table headers + `key = value`), no dependency; the
// config is checked against an ALLOWLIST of tables and key paths (see
// `unexpectedConfigCheck`), never against a list of known-bad keys.
// Exit-1 `reason`: `not_logged_in` when auth_present fails, otherwise
// `preflight_failed` — the one constant Wave 4 added to the frozen facade's
// REASON_LIST (documented exception, see the xprov.cjs header).
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const io = require('./io.cjs');
const xprov = require('./xprov.cjs');
const C = require('./xprov-common.cjs');

const HOME_MODE = 0o700;
const CONFIG_MODE = 0o600;
const CONFIG_FILE = 'config.toml';
const AUTH_FILE = 'auth.json';
const GLOBAL_CODEX_DIRNAME = '.codex';
const PYTHON_MIN = Object.freeze([3, 10]);
const ALLOWED_SESSION_TOOLS = Object.freeze(['exec', 'shell', 'local_shell']);
const REQUIRED_FEATURES_OFF = Object.freeze(['plugins', 'remote_plugin']);
// Wave 7 pins, in the order `codex features disable` writes them (memories last: a1's own line).
const FEATURE_PINS = Object.freeze(['apps', 'browser_use', 'computer_use', 'hooks', 'skill_mcp_dependency_install', 'memories']);
const ALL_FEATURE_PINS = Object.freeze([...REQUIRED_FEATURES_OFF, ...FEATURE_PINS]);
// Root keys a1 pins (key → required value), inserted after the last root entry.
const ROOT_PINS = Object.freeze({ cli_auth_credentials_store: 'file' });
const SKILLS_DIR = 'skills';
// Codex runtime dirs (xprov-run CODEX_RUNTIME_DIRS without skills/.system): content never hashed nor trusted.
const RUNTIME_DIRS_NOT_DESCENDED = Object.freeze(['cache', 'sessions', 'plugins', 'tmp', 'shell_snapshots', 'thread-writer-locks', 'log']);
const SKILLS_SYSTEM = '.system';
const ETC_CODEX_DIR = '/etc/codex';
const ETC_CODEX_FILES = Object.freeze(['config.toml', 'requirements.toml']);
const SHA_SHOWN = 12;
const PLUGIN_CACHE_DEPTH = 3;
const PLUGIN_STAGING_DIR = '.remote-plugin-install-staging';
const CURATED_MARKETPLACE = 'openai-curated-remote';
const SESSIONS_MAX_DEPTH = 6;
const CLI_OUTPUT_MAX = 300;
const CODEX_IGNORED_DIRS = Object.freeze(['cache', 'sessions', 'plugins', 'skills', 'tmp', 'shell_snapshots', 'thread-writer-locks']);

// The exact file init-home writes — byte-identical to the real
// ~/.codex-a1-review/config.toml after `codex features disable plugins` and
// `… remote_plugin` (measured 2026-09-24), plus the six Wave 7 pins as
// `codex features disable` appends them and a1's explicit `memories = false`
// (measured 2026-10-02; the harness's COMPLIANT_CONFIG carries the same bytes).
const COMPLIANT_CONFIG = `# a1-specforge — dedicated Codex home for cross-provider REVIEW runs only.
# Created 2026-09-24 (analysis finding F-049, spec 009-cross-provider-review-gate).
# Invariants: read-only sandbox, on-request approvals, NO MCP servers, NO plugins.
# The claudex-loop runner overrides approval_policy per call; the sandbox and the
# absence of MCP servers are what this file guarantees.
sandbox_mode = "read-only"
approval_policy = "on-request"
cli_auth_credentials_store = "file"

[features]
plugins = false
remote_plugin = false
apps = false
browser_use = false
computer_use = false
hooks = false
skill_mcp_dependency_install = false
memories = false
`;

// ---------- line-based TOML ----------

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

function unquote(v) {
  const s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

/** Splits a dotted TOML path on `.` outside quotes and strips the quotes of
 * every segment, so `"mcp_servers".x`, `mcp_servers."x"` and `mcp_servers.x`
 * all normalise to `mcp_servers.x` (Samuel, Waves 3+4 review). */
function splitDotted(str) {
  const segs = [];
  let cur = '';
  let quote = null;
  for (const ch of String(str)) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '.') { segs.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  segs.push(cur.trim());
  return segs.filter((s) => s !== '');
}

const KEY_SEGMENT = String.raw`(?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*')`;
const KEY_VALUE_RE = new RegExp(`^(${KEY_SEGMENT}(?:\\s*\\.\\s*${KEY_SEGMENT})*)\\s*=\\s*(.*)$`);

/** Returns fresh `{tables: [{name, line}], entries: [{table, key, path, value,
 * line}], unparsed: [lineNo…]}`. `name` and `key` are normalised dotted paths,
 * `path` is table + key. Every non-empty, non-comment line that is neither a
 * header nor `key = value` lands in `unparsed`: the compliant file holds only
 * scalars, so a continuation line of an inline table or array is never
 * legitimate and the allowlist check reports it. */
function parseTomlLines(text) {
  const tables = [];
  const entries = [];
  const unparsed = [];
  let table = '';
  String(text).split('\n').forEach((raw, idx) => {
    const line = stripComment(raw).trim();
    if (line === '') return;
    const header = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (header) {
      table = splitDotted(header[1]).join('.');
      tables.push(Object.freeze({ name: table, line: idx + 1 }));
      return;
    }
    const kv = line.match(KEY_VALUE_RE);
    if (kv) {
      const key = splitDotted(kv[1]).join('.');
      entries.push(Object.freeze({ table, key, path: table ? `${table}.${key}` : key, value: unquote(kv[2]), line: idx + 1 }));
      return;
    }
    unparsed.push(idx + 1);
  });
  return { tables, entries, unparsed };
}

// ---------- path helpers ----------

function realpathOrNull(p) {
  try { return fs.realpathSync(p); } catch (_e) { return null; }
}

function globalCodexHome(homedir) {
  return path.join(homedir || os.homedir(), GLOBAL_CODEX_DIRNAME);
}

/** realpath comparison — a symlink or `..` shape is caught; never a string compare. */
function isGlobalHome(home, homedir) {
  const a = realpathOrNull(home);
  const b = realpathOrNull(globalCodexHome(homedir));
  return a !== null && b !== null && a === b;
}

// ---------- config checks (pure over the TOML text) ----------

// ALLOWLIST, not denylist (Samuel, Waves 3+4 review): the compliant file is
// small and fixed. Every table header and every full key path outside this set
// FAILs `unexpected_config_key` — inline root tables (`mcp_servers = {…}`),
// dotted root keys (`mcp_servers.x.command`), `notify`, `model_provider` +
// `[model_providers.*]`, `profile` + `[profiles.*]`, `[shell_environment_policy]`,
// `[tools]`, `experimental_*` and anything Codex adds tomorrow all land here.
const ALLOWED_TABLES = Object.freeze(['', 'features']);
const ALLOWED_KEYS = Object.freeze([
  'sandbox_mode', 'approval_policy', 'model', 'model_reasoning_effort', ...Object.keys(ROOT_PINS),
  ...ALL_FEATURE_PINS.map((k) => `features.${k}`),
]);
const UNEXPECTED_LIST_MAX = 20;

function firstSegment(dotted) {
  return String(dotted).split('.')[0];
}

function unexpectedConfigCheck(parsed) {
  const badTables = parsed.tables.filter((t) => !ALLOWED_TABLES.includes(t.name)).map((t) => t.name);
  const badKeys = parsed.entries.filter((e) => !ALLOWED_KEYS.includes(e.path)).map((e) => e.path);
  const unexpected = [...new Set([...badTables, ...badKeys])].sort();
  const shown = unexpected.slice(0, UNEXPECTED_LIST_MAX);
  const more = unexpected.length - shown.length;
  const parts = [];
  if (unexpected.length) parts.push(`keys: ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`);
  if (parsed.unparsed.length) parts.push(`unparsed lines: ${parsed.unparsed.join(', ')}`);
  return check('unexpected_config_key', parts.length === 0, parts.length ? parts.join('; ') : 'all keys allowlisted');
}

function configChecks(text) {
  const parsed = parseTomlLines(text);
  const { tables, entries } = parsed;
  const root = (k) => entries.find((e) => e.table === '' && e.key === k);
  const sandbox = root('sandbox_mode');
  const authStore = entries.filter((e) => e.table === '' && e.key === 'cli_auth_credentials_store').map((e) => e.value);
  // Any table OR root key whose first dotted segment is `mcp_servers` counts:
  // `[mcp_servers.x]`, `["mcp_servers".x]`, `mcp_servers = {…}`, `mcp_servers.x.command = …`.
  const mcp = [
    ...tables.filter((t) => firstSegment(t.name) === 'mcp_servers').map((t) => `table [${t.name}]`),
    ...entries.filter((e) => e.table === '' && firstSegment(e.key) === 'mcp_servers').map((e) => `key ${e.key}`),
  ];
  const pluginTables = tables.filter((t) => /^plugins(\.|$)/.test(t.name));
  const enabledPlugins = pluginTables.filter((t) =>
    entries.some((e) => e.table === t.name && e.key === 'enabled' && e.value === 'true'));
  // Fail closed on ambiguity: every occurrence of the key must be `false` — a
  // second [features] table (whichever one Codex would honour) is a FAIL.
  const featureState = (k) => {
    const values = entries.filter((x) => x.table === 'features' && x.key === k).map((x) => x.value);
    return { key: k, value: values.length === 0 ? null : values.join("/"), off: values.length > 0 && values.every((v) => v === 'false') };
  };
  const describe = (list) => list.map((f) => (f.value === null ? `missing: features.${f.key}` : `features.${f.key} = ${f.value}`)).join(', ');
  const features = REQUIRED_FEATURES_OFF.map(featureState);
  const featuresOff = features.every((f) => f.off);
  const pins = FEATURE_PINS.map(featureState);
  return [
    check('sandbox_read_only', Boolean(sandbox) && sandbox.value === 'read-only',
      sandbox ? `sandbox_mode = "${sandbox.value}"` : 'sandbox_mode absent'),
    check('auth_store_file', authStore.length > 0 && authStore.every((v) => v === ROOT_PINS.cli_auth_credentials_store),
      authStore.length ? `cli_auth_credentials_store = "${authStore.join('/')}"` : 'cli_auth_credentials_store absent (Codex default may use a keyring)'),
    check('mcp_servers_absent', mcp.length === 0, mcp.length ? mcp.join(', ') : 'no mcp_servers table or key'),
    check('plugins_disabled', enabledPlugins.length === 0,
      enabledPlugins.length ? enabledPlugins.map((t) => `[${t.name}] enabled = true`).join(', ')
        : pluginTables.length ? `${pluginTables.map((t) => `[${t.name}]`).join(', ')} present, none enabled` : 'no [plugins.*] table'),
    check('remote_plugin_switch', featuresOff, describe(features)),
    check('features_pinned_off', pins.every((f) => f.off),
      pins.every((f) => f.off) ? `${FEATURE_PINS.length} pins false` : describe(pins.filter((f) => !f.off))),
    unexpectedConfigCheck(parsed),
  ];
}

// ---------- filesystem checks ----------

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (_e) { return []; }
}

/** Leaf directories under plugins/cache (depth ≤ 3, `marketplace/plugin/version`)
 * plus the staging dir. Fresh sorted array of relative paths. */
function scanPluginCache(home) {
  const cache = path.join(home, 'plugins', 'cache');
  const found = [];
  const walk = (dir, rel, depth) => {
    const subs = listDirs(dir);
    if (subs.length === 0 || depth === PLUGIN_CACHE_DEPTH) { if (rel) found.push(rel); return; }
    for (const s of subs) walk(path.join(dir, s), rel ? `${rel}/${s}` : s, depth + 1);
  };
  walk(cache, '', 0);
  if (fs.existsSync(path.join(home, 'plugins', PLUGIN_STAGING_DIR))) found.push(PLUGIN_STAGING_DIR);
  return found.sort();
}

function pluginCacheCheck(home, allowlist) {
  const allow = Array.isArray(allowlist) ? allowlist : [];
  const found = scanPluginCache(home);
  const isAllowed = (p) => allow.some((a) => p === a || p.startsWith(`${a}/`));
  const offenders = found.filter((p) => !isAllowed(p));
  const allowed = found.filter(isAllowed);
  if (offenders.length) return check('plugins_cache_empty', false, offenders.join(', '));
  return check('plugins_cache_empty', true, allowed.length ? `allowlisted: ${allowed.join(', ')}` : 'empty');
}

/** Every symlink in the dedicated home except the top-level auth.json (the one
 * link a1 creates itself): lstat walk, links never followed (Samuel m7 — a
 * linked `skills` or `skills/.system` hid its content from fileHashes and from
 * a readdirSync that follows links). Codex's runtime dirs are checked only as
 * entries, never descended: measured 2026-10-03, every run leaves arg0 shims
 * `tmp/arg0/codex-arg0<random>/{apply_patch,applypatch,codex-execve-wrapper}` →
 * its own binary. `skills/` (incl. `.system`) IS descended. Returns relative paths. */
function homeSymlinks(home) {
  const found = [];
  const walk = (dir, rel) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_e) { return; }
    for (const n of names.sort()) {
      const full = path.join(dir, n);
      const r = rel ? `${rel}/${n}` : n;
      let st;
      try { st = fs.lstatSync(full); } catch (_e) { continue; }
      if (st.isSymbolicLink()) { if (r !== AUTH_FILE) found.push(r); continue; }
      if (st.isDirectory() && !(rel === '' && RUNTIME_DIRS_NOT_DESCENDED.includes(n))) walk(full, r);
    }
  };
  walk(home, '');
  return found;
}

/** `skills/` and `skills/.system` are real directories owned by this user (or
 * absent): a symlink or a foreign owner → the reason, else null. */
function skillsDirsProblem(home) {
  for (const rel of [SKILLS_DIR, path.join(SKILLS_DIR, SKILLS_SYSTEM)]) {
    let st;
    try { st = fs.lstatSync(path.join(home, rel)); } catch (_e) { continue; }
    if (st.isSymbolicLink()) return `${rel} is a symlink`;
    if (!st.isDirectory()) return `${rel} is not a directory`;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return `${rel} is owned by uid ${st.uid}`;
  }
  return null;
}

function skillsRealDirsCheck(home) {
  const p = skillsDirsProblem(home);
  return check('skills_real_dirs', p === null, p || 'skills/ and skills/.system are real, own directories (or absent)');
}

function homeNoSymlinksCheck(home) {
  const links = homeSymlinks(home);
  return check('home_no_symlinks', links.length === 0, links.length ? `symlinks: ${links.slice(0, 10).join(', ')}` : 'no symlink besides auth.json');
}

/** `$CODEX_HOME/skills` is a user skill root (measured): only `.system` may live there. */
function skillsSystemOnlyCheck(home) {
  let names;
  let st = null;
  try { st = fs.lstatSync(path.join(home, SKILLS_DIR)); } catch (_e) { st = null; }
  if (st === null) return check('skills_system_only', true, 'no skills/ dir');
  if (!st.isDirectory()) return check('skills_system_only', false, 'skills/ is not a real directory (symlink?)');
  try { names = fs.readdirSync(path.join(home, SKILLS_DIR)); } catch (_e) { return check('skills_system_only', false, 'skills/ unreadable'); }
  const others = names.filter((n) => n !== SKILLS_SYSTEM).sort();
  return check('skills_system_only', others.length === 0, others.length ? `skills/ also holds: ${others.join(', ')}` : 'skills/ holds only .system');
}

/** A system-wide Codex config would apply to every run; absent is the only PASS. */
function etcCodexCheck(dir) {
  const present = ETC_CODEX_FILES.filter((f) => fs.existsSync(path.join(dir, f)));
  if (present.length === 0) return check('etc_codex_absent', true, `absent: ${dir}/{${ETC_CODEX_FILES.join(',')}}`);
  const shown = present.map((f) => {
    let h = 'unreadable';
    try { h = C.sha256(fs.readFileSync(path.join(dir, f))).slice(0, SHA_SHOWN); } catch (_e) { /* reported as unreadable */ }
    return `${f} sha256 ${h}`;
  });
  return check('etc_codex_absent', false, `${dir}: ${shown.join(', ')}`);
}

function newestSessionLog(home) {
  let best = null;
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < SESSIONS_MAX_DEPTH) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        const m = fs.statSync(p).mtimeMs;
        if (!best || m > best.mtimeMs) best = { file: p, mtimeMs: m };
      }
    }
  };
  walk(path.join(home, 'sessions'), 0);
  return best ? best.file : null;
}

/** Tool names measured from one rollout log — records, never a `"name"` grep.
 * MEASURED arm: `response_item` with payload.type `*_call` + `name` (five real
 * rollouts, 2026-09-24; only `custom_tool_call`/`exec` seen). UNMEASURED arm:
 * the `event_msg` / `mcp_tool_call*` branch below is written against a guessed
 * shape (testing.md class 3) — no MCP session has been captured, and none will
 * be captured with the review home. The value of this check today is the
 * response_item arm only; the mcp branch is belt-and-braces that may never
 * fire. Measuring a real MCP form is allowed only in a throwaway CODEX_HOME
 * without network — not done (Samuel, Waves 3+4). */
function sessionToolNames(file) {
  const names = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let rec;
    try { rec = JSON.parse(line); } catch (_e) { continue; }
    const p = rec && rec.payload;
    if (!p || typeof p.type !== 'string') continue;
    if (rec.type === 'response_item' && /_call$/.test(p.type)) {
      names.add(p.name ? String(p.name) : p.type.replace(/_call$/, ''));
    } else if (rec.type === 'event_msg' && p.type.startsWith('mcp_tool_call')) {
      const inv = p.invocation || {};
      names.add(`mcp:${inv.server || '?'}/${inv.tool || '?'}`);
    }
  }
  return [...names].sort();
}

function sessionToolsCheck(home) {
  const file = newestSessionLog(home);
  if (!file) return skip('session_tools_exec_only', 'no session');
  const names = sessionToolNames(file);
  const bad = names.filter((n) => !ALLOWED_SESSION_TOOLS.includes(n));
  if (bad.length) return check('session_tools_exec_only', false, `disallowed: ${bad.join(', ')}`);
  return check('session_tools_exec_only', true, names.length ? `tools: ${names.join(', ')}` : 'tools: none');
}

/** config.toml must be a REGULAR file (lstat, never stat): init-home always
 * writes one, and a symlink onto ~/.codex/config.toml would silently pass every
 * later global change through the "dedicated" home (Samuel, Waves 3+4). */
function configSymlinkCheck(configPath) {
  let st = null;
  try { st = fs.lstatSync(configPath); } catch (_e) { return check('config_is_symlink', true, 'no file'); }
  if (st.isSymbolicLink()) {
    let target = '?';
    try { target = fs.readlinkSync(configPath); } catch (_e) { /* unreadable link */ }
    return check('config_is_symlink', false, `symlink -> ${target}`);
  }
  return check('config_is_symlink', st.isFile(), st.isFile() ? 'regular file' : 'not a regular file');
}

function homeModeCheck(home) {
  try {
    const mode = octal(fs.statSync(home).mode);
    return check('home_mode_0700', mode === '700', `mode ${mode}`);
  } catch (_e) { return check('home_mode_0700', false, 'stat failed'); }
}

function authCheck(home) {
  const p = path.join(home, AUTH_FILE);
  let isLink = false;
  try { isLink = fs.lstatSync(p).isSymbolicLink(); } catch (_e) { /* absent */ }
  const present = fs.existsSync(p); // follows the symlink: a dangling link is `missing`
  return check('auth_present', present, present ? (isLink ? 'present (symlink)' : 'present') : 'missing (not_logged_in)');
}

function runnerPinCheck(opts) {
  const r = xprov.checkRunnerPin({ runnerPath: opts.runnerPath, sumsPath: opts.sumsPath });
  return check('runner_pin', r.ok, r.ok ? `sha256 ${r.actual.slice(0, 12)}…` : r.reason);
}

function spawnText(cmd, argv, env) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', env: env || process.env });
  const text = `${r.stdout || ''}${r.stderr || ''}`.trim().slice(0, CLI_OUTPUT_MAX);
  return { status: r.status, error: r.error ? r.error.code || 'spawn_error' : null, text };
}

function pythonCheck(env) {
  const r = spawnText('python3', ['--version'], env);
  const m = r.text.match(/Python (\d+)\.(\d+)(?:\.(\d+))?/);
  if (r.status !== 0 || !m) return check('python_version', false, r.error || r.text || 'python3 --version failed');
  const [maj, min] = [Number(m[1]), Number(m[2])];
  const ok = maj > PYTHON_MIN[0] || (maj === PYTHON_MIN[0] && min >= PYTHON_MIN[1]);
  return check('python_version', ok, m[0]);
}

function codexCliCheck(env) {
  const r = spawnText('codex', ['--version'], env);
  return check('codex_cli', r.status === 0, r.status === 0 ? r.text : (r.error || r.text || `exit ${r.status}`));
}

// ---------- preflight ----------

/** Runs every check, in order, and returns a frozen report. Never throws for
 * a failing check; only a hostile `codexHome` override throws (facade rule). */
function preflight(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const home = o.codexHome || xprov.codexHome(env);
  const homedir = o.homedir || os.homedir();
  const configPath = path.join(home, CONFIG_FILE);
  const homeExists = fs.existsSync(home);
  const configExists = fs.existsSync(configPath);
  let configText = '';
  if (configExists) { try { configText = fs.readFileSync(configPath, 'utf8'); } catch (_e) { configText = ''; } }
  const checks = [
    check('codex_home_is_global', !isGlobalHome(home, homedir),
      `home ${realpathOrNull(home) || home} vs ${realpathOrNull(globalCodexHome(homedir)) || globalCodexHome(homedir)}`),
    check('home_exists', homeExists, home),
    check('config_exists', configExists, configPath),
    configSymlinkCheck(configPath),
    homeModeCheck(home),
    ...configChecks(configText),
    pluginCacheCheck(home, o.pluginAllowlist),
    skillsSystemOnlyCheck(home),
    skillsRealDirsCheck(home),
    homeNoSymlinksCheck(home),
    sessionToolsCheck(home),
    etcCodexCheck(o.etcCodexDir || ETC_CODEX_DIR),
    authCheck(home),
    runnerPinCheck(o),
    pythonCheck(env),
    codexCliCheck(env),
  ];
  const failed = checks.filter((c) => c.result === 'FAIL').map((c) => c.name);
  const summary = checks.map((c) => `${c.name}: ${c.result} (${c.measured})`);
  const report = { ok: failed.length === 0, codex_home: home, checks, failed, summary };
  if (failed.length) report.reason = failed.includes('auth_present') ? xprov.REASONS.not_logged_in : xprov.REASONS.preflight_failed;
  return Object.freeze(report);
}

// ---------- init-home ----------

function tryPruneMarketplace(home, env) {
  const probe = spawnText('codex', ['plugin', 'marketplace', 'remove', '--help'], env);
  if (probe.status !== 0) {
    return Object.freeze({ attempted: false, reason: 'codex plugin marketplace remove unavailable', probe_status: probe.status, probe: probe.text });
  }
  const r = spawnText('codex', ['plugin', 'marketplace', 'remove', CURATED_MARKETPLACE], { ...env, CODEX_HOME: home });
  return Object.freeze({ attempted: true, marketplace: CURATED_MARKETPLACE, status: r.status, output: r.text });
}

function createFreshHome(home, homedir) {
  fs.mkdirSync(home, { recursive: true, mode: HOME_MODE });
  fs.chmodSync(home, HOME_MODE); // umask-proof
  const configPath = path.join(home, CONFIG_FILE);
  io.writeTextAtomic(configPath, COMPLIANT_CONFIG);
  fs.chmodSync(configPath, CONFIG_MODE);
  const target = path.join(globalCodexHome(homedir), AUTH_FILE);
  let auth;
  if (fs.existsSync(target)) {
    fs.symlinkSync(target, path.join(home, AUTH_FILE));
    auth = { linked: true, target, target_mode: octal(fs.statSync(target).mode) }; // reported, never changed
  } else {
    auth = { linked: false, target, reason: xprov.REASONS.not_logged_in };
  }
  return { created: [home, configPath].concat(auth.linked ? [path.join(home, AUTH_FILE)] : []), auth };
}

/** Appends the missing pins: root keys (ROOT_PINS) after the last root entry,
 * `<pin> = false` to [features] (or a new [features] table at the end).
 * Returns { text, added, conflicts }; never edits an existing line. */
function pinFeaturesText(text) {
  const parsed = parseTomlLines(text);
  const featureTables = parsed.tables.filter((t) => t.name === 'features');
  if (featureTables.length > 1) return { text, added: [], conflicts: ['more than one [features] table'] };
  if (featureTables.length === 1) {
    // A multi-line value inside [features] (continuation lines parse as `unparsed`)
    // has no safe insertion point after its last entry: refuse, never guess.
    const start = featureTables[0].line;
    const next = parsed.tables.find((tb) => tb.line > start);
    const end = next ? next.line : Infinity;
    if (parsed.unparsed.some((n) => n > start && n < end)) return { text, added: [], conflicts: ['[features] holds a multi-line value'] };
  }
  const valuesOf = (p) => parsed.entries.filter((e) => e.path === p).map((e) => e.value);
  const rootKeys = Object.keys(ROOT_PINS);
  const conflicts = [
    ...rootKeys.filter((k) => valuesOf(k).some((v) => v !== ROOT_PINS[k])).map((k) => `${k} = ${valuesOf(k).join('/')}`),
    ...ALL_FEATURE_PINS.filter((k) => valuesOf(`features.${k}`).some((v) => v !== 'false')).map((k) => `features.${k} = ${valuesOf(`features.${k}`).join('/')}`),
  ];
  if (conflicts.length) return { text, added: [], conflicts };
  const rootAdd = rootKeys.filter((k) => valuesOf(k).length === 0);
  const featAdd = ALL_FEATURE_PINS.filter((k) => valuesOf(`features.${k}`).length === 0);
  const added = [...rootAdd, ...featAdd];
  if (added.length === 0) return { text, added, conflicts };
  const lines = String(text).replace(/\n$/, '').split('\n');
  const featLines = featAdd.map((k) => `${k} = false`);
  if (featLines.length) {
    if (featureTables.length === 0) lines.push('', '[features]', ...featLines);
    else {
      const header = featureTables[0].line;
      const last = Math.max(header, ...parsed.entries.filter((e) => e.table === 'features').map((e) => e.line));
      lines.splice(last, 0, ...featLines);
    }
  }
  if (rootAdd.length) {
    // after the last root entry; with none, before the first table (or at the end)
    const rootEntries = parsed.entries.filter((e) => e.table === '').map((e) => e.line);
    const firstTable = parsed.tables.length ? parsed.tables[0].line - 1 : lines.length;
    const at = rootEntries.length ? Math.max(...rootEntries) : firstTable;
    lines.splice(at, 0, ...rootAdd.map((k) => `${k} = "${ROOT_PINS[k]}"`));
  }
  return { text: `${lines.join('\n')}\n`, added, conflicts };
}

/** `init-home --pin-features` on an existing home: additive, atomic, 0600 kept. */
function pinFeatures(home, configPath) {
  const sym = configSymlinkCheck(configPath);
  if (sym.result !== 'PASS') return Object.freeze({ ok: false, changed: false, codex_home: home, reason: 'pin_refused', failed: [sym.name], pinned: [], detail: sym.measured });
  const before = fs.readFileSync(configPath, 'utf8');
  const r = pinFeaturesText(before);
  if (r.conflicts.length) return Object.freeze({ ok: false, changed: false, codex_home: home, reason: 'pin_conflict', failed: ['features_pinned_off'], pinned: [], conflicts: r.conflicts });
  if (r.added.length) { io.writeTextAtomic(configPath, r.text); fs.chmodSync(configPath, CONFIG_MODE); }
  return null;
}

function isEffectivelyEmpty(home) {
  return fs.readdirSync(home).filter((n) => !CODEX_IGNORED_DIRS.includes(n)).length === 0;
}

/** Idempotent: creates a missing home (0700 + compliant config + auth
 * symlink), verifies an existing one, never rewrites an existing config.toml. */
function initHome(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const home = o.codexHome || xprov.codexHome(env);
  const homedir = o.homedir || os.homedir();
  if (isGlobalHome(home, homedir)) {
    return Object.freeze({ ok: false, changed: false, codex_home: home, reason: 'codex_home_is_global', failed: ['codex_home_is_global'] });
  }
  const configPath = path.join(home, CONFIG_FILE);
  const exists = fs.existsSync(home);
  if (!exists || (!fs.existsSync(configPath) && isEffectivelyEmpty(home))) {
    const made = createFreshHome(home, homedir);
    return Object.freeze({ ok: true, changed: true, codex_home: home, ...made,
      plugins_found: scanPluginCache(home), pruned: o.pruneMarketplaces ? tryPruneMarketplace(home, env) : { attempted: false, reason: 'not requested' } });
  }
  let pinned = [];
  if (o.pinFeatures && fs.existsSync(configPath)) {
    const before = parseTomlLines(fs.readFileSync(configPath, 'utf8'));
    const refused = pinFeatures(home, configPath);
    if (refused) return refused;
    const after = parseTomlLines(fs.readFileSync(configPath, 'utf8'));
    const paths = [...Object.keys(ROOT_PINS), ...ALL_FEATURE_PINS.map((k) => `features.${k}`)];
    pinned = paths.filter((p) => !before.entries.some((e) => e.path === p) && after.entries.some((e) => e.path === p)).map((p) => p.replace(/^features\./, ''));
  }
  const configExists = fs.existsSync(configPath);
  const checks = [
    homeModeCheck(home),
    check('config_exists', configExists, configPath),
    configSymlinkCheck(configPath),
    ...configChecks(configExists ? fs.readFileSync(configPath, 'utf8') : ''),
  ];
  const failed = checks.filter((c) => c.result === 'FAIL').map((c) => c.name);
  return Object.freeze({
    ok: failed.length === 0, changed: pinned.length > 0, codex_home: home, checks, failed, pinned,
    plugins_found: scanPluginCache(home),
    pruned: o.pruneMarketplaces ? tryPruneMarketplace(home, env) : { attempted: false, reason: 'not requested' },
  });
}

// ---------- CLI ----------

function cmdXprovPreflight(args) {
  const flags = io.parseFlags(args || [], { 'allow-plugins': 'string' });
  if (flags._.length) return usageExit(`preflight: unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  const home = resolveHomeOrExit('preflight');
  if (home === null) return null;
  const allow = flags['allow-plugins'] ? String(flags['allow-plugins']).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const report = preflight({ codexHome: home, pluginAllowlist: allow });
  const lines = [...report.summary, report.ok ? 'preflight: PASS' : `preflight: FAIL (${report.failed.join(', ')})`];
  return emit(report, lines, report.ok ? xprov.EXIT_PASS : xprov.EXIT_FAIL);
}

function cmdXprovInitHome(args) {
  const flags = io.parseFlags(args || [], { 'prune-marketplaces': 'bool', 'pin-features': 'bool' });
  if (flags._.length) return usageExit(`init-home: unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  const home = resolveHomeOrExit('init-home');
  if (home === null) return null;
  const r = initHome({ codexHome: home, pruneMarketplaces: Boolean(flags['prune-marketplaces']), pinFeatures: Boolean(flags['pin-features']) });
  const lines = [];
  if (r.reason === 'codex_home_is_global') lines.push(`init-home: refused — ${home} is the global ~/.codex`);
  else if (r.reason === 'pin_conflict') lines.push(`init-home: --pin-features refused — ${r.conflicts.join(', ')}; a human set it, a1 does not overwrite it`);
  else if (r.reason === 'pin_refused') lines.push(`init-home: --pin-features refused — ${r.detail}`);
  else if (r.pinned && r.pinned.length) lines.push(`init-home: pinned ${r.pinned.join(', ')} in ${home}/config.toml${r.ok ? '' : ` — still failing: ${r.failed.join(', ')}`}`);
  else if (r.changed) lines.push(`init-home: created ${home} (0700) with the compliant config.toml${r.auth.linked ? ' and auth.json symlink' : ' — no ~/.codex/auth.json to link (not_logged_in)'}`);
  else if (r.ok) lines.push(`init-home: ${home} already compliant, nothing written`);
  else {
    lines.push(`init-home: ${home} exists but fails: ${r.failed.join(', ')} — not overwriting a human's config.toml`);
    if (r.failed.includes('remote_plugin_switch')) lines.push('  add to config.toml:\n  [features]\n  plugins = false\n  remote_plugin = false');
  }
  if (r.plugins_found && r.plugins_found.length) lines.push(`init-home: plugin dirs present (reported, never deleted): ${r.plugins_found.join(', ')}`);
  return emit(r, lines, r.ok ? xprov.EXIT_PASS : xprov.EXIT_FAIL);
}

// ---------- report shape + CLI plumbing (no checks live below this line) ----------

function check(name, pass, measured) {
  return Object.freeze({ name, result: pass ? 'PASS' : 'FAIL', measured: String(measured) });
}

function skip(name, measured) {
  return Object.freeze({ name, result: 'SKIP', measured: String(measured) });
}

function octal(mode) {
  return (mode & 0o777).toString(8);
}

const usageExit = (msg) => C.usageExit('', msg);

/** stdout: the JSON contract (shared writer); stderr: the human lines. */
function emit(report, humanLines, code) {
  for (const l of humanLines) process.stderr.write(`${l}\n`);
  return C.emitJson(report, code, false);
}

/** The dedicated home, or `null` after a usage error (callers return). */
function resolveHomeOrExit(sub) {
  try { return xprov.codexHome(process.env); } catch (e) {
    return usageExit(`${sub}: ${e.message}`);
  }
}

module.exports = {
  COMPLIANT_CONFIG, ALLOWED_SESSION_TOOLS, REQUIRED_FEATURES_OFF, FEATURE_PINS, CURATED_MARKETPLACE,
  parseTomlLines, configChecks, pinFeaturesText, homeSymlinks, skillsDirsProblem, scanPluginCache, sessionToolNames, isGlobalHome,
  preflight, initHome,
  cmdXprovPreflight, cmdXprovInitHome,
};
