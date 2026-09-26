'use strict';

const fs = require('fs');
const path = require('path');

// SPEC_SIZES moved to status-constants.cjs (spec 010 W1): `schema export` exports it as size_values.
const { SPEC_STATUSES, SPEC_SIZES } = require('./status-constants.cjs');
const { usage } = require('./help.cjs');
const {
  resolveVaultPath,
  parseFlags,
  readMd,
  writeMdAtomic,
  writeTextAtomic,
  parseFrontmatter,
  serializeScalar,
  assertSafeSegment,
  nowIso,
  fail,
  projectsPath,
} = require('./io.cjs');

// ---------- spec init (spec 010, Wave 6, FR-017/FR-025) ----------

// The template the skill used to hand-fill; `spec init` is now its only writer.
const SPEC_TEMPLATE_PATH = path.join(
  __dirname, '..', '..', 'skills', 'a1-new-feature', 'templates', 'spec-template.md'
);
const SPEC_TITLE_MAX_CHARS = 200;
const FEATURE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Frontmatter lines the template carries as placeholders, filled by key so
// `type: spec` (and every other line) stays exactly where the template puts it.
const SPEC_INIT_FILL = Object.freeze({
  id: (v) => v.id,
  project: (v) => v.projectSlug,
  feature_slug: (v) => v.featureSlug,
  title: (v) => serializeScalar(v.title),
  status: () => 'discovering',
  size: (v) => serializeScalar(v.size),
  created: (v) => v.created,
});

function validateSpecTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') usage('spec init requires --title <t>');
  if (title.length > SPEC_TITLE_MAX_CHARS) {
    fail(`--title is longer than ${SPEC_TITLE_MAX_CHARS} characters (${title.length})`);
  }
  if (/[\r\n]/.test(title)) fail('--title must be a single line');
  return title;
}

function fillFrontmatterLine(line, v) {
  const m = line.match(/^([a-z_]+):/);
  const filler = m && SPEC_INIT_FILL[m[1]];
  return filler ? `${m[1]}: ${filler(v)}` : line;
}

/** Plain string substitution: frontmatter by key, body by placeholder token. */
function fillSpecTemplate(template, v) {
  const m = template.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`spec template has no frontmatter block: ${SPEC_TEMPLATE_PATH}`);
  const fm = m[1].split('\n').map((line) => fillFrontmatterLine(line, v)).join('\n');
  const body = m[2]
    .split('<###>').join(v.padded)
    .split('<feature-slug>').join(v.featureSlug)
    .split('<project-slug>').join(v.projectSlug)
    .split('<Working Title>').join(v.title);
  return `---\n${fm}\n---\n${body}`;
}

/** The FR-017 invariant, checked on the bytes about to be written: `type: spec`
 * is the first key and the file parses back to what was asked for. */
function assertSpecInitContent(content, v) {
  if (!content.startsWith('---\ntype: spec\n')) {
    throw new Error('spec template drift: `type: spec` is not the first frontmatter key');
  }
  const { fm } = parseFrontmatter(content);
  const want = { type: 'spec', id: v.id, project: v.projectSlug, status: 'discovering', title: v.title };
  for (const [k, expected] of Object.entries(want)) {
    if (fm[k] !== expected) {
      throw new Error(`spec init self-check failed: ${k}=${JSON.stringify(fm[k])}, want ${JSON.stringify(expected)}`);
    }
  }
}

/** A feature slug gets one spec: `spec init` refuses when any
 * `<###>-<feature-slug>.md` already exists, instead of silently taking the
 * next number and leaving two specs for one feature. */
function refuseExistingFeatureSlug(projectSlug, featureSlug) {
  const dir = projectsPath(projectSlug, 'spec');
  if (!fs.existsSync(dir)) return;
  const existing = fs.readdirSync(dir).find((f) => /^\d{3}-/.test(f) && f.slice(4) === `${featureSlug}.md`);
  if (existing) fail(`spec file already exists for feature slug "${featureSlug}": ${path.join(dir, existing)}`);
}

/** `spec init <project-slug> <feature-slug> --title <t> [--size S|M|L]` —
 * writes the template at the next number and links it from the hub (FR-025;
 * a missing hub is reported as `hub: "missing"`, never created). */
function cmdSpecInit(args) {
  const projectSlug = args[0];
  const featureSlug = args[1];
  if (!projectSlug || !featureSlug) usage('spec init requires <project-slug> <feature-slug> --title <t>');
  try {
    assertSafeSegment(projectSlug, 'project slug');
  } catch (e) {
    fail(e.message);
  }
  const flags = parseFlags(args.slice(2), { title: 'value', size: 'value' });
  if (!FEATURE_SLUG_RE.test(featureSlug)) {
    fail(`feature slug must be kebab-case [a-z0-9-] (got: ${JSON.stringify(featureSlug)})`);
  }
  const title = validateSpecTitle(flags.title);
  const size = flags.size === undefined ? null : flags.size;
  if (size !== null && !SPEC_SIZES.has(size)) usage(`invalid spec size "${size}". valid: S, M, L`);

  refuseExistingFeatureSlug(projectSlug, featureSlug);
  const { padded } = cmdSpecNextNumber([projectSlug]);
  const id = `${padded}-${featureSlug}`;
  const specPath = projectsPath(projectSlug, 'spec', `${id}.md`);
  if (fs.existsSync(specPath)) fail(`spec file already exists: ${specPath}`);
  const created = nowIso().slice(0, 10);
  const values = { id, padded, projectSlug, featureSlug, title, size, created };
  const content = fillSpecTemplate(fs.readFileSync(SPEC_TEMPLATE_PATH, 'utf8'), values);
  assertSpecInitContent(content, values);
  writeTextAtomic(specPath, content);

  // Spec authorship is host-agnostic (the file above is written on every
  // host); the hub note is not — a non-writer host leaves it alone (Wave 5).
  const notWriter = require('./vault-common.cjs').notWriterSkip('spec init hub link');
  const hub = notWriter
    ? { hub: 'skipped-non-writer', hub_path: null, line: null }
    : require('./vault-hub.cjs').linkHub(projectSlug, 'spec', id);
  return {
    spec_path: specPath, id, project: projectSlug, feature_slug: featureSlug, title,
    status: 'discovering', size, created,
    hub: hub.hub, hub_path: hub.hub_path, relation_line: hub.line,
  };
}

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

// FR-030 (spec 010 W7): the blockquote directly under the H1 carries a
// human-readable "Status: `…`" line (spec template, measured in 005). Only
// its FIRST line matching the OLD status is rewritten; a missing H1, a missing
// blockquote, or a header showing another status leaves the body untouched.
function rewriteBodyStatusHeader(body, oldStatus, newStatus) {
  if (typeof oldStatus !== 'string' || oldStatus === '' || oldStatus === newStatus) return body;
  const lines = body.split('\n');
  const h1 = lines.findIndex((l) => /^# /.test(l));
  if (h1 === -1) return body;
  let i = h1 + 1;
  while (i < lines.length && lines[i].trim() === '') i++;
  const needle = 'Status: `' + oldStatus + '`';
  for (; i < lines.length && lines[i].startsWith('>'); i++) {
    if (lines[i].includes(needle)) {
      const updated = lines[i].replace(needle, 'Status: `' + newStatus + '`');
      return [...lines.slice(0, i), updated, ...lines.slice(i + 1)].join('\n');
    }
  }
  return body;
}

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
  const { fm, body: originalBody } = readMd(specPath);
  const body = rewriteBodyStatusHeader(originalBody, fm.status, newStatus);
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
  // FR-031: name the reconciling command, never run it (the roadmap is not ours to write here).
  // Side-effect free (SC-002): only terminal targets look anything up, and the
  // vault root comes from the env var alone — vaultRoot() would create
  // .a1/learnings/ and announce itself on stderr in a vault-less repo.
  const coherence = require('./spec-coherence.cjs');
  const hint = coherence.TERMINAL_STATUSES.has(newStatus)
    ? coherence.roadmapHint({ specAbs: specPath, fm, newStatus, vaultRoot: process.env.A1_VAULT_ROOT || null })
    : null;
  if (hint) process.stderr.write(`${hint}\n`);
  return {
    spec_path: specPath,
    status: fm.status,
    phase_history: fm.phase_history,
    wave_plan_path: fm.wave_plan_path ?? null,
    verify_failures: fm.verify_failures ?? [],
  };
}

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
  cmdSpecInit,
  cmdSpecNextNumber,
  cmdSpecUpdateStatus,
  cmdSpecSetSize,
  cmdSpecList,
};
