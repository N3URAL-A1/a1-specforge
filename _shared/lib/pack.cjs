'use strict';

const fs = require('fs');
const path = require('path');
const { parseFlags, vaultRoot } = require('./io.cjs');

// ---------------------------------------------------------------------------
// pack — Gate-Pack system (ADR 2026-07-05-gate-pack-format).
//
// A pack is a versioned directory bundling battle-tested gate patterns so users
// import proven gates instead of collecting their own bugs. Trust model v1:
// curation over cryptography — no executable payloads (checks/ carries only
// parameter files for already-shipped CLI subcommands).
//
//   a1-tools pack validate <dir>
//       Validates pack.yaml manifest + every pattern file + checks/ safety.
//       Exit: 0 valid, 1 invalid (schema/field/unsafe-payload), 2 error (setup).
//
//   a1-tools pack import <dir> [--dest <repo>]
//       validate → copy to <repo>/.a1/packs/<name>/ → stops (never applies).
//       Re-import same version: idempotent (exit 0). Different version: replaces.
//
//   a1-tools pack export --patterns <id,..> --anonymize A2|A3 --out <dir>
//                        [--source <label>]
//       Builds a pack skeleton from Vault patterns.md entries. Enforces the
//       anonymization deny-regex — a hit in generated output → exit 1 (leak).
//       A3 additionally strips code blocks from diffs.
//
// pack.yaml (flat parser, reuses the frontmatter grammar — no YAML dependency).
// ---------------------------------------------------------------------------

const PACK_ANON_LEVELS = new Set(['A1', 'A2', 'A3']);
const PACK_TARGET_KINDS = new Set(['brief-line', 'gate-step', 'cli-check']);
// Deny-regex per ADR §3: project slugs, file paths, personal names, e-mails,
// vault paths, tenant names. A hit in exported output blocks the export.
const PACK_DENY_REGEX = /\/Users\/|N3URAL-Vault|@|n3ural|niimo/i;

// Parse a flat pack.yaml. Reuses parseFrontmatter's grammar by wrapping the
// body in "---" fences, then post-processes the two nested blocks the manifest
// needs (provenance{}, and the top-level scalar/list fields). No dependency.
function parsePackYaml(content) {
  // Nested objects (provenance) aren't handled by parseFrontmatter — parse the
  // manifest line-by-line with a one-level-deep indent model.
  const lines = content.split(/\r?\n/);
  const obj = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const valueRaw = m[2].trim();
    if (valueRaw === '') {
      // Could be a nested object (indented "key: val") or a block list ("- ").
      let j = i + 1;
      const nestedObj = {};
      const list = [];
      while (j < lines.length && /^\s+\S/.test(lines[j])) {
        const child = lines[j];
        const listM = child.match(/^\s*-\s*(.*)$/);
        const kvM = child.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
        if (listM) {
          list.push(unquotePackScalar(listM[1].trim()));
        } else if (kvM) {
          nestedObj[kvM[1]] = unquotePackScalar(kvM[2].trim());
        }
        j++;
      }
      if (list.length > 0) obj[key] = list;
      else if (Object.keys(nestedObj).length > 0) obj[key] = nestedObj;
      else obj[key] = null;
      i = j;
      continue;
    }
    obj[key] = parsePackInlineValue(valueRaw);
    i++;
  }
  return obj;
}

function unquotePackScalar(v) {
  if ((v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parsePackInlineValue(v) {
  if (v === '[]') return [];
  // Inline flow list: [a, b, c]
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => unquotePackScalar(s.trim()));
  }
  return unquotePackScalar(v);
}

// A pattern file is a YAML-ish document (frontmatter grammar) with a `diff` and
// `evidence_schema`. Parse the whole file as a manifest-style flat doc, but keep
// the raw text so multi-line block scalars (diff: |) can be recovered.
function parsePatternFile(content) {
  const obj = parsePackYaml(content);
  // Recover block scalar for `diff: |` — parsePackYaml gives it as null.
  const diffMatch = content.match(/^diff:\s*\|\s*\n([\s\S]*?)(?=^\S|\Z)/m);
  if (diffMatch) {
    obj.diff = diffMatch[1].replace(/\n+$/, '\n');
  }
  return obj;
}

function packValidateDir(dir) {
  const errors = [];
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return { ok: false, fatal: true, errors: [`pack dir not found: ${abs}`] };
  }
  const manifestPath = path.join(abs, 'pack.yaml');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, fatal: true, errors: [`missing pack.yaml in ${abs}`] };
  }

  let manifest;
  try {
    manifest = parsePackYaml(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { ok: false, fatal: true, errors: [`pack.yaml parse error: ${e.message}`] };
  }

  // Required manifest fields (ADR §2).
  const reqScalars = ['name', 'version', 'anonymization', 'requires_cli'];
  for (const k of reqScalars) {
    if (manifest[k] === undefined || manifest[k] === null || manifest[k] === '') {
      errors.push(`pack.yaml missing required field: ${k}`);
    }
  }
  if (manifest.version && !/^\d+\.\d+\.\d+$/.test(String(manifest.version))) {
    errors.push(`pack.yaml version "${manifest.version}" is not semver (MAJOR.MINOR.PATCH)`);
  }
  if (!Array.isArray(manifest.stacks) || manifest.stacks.length === 0) {
    errors.push('pack.yaml stacks[] must be a non-empty list');
  }
  if (manifest.anonymization && !PACK_ANON_LEVELS.has(String(manifest.anonymization))) {
    errors.push(`pack.yaml anonymization "${manifest.anonymization}" must be A1|A2|A3`);
  }
  const prov = manifest.provenance;
  if (!prov || typeof prov !== 'object' || Array.isArray(prov)) {
    errors.push('pack.yaml provenance{} missing or malformed');
  } else {
    for (const k of ['occurrences', 'severity', 'date_range', 'source']) {
      if (prov[k] === undefined || prov[k] === null || prov[k] === '') {
        errors.push(`pack.yaml provenance.${k} missing`);
      }
    }
  }
  if (!Array.isArray(manifest.patterns) || manifest.patterns.length === 0) {
    errors.push('pack.yaml patterns[] must be a non-empty list');
  }

  // Each listed pattern → file must exist with required fields.
  const listed = Array.isArray(manifest.patterns) ? manifest.patterns : [];
  for (const pid of listed) {
    const pf = path.join(abs, 'patterns', `${pid}.md`);
    if (!fs.existsSync(pf)) {
      errors.push(`pattern "${pid}" listed in manifest but patterns/${pid}.md missing`);
      continue;
    }
    let pat;
    try {
      pat = parsePatternFile(fs.readFileSync(pf, 'utf8'));
    } catch (e) {
      errors.push(`patterns/${pid}.md parse error: ${e.message}`);
      continue;
    }
    for (const k of ['id', 'class', 'trigger_signature', 'diff', 'evidence_schema']) {
      if (pat[k] === undefined || pat[k] === null || pat[k] === '') {
        errors.push(`patterns/${pid}.md missing required field: ${k}`);
      }
    }
    if (pat.id && String(pat.id) !== String(pid)) {
      errors.push(`patterns/${pid}.md id "${pat.id}" does not match filename "${pid}"`);
    }
    const tgt = pat.target;
    if (!tgt || typeof tgt !== 'object' || Array.isArray(tgt)) {
      errors.push(`patterns/${pid}.md target{} missing or malformed`);
    } else {
      if (!tgt.kind || !PACK_TARGET_KINDS.has(String(tgt.kind))) {
        errors.push(`patterns/${pid}.md target.kind "${tgt.kind}" must be brief-line|gate-step|cli-check`);
      }
      for (const k of ['skill', 'anchor']) {
        if (tgt[k] === undefined || tgt[k] === null || tgt[k] === '') {
          errors.push(`patterns/${pid}.md target.${k} missing`);
        }
      }
    }
  }

  // Also flag orphan pattern files not listed in the manifest.
  const patternsDir = path.join(abs, 'patterns');
  if (fs.existsSync(patternsDir)) {
    for (const entry of fs.readdirSync(patternsDir)) {
      if (!entry.endsWith('.md')) continue;
      const pid = entry.slice(0, -3);
      if (!listed.includes(pid)) {
        errors.push(`patterns/${entry} present but not listed in manifest patterns[]`);
      }
    }
  }

  // checks/ may ONLY contain parameter files — no executable payloads (ADR §5).
  const checksDir = path.join(abs, 'checks');
  if (fs.existsSync(checksDir)) {
    for (const entry of fs.readdirSync(checksDir)) {
      const full = path.join(checksDir, entry);
      if (fs.statSync(full).isDirectory()) {
        errors.push(`checks/${entry}/ — subdirectories not allowed in checks/`);
        continue;
      }
      const isParam = entry.endsWith('.json') || entry.endsWith('.args.json');
      if (!isParam) {
        errors.push(`checks/${entry} — only .json/.args.json parameter files allowed (no executable payloads)`);
      }
    }
  }

  return { ok: errors.length === 0, fatal: false, errors, manifest };
}

function cmdPackValidate(rest) {
  const dir = rest[0];
  if (!dir) {
    process.stderr.write('usage: pack validate <dir>\n');
    process.exit(1);
  }
  const res = packValidateDir(dir);
  if (res.fatal) {
    for (const e of res.errors) process.stderr.write(`error: ${e}\n`);
    process.exit(2);
  }
  if (res.ok) {
    process.stdout.write(`pack: VALID — ${res.manifest.name}@${res.manifest.version} (${(res.manifest.patterns || []).length} patterns)\n`);
    process.exit(0);
  }
  process.stderr.write(`pack: INVALID — ${res.errors.length} problem(s):\n`);
  for (const e of res.errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.statSync(s).isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rmDirRecursive(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function cmdPackImport(rest) {
  const flags = parseFlags(rest, { dest: 'value' });
  const dir = flags._[0];
  if (!dir) {
    process.stderr.write('usage: pack import <dir> [--dest <repo>]\n');
    process.exit(1);
  }
  const res = packValidateDir(dir);
  if (res.fatal) {
    for (const e of res.errors) process.stderr.write(`error: ${e}\n`);
    process.exit(2);
  }
  if (!res.ok) {
    process.stderr.write(`pack: INVALID — refusing import (${res.errors.length} problem(s)):\n`);
    for (const e of res.errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  const name = String(res.manifest.name);
  const version = String(res.manifest.version);
  const destRepo = path.resolve(flags.dest || process.cwd());
  const stagedDir = path.join(destRepo, '.a1', 'packs', name);

  let note = 'staged';
  if (fs.existsSync(stagedDir)) {
    const existingManifest = path.join(stagedDir, 'pack.yaml');
    let existingVersion = null;
    if (fs.existsSync(existingManifest)) {
      try {
        existingVersion = String(parsePackYaml(fs.readFileSync(existingManifest, 'utf8')).version);
      } catch (_e) {}
    }
    if (existingVersion === version) {
      // Idempotent re-import of same version.
      process.stdout.write(`pack ${name}@${version} already staged at ${stagedDir} — idempotent, apply via a1-evolve\n`);
      process.exit(0);
    }
    note = `replaced ${existingVersion || 'unknown'} → ${version}`;
    rmDirRecursive(stagedDir);
  }
  copyDirRecursive(path.resolve(dir), stagedDir);
  process.stdout.write(`pack ${name}@${version} staged at ${stagedDir} (${note}), apply via a1-evolve\n`);
  process.exit(0);
}

// Parse the Vault patterns.md "Applied" + "Monitoring" tables into records so
// export can build a pack skeleton from real corpus entries.
function parseVaultPatternsTable(content) {
  const records = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    // Applied table rows: | pattern | × | target | synthese |
    const row = line.match(/^\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (row) {
      let id = row[1].replace(/\*\*/g, '').trim();
      if (id === 'Pattern' || id.startsWith('---')) continue;
      const occ = parseInt(row[2].replace(/\*\*/g, ''), 10);
      const target = row[3].replace(/\*\*/g, '').trim();
      if (!id || isNaN(occ)) continue;
      records[id] = { id, occurrences: occ, target_file: target };
    }
    // Monitoring/watch rows: "- pattern_name (N) — description"
    const watch = line.match(/^-\s+([a-z_][a-z0-9_]*)\s*\((\d+)\)\s*(?:—\s*(.*))?$/);
    if (watch) {
      const id = watch[1];
      const occ = parseInt(watch[2], 10);
      if (!records[id]) {
        records[id] = { id, occurrences: occ, target_file: '', note: (watch[3] || '').trim() };
      }
    }
  }
  return records;
}

function cmdPackExport(rest) {
  const flags = parseFlags(rest, {
    patterns: 'value',
    anonymize: 'value',
    out: 'value',
    source: 'value',
  });
  if (!flags.patterns || !flags.anonymize || !flags.out) {
    process.stderr.write('usage: pack export --patterns <id,..> --anonymize A2|A3 --out <dir> [--source <label>]\n');
    process.exit(1);
  }
  if (!PACK_ANON_LEVELS.has(flags.anonymize)) {
    process.stderr.write(`error: --anonymize "${flags.anonymize}" must be A1|A2|A3 (export requires A2 or A3)\n`);
    process.exit(1);
  }
  const anon = flags.anonymize;
  const ids = flags.patterns.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    process.stderr.write('error: --patterns produced no ids\n');
    process.exit(1);
  }

  const patternsMd = path.join(vaultRoot(), 'pattern', 'a1-learnings', 'patterns.md');
  if (!fs.existsSync(patternsMd)) {
    process.stderr.write(`error: Vault patterns.md not found: ${patternsMd}\n`);
    process.exit(2);
  }
  const corpus = parseVaultPatternsTable(fs.readFileSync(patternsMd, 'utf8'));

  const missing = ids.filter((id) => !corpus[id]);
  if (missing.length > 0) {
    process.stderr.write(`error: pattern id(s) not found in Vault patterns.md: ${missing.join(', ')}\n`);
    process.exit(1);
  }

  const outDir = path.resolve(flags.out);
  const packName = path.basename(outDir);
  const source = flags.source || 'a1-office (anonymized)';

  // Build pattern files + manifest in memory, then run the deny-regex over the
  // FULL generated output. A hit → exit 1 listing the leak (before any write).
  const patternFiles = {};
  let totalOcc = 0;
  const stacks = new Set();
  for (const id of ids) {
    const rec = corpus[id];
    totalOcc += rec.occurrences;
    let diffText = rec.note || rec.target_file || `Gate derived from pattern ${id} (${rec.occurrences}×).`;
    if (anon === 'A3') {
      // A3: mechanism-only — strip fenced code blocks from diffs.
      diffText = diffText.replace(/```[\s\S]*?```/g, '[code stripped: A3]');
    }
    const pf = [
      `id: ${id}`,
      `class: ${id}`,
      `trigger_signature: "corpus pattern ${id}"`,
      'target:',
      '  kind: gate-step',
      '  skill: a1-new-feature',
      `  anchor: "${rec.target_file || 'Gate'}"`,
      'diff: |',
      `  ${diffText.replace(/\n/g, '\n  ')}`,
      'evidence_schema: "grep + CLI check output"',
      '',
    ].join('\n');
    patternFiles[id] = pf;
  }
  stacks.add('generic');

  const manifest = [
    `name: ${packName}`,
    'version: 0.1.0',
    `stacks: [${[...stacks].join(', ')}]`,
    'provenance:',
    `  occurrences: ${totalOcc}`,
    '  severity: unknown',
    '  date_range: unknown',
    `  source: ${source}`,
    `anonymization: ${anon}`,
    `patterns: [${ids.join(', ')}]`,
    'requires_cli: ">=1.4"',
    '',
  ].join('\n');

  // Deny-regex scan across all generated content.
  const scanTargets = [{ file: 'pack.yaml', text: manifest }];
  for (const id of ids) scanTargets.push({ file: `patterns/${id}.md`, text: patternFiles[id] });
  const leaks = [];
  for (const t of scanTargets) {
    for (const line of t.text.split('\n')) {
      const m = line.match(PACK_DENY_REGEX);
      if (m) leaks.push(`${t.file}: "${line.trim()}" (matched /${m[0]}/)`);
    }
  }
  if (leaks.length > 0) {
    process.stderr.write(`pack export: ANONYMIZATION FAILURE — ${leaks.length} leak(s), refusing to write:\n`);
    for (const l of leaks) process.stderr.write(`  - ${l}\n`);
    process.exit(1);
  }

  // Clean; write.
  fs.mkdirSync(path.join(outDir, 'patterns'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'pack.yaml'), manifest, 'utf8');
  for (const id of ids) {
    fs.writeFileSync(path.join(outDir, 'patterns', `${id}.md`), patternFiles[id], 'utf8');
  }
  process.stdout.write(`pack exported: ${packName} (${ids.length} patterns, ${anon}) → ${outDir}\n`);
  process.exit(0);
}

module.exports = { cmdPackValidate, cmdPackImport, cmdPackExport };
