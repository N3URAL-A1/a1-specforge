'use strict';
// emitExit(code, stdoutText, stderrText, opts): write the payload, then exit with `code`
// only after stdout and stderr have flushed.
//
// Why (fix 2026-11-05-stdout-pipe-truncation): on macOS a pipe write is asynchronous.
// `process.stdout.write(big); process.exit(0)` ends the process while data still waits
// in libuv's queue, so the reader gets exactly one pipe buffer (65536 bytes). Files and
// Linux pipes are synchronous, which hides the defect there.
//
// process.exitCode is set first, so the code is right even if the callback never runs.
// The exit happens in the last write callback (not by waiting for the loop to empty),
// because a lingering handle must not keep the CLI alive. Callers `return emitExit(...)`:
// code after the call still runs until the callbacks fire.
//
// Order: stdout is written before stderr (what almost every replaced site did).
// `{ stderrFirst: true }` keeps the two sites that wrote stderr first.
// The writes run in sequence: the second starts in the first one's callback. Started together,
// the second write slips into the shared pipe between the chunks of the first one on macOS,
// so under `2>&1` stderr lands inside stdout at byte 65536.
// Errors: EPIPE (the reader went away) keeps `code`; any other stream error (ENOSPC, EIO)
// means the payload was lost, so the exit code becomes 2 and one best-effort line names the cause.
// A failed first stream does not stop the second.

const fs = require('fs');

const STREAM_ERROR_EXIT = 2;
const STDERR_FD = 2;
let done = false;

function reportStreamError(name, err) {
  try { fs.writeSync(STDERR_FD, `a1-tools: ${name} write failed: ${err.code || err.message}\n`); } catch { /* nothing left to tell */ }
}

function emitExit(code, stdoutText, stderrText, opts) {
  if (done) return; // first emit wins, like the process.exit() it replaces
  done = true;
  process.exitCode = code;
  const stderrFirst = Boolean(opts && opts.stderrFirst);
  const all = stderrFirst
    ? [['stderr', process.stderr, stderrText], ['stdout', process.stdout, stdoutText]]
    : [['stdout', process.stdout, stdoutText], ['stderr', process.stderr, stderrText]];
  const parts = all.filter(([, , t]) => typeof t === 'string' && t.length > 0);
  let exitWith = code;
  const step = (i) => {
    if (i >= parts.length) { process.exit(exitWith); return; }
    const [name, stream, text] = parts[i];
    stream.on('error', () => {}); // reported through the write callback, not as an uncaught event
    stream.write(text, (err) => {
      if (err && err.code !== 'EPIPE') { exitWith = STREAM_ERROR_EXIT; reportStreamError(name, err); }
      step(i + 1);
    });
  };
  step(0);
}

module.exports = { emitExit };
