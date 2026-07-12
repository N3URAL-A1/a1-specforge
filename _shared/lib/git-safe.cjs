'use strict';

// Single audited exec path for git invocations across a1-tools.cjs. Every
// call goes through execFileSync with an argv array — no shell is ever
// involved, so shell metacharacters in any argument (paths, refs, etc.) are
// inert literal bytes instead of executable syntax.

const { execFileSync } = require('child_process');

// Defense-in-depth: reject shell metacharacters at the CLI argument-parsing
// boundary too, so any future exec call site added elsewhere fails safe even
// if it forgets to use gitSafe().
const SHELL_METACHAR_RE = /[$`;|&<>(){}\n\r]/;

function containsShellMetachar(value) {
  return typeof value === 'string' && SHELL_METACHAR_RE.test(value);
}

function assertNoShellMetachar(value, label) {
  if (containsShellMetachar(value)) {
    throw new Error(`${label} contains disallowed shell metacharacters: ${JSON.stringify(value)}`);
  }
}

// Returns trimmed stdout. Throws on non-zero exit unless opts.allowFail.
function gitSafe(repoPath, args, opts = {}) {
  try {
    const out = execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    return out.trim();
  } catch (e) {
    const msg = (e.stderr && e.stderr.toString().trim()) || e.message;
    if (opts.allowFail) return { __error: msg, __code: e.status };
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

module.exports = {
  gitSafe,
  containsShellMetachar,
  assertNoShellMetachar,
};
