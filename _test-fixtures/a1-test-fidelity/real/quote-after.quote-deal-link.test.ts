/**
 * Bug 2026-10-03 quote-deal-id-not-persisted (Vault: project/n3ural-platform/fixes/…, Falks Diagnose).
 *
 * Zusagen, je Teil ein eigener Block — gerufen werden die ECHTEN Handler gegen die Datenbank:
 *
 *   A  POST /api/crm/invoices (Angebot mit deal_id + project_type_id) speichert deal_id UND
 *      billing_method, synchronisiert deals.value_eur UND der Won-Gate der Stufen-Route findet das
 *      Angebot danach. Vorher (seit 180bdfda) liess insertInvoiceWithItems beide Spalten still fallen,
 *      und der einzige Test (pipeline-flow-quote-billing) mockte createInvoice (testing.md Klasse 3).
 *   C  PATCH /api/crm/invoices/[id]/status mit "accepted" (der Weg des Dashboard-Knopfs) koppelt wie
 *      PATCH /api/crm/invoices/[id]: Deal → Gewonnen-Art, Projekt, genau EIN Verlaufseintrag; in DERSELBEN
 *      Transaktion wie die Statusaenderung. Negative Zwillinge: "rejected" koppelt nicht; ein bereits
 *      gewonnener Deal bekommt keinen zweiten Verlaufseintrag.
 *   D  Entwurfs-PATCH eines Angebots loest project_type_id in derselben Reihenfolge auf wie die Anlage
 *      (api.tags kind='deal' zuerst, dann api.project_types).
 *   E  PATCH /api/crm/invoices/[id] mit items: ein nicht getroffenes Feld-Update rollt den Zeilentausch
 *      zurueck (der Wurf liegt in der Transaktion, nicht dahinter).
 *
 * Gemockt sind nur die Sitzungsquellen (@/auth, next/headers). Alles laeuft in EINER zurueckgerollten
 * Sitzung (shared-session-pool) mit eigenen Fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { auth } from "@/auth";
import { headers } from "next/headers";
import { _setPool, withTenantContext } from "@/lib/db/tenant-pool";
import { insertInvoiceWithItems } from "@/lib/crm/invoice-write-service";
import { acceptQuote } from "@/lib/crm/quote-acceptance";
import { POST as invoicesPOST } from "@/app/api/crm/invoices/route";
import { PATCH as invoicePATCH } from "@/app/api/crm/invoices/[id]/route";
import { PATCH as statusPATCH } from "@/app/api/crm/invoices/[id]/status/route";
import { PATCH as stagePATCH } from "@/app/api/crm/deals/[id]/stage/route";
import { dbConfig } from "../_helpers/read-migration-harness";
import { createSharedSessionPool } from "../_helpers/shared-session-pool";

const T = "0b0c0d03-0000-4000-8000-000000000001";
const TF = "0b0c0d03-0000-4000-8000-000000000002";
const TAG_FOREIGN = "0b0c0d03-0000-4000-8000-0000000000c3";
const LEGACY_INACTIVE = "0b0c0d03-0000-4000-8000-0000000000d2";
const U = "0b0c0d03-0000-4000-8000-0000000000a1";
const LEAD = "qdl-lead";
const DEAL = 2147081001;
const QUOTE = 2147081002;
const QUOTE_B = 2147081003;
const MISSING_INVOICE = 2147081999;
const HOURLY_RATE = 120;
/** Mitglied OHNE Rechnungs-Schreibrecht (invoices_update verlangt owner/admin). */
const U_MEMBER = "0b0c0d03-0000-4000-8000-0000000000a2";
const TAG_FIXED = "0b0c0d03-0000-4000-8000-0000000000c1";
const TAG_RETAINER = "0b0c0d03-0000-4000-8000-0000000000c2";
const LEGACY_TYPE = "0b0c0d03-0000-4000-8000-0000000000d1";
const DEAL_VALUE_BEFORE = 1000;
const QUOTE_PRICE = 2500;

let client: Client;
let customerId: number;
let st: Record<string, string>;

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (url: string, method: string, body: unknown): Request =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function one<V>(sql: string, p: unknown[] = []): Promise<V | null> {
  return ((await client.query<{ v: V }>(sql, p)).rows[0]?.v ?? null) as V | null;
}

const dealStageName = () => one<string>(`SELECT s.name AS v FROM api.deals d JOIN api.pipeline_stages s ON s.id = d.stage_id WHERE d.id = $1`, [DEAL]);
const dealStageKind = () => one<string>(`SELECT s.stage_kind AS v FROM api.deals d JOIN api.pipeline_stages s ON s.id = d.stage_id WHERE d.id = $1`, [DEAL]);
const historyCount = () => one<number>(`SELECT count(*)::int AS v FROM api.deal_stage_history WHERE deal_id = $1`, [DEAL]);
const projectCount = () => one<number>(`SELECT count(*)::int AS v FROM api.projects WHERE deal_id = $1`, [DEAL]);
const quoteStatus = () => one<string>(`SELECT status::text AS v FROM api.invoices WHERE id = $1`, [QUOTE]);

async function moveDealTo(stage: string): Promise<void> {
  await client.query(`UPDATE api.deals SET stage_id = $2 WHERE id = $1`, [DEAL, st[stage]]);
}

/** Angebot direkt angelegt (fuer C/D/E — dort geht es nicht um den Anlage-Pfad). */
async function insertQuote(status: string, billingMethod: string | null, dealId: number | null = DEAL): Promise<void> {
  await client.query(
    `INSERT INTO api.invoices (id, invoice_number, type, customer_id, status, issue_date, due_date, tenant_id, deal_id, billing_method, kleinunternehmer)
     VALUES ($1, 'QDL-Q-1', 'quote', $2, $3, CURRENT_DATE, CURRENT_DATE + 30, $4, $5, $6, true)`,
    [QUOTE, customerId, status, T, dealId, billingMethod]
  );
  await client.query(
    `INSERT INTO api.invoice_items (tenant_id, invoice_id, position, description, quantity, unit, unit_price, total)
     VALUES ($1, $2, 1, 'QDL Leistung', 1, 'Pauschal', $3, $3)`,
    [T, QUOTE, QUOTE_PRICE]
  );
}

beforeEach(async () => {
  client = new Client(dbConfig());
  await client.connect();
  await client.query("BEGIN");
  await client.query(`SET LOCAL lock_timeout = '5s'`);
  await client.query(`INSERT INTO api.tenants (id, slug, name) VALUES ($1, 'qdl-t', 'QDL'), ($2, 'qdl-f', 'QDL fremd')`, [T, TF]);
  await client.query(`INSERT INTO api.platform_users (id, email) VALUES ($1, 'qdl@example.invalid')`, [U]);
  await client.query(`INSERT INTO api.tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [T, U]);
  await client.query(
    `INSERT INTO api.tenant_feature_flags (tenant_id, flag_name, enabled)
     SELECT $1, f, true FROM unnest(ARRAY['invoices','deals','projects']) AS f ON CONFLICT DO NOTHING`,
    [T]
  );
  const s = await client.query<{ name: string; id: string }>(
    `SELECT s.name, s.id FROM api.pipeline_stages s JOIN api.pipelines p ON p.id = s.pipeline_id WHERE p.tenant_id = $1 AND p.is_default`,
    [T]
  );
  st = Object.fromEntries(s.rows.map((r) => [r.name, r.id]));
  customerId = (await client.query<{ id: number }>(`INSERT INTO api.customers (firma, status, tenant_id) VALUES ('QDL Kunde', 'active', $1) RETURNING id`, [T])).rows[0].id;
  await client.query(`INSERT INTO api.leads (id, firma, tenant_id) VALUES ($1, 'QDL GmbH', $2)`, [LEAD, T]);
  const pipe = await one<string>(`SELECT pipeline_id AS v FROM api.pipeline_stages WHERE id = $1`, [st.negotiation]);
  await client.query(
    `INSERT INTO api.deals (id, lead_id, title, tenant_id, pipeline_id, stage_id, value_eur, customer_id) VALUES ($1, $2, 'QDL Deal', $3, $4, $5, $6, $7)`,
    [DEAL, LEAD, T, pipe, st.negotiation, DEAL_VALUE_BEFORE, customerId]
  );
  await client.query(
    `INSERT INTO api.tags (id, tenant_id, name, kind, billing_method) VALUES ($1, $3, 'QDL Festpreis', 'deal', 'fixed_price'), ($2, $3, 'QDL Retainer', 'deal', 'retainer')`,
    [TAG_FIXED, TAG_RETAINER, T]
  );
  await client.query(`INSERT INTO api.project_types (id, tenant_id, name, billing_method) VALUES ($1, $2, 'QDL Alt-Typ', 'per_unit')`, [LEGACY_TYPE, T]);
  await client.query(`INSERT INTO api.project_types (id, tenant_id, name, billing_method, is_active) VALUES ($1, $2, 'QDL Alt-Typ inaktiv', 'hourly', false)`, [LEGACY_INACTIVE, T]);
  await client.query(`INSERT INTO api.tags (id, tenant_id, name, kind, billing_method) VALUES ($1, $2, 'QDL fremder Typ', 'deal', 'hourly')`, [TAG_FOREIGN, TF]);
  _setPool(createSharedSessionPool(client).pool);
  vi.mocked(auth).mockResolvedValue({ user: { id: U, isSuperadmin: false, email: "qdl@example.invalid" } } as never);
  vi.mocked(headers).mockResolvedValue(new Headers({ "x-tenant-id": T, "x-user-id": U }) as never);
});

afterEach(async () => {
  _setPool(null);
  await client.query("ROLLBACK");
  await client.end();
});

// ── A — Anlage eines Angebots aus dem Deal ──────────────────────────────────────────────────────
describe("A — POST /api/crm/invoices (Angebot aus dem Deal) speichert die Deal-Verknuepfung", () => {
  const createQuote = async (body: Record<string, unknown>) => {
    const res = await invoicesPOST(
      req("http://t/api/crm/invoices", "POST", {
        type: "quote",
        customer_id: customerId,
        project_type_id: TAG_FIXED,
        items: [{ description: "QDL Konzept", quantity: 1, unit: "Pauschal", unit_price: QUOTE_PRICE }],
        ...body,
      }) as never
    );
    const json = (await res.json()) as { data?: { id: number } };
    return { status: res.status, id: json.data?.id ?? null };
  };

  it("A1 „speichert deal_id“: die Zeile traegt die Deal-Id", async () => {
    const r = await createQuote({ deal_id: DEAL });
    expect({ status: r.status, deal: await one<number>(`SELECT deal_id AS v FROM api.invoices WHERE id = $1`, [r.id]) }).toEqual({ status: 201, deal: DEAL });
  });

  it("A2 „speichert billing_method“: die Zeile traegt die Abrechnungsart des Projekt-Typs", async () => {
    const r = await createQuote({ deal_id: DEAL });
    expect({ status: r.status, bm: await one<string>(`SELECT billing_method AS v FROM api.invoices WHERE id = $1`, [r.id]) }).toEqual({ status: 201, bm: "fixed_price" });
  });

  it("A3 deals.value_eur wird auf die Angebotssumme gezogen", async () => {
    const r = await createQuote({ deal_id: DEAL });
    expect({ status: r.status, value: Number(await one<string>(`SELECT value_eur AS v FROM api.deals WHERE id = $1`, [DEAL])) }).toEqual({ status: 201, value: QUOTE_PRICE });
  });

  it("A4 der Won-Gate der Stufen-Route findet das neue Angebot (200 statt 422 quote_required)", async () => {
    await createQuote({ deal_id: DEAL });
    const res = await stagePATCH(req(`http://t/api/crm/deals/${DEAL}/stage`, "PATCH", { stage: "won" }) as never, params(DEAL));
    const json = (await res.json()) as { code?: string };
    expect({ status: res.status, code: json.code ?? null, stage: await dealStageName() }).toEqual({ status: 200, code: null, stage: "won" });
  });

  it("A5 negativer Zwilling: ohne deal_id bleibt die Zeile ohne Deal und der Deal-Wert unveraendert", async () => {
    const r = await createQuote({});
    expect({
      status: r.status,
      deal: await one<number>(`SELECT deal_id AS v FROM api.invoices WHERE id = $1`, [r.id]),
      value: Number(await one<string>(`SELECT value_eur AS v FROM api.deals WHERE id = $1`, [DEAL])),
    }).toEqual({ status: 201, deal: null, value: DEAL_VALUE_BEFORE });
  });

  it("A6 Rechnung (type invoice) mit deal_id: deal_id gespeichert, billing_method bleibt leer (nur Angebote)", async () => {
    const res = await invoicesPOST(
      req("http://t/api/crm/invoices", "POST", {
        type: "invoice",
        customer_id: customerId,
        deal_id: DEAL,
        due_date: "2026-10-31",
        service_period_start: "2026-09-01",
        service_period_end: "2026-09-30",
        items: [{ description: "QDL Rechnung", quantity: 1, unit_price: 10 }],
      }) as never
    );
    const id = ((await res.json()) as { data?: { id: number } }).data?.id;
    const row = (await client.query<{ deal_id: number | null; billing_method: string | null }>(`SELECT deal_id, billing_method FROM api.invoices WHERE id = $1`, [id])).rows[0];
    expect({ status: res.status, row }).toEqual({ status: 201, row: { deal_id: DEAL, billing_method: null } });
  });

  // Ersatz fuer pipeline-flow-quote-billing QBM-04…10 (Mock auf createInvoice + vorgeskripteter Client,
  // testing.md Klasse 3): dieselben Zusagen auf der Wirkebene.
  it.each([
    ["A8 Projekt-Typ eines FREMDEN Mandanten (QBM-09)", TAG_FOREIGN],
    ["A9 inaktiver Alt-Typ (QBM-10)", LEGACY_INACTIVE],
    ["A10 Kennung ohne UUID-Form (vorher Cast-Fehler → 500)", "kein-uuid"],
  ])("%s → 422 „Ungültige Abrechnungsart“, kein Angebot angelegt", async (_name, typeId) => {
    // Review #320: die SELECT-Wand auf api.tags oeffnen, sonst verdeckt RLS den fremden Tag und A8
    // belegt den ausdruecklichen tenant_id-Filter der Aufloesung nicht (Regel 21).
    await client.query(`ALTER POLICY tags_select ON api.tags USING (true)`);
    const before = await one<number>(`SELECT count(*)::int AS v FROM api.invoices WHERE tenant_id = $1`, [T]);
    const res = await invoicesPOST(
      req("http://t/api/crm/invoices", "POST", { type: "quote", customer_id: customerId, deal_id: DEAL, project_type_id: typeId, items: [{ description: "x", quantity: 1, unit_price: 1 }] }) as never
    );
    const json = (await res.json()) as { error?: string };
    expect({ status: res.status, msg: /Ungültige Abrechnungsart/.test(json.error ?? ""), after: await one<number>(`SELECT count(*)::int AS v FROM api.invoices WHERE tenant_id = $1`, [T]) }).toEqual({
      status: 422,
      msg: true,
      after: before,
    });
  });

  it("A7 Service: billing_method an einer Nicht-Angebots-Zeile ist ein Programmierfehler (wirft, schreibt nichts)", async () => {
    const before = await one<number>(`SELECT count(*)::int AS v FROM api.invoices WHERE tenant_id = $1`, [T]);
    const err = await withTenantContext({ tenantId: T, userId: U, isSuperadmin: false }, (c) =>
      insertInvoiceWithItems(c, T, { type: "invoice", customer_id: customerId, issue_date: "2026-10-03", billing_method: "hourly" }, [
        { description: "x", quantity: 1, unit_price: 1 },
      ])
    ).then(
      () => null,
      (e: Error) => e.message
    );
    expect({ threw: typeof err === "string" && /billing_method/.test(err), after: await one<number>(`SELECT count(*)::int AS v FROM api.invoices WHERE tenant_id = $1`, [T]) }).toEqual({
      threw: true,
      after: before,
    });
  });
});

// ── C — Annehmen ueber die Status-Route (Weg des Dashboard-Knopfs) ─────────────────────────────
describe("C — PATCH /api/crm/invoices/[id]/status accepted koppelt Deal und Projekt", () => {
  const setStatus = async (status: string) => {
    const res = await statusPATCH(req(`http://t/api/crm/invoices/${QUOTE}/status`, "PATCH", { status }) as never, params(QUOTE));
    const json = (await res.json()) as { coupling?: { deal_moved_to_won?: boolean; project_created?: boolean }; code?: string };
    return { status: res.status, json };
  };

  it("C1 accepted: Deal in Gewonnen-Art, genau 1 Verlaufseintrag, Projekt angelegt, Antwort meldet den Wechsel", async () => {
    await insertQuote("sent", "fixed_price");
    const r = await setStatus("accepted");
    expect({
      status: r.status,
      quote: await quoteStatus(),
      acceptedAt: (await one<string>(`SELECT accepted_at::text AS v FROM api.invoices WHERE id = $1`, [QUOTE])) !== null,
      kind: await dealStageKind(),
      history: await historyCount(),
      projects: await projectCount(),
      moved: r.json.coupling?.deal_moved_to_won ?? null,
    }).toEqual({ status: 200, quote: "accepted", acceptedAt: true, kind: "won", history: 1, projects: 1, moved: true });
  });

  it("C2 negativer Zwilling: rejected bewegt den Deal nicht und legt kein Projekt an", async () => {
    await insertQuote("sent", "fixed_price");
    const r = await setStatus("rejected");
    expect({ status: r.status, quote: await quoteStatus(), stage: await dealStageName(), history: await historyCount(), projects: await projectCount() }).toEqual({
      status: 200,
      quote: "rejected",
      stage: "negotiation",
      history: 0,
      projects: 0,
    });
  });

  it("C3 Loop-Guard: Deal schon gewonnen → kein zweiter Verlaufseintrag, Antwort meldet KEINEN Wechsel, Projekt sichergestellt", async () => {
    await moveDealTo("won");
    await insertQuote("sent", "fixed_price");
    const r = await setStatus("accepted");
    expect({ status: r.status, history: await historyCount(), moved: r.json.coupling?.deal_moved_to_won ?? null, projects: await projectCount() }).toEqual({
      status: 200,
      history: 0,
      moved: false,
      projects: 1,
    });
  });

  it("C4 Angebot ohne Deal: accepted gelingt, Antwort meldet keinen Deal-Wechsel", async () => {
    await insertQuote("sent", "fixed_price", null);
    const r = await setStatus("accepted");
    expect({ status: r.status, quote: await quoteStatus(), moved: r.json.coupling?.deal_moved_to_won ?? null, stage: await dealStageName() }).toEqual({
      status: 200,
      quote: "accepted",
      moved: false,
      stage: "negotiation",
    });
  });

  it("C5 atomar: Kopplung scheitert (hourly ohne Stundensatz) → 422 mit gangbarem Ausweg, Angebot bleibt sent, Deal unveraendert", async () => {
    await insertQuote("sent", "hourly");
    const r = await setStatus("accepted");
    const msg = (r.json as { error?: string }).error ?? "";
    expect({
      status: r.status,
      code: r.json.code,
      // Ausweg muss im Annahme-Kontext machbar sein: ein versendetes Angebot ist gesperrt (GoBD).
      wayOut: /ablehnen/i.test(msg) && /neues Angebot/i.test(msg),
      quote: await quoteStatus(),
      stage: await dealStageName(),
      history: await historyCount(),
    }).toEqual({ status: 422, code: "hourly_rate_required", wayOut: true, quote: "sent", stage: "negotiation", history: 0 });
  });

  // ── Review #320 MAJOR: Annahme darf nicht in eine Sackgasse laufen ──
  it("C7 Deal gewonnen + Projekt vorhanden + stundenbasiertes Angebot ohne Stunden-Position → 200 (es entsteht kein Projekt)", async () => {
    await moveDealTo("won");
    await client.query(`INSERT INTO api.projects (tenant_id, customer_id, deal_id, name, type, status) VALUES ($1, $2, $3, 'QDL Projekt', 'hourly', 'active')`, [T, customerId, DEAL]);
    await insertQuote("sent", "hourly");
    const r = await setStatus("accepted");
    expect({ status: r.status, quote: await quoteStatus(), projects: await projectCount() }).toEqual({ status: 200, quote: "accepted", projects: 1 });
  });

  it("C8 zwei Angebote am Deal: angenommenes A hat die Stunden-Position, neuerer Entwurf B nicht → 200, Projekt-Stundensatz aus A", async () => {
    // A direkt mit aelterem Zeitstempel (ein versendetes Angebot ist GoBD-gesperrt, auch created_at).
    await client.query(
      `INSERT INTO api.invoices (id, invoice_number, type, customer_id, status, issue_date, due_date, tenant_id, deal_id, billing_method, kleinunternehmer, created_at)
       VALUES ($1, 'QDL-Q-1', 'quote', $2, 'sent', CURRENT_DATE, CURRENT_DATE + 30, $3, $4, 'hourly', true, now() - interval '1 day')`,
      [QUOTE, customerId, T, DEAL]
    );
    await client.query(`INSERT INTO api.invoice_items (tenant_id, invoice_id, position, description, quantity, unit, unit_price, total) VALUES ($1, $2, 1, 'QDL Beratung', 10, 'Stunde', $3, $4)`, [T, QUOTE, HOURLY_RATE, HOURLY_RATE * 10]);
    await client.query(
      `INSERT INTO api.invoices (id, invoice_number, type, customer_id, status, issue_date, due_date, tenant_id, deal_id, billing_method, kleinunternehmer, created_at)
       VALUES ($1, 'QDL-Q-2', 'quote', $2, 'draft', CURRENT_DATE, CURRENT_DATE + 30, $3, $4, 'hourly', true, now())`,
      [QUOTE_B, customerId, T, DEAL]
    );
    const r = await setStatus("accepted");
    expect({ status: r.status, rate: Number(await one<string>(`SELECT hourly_rate AS v FROM api.projects WHERE deal_id = $1`, [DEAL])) }).toEqual({ status: 200, rate: HOURLY_RATE });
  });

  // ── Review #320 MINOR: Quellstatus im UPDATE bewachen ──
  it("C9 Service: Angebot ist nicht (mehr) sent (Doppelklick) → Konflikt 409, nichts geschrieben", async () => {
    await insertQuote("accepted", "fixed_price");
    await client.query(`UPDATE api.invoices SET accepted_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [QUOTE]);
    const out = await withTenantContext({ tenantId: T, userId: U, isSuperadmin: false }, (c) => acceptQuote(c, T, QUOTE, "qdl")).then(
      () => 200,
      (e: { httpStatus?: number }) => e.httpStatus ?? 500
    );
    expect({ out, acc: await one<string>(`SELECT to_char(accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS v FROM api.invoices WHERE id = $1`, [QUOTE]), history: await historyCount() }).toEqual({
      out: 409,
      acc: "2026-01-01",
      history: 0,
    });
  });

  it("C10 Route: Wettlauf — ein zweiter Tab lehnt im selben Moment ab → 409 (nicht 403)", async () => {
    await insertQuote("sent", "fixed_price");
    // Nachbau des Wettlaufs ohne Policy-Eingriff (Review #320 Delta): Die Route hat sent gelesen;
    // genau beim Annehmen schreibt "der andere Tab" rejected (verschachteltes UPDATE) und das
    // Annehmen trifft keine Zeile mehr. Innerhalb der Transaktion ist der Status damit NICHT mehr
    // sent — das unterscheidet den Wettlauf vom fehlenden Recht (C13). (Danach steht wieder sent da:
    // das verschachtelte UPDATE laeuft in derselben Transaktion und rollt mit dem 409 zurueck; im
    // echten Wettlauf ist es eine fremde, schon committete Transaktion.)
    await client.query(
      `CREATE FUNCTION api.qdl_race() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN UPDATE api.invoices SET status = 'rejected', declined_at = now() WHERE id = OLD.id; RETURN NULL; END $$`
    );
    await client.query(
      `CREATE TRIGGER qdl_race BEFORE UPDATE ON api.invoices FOR EACH ROW WHEN (NEW.status = 'accepted' AND OLD.id = ${QUOTE}) EXECUTE FUNCTION api.qdl_race()`
    );
    const r = await setStatus("accepted");
    expect({ status: r.status, code: r.json.code, history: await historyCount() }).toEqual({
      status: 409,
      code: "QUOTE_STATUS_CONFLICT",
      history: 0,
    });
  });

  it("C13 echtes Mitglied ohne Schreibrecht (role member) → 403 mit klarer Meldung, kein 409-Neuladen-Kreislauf", async () => {
    await insertQuote("sent", "fixed_price");
    await client.query(`INSERT INTO api.platform_users (id, email) VALUES ($1, 'qdl-member@example.invalid')`, [U_MEMBER]);
    await client.query(`INSERT INTO api.tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'member')`, [T, U_MEMBER]);
    vi.mocked(auth).mockResolvedValue({ user: { id: U_MEMBER, isSuperadmin: false, email: "qdl-member@example.invalid" } } as never);
    vi.mocked(headers).mockResolvedValue(new Headers({ "x-tenant-id": T, "x-user-id": U_MEMBER }) as never);
    const r = await setStatus("accepted");
    const msg = (r.json as { error?: string }).error ?? "";
    expect({
      status: r.status,
      code: r.json.code,
      german: /Berechtigung/.test(msg) && /Angebot/.test(msg),
      quote: await quoteStatus(),
      stage: await dealStageName(),
      history: await historyCount(),
    }).toEqual({ status: 403, code: "QUOTE_ACCEPT_FORBIDDEN", german: true, quote: "sent", stage: "negotiation", history: 0 });
  });

  // ── Review #320 MINOR: StageTransitionError-Abbildung der Status-Route ──
  it("C11 Pipeline ohne Gewonnen-Phase → 422 STAGE_NOT_FOUND, Angebot bleibt sent", async () => {
    await insertQuote("sent", "fixed_price");
    await client.query(
      `UPDATE api.pipeline_stages SET deleted_at = now() WHERE stage_kind = 'won' AND pipeline_id = (SELECT pipeline_id FROM api.deals WHERE id = $1)`,
      [DEAL]
    );
    const r = await setStatus("accepted");
    expect({ status: r.status, code: r.json.code, quote: await quoteStatus() }).toEqual({ status: 422, code: "STAGE_NOT_FOUND", quote: "sent" });
  });

  // ── Review #320 NIT: unbekannte Rechnung → 404 statt 500 ──
  it("C12 unbekannte Id: /status und PATCH [id] → 404", async () => {
    const a = await statusPATCH(req(`http://t/api/crm/invoices/${MISSING_INVOICE}/status`, "PATCH", { status: "sent" }) as never, params(MISSING_INVOICE));
    const b = await invoicePATCH(req(`http://t/api/crm/invoices/${MISSING_INVOICE}`, "PATCH", { notes: "x" }) as never, params(MISSING_INVOICE));
    expect([a.status, b.status]).toEqual([404, 404]);
  });

  it("C6 Gegenprobe gleiche Quelle: PATCH /api/crm/invoices/[id] accepted koppelt weiter (1 Verlaufseintrag, Projekt)", async () => {
    await insertQuote("sent", "fixed_price");
    const res = await invoicePATCH(req(`http://t/api/crm/invoices/${QUOTE}`, "PATCH", { status: "accepted" }) as never, params(QUOTE));
    expect({ status: res.status, kind: await dealStageKind(), history: await historyCount(), projects: await projectCount() }).toEqual({
      status: 200,
      kind: "won",
      history: 1,
      projects: 1,
    });
  });
});

// ── D — Entwurfs-PATCH: Projekt-Typ wie bei der Anlage aufloesen ────────────────────────────────
describe("D — Entwurfs-PATCH eines Angebots loest project_type_id wie die Anlage auf", () => {
  const patchType = async (projectTypeId: string) => {
    const res = await invoicePATCH(req(`http://t/api/crm/invoices/${QUOTE}`, "PATCH", { project_type_id: projectTypeId }) as never, params(QUOTE));
    return { status: res.status, bm: await one<string>(`SELECT billing_method AS v FROM api.invoices WHERE id = $1`, [QUOTE]) };
  };

  it("D1 Projekt-Typ aus api.tags (kind deal) → 200, billing_method des Tags", async () => {
    await insertQuote("draft", "fixed_price");
    expect(await patchType(TAG_RETAINER)).toEqual({ status: 200, bm: "retainer" });
  });

  it("D2 negativer Zwilling: Alt-Typ aus api.project_types → 200, billing_method des Alt-Typs", async () => {
    await insertQuote("draft", "fixed_price");
    expect(await patchType(LEGACY_TYPE)).toEqual({ status: 200, bm: "per_unit" });
  });

  it("D3 unbekannter Typ → 422, billing_method unveraendert", async () => {
    await insertQuote("draft", "fixed_price");
    expect(await patchType("0b0c0d03-0000-4000-8000-0000000000ff")).toEqual({ status: 422, bm: "fixed_price" });
  });
});

// ── E — items-PATCH: der Wurf bei 0 getroffenen Zeilen liegt IN der Transaktion ─────────────────
describe("E — PATCH /api/crm/invoices/[id] mit items, Feld-Update trifft keine Zeile", () => {
  const items = () =>
    one<string>(`SELECT string_agg(id || ':' || description, '|' ORDER BY position) AS v FROM api.invoice_items WHERE invoice_id = $1`, [QUOTE]);

  it("E1 UPDATE trifft 0 Zeilen → Zeilentausch zurueckgerollt, 404 (vorher: Zeilen getauscht, dann 500)", async () => {
    await insertQuote("draft", "fixed_price");
    // Lesen bleibt erlaubt (fetchInvoice), das UPDATE trifft unter agent_user keine Zeile mehr.
    await client.query(`ALTER POLICY invoices_update ON api.invoices USING (false)`);
    const before = await items();
    const res = await invoicePATCH(
      req(`http://t/api/crm/invoices/${QUOTE}`, "PATCH", { items: [{ description: "QDL getauscht", quantity: 1, unit_price: 3 }] }) as never,
      params(QUOTE)
    );
    expect({ status: res.status, items: await items() }).toEqual({ status: 404, items: before });
  });
});
