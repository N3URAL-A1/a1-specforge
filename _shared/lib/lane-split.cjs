'use strict';

/**
 * lane-split — deterministic validation of a PLAN.md `lanes:` block.
 *
 * A phase may declare that several of its waves are independent enough to run
 * concurrently on separate agents ("lanes"). Getting that split wrong does not
 * surface as a failing test — it surfaces as a merge conflict or, worse, as two
 * agents cutting over the same production resource. So the split is checked
 * here by exit code, not by prompt judgement.
 *
 * Checks (all BLOCKER unless noted):
 *   1. owns-overlap      two lanes claim overlapping paths
 *   2. wave-coverage     a wave appears in two lanes, or in none
 *   3. cross-lane-dep    a lane's wave depends on another lane's wave
 *   4. cutover-in-lane   a lane contains a wave marked as cutover work
 *   5. schema            malformed lanes block (missing id/waves/owns)
 *
 * Exit codes: 0 = PASS, 1 = BLOCKER found, 2 = usage/parse error.
 */

const fs = require('fs');
const path = require('path');
const { parseFlags } = require('./io.cjs');
const { scopePathsOverlap } = require('./code-scope.cjs');

/** Wave-level markers that make a wave ineligible for a lane. Matched
 * case-insensitively against the wave heading and its task bodies. A wave that
 * switches DNS, cuts over a database, or flips a live ENV is single-lane by
 * nature — concurrency there buys risk, not speed. */
const CUTOVER_MARKERS = [
  'cutover',
  'dns-switch',
  'dns switch',
  'prod-cutover',
  'write-cutover',
  'contract-pr',
  'contract pr',
];

/** Extract the YAML frontmatter block from a markdown file. Returns '' when the
 * file has none — an absent frontmatter is not an error here, it just means no
 * lanes are declared. */
function frontmatterOf(text) {
  if (!text.startsWith('---')) return '';
  const end = text.indexOf('\n---', 3);
  if (end === -1) return '';
  return text.slice(3, end);
}

/**
 * Minimal parser for the `lanes:` block. Deliberately not a full YAML
 * implementation: the block's shape is fixed by the planner template, and
 * pulling in a YAML dependency for one nested list would be its own liability.
 * Anything that does not match the expected shape is reported as a schema
 * finding rather than silently skipped.
 */
function parseLanes(fm) {
  const lines = fm.split('\n');
  // `lanes: none` is the explicit "considered, not applicable" marker. For this
  // check it behaves exactly like an absent field: no split to validate, so
  // every wave runs sequentially and wave-coverage does not apply.
  if (lines.some((l) => /^lanes:\s*none\s*(#.*)?$/i.test(l))) {
    return { declared: false, lanes: [], sequentialAfter: [] };
  }
  const lanesIdx = lines.findIndex((l) => /^lanes:\s*(#.*)?$/.test(l));
  if (lanesIdx === -1) {
    return { declared: false, lanes: [], sequentialAfter: [] };
  }

  const lanes = [];
  let current = null;
  let i = lanesIdx + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // dedent — end of the lanes block
    if (line.trim() === '' || /^\s*#/.test(line)) continue;

    const itemMatch = line.match(/^\s*-\s+id:\s*(.+?)\s*$/);
    if (itemMatch) {
      if (current) lanes.push(current);
      current = { id: itemMatch[1].replace(/['"]/g, ''), waves: [], owns: [], agent: null };
      continue;
    }
    if (!current) continue;

    const wavesMatch = line.match(/^\s+waves:\s*\[(.*?)\]\s*$/);
    if (wavesMatch) {
      current.waves = wavesMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n));
      continue;
    }
    // Block-sequence form of `waves:` — also legal YAML, and reporting it as
    // "declares no waves" would blame the author for the wrong thing.
    const wavesBlock = line.match(/^(\s+)waves:\s*$/);
    if (wavesBlock) {
      const keyIndent = wavesBlock[1].length;
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j].match(/^(\s+)-\s*(\d+)\s*$/);
        if (!item || item[1].length <= keyIndent) break;
        current.waves.push(Number(item[2]));
        i = j;
      }
      continue;
    }
    const agentMatch = line.match(/^\s+agent:\s*(.+?)\s*$/);
    if (agentMatch) {
      current.agent = agentMatch[1].replace(/['"]/g, '');
      continue;
    }
    const ownsBlock = line.match(/^(\s+)owns:\s*$/);
    if (ownsBlock) {
      // Only consume list items indented DEEPER than the `owns:` key itself.
      // A `- id: <next>` sits at the lane-item indent, which is shallower —
      // without this guard the loop swallows the next lane and silently merges
      // two lanes into one.
      const ownsIndent = ownsBlock[1].length;
      for (let j = i + 1; j < lines.length; j++) {
        const ownLine = lines[j].match(/^(\s+)-\s*(.+?)\s*$/);
        if (!ownLine) break;
        // Same-indent items are legal YAML too, so depth alone cannot end the
        // list — but `- id: <next>` sits at that very indent. Stop on a new
        // lane item explicitly; otherwise two lanes silently merge into one.
        if (/^id:\s*/.test(ownLine[2])) break;
        if (ownLine[1].length < ownsIndent) break;
        current.owns.push(ownLine[2].replace(/['"]/g, ''));
        i = j;
      }
      continue;
    }
    const ownsInline = line.match(/^\s+owns:\s*\[(.*?)\]\s*$/);
    if (ownsInline) {
      current.owns = ownsInline[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean);
    }
  }
  if (current) lanes.push(current);

  const seqLine = lines.find((l) => /^sequential_after_lanes:\s*\[/.test(l));
  const sequentialAfter = seqLine
    ? seqLine
        .replace(/^sequential_after_lanes:\s*\[/, '')
        .replace(/\].*$/, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n))
    : [];

  return { declared: true, lanes, sequentialAfter };
}

/** Collect every wave heading in the plan body: number, title, and the body
 * text up to the next wave heading (used for cutover/dependency detection). */
function parseWaves(text) {
  const waves = [];
  // Tolerant of heading depth (## to ####) and of inline emphasis around the
  // token (`## **Wave 2** — name`). A heading this misses is not merely
  // skipped: its body is absorbed into the previous wave, which silently moves
  // findings to the wrong wave — or drops them, when the absorbing wave sits
  // in sequential_after_lanes where the lane checks do not apply.
  const re = /^#{2,4}\s+\**\s*Wave\s+(\d+)\s*\**\s*[—\-:]?\s*(.*)$/gim;
  const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    marks.push({ num: Number(m[1]), title: m[2].replace(/\**/g, '').trim(), start: m.index });
  }
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    waves.push({ ...marks[i], body: text.slice(marks[i].start, end) });
  }
  return waves;
}

/** Wave numbers this wave declares a dependency on. Recognises the established
 * `Depends on:` field; `Vorbedingung:` is NOT a field in this framework. */
function declaredDeps(waveBody) {
  const deps = new Set();
  // Accepts bold and plain form, singular and plural, and comma lists:
  //   **Depends on:** Wave 2 · Depends on: Waves 2, 3 · **Depends on:** Wave 3, 2
  // Every integer on the line counts — matching only `Wave <n>` tokens drops
  // each entry after the first, which disables the cross-lane check silently.
  const re = /\**Depends on:\**\s*(.+)/gi;
  let m;
  while ((m = re.exec(waveBody)) !== null) {
    const nums = m[1].match(/\d+/g) || [];
    nums.forEach((n) => deps.add(Number(n)));
  }
  return [...deps];
}

/** Cutover detection is lexical and therefore fallible in both directions —
 * a1-adam-auditor owns the judgement call for waves that touch a shared
 * production resource without saying so. To keep false positives low, only the
 * heading, task titles, and the Goal/Actions lines are searched: prose such as
 * "this wave is explicitly not part of the cutover" lives in the body and
 * should not trip the gate. */
function isCutoverWave(wave) {
  const signal = [wave.title]
    .concat(wave.body.split('\n').filter((l) => /^###\s|^\*\*(Goal|Actions):\*\*|^\d+\.\s/.test(l.trim())))
    .join('\n')
    .toLowerCase();
  return CUTOVER_MARKERS.some((marker) => signal.includes(marker));
}

function cmdLaneSplitCheck(args) {
  const flags = parseFlags(args, { plan: 'value' });
  if (!flags.plan) {
    // Deliberately not usage() — that exits 1, which is the "blockers found"
    // branch. An orchestrator would route a typo into a plan-revision loop
    // with no findings to act on. Usage errors are exit 2.
    process.stderr.write('usage: a1-tools lane-split check --plan <path/to/PLAN.md>\n');
    process.exit(2);
  }
  const planPath = path.resolve(flags.plan);
  if (!fs.existsSync(planPath)) {
    process.stderr.write(`lane-split: plan not found: ${planPath}\n`);
    process.exit(2);
  }

  const text = fs.readFileSync(planPath, 'utf8');
  const { declared, lanes, sequentialAfter } = parseLanes(frontmatterOf(text));
  const findings = [];

  if (!declared) {
    const out = {
      status: 'PASS',
      plan: planPath,
      lanes: 0,
      note: 'no lanes declared — phase runs sequentially (the default)',
      findings: [],
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(0);
  }

  // 5. schema
  lanes.forEach((lane, idx) => {
    if (!lane.id) findings.push({ check: 'schema', severity: 'BLOCKER', msg: `lane #${idx + 1} has no id` });
    if (!lane.waves.length) {
      findings.push({ check: 'schema', severity: 'BLOCKER', msg: `lane '${lane.id}' declares no waves` });
    }
    if (!lane.owns.length) {
      findings.push({ check: 'schema', severity: 'BLOCKER', msg: `lane '${lane.id}' declares no owns paths` });
    }
  });

  // 1. owns-overlap — pairwise, reusing the scope-reservation glob math
  for (let a = 0; a < lanes.length; a++) {
    for (let b = a + 1; b < lanes.length; b++) {
      for (const pa of lanes[a].owns) {
        for (const pb of lanes[b].owns) {
          if (scopePathsOverlap(pa, pb)) {
            findings.push({
              check: 'owns-overlap',
              severity: 'BLOCKER',
              msg: `lanes '${lanes[a].id}' and '${lanes[b].id}' both claim overlapping paths: '${pa}' vs '${pb}'`,
            });
          }
        }
      }
    }
  }

  // 2. wave-coverage — every wave in exactly one lane or in sequential_after_lanes
  const planWaves = parseWaves(text);
  // A wave can be claimed by several lanes (itself a finding). Keep every
  // claimant: collapsing to the last writer would hide the cross-lane
  // dependency check below, since both ends would resolve to the same lane.
  const claimants = new Map();
  for (const lane of lanes) {
    for (const w of lane.waves) {
      if (claimants.has(w)) {
        findings.push({
          check: 'wave-coverage',
          severity: 'BLOCKER',
          msg: `wave ${w} is claimed by both '${claimants.get(w)[0]}' and '${lane.id}'`,
        });
        claimants.get(w).push(lane.id);
      } else {
        claimants.set(w, [lane.id]);
      }
    }
  }
  const laneOf = new Map([...claimants].map(([w, ids]) => [w, ids[0]]));
  for (const wave of planWaves) {
    if (!laneOf.has(wave.num) && !sequentialAfter.includes(wave.num)) {
      findings.push({
        check: 'wave-coverage',
        severity: 'BLOCKER',
        msg: `wave ${wave.num} belongs to no lane and is not in sequential_after_lanes`,
      });
    }
  }
  // A wave a lane claims but that no heading in the body matches means the
  // parser and the author disagree about the plan's shape. Never treat that as
  // "nothing to check" — an unparsed wave takes its cutover and dependency
  // markers out of scope with it.
  const foundNums = new Set(planWaves.map((w) => w.num));
  for (const [num, ids] of claimants) {
    if (!foundNums.has(num)) {
      findings.push({
        check: 'schema',
        severity: 'BLOCKER',
        msg: `lane '${ids.join("'/'")}' claims wave ${num}, but no matching wave heading was found in the plan body`,
      });
    }
  }

  // 3. cross-lane-dep — compare against every claimant, so a doubly-claimed
  // wave cannot mask a genuine cross-lane edge.
  for (const wave of planWaves) {
    const owners = claimants.get(wave.num);
    if (!owners) continue;
    for (const dep of declaredDeps(wave.body)) {
      const depOwners = claimants.get(dep);
      if (!depOwners) continue;
      const crossing = depOwners.filter((d) => !owners.includes(d));
      for (const depOwner of crossing) {
        findings.push({
          check: 'cross-lane-dep',
          severity: 'BLOCKER',
          msg: `wave ${wave.num} (lane '${owners.join("'/'")}') depends on wave ${dep} (lane '${depOwner}')`,
        });
      }
    }
  }

  // 4. cutover-in-lane
  for (const wave of planWaves) {
    const owner = laneOf.get(wave.num);
    if (owner && isCutoverWave(wave)) {
      findings.push({
        check: 'cutover-in-lane',
        severity: 'BLOCKER',
        msg: `wave ${wave.num} ('${wave.title}') reads as cutover work but sits in lane '${owner}' — cutover waves are single-lane`,
      });
    }
  }

  const blockers = findings.filter((f) => f.severity === 'BLOCKER').length;
  const out = {
    status: blockers === 0 ? 'PASS' : 'FAIL',
    plan: planPath,
    lanes: lanes.length,
    waves_in_lanes: laneOf.size,
    sequential_after_lanes: sequentialAfter,
    blockers,
    findings,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(blockers === 0 ? 0 : 1);
}

module.exports = { cmdLaneSplitCheck, parseLanes, parseWaves, isCutoverWave, declaredDeps };
