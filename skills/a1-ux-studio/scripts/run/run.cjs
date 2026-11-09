#!/usr/bin/env node
'use strict';
// a1-ux-studio run folder script (spec 024, FR-002/003/018/031).
// Subcommand: init. Exit codes: 0 ok, 1 refusal (env, empty Intent), 2 usage/hostile input.
// Node core only. Later waves add `pick` (W4) and `asset-slot` (W5).

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTEXTS = Object.freeze(['brand', 'product']);
const VIEWPORTS = Object.freeze(['desktop-first', 'mobile parity']);
const MAX_REF_BYTES = 20 * 1024 * 1024;
const REF_TIMEOUT_MS = 5000;
const MAX_BRIEF_BYTES = 1024 * 1024;
const MAX_FOLDER_SUFFIX = 999;
const REF_DEADLINE_MS = 5000;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g;
const TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'run.md');

class Refusal extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Refusal(2, `unexpected argument: ${a.slice(0, 80)}`);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Refusal(2, `missing value for ${a.slice(0, 40)}`);
    out[a.slice(2)] = val;
    i += 1;
  }
  return out;
}

function requireSlug(name, value) {
  if (typeof value !== 'string' || !SLUG_RE.test(value)) {
    throw new Refusal(2, `invalid ${name}: must match ${SLUG_RE.source}`);
  }
  return value;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function resolveDate(raw) {
  if (raw === undefined) return today();
  if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) throw new Refusal(2, 'invalid --date: want YYYY-MM-DD');
  return raw;
}

function loadBrief(file) {
  if (!file) throw new Refusal(2, 'missing --brief <json-file>');
  let raw;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Refusal(2, 'brief must be a regular file');
    if (st.size > MAX_BRIEF_BYTES) throw new Refusal(2, 'brief file too large');
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e instanceof Refusal) throw e;
    throw new Refusal(2, 'cannot read brief file');
  }
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Refusal(2, 'brief file is not valid JSON'); }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Refusal(2, 'brief must be a JSON object');
  return normalizeBrief(data);
}

function strList(v, name) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Refusal(2, `${name} must be a list of strings`);
  return v.map((x) => x.trim()).filter((x) => x.length > 0);
}

function normalizeBrief(data) {
  const intent = data.intent && typeof data.intent === 'object' ? data.intent : {};
  const guard = data.guardrails && typeof data.guardrails === 'object' ? data.guardrails : {};
  const context = intent.context === undefined ? 'product' : intent.context;
  const viewport = intent.viewport === undefined ? 'desktop-first' : intent.viewport;
  if (!CONTEXTS.includes(context)) throw new Refusal(2, `invalid intent.context: want ${CONTEXTS.join('|')}`);
  if (!VIEWPORTS.includes(viewport)) throw new Refusal(2, `invalid intent.viewport: want ${VIEWPORTS.join('|')}`);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return Object.freeze({
    aesthetic: str(data.aesthetic),
    reference: str(data.reference),
    intent: Object.freeze({ text: str(intent.text), context, viewport }),
    guardrails: Object.freeze({
      always: strList(guard.always, 'guardrails.always'),
      never: strList(guard.never, 'guardrails.never'),
    }),
  });
}

function head(url, method, budgetMs) {
  return new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? https : http;
    let timer = null;
    const done = (r) => { clearTimeout(timer); resolve(r); };
    const req = lib.request(url, { method, timeout: REF_TIMEOUT_MS }, (res) => {
      res.resume();
      done({ status: res.statusCode });
    });
    // Total deadline on top of the socket idle timeout: a server that trickles bytes
    // keeps the socket alive and would otherwise hold init open.
    timer = setTimeout(() => { req.destroy(); done({ cause: 'timeout' }); }, Math.max(budgetMs, 1));
    req.on('timeout', () => { req.destroy(); done({ cause: 'timeout' }); });
    req.on('error', (e) => done({ cause: e.code || 'network error' }));
    req.end();
  });
}

// Drops user:pass@ from an http(s) URL; every other reference is returned unchanged.
function redactCredentials(ref) {
  return ref.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#\s]*@/i, '$1');
}

async function checkUrl(ref) {
  let url;
  try { url = new URL(ref); } catch (e) { return 'invalid URL'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'unsupported scheme';
  const start = Date.now();
  let r = await head(url, 'HEAD', REF_DEADLINE_MS);
  if (r.status === 405 || r.status === 501) r = await head(url, 'GET', REF_DEADLINE_MS - (Date.now() - start));
  if (r.cause) return `unreachable: ${r.cause}`;
  // Redirects are never followed: a 3xx proves the host answers and nothing more.
  return r.status >= 400 ? `http ${r.status}` : null;
}

function checkPath(ref) {
  let st;
  try { st = fs.statSync(ref); } catch (e) { return 'file not found'; }
  if (!st.isFile()) return 'not a file';
  if (st.size > MAX_REF_BYTES) return `larger than ${MAX_REF_BYTES / (1024 * 1024)} MB`;
  return null;
}

// Returns a warning line or null. Never throws: a bad reference does not stop the run.
async function checkReference(ref) {
  if (ref === '') return 'reference unusable: (empty) (empty)';
  const cause = /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) ? await checkUrl(ref) : checkPath(ref);
  return cause ? `reference unusable: ${clean(ref).slice(0, 200)} (${cause})` : null;
}

// One line, no control characters (stderr echo, log-injection safe).
function clean(v) { return String(v).replace(CTRL_RE, '').replace(/\s+/g, ' ').trim(); }

// Keeps brief text from forging run.md structure: no comment markers, headings or frontmatter fences.
function neutralize(text) {
  return text
    .replace(CTRL_RE, '')
    .replace(/<!--/g, '&lt;!--')
    .replace(/-->/g, '--&gt;')
    .split(/\r\n|\r|\n/)
    .map((line) => (/^\s*-{3,}\s*$/.test(line) ? `\\${line.trim()}` : line.replace(/^(\s*)#/, '$1\\#')))
    .join('\n');
}

const oneLine = (v) => neutralize(String(v).replace(/\s*[\r\n]+\s*/g, ' '));

function templateVars(b) {
  const bullets = (xs) => (xs.length ? xs.map((x) => `- ${oneLine(x)}`).join('\n') : '- none');
  return {
    aesthetic: oneLine(b.aesthetic) || 'none',
    reference: oneLine(b.reference) || 'none',
    intent_text: neutralize(b.intent.text),
    intent_context: b.intent.context,
    intent_viewport: b.intent.viewport,
    guardrails_always: bullets(b.guardrails.always),
    guardrails_never: bullets(b.guardrails.never),
  };
}

// Strips the leading template comment (through the first "-->" line), then fills every
// double-brace token in ONE pass so brief text that looks like a token stays verbatim.
function renderRun(tpl, vars) {
  const end = tpl.indexOf('-->\n');
  const body = tpl.startsWith('<!--') && end !== -1 ? tpl.slice(end + 4) : tpl;
  return body.replace(/\{\{([a-z_]+)\}\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m));
}

function createRunDir(base, name) {
  fs.mkdirSync(base, { recursive: true });
  for (let n = 1; n <= MAX_FOLDER_SUFFIX; n += 1) {
    const dir = path.join(base, n === 1 ? name : `${name}-${n}`);
    try { fs.mkdirSync(dir); return dir; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Refusal(1, 'too many run folders for this screen and date');
}

const inside = (rootReal, p) => p === rootReal || p.startsWith(rootReal + path.sep);

// Resolves symlinks of the deepest existing ancestor of `target` (a dangling link is refused)
// and demands it stays under the real vault root. Call BEFORE anything is created.
function assertInsideVault(root, target) {
  const refuse = () => new Refusal(1, 'path resolves outside A1_VAULT_ROOT; nothing written');
  let rootReal;
  try { rootReal = fs.realpathSync(root); } catch (e) { throw refuse(); }
  let cur = target;
  for (;;) {
    try {
      fs.lstatSync(cur);
      let real;
      try { real = fs.realpathSync(cur); } catch (e) { throw refuse(); }
      if (!inside(rootReal, real)) throw refuse();
      return;
    } catch (e) {
      if (e instanceof Refusal) throw e;
      if (e.code !== 'ENOENT') throw refuse();
      const up = path.dirname(cur);
      if (up === cur) throw refuse();
      cur = up;
    }
  }
}

function vaultProject(project) {
  const root = process.env.A1_VAULT_ROOT;
  if (!root) throw new Refusal(1, 'A1_VAULT_ROOT is not set; nothing written');
  const dir = path.join(root, 'project', project);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Refusal(1, `vault project folder missing under A1_VAULT_ROOT: project/${project}; nothing written`);
  }
  assertInsideVault(root, dir);
  return dir;
}

async function init(args) {
  const project = requireSlug('--project', args.project);
  const screen = requireSlug('--screen', args.screen);
  if (args.spec !== undefined && args.topic !== undefined) throw new Refusal(2, 'use --spec or --topic, not both');
  const date = resolveDate(args.date);
  const specId = args.spec !== undefined
    ? requireSlug('--spec', args.spec)
    : requireSlug('--topic', args.topic === undefined ? '' : args.topic) && requireSlug('adhoc id', `adhoc-${date}-${args.topic}`);
  const brief = loadBrief(args.brief);
  const projectDir = vaultProject(project);
  if (brief.intent.text === '') throw new Refusal(1, 'Intent is empty: ask the user for the Intent (what the screen is for); no run folder created');

  const safeRef = redactCredentials(brief.reference);
  const warning = await checkReference(safeRef);
  if (warning) process.stderr.write(`warning: ${clean(warning)}\n`);

  let tpl;
  try { tpl = fs.readFileSync(TEMPLATE, 'utf8'); } catch (e) { throw new Refusal(2, 'templates/run.md missing'); }
  const base = path.join(projectDir, 'ux', specId);
  assertInsideVault(process.env.A1_VAULT_ROOT, base);
  const dir = createRunDir(base, `${date}-${screen}`);
  try { assertInsideVault(process.env.A1_VAULT_ROOT, dir); } catch (e) { fs.rmdirSync(dir); throw e; }
  const shown = { ...brief, reference: safeRef };
  const body = renderRun(tpl, { spec_id: specId, project, screen, created: date, status: 'brief', ...templateVars(shown) });
  fs.writeFileSync(path.join(dir, 'run.md'), body, { flag: 'wx' });
  process.stdout.write(`${dir}\n`);
  return 0;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd !== 'init') throw new Refusal(2, 'usage: run.cjs init --project <slug> (--spec <id> | --topic <slug>) --screen <slug> --brief <json-file> [--date YYYY-MM-DD]');
  return init(parseArgs(rest));
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof Refusal) { process.stderr.write(`error: ${clean(e.message)}\n`); process.exit(e.code); }
    process.stderr.write(`error: ${clean(e && e.message ? e.message : e)}\n`);
    process.exit(3);
  },
);
