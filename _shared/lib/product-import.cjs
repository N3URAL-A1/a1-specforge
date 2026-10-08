'use strict';

// product import: legacy roadmap (HTML tasks / data.json) -> schema v1.

const fs = require('fs');
const path = require('path');
const { serializeNestedFrontmatter, parseFlags, fail, nowIso } = require('./io.cjs');
const { acquireReservationsLock, exitWithLock, failWithLock, writeAllOrNothing } = require('./locks.cjs');
const { usage } = require('./help.cjs');
const { PRODUCT_ROADMAP_KEY_ORDER, YYYY_MM_DD_RE } = require('./product-schema.cjs');
const { regenerateDerived } = require('./product-derived.cjs');
const { productDirFromFlags } = require('./product-txn.cjs');
const { validateRoadmapFm } = require('./product-validate.cjs');

// ---------------------------------------------------------------------------
// product import — migrate a legacy hand-rolled roadmap (either of the two
// observed shapes) into a valid schema-v1 docs/product/ROADMAP.md (FR-021,
// FR-022, SC-006, Wave 6).
//
// ONE code path handles both shapes (FR-021 AC: "via one code path, not one
// per consumer"): parseLegacyRoadmap() sniffs the shape, extracts a common
// intermediate representation (milestones + features + un-mappable notes),
// and a single normalizer turns that IR into schema-v1 frontmatter + body.
// Only the shape-specific EXTRACTION step branches; normalization, Appendix
// handling, and the write path are shared.
//
// Shape A — hand-written HTML (Niimo-style): a Frappe-Gantt page with a
//   `const tasks = [...]` JS array literal. Each task becomes one feature;
//   there is no milestone/status vocabulary in the source, so all tasks land
//   under one synthesized milestone and status is inferred from `progress`
//   (100 -> done, else planned) and `custom_class` (gate/active hints go to
//   the Appendix as free-text, since schema-v1 has no gate/blocker concept).
//
// Shape B — data.json + generator (A1/office-style): a JSON document with
//   `S4_phases.phases[].epics[].stories[]`. Each PHASE becomes one milestone;
//   each STORY becomes one feature (status mapped planned/doing/done ->
//   planned/in-flight/done). Story-point badges, epic groupings, and every
//   other S1/S2/S3/S5-S10 section (vision, live-status cards, SVG diagrams,
//   comparison tables, dispatch matrix, changelog) have no schema-v1 home and
//   are preserved verbatim in the Appendix (FR-022).
// ---------------------------------------------------------------------------

/** Detect which legacy shape `content` (already-read file text) matches.
 * Returns 'html-tasks' | 'data-json' | null (unrecognized). Pure. */
function detectLegacyRoadmapShape(content, filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.json') {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && parsed.S4_phases && Array.isArray(parsed.S4_phases.phases)) {
        return 'data-json';
      }
    } catch (_e) {
      // not valid JSON — fall through to null
    }
    return null;
  }
  if (/const\s+tasks\s*=\s*\[/.test(content)) {
    return 'html-tasks';
  }
  return null;
}

/** Extract a slug-safe id fragment from arbitrary source text (task id,
 * story text, …). Lowercases, strips non-alphanumerics to hyphens, trims
 * repeats/edges, and truncates so generated feature ids stay readable. */
function slugifyFragment(s, maxLen) {
  const slug = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLen || 40)
    // Truncation above can re-expose a trailing hyphen (or leave a
    // hyphen run) that the earlier trim already removed — trim again so
    // the result always satisfies FEATURE_ID_RE (###-kebab-slug, no
    // leading/trailing/doubled hyphens).
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

/** Best-effort, non-executing normalization of a JS object/array literal
 * into strict JSON text: quotes bare identifier keys (`id:` -> `"id":`) and
 * drops trailing commas before `]`/`}`. Pure text transformation — no
 * code execution, no eval/Function/vm. Deliberately conservative: it does
 * NOT attempt to handle single-quoted strings, comments, or nested
 * template literals; inputs using those shapes are expected to fail the
 * subsequent JSON.parse and be rejected by the caller rather than silently
 * mis-normalized. */
function normalizeJsLiteralToJson(literal) {
  return literal
    // Bare/unquoted object keys: {id: "x"} / , key: -> "key":. Only matches
    // keys that are plain identifiers directly after `{` or `,` (optionally
    // across whitespace/newlines), so it never touches string contents.
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3')
    // Trailing commas before a closing bracket/brace.
    .replace(/,(\s*[\]}])/g, '$1');
}

/** Extract the `const tasks = [ {...}, {...} ]` JS array literal from a
 * Frappe-Gantt-style HTML page as plain objects, without a JS parser
 * dependency and WITHOUT executing any code: isolates the bracketed
 * literal text via brace-matching, then parses it as JSON (falling back to
 * a whitelisted, regex-only normalization pass for the common non-JSON JS
 * literal shapes — unquoted keys, trailing commas — before re-attempting
 * JSON.parse). If the literal still can't be parsed as JSON after
 * normalization, this fails hard rather than falling back to eval/
 * Function/vm — arbitrary code execution on attacker-controlled HTML input
 * is not an acceptable fallback (see security review finding: `new
 * Function` previously allowed RCE via a crafted `data.json`/HTML import
 * file, e.g. an IIFE with `process.mainModule.require(...)` embedded in a
 * task name). */
function extractTasksArrayLiteral(html) {
  const startMatch = /const\s+tasks\s*=\s*(\[)/.exec(html);
  if (!startMatch) return [];
  let depth = 0;
  let i = startMatch.index + startMatch[0].length - 1; // position of the '['
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const literal = html.slice(start, i);

  try {
    return JSON.parse(literal);
  } catch (_e) {
    // Fall through to the whitelisted normalization pass below.
  }

  try {
    return JSON.parse(normalizeJsLiteralToJson(literal));
  } catch (_e) {
    fail(
      'product import: could not parse tasks array as JSON — unsupported HTML shape '
      + '(only JSON-compatible object/array literals are supported: double-quoted or '
      + 'bare-identifier keys, double-quoted string values, no comments, no computed '
      + 'values, no function calls)'
    );
  }
  return []; // unreachable — fail() exits the process
}

/** Shape A extraction: hand-written HTML (Niimo-style, Frappe-Gantt). Returns
 * the common IR: { milestones, features, appendixNotes }. */
function extractFromHtmlTasks(content, sourceLabel) {
  const tasks = extractTasksArrayLiteral(content);
  const titleMatch = /<title>([^<]*)<\/title>/.exec(content);
  const pageTitle = titleMatch ? titleMatch[1].trim() : 'Imported Roadmap';

  const milestoneId = 'migrated';
  const milestones = [{
    id: milestoneId,
    title: 'Migrated tasks',
    status: 'in-progress',
    target: null,
  }];

  const usedIds = new Set();
  const features = [];
  const appendixNotes = [];
  appendixNotes.push(`Source page title: ${pageTitle}`);

  tasks.forEach((t, idx) => {
    const baseSlug = slugifyFragment(t.id || t.name || `task-${idx + 1}`, 30);
    let slug = baseSlug;
    let n = 2;
    while (usedIds.has(slug)) { slug = `${baseSlug}-${n++}`; }
    usedIds.add(slug);
    const id = `${String(idx + 1).padStart(3, '0')}-${slug}`;

    const progress = typeof t.progress === 'number' ? t.progress : 0;
    const status = progress >= 100 ? 'done' : 'planned';
    const dependsOn = typeof t.dependencies === 'string' && t.dependencies.trim()
      ? t.dependencies.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    features.push({
      id,
      milestone: milestoneId,
      title: t.name || t.id || `Task ${idx + 1}`,
      status,
      stage: null,
      depends_on: [], // resolved to real feature ids in a second pass below
      started: typeof t.start === 'string' && YYYY_MM_DD_RE.test(t.start) ? t.start : null,
      finished: status === 'done' && typeof t.end === 'string' && YYYY_MM_DD_RE.test(t.end) ? t.end : null,
      spec_path: null,
      plan_path: null,
      _legacyTaskId: t.id || null,
      _legacyDependsOnRaw: dependsOn,
    });

    const extras = [];
    if (t.start || t.end) extras.push(`dates ${t.start || '?'} → ${t.end || '?'}`);
    if (t.custom_class) extras.push(`class=${t.custom_class}`);
    if (typeof t.progress === 'number' && t.progress !== 0 && t.progress !== 100) extras.push(`progress=${t.progress}%`);
    if (extras.length > 0) {
      appendixNotes.push(`**${id}** (${t.name || t.id}): ${extras.join(', ')}`);
    }
  });

  // Resolve legacy string dependency ids -> generated feature ids.
  const byLegacyId = new Map(features.map((f) => [f._legacyTaskId, f.id]));
  for (const f of features) {
    f.depends_on = f._legacyDependsOnRaw
      .map((legacyId) => byLegacyId.get(legacyId))
      .filter(Boolean);
    delete f._legacyTaskId;
    delete f._legacyDependsOnRaw;
  }

  // Legend/footer text has no schema home — preserve verbatim.
  const legendMatch = /<div class="legend">([\s\S]*?)<\/div>/.exec(content);
  if (legendMatch) {
    const legendText = legendMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (legendText) appendixNotes.push(`Legend: ${legendText}`);
  }
  const footerMatch = /<footer>([\s\S]*?)<\/footer>/.exec(content);
  if (footerMatch) {
    const footerText = footerMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (footerText) appendixNotes.push(`Footer note: ${footerText}`);
  }

  return {
    title: pageTitle,
    milestones,
    features,
    appendixNotes,
    source: `migrated from ${sourceLabel} (hand-written HTML, Frappe-Gantt)`,
  };
}

const DATAJSON_STORY_STATUS_MAP = { planned: 'planned', doing: 'in-flight', done: 'done' };

/** Shape B extraction: data.json + generator (A1/office-style). Returns the
 * common IR: { milestones, features, appendixNotes }. */
function extractFromDataJson(content, sourceLabel) {
  const data = JSON.parse(content);
  const pageTitle = (data.meta && data.meta.title) || 'Imported Roadmap';
  const phases = (data.S4_phases && data.S4_phases.phases) || [];

  const milestones = phases.map((p) => ({
    id: slugifyFragment(p.key || p.name, 20),
    title: p.name || p.key,
    status: 'planned',
    target: null,
  }));
  // If every story in a phase is done, the phase (milestone) is done; if any
  // story is doing/done, it's in-progress; otherwise it stays planned.
  phases.forEach((p, i) => {
    const stories = (p.epics || []).flatMap((e) => e.stories || []);
    const statuses = stories.map((s) => s.status);
    if (stories.length > 0 && statuses.every((s) => s === 'done')) milestones[i].status = 'done';
    else if (statuses.some((s) => s === 'done' || s === 'doing')) milestones[i].status = 'in-progress';
  });

  const usedIds = new Set();
  const features = [];
  const appendixNotes = [];
  appendixNotes.push(`Source document title: ${pageTitle} (${(data.meta && data.meta.version) || 'unversioned'})`);
  if (data.meta && data.meta.totalSP) appendixNotes.push(`Total story points (source): ${data.meta.totalSP} SP`);

  let featureSeq = 0;
  phases.forEach((p, pi) => {
    const milestoneId = milestones[pi].id;
    (p.epics || []).forEach((epic) => {
      const epicSpTotal = (epic.stories || []).reduce((a, s) => a + (s.sp || 0), 0);
      (epic.stories || []).forEach((story) => {
        featureSeq += 1;
        const baseSlug = slugifyFragment(story.text, 30);
        let slug = baseSlug;
        let n = 2;
        while (usedIds.has(slug)) { slug = `${baseSlug}-${n++}`; }
        usedIds.add(slug);
        const id = `${String(featureSeq).padStart(3, '0')}-${slug}`;
        const status = DATAJSON_STORY_STATUS_MAP[story.status] || 'planned';

        features.push({
          id,
          milestone: milestoneId,
          title: story.text,
          status,
          stage: null,
          depends_on: [],
          started: null,
          finished: null,
          spec_path: null,
          plan_path: null,
        });

        const extras = [`epic: ${epic.name}`, `agent: ${epic.agent || 'unassigned'}`, `${story.sp || 0} SP`];
        appendixNotes.push(`**${id}** (${story.text}): ${extras.join(', ')}`);
      });
      appendixNotes.push(`Epic "${epic.name}" total: ${epicSpTotal} SP, agent: ${epic.agent || 'unassigned'}`);
    });
  });

  // Whole sections with no schema-v1 home (vision, live-status, architecture
  // diagrams, EU-cloud comparison, repo-structure decisions, dispatch
  // matrix, next-steps, changelog) — preserve verbatim per-section (FR-022).
  const noHomeSections = [
    ['S1_vision', 'Vision'], ['S2_live', 'Was ist live'], ['S3_timeline', 'Timeline (SVG-rendered)'],
    ['S5_architecture', 'Architecture diagrams'], ['S6_eucloud', 'EU-Cloud comparison'],
    ['S7_repos', 'Repo-structure decisions'], ['S8_dispatch', 'Dispatch matrix'],
    ['S9_nextsteps', 'Next steps & open decisions'], ['S10_changelog', 'Source changelog'],
  ];
  for (const [key, label] of noHomeSections) {
    if (data[key]) {
      appendixNotes.push(`### ${label} (section \`${key}\`, verbatim JSON)\n\n\`\`\`json\n${JSON.stringify(data[key], null, 2)}\n\`\`\``);
    }
  }

  return {
    title: pageTitle,
    milestones,
    features,
    appendixNotes,
    source: `migrated from ${sourceLabel} (data.json + generator)`,
  };
}

/** ONE code path (FR-021): detect the legacy shape, extract via the
 * shape-specific extractor into a common IR, then normalize into schema-v1
 * roadmap frontmatter + body (with an Appendix section for un-mappable
 * content, FR-022). `project` is the target project slug (schema-v1
 * `project` field — distinct from any id/slug found in the source). Pure —
 * no I/O; caller handles file reads and the atomic write. Throws on an
 * unrecognized shape. */
function parseLegacyRoadmap(content, filePath, project) {
  const shape = detectLegacyRoadmapShape(content, filePath);
  if (!shape) {
    throw new Error(
      `unrecognized legacy roadmap shape in ${filePath} — expected either a hand-written HTML page ` +
      `with a Frappe-Gantt "const tasks = [...]" array, or a data.json with an "S4_phases.phases[]" array`
    );
  }

  const ir = shape === 'html-tasks'
    ? extractFromHtmlTasks(content, filePath)
    : extractFromDataJson(content, filePath);

  const today = nowIso().slice(0, 10);
  const roadmapFm = {
    schema_version: 1,
    type: 'roadmap',
    project,
    title: ir.title,
    status: 'active',
    updated: today,
    source: `${ir.source} (${today})`,
    milestones: ir.milestones,
    features: ir.features.map((f) => ({
      id: f.id, milestone: f.milestone, title: f.title, status: f.status, stage: f.stage,
      depends_on: f.depends_on, started: f.started, finished: f.finished,
      spec_path: f.spec_path, plan_path: f.plan_path,
    })),
    next: (() => {
      const firstEligible = ir.features.find((f) => f.status !== 'done' && f.status !== 'cancelled');
      return firstEligible ? firstEligible.id : null;
    })(),
  };

  const milestoneSections = ir.milestones.map((m) => {
    const feats = ir.features.filter((f) => f.milestone === m.id);
    const featLines = feats.map((f) => {
      const mark = f.status === 'done' ? 'x' : f.status === 'in-flight' ? '~' : ' ';
      const deps = f.depends_on.length > 0 ? ` (depends on: ${f.depends_on.join(', ')})` : '';
      return `- [${mark}] **${f.id}** — ${f.title}: migrated from legacy roadmap${deps}`;
    }).join('\n');
    return `### ${m.title} <!-- entry: ${m.id} -->\nStatus: ${m.status} · Target: ${m.target || 'unset'}\nGoal: migrated from legacy roadmap; goals were not explicit in the source.\n\n**Features:**\n${featLines || '(none)'}`;
  }).join('\n\n');

  const appendixBody = ir.appendixNotes.length > 0
    ? ir.appendixNotes.join('\n\n')
    : '(none)';

  const body = `\n# ${ir.title}\n\n> Migrated from a legacy roadmap format by \`a1-tools product import\`. Review milestone/feature titles and statuses for accuracy.\n\n## Milestones\n\n${milestoneSections}\n\n## In-flight features\n\nNone.\n\n## Changelog\n\n- **${today}** — roadmap migrated — ${ir.source}\n\n## Appendix — migrated details\n\n${appendixBody}\n`;

  return { roadmapFm, body, shape };
}

/** product import --file <path> --project <slug> [--title <t>] [--dir docs/product]:
 * migrate a legacy roadmap (hand-written HTML or data.json+generator shape,
 * auto-detected — FR-021) into a fresh schema-v1 docs/product/ROADMAP.md.
 * Un-mappable source content is preserved under '## Appendix — migrated
 * details' (FR-022). Validates its own output (SC-006 round-trip) before
 * writing — refuses (exit 1) if the generated frontmatter would fail
 * `product validate`. Writes through the same regenerateDerived +
 * writeAllOrNothing path as every other product-mutating command, so
 * index.json/NEXT.md regenerate correctly. Refuses to overwrite an existing
 * ROADMAP.md (same guard as `product init`) — mirrors its "not an update
 * command" contract. */
function cmdProductImport(args) {
  const flags = parseFlags(args, { file: 'value', project: 'value', title: 'value', dir: 'value' });
  if (!flags.file || !flags.project) {
    usage('product import requires --file <path-to-legacy-roadmap> --project <slug>');
  }
  const dir = productDirFromFlags(flags);
  const roadmapFile = path.join(dir, 'ROADMAP.md');
  // Source-file existence is not an overwrite guard on the locked target —
  // it's a precondition on the (unlocked, read-only) input path — so it can
  // stay ahead of the lock.
  if (!fs.existsSync(flags.file)) {
    fail(`product import: source file not found: ${flags.file}`);
  }

  const content = fs.readFileSync(flags.file, 'utf8');
  let parsed;
  try {
    parsed = parseLegacyRoadmap(content, flags.file, flags.project);
  } catch (e) {
    fail(`product import: ${e.message}`);
  }
  if (flags.title) parsed.roadmapFm.title = flags.title;

  const { valid, errors } = validateRoadmapFm(parsed.roadmapFm);
  if (!valid) {
    fail(`product import: generated ROADMAP.md would fail schema-v1 validation (internal bug — please report):\n${errors.join('\n')}`);
  }

  const lockFile = path.join(dir, '.product-stage.lock.json');
  const lockPath = acquireReservationsLock(lockFile);

  // Overwrite guard on the locked target MUST run inside the locked section
  // (TOCTOU fix): two concurrent `product import` runs could otherwise both
  // pass an existsSync check taken before either held the lock, and the
  // second to reach writeAllOrNothing would clobber the first's ROADMAP.md.
  if (fs.existsSync(roadmapFile)) {
    failWithLock(lockPath, `product import: ${roadmapFile} already exists — refusing to overwrite (use add-milestone/add-feature to extend, or start from an empty --dir)`);
  }

  const roadmapFmStr = serializeNestedFrontmatter(parsed.roadmapFm, PRODUCT_ROADMAP_KEY_ORDER);
  const roadmapContent = `---\n${roadmapFmStr}\n---\n${parsed.body}`;
  const { indexJson, nextMd } = regenerateDerived(dir, parsed.roadmapFm);

  const writes = [
    { target: roadmapFile, content: roadmapContent },
    { target: path.join(dir, 'index.json'), content: JSON.stringify(indexJson, null, 2) + '\n' },
    { target: path.join(dir, 'NEXT.md'), content: nextMd },
  ];
  writeAllOrNothing(lockPath, writes, 'product import');

  const out = {
    status: 'OK',
    shape_detected: parsed.shape,
    project: flags.project,
    milestones: parsed.roadmapFm.milestones.length,
    features: parsed.roadmapFm.features.length,
    files_written: writes.map((w) => w.target),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  exitWithLock(lockPath, 0);
}

module.exports = {
  cmdProductImport,
};
