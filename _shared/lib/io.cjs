'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- vault root resolution ----------

// Module-level once-flag: the status line is printed on the FIRST vaultRoot()
// call per process only. vaultRoot() is the single choke point for all ~32
// call sites (spec, fix, analyze, constitution, checklist, reconcile,
// modernize AND every wiki/-writing subcommand: postmortem, promote,
// write-suggestion). No per-subcommand status emission.
let _vaultRootAnnounced = false;

/**
 * Resolve the learning-store root via a 3-tier fallback chain. No silent
 * degradation: the chosen tier is always announced once per process to stderr.
 *
 * Precedence (env wins over repo-local, repo-local wins over legacy):
 *   Tier 1  A1_VAULT_ROOT env var      → used as-is (dir created on first write).
 *           Rob's machine keeps writing to ~/N3URAL-Vault ONLY via this env var.
 *   Tier 2  inside a git repo          → <repo>/.a1/learnings/ (auto-created).
 *           Always succeeds inside a repo — this is the OSS default.
 *   Tier 3  legacy ~/N3URAL-Vault      → ONLY if it already exists AND we are
 *           NOT inside a git repo. Emits a deprecation warning.
 *   none    not in a repo, no env, no legacy → hard-fail exit 2 (NO Tier 4).
 *
 * All stderr; never stdout (stdout is the JSON contract of the CLI).
 */
function vaultRoot() {
  let root;
  let source;

  // Tier 1 — explicit env var.
  if (process.env.A1_VAULT_ROOT) {
    root = process.env.A1_VAULT_ROOT;
    source = 'env';
  } else {
    // Tier 2 — repo-local, if inside a git repo (CWD-based).
    let repoTop = null;
    try {
      const { execSync } = require('child_process');
      repoTop = execSync('git rev-parse --show-toplevel', {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
    } catch (_e) {
      repoTop = null;
    }

    if (repoTop) {
      root = path.join(repoTop, '.a1', 'learnings');
      source = 'repo-local';
      if (!fs.existsSync(root)) {
        fs.mkdirSync(root, { recursive: true });
        process.stderr.write('[a1-tools] created .a1/learnings/\n');
      }
    } else {
      // Tier 3 — legacy vault, ONLY if it already exists and we are not in a repo.
      const legacy = path.join(os.homedir(), 'N3URAL-Vault');
      if (fs.existsSync(legacy)) {
        root = legacy;
        source = 'legacy';
        process.stderr.write(
          '[a1-tools] Using legacy vault ~/N3URAL-Vault — set A1_VAULT_ROOT or run inside a git repo for repo-local .a1/learnings/\n'
        );
      } else {
        // Nothing resolves — hard fail, no silent fallback.
        process.stderr.write(
          '[a1-tools] error: cannot resolve a learning-store root.\n' +
            '  Set A1_VAULT_ROOT to an explicit path, or run inside a git repo\n' +
            '  (repo-local .a1/learnings/ is used automatically there).\n'
        );
        process.exit(2);
      }
    }
  }

  if (!_vaultRootAnnounced) {
    _vaultRootAnnounced = true;
    process.stderr.write(
      `[a1-tools] learnings root: ${root} (source: ${source})\n`
    );
  }

  return root;
}

// ---------- code roots resolution ----------

// Same choke-point idea as vaultRoot(), for a different question. vaultRoot()
// answers "where do learning artifacts get WRITTEN"; codeRoots() answers "where
// do the project CHECKOUTS live" — the directories a1-evolve's collect phase
// globs for `*/.a1/learnings/`, `*/.a1/phases/*/observations.jsonl` and
// `*/.a1/packs/`. They are unrelated paths: on Rob's machine the store is
// ~/N3URAL-Vault (via A1_VAULT_ROOT) while the checkouts are ~/claude-projects.
let _codeRootsAnnounced = false;

/**
 * Resolve the directories that hold project checkouts, as an array of absolute
 * paths (most specific first). No silent degradation: the chosen tier is
 * announced once per process to stderr, like vaultRoot().
 *
 * Precedence:
 *   Tier 1  A1_CODE_ROOTS env var  → colon-separated list, used as-is.
 *           Only existing directories are kept; if none exist, that is an
 *           error, not a silent fall-through to autodetect.
 *   Tier 2  autodetect             → the first of ~/claude-projects, ~/code,
 *           ~/projects, ~/src, ~/repos, ~/dev that exists. All matches are
 *           returned, not just the first, so a split setup still works.
 *   Tier 3  the current git repo's parent directory — a sibling layout is the
 *           common case for a single-checkout machine.
 *   none    nothing resolves → empty array plus a loud stderr warning. The
 *           caller decides whether that is fatal; a collect phase that finds
 *           no roots must say so rather than report "0 learnings".
 *
 * Why this exists (2026-09-11): a1-evolve's collect globs were hardcoded to
 * ~/code, which does not exist on this machine — taken literally the 6th
 * synthesis run would have collected nothing while reporting success. Third
 * collect-scope defect in six runs, so the path got an owner instead of a
 * fourth hardcode.
 */
function codeRoots() {
  let roots = [];
  let source;

  if (process.env.A1_CODE_ROOTS) {
    // Absolute only. A relative entry passes statSync (resolved against the
    // CURRENT cwd) and then poisons every emitted glob, because a1-evolve's
    // collect phase changes directory between steps — the glob would silently
    // mean something different per step. The JSDoc promises absolute paths, so
    // deliver them: resolve first, and reject anything that was not absolute.
    const declared = process.env.A1_CODE_ROOTS.split(':')
      .map((d) => d.trim())
      .filter(Boolean);
    // Shell-hazardous characters. A DENYLIST, deliberately, not an allowlist:
    // no real project root contains `$`, a backtick, `;`, `|`, `&`, `<`, `>` or
    // a newline, while an allowlist would reject paths that are perfectly
    // legitimate on this machine (`Müller-Projekte`, `c++tools`, `foo@bar`) and
    // would then be disabled by whoever hits it. Defence in depth after SEC-1:
    // the primary control is that `glob-liveness.cjs` passes patterns as argv
    // rather than shell source, so nothing here is load-bearing for safety —
    // this is a legibility guard that says "your root looks like a command,
    // that is a config error" instead of letting it travel silently.
    // (a1-samuel-security SEC-5, 2026-09-12: "exists as a directory" was not a
    // sufficient boundary check for a value flowing into globs and mkdirSync.)
    const hazardous = declared.filter((d) => /[$`;|&<>\n\r]/.test(d));
    if (hazardous.length > 0) {
      process.stderr.write(
        `[a1-tools] error: A1_CODE_ROOTS entries must not contain shell metacharacters: ${hazardous.join(', ')}\n`
      );
      process.exit(2);
    }
    const relative = declared.filter((d) => !path.isAbsolute(d));
    if (relative.length > 0) {
      process.stderr.write(
        `[a1-tools] error: A1_CODE_ROOTS entries must be absolute paths: ${relative.join(', ')}\n`
      );
      process.exit(2);
    }
    roots = declared.filter((d) => {
      try {
        return fs.statSync(d).isDirectory();
      } catch (_e) {
        return false;
      }
    });
    source = 'env';
    if (roots.length === 0) {
      process.stderr.write(
        `[a1-tools] error: A1_CODE_ROOTS is set but none of its paths exist: ${declared.join(', ')}\n`
      );
      process.exit(2);
    }
  } else {
    const candidates = ['claude-projects', 'code', 'projects', 'src', 'repos', 'dev'];
    roots = candidates
      .map((c) => path.join(os.homedir(), c))
      .filter((d) => {
        try {
          return fs.statSync(d).isDirectory();
        } catch (_e) {
          return false;
        }
      });
    source = 'autodetect';

    if (roots.length === 0) {
      // Tier 3 — sibling layout relative to the current repo.
      try {
        const { execSync } = require('child_process');
        const top = execSync('git rev-parse --show-toplevel', {
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .toString()
          .trim();
        if (top) {
          roots = [path.dirname(top)];
          source = 'repo-parent';
        }
      } catch (_e) {
        /* not in a repo — fall through to the empty case */
      }
    }
  }

  if (!_codeRootsAnnounced) {
    _codeRootsAnnounced = true;
    if (roots.length === 0) {
      process.stderr.write(
        '[a1-tools] warning: no project roots resolved. Set A1_CODE_ROOTS\n' +
          '  (colon-separated) so cross-project collection can find checkouts.\n'
      );
    } else {
      process.stderr.write(
        `[a1-tools] code roots: ${roots.join(', ')} (source: ${source})\n`
      );
    }
  }

  return roots;
}

function resolveVaultPath(input) {
  if (path.isAbsolute(input)) return input;
  return path.join(vaultRoot(), input);
}

// ---------- frontmatter parser (line-based, minimal) ----------
// Supports: scalars (quoted/unquoted), null, [], block lists with "- ".
// Does NOT support nested objects.

function parseFrontmatter(content) {
  // Normalize CRLF first. Without this, a file saved on Windows starts with
  // '---\r\n', fails the startsWith check, and is reported as HAVING NO
  // FRONTMATTER — every field silently undefined, which reads downstream as
  // "undated entry" rather than as a parse error. Found 2026-09-11 while
  // testing the postmortem type filter; no CRLF file exists in the current
  // corpus, so this closes a latent blind spot rather than a live defect.
  // Normalizing the WHOLE document (body included) is deliberate, not a side
  // effect: writeMdAtomic and serializeFrontmatter hardcode '\n' and have never
  // been able to emit CRLF, so a CRLF file was already rewritten with LF on any
  // round-trip — before this fix it was rewritten WITH A SECOND, EMPTY
  // frontmatter wrapped around the original (measured in review 2026-09-11).
  // Nothing in the repo depends on byte-preserving round-trips through here:
  // `.raw` has no consumer outside this file, and the two places that do need
  // exact bytes (fix.cjs's agents.lock hashing, constitution.cjs's archive copy)
  // read with fs.readFileSync and bypass this parser entirely.
  if (content.indexOf('\r\n') !== -1) content = content.replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) {
    return { fm: {}, body: content, raw: '' };
  }
  const end = content.indexOf('\n---', 4);
  if (end === -1) {
    throw new Error('frontmatter has no closing "---"');
  }
  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, '');
  const fm = {};
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.startsWith('#')) {
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const valueRaw = m[2];
    if (valueRaw === '' || valueRaw === undefined) {
      const list = [];
      let j = i + 1;
      while (
        j < lines.length &&
        (lines[j].startsWith('  - ') || lines[j].startsWith('- '))
      ) {
        let item = lines[j].replace(/^\s*-\s*/, '');
        if (
          (item.startsWith('"') && item.endsWith('"')) ||
          (item.startsWith("'") && item.endsWith("'"))
        ) {
          try {
            if (item.startsWith('"')) item = JSON.parse(item);
            else item = item.slice(1, -1);
          } catch (_e) {
            item = item.slice(1, -1);
          }
        }
        list.push(item);
        j++;
      }
      if (list.length > 0) {
        fm[key] = list;
        i = j;
        continue;
      }
      fm[key] = null;
      i++;
      continue;
    }
    if (valueRaw === '[]') {
      fm[key] = [];
      i++;
      continue;
    }
    // Non-empty inline array. This parser has its own value handling (it does
    // not route through parseScalarToken), so the `[]`-only gap existed here
    // too and had to be closed in both places — see the note in
    // parseScalarToken for the two measured consequences.
    if (valueRaw.startsWith('[') && valueRaw.endsWith(']')
        && valueRaw.indexOf('[', 1) === -1) {
      const inner = valueRaw.slice(1, -1).trim();
      fm[key] = inner === ''
        ? []
        : inner.split(',').map((x) => parseScalarToken(x.trim()));
      i++;
      continue;
    }
    if (valueRaw === 'null') {
      fm[key] = null;
      i++;
      continue;
    }
    let v = valueRaw;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    fm[key] = v;
    i++;
  }
  return { fm, body, raw };
}

function serializeScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return JSON.stringify(v);
  if (v === '') return '""';
  if (/^[A-Za-z0-9._:/\-+@]+$/.test(v)) return v;
  return JSON.stringify(v);
}

// Stable key order for spec and bug frontmatter — known keys first, rest alphabetic.
const SPEC_KEY_ORDER = [
  'id',
  'project',
  'feature_slug',
  'title',
  'status',
  'created',
  'phase_history',
  'wave_plan_path',
  'verify_failures',
];

const BUG_KEY_ORDER = [
  'type',
  'project',
  'bug_slug',
  'title',
  'status',
  'severity',
  'reported_at',
  'reporter',
  'affected_repos',
  'related_deploy',
  'duplicate_of',
  'phase_history',
  'recommended_code_agent',
  'fix_commit',
  'verify_result',
  'tags',
];

const ANALYSIS_KEY_ORDER = [
  'type',
  'project',
  'focus',
  'title',
  'status',
  'created_at',
  'analyzed_path',
  'phase_history',
  'discover',
  'agents_dispatched',
  'findings',
  'findings_count',
  'suggested_next',
  'tags',
];

const CONSTITUTION_KEY_ORDER = [
  'type',
  'project',
  'title',
  'status',
  'version',
  'created_at',
  'last_written_at',
  'phase_history',
  'tags',
];

const RECONCILE_KEY_ORDER = [
  'type',
  'project',
  'title',
  'status',
  'scope_mode',
  'created_at',
  'date',
  'phase_history',
  'scope_targets',
  'parsed_targets',
  'stale_candidates',
  'parse_warnings',
  'agents_dispatched',
  'probe_notes',
  'drifts',
  'drifts_count',
  'in_sync_count',
  'skipped_projects',
  'suggested_next',
  'tags',
];

function detectKeyOrder(fm) {
  if (fm.type === 'bug-report') return BUG_KEY_ORDER;
  if (fm.type === 'project-analysis') return ANALYSIS_KEY_ORDER;
  if (fm.type === 'constitution') return CONSTITUTION_KEY_ORDER;
  if (fm.type === 'drift-report') return RECONCILE_KEY_ORDER;
  return SPEC_KEY_ORDER;
}

function serializeFrontmatter(fm) {
  const knownOrder = detectKeyOrder(fm);
  const keys = Object.keys(fm);
  const ordered = [];
  for (const k of knownOrder) if (keys.includes(k)) ordered.push(k);
  for (const k of keys.sort()) if (!ordered.includes(k)) ordered.push(k);

  const lines = [];
  for (const k of ordered) {
    const v = fm[k];
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) {
          lines.push(`  - ${serializeScalar(item)}`);
        }
      }
    } else {
      lines.push(`${k}: ${serializeScalar(v)}`);
    }
  }
  return lines.join('\n');
}

function readMd(p) {
  const content = fs.readFileSync(p, 'utf8');
  const parsed = parseFrontmatter(content);
  return { content, ...parsed };
}

function writeMdAtomic(p, fm, body) {
  const fmStr = serializeFrontmatter(fm);
  const out = `---\n${fmStr}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, out, 'utf8');
  fs.renameSync(tmp, p);
}

function nowIso() {
  return new Date().toISOString();
}

/** Write text content to `file` atomically (tmp-file + rename), mirroring
 * writeJsonAtomic's pattern but for plain markdown (ROADMAP.md, NEXT.md,
 * feature.md). Creates the parent dir if missing. */
function writeTextAtomic(file, content) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// product — nested-object-list frontmatter parser for docs/product/ROADMAP.md
// and docs/product/features/<###>-<slug>/feature.md (see docs/product/SCHEMA.md
// sections 1 and 2, binding contract).
//
// parseFrontmatter/serializeFrontmatter (above) are FLAT: they only handle
// scalars and simple string-list values ("- item"). ROADMAP.md's `milestones:`
// and `features:` keys are lists of YAML OBJECTS ("- id: foo\n  title: bar\n
// ..."), which the flat parser cannot represent. Rather than force-fit that
// shape into the existing parser, this is a small, purpose-built, tolerant
// parser for exactly this document family.
//
// Approach (line-based, indentation-driven, no external YAML dependency —
// consistent with the rest of this file):
//   1. Split the frontmatter block into lines.
//   2. A top-level key is a line matching `^key:` (0 leading spaces).
//   3. If the value after the colon is empty AND the following lines are
//      `  - key: value` (2-space indent, list-item marker), the key holds a
//      LIST OF OBJECTS: each `  - ` line starts a new object; subsequent
//      `    key: value` lines (4-space indent, no dash) are more fields of
//      the SAME object, until the next `  - ` or a dedent back to 0.
//   4. If instead the following lines are `  - value` (2-space indent, dash,
//      but the remainder does NOT look like `key: value`), it's a simple
//      string list (delegates to the same scalar rules as the flat parser).
//   5. Otherwise it's a plain scalar on the same line as the key.
// Scalars reuse the same quoting/null/number rules as serializeScalar so
// round-tripping (parse -> serialize -> parse) is lossless for every machine
// field defined in SCHEMA.md sections 1/2.
// ---------------------------------------------------------------------------

function parseScalarToken(raw) {
  if (raw === '' || raw === undefined) return null;
  if (raw === 'null') return null;
  if (raw === '[]') return [];
  // Non-empty inline arrays. Only `[]` was handled until 2026-09-11, so
  // `[a, b]` came back as the STRING "[a, b]" — silently, since a string is a
  // plausible-looking value. Two measured consequences: docs/product/ROADMAP.md
  // failed `product validate` with "features[1].depends_on: must be an array"
  // for two months, and every retro's `issues:`/`finding_classes:` field was
  // unreadable as a list, which is why a1-evolve's clustering had to re-parse
  // them out of the raw text with a regex instead of using the parser.
  // Quoted items are unwrapped via the same scalar rules (recursion depth 1 —
  // nested inline arrays are not YAML we emit, so `[[a]]` stays a string).
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    if (inner.indexOf('[') === -1 && inner.indexOf(']') === -1) {
      return inner.split(',').map((x) => parseScalarToken(x.trim()));
    }
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?[0-9]+$/.test(raw)) return parseInt(raw, 10);
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    try {
      if (raw.startsWith('"')) return JSON.parse(raw);
      return raw.slice(1, -1);
    } catch (_e) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

/** Parse a nested-object-list frontmatter block (ROADMAP.md / feature.md
 * shape). Returns { fm, body } where fm is a plain object whose values are
 * scalars, arrays of scalars, or arrays of flat objects. */
function parseNestedFrontmatter(content) {
  // Same CRLF normalization as parseFrontmatter (see the note there). Applied
  // here too so the fix is not half-done: this parser has 10+ call sites in
  // product.cjs (roadmap + phase frontmatter), where a CRLF file would have
  // parsed as {} — silently empty frontmatter, the exact latent class the flat
  // parser's fix closed.
  if (content.indexOf('\r\n') !== -1) content = content.replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) {
    return { fm: {}, body: content };
  }
  const end = content.indexOf('\n---', 4);
  if (end === -1) {
    throw new Error('frontmatter has no closing "---"');
  }
  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, '');
  const lines = raw.split('\n');
  const fm = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.startsWith('#')) {
      i++;
      continue;
    }
    const topMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!topMatch) {
      i++;
      continue;
    }
    const key = topMatch[1];
    const valueRaw = topMatch[2];

    if (valueRaw !== '') {
      fm[key] = parseScalarToken(valueRaw);
      i++;
      continue;
    }

    // Empty value on the key line: look ahead for a "  - " block.
    let j = i + 1;
    const listLines = [];
    while (j < lines.length && /^  - /.test(lines[j])) {
      // Collect this item: the "  - " line, plus any "    " continuation
      // lines (4-space indent, no dash) that belong to the same object. A
      // continuation line whose value is empty (e.g. "    depends_on:")
      // additionally absorbs a following run of "      - value" lines
      // (6-space indent) as a NESTED SCALAR ARRAY for that field — mirrors
      // serializeNestedFrontmatter's own emission shape for a list-valued
      // field inside an object-list item (see the `      - ` prefix there).
      // Without this, a non-empty depends_on (or any other nested array)
      // inside milestones[]/features[] fails to round-trip: the sub-list
      // lines don't match "    [A-Za-z_]" (they start with two extra spaces
      // then a dash) and were previously silently dropped, leaving the
      // field undefined.
      const itemLines = [lines[j].replace(/^  - /, '')];
      let k = j + 1;
      while (k < lines.length && /^    [A-Za-z_]/.test(lines[k])) {
        const contLine = lines[k].replace(/^    /, '');
        k++;
        const contMatch = contLine.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
        if (contMatch && contMatch[2] === '') {
          const subItems = [];
          while (k < lines.length && /^      - /.test(lines[k])) {
            subItems.push(parseScalarToken(lines[k].replace(/^      - /, '')));
            k++;
          }
          if (subItems.length > 0) {
            // Nested scalar array (e.g. "depends_on:\n      - a\n      - b"):
            // store as a pre-parsed marker object rather than a raw
            // "key: value" text line, since the array can't be losslessly
            // re-encoded as one such line for the generic line-regex parser
            // below to re-split.
            itemLines.push({ __nestedKey: contMatch[1], __nestedArray: subItems });
            continue;
          }
        }
        itemLines.push(contLine);
      }
      listLines.push(itemLines);
      j = k;
    }

    if (listLines.length === 0) {
      fm[key] = null;
      i++;
      continue;
    }

    // Decide: object-list (first sub-line looks like "key: value") vs
    // simple string list (first sub-line is a bare scalar).
    const firstItem = listLines[0][0];
    const looksLikeObject = /^[A-Za-z_][A-Za-z0-9_]*:\s?/.test(firstItem);

    if (looksLikeObject) {
      const objects = listLines.map((itemLines) => {
        const obj = {};
        for (const itemLine of itemLines) {
          if (typeof itemLine === 'object' && itemLine !== null && '__nestedKey' in itemLine) {
            // Nested scalar array marker (see the collection loop above) —
            // already fully parsed, just attach it under its key.
            obj[itemLine.__nestedKey] = itemLine.__nestedArray;
            continue;
          }
          const m = itemLine.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
          if (!m) continue;
          const k2 = m[1];
          let v2raw = m[2];
          if (v2raw === '[]') {
            obj[k2] = [];
          } else if (v2raw === '') {
            obj[k2] = null;
          } else {
            obj[k2] = parseScalarToken(v2raw);
          }
        }
        return obj;
      });
      fm[key] = objects;
    } else {
      fm[key] = listLines.map((itemLines) => parseScalarToken(itemLines[0]));
    }

    i = j;
  }

  return { fm, body };
}

/** Serialize a nested frontmatter object back to the ROADMAP.md/feature.md
 * YAML-subset shape. `keyOrder` is an array of key names controlling
 * emission order (unknown keys fall back to insertion order, appended at the
 * end) — callers pass PRODUCT_ROADMAP_KEY_ORDER / PRODUCT_FEATURE_KEY_ORDER. */
function serializeNestedFrontmatter(fm, keyOrder) {
  const keys = Object.keys(fm);
  const ordered = [];
  for (const k of keyOrder || []) if (keys.includes(k)) ordered.push(k);
  for (const k of keys) if (!ordered.includes(k)) ordered.push(k);

  const lines = [];
  for (const k of ordered) {
    const v = fm[k];
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
        continue;
      }
      const isObjectList = v.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
      if (isObjectList) {
        lines.push(`${k}:`);
        for (const obj of v) {
          const objKeys = Object.keys(obj);
          objKeys.forEach((ok, idx) => {
            const ov = obj[ok];
            const prefix = idx === 0 ? '  - ' : '    ';
            if (Array.isArray(ov)) {
              if (ov.length === 0) {
                lines.push(`${prefix}${ok}: []`);
              } else {
                lines.push(`${prefix}${ok}:`);
                for (const item of ov) lines.push(`      - ${serializeScalar(item)}`);
              }
            } else {
              lines.push(`${prefix}${ok}: ${serializeScalar(ov)}`);
            }
          });
        }
      } else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${serializeScalar(item)}`);
      }
    } else {
      lines.push(`${k}: ${serializeScalar(v)}`);
    }
  }
  return lines.join('\n');
}

function writeNestedMdAtomic(p, fm, body, keyOrder) {
  const fmStr = serializeNestedFrontmatter(fm, keyOrder);
  const out = `---\n${fmStr}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
  writeTextAtomic(p, out);
  return out;
}

// ---------- flag parser ----------

function parseFlags(args, knownFlags) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let matched = false;
    for (const [name, kind] of Object.entries(knownFlags)) {
      if (a === `--${name}`) {
        if (kind === 'bool') {
          flags[name] = true;
        } else {
          flags[name] = args[++i];
        }
        matched = true;
        break;
      }
      if (kind !== 'bool' && a.startsWith(`--${name}=`)) {
        flags[name] = a.slice(`--${name}=`.length);
        matched = true;
        break;
      }
    }
    if (!matched) flags._.push(a);
  }
  return flags;
}

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

// ---------- recursive copy ----------

// Recursively copies src into dest (creates dest, overwrites existing files).
// Used to mirror gitignored directory trees (e.g. pack staging, worktree
// learning-store mirroring) where a plain git checkout would not carry them.
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.statSync(s).isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ---------- path-traversal guard ----------

// User-supplied identifiers (project slugs, feature/analysis ids) become path
// segments under <vault>/project/. A hostile value like `../../etc` or an
// absolute path must fail loud instead of resolving outside the vault.
function assertSafeSegment(value, label) {
  const v = String(value == null ? '' : value);
  if (
    v === '' ||
    v === '.' ||
    v === '..' ||
    v.includes('/') ||
    v.includes('\\') ||
    v.includes('\0')
  ) {
    const err = new Error(
      `${label || 'path segment'} must be a plain identifier without path separators (got: ${JSON.stringify(v)})`
    );
    err.code = 'A1_INPUT'; // facade prints these as user errors, not internal
    throw err;
  }
  return v;
}

// Central join for everything under <vault>/project/. Every segment is
// validated — literals ('spec', 'fixes') pass trivially, user input cannot
// escape. Multi-segment literals ('a/b') are rejected by design: pass
// segments individually.
function projectsPath(...segments) {
  const safe = segments.map((s) => assertSafeSegment(s, 'projects path segment'));
  return path.join(vaultRoot(), 'project', ...safe);
}

module.exports = { vaultRoot, codeRoots, resolveVaultPath, parseFrontmatter, serializeScalar, detectKeyOrder, serializeFrontmatter, readMd, writeMdAtomic, nowIso, writeTextAtomic, parseScalarToken, parseNestedFrontmatter, serializeNestedFrontmatter, writeNestedMdAtomic, parseFlags, fail, assertSafeSegment, projectsPath, copyDirRecursive };
