'use strict';

// worktree-gatelog.cjs (review round 1 of PR #130): a checkout folder that is no safe project name has no run-record file, so every
// gate log scope stays unpreserved (fail closed), even when a store file named after the string "null" lists the scope.
// Measured red: dropping `if (project === null) return seen;` in recordedScopes (the `null.jsonl` file is then read).

const fs = require('fs');
const path = require('path');
const { eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'wg-'));
const G = require(path.join(LIB, 'worktree-gatelog.cjs'));

const line = JSON.stringify({ schema: 1, scope: 'pr-1', gate: 'x' });
const store = path.join(WORK, 'store');
fs.mkdirSync(path.join(store, '_runs'), { recursive: true });
fs.writeFileSync(path.join(store, '_runs', 'null.jsonl'), JSON.stringify({ scope: 'pr-1' }) + '\n');

const mkWt = (name) => {
  const d = path.join(WORK, name);
  fs.mkdirSync(path.join(d, '.a1', 'phases', 'pr-1'), { recursive: true });
  fs.writeFileSync(path.join(d, '.a1', 'phases', 'pr-1', 'gate-log.jsonl'), line + '\n');
  return d;
};

eq('WG1 unsafe folder name "My Repo": pr-1 stays unpreserved', G.unpreservedScopes(mkWt('My Repo'), store), ['pr-1']);
fs.writeFileSync(path.join(store, '_runs', 'good-name.jsonl'), JSON.stringify({ scope: 'pr-1' }) + '\n');
eq('WG2 control: a safe folder name with its own run record is preserved', G.unpreservedScopes(mkWt('good-name'), store), []);

done();
