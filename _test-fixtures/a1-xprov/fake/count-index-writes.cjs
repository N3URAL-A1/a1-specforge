'use strict';
// Fixture-only preload (NODE_OPTIONS=--require <this file>): records every
// write that lands on a phase's xreview/index.json — rename onto it (the
// atomic path) or a direct writeFileSync — as one line in
// $XPROV_INDEX_WRITES_LOG. Loaded into the gate AND the normalize child, so
// the log counts the writes of the whole gate call (spec 009 R-M5: exactly one).
const fs = require('fs');
const LOG = process.env.XPROV_INDEX_WRITES_LOG;
const isIndex = (p) => typeof p === 'string' && /[\\/]xreview[\\/]index\.json$/.test(p);
const note = (how, p) => { if (LOG && isIndex(p)) fs.appendFileSync(LOG, `${process.pid} ${how} ${p}\n`); };
const rename = fs.renameSync;
fs.renameSync = function renameSync(from, to) { note('rename', String(to)); return rename.call(fs, from, to); };
const write = fs.writeFileSync;
fs.writeFileSync = function writeFileSync(file, ...rest) { note('write', String(file)); return write.call(fs, file, ...rest); };
