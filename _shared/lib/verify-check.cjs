'use strict';

// `verify check <VERIFICATION.md>` (spec 017 FR-018) plus the small git helpers
// `verify run` shares with it. A VERIFICATION.md claiming PASS is refused when
//   - `verify_run` is missing or unparsable,
//   - `verify_run.verdict` is not `pass`,
//   - `head_sha` is unknown to git (hand-edited), or
//   - a path outside `.a1/` (other than the file itself) changed between
//     `head_sha` and HEAD (code changed after the run; Q12: committing the
//     VERIFICATION.md alone does not trip it).
// Exit 0 ok (or the file does not claim PASS) / 1 refused / 2 usage or unreadable.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseFrontmatter } = require('./io-frontmatter.cjs');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{40}$/;
const A1_PREFIX = '.a1/';

/** git stdout, untrimmed (NUL-separated output stays exact), or null on failure. */
function gitRaw(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: GIT_MAX_BUFFER, shell: false,
    });
  } catch (_e) {
    return null;
  }
}

function headSha(cwd) {
  const out = gitRaw(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
  return out && SHA_RE.test(out.trim()) ? out.trim() : null;
}

function splitNul(out) {
  return out === null ? null : out.split('\0').filter((p) => p !== '');
}

/** Repo-relative paths changed between two commits, or null when git cannot tell. */
function diffNames(cwd, from, to) {
  return splitNul(gitRaw(cwd, ['diff', '--name-only', '-z', from, to, '--']));
}

function readVerifyRun(fm) {
  const raw = fm.verify_run;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (_e) {
    return null;
  }
}

/** { ok, reasons[], exit } for one VERIFICATION.md. Pure apart from git reads. */
function checkVerification(file) {
  const abs = path.resolve(file);
  const stat = fs.statSync(abs);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { exit: 2, reasons: ['unreadable_file'] };
  const { fm } = parseFrontmatter(fs.readFileSync(abs, 'utf8'));
  if (String(fm.verdict || '').toUpperCase() !== 'PASS') return { exit: 0, reasons: [], note: 'file does not claim PASS' };
  const run = readVerifyRun(fm);
  if (!run) return { exit: 1, reasons: ['verify_run_missing'] };
  if (run.verdict !== 'pass') return { exit: 1, reasons: ['verify_run_not_pass'] };
  if (typeof run.head_sha !== 'string' || !SHA_RE.test(run.head_sha)) return { exit: 1, reasons: ['head_sha_invalid'] };
  const dir = path.dirname(abs);
  const top = (gitRaw(dir, ['rev-parse', '--show-toplevel']) || '').trim();
  if (top === '') return { exit: 1, reasons: ['not_a_git_repo'] };
  const changed = diffNames(dir, run.head_sha, 'HEAD');
  if (changed === null) return { exit: 1, reasons: ['head_sha_unknown'] };
  const self = path.relative(fs.realpathSync(top), fs.realpathSync(abs)).split(path.sep).join('/');
  const late = changed.filter((p) => !p.startsWith(A1_PREFIX) && p !== self);
  if (late.length > 0) return { exit: 1, reasons: ['code_changed_after_run'], changed_after_run: late.length, sample: late.slice(0, 5) };
  return { exit: 0, reasons: [] };
}

/** @param {string[]} args */
function cmdVerifyCheck(args) {
  const files = args.filter((a) => !a.startsWith('--'));
  const extra = args.filter((a) => a.startsWith('--'));
  if (files.length !== 1 || extra.length > 0 || files[0].includes('\0')) {
    process.stderr.write('usage: verify check <VERIFICATION.md>\n');
    process.exit(2);
  }
  let res;
  try { res = checkVerification(files[0]); } catch (e) {
    process.stderr.write(`verify check: ${e.message}\n`);
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify({ ok: res.exit === 0, ...res, exit: undefined })}\n`);
  if (res.exit === 1) process.stderr.write(`verify check: refused - ${res.reasons.join(', ')}\n`);
  process.exit(res.exit);
}

module.exports = { gitRaw, headSha, splitNul, diffNames, readVerifyRun, checkVerification, cmdVerifyCheck, SHA_RE };
