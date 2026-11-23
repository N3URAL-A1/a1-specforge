'use strict';

// `a1-tools wave <sub>` group dispatcher (spec 027 slice 4, plans D7, D11).

const { emitExit } = require('./emit-exit.cjs');

const USAGE = 'a1-tools wave next-check <slug> <wave> --since <iso> [--project <dir>] [--plan <file>] [--checkpoint-each-wave]\n       a1-tools wave checks <slug> <wave> --diff-base <ref> [--project <dir>] [--migrations <dir>] [--phase <slug>]';

/** @param {string} sub @param {string[]} rest */
function cmdWave(sub, rest) {
  if (sub === 'next-check') return require('./wave-next-check.cjs').cmdWaveNextCheck(rest);
  if (sub === 'checks') return require('./wave-checks.cjs').cmdWaveChecks(rest);
  return emitExit(2, '', `wave: unknown subcommand ${JSON.stringify(String(sub))}\nusage: ${USAGE}\n`);
}

module.exports = { cmdWave };
