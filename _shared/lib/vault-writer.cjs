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
//   cmdVaultWriter         FR-041/FR-043: `a1-tools vault writer`.
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
const BOM = '﻿';
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
  if (CONTINUATION_RE.test(block[at[0] + 1] || '')) return { state: UNREADABLE, cls: 'folded' };
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
  const id = hostIdentity(env, osHost);
  const decl = readWriterDeclaration(root, slug, fs);
  const writer = decl.state === 'declared' ? { writerHost: decl.value, writerSource: 'hub' }
    : decl.state === UNREADABLE ? { writerHost: UNREADABLE, writerSource: 'hub', cls: decl.cls }
      : fallbackWriter(env);
  const mayWrite = writer.writerHost === UNDECLARED
    || (writer.writerHost !== UNREADABLE && id.source !== 'invalid' && id.host === writer.writerHost);
  return Object.freeze({ slug, host: id.host, hostSource: id.source, ...writer, mayWrite });
}

/** The FR-034 reason for a gate that refuses (null when it may write). */
function notWriterReason(gate) {
  if (gate.mayWrite) return null;
  const slug = displaySlug(gate.slug);
  if (gate.writerHost === UNREADABLE) {
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
    reason: gate.writerHost === UNREADABLE ? 'writer-unreadable' : 'not-writer',
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

module.exports = {
  WRITER_KEY, UNDECLARED, UNREADABLE, MANUAL_PATH, EXIT,
  readWriterDeclaration, writerGateFor, notWriterReason, notWriterSkip, skippedProject,
  gateFields, hubConflict, projectNames, isProjectName, displaySlug,
};
