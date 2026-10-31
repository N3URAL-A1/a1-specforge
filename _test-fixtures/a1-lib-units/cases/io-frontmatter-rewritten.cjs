'use strict';

// io-frontmatter.cjs (flat parser) on vault notes that basic-memory re-dumped with
// PyYAML (`yaml.dump`: 80-column folding, unindented lists, `''` escapes). The
// fixtures under ../real/ come from real rewritten vault files (CONVENTIONS.md: never derive a fixture from the
// parser). Whole-file byte copies: specforge-locks-empty-lockfile-stolen.md (project/a1-specforge/fixes/2026-10-21-locks-empty-lockfile-stolen.md),
// specforge-verify-merge-check-review-minors.md (fixes/2026-10-22-verify-merge-check-review-minors.md).
// Byte-exact frontmatter excerpts (leading slice of the file): office-briefing-agent-def-id-mismatch.md
// (project/a1-office/fixes/2026-07-22-briefing-agent-def-id-mismatch.md), specforge-analysis-quality-findings.md
// (project/a1-specforge/analyses/2026-07-12-quality.md), specforge-postmortem-gnu-only-fixture-idioms.md
// (project/a1-specforge/postmortems/2026-10-28-gnu-only-fixture-idioms.md), office-wave-plan-lanes.md
// (project/a1-office/plans/067-claudia-invoice-intake-wave-plan.md, lines 1-35 plus a closing `---`). Bug report
// 2026-10-31-vault-frontmatter-rewrite-2.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { eq, check, done } = require('../lib.cjs');

const lib = process.argv[2];
const { parseFrontmatter, readMd, writeMdAtomic } = require(path.join(lib, 'io-frontmatter.cjs'));
const { parseNestedFrontmatter } = require(path.join(lib, 'io-nested-frontmatter.cjs'));
const real = (n) => fs.readFileSync(path.join(__dirname, '..', 'real', n), 'utf8');

// F1 — plain scalar folded onto an indented line (a1-office report, truncated title measured 2026-10-31).
// Red-making change: joinFoldedScalar returns early for unquoted values.
{
  const fm = parseFrontmatter(real('office-briefing-agent-def-id-mismatch.md')).fm;
  eq('F1 folded plain title joined with one space', fm.title,
    'Proaktive Agent-Läufe (Briefing) schlagen seit 5 Tagen silent fehl — agentId UUID statt Slug');
  eq('F1 fields after the fold are intact', [fm.status, fm.severity], ['fixed', 'blocker']);
}

// F2 — folded single-quoted scalar: joined, and the following keys are not swallowed.
{
  const fm = parseFrontmatter(real('office-briefing-agent-def-id-mismatch.md')).fm;
  eq('F2 folded single-quoted verify_result starts and ends whole',
    [fm.verify_result.startsWith('PR #100 gemergt (7b24e70), alle 10 CI-Checks grün (lint, tsc, unit 3773/3983'),
      fm.verify_result.endsWith('nächste Cron-Tick ein neues Briefing erfolgreich abschließt.'),
      fm.verify_result.indexOf('  ') === -1], [true, true, true]);
  eq('F2 key after it still parsed', fm.tags, ['bug', 'project/a1-office']);
}

// F3 — unindented list items read the same as the indented ones; folded plain title; permalink kept.
{
  const fm = parseFrontmatter(real('specforge-locks-empty-lockfile-stolen.md')).fm;
  eq('F3 title joined', fm.title,
    'acquireReservationsLock treats a just-created empty lock file as stale, so two processes can both hold the lock');
  eq('F3 unindented list', fm.affected_repos, ['a1-specforge']);
  eq('F3 unindented list 2', fm.tags, ['bug', 'project/a1-specforge']);
  eq('F3 phase_history item', fm.phase_history, ['phase=report completed=2026-10-20T22:30:00.000Z']);
  eq('F3 scalar after list', fm.permalink, 'vault/project/a1-specforge/fixes/2026-10-21-locks-empty-lockfile-stolen');
}

// F4 — the second shape: folded title AND folded reporter (value ends mid-sentence in the real file).
{
  const fm = parseFrontmatter(real('specforge-verify-merge-check-review-minors.md')).fm;
  eq('F4 title', fm.title, 'Spec 017 review follow-ups — verify/merge-check MINORs left open at merge of PR');
  eq('F4 reporter', fm.reporter, 'orchestrator (Reinhard round D, Samuel re-review, PR');
  eq('F4 null scalars', [fm.class_query, fm.root_site, fm.fix_commit], [null, null, null]);
}

// F5 — `''` inside a single-quoted scalar is one apostrophe.
{
  const fm = parseFrontmatter(real('specforge-postmortem-gnu-only-fixture-idioms.md')).fm;
  eq('F5 one_line_learning unescaped', fm.one_line_learning,
    "A guard written for the CI platform only is half a guard: it keeps the other platform's breakage invisible until somebody runs there.");
  eq('F5 unindented list', fm.root_cause_class, ['one-sided-guard', 'platform-portability']);
}

// F6 — the writer round-trips a read file without losing the joined values.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-fm-rewrite-'));
  try {
    const src = path.join(dir, 'report.md');
    fs.writeFileSync(src, real('specforge-verify-merge-check-review-minors.md'));
    const a = readMd(src);
    const out = path.join(dir, 'out.md');
    // writeMdAtomic asserts vault containment only when a vault root is set; none here.
    writeMdAtomic(out, a.fm, a.body);
    const b = readMd(out);
    eq('F6 title survives a write-back', b.fm.title, 'Spec 017 review follow-ups — verify/merge-check MINORs left open at merge of PR');
    const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    eq('F6 whole frontmatter equal after round trip (key order is the writer\'s)', sorted(b.fm), sorted(a.fm));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// F7 — the guard stays: the nested parser still rejects the unindented list (F-017, N2-N5 elsewhere).
check('F7 nested parser unchanged: still rejects a rewritten note', (() => {
  try { parseNestedFrontmatter(real('specforge-locks-empty-lockfile-stolen.md')); return false; } catch (_e) { return true; }
})());

// F8 — a plain value followed by a flow/blank shape is not over-joined.
{
  const fm = parseFrontmatter('---\na: x\nb: [1, 2]\nc: y\n\n---\n').fm;
  eq('F8 neighbouring keys untouched', [fm.a, fm.b, fm.c], ['x', [1, 2], 'y']);
}

// F9 — a single-quoted list item whose fold ends in an escaped `''` must not close early (real analysis note, item F-005).
// Red-making change: closing test `v.endsWith(q)` instead of counting the trailing quotes.
{
  const fm = parseFrontmatter(real('specforge-analysis-quality-findings.md')).fm;
  const f5 = fm.findings[4];
  eq('F9 fifteen findings, none merged or split', fm.findings.length, 15);
  eq('F9 F-005 item joined across the `\'\'` line end',
    [f5.includes("description=VISION.md's 'Creative directions (prioritized)' table ranks a1-dashboard"),
      f5.includes('shipped in M7/M8. The prioritization signal'),
      f5.endsWith('pointing to docs/roadmap.md as the authoritative sequencing.')], [true, true, true]);
}

// F10 - list-of-maps: the flat parser has no shape for it, so an item stops at a map-key continuation line (old
// reading kept). Excerpt = byte-exact leading slice of a real a1-office wave plan (`lanes:`).
// Red-making change: drop the `inList` map-key stop in joinFoldedScalar (item becomes "id: review waves: [1, 7, 8] owns:").
{
  const fm = parseFrontmatter(real('office-wave-plan-lanes.md')).fm;
  eq('F10 lanes keeps the pre-fix reading (item 1, first line only)', fm.lanes, ['id: review']);
  eq('F10 keys before it intact', [fm.type, fm.waves], ['wave-plan', '9']);
}

// F11 - an indented comment line ends a plain scalar.
{
  const fm = parseFrontmatter('---\na: x\n  # note\nb: y\n---\n').fm;
  eq('F11 comment not joined into the value', [fm.a, fm.b], ['x', 'y']);
}

// F12 - isClosedQuoted edge cases, driven through the real parser.
// Red-making change: drop trimEnd / the backslash-parity test.
{
  const rd = (v) => parseFrontmatter(`---\nk: ${v}\nz: end\n---\n`).fm;
  eq("F12 '' alone is closed (empty string)", [rd("''").k, rd("''").z], ['', 'end']);
  eq("F12 'a''' closes after the escaped pair + quote", rd("'a'''").k, "a'");
  eq('F12 "x\\"" is an escaped quote, so the fold continues', rd('"x\\"\n  tail"').k, 'x\\" tail');
  eq('F12 "x\\\\" (escaped backslash) is closed', [rd('"x\\\\"').k, rd('"x\\\\"').z], ['x\\\\', 'end']);
  eq('F12 trailing whitespace after the closing quote still closes (no join of the indented line)', rd("'a'   \n  more").k.includes('more'), false);
  eq("F12 '''' (one escaped apostrophe) is closed", rd("''''").k, "'");
}

done();
