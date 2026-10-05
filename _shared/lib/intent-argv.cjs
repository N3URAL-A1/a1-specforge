'use strict';

// ---------------------------------------------------------------------------
// intent-argv — what `intent run` hands to a child and the guard in front of
// every spawn (spec 011, Wave 6: FR-021, FR-022, FR-023, FR-039, FR-042,
// FR-049). Pure except for the realpath of the seal (buildArgv) and the
// optional realpath check of the guard. Moved out of intent-run.cjs in Wave 6
// part B (guardArgv, guardStageArgv unchanged in shape); intent-run
// re-exports them.
//
//   buildArgv(row, target, seal, where) — the FR-022 template: `-p <prompt>`,
//     --restricted, --strict-mcp-config, --mcp-config <EMPTY_MCP>, the row's
//     --tools/--allowedTools, --disallowedTools <deny rules…>, --plugin-dir
//     and --add-dir <SEAL>, dontAsk, --permission-prompts none,
//     --no-session-persistence, --append-system-prompt, --output-format json.
//     <T> = realpath(<SEAL>)/_shared/a1-tools.cjs, byte-identical in the
//     allow list and in the system prompt (RESEARCH.md round 3, B1-GIT).
//   buildDenyRules — Bash(git *--output*), the four wrapper rules (B6), the
//     seal, the work-tree rules of <CWD> (FR-042), for a write action the
//     primary checkout, and the 8 private-state rules (FR-049).
//   buildEnv — built from nothing, never a filtered process.env (RESEARCH.md
//     round 3, B4-a/b/c: zsh re-reads ~/.zshenv on every Bash call, and
//     switching only SHELL still inherits the parent's credentials; only
//     `env -i` + SHELL=/bin/bash gave a Bash tool without any credential
//     variable and working OAuth; round 5's control printed a vault root read
//     from ~/.zshenv). No variable is added beyond INTENT_CHILD_ENV_NAMES.
//   guardArgv / guardStageArgv (FR-039) — pure checks over a built argv; the
//     guard pins the seal, work-tree, primary, private-state and wrapper
//     rules, the empty MCP path, the system prompt and a normalised <T>
//     itself; a caller may only add deny rules or narrow the env names.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const {
  INTENT_CHILD_ENV_NAMES, INTENT_CHILD_OPTIONAL_ENV_NAMES, INTENT_ROW_TOOLS, INTENT_WRAPPER_DENY, SAFE_PATH_RE, INTENT_HOSTNAME_RE,
  childSystemPrompt, rowAllow, readDenyRules, workTreeDenyRules,
} = require('./intent-constants.cjs');
const { GIT_CONFIG_ENV } = require('./intent-git.cjs');

const A1_TOOLS_REL = path.join('_shared', 'a1-tools.cjs');
const CHILD_SHELL = '/bin/bash';
const BASE_PATH = Object.freeze(['/usr/bin', '/bin']);
const SAFE_LANG_RE = /^[A-Za-z0-9_.@-]{1,64}$/;
const DEFAULT_LANG = 'en_US.UTF-8';

// ---------- build (FR-022, FR-023, FR-042, FR-049) ----------

const sealTools = (sealDir) => path.join(sealDir, A1_TOOLS_REL);

// Every deny rule of FR-022, one argv element each. `primary` (write actions
// only): the owner's checkout, which the child's tools must never write.
function buildDenyRules({ sealDir, cwd, passwdHome, primary = null }) {
  return Object.freeze([
    'Bash(git *--output*)', ...INTENT_WRAPPER_DENY, `Edit(/${sealDir}/**)`, `Write(/${sealDir}/**)`,
    ...workTreeDenyRules(cwd), ...(primary ? [`Edit(/${primary}/**)`, `Write(/${primary}/**)`] : []), ...readDenyRules(passwdHome),
  ]);
}

// The row's prompt with the validated target substituted once.
function promptOf(row, target) {
  if (!row.prompt.includes('{target}')) return row.prompt;
  if (typeof target !== 'string' || target.length === 0) throw new Error('buildArgv: this action needs its target');
  return row.prompt.replace('{target}', target);
}

// -> { argv, a1Tools, prompt, denyRules, systemPrompt, emptyMcpPath, sealDir }.
// seal: { sealDir }; where: { cwd, passwdHome, primary? }.
function buildArgv(row, target, seal, where, deps = {}) {
  const realpath = deps.realpath || fs.realpathSync.native;
  const sealDir = realpath(seal.sealDir); // FR-022: <T> is a normalised realpath, no link, no `//`
  const a1Tools = sealTools(sealDir);
  const emptyMcpPath = path.join(path.dirname(sealDir), 'empty-mcp.json');
  const prompt = promptOf(row, target);
  const denyRules = buildDenyRules({ sealDir, ...where });
  const systemPrompt = childSystemPrompt(a1Tools);
  const argv = [
    '-p', prompt, '--restricted', '--strict-mcp-config', '--mcp-config', emptyMcpPath,
    '--tools', INTENT_ROW_TOOLS[row.row].join(','), '--allowedTools', rowAllow(row.row, a1Tools).join(','),
    '--disallowedTools', ...denyRules, '--plugin-dir', sealDir, '--add-dir', sealDir,
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--no-session-persistence',
    '--append-system-prompt', systemPrompt, '--output-format', 'json',
  ];
  return Object.freeze({ argv: Object.freeze(argv), a1Tools, prompt, denyRules, systemPrompt, emptyMcpPath, sealDir });
}

// FR-023 — `stage`: [<T>, product, stage, --by <feature-id>, --set <stage>,
// --dir docs/product], spawned as process.execPath.
function buildStageArgv(target, seal, deps = {}) {
  const realpath = deps.realpath || fs.realpathSync.native;
  const sealDir = realpath(seal.sealDir);
  const at = String(target).lastIndexOf(':');
  const [featureId, stage] = [String(target).slice(0, at), String(target).slice(at + 1)];
  const argv = [sealTools(sealDir), 'product', 'stage', '--by', featureId, '--set', stage, '--dir', 'docs/product'];
  return Object.freeze({ argv: Object.freeze(argv), a1Tools: argv[0], featureId, stage, sealDir });
}

// FR-021 — the child env, from nothing. ctx: { home, user, vaultRoot, action,
// project, id }; bins: absolute paths of the resolved node, claude and git.
// A1_HOST_ID / A1_VAULT_WRITER_HOST are copied only when set to a host name
// (INTENT_HOSTNAME_RE, part B review m6); any other value stays behind.
function buildEnv(parentEnv, ctx, bins) {
  const dirs = [...new Set([...bins.filter(Boolean).map((b) => path.dirname(b)), ...BASE_PATH])];
  const optional = Object.fromEntries(INTENT_CHILD_OPTIONAL_ENV_NAMES
    .filter((n) => typeof parentEnv[n] === 'string' && parentEnv[n].length > 0 && INTENT_HOSTNAME_RE.test(parentEnv[n]))
    .map((n) => [n, parentEnv[n]]));
  return Object.freeze({
    HOME: ctx.home,
    USER: ctx.user,
    LANG: SAFE_LANG_RE.test(parentEnv.LANG || '') ? parentEnv.LANG : DEFAULT_LANG,
    SHELL: CHILD_SHELL,
    PATH: dirs.join(':'),
    A1_VAULT_ROOT: ctx.vaultRoot,
    A1_INTENT_CHILD: '1',
    A1_INTENT_ACTION: ctx.action,
    A1_INTENT_PROJECT: ctx.project,
    A1_INTENT_ID: ctx.id,
    ...optional,
    ...GIT_CONFIG_ENV,
  });
}

// ---------- argv guard (FR-039) ----------

// Every flag of the FR-022 template -> its number of values (the deny list
// takes every following element that does not start with `-`).
const CLAUDE_TEMPLATE_FLAGS = Object.freeze({
  '-p': 1, '--restricted': 0, '--strict-mcp-config': 0, '--mcp-config': 1, '--tools': 1, '--allowedTools': 1,
  '--disallowedTools': Infinity, '--plugin-dir': 1, '--add-dir': 1, '--permission-mode': 1, '--permission-prompts': 1,
  '--no-session-persistence': 0, '--append-system-prompt': 1, '--output-format': 1,
});
const FIXED_VALUES = Object.freeze({ '--permission-mode': 'dontAsk', '--permission-prompts': 'none', '--output-format': 'json' });
const NODE_OPTION_RE = /^(?:-e|--eval|-p|--print|-r|--require|--import|--loader|--experimental-loader|--env-file|--inspect(?:-brk|-port|-wait|-publish-uid)?)(?:=|$)/;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PAYLOAD_SUBSTRING_MIN = 16;

const fail = (rule) => Object.freeze({ ok: false, rule });
const safePath = (p) => typeof p === 'string' && SAFE_PATH_RE.test(p) && path.normalize(p) === p;

// FR-022 — <T> has no `//`, no `.`/`..` segment and (when a realpath is
// given) equals its realpath. -> null or the rule.
function toolsPathRule(t, realpath) {
  if (typeof t !== 'string' || !t.startsWith('/') || t.includes('//') || t.split('/').some((s) => s === '.' || s === '..')) return 't_not_normalised';
  if (!realpath) return null;
  try {
    return realpath(t) === t ? null : 't_not_normalised';
  } catch (_e) {
    return 't_not_normalised';
  }
}

// Forbidden anywhere, whatever the flag: bypass spellings, settings, payload.
function forbiddenElement(argv, payload) {
  for (const el of argv.map(String)) {
    if (/dangerously/i.test(el)) return 'forbidden_dangerously';
    if (/bypassPermissions/i.test(el)) return 'forbidden_bypass_permissions';
    if (el === '--settings' || el.startsWith('--settings=')) return 'forbidden_settings';
    if (el === '--setting-sources' || el.startsWith('--setting-sources=')) return 'forbidden_setting_sources';
    if (typeof payload === 'string' && payload.length > 0 && (el === payload || (payload.length >= PAYLOAD_SUBSTRING_MIN && el.includes(payload)))) return 'payload_in_argv';
  }
  return null;
}

// -> { flags: { flag: [values…] per occurrence } } or { rule }.
function parseTemplateArgv(argv) {
  if (argv[0] !== '-p') return { rule: 'first_element_not_p' };
  const flags = {};
  for (let i = 0; i < argv.length;) {
    const el = String(argv[i]);
    if (!Object.prototype.hasOwnProperty.call(CLAUDE_TEMPLATE_FLAGS, el)) return { rule: el.startsWith('-') ? 'unknown_flag' : 'stray_element' };
    const arity = CLAUDE_TEMPLATE_FLAGS[el];
    let j = i + 1;
    if (arity === Infinity) while (j < argv.length && !String(argv[j]).startsWith('-')) j += 1;
    else j += arity;
    if (j > argv.length) return { rule: `missing_value:${el}` };
    flags[el] = [...(flags[el] || []), argv.slice(i + 1, j).map(String)];
    i = j;
  }
  return { flags };
}

// FR-039 pins on the allow list: exactly one Bash rule for row W, and none
// that names raw git, a node option or an env assignment before `node`; its
// <T> must be normalised (FR-022).
function allowEntriesRule(value, row, a1Tools, realpath) {
  const bash = value.split(',').filter((e) => /^Bash\(/.test(e));
  for (const e of bash) {
    const tokens = e.slice('Bash('.length, -1).trim().split(/\s+/);
    const nodeAt = tokens.indexOf('node');
    if (tokens.slice(0, nodeAt < 0 ? tokens.length : nodeAt).some((t) => ENV_ASSIGNMENT_RE.test(t))) return 'allow_env_assignment';
    if (nodeAt !== 0 && tokens.includes('git')) return 'allow_raw_git';
    if (nodeAt === 0 && tokens.slice(1).some((t) => NODE_OPTION_RE.test(t))) return 'allow_node_option';
    if (nodeAt === 0 && tokens[1] && tokens[1].startsWith('/')) {
      const bad = toolsPathRule(tokens[1], realpath);
      if (bad) return bad;
    }
  }
  const want = row === 'W' ? [`Bash(node ${a1Tools} *)`] : [];
  return bash.join('\n') === want.join('\n') ? null : 'bash_rule';
}

// Exact values of the flags that must appear exactly once. The system prompt
// is the current constant with this <T> (FR-022), never the caller's text.
function valueRule(flags, o, a1Tools) {
  const one = (f) => flags[f][0][0];
  const want = {
    '--mcp-config': o.emptyMcpPath, '--tools': INTENT_ROW_TOOLS[o.row].join(','), '--allowedTools': rowAllow(o.row, a1Tools).join(','),
    '--plugin-dir': o.sealDir, '--add-dir': o.sealDir, '--append-system-prompt': childSystemPrompt(a1Tools), ...FIXED_VALUES,
    '-p': o.prompt,
  };
  const bad = Object.keys(want).find((f) => one(f) !== want[f]);
  if (bad) return bad === '--append-system-prompt' ? 'system_prompt' : `value:${bad}`;
  const deny = flags['--disallowedTools'][0];
  return JSON.stringify(deny) === JSON.stringify([...o.denyRules]) ? null : 'deny_rules';
}

// Each wrapper rule exactly once in the argv's deny list (B6).
function wrapperRule(flags) {
  const deny = flags['--disallowedTools'] ? flags['--disallowedTools'][0] : [];
  return INTENT_WRAPPER_DENY.every((r) => deny.filter((x) => x === r).length === 1) ? null : 'wrapper_deny_missing';
}

// Review MINOR-5: what the guard pins itself; the caller may only add. The
// deny list must hold the seal, wrapper, work-tree (FR-042), primary (row W,
// FR-043) and private-state (FR-049) rules, the MCP config is the seal dir's
// empty-mcp.json, and the prompt is always given.
function pinnedRule(o) {
  if (typeof o.prompt !== 'string' || o.prompt.length === 0) return 'prompt_unpinned';
  if (o.emptyMcpPath !== path.join(path.dirname(o.sealDir), 'empty-mcp.json')) return 'empty_mcp_path';
  const paths = [o.cwd, o.passwdHome, ...(o.row === 'W' ? [o.primary] : [])];
  if (!paths.every(safePath)) return o.row === 'W' && !o.primary ? 'primary_unpinned' : 'path_charset';
  const primary = o.row === 'W' ? [`Edit(/${o.primary}/**)`, `Write(/${o.primary}/**)`] : [];
  const required = [
    'Bash(git *--output*)', ...INTENT_WRAPPER_DENY, `Edit(/${o.sealDir}/**)`, `Write(/${o.sealDir}/**)`,
    ...workTreeDenyRules(o.cwd), ...primary, ...readDenyRules(o.passwdHome),
  ];
  const given = new Set(o.denyRules || []);
  return required.every((r) => given.has(r)) ? null : 'deny_rules_incomplete';
}

// Caller env names may only narrow the FR-021 set; an optional name, when
// present, is never empty (buildEnv copies only set, non-empty values).
function envRule(env, envNames) {
  const names = Object.keys(env || {});
  if (names.includes('NODE_OPTIONS')) return 'env_node_options';
  const allowed = INTENT_CHILD_ENV_NAMES.filter((n) => !envNames || envNames.includes(n));
  if (!names.every((n) => allowed.includes(n))) return 'env_name';
  return INTENT_CHILD_OPTIONAL_ENV_NAMES.some((n) => names.includes(n) && !env[n]) ? 'env_empty_value' : null;
}

// FR-039 -> { ok: true } | { ok: false, rule }. o: { row: 'R'|'W', sealDir,
// emptyMcpPath, payload, prompt, denyRules, env, cwd, passwdHome, primary
// (row W), envNames?, realpath? }.
function guardArgv(argv, o) {
  if (!Array.isArray(argv) || !Object.prototype.hasOwnProperty.call(INTENT_ROW_TOOLS, o.row)) return fail('row_or_argv_invalid');
  const forbidden = forbiddenElement(argv, o.payload);
  if (forbidden) return fail(forbidden);
  if (!safePath(o.sealDir) || !safePath(o.emptyMcpPath)) return fail('path_charset');
  const pinned = pinnedRule(o);
  if (pinned) return fail(pinned);
  const parsed = parseTemplateArgv(argv);
  if (parsed.rule) return fail(parsed.rule);
  const missing = Object.keys(CLAUDE_TEMPLATE_FLAGS).find((f) => !parsed.flags[f] || parsed.flags[f].length !== 1);
  if (missing) return fail(`flag_count:${missing}`);
  const a1Tools = sealTools(o.sealDir);
  const rule = wrapperRule(parsed.flags) || toolsPathRule(a1Tools, o.realpath)
    || allowEntriesRule(parsed.flags['--allowedTools'][0][0], o.row, a1Tools, o.realpath) || valueRule(parsed.flags, o, a1Tools)
    || envRule(o.env, o.envNames);
  return rule ? fail(rule) : Object.freeze({ ok: true });
}

// FR-039 for `stage` (kind cli): argv exactly [<T>, product, stage, --by <id>,
// --set <stage>, --dir docs/product], spawned as process.execPath, so no node
// option precedes <T>. -> { ok: true } | { ok: false, rule }.
function guardStageArgv(argv, { sealDir, featureId, stage, env, envNames, realpath }) {
  if (!safePath(sealDir)) return fail('path_charset');
  const t = sealTools(sealDir);
  const want = [t, 'product', 'stage', '--by', featureId, '--set', stage, '--dir', 'docs/product'];
  if (!Array.isArray(argv) || JSON.stringify(argv) !== JSON.stringify(want)) return fail('stage_argv');
  const rule = toolsPathRule(t, realpath) || envRule(env, envNames);
  return rule ? fail(rule) : Object.freeze({ ok: true });
}

module.exports = {
  CLAUDE_TEMPLATE_FLAGS,
  buildDenyRules,
  buildArgv,
  buildStageArgv,
  buildEnv,
  guardArgv,
  guardStageArgv,
};
