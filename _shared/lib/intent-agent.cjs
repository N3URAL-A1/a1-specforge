'use strict';

// ---------------------------------------------------------------------------
// intent-agent — `a1-tools intent install-agent [--uninstall | --status]
// [--force]` (spec 011, Wave 11 ops half: FR-032, FR-017, FR-037, FR-040,
// FR-046). Installs the LaunchAgent ai.n3ural.a1-intent-tick that runs
// `a1-tools intent tick` every 30 s on the executor Mac. Library-only seam:
// injectAgentDeps() / the `deps` argument; no environment variable reaches
// launchctl, the plist directory or the doctor.
//
// Every refusal exits 1 with stdout {"ok":false,"reasons":[code],"detail"};
// stderr names what really happened to the plist ("nothing was changed",
// "rolled back ...", or "plist left ..."). `--yes` and unknown or combined
// flags are usage errors (exit 2). An I/O error carrying a code (ENXIO on
// /dev/tty, EEXIST, a missing template, A1_EXECUTOR_UNREADABLE) is wrapped
// into the same JSON refusal and never escapes as a stack trace.
//
// Install gates, in this order; the first failing one refuses before anything
// is written and before launchctl is called:
//   not_a_tty             stdin and stdout must be a TTY (checked first).
//   claude_code_context   no CLAUDECODE / CLAUDE_PID / CLAUDE_CODE_* variable,
//                         no Claude Code ancestor (xprov-approve's walk, fail
//                         closed), not in intent child mode: the human
//                         boundary of seal/approve/xprov approve. The
//                         subcommand is also absent from every
//                         INTENT_CHILD_ALLOWLIST row (child: exit 77).
//   unsupported_platform  launchd exists on darwin only.
//   home_mismatch         os.homedir() must equal the passwd home: the plist
//                         sets no HOME, and tick resolves ~/.a1-intents from
//                         the passwd home.
//   not_executor_host     FR-017: os.hostname() == executor.json host.
//   vault_root_missing    A1_VAULT_ROOT is required (the plist carries it).
//   node_missing / claude_missing   resolved from PATH by a JS walk (absolute
//                         entries only, no shell).
//   invalid_value         a value with a control character, `&`, `<`, `>` or
//                         `{{` (doctor's plist reader rejects `&`, so such a
//                         plist would brick doctor), or an A1_HOST_ID outside
//                         [A-Za-z0-9._-]{1,64}. Checked before doctor and seal.
//   path_shadowed         the plist PATH must resolve claude and node to the
//                         binaries the owner confirmed (claude's dir comes
//                         FIRST, then node's, then the system dirs).
//   doctor_failed         runDoctor() in-process; any failing check (the
//                         *:58589 Obsidian listener is the ship-blocker).
//   seal_invalid          verifySeal() must be ok (FR-040).
//   template_missing / template_unfilled   the template is read from
//                         <seal_dir>/_shared/templates/ (the verified copy),
//                         and the rendered text must hold no placeholder and
//                         no <key>A1_INTENT_*</key> (FR-046).
//   plist_exists_differs  an existing plist with other bytes is never
//                         overwritten without --force; a link never.
//   not_confirmed         the owner types "yes" on /dev/tty after seeing the
//                         plist values (path, command, claude, PATH, vault).
// Then the write. Nothing the owner confirmed may be swapped: the plist is
// always written fresh after the confirmation (tmp 0600 + link(2) for a new
// file, so an existing file is never replaced by chance; rename for a
// replacement), never an earlier file handed to launchctl.
//   new file:   write, bootstrap; on failure the new plist is unlinked.
//   existing:   first `launchctl print`; an identical plist whose job is
//               already loaded is `already_installed` (exit 0, no bootstrap).
//               Otherwise: tmp written, the old plist linked to a .bak, bootout
//               (failure ignored), rename, bootstrap. On a bootstrap failure the
//               old plist is restored and bootstrapped again best-effort; the
//               failure is `launchctl_failed` and stderr says "rolled back".
//
// WHICH a1-tools THE PLIST RUNS: the SEALED copy, <seal_dir>/_shared/
// a1-tools.cjs, not the installed plugin cache. Reasons: (1) FR-040 pins that
// copy byte for byte (sha256 manifest, files 0444, dirs 0555) and `run` runs
// the child from it; the tick that claims, validates the signature and spawns
// is the most privileged code of the feature, so it should be the verified,
// read-only copy and not a directory `claude plugin update` rewrites at any
// time; (2) one code version for tick and run; (3) FR-040 says the a1-tools
// path points into the copy. Cost and its guard: a re-seal creates a NEW seal
// dir (its name carries version and root hash) and the agent keeps running the
// OLD one until `install-agent --force`. `run` and `tick` therefore fail closed
// when their own root lies under ~/.a1-intents-seal but is not the manifest's
// seal_dir (intent-seal.cjs agentRootSkew: seal_stale, agent_points_at_old_seal,
// 0 spawns), and `intent seal` prints the hint. `--status` reports
// plist_matches_seal.
//
// Uninstall: the plist must be a regular file (else plist_unsafe, launchctl
// not called); `bootout gui/<uid>/<label>`; when bootout fails, `launchctl
// print` decides: loaded -> bootout_failed (plist stays); not loaded -> the
// plist is removed; anything else -> state unknown -> bootout_failed, never
// "not loaded". Status: `print` -> loaded / not_loaded / unknown (an error or
// timeout is unknown), plist_problem instead of a swallowed error, the plist's
// a1-tools path, the last 5 lines of ~/.a1-intents/log.jsonl.
// UNMEASURED: launchctl's real exit codes and texts; the stub and the classifier
// below (status 0 = loaded, 113 or "Could not find service" = not loaded, all
// else unknown) are from memory until measured on the executor Mac.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
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
const TEMPLATE_REL = path.join('_shared', 'templates', PLIST_FILE);
const SEALED_TOOLS_REL = path.join('_shared', 'a1-tools.cjs');
const BASE_PATH_DIRS = Object.freeze(['/usr/bin', '/bin', '/usr/sbin', '/sbin']);
const HOST_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const BAD_VALUE_RE = /[\u0000-\u001f\u007f&<>]/; // control characters and the XML metacharacters doctor cannot read
const CLAUDE_ENV_RE = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$/;
const HOST_BLOCK_RE = /^[^\n]*<!--A1_HOST_ID-->[\s\S]*?<!--\/A1_HOST_ID-->[^\n]*\n/m;
const INTENT_KEY_RE = /<key>\s*A1_INTENT_/;
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
const NOT_LOADED_STATUS = 113; // UNMEASURED
const NOT_LOADED_RE = /could not find service|no such process/i; // UNMEASURED
const NOTHING_CHANGED = 'nothing was changed.';

class AgentRefusal extends Error {
  constructor(code, detail, outcome) {
    super(detail || code);
    this.code = code;
    this.outcome = outcome || NOTHING_CHANGED;
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
  let fd;
  try {
    fd = fs.openSync(TTY_PATH, 'r+');
  } catch (e) {
    throw new AgentRefusal('not_a_tty', `${TTY_PATH} cannot be opened (${e.code || 'error'})`);
  }
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
  passwdHome: () => os.userInfo().homedir,
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

// Every value that reaches the plist: no control character, no & < > (doctor
// rejects them), no placeholder text.
function assertValues(values) {
  const bad = Object.entries(values).find(([, v]) => typeof v !== 'string' || BAD_VALUE_RE.test(v) || v.includes('{{'));
  if (bad) throw new AgentRefusal('invalid_value', `${bad[0]} holds a control character, one of & < > or a placeholder`);
}

function pathValue(env) {
  return [...new Set([path.dirname(env.claude), path.dirname(env.node), ...BASE_PATH_DIRS])].join(':');
}

// -> { node, claude, vault, hostId, home, pathValue } or throws.
function resolveEnvironment(d) {
  const vault = d.env.A1_VAULT_ROOT;
  if (!vault || !path.isAbsolute(vault)) throw new AgentRefusal('vault_root_missing', 'A1_VAULT_ROOT must be set to an absolute path');
  const node = findOnPath('node', d.env.PATH);
  if (node === null) throw new AgentRefusal('node_missing', 'node is not on PATH');
  const claude = findOnPath('claude', d.env.PATH);
  if (claude === null) throw new AgentRefusal('claude_missing', 'claude is not on PATH; the agent could not start an intent child');
  const hostId = d.env.A1_HOST_ID || '';
  if (hostId !== '' && !HOST_ID_RE.test(hostId)) throw new AgentRefusal('invalid_value', 'A1_HOST_ID is not [A-Za-z0-9._-]{1,64}');
  const v = { node, claude, vault, hostId, home: d.homedir(), pathValue: pathValue({ node, claude }) };
  assertValues(v);
  if (findOnPath('claude', v.pathValue) !== claude || findOnPath('node', v.pathValue) !== node) {
    throw new AgentRefusal('path_shadowed', 'the plist PATH would resolve claude or node to another binary than the one you confirm');
  }
  return v;
}

// ---------- render ----------

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// -> the plist text. Pure.
function renderPlist(templateText, values) {
  assertValues({ node: values.node, tools: values.tools, home: values.home, vault: values.vault, pathValue: values.pathValue, hostId: values.hostId });
  const base = values.hostId === '' ? templateText.replace(HOST_BLOCK_RE, '') : templateText;
  const filled = base
    .split('{{NODE}}').join(xmlEscape(values.node))
    .split('{{A1_TOOLS}}').join(xmlEscape(values.tools))
    .split('{{HOME}}').join(xmlEscape(values.home))
    .split('{{PATH}}').join(xmlEscape(values.pathValue))
    .split('{{A1_VAULT_ROOT}}').join(xmlEscape(values.vault))
    .split('{{A1_HOST_ID}}').join(xmlEscape(values.hostId));
  if (filled.includes('{{') || (values.hostId === '' && filled.includes('<key>A1_HOST_ID</key>'))) {
    throw new AgentRefusal('template_unfilled', 'the template still holds a placeholder or the host block');
  }
  if (INTENT_KEY_RE.test(filled)) throw new AgentRefusal('template_unfilled', 'the template carries an A1_INTENT_* key (FR-046)');
  return filled;
}

// The template of the SEALED copy (already verified), never of this file's own directory.
function readTemplate(sealDir) {
  const file = path.join(sealDir, TEMPLATE_REL);
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    throw new AgentRefusal('template_missing', `the sealed copy holds no ${TEMPLATE_REL} (${e.code || 'error'})`);
  }
  if (!st.isFile() || st.size > TEMPLATE_MAX_BYTES) throw new AgentRefusal('template_missing', 'the sealed plist template is not a regular file of a sane size');
  return fs.readFileSync(file, 'utf8');
}

// ---------- the plist file ----------

const plistDir = (d) => path.join(d.homedir(), LAUNCH_AGENTS_REL);
const plistPath = (d) => path.join(plistDir(d), PLIST_FILE);
const domainTarget = (d) => `gui/${d.uid}/${LABEL}`;

// -> null (absent) | text. A link or a non-regular file throws `unsafeCode`.
function readExisting(file, unsafeCode) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  if (!st.isFile() || st.size > PLIST_MAX_BYTES) throw new AgentRefusal(unsafeCode, 'the existing plist is a link or not a regular file; remove it by hand');
  return fs.readFileSync(file, 'utf8');
}

function writeTmp(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`; // unpredictable: a leftover of a crashed run never collides
  try {
    fs.writeFileSync(tmp, text, { mode: PLIST_MODE, flag: 'wx' });
    fs.chmodSync(tmp, PLIST_MODE);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new AgentRefusal('io_error', `cannot write ${tmp} (${e.code || 'error'})`);
  }
  return tmp;
}

// launchctl print -> { state: 'loaded'|'not_loaded'|'unknown', r }
function jobState(d) {
  const r = d.exec(d.launchctl, ['print', domainTarget(d)]);
  if (!r.error && r.status === 0) return { state: 'loaded', r };
  if (!r.error && (r.status === NOT_LOADED_STATUS || NOT_LOADED_RE.test(String(r.stderr || '')))) return { state: 'not_loaded', r };
  return { state: 'unknown', r };
}

const ran = (r) => !r.error && r.status === 0;
const failText = (argv0, r) => `launchctl ${argv0} exited ${r.error || r.status}: ${String(r.stderr || '').trim().slice(0, 200)}`;

// ---------- install ----------

function installSummary(file, v, tools) {
  return [
    'intent install-agent: LaunchAgent ai.n3ural.a1-intent-tick (tick every 30 s)',
    `  plist:       ${file}`,
    `  runs:        ${v.node} ${tools} intent tick`,
    `  claude:      ${v.claude}`,
    `  PATH:        ${v.pathValue}`,
    `  vault root:  ${v.vault}`,
    `  A1_HOST_ID:  ${v.hostId || '(not set)'}`,
  ].join('\n');
}

function gateInstall(d) {
  guardHuman(d, { tty: true });
  if (d.platform !== 'darwin') throw new AgentRefusal('unsupported_platform', 'launchd exists on macOS only');
  if (path.resolve(d.homedir()) !== path.resolve(d.passwdHome())) {
    throw new AgentRefusal('home_mismatch', 'HOME differs from the passwd home; the agent runs without HOME and tick resolves the passwd home');
  }
  const config = executorConfig({ homedir: d.homedir });
  if (config === null || config.executor_host !== d.hostname) throw new AgentRefusal('not_executor_host', 'install-agent runs only on the executor host');
  const v = resolveEnvironment(d);
  checkDoctor(d, v.vault);
  return { v, ...verifiedSeal(d) };
}

// New file: link(2) never replaces. Bootstrap failure -> the new plist is unlinked.
function installNew(d, file, text) {
  const tmp = writeTmp(file, text);
  try {
    fs.linkSync(tmp, file);
  } catch (e) {
    throw new AgentRefusal('plist_exists_differs', `${file} appeared after your confirmation (${e.code || 'error'}); nothing was changed`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const r = d.exec(d.launchctl, ['bootstrap', `gui/${d.uid}`, file]);
  if (ran(r)) return;
  fs.rmSync(file, { force: true });
  throw new AgentRefusal('launchctl_failed', failText('bootstrap', r), 'rolled back: the new plist was removed.');
}

// Existing file: tmp, old -> .bak (link), bootout, rename, bootstrap; restore on failure.
function installReplace(d, file, text) {
  const tmp = writeTmp(file, text);
  const bak = `${file}.bak.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.linkSync(file, bak);
    d.exec(d.launchctl, ['bootout', domainTarget(d)]); // a failure only means it was not loaded
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(bak, { force: true });
    throw new AgentRefusal('io_error', `cannot replace ${file} (${e.code || 'error'})`);
  }
  const r = d.exec(d.launchctl, ['bootstrap', `gui/${d.uid}`, file]);
  if (ran(r)) {
    fs.rmSync(bak, { force: true });
    return;
  }
  let outcome;
  try {
    fs.renameSync(bak, file);
    d.exec(d.launchctl, ['bootstrap', `gui/${d.uid}`, file]); // best effort: the old job again
    outcome = 'rolled back: the previous plist is back in place (its job was booted out and bootstrapped again best-effort).';
  } catch (e) {
    outcome = `ROLLBACK FAILED (${e.code || 'error'}): the new plist stays at ${file}, the old one is at ${bak}.`;
  }
  throw new AgentRefusal('launchctl_failed', failText('bootstrap', r), outcome);
}

function install(d, force) {
  const { v, tools, seal } = gateInstall(d);
  const text = renderPlist(readTemplate(seal.sealDir), { node: v.node, tools, home: v.home, vault: v.vault, pathValue: v.pathValue, hostId: v.hostId });
  const file = plistPath(d);
  const existing = readExisting(file, 'plist_exists_differs');
  const differs = existing !== null && existing !== text;
  if (differs && !force) throw new AgentRefusal('plist_exists_differs', `${file} exists with other content; review it or pass --force`);
  if (!d.confirm(installSummary(file, v, tools))) throw new AgentRefusal('not_confirmed', `the answer was not "${CONFIRM_WORD}"`);
  const base = { ok: true, plist: file, a1_tools: tools, label: LABEL, host_id: v.hostId || null };
  if (existing === null) {
    installNew(d, file, text);
    return { ...base, action: 'installed' };
  }
  if (!differs && jobState(d).state === 'loaded') return { ...base, action: 'already_installed' };
  installReplace(d, file, text);
  return { ...base, action: 'installed' };
}

// ---------- uninstall ----------

function uninstall(d) {
  guardHuman(d, { tty: false });
  const file = plistPath(d);
  const existing = readExisting(file, 'plist_unsafe'); // before any launchctl call
  const r = d.exec(d.launchctl, ['bootout', domainTarget(d)]);
  const bootedOut = ran(r);
  if (!bootedOut) {
    const { state } = jobState(d);
    if (state !== 'not_loaded') {
      throw new AgentRefusal('bootout_failed', `${failText('bootout', r)}; the job is ${state}`, 'the plist was kept.');
    }
  }
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

// The a1-tools path the installed plist runs (the second ProgramArguments entry).
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
  let plistProblem = null;
  try {
    existing = readExisting(file, 'plist_unsafe');
  } catch (e) {
    if (!(e instanceof AgentRefusal)) throw e;
    plistProblem = e.message;
  }
  const { state, r } = jobState(d);
  const tools = plistTools(existing);
  const sealTools = currentSealTools(d);
  const tail = logTail(d);
  return {
    ok: true,
    action: 'status',
    label: LABEL,
    loaded: state === 'loaded' ? true : state === 'not_loaded' ? false : null,
    ...(state === 'loaded' ? parsePrint(r.stdout) : { state: state === 'not_loaded' ? 'not_loaded' : 'unknown', last_exit: null }),
    plist_present: existing !== null,
    ...(plistProblem ? { plist_problem: plistProblem } : {}),
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

const WRAPPED_CODES = Object.freeze({
  A1_EXECUTOR_UNREADABLE: 'executor_unreadable',
  A1_INTENTS_DIR_UNSAFE: 'intents_dir_unsafe',
});

// An error with a code (errno or A1_*) becomes a JSON refusal; a plain bug still throws.
function asRefusal(e) {
  if (e instanceof AgentRefusal) return e;
  if (e && typeof e.code === 'string') return new AgentRefusal(WRAPPED_CODES[e.code] || 'io_error', `${e.code}: ${String(e.message).slice(0, 200)}`);
  return null;
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
    const refusal = asRefusal(e);
    if (refusal === null) throw e;
    process.stdout.write(`${JSON.stringify({ ok: false, reasons: [refusal.code], detail: refusal.message.slice(0, 300) })}\n`);
    process.exitCode = EXIT_REFUSED;
    process.stderr.write(`intent install-agent: refused (${refusal.code}); ${refusal.outcome}\n`);
  }
  return undefined;
}

module.exports = { cmdIntentInstallAgent, injectAgentDeps, renderPlist, findOnPath, AgentRefusal, LABEL };
