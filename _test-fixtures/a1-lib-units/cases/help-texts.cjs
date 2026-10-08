'use strict';

// help-intent.cjs, help-vault.cjs, help-xprov.cjs — the help texts of the
// intent, vault/spec/schema and xprov command groups, split out of help.cjs.
// Low risk (text only); what can drift is a subcommand the router accepts but
// --help never mentions, or a block that no longer reaches --help. The
// subcommand lists are literals here; the router lists are pinned against the
// same literals so both sides are measured, not copied (testing.md class 4).

const path = require('path');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const { INTENT_HELP } = require(path.join(LIB, 'help-intent.cjs'));
const { SPEC_INIT_HELP, VAULT_HELP } = require(path.join(LIB, 'help-vault.cjs'));
const { XPROV_HELP } = require(path.join(LIB, 'help-xprov.cjs'));
const { HELP } = require(path.join(LIB, 'help.cjs'));

const INTENT_SUBS = ['validate', 'device', 'claim', 'reject', 'complete', 'run', 'tick', 'watch', 'list', 'schema', 'doctor', 'approve', 'install-agent', 'seal'];
const XPROV_SUBS = ['normalize', 'gc', 'preflight', 'init-home', 'permit-check', 'permit', 'observe', 'snapshot', 'run', 'gate', 'load-check', 'wave-status', 'waive', 'allowlist'];
const VAULT_SUBS = ['sync', 'status', 'lint', 'link-hub', 'writer'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const BLOCKS = { INTENT_HELP, SPEC_INIT_HELP, VAULT_HELP, XPROV_HELP };

// T1 — every block is a non-empty string and reaches `a1-tools --help` verbatim.
// Red-making change: dropping `${INTENT_HELP}` (or any block) from HELP in help.cjs.
for (const [name, text] of Object.entries(BLOCKS)) {
  check(`T1 ${name} is non-empty text`, typeof text === 'string' && text.trim().length > 0);
  check(`T1 ${name} is part of --help`, HELP.includes(text));
}

// T2 — every intent subcommand has its `a1-tools intent <sub>` entry, and
// the router accepts exactly those.
// Red-making change: adding a subcommand to intent-cli's table without a help entry.
for (const sub of INTENT_SUBS) check(`T2 intent ${sub} documented`, new RegExp(`a1-tools intent ${esc(sub)}(\\s|$)`, 'm').test(INTENT_HELP));
eq('T2 intent router = documented list', require(path.join(LIB, 'intent-cli.cjs')).SUBCOMMAND_NAMES, INTENT_SUBS);

// T3 — every xprov subcommand has an entry line (four-space indent) in XPROV_HELP.
for (const sub of XPROV_SUBS) check(`T3 xprov ${sub} documented`, new RegExp(`^ {4}${esc(sub)}(\\s|$)`, 'm').test(XPROV_HELP));
eq('T3 xprov router = documented list', require(path.join(LIB, 'xprov.cjs')).SUBCOMMAND_NAMES, XPROV_SUBS);

// T4 — vault, spec init and schema export entries.
for (const sub of VAULT_SUBS) check(`T4 vault ${sub} documented`, new RegExp(`a1-tools vault ${esc(sub)}(\\s|$)`, 'm').test(VAULT_HELP));
check('T4 schema export documented', /a1-tools schema export(\s|$)/m.test(VAULT_HELP));
check('T4 spec init documented', /a1-tools spec init(\s|$)/m.test(SPEC_INIT_HELP));

// T5 — plain terminal text: no tabs, no CR, no trailing blanks, no control characters.
for (const [name, text] of Object.entries(BLOCKS)) {
  check(`T5 ${name} has no tab`, !text.includes('\t'));
  check(`T5 ${name} has no CR`, !text.includes('\r'));
  eq(`T5 ${name} has no trailing blanks`, text.split('\n').filter((l) => /[ \t]$/.test(l)).length, 0);
  check(`T5 ${name} has no control characters`, !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text));
}

done();
