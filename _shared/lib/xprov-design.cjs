'use strict';

// ---------------------------------------------------------------------------
// xprov-design — helpers for the design-file review (spec 025). Wave 4 only carries `pathsIn`, moved verbatim out of the deleted
// xprov-placement.cjs; Wave 5 extends this module with the design snapshot and hash logic. Pure functions, no I/O.
// ---------------------------------------------------------------------------

const BACKTICK_RE = /`([^`\n]+)`/g;
// a path token has no whitespace and none of the shell-active characters `$ ( ) ; | & < > " '`
const PATH_SHAPE_RE = /^[^\s$();|&<>"']+$/;
const EXT_RE = /\.[A-Za-z0-9]{1,8}$/;

/** Backtick-quoted path candidates of a text. Hostile spans (spaces, `$(…)`, `;`) are inert text and are skipped. */
function pathsIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(BACKTICK_RE)) {
    const t = m[1].trim();
    if (t === '' || !PATH_SHAPE_RE.test(t)) continue;
    if (t.includes('/') || EXT_RE.test(t)) out.add(t);
  }
  return [...out];
}

module.exports = { pathsIn };
