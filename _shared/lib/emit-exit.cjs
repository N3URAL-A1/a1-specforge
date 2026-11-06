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
// Errors: EPIPE (the reader went away) keeps `code`; any other stream error (ENOSPC, EIO)
// means the payload was lost, so the exit code becomes 2.

const STREAM_ERROR_EXIT = 2;
let done = false;

function emitExit(code, stdoutText, stderrText, opts) {
  if (done) return; // first emit wins, like the process.exit() it replaces
  done = true;
  process.exitCode = code;
  const stderrFirst = Boolean(opts && opts.stderrFirst);
  const all = stderrFirst
    ? [[process.stderr, stderrText], [process.stdout, stdoutText]]
    : [[process.stdout, stdoutText], [process.stderr, stderrText]];
  const parts = all.filter(([, t]) => typeof t === 'string' && t.length > 0);
  if (parts.length === 0) { process.exit(code); return; }
  let exitWith = code;
  let pending = parts.length;
  const finish = (err) => {
    if (err && err.code !== 'EPIPE') exitWith = STREAM_ERROR_EXIT;
    pending -= 1;
    if (pending === 0) process.exit(exitWith);
  };
  for (const [stream, text] of parts) {
    stream.on('error', () => {}); // reported through the write callback, not as an uncaught event
    stream.write(text, finish);
  }
}

module.exports = { emitExit };
