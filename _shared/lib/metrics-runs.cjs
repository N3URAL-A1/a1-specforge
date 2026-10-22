'use strict';

// ---------------------------------------------------------------------------
// metrics-runs — the run window shared by `metrics escaped` and `metrics cost`
// (spec 018-pipeline-metrics). A "run" is a finished unit of pipeline work:
//   spec: project/<slug>/spec/*.md           with `status: done`
//         date = the last timestamp in `phase_history`, else `created`
//   fix : project/<slug>/fixes/*.md          with `status: fixed`
//         date = the YYYY-MM-DD filename prefix; `*.postmortem.md` is skipped
// Runs are sorted by date, then id. Reads vault markdown as data, never evals.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./io-frontmatter.cjs');
const { assertSafeSegment } = require('./io-roots.cjs');

const EXIT_IO = 2;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const COMPLETED_RE = /completed=(\d{4}-\d{2}-\d{2})(?:T[0-9:.]+Z?)?(?:\s|$)/;
const HISTORY_DATE_RE = /(\d{4}-\d{2}-\d{2})/;

/** @returns {string} the vault root; exits 2 with a one-line message when unset or absent */
function vaultOrExit2() {
  const root = process.env.A1_VAULT_ROOT;
  if (!root) {
    process.stderr.write('error: A1_VAULT_ROOT is not set; metrics read the vault and need it (no repo-local fallback)\n');
    process.exit(EXIT_IO);
  }
  let isDir = false;
  try { isDir = fs.statSync(root).isDirectory(); } catch (_e) { isDir = false; }
  if (!isDir) {
    process.stderr.write(`error: A1_VAULT_ROOT is not a directory: ${JSON.stringify(root.slice(0, 200))}\n`);
    process.exit(EXIT_IO);
  }
  return root;
}

function listMd(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
}

function frontmatterOf(file) {
  try {
    return parseFrontmatter(fs.readFileSync(file, 'utf8')).fm;
  } catch (_e) {
    return null; // unparsable frontmatter: not a countable run, never fatal
  }
}

function asDate(value) {
  const m = HISTORY_DATE_RE.exec(String(value == null ? '' : value));
  return m ? m[1] : null;
}

/** Date of the last phase_history entry that carries a timestamp; entries are strings or {phase, completed}. */
function historyDate(history) {
  const entries = Array.isArray(history) ? history : [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const text = typeof e === 'string' ? e : e && typeof e.completed === 'string' ? `completed=${e.completed}` : '';
    const m = COMPLETED_RE.exec(text);
    if (m) return m[1];
  }
  return null;
}

function specRuns(dir) {
  const runs = [];
  for (const name of listMd(dir)) {
    const fm = frontmatterOf(path.join(dir, name));
    if (!fm || fm.status !== 'done') continue;
    const date = historyDate(fm.phase_history) || asDate(fm.created);
    if (date) runs.push({ kind: 'spec', id: name.slice(0, -3), date });
  }
  return runs;
}

function fixRuns(dir) {
  const runs = [];
  for (const name of listMd(dir)) {
    if (name.endsWith('.postmortem.md') || !DATE_RE.test(name)) continue;
    const fm = frontmatterOf(path.join(dir, name));
    if (!fm || fm.status !== 'fixed') continue;
    runs.push({ kind: 'fix', id: name.slice(0, -3), date: name.slice(0, 10) });
  }
  return runs;
}

function byDateThenId(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * @param {string} vault - vault root
 * @param {string} slug - project slug (one safe path segment)
 * @returns {{kind: 'spec'|'fix', id: string, date: string}[]} sorted by date, then id
 */
function listRuns(vault, slug) {
  assertSafeSegment(slug, 'project slug');
  const base = path.join(vault, 'project', slug);
  return [...specRuns(path.join(base, 'spec')), ...fixRuns(path.join(base, 'fixes'))].sort(byDateThenId);
}

/** The n newest runs of a sorted list; a new array. */
function lastN(runs, n) {
  return n >= runs.length ? runs.slice() : runs.slice(runs.length - n);
}

module.exports = { listRuns, lastN, vaultOrExit2 };
