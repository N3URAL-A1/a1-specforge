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

function resolveVaultPath(input) {
  if (path.isAbsolute(input)) return input;
  return path.join(vaultRoot(), input);
}

// ---------- frontmatter parser (line-based, minimal) ----------
// Supports: scalars (quoted/unquoted), null, [], block lists with "- ".
// Does NOT support nested objects.

function parseFrontmatter(content) {
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
// segments under <vault>/projects/. A hostile value like `../../etc` or an
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

// Central join for everything under <vault>/projects/. Every segment is
// validated — literals ('spec', 'fixes') pass trivially, user input cannot
// escape. Multi-segment literals ('a/b') are rejected by design: pass
// segments individually.
function projectsPath(...segments) {
  const safe = segments.map((s) => assertSafeSegment(s, 'projects path segment'));
  return path.join(vaultRoot(), 'projects', ...safe);
}

module.exports = { vaultRoot, resolveVaultPath, parseFrontmatter, serializeScalar, detectKeyOrder, serializeFrontmatter, readMd, writeMdAtomic, nowIso, writeTextAtomic, parseScalarToken, parseNestedFrontmatter, serializeNestedFrontmatter, writeNestedMdAtomic, parseFlags, fail, assertSafeSegment, projectsPath, copyDirRecursive };
