'use strict';

// probe-config — reader and static policy of `.a1/live-probes.yaml` (spec 020-live-probes, FR-003/004/008/012).
//
// The file is attacker-influenced input (a pull request can edit it), so this is a CLOSED grammar, not YAML:
// indented maps and lists of maps, scalars, `[]`, int lists for `status`, and the `{env: NAME}` reference.
// Refused at parse time: anchors, aliases, tags, merge keys, block scalars, flow maps, `${`, tabs and every
// control character. Every key level has an allowlist. All policy (kinds, methods by host class, hosts,
// schemes, secrets, bounds) is decided here, before any network module is loaded. No network, no shell, no module-global state (the only child processes
// are the fixed-argv git reads of the probe file, in probe-config-file.cjs): loadProbeConfig() returns a deeply frozen, normalized value.
//
// Errors name a code and the dotted key path (`probes[0].headers.Authorization`), never a value.

const path = require('path');
const { ProbeConfigError, fail, FILE_REL, MAX_BYTES, assertPlainConfigDir, readProbeFile } = require(path.join(__dirname, 'probe-config-file.cjs'));

const CLASSES = ['production', 'preview', 'staging'];
const METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE'];
const MUTATING = ['POST', 'PUT', 'DELETE'];
const DEFAULT_TIMEOUT_MS = 10000;
const CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\ufeff]/;
const KEY_RE = /^([A-Za-z0-9_][A-Za-z0-9_-]*):(?: +(.*))?$/;
const ENV_REF_RE = /^\{ *env: *([^ {}]*) *\}$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const INT_LIST_RE = /^\[ *\d{1,3}(?: *, *\d{1,3})* *\]$/;
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;
const QUERY_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const HOST_NAME_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const JSON_PATH_RE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
const SECRET_KEY_RE = /authorization|token|secret|password|key|cookie/i;
const UNSAFE_NAMES = ['__proto__', 'constructor', 'prototype'];
const MAX_PROBES = 50;
const MAX_VALUE = 1024;
const MAX_LINE_BYTES = 4096;
const HTTP_KEYS = ['kind', 'url', 'method', 'headers', 'query', 'expect', 'timeout_ms'];
const TCP_KEYS = ['kind', 'host', 'port', 'expect', 'timeout_ms'];


class EnvRef { constructor(name) { this.name = name; } }
const isMap = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === null;
const isInt = (v, lo, hi) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

// ---------- reader ----------

function tokenize(text) {
  const out = [];
  text.split('\n').forEach((l, idx) => {
    if (Buffer.byteLength(l) > MAX_LINE_BYTES) fail('bad_line', '', idx + 1); // before any regex: no hostile line gets to the matcher
    const m = /^( *)(.*)$/.exec(l); // linear: the trailing blanks are trimmed by string method, not by a backtracking group
    let end = m[2].length;
    while (end > 0 && m[2][end - 1] === ' ') end -= 1; // trailing blanks (spaces only, as before)
    const body = m[2].slice(0, end);
    if (body === '' || body.startsWith('#')) return;
    out.push({ indent: m[1].length, text: body, no: idx + 1 });
  });
  return out;
}

function parseScalar(raw, where, no) {
  if (raw.includes('${')) fail('expansion_refused', where, no);
  if (raw === '[]') return [];
  if (/^"[^"\\]*"$/.test(raw) || /^'[^']*'$/.test(raw)) return raw.slice(1, -1);
  const refusals = { '&': 'anchor_refused', '*': 'alias_refused', '!': 'tag_refused', '|': 'block_scalar_refused', '>': 'block_scalar_refused' };
  if (refusals[raw[0]]) fail(refusals[raw[0]], where, no);
  if (raw[0] === '"' || raw[0] === "'") fail('bad_quoted_string', where, no);
  if (raw[0] === '{') {
    const m = ENV_REF_RE.exec(raw);
    if (!m) fail('flow_style_refused', where, no);
    if (!ENV_NAME_RE.test(m[1])) fail('bad_env_name', where, no);
    return new EnvRef(m[1]);
  }
  if (raw[0] === '[') {
    if (!INT_LIST_RE.test(raw)) fail('flow_style_refused', where, no);
    return raw.slice(1, -1).split(',').map((s) => Number(s.trim()));
  }
  if (/^[@`%]/.test(raw) || raw.includes(' #') || raw.includes(': ')) fail('bad_scalar', where, no);
  if (/^-?\d{1,15}$/.test(raw)) return Number(raw);
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (raw === 'null' || raw === '~') fail('null_refused', where, no);
  return raw;
}

const isItem = (t) => t === '-' || t.startsWith('- ');

function parseBlock(st, indent, where) {
  const ln = st.lines[st.i];
  if (ln.indent !== indent) fail('bad_indent', where, ln.no);
  return isItem(ln.text) ? parseList(st, indent, where) : parseMap(st, indent, where);
}

function parseList(st, indent, where) {
  const items = [];
  while (st.i < st.lines.length && st.lines[st.i].indent === indent && isItem(st.lines[st.i].text)) {
    const ln = st.lines[st.i];
    const rest = ln.text.slice(1);
    const body = rest.replace(/^ +/, '');
    const w = `${where}[${items.length}]`;
    if (body === '') fail('empty_list_item', w, ln.no);
    st.lines[st.i] = { indent: indent + 1 + (rest.length - body.length), text: body, no: ln.no };
    items.push(parseMap(st, st.lines[st.i].indent, w));
  }
  return items;
}

function parseMap(st, indent, where) {
  const map = Object.create(null);
  while (st.i < st.lines.length && st.lines[st.i].indent === indent && !isItem(st.lines[st.i].text)) {
    const ln = st.lines[st.i];
    const m = KEY_RE.exec(ln.text);
    if (!m) fail('bad_line', where, ln.no);
    const w = where ? `${where}.${m[1]}` : m[1];
    if (m[1] in map) fail('duplicate_key', w, ln.no);
    st.i += 1;
    if (m[2] === undefined || m[2] === '') {
      const nxt = st.lines[st.i];
      if (!nxt || nxt.indent <= indent) fail('empty_value', w, ln.no);
      map[m[1]] = parseBlock(st, nxt.indent, w);
    } else {
      map[m[1]] = parseScalar(m[2], w, ln.no);
    }
  }
  return map;
}

function parseDocument(text) {
  const st = { lines: tokenize(text), i: 0 };
  if (st.lines.length === 0) fail('empty_file', FILE_REL);
  const tree = parseMap(st, st.lines[0].indent === 0 ? 0 : fail('bad_indent', '', st.lines[0].no), '');
  if (st.i < st.lines.length) fail('bad_indent', '', st.lines[st.i].no);
  return tree;
}

// ---------- policy ----------

function only(obj, allowed, where) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail('unknown_key', where ? `${where}.${k}` : k);
}
function need(obj, key, where) {
  if (obj[key] === undefined) fail('missing_key', `${where}.${key}`);
  return obj[key];
}
function needMap(v, where) {
  if (!isMap(v)) fail('not_a_map', where);
  return v;
}

function validateHosts(list) {
  if (list === undefined) return new Map();
  if (!Array.isArray(list)) fail('not_a_list', 'hosts');
  const hosts = new Map();
  list.forEach((h, i) => {
    const w = `hosts[${i}]`;
    needMap(h, w);
    only(h, ['name', 'class', 'allow_http'], w);
    const name = need(h, 'name', w);
    if (typeof name !== 'string' || !HOST_NAME_RE.test(name)) fail('bad_host_name', `${w}.name`);
    if (!CLASSES.includes(need(h, 'class', w))) fail('bad_class', `${w}.class`);
    if (h.allow_http !== undefined && typeof h.allow_http !== 'boolean') fail('bad_value', `${w}.allow_http`);
    if (hosts.has(name)) fail('duplicate_host', `${w}.name`);
    hosts.set(name, Object.freeze({ name, class: h.class, allow_http: h.allow_http === true }));
  });
  return hosts;
}

function hostOf(hosts, name, where) {
  const h = typeof name === 'string' ? hosts.get(name) : undefined;
  if (!h) fail('host_not_listed', where);
  return h;
}

function parseUrl(raw, where, hosts) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\s\\]/.test(raw)) fail('bad_url', where);
  let u;
  try { u = new URL(raw); } catch (_e) { fail('bad_url', where); }
  if (u.username || u.password) fail('url_userinfo_refused', where);
  const host = hostOf(hosts, u.hostname, where);
  if (!/^[a-z][a-z0-9+.-]*:/.test(raw)) fail('bad_url', where); // SEC-7a: the scheme is written in lower case, no case-folded spelling reaches a check
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && host.allow_http)) fail('scheme_refused', where);
  return { url: raw, host, protocol: u.protocol };
}

function validateKv(m, where, nameRe) {
  needMap(m, where);
  const names = Object.keys(m);
  if (names.length > 32) fail('too_many_entries', where);
  const out = Object.create(null); // a plain {} would turn a `__proto__` key into a prototype swap
  for (const k of names) {
    const w = `${where}.${k}`;
    const v = m[k];
    if (!nameRe.test(k) || UNSAFE_NAMES.includes(k)) fail('bad_name', w);
    if (v instanceof EnvRef) { out[k] = { env: v.name }; continue; }
    if (SECRET_KEY_RE.test(k)) fail('literal_value_refused', w);
    if (!['string', 'number', 'boolean'].includes(typeof v)) fail('bad_value', w);
    if (String(v).length > MAX_VALUE) fail('value_too_long', w);
    out[k] = { literal: String(v) };
  }
  return out;
}

function str(v, where, max = MAX_VALUE) {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) fail('bad_value', where);
  return v;
}

function validateHttpExpect(e, where) {
  needMap(e, where);
  only(e, ['status', 'body_contains', 'json', 'header'], where);
  const st = need(e, 'status', where);
  const list = Array.isArray(st) ? st : [st];
  if (list.length === 0 || list.length > 16 || !list.every((s) => isInt(s, 100, 599))) fail('bad_value', `${where}.status`);
  const out = { status: list };
  if (e.body_contains !== undefined) out.body_contains = str(e.body_contains, `${where}.body_contains`);
  if (e.json !== undefined) {
    const j = needMap(e.json, `${where}.json`);
    only(j, ['path', 'equals'], `${where}.json`);
    const eq = need(j, 'equals', `${where}.json`);
    if (!['string', 'number', 'boolean'].includes(typeof eq)) fail('bad_value', `${where}.json.equals`);
    if (!JSON_PATH_RE.test(String(need(j, 'path', `${where}.json`)))) fail('bad_value', `${where}.json.path`);
    out.json = { path: j.path, equals: eq };
  }
  if (e.header !== undefined) {
    const h = needMap(e.header, `${where}.header`);
    only(h, ['name', 'matches'], `${where}.header`);
    if (!HEADER_NAME_RE.test(String(need(h, 'name', `${where}.header`)))) fail('bad_name', `${where}.header.name`);
    out.header = { name: h.name, matches: str(need(h, 'matches', `${where}.header`), `${where}.header.matches`) };
  }
  return out;
}

function timeoutOf(p, where) {
  if (p.timeout_ms === undefined) return DEFAULT_TIMEOUT_MS;
  if (!isInt(p.timeout_ms, 1, 60000)) fail('bad_value', `${where}.timeout_ms`);
  return p.timeout_ms;
}

function validateHttp(p, where, hosts) {
  const { url, host, protocol } = parseUrl(need(p, 'url', where), `${where}.url`, hosts);
  const method = p.method === undefined ? 'GET' : p.method;
  if (!METHODS.includes(method)) fail('method_refused', `${where}.method`);
  if (MUTATING.includes(method) && host.class === 'production') fail('mutating_method_on_production', `${where}.method`);
  const headers = p.headers === undefined ? {} : validateKv(p.headers, `${where}.headers`, HEADER_NAME_RE);
  // SEC-7a: a secret taken from the environment must not travel in clear text, not even to an allow_http host.
  if (protocol === 'http:') for (const [k, v] of Object.entries(headers)) if (v.env !== undefined) fail('env_header_over_http', `${where}.headers.${k}`);
  const query = p.query === undefined ? {} : validateKv(p.query, `${where}.query`, QUERY_NAME_RE);
  if (protocol === 'http:') for (const [k, v] of Object.entries(query)) if (v.env !== undefined) fail('env_query_over_http', `${where}.query.${k}`);
  return {
    kind: 'http', url, host: host.name, host_class: host.class, method,
    headers,
    query,
    expect: validateHttpExpect(need(p, 'expect', where), `${where}.expect`),
    timeout_ms: timeoutOf(p, where),
  };
}

function validateTcp(p, where, hosts) {
  const host = hostOf(hosts, need(p, 'host', where), `${where}.host`);
  if (!isInt(need(p, 'port', where), 1, 65535)) fail('bad_value', `${where}.port`);
  if (p.expect !== 'open' && p.expect !== 'closed') fail('bad_value', `${where}.expect`);
  return { kind: 'tcp', host: host.name, host_class: host.class, port: p.port, expect: p.expect, timeout_ms: timeoutOf(p, where) };
}

/** One http or tcp probe (a top-level probe or a pair half). `withId` adds `id` to the key allowlist. */
function validateLeaf(p, where, hosts, withId) {
  needMap(p, where);
  const kind = need(p, 'kind', where);
  if (kind === 'pair' && !withId) fail('nested_pair', `${where}.kind`);
  if (kind !== 'http' && kind !== 'tcp') fail('unknown_kind', `${where}.kind`);
  only(p, (kind === 'http' ? HTTP_KEYS : TCP_KEYS).concat(withId ? ['id'] : []), where);
  return kind === 'http' ? validateHttp(p, where, hosts) : validateTcp(p, where, hosts);
}

function isRefusal(leaf) {
  if (leaf.kind === 'tcp') return leaf.expect === 'closed';
  return leaf.expect.status.every((s) => s === 401 || s === 403 || s === 404 || (s >= 300 && s <= 399));
}

function validatePair(p, where, hosts) {
  only(p, ['id', 'kind', 'allow', 'deny'], where);
  const allow = validateLeaf(need(p, 'allow', where), `${where}.allow`, hosts, false);
  const deny = validateLeaf(need(p, 'deny', where), `${where}.deny`, hosts, false);
  if (!isRefusal(deny)) fail('deny_not_refusal', `${where}.deny`);
  return { kind: 'pair', allow, deny };
}

function validateProbes(list, hosts) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) fail('not_a_list', 'probes');
  if (list.length > MAX_PROBES) fail('too_many_probes', 'probes'); // SEC-7b: a pair counts as one entry
  const seen = new Set();
  return list.map((p, i) => {
    const where = `probes[${i}]`;
    needMap(p, where);
    const id = need(p, 'id', where);
    if (typeof id !== 'string' || !ID_RE.test(id)) fail('bad_value', `${where}.id`);
    if (seen.has(id)) fail('duplicate_id', `${where}.id`);
    seen.add(id);
    const kind = need(p, 'kind', where);
    if (!['http', 'tcp', 'pair'].includes(kind)) fail('unknown_kind', `${where}.kind`);
    const body = kind === 'pair' ? validatePair(p, where, hosts) : validateLeaf(p, where, hosts, true);
    return { id, ...body };
  });
}

function validateTree(tree) {
  only(tree, ['version', 'hosts', 'probes'], '');
  if (tree.version === undefined) fail('missing_version', 'version');
  if (tree.version !== 1) fail('bad_version', 'version');
  const hosts = validateHosts(tree.hosts);
  return { version: 1, hosts: [...hosts.values()], probes: validateProbes(tree.probes, hosts) };
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}

/**
 * Read and validate `<projectDir>/.a1/live-probes.yaml`.
 * @returns {{absent: true, file: string} | {absent: false, file: string, version: 1, hosts: object[], probes: object[]}}
 * @throws {ProbeConfigError} on any hostile, malformed or policy-violating file (callers exit 2)
 */
function loadProbeConfig(projectDir) {
  const file = path.join(projectDir, FILE_REL);
  assertPlainConfigDir(projectDir);
  const text = readProbeFile(file, projectDir);
  if (text === null) return { absent: true, file };
  const bad = CONTROL_RE.exec(text);
  if (bad) fail('control_character', FILE_REL, text.slice(0, bad.index).split('\n').length);
  return deepFreeze({ absent: false, file, ...validateTree(parseDocument(text)) });
}

module.exports = { loadProbeConfig, ProbeConfigError, FILE_REL, MAX_BYTES, DEFAULT_TIMEOUT_MS };
