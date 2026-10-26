'use strict';
// SC-007 helper: synthetic 11-milestone / 65-feature roadmap, 5 `product stage`
// runs with modules and 5 without; prints the median wall-clock difference in ms.
// Usage: node perf-run.cjs <a1-tools.cjs> <workdir>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [tools, work] = process.argv.slice(2);
const MILESTONES = 11;
const FEATURES = 65;
const MODULE_IDS = ['alpha', 'beta', 'gamma'];
const RUNS = 5;

function build(dir, tagged) {
  fs.mkdirSync(dir, { recursive: true });
  const L = ['---', 'schema_version: 1', 'type: roadmap', 'project: perf', 'title: perf — Roadmap',
    'status: active', 'updated: 2026-07-13', 'source: "perf fixture"'];
  if (tagged) L.push(`modules: [${MODULE_IDS.join(', ')}]`);
  L.push('milestones:');
  for (let m = 0; m < MILESTONES; m++) {
    L.push(`  - id: m${m}-ms`, `    title: Milestone ${m}`, '    status: in-progress', '    target: 2026-12');
    if (tagged) L.push(`    module: ${MODULE_IDS[m % MODULE_IDS.length]}`);
  }
  L.push('features:');
  const id = (i) => `${String(i + 1).padStart(3, '0')}-feat-${i}`;
  for (let i = 0; i < FEATURES; i++) {
    const deps = i > 0 && i % 2 === 0 ? [id(Math.max(0, i - 7))] : [];
    L.push(`  - id: ${id(i)}`, `    milestone: m${i % MILESTONES}-ms`, `    title: Feature ${i}`,
      '    status: planned', '    stage: null', `    depends_on: [${deps.join(', ')}]`,
      '    started: null', '    finished: null', '    spec_path: null', '    plan_path: null');
  }
  L.push('next: null', '---', '', '# perf', '', '## Changelog', '', '- **2026-07-13** — Created.', '');
  fs.writeFileSync(path.join(dir, 'ROADMAP.md'), L.join('\n'));
}

function timeStage(dir, i) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync('node', [tools, 'product', 'stage', '--by', `${String(i + 1).padStart(3, '0')}-feat-${i}`,
    '--set', 'started', '--dir', dir], { encoding: 'utf8' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (r.status !== 0) { process.stderr.write(r.stderr + r.stdout); process.exit(2); }
  return ms;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const withDir = path.join(work, 'with');
const withoutDir = path.join(work, 'without');
build(withDir, true);
build(withoutDir, false);
const withMs = []; const withoutMs = [];
for (let i = 0; i < RUNS; i++) { withMs.push(timeStage(withDir, i)); withoutMs.push(timeStage(withoutDir, i)); }
const modulesWritten = fs.existsSync(path.join(withDir, 'modules', 'alpha', 'ROADMAP.md'));
process.stdout.write(JSON.stringify({
  median_with: Math.round(median(withMs)), median_without: Math.round(median(withoutMs)),
  diff: Math.round(median(withMs) - median(withoutMs)), modulesWritten,
}) + '\n');
