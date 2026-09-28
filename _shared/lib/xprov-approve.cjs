'use strict';

// ---------------------------------------------------------------------------
// xprov allowlist propose | approve — spec 009-cross-provider-review-gate,
// Wave 6b (FR-030 h, j). Sole writer: this wave.
//
//   propose --commit <rev> [--json] [--repo <toplevel>]
//       Lists every secret-pattern match at <rev> as path:line:column, pattern,
//       proposed class, masked excerpt (first 4 characters + length) and
//       high_confidence — never the matched text. `--json` prints a DRAFT
//       allowlist whose `reason` fields are empty (the schema rejects it until
//       the owner fills them in). Never writes a file.
//
//   approve --repo <path> [--revoke <sha256>]
//       HUMAN ONLY. Records the sha256 of the allowlist blob at the verified
//       refs/remotes/origin/<default_branch> in ~/.a1-xprov/allowlist-approvals.json
//       (or removes one sha with --revoke). Exits 2 and writes nothing unless
//         (1) stdin and stdout are TTYs,
//         (2) no CLAUDECODE, CLAUDE_PID or CLAUDE_CODE_* variable is set, and
//         (3) no ancestor process (parent-pid walk to pid 1) is CLAUDE_PID or
//             Claude Code: start name `claude` (/proc/<pid>/comm on Linux,
//             `ps -o comm=` basename on macOS), an executable resolved under a
//             `claude/versions/` directory, or `@anthropic-ai/claude-code` in
//             its argv (npm install, where the executable is `node`).
//       A TTY alone is fakeable with script(1); (2) and (3) are what keep an
//       agent's Bash tool — and the `!` prefix, which descends from Claude
//       Code — out. The owner runs this in a separate terminal, reads the
//       listing and types the entry count; a wrong count exits 2. The store is
//       written through a temp file in the same directory and rename().
//       Measured 2026-09-28 on macOS: Claude Code runs as start name `claude`,
//       executable ~/.local/share/claude/versions/<version>, with CLAUDECODE,
//       CLAUDE_PID and CLAUDE_CODE_* set. The Linux form (aiserver) is not
//       measured yet — the guard covers comm, the versions path and npm argv.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const tty = require('tty');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const io = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const AL = require('./xprov-allowlist.cjs');
const { cloneSnapshot, cleanupSnapshot, scanTrackedFiles, REF_RE } = require('./xprov-snapshot.cjs');

const EXIT_REFUSED = X.EXIT_USAGE; // every guard refusal is exit 2 with nothing written
const MAX_ANCESTRY_STEPS = 256;
const TYPED_MAX_BYTES = 64;
const CLAUDE_ENV_RE = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$/;
const CLAUDE_VERSIONS_RE = /(^|\/)claude\/versions\//;
const CLAUDE_NPM_PACKAGE = '@anthropic-ai/claude-code';
const FIXTURE_PATH_RE = /(^|\/)(_test-fixtures|fixtures?|tests?|__tests__|spec)\//;

const usage = (msg) => C.usageExit('allowlist', msg);

// ---------- propose (FR-030 h) ----------

function proposeClass(p) {
  if (FIXTURE_PATH_RE.test(p)) return 'fixture_fake';
  if (/\.(md|markdown|txt|rst)$/i.test(p)) return 'doc_example';
  return 'code_pattern';
}

/** Every match at <rev> with its 1-based position; the clone is removed again. */
function matchesAt(root, rev) {
  if (!REF_RE.test(String(rev))) throw C.inputError(`--commit must be a git revision without a leading dash or whitespace (got ${JSON.stringify(C.clip(rev, 80))})`);
  const sha = C.gitOut(['-C', root, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  if (sha === null) throw C.inputError(`--commit ${JSON.stringify(C.clip(rev, 80))} is not a commit in ${root}`);
  const cl = cloneSnapshot(root, sha.trim(), null);
  if (!cl.ok) return { ok: false, detail: cl.detail };
  try {
    const scan = scanTrackedFiles(cl.dir, { positions: true });
    if (scan.error) return { ok: false, detail: `ls-files: ${scan.error}` };
    return { ok: true, commit: cl.commit, matches: scan.matches };
  } finally {
    cleanupSnapshot(cl.dir);
  }
}

function listing(matches) {
  return matches.map((m) => Object.freeze({
    location: `${m.path}:${m.line}:${m.column}`, path: m.path, line: m.line, column: m.column,
    pattern: m.pattern, class: proposeClass(m.path), excerpt: m.excerpt, high_confidence: X.HIGH_CONFIDENCE_PATTERNS.includes(m.pattern),
  }));
}

/** Draft allowlist: one entry per (path, pattern), fingerprints de-duplicated, reasons empty. */
function draft(root, matches) {
  const rec = AL.permitRecord(root);
  const owner = rec && typeof rec.decided_by === 'string' ? rec.decided_by : '';
  const today = io.nowIso().slice(0, 10);
  const entries = [...AL.groupPairs(matches).values()].map((p) => ({
    path: p.path, pattern: p.pattern, max_count: p.count, fingerprints: [...p.fingerprints],
    class: proposeClass(p.path), reason: '', reviewed_by: owner, added_on: today,
  }));
  return { version: 1, owner, entries };
}

function cmdPropose(args) {
  const flags = io.parseFlags(args, { commit: 'str', json: 'bool', repo: 'str' });
  if (flags._.length) return usage(`propose: unexpected argument ${JSON.stringify(C.clip(flags._[0], 80))}`);
  if (!flags.commit) return usage('propose requires --commit <rev> [--json] [--repo <toplevel>]');
  const root = C.resolveRepoFlag(flags.repo);
  const r = matchesAt(root, flags.commit);
  if (!r.ok) {
    process.stderr.write(`xprov allowlist propose: snapshot_failed — ${r.detail}\n`);
    return C.emitJson({ ok: false, reason: X.REASONS.snapshot_failed, detail: r.detail }, X.EXIT_FAIL);
  }
  const rows = listing(r.matches);
  for (const m of rows) process.stderr.write(`${m.location}  ${m.pattern}  ${m.class}  ${m.excerpt}  high_confidence: ${m.high_confidence}\n`);
  process.stderr.write(`xprov allowlist propose: ${rows.length} match(es) at ${r.commit.slice(0, 12)}; nothing written\n`);
  if (flags.json) return C.emitJson(draft(root, r.matches), X.EXIT_PASS);
  return C.emitJson({ ok: true, commit: r.commit, matches: rows }, X.EXIT_PASS);
}

// ---------- approve guards (FR-030 j) ----------

function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.error) throw new Error(`${cmd}: ${r.error.code || r.error.message}`);
  return r.status === 0 ? String(r.stdout) : null;
}

/** { ppid, name, exe, args } of one process, or null when it cannot be read. */
function processInfo(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const name = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      let exe = '';
      try { exe = fs.readlinkSync(`/proc/${pid}/exe`); } catch (_e) { exe = ''; } // another user's process
      const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ');
      return { ppid, name, exe, args };
    } catch (_e) { return null; }
  }
  const ppid = run('ps', ['-o', 'ppid=', '-p', String(pid)]);
  const name = run('ps', ['-o', 'comm=', '-p', String(pid)]);
  const args = run('ps', ['-o', 'args=', '-p', String(pid)]);
  if (ppid === null || name === null) return null;
  const txt = run('lsof', ['-a', '-d', 'txt', '-p', String(pid), '-Fn']) || '';
  const exe = (txt.split('\n').find((l) => l.startsWith('n')) || '').slice(1);
  return { ppid: Number(ppid.trim()), name: name.trim(), exe, args: (args || '').trim() };
}

/** Why this process may not approve, or null. Fails closed when the walk cannot be completed. */
function ancestryRefusal() {
  const claudePid = /^\d+$/.test(String(process.env.CLAUDE_PID || '')) ? Number(process.env.CLAUDE_PID) : null;
  let pid = process.pid;
  for (let step = 0; step < MAX_ANCESTRY_STEPS && pid > 1; step++) {
    let info;
    try { info = processInfo(pid); } catch (e) { return `cannot read the process tree (${e.message})`; }
    if (!info) return `cannot read process ${pid} of the ancestry`;
    if (pid === claudePid) return `ancestor ${pid} is CLAUDE_PID`;
    if (path.basename(info.name) === 'claude') return `ancestor ${pid} started as claude`;
    if (CLAUDE_VERSIONS_RE.test(info.exe)) return `ancestor ${pid} runs an executable under claude/versions/`;
    if (info.args.includes(CLAUDE_NPM_PACKAGE)) return `ancestor ${pid} runs ${CLAUDE_NPM_PACKAGE}`;
    if (!Number.isInteger(info.ppid) || info.ppid === pid) return `cannot read the parent of process ${pid}`;
    pid = info.ppid;
  }
  return pid > 1 ? 'process tree deeper than the walk limit' : null;
}

function guardRefusal() {
  if (!tty.isatty(0) || !tty.isatty(1)) return 'stdin and stdout must both be a terminal';
  const vars = Object.keys(process.env).filter((k) => CLAUDE_ENV_RE.test(k));
  if (vars.length) return `refusing under Claude Code (environment: ${vars.sort().join(', ')})`;
  return ancestryRefusal();
}

// ---------- store writer ----------

/** One line from the terminal (blocking reads on fd 0). */
function readTypedLine() {
  const buf = Buffer.alloc(TYPED_MAX_BYTES);
  let s = '';
  while (s.length < TYPED_MAX_BYTES && !/[\r\n]/.test(s)) {
    let n;
    try { n = fs.readSync(0, buf, 0, buf.length, null); } catch (e) { if (e.code === 'EAGAIN') continue; throw e; }
    if (n === 0) break;
    s += buf.toString('utf8', 0, n);
  }
  return s.split(/[\r\n]/)[0].trim();
}

/** Atomic store write: 0600 temp file in ~/.a1-xprov (0700, never a symlink), then rename. */
function writeStore(repos) {
  const home = X.xprovHome();
  let st = null;
  try { st = fs.lstatSync(home); } catch (_e) { st = null; }
  if (st && (st.isSymbolicLink() || !st.isDirectory())) throw C.inputError(`${home} is not a real directory; refusing to write the approval store`);
  if (!st) fs.mkdirSync(home, { mode: AL.STORE_DIR_MODE });
  fs.chmodSync(home, AL.STORE_DIR_MODE);
  const tmp = path.join(home, `.${X.ALLOWLIST_APPROVALS_FILE}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'wx', AL.STORE_MODE);
  try {
    fs.writeSync(fd, `${JSON.stringify({ version: 1, repos }, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, AL.storePath());
  return AL.storePath();
}

// ---------- approve / revoke ----------

function approve(root) {
  const t = AL.verifiedTip(root); // the same verification the gate's anchor needs
  if (!t.ok) return { code: X.EXIT_FAIL, msg: t.note };
  const blob = AL.blobAt(root, t.tip, X.ALLOWLIST_FILE);
  if (blob === null) return { code: X.EXIT_FAIL, msg: `no ${X.ALLOWLIST_FILE} at ${t.tip.slice(0, 12)}` };
  const parsed = AL.parseAllowlist(blob.toString('utf8'));
  if (!parsed.ok) return { code: X.EXIT_FAIL, msg: `${X.ALLOWLIST_FILE} at ${t.tip.slice(0, 12)} is invalid: ${parsed.detail}` };
  const r = matchesAt(root, t.tip);
  if (!r.ok) return { code: X.EXIT_FAIL, msg: `snapshot of ${t.tip.slice(0, 12)} failed: ${r.detail}` };
  const sha = C.sha256(blob);
  const rows = listing(r.matches);
  const err = (line) => process.stderr.write(`${line}\n`);
  err(`Allowlist ${X.ALLOWLIST_FILE} at ${t.tip.slice(0, 12)} — owner ${parsed.doc.owner}, blob sha256 ${sha}`);
  for (const e of parsed.doc.entries) {
    err(`- ${e.path} · ${e.pattern} · max_count ${e.max_count} · ${e.class} · ${e.reason}`);
    const hits = rows.filter((m) => m.path === e.path && m.pattern === e.pattern);
    if (!hits.length) err('    (no match at this commit: stale)');
    for (const m of hits) err(`    ${m.location}  ${m.excerpt}  high_confidence: ${m.high_confidence}`);
  }
  const n = parsed.doc.entries.length;
  process.stderr.write(`Type the number of entries (${n}) to approve this blob: `);
  const typed = readTypedLine();
  if (typed !== String(n)) return { code: EXIT_REFUSED, msg: `typed ${JSON.stringify(C.clip(typed, 16))}, expected ${n}; nothing written` };
  const key = C.commonDirOf(root);
  const current = AL.readApprovals();
  const repos = { ...(current.ok ? current.repos : {}) };
  repos[key] = [...new Set([...(repos[key] || []), sha])];
  const file = writeStore(repos);
  return { code: X.EXIT_PASS, msg: `approved ${sha} for ${key} in ${file}`, out: { ok: true, repo: key, approved: sha, store: file } };
}

function revoke(root, sha) {
  if (!AL.SHA256_RE.test(String(sha))) return { code: EXIT_REFUSED, msg: '--revoke needs a lowercase sha256' };
  const key = C.commonDirOf(root);
  const current = AL.readApprovals();
  if (!current.ok) return { code: X.EXIT_FAIL, msg: `no valid approval store (${current.why}); nothing to revoke` };
  const list = current.repos[key] || [];
  if (!list.includes(sha)) return { code: X.EXIT_FAIL, msg: `${sha} is not approved for ${key}` };
  const file = writeStore({ ...current.repos, [key]: list.filter((s) => s !== sha) });
  return { code: X.EXIT_PASS, msg: `revoked ${sha} for ${key} in ${file}`, out: { ok: true, repo: key, revoked: sha, store: file } };
}

function cmdApprove(args) {
  const flags = io.parseFlags(args, { repo: 'str', revoke: 'str' });
  if (flags._.length) return usage(`approve: unexpected argument ${JSON.stringify(C.clip(flags._[0], 80))}`);
  if (!flags.repo) return usage('approve requires --repo <path> [--revoke <sha256>]');
  const refusal = guardRefusal();
  if (refusal) {
    process.stderr.write(`xprov allowlist approve: ${refusal}. Run it yourself in a separate terminal (not through an agent and not via the ! prefix). Nothing written.\n`);
    process.exitCode = EXIT_REFUSED;
    return null;
  }
  const root = C.resolveRepoFlag(flags.repo);
  const r = flags.revoke !== undefined ? revoke(root, flags.revoke) : approve(root);
  process.stderr.write(`xprov allowlist approve: ${r.msg}\n`);
  if (r.out) return C.emitJson(r.out, r.code);
  process.exitCode = r.code;
  return null;
}

// ---------- dispatch ----------

function cmdXprovAllowlist(args) {
  const [sub, ...rest] = Array.isArray(args) ? args : [];
  try {
    if (sub === 'propose') return cmdPropose(rest);
    if (sub === 'approve') return cmdApprove(rest);
  } catch (e) {
    if (e && e.code === 'A1_INPUT') return usage(`${sub}: ${e.message}`);
    throw e;
  }
  return usage(`<propose|approve> is required, got ${JSON.stringify(C.clip(sub == null ? '' : sub, 40))}`);
}

module.exports = {
  cmdXprovAllowlist, guardRefusal, ancestryRefusal, processInfo, proposeClass, draft, listing, writeStore, readTypedLine,
  CLAUDE_ENV_RE, CLAUDE_VERSIONS_RE, CLAUDE_NPM_PACKAGE,
};
