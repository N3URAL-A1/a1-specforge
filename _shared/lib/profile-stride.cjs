'use strict';

// profile-stride — spec 006-specforge-kritis-profile, Wave 5 (FR-003). Owns
// `profile threat-model-check`: proves a `docs/product/features/<id>/
// threat-model.md` covers all six STRIDE categories and leaves no high risk
// open without a named acceptance.
//
// `evaluateThreatModel(text)` is pure (string in, frozen verdict out) and
// owns every STRIDE-table and accepted-risks parsing rule. `checkThreatModel`
// is the CLI entry point `_shared/lib/profile.cjs` (Wave 1, frozen) dispatches
// `rest` argv to directly — it owns every filesystem decision (path
// containment, lstat symlink refusal, size cap, id validation) and never
// passes anything but the file's text into the pure function. Finding codes
// form a closed, frozen set: section_missing, category_missing, bad_risk,
// bad_status, unmitigated, not_applicable_without_reason. Exit 0 pass / 1
// finding / 2 unreadable, unsafe path or hostile input (house contract).

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024; // 512 KiB cap (wave-plan brief)
const ID_PATTERN = /^[0-9]{3}-[a-z0-9-]+$/;

const REQUIRED_SECTIONS = Object.freeze(['## Assets', '## Actors', '## Trust boundaries', '## STRIDE', '## Accepted risks']);
const REQUIRED_CATEGORIES = Object.freeze([
  'Spoofing', 'Tampering', 'Repudiation',
  'Information Disclosure', 'Denial of Service', 'Elevation of Privilege',
]);
const RISK_VALUES = Object.freeze(['low', 'medium', 'high']);
const STATUS_VALUES = Object.freeze(['open', 'mitigated', 'accepted']);

function categoryKey(name) {
  return name.trim().toLowerCase();
}

/** First letter of the canonical STRIDE word (used in finding output, e.g.
 * "D" for "Denial of Service"), looked up case-insensitively. */
function shortLetter(categoryName) {
  const idx = REQUIRED_CATEGORIES.findIndex((c) => categoryKey(c) === categoryKey(categoryName));
  return idx === -1 ? categoryName : REQUIRED_CATEGORIES[idx][0];
}

/** One `## STRIDE` table row, parsed from a markdown pipe-table line.
 * Returns `null` for a line with fewer than the six required cells. */
function parseStrideRow(line) {
  const cells = line.split('|').map((c) => c.trim());
  // A pipe-table row starts and ends with an empty cell from the leading
  // and trailing "|"; drop those, keep the six content cells.
  const content = cells.slice(1, -1);
  if (content.length < 6) return null;
  const [category, relevant, finding, risk, mitigation, status] = content;
  return { category, relevant, finding, risk, mitigation, status };
}

/** Rows of the `## STRIDE` table within `text`, or `[]` if the section or
 * table is absent. Skips the header row and the `|---|` separator row. */
function parseStrideTable(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## STRIDE');
  if (start === -1) return [];
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break; // next section
    if (!line.trim().startsWith('|')) continue;
    if (/^\|?\s*-+\s*\|/.test(line)) continue; // separator row
    const row = parseStrideRow(line);
    if (!row) continue;
    if (row.category.toLowerCase() === 'category') continue; // header row
    rows.push(row);
  }
  return rows;
}

/** `- <category>: <risk> — accepted by <name> on <date>` lines under
 * `## Accepted risks`. Returns the lowercased set of accepted categories. */
function parseAcceptedRisks(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Accepted risks');
  if (start === -1) return [];
  const accepted = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    const m = line.match(/^-\s*([^:]+):.*accepted by\s+\S/i);
    if (m) accepted.push(categoryKey(m[1]));
  }
  return accepted;
}

/**
 * `evaluateThreatModel(text)` — pure. Returns a frozen
 * `{ ok, findings: [{code, category?, detail}] }`. Never throws on
 * malformed input; a missing section or table simply yields findings.
 */
function evaluateThreatModel(text) {
  const findings = [];
  const lines = text.split('\n');

  for (const section of REQUIRED_SECTIONS) {
    if (!lines.some((l) => l.trim() === section)) {
      findings.push({ code: 'section_missing', detail: `missing section: ${section}` });
    }
  }

  const rows = parseStrideTable(text);
  const seenCategories = new Set(rows.map((r) => categoryKey(r.category)));

  for (const required of REQUIRED_CATEGORIES) {
    if (!seenCategories.has(categoryKey(required))) {
      findings.push({ code: 'category_missing', category: shortLetter(required), detail: `missing STRIDE category: ${required}` });
    }
  }

  const acceptedCategories = parseAcceptedRisks(text);

  for (const row of rows) {
    const relevant = row.relevant.trim().toLowerCase();
    const risk = row.risk.trim().toLowerCase();
    const status = row.status.trim().toLowerCase();

    if (relevant === 'no' && row.finding.trim().length === 0) {
      findings.push({ code: 'not_applicable_without_reason', category: shortLetter(row.category), detail: `${row.category}: Relevant is "no" with no reason in Finding` });
      continue; // a not-applicable row is not also checked for risk/status
    }

    if (!RISK_VALUES.includes(risk)) {
      findings.push({ code: 'bad_risk', category: shortLetter(row.category), detail: `${row.category}: Risk "${row.risk}" is not one of ${RISK_VALUES.join('/')}` });
    }
    if (!STATUS_VALUES.includes(status)) {
      findings.push({ code: 'bad_status', category: shortLetter(row.category), detail: `${row.category}: Status "${row.status}" is not one of ${STATUS_VALUES.join('/')}` });
    }
    if (risk === 'high' && status === 'open' && !acceptedCategories.includes(categoryKey(row.category))) {
      findings.push({ code: 'unmitigated', category: shortLetter(row.category), detail: `${row.category}: high risk, open, no matching entry under ## Accepted risks` });
    }
  }

  return Object.freeze({ ok: findings.length === 0, findings: Object.freeze(findings) });
}

// ---------------------------------------------------------------------------
// CLI wrapper — every filesystem decision lives here, never in the pure
// evaluator above.

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') { flags.id = argv[++i]; continue; }
    if (a === '--repo-root') { flags.repoRoot = argv[++i]; continue; }
    if (a === '--phase') { i++; continue; } // installGateLog strips it; tolerate here too
    if (a === '--json') { flags.json = true; continue; }
    flags._.push(a);
  }
  return flags;
}

function fail2(msg) {
  process.stderr.write(`profile threat-model-check: ${msg}\n`);
  process.exit(2);
}

function isInside(candidateReal, rootReal) {
  return candidateReal === rootReal || candidateReal.startsWith(rootReal + path.sep);
}

/** Resolves `<repoRoot>/docs/product/features/<id>/threat-model.md`,
 * refusing a symlinked target file and any path that would resolve outside
 * `repoRoot`. Returns the file's text on success; calls `fail2` (exit 2,
 * never returns) on any refusal. */
function resolveThreatModelText(id, repoRootArg) {
  if (!ID_PATTERN.test(id || '')) {
    fail2(`--id "${id}" does not match ^[0-9]{3}-[a-z0-9-]+$`);
  }
  if (!repoRootArg) fail2('--repo-root is required');

  let repoRootReal;
  try {
    repoRootReal = fs.realpathSync(repoRootArg);
  } catch (e) {
    fail2(`--repo-root "${repoRootArg}" is not readable (${e.code || e.message})`);
  }

  const file = path.join(repoRootReal, 'docs', 'product', 'features', id, 'threat-model.md');

  let lst;
  try {
    lst = fs.lstatSync(file);
  } catch (e) {
    fail2(`threat model not found: ${file} (${e.code || e.message})`);
  }
  if (lst.isSymbolicLink()) {
    fail2(`refusing a symlinked threat model: ${file}`);
  }
  if (!lst.isFile()) {
    fail2(`not a regular file: ${file}`);
  }
  if (lst.size > MAX_BYTES) {
    fail2(`threat model exceeds the ${MAX_BYTES}-byte cap: ${file} (${lst.size} bytes)`);
  }

  let fileReal;
  try {
    fileReal = fs.realpathSync(file);
  } catch (e) {
    fail2(`threat model is not readable: ${file} (${e.code || e.message})`);
  }
  if (!isInside(fileReal, repoRootReal)) {
    fail2(`threat model resolves outside --repo-root: ${file} -> ${fileReal}`);
  }

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail2(`threat model is not readable: ${file} (${e.code || e.message})`);
  }
  return text;
}

/**
 * `checkThreatModel(argv)` — CLI entry point for `profile threat-model-check`.
 * This is the name `_shared/lib/profile.cjs` dispatches `rest` to directly
 * (Wave 1 scaffold, frozen); it owns argv parsing, path resolution and
 * `process.exit`. The pure logic lives in `evaluateThreatModel` above.
 */
function checkThreatModel(argv) {
  const flags = parseArgs(argv || []);
  const text = resolveThreatModelText(flags.id, flags.repoRoot);
  const result = evaluateThreatModel(text);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.ok) {
    process.stdout.write(`profile threat-model-check: pass (${flags.id})\n`);
  } else {
    for (const f of result.findings) {
      const cat = f.category ? ` ${f.category}` : '';
      process.stdout.write(`${f.code}${cat}: ${f.detail}\n`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}

module.exports = { checkThreatModel, evaluateThreatModel };
