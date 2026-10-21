'use strict';

// ---------------------------------------------------------------------------
// `a1-tools disposition add | review` — spec 017 FR-025 (Wave 8).
//   add     records an entry with review: pending
//             --kind fidelity|skip_increase|class_sweep|config_change --reason <t> --by <who>
//             (--fingerprint <fp> | --rule <id> --file <path> [--line <n> | --text <t>]) [--project <dir>]
//   review  <fingerprint> --verdict upheld|overturned --reason <t> [--by <who>] [--project <dir>]
// Exit 0 recorded / 1 refused (duplicate, unknown fingerprint; JSON `error` on stdout) / 2 usage or
// unreadable store. There is no --skip and no --ignore: every unknown option is a usage error.
// The store, the fingerprint grammar and the merge-check feed live in disposition-store.cjs.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { parseFlags, nowIso } = require('./io.cjs');
const S = require('./disposition-store.cjs');

const SNIPPET_MAX = 160; // the same cut test-fidelity applies to a finding's line text
const ADD_FLAGS = { kind: 'string', fingerprint: 'string', rule: 'string', file: 'string', line: 'string', text: 'string', reason: 'string', by: 'string', project: 'string' };
const REVIEW_FLAGS = { verdict: 'string', reason: 'string', by: 'string', project: 'string' };
const FILE_LEVEL_RULES = Object.freeze(['test-not-in-ci']);
const USAGE = 'usage: a1-tools disposition add --kind <fidelity|skip_increase|class_sweep|config_change> (--fingerprint <fp> | --rule <id> --file <path> [--line <n> | --text <t>]) --reason <t> --by <who> [--project <dir>]\n'
  + '       a1-tools disposition review <fingerprint> --verdict <upheld|overturned> --reason <t> [--by <who>] [--project <dir>]\n';

class UsageError extends Error {}

function emit(obj, code) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exitCode = code;
}

/** Strict flag parse: unknown options, stray positionals and empty values are usage errors. */
function parseStrict(args, schema, positionals) {
  const flags = parseFlags(args, schema);
  const stray = flags._.filter((a, i) => i >= positionals || a.startsWith('-'));
  if (stray.length > 0) throw new UsageError(`unexpected argument ${JSON.stringify(String(stray[0]).slice(0, 60))} (no --skip or --ignore exists)`);
  for (const k of Object.keys(schema)) {
    if (flags[k] !== undefined && (typeof flags[k] !== 'string' || flags[k] === '')) throw new UsageError(`--${k} needs a value`);
    if (typeof flags[k] === 'string' && flags[k].includes('\0')) throw new UsageError(`--${k} contains a NUL byte`);
  }
  return flags;
}

function projectOf(flags) {
  const dir = path.resolve(process.cwd(), flags.project || '.');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UsageError(`--project is not a directory: ${dir}`);
  return dir;
}

/** The text of line `n` of `rel` inside the project, cut like a finding's snippet. */
function lineText(project, rel, n) {
  if (!/^[1-9]\d{0,8}$/.test(n)) throw new UsageError('--line must be a positive integer');
  const root = fs.realpathSync(project);
  let abs;
  try { abs = fs.realpathSync(path.join(root, rel)); } catch (_e) { throw new UsageError(`--file does not exist: ${JSON.stringify(rel)}`); }
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new UsageError('--file resolves outside the project');
  if (!fs.statSync(abs).isFile()) throw new UsageError('--file is not a regular file');
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const text = (lines[Number(n) - 1] || '').trim().slice(0, SNIPPET_MAX);
  if (text === '') throw new UsageError(`line ${n} of ${JSON.stringify(rel)} is empty or past the end of the file`);
  return text;
}

function fingerprintFromFlags(flags, project) {
  const parts = ['rule', 'file', 'line', 'text'].filter((k) => flags[k] !== undefined);
  if (flags.fingerprint !== undefined) {
    if (parts.length > 0) throw new UsageError('--fingerprint cannot be combined with --rule/--file/--line/--text');
    return flags.fingerprint;
  }
  if (flags.rule === undefined || flags.file === undefined) throw new UsageError('give --fingerprint or both --rule and --file');
  if (flags.line !== undefined && flags.text !== undefined) throw new UsageError('give --line or --text, not both');
  const fileLevel = FILE_LEVEL_RULES.includes(flags.rule);
  if (fileLevel && (flags.line !== undefined || flags.text !== undefined)) throw new UsageError(`rule ${flags.rule} is file-level: no --line or --text`);
  if (!fileLevel && flags.line === undefined && flags.text === undefined) throw new UsageError(`rule ${flags.rule} needs --line <n> or --text <t>`);
  if (!S.isSafeFile(flags.file)) throw new UsageError('--file is not a plain repo-relative path ("*", "?", "..", "|", backslash and control characters are refused)');
  const text = flags.line !== undefined ? lineText(project, flags.file, flags.line) : (flags.text || '');
  return S.fingerprintOf(flags.rule, flags.file, text);
}

function wrap(fn) {
  try { fn(); } catch (e) {
    const known = e instanceof UsageError || e instanceof S.DispositionError;
    process.stderr.write(`disposition: ${known ? '' : 'internal error: '}${e && e.message ? e.message : String(e)}\n`);
    process.exitCode = 2;
  }
}

function cmdAdd(args) {
  const flags = parseStrict(args, ADD_FLAGS, 0);
  const project = projectOf(flags);
  if (flags.kind === undefined) throw new UsageError('--kind is required');
  const fingerprint = fingerprintFromFlags(flags, project);
  S.checkFingerprint(flags.kind, fingerprint);
  const entry = {
    kind: flags.kind, fingerprint, reason: S.checkText('--reason', flags.reason, S.MAX_REASON), date: nowIso().slice(0, 10),
    by: S.checkText('--by', flags.by, S.MAX_BY), review: 'pending',
  };
  const added = S.withEntries(project, (list) => (list.some((e) => e.fingerprint === fingerprint)
    ? { next: null, result: false } : { next: [...list, entry], result: true }));
  if (!added) return emit({ ok: false, error: 'duplicate', fingerprint }, 1);
  return emit({ ok: true, action: 'add', fingerprint, kind: entry.kind, review: 'pending' }, 0);
}

function cmdReview(args) {
  const flags = parseStrict(args, REVIEW_FLAGS, 1);
  if (flags._.length !== 1) throw new UsageError('review needs exactly one <fingerprint>');
  const fingerprint = flags._[0];
  S.parseFingerprint(fingerprint);
  if (!S.VERDICTS.includes(flags.verdict)) throw new UsageError(`--verdict must be ${S.VERDICTS.join(' | ')}`);
  const reason = S.checkText('--reason', flags.reason, S.MAX_REASON);
  const by = flags.by === undefined ? null : S.checkText('--by', flags.by, S.MAX_BY);
  const found = S.withEntries(projectOf(flags), (list) => {
    if (!list.some((e) => e.fingerprint === fingerprint)) return { next: null, result: false };
    const next = list.map((e) => (e.fingerprint !== fingerprint ? e
      : { ...e, review: flags.verdict, review_reason: reason, reviewed_at: nowIso(), ...(by === null ? {} : { reviewed_by: by }) }));
    return { next, result: true };
  });
  if (!found) return emit({ ok: false, error: 'not_found', fingerprint }, 1);
  return emit({ ok: true, action: 'review', fingerprint, review: flags.verdict }, 0);
}

/** @param {string|undefined} sub @param {string[]} rest */
function cmdDisposition(sub, rest) {
  if (sub !== 'add' && sub !== 'review') {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  wrap(() => (sub === 'add' ? cmdAdd(rest) : cmdReview(rest)));
}

module.exports = {
  cmdDisposition,
  pendingOrOverturned: S.pendingOrOverturned,
  changedBetween: S.changedBetween,
  loadEntries: S.loadEntries,
  clearedFingerprints: S.clearedFingerprints,
  fingerprintOf: S.fingerprintOf,
  DispositionError: S.DispositionError,
};
