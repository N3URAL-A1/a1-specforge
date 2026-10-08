'use strict';

// Mini assert kit for the direct unit cases. Every case prints one
// `PASS  <name>` / `FAIL  <name>: <detail>` line; the last line is
// `UNITS <pass> <fail>`, which run-tests.sh tallies. Expectations are
// literals in the case files, never values imported from the module under
// test (testing.md class 4).

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); pass += 1; } else { console.log(`FAIL  ${name}${detail === undefined ? '' : `: ${detail}`}`); fail += 1; }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

function throws(name, fn, re) {
  try { fn(); } catch (e) { check(name, re.test(e.message), `threw ${JSON.stringify(e.message)}, expected ${re}`); return; }
  check(name, false, `did not throw (expected ${re})`);
}

function noThrow(name, fn) {
  try { fn(); check(name, true); } catch (e) { check(name, false, `threw ${JSON.stringify(e.message)}`); }
}

function done() {
  console.log(`UNITS ${pass} ${fail}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

module.exports = { check, eq, throws, noThrow, done };
