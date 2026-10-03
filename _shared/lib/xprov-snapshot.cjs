'use strict';

// ---------------------------------------------------------------------------
// xprov-snapshot — the review target is a fresh, depth-limited fetch, never the
// live tree (spec 009-cross-provider-review-gate, Wave 5; FR-016, FR-017;
// amended 2026-09-24 after a1-samuel-security's W5 review).
//
//   snapshot({ sourceRepo, commit, base, inputs, targetDir }) → { ok, snapshot,
//     commit, base, depth, files_scanned, base_files_scanned, inputs_scanned,
//     files_skipped (always 0), repo_local_removed, gitleaks, inputs,
//     diff_sha256 }
//     `git init` + `git fetch --depth 1 <sourceRepo> <commit>` + `checkout
//     FETCH_HEAD` (argv arrays via spawnSync, never a shell); with `base`
//     (inspect) base is fetched `--depth 1` as well, so the runner's `git diff
//     <base>` resolves INSIDE the snapshot while no commit between them — and
//     no parent commit's secret — is ever in its object store (MAJOR 6; Wave 7
//     replaced the earlier `rev-list --count base..commit` + 1 depth). Only tracked files exist in the clone (no untracked, no
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
// Wave 7 (a1-samuel-security, 2 MAJOR, 2026-10-02): EVERYTHING that leaves for
// the provider is scanned, not only the reviewed tree. Measured in the pinned
// runner.py 2.1.0: inspect sends `git diff --no-ext-diff --no-textconv <base>
// --` of the snapshot working tree (runner.py:345) — removed lines, deleted
// files and the base content of stripped repo-local files; the plan from the
// --plan path (:323); the --feedback file verbatim (:349). Hence:
//   * inspect fetches exactly base and head, depth 1 each — intermediate
//     commits' objects are never in the snapshot (plan review: head only);
//   * base side: every path of `git diff --name-only --no-renames -z <base>
//     --` (stripped working tree vs base, so deletions and stripped files are
//     included) is scanned as the `<base>:<path>` blob, side `base`;
//   * inputs: PLAN.md and the dispositions are COPIED into `<snapshot>.inputs/`
//     (0700, a1-owned, outside the snapshot so the runner's untracked-file
//     manifest never sees them), the copies are scanned (side `input`, labelled
//     with their repo path) and the gate passes the copies to the runner;
//   * path NAMES of the snapshot and of every base-side path (deletions, both
//     rename sides) are scanned too, first; a hit is never allowlisted and is
//     reported by pattern and a 12-character sha256 of the path only;
//   * every side meets the same anchored allowlist (xprov-allowlist evaluate,
//     `extra`); gitleaks runs over the base blobs and the inputs as well and is
//     never allowlisted;
//   * the diff the runner will hash is hashed HERE, right after the scan, with
//     a runner-like git environment (empty HOME, GIT_CONFIG_NOSYSTEM=1), and
//     written to `<snapshot>.inputs/diff.sha256`; `xprov run` compares it with
//     the runner's own snapshot.diff_sha256 (runner.py:106-107) — a mismatch
//     is a tripwire (detective TOCTOU check).
//   * `targetDir` rebuilds a snapshot at a given path (plan-review resume: the
//     runner refuses a resume whose record.repo differs, runner.py:257-264);
//     the path must be a `snap-XXXXXX` child of the snapshots root, no
//     symlink, absent or empty — and so must its `.inputs` sibling.
//
// Measured 2026-09-24: codex-cli 0.155.1 `features list` is byte-identical
// with and without a repo-local `.codex/config.toml` in the cwd — that proves
// non-reading for [features] only, which is why the files are stripped anyway.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseFlags, repoRoot } = require('./io.cjs');
const { isUnder } = require('./xprov-artifacts.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const AL = require('./xprov-allowlist.cjs');
// Shared helpers — one definition each, in xprov-common.cjs.
const { DIR_MODE, mkdir0700, writeStdoutSync, gitSpawn: git } = C;
const tail = C.stderrTail;

const SNAP_PREFIX = 'snap-';
const SCAN_WINDOW = X.MAX_RESULT_BYTES; // 5 MB windows …
const SCAN_OVERLAP = 512; // … with overlap so a token on a window edge is still seen
const UTF16_SNIFF_BYTES = 8000;
// No leading `-`: `--commit --force` must never become a git option.
const REF_RE = /^[A-Za-z0-9._][A-Za-z0-9._/@^~-]{0,199}$/;
// `.agents` (Wave 7, measured): `.agents/skills` at the git root of Codex's cwd is
// a skill root whose text lands in a developer message — the reviewed repo must
// not steer its own reviewer. Only the root counts (nothing above the git root,
// measured), and the snapshot root is the runner's cwd.
const REPO_LOCAL_STRIP = Object.freeze(['.codex', 'AGENTS.md', 'AGENTS.override.md', '.agents']);
const GITLEAKS_CONFIG = path.join(__dirname, 'xprov-gitleaks.toml');
const UPLOAD_PACK_FALLBACK = 'git -c uploadpack.allowAnySHA1InWant=true upload-pack'; // literal, ours — not user input
const INPUTS_SUFFIX = '.inputs';
const DIFF_SHA_FILE = 'diff.sha256';
const INPUTS_RECORD_FILE = 'inputs.json'; // { plan: sha256, feedback: sha256 } of the scanned copies
const INPUT_FILES = Object.freeze({ plan: 'PLAN.md', feedback: 'feedback.md' });
const SNAP_NAME_RE = /^snap-[A-Za-z0-9]{6}$/; // mkdtemp's six-character suffix
const FILE_MODE = 0o600;


/** ~/.a1-xprov/snapshots/, 0700, never inside the checkout or the vault. */
function ensureSnapshotsRoot() {
  const root = path.resolve(X.snapshotsDir());
  const forbidden = [repoRoot()];
  if (process.env.A1_VAULT_ROOT && process.env.A1_VAULT_ROOT.trim() !== '') forbidden.push(process.env.A1_VAULT_ROOT);
  for (const f of forbidden) {
    if (isUnder(root, f)) throw C.inputError(`snapshots root ${root} would lie under ${f}`, 'snapshots_inside_checkout_or_vault');
  }
  mkdir0700(X.xprovHome());
  mkdir0700(root);
  return root;
}

function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best effort; reported by the caller's state */ }
}

// ---------- complete, counting secret scan (FR-017, FR-030 c) ----------
// Every non-overlapping match of every pattern is counted per file and view
// (latin1, plus UTF-16 when the file sniffs as UTF-16), deduplicated by
// (view, pattern, absolute byte offset of the match start) so a match inside a
// window overlap counts once. Each match carries the fingerprint of its line:
// sha256 over the UTF-8 of the whole decoded line, LF (and a CR before it)
// stripped; a line longer than LINE_MAX_CHARS is fingerprinted over the match
// plus LINE_CONTEXT_CHARS on each side, clipped to the line. Lines are read
// from the FILE, not from the window, so a line crossing a window end is read
// whole. A match never leaves this module as text: only its pattern name, its
// fingerprint and a masked excerpt (first EXCERPT_CHARS characters + length).

const LINE_MAX_CHARS = 4096;
const LINE_CONTEXT_CHARS = 256;
const EXCERPT_CHARS = 4;
const POSITION_CHUNK = 1024 * 1024;
const VIEW_UNIT = Object.freeze({ latin1: 1, utf16le: 2, utf16be: 2 });
const GLOBAL_PATTERNS = Object.freeze(X.SECRET_PATTERNS.map((p) => Object.freeze({
  name: p.name, re: new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : `${p.re.flags}g`),
})));

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

function decodeView(buf, view) {
  if (view === 'latin1') return buf.toString('latin1');
  return (view === 'utf16be' ? swapBytes(buf) : buf).toString('utf16le');
}

/** Random-access byte source: a regular file (fd) or a buffer (symlink text). */
function fdSource(fd, size) {
  return {
    size,
    read(start, end) {
      const s = Math.max(0, start);
      const len = Math.max(0, Math.min(end, size) - s);
      const buf = Buffer.alloc(len);
      if (len > 0) fs.readSync(fd, buf, 0, len, s);
      return buf;
    },
  };
}
const bufferSource = (buf) => ({ size: buf.length, read: (start, end) => buf.subarray(Math.max(0, start), Math.min(end, buf.length)) });

/** The fingerprinted text of the line holding the match at byte `abs`. */
function lineText(src, view, abs, matchChars) {
  const unit = VIEW_UNIT[view];
  const span = (LINE_MAX_CHARS + 1) * unit;
  const backStart = Math.max(0, abs - span);
  const back = decodeView(src.read(backStart, abs), view);
  const nl = back.lastIndexOf('\n');
  const lineStart = nl >= 0 ? backStart + (nl + 1) * unit : backStart === 0 ? 0 : null;
  const fwdEnd = Math.min(src.size, abs + span);
  const fwd = decodeView(src.read(abs, fwdEnd), view);
  const lf = fwd.indexOf('\n');
  const lineEnd = lf >= 0 ? abs + lf * unit : fwdEnd === src.size ? src.size : null;
  const stripCr = (t, atEnd) => (atEnd && t.endsWith('\r') ? t.slice(0, -1) : t);
  if (lineStart !== null && lineEnd !== null) {
    const whole = stripCr(decodeView(src.read(lineStart, lineEnd), view), true);
    if (whole.length <= LINE_MAX_CHARS) return whole;
  }
  const from = Math.max(lineStart === null ? 0 : lineStart, abs - LINE_CONTEXT_CHARS * unit);
  const want = abs + (matchChars + LINE_CONTEXT_CHARS) * unit;
  const to = lineEnd === null ? want : Math.min(lineEnd, want);
  return stripCr(decodeView(src.read(from, to), view), to === lineEnd);
}

/** 1-based line and column of byte `abs` in `view` (propose only). */
function positionOf(src, view, abs) {
  const unit = VIEW_UNIT[view];
  let line = 1;
  let col = 1;
  for (let s = 0; s < abs; s += POSITION_CHUNK * unit) {
    const text = decodeView(src.read(s, Math.min(abs, s + POSITION_CHUNK * unit)), view);
    for (const ch of text) { if (ch === '\n') { line++; col = 1; } else col++; }
  }
  return { line, column: col };
}

function scanWindow(buf, view, offset, seen) {
  const unit = VIEW_UNIT[view];
  const text = decodeView(buf, view);
  for (const p of GLOBAL_PATTERNS) {
    p.re.lastIndex = 0;
    for (let m = p.re.exec(text); m !== null; m = p.re.exec(text)) {
      if (m[0].length === 0) { p.re.lastIndex++; continue; }
      const abs = offset + m.index * unit;
      const key = `${view}\0${p.name}\0${abs}`;
      const prev = seen.get(key);
      if (!prev || prev.chars < m[0].length) seen.set(key, { view, pattern: p.name, abs, chars: m[0].length, head: m[0].slice(0, EXCERPT_CHARS) });
    }
  }
}

/** Keeps one hit per stretch of text: a hit whose start lies inside a kept hit
 * of the same view and pattern is the same match seen again by the next
 * window (e.g. `https://…` at W-3 re-matched as `ps://…` at W). Input must be
 * sorted by (view, pattern, offset). */
function mergeOverlaps(sorted) {
  const kept = [];
  for (const m of sorted) {
    const last = kept[kept.length - 1];
    const same = last && last.view === m.view && last.pattern === m.pattern;
    if (same && m.abs < last.abs + last.chars * VIEW_UNIT[m.view]) continue;
    kept.push(m);
  }
  return kept;
}

/** The match's TRUE length in characters: a window can cut a long match at its
 * buffer end, so the pattern is re-run on the file from the match start. */
function trueChars(src, m) {
  const unit = VIEW_UNIT[m.view];
  const p = X.SECRET_PATTERNS.find((x) => x.name === m.pattern);
  const re = new RegExp(p.re.source, `${p.re.flags}y`);
  const hit = re.exec(decodeView(src.read(m.abs, m.abs + LINE_MAX_CHARS * unit), m.view));
  return hit ? Math.max(hit[0].length, m.chars) : m.chars;
}

/** Every match in one source, in (pattern order, view, offset) order. */
function scanSource(src, rel, withPositions) {
  const head = src.read(0, Math.min(src.size, SCAN_WINDOW + SCAN_OVERLAP));
  const mode = utf16Mode(head);
  const views = mode ? ['latin1', mode === 'le' ? 'utf16le' : 'utf16be'] : ['latin1'];
  const seen = new Map();
  for (let offset = 0; ; offset += SCAN_WINDOW) {
    const end = Math.min(src.size, offset + SCAN_WINDOW + SCAN_OVERLAP);
    const buf = src.read(offset, end);
    for (const view of views) scanWindow(buf, view, offset, seen);
    if (end >= src.size) break;
  }
  const order = (name) => X.SECRET_PATTERNS.findIndex((p) => p.name === name);
  const sorted = [...seen.values()].sort((a, b) => order(a.pattern) - order(b.pattern) || a.view.localeCompare(b.view) || a.abs - b.abs);
  return mergeOverlaps(sorted)
    .map((m) => Object.freeze({
      path: rel, pattern: m.pattern, view: m.view, offset: m.abs,
      fingerprint: C.sha256(Buffer.from(lineText(src, m.view, m.abs, trueChars(src, m)), 'utf8')),
      excerpt: `${m.head}… (${m.chars} chars)`,
      ...(withPositions ? positionOf(src, m.view, m.abs) : {}),
    }));
}

/** Windowed, counting scan of one tracked entry; never skips, whatever the size. */
function scanEntry(full, st, rel, withPositions) {
  if (st.isSymbolicLink()) return scanSource(bufferSource(fs.readlinkSync(full, { encoding: 'buffer' })), rel, withPositions);
  if (!st.isFile()) return [];
  const fd = fs.openSync(full, 'r');
  try { return scanSource(fdSource(fd, st.size), rel, withPositions); } finally { fs.closeSync(fd); }
}

/** Scan every tracked entry of a clone. Returns { files_scanned, skipped: 0,
 * tracked: [paths], matches: [{path, pattern, view, offset, fingerprint,
 * excerpt}], missingBlobs: [{path, buf}] }. A tracked path missing from the
 * working tree (a stripped repo-local file — `.codex/config.toml` is a
 * realistic secret carrier) is still readable as `git show HEAD:<path>` from
 * the snapshot's object store, so its HEAD blob is scanned as side head
 * (Codex R1, live inspect 2026-10-03; Samuel: take the fix, keep the blobs). */
function scanTrackedFiles(dir, opts) {
  const withPositions = Boolean(opts && opts.positions);
  const ls = git(['-C', dir, 'ls-files', '-z']);
  if (ls.status !== 0) return { files_scanned: 0, skipped: 0, tracked: [], matches: [], missingBlobs: [], error: tail(ls.stderr) };
  const tracked = ls.stdout.split('\0').filter(Boolean);
  let scanned = 0;
  const matches = [];
  const missingBlobs = [];
  for (const rel of tracked) {
    const full = path.join(dir, rel);
    let st = null;
    try { st = fs.lstatSync(full); } catch (_e) { st = null; }
    if (st === null) {
      const spec = `HEAD:${rel}`;
      const type = git(['-C', dir, 'cat-file', '-t', spec]);
      if (type.status !== 0 || type.stdout.trim() !== 'blob') continue; // a gitlink: no content in this object store
      const b = spawnSync('git', ['-C', dir, 'cat-file', 'blob', spec], { maxBuffer: C.GIT_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
      if (b.status !== 0) return { files_scanned: scanned, skipped: 0, tracked, matches, missingBlobs, error: `cat-file ${rel}: ${tail(String(b.stderr))}` };
      scanned++;
      missingBlobs.push({ path: rel, buf: b.stdout });
      matches.push(...scanSource(bufferSource(b.stdout), rel, withPositions));
      continue;
    }
    scanned++;
    matches.push(...scanEntry(full, st, rel, withPositions));
  }
  return { files_scanned: scanned, skipped: 0, tracked, matches, missingBlobs };
}

/** gitleaks when on PATH, with a1's own config (never the reviewed repo's). */
function gitleaksScan(dir) {
  const r = spawnSync('gitleaks', ['detect', '--no-git', '--source', dir, '--no-banner', '--redact', '--config', GITLEAKS_CONFIG],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error && r.error.code === 'ENOENT') return { available: false, hit: false };
  return { available: true, hit: r.status !== 0 };
}

// ---------- snapshot ----------

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

function validateRefs(commit, base) {
  if (!REF_RE.test(commit)) throw C.inputError(`--commit must be a git revision (no leading dash, no whitespace; got ${JSON.stringify(commit.slice(0, 80))})`, 'bad_commit');
  if (base !== null && !REF_RE.test(base)) throw C.inputError(`--base must be a git revision (no leading dash, no whitespace; got ${JSON.stringify(base.slice(0, 80))})`, 'bad_base');
}

/** Why `target` cannot be (re)built as a snapshot: not a `snap-XXXXXX` child
 * of the snapshots root, a symlink, or present and non-empty — or null. The
 * `.inputs` sibling must pass the same checks. */
function snapshotPathProblem(target, root) {
  const t = path.resolve(String(target));
  if (!SNAP_NAME_RE.test(path.basename(t))) return `${t}: not a snap-XXXXXX name`;
  let parent;
  try { parent = fs.realpathSync(path.dirname(t)); } catch (_e) { return `${t}: parent does not resolve`; }
  if (parent !== fs.realpathSync(root)) return `${t}: not a direct child of ${root}`;
  for (const p of [t, `${t}${INPUTS_SUFFIX}`]) {
    let st = null;
    try { st = fs.lstatSync(p); } catch (_e) { st = null; }
    if (st === null) continue;
    if (st.isSymbolicLink()) return `${p}: is a symlink`;
    if (!st.isDirectory()) return `${p}: is not a directory`;
    if (fs.readdirSync(p).length > 0) return `${p}: exists and is not empty`;
  }
  return null;
}

/** The clone alone (no scan): { ok, dir, commit, base, depth, repo_local_removed }
 * or { ok: false, reason: snapshot_failed, detail }. Head is fetched depth 1;
 * with `base`, base is fetched depth 1 too — nothing between them. `targetDir`
 * (resume) rebuilds at that validated path. Used by snapshot() and by
 * `allowlist propose|approve` (listing only). */
function cloneSnapshot(sourceRepo, commit, base, targetDir) {
  const root = ensureSnapshotsRoot();
  let dir;
  if (targetDir) {
    const problem = snapshotPathProblem(targetDir, root);
    if (problem) return { ok: false, reason: X.REASONS.snapshot_failed, dir: null, detail: `resume snapshot path refused — ${problem}` };
    dir = path.resolve(targetDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: DIR_MODE });
  } else {
    dir = fs.mkdtempSync(path.join(root, SNAP_PREFIX));
  }
  fs.chmodSync(dir, DIR_MODE);
  const failed = (detail) => { removeDir(dir); return { ok: false, reason: X.REASONS.snapshot_failed, dir: null, detail }; };
  let baseSha = null;
  if (base) {
    const rb = git(['-C', sourceRepo, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
    if (rb.status !== 0) return failed(`base ${base} does not resolve in ${sourceRepo}`);
    baseSha = rb.stdout.trim();
  }
  const init = git(['init', '--quiet', dir]);
  if (init.status !== 0) return failed(`init: ${tail(init.stderr || String(init.error))}`);
  const fetch = fetchInto(dir, sourceRepo, commit, 1);
  if (fetch.status !== 0) return failed(`fetch ${commit} (depth 1): ${tail(fetch.stderr || String(fetch.error))}`);
  const co = git(['-C', dir, 'checkout', '--quiet', 'FETCH_HEAD']);
  if (co.status !== 0) return failed(`checkout: ${tail(co.stderr)}`);
  const head = git(['-C', dir, 'rev-parse', 'HEAD']);
  if (head.status !== 0) return failed(`rev-parse: ${tail(head.stderr)}`);
  if (baseSha !== null && baseSha !== head.stdout.trim()) {
    const fb = fetchInto(dir, sourceRepo, baseSha, 1);
    if (fb.status !== 0) return failed(`fetch base ${baseSha.slice(0, 12)} (depth 1): ${tail(fb.stderr || String(fb.error))}`);
  }
  return { ok: true, dir, commit: head.stdout.trim(), base: baseSha, depth: 1, repo_local_removed: stripRepoLocal(dir) };
}

// ---------- outbound sides: base blobs, input copies, the diff hash (Wave 7) ----------

/** git with the environment the runner's own git runs under: an empty HOME (no
 * global config), GIT_CONFIG_NOSYSTEM=1, the caller's PATH and locale. Buffer stdout. */
function runnerLikeGit(dir, args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-xprov-githome-'));
  try {
    const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
    for (const [k, v] of Object.entries(process.env)) if (k === 'LANG' || k.startsWith('LC_')) env[k] = v;
    return spawnSync('git', ['-C', dir, ...args], { env, maxBuffer: C.GIT_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** Base-side blobs of every path the outbound diff touches: { blobs: [{ path,
 * buf }], paths: [every path of the diff, deletions and both rename sides] }. */
function baseSideBlobs(dir, baseSha) {
  const names = runnerLikeGit(dir, ['diff', '--no-ext-diff', '--name-only', '--no-renames', '-z', baseSha, '--']);
  if (names.status !== 0) return { error: `diff --name-only ${baseSha.slice(0, 12)}: ${tail(String(names.stderr))}` };
  const blobs = [];
  const paths = names.stdout.toString('utf8').split('\0').filter(Boolean);
  for (const rel of paths) {
    const spec = `${baseSha}:${rel}`;
    const type = git(['-C', dir, 'cat-file', '-t', spec]);
    if (type.status !== 0 || type.stdout.trim() !== 'blob') continue; // added in the wave, or a gitlink (the runner refuses those)
    const b = spawnSync('git', ['-C', dir, 'cat-file', 'blob', spec], { maxBuffer: C.GIT_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
    if (b.status !== 0) return { error: `cat-file ${rel}: ${tail(String(b.stderr))}` };
    blobs.push({ path: rel, buf: b.stdout });
  }
  return { blobs, paths };
}

/** Path NAMES leave too (the runner's change manifest and diff headers): the
 * first outbound path that matches a secret pattern, as { pattern, ref } —
 * `ref` is a 12-character sha256 of the path, never the path itself, because
 * the name can be the secret (Codex R1, live inspect 2026-10-03). Path hits
 * are never allowlisted. */
function pathNameHit(paths) {
  for (const p of paths) {
    const hit = X.SECRET_PATTERNS.find((s) => new RegExp(s.re.source, s.re.flags.replace('g', '')).test(p));
    if (hit) return { pattern: hit.name, ref: C.sha256(Buffer.from(p, 'utf8')).slice(0, 12) };
  }
  return null;
}

/** Copies the inputs into `<dir>.inputs/` (0700, files 0600). `inputs` =
 * [{ key: 'plan'|'feedback', source, label }]. Returns { inputsDir, copies,
 * labels } — never reads through a symlinked source. */
function copyInputs(dir, inputs) {
  const inputsDir = `${dir}${INPUTS_SUFFIX}`;
  if (!fs.existsSync(inputsDir)) fs.mkdirSync(inputsDir, { mode: DIR_MODE });
  fs.chmodSync(inputsDir, DIR_MODE);
  const copies = {};
  const labels = [];
  for (const i of inputs || []) {
    const st = fs.lstatSync(i.source);
    if (!st.isFile()) throw C.inputError(`${i.source}: not a regular file`, 'input_not_a_file');
    const dest = path.join(inputsDir, INPUT_FILES[i.key]);
    fs.writeFileSync(dest, fs.readFileSync(i.source), { mode: FILE_MODE });
    copies[i.key] = dest;
    labels.push({ dest, label: i.label });
  }
  // `xprov run` accepts only these copies and re-hashes them right before the
  // spawn against this record (Codex R1, live inspect 2026-10-03).
  const record = Object.fromEntries(Object.entries(copies).map(([k, p]) => [k, C.sha256(fs.readFileSync(p))]));
  fs.writeFileSync(path.join(inputsDir, INPUTS_RECORD_FILE), `${JSON.stringify(record)}\n`, { mode: FILE_MODE });
  return { inputsDir, copies, labels };
}

/** gitleaks over in-memory blobs, written to a 0700 temp dir that is removed. */
function gitleaksBlobs(blobs) {
  if (blobs.length === 0) return { available: true, hit: false };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-xprov-base-'));
  try {
    blobs.forEach((b, n) => {
      const dest = path.join(tmp, String(n), b.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: DIR_MODE });
      fs.writeFileSync(dest, b.buf, { mode: FILE_MODE });
    });
    return gitleaksScan(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The allowlist fields every snapshot result carries (FR-030 g). */
function allowlistReport(al) {
  return {
    allowlisted_hits: al.allowlisted_hits, allowlist_anchor: al.anchor, allowlist_approved_blob: al.approved_blob,
    allowlist_stale: al.stale, allowlisted: al.allowlisted, uncovered: al.uncovered, allowlist_note: al.note,
  };
}

/** Review target + scan. `primaryRoot` is the checkout every FR-030 git read
 * runs against (default: sourceRepo); `gateKind` is 'plan' or 'inspect'
 * (default: inspect when `base` is given). */
function snapshot(opts) {
  const sourceRepo = path.resolve(opts.sourceRepo);
  const commit = String(opts.commit);
  const base = opts.base === undefined || opts.base === null ? null : String(opts.base);
  validateRefs(commit, base);
  const primaryRoot = opts.primaryRoot ? path.resolve(opts.primaryRoot) : sourceRepo;
  const gateKind = opts.gateKind || (base === null ? 'plan' : 'inspect');
  const none = allowlistReport(AL.NO_ALLOWLIST);
  // FR-030 (b): the reviewed checkout must share the primary checkout's object store.
  const primaryCommon = C.commonDirOf(primaryRoot);
  if (primaryCommon === null || primaryCommon !== C.commonDirOf(sourceRepo)) {
    return { ok: false, reason: X.REASONS.snapshot_failed, snapshot: null, commit, detail: `${sourceRepo} does not share the git-common-dir of the primary checkout ${primaryRoot}`, ...none };
  }
  // Read before ensureSnapshotsRoot() tightens ~/.a1-xprov: a 0755 directory must count as "no store" (FR-030 j).
  const approvals = AL.readApprovals();
  const cl = cloneSnapshot(sourceRepo, commit, base, opts.targetDir);
  if (!cl.ok) return { ok: false, reason: cl.reason, snapshot: null, commit, detail: cl.detail, ...none };
  const dir = cl.dir;
  const failed = (reason, extra) => { removeSnapshotDirs(dir); return { ok: false, reason, snapshot: null, commit, ...extra }; };
  const scan = scanTrackedFiles(dir);
  if (scan.error) return failed(X.REASONS.snapshot_failed, { detail: `ls-files: ${scan.error}`, ...none });
  // Base side: what the outbound diff carries from <base>.
  const base_ = cl.base === null ? { blobs: [] } : baseSideBlobs(dir, cl.base);
  if (base_.error) return failed(X.REASONS.snapshot_failed, { detail: base_.error, ...none });
  // Path names first — before any report could list a path (side `path`, never allowlisted).
  const nameHit = pathNameHit([...new Set([...scan.tracked, ...(base_.paths || [])])]);
  if (nameHit) {
    return failed(X.REASONS.secret_in_snapshot, { secret_pattern: nameHit.pattern, secret_side: 'path', reason_detail: 'path_name', detail: `path #${nameHit.ref}`, files_scanned: scan.files_scanned, ...none });
  }
  const baseMatches = base_.blobs.flatMap((b) => scanSource(bufferSource(b.buf), b.path, false));
  // Inputs: the copies the runner will read, scanned under their repo labels.
  let ins;
  try { ins = copyInputs(dir, opts.inputs); } catch (e) { return failed(X.REASONS.snapshot_failed, { detail: e.message, ...none }); }
  const inputMatches = ins.labels.flatMap((l) => scanEntry(l.dest, fs.lstatSync(l.dest), l.label, false));
  const al = AL.evaluate({
    root: primaryRoot, commitSha: cl.commit, gateKind, matches: scan.matches, tracked: scan.tracked, approvals,
    extra: [{ side: 'base', matches: baseMatches }, { side: 'input', matches: inputMatches }],
  });
  const report = allowlistReport(al);
  const counts = { files_scanned: scan.files_scanned, base_files_scanned: base_.blobs.length, inputs_scanned: ins.labels.length };
  if (al.fail) return failed(al.fail.reason, { reason_detail: al.fail.reason_detail || null, detail: al.fail.detail || null, ...counts, ...report });
  if (al.uncovered.length) {
    return failed(X.REASONS.secret_in_snapshot, { secret_pattern: al.uncovered[0].pattern, secret_side: al.uncovered[0].side || 'head', reason_detail: al.unresolved ? X.ALLOWLIST_DETAILS.anchor_unresolved : null, ...counts, ...report });
  }
  // FR-030 (e): gitleaks hits are never allowlisted — tree, base blobs and inputs alike.
  const gl = gitleaksScan(dir);
  const glBase = gitleaksBlobs([...base_.blobs, ...scan.missingBlobs]); // stripped HEAD blobs too
  const glIn = ins.labels.length ? gitleaksScan(ins.inputsDir) : { hit: false };
  if (gl.hit || glBase.hit || glIn.hit) return failed(X.REASONS.secret_in_snapshot, { secret_pattern: 'gitleaks', reason_detail: 'gitleaks', ...counts, ...report });
  // Detective TOCTOU anchor: the diff the runner will hash, hashed now.
  let diffSha = null;
  if (cl.base !== null) {
    const d = runnerLikeGit(dir, ['diff', '--no-ext-diff', '--no-textconv', '--binary', cl.base, '--']);
    if (d.status !== 0) return failed(X.REASONS.snapshot_failed, { detail: `diff --binary: ${tail(String(d.stderr))}`, ...none });
    diffSha = C.sha256(d.stdout);
    fs.writeFileSync(path.join(ins.inputsDir, DIFF_SHA_FILE), `${diffSha}\n`, { mode: FILE_MODE });
  }
  return {
    ok: true, snapshot: dir, commit: cl.commit, base: cl.base, depth: cl.depth, ...counts,
    files_skipped: 0, repo_local_removed: cl.repo_local_removed, gitleaks: gl.available,
    inputs: ins.copies, diff_sha256: diffSha, ...report,
  };
}

/** The input-copy hashes `snapshot()` recorded next to the snapshot, or null. */
function storedInputHashes(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(`${dir}${INPUTS_SUFFIX}`, INPUTS_RECORD_FILE), 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch (_e) { return null; }
}

/** The diff hash `snapshot()` stored next to the snapshot, or null. */
function storedDiffSha(dir) {
  try { return fs.readFileSync(path.join(`${dir}${INPUTS_SUFFIX}`, DIFF_SHA_FILE), 'utf8').trim(); } catch (_e) { return null; }
}

function removeSnapshotDirs(dir) {
  removeDir(dir);
  removeDir(`${dir}${INPUTS_SUFFIX}`);
}

/** Remove one snapshot; only a direct `snap-*` child of the snapshots root qualifies. */
function cleanupSnapshot(dir) {
  const root = path.resolve(X.snapshotsDir());
  const target = path.resolve(dir);
  const rel = path.relative(root, target);
  const lexical = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep);
  // A resumed snapshot carries the runner's realpath (runner.py resolves --repo):
  // /private/var/… for a root spelled /var/… — same directory, other spelling.
  let realParent = false;
  try { realParent = fs.realpathSync(path.dirname(target)) === fs.realpathSync(root); } catch (_e) { realParent = false; }
  if (!(lexical || realParent) || !path.basename(target).startsWith(SNAP_PREFIX)) {
    throw C.inputError(`${target} is not a snapshot under ${root}; refusing to remove it`, 'not_a_snapshot');
  }
  if (fs.existsSync(target) && !realParent) {
    throw C.inputError(`${target} does not resolve under ${root}; refusing to remove it`, 'not_a_snapshot');
  }
  removeSnapshotDirs(target);
  return target;
}

// ---------- CLI ----------

// Usage errors are thrown as typed A1_INPUT errors; the facade prints `error: …` and exits 2.
const usage = (msg) => C.usageThrow('snapshot', msg);

function cmdXprovSnapshot(args) {
  const flags = parseFlags(args, { repo: 'str', commit: 'str', base: 'str', remove: 'str', plan: 'str', feedback: 'str' });
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
  const top = C.gitOut(['rev-parse', '--show-toplevel']); // FR-030 (b): the primary checkout is the cwd's
  const primaryRoot = top === null ? repo : top.trim();
  // Wave 7: the inputs `xprov run` will send are copied and scanned here.
  const label = (p) => { const rel = path.relative(primaryRoot, path.resolve(p)); return rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(p) : rel; };
  const inputs = [];
  for (const key of ['plan', 'feedback']) {
    if (flags[key] === undefined) continue;
    if (!fs.existsSync(String(flags[key]))) usage(`--${key} not found: ${flags[key]}`);
    inputs.push({ key, source: path.resolve(String(flags[key])), label: label(String(flags[key])) });
  }
  const r = snapshot({ sourceRepo: repo, commit: flags.commit, base: flags.base, primaryRoot, inputs });
  if (!r.ok) {
    process.stderr.write(`xprov snapshot: ${r.reason}${r.reason_detail ? `/${r.reason_detail}` : ''}${r.secret_pattern ? ` (pattern ${r.secret_pattern})` : ''}${r.detail ? ` — ${r.detail}` : ''}\n`);
    for (const u of r.uncovered || []) process.stderr.write(`  uncovered: ${u.path} · ${u.pattern}\n`);
  }
  if (r.allowlist_note) process.stderr.write(`xprov snapshot: allowlist: ${r.allowlist_note}\n`);
  for (const s of r.allowlist_stale || []) process.stderr.write(`xprov snapshot: allowlist_stale: ${s.path} · ${s.pattern}\n`);
  writeStdoutSync(`${JSON.stringify(r, null, 2)}\n`);
  process.exitCode = r.ok ? X.EXIT_PASS : X.EXIT_FAIL;
}

module.exports = {
  snapshot, cloneSnapshot, cleanupSnapshot, removeDir, scanTrackedFiles, utf16Mode, gitleaksScan, ensureSnapshotsRoot, cmdXprovSnapshot,
  SNAP_PREFIX, REPO_LOCAL_STRIP, GITLEAKS_CONFIG, REF_RE, LINE_MAX_CHARS, LINE_CONTEXT_CHARS,
  INPUTS_SUFFIX, INPUT_FILES, storedDiffSha, storedInputHashes, snapshotPathProblem,
};
