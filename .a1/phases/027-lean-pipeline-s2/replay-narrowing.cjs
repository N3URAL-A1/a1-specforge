'use strict';
// Replays `verify run --affected` selection over a fixed commit range (D17).
// Usage: node replay-narrowing.cjs [--config <verify.json>] [--out <file>]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const END = '45ee7f1';
const COUNT = 25;
const BASELINE = '.a1/phases/027-lean-pipeline/BASELINE.json';
const MIN_NARROWED = 12;
const MAX_MEAN_S = 1306;
const FULL_S = 1511;
const XPROV = '_test-fixtures/a1-xprov/';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const { selectAffected, literalRequirers } = require(path.join(root, '_shared/lib/verify-affected.cjs'));

function usage(msg) {
  process.stderr.write(`replay-narrowing: ${msg}\nusage: node replay-narrowing.cjs [--config <verify.json>] [--out <file>]\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { config: '.a1/verify.json', out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) o.config = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) o.out = argv[++i];
    else usage(`unexpected argument "${argv[i]}"`);
  }
  return o;
}

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const nul = (s) => s.split('\0').filter(Boolean);

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = JSON.parse(fs.readFileSync(path.resolve(opts.config), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(root, BASELINE), 'utf8'));
  const dur = new Map(baseline.verify_head_only.commands.map((c) => [c.id, c.duration_ms / 1000]));
  const planIds = [...dur.keys()].sort();
  // selection also sees the current a1-xprov runners (run-tests-c.sh post-dates the baseline); seconds stay baseline-only
  const xdir = path.join(root, XPROV);
  const xprovNow = fs.readdirSync(xdir).filter((f) => /^run-tests.*\.sh$/.test(f)).map((f) => XPROV + f);
  const selPlan = [...new Set([...planIds, ...xprovNow])].sort();
  const commits = git(['rev-list', '--first-parent', `--max-count=${COUNT}`, END]).split('\n').filter(Boolean);
  const out = [];
  for (const c of commits) {
    const changed = nul(git(['diff', '--name-only', '-z', '--no-renames', `${c}^`, c]));
    const tree = new Set(git(['ls-tree', '-r', '--name-only', c]).split('\n').filter(Boolean));
    const js = changed.filter((p) => /\.(cjs|js)$/.test(p) && fs.existsSync(path.join(root, p)));
    const requirers = js.length ? literalRequirers(root, js) : new Map();
    const r = selectAffected({ changed, exists: (p) => tree.has(p), cfg, planIds: selPlan, requirers });
    const sel = new Set(r.ids);
    // a1-xprov rule (D17): any current a1-xprov runner selected -> both baseline xprov ids count
    const xprovHit = r.selection === 'subset' && r.ids.some((i) => i.startsWith(XPROV));
    const ids = r.selection === 'full' ? planIds : planIds.filter((i) => sel.has(i) || (xprovHit && i.startsWith(XPROV)));
    let seconds = 0;
    for (const i of ids) {
      if (!dur.has(i)) { process.stderr.write(`baseline_missing:${i}\n`); process.exit(2); }
      seconds += dur.get(i);
    }
    out.push({
      sha: c.slice(0, 7), subject: git(['log', '-1', '--format=%s', c]).trim(),
      selection: r.selection, reason: r.reason, paths: r.paths, selected: ids,
      seconds: Math.round(seconds * 10) / 10,
    });
  }
  const narrowed = out.filter((x) => x.selection === 'subset').length;
  const mean = out.reduce((a, x) => a + x.seconds, 0) / out.length;
  const pass = narrowed >= MIN_NARROWED && mean <= MAX_MEAN_S;
    const result = {
    range: { end: END, count: COUNT }, config: opts.config,
    thresholds: { min_narrowed: MIN_NARROWED, max_mean_s: MAX_MEAN_S },
    commits: out,
    totals: { narrowed, mean_selected_s: Math.round(mean * 10) / 10, full_s: FULL_S }, pass,
  };
  const text = JSON.stringify(result, null, 2) + '\n';
  if (opts.out) fs.writeFileSync(opts.out, text); else process.stdout.write(text);
  process.stderr.write(`narrowed ${narrowed}/${COUNT}, mean selected ${result.totals.mean_selected_s} s of ${FULL_S} s, pass=${pass}\n`);
  process.exit(pass ? 0 : 1);
}

main();
