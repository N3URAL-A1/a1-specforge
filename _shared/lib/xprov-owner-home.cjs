'use strict';

// ---------------------------------------------------------------------------
// xprov-owner-home — the ONE place that decides where the owner stores live
// (spec 016 FR-009, wave 1).
//
// Owner stores (permits, denials, waivers, allowlist approvals, consent
// evidence, the audit chain, scan records) resolve under the home directory of
// the OS user record (`os.userInfo().homedir`, i.e. passwd), never under `$HOME`.
// `$HOME` is an environment variable: anything that starts a process can point
// it at a directory it owns and plant its own stores there.
//
// Tripwire: when `os.homedir()` (which honours `$HOME`) names another directory
// than the passwd home, `homeMismatch()` returns a sentence and every owner-store
// WRITER calls `assertWritable()`, which throws; `permit-check` reports not ok.
//
// Test seam (plan decision D-2): this module is the only place that reads the
// passwd home. The fixture harness swaps it in its tree COPY for
// fake/xprov-owner-home.cjs; no environment variable can redirect production.
//
// Pure at module load; no module-global mutable state.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');

/** The owner root: the passwd home of the current OS user. */
function ownerHome() {
  return os.userInfo().homedir;
}

function canonical(p) {
  const resolved = path.resolve(String(p));
  try { return fs.realpathSync(resolved); } catch (_e) { return resolved; }
}

/** null when `$HOME` and the passwd home name the same directory, else one sentence. Fails closed:
 * an unreadable user record or an empty passwd home counts as a mismatch. */
function homeMismatch() {
  let owner;
  let env;
  try { owner = ownerHome(); env = os.homedir(); } catch (e) {
    return `the home directory could not be read (${(e && e.code) || 'error'})`;
  }
  if (typeof owner !== 'string' || owner === '' || typeof env !== 'string' || env === '') {
    return 'the OS user record or $HOME holds no home directory';
  }
  if (canonical(owner) === canonical(env)) return null;
  return `$HOME (${env}) differs from the home directory of the OS user (${owner}); owner stores are not written`;
}

/** Throws a typed user error when the tripwire holds; owner-store writers call this before the first byte. */
function assertWritable() {
  const why = homeMismatch();
  if (why === null) return;
  const err = new Error(why);
  err.code = 'A1_INPUT';
  err.reason = 'owner_home_mismatch';
  throw err;
}

module.exports = { ownerHome, homeMismatch, assertWritable };
