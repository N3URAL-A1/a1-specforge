'use strict';

const fs = require('fs');
const path = require('path');

const { SPEC_STATUSES } = require('./status-constants.cjs');
const { usage } = require('./help.cjs');
const {
  vaultRoot,
  resolveVaultPath,
  parseFlags,
  readMd,
  writeMdAtomic,
  nowIso,
  fail,
  projectsPath,
} = require('./io.cjs');

function appendPhaseHistory(fm, phaseName) {
  if (!Array.isArray(fm.phase_history)) fm.phase_history = [];
  const entry = `phase=${phaseName} completed=${nowIso()}`;
  fm.phase_history = fm.phase_history.filter(
    (e) => !(typeof e === 'string' && e.startsWith(`phase=${phaseName} `))
  );
  fm.phase_history.push(entry);
}

// ---------- spec subcommands ----------

function cmdSpecNextNumber(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('spec next-number requires <project-slug>');
  const dir = projectsPath(projectSlug, 'spec');
  let max = 0;
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(/^(\d{3})-/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  const next = max + 1;
  return {
    project: projectSlug,
    next,
    padded: String(next).padStart(3, '0'),
    dir,
  };
}

const SPEC_STATUS_TO_PHASE = {
  draft: 'discover',
  clarified: 'specify+clarify',
  planned: 'plan',
  'awaiting-consistency-fix': 'consistency-gate-fail',
  implementing: null,
  done: 'implement+verify',
  cancelled: 'cancelled',
};

function cmdSpecUpdateStatus(args) {
  const specPathInput = args[0];
  const newStatus = args[1];
  if (!specPathInput || !newStatus) {
    usage('spec update-status requires <spec-path> <new-status>');
  }
  if (!SPEC_STATUSES.has(newStatus)) {
    usage(
      `invalid spec status "${newStatus}". valid: ${[...SPEC_STATUSES].join(', ')}`
    );
  }
  const flags = parseFlags(args.slice(2), {
    'wave-plan-path': 'value',
    'verify-failures-file': 'value',
    'clear-verify-failures': 'bool',
  });
  const specPath = resolveVaultPath(specPathInput);
  if (!fs.existsSync(specPath)) fail(`spec file not found: ${specPath}`);
  const { fm, body } = readMd(specPath);
  fm.status = newStatus;

  const completedPhase = SPEC_STATUS_TO_PHASE[newStatus];
  if (completedPhase) {
    for (const ph of completedPhase.split('+')) appendPhaseHistory(fm, ph);
  }

  if (flags['wave-plan-path'] !== undefined) {
    fm.wave_plan_path = flags['wave-plan-path'];
  }
  if (flags['clear-verify-failures'] || newStatus === 'done') {
    fm.verify_failures = [];
  }
  if (flags['verify-failures-file']) {
    const raw = fs.readFileSync(flags['verify-failures-file'], 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      fail(`verify-failures-file is not valid JSON: ${e.message}`);
    }
    if (!Array.isArray(parsed)) {
      fail('verify-failures-file must contain a JSON array');
    }
    fm.verify_failures = parsed.map((f) => JSON.stringify(f));
  }

  writeMdAtomic(specPath, fm, body);
  return {
    spec_path: specPath,
    status: fm.status,
    phase_history: fm.phase_history,
    wave_plan_path: fm.wave_plan_path ?? null,
    verify_failures: fm.verify_failures ?? [],
  };
}

const SPEC_SIZES = new Set(['S', 'M', 'L']);

// Writes the size-triage class (M12 fast path) into the spec frontmatter —
// the CLI is the only sanctioned frontmatter mutator (same rule as
// update-status; skills never Edit frontmatter directly).
function cmdSpecSetSize(args) {
  const specPathInput = args[0];
  const size = args[1];
  if (!specPathInput || !size) {
    usage('spec set-size requires <spec-path> <S|M|L>');
  }
  if (!SPEC_SIZES.has(size)) {
    usage(`invalid spec size "${size}". valid: S, M, L`);
  }
  const specPath = resolveVaultPath(specPathInput);
  if (!fs.existsSync(specPath)) fail(`spec file not found: ${specPath}`);
  const { fm, body } = readMd(specPath);
  fm.size = size;
  writeMdAtomic(specPath, fm, body);
  return { spec_path: specPath, size: fm.size };
}

function cmdSpecList(args) {
  const projectSlug = args[0];
  if (!projectSlug) usage('spec list requires <project-slug>');
  const flags = parseFlags(args.slice(1), { status: 'value' });
  const dir = projectsPath(projectSlug, 'spec');
  if (!fs.existsSync(dir)) {
    return { project: projectSlug, count: 0, specs: [] };
  }
  const specs = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.match(/^\d{3}-.+\.md$/)) continue;
    const full = path.join(dir, entry);
    let status = 'unknown';
    let title = entry;
    try {
      const { fm } = readMd(full);
      status = fm.status || 'unknown';
      title = fm.title || entry;
    } catch (_e) {
      // ignore
    }
    if (flags.status && status !== flags.status) continue;
    specs.push({ file: entry, path: full, status, title });
  }
  return { project: projectSlug, count: specs.length, specs };
}

module.exports = {
  appendPhaseHistory,
  cmdSpecNextNumber,
  cmdSpecUpdateStatus,
  cmdSpecSetSize,
  cmdSpecList,
};
