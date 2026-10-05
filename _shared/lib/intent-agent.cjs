'use strict';

// ---------------------------------------------------------------------------
// intent-agent — `a1-tools intent install-agent [--uninstall | --status]
// [--force]` (spec 011, Wave 11 ops half: FR-032, FR-017, FR-037, FR-040,
// FR-046). Installs the LaunchAgent ai.n3ural.a1-intent-tick that runs
// `a1-tools intent tick` every 30 s on the executor Mac. Library-only seam:
// injectAgentDeps() / the `deps` argument; no environment variable reaches
// launchctl, the plist directory or the doctor.
//
// Install, in this order; the first failing gate refuses (exit 1, stdout
// {"ok":false,"reasons":[code],"detail"}, nothing written, launchctl never
// called). `--yes` is a usage error (exit 2), as for seal and approve.
//   not_a_tty             stdin and stdout must be a TTY (checked first).
//   claude_code_context   no CLAUDECODE / CLAUDE_PID / CLAUDE_CODE_* variable,
//                         no Claude Code ancestor (xprov-approve's walk, fail
//                         closed), not in intent child mode: the human
//                         boundary of seal/approve/xprov approve. The subcommand is also absent
//                         from every INTENT_CHILD_ALLOWLIST row, so a child is
//                         refused (exit 77) before this code loads.
//   unsupported_platform  launchd exists on darwin only.
//   not_executor_host     FR-017: os.hostname() == executor.json host.
//   vault_root_missing    A1_VAULT_ROOT is required (the plist carries it).
//   claude_missing / node_missing   resolved from PATH by a JS walk (absolute
//                         entries only, no shell); the plist PATH holds the
//                         directories of both.
//   invalid_value         A1_HOST_ID (optional) outside [A-Za-z0-9._-]{1,64},
//                         or a path with a control character.
//   doctor_failed         runDoctor() in-process; any failing check (the
//                         *:58589 Obsidian listener is the ship-blocker).
//   seal_invalid          verifySeal() must be ok (FR-040).
//   plist_exists_differs  an existing plist with other bytes is never
//                         overwritten without --force; a symlink never.
//   not_confirmed         the owner types "yes" on /dev/tty after seeing the
//                         plist values.
// Then: render the template (_shared/templates/ai.n3ural.a1-intent-tick.plist;
// values XML-escaped; the marker-fenced A1_HOST_ID block is deleted when
// A1_HOST_ID is empty; no A1_INTENT_* key, FR-046), write it 0600 through a
// tmp file and link(2) (a new file never replaces another: O_EXCL semantics)
// or rename (--force), and run `/bin/launchctl bootstrap gui/<uid> <plist>`
// by absolute path with an argv array, no shell. With --force over a
// differing plist the old job is booted out first. An identical plist is kept
// as is. A launchctl failure is `launchctl_failed` (exit 1) with its status.
//
// WHICH a1-tools THE PLIST RUNS: the SEALED copy, <seal_dir>/_shared/
// a1-tools.cjs, not the installed plugin cache. Reasons: (1) FR-040 pins that
// copy byte for byte (sha256 manifest, files 0444, dirs 0555) and `run` already
// runs the child from it; the tick that claims, validates the signature and
// spawns is the most privileged code of the feature, so it should be the
// verified, read-only copy and not a directory that `claude plugin update`
// or any process of the owner rewrites at any time; (2) one code version for
// tick and run: after a plugin update without a re-seal both fail closed
// (seal_stale) instead of the tick silently running new code against an old
// seal; (3) FR-040 states that the a1-tools path points into the copy, never
// into the plugin cache. Cost: after every re-seal the owner runs
// `install-agent --force` once, because the seal dir name carries the version
// and the root hash. `--status` prints the path the plist runs, and whether
// it still equals the current seal.
//
// Uninstall: `bootout gui/<uid>/<label>` (a job that is not loaded is only
// reported), then the plist is removed. Status: `launchctl print gui/<uid>/
// <label>` -> state and last exit, plus the last 5 lines of ~/.a1-intents/
// log.jsonl. Uninstall and status never need the TTY; uninstall refuses a
// Claude Code context.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { executorConfig } = require('./intent-lifecycle.cjs');
const { openPrivate, devicesDir } = require('./intent-devices.cjs');

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
const LABEL = 'ai.n3ural.a1-intent-tick';
const PLIST_FILE = `${LABEL}.plist`;
const LAUNCHCTL = '/bin/launchctl';
const LAUNCH_AGENTS_REL = path.join('Library', 'LaunchAgents');
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', PLIST_FILE);
const SEALED_TOOLS_REL = path.join('_shared', 'a1-tools.cjs');
const BASE_PATH_DIRS = Object.freeze(['/usr/bin', '/bin', '/usr/sbin', '/sbin']);
const HOST_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const CLAUDE_ENV_RE = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$/;
const HOST_BLOCK_RE = /^[^\n]*<!--A1_HOST_ID-->[\s\S]*?<!--\/A1_HOST_ID-->[^\n]*\n/m;
const TEMPLATE_MAX_BYTES = 64 * 1024;
const PLIST_MAX_BYTES = 256 * 1024;
const CONFIRM_WORD = 'yes';
const ANSWER_MAX_BYTES = 64;
const TTY_PATH = '/dev/tty';
const PLIST_MODE = 0o600;
const TOOL_TIMEOUT_MS = 15000;
const TOOL_ENV = Object.freeze({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C' });
const LOG_TAIL_LINES = 5;
const LOG_TAIL_BYTES = 64 * 1024;
const LOG_LINE_CLIP = 600;
const STATUS_KEY_RE = /^\s*(state|last exit code|last exit status)\s*=\s*(.+?)\s*$/;

class AgentRefusal extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = code;
  }
}

let injected = Object.freeze({});

// Fixture seam (see header). Production never calls it.
function injectAgentDeps(deps) {
  injected = Object.freeze({ ...deps });
}

// ---------- environment ----------

function execTool(file, argv) {
  const r = spawnSync(file, argv, { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS, env: TOOL_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? (r.error.code || 'error') : null };
}

// First executable regular file named `name` on an absolute PATH entry.
function findOnPath(name, envPath) {
  for (const dir of String(envPath || '').split(':')) {
    if (dir === '' || !path.isAbsolute(dir)) continue; // an empty or relative entry means "cwd": never
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_e) {
      // not here
    }
  }
  return null;
}

function claudeContextRefusal(env) {
  const vars = Object.keys(env).filter((k) => CLAUDE_ENV_RE.test(k));
  if (vars.length > 0) return `environment: ${vars.sort().join(', ')}`;
  try {
    return require('./xprov-approve.cjs').ancestryRefusal();
  } catch (e) {
    return `the process ancestry could not be checked (${e.message})`; // fail closed
  }
}

function confirmOnTty(summary) {
  const fd = fs.openSync(TTY_PATH, 'r+');
  try {
    fs.writeSync(fd, `${summary}\nType "${CONFIRM_WORD}" to install this agent: `);
    const buf = Buffer.alloc(1);
    let answer = '';
    while (answer.length < ANSWER_MAX_BYTES && fs.readSync(fd, buf, 0, 1, null) === 1) {
      const c = buf.toString('utf8');
      if (c === '\n' || c === '\r') break;
      answer += c;
    }
    return answer.trim() === CONFIRM_WORD;
  } finally {
    fs.closeSync(fd);
  }
}

const defaultDeps = () => ({
  homedir: os.homedir,
  hostname: os.hostname(),
  platform: process.platform,
  uid: typeof process.getuid === 'function' ? process.getuid() : -1,
  env: process.env,
  isTty: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
  contextRefusal: claudeContextRefusal,
  isChild: () => require('./intent-child.cjs').isChildMode(),
  confirm: confirmOnTty,
  exec: execTool,
  launchctl: LAUNCHCTL,
  templatePath: TEMPLATE_PATH,
  ...injected,
});

// ---------- gates ----------

function guardHuman(d, { tty }) {
  if (tty && !d.isTty()) throw new AgentRefusal('not_a_tty', 'intent install-agent needs an interactive terminal on stdin and stdout');
  if (d.isChild()) throw new AgentRefusal('claude_code_context', 'intent child mode');
  const why = d.contextRefusal(d.env);
  if (why) throw new AgentRefusal('claude_code_context', why);
}

function verifiedSeal(d) {
  const { verifySeal } = require('./intent-seal.cjs');
  const seal = verifySeal({ homedir: d.homedir });
  if (!seal.ok) throw new AgentRefusal('seal_invalid', seal.detail);
  const tools = path.join(seal.sealDir, SEALED_TOOLS_REL);
  if (!fs.existsSync(tools)) throw new AgentRefusal('seal_invalid', 'the sealed copy holds no _shared/a1-tools.cjs');
  return { seal, tools };
}

function checkDoctor(d, vault) {
  const { runDoctor } = require('./intent-doctor.cjs');
  const report = runDoctor({ homedir: d.homedir, vault, env: d.env });
  const failed = report.checks.filter((c) => !c.ok).map((c) => c.name);
  if (failed.length > 0) throw new AgentRefusal('doctor_failed', `failing checks: ${failed.join(', ')}`);
}

// -> { node, claude, vault, hostId } or throws.
function resolveEnvironment(d) {
  const vault = d.env.A1_VAULT_ROOT;
  if (!vault || !path.isAbsolute(vault)) throw new AgentRefusal('vault_root_missing', 'A1_VAULT_ROOT must be set to an absolute path');
  const node = findOnPath('node', d.env.PATH);
  if (node === null) throw new AgentRefusal('node_missing', 'node is not on PATH');
  const claude = findOnPath('claude', d.env.PATH);
  if (claude === null) throw new AgentRefusal('claude_missing', 'claude is not on PATH; the agent could not start an intent child');
  const hostId = d.env.A1_HOST_ID || '';
  if (hostId !== '' && !HOST_ID_RE.test(hostId)) throw new AgentRefusal('invalid_value', 'A1_HOST_ID is not [A-Za-z0-9._-]{1,64}');
  return { node, claude, vault, hostId };
}

// ---------- render ----------

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pathDirs(env) {
  return [...new Set([path.dirname(env.node), path.dirname(env.claude), ...BASE_PATH_DIRS])];
}

// -> the plist text. Pure apart from reading the template.
function renderPlist(templateText, values) {
  const all = [values.node, values.tools, values.home, values.vault, values.pathValue, values.hostId];
  if (all.some((v) => typeof v !== 'string' || CONTROL_RE.test(v) || v.includes('{{'))) {
    throw new AgentRefusal('invalid_value', 'a value is empty-typed, holds a control character or a placeholder');
  }
  const base = values.hostId === '' ? templateText.replace(HOST_BLOCK_RE, '') : templateText;
  const filled = base
    .split('{{NODE}}').join(xmlEscape(values.node))
    .split('{{A1_TOOLS}}').join(xmlEscape(values.tools))
    .split('{{HOME}}').join(xmlEscape(values.home))
    .split('{{PATH}}').join(xmlEscape(values.pathValue))
    .split('{{A1_VAULT_ROOT}}').join(xmlEscape(values.vault))
    .split('{{A1_HOST_ID}}').join(xmlEscape(values.hostId));
  if (filled.includes('{{') || filled.includes('A1_HOST_ID-->') && values.hostId === '') {
    throw new AgentRefusal('template_unfilled', 'the template still holds a placeholder or the host block');
  }
  return filled;
}

function readTemplate(d) {
  const st = fs.statSync(d.templatePath);
  if (!st.isFile() || st.size > TEMPLATE_MAX_BYTES) throw new AgentRefusal('template_unfilled', 'the plist template is not a regular file of a sane size');
  return fs.readFileSync(d.templatePath, 'utf8');
}

// ---------- the plist file ----------

const plistDir = (d) => path.join(d.homedir(), LAUNCH_AGENTS_REL);
const plistPath = (d) => path.join(plistDir(d), PLIST_FILE);
const domainTarget = (d) => `gui/${d.uid}/${LABEL}`;

// -> null (absent) | text. A symlink or a non-regular file is refused.
function readExisting(file) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  if (!st.isFile() || st.size > PLIST_MAX_BYTES) throw new AgentRefusal('plist_exists_differs', 'the existing plist is a link or not a regular file; remove it by hand');
  return fs.readFileSync(file, 'utf8');
}

// tmp (0600, O_EXCL) -> link(2) for a new file, rename for --force.
function writePlist(file, text, replace) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: PLIST_MODE, flag: 'wx' });
  try {
    fs.chmodSync(tmp, PLIST_MODE);
    if (replace) fs.renameSync(tmp, file);
    else fs.linkSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function launchctlOrThrow(d, argv) {
  const r = d.exec(d.launchctl, argv);
  if (r.error || r.status !== 0) {
    throw new AgentRefusal('launchctl_failed', `launchctl ${argv[0]} exited ${r.error || r.status}: ${String(r.stderr || '').trim().slice(0, 200)}`);
  }
}

// ---------- install ----------

function installSummary(file, v, tools) {
  return [
    'intent install-agent: LaunchAgent ai.n3ural.a1-intent-tick (tick every 30 s)',
    `  plist:       ${file}`,
    `  runs:        ${v.node} ${tools} intent tick`,
    `  claude:      ${v.claude}`,
    `  vault root:  ${v.vault}`,
    `  A1_HOST_ID:  ${v.hostId || '(not set)'}`,
  ].join('\n');
}

function install(d, force) {
  guardHuman(d, { tty: true });
  if (d.platform !== 'darwin') throw new AgentRefusal('unsupported_platform', 'launchd exists on macOS only');
  const config = executorConfig({ homedir: d.homedir });
  if (config === null || config.executor_host !== d.hostname) throw new AgentRefusal('not_executor_host', 'install-agent runs only on the executor host');
  const v = resolveEnvironment(d);
  checkDoctor(d, v.vault);
  const { tools } = verifiedSeal(d);
  const text = renderPlist(readTemplate(d), { node: v.node, tools, home: d.homedir(), vault: v.vault, pathValue: pathDirs(v).join(':'), hostId: v.hostId });
  const file = plistPath(d);
  const existing = readExisting(file);
  const differs = existing !== null && existing !== text;
  if (differs && !force) throw new AgentRefusal('plist_exists_differs', `${file} exists with other content; review it or pass --force`);
  if (!d.confirm(installSummary(file, v, tools))) throw new AgentRefusal('not_confirmed', `the answer was not "${CONFIRM_WORD}"`);
  if (differs) d.exec(d.launchctl, ['bootout', domainTarget(d)]); // the old job; a failure only means it was not loaded
  if (existing === null || differs) writePlist(file, text, differs);
  launchctlOrThrow(d, ['bootstrap', `gui/${d.uid}`, file]);
  return { ok: true, action: 'installed', plist: file, a1_tools: tools, label: LABEL, host_id: v.hostId || null };
}

// ---------- uninstall ----------

function uninstall(d) {
  guardHuman(d, { tty: false });
  const file = plistPath(d);
  const r = d.exec(d.launchctl, ['bootout', domainTarget(d)]);
  const bootedOut = !r.error && r.status === 0;
  const existing = readExisting(file);
  if (existing !== null) fs.unlinkSync(file);
  return { ok: true, action: 'uninstalled', plist: file, booted_out: bootedOut, plist_removed: existing !== null };
}

// ---------- status ----------

function logTail(d) {
  let fd;
  try {
    fd = openPrivate(path.join(devicesDir(d.homedir), 'log.jsonl'), 'file', { homedir: d.homedir }, (why) => new AgentRefusal('log_unsafe', why));
  } catch (e) {
    if (!(e instanceof AgentRefusal)) throw e;
    return { lines: [], problem: e.message };
  }
  if (fd === null) return { lines: [], problem: null };
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, LOG_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter((l) => l !== '');
    return { lines: lines.slice(-LOG_TAIL_LINES).map((l) => l.slice(0, LOG_LINE_CLIP)), problem: null };
  } finally {
    fs.closeSync(fd);
  }
}

function parsePrint(text) {
  const found = {};
  for (const line of text.split('\n')) {
    const m = STATUS_KEY_RE.exec(line);
    if (m && found[m[1]] === undefined) found[m[1]] = m[2];
  }
  return { state: found.state || null, last_exit: found['last exit code'] || found['last exit status'] || null };
}

// The a1-tools path the installed plist runs (the line after the script's node entry).
function plistTools(text) {
  const m = /<key>ProgramArguments<\/key>\s*<array>\s*<string>[^<]*<\/string>\s*<string>([^<]*)<\/string>/.exec(text || '');
  return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null;
}

function currentSealTools(d) {
  try {
    return verifiedSeal(d).tools;
  } catch (_e) {
    return null;
  }
}

function status(d) {
  const file = plistPath(d);
  let existing = null;
  try {
    existing = readExisting(file);
  } catch (e) {
    if (!(e instanceof AgentRefusal)) throw e;
  }
  const r = d.exec(d.launchctl, ['print', domainTarget(d)]);
  const loaded = !r.error && r.status === 0;
  const tools = plistTools(existing);
  const sealTools = currentSealTools(d);
  const tail = logTail(d);
  return {
    ok: true,
    action: 'status',
    label: LABEL,
    loaded,
    ...(loaded ? parsePrint(r.stdout) : { state: 'not_loaded', last_exit: null }),
    plist_present: existing !== null,
    plist_a1_tools: tools,
    plist_matches_seal: tools !== null && tools === sealTools,
    log_tail: tail.lines,
    ...(tail.problem ? { log_problem: tail.problem } : {}),
  };
}

// ---------- command ----------

function usageExit(message) {
  process.stderr.write(`usage error: ${message}\n`);
  process.stderr.write('see: a1-tools --help (section "a1-tools intent")\n');
  process.exitCode = EXIT_USAGE;
}

const FLAGS = Object.freeze(['--uninstall', '--status', '--force']);

function parseArgs(args) {
  if (args.includes('--yes')) return { error: 'intent install-agent: --yes is refused; the install needs the owner\'s confirmation on the terminal' };
  const unknown = args.find((a) => !FLAGS.includes(a));
  if (unknown !== undefined) return { error: `intent install-agent: unknown argument ${JSON.stringify(String(unknown).slice(0, 64))} (expected --uninstall, --status or --force)` };
  const set = new Set(args);
  if (set.size !== args.length) return { error: 'intent install-agent: an argument is repeated' };
  if (set.has('--uninstall') && set.has('--status')) return { error: 'intent install-agent: --uninstall and --status exclude each other' };
  if (set.has('--force') && (set.has('--uninstall') || set.has('--status'))) return { error: 'intent install-agent: --force belongs to the install only' };
  return { mode: set.has('--uninstall') ? 'uninstall' : set.has('--status') ? 'status' : 'install', force: set.has('--force') };
}

function cmdIntentInstallAgent(args, deps = {}) {
  const parsed = parseArgs(args);
  if (parsed.error) return usageExit(parsed.error);
  const d = { ...defaultDeps(), ...deps };
  try {
    const r = parsed.mode === 'install' ? install(d, parsed.force) : parsed.mode === 'uninstall' ? uninstall(d) : status(d);
    process.stdout.write(`${JSON.stringify(r)}\n`);
    process.exitCode = EXIT_OK;
    process.stderr.write(`intent install-agent: ${r.action}\n`);
  } catch (e) {
    if (!(e instanceof AgentRefusal)) throw e;
    process.stdout.write(`${JSON.stringify({ ok: false, reasons: [e.code], detail: e.message.slice(0, 300) })}\n`);
    process.exitCode = EXIT_REFUSED;
    process.stderr.write(`intent install-agent: refused (${e.code}); nothing was changed.\n`);
  }
  return undefined;
}

module.exports = { cmdIntentInstallAgent, injectAgentDeps, renderPlist, findOnPath, AgentRefusal, LABEL };
