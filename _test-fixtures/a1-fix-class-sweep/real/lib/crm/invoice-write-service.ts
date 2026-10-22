/**
 * lib/crm/invoice-write-service.ts
 *
 * Einzige Schreibschicht für neue Rechnungen/Angebote (INSERT).
 *
 * GoBD-Invarianten:
 *  - Nummernkreis lückenlos via api.next_invoice_number() (DB-Sequence, kein MAX-peek).
 *  - Total = sum(items). kleinunternehmer → tax 0 %, sonst 19 %.
 *  - bill_to nur beim CREATE — kein Update-Schema nimmt es an (updateInvoiceFields wuerde es pruefen).
 *  - Alle DB-Zugriffe tenant-isoliert (immer tenant_id-Filter, nie withSystemContext).
 *  - SEC-7: customer_id, bill_to_customer_id und deal_id werden gegen den Mandanten geprueft,
 *    BEVOR geschrieben wird (einspaltige FKs umgehen RLS). Fremd und nicht existent → dieselbe 422.
 *
 * Verwendung:
 *   Aufrufer öffnet withTenantContext und übergibt den bereits offenen Client.
 *   insertInvoiceWithItems läuft INNERHALB der Transaktion des Aufrufers (atomar).
 *   bill_to_customer_id muss vom Aufrufer VORHER aufgelöst worden sein
 *   (via resolveBillTo aus bill-through-resolver.ts oder resolveBillToByProject).
 */

import type { PoolClient, QueryResultRow } from "pg";
import type { BillingMethod, InvoiceType } from "./types";
import { getNextInvoiceNumber } from "./invoice-number";
import { promoteProjectToActiveOnInvoice } from "./projects-write-service";
import { assertRefsInTenant } from "./tenant-references";
import { updateReturning } from "./_sql/write";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface InvoiceWriteFields {
  type: InvoiceType;
  customer_id: number;
  project_id?: number | null;
  issue_date: string;         // YYYY-MM-DD
  due_date?: string | null;   // YYYY-MM-DD; Fallback: issue_date + 14 d
  notes?: string | null;
  kleinunternehmer?: boolean; // default true (undefined → 0% MwSt §19 UStG); nur explizit false → 19%
  service_period_start?: string | null;
  service_period_end?: string | null;
  bill_to_customer_id?: number | null;
  converted_from_id?: number | null;
  /**
   * Deal, aus dem das Angebot (oder die Rechnung) entsteht. Geprueft (SEC-7) UND geschrieben.
   * Bis 2026-10-03 fehlte die Spalte im INSERT seit der Konsolidierung 180bdfda (2026-06-30) —
   * Angebote verloren still ihre Deal-Verknuepfung (Won-Gate, Deal-Wert, Annahme-Kopplung).
   * Vor 180bdfda schrieb der Dashboard-Pfad sie fuer jeden Typ (Spread-INSERT); das bleibt so.
   */
  deal_id?: number | null;
  /**
   * Abrechnungsart des Angebots (Migration 075, Feature 010). NUR fuer type='quote' — so steht es in
   * types/invoice.ts, und vor 180bdfda hat sie ausschliesslich der Angebots-Pfad mitgegeben. An einer
   * anderen Zeilenart ist sie ein Programmierfehler und wirft, statt still zu verschwinden.
   */
  billing_method?: BillingMethod | null;
}

export interface InvoiceItemWrite {
  description: string;
  quantity: number;
  unit?: string;              // default: "Stunde"
  unit_price: number;
  /** Nur für time-entry-generate-invoice: FK zu position_templates */
  position_id?: number | null;
  /** Nur für time-entry-generate-invoice: GoBD-Audit-Trail */
  notes?: string | null;
}

export interface InsertInvoiceWithItemsResult {
  invoice: {
    id: number;
    invoice_number: string;
    type: InvoiceType;
    status: "draft";
    project_id: number | null;
    total: number;
  };
  items: Array<{
    id: number;
    invoice_id: number;
    position: number;
    total: number;
  }>;
}

// ---------------------------------------------------------------------------
// Hilfs: due_date-Fallback (+14 Tage ab issue_date)
// ---------------------------------------------------------------------------

function dueDateFallback(issueDate: string): string {
  const d = new Date(issueDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 14);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// SEC-7: Referenzen gegen den Mandanten pruefen
// ---------------------------------------------------------------------------

/** Felder einer Rechnung, die auf mandantengebundene Zeilen zeigen und einspaltige FKs haben. */
export interface InvoiceReferenceFields {
  customer_id?: number | null;
  bill_to_customer_id?: number | null;
  deal_id?: number | null;
}

/**
 * Wirft TenantReferenceError (422), wenn eine der Referenzen nicht im Mandanten liegt.
 * project_id fehlt bewusst: invoices_project_tenant_fkey ist bereits zusammengesetzt.
 */
export async function assertInvoiceReferences(
  client: PoolClient,
  tenantId: string,
  fields: InvoiceReferenceFields
): Promise<void> {
  await assertRefsInTenant(client, tenantId, [
    ["customer", fields.customer_id],
    ["customer", fields.bill_to_customer_id],
    ["deal", fields.deal_id],
  ]);
}

/**
 * Felder einer bestehenden Rechnung aendern — die gemeinsame Stelle fuer `UPDATE api.invoices`
 * hinter `updateInvoice` (Entwurfs-Bearbeitung, aber auch Status- und Zahlungs-Routen) und dem
 * items-/selected_items-Zweig der Dashboard-Bearbeitung. Prueft die Referenzen (`customer_id`,
 * und falls je gesetzt `bill_to_customer_id`/`deal_id`) im selben Client, also derselben
 * Transaktion, und schreibt erst danach. Felder ohne Referenz (Status, Betraege) laufen ohne
 * Abfrage durch.
 *
 * Gibt `undefined` zurueck, wenn keine Zeile getroffen wurde (unbekannt oder fremder Mandant —
 * RLS scoped das UPDATE). Der GoBD-Trigger sitzt auf der Tabelle und greift unveraendert.
 */
export async function updateInvoiceFields<T extends QueryResultRow>(
  client: PoolClient,
  tenantId: string,
  id: number,
  updates: Record<string, unknown>
): Promise<T | undefined> {
  await assertInvoiceReferences(client, tenantId, updates as InvoiceReferenceFields);
  return updateReturning<T>(client, "invoices", "id", id, updates);
}

/**
 * Angebot annehmen — NUR aus "sent", im Mandanten (Review PR #320). Gibt die Zeile zurueck oder
 * `undefined`, wenn keine getroffen wurde (unbekannt, fremd, oder nicht mehr "sent" — die
 * Unterscheidung trifft der Aufrufer). Der GoBD-Trigger erlaubt den Statuswechsel sent → accepted.
 */
export async function markQuoteAccepted<T extends QueryResultRow>(
  client: PoolClient,
  tenantId: string,
  quoteId: number
): Promise<T | undefined> {
  const { rows } = await client.query<T>(
    `UPDATE api.invoices
        SET status = 'accepted', accepted_at = now()
      WHERE id = $1 AND tenant_id = $2 AND type = 'quote' AND status = 'sent'
      RETURNING *`,
    [quoteId, tenantId]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Core-Funktion
// ---------------------------------------------------------------------------

/**
 * Legt Invoice + Items in der BEREITS OFFENEN Transaktion des Aufrufers an.
 *
 * Der Aufrufer ist verantwortlich für:
 *   1. withTenantContext → client
 *   2. bill_to_customer_id (vorher aufgelöst)
 *   3. Audit-Log (withAuditLog um diesen Call wenn nötig)
 *
 * Gibt invoice + items zurück (RETURNING).
 *
 * GoBD: Nummernkreis via api.next_invoice_number (DB-Sequence + Self-Healing).
 * Kein MAX-peek, kein Duplicate-Guard erforderlich (Sequence ist SSOT).
 */
export async function insertInvoiceWithItems(
  client: PoolClient,
  tenantId: string,
  fields: InvoiceWriteFields,
  items: InvoiceItemWrite[]
): Promise<InsertInvoiceWithItemsResult> {
  // ── 0a. billing_method nur an Angeboten (vor jedem Schreiben, vor dem Nummernkreis) ──
  if (fields.billing_method != null && fields.type !== "quote") {
    throw new Error(
      `insertInvoiceWithItems: billing_method ist nur fuer type='quote' vorgesehen (erhalten: type='${fields.type}').`
    );
  }

  // ── 0. SEC-7: Referenzen im eigenen Mandanten? (vor Nummernkreis und INSERT) ──
  await assertInvoiceReferences(client, tenantId, fields);

  // ── 1. Totals berechnen (GoBD: Total = sum(items)) ─────────────────────
  const kleinunternehmer = fields.kleinunternehmer !== false; // default true → 0% MwSt
  const subtotal = items.reduce(
    (sum, item) => sum + Math.round(item.quantity * item.unit_price * 100) / 100,
    0
  );
  const taxRate = kleinunternehmer ? 0 : 19;
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  const issueDate = fields.issue_date;
  const dueDate = fields.due_date ?? dueDateFallback(issueDate);

  // ── 2. Nummernkreis via DB-Sequence (lückenlos, kein MAX-peek) ─────────
  const invoiceNumber = await getNextInvoiceNumber(client, fields.type);

  // ── 3. Invoice INSERT ───────────────────────────────────────────────────
  // node-pg returns NUMERIC columns as string — we parse them explicitly.
  const { rows: invRows } = await client.query<{
    id: number;
    invoice_number: string;
    type: string;
    status: string;
    project_id: number | null;
    total: string; // NUMERIC → string in node-pg
  }>(
    `INSERT INTO api.invoices
       (tenant_id, type, customer_id, project_id,
        invoice_number, issue_date, due_date,
        subtotal, tax_rate, tax_amount, total,
        kleinunternehmer, notes,
        service_period_start, service_period_end,
        bill_to_customer_id, converted_from_id,
        deal_id, billing_method,
        status, paid_amount)
     VALUES
       ($1, $2::api.invoice_type, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13,
        $14, $15,
        $16, $17,
        $18, $19,
        'draft', 0)
     RETURNING id, invoice_number, type::text AS type,
               status::text AS status, project_id, total`,
    [
      tenantId,                              // $1
      fields.type,                           // $2
      fields.customer_id,                    // $3
      fields.project_id ?? null,             // $4
      invoiceNumber,                         // $5
      issueDate,                             // $6
      dueDate,                               // $7
      subtotal,                              // $8
      taxRate,                               // $9
      taxAmount,                             // $10
      total,                                 // $11
      kleinunternehmer,                      // $12
      fields.notes ?? null,                  // $13
      fields.service_period_start ?? null,   // $14
      fields.service_period_end ?? null,     // $15
      fields.bill_to_customer_id ?? null,    // $16
      fields.converted_from_id ?? null,      // $17
      fields.deal_id ?? null,                // $18
      fields.billing_method ?? null,         // $19
    ]
  );

  const newInvoice = invRows[0]!;

  // ── 4. Items INSERT (1-basierte Position, atomar in derselben Tx) ───────
  const insertedItems: Array<{ id: number; invoice_id: number; position: number; total: number }> = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]!;
    const itemTotal = Math.round(item.quantity * item.unit_price * 100) / 100;

    const { rows: itemRows } = await client.query<{
      id: number;
      invoice_id: number;
      position: number;
      total: string; // NUMERIC → string in node-pg
    }>(
      `INSERT INTO api.invoice_items
         (tenant_id, invoice_id, position,
          description, quantity, unit, unit_price, total,
          notes, position_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, invoice_id, position, total`,
      [
        tenantId,                       // $1
        newInvoice.id,                  // $2
        idx + 1,                        // $3 (1-basiert)
        item.description,               // $4
        item.quantity,                  // $5
        item.unit ?? "Stunde",          // $6
        item.unit_price,                // $7
        itemTotal,                      // $8
        item.notes ?? null,             // $9
        item.position_id ?? null,       // $10
      ]
    );

    const rawItem = itemRows[0]!;
    insertedItems.push({ ...rawItem, total: parseFloat(rawItem.total) });
  }

  // ── 5. Projektstatus automatisch nachziehen ─────────────────────────────
  // Eine echte Rechnung bedeutet Umsetzung statt Planung. Die Mutation lebt
  // im kanonischen Projekt-Write-Service (Write-Path-Gate, Spec 034) und
  // läuft in derselben Transaktion wie der Invoice-INSERT.
  if (fields.type === "invoice" && newInvoice.project_id != null) {
    await promoteProjectToActiveOnInvoice(client, tenantId, newInvoice.project_id);
  }

  return {
    invoice: {
      id: newInvoice.id,
      invoice_number: newInvoice.invoice_number,
      type: newInvoice.type as InvoiceType,
      status: "draft" as const,
      project_id: newInvoice.project_id,
      total: parseFloat(newInvoice.total),
    },
    items: insertedItems,
  };
}
