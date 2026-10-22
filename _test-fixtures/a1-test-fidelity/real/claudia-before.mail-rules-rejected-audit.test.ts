/**
 * tests/unit/mail-rules-rejected-audit.test.ts
 *
 * SEC-4 (Review 2026-07-16, Samuel MINOR, Spec 040): abgelehnte mail.rules.*-
 * Schreibversuche schrieben bisher KEINE Audit-Zeile — nur erfolgreiche Writes
 * wurden auditiert. Diese Suite deckt die drei deterministischen Reject-Codes
 * ab, die jetzt eine 'rejected'-Zeile nach api.agent_tool_calls schreiben:
 * ACTION_NOT_ALLOWED (inkl. System-Label), RULE_CONFLICT (unbestätigt),
 * MISSING_SCOPE — über alle drei betroffenen Routen (create/update/delete).
 *
 * Der Erfolgspfad bleibt unverändert (weiterhin genau EINE 'executed'-Zeile).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (fn: () => unknown) => fn() };
});

vi.mock("@/lib/office/auth-middleware", () => ({
  verifyBearerToken: vi.fn().mockResolvedValue({
    ok: true,
    auth: {
      keyId: "test-key-id",
      keyName: "test-key",
      tenantId: "test-tenant-id",
      createdBy: "test-user-id",
      actorKind: "api_key",
      scopes: ["mail:write"],
    },
  }),
}));

const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));

vi.mock("@/lib/db/tenant-pool", () => ({
  withTenantContext: vi.fn().mockImplementation(
    async (_ctx: unknown, fn: (client: unknown) => unknown) => fn({ query: mockQuery })
  ),
}));

const mockLoadAndDecryptConnection = vi.hoisted(() => vi.fn());

const MockNoConnectionError = vi.hoisted(() =>
  class MockNoConnectionError extends Error {
    readonly code = "NO_CONNECTION" as const;
    constructor(provider: string) {
      super(`Kein verbundenes ${provider}-Konto gefunden.`);
      this.name = "NoConnectionError";
    }
  }
);

vi.mock("@/lib/claudia/connection-loader", () => ({
  loadAndDecryptConnection: mockLoadAndDecryptConnection,
  markConnectionRevoked: vi.fn().mockResolvedValue(undefined),
  hasScope: (scope: string | null, required: string) =>
    scope != null && scope.split(/\s+/).includes(required),
  NoConnectionError: MockNoConnectionError,
}));

const mockListMailRules = vi.hoisted(() => vi.fn());
const mockCreateMailRule = vi.hoisted(() => vi.fn());
const mockDeleteMailRule = vi.hoisted(() => vi.fn());

vi.mock("@/lib/claudia/gmail-adapter", () => ({
  gmailAdapter: {
    listMailRules: mockListMailRules,
    createMailRule: mockCreateMailRule,
    deleteMailRule: mockDeleteMailRule,
  },
}));

vi.mock("@/lib/claudia/msgraph-adapter", () => ({
  msGraphAdapter: { listMailRules: vi.fn(), createMailRule: vi.fn(), deleteMailRule: vi.fn() },
  MailRulesNotSupportedError: class MailRulesNotSupportedError extends Error {},
}));

// Route-Importe NACH vi.mock-Deklarationen
import { POST as createRoute } from "@/app/api/office/v1/capabilities/mail-rules-create/route";
import { POST as updateRoute } from "@/app/api/office/v1/capabilities/mail-rules-update/route";
import { POST as deleteRoute } from "@/app/api/office/v1/capabilities/mail-rules-delete/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/office/v1/capabilities/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
    body: JSON.stringify(body),
  });
}

function auditCalls() {
  return mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && c[0].includes("api.agent_tool_calls")
  );
}

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

const CONNECTED = {
  accessToken: "tok",
  connectionId: "conn-1",
  email: "user@example.com",
  scope: `openid ${GMAIL_SCOPE}`,
};

const NO_SCOPE_CONNECTED = {
  ...CONNECTED,
  scope: "openid email", // gmail.settings.basic fehlt
};

const BASE_BODY = {
  provider: "google",
  condition: { from: "newsletter@example.com" },
  action: { type: "archive" },
};

// ── create: ACTION_NOT_ALLOWED (forward) ───────────────────────────────────────

describe("mail-rules-create — Reject-Audit: ACTION_NOT_ALLOWED (forward)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("writes a 'rejected' audit row and returns 400", async () => {
    const res = await createRoute(
      makeRequest("mail-rules-create", { ...BASE_BODY, action: { type: "forward", to: "evil@example.com" } })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("ACTION_NOT_ALLOWED");

    const calls = auditCalls();
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(sql).toContain("'rejected'");
    expect(params[2]).toBe("mail.rules.create");
    const resultJson = JSON.parse(params[4]);
    expect(resultJson.code).toBe("ACTION_NOT_ALLOWED");
    // No connection load for a fail-fast guard reject.
    expect(mockLoadAndDecryptConnection).not.toHaveBeenCalled();
  });
});

// ── create: RULE_CONFLICT_CONFIRM_REQUIRED ─────────────────────────────────────

describe("mail-rules-create — Reject-Audit: RULE_CONFLICT_CONFIRM_REQUIRED", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockLoadAndDecryptConnection.mockResolvedValue(CONNECTED);
    mockListMailRules.mockResolvedValue([
      { id: "existing-1", condition: BASE_BODY.condition, action: { type: "star" } },
    ]);
  });

  it("writes a 'rejected' audit row and returns 409", async () => {
    const res = await createRoute(makeRequest("mail-rules-create", BASE_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("RULE_CONFLICT_CONFIRM_REQUIRED");

    const calls = auditCalls();
    expect(calls).toHaveLength(1);
    const resultJson = JSON.parse(calls[0][1][4]);
    expect(resultJson.code).toBe("RULE_CONFLICT_CONFIRM_REQUIRED");
    expect(mockCreateMailRule).not.toHaveBeenCalled();
  });
});

// ── create: exact duplicate → RULE_CONFLICT ────────────────────────────────────

describe("mail-rules-create — Reject-Audit: RULE_CONFLICT (exact duplicate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockLoadAndDecryptConnection.mockResolvedValue(CONNECTED);
    mockListMailRules.mockResolvedValue([
      { id: "existing-1", condition: BASE_BODY.condition, action: BASE_BODY.action },
    ]);
  });

  it("writes a 'rejected' audit row and returns 409", async () => {
    const res = await createRoute(makeRequest("mail-rules-create", BASE_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("RULE_CONFLICT");

    const calls = auditCalls();
    expect(calls).toHaveLength(1);
    const resultJson = JSON.parse(calls[0][1][4]);
    expect(resultJson.code).toBe("RULE_CONFLICT");
  });
});

// ── create: MISSING_SCOPE ───────────────────────────────────────────────────────

describe("mail-rules-create — Reject-Audit: MISSING_SCOPE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockLoadAndDecryptConnection.mockResolvedValue(NO_SCOPE_CONNECTED);
  });

  it("writes a 'rejected' audit row and returns 403", async () => {
    const res = await createRoute(makeRequest("mail-rules-create", BASE_BODY));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("MISSING_SCOPE");

    const calls = auditCalls();
    expect(calls).toHaveLength(1);
    const resultJson = JSON.parse(calls[0][1][4]);
    expect(resultJson.code).toBe("MISSING_SCOPE");
  });
});

// ── update: ACTION_NOT_ALLOWED + MISSING_SCOPE ──────────────────────────────────

describe("mail-rules-update — Reject-Audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("ACTION_NOT_ALLOWED: writes a 'rejected' audit row, returns 400", async () => {
    const res = await updateRoute(
      makeRequest("mail-rules-update", {
        ...BASE_BODY,
        ruleId: "filter-1",
        action: { type: "forward", to: "evil@example.com" },
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("ACTION_NOT_ALLOWED");

    const calls = auditCalls();
    expect(calls).toHaveLength(1);
    const [, params] = calls[0];
    expect(params[2]).toBe("mail.rules.update");
    expect(JSON.parse(params[4]).code).toBe("ACTION_NOT_ALLOWED");
  });

  it("MISSING_SCOPE: writes a 'rejected' audit row, returns 403", async () => {
    mockLoadAndDecryptConnection.mockResolvedValue(NO_SCOPE_CONNECTED);
    const res = await updateRoute(makeRequest("mail-rules-update", { ...BASE_BODY, ruleId: "filter-1" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("MISSING_SCOPE");

    const calls = auditCalls();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1][4]).code).toBe("MISSING_SCOPE");
  });
});

// ── delete: MISSING_SCOPE ───────────────────────────────────────────────────────

describe("mail-rules-delete — Reject-Audit: MISSING_SCOPE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockLoadAndDecryptConnection.mockResolvedValue(NO_SCOPE_CONNECTED);
  });

  it("writes a 'rejected' audit row and returns 403", async () => {
    const res = await deleteRoute(makeRequest("mail-rules-delete", { provider: "google", ruleId: "filter-1" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("MISSING_SCOPE");

    const calls = auditCalls();
    expect(calls).toHaveLength(1);
    const [, params] = calls[0];
    expect(params[2]).toBe("mail.rules.delete");
    expect(JSON.parse(params[4]).code).toBe("MISSING_SCOPE");
  });
});

// ── Success-Pfad bleibt unverändert: genau EINE 'executed'-Zeile ──────────────

describe("mail-rules-create — Success-Pfad unverändert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockLoadAndDecryptConnection.mockResolvedValue(CONNECTED);
    mockListMailRules.mockResolvedValue([]);
    mockCreateMailRule.mockResolvedValue({ id: "filter-new", condition: BASE_BODY.condition, action: BASE_BODY.action });
  });

  it("writes exactly one audit row with status 'executed'", async () => {
    const res = await createRoute(makeRequest("mail-rules-create", BASE_BODY));
    expect(res.status).toBe(201);

    const calls = auditCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("'executed'");
    expect(calls[0][0]).not.toContain("'rejected'");
  });
});

// ── Best-effort: Audit-Fehler maskiert nicht den User-facing Reject ───────────

describe("mail-rules-create — Reject-Audit ist best-effort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadAndDecryptConnection.mockResolvedValue(NO_SCOPE_CONNECTED);
    // Der Audit-Insert selbst schlägt fehl (z.B. DB-Hiccup) — der Reject-Response
    // muss trotzdem korrekt zurückkommen, kein 500 durch den Audit-Fehler.
    mockQuery.mockRejectedValue(new Error("connection reset"));
  });

  it("still returns the original 403 MISSING_SCOPE despite the audit-write failure", async () => {
    const res = await createRoute(makeRequest("mail-rules-create", BASE_BODY));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("MISSING_SCOPE");
  });
});
