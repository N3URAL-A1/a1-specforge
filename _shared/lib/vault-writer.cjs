'use strict';

// ---------------------------------------------------------------------------
// vault-writer — the per-project vault writer (spec 010-vault-cockpit-contract,
// Wave 10: FR-034 amended, FR-035 amended, FR-038..FR-043).
//
//   readWriterDeclaration  FR-038: the `a1_writer_host:` key of the hub note
//                          project/<slug>.md, read line-wise (never through the
//                          shared frontmatter parser, which truncates folded
//                          values). Every error path ends in `unreadable`,
//                          never `none`.
//   writerGateFor          FR-040: hub → A1_VAULT_WRITER_HOST (rollout aid) →
//                          undeclared, computed per slug per call, no cache.
//   notWriterSkip …        FR-034/FR-042: the skip lines and JSON entries.
//   projectNames           FR-042/FR-043: the name filter (`ignored_names`).
//   cmdVaultWriter         FR-041/FR-043: `a1-tools vault writer` (list,
//                          --set/--clear via tmp + rename after a re-read).
//
// The hub key is a coordination declaration against mirror conflicts, not an
// authorisation control; any vault writer can change it. Echo rule (FR-034):
// only values that passed their pattern reach stdout/stderr — host ids after
// normalizeHostId, slugs after PRODUCT_SLUG_RE, classes from the fixed set;
// an invalid host is `<invalid>`, a raw hub value is never printed.
// ---------------------------------------------------------------------------

const realFs = require('fs');
const os = require('os');
const path = require('path');
const { assertSafeSegment, parseFlags } = require('./io.cjs');
const { tmpPathFor, assertVaultWriteContained } = require('./fs-safe.cjs');
const {
  isConflictCopy, externalVaultRoot, rootProblem, warnSkipped, normalizeHostId, hostIdentity,
} = require('./vault-common.cjs');
const { emitJson, writeStdoutSync } = require('./xprov-common.cjs');

const WRITER_KEY = 'a1_writer_host';
const WRITER_KEY_PREFIX = `${WRITER_KEY}:`;
const WRITER_KEY_ANYWHERE_RE = /a1_writer_host/i;
const WRITER_FALLBACK_ENV = 'A1_VAULT_WRITER_HOST';
const UNDECLARED = 'undeclared';
const UNREADABLE = 'unreadable';
const BOM = '\uFEFF';
const FENCE = '---';
const CONTINUATION_RE = /^[ \t]+\S/;
const INLINE_COMMENT_RE = /(^|\s)#/;
const MANUAL_PATH = 'edit a1_writer_host: in the hub note in Obsidian';
const EXIT = Object.freeze({ ok: 0, refused: 1, usage: 2 });

// ---------- names (FR-042 / FR-043 filter) ----------

function productSlugRe() {
  return require('./product.cjs').PRODUCT_SLUG_RE; // lazy: product.cjs loads locks → vault-common
}

/** True for a name that may be treated (and printed) as a project slug. */
function isProjectName(name) {
  if (typeof name !== 'string' || isConflictCopy(name) || !productSlugRe().test(name)) return false;
  try { assertSafeSegment(name, 'project slug'); return true; } catch (_e) { return false; }
}

/** The slug for display: itself when it passed the filter, else a placeholder. */
function displaySlug(slug) {
  return isProjectName(slug) ? slug : '<unprintable slug>';
}

/** { names, ignored }: the project names under <root>/project — every hub
 * `<slug>.md` and every folder (links included) — sorted, filtered; `ignored`
 * counts the rejected names (never printed). Dot entries are not projects. */
function projectNames(root, fs = realFs) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, 'project'), { withFileTypes: true }); } catch (_e) { return { names: [], ignored: 0 }; }
  const raw = new Set();
  for (const d of entries) {
    if (d.name.startsWith('.')) continue;
    if (d.name.endsWith('.md') && !d.isDirectory()) raw.add(d.name.slice(0, -3));
    else if (d.isDirectory() || d.isSymbolicLink()) raw.add(d.name);
  }
  const all = [...raw];
  const names = all.filter(isProjectName).sort();
  return { names, ignored: all.length - names.length };
}

/** True when a sync-conflict copy of project/<slug>.md exists (FR-035). */
function hubConflict(root, slug, fs = realFs) {
  let names;
  try { names = fs.readdirSync(path.join(root, 'project')); } catch (_e) { return false; }
  return names.some((n) => n.endsWith('.md') && isConflictCopy(n)
    && (n.startsWith(`${slug} (`) || n.startsWith(`${slug}.sync-conflict-`)));
}

// ---------- the declaration (FR-038) ----------

const unreadable = (cls, bytes) => Object.freeze({ state: UNREADABLE, cls, bytes });

/** Rule 3 on the normalised text: declared | none | unreadable (class). */
function parseDeclaration(text) {
  const lines = text.split('\n');
  if (lines[0] !== FENCE) return { state: 'none' };
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) return { state: UNREADABLE, cls: 'unterminated_frontmatter' };
  const block = lines.slice(1, close);
  const at = block.map((l, i) => (l.startsWith(WRITER_KEY_PREFIX) ? i : -1)).filter((i) => i !== -1);
  if (at.length === 0) return { state: 'none' };
  if (at.length > 1) return { state: UNREADABLE, cls: 'duplicate_key' };
  const next = block.slice(at[0] + 1).find((l) => l.trim() !== ''); // YAML folds across blank lines
  if (CONTINUATION_RE.test(next || '')) return { state: UNREADABLE, cls: 'folded' };
  const value = block[at[0]].slice(WRITER_KEY_PREFIX.length).trim();
  if (value === '' || INLINE_COMMENT_RE.test(value)) return { state: UNREADABLE, cls: 'invalid_value' };
  const unquoted = /^(["']).*\1$/.test(value) && value.length >= 2 ? value.slice(1, -1) : value;
  const id = normalizeHostId(unquoted);
  return id === null ? { state: UNREADABLE, cls: 'invalid_value' } : { state: 'declared', value: id };
}

/**
 * readWriterDeclaration(root, slug, fs?) → frozen { state, value?, cls?, bytes? }
 * with state ∈ declared | none | unreadable, in the FR-038 rule order.
 * `bytes` (a Buffer) is the hub content the decision was made on, when read.
 */
function readWriterDeclaration(root, slug, fs = realFs) {
  const hub = path.join(root, 'project', `${slug}.md`);
  let st;
  try {
    st = fs.lstatSync(hub);
  } catch (e) {
    if (e.code !== 'ENOENT') return unreadable('read_error');
    try { fs.lstatSync(path.join(root, 'project', slug)); return unreadable('hub_missing'); } catch (e2) {
      return e2.code === 'ENOENT' ? Object.freeze({ state: 'none' }) : unreadable('read_error');
    }
  }
  if (st.isSymbolicLink()) return unreadable('link');
  let bytes;
  try { bytes = fs.readFileSync(hub); } catch (_e) { return unreadable('read_error'); }
  if (bytes.length === 0) return unreadable('empty', bytes);
  const raw = bytes.toString('utf8');
  const text = (raw.startsWith(BOM) ? raw.slice(1) : raw).replace(/\r\n/g, '\n');
  const parsed = parseDeclaration(text);
  if (parsed.state === 'declared') return Object.freeze({ ...parsed, bytes });
  if (parsed.state === UNREADABLE) return unreadable(parsed.cls, bytes);
  if (WRITER_KEY_ANYWHERE_RE.test(text)) return unreadable('invalid_key', bytes);
  return Object.freeze({ state: 'none', bytes });
}

// ---------- the gate (FR-039 / FR-040) ----------

/** The hub-less fallback: A1_VAULT_WRITER_HOST, validated like an id. */
function fallbackWriter(env) {
  const raw = env[WRITER_FALLBACK_ENV];
  if (typeof raw !== 'string' || raw.trim() === '') return { writerHost: UNDECLARED, writerSource: 'none' };
  const id = normalizeHostId(raw);
  return id === null
    ? { writerHost: UNREADABLE, writerSource: 'env', cls: 'invalid_value' }
    : { writerHost: id, writerSource: 'env' };
}

/**
 * writerGateFor(slug, root, env?, osHost?, fs?) → fresh frozen
 * { slug, host, hostSource, writerHost, writerSource, mayWrite, cls? }.
 * Evaluated for exactly this slug on every call — never cached (FR-040).
 */
function writerGateFor(slug, root, env = process.env, osHost = os.hostname(), fs = realFs) {
  return gateFromDeclaration(slug, readWriterDeclaration(root, slug, fs), env, osHost);
}

/** The gate for a declaration already read (`vault writer --set` decides and
 * later re-compares on the SAME bytes, FR-041). */
function gateFromDeclaration(slug, decl, env = process.env, osHost = os.hostname()) {
  const id = hostIdentity(env, osHost);
  const writer = decl.state === 'declared' ? { writerHost: decl.value, writerSource: 'hub' }
    : decl.state === UNREADABLE ? { writerHost: UNREADABLE, writerSource: 'hub', cls: decl.cls }
      : fallbackWriter(env);
  // Decided on the SOURCE, never on the value: only `none` is open to every
  // host, and a declaration with a class is unreadable (fail-closed).
  const mayWrite = writer.writerSource === 'none'
    || (!writer.cls && id.source !== 'invalid' && id.host === writer.writerHost);
  return Object.freeze({ slug, host: id.host, hostSource: id.source, ...writer, mayWrite });
}

/** The FR-034 reason for a gate that refuses (null when it may write). */
function notWriterReason(gate) {
  if (gate.mayWrite) return null;
  const slug = displaySlug(gate.slug);
  if (gate.cls && gate.writerSource === 'env') {
    return `fallback writer of ${slug} unreadable: ${WRITER_FALLBACK_ENV} is not a valid host id`;
  }
  if (gate.cls) {
    return `writer declaration of ${slug} unreadable (${gate.cls}) — create or repair project/${slug}.md`;
  }
  return `this host is not the vault writer of ${slug} (${gate.host} ≠ ${gate.writerHost})`;
}

/** null when the gate may write; else prints `[a1-tools] <what> skipped: <reason>`
 * and returns the reason. */
function notWriterSkip(what, gate) {
  const reason = notWriterReason(gate);
  if (reason) warnSkipped(what, reason);
  return reason;
}

/** FR-042 per-project skip: one stderr line, one `skipped_projects` entry. */
function skippedProject(command, gate) {
  process.stderr.write(`[a1-tools] ${command} skipped for ${displaySlug(gate.slug)}: ${notWriterReason(gate)}\n`);
  return Object.freeze({
    slug: gate.slug,
    reason: gate.cls ? 'writer-unreadable' : 'not-writer',
    writer_host: gate.writerHost,
  });
}

/** The FR-035 / FR-043 fields of one gate, in JSON spelling. */
function gateFields(gate, root) {
  return {
    host: gate.host,
    host_source: gate.hostSource,
    writer_host: gate.writerHost,
    writer_source: gate.writerSource,
    ...(gate.cls ? { writer_class: gate.cls } : {}),
    may_write: gate.mayWrite,
    hub_conflict: hubConflict(root, gate.slug),
  };
}

// ---------- `a1-tools vault writer` (FR-041 / FR-043) ----------

const WRITER_FLAGS = Object.freeze({ set: 'value', clear: 'bool', 'dry-run': 'bool', json: 'bool' });

/** A refusal of the command: message for stderr, exit code. Never echoes raw input. */
const refusal = (code, message) => ({ code, message });

/** FR-043 row for one project; `writer_class` only for an unreadable declaration. */
function listRow(root, slug, env, osHost) {
  const gate = writerGateFor(slug, root, env, osHost);
  return {
    slug, writer_host: gate.writerHost, writer_source: gate.writerSource,
    ...(gate.cls ? { writer_class: gate.cls } : {}),
    may_write: gate.mayWrite, hub_conflict: hubConflict(root, slug),
  };
}

/** `vault writer` without a slug: read-only overview of every hub and hubless folder. */
function listWriters(root, env = process.env, osHost = os.hostname()) {
  const id = hostIdentity(env, osHost);
  const { names, ignored } = projectNames(root);
  return { host: id.host, host_source: id.source, projects: names.map((n) => listRow(root, n, env, osHost)), ignored_names: ignored };
}

/** Every id some hub declares, besides `except` — plus the rollout aid and this host (typo guard, FR-041). */
function knownWriterIds(root, except, env, osHost) {
  const ids = new Set(projectNames(root).names.filter((n) => n !== except)
    .map((n) => readWriterDeclaration(root, n)).filter((d) => d.state === 'declared').map((d) => d.value));
  const fallback = normalizeHostId(env[WRITER_FALLBACK_ENV] || '');
  if (fallback) ids.add(fallback);
  const own = hostIdentity(env, osHost);
  if (own.source !== 'invalid') ids.add(own.host);
  return ids;
}

/** The hub text with the key line set to `id` (null: removed) — every other byte kept. */
function withWriterLine(raw, id) {
  const lines = raw.split('\n');
  const bare = (l) => (l.endsWith('\r') ? l.slice(0, -1) : l);
  const cr = lines[0].endsWith('\r') ? '\r' : '';
  const close = lines.findIndex((l, i) => i > 0 && bare(l) === FENCE);
  const at = lines.findIndex((l, i) => i > 0 && i < close && bare(l).startsWith(WRITER_KEY_PREFIX));
  const keyLine = id === null ? [] : [`${WRITER_KEY_PREFIX} ${id}${cr}`];
  if (at === -1) return [lines[0], ...keyLine, ...lines.slice(1)].join('\n');
  return [...lines.slice(0, at), ...keyLine, ...lines.slice(at + 1)].join('\n');
}

/** Writes `next` over the hub via tmp + rename, re-reading the hub right before
 * the rename: bytes that differ from `expected` → false, nothing written (W23).
 * The tmp file gets the hub's mode and is removed on every path that does not
 * rename it; an fs error propagates to the caller (refusal, no stack). */
function renameIfUnchanged(hub, next, expected, ops) {
  assertVaultWriteContained(hub);
  const mode = ops.statSync(hub).mode & 0o7777;
  const tmp = tmpPathFor(hub);
  let renamed = false;
  try {
    ops.writeFileSync(tmp, next, { encoding: 'utf8', flag: 'wx', mode });
    ops.chmodSync(tmp, mode); // the umask may have narrowed it
    let now = null;
    try { now = ops.lstatSync(hub).isSymbolicLink() ? null : ops.readFileSync(hub); } catch (_e) { now = null; }
    if (now === null || !now.equals(expected)) return false;
    ops.renameSync(tmp, hub);
    renamed = true;
    return true;
  } finally {
    if (!renamed) { try { ops.unlinkSync(tmp); } catch (_e) { /* never created */ } }
  }
}

/**
 * setWriterHost({root, slug, target, dryRun, env?, osHost?, ops?}) — the
 * FR-041 hand-over; `target` is a normalised id or null for --clear. Returns
 * { code, result } or { code, message } (refusal). `ops` is the fs adapter
 * for the write (statSync, writeFileSync, chmodSync, lstatSync, readFileSync,
 * renameSync, unlinkSync) — io.writeTextAtomic has no re-read hook, hence the
 * own tmp + rename here.
 */
function setWriterHost({ root, slug, target, dryRun, env = process.env, osHost = os.hostname(), ops = realFs }) {
  const hubRel = `project/${slug}.md`;
  const decl = readWriterDeclaration(root, slug);
  const manual = `nothing written; ${MANUAL_PATH} (${hubRel})`;
  if (decl.state === UNREADABLE) return refusal(EXIT.refused, `writer declaration of ${slug} unreadable (${decl.cls}) — ${manual}`);
  if (!decl.bytes) return refusal(EXIT.refused, `hub note missing: ${hubRel} — ${manual}`);
  const gate = gateFromDeclaration(slug, decl, env, osHost);
  // before = the EFFECTIVE writer (hub, else the rollout aid); the no-op check
  // compares the hub alone, so a hub resolved through the env still gets its key.
  const base = { slug, hub_path: hubRel, writer_host_before: gate.writerHost, dry_run: dryRun };
  const hubValue = decl.state === 'declared' ? decl.value : null;
  if ((target === null && decl.state === 'none') || (target !== null && hubValue === target)) {
    return { code: EXIT.ok, result: { ...base, action: 'unchanged', writer_host_after: gate.writerHost } };
  }
  const raw = decl.bytes.toString('utf8');
  if (!/^(\uFEFF)?---\r?$/.test(raw.split('\n')[0])) return refusal(EXIT.refused, `hub note ${hubRel} has no frontmatter block — ${manual}`);
  const reason = notWriterReason(gate);
  if (reason) return refusal(EXIT.refused, `${reason} — ${manual}`);
  if (target !== null && !knownWriterIds(root, slug, env, osHost).has(target)) {
    process.stderr.write(`warning: ${target} is not a known writer id\n`);
  }
  const after = target === null ? fallbackWriter(env).writerHost : target;
  if (dryRun) return { code: EXIT.ok, result: { ...base, action: target === null ? 'would-clear' : 'would-set', writer_host_after: after } };
  const hub = path.join(root, 'project', `${slug}.md`);
  let written;
  try {
    written = renameIfUnchanged(hub, withWriterLine(raw, target), decl.bytes, ops);
  } catch (e) {
    return refusal(EXIT.refused, `could not write ${hubRel} (${e.code || 'error'}) — nothing written`);
  }
  if (!written) return refusal(EXIT.refused, `${hubRel} changed since it was read — nothing written; run the command again`);
  return { code: EXIT.ok, result: { ...base, action: target === null ? 'cleared' : 'set', writer_host_after: after } };
}

function writerUsage(msg) {
  process.stderr.write(`usage error: vault writer ${msg}\n`);
  process.exit(EXIT.usage);
}

/** The parsed call, or a usage exit (2). Slug and id are validated here; the raw values are never echoed. */
function parseWriterArgs(args) {
  const flags = parseFlags(args, WRITER_FLAGS);
  if (flags._.some((a) => a.startsWith('--'))) writerUsage('unknown flag');
  if (flags._.length > 1) writerUsage('takes at most one <slug>');
  const slug = flags._[0];
  const change = flags.set !== undefined || flags.clear === true;
  if (slug === undefined) {
    if (change || flags['dry-run']) writerUsage('--set, --clear and --dry-run need a <slug>');
    return { list: true, json: flags.json === true };
  }
  if (!isProjectName(slug)) writerUsage('<slug> is not a valid project slug');
  if (!change || (flags.set !== undefined && flags.clear === true)) writerUsage('<slug> takes exactly one of --set <host id> | --clear');
  const target = flags.set === undefined ? null : normalizeHostId(flags.set);
  if (flags.set !== undefined && target === null) writerUsage('--set: not a valid host id');
  return { list: false, slug, target, dryRun: flags['dry-run'] === true, json: flags.json === true };
}

/** `a1-tools vault writer [--json]` · `vault writer <slug> (--set <id> | --clear) [--dry-run] [--json]` */
function cmdVaultWriter(args) {
  const call = parseWriterArgs(args);
  const ext = externalVaultRoot();
  if (ext.refusal) {
    process.stderr.write(`[a1-tools] vault writer: ${ext.refusal}\n`);
    process.exit(EXIT.usage);
  }
  const problem = rootProblem(ext.root, call.list || call.dryRun ? realFs.constants.R_OK : realFs.constants.W_OK);
  if (problem) {
    warnSkipped('vault writer', problem);
    if (call.json) emitJson({ status: 'skipped', reason: problem }, EXIT.ok);
    process.exit(EXIT.ok);
  }
  if (call.list) {
    const report = listWriters(ext.root);
    if (call.json) emitJson(report, EXIT.ok);
    else writeStdoutSync(report.projects.map((r) => `${r.slug}\t${r.writer_host}\t${r.writer_source}\tmay_write ${r.may_write}${r.class ? `\t${r.class}` : ''}\n`).join('')
      + `host ${report.host} (${report.host_source}), ${report.projects.length} project(s), ignored_names ${report.ignored_names}\n`);
    process.exit(EXIT.ok);
  }
  const out = setWriterHost({ root: ext.root, slug: call.slug, target: call.target, dryRun: call.dryRun });
  if (out.message) {
    process.stderr.write(`[a1-tools] vault writer: ${out.message}\n`);
    process.exit(out.code);
  }
  if (call.json) emitJson(out.result, out.code);
  else writeStdoutSync(`vault writer: ${out.result.slug} ${out.result.writer_host_before} -> ${out.result.writer_host_after} (${out.result.action})\n`);
  process.exit(out.code);
}

module.exports = {
  WRITER_KEY, UNDECLARED, UNREADABLE, MANUAL_PATH, EXIT,
  readWriterDeclaration, writerGateFor, gateFromDeclaration, notWriterReason, notWriterSkip, skippedProject,
  gateFields, hubConflict, projectNames, isProjectName, displaySlug,
  listWriters, setWriterHost, cmdVaultWriter,
};
