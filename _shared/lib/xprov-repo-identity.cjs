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
// SEC-2: the origin is read three ways — `config --get-all remote.origin.url`, `remote get-url --all origin`
// (url.<x>.insteadOf applied) and `remote get-url --push --all origin`. One distinct value is the origin string; more than one
// (a multi-valued key, an insteadOf rewrite, a pushurl that differs) is the origin LIST (the distinct values in that read order),
// which classifies as customer and is bound as a whole. SEC-3: every git call runs the binary of C.gitBin() under
// C.ownerGitEnv() (GIT_ENV_DROP removed, no system config).
//
// Classification (customer vs org) is a pure function of the origin string:
// org N3URAL-A1 on github.com, or customer (no origin, another host, another org).
//
// Pure functions plus one git reader (argv array, no shell).
// ---------------------------------------------------------------------------

const C = require('./xprov-common.cjs');

const OWN_ORG = 'N3URAL-A1';
const OWN_HOST = 'github.com';
const ORIGIN_MAX_CHARS = 10000;
const DOT_NAMES = Object.freeze(['.', '..']); // not repository names
const CLASS = Object.freeze({ ORG: 'org', CUSTOMER: 'customer' });
// scp-like `git@github.com:org/repo(.git)` and URL forms `https|ssh|git://[user[:pw]@]host[:port]/org/repo(.git)`.
const SCP_RE = /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):([^/:][^]*)$/;
const URL_RE = /^(?:https?|ssh|git):\/\/(?:[^/@\s]*@)?([A-Za-z0-9.-]+)(?::\d{1,5})?\/([^]*)$/;

function gitLines(root, args) {
  const r = C.gitSpawn(['-C', String(root), ...args], { env: C.ownerGitEnv() });
  if (r.error) throw C.inputError('git could not be run to read remote.origin.url', 'origin_unreadable');
  if (r.status === 0) return r.stdout.split('\n').filter((l) => l !== '');
  if (r.status === 1 || r.status === 2) return []; // key absent / no such remote
  throw C.inputError('remote.origin.url could not be read', 'origin_unreadable');
}

/** The raw `remote.origin.url` of a checkout: null when absent, the string when every read agrees on one value, else the
 * frozen list of the distinct values. Throws a typed input error when unreadable or oversized. */
function readOrigin(root) {
  const seen = [
    ...gitLines(root, ['config', '--get-all', 'remote.origin.url']),
    ...gitLines(root, ['remote', 'get-url', '--all', 'origin']),
    ...gitLines(root, ['remote', 'get-url', '--push', '--all', 'origin']),
  ];
  const distinct = [...new Set(seen)];
  if (distinct.some((v) => v.length > ORIGIN_MAX_CHARS)) throw C.inputError(`remote.origin.url exceeds ${ORIGIN_MAX_CHARS} characters`, 'origin_too_long');
  if (distinct.length === 0) return null;
  return distinct.length === 1 ? distinct[0] : Object.freeze(distinct);
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

/** True when two identity origins differ (null equals only null; a list equals only the same list). */
const originChanged = (recorded, current) => (recorded === undefined ? false : JSON.stringify(recorded) !== JSON.stringify(current));

/** `org/repo` path of an origin on the own host, or null. */
function ownHostPath(origin) {
  const m = URL_RE.exec(origin) || SCP_RE.exec(origin);
  if (!m || m[1].toLowerCase() !== OWN_HOST) return null;
  return m[2];
}

/** 'org' for an origin of github.com/N3URAL-A1/<repo>, else 'customer' (also for null: no origin, and for a list: disagreeing reads). */
function classifyOrigin(origin) {
  if (typeof origin !== 'string' || origin === '' || origin.length > ORIGIN_MAX_CHARS) return CLASS.CUSTOMER;
  const p = ownHostPath(origin);
  if (p === null) return CLASS.CUSTOMER;
  const parts = p.replace(/\/+$/, '').split('/');
  return parts.length === 2 && parts[0].toLowerCase() === OWN_ORG.toLowerCase() && /^[A-Za-z0-9._-]+$/.test(parts[1]) && !DOT_NAMES.includes(parts[1]) ? CLASS.ORG : CLASS.CUSTOMER;
}

module.exports = { OWN_ORG, ORIGIN_MAX_CHARS, CLASS, readOrigin, bindingIdentity, repoIdentity, originChanged, classifyOrigin };
