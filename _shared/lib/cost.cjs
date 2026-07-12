'use strict';

const fs = require('fs');
const path = require('path');
const { parseFlags } = require('./io.cjs');
const { usage } = require('./help.cjs');

// ---------------------------------------------------------------------------
// cost — token spend aggregation from Claude Code session JSONL (M6 Task 2.2)
//
// Implementation contract: _shared/cost-format-notes.md (M6 Task 1.3 spike).
// Key rules:
//   - Only lines with type === "assistant" AND message.usage carry token data.
//   - Streamed messages duplicate usage per message.id (up to 4 lines) —
//     aggregate ONCE per unique message.id (last line wins, per file).
//   - Sub-agent usage lives in <sessionId>/subagents/agent-*.jsonl and is NOT
//     in the main session totals — it must be ADDED to the owning session.
//   - Malformed lines are skipped with a warning counter, never crash.
//
// Owns stdout + exit code: 0 = ok, 2 = error (dir missing / no JSONL files).
// ---------------------------------------------------------------------------

function costEmptyTotals() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

function costAddUsage(t, usage) {
  t.input += usage.input_tokens || 0;
  t.output += usage.output_tokens || 0;
  t.cacheRead += usage.cache_read_input_tokens || 0;
  t.cacheCreation += usage.cache_creation_input_tokens || 0;
}

// Parse one JSONL file: dedup by message.id (last wins), apply time window.
// Returns { events: [{id, model, timestamp, usage}], skippedLines }.
function costParseJsonlFile(filePath, sinceMs, untilMs) {
  const byId = new Map(); // message.id → event (last wins)
  let skippedLines = 0;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      skippedLines++;
      continue;
    }
    if (!obj || obj.type !== 'assistant') continue;
    const msg = obj.message;
    if (!msg || !msg.usage || !msg.id) continue;
    byId.set(msg.id, {
      id: msg.id,
      model: msg.model || 'unknown',
      timestamp: obj.timestamp || null,
      usage: msg.usage,
    });
  }
  const events = [];
  for (const ev of byId.values()) {
    if (sinceMs !== null || untilMs !== null) {
      const ts = ev.timestamp ? Date.parse(ev.timestamp) : NaN;
      if (Number.isNaN(ts)) continue; // no timestamp → cannot window-match
      if (sinceMs !== null && ts < sinceMs) continue;
      if (untilMs !== null && ts > untilMs) continue;
    }
    events.push(ev);
  }
  return { events, skippedLines };
}

function cmdCostRun(args) {
  const flags = parseFlags(args, {
    project: 'value',
    since: 'value',
    until: 'value',
    json: 'bool',
  });
  const dir = flags.project;
  if (!dir) usage('cost run requires --project <claude-projects-dir>');

  let sinceMs = null;
  let untilMs = null;
  if (flags.since) {
    sinceMs = Date.parse(flags.since);
    if (Number.isNaN(sinceMs)) {
      process.stderr.write(`error: invalid --since timestamp: ${flags.since}\n`);
      process.exit(2);
    }
  }
  if (flags.until) {
    untilMs = Date.parse(flags.until);
    if (Number.isNaN(untilMs)) {
      process.stderr.write(`error: invalid --until timestamp: ${flags.until}\n`);
      process.exit(2);
    }
  }

  let mainLogs;
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`project dir not found: ${dir}`);
    }
    mainLogs = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl') && fs.statSync(path.join(dir, f)).isFile())
      .sort();
    if (mainLogs.length === 0) throw new Error(`no .jsonl session logs in: ${dir}`);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(2);
  }

  const sessions = [];
  const grand = costEmptyTotals();
  const perModel = {}; // model → totals
  let skippedLines = 0;

  for (const file of mainLogs) {
    const sessionId = file.replace(/\.jsonl$/, '');
    const files = [path.join(dir, file)];
    // sub-agent logs: <dir>/<sessionId>/subagents/agent-*.jsonl (ADDED, not duplicated)
    const subDir = path.join(dir, sessionId, 'subagents');
    if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      for (const sf of fs.readdirSync(subDir).sort()) {
        if (sf.endsWith('.jsonl')) files.push(path.join(subDir, sf));
      }
    }

    const totals = costEmptyTotals();
    const models = new Set();
    let eventCount = 0;
    for (const fp of files) {
      const { events, skippedLines: skipped } = costParseJsonlFile(fp, sinceMs, untilMs);
      skippedLines += skipped;
      for (const ev of events) {
        costAddUsage(totals, ev.usage);
        if (!perModel[ev.model]) perModel[ev.model] = costEmptyTotals();
        costAddUsage(perModel[ev.model], ev.usage);
        models.add(ev.model);
        eventCount++;
      }
    }
    costAddUsage(grand, {
      input_tokens: totals.input,
      output_tokens: totals.output,
      cache_read_input_tokens: totals.cacheRead,
      cache_creation_input_tokens: totals.cacheCreation,
    });
    if (eventCount > 0) {
      sessions.push({
        session: sessionId,
        models: [...models].sort(),
        events: eventCount,
        input: totals.input,
        output: totals.output,
        cacheRead: totals.cacheRead,
        cacheCreation: totals.cacheCreation,
        total: totals.input + totals.output + totals.cacheRead + totals.cacheCreation,
      });
    }
  }

  const total = grand.input + grand.output + grand.cacheRead + grand.cacheCreation;
  const summaryLine = `Cost: ${total} tokens (in ${grand.input}, out ${grand.output}, cache ${grand.cacheRead + grand.cacheCreation})`;

  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          project: dir,
          since: flags.since || null,
          until: flags.until || null,
          sessions,
          perModel,
          totals: {
            input: grand.input,
            output: grand.output,
            cacheRead: grand.cacheRead,
            cacheCreation: grand.cacheCreation,
            total,
          },
          skippedLines,
          summary: summaryLine,
        },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write('SESSION                               MODELS                          IN        OUT       CACHE\n');
    for (const s of sessions) {
      process.stdout.write(
        `${s.session.padEnd(38)}${s.models.join(',').padEnd(32)}${String(s.input).padEnd(10)}${String(s.output).padEnd(10)}${s.cacheRead + s.cacheCreation}\n`
      );
    }
    if (skippedLines > 0) process.stdout.write(`WARN: ${skippedLines} malformed line(s) skipped\n`);
    process.stdout.write(`${summaryLine}\n`);
  }
  process.exit(0);
}

module.exports = { cmdCostRun };
