# Ludwig vs. the `legal` plugin — overlap verdict

**Date:** 2026-07-12 (M13) · **Closes:** decision doc 7.4 candidate 4's open
verification ("does Ludwig largely duplicate the installed legal plugin?")

## Verdict: KEEP Ludwig — no duplication; the relationship is layered by design

The open question assumed the two might be substitutes. Direct comparison
shows they are complements, and Ludwig's own prompt already encodes that:

**Hard Rule 4 in `agents/a1-ludwig-legal.md`:** *"Anthropic legal plugin is
the base layer. When the `legal` plugin is installed, prefer its slash
commands over ad-hoc prose analysis."* — Ludwig orchestrates the plugin where
it fits instead of re-implementing it.

## What each side actually covers

| | `legal` plugin | `a1-ludwig-legal` |
|---|---|---|
| Persona | In-house counsel / legal-ops workflows | Product-compliance triage for the a1 pipeline |
| Skills | brief, triage-nda, review-contract, signature-request, vendor-check, meeting-briefing, legal-response, compliance-check, legal-risk-assessment | GREEN/YELLOW/RED triage reports, compliance checklists, draft legal artifacts |
| Integrations | Atlassian, Box, DocuSign, Egnyte, Gmail, Google Calendar, MS365, Slack (auth-gated MCP) | a1 conventions: spawned by a1-analyze as a lane, reads `constitution.md`, writes a1-shaped findings |
| Jurisdiction default | US-leaning generic | **EU/DACH first** (GDPR/DSGVO, EU AI Act, DSA, NIS2, Impressum/AGB, TMG/TTDSG) — with an explicit "never apply US default positions" rule |
| Output shape | Documents/workflow steps for lawyers | Severity-ranked findings a1 pipelines consume (STOP/launch-gate semantics) |

The only genuine intersection is `legal:compliance-check` /
`legal:legal-risk-assessment` vs. Ludwig's triage — and exactly there Ludwig's
Hard Rule 4 routes through the plugin when present, adding the DACH remap and
the a1 output contract on top.

## What breaks if Ludwig were dropped

`a1-analyze` loses its legal lane's a1-shaped output (the plugin does not
know `constitution.md`, GREEN/YELLOW/RED discipline, or the findings JSON the
analyze pipeline consumes), and every non-plugin machine loses legal coverage
entirely (the plugin is auth-gated and may be absent in headless runs).

## Residual (not blocking)

A live A/B on one real input (same contract through `legal:compliance-check`
and through Ludwig) would quantify the overlap empirically. Worth doing once
a real compliance task shows up; not worth synthetic effort now.
