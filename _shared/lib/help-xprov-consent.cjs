'use strict';

// help-xprov-consent — the help text of `a1-tools xprov consent` (spec 016, wave 2), split out of help-xprov.cjs.
// Tier-0 wording only: a record the same OS user could write; the audit chain makes a naive forgery visible and prevents nothing.

const CONSENT_HELP = `    consent question|ensure|record|revoke  --kind consent|classification [--repo <git-toplevel>]
          [--ludwig-record <vault path>]
                  (spec 016 FR-002, FR-003, FR-005, FR-007, FR-008; xprov-consent*.cjs)
                  The owner's yes to "may this repo go to Codex" as a chat answer,
                  no terminal. question: prints the canonical AskUserQuestion input
                  (header xprov-Freigabe or xprov-Einstufung, German text, one
                  question, the No label first, hash). ensure: state of the open
                  marker (none|pending|answered|expired|used) and whether to ask;
                  a second asker polls it and does not ask again; exit 0 only when
                  an answer is ready. record: turns a matching, unexpired (10 min),
                  unused marker with a real owner answer, bound to repo, kind,
                  question hash, nonce, tool_use_id and session_id, into the stores:
                  yes -> permits.json entry + .a1/xprov.json + consent.json evidence;
                  No -> an owner-chat denial; no answer -> nothing written, exit 1.
                  The answer is never an argument. A customer repo (no origin, a
                  list of origins, or an origin outside N3URAL-A1) is refused until
                  the stored xprov-Einstufung answer exists and --ludwig-record
                  <record/... or project/....md> names the a1-ludwig-legal record.
                  revoke: removes the repo's permit, denial, evidence and unused
                  markers whatever channel wrote them; the next send asks again.
                  waive and allowlist follow in wave 3 (exit 2 until then).
                  Tier 0: every owner write appends a hash-chained line to
                  ~/.a1-xprov/consent-audit.jsonl first. The stores are records the
                  same OS user could write; the chain makes a naive forgery
                  visible (permit-check: audit missing|broken, enforcement:
                  unenforced) and prevents nothing. Dev install: bin/install.sh
                  installs no plugin hook, so no marker is ever answered there and
                  record writes nothing (the Reinhard-only path applies).
                  Exit: 0 ok · 1 refused (stdout JSON \`reason\`) · 2 usage error.`;

module.exports = { CONSENT_HELP };
