'use strict';

// git-safe.cjs — the single audited git exec path (argv array, no shell) and
// the shell-metacharacter guard at the CLI argument boundary.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { check, eq, throws, noThrow, done } = require('../lib.cjs');

const G = require(path.join(process.argv[2], 'git-safe.cjs'));
const work = fs.mkdtempSync(path.join(process.argv[3], 'git-'));

// G1 — every listed metacharacter is caught, one at a time.
// Red-making change: dropping any one character from SHELL_METACHAR_RE.
for (const ch of ['$', '`', ';', '|', '&', '<', '>', '(', ')', '{', '}', '\n', '\r']) {
  check(`G1 metachar ${JSON.stringify(ch)} detected`, G.containsShellMetachar(`feature${ch}x`) === true);
}
// G2 — ordinary refs, paths and non-strings are not metacharacter input.
for (const v of ['feature/x-1', 'docs/my file.md', 'v1.2.3', '../relative', '']) {
  check(`G2 clean value ${JSON.stringify(v)}`, G.containsShellMetachar(v) === false);
}
for (const v of [42, null, undefined, ['$(x)'], { a: ';' }]) {
  check(`G2 non-string ${JSON.stringify(v)} is not flagged`, G.containsShellMetachar(v) === false);
}

// G3 — assertNoShellMetachar names the label and quotes the value.
throws('G3 assert refuses injection-shaped input', () => G.assertNoShellMetachar('main; rm -rf /', '--base'), /^--base contains disallowed shell metacharacters: "main; rm -rf \/"$/);
throws('G3 assert refuses command substitution', () => G.assertNoShellMetachar('$(touch PWNED)', 'slug'), /^slug contains/);
noThrow('G3 assert accepts a clean ref', () => G.assertNoShellMetachar('feature/x-1', '--base'));

// A throwaway repo with one commit (identity from env; HOME is the suite's).
const repo = path.join(work, 'repo');
fs.mkdirSync(repo);
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
execFileSync('git', ['init', '-q', repo], { env });
fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
execFileSync('git', ['-C', repo, 'add', 'a.txt'], { env });
execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'], { env });

// G4 — stdout comes back trimmed.
eq('G4 gitSafe returns trimmed stdout', G.gitSafe(repo, ['rev-parse', '--is-inside-work-tree']), 'true');
eq('G4 gitSafe runs in repoPath (-C)', G.gitSafe(repo, ['ls-files']), 'a.txt');

// G5 — a failing command throws with the args and git's stderr.
throws('G5 failure throws with args and stderr', () => G.gitSafe(repo, ['rev-parse', '--verify', 'no-such-ref']), /^git rev-parse --verify no-such-ref failed: .*(fatal|Needed a single revision)/s);

// G6 — allowFail returns the error object instead of throwing.
{
  const r = G.gitSafe(repo, ['rev-parse', '--verify', 'no-such-ref'], { allowFail: true });
  check('G6 allowFail returns {__error, __code}', r && typeof r.__error === 'string' && r.__error !== '' && Number.isInteger(r.__code) && r.__code !== 0, JSON.stringify(r));
}

// G7 — shell syntax in an argument is an inert literal: no shell runs it.
// Red-making change: building one command string and running it via execSync.
{
  const marker = path.join(work, 'PWNED');
  for (const arg of [`; touch ${marker}`, `$(touch ${marker})`, `\`touch ${marker}\``, `| touch ${marker}`]) {
    const out = G.gitSafe(repo, ['ls-files', '--', arg]);
    eq(`G7 ${JSON.stringify(arg.slice(0, 2))} pathspec matches nothing`, out, '');
  }
  check('G7 no injected command ran', !fs.existsSync(marker));
}

done();
