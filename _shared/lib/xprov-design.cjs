'use strict';

// ---------------------------------------------------------------------------
// xprov-design — the design-file review of spec 025 (gate `design-review-xprov`, W5).
//
//   DESIGN_FILE_GLOBS         the one constant: which repo paths a design review may name
//   resolveDoc(root, doc)     --doc validation: repo-relative, no `..`, matches the globs, a regular file, and its REALPATH stays inside the
//                             repo and still matches the globs (a symlink cannot smuggle another file in) → { rel, abs, bytes }; A1_INPUT otherwise
//   bodyHash(text)            sha256 of the body: leading `---` frontmatter removed, then whitespace normalized with xprov-delta's canonical()
//   findPass(root, doc, hash) a valid pass of exactly this doc body in ANY phase's xreview/index.json (read-only), or null
//   docScope(rel)             the file-name scope of a doc's findings files (`design-<slug>-<8 hex>`)
//   pathsIn(text)             backtick-quoted path candidates (moved verbatim out of the deleted xprov-placement.cjs in W4)
//
// Pure apart from the reads named above; request-scoped, no module-level state.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const C = require('./xprov-common.cjs');
const RR = require('./xprov-runrecord.cjs');
const DL = require('./xprov-delta.cjs');
const X = require('./xprov.cjs');
const { matchesGlob } = require('./segment-glob.cjs');

const DESIGN_FILE_GLOBS = Object.freeze(['docs/adr/**', 'docs/architecture/**']);
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const MAX_DOC_PATH_CHARS = 300;
const SCOPE_SLUG_MAX = 60;
const FRONTMATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

const inGlobs = (rel) => DESIGN_FILE_GLOBS.some((g) => matchesGlob(g, rel));

/** The text without a leading `---` … `---` frontmatter block. */
const stripFrontmatter = (text) => String(text).replace(FRONTMATTER_RE, '');

/** sha256 of the body in comparison form: frontmatter and line-edge whitespace never change it, a word does. */
function bodyHash(text) {
  return C.sha256(Buffer.from(DL.canonical(stripFrontmatter(text)), 'utf8'));
}

function shapeProblem(doc) {
  if (typeof doc !== 'string' || doc.trim() === '') return '--doc <repo-relative path> is required';
  if (doc.length > MAX_DOC_PATH_CHARS || /[\x00-\x1f\x7f]/.test(doc)) return '--doc must be a short single-line path';
  if (path.isAbsolute(doc) || /^[A-Za-z]:[\\/]/.test(doc) || doc.startsWith('\\') ) return '--doc must be repo-relative, not absolute';
  if (doc.split(/[\\/]/).includes('..')) return '--doc must not contain ..';
  if (!inGlobs(doc)) return `--doc must match ${DESIGN_FILE_GLOBS.join(' or ')}`;
  return null;
}

/** Validates --doc against the repo `root`. Returns { rel, abs, bytes } (abs = the realpath that is read and snapshotted) or throws A1_INPUT. */
function resolveDoc(root, doc) {
  const bad = shapeProblem(doc);
  if (bad) throw C.inputError(bad, 'bad_doc');
  const rel = path.posix.normalize(doc.replace(/\\/g, '/'));
  let realRoot;
  let real;
  try { realRoot = fs.realpathSync(root); real = fs.realpathSync(path.join(realRoot, rel)); } catch (_e) { throw C.inputError(`--doc ${rel} does not exist`, 'bad_doc'); }
  const back = path.relative(realRoot, real);
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) throw C.inputError(`--doc ${rel} resolves outside the repository`, 'bad_doc');
  const realRel = back.split(path.sep).join('/');
  if (!inGlobs(realRel)) throw C.inputError(`--doc ${rel} resolves to ${realRel}, outside ${DESIGN_FILE_GLOBS.join(' or ')}`, 'bad_doc');
  const bytes = C.readNoFollow(real, MAX_DOC_BYTES);
  if (bytes === null) throw C.inputError(`--doc ${rel} is not a readable regular file of at most ${MAX_DOC_BYTES} bytes`, 'bad_doc');
  return Object.freeze({ rel, abs: real, bytes });
}

/** Findings-file scope of one doc: readable slug + 8 hex of the path hash (two docs never share a round key). */
function docScope(rel) {
  const slug = String(rel).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SCOPE_SLUG_MAX);
  return `design-${slug}-${C.sha256(Buffer.from(String(rel), 'utf8')).slice(0, 8)}`;
}

/** The phase names under .a1/phases (real directories only; a symlinked phase is not followed). */
function phaseNames(root) {
  const dir = path.join(root, '.a1', 'phases');
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_e) { return []; }
}

/**
 * The newest pass for exactly this doc body in any phase's xreview/index.json: gate, doc and doc_body_sha256 match, verdict pass, not a waiver,
 * and the run dir behind it still proves an APPROVED review (the same proof the plan reuse needs). → the index entry or null.
 */
function findPass(root, doc, hash) {
  const hits = [];
  for (const name of phaseNames(root)) {
    const index = C.readIndex(path.join(root, '.a1', 'phases', name, 'xreview', 'index.json'));
    if (index === null) continue;
    for (const e of index) {
      if (e.gate === X.GATE_IDS.DESIGN_REVIEW && e.doc === doc && e.doc_body_sha256 === hash && e.verdict === X.VERDICTS.PASS && e.waived !== true
        && typeof e.result_path === 'string' && typeof e.plan_sha256 === 'string' && RR.planPassValid(e.result_path, e.plan_sha256, root)) hits.push(e);
    }
  }
  hits.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  return hits.length ? hits[hits.length - 1] : null;
}

const BACKTICK_RE = /`([^`\n]+)`/g;
// a path token has no whitespace and none of the shell-active characters `$ ( ) ; | & < > " '`
const PATH_SHAPE_RE = /^[^\s$();|&<>"']+$/;
const EXT_RE = /\.[A-Za-z0-9]{1,8}$/;

/** Backtick-quoted path candidates of a text. Hostile spans (spaces, `$(…)`, `;`) are inert text and are skipped. */
function pathsIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(BACKTICK_RE)) {
    const t = m[1].trim();
    if (t === '' || !PATH_SHAPE_RE.test(t)) continue;
    if (t.includes('/') || EXT_RE.test(t)) out.add(t);
  }
  return [...out];
}

module.exports = { DESIGN_FILE_GLOBS, stripFrontmatter, bodyHash, resolveDoc, docScope, findPass, pathsIn };
