'use strict';

// Loopback test server of the a1-probe suite (spec 020). Binds 127.0.0.1 only, ephemeral ports.
// Prints ONE line on stdout once ready: {"http":<port>,"tcp":<port>}. The suite starts it with
// `node server.cjs & SRV_PID=$!` and kills only that PID.
//
// Routes (every request except /__count is counted per path):
//   /ok          200 {"ok":true} + header x-probe: yes
//   /boom        500 {"error":"internal"}            (shape of the 2026-09-26 a1-office postmortem)
//   /flaky       503, 503, then 200 (per server run)
//   /redirect    302 Location: http://other.invalid/ (never followed)
//   /deny        403
//   /anon        200 normally, 401 with --fixed      (shape of the 2026-10-15 a1-office postmortem)
//   /hang        never answers
//   /slow        trickles one byte per 200 ms        (slow-loris)
//   /big         5 MiB body
//   /echo-secret 200, echoes the request Authorization header in the body
//   /__count     {"total":N,"routes":{path:n}}       (not counted itself)
// The TCP listener accepts and ends every connection; its connections are counted as "tcp".

const http = require('http');
const net = require('net');

const FIXED = process.argv.includes('--fixed');
const counts = Object.create(null);
let flaky = 0;
const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };

function route(req, res) {
  const p = (req.url || '/').split('?')[0];
  if (p === '/__count') {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ total, routes: counts }));
    return;
  }
  bump(p);
  const send = (code, body, headers) => { res.writeHead(code, { 'content-type': 'application/json', ...(headers || {}) }); res.end(body); };
  if (p === '/ok') send(200, '{"ok":true}', { 'x-probe': 'yes' });
  else if (p === '/boom') send(500, '{"error":"internal"}');
  else if (p === '/flaky') { flaky += 1; if (flaky <= 2) send(503, '{"error":"starting"}'); else send(200, '{"ok":true}'); }
  else if (p === '/redirect') send(302, '', { location: 'http://other.invalid/' });
  else if (p === '/deny') send(403, '{"error":"forbidden"}');
  else if (p === '/anon') { if (FIXED) send(401, '{"error":"unauthorized"}'); else send(200, '{"rows":[]}'); }
  else if (p === '/hang') { /* never answers */ }
  else if (p === '/slow') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    const t = setInterval(() => { if (res.writableEnded || res.destroyed) { clearInterval(t); return; } res.write('x'); }, 200);
    res.on('close', () => clearInterval(t));
  } else if (p === '/big') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(Buffer.alloc(5 * 1024 * 1024, 0x61));
  } else if (p === '/echo-secret') send(200, JSON.stringify({ echo: req.headers.authorization || '' }));
  else send(404, '{"error":"not_found"}');
}

const httpServer = http.createServer(route);
const tcpServer = net.createServer((s) => { bump('tcp'); s.on('error', () => {}); s.end(); });

httpServer.listen(0, '127.0.0.1', () => {
  tcpServer.listen(0, '127.0.0.1', () => {
    process.stdout.write(`${JSON.stringify({ http: httpServer.address().port, tcp: tcpServer.address().port })}\n`);
  });
});
