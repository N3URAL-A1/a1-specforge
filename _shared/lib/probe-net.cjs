'use strict';

// probe-net — network executors of `probe run` (spec 020-live-probes, FR-005/006/010/011).
//
// SECURITY SURFACE. Target hosts come from a file a pull request can edit, so every connection passes an
// address guard three times: preflight (resolve every listed host), the request `lookup` (re-resolve,
// DNS rebinding) and the connected socket's remoteAddress. Redirects are never followed, TLS is always
// verified, responses are capped, timers destroy sockets. Results never carry a body, a header value or a
// secret; raw error text goes only through intent-redact into stderr diagnostics (see `diagnose`).
// No module-global mutable state: agents, sockets and timers are created per call.

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');

const MAX_BODY = 1024 * 1024;
const MAX_HEADER = 16 * 1024;
const OK = 'ok';
const BLOCKED = 'blocked';
const LOOPBACK = 'loopback';
const UNSAFE_SEGMENTS = ['__proto__', 'constructor', 'prototype'];
const CTRL_RE = /[\u0000-\u001f\u007f]/;

// ---------- address classifier ----------

/** [a,b,c,d] → 'ok' | 'blocked' | 'loopback' */
function classifyV4(b) {
  const [a, c] = [b[0], b[1]];
  if (a === 127) return LOOPBACK;
  if (a === 0 || a === 10 || a >= 224) return BLOCKED; // 0/8, 10/8, 224/4, 240/4, broadcast
  if (a === 100 && c >= 64 && c <= 127) return BLOCKED;
  if (a === 169 && c === 254) return BLOCKED;
  if (a === 172 && c >= 16 && c <= 31) return BLOCKED;
  if (a === 192 && c === 0 && b[2] === 0) return BLOCKED;
  if (a === 192 && c === 168) return BLOCKED;
  if (a === 198 && (c === 18 || c === 19)) return BLOCKED;
  if (a === 192 && c === 0 && b[2] === 2) return BLOCKED; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && c === 51 && b[2] === 100) return BLOCKED; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && c === 0 && b[2] === 113) return BLOCKED; // 203.0.113.0/24 TEST-NET-3
  return OK;
}

function parseV4(s) {
  const p = s.split('.');
  if (p.length !== 4 || !p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return null;
  return p.map(Number);
}

/** IPv6 text → 16 bytes, or null. Handles `::`, embedded dotted v4, zone ids. */
function parseV6(text) {
  let s = text.split('%')[0];
  const dot = s.lastIndexOf(':') >= 0 && s.slice(s.lastIndexOf(':') + 1).includes('.');
  if (dot) {
    const v4 = parseV4(s.slice(s.lastIndexOf(':') + 1));
    if (!v4) return null;
    s = `${s.slice(0, s.lastIndexOf(':') + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h) => (h === '' ? [] : h.split(':'));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < (halves.length === 2 ? 1 : 0)) return null;
  const groups = head.concat(Array(halves.length === 2 ? missing : 0).fill('0'), tail);
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  const out = [];
  for (const g of groups) { const n = parseInt(g, 16); out.push(n >> 8, n & 255); }
  return out;
}

const zero = (b, from, to) => b.slice(from, to).every((x) => x === 0);

/** A v4 address embedded in a v6 one: usable only when it is a public unicast address (loopback in there is still blocked). */
const embedded = (v4) => (classifyV4(v4) === OK ? OK : BLOCKED);

function classifyV6(b) {
  if (zero(b, 0, 16)) return BLOCKED;
  if (zero(b, 0, 15) && b[15] === 1) return LOOPBACK;
  if (zero(b, 0, 10) && b[10] === 255 && b[11] === 255) return classifyV4(b.slice(12)); // ::ffff:a.b.c.d
  if (zero(b, 0, 12)) return classifyV4(b.slice(12)) === OK ? OK : BLOCKED; // ::a.b.c.d (compatible)
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(b, 4, 12)) { // 64:ff9b::/96
    const r = classifyV4(b.slice(12));
    return r === OK ? OK : BLOCKED;
  }
  if (zero(b, 0, 8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) return embedded(b.slice(12)); // ::ffff:0:0/96 (SIIT)
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b[4] === 0 && b[5] === 1) { // 64:ff9b:1::/48 (local-use NAT64)
    return embedded(b.slice(12)) === OK && embedded([b[6], b[7], b[9], b[10]]) === OK ? OK : BLOCKED; // last 32 bits and the RFC 6052 /48 layout
  }
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return BLOCKED; // 2001::/32 Teredo
  if (b[0] === 1 && b[1] === 0 && zero(b, 2, 8)) return BLOCKED; // 100::/64 discard-only
  if (b[0] === 0x20 && b[1] === 0x02) { const r = classifyV4(b.slice(2, 6)); if (r !== OK) return BLOCKED; } // 6to4
  if ((b[0] & 0xfe) === 0xfc) return BLOCKED; // fc00::/7 (covers fd00:ec2::254)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return BLOCKED; // fe80::/10
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return BLOCKED; // fec0::/10 (deprecated site-local)
  if (b[0] === 0xff) return BLOCKED; // ff00::/8
  return OK;
}

/** @returns {'ok'|'blocked'|'loopback'} — unparsable input is blocked (fail closed). */
function classifyAddress(addr) {
  const s = String(addr);
  const kind = net.isIP(s.split('%')[0]);
  if (kind === 4) { const b = parseV4(s); return b ? classifyV4(b) : BLOCKED; }
  if (kind === 6) { const b = parseV6(s); return b ? classifyV6(b) : BLOCKED; }
  return BLOCKED;
}

/** True when a connection to `addr` may be made under `env`. Only `A1_PROBE_ALLOW_LOOPBACK=1` admits loopback. */
function allowed(addr, env) {
  const c = classifyAddress(addr);
  return c === OK || (c === LOOPBACK && !!env && env.A1_PROBE_ALLOW_LOOPBACK === '1');
}

// ---------- lookup + preflight ----------

function blockedError(addr) {
  const e = new Error('blocked_host');
  e.code = 'BLOCKED_HOST';
  e.address = addr;
  return e;
}

/** A dns.lookup-compatible function that re-applies the guard on every resolution. */
function guardedLookup(env, base = dns.lookup) {
  return (hostname, options, cb) => {
    const opts = typeof options === 'function' ? {} : options || {};
    const done = typeof options === 'function' ? options : cb;
    base(hostname, { ...opts, all: true }, (err, list) => {
      if (err) return done(err);
      const bad = list.find((a) => !allowed(a.address, env));
      if (bad) return done(blockedError(bad.address));
      return opts.all ? done(null, list) : done(null, list[0].address, list[0].family);
    });
  };
}

/**
 * Resolve every host and refuse the run if any address is blocked (no probe request has been sent yet).
 * DNS failures are not blocks: the probe itself reports `dns_error`.
 * @param {Array<string|{name:string}>} hosts
 * @returns {Promise<{ok:boolean, reason?:string, host?:string}>}
 */
async function preflight(hosts, env, opts = {}) {
  const lookup = opts.lookup || dns.lookup;
  const names = [...new Set(hosts.map((h) => (typeof h === 'string' ? h : h.name)))];
  for (const name of names) {
    const lit = net.isIP(name.replace(/^\[|\]$/g, ''));
    let addrs;
    if (lit) addrs = [name.replace(/^\[|\]$/g, '')];
    else {
      addrs = await new Promise((resolve) => lookup(name, { all: true }, (e, l) => resolve(e ? [] : l.map((a) => a.address))));
    }
    const bad = addrs.find((a) => !allowed(a, env));
    if (bad) return Object.freeze({ ok: false, reason: 'blocked_host', host: name });
  }
  return Object.freeze({ ok: true });
}

// ---------- shared helpers ----------

/** Raw error text for stderr only, through the shared redactor. */
function diagnose(err) {
  try {
    const { redact } = require(path.join(__dirname, 'intent-redact.cjs'));
    process.stderr.write(`probe-net: ${redact(String((err && err.message) || err)).replace(/\s+/g, ' ').slice(0, 300)}\n`);
  } catch (_e) { /* diagnostics are best effort */ }
}

function mapNetError(err) {
  const code = err && err.code;
  if (code === 'BLOCKED_HOST') return 'blocked_host';
  if (code === 'ECONNREFUSED') return 'unreachable';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL' || code === 'ENODATA') return 'dns_error';
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'reset';
  if (/CERT|TLS|SSL|ERR_TLS|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME_MISMATCH/i.test(String(code))) return 'tls_error';
  if (code === 'ERR_INVALID_CHAR' || code === 'ERR_HTTP_INVALID_HEADER_VALUE' || code === 'ERR_INVALID_HTTP_TOKEN') return 'bad_request';
  return 'unreachable';
}

function result(start, fields) {
  return Object.freeze({ ...fields, duration_ms: Date.now() - start });
}

/** Wrap an agent so the connected address is checked the moment the TCP connect completes. */
function guardConnect(agent, env, onBlocked) {
  const orig = agent.createConnection;
  agent.createConnection = function guarded(o, cb) {
    const sock = orig.call(this, o, cb);
    sock.once('connect', () => {
      if (!allowed(sock.remoteAddress, env)) { onBlocked(); sock.destroy(blockedError(sock.remoteAddress)); }
    });
    return sock;
  };
  return agent;
}

/** IP literals skip `lookup` in net.connect, so the guard is applied to them before any socket exists. */
function literalBlocked(host, env) {
  const h = String(host).replace(/^\[|\]$/g, '');
  return net.isIP(h) !== 0 && !allowed(h, env);
}

function resolveKv(map, env) {
  const out = [];
  for (const [k, v] of Object.entries(map || {})) {
    const val = v.literal !== undefined ? v.literal : env[v.env];
    if (val === undefined || val === '') return { missing: true };
    out.push([k, String(val)]);
  }
  return { missing: false, pairs: out };
}

// ---------- http ----------

function walkJson(root, dotted) {
  let cur = root;
  const segs = dotted.split('.');
  if (segs.some((seg) => UNSAFE_SEGMENTS.includes(seg))) return { bad: true };
  for (const seg of segs) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg)) return { found: false };
    cur = cur[seg];
  }
  return { found: true, value: cur };
}

function checkBody(expect, buf, truncated) {
  if (expect.body_contains === undefined && expect.json === undefined) return null;
  if (truncated) return 'body_too_large';
  const text = buf.toString('utf8');
  if (expect.body_contains !== undefined && !text.includes(expect.body_contains)) return 'body_mismatch';
  if (expect.json !== undefined) {
    let doc;
    try { doc = JSON.parse(text); } catch (_e) { return 'json_invalid'; }
    const w = walkJson(doc, expect.json.path);
    if (w.bad) return 'json_path_invalid';
    if (!w.found || w.value !== expect.json.equals) return 'json_mismatch';
  }
  return null;
}

function judge(expect, status, headers, buf, truncated) {
  if (!expect.status.includes(status)) return 'status_mismatch';
  if (expect.header) {
    const v = headers[expect.header.name.toLowerCase()];
    const flat = Array.isArray(v) ? v.join(', ') : v;
    if (flat === undefined || !flat.includes(expect.header.matches)) return 'header_mismatch';
  }
  return checkBody(expect, buf, truncated);
}

function buildTarget(probe, env) {
  const url = new URL(probe.url);
  const q = resolveKv(probe.query, env);
  const h = resolveKv(probe.headers, env);
  if (q.missing || h.missing) return { missing: true };
  for (const [k, v] of q.pairs) url.searchParams.set(k, v);
  if (h.pairs.some(([, v]) => CTRL_RE.test(v))) return { bad: true };
  return { url, headers: Object.fromEntries(h.pairs) };
}

/**
 * Run one http probe. ctx: {env, lookup?}. `ctx.lookup` replaces the guarded lookup (tests only: it lets a
 * case isolate the connected-address check). Resolves with a frozen {pass, reason, status?, duration_ms}.
 */
function runHttp(probe, ctx) {
  const env = (ctx && ctx.env) || {};
  const start = Date.now();
  return new Promise((resolve) => {
    const target = buildTarget(probe, env);
    if (target.missing) return resolve(result(start, { pass: false, reason: 'env_missing', not_measured: true }));
    if (target.bad) return resolve(result(start, { pass: false, reason: 'bad_request' }));
    const { url } = target;
    if (literalBlocked(url.hostname, env)) return resolve(result(start, { pass: false, reason: 'blocked_host', blocked: true }));
    const mod = url.protocol === 'https:' ? https : http;
    let settled = false;
    let blocked = false;
    let req = null;
    let timer = null;
    const finish = (fields) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (req) req.destroy();
      resolve(result(start, fields));
    };
    const agent = guardConnect(new mod.Agent({ keepAlive: false }), env, () => { blocked = true; });
    timer = setTimeout(() => finish({ pass: false, reason: 'timeout' }), probe.timeout_ms);
    try {
      req = mod.request({
        protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || undefined,
        path: `${url.pathname}${url.search}`, method: probe.method, headers: target.headers, agent,
        lookup: (ctx && ctx.lookup) || guardedLookup(env), maxHeaderSize: MAX_HEADER, rejectUnauthorized: true,
      });
    } catch (e) {
      diagnose(e);
      return finish({ pass: false, reason: 'bad_request' });
    }
    req.on('error', (e) => {
      diagnose(e);
      if (blocked || (e && e.code === 'BLOCKED_HOST')) return finish({ pass: false, reason: 'blocked_host', blocked: true });
      return finish({ pass: false, reason: mapNetError(e) });
    });
    req.on('response', (res) => onResponse(res, probe, finish));
    req.end();
  });
}

function onResponse(res, probe, finish) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  const status = res.statusCode;
  const done = () => {
    const reason = judge(probe.expect, status, res.headers, Buffer.concat(chunks), truncated);
    finish({ pass: reason === null, reason: reason === null ? 'ok' : reason, status, bytes_read: bytes });
  };
  res.on('data', (d) => {
    if (truncated) return;
    bytes += d.length;
    chunks.push(d);
    if (bytes > MAX_BODY) { truncated = true; chunks.length = 0; res.destroy(); done(); }
  });
  res.on('end', done);
  res.on('error', () => finish({ pass: false, reason: 'reset', status }));
  res.on('close', () => { if (!res.complete && !truncated) finish({ pass: false, reason: 'reset', status }); });
}

// ---------- tcp ----------

/** Run one tcp probe. `open` on connect; `closed` on ECONNREFUSED or timeout. */
function runTcp(probe, ctx) {
  const env = (ctx && ctx.env) || {};
  const start = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let sock = null;
    let timer = null;
    const finish = (state, extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (sock) sock.destroy();
      if (state === 'blocked') return resolve(result(start, { pass: false, reason: 'blocked_host', blocked: true }));
      if (state === 'error') return resolve(result(start, { pass: false, reason: extra }));
      const pass = state === probe.expect;
      return resolve(result(start, { pass, reason: pass ? 'ok' : `unexpected_${state}` }));
    };
    if (literalBlocked(probe.host, env)) return finish('blocked');
    timer = setTimeout(() => finish('closed'), probe.timeout_ms);
    sock = net.connect({ host: probe.host.replace(/^\[|\]$/g, ''), port: probe.port, lookup: (ctx && ctx.lookup) || guardedLookup(env) });
    sock.once('connect', () => {
      if (!allowed(sock.remoteAddress, env)) return finish('blocked');
      return finish('open');
    });
    sock.on('error', (e) => {
      diagnose(e);
      if (e && e.code === 'BLOCKED_HOST') return finish('blocked');
      if (e && e.code === 'ECONNREFUSED') return finish('closed');
      return finish('error', mapNetError(e));
    });
  });
}

module.exports = { preflight, runHttp, runTcp, classifyAddress, allowed, guardedLookup, MAX_BODY };
