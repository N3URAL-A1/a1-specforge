/**
 * tests/integration/pipeline-flow-quote-billing.test.ts
 *
 * SC-001: Quote billing_method Capture
 *   - POST /api/crm/invoices ohne project_type_id → 400/422
 *   - POST /api/crm/invoices mit gültigem project_type_id → billing_method aufgelöst + gespeichert
 *   - POST /api/crm/invoices mit ungültigem/fremdem project_type_id → 422
 *
 * Mocking-Strategie (konsistent mit project-types-api.test.ts):
 *   - requireTenantContext → gemockt
 *   - withTenantContext    → gemockt (kein Cloud SQL nötig)
 *   - auth()               → gemockt (kein NextAuth nötig)
 *   - getRequestTenantId   → gemockt
 *   - checkFeatureFlag     → gemockt (erlaubt durch)
 *   - createInvoice        → gemockt
 *   - syncDealValueFromQuote → gemockt
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";

// ============================================================
// Mocks — VOR den Route-Imports (Vitest-Requirement)
// ============================================================

const { RequestContextError } = vi.hoisted(() => {
  class RequestContextError extends Error {
    public readonly status: 401 | 403 | 400;
    constructor(message: string, status: 401 | 403 | 400) {
      super(message);
      this.name = "RequestContextError";
      this.status = status;
    }
  }
  return { RequestContextError };
});

vi.mock("@/lib/auth/request-context", () => ({
  requireTenantContext: vi.fn(),
  RequestContextError,
}));

vi.mock("@/lib/db/tenant-pool", () => ({
  withTenantContext: vi.fn(),
  withSystemContext: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/crm/request-context", () => ({
  getRequestTenantId: vi.fn(),
}));

vi.mock("@/lib/features/api-guard", () => ({
  checkFeatureFlag: vi.fn(),
}));

vi.mock("@/lib/crm/api", () => ({
  fetchInvoices: vi.fn(),
  createInvoice: vi.fn(),
  syncDealValueFromQuote: vi.fn(),
}));

// ── Route-Imports nach Mocks ──────────────────────────────────────────────────

import { requireTenantContext } from "@/lib/auth/request-context";
import { withTenantContext } from "@/lib/db/tenant-pool";
import { auth } from "@/auth";
import { getRequestTenantId } from "@/lib/crm/request-context";
import { checkFeatureFlag } from "@/lib/features/api-guard";
import { createInvoice, syncDealValueFromQuote } from "@/lib/crm/api";
import { POST } from "@/app/api/crm/invoices/route";

// ============================================================
// Fixtures
// ============================================================

const TENANT_ID = "aaaaaaaa-sc01-sc01-sc01-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-sc01-sc01-sc01-bbbbbbbbbbbb";
const PROJECT_TYPE_ID = "cccccccc-sc01-sc01-sc01-cccccccccccc";
const FOREIGN_TYPE_ID = "dddddddd-sc01-sc01-sc01-dddddddddddd";

const MOCK_SESSION = {
  user: {
    id: USER_ID,
    email: "test@n3urala1.com",
    isSuperadmin: false,
  },
};

const MOCK_CTX = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  isSuperadmin: false,
};

const VALID_QUOTE_BODY = {
  type: "quote",
  customer_id: 1,
  deal_id: 42,
  project_type_id: PROJECT_TYPE_ID,
  items: [
    {
      description: "Consulting",
      quantity: 10,
      unit: "Stunde",
      unit_price: 150,
    },
  ],
};

const CREATED_INVOICE = {
  id: 99,
  type: "quote",
  status: "draft",
  customer_id: 1,
  deal_id: 42,
  billing_method: "hourly",
  total: 1500,
};

// ============================================================
// Helpers
// ============================================================

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost:3003/api/crm/invoices/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupHappyPath(billingMethodResult: string | null = "hourly") {
  vi.mocked(auth).mockResolvedValue(MOCK_SESSION as ReturnType<typeof auth> extends Promise<infer T> ? T : never);
  vi.mocked(requireTenantContext).mockResolvedValue(MOCK_CTX);
  vi.mocked(getRequestTenantId).mockResolvedValue(TENANT_ID);
  vi.mocked(checkFeatureFlag).mockResolvedValue(null); // null = kein Guard, durchlassen

  vi.mocked(withTenantContext).mockImplementation(
    async (_ctx: unknown, fn: (client: PoolClient) => unknown) => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          rows: billingMethodResult ? [{ billing_method: billingMethodResult }] : [],
        }),
      } as unknown as PoolClient;
      return fn(mockClient);
    }
  );

  vi.mocked(createInvoice).mockResolvedValue(CREATED_INVOICE as ReturnType<typeof createInvoice> extends Promise<infer T> ? T : never);
  vi.mocked(syncDealValueFromQuote).mockResolvedValue(undefined);
}

// ============================================================
// SC-001: Quote ohne project_type_id → 400/422
// ============================================================

describe("SC-001: Quote ohne project_type_id → Validierungsfehler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(MOCK_SESSION as ReturnType<typeof auth> extends Promise<infer T> ? T : never);
    vi.mocked(getRequestTenantId).mockResolvedValue(TENANT_ID);
    vi.mocked(checkFeatureFlag).mockResolvedValue(null);
  });

  it("QBM-01: type=quote ohne project_type_id → 400 (Schema-Validierung)", async () => {
    const bodyWithoutProjectTypeId = {
      type: "quote",
      customer_id: 1,
      deal_id: 42,
      items: [{ description: "Test", quantity: 1, unit: "Stunde", unit_price: 100 }],
      // project_type_id fehlt absichtlich
    };

    const req = makePostRequest(bodyWithoutProjectTypeId);
    const res = await POST(req);

    // Schema validation rejects missing project_type_id
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("QBM-02: type=quote mit leerem project_type_id → 400", async () => {
    const body = {
      ...VALID_QUOTE_BODY,
      project_type_id: "",
    };

    const req = makePostRequest(body);
    const res = await POST(req);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("QBM-03: kein Auth → 401", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const req = makePostRequest(VALID_QUOTE_BODY);
    const res = await POST(req);

    expect(res.status).toBe(401);
  });
});

// ============================================================
// SC-001: Quote mit gültigem project_type_id → billing_method aufgelöst
// ============================================================

describe("SC-001: Quote mit gültigem project_type_id → billing_method gespeichert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath("hourly");
  });

  it("QBM-04: POST mit gültigem project_type_id → 201 + billing_method in createInvoice", async () => {
    const req = makePostRequest(VALID_QUOTE_BODY);
    const res = await POST(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toBeDefined();

    // createInvoice muss mit billing_method aufgerufen worden sein
    expect(createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ billing_method: "hourly" })
    );
  });

  it("QBM-05: billing_method aus DB-Lookup kommt aus project_type_id-Auflösung (hourly)", async () => {
    setupHappyPath("hourly");

    const req = makePostRequest({ ...VALID_QUOTE_BODY, project_type_id: PROJECT_TYPE_ID });
    await POST(req);

    expect(createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ billing_method: "hourly" })
    );
  });

  it("QBM-06: billing_method=fixed_price aus project_type → korrekt übergeben", async () => {
    setupHappyPath("fixed_price");

    const req = makePostRequest({ ...VALID_QUOTE_BODY, project_type_id: PROJECT_TYPE_ID });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ billing_method: "fixed_price" })
    );
  });

  it("QBM-07: withTenantContext wird mit korrektem tenantId aufgerufen", async () => {
    const req = makePostRequest(VALID_QUOTE_BODY);
    await POST(req);

    expect(withTenantContext).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      expect.any(Function)
    );
  });

  it("QBM-08: syncDealValueFromQuote wird nach createInvoice aufgerufen", async () => {
    const req = makePostRequest(VALID_QUOTE_BODY);
    await POST(req);

    expect(syncDealValueFromQuote).toHaveBeenCalledWith(
      CREATED_INVOICE.deal_id,
      CREATED_INVOICE.total
    );
  });
});

// ============================================================
// SC-001: Ungültiger/fremder project_type_id → 422
// ============================================================

describe("SC-001: Ungültiger/fremder project_type_id → 422", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(MOCK_SESSION as ReturnType<typeof auth> extends Promise<infer T> ? T : never);
    vi.mocked(requireTenantContext).mockResolvedValue(MOCK_CTX);
    vi.mocked(getRequestTenantId).mockResolvedValue(TENANT_ID);
    vi.mocked(checkFeatureFlag).mockResolvedValue(null);
  });

  it("QBM-09: project_type_id nicht in DB gefunden → 422", async () => {
    // DB gibt keine Rows zurück (fremder/ungültiger type_id)
    vi.mocked(withTenantContext).mockImplementation(
      async (_ctx: unknown, fn: (client: PoolClient) => unknown) => {
        const mockClient = {
          query: vi.fn().mockResolvedValue({ rows: [] }), // kein Ergebnis
        } as unknown as PoolClient;
        return fn(mockClient);
      }
    );

    const req = makePostRequest({ ...VALID_QUOTE_BODY, project_type_id: FOREIGN_TYPE_ID });
    const res = await POST(req);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain("Ungültige Abrechnungsart");
  });

  it("QBM-10: inaktiver project_type (is_active=false) → 422 (DB gibt keine Rows)", async () => {
    // Simuliert: is_active=false → DB-Query filtert is_active=true → 0 Rows
    vi.mocked(withTenantContext).mockImplementation(
      async (_ctx: unknown, fn: (client: PoolClient) => unknown) => {
        const mockClient = {
          query: vi.fn().mockResolvedValue({ rows: [] }),
        } as unknown as PoolClient;
        return fn(mockClient);
      }
    );

    const req = makePostRequest(VALID_QUOTE_BODY);
    const res = await POST(req);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });
});
