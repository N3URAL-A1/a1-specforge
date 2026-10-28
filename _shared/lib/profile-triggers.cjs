'use strict';

// profile-triggers — spec 006-specforge-kritis-profile, Wave 7 (FR-007). Owns
// `profile trigger-check`: measures trigger-phrase collisions across installed
// skill descriptions under one or more `--skills-dir` trees, so the retired
// `specforge` alias's one trigger ("specforge") never competes with another
// skill's trigger.
//
// Exit contract (help-profile.cjs, already final): 0 every phrase has exactly
// one claimant and it is --expect / 1 a phrase has zero or more than one
// claimant, or the sole claimant is not --expect / 2 unreadable skills dir,
// oversized file (> 256 KiB), or internal error. Every exit-2 message is one
// stderr line, no stack trace.
//
// Request-scoped: `checkTriggers(rest)` takes argv only; `measureCollisions`
// below is pure given its inputs (skill dirs, phrases, expect) — no
// module-global mutable state. `profile trigger-check` is deliberately kept
// off every intent allowlist (spec 006 Wave 8 decision) and never parses
// `--phase`.

const fs = require('fs');
const path = require('path');

const USAGE = 'usage: a1-tools profile trigger-check --skills-dir <dir> [--skills-dir <dir> ...] '
  + '--phrase <text> [--phrase <text> ...] --expect <skill-name>';
const MAX_SKILL_MD_BYTES = 256 * 1024;
// The alias's own description names the product/repo "a1-specforge" as the one
// phrase a trigger match must not fire on, even though "specforge" is a
// substring of it (FR-007's named trap).
const EXCLUDE_SUBSTRING_OF = 'a1-specforge';

/** One stderr line, exit 2. Never a stack trace (house contract, item 6). */
function die(msg) {
  process.stderr.write(`profile trigger-check: ${msg}\n`);
  process.exit(2);
}

function usageExit(msg) {
  process.stderr.write(`profile trigger-check: ${msg}\n${USAGE}\n`);
  process.exit(1);
}

/** Minimal argv parser for this subcommand only: `--flag value`, repeatable. */
function parseArgs(argv) {
  const skillsDirs = [];
  const phrases = [];
  let expect = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--skills-dir') { skillsDirs.push(argv[i + 1]); i += 1; }
    else if (a === '--phrase') { phrases.push(argv[i + 1]); i += 1; }
    else if (a === '--expect') { expect = argv[i + 1]; i += 1; }
    else { usageExit(`unknown argument: ${a}`); }
  }
  return { skillsDirs, phrases, expect };
}

/**
 * The `description:` value of a SKILL.md's frontmatter, folded YAML `>` block
 * scalar supported (every real SKILL.md uses it; measured 2026-10-28).
 * Returns null when there is no frontmatter or no `description` key.
 * Deliberately NOT routed through io-frontmatter.cjs's parseFrontmatter: that
 * parser treats `description: >` as the two-character string literal ">" —
 * it has no folded-block-scalar support, only folded QUOTED scalars. This
 * reader is minimal and SKILL.md-specific; it is not a general YAML parser.
 */
function readDescription(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const fmLines = text.slice(4, end).split('\n');
  const i0 = fmLines.findIndex((l) => /^description:\s*(.*)$/.test(l));
  if (i0 === -1) return null;
  const m = fmLines[i0].match(/^description:\s*(.*)$/);
  const inline = m[1].trim();
  if (inline !== '' && inline !== '>' && inline !== '>-' && inline !== '|') {
    // Inline scalar on the same line (quoted or bare) — not the form any
    // real SKILL.md uses today, but handled rather than silently dropped.
    return inline.replace(/^["']|["']$/g, '');
  }
  // Folded/literal block scalar: every following indented, non-key line
  // belongs to it, joined with a single space (folded) until a line at
  // column 0 or a new top-level `key:` line ends it.
  const parts = [];
  for (let i = i0 + 1; i < fmLines.length; i += 1) {
    const line = fmLines[i];
    if (line === '' || /^\s/.test(line)) {
      if (line.trim() !== '') parts.push(line.trim());
      continue;
    }
    break;
  }
  return parts.join(' ');
}

function normalisePhrase(s) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** `realpath`-following read of every skill dir's SKILL.md directly under `dir`. Throws on an unsafe/unreadable dir. */
function readSkillDescriptions(dir) {
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch (e) {
    throw new Error(`--skills-dir ${dir} does not exist or cannot be resolved: ${e.code || e.message}`);
  }
  let entries;
  try {
    entries = fs.readdirSync(real, { withFileTypes: true });
  } catch (e) {
    throw new Error(`--skills-dir ${real} cannot be listed: ${e.code || e.message}`);
  }
  const out = [];
  for (const entry of entries) {
    // Follow symlinked skill dirs with realpath (contract: "symlinked skill
    // dirs followed with realpath"); a broken symlink or a non-directory
    // target is skipped, not a hard failure — one bad entry must not blind
    // the check to every other installed skill.
    const entryPath = path.join(real, entry.name);
    let entryReal;
    try {
      entryReal = fs.realpathSync(entryPath);
    } catch (_e) {
      continue;
    }
    let st;
    try {
      st = fs.statSync(entryReal);
    } catch (_e) {
      continue;
    }
    if (!st.isDirectory()) continue;
    const skillMd = path.join(entryReal, 'SKILL.md');
    let mdStat;
    try {
      mdStat = fs.lstatSync(skillMd);
    } catch (_e) {
      continue; // no SKILL.md in this dir — not a skill, not a claimant
    }
    if (mdStat.isSymbolicLink()) {
      // A symlinked SKILL.md inside an already-realpath'd skill dir would
      // only occur under a deliberately adversarial layout; refuse it
      // rather than silently following a second link.
      continue;
    }
    if (mdStat.size > MAX_SKILL_MD_BYTES) {
      throw new Error(`${skillMd} is ${mdStat.size} bytes, over the ${MAX_SKILL_MD_BYTES}-byte cap`);
    }
    const text = fs.readFileSync(skillMd, 'utf8');
    const description = readDescription(text);
    if (description === null || description === '') continue;
    out.push({ skill: entry.name, description });
  }
  return out;
}

/**
 * Pure: given the skill descriptions already read and the requested phrases,
 * returns `{ phrase, claimants[] }` per phrase. A skill "claims" a phrase
 * when its normalised description contains the normalised phrase as a
 * substring — EXCEPT when the phrase is itself a substring of
 * EXCLUDE_SUBSTRING_OF and every occurrence of the phrase in the description
 * falls inside an occurrence of EXCLUDE_SUBSTRING_OF (the FR-007 trap:
 * "specforge" inside "a1-specforge" must not count as a claim on its own).
 */
function measureCollisions(skills, phrases) {
  const normExclude = normalisePhrase(EXCLUDE_SUBSTRING_OF);
  return phrases.map((phrase) => {
    const normPhrase = normalisePhrase(phrase);
    const claimants = [];
    for (const { skill, description } of skills) {
      const normDesc = normalisePhrase(description);
      if (!normDesc.includes(normPhrase)) continue;
      if (normPhrase !== normExclude && normExclude.includes(normPhrase)) {
        // The phrase is a strict substring of the excluded name (e.g.
        // "specforge" inside "a1-specforge"). A claim only counts if the
        // description contains the phrase OUTSIDE every occurrence of the
        // excluded name — i.e. there is a standalone occurrence.
        const withoutExcluded = normDesc.split(normExclude).join(' '.repeat(normExclude.length));
        if (!withoutExcluded.includes(normPhrase)) continue;
      }
      claimants.push(skill);
    }
    return { phrase, claimants };
  });
}

/** `checkTriggers(rest)` — Wave 7 contract. CLI entry point for `profile trigger-check`. */
function checkTriggers(argv) {
  const { skillsDirs, phrases, expect } = parseArgs(argv);
  if (skillsDirs.length === 0) usageExit('at least one --skills-dir is required');
  if (phrases.length === 0) usageExit('at least one --phrase is required');
  if (!expect) usageExit('--expect is required');

  let skills;
  try {
    skills = skillsDirs.flatMap(readSkillDescriptions);
  } catch (e) {
    die((e && e.message) || String(e));
    return; // unreachable — die() calls process.exit(2)
  }

  const results = measureCollisions(skills, phrases);
  let ok = true;
  const lines = [];
  for (const { phrase, claimants } of results) {
    const unique = Array.from(new Set(claimants));
    if (unique.length === 1 && unique[0] === expect) {
      lines.push(`ok    "${phrase}" -> ${unique[0]}`);
    } else {
      ok = false;
      const who = unique.length === 0 ? '(no claimant)' : unique.join(', ');
      lines.push(`FAIL  "${phrase}" -> ${who} (expected exactly one claimant: ${expect})`);
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = ok ? 0 : 1;
}

module.exports = { checkTriggers, measureCollisions, readDescription, readSkillDescriptions };
