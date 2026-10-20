'use strict';

// ---------------------------------------------------------------------------
// xprov-homemark — the owner marker of the dedicated review home (spec 016 Wave 8 review, W8-3).
//
// The gate repairs a review home by itself (xprov-recover.cjs preflightWithRepair). It may do so only in a home the OWNER made:
// `xprov init-home` (an owner command, run in a terminal) writes this marker file; the repair never writes it. A home reached
// through A1_XPROV_CODEX_HOME that carries no marker is not repaired — the override could point at any directory. The default
// home `~/.codex-a1-review` is the canonical name and needs no marker.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER_FILE = '.a1-review-home';
const MARKER_TEXT = 'a1-xprov review home (written by `xprov init-home`; the gate repairs only a home that carries this file)\n';
const MARKER_MODE = 0o600;
const MARKER_READ_BYTES = 256;
const CANONICAL_DIRNAME = '.codex-a1-review';

const real = (p) => { try { return fs.realpathSync(p); } catch (_e) { return path.resolve(p); } };

/** Writes the marker once (flag wx: an existing file is never rewritten); true when the home carries a valid one afterwards. */
function writeOwnerMarker(home) {
  const file = path.join(home, MARKER_FILE);
  try {
    fs.writeFileSync(file, MARKER_TEXT, { flag: 'wx', mode: MARKER_MODE });
  } catch (e) {
    if (e.code !== 'EEXIST') return false;
  }
  return hasOwnerMarker(home);
}

/** A regular file (no link) in the home's top level with the marker text. */
function hasOwnerMarker(home) {
  const file = path.join(home, MARKER_FILE);
  try {
    if (!fs.lstatSync(file).isFile()) return false;
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const buf = Buffer.alloc(MARKER_READ_BYTES);
      const n = fs.readSync(fd, buf, 0, MARKER_READ_BYTES, 0);
      return buf.toString('utf8', 0, n) === MARKER_TEXT;
    } finally { fs.closeSync(fd); }
  } catch (_e) { return false; }
}

/** The default review home name under the user's home (compared by realpath). */
function isCanonicalHome(home, homedir) {
  return real(home) === real(path.join(homedir || os.homedir(), CANONICAL_DIRNAME));
}

module.exports = { MARKER_FILE, MARKER_TEXT, writeOwnerMarker, hasOwnerMarker, isCanonicalHome };
