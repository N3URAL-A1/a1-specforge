'use strict';
// Preloaded via NODE_OPTIONS=--require so `new Date()` / Date.now() are fixed.
// Keeps the golden files stable across days (stage writes `started: <today>`).
const FIXED = Date.parse('2026-07-14T12:00:00.000Z');
const RealDate = Date;
class PinnedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
  static now() { return FIXED; }
}
global.Date = PinnedDate;
