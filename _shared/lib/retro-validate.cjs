'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, fail, parseFlags, repoRoot } = require('./io.cjs');
const { emitExit } = require('./emit-exit.cjs');
const { currentScope } = require('./gate-log.cjs');
const { parseRegistryIds, expandRangeIds, resolveGateId } = require('./gate-ids.cjs');
const { checkRetroAgainstLog } = require('./retro-gatelog.cjs');
const { ENFORCED_SINCE } = require('./enforced-since.cjs');
const { normalizeNewlines, linesOf, blocksOf, machineKeyLines } = require('./retro-view.cjs');

// ---------------------------------------------------------------------------
// retro validate — Wave 2 of spec 007-retro-gate-id-validator.
//
// `node a1-tools.cjs retro validate <retro-path>` parses every
// `gates_fired[].id` in the given retro file and checks it against
// `_shared/gates-registry.md` (via gate-ids.cjs, Wave 1). This is the
// write-time half of invariant 7: a silently-invented or misspelled gate id
// looked like data to a1-evolve's gate-ROI step and contributed nothing —
// measured 2026-09-11 at 11 of the corpus's `gates_fired` entries, in 3
// distinct misspellings, discarded without a trace.
//
// Exit codes (documented again in help.cjs, per invariant 7):
//   0  every gates_fired[].id in the file is registered (literal or range).
//   1  at least one id is drift (known alias) or unknown (neither table nor
//      alias) — the file has something to fix before its entry counts.
//   2  missing file, unreadable registry, OR a `gates_fired` field that is
//      PRESENT but unparseable.
//
// NOT 2: a bad ARGUMENT exits 1. The header used to promise 2 for "usage
// error"; a1-victor-verifier measured 1 on 2026-09-12 and was right, so the
// documentation was corrected to the measured behaviour.
//
// CORRECTION (2026-09-12, a1-reinhard-reviewer): the justification I first
// wrote here claimed the facade consistently exits 1 on an unknown flag and
// that this command was the only offender. That was WRONG — measured cleanly,
// `learnings roots --bogus`, `quick stats --bogus` and `retro validate <file>
// --bogus` all exit **0**. My original measurement used an unquoted `$c` in a
// shell loop, which split the arguments differently from what I thought I was
// testing. So the silent-ignore behaviour was facade-wide, not unique to
// anything; `workflow lint` (abde955) and this command are now the two that
// reject leftovers, and the others still do not. An unverified claim, written
// into a commit, inside a feature built against unverified claims.
//
// Consequence a caller must know: exit 1 means EITHER "drift found" OR "you
// called me wrong". Distinguish them by stdout — a real run always emits the
// JSON report on stdout, a usage error emits nothing there.
//
// THE ASYMMETRY THAT MATTERS (do not "fix" this by treating both alike): a
// MISSING gates_fired field is exit 0 — read-only reporter skills legitimately
// omit it (retro-template.md, "Skills with no gates ... omit the field").
// A PRESENT-BUT-UNPARSEABLE gates_fired field is exit 2 — treating a
// malformed block as "no gates" would silently discard it exactly like the
// defect this feature exists to kill, just one layer earlier (a parse
// failure instead of a registry miss). See V6 in the fixture suite.
// ---------------------------------------------------------------------------

// Hostile-input guards on the retro-path argument (CONVENTIONS.md, mandatory
// for every new CLI subcommand). A retro path is a file argument, not a slug
// joined into a path (unlike the `product` commands' --id/--milestone, fixed
// in d639b8e) — so the applicable guard is: resolve to an absolute path,
// reject control-character/NUL/oversized shapes up front (before any fs
// call touches the string), and require the resolved path to be an existing
// REGULAR file. A `../../etc/passwd`-shaped argument is not rejected because
// it is "outside a store" (there is no single store a retro must live under
// — Wave 1's own fixtures and V4's snapshot both live in the repo, not the
// vault) but because it is treated as an opaque path: it either resolves to
// a real file or it does not, and nothing in between is trusted enough to
// read speculatively.
const MAX_PATH_LEN = 4096;

function rejectHostilePath(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    fail('retro validate requires <retro-path>');
  }
  if (raw.length > MAX_PATH_LEN) {
    const err = new Error(`retro-path too long (${raw.length} chars, max ${MAX_PATH_LEN})`);
    err.code = 'A1_INPUT';
    throw err;
  }
  if (/[\x00-\x1f\x7f]/.test(raw)) {
    const err = new Error('retro-path contains a control character');
    err.code = 'A1_INPUT';
    throw err;
  }
}

// `repoRoot` comes from io.cjs — see the note there. The hoist landed in
// workflow-lint.cjs first and missed this file, which is the same
// one-place-not-its-neighbour shape as the two header corrections above
// (a1-reinhard-reviewer's re-review NIT, 2026-09-12).

function registryPath() {
  const inRepo = path.join(repoRoot(), '_shared', 'gates-registry.md');
  if (fs.existsSync(inRepo)) return inRepo;
  // Called from another project's checkout (the retro call sites of a1-execute, a1-fix, ...): use this
  // tool's own registry instead of failing exit 2 on a path that only exists inside the a1-specforge repo.
  return path.resolve(__dirname, '..', 'gates-registry.md');
}

// Parse the `gates_fired:` block-of-objects shape
// (`- {id: x, verdict: y, caught: z}`) that parseFrontmatter() (io.cjs)
// already isolates as a list of RAW STRINGS (io.cjs does not parse nested
// objects — see its own header comment). This function turns those raw
// strings into {id, verdict, caught} without widening io.cjs: a second
// change to that shared parser in the same week it grew inline-array support
// is exactly how a regression enters, per the brief for this wave.
//
// Returns { entries, malformed } — `malformed` is true if gates_fired was
// present as a raw string (parseFrontmatter's "no list items matched"
// fallback keeps unparsed content as a bare string/null) or if any list item
// does not match the `{id: ..., ...}` shape at all. Distinguishing "field
// absent" (undefined) from "field present but garbage" (malformed: true) is
// the whole point of the exit-0-vs-exit-2 asymmetry above.
// ---------------------------------------------------------------------------
// A learning-store file is NOT one frontmatter block. Measured 2026-09-13
// against the real store: every `pattern/a1-learnings/a1-*.md` file opens
// with a `type: pattern` header that has no `gates_fired`, and the retro
// entries are APPENDED below it as further `---`-delimited blocks. The
// original implementation called `parseFrontmatter` on the whole file, read
// only that header, found no `gates_fired`, and took the legitimate
// "read-only reporter skill" exit-0 path — on all 34 `gates_fired` blocks
// across the five store files that had them. A gate that cannot fail on any
// real input is documentation (invariant 8), so this splits the file into
// blocks first and validates every one.
//
// Every fixture in `_test-fixtures/a1-retro-validate/corpus/` had the
// single-block shape, including the "frozen corpus snapshot" that was
// supposed to stand in for the real 58 entries — it had been rewritten into
// the parser's shape instead of copied from the store. `retro-appended-entries.md`
// (case V10) is the shape that actually occurs.
//
// The split is deliberately textual and not a YAML-document parser: entries
// are appended by skills using a plain heredoc, so a block is "a line that
// is exactly `---`, up to the next such line". Content outside blocks (the
// file's prose) is ignored, exactly as before.
function frontmatterBlocks(text) {
  // One view of the file (retro-view.cjs, review round 2): the same newline normaliser and block rule `machine-retro` reads the
  // store with. A block opens at an exact `---` line and every delimiter opens one (an appended entry's closing `---` is also the
  // next entry's opening one; pairing opening/closing lines shifts by one from the second entry on, measured on fixture V10).
  // Over-producing blocks is safe (a block without `gates_fired:` is skipped); under-producing drops retro entries.
  const blocks = [];
  for (const b of blocksOf(linesOf(text))) {
    const body = b.lines.join('\n').replace(/^\n+|\n+$/g, '');
    if (body.trim() === '') continue;
    // parseFrontmatter expects the delimiters, so re-wrap each block.
    blocks.push('---\n' + body + '\n---\n');
  }
  return blocks;
}

const GATES_ITEM_RE = /^\{\s*id:\s*([^,}]+?)\s*(?:,\s*verdict:\s*([^,}]+?)\s*)?(?:,\s*caught:\s*([^,}]+?)\s*)?\}$/;

function parseGatesFired(fm) {
  if (!Object.prototype.hasOwnProperty.call(fm, 'gates_fired')) {
    return { present: false, entries: [], malformed: false };
  }
  const raw = fm.gates_fired;
  if (!Array.isArray(raw)) {
    // parseFrontmatter emits a bare scalar/null when the key had a value but
    // no `- ` list items followed it (e.g. `gates_fired: garbage` or
    // `gates_fired:` immediately followed by non-list content). That is
    // "present but unparseable" — exactly the case the asymmetry names.
    return { present: true, entries: [], malformed: true };
  }
  const entries = [];
  let malformed = false;
  for (const item of raw) {
    const m = typeof item === 'string' ? item.match(GATES_ITEM_RE) : null;
    if (!m) {
      malformed = true;
      continue;
    }
    entries.push({
      id: m[1].trim(),
      verdict: m[2] ? m[2].trim() : undefined,
      caught: m[3] ? m[3].trim() : undefined,
    });
  }
  return { present: true, entries, malformed };
}

/**
 * `retro validate <retro-path> [--registry <path>]` — see module header for
 * the full contract. `--registry` overrides the repo-resolved
 * `_shared/gates-registry.md` and exists SOLELY so SC-002 (a registry
 * mutation must be able to turn a previously-green retro red) is testable
 * without mutating the real registry in place — mirrors realpath-check's own
 * `--evidence <path>` override for the same reason (a sane default derived
 * from context, plus an explicit escape hatch for fixtures/non-standard
 * layouts). Production call sites (retro-template.md's snippet) never pass
 * it.
 * @param {string[]} argv
 */
function resolveRetroPath(flags) {
  // Reject leftovers. `parseFlags` parks unrecognised tokens in `_` without
  // complaining, so `--registr <path>` (one character short) was silently
  // dropped and the run validated against the REAL registry while reporting
  // success — a green run over the wrong input, the class this command exists
  // to remove. Found by a1-reinhard-reviewer 2026-09-12: Wave 3 fixed exactly
  // this in `workflow lint` and did not apply it to its sibling.
  const leftovers = flags._.slice(1).concat(
    flags._.slice(0, 1).filter((t) => String(t).startsWith('--'))
  );
  if (leftovers.length > 0) {
    process.stderr.write(
      `usage error: unrecognised argument(s): ${leftovers.join(' ')}\n` +
        '  usage: retro validate <retro-path> [--registry <path>] [--gate-log <path>] [--enforced-since YYYY-MM-DD] [--defer-to-machine <spec>#<pr>]\n'
    );
    process.exit(1);
  }

  const retroPathRaw = flags._[0];
  rejectHostilePath(retroPathRaw);

  const retroPath = path.resolve(process.cwd(), retroPathRaw);

  let stat;
  try {
    stat = fs.statSync(retroPath);
  } catch (_e) {
    process.stderr.write(`error: retro file not found: ${retroPath}\n`);
    process.exit(2);
  }
  if (!stat.isFile()) {
    process.stderr.write(`error: retro path is not a regular file: ${retroPath}\n`);
    process.exit(2);
  }
  return retroPath;
}

/**
 * Read the registry text, honouring the test-only `--registry` override.
 * Exits 2 when it cannot be read: an unreadable registry must never be
 * mistaken for "no ids are registered", which would turn every drift entry
 * into a silent pass.
 * @param {object} flags parsed flags
 * @returns {string} raw registry markdown
 */
function loadRegistryText(flags) {
  const regPath = flags.registry ? path.resolve(process.cwd(), flags.registry) : registryPath();
  let registryText;
  try {
    registryText = fs.readFileSync(regPath, 'utf8');
  } catch (_e) {
    process.stderr.write(`error: registry unreadable: ${regPath}\n`);
    process.exit(2);
  }
  return registryText;
}

/**
 * `retro validate <retro-path> [--registry <path>]` — see module header for
 * the full contract and the exit-code semantics.
 *
 * Argument resolution and registry loading were split into their own
 * functions on 2026-09-12 (a1-reinhard-reviewer NIT, coding-style.md's
 * 50-line rule): this was 94 logic lines and read as three unrelated phases.
 * @param {string[]} argv
 */
function cmdRetroValidate(argv) {
  const flags = parseFlags(argv, { registry: 'value', 'gate-log': 'value', 'enforced-since': 'value', 'defer-to-machine': 'value' });
  // Spec 028 FR-016: parseFlags keeps only the last value, so every --gate-log is collected from argv itself.
  const gateLogs = collectGateLogs(argv);
  const retroPath = resolveRetroPath(flags);
  const registryText = loadRegistryText(flags);
  const expanded = expandRangeIds(parseRegistryIds(registryText));

  const retroText = normalizeNewlines(fs.readFileSync(retroPath, 'utf8'));
  const blocks = frontmatterBlocks(retroText);
  // No `---` delimiters at all: fall back to treating the whole text as one
  // block so a bare single-entry file (the shape every pre-2026-09-13
  // fixture had) keeps working unchanged.
  const candidates = blocks.length > 0 ? blocks : [retroText];

  let present = false;
  let malformed = false;
  const rawEntries = [];
  const blockInfos = [];
  for (const block of candidates) {
    let fm;
    try {
      ({ fm } = parseFrontmatter(block));
    } catch (e) {
      process.stderr.write(`error: retro file frontmatter unreadable: ${e.message}\n`);
      process.exit(2);
    }
    const got = parseGatesFired(fm);
    blockInfos.push({ date: fm.date, isEntry: got.present || fm.date !== undefined, entries: got.entries, retroOf: fm.retro_of, hasGates: got.present });
    if (!got.present) continue;
    present = true;
    if (got.malformed) malformed = true;
    rawEntries.push(...got.entries);
  }

  // E: the gate-log trust check runs first, so a broken or missing log keeps exit 2 over the forbidden-keys exit 1.
  const gateLog = runGateLogCheck(flags, registryText, blockInfos, gateLogs);

  // A raw-text ban on the normalised file, not on parsed blocks: a machine key hidden behind `---x`, a U+2028 or a lone CR is
  // invisible to a block parser and visible to the store reader (root cause A). `kind: machine` / `machine_record` are written only
  // by `feature close` (machine-retro.cjs); a prose retro that carries them would forge the idempotency key of a run (F-003).
  const forbidden = machineKeyLines(retroText);
  if (forbidden.length > 0) {
    return emitExit(1, JSON.stringify({ file: retroPath, entries: [], valid: 0, drift: 0, unknown: 0, forbidden_machine_keys: forbidden }) + '\n',
      'fix: a retro must not carry `kind: machine` or `machine_record` (only `feature close` writes them); a prose retro uses `retro_of: <spec>#<pr>`.\n');
  }

  if (present && malformed) {
    process.stderr.write(
      `error: gates_fired block in ${retroPath} is present but unparseable — ` +
        'expected "- {id: <slug>, verdict: <pass|fail|not_applicable>, caught: <true|false>}" items.\n' +
        'A malformed block is NOT treated as "no gates": fix the shape rather than ' +
        'removing it, or this run\'s gate attributions vanish exactly like an ' +
        'unregistered id would (invariant 7).\n'
    );
    process.exit(2);
  }

  if (!present) {
    // Missing field is legitimate for read-only reporter skills
    // (retro-template.md). Nothing to validate; still print the JSON shape
    // so callers can rely on a stable contract regardless of exit path.
    const out = { file: retroPath, entries: [], valid: 0, drift: 0, unknown: 0, ...(gateLog ? { gate_log: gateLog } : {}) };
    return emitExit(gateLog && gateLog.problems.length > 0 ? 1 : 0, JSON.stringify(out) + '\n', deferredWarn(gateLog) + problemLines(gateLog));
  }

  const results = rawEntries.map((entry, idx) => {
    const r = resolveGateId(entry.id, expanded);
    return { id: entry.id, status: r.status, canonical: r.canonical, line: idx + 1 };
  });

  reportAndExit(retroPath, results, gateLog);
}

/**
 * Every `--gate-log <v>` / `--gate-log=<v>` value in argv order (a flag without a value yields undefined, which
 * runGateLogCheck refuses). Pure.
 * @param {string[]} argv @returns {(string|undefined)[]}
 */
function collectGateLogs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--gate-log') out.push(argv[++i]);
    else if (argv[i].startsWith('--gate-log=')) out.push(argv[i].slice('--gate-log='.length));
  }
  return out;
}

/**
 * FR-009: compare the retro with the gate log. Returns null without
 * `--gate-log`. A missing/malformed log or a bad flag value is exit 2 (a log
 * that cannot be trusted must not read as "nothing fired").
 * @param {object} flags @param {string} registryText @param {object[]} blockInfos
 */
function runGateLogCheck(flags, registryText, blockInfos, gateLogs) {
  if (!('gate-log' in flags) && !('enforced-since' in flags) && !('defer-to-machine' in flags)) return null; // present-without-value is a usage error below
  const since = flags['enforced-since'] === undefined ? ENFORCED_SINCE : flags['enforced-since'];
  const plain = (p) => typeof p === 'string' && p !== '' && p.length <= MAX_PATH_LEN && !/[\x00-\x1f\x7f]/.test(p);
  if (gateLogs.length === 0 || !gateLogs.every(plain)) {
    process.stderr.write('error: --enforced-since and --defer-to-machine need --gate-log <path>; --gate-log needs a plain path\n');
    process.exit(2);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since))) {
    process.stderr.write('error: --enforced-since must be YYYY-MM-DD\n');
    process.exit(2);
  }
  try {
    const logPaths = [...new Set(gateLogs.map((p) => path.resolve(process.cwd(), p)))];
    return checkRetroAgainstLog({ logPaths, registryText, blocks: blockInfos, since, scope: currentScope(), defer: flags['defer-to-machine'] === undefined ? null : String(flags['defer-to-machine']), root: repoRoot() });
  } catch (e) {
    if (e.code !== 'A1_GATELOG') throw e;
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(2);
  }
  return null;
}

/** @returns {string} one WARN line naming every blocking fail left to the machine entry, else '' */
function deferredWarn(gateLog) {
  const d = gateLog && gateLog.deferred;
  if (!d || d.failed_blocking.length === 0) return '';
  return `WARN: blocking fail(s) ${d.failed_blocking.join(', ')} are not named here: retro_of ${d.retro_of.join(', ')} leaves them to the kind: machine entry of \`feature close\`; without that close there is no carrier.\n`;
}

const problemLines = (gateLog) => (gateLog ? gateLog.problems.map((p) => `fix: gate log ${p.rule}: ${p.id} - ${p.reason}.\n`).join('') : '');

/**
 * Emit the JSON report on stdout, the fix instructions on stderr, and own the
 * exit code (0 all registered / 1 at least one drift or unknown). Split out
 * with the two resolvers on 2026-09-12 — see `cmdRetroValidate`.
 *
 * The stream split is part of the contract, not formatting: a caller
 * distinguishes "drift found" from "you called me wrong" — both exit 1 — by
 * whether stdout carries the report.
 * @param {string} retroPath
 * @param {{id: string, status: string, canonical?: string, line: number}[]} results
 */
function reportAndExit(retroPath, results, gateLog) {
  const valid = results.filter((r) => r.status === 'ok').length;
  const drift = results.filter((r) => r.status === 'drift').length;
  const unknown = results.filter((r) => r.status === 'unknown').length;

  const toEntry = (r) =>
    r.canonical
      ? { id: r.id, status: r.status, canonical: r.canonical, line: r.line }
      : { id: r.id, status: r.status, line: r.line };

  const text = JSON.stringify({ file: retroPath, entries: results.map(toEntry), valid, drift, unknown, ...(gateLog ? { gate_log: gateLog } : {}) }) + '\n';

  const logProblems = gateLog ? gateLog.problems : [];
  let err = deferredWarn(gateLog) + problemLines(gateLog);
  if (drift === 0 && unknown === 0 && logProblems.length === 0) {
    return emitExit(0, text, err);
  }

  for (const r of results) {
    if (r.status === 'drift') {
      err += `fix: "${r.id}" is not a registered gate id — use \`${r.canonical}\` instead ` +
        `(gates_fired entry ${r.line}).\n`;
    } else if (r.status === 'unknown') {
      err += `fix: "${r.id}" is not registered and has no known canonical id — add a row to ` +
        `_shared/gates-registry.md per invariant 7 (gates are registered), or correct ` +
        `the id if this was a typo (gates_fired entry ${r.line}).\n`;
    }
  }
  return emitExit(1, text, err);
}

module.exports = { cmdRetroValidate, parseGatesFired, registryPath };
