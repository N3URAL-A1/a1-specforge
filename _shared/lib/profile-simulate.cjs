'use strict';

// profile-simulate — spec 006-specforge-kritis-profile, Wave 6 (FR-005).
// Owns `profile simulate-roles` and `profile simulate-check`: renders
// stakeholder/reviewer role cards from the catalogue
// (`_shared/profiles/kritis/stakeholder-roles.md`) and verifies that a
// spec's resulting `## Stakeholder Simulation` section carries one
// `### <role-id>` block per requested role, each with an
// `Assumption challenged:` line.
//
// `renderRoleCards(ids, catalogue)` and `evaluateSimulation(text, ids)` are
// pure (data in, frozen verdict out; no I/O, no process.exit). `renderRoles`
// and `checkSimulation` exported below are the CLI entry points
// `_shared/lib/profile.cjs` (Wave 1, frozen) dispatches `rest` argv to
// directly — they own argv parsing, path resolution and `process.exit`;
// the pure logic lives separately (same split as profile-stride.cjs's
// checkThreatModel/evaluateThreatModel).
//
// Section heading is the literal `## Stakeholder Simulation` (wave-plan
// Wave 6 brief, lines 599 and 614) — fixed text, not read from a file.
//
// Finding codes (simulate-check) form a closed, frozen set: section_missing,
// block_missing, assumption_missing. Role-id validation errors
// (simulate-roles) are usage/finding errors, not internal errors:
// no_roles, too_many_roles, invalid_role_id, duplicate_role, unknown_role.
// Exit 0 pass / 1 finding or usage / 2 unreadable, unsafe path or hostile
// input (house contract).

const fs = require('fs');
const { resolveVaultPath, parseFlags } = require('./io.cjs');
const { usage } = require('./help.cjs');

const MAX_SPEC_BYTES = 1024 * 1024; // 1 MiB (same cap as profile-ears.cjs)
const MAX_ROLES = 5;
const ROLE_ID_PATTERN = /^[a-z][a-z-]*$/; // plain kebab-case id, no shell/path metacharacters

const SECTION_HEADING = '## Stakeholder Simulation';
const MANDATORY_QUESTION = 'name one assumption the author treats as given';

// Closed catalogue (9 ids). Mirrors _shared/profiles/kritis/stakeholder-roles.md's
// table exactly; that file documents this data, it is not a second source
// re-parsed at runtime (contract item 9: no implicit filesystem read inside
// the pure function below — the catalogue is an explicit parameter).
const ROLE_CATALOGUE = Object.freeze({
  'product-owner': Object.freeze({ focus: 'Business value, ROI, MVP scope', method: 'MoSCoW, Value/Effort' }),
  architect: Object.freeze({ focus: 'API design, module structure, ADR compliance', method: 'FLEX + ARCEVAL' }),
  'contract-guardian': Object.freeze({ focus: 'Spec-to-schema chain, fixture validity, consistency', method: 'iSAQB governance' }),
  'security-officer': Object.freeze({ focus: 'OWASP Top 10, STRIDE, auth, secrets, security ADRs', method: 'STRIDE (all 6 categories)' }),
  'data-engineer': Object.freeze({ focus: 'Storage patterns, data flow, retention, concurrency', method: 'Retention policy check' }),
  'harness-auditor': Object.freeze({ focus: 'Golden Principles, file placement, exec plans, doc freshness', method: 'GP-01..GP-10' }),
  'end-user': Object.freeze({ focus: 'Usability, comprehensibility, fault tolerance', method: 'Persona-based' }),
  dpo: Object.freeze({ focus: 'GDPR, data categories, deletion concepts, DPIA', method: 'GDPR Art. 25, 35' }),
  ops: Object.freeze({ focus: 'Monitoring, deployment, incident response, capacity', method: 'OPS-01..OPS-05 (Anhang D)' }),
});

// ---------------------------------------------------------------------------
// renderRoles / simulate-roles

/** Parses a `--roles` CSV into a trimmed, non-empty array of raw tokens
 * (no validation here — validateRoleIds owns that). `''` yields `[]`. */
function splitRolesCsv(csv) {
  return String(csv == null ? '' : csv)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Validates a list of requested role ids against the catalogue and the
 * usage rules (1-5 roles, no duplicates, known ids, plain kebab-case shape).
 * Returns `{ ok: true }` or `{ ok: false, code, detail }` — never throws.
 * Pure.
 */
function validateRoleIds(ids, catalogue) {
  const cat = catalogue || ROLE_CATALOGUE;
  if (ids.length === 0) {
    return { ok: false, code: 'no_roles', detail: '--roles must name at least one role id' };
  }
  if (ids.length > MAX_ROLES) {
    return { ok: false, code: 'too_many_roles', detail: `--roles names ${ids.length} roles, maximum is ${MAX_ROLES}` };
  }
  const seen = new Set();
  for (const id of ids) {
    if (!ROLE_ID_PATTERN.test(id)) {
      return { ok: false, code: 'invalid_role_id', detail: `role id "${id}" is not a plain kebab-case identifier` };
    }
    if (seen.has(id)) {
      return { ok: false, code: 'duplicate_role', detail: `role id "${id}" is requested more than once` };
    }
    seen.add(id);
    if (!Object.prototype.hasOwnProperty.call(cat, id)) {
      return { ok: false, code: 'unknown_role', detail: `role id "${id}" is not in the catalogue` };
    }
  }
  return { ok: true };
}

/**
 * `renderRoleCards(ids, catalogue)` — pure. Returns a frozen
 * `{ ok, code?, detail?, text? }`. On success, `text` is the rendered role
 * cards (one `### <id>` block per requested id, in the order given).
 * `catalogue` defaults to the built-in ROLE_CATALOGUE but is an explicit
 * parameter so a caller (or a test) can pass a different map.
 */
function renderRoleCards(ids, catalogue) {
  const cat = catalogue || ROLE_CATALOGUE;
  const verdict = validateRoleIds(ids, cat);
  if (!verdict.ok) return Object.freeze(verdict);

  const blocks = ids.map((id) => {
    const role = cat[id];
    return [
      `### ${id}`,
      `Focus: ${role.focus}`,
      `Method: ${role.method}`,
      `Question: ${MANDATORY_QUESTION}.`,
    ].join('\n');
  });
  return Object.freeze({ ok: true, text: `${blocks.join('\n\n')}\n` });
}

function fail2Simulate(cmd, msg) {
  process.stderr.write(`profile ${cmd}: ${msg}\n`);
  process.exit(2);
}

/**
 * `renderRoles(argv)` — CLI entry point for `profile simulate-roles`.
 * This is the name `_shared/lib/profile.cjs` dispatches `rest` to directly.
 */
function renderRoles(argv) {
  const flags = parseFlags(argv || [], { roles: 'value', json: 'bool' });
  if (!flags.roles) {
    usage('profile simulate-roles requires --roles <csv>');
    return;
  }

  const ids = splitRolesCsv(flags.roles);
  const result = renderRoleCards(ids, ROLE_CATALOGUE);

  if (!result.ok) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stdout.write(`${result.code}: ${result.detail}\n`);
    }
    process.exit(1);
    return;
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, roles: ids })}\n`);
  } else {
    process.stdout.write(result.text);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// checkSimulation / simulate-check

/** Body lines of `## Stakeholder Simulation`, or `null` if the heading is
 * absent (caller distinguishes "section missing" from "section empty"). */
function extractSimulationSection(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const start = lines.findIndex((l) => l.trim() === SECTION_HEADING);
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break; // next level-2 section ends this one
    body.push(lines[i]);
  }
  return body;
}

/** `{ roleId -> bodyLines }` for every `### <role-id>` block found in
 * `sectionLines`. A block runs until the next `### ` or `## ` heading. */
function parseRoleBlocks(sectionLines) {
  const blocks = {};
  let i = 0;
  while (i < sectionLines.length) {
    const m = sectionLines[i].match(/^###\s+(\S+)\s*$/);
    if (!m) { i += 1; continue; }
    const id = m[1];
    const body = [];
    let j = i + 1;
    while (j < sectionLines.length && !/^#{2,3}\s/.test(sectionLines[j])) {
      body.push(sectionLines[j]);
      j += 1;
    }
    blocks[id] = body;
    i = j;
  }
  return blocks;
}

/**
 * `evaluateSimulation(text, ids)` — pure (text + role-id list in, frozen
 * verdict out). Verifies the spec's `## Stakeholder Simulation` section has
 * one `### <role-id>` block per id in `ids`, each with an
 * `Assumption challenged:` line. Never throws on malformed input; a missing
 * section or block simply yields findings.
 */
function evaluateSimulation(text, ids) {
  const findings = [];
  const section = extractSimulationSection(text);

  if (section === null) {
    for (const id of ids) {
      findings.push({ code: 'section_missing', role: id, detail: `missing section: ${SECTION_HEADING} (role ${id} cannot be verified)` });
    }
    return Object.freeze({ ok: false, findings: Object.freeze(findings) });
  }

  const blocks = parseRoleBlocks(section);
  for (const id of ids) {
    const body = blocks[id];
    if (body === undefined) {
      findings.push({ code: 'block_missing', role: id, detail: `missing block: ### ${id} under ${SECTION_HEADING}` });
      continue;
    }
    const hasAssumption = body.some((l) => /^Assumption challenged:\s*\S/.test(l.trim()));
    if (!hasAssumption) {
      findings.push({ code: 'assumption_missing', role: id, detail: `role ${id}'s block has no "Assumption challenged:" line` });
    }
  }

  return Object.freeze({ ok: findings.length === 0, findings: Object.freeze(findings) });
}

/** Read and validate `--spec`'s target path (same shape as profile-ears.cjs's
 * readSpecOrExit): resolves via resolveVaultPath, refuses a symlink or a
 * non-file, caps size, exits 2 on any refusal without returning. */
function readSpecOrExit(cmd, specFlag) {
  let abs;
  try {
    abs = resolveVaultPath(specFlag);
  } catch (e) {
    fail2Simulate(cmd, `unsafe --spec path: ${e.message}`);
  }

  let st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    fail2Simulate(cmd, `cannot read --spec: ${e.code || e.message}`);
  }
  if (st.isSymbolicLink()) {
    fail2Simulate(cmd, '--spec refused — target is a symlink');
  }
  if (!st.isFile()) {
    fail2Simulate(cmd, '--spec is not a regular file');
  }
  if (st.size > MAX_SPEC_BYTES) {
    fail2Simulate(cmd, `--spec exceeds the ${MAX_SPEC_BYTES}-byte cap (${st.size} bytes)`);
  }

  try {
    return fs.readFileSync(abs, 'utf8');
  } catch (e) {
    fail2Simulate(cmd, `cannot read --spec: ${e.code || e.message}`);
    return ''; // unreachable — process.exit stops execution
  }
}

/**
 * `checkSimulation(argv)` — CLI entry point for `profile simulate-check`.
 * This is the name `_shared/lib/profile.cjs` dispatches `rest` to directly.
 */
function checkSimulation(argv) {
  const flags = parseFlags(argv || [], { spec: 'value', roles: 'value', json: 'bool' });
  if (!flags.spec) {
    usage('profile simulate-check requires --spec <path>');
    return;
  }
  if (!flags.roles) {
    usage('profile simulate-check requires --roles <csv>');
    return;
  }

  const ids = splitRolesCsv(flags.roles);
  if (ids.length === 0) {
    usage('profile simulate-check requires at least one role id in --roles');
    return;
  }

  const text = readSpecOrExit('simulate-check', flags.spec);

  let result;
  try {
    result = evaluateSimulation(text, ids);
  } catch (e) {
    process.stderr.write(`profile simulate-check: internal error: ${e.message}\n`);
    process.exit(2);
    return;
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.ok) {
    process.stdout.write(`profile simulate-check: pass (${ids.join(',')})\n`);
  } else {
    for (const f of result.findings) {
      process.stdout.write(`${f.code} ${f.role}: ${f.detail}\n`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  renderRoles,
  checkSimulation,
  renderRoleCards,
  evaluateSimulation,
  validateRoleIds,
  ROLE_CATALOGUE,
};
