'use strict';
/**
 * strip-blocks.cjs — removes `<!-- a1-profile:kritis -->` ... `<!-- /a1-profile:kritis -->`
 * marked blocks from a prompt file's text, so the REST of the file can be
 * compared byte for byte against its golden copy (spec
 * 006-specforge-kritis-profile, FR-008). Pure text in, text out — no file
 * I/O of its own beyond the CLI wrapper below, so it is usable both as a
 * library (parts/01-golden.sh calls stripBlocks() via `node -e`) and as a
 * one-shot CLI.
 *
 *   node strip-blocks.cjs <file>        → prints the stripped text to stdout
 *
 * Rules (wave-plan Wave 1 brief item 4):
 *   - every block opens with `<!-- a1-profile:kritis -->` on its own line
 *     and closes with `<!-- /a1-profile:kritis -->` on its own line.
 *   - the FIRST line inside every block MUST be exactly the guard sentence
 *     `**KRITIS profile only** — skip this block unless the run profile is
 *     \`kritis\`.` — a block without it is refused (exit 2), so a profile
 *     edit can never land invisibly.
 *   - an unbalanced open (no matching close) or a nested open (a second
 *     open before the first close) is refused (exit 2).
 *   - blocks are removed ENTIRELY (open marker, guard line, body, close
 *     marker) — nothing of a block survives the strip, by design: the
 *     stripped text is what a no-profile run must still produce verbatim.
 *
 * Exit codes (CLI only): 0 printed, 2 unbalanced/nested/missing-guard or
 * unreadable file.
 */

const OPEN = '<!-- a1-profile:kritis -->';
const CLOSE = '<!-- /a1-profile:kritis -->';
const GUARD = '**KRITIS profile only** — skip this block unless the run profile is `kritis`.';

/**
 * stripBlocks(text) -> { text: string, blocks: number }
 * Throws Error (message starts with one of the fixed reason codes below) on
 * any structural violation. Never partially strips: a violation means the
 * caller gets nothing usable, by design (fail-closed on malformed markers).
 */
function stripBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  let blocks = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === CLOSE) {
      throw new Error(`unbalanced_close: line ${i + 1} closes a block that was never opened`);
    }
    if (line.trim() !== OPEN) {
      out.push(line);
      i += 1;
      continue;
    }
    // line i is the OPEN marker — find its matching CLOSE, refusing nesting.
    const guardLine = lines[i + 1];
    if (guardLine === undefined) {
      throw new Error(`unbalanced_open: line ${i + 1} opens a block with no content and no close`);
    }
    if (guardLine.trim() !== GUARD) {
      throw new Error(
        `missing_guard: block opened at line ${i + 1} does not start with the guard sentence (got: ${JSON.stringify(guardLine)})`
      );
    }
    let j = i + 1;
    let closeAt = -1;
    while (j < lines.length) {
      const l = lines[j].trim();
      if (l === OPEN) {
        throw new Error(`nested_open: line ${j + 1} opens a block before line ${i + 1}'s block closed`);
      }
      if (l === CLOSE) {
        closeAt = j;
        break;
      }
      j += 1;
    }
    if (closeAt === -1) {
      throw new Error(`unbalanced_open: block opened at line ${i + 1} has no matching close`);
    }
    blocks += 1;
    i = closeAt + 1; // drop the whole block, open marker through close marker
  }
  return { text: out.join('\n'), blocks };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: node strip-blocks.cjs <file>\n');
    process.exit(2);
  }
  const fs = require('fs');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    process.stderr.write(`strip-blocks: cannot read ${file}: ${e.message}\n`);
    process.exit(2);
  }
  try {
    const { text } = stripBlocks(raw);
    process.stdout.write(text);
  } catch (e) {
    process.stderr.write(`strip-blocks: ${file}: ${e.message}\n`);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { stripBlocks, OPEN, CLOSE, GUARD };
