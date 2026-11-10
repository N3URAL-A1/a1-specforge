'use strict';

// xprov-recover.cjs — `anchorOf` (spec 025 Wave 4: moved here from the deleted xprov-wave-ranges.cjs; plan recovery needs it).
// Runs against a real throwaway git repo (cwd of the suite), HOME is the suite temp home.

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { check, eq, done } = require('../lib.cjs');

const R = require(path.join(process.argv[2], 'xprov-recover.cjs'));

check('A1 anchorOf is exported as a function', typeof R.anchorOf === 'function', typeof R.anchorOf);
if (typeof R.anchorOf !== 'function') { done(); process.exit(1); }

const repo = path.join(process.cwd(), 'anchor-repo');
fs.mkdirSync(repo);
const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
git('init', '-q', '-b', 'main');
fs.writeFileSync(path.join(repo, 'f'), '1');
git('add', 'f'); git('commit', '-q', '-m', 'one');
const fork = git('rev-parse', 'HEAD');
git('checkout', '-q', '-b', 'topic');
fs.writeFileSync(path.join(repo, 'f'), '2');
git('commit', '-q', '-am', 'two');
const tip = git('rev-parse', 'HEAD');

eq('A2 anchorOf = merge-base of the default branch and the tip', R.anchorOf(repo, tip), fork);
eq('A3 anchorOf without any default branch ref is null', R.anchorOf(path.join(process.cwd(), 'nonexistent'), tip), null);
done();
