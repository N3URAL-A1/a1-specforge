/**
 * tests/integration/claudia/http-caps-audit.test.ts
 *
 * Real-transaction regression test for the 2026-09-25 MAJOR bug: every
 * Claudia HTTP capability route (mail-send, mail-list, calendar-create,
 * calendar-list, calendar-update, mail-rules-create/update/delete) inserted
 * into `api.agent_tool_calls` with a column set that never existed on that
 * table (`user_id`, `agent_id`) — Postgres raised 42703 at parse time, the
 * transaction rolled back, and the route answered 500 AFTER the external
 * effect (mail sent / event created / filter changed) had already happened.
 * See N3URAL-Vault/project/n3ural-platform/fixes/2026-09-25-claudia-caps-audit-insert-500.md.
 *
 * Modeled on tests/integration/claudia/mail-draft-audit.test.ts: calls the
 * REAL route handlers with `withTenantContext` mocked to reuse an already
 * open transaction on a real Postgres connection (real RLS, real CHECK/FK
 * constraints). Only true external boundaries are mocked: `verifyBearerToken`
 * (no real API key needed), `loadAndDecryptConnection` (no real KMS/OAuth)
 * and the provider adapters (`gmailAdapter`, `msGraphAdapter` — no real
 * Gmail/Graph API calls).
 *
 * DB: requires PGHOST/PGPORT/PGDATABASE/PGUSER/POSTGRES_PASSWORD to be set
 * explicitly (same contract as mail-draft-audit.test.ts / read-migration-
 * harness.ts) — no silent fallback to a real/production database. In CI a
 * missing env or a failed connect throws instead of silently skipping (same
 * "no green-but-empty job" rule as mail-draft-audit.test.ts).
 *
 * Mutation answer for every "writes exactly one audit_log row" assertion:
 * restoring the old broken `INSERT INTO api.agent_tool_calls (..., user_id,
 * agent_id, ...)` in the route under test makes that route's tests fail with
 * a real Postgres 42703 (`column "user_id" of relation "agent_tool_calls"
 * does not exist`) surfacing as a 500 from the route — exactly the symptom
 * this file exists to catch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

// ── Mocks — before importing the route handlers ─────────────────────────────

// next/server's after() requires a real App-Router request scope (unavailable
// under vitest) — run the callback inline instead of deferring it (same
// pattern as mail-draft-audit.test.ts).
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (fn: () => unknown) => fn() };
});

vi.mock("@/lib/office/auth-middleware", () => ({
  verifyBearerToken: vi.fn(),
}));

vi.mock("@/lib/db/tenant-pool", () => ({
  withTenantContext: vi.fn(),
}));

vi.mock("@/lib/claudia/connection-loader", async () => {
  const actual = await vi.importActual<typeof import("@/lib/claudia/connection-loader")>(
    "@/lib/claudia/connection-loader"
  );
  return {
    ...actual,
    loadAndDecryptConnection: vi.fn(),
    markConnectionRevoked: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/claudia/gmail-adapter", () => ({
  gmailAdapter: {
    listMails: vi.fn(),
    sendMail: vi.fn(),
    listCalendarEvents: vi.fn(),
    createCalendarEvent: vi.fn(),
    updateCalendarEvent: vi.fn(),
    listMailRules: vi.fn(),
    createMailRule: vi.fn(),
    deleteMailRule: vi.fn(),
    createDraft: vi.fn(),
  },
}));

vi.mock("@/lib/claudia/msgraph-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/claudia/msgraph-adapter")>(
    "@/lib/claudia/msgraph-adapter"
  );
  return {
    ...actual,
    msGraphAdapter: {
      listMails: vi.fn(),
      sendMail: vi.fn(),
      listCalendarEvents: vi.fn(),
      createCalendarEvent: vi.fn(),
      updateCalendarEvent: vi.fn(),
      listMailRules: vi.fn(),
      createMailRule: vi.fn(),
      deleteMailRule: vi.fn(),
      createDraft: vi.fn(),
    },
  };
});

import { verifyBearerToken } from "@/lib/office/auth-middleware";
import { withTenantContext } from "@/lib/db/tenant-pool";
import { loadAndDecryptConnection } from "@/lib/claudia/connection-loader";
import { gmailAdapter } from "@/lib/claudia/gmail-adapter";
import { POST as mailSend } from "@/app/api/office/v1/capabilities/mail-send/route";
import { POST as mailList } from "@/app/api/office/v1/capabilities/mail-list/route";
import { POST as calendarCreate } from "@/app/api/office/v1/capabilities/calendar-create/route";
import { POST as calendarList } from "@/app/api/office/v1/capabilities/calendar-list/route";
import { POST as calendarUpdate } from "@/app/api/office/v1/capabilities/calendar-update/route";
import { POST as mailRulesCreate } from "@/app/api/office/v1/capabilities/mail-rules-create/route";
import { POST as mailRulesUpdate } from "@/app/api/office/v1/capabilities/mail-rules-update/route";
import { POST as mailRulesDelete } from "@/app/api/office/v1/capabilities/mail-rules-delete/route";

// ─── DB config (identical contract to mail-draft-audit.test.ts) ────────────

function dbConfig() {
  return {
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.POSTGRES_PASSWORD ?? process.env.PGPASSWORD,
  };
}

function envComplete(cfg: ReturnType<typeof dbConfig>): boolean {
  return Boolean(cfg.host && cfg.port && cfg.database && cfg.user && cfg.password);
}

// Fixture constants from tests/ci/fixture-seed.sql
const TENANT_A = "00000000-0000-0000-0000-000000000010"; // n3ural
const USER_OWNER = "576815bd-301e-48c7-a39e-d78ed176d192"; // ci-owner@example.test

const GMAIL_FULL_SCOPE =
  "openid https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.settings.basic https://www.googleapis.com/auth/calendar";

function validAuthResult() {
  return {
    ok: true as const,
    auth: {
      keyId: testApiKeyId,
      keyName: "http-caps-audit-test-key",
      tenantId: TENANT_A,
      createdBy: USER_OWNER,
      actorKind: "api_key" as const,
      scopes: ["mail:read", "mail:write", "calendar:read", "calendar:write"],
      kind: "api_key",
    },
  };
}

function invalidActorAuthResult() {
  // Same key, but createdBy swapped to a non-existent platform_users id. This
  // id also becomes app.current_user_id (mockTenantContextReusingTx), which
  // has no api.tenant_users membership for TENANT_A — measured against the
  // real seed (tests/ci/schema-seed.sql), this makes the RLS policy
  // `audit_log_insert` (WITH CHECK tenant_id IN accessible_tenant_ids())
  // reject the row before the actor_user_id FK is ever evaluated. Either way
  // the INSERT fails inside the SAVEPOINT, which is what this test proves.
  return {
    ok: true as const,
    auth: {
      keyId: testApiKeyId,
      keyName: "http-caps-audit-test-key",
      tenantId: TENANT_A,
      createdBy: "00000000-0000-0000-0000-00000000dead",
      actorKind: "api_key" as const,
      scopes: ["mail:read", "mail:write", "calendar:read", "calendar:write"],
      kind: "api_key",
    },
  };
}

const CONNECTED = {
  accessToken: "fake-access-token-never-logged",
  connectionId: "conn-http-caps-audit-test",
  email: "robert@n3urala1.com",
  scope: GMAIL_FULL_SCOPE,
};

let client: Client;
let dbAvailable = false;
let testApiKeyId: string;

beforeEach(async () => {
  vi.clearAllMocks();

  const cfg = dbConfig();
  if (!envComplete(cfg)) {
    dbAvailable = false;
    if (process.env.CI) {
      throw new Error("DB required in CI: PGHOST/PGPORT/PGDATABASE/PGUSER/POSTGRES_PASSWORD incomplete");
    }
    return;
  }

  client = new Client(cfg as { host: string; port: number; database: string; user: string; password: string });
  try {
    await client.connect();
    dbAvailable = true;
  } catch (err) {
    dbAvailable = false;
    if (process.env.CI) {
      throw new Error(
        `DB required in CI: connection to ${cfg.host}:${cfg.port}/${cfg.database} failed — ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
    }
    return;
  }

  testApiKeyId = randomUUID();
  await client.query(
    `INSERT INTO api.platform_api_keys (id, name, hashed_token, scopes, tenant_id, created_by, kind)
     VALUES ($1::uuid, 'http-caps-audit-test-key', 'test-hash-not-real', '["mail:read","mail:write","calendar:read","calendar:write"]'::jsonb, $2::uuid, $3::uuid, 'api_key')`,
    [testApiKeyId, TENANT_A, USER_OWNER]
  );
});

afterEach(async () => {
  if (!dbAvailable) return;
  try {
    await client.query("ROLLBACK");
  } catch {
    // no open tx
  }
  await client.query(`DELETE FROM api.audit_log WHERE actor_api_key_id = $1::uuid`, [testApiKeyId]).catch(() => {});
  await client.query(`DELETE FROM api.platform_api_keys WHERE id = $1::uuid`, [testApiKeyId]).catch(() => {});
  await client.end();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/office/v1/capabilities/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token" },
    body: JSON.stringify(body),
  });
}

/**
 * Mirrors lib/db/tenant-pool.ts::withTenantContext (RESET ROLE + SET LOCAL
 * ROLE agent_user + 3x set_config) against the test's own already-open
 * transaction — identical strategy to mail-draft-audit.test.ts.
 */
function mockTenantContextReusingTx(tenantId: string, userId: string): void {
  vi.mocked(withTenantContext).mockImplementation(async (_ctx, fn) => {
    await client.query("RESET ROLE");
    await client.query("SET LOCAL ROLE agent_user");
    await client.query("SELECT set_config('app.current_user_id',$1,true)", [userId]);
    await client.query("SELECT set_config('app.current_tenant_id',$1,true)", [tenantId]);
    // Production always calls withTenantContext with isSuperadmin: false
    // (lib/office/create-office-handler.ts:110) — asserted for real here.
    await client.query("SELECT set_config('app.is_superadmin','false',true)");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return fn(client as any);
  });
}

async function auditRows(rowId: string) {
  const { rows } = await client.query(
    `SELECT actor_user_id, actor_kind, actor_api_key_id, table_name, operation, row_id, metadata
       FROM api.audit_log WHERE row_id = $1 AND actor_api_key_id = $2::uuid`,
    [rowId, testApiKeyId]
  );
  return rows;
}

// ─── Write routes: 2xx + exactly one audit_log row ─────────────────────────

describe("Claudia HTTP capability routes — real audit_log insert (2026-09-25 fix)", () => {
  it("mail-send: 200, one audit_log row, no token/body in metadata", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue(CONNECTED);
    vi.mocked(gmailAdapter.sendMail).mockResolvedValue({
      mailId: `mail-${randomUUID()}`,
      timestamp: new Date().toISOString(),
    });

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await mailSend(
        makeRequest("mail-send", {
          provider: "google",
          to: ["kunde@example.com"],
          subject: "Rechnung",
          bodyHtml: "<p>BODY-SENTINEL</p>",
          confirmed: true,
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const mailId = body.data.mailId as string;

      const rows = await auditRows(mailId);
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_user_id).toBe(USER_OWNER);
      expect(rows[0].actor_kind).toBe("api_key");
      expect(rows[0].actor_api_key_id).toBe(testApiKeyId);
      expect(rows[0].operation).toBe("INSERT");
      const metaStr = JSON.stringify(rows[0].metadata);
      // Key-name check (redaction by field) plus a content sentinel — a
      // redaction that only strips the `bodyHtml` key but leaves the actual
      // markup under a different key would still pass a key-name-only check.
      expect(metaStr).not.toMatch(/bodyHtml|fake-access-token/);
      expect(metaStr).not.toContain("BODY-SENTINEL");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("calendar-create: 200, one audit_log row with eventId as row_id", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue(CONNECTED);
    const eventId = `event-${randomUUID()}`;
    vi.mocked(gmailAdapter.createCalendarEvent).mockResolvedValue({ eventId });

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await calendarCreate(
        makeRequest("calendar-create", {
          provider: "google",
          title: "Kickoff",
          start: "2026-10-01T10:00:00Z",
          end: "2026-10-01T11:00:00Z",
          confirmed: true,
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.eventId).toBe(eventId);

      const rows = await auditRows(eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_api_key_id).toBe(testApiKeyId);
      expect(rows[0].operation).toBe("INSERT");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("calendar-update: 200, one audit_log row with eventId as row_id, operation UPDATE", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue(CONNECTED);
    vi.mocked(gmailAdapter.updateCalendarEvent).mockResolvedValue(undefined);
    const eventId = `event-update-${randomUUID()}`;

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await calendarUpdate(
        makeRequest("calendar-update", {
          provider: "google",
          eventId,
          changes: { title: "Neuer Titel" },
          confirmed: true,
        })
      );
      expect(res.status).toBe(200);

      const rows = await auditRows(eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0].operation).toBe("UPDATE");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("calendar-update: metadata never carries description/location/attendee addresses, only changed_fields", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue(CONNECTED);
    vi.mocked(gmailAdapter.updateCalendarEvent).mockResolvedValue(undefined);
    const eventId = `event-redact-${randomUUID()}`;

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await calendarUpdate(
        makeRequest("calendar-update", {
          provider: "google",
          eventId,
          changes: {
            description: "GEHEIM-XYZ",
            location: "ORT-XYZ",
            attendees: ["a-xyz@example.com"],
          },
          confirmed: true,
        })
      );
      expect(res.status).toBe(200);

      const rows = await auditRows(eventId);
      expect(rows).toHaveLength(1);
      const metaStr = JSON.stringify(rows[0].metadata);
      // Mutation answer: restoring `changes: validated.changes` (unfiltered)
      // in the route makes every one of these assertions fail red again.
      expect(metaStr).not.toContain("GEHEIM-XYZ");
      expect(metaStr).not.toContain("ORT-XYZ");
      expect(metaStr).not.toContain("a-xyz@example.com");
      expect(rows[0].metadata.changed_fields).toContain("description");
      expect(rows[0].metadata.changed_fields).toContain("location");
      expect(rows[0].metadata.changed_fields).toContain("attendees");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("mail-rules-create: 201, one audit_log row with ruleId as row_id", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue(CONNECTED);
    vi.mocked(gmailAdapter.listMailRules).mockResolvedValue([]);
    const ruleId = `rule-${randomUUID()}`;
    vi.mocked(gmailAdapter.createMailRule).mockResolvedValue({
      id: ruleId,
      condition: { from: "newsletter@example.com" },
      action: { type: "archive" },
    });

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await mailRulesCreate(
        makeRequest("mail-rules-create", {
          provider: "google",
          condition: { from: "newsletter@example.com" },
          action: { type: "archive" },
        })
      );
      expect(res.status).toBe(201);

      const rows = await auditRows(ruleId);
      expect(rows).toHaveLength(1);
      expect(rows[0].operation).toBe("INSERT");
      expect(rows[0].metadata.audit_event).toBeDefined();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("mail-rules-update: 200, one audit_log row with new ruleId, operation UPDATE", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue(CONNECTED);
    vi.mocked(gmailAdapter.listMailRules).mockResolvedValue([
      { id: "old-rule", condition: { from: "old@example.com" }, action: { type: "archive" } },
    ]);
    const newRuleId = `rule-updated-${randomUUID()}`;
    vi.mocked(gmailAdapter.createMailRule).mockResolvedValue({
      id: newRuleId,
      condition: { from: "new@example.com" },
      action: { type: "archive" },
    });
    vi.mocked(gmailAdapter.deleteMailRule).mockResolvedValue(undefined);

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await mailRulesUpdate(
        makeRequest("mail-rules-update", {
          provider: "google",
          ruleId: "old-rule",
          condition: { from: "new@example.com" },
          action: { type: "archive" },
        })
      );
      expect(res.status).toBe(200);

      const rows = await auditRows(newRuleId);
      expect(rows).toHaveLength(1);
      expect(rows[0].operation).toBe("UPDATE");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("mail-rules-delete: 200, one audit_log row, operation DELETE", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue(CONNECTED);
    const ruleId = "rule-to-delete";
    vi.mocked(gmailAdapter.deleteMailRule).mockResolvedValue(undefined);

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await mailRulesDelete(
        makeRequest("mail-rules-delete", { provider: "google", ruleId })
      );
      expect(res.status).toBe(200);

      const rows = await auditRows(ruleId);
      expect(rows).toHaveLength(1);
      expect(rows[0].operation).toBe("DELETE");
    } finally {
      await client.query("ROLLBACK");
    }
  });
});

// ─── Read routes: 200, no audit_log row (telemetry covers the call) ────────

describe("Claudia HTTP capability read routes — 200, no audit_log row", () => {
  it("mail-list: 200, no api.audit_log row written for this key", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue(CONNECTED);
    vi.mocked(gmailAdapter.listMails).mockResolvedValue([]);

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await mailList(makeRequest("mail-list", { provider: "google", limit: 10 }));
      expect(res.status).toBe(200);

      const { rows } = await client.query(
        `SELECT 1 FROM api.audit_log WHERE actor_api_key_id = $1::uuid`,
        [testApiKeyId]
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("calendar-list: 200, no api.audit_log row written for this key", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue(CONNECTED);
    vi.mocked(gmailAdapter.listCalendarEvents).mockResolvedValue([]);

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await calendarList(
        makeRequest("calendar-list", {
          provider: "google",
          startDate: "2026-10-01T00:00:00Z",
          endDate: "2026-10-02T00:00:00Z",
        })
      );
      expect(res.status).toBe(200);

      const { rows } = await client.query(
        `SELECT 1 FROM api.audit_log WHERE actor_api_key_id = $1::uuid`,
        [testApiKeyId]
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});

// ─── Audit failure must never mask a successful external effect ───────────

describe("Claudia HTTP capability routes — audit failure never masks a successful external effect", () => {
  it("mail-send: audit insert fails on actor FK violation, response is still 200 and provider called exactly once", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(invalidActorAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue(CONNECTED);
    const mailId = `mail-fail-${randomUUID()}`;
    vi.mocked(gmailAdapter.sendMail).mockResolvedValue({
      mailId,
      timestamp: new Date().toISOString(),
    });

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, "00000000-0000-0000-0000-00000000dead");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await mailSend(
        makeRequest("mail-send", {
          provider: "google",
          to: ["kunde@example.com"],
          subject: "Rechnung",
          bodyHtml: "<p>Body</p>",
          confirmed: true,
        })
      );

      // Mutation answer: removing the SAVEPOINT wrap around the audit insert
      // makes this assertion fail — Postgres aborts the whole transaction on
      // the RLS-policy rejection and the route's error path returns 500 instead.
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.mailId).toBe(mailId);
      expect(gmailAdapter.sendMail).toHaveBeenCalledTimes(1);

      // Transaction still usable — proof the SAVEPOINT absorbed the failure.
      const { rows } = await client.query("SELECT 1 AS one");
      expect(rows[0].one).toBe(1);

      // No row persisted under the invalid actor.
      const { rows: leftover } = await client.query(
        `SELECT 1 FROM api.audit_log WHERE row_id = $1`,
        [mailId]
      );
      expect(leftover).toHaveLength(0);
      // Precise the failure: it must be the audit INSERT itself rejected by
      // Postgres — measured against the real DB it is the RLS policy
      // `audit_log_insert` firing first (the dead actor has no tenant
      // membership), not an unrelated audit error that would also satisfy a
      // bare "was called" assertion.
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[http-cap-audit]"),
        expect.stringMatching(/row-level security policy/)
      );
    } finally {
      await client.query("ROLLBACK");
      consoleErrorSpy.mockRestore();
    }
  });
});

// ─── Rejected-audit helper (lib/claudia/mail-rules-audit.ts) ───────────────

describe("mail-rules-audit rejected audit — persists under SAVEPOINT (2026-09-25 fix)", () => {
  it("mail-rules-create: ACTION_NOT_ALLOWED (forward) returns 400 and persists exactly one 'mail.rule.rejected' row with operation INSERT and row_id NULL", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await mailRulesCreate(
        makeRequest("mail-rules-create", {
          provider: "google",
          condition: { from: "newsletter@example.com" },
          action: { type: "forward", to: "evil@example.com" },
        })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("ACTION_NOT_ALLOWED");

      const { rows } = await client.query(
        `SELECT operation, table_name, row_id, metadata
           FROM api.audit_log WHERE actor_api_key_id = $1::uuid`,
        [testApiKeyId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata.audit_event).toBe("mail.rule.rejected");
      // Mutation answer: hardcoding operation:'INSERT' for every capabilityId
      // would still pass create's own case — this only fails if update/delete
      // are also pinned to INSERT, which the two tests below cover.
      expect(rows[0].operation).toBe("INSERT");
      expect(rows[0].row_id).toBeNull();

      // Connection load never happened — fail-fast guard reject.
      expect(loadAndDecryptConnection).not.toHaveBeenCalled();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("mail-rules-update: ACTION_NOT_ALLOWED (forward) persists a rejected row with operation UPDATE and row_id = ruleId", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    const ruleId = `rule-reject-${randomUUID()}`;

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await mailRulesUpdate(
        makeRequest("mail-rules-update", {
          provider: "google",
          ruleId,
          condition: { from: "newsletter@example.com" },
          action: { type: "forward", to: "evil@example.com" },
        })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("ACTION_NOT_ALLOWED");

      const rows = await auditRows(ruleId);
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata.audit_event).toBe("mail.rule.rejected");
      // Mutation answer: pinning operation to 'INSERT' regardless of
      // capabilityId makes this fail red (would read 'INSERT' instead).
      expect(rows[0].operation).toBe("UPDATE");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("mail-rules-delete: MISSING_SCOPE persists a rejected row with operation DELETE and row_id = ruleId", async (ctx) => {
    if (!dbAvailable) ctx.skip();
    vi.mocked(verifyBearerToken).mockResolvedValue(validAuthResult());
    vi.mocked(loadAndDecryptConnection).mockResolvedValue({
      ...CONNECTED,
      scope: "openid email", // gmail.settings.basic fehlt → MISSING_SCOPE
    });
    const ruleId = `rule-reject-delete-${randomUUID()}`;

    await client.query("BEGIN");
    mockTenantContextReusingTx(TENANT_A, USER_OWNER);
    try {
      const res = await mailRulesDelete(makeRequest("mail-rules-delete", { provider: "google", ruleId }));
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("MISSING_SCOPE");

      const rows = await auditRows(ruleId);
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata.audit_event).toBe("mail.rule.rejected");
      // Mutation answer: pinning operation to 'INSERT' regardless of
      // capabilityId makes this fail red (would read 'INSERT' instead).
      expect(rows[0].operation).toBe("DELETE");
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
