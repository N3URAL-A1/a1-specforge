'use strict';

// ---------------------------------------------------------------------------
// intent-seal — `a1-tools intent seal` and verifySeal (spec 011, Wave 5b,
// FR-040, FR-044; hardened in Wave 6 part A, FR-050). The child of `intent
// run` gets the installed plugin only as a read-only copy whose every byte a
// sha256 manifest pins. The seal has its own private directory (FR-011:
// 0700, this uid, checked through O_DIRECTORY|O_NOFOLLOW + fstat), apart
// from ~/.a1-intents, so the child can be denied all of ~/.a1-intents while
// it reads the plugin (FR-049):
//
//   ~/.a1-intents-seal/<version>-<12 hex>/   files 0444, dirs 0555
//   ~/.a1-intents-seal/manifest.json         0600, tmp + rename
//   ~/.a1-intents-seal/empty-mcp.json        0444, exactly {"mcpServers":{}}
//
// Source: plugins["a1-specforge@a1-specforge"][0].installPath and .version of
// ~/.claude/plugins/installed_plugins.json. Only regular files and
// directories are copied; a symlink anywhere aborts before anything is
// written. FR-050: each source file is read once, through the descriptor the
// walk opens right after its lstat (O_NOFOLLOW, fstat regular), never again
// by path; a file swapped for a link in between aborts the seal. Those bytes
// are hashed for the owner's confirmation AND copied, so a source change after
// the confirmation cannot enter the seal (the spec re-reads after the prompt;
// one open descriptor per file across the prompt would exceed the default
// limit of 256 for the 462 files of 1.5.0). With no rewrite the root hash of
// the copy, read back from disk, must equal the confirmed source root, else
// nothing is kept. The dir name's 12 hex come from the SOURCE root (a
// rewritten SKILL.md names the seal dir, so a name from the rewritten files
// would depend on itself); the manifest's root_sha256 is over the sealed
// files: sha256 of the sorted "<path>\t<sha256>\n" lines (rootHash).
//
// Gates, in order: the B1 constant (FR-044: null -> b1_unmeasured), a TTY on
// stdin and stdout, the executor host (FR-017), the source walk, then the
// owner types "yes" on /dev/tty after seeing version, source, file count and
// root hash. `--yes` is a usage error (exit 2), like approve (FR-015).
//
// verifySeal() is what `run` (Wave 6) calls before every spawn; any failure
// is { ok: false, reason: 'sandbox_invalid', detail } with detail one of
// seal_missing, seal_mismatch, seal_writable, seal_stale, mcp_config_mismatch.
// FR-050: manifest through one private descriptor; seal_dir a normalised
// direct child named <version>-<12 hex> (else seal_mismatch). `run` never
// re-seals; after `claude plugin update a1-specforge` the owner seals again.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { INTENT_SEAL_SKILL_REWRITE, INTENT_SKILL_ROWS, rowAllow } = require('./intent-constants.cjs');
const { executorConfig } = require('./intent-lifecycle.cjs');
const { openPrivate, assertPrivateDirAt } = require('./intent-devices.cjs');

const INSTALLED_REL = path.join('.claude', 'plugins', 'installed_plugins.json');
const PLUGIN_KEY = 'a1-specforge@a1-specforge';
const SEAL_DIR = '.a1-intents-seal';
const MANIFEST_FILE = 'manifest.json';
const EMPTY_MCP_FILE = 'empty-mcp.json';
const EMPTY_MCP_BYTES = '{"mcpServers":{}}';
const FILE_MODE = 0o444;
const DIR_MODE = 0o555;
const MANIFEST_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const WRITE_BITS = 0o222;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const ROOT_PREFIX_HEX = 12;
const CONFIRM_WORD = 'yes';
const ANSWER_MAX_BYTES = 64;
const TTY_PATH = '/dev/tty';
const SKILL_FILE_RE = /^skills\/([^/]+)\/SKILL\.md$/;
const SKILL_A1_TOOLS = path.join('_shared', 'a1-tools.cjs');
const SOURCE_MAX_BYTES = 64 * 1024 * 1024; // the 1.5.0 plugin is 4.1 MB; every byte is held once in memory
const READ_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;

class SealRefusal extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = code;
  }
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// Pure: files = { <relative path>: <sha256> } -> root sha256.
function rootHash(files) {
  return sha256(Object.keys(files).sort().map((p) => `${p}\t${files[p]}\n`).join(''));
}

const sealRoot = (homedir) => path.join(homedir(), SEAL_DIR);

// -> { installPath, version } of the installed plugin. Throws SealRefusal.
function readInstalled(homedir) {
  let entry;
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(homedir(), INSTALLED_REL), 'utf8'));
    entry = doc && doc.plugins && Array.isArray(doc.plugins[PLUGIN_KEY]) ? doc.plugins[PLUGIN_KEY][0] : null;
  } catch (e) {
    throw new SealRefusal('plugin_not_installed', `~/${INSTALLED_REL} is unreadable (${e.code || 'not JSON'})`);
  }
  const ok = entry && typeof entry.installPath === 'string' && path.isAbsolute(entry.installPath)
    && typeof entry.version === 'string' && VERSION_RE.test(entry.version);
  if (!ok) throw new SealRefusal('plugin_not_installed', `no usable ${PLUGIN_KEY} entry in ~/${INSTALLED_REL}`);
  return { installPath: entry.installPath, version: entry.version };
}

// lstat walk -> { files, dirs, other } (sorted); `onFile(rel)` -> the entry
// kept for a regular file (default: its path). Links are never followed.
function walkTree(root, onFile = (r) => r, rel = '', acc = { files: [], dirs: [], other: [] }) {
  for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(path.join(root, r));
    if (st.isDirectory()) {
      acc.dirs.push(r);
      walkTree(root, onFile, r, acc);
    } else if (st.isFile()) acc.files.push(onFile(r));
    else acc.other.push(r);
  }
  return acc;
}

// Reads one file through its own descriptor: O_NOFOLLOW, fstat regular.
function readRegular(abs, rel, onLink) {
  let fd;
  try {
    fd = fs.openSync(abs, READ_FLAGS);
  } catch (e) {
    if (e && (e.code === 'ELOOP' || e.code === 'EMLINK')) throw new SealRefusal(onLink, `became a link during the walk: ${rel.slice(0, 200)}`);
    throw e;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) throw new SealRefusal(onLink, `not a regular file: ${rel.slice(0, 200)}`);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

// FR-050 — each file is read right after its lstat, through its own
// descriptor. -> { files: [{ rel, bytes }], dirs: [rel] }.
function walkSource(root, d) {
  if (!fs.lstatSync(root).isDirectory()) throw new SealRefusal('symlink_in_source', 'the install path is not a directory');
  let total = 0;
  const tree = walkTree(root, (r) => {
    d.afterLstat(r);
    const bytes = readRegular(path.join(root, r), r, 'symlink_in_source');
    total += bytes.length;
    if (total > SOURCE_MAX_BYTES) throw new SealRefusal('source_too_large', `the plugin exceeds ${SOURCE_MAX_BYTES} bytes`);
    return { rel: r, bytes };
  });
  if (tree.other.length > 0) throw new SealRefusal('symlink_in_source', `not a regular file or directory: ${tree.other[0].slice(0, 200)}`);
  return tree;
}

// FR-044 — replace the items of the frontmatter `allowed-tools:` block list;
// every other byte stays. -> the new text, or null when there is no block.
function rewriteAllowedTools(text, list) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  const at = lines.findIndex((l, i) => i > 0 && i < end && l === 'allowed-tools:');
  if (end < 0 || at < 0) return null;
  let j = at + 1;
  while (j < end && lines[j].startsWith('  - ')) j += 1;
  if (j === at + 1) return null;
  return [...lines.slice(0, at + 1), ...list.map((t) => `  - ${t}`), ...lines.slice(j)].join('\n');
}

// -> the bytes the seal holds for `rel` (rewritten SKILL.md or the source).
function sealedContent({ rel, bytes }, rewrite, sealDir) {
  const m = rewrite ? SKILL_FILE_RE.exec(rel) : null;
  if (!m) return bytes;
  const row = INTENT_SKILL_ROWS[m[1]] || 'R';
  const out = rewriteAllowedTools(bytes.toString('utf8'), rowAllow(row, path.join(sealDir, SKILL_A1_TOOLS)));
  if (out === null) throw new SealRefusal('skill_rewrite_failed', `${rel} has no allowed-tools block list`);
  return Buffer.from(out, 'utf8');
}

function makeWritable(dir) {
  fs.chmodSync(dir, PRIVATE_DIR_MODE);
  for (const d of walkTree(dir).dirs) fs.chmodSync(path.join(dir, d), PRIVATE_DIR_MODE);
}

function removeTree(dir) {
  if (!fs.existsSync(dir)) return;
  if (!fs.lstatSync(dir).isDirectory()) throw new Error(`intent seal: ${dir} is not a directory; remove it by hand`);
  makeWritable(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

// Copies the walked bytes into `staging` and removes every write bit.
function buildCopy(tree, staging, rewrite, finalDir) {
  fs.mkdirSync(staging, { mode: PRIVATE_DIR_MODE });
  for (const d of tree.dirs) fs.mkdirSync(path.join(staging, d), { mode: PRIVATE_DIR_MODE });
  for (const entry of tree.files) {
    fs.writeFileSync(path.join(staging, entry.rel), sealedContent(entry, rewrite, finalDir), { mode: FILE_MODE, flag: 'wx' });
    fs.chmodSync(path.join(staging, entry.rel), FILE_MODE);
  }
  for (const d of [...tree.dirs].reverse()) fs.chmodSync(path.join(staging, d), DIR_MODE);
  fs.chmodSync(staging, DIR_MODE);
}

// { rel: sha256 } of the copy as read back from disk (O_NOFOLLOW descriptors).
function hashCopy(staging, tree) {
  return Object.fromEntries(tree.files.map(({ rel }) => [rel, sha256(readRegular(path.join(staging, rel), rel, 'seal_root_mismatch'))]));
}

function writeAtomic(file, text, mode) {
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, text, { mode, flag: 'wx' });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

// The owner sees what is sealed and types "yes" on the terminal.
function confirmOnTty(summary) {
  const fd = fs.openSync(TTY_PATH, 'r+');
  try {
    fs.writeSync(fd, `${summary}\nType "${CONFIRM_WORD}" to seal this copy: `);
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
  now: Date.now,
  rewrite: INTENT_SEAL_SKILL_REWRITE,
  isTty: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
  confirm: confirmOnTty,
  afterLstat: () => {}, //        FR-050 fixture hooks (library calls only): between lstat and open,
  beforeRootCompare: () => {}, // and between the copy and its root compare
});

function summaryText(src, tree, sourceRoot, rewrite) {
  return [
    `intent seal: a1-specforge ${src.version}`,
    `  source:      ${src.installPath}`,
    `  files:       ${tree.files.length}`,
    `  root sha256: ${sourceRoot} (source)`,
    `  allowed-tools rewrite: ${rewrite ? 'row lists (B1: WIDENS)' : 'none (B1: NO-WIDENING)'}`,
  ].join('\n');
}

// Everything before the first write: gates, source, confirmation.
function prepareSeal(d) {
  if (d.rewrite === null) throw new SealRefusal('b1_unmeasured', 'INTENT_SEAL_SKILL_REWRITE is null until RESEARCH.md round 3 records the B1 verdict');
  if (!d.isTty()) throw new SealRefusal('not_a_tty', 'intent seal needs an interactive terminal on stdin and stdout');
  const config = executorConfig(d);
  if (config === null || config.executor_host !== d.hostname) throw new SealRefusal('not_executor_host', 'intent seal runs only on the executor host');
  const src = readInstalled(d.homedir);
  const tree = walkSource(src.installPath, d);
  const sourceRoot = rootHash(Object.fromEntries(tree.files.map(({ rel, bytes }) => [rel, sha256(bytes)])));
  if (!d.confirm(summaryText(src, tree, sourceRoot, d.rewrite))) throw new SealRefusal('not_confirmed', `the answer was not "${CONFIRM_WORD}"`);
  return { src, tree, sourceRoot };
}

// -> { ok: true, ... } or throws SealRefusal. Writes only after the gates.
function sealPlugin(deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const { src, tree, sourceRoot } = prepareSeal(d);
  const root = fs.realpathSync(assertPrivateDirAt(sealRoot(d.homedir))); // --plugin-dir is a child of it
  const finalDir = path.join(root, `${src.version}-${sourceRoot.slice(0, ROOT_PREFIX_HEX)}`);
  const staging = path.join(root, `.staging-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  let files;
  try {
    buildCopy(tree, staging, d.rewrite, finalDir);
    d.beforeRootCompare(staging);
    files = hashCopy(staging, tree);
    if (!d.rewrite && rootHash(files) !== sourceRoot) {
      throw new SealRefusal('seal_root_mismatch', 'the copy differs from the confirmed source root; nothing was kept');
    }
    removeTree(finalDir);
    fs.renameSync(staging, finalDir);
  } finally {
    removeTree(staging);
  }
  writeAtomic(path.join(root, EMPTY_MCP_FILE), EMPTY_MCP_BYTES, FILE_MODE);
  const manifest = {
    source_install_path: src.installPath,
    version: src.version,
    sealed_at: new Date(d.now()).toISOString(),
    seal_dir: finalDir,
    skill_rewrite: d.rewrite ? 'row-lists' : 'none',
    files,
    root_sha256: rootHash(files),
  };
  writeAtomic(path.join(root, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, MANIFEST_MODE);
  return { ok: true, seal_dir: finalDir, version: src.version, files: tree.files.length, root_sha256: manifest.root_sha256, skill_rewrite: manifest.skill_rewrite };
}

// ---------- verification (called by `run` before every spawn) ----------

const invalidSeal = (detail) => Object.freeze({ ok: false, reason: 'sandbox_invalid', detail });

// The seal directory: private (FR-011), else seal_mismatch; absent -> seal_missing.
function verifiedRoot(homedir) {
  const root = sealRoot(homedir);
  if (!fs.existsSync(root)) throw new SealRefusal('seal_missing');
  try {
    assertPrivateDirAt(root, {}, { create: false });
  } catch (e) {
    if (e && e.code === 'A1_INTENTS_DIR_UNSAFE') throw new SealRefusal('seal_mismatch');
    throw e;
  }
  return fs.realpathSync(root);
}

// FR-050 — manifest through one private descriptor: 0600 regular file of
// this uid, no link (else seal_mismatch); missing or unparsable -> seal_missing.
function readManifest(root) {
  const fd = openPrivate(path.join(root, MANIFEST_FILE), 'file', {}, () => new SealRefusal('seal_mismatch'));
  if (fd === null) throw new SealRefusal('seal_missing');
  let m;
  try {
    m = JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch (_e) {
    throw new SealRefusal('seal_missing'); // an unparsable manifest pins nothing
  } finally {
    fs.closeSync(fd);
  }
  const ok = m && typeof m.seal_dir === 'string' && typeof m.version === 'string' && m.files && typeof m.files === 'object'
    && typeof m.root_sha256 === 'string';
  if (!ok) throw new SealRefusal('seal_missing');
  return m;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// FR-050 — seal_dir is a normalised direct child of the seal directory named
// <version>-<12 hex>: no `.`/`..` segment, unchanged by path.normalize.
function sealDirShapeOk(m, root) {
  const sd = m.seal_dir;
  if (!path.isAbsolute(sd) || path.normalize(sd) !== sd || sd.split(path.sep).some((seg) => seg === '.' || seg === '..')) return false;
  if (!VERSION_RE.test(m.version) || path.dirname(sd) !== root) return false;
  return new RegExp(`^${escapeRe(m.version)}-[0-9a-f]{${ROOT_PREFIX_HEX}}$`).test(path.basename(sd));
}

// Hash of one sealed file through an O_NOFOLLOW descriptor.
const hashSealed = (dir, rel) => sha256(readRegular(path.join(dir, rel), rel, 'seal_mismatch'));

// The on-disk half: type, write bits, file set, hashes, root. -> detail|null.
function checkSealTree(m) {
  const tree = walkTree(m.seal_dir);
  if (tree.other.length > 0) return 'seal_mismatch';
  const modes = [m.seal_dir, ...tree.dirs.map((r) => path.join(m.seal_dir, r)), ...tree.files.map((r) => path.join(m.seal_dir, r))]
    .map((p) => fs.lstatSync(p).mode);
  if (modes.some((mode) => (mode & WRITE_BITS) !== 0)) return 'seal_writable';
  const onDisk = [...tree.files].sort(); // every file under the dir, listed or not
  if (Object.keys(m.files).sort().join('\n') !== onDisk.join('\n')) return 'seal_mismatch';
  const own = Object.fromEntries(onDisk.map((r) => [r, hashSealed(m.seal_dir, r)]));
  if (onDisk.some((r) => own[r] !== m.files[r]) || rootHash(own) !== m.root_sha256) return 'seal_mismatch';
  return null;
}

function emptyMcpIntact(root) {
  try {
    return readRegular(path.join(root, EMPTY_MCP_FILE), EMPTY_MCP_FILE, 'mcp_config_mismatch').toString('utf8') === EMPTY_MCP_BYTES;
  } catch (_e) {
    return false; // missing, a link or not a file: a mismatch
  }
}

function installedVersion(homedir) {
  try {
    return readInstalled(homedir).version;
  } catch (_e) {
    return null; // plugin gone or unreadable: the seal cannot be current
  }
}

// -> { ok: true, sealDir, rootSha, version, skillRewrite } | invalidSeal(detail)
function verifySeal(deps = {}) {
  const homedir = deps.homedir || os.homedir;
  try {
    const root = verifiedRoot(homedir);
    const m = readManifest(root);
    if (!sealDirShapeOk(m, root)) return invalidSeal('seal_mismatch');
    if (!fs.existsSync(m.seal_dir) || !fs.lstatSync(m.seal_dir).isDirectory()) return invalidSeal('seal_missing');
    const bad = checkSealTree(m);
    if (bad !== null) return invalidSeal(bad);
    if (installedVersion(homedir) !== m.version) return invalidSeal('seal_stale');
    if (!emptyMcpIntact(root)) return invalidSeal('mcp_config_mismatch');
    return Object.freeze({ ok: true, sealDir: m.seal_dir, rootSha: m.root_sha256, version: m.version, skillRewrite: m.skill_rewrite });
  } catch (e) {
    if (!(e instanceof SealRefusal)) throw e;
    return invalidSeal(e.code === 'seal_missing' ? 'seal_missing' : 'seal_mismatch'); // e.g. a sealed entry turned into a link
  }
}

module.exports = { SealRefusal, rootHash, rewriteAllowedTools, sealPlugin, verifySeal };
