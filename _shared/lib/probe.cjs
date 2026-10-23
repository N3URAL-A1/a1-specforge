'use strict';

// probe — command group `probe` (spec 020-live-probes). `probe run` reads .a1/live-probes.yaml from a
// target repo and measures the real effect from outside. Exit contract (FR-002): 0 all pass or no probes,
// 1 a probe failed or was not measured, 2 usage error, hostile file, blocked host, unreadable path.
// Every error exits 2 with a one-line message (no stack trace) that passes through intent-redact.
//
// Wave 1 state: parse + static policy are real; after a successful parse the run is a fail-closed stub
// (exit 2, "not implemented") that wave 4 replaces. The network module is loaded lazily and only after a
// successful parse, so a hostile file never reaches network code.

const fs = require('fs');
const path = require('path');

const MAX_WAIT_S = 600;
const USAGE = 'usage: a1-tools probe run --project <dir> [--wait <seconds>] [--json]';

/** One-line message on stderr, exit 2. Text goes through the shared redactor first. */
function die(msg) {
  const { redact } = require(path.join(__dirname, 'intent-redact.cjs'));
  process.stderr.write(`probe: ${redact(String(msg)).replace(/\s+/g, ' ').slice(0, 500)}\n`);
  process.exit(2);
}

function parseArgs(args) {
  const opts = { project: null, wait: 0, json: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--project' || a === '--wait') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) die(`${a} needs a value. ${USAGE}`);
      i += 1;
      if (a === '--project') opts.project = v;
      else if (!/^\d{1,3}$/.test(v) || Number(v) > MAX_WAIT_S) die(`--wait must be an integer 0..${MAX_WAIT_S}`);
      else opts.wait = Number(v);
    } else die(`unknown argument: ${a.slice(0, 40)}. ${USAGE}`);
  }
  if (!opts.project) die(`--project <dir> is required. ${USAGE}`);
  return opts;
}

function resolveProject(dir) {
  let real;
  try { real = fs.realpathSync(dir); } catch (_e) { return die('project directory not found'); }
  if (!fs.statSync(real).isDirectory()) die('--project is not a directory');
  return real;
}

function cmdProbeRun(args) {
  const opts = parseArgs(args);
  const project = resolveProject(opts.project);
  const { loadProbeConfig, ProbeConfigError } = require(path.join(__dirname, 'probe-config.cjs'));
  try {
    loadProbeConfig(project);
  } catch (e) {
    if (e instanceof ProbeConfigError) die(e.message);
    throw e;
  }
  die('not implemented — spec 020 wave 4');
}

/**
 * @param {string|undefined} sub - 'run'
 * @param {string[]} args
 */
function cmdProbe(sub, args) {
  if (sub !== 'run') die(`probe requires the subcommand "run". ${USAGE}`);
  cmdProbeRun(args);
}

module.exports = { cmdProbe, MAX_WAIT_S };
