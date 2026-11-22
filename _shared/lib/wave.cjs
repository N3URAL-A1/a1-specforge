'use strict';

// `a1-tools wave <sub>` group dispatcher (spec 027 slice 4, plan D7). Task 6.1 adds `checks`.

const { emitExit } = require('./emit-exit.cjs');

const USAGE = 'a1-tools wave next-check <slug> <wave> --since <iso> [--project <dir>] [--plan <file>] [--checkpoint-each-wave]';

/** @param {string} sub @param {string[]} rest */
function cmdWave(sub, rest) {
  if (sub === 'next-check') return require('./wave-next-check.cjs').cmdWaveNextCheck(rest);
  return emitExit(2, '', `wave: unknown subcommand ${JSON.stringify(String(sub))}\nusage: ${USAGE}\n`);
}

module.exports = { cmdWave };
