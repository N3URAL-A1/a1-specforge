'use strict';

// ---------------------------------------------------------------------------
// xprov-repo-identity — who a repository is, for permit binding (spec 016
// FR-006, FR-007; wave 1).
//
// Identity = realpath of the primary checkout's `git rev-parse --git-common-dir`
// (shared by every linked worktree) PLUS the raw `remote.origin.url`. An absent
// origin is the explicit value null, never an empty string. A permit bound to an
// identity is void as soon as either part differs, including an origin that
// appears or disappears.
//
// Classification (customer vs org) is a pure function of the origin string:
// org N3URAL-A1 on github.com, or customer (no origin, another host, another org).
//
// Pure functions plus one git reader (argv array, no shell).
// ---------------------------------------------------------------------------

const { spawnSync } = require('child_process');
const C = require('./xprov-common.cjs');

const OWN_ORG = 'N3URAL-A1';
const OWN_HOST = 'github.com';
const ORIGIN_MAX_CHARS = 10000;
const CLASS = Object.freeze({ ORG: 'org', CUSTOMER: 'customer' });
// scp-like `git@github.com:org/repo(.git)` and URL forms `https|ssh|git://[user[:pw]@]host[:port]/org/repo(.git)`.
const SCP_RE = /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):([^/:][^]*)$/;
const URL_RE = /^(?:https?|ssh|git):\/\/(?:[^/@\s]*@)?([A-Za-z0-9.-]+)(?::\d{1,5})?\/([^]*)$/;

/** The raw `remote.origin.url` of a checkout, or null when absent. Throws a typed input error when unreadable or oversized. */
function readOrigin(root) {
  const r = spawnSync('git', ['-C', String(root), 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.error) throw C.inputError('git could not be run to read remote.origin.url', 'origin_unreadable');
  if (r.status === 1) return null; // key absent
  if (r.status !== 0) throw C.inputError('remote.origin.url could not be read', 'origin_unreadable');
  const raw = String(r.stdout).replace(/\n$/, '');
  if (raw === '') return null;
  if (raw.length > ORIGIN_MAX_CHARS) throw C.inputError(`remote.origin.url exceeds ${ORIGIN_MAX_CHARS} characters`, 'origin_too_long');
  return raw;
}

/** { key, origin } for a checkout; key null when the path is no git checkout. */
function repoIdentity(root) {
  return Object.freeze({ key: C.commonDirOf(root), origin: readOrigin(root) });
}

/** { key, origin, originError } for the binding check of `permit-check`; an unreadable origin is reported, never thrown. */
function bindingIdentity(root, key) {
  try { return { key, origin: readOrigin(root), originError: null }; } catch (e) {
    return { key, origin: null, originError: e && e.code === 'A1_INPUT' ? e.message : 'error' };
  }
}

/** True when two identity origins differ (null equals only null). */
const originChanged = (recorded, current) => (recorded === undefined ? false : recorded !== current);

/** `org/repo` path of an origin on the own host, or null. */
function ownHostPath(origin) {
  const m = URL_RE.exec(origin) || SCP_RE.exec(origin);
  if (!m || m[1].toLowerCase() !== OWN_HOST) return null;
  return m[2];
}

/** 'org' for an origin of github.com/N3URAL-A1/<repo>, else 'customer' (also for null: no origin). */
function classifyOrigin(origin) {
  if (typeof origin !== 'string' || origin === '' || origin.length > ORIGIN_MAX_CHARS) return CLASS.CUSTOMER;
  const p = ownHostPath(origin);
  if (p === null) return CLASS.CUSTOMER;
  const parts = p.replace(/\/+$/, '').split('/');
  return parts.length === 2 && parts[0].toLowerCase() === OWN_ORG.toLowerCase() && /^[A-Za-z0-9._-]+$/.test(parts[1]) ? CLASS.ORG : CLASS.CUSTOMER;
}

module.exports = { OWN_ORG, ORIGIN_MAX_CHARS, CLASS, readOrigin, bindingIdentity, repoIdentity, originChanged, classifyOrigin };
