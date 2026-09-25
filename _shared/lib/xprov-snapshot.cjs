'use strict';

// ---------------------------------------------------------------------------
// xprov-snapshot — the review target is a fresh, depth-limited fetch, never the
// live tree (spec 009-cross-provider-review-gate, Wave 5; FR-016, FR-017;
// amended 2026-09-24 after a1-samuel-security's W5 review).
//
//   snapshot({ sourceRepo, commit, base }) → { ok, snapshot, commit, depth,
//     files_scanned, files_skipped (always 0), repo_local_removed, gitleaks }
//     `git init` + `git fetch --depth N <sourceRepo> <commit>` + `checkout
//     FETCH_HEAD` (argv arrays via spawnSync, never a shell). N = 1 for a plan
//     review; N = `rev-list --count base..commit` + 1 when `base` is given
//     (inspect mode: the runner runs `git diff <base>` INSIDE the snapshot, so
//     base must be reachable — one commit too shallow and the runner fails).
//     A parent commit's secret is therefore never in the snapshot's history
//     (MAJOR 6). Only tracked files exist in the clone (no untracked, no
//     ignored, no worktree gitdir file, no objects/info/alternates).
//     After the checkout the repo-local Codex inputs `.codex/`, `AGENTS.md`,
//     `AGENTS.override.md` are removed from the WORKING TREE (rm, not git rm:
//     both tripwire baselines see the same state) and reported (MAJOR 7).
//     Then the secret scan BEFORE anything is dispatched: EVERY `git ls-files
//     -z` entry is scanned, nothing is skipped (MAJOR 5) — files are read in
//     5 MB windows with a 512-byte overlap and decoded as latin1 (the patterns
//     are ASCII), UTF-16 candidates (BOM or alternating NULs) are decoded as
//     UTF-16 as well, symlinks contribute their link text. `gitleaks detect
//     --no-git --source <dir> --no-banner --redact --config <a1's own toml>`
//     runs when gitleaks is on PATH (the reviewed repo's `.gitleaks.toml` is
//     never loaded). Any hit removes the clone and reports
//     `secret_in_snapshot` with the pattern NAME only.
//
//   cleanupSnapshot(dir) refuses anything that is not a direct `snap-*` child
//     of the snapshots root (realpath compared). CLI: `a1-tools xprov snapshot
//     --repo <path> --commit <rev> [--base <rev>]` or `--remove <dir>`.
//
// Measured 2026-09-24: codex-cli 0.155.1 `features list` is byte-identical
// with and without a repo-local `.codex/config.toml` in the cwd — that proves
// non-reading for [features] only, which is why the files are stripped anyway.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseFlags, repoRoot } = require('./io.cjs');
const { isUnder } = require('./xprov-artifacts.cjs');
const X = require('./xprov.cjs');

const DIR_MODE = 0o700;
const SNAP_PREFIX = 'snap-';
const SCAN_WINDOW = X.MAX_RESULT_BYTES; // 5 MB windows …
const SCAN_OVERLAP = 512; // … with overlap so a token on a window edge is still seen
const UTF16_SNIFF_BYTES = 8000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
// No leading `-`: `--commit --force` must never become a git option.
const REF_RE = /^[A-Za-z0-9._][A-Za-z0-9._/@^~-]{0,199}$/;
const STDERR_TAIL_CHARS = 500;
const REPO_LOCAL_STRIP = Object.freeze(['.codex', 'AGENTS.md', 'AGENTS.override.md']);
const GITLEAKS_CONFIG = path.join(__dirname, 'xprov-gitleaks.toml');
const UPLOAD_PACK_FALLBACK = 'git -c uploadpack.allowAnySHA1InWant=true upload-pack'; // literal, ours — not user input

function inputError(reason, message) {
  const err = new Error(message);
  err.code = 'A1_INPUT';
  err.reason = reason;
  return err;
}

function git(args, opts) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'], ...(opts || {}) });
  return { status: r.status, stdout: r.stdout || '', stderr: (r.stderr || '').trim(), error: r.error || null };
}

const tail = (s) => (s.length > STDERR_TAIL_CHARS ? `…${s.slice(-STDERR_TAIL_CHARS)}` : s);

function mkdir0700(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  fs.chmodSync(dir, DIR_MODE);
}

/** ~/.a1-xprov/snapshots/, 0700, never inside the checkout or the vault. */
function ensureSnapshotsRoot() {
  const root = path.resolve(X.snapshotsDir());
  const forbidden = [repoRoot()];
  if (process.env.A1_VAULT_ROOT && process.env.A1_VAULT_ROOT.trim() !== '') forbidden.push(process.env.A1_VAULT_ROOT);
  for (const f of forbidden) {
    if (isUnder(root, f)) throw inputError('snapshots_inside_checkout_or_vault', `snapshots root ${root} would lie under ${f}`);
  }
  mkdir0700(X.xprovHome());
  mkdir0700(root);
  return root;
}

function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best effort; reported by the caller's state */ }
}

// ---------- complete secret scan ----------

function firstPattern(text) {
  const p = X.SECRET_PATTERNS.find((entry) => entry.re.test(text));
  return p ? p.name : null;
}

/** UTF-16 candidate: BOM, or NULs in every other byte of the first bytes. */
function utf16Mode(head) {
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return 'le';
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return 'be';
  const n = Math.min(head.length, UTF16_SNIFF_BYTES);
  if (n < 4) return null;
  let oddNul = 0;
  let evenNul = 0;
  for (let i = 0; i < n; i++) { if (head[i] === 0) { if (i % 2) oddNul++; else evenNul++; } }
  if (oddNul > n / 4 && evenNul < n / 16) return 'le';
  if (evenNul > n / 4 && oddNul < n / 16) return 'be';
  return null;
}

function swapBytes(buf) {
  const out = Buffer.from(buf);
  for (let i = 0; i + 1 < out.length; i += 2) { const t = out[i]; out[i] = out[i + 1]; out[i + 1] = t; }
  return out;
}

/** Scan one buffer window as latin1 and, when asked, as UTF-16. */
function scanChunk(chunk, mode) {
  const hit = firstPattern(chunk.toString('latin1'));
  if (hit) return hit;
  if (mode === 'le') return firstPattern(chunk.toString('utf16le'));
  if (mode === 'be') return firstPattern(swapBytes(chunk).toString('utf16le'));
  return null;
}

/** Windowed scan of one regular file; never skips, whatever the size. */
function scanFile(full, size) {
  const fd = fs.openSync(full, 'r');
  try {
    let mode = null;
    let offset = 0;
    let first = true;
    while (offset < size || first) {
      const len = Math.max(Math.min(SCAN_WINDOW + SCAN_OVERLAP, size - offset), 0);
      const buf = Buffer.alloc(len);
      if (len > 0) fs.readSync(fd, buf, 0, len, offset);
      if (first) { mode = utf16Mode(buf); first = false; }
      const hit = scanChunk(buf, mode);
      if (hit) return hit;
      offset += SCAN_WINDOW;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** Scan every tracked entry; returns { hit: name|null, files_scanned, skipped: 0 }. */
function scanTrackedFiles(dir) {
  const ls = git(['-C', dir, 'ls-files', '-z']);
  if (ls.status !== 0) return { hit: null, files_scanned: 0, skipped: 0, error: tail(ls.stderr) };
  let scanned = 0;
  for (const rel of ls.stdout.split('\0').filter(Boolean)) {
    const full = path.join(dir, rel);
    let st;
    try { st = fs.lstatSync(full); } catch (_e) { continue; } // stripped repo-local file (MAJOR 7), nothing to scan
    scanned++;
    const hit = st.isSymbolicLink() ? firstPattern(fs.readlinkSync(full)) : st.isFile() ? scanFile(full, st.size) : null;
    if (hit) return { hit, files_scanned: scanned, skipped: 0 };
  }
  return { hit: null, files_scanned: scanned, skipped: 0 };
}

/** gitleaks when on PATH, with a1's own config (never the reviewed repo's). */
function gitleaksScan(dir) {
  const r = spawnSync('gitleaks', ['detect', '--no-git', '--source', dir, '--no-banner', '--redact', '--config', GITLEAKS_CONFIG],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error && r.error.code === 'ENOENT') return { available: false, hit: false };
  return { available: true, hit: r.status !== 0 };
}

// ---------- snapshot ----------

function fetchDepth(sourceRepo, commit, base) {
  if (!base) return { ok: true, depth: 1 };
  const r = git(['-C', sourceRepo, 'rev-list', '--count', `${base}..${commit}`]);
  if (r.status !== 0 || !/^\d+$/.test(r.stdout.trim())) return { ok: false, detail: `rev-list ${base}..${commit}: ${tail(r.stderr)}` };
  return { ok: true, depth: Number(r.stdout.trim()) + 1 };
}

function fetchInto(dir, sourceRepo, commit, depth) {
  const plain = git(['-C', dir, 'fetch', '--quiet', '--depth', String(depth), sourceRepo, commit]);
  if (plain.status === 0) return plain;
  // Older git refuses a bare sha as `want` unless the server allows it; for a local path the server is ours.
  return git(['-C', dir, 'fetch', '--quiet', '--depth', String(depth), `--upload-pack=${UPLOAD_PACK_FALLBACK}`, sourceRepo, commit]);
}

function stripRepoLocal(dir) {
  const removed = [];
  for (const name of REPO_LOCAL_STRIP) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed.push(name); }
  }
  return removed;
}

function snapshot(opts) {
  const sourceRepo = path.resolve(opts.sourceRepo);
  const commit = String(opts.commit);
  const base = opts.base === undefined || opts.base === null ? null : String(opts.base);
  if (!REF_RE.test(commit)) throw inputError('bad_commit', `--commit must be a git revision (no leading dash, no whitespace; got ${JSON.stringify(commit.slice(0, 80))})`);
  if (base !== null && !REF_RE.test(base)) throw inputError('bad_base', `--base must be a git revision (no leading dash, no whitespace; got ${JSON.stringify(base.slice(0, 80))})`);
  const root = ensureSnapshotsRoot();
  const dir = fs.mkdtempSync(path.join(root, SNAP_PREFIX));
  fs.chmodSync(dir, DIR_MODE);
  const failed = (reason, extra) => { removeDir(dir); return { ok: false, reason, snapshot: null, commit, ...extra }; };
  const depth = fetchDepth(sourceRepo, commit, base);
  if (!depth.ok) return failed(X.REASONS.snapshot_failed, { detail: depth.detail });
  const init = git(['init', '--quiet', dir]);
  if (init.status !== 0) return failed(X.REASONS.snapshot_failed, { detail: `init: ${tail(init.stderr || String(init.error))}` });
  const fetch = fetchInto(dir, sourceRepo, commit, depth.depth);
  if (fetch.status !== 0) return failed(X.REASONS.snapshot_failed, { detail: `fetch ${commit} (depth ${depth.depth}): ${tail(fetch.stderr || String(fetch.error))}` });
  const co = git(['-C', dir, 'checkout', '--quiet', 'FETCH_HEAD']);
  if (co.status !== 0) return failed(X.REASONS.snapshot_failed, { detail: `checkout: ${tail(co.stderr)}` });
  const head = git(['-C', dir, 'rev-parse', 'HEAD']);
  if (head.status !== 0) return failed(X.REASONS.snapshot_failed, { detail: `rev-parse: ${tail(head.stderr)}` });
  const repoLocalRemoved = stripRepoLocal(dir);
  const scan = scanTrackedFiles(dir);
  if (scan.error) return failed(X.REASONS.snapshot_failed, { detail: `ls-files: ${scan.error}` });
  if (scan.hit) return failed(X.REASONS.secret_in_snapshot, { secret_pattern: scan.hit, files_scanned: scan.files_scanned });
  const gl = gitleaksScan(dir);
  if (gl.hit) return failed(X.REASONS.secret_in_snapshot, { secret_pattern: 'gitleaks', files_scanned: scan.files_scanned });
  return {
    ok: true, snapshot: dir, commit: head.stdout.trim(), depth: depth.depth, files_scanned: scan.files_scanned,
    files_skipped: 0, repo_local_removed: repoLocalRemoved, gitleaks: gl.available,
  };
}

/** Remove one snapshot; only a direct `snap-*` child of the snapshots root qualifies. */
function cleanupSnapshot(dir) {
  const root = path.resolve(X.snapshotsDir());
  const target = path.resolve(dir);
  const rel = path.relative(root, target);
  const direct = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep);
  if (!direct || !path.basename(target).startsWith(SNAP_PREFIX)) {
    throw inputError('not_a_snapshot', `${target} is not a snapshot under ${root}; refusing to remove it`);
  }
  if (fs.existsSync(target) && fs.realpathSync(path.dirname(target)) !== fs.realpathSync(root)) {
    throw inputError('not_a_snapshot', `${target} does not resolve under ${root}; refusing to remove it`);
  }
  removeDir(target);
  return target;
}

// ---------- CLI ----------

function writeStdoutSync(text) {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off, buf.length - off); } catch (e) { if (e.code !== 'EAGAIN') throw e; }
  }
}

function usage(msg) {
  process.stderr.write(`usage error: xprov snapshot ${msg}\n`);
  process.stderr.write('  usage: xprov snapshot --repo <path> --commit <rev> [--base <rev>] | xprov snapshot --remove <dir>\n');
  process.exit(X.EXIT_USAGE);
}

function cmdXprovSnapshot(args) {
  const flags = parseFlags(args, { repo: 'str', commit: 'str', base: 'str', remove: 'str' });
  if (flags._.length) usage(`unexpected argument ${JSON.stringify(String(flags._[0]).slice(0, 80))}`);
  if (flags.remove !== undefined) {
    const removed = cleanupSnapshot(flags.remove); // A1_INPUT → facade exit 2
    writeStdoutSync(`${JSON.stringify({ removed }, null, 2)}\n`);
    process.exitCode = X.EXIT_PASS;
    return;
  }
  if (!flags.repo || !flags.commit) usage('--repo <path> and --commit <rev> are required');
  if (!REF_RE.test(String(flags.commit))) usage(`--commit must be a git revision without a leading dash or whitespace (got ${JSON.stringify(String(flags.commit).slice(0, 80))})`);
  if (flags.base !== undefined && !REF_RE.test(String(flags.base))) usage('--base must be a git revision without a leading dash or whitespace');
  const repo = path.resolve(flags.repo);
  if (!fs.existsSync(path.join(repo, '.git'))) usage(`--repo is not a git checkout: ${repo}`);
  const r = snapshot({ sourceRepo: repo, commit: flags.commit, base: flags.base });
  if (!r.ok) {
    process.stderr.write(`xprov snapshot: ${r.reason}${r.secret_pattern ? ` (pattern ${r.secret_pattern})` : ''}${r.detail ? ` — ${r.detail}` : ''}\n`);
  }
  writeStdoutSync(`${JSON.stringify(r, null, 2)}\n`);
  process.exitCode = r.ok ? X.EXIT_PASS : X.EXIT_FAIL;
}

module.exports = {
  snapshot, cleanupSnapshot, scanTrackedFiles, scanFile, utf16Mode, gitleaksScan, ensureSnapshotsRoot, cmdXprovSnapshot,
  SNAP_PREFIX, REPO_LOCAL_STRIP, GITLEAKS_CONFIG, REF_RE,
};
