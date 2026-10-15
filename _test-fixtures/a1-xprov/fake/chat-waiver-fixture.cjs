'use strict';

// Test-only builder for part 24 (spec 016 wave 3). It never requires the code under test (testing.md class 4): it copies REAL files
// (cases/chat-waiver/, see PROVENANCE.meta) into a fixture phase and adapts only what must point at the fixture repository:
// plan_sha256 of every row, result_path of every row, plan_sha256 inside the pass run dir. Everything else stays as measured.
//
//   node chat-waiver-fixture.cjs '<json>'      json: { cmd, repo, home, cases, ... }
//   build   { sets: ['plan','wave'] }   writes xreview/index.json (rows of the sets) + the run dirs under <home>/.a1-xprov/artifacts/<repo basename>/
//   add     { sets: [...] }             appends the rows (and run dirs) of more sets to the existing index
//   rewrite { file: 'row', index, field, value }   sets one field of one index row (a forged or tampered row)
//   retitle { run, title }              replaces the first BLOCKER title of a run's a1-findings.json and the row's findings_sha256
//   files   {}                          writes the two gitleaks-hit files of the masked report into the repo (src/config/…)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const a = JSON.parse(process.argv[2]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const phaseDir = path.join(a.repo, '.a1', 'phases', a.phase || 'p24');
const indexPath = path.join(phaseDir, 'xreview', 'index.json');
const artifacts = path.join(a.home, '.a1-xprov', 'artifacts', path.basename(a.repo));
const planSha = () => sha(fs.readFileSync(path.join(phaseDir, 'PLAN.md')));
const runName = (row) => (typeof row.result_path === 'string' ? path.basename(path.dirname(row.result_path)).replace(/^claudex-/, '') : null);

function rowsOf(set) {
  const f = set === 'plan' ? 'plan.index.json' : 'wave.index.json';
  return read(path.join(a.cases, f)).filter((r) => r.waived !== true && typeof r.verdict === 'string' && (set === 'plan' ? r.gate === 'plan-review-xprov' : r.gate === 'wave-inspect-xprov'));
}

function install(row, sha256) {
  const name = runName(row);
  const src = path.join(a.cases, 'runs', name);
  const hasRun = fs.existsSync(src);
  const runDir = path.join(artifacts, `claudex-${name}`);
  if (hasRun) {
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(runDir, f));
    // the pass run dir names the PLAN.md it approved: adapt it to the fixture plan (a1-pass.json and result.json)
    for (const f of ['result.json', 'a1-pass.json']) {
      const p = path.join(runDir, f);
      if (fs.existsSync(p)) { const j = read(p); if (j.plan_sha256) { j.plan_sha256 = sha256; fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`); } }
    }
  }
  return { ...row, plan_sha256: sha256, result_path: path.join(runDir, 'result.json') };
}

function build(sets, keep) {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const sha256 = planSha();
  const rows = sets.flatMap((s) => rowsOf(s).map((r) => install(r, sha256)));
  const old = keep && fs.existsSync(indexPath) ? read(indexPath) : [];
  fs.writeFileSync(indexPath, `${JSON.stringify([...old, ...rows], null, 2)}\n`);
  console.log(JSON.stringify({ rows: rows.length, plan_sha256: sha256 }));
}

if (a.cmd === 'build') build(a.sets, false);
else if (a.cmd === 'add') build(a.sets, true);
else if (a.cmd === 'rewrite') {
  const idx = read(indexPath);
  const i = idx.findIndex((r) => r.gate === a.gate && String(r.wave) === String(a.wave) && String(r.round) === String(a.round));
  if (i < 0) { console.error('no such row'); process.exit(3); }
  idx[i] = { ...idx[i], [a.field]: a.value };
  fs.writeFileSync(indexPath, `${JSON.stringify(idx, null, 2)}\n`);
} else if (a.cmd === 'append-row') {
  const idx = read(indexPath);
  fs.writeFileSync(indexPath, `${JSON.stringify([...idx, a.row], null, 2)}\n`);
} else if (a.cmd === 'retitle') {
  const p = path.join(artifacts, `claudex-${a.run}`, 'a1-findings.json');
  const f = read(p);
  f.blocker[0] = { ...f.blocker[0], title: a.title };
  fs.writeFileSync(p, `${JSON.stringify(f, null, 2)}\n`);
  const idx = read(indexPath);
  const next = idx.map((r) => (runName(r) === a.run ? { ...r, findings_sha256: sha(fs.readFileSync(p)) } : r));
  fs.writeFileSync(indexPath, `${JSON.stringify(next, null, 2)}\n`);
} else if (a.cmd === 'files') {
  // the masked report names two files; their lines carry the MASKED-FIXTURE-SECRET markers (the "secret bytes" the question must never show)
  const rep = read(path.join(a.cases, 'gitleaks-report.masked.json'));
  for (const e of rep) {
    const p = path.join(a.repo, e.File);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `const x = { token: "${e.Secret}" }; // ${e.Match}\n`);
  }
} else { console.error('unknown cmd'); process.exit(2); }
