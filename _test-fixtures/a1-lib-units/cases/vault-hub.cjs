'use strict';

// vault-hub.cjs — the pure text helpers of `vault link-hub` (spec 010,
// FR-024/FR-025): the hub note is edited as TEXT, one inserted line per
// artifact, so the byte diff of a write is that line and nothing else.

const path = require('path');
const { eq, done } = require('../lib.cjs');

const H = require(path.join(process.argv[2], 'vault-hub.cjs'));
const LINE = '- references [[project/acme/specs/001-login]]';
const ins = (text) => H.insertRelationLine(text, LINE);

eq('H1 relationLine template', H.relationLine('acme', 'specs', '001-login'), LINE);

// H2 — the line already present (also with trailing blanks or CR) -> null.
eq('H2 present -> null', ins(`# Acme\n\n## Relations\n\n${LINE}\n`), null);
eq('H2 present with trailing spaces -> null', ins(`## Relations\n${LINE}   \n`), null);
eq('H2 present with CRLF -> null', ins(`## Relations\r\n${LINE}\r\n`), null);

// H3 — no Relations block: appended at the end.
eq('H3 append block', ins('# Acme\n\nBody.\n'), `# Acme\n\nBody.\n\n## Relations\n\n${LINE}\n`);
eq('H3 append to text without final newline', ins('# Acme'), `# Acme\n\n## Relations\n\n${LINE}\n`);
eq('H3 append to empty text', ins(''), `\n## Relations\n\n${LINE}\n`);
eq('H3 "## Relations and more" is not the block', ins('## Relations and more\n'), `## Relations and more\n\n## Relations\n\n${LINE}\n`);

// H4 — inserted after the last bullet, before the next heading.
// Red-making change: inserting at headingIdx + 1 instead of after the last bullet.
eq('H4 after the last bullet', ins('## Relations\n\n- a\n- b\n\n## Notes\nx\n'), `## Relations\n\n- a\n- b\n${LINE}\n\n## Notes\nx\n`);
eq('H4 bullets of the next section are not counted', ins('## Relations\n- a\n## Notes\n- z\n'), `## Relations\n- a\n${LINE}\n## Notes\n- z\n`);

// H5 — continuation lines of the last bullet stay with it.
eq('H5 after continuation lines', ins('## Relations\n- a\n  wrapped text\n\nafter\n'), `## Relations\n- a\n  wrapped text\n${LINE}\n\nafter\n`);

// H6 — empty block: after the blank line under the heading.
eq('H6 empty block with blank line', ins('## Relations\n\n## Next\n'), `## Relations\n\n${LINE}\n## Next\n`);
eq('H6 heading as the last line', ins('# A\n## Relations'), `# A\n## Relations\n${LINE}`);

// H7 — a CRLF hub gets CRLF on every line it gains.
eq('H7 CRLF append', ins('# Acme\r\n'), `# Acme\r\n\r\n## Relations\r\n\r\n${LINE}\r\n`);
eq('H7 CRLF insert', ins('## Relations\r\n- a\r\n## Notes\r\n'), `## Relations\r\n- a\r\n${LINE}\r\n## Notes\r\n`);
eq('H7 CRLF insert at end without final newline', ins('## Relations\r\n- a'), `## Relations\r\n- a\r\n${LINE}`);

done();
