---
id: 014-preview-bypass-token
project: n3ural-contentbot
title: Preview URL reachable without a Vercel login
status: done
---

# Preview URL reachable without a Vercel login

## Functional Requirements

**FR-014** — When the preview reaches `ready` and the tenant config names a bypass token env var
that is set, the system shall carry the tenant's bypass token on the preview URL as the
`x-vercel-protection-bypass` query parameter, appending it URL-correctly (respecting an existing
query string) without adding any other diagnostic data to the customer-facing message.
[EARS: event-driven]

- **AC-1** — Given a tenant whose config names a bypass token env var and the var is set,
  when the preview reaches `ready`, then `previewUrl` carries the token as a query parameter
  and the rest of the URL is unchanged.
- **AC-2** — Given a tenant with no bypass token configured, when the preview reaches
  `ready`, then `previewUrl` is exactly the URL built today (no parameter, no crash).
- **AC-3** — Given a config that names a bypass env var which is not set in the
  environment, then the run does not crash; the URL is sent unchanged and the operator
  (not the customer) is told the token is missing.

**FR-015** — The system shall reference the bypass token by env-var name only (ADR-006), accepting
an optional `deploy.vercel.bypassTokenEnv` string in the config schema and never writing a token
value to the repo, the customer message, or a log line. [EARS: ubiquitous]

- **AC-1** — `npm run check:no-hardcoded-paths` and the repo's secret checks stay green.
- **AC-2** — A token value never appears in any log or customer message; grep over the
  emitted strings finds no token.
- **AC-3** — Two tenants configured with different env var names resolve to different
  tokens in the same server process.
