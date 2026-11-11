'use strict';

// xprov-design.cjs — `pathsIn` (spec 025 Wave 4: moved verbatim out of the deleted xprov-placement.cjs; Wave 5 extends the module).
// Expectations are literals, never values taken from the module.

const path = require('path');
const { check, eq, done } = require('../lib.cjs');

const D = require(path.join(process.argv[2], 'xprov-design.cjs'));

check('D1 pathsIn is exported as a function', typeof D.pathsIn === 'function', typeof D.pathsIn);
if (typeof D.pathsIn !== 'function') { done(); process.exit(1); }

eq('D2 backticked paths and file names are found', D.pathsIn('Edit `src/a.js` and `README.md`, not `plain`.'), ['src/a.js', 'README.md']);
eq('D3 duplicates collapse to one entry', D.pathsIn('`a/b.cjs` then `a/b.cjs`'), ['a/b.cjs']);
eq('D4 a word without slash or extension is no path', D.pathsIn('use `foo` here'), []);
eq('D5 hostile spans are inert text', D.pathsIn('`rm -rf /` `$(id)/x.js` `a;b/c` `a|b.js` `"q"/x.js`'), []);
eq('D6 text without backticks yields nothing', D.pathsIn('src/a.js and b.md'), []);
eq('D7 a non-string input is read as text', D.pathsIn(null), []);
done();
