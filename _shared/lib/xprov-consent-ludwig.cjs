'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-ludwig — the vault record of a legal decision, for customer repositories (spec 016 FR-007; security review
// 2026-10-14, MAJOR-3).
//
//   validateArg(v)      : the shape of `--ludwig-record` (vault-relative `record/…md` or `project/…md`, bounded); throws a typed input error.
//   verifyInVault(rel)  : null when `rel` names a regular file under $A1_VAULT_ROOT, else { reason, detail }.
//
// The record is a vault path the owner sees in the classification question and the permit then names. A path that does not exist
// is a fabricated authority, so the file is looked up: lstat on every component (no symlink anywhere below the vault root), the last
// one a regular file, and the final realpath inside the root. Without A1_VAULT_ROOT nothing can be verified and a customer repository
// is refused. Tier 0: an agent controls its own environment, so the variable is no proof; it stops a typo and a made-up path, and the
// owner reads the path in the question. Request-scoped: the environment is read per call.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const C = require('./xprov-common.cjs');

const LUDWIG_RECORD_MAX_CHARS = 300; // a vault path; the permit-record pattern itself has no length bound

// Required lazily: the permit module is loaded by the dispatcher anyway, and this keeps the require graph acyclic at load time.
const permit = () => require('./xprov-permit.cjs');

const fail = (reason, detail) => Object.freeze({ reason, detail });

/** The argument as given when its shape is valid; throws a typed input error (exit 2) otherwise. */
function validateArg(v) {
  if (String(v).length > LUDWIG_RECORD_MAX_CHARS) throw C.inputError(`--ludwig-record is longer than ${LUDWIG_RECORD_MAX_CHARS} characters`, 'ludwig_record_too_long');
  permit().validateRecord(v);
  return v;
}

/** null | { reason, detail }. `rel` has passed validateArg. */
function verifyInVault(rel) {
  const root = process.env.A1_VAULT_ROOT;
  if (typeof root !== 'string' || root === '' || !path.isAbsolute(root)) {
    return fail('vault_root_unset', 'customer repository: A1_VAULT_ROOT (an absolute path) must be set so the a1-ludwig-legal record can be checked; nothing written');
  }
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch (_e) { return fail('vault_root_unusable', 'A1_VAULT_ROOT cannot be resolved; nothing written'); }
  const parts = rel.split('/');
  let cur = realRoot;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st;
    try { st = fs.lstatSync(cur); } catch (_e) { return fail('ludwig_record_not_found', `the a1-ludwig-legal record ${rel} does not exist under A1_VAULT_ROOT; nothing written`); }
    if (st.isSymbolicLink()) return fail('ludwig_record_symlink', `the a1-ludwig-legal record path ${rel} contains a symlink; nothing written`);
    const last = i === parts.length - 1;
    if (last ? !st.isFile() : !st.isDirectory()) return fail('ludwig_record_not_file', `the a1-ludwig-legal record ${rel} is not a regular file; nothing written`);
  }
  let real;
  try { real = fs.realpathSync(cur); } catch (_e) { return fail('ludwig_record_not_found', `the a1-ludwig-legal record ${rel} cannot be resolved; nothing written`); }
  return real.startsWith(realRoot + path.sep) ? null : fail('ludwig_record_outside', `the a1-ludwig-legal record ${rel} resolves outside A1_VAULT_ROOT; nothing written`);
}

module.exports = { LUDWIG_RECORD_MAX_CHARS, validateArg, verifyInVault };
