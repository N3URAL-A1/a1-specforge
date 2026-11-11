'use strict';

// ---------------------------------------------------------------------------
// xprov-design — the design-file review of spec 025 (gate `design-review-xprov`, W5).
//
//   DESIGN_FILE_GLOBS         the one constant: which repo paths a design review may name
//   resolveDoc(root, doc)     --doc validation: repo-relative, no `..`, matches the globs, a regular file, and its REALPATH stays inside the
//                             repo and still matches the globs (a symlink cannot smuggle another file in) → { rel, abs, bytes }; A1_INPUT otherwise
//   bodyHash(text)            sha256 of the body: leading `---` frontmatter removed, then whitespace normalized with xprov-delta's canonical()
//   findPass(root, doc, hash) a valid pass of exactly this doc body in ANY phase's xreview/index.json (read-only), or null
//   findRecorded(root, doc, hash) the newest valid pass OR fail-with-findings of exactly this body in any phase (FR-014), or null
//   readPinned(real, lstat, max, io) the file bytes read through one O_NOFOLLOW descriptor whose dev/ino match the checked lstat (SEC-4)
//   docScope(rel)             the file-name scope of a doc's findings files (`design-<slug>-<8 hex>`)
//   pathsIn(text)             backtick-quoted path candidates (moved verbatim out of the deleted xprov-placement.cjs in W4)
//   designTargets(root, o)    W7 selection: the design files a review still owes — plan mode (named in PLAN.md) or base mode (changed in a
//                             range), minus those with a recorded pass on the current body (a recorded REVISE stays a target: the gate answers it from the record) → { targets, skipped }
//   cmdXprovDesignTargets     `xprov design-targets` (not a gate: no registry row, read-only)
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
const MAX_FRONTMATTER_BYTES = 4 * 1024; // SEC-4: a longer leading block is body
// SEC-3: a frontmatter line is blank or `key: scalar` with a short single-line value. No comment, list item, indented continuation or block
// scalar (`|`, `>`): prose moved into any of those shapes would stay out of the body hash and an old result would be reused.
const MAX_FRONTMATTER_VALUE_CHARS = 200;
const FRONTMATTER_LINE_RE = /^(?:[ \t]*|[A-Za-z_][\w.-]*[ \t]*:(?:[ \t].*)?)$/;
const isMetadataLine = (l) => {
  if (!FRONTMATTER_LINE_RE.test(l)) return false;
  const v = l.slice(l.indexOf(':') + 1).trim();
  return l.indexOf(':') === -1 || (v.length <= MAX_FRONTMATTER_VALUE_CHARS && !/^[|>]/.test(v));
};

const inGlobs = (rel) => DESIGN_FILE_GLOBS.some((g) => matchesGlob(g, rel));

/** The text without a leading `---` … `---` frontmatter block — only a short block of `key: scalar` lines counts (SEC-3/SEC-4); anything else is body. */
function stripFrontmatter(text) {
  const t = String(text);
  const m = FRONTMATTER_RE.exec(t);
  if (m === null || Buffer.byteLength(m[0], 'utf8') > MAX_FRONTMATTER_BYTES) return t;
  const inner = m[0].replace(/\r?\n$/, '').split(/\r?\n/).slice(1, -1); // between the two `---` lines
  return inner.every(isMetadataLine) ? t.slice(m[0].length) : t;
}

/** sha256 of the body in comparison form: frontmatter and line-edge whitespace never change it, a word does. */
function bodyHash(text) {
  return C.sha256(Buffer.from(DL.canonical(stripFrontmatter(text)), 'utf8'));
}

function shapeProblem(doc) {
  if (typeof doc !== 'string' || doc.trim() === '') return '--doc <repo-relative path> is required';
  if (doc.length > MAX_DOC_PATH_CHARS || /[\x00-\x1f\x7f]/.test(doc)) return '--doc must be a short single-line path';
  if (path.isAbsolute(doc) || /^[A-Za-z]:[\\/]/.test(doc) || doc.startsWith('\\') ) return '--doc must be repo-relative, not absolute';
  if (doc.split(/[\\/]/).includes('..')) return '--doc must not contain ..';
  if (doc !== doc.trim()) return '--doc must not have leading or trailing whitespace';
  if (doc.split(/[\\/]/).some((seg) => seg === '.' || seg === '')) return '--doc must be written canonically (no ./ segment, no //, no trailing /)';
  if (!inGlobs(doc)) return `--doc must match ${DESIGN_FILE_GLOBS.join(' or ')}`;
  return null;
}

/**
 * SEC-4: the bytes of `real`, read through ONE descriptor opened with O_NOFOLLOW (last component only) whose dev/ino must equal the lstat `before` taken
 * on the checked realpath: a file or directory swapped between the checks and the open shows as a mismatch → null. `io` is a seam for the unit case.
 */
function readPinned(real, before, maxBytes, io) {
  const f = io || fs;
  let fd;
  try { fd = f.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch (_e) { return null; }
  try {
    const st = f.fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes || st.dev !== before.dev || st.ino !== before.ino) return null;
    return f.readFileSync(fd);
  } catch (_e) { return null; } finally { try { f.closeSync(fd); } catch (_e) { /* nothing left to release */ } }
}

/** Validates --doc against the repo `root`. Returns { rel, abs, bytes } (abs = the realpath that is read and snapshotted) or throws A1_INPUT. */
function resolveDoc(root, doc) {
  const bad = shapeProblem(doc);
  if (bad) throw C.inputError(bad, 'bad_doc');
  const spelled = doc.replace(/\\/g, '/');
  let realRoot;
  let real;
  try { realRoot = fs.realpathSync(root); real = fs.realpathSync(path.join(realRoot, spelled)); } catch (_e) { throw C.inputError(`--doc ${spelled} does not exist`, 'bad_doc'); }
  const back = path.relative(realRoot, real);
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) throw C.inputError(`--doc ${spelled} resolves outside the repository`, 'bad_doc');
  const realRel = back.split(path.sep).join('/');
  if (!inGlobs(realRel)) throw C.inputError(`--doc ${spelled} resolves to ${realRel}, outside ${DESIGN_FILE_GLOBS.join(' or ')}`, 'bad_doc');
  const st = fs.lstatSync(real);
  if (st.nlink > 1) throw C.inputError(`--doc ${realRel} has ${st.nlink} hard links; a hard link may point at a file outside the repository`, 'bad_doc');
  const bytes = readPinned(real, st, MAX_DOC_BYTES);
  if (bytes === null) throw C.inputError(`--doc ${realRel} is not a readable regular file of at most ${MAX_DOC_BYTES} bytes, or it changed while it was opened`, 'bad_doc');
  return Object.freeze({ rel: realRel, abs: real, bytes }); // the reuse key is the realpath-relative form (SEC-5)
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

/** The index entries of every phase that record `doc` at body hash `hash` for the design gate, with their phase name (read-only). */
function recordedEntries(root, doc, hash) {
  const out = [];
  for (const name of phaseNames(root)) {
    const index = C.readIndex(path.join(root, '.a1', 'phases', name, 'xreview', 'index.json'));
    if (index === null) continue;
    for (const e of index) {
      if (e.gate === X.GATE_IDS.DESIGN_REVIEW && e.doc === doc && e.doc_body_sha256 === hash && e.waived !== true && typeof e.result_path === 'string' && typeof e.plan_sha256 === 'string') out.push({ e, phase: name });
    }
  }
  return out.sort((a, b) => String(a.e.ts || '').localeCompare(String(b.e.ts || '')));
}

/**
 * The newest pass for exactly this doc body in any phase's xreview/index.json: gate, doc and doc_body_sha256 match, verdict pass, not a waiver,
 * and the run dir behind it still proves an APPROVED review (the same proof the plan reuse needs). → the index entry or null.
 */
function findPass(root, doc, hash) {
  const hits = recordedEntries(root, doc, hash).filter(({ e }) => e.verdict === X.VERDICTS.PASS
    && RR.planPassValid(e.result_path, e.plan_sha256, root, X.GATE_IDS.DESIGN_REVIEW) && passBoundToDoc(e.result_path, e.plan_sha256, doc, hash));
  return hits.length ? hits[hits.length - 1].e : null;
}

/**
 * The run dir behind a fail-with-findings row proves a completed Codex REVISE of exactly this doc body: run record (completed, review, REVISE, the row's
 * plan sha), the kept copy of the reviewed text (hashes to that sha and to the body hash), and the run-dir findings record (hashes to findings_sha256).
 */
function failBoundToDoc(e, hash, root) {
  const rec = RR.runRecord(e.result_path, root);
  if (!C.isPlainObject(rec) || rec.status !== 'completed' || rec.mode !== 'review' || rec.plan_sha256 !== e.plan_sha256
    || !C.isPlainObject(rec.response) || rec.response.verdict !== 'REVISE') return false;
  const runDir = path.dirname(path.resolve(e.result_path));
  const copy = C.readNoFollow(path.join(runDir, RR.DOC_COPY_FILE), MAX_DOC_BYTES);
  return copy !== null && C.sha256(copy) === e.plan_sha256 && bodyHash(copy.toString('utf8')) === hash && RR.verifiedFindings(runDir, e.findings_sha256) !== null;
}

const FINDING_BUCKETS = Object.freeze(['blocker', 'major', 'minor']);

/** The xreview findings copy and the run-dir record say the same: same summary and the same three finding lists (their bytes differ by design). */
function sameFindings(copy, record) {
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  return C.isPlainObject(copy) && C.isPlainObject(record) && same(copy.summary, record.summary) && FINDING_BUCKETS.every((k) => same(copy[k], record[k]));
}

/**
 * Where the findings of a recorded REVISE live: the xreview copy (`<gate>-<scope>-r<round>.findings.json`) when the row has an integer round >= 1 and the
 * copy matches the run-dir record, else the run-dir record itself (failBoundToDoc has already proved its sha256). null when neither file is readable.
 */
function findingsPathOf(root, phase, doc, e) {
  const runDir = path.dirname(path.resolve(e.result_path));
  const record = path.join(runDir, RR.FINDINGS_FILE);
  const parse = (file) => { const b = C.readNoFollow(file, MAX_DOC_BYTES); try { return b === null ? null : JSON.parse(b.toString('utf8')); } catch (_e) { return null; } };
  if (Number.isInteger(e.round) && e.round >= 1) {
    const copy = path.join(root, '.a1', 'phases', phase, 'xreview', `${X.GATE_IDS.DESIGN_REVIEW}-${docScope(doc)}-r${e.round}.findings.json`);
    if (sameFindings(parse(copy), parse(record))) return copy;
  }
  return fs.existsSync(record) ? record : null;
}

/**
 * spec 025 FR-014 (at most one Codex run per document state): the newest recorded REAL Codex verdict — pass or fail-with-findings — for exactly this doc
 * body in any phase. Outcomes that are not a verdict (not_applicable, preflight/runner failures, tripwire, secret hits) are never reused: they retry.
 * → { kind: 'pass'|'fail-with-findings', entry, findings_path } or null (findings_path is null for a pass).
 */
function findRecorded(root, doc, hash) {
  const hits = recordedEntries(root, doc, hash).map(({ e, phase }) => {
    if (e.verdict === X.VERDICTS.PASS) {
      return RR.planPassValid(e.result_path, e.plan_sha256, root, X.GATE_IDS.DESIGN_REVIEW) && passBoundToDoc(e.result_path, e.plan_sha256, doc, hash) ? { kind: 'pass', entry: e, findings_path: null } : null;
    }
    if (e.verdict !== X.VERDICTS.FAIL_WITH_FINDINGS || !failBoundToDoc(e, hash, root)) return null;
    return { kind: 'fail-with-findings', entry: e, findings_path: findingsPathOf(root, phase, doc, e) };
  }).filter((h) => h !== null);
  return hits.length ? hits[hits.length - 1] : null;
}

/**
 * SEC-1: the index row is only a pointer; the run dir must prove WHICH text was approved. a1's pass marker names the doc and its body hash, and
 * the approved text kept next to it hashes to the run's plan_sha256 and to the body hash the caller looks for.
 */
function passBoundToDoc(resultPath, planSha, doc, hash) {
  const runDir = path.dirname(path.resolve(resultPath));
  const marker = RR.readJsonNoFollow(path.join(runDir, RR.PASS_MARKER_FILE));
  if (marker === null || marker.gate !== X.GATE_IDS.DESIGN_REVIEW || marker.doc !== doc || marker.doc_body_sha256 !== hash) return false;
  const copy = C.readNoFollow(path.join(runDir, RR.DOC_COPY_FILE), MAX_DOC_BYTES);
  return copy !== null && C.sha256(copy) === planSha && bodyHash(copy.toString('utf8')) === hash;
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

const MAX_CANDIDATES = 500; // design-file candidates one call looks at
const MAX_PLAN_BYTES = 4 * 1024 * 1024;
const MAX_DIFF_PATHS = 20000;
const REV_RE = /^(?:[0-9a-fA-F]{4,64}|HEAD)$/; // a commit sha or HEAD: never option-shaped (git would take `--output=<file>` as an option)

/** Plan mode candidates: the path tokens PLAN.md names. Nothing else — never a scan of docs/adr/. */
function planCandidates(planText) {
  return pathsIn(planText);
}

/** Base mode candidates: the paths `git diff --name-only <base> <head>` reports (argv array, no shell). */
function rangeCandidates(root, base, head) {
  for (const [flag, rev] of [['--base', base], ['--head', head]]) {
    if (!REV_RE.test(String(rev))) throw C.inputError(`${flag} must be a commit sha (4-64 hex digits) or HEAD, got ${JSON.stringify(C.clip(rev, 80))}`, 'bad_rev');
  }
  const r = C.gitSpawn(['-C', root, 'diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', base, head, '--'], { env: C.pinnedGitEnv(null) });
  if (r.status !== 0) throw C.inputError(`git diff ${C.clip(base, 20)} ${C.clip(head, 20)} failed: ${C.clip(r.stderr, 200)}`, 'diff_failed');
  const names = r.stdout.split('\0').filter((n) => n !== '');
  if (names.length > MAX_DIFF_PATHS) throw C.inputError(`more than ${MAX_DIFF_PATHS} changed paths`, 'too_many_paths');
  return names;
}

/**
 * The design files a review still owes. `candidates` are repo-relative path strings; only those matching DESIGN_FILE_GLOBS are looked at
 * (code and hostile tokens are never mentioned). Each is validated like `gate --doc` (realpath inside the repo and the globs) and deduplicated by
 * its realpath-relative form; one with a pass on the current body hash is skipped. → { targets: [rel…], skipped: [{path, reason}] }.
 */
function designTargets(root, candidates) {
  const wanted = candidates.filter(inGlobs);
  if (wanted.length > MAX_CANDIDATES) throw C.inputError(`more than ${MAX_CANDIDATES} design-file candidates`, 'too_many_paths');
  const targets = [];
  const skipped = [];
  const seen = new Set();
  for (const cand of wanted) {
    let doc;
    try { doc = resolveDoc(root, cand); } catch (e) {
      if (e && e.code === 'A1_INPUT') { skipped.push(Object.freeze({ path: cand, reason: 'invalid_doc' })); continue; }
      throw e;
    }
    if (seen.has(doc.rel)) continue;
    seen.add(doc.rel);
    const rec = findRecorded(root, doc.rel, bodyHash(doc.bytes.toString('utf8')));
    // only a pass is skipped: a recorded REVISE stays a target, so the gate is called and answers from the record (0 runner calls) with its warning and findings path
    if (rec !== null && rec.kind === 'pass') skipped.push(Object.freeze({ path: doc.rel, reason: 'pass_recorded' }));
    else targets.push(doc.rel);
  }
  return Object.freeze({ targets, skipped });
}

function selectionMode(f) {
  const plan = f.plan !== undefined;
  const range = f.base !== undefined;
  if (plan === range) throw C.inputError('design-targets requires exactly one of --plan <PLAN.md> or --base <sha> [--head <sha>]', 'bad_mode');
  if (plan && f.head !== undefined) throw C.inputError('--head belongs to --base mode', 'bad_mode');
  return plan ? 'plan' : 'range';
}

/**
 * `xprov design-targets --phase <p> (--plan <PLAN.md> | --base <sha> [--head <sha>])` — stdout JSON {targets, skipped}, exit 0; usage errors exit 2.
 * `--phase` is validated and otherwise unused: it is accepted for symmetry with `gate`. The recorded-verdict lookup deliberately spans EVERY phase (a W5
 * decision: an unchanged ADR is not re-sent because a later phase touches it again), so restricting it to this phase would weaken FR-014.
 */
function cmdXprovDesignTargets(args) {
  const { parseFlags, repoRoot, assertSafeSegment } = require('./io.cjs');
  try {
    const f = parseFlags(args || [], { phase: 'str', plan: 'str', base: 'str', head: 'str' });
    if (f._.length) throw C.inputError(`unexpected argument ${JSON.stringify(C.clip(f._[0], 80))}`);
    if (typeof f.phase !== 'string' || f.phase === '') throw C.inputError('design-targets requires --phase <name>');
    C.rejectReservedPhase(assertSafeSegment(f.phase, '--phase'));
    const mode = selectionMode(f);
    const root = repoRoot();
    let candidates;
    if (mode === 'plan') {
      const bytes = typeof f.plan === 'string' && f.plan !== '' ? C.readNoFollow(path.resolve(f.plan), MAX_PLAN_BYTES) : null;
      if (bytes === null) throw C.inputError(`--plan is not a readable regular file of at most ${MAX_PLAN_BYTES} bytes: ${JSON.stringify(C.clip(f.plan, 120))}`);
      candidates = planCandidates(bytes.toString('utf8'));
    } else {
      candidates = rangeCandidates(root, f.base, f.head === undefined ? 'HEAD' : f.head);
    }
    return C.emitJson(designTargets(root, candidates), X.EXIT_PASS, true);
  } catch (e) {
    if (e && e.code === 'A1_INPUT') return C.usageExit('design-targets', e.message);
    throw e;
  }
}

module.exports = { DESIGN_FILE_GLOBS, stripFrontmatter, bodyHash, resolveDoc, readPinned, docScope, findPass, findRecorded, pathsIn, designTargets, cmdXprovDesignTargets };
