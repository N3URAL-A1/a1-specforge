'use strict';

// ---------------------------------------------------------------------------
// xprov-consent-question — the canonical owner questions (spec 016 FR-002, FR-007; wave 2).
//
// One registry of question KINDS. A kind owns its header, its two fixed labels (the No label
// FIRST), the option descriptions and a pure builder that turns a repository context into the
// question text. `buildQuestion` returns the exact AskUserQuestion input the agent must pass and
// the hash of its canonical form; the plugin hook (wave 4) recomputes the question with this same
// function and compares byte for byte, `consent record` recomputes the hash against the marker.
//
// Wave 2 registers `consent` (header xprov-Freigabe) and `classification` (xprov-Einstufung).
// Wave 3 adds `waiver` (xprov-Waiver) and `allowlist` (xprov-Allowlist) by adding entries to KINDS; nothing else changes.
//
// Texts are German (the owner reads them), one question, two labels, no markup beyond plain text.
// Every value taken from the repository (name, path, origin) is cleaned of control, line-break and
// format characters and clipped before it enters the text: an agent controls these strings.
// Tier-0 wording: the question never claims the consent is unforgeable.
// Pure functions; the only I/O is the realpath of the repository root.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./xprov-common.cjs');
const RI = require('./xprov-repo-identity.cjs');

const VALUE_MAX_CHARS = 300;
const SHOWN_ORIGINS_MAX = 4;
// The exposure sentence is the one of the permit module (spec 012 FR-016). Required lazily: the permit module is
// loaded by the dispatcher anyway, and this keeps the require graph acyclic at load time.
const exposure = () => require('./xprov-permit.cjs').EXPOSURE_SENTENCE;

const CLEAN_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/gu;
const clean = (v) => C.clip(String(v == null ? '' : v).replace(CLEAN_RE, '?'), VALUE_MAX_CHARS);

const CLASS_TEXT = Object.freeze({ [RI.CLASS.ORG]: 'Eigenes Repo (Organisation N3URAL-A1)', [RI.CLASS.CUSTOMER]: 'Kundenrepo (kein origin oder origin außerhalb von N3URAL-A1)' });

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * The repository facts a question shows: { name, path, origin (shown string), originSha, classification, ludwigRecord }.
 * `originSha` is the sha256 of the RAW origin as JSON: it goes into the question hash, so two origins that render alike
 * (clipped, or beyond the first four of a list) never share a hash (security review 2026-10-14, MINOR-3).
 * `opts.ludwigRecord`: the vault path of the legal decision, shown by the classification question (MAJOR-3).
 */
function repoContext(root, origin, opts) {
  let real;
  try { real = fs.realpathSync(path.resolve(String(root))); } catch (_e) { real = path.resolve(String(root)); }
  let shown;
  if (origin === null || origin === undefined) shown = 'keiner';
  else if (Array.isArray(origin)) {
    const more = origin.length - SHOWN_ORIGINS_MAX;
    shown = `MEHRERE WERTE (${origin.slice(0, SHOWN_ORIGINS_MAX).map(clean).join(' | ')}${more > 0 ? ` (+${more} more)` : ''})`;
  } else shown = clean(origin);
  const lud = opts && opts.ludwigRecord !== undefined ? clean(opts.ludwigRecord) : null;
  return Object.freeze({
    name: clean(path.basename(real)), path: clean(real), origin: shown, originSha: sha256(JSON.stringify(origin === undefined ? null : origin)),
    classification: RI.classifyOrigin(origin), ludwigRecord: lud,
  });
}

function buildConsent(ctx) {
  return [
    `Soll das Repo "${ctx.name}" zur Code-Prüfung an Codex gesendet werden dürfen?`,
    `Repo: ${ctx.name}`,
    `Pfad: ${ctx.path}`,
    `Origin: ${ctx.origin}`,
    `Einstufung: ${CLASS_TEXT[ctx.classification]}`,
    'Empfänger: OpenAI Codex, ein externer Dritter.',
    exposure(),
    'Das Ja gilt dauerhaft für dieses Repo: keine neue Frage nach PLAN-Änderung, neuer Phase oder neuem Worktree. Es erlaubt keinen Waiver und keine Allowlist-Freigabe.',
    'Widerruf: `a1-tools xprov consent revoke` im Repo (oder mit --repo <Pfad>).',
    'Ein Nein oder keine Antwort heisst: nur die Reinhard-Prüfung läuft, nichts geht an Codex.',
  ].join('\n');
}

function buildClassification(ctx) {
  return [
    `Einstufung des Repos "${ctx.name}" vor einer Weitergabe an Codex.`,
    `Pfad: ${ctx.path}`,
    `Origin: ${ctx.origin}`,
    `Berechnete Einstufung: ${CLASS_TEXT[ctx.classification]}`,
    `Legal-Entscheidung (Vault-Pfad): ${ctx.ludwigRecord === null || ctx.ludwigRecord === undefined ? 'keine angegeben' : ctx.ludwigRecord}`,
    'Ein Kundenrepo darf nur mit einer a1-ludwig-legal-Entscheidung an Codex gehen. Das Ja hier bestätigt die Einstufung als Kundenrepo und dass die oben genannte Entscheidung vorliegt. Es ersetzt die Entscheidung nicht: beim Eintragen der Freigabe muss genau dieser Vault-Pfad angegeben werden.',
    'Diese Antwort erlaubt noch keinen Versand; die Freigabe ist eine eigene Frage.',
  ].join('\n');
}

// The waiver and allowlist texts are built by their own modules (they read the failed targets / scan hits themselves); required lazily
// so this registry stays free of an import cycle. Their builders read `ctx.waiver` / `ctx.allowlist`, which only those modules set.
const KINDS = Object.freeze({
  consent: Object.freeze({
    header: 'xprov-Freigabe', build: buildConsent,
    labels: Object.freeze({ no: 'Nein, nichts an Codex senden', yes: 'Ja, dieses Repo an Codex senden' }),
    descriptions: Object.freeze({ no: 'Nur Reinhard prüft; das Repo bleibt ohne Codex-Freigabe.', yes: 'Dauerhafte Freigabe dieses Repos für Codex-Reviews.' }),
  }),
  classification: Object.freeze({
    header: 'xprov-Einstufung', build: buildClassification,
    labels: Object.freeze({ no: 'Nein, keine Einstufung', yes: 'Ja, Kundenrepo, Legal-Entscheidung liegt vor' }),
    descriptions: Object.freeze({ no: 'Keine Einstufung; eine Freigabe bleibt gesperrt.', yes: 'Das Repo gilt als Kundenrepo; eine a1-ludwig-legal-Entscheidung liegt vor.' }),
  }),
  waiver: Object.freeze({
    header: 'xprov-Waiver', build: (ctx) => require('./xprov-consent-waive.cjs').buildText(ctx),
    labels: Object.freeze({ no: 'Nein, keinen Waiver', yes: 'Ja, diese Ziele per Waiver freigeben' }),
    descriptions: Object.freeze({ no: 'Nichts wird geschrieben; die Ziele bleiben fehlgeschlagen.', yes: 'Ein Waiver je aufgeführtem Ziel, gebunden an PLAN.md-sha und Head.' }),
  }),
  allowlist: Object.freeze({
    header: 'xprov-Allowlist', build: (ctx) => require('./xprov-consent-allowlist.cjs').buildText(ctx),
    labels: Object.freeze({ no: 'Nein, nichts freigeben', yes: 'Ja, diese Blobs freigeben' }),
    descriptions: Object.freeze({ no: 'Nichts wird freigegeben; die Prüfung läuft ohne Codex.', yes: 'Eine Freigabe je aufgeführtem Blob, gebunden an dessen sha256.' }),
  }),
});

/** The kind definition, or null for an unknown name (own properties only: `__proto__`, `constructor` are unknown). */
const kindDef = (kind) => (typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null);
const kindNames = () => Object.keys(KINDS);

/** The question hash: sha256 of the canonical form (header, text, options, multiSelect, origin_sha). `originSha` is the one of the repository context. */
function hashOf(kind, question, originSha) {
  const def = kindDef(kind);
  if (def === null) return null;
  const options = [{ label: def.labels.no, description: def.descriptions.no }, { label: def.labels.yes, description: def.descriptions.yes }];
  return sha256(JSON.stringify({ header: def.header, question, options, multiSelect: false, origin_sha: originSha }));
}

/** { kind, header, question, labels [no, yes], options, multiSelect, hash, classification } or null for an unknown kind. */
function buildQuestion(kind, ctx) {
  const def = kindDef(kind);
  if (def === null) return null;
  const question = def.build(ctx);
  const options = [{ label: def.labels.no, description: def.descriptions.no }, { label: def.labels.yes, description: def.descriptions.yes }];
  return Object.freeze({
    kind, header: def.header, question, labels: Object.freeze([def.labels.no, def.labels.yes]), options: Object.freeze(options), multiSelect: false,
    hash: hashOf(kind, question, ctx.originSha), originSha: ctx.originSha, classification: ctx.classification,
  });
}

/** 'yes' only for the exact canonical yes label; every other answer (the No label, free text, anything) is 'no'. */
function decisionOf(kind, label) {
  const def = kindDef(kind);
  return def !== null && typeof label === 'string' && label === def.labels.yes ? 'yes' : 'no';
}

module.exports = { KINDS, VALUE_MAX_CHARS, kindDef, kindNames, repoContext, buildQuestion, hashOf, decisionOf, clean };
