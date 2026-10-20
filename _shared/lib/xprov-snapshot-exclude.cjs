'use strict';

// ---------------------------------------------------------------------------
// xprov-snapshot-exclude — secret hits in files the wave did not change (spec 016 FR-029, wave 9).
//
// A secret hit in a file the reviewed diff does not touch must not stop a review: the reviewer never
// needed that file. The snapshot is cloned again WITHOUT it and scanned again. A hit in a changed file,
// in the base side, in an input copy, in a path name or one a1 cannot place stays a hard stop (the owner
// is asked in chat whether to allowlist it).
//
//   classify(hits, ctx)      -> { excludable: [{path, rule}], changed: [{path, rule, side}] }
//   excludeFromClone(dir, p) -> { ok, excluded } | { ok: false, detail }   the file leaves the work tree AND the object store
//   hitsRecordFor(...)       -> the record `xprov consent question --kind allowlist --scan <snap>` reads
//
// Exclusion rules (conservative, per FILE, not per line): a head-side hit whose path is not in the changed
// set and not an input label is excludable; everything else counts as a changed-line hit. Only paths and
// rule ids are ever carried — never the matched value.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./xprov-common.cjs');
const H = require('./xprov-consent-hits.cjs');

const MAX_EXCLUDED = 50;
const GIT_TIMEOUT_MS = 120000;

/** One hit as { path, rule, side } (side `head` | `base` | `input` | `path` | `blob`). */
const hit = (p, rule, side) => Object.freeze({ path: p, rule, side });

/**
 * Split the hits of a failed scan. `ctx`: { changed: Set<string> (paths of the diff), inputs: Set<string> (input labels),
 * tracked: Set<string> (paths git tracks in the snapshot), canExclude: boolean }.
 * Returns { excludable, changed } — `excludable` is empty unless every hit is excludable (one changed hit stops the whole run).
 */
function classify(hits, ctx) {
  const excludable = [];
  const changed = [];
  const seen = new Set();
  for (const h of hits) {
    const key = `${h.side}\t${h.path}\t${h.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const safe = h.side === 'head' && ctx.canExclude && ctx.tracked.has(h.path) && H.plainRelPath(h.path)
      && !ctx.changed.has(h.path) && !ctx.inputs.has(h.path);
    (safe ? excludable : changed).push(h);
  }
  const all = changed.length === 0 && excludable.length > 0 && excludable.length <= MAX_EXCLUDED;
  return Object.freeze({
    excludable: all ? Object.freeze(excludable.map((h) => Object.freeze({ path: h.path, rule: h.rule }))) : Object.freeze([]),
    changed: Object.freeze(all ? [] : [...changed, ...excludable].map((h) => hit(h.path, h.rule, h.side || 'head'))),
  });
}

const gitRun = (dir, args, input) => spawnSync(C.gitBin(), ['-C', dir, ...args], {
  env: C.pinnedGitEnv(null, dir), maxBuffer: C.GIT_MAX_BUFFER, timeout: GIT_TIMEOUT_MS,
  input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
});

/** Blob ids (HEAD tree) of the given paths, or null when git cannot say. */
function blobIdsOf(dir, paths) {
  const ids = [];
  for (const p of paths) {
    const r = gitRun(dir, ['--literal-pathspecs', 'rev-parse', '--verify', '--quiet', `HEAD:${p}`]);
    if (r.status !== 0) return null;
    ids.push(String(r.stdout).trim());
  }
  return ids;
}

/** Rebuild the object store without `drop` (a Set of object ids): one pack of everything reachable from `roots`. */
function purgeObjects(dir, roots, drop) {
  const rp = gitRun(dir, ['repack', '-a', '-d', '-q']);
  if (rp.status !== 0) return `repack: ${C.clip(String(rp.stderr), 200)}`;
  const rl = gitRun(dir, ['rev-list', '--objects', ...roots]);
  if (rl.status !== 0) return `rev-list: ${C.clip(String(rl.stderr), 200)}`;
  const keep = String(rl.stdout).split('\n').map((l) => l.split(' ')[0]).filter((id) => id !== '' && !drop.has(id));
  const packDir = path.join(dir, '.git', 'objects', 'pack');
  const pk = gitRun(dir, ['pack-objects', '-q', path.join(packDir, 'pack')], `${keep.join('\n')}\n`);
  if (pk.status !== 0) return `pack-objects: ${C.clip(String(pk.stderr), 200)}`;
  const fresh = `pack-${String(pk.stdout).trim()}`;
  for (const name of fs.readdirSync(packDir)) {
    if (!name.startsWith(fresh)) fs.rmSync(path.join(packDir, name), { force: true });
  }
  const objects = path.join(dir, '.git', 'objects');
  for (const name of fs.readdirSync(objects)) {
    if (/^[0-9a-f]{2}$/.test(name)) fs.rmSync(path.join(objects, name), { recursive: true, force: true });
  }
  return null;
}

/**
 * Remove `paths` from a fresh snapshot clone: the work-tree file is deleted, the index entry is marked skip-worktree (so `git diff <base>`
 * and `git status` stay clean for it), and the blob is dropped from the object store so the reviewer cannot `git show` it.
 * `roots`: the commits whose objects stay (head, and base when set).
 */
function excludeFromClone(dir, paths, roots) {
  const ids = blobIdsOf(dir, paths);
  if (ids === null) return { ok: false, detail: 'exclude: a path has no blob at HEAD' };
  const flag = gitRun(dir, ['--literal-pathspecs', 'update-index', '--skip-worktree', '--', ...paths]);
  if (flag.status !== 0) return { ok: false, detail: `exclude: update-index: ${C.clip(String(flag.stderr), 200)}` };
  for (const p of paths) fs.rmSync(path.join(dir, p), { force: true });
  const problem = purgeObjects(dir, roots, new Set(ids));
  if (problem) return { ok: false, detail: `exclude: ${problem}` };
  for (const id of ids) {
    if (gitRun(dir, ['cat-file', '-e', id]).status === 0) return { ok: false, detail: 'exclude: an excluded blob is still in the object store' };
  }
  for (const r of roots) {
    if (gitRun(dir, ['cat-file', '-e', `${r}^{commit}`]).status !== 0) return { ok: false, detail: 'exclude: a reviewed commit left the object store' };
  }
  return { ok: true, excluded: Object.freeze([...paths]) };
}

/** The hits record body for the head-side hits (path, rule, line, column) of a failed scan. */
function hitsRecordFor({ basename, repoKey, commit, hits }) {
  return {
    version: 1, snapshot: basename, repo_key: repoKey, commit,
    hits: hits.map((h) => ({ path: h.path, rule: h.rule, line: h.line, column: h.column })), ts: new Date().toISOString(),
  };
}

/** The line the reviewer reads for each excluded file (Samuel W9-2): path only, never a value. */
const noteLine = (p) => `excluded (unchanged, secret hit): ${p}`;

/**
 * `inputs` (the snapshot's input list) plus the excluded-file lines in the `feedback` input, so the context Codex receives names what it did not
 * see. An existing feedback input keeps its text and gets the lines appended. → { inputs, cleanup }.
 */
function noteInputs(inputs, excluded) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-xprov-excl-'));
  fs.chmodSync(dir, 0o700);
  const lines = [...new Set(excluded.map((x) => x.path))].map(noteLine).join('\n');
  const old = (inputs || []).find((i) => i.key === 'feedback');
  const file = path.join(dir, 'feedback.md');
  fs.writeFileSync(file, `${old ? `${fs.readFileSync(old.source, 'utf8')}\n\n` : ''}${lines}\n`, { mode: 0o600 });
  const note = { key: 'feedback', source: file, label: old ? old.label : 'excluded files' };
  return { inputs: [...(inputs || []).filter((i) => i.key !== 'feedback'), note], cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

module.exports = { noteLine, noteInputs, classify, excludeFromClone, hitsRecordFor, MAX_EXCLUDED };
