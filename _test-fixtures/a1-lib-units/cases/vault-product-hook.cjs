'use strict';

// vault-product-hook.cjs — the product transaction hook (spec 010, Wave 4:
// FR-007/FR-010). afterCommit never throws; without A1_VAULT_ROOT it touches
// and prints nothing; a failure is ONE stderr line per hook, however often
// afterCommit runs. The vault is a mktemp dir under the suite root.

const fs = require('fs');
const path = require('path');
const { check, eq, done } = require('../lib.cjs');

const { productMirrorHook } = require(path.join(process.argv[2], 'vault-product-hook.cjs'));
const work = fs.mkdtempSync(path.join(process.argv[3], 'vph-'));

function capture(fn) {
  const w = process.stderr.write;
  let err = '';
  process.stderr.write = (s) => { err += s; return true; };
  let value;
  try { value = fn(); } finally { process.stderr.write = w; }
  return { value, err };
}
const env = (vars, fn) => {
  const keys = Object.keys(vars);
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) { if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
};

// A repo with docs/product and a vault.
const repo = path.join(work, 'repo');
const product = path.join(repo, 'docs', 'product');
fs.mkdirSync(path.join(product, 'features'), { recursive: true });
const roadmap = (project) => fs.writeFileSync(path.join(product, 'ROADMAP.md'), `---\nproject: ${project}\n---\n# Roadmap\n`);
roadmap('acme');
fs.writeFileSync(path.join(product, 'VISION.md'), '# Vision\n');
fs.writeFileSync(path.join(product, 'features', 'F-001.md'), '# F-001\n');
fs.writeFileSync(path.join(product, 'scratch.tmp.123'), 'excluded\n');
const vault = path.join(work, 'vault');
fs.mkdirSync(vault);

// V1 — no A1_VAULT_ROOT: undefined (the key drops out of the JSON), silent, no vault write.
// Red-making change: flipping EMIT_INACTIVE_RESULT to true.
env({ A1_VAULT_ROOT: undefined }, () => {
  const r = capture(() => productMirrorHook(product).afterCommit());
  eq('V1 inactive: undefined', r.value, undefined);
  eq('V1 inactive: no stderr', r.err, '');
  eq('V1 inactive: vault untouched', fs.readdirSync(vault), []);
});

env({ A1_VAULT_ROOT: vault, A1_VAULT_WRITER_HOST: undefined, A1_HOST_ID: undefined }, () => {
  // V2 — the mirror: product set copied to project/<slug>/product/, excludes kept out.
  {
    const r = capture(() => productMirrorHook(product).afterCommit());
    eq('V2 mirrored', r.value, { status: 'ok', files: 3 });
    eq('V2 no stderr', r.err, '');
    const dest = path.join(vault, 'project', 'acme', 'product');
    check('V2 files in the vault', ['ROADMAP.md', 'VISION.md', path.join('features', 'F-001.md')].every((f) => fs.existsSync(path.join(dest, f))));
    check('V2 tmp file excluded', !fs.existsSync(path.join(dest, 'scratch.tmp.123')));
    // Once project/acme/ exists, a missing hub note is an unreadable writer
    // declaration (fail closed) — with the hub note in place it mirrors again.
    const again = capture(() => productMirrorHook(product).afterCommit());
    check('V2 project folder without hub note: skipped (hub_missing)', again.value.status === 'skipped' && /hub_missing/.test(again.value.reason), JSON.stringify(again.value));
    fs.writeFileSync(path.join(vault, 'project', 'acme.md'), '---\ntitle: Acme\n---\n# Acme\n');
    eq('V2 with hub note: unchanged run copies nothing', productMirrorHook(product).afterCommit(), { status: 'ok', files: 0 });
  }

  // V3 — skips: one stderr line per hook, a result with the reason, never a throw.
  // Red-making change: dropping `warned = true` (two lines for two afterCommit calls).
  const skip = (name, dir, re) => {
    const hook = productMirrorHook(dir);
    const r = capture(() => [hook.afterCommit(), hook.afterCommit()]);
    check(`${name}: skipped twice`, r.value.every((v) => v && v.status === 'skipped' && v.files === 0 && re.test(v.reason)), JSON.stringify(r.value));
    eq(`${name}: exactly one stderr line`, r.err.split('\n').filter(Boolean).length, 1);
    check(`${name}: the line is the skip line`, r.err.startsWith('[a1-tools] vault mirror skipped: '), r.err);
  };
  skip('V3 free --dir (not <repo>/docs/product)', path.join(work, 'elsewhere'), /is not <repo>\/docs\/product/);
  roadmap('');
  skip('V3 ROADMAP without project:', product, /no frontmatter project:/);
  roadmap('../../etc');
  skip('V3 traversal slug', product, /ROADMAP\.md project/);
  roadmap('Acme_Corp');
  skip('V3 slug not in CLI shape', product, /not a valid project slug/);
  roadmap('a'.repeat(10000));
  {
    const hook = productMirrorHook(product);
    const r = capture(() => hook.afterCommit());
    check('V3 oversized slug skipped without echoing it', r.value.status === 'skipped' && /longer than/.test(r.value.reason) && !r.err.includes('a'.repeat(200)), r.err.slice(0, 200));
  }
  roadmap('acme');
  fs.rmSync(path.join(product, 'ROADMAP.md'));
  skip('V3 missing ROADMAP.md', product, /ENOENT|no such file/);
  roadmap('acme');
});

// V4 — a configured vault root that does not exist: skipped, nothing created.
env({ A1_VAULT_ROOT: path.join(work, 'no-vault'), A1_VAULT_WRITER_HOST: undefined, A1_HOST_ID: undefined }, () => {
  const r = capture(() => productMirrorHook(product).afterCommit());
  check('V4 missing vault root skipped', r.value.status === 'skipped', JSON.stringify(r.value));
  check('V4 nothing created', !fs.existsSync(path.join(work, 'no-vault')));
});

// V5 — another host is the declared fallback writer: skipped, vault unchanged.
env({ A1_VAULT_ROOT: vault, A1_VAULT_WRITER_HOST: 'other-host', A1_HOST_ID: 'this-host' }, () => {
  fs.writeFileSync(path.join(product, 'VISION.md'), '# Vision v2\n');
  const r = capture(() => productMirrorHook(product).afterCommit());
  check('V5 not the writer: skipped', r.value.status === 'skipped' && /not the vault writer of acme \(this-host ≠ other-host\)/.test(r.value.reason), JSON.stringify(r.value));
  eq('V5 vault copy unchanged', fs.readFileSync(path.join(vault, 'project', 'acme', 'product', 'VISION.md'), 'utf8'), '# Vision\n');
});

done();
