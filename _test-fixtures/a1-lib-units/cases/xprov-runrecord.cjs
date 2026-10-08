'use strict';

// xprov-runrecord.cjs — what a run dir proves (spec 009 Wave 7). index.json
// rows are agent-writable pointers; a pass counts only through a run dir in
// THIS repository's artifacts dir, read with O_NOFOLLOW, carrying a1's own
// pass marker and (for inspect) a matching a1-reviewed.json.
// HOME is the suite's temp home; cwd is a throwaway git repo `demo-repo`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { check, eq, done } = require('../lib.cjs');

if (!process.argv[3] || !os.homedir().startsWith(process.argv[3])) {
  check('R0 HOME is the suite temp home', false, `${os.homedir()} (run through run-tests.sh)`);
  done();
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(process.argv[3], 'rr-'));
const repo = path.join(work, 'demo-repo');
fs.mkdirSync(repo);
execFileSync('git', ['init', '-q', repo]);
process.chdir(repo);

const RR = require(path.join(process.argv[2], 'xprov-runrecord.cjs'));
const root = path.join(os.homedir(), '.a1-xprov', 'artifacts', 'demo-repo');

const PLAN = 'a'.repeat(64);
const HEAD = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const DIFF = 'd'.repeat(64);
const review = { status: 'completed', mode: 'review', plan_sha256: PLAN, response: { verdict: 'APPROVED' } };
const inspect = { status: 'completed', mode: 'inspect', plan_sha256: PLAN, response: { verdict: 'APPROVED' }, snapshot: { base: BASE, diff_sha256: DIFF } };

let n = 0;
function runDir(result, { marker = { plan_sha256: PLAN }, reviewed = null, under = root } = {}) {
  n += 1;
  const d = path.join(under, `claudex-${n}`);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  if (result !== undefined) fs.writeFileSync(path.join(d, 'result.json'), typeof result === 'string' ? result : JSON.stringify(result));
  if (marker) fs.writeFileSync(path.join(d, 'a1-pass.json'), JSON.stringify(marker));
  if (reviewed) fs.writeFileSync(path.join(d, 'a1-reviewed.json'), JSON.stringify(reviewed));
  return path.join(d, 'result.json');
}

eq('R0 file names', [RR.REVIEWED_FILE, RR.PASS_MARKER_FILE], ['a1-reviewed.json', 'a1-pass.json']);

// R1 — inOwnArtifacts: only run dirs strictly below this repo's artifacts dir.
// Red-making change: dropping the `runDir !== root` clause of inOwnArtifacts.
{
  const ok = runDir(review);
  check('R1 run dir in own artifacts', RR.inOwnArtifacts(ok) === true);
  check('R1 empty path refused', RR.inOwnArtifacts('') === false);
  check('R1 non-string refused', RR.inOwnArtifacts(null) === false && RR.inOwnArtifacts(42) === false);
  check('R1 result.json directly in the artifacts root refused', RR.inOwnArtifacts(path.join(root, 'result.json')) === false);
  check('R1 another repo\'s artifacts refused', RR.inOwnArtifacts(path.join(root, '..', 'other-repo', 'claudex-1', 'result.json')) === false);
  check('R1 traversal out of the root refused', RR.inOwnArtifacts(path.join(root, 'claudex-1', '..', '..', 'x', 'result.json')) === false);
  check('R1 a dir outside ~/.a1-xprov refused', RR.inOwnArtifacts(path.join(work, 'claudex-1', 'result.json')) === false);
  const linkDir = path.join(root, 'claudex-link');
  fs.symlinkSync(path.join(work, 'outside'), linkDir);
  fs.mkdirSync(path.join(work, 'outside'));
  check('R1 a linked run dir that leaves the root refused', RR.inOwnArtifacts(path.join(linkDir, 'result.json')) === false);
}

// R2 — runRecord / readJsonNoFollow.
{
  eq('R2 runRecord reads result.json', RR.runRecord(runDir(review)), review);
  eq('R2 invalid JSON -> null', RR.runRecord(runDir('{not json')), null);
  eq('R2 JSON array -> null', RR.runRecord(runDir('[1,2]')), null);
  eq('R2 missing file -> null', RR.runRecord(runDir(undefined)), null);
  const linked = runDir(undefined);
  const real = path.join(work, 'real-result.json');
  fs.writeFileSync(real, JSON.stringify(review));
  fs.symlinkSync(real, linked);
  eq('R2 symlinked result.json -> null (O_NOFOLLOW)', RR.runRecord(linked), null);
  const outsidePerfect = runDir(review, { under: path.join(work, 'fake-artifacts') });
  eq('R2 perfect record outside the artifacts dir -> null', RR.runRecord(outsidePerfect), null);
}

// R3 — planPassValid: completed, APPROVED review of exactly this plan + marker.
// Red-making change: removing the hasPassMarker() call from planPassValid.
{
  check('R3 valid plan pass', RR.planPassValid(runDir(review), PLAN) === true);
  check('R3 other plan sha', RR.planPassValid(runDir(review), 'e'.repeat(64)) === false);
  check('R3 verdict not APPROVED', RR.planPassValid(runDir({ ...review, response: { verdict: 'CHANGES_REQUESTED' } }), PLAN) === false);
  check('R3 status not completed', RR.planPassValid(runDir({ ...review, status: 'failed' }), PLAN) === false);
  check('R3 inspect record is not a plan pass', RR.planPassValid(runDir({ ...review, mode: 'inspect' }), PLAN) === false);
  check('R3 no pass marker', RR.planPassValid(runDir(review, { marker: null }), PLAN) === false);
  check('R3 marker for another plan', RR.planPassValid(runDir(review, { marker: { plan_sha256: 'f'.repeat(64) } }), PLAN) === false);
  check('R3 same files outside own artifacts', RR.planPassValid(runDir(review, { under: path.join(work, 'fake2') }), PLAN) === false);
  const d = path.dirname(runDir(review));
  check('R3 hasPassMarker without a plan sha', RR.hasPassMarker(d) === true);
  check('R3 hasPassMarker bound to the plan sha', RR.hasPassMarker(d, PLAN) === true && RR.hasPassMarker(d, 'f'.repeat(64)) === false);
}

// R4 — inspectPass: head/base only from a1-reviewed.json, only when it agrees
// with the record's snapshot.
// Red-making change: dropping the diff_sha256 comparison in reviewedHeadBase.
{
  const reviewed = { commit: HEAD, base: BASE, diff_sha256: DIFF };
  eq('R4 valid inspect pass', RR.inspectPass(runDir(inspect, { reviewed }), PLAN), { head: HEAD, base: BASE });
  eq('R4 no a1-reviewed.json', RR.inspectPass(runDir(inspect), PLAN), null);
  eq('R4 reviewed base differs from snapshot', RR.inspectPass(runDir(inspect, { reviewed: { ...reviewed, base: 'e'.repeat(40) } }), PLAN), null);
  eq('R4 reviewed diff sha differs', RR.inspectPass(runDir(inspect, { reviewed: { ...reviewed, diff_sha256: 'e'.repeat(64) } }), PLAN), null);
  eq('R4 commit is not a sha', RR.inspectPass(runDir(inspect, { reviewed: { ...reviewed, commit: 'HEAD; rm -rf /' } }), PLAN), null);
  eq('R4 uppercase sha refused', RR.inspectPass(runDir(inspect, { reviewed: { ...reviewed, commit: HEAD.toUpperCase() } }), PLAN), null);
  eq('R4 review record is not an inspect pass', RR.inspectPass(runDir({ ...inspect, mode: 'review' }, { reviewed }), PLAN), null);
  eq('R4 no pass marker', RR.inspectPass(runDir(inspect, { reviewed, marker: null }), PLAN), null);
  eq('R4 snapshot missing', RR.reviewedHeadBase(runDir({ ...inspect, snapshot: undefined }, { reviewed })), { head: null, base: null });
}

done();
